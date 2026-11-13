-- AI Apparel CRM -> Monday. Run as the project database administrator.
-- Secret values remain in Edge Function secrets / Vault and are never stored here.
create table if not exists ai_crm.monday_sync_state (
 kind text not null, source_id text not null, item_id text, fingerprint text,
 synced_at timestamptz, last_error text, group_title text, primary key(kind,source_id)
);
alter table ai_crm.monday_sync_state enable row level security;
revoke all on ai_crm.monday_sync_state from public,anon,authenticated;
grant all on ai_crm.monday_sync_state to service_role;
create table if not exists ai_crm.monday_sync_lock(id int primary key check(id=1),owner text,expires_at timestamptz);
alter table ai_crm.monday_sync_lock enable row level security;
revoke all on ai_crm.monday_sync_lock from public,anon,authenticated;
grant all on ai_crm.monday_sync_lock to service_role;
insert into ai_crm.monday_sync_lock(id) values(1) on conflict do nothing;
grant usage on schema ai_crm to service_role;
grant select on ai_crm.business_accounts,ai_crm.business_contacts,ai_crm.online_customers,ai_crm.customer_business_links,ai_crm.clients,ai_crm.quotes,ai_crm.quote_line_items,ai_crm.jobs,ai_crm.quote_approval_workflows,ai_crm.quote_proofs,ai_crm.tasks,ai_crm.staff,ai_crm.job_production,ai_crm.production_stages,ai_crm.quote_internal_costs to service_role;
CREATE OR REPLACE FUNCTION public.ai_apparel_monday_sync_internal(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v jsonb; begin
if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required'; end if;
if p_action='lock' then
 update ai_crm.monday_sync_lock set owner=p_payload->>'owner',expires_at=now()+interval '3 minutes'
 where id=1 and (expires_at is null or expires_at<now());
 return jsonb_build_object('acquired',found);
elsif p_action='release' then
 update ai_crm.monday_sync_lock set expires_at=null,owner=null where id=1 and owner=p_payload->>'owner';
 return '{}'::jsonb;
elsif p_action='ack' then
 insert into ai_crm.monday_sync_state(kind,source_id,item_id,fingerprint,synced_at,last_error,group_title)
 values(p_payload->>'kind',p_payload->>'source_id',p_payload->>'item_id',p_payload->>'fingerprint',now(),p_payload->>'error',p_payload->>'group_title')
 on conflict(kind,source_id) do update set item_id=coalesce(excluded.item_id,ai_crm.monday_sync_state.item_id),
 fingerprint=case when excluded.last_error is null then excluded.fingerprint else ai_crm.monday_sync_state.fingerprint end,
 synced_at=case when excluded.last_error is null then excluded.synced_at else ai_crm.monday_sync_state.synced_at end,last_error=excluded.last_error,group_title=coalesce(excluded.group_title,ai_crm.monday_sync_state.group_title);
 return '{}'::jsonb;
elsif p_action='snapshot' then
 select jsonb_build_object(
 'businesses',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.business_accounts t),
 'contacts',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.business_contacts t),
 'customers',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.online_customers t),
 'links',(select coalesce(jsonb_agg(to_jsonb(t) order by t.customer_id,t.business_id),'[]') from ai_crm.customer_business_links t),
 'clients',(select coalesce(jsonb_agg(to_jsonb(t)-'monday_item_id' order by t.id),'[]') from ai_crm.clients t),
 'quotes',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.quotes t),
 'lines',(select coalesce(jsonb_agg(to_jsonb(t) order by t.quote_id,t.position,t.id),'[]') from ai_crm.quote_line_items t),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(t)-'monday_item_id' order by t.id),'[]') from ai_crm.jobs t),
 'workflows',(select coalesce(jsonb_agg(to_jsonb(t)-'approval_token_hash' order by t.quote_id),'[]') from ai_crm.quote_approval_workflows t),
 'proofs',(select coalesce(jsonb_agg(jsonb_build_object('quote_id',t.quote_id,'filename',t.filename,'uploaded_at',t.uploaded_at) order by t.id),'[]') from ai_crm.quote_proofs t),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.tasks t),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'display_name',t.display_name,'email',t.email) order by t.id),'[]') from ai_crm.staff t),
 'production',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.job_production t),
 'stages',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.production_stages t),
 'costs',(select coalesce(jsonb_agg(to_jsonb(t) order by t.quote_id,t.line_position),'[]') from ai_crm.quote_internal_costs t),
 'files',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from ai_crm.quote_proofs t),
 'state',(select coalesce(jsonb_agg(to_jsonb(t) order by t.kind,t.source_id),'[]') from ai_crm.monday_sync_state t)
 ) into v; return v;
end if;
raise exception 'Unknown action';
end $function$

revoke all on function public.ai_apparel_monday_sync_internal(text,jsonb) from public,anon,authenticated;
grant execute on function public.ai_apparel_monday_sync_internal(text,jsonb) to service_role;
select cron.schedule('ai-apparel-monday-sync','* * * * *',$cron$
select net.http_post(
 url:='https://qpavspvpdebtbbffdcmo.supabase.co/functions/v1/ai-apparel-monday-sync',
 headers:=jsonb_build_object('Content-Type','application/json','x-ai-financial-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='ai_apparel_financial_cron_token' limit 1)),
 body:='{}'::jsonb,timeout_milliseconds:=120000)
where exists(select 1 from vault.decrypted_secrets where name='ai_apparel_financial_cron_token');
$cron$);
