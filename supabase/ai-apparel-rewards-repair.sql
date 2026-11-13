
-- Rewards amounts are stored transactionally; this does not create sales, invoices or tax entries.
create unique index if not exists ai_apparel_orders_source_external_org_key on public.ai_apparel_orders(source,external_order_id,organization_id);
alter table public.ai_apparel_orders drop constraint if exists ai_apparel_orders_source_external_order_id_key;

create or replace function public.ai_apparel_rewards_sync_context()
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
return jsonb_build_object(
 'organizations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.ai_apparel_organizations o),
 'integrations',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.ai_apparel_organization_integrations i),
 'quotes',(select coalesce(jsonb_agg(t),'[]') from (
 select q.id::text,'crm'::text kind,b.rewards_organization_id organization_id,w.shopify_draft_order_id draft_id,j.shopify_order_id order_id
 from ai_crm.quotes q join ai_crm.business_accounts b on b.id=q.business_id
 join ai_crm.quote_approval_workflows w on w.quote_id=q.id
 left join ai_crm.jobs j on j.quote_id=q.id where w.shopify_draft_order_id is not null
 union all
 select q.id::text,'legacy',q.organization_id,q.shopify_draft_order_id,q.shopify_order_id
 from public.ai_apparel_quote_requests q where q.shopify_draft_order_id is not null)t)
);
end $$;
revoke all on function public.ai_apparel_rewards_sync_context() from public,anon,authenticated;
grant execute on function public.ai_apparel_rewards_sync_context() to service_role;

create or replace function public.ai_apparel_rewards_sync_order(p_order jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.ai_apparel_orders%rowtype; saved public.ai_apparel_orders%rowtype; ledger_before jsonb; linked jsonb; v_points numeric; v_org text; v_external text; v_reference text;
begin
if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
v_org:=p_order->>'organization_id'; v_external:=p_order->>'external_order_id';
if p_order->>'source'<>'shopify' or v_external not like 'gid://shopify/Order/%' or not exists(select 1 from public.ai_apparel_organizations where id=v_org and status='active') then raise exception 'Invalid automatic rewards source';end if;
v_points:=(p_order->>'rewards_points')::numeric;
if v_points<0 or (p_order->>'subtotal')::numeric<0 then raise exception 'Invalid automatic rewards amount';end if;
perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_org||':'||v_external,0));
v_reference:=regexp_replace(upper(p_order->>'order_number'),'[^A-Z0-9]','','g');
if exists(select 1 from public.ai_apparel_orders o where o.organization_id=v_org and o.source='admin' and
 (regexp_replace(upper(o.order_number),'[^A-Z0-9]','','g')=v_reference or regexp_replace(upper(o.raw_data->>'original_order_number'),'[^A-Z0-9]','','g')=v_reference))
 then return jsonb_build_object('ok',true,'skipped','manual_credit_preserved');end if;
select * into previous from public.ai_apparel_orders where organization_id=v_org and external_order_id=v_external and source='shopify';
select to_jsonb(l) into ledger_before from public.ai_apparel_rewards_ledger l where organization_id=v_org and external_reference=v_external and transaction_type='EARN';
insert into public.ai_apparel_orders(organization_id,external_order_id,order_number,order_type,source,customer_name,customer_email,subtotal,rewards_multiplier,rewards_points,payment_status,fulfillment_status,ordered_at,discount_codes,discount_amount,raw_data,updated_at)
values(v_org,v_external,p_order->>'order_number',p_order->>'order_type','shopify',p_order->>'customer_name',p_order->>'customer_email',(p_order->>'subtotal')::numeric,(p_order->>'rewards_multiplier')::numeric,v_points,p_order->>'payment_status',p_order->>'fulfillment_status',(p_order->>'ordered_at')::timestamptz,array(select jsonb_array_elements_text(coalesce(p_order->'discount_codes','[]'))),(p_order->>'discount_amount')::numeric,p_order->'raw_data',now())
on conflict(source,external_order_id,organization_id) do update set
 order_number=excluded.order_number,order_type=excluded.order_type,customer_name=excluded.customer_name,customer_email=excluded.customer_email,
 subtotal=excluded.subtotal,rewards_multiplier=excluded.rewards_multiplier,rewards_points=excluded.rewards_points,
 payment_status=excluded.payment_status,fulfillment_status=excluded.fulfillment_status,discount_codes=excluded.discount_codes,discount_amount=excluded.discount_amount,raw_data=excluded.raw_data,updated_at=now()
returning * into saved;
insert into public.ai_apparel_rewards_ledger(organization_id,order_id,transaction_type,points,description,source,external_reference,occurred_at)
values(v_org,saved.id,'EARN',v_points,(case when saved.order_type='ONLINE' then 'Company Store purchase ' else 'Direct quote purchase ' end)||saved.order_number,'shopify',v_external,saved.ordered_at)
on conflict(organization_id,external_reference,transaction_type) do update set order_id=excluded.order_id,points=excluded.points,description=excluded.description,source=excluded.source;
if previous.id is null or previous.rewards_points is distinct from saved.rewards_points or previous.payment_status is distinct from saved.payment_status or previous.subtotal is distinct from saved.subtotal then
 insert into public.ai_apparel_admin_audit_log(admin_email,organization_id,action,entity_type,entity_id,before_data,after_data,note)
 values('system:rewards-sync',v_org,'SYNC_REWARDS_ORDER','order',saved.id::text,jsonb_build_object('order',to_jsonb(previous),'ledger',ledger_before),to_jsonb(saved),'Verified AI Apparel Shopify order; rewards update only');
end if;
for linked in select value from jsonb_array_elements(coalesce(p_order->'raw_data'->'linked_quotes','[]')) loop
 if linked->>'kind'='crm' then
 update ai_crm.quote_approval_workflows set payment_status=saved.payment_status,invoice_status=case when saved.payment_status='PAID' then 'PAID' else invoice_status end
 where quote_id=(linked->>'id')::uuid;
 elsif linked->>'kind'='legacy' and saved.payment_status in ('PAID','PARTIALLY_REFUNDED') then
 update public.ai_apparel_quote_requests set status='completed',shopify_order_id=v_external,rewards_order_id=saved.id,completed_at=coalesce(completed_at,now())
 where id=(linked->>'id')::uuid and organization_id=v_org;
 end if;
end loop;
return jsonb_build_object('ok',true,'order_id',saved.id,'points',v_points,'changed',previous.id is null or previous.rewards_points is distinct from saved.rewards_points);
end $$;
revoke all on function public.ai_apparel_rewards_sync_order(jsonb) from public,anon,authenticated;
grant execute on function public.ai_apparel_rewards_sync_order(jsonb) to service_role;
grant update(payment_status,invoice_status,shopify_invoice_total) on ai_crm.quote_approval_workflows to service_role;

create or replace function public.ai_apparel_rewards_summary(p_organization_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
select jsonb_build_object('balance',coalesce(sum(points),0),
 'available_credit',greatest(0,coalesce(sum(points),0))/100,
 'tier_points',greatest(0,coalesce(sum(points) filter(where transaction_type<>'REDEEM' and occurred_at>=date_trunc('year',now() at time zone 'America/New_York') at time zone 'America/New_York'),0)),
 'year',extract(year from now() at time zone 'America/New_York'),
 'entries',count(*),'last_activity',max(occurred_at))
 into result from public.ai_apparel_rewards_ledger where organization_id=p_organization_id;
return result;end $$;
revoke all on function public.ai_apparel_rewards_summary(text) from public,anon,authenticated;
grant execute on function public.ai_apparel_rewards_summary(text) to service_role;
