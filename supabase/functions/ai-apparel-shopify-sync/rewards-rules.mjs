export const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const normal = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const values = a => Array.isArray(a) ? a : [];
export function configurations(context) {
 return context.integrations.filter(i => i.provider === "shopify" && i.enabled).map(i => {
 const o = context.organizations.find(o => o.id === i.organization_id);
 const meta = i.metadata || {};
 return {...i,organization:o,aliases:[i.product_title_matcher,i.customer_tag,o?.tag,o?.name,o?.short_name,...values(meta.match_aliases)].map(normal).filter(a=>a.length>=3)};
 }).filter(i=>i.organization?.status==="active");
}
export function classifyOrder(order,context) {
 const configs=configurations(context),review=[],rows=[];
 if(order.lineItems.pageInfo?.hasNextPage)return {rows,review:[{order:order.name,reason:"line_items_require_pagination"}]};
 const lines=order.lineItems.nodes||[];
 const tags=[...values(order.tags),...values(order.customer?.tags)].map(normal);
 const tagged=configs.filter(c=>c.aliases.some(a=>tags.includes(a)));
 const linked=context.quotes.filter(q=>q.order_id===order.id);
 const linkedOrg=[...new Set(linked.map(q=>q.organization_id))];
 const lineOrganizations=lines.map(l=>{
 const prefix=normal(String(l.title||"").split("|")[0]);
 const matches=configs.filter(c=>c.aliases.some(a=>prefix.startsWith(a)));
 if(matches.length>1){review.push({order:order.name,reason:"ambiguous_product_match",title:l.title});return null;}
 return matches[0]?.organization_id||null;
 });
 const identified=[...new Set([...lineOrganizations.filter(Boolean),...linkedOrg,...(tagged.length===1?[tagged[0].organization_id]:[])])];
 for(const org of identified){
 const cfg=configs.find(c=>c.organization_id===org);
 if(!cfg)continue;
 const selected=lines.filter((l,i)=>{
 if(lineOrganizations[i])return lineOrganizations[i]===org;
 return linkedOrg.length===1?linkedOrg[0]===org:tagged.length===1&&tagged[0].organization_id===org;
 });
 if(!selected.length)continue;
 const money=l=>Number(l.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount||0);
 const tax=l=>order.taxesIncluded?(l.taxLines||[]).reduce((s,t)=>s+Number(t.priceSet?.shopMoney?.amount||0),0)/Math.max(1,Number(l.quantity||0)):0;
 if(selected.some(l=>l.originalUnitPriceSet?.shopMoney?.currencyCode!=="USD")){review.push({order:order.name,organization_id:org,reason:"unsupported_currency"});continue;}
 const subtotal=selected.length===lines.length&&!order.taxesIncluded&&order.currentSubtotalPriceSet?round(order.currentSubtotalPriceSet.shopMoney.amount):round(selected.reduce((s,l)=>s+Math.max(0,money(l)-tax(l))*Number(l.currentQuantity||0),0));
 const original=round(selected.reduce((s,l)=>s+Number(l.originalUnitPriceSet?.shopMoney?.amount||0)*Number(l.currentQuantity||0),0));
 const discount=round(Math.max(0,original-subtotal));
 const direct=order.sourceName==="shopify_draft_order"||linkedOrg.includes(org);

 const eligible=!order.cancelledAt&&!order.test&&["PAID","PARTIALLY_REFUNDED"].includes(order.displayFinancialStatus);
 const codes=values(order.discountCodes);
 const deferred=codes.some(code=>values(cfg.metadata?.deferred_coupon_codes).some(approved=>String(approved).toLowerCase()===String(code).toLowerCase()));
 const multiplier=deferred?1:direct?1:2;
 const couponReview=eligible&&!deferred&&subtotal===0&&original>0&&codes.length>0;
 if(couponReview)review.push({order:order.name,organization_id:org,reason:"full_discount_coupon_needs_classification",coupon_codes:codes,original_merchandise:original});
 rows.push({
 organization_id:org,external_order_id:order.id,order_number:order.name,
 order_type:direct?"QUOTE":"ONLINE",source:"shopify",
 customer_name:[order.customer?.firstName,order.customer?.lastName].filter(Boolean).join(" ")||null,
 customer_email:order.customer?.email||null,subtotal,rewards_multiplier:multiplier,
 rewards_points:eligible&&!couponReview?round((deferred?original:subtotal)*multiplier):0,
 payment_status:order.cancelledAt?"CANCELLED":order.displayFinancialStatus,
 fulfillment_status:order.displayFulfillmentStatus,ordered_at:order.createdAt,
 discount_codes:codes,discount_amount:discount,
 raw_data:{matcher:cfg.product_title_matcher||cfg.organization.name,shopify_updated_at:order.updatedAt,eligible,review_required:couponReview?"full_discount_coupon_needs_classification":null,
 original_qualifying_subtotal:original,...(deferred?{rewards_entry_method:"deferred_coupon",rewards_only_credit:true}:{}),qualifying_items:selected.map(l=>({title:l.title,quantity:l.currentQuantity})),linked_quotes:linked.filter(q=>q.organization_id===org).map(q=>({id:q.id,kind:q.kind})),rewards_rule:deferred?"deferred_coupon_original_merchandise_1x":direct?"direct_quote_1x":"online_store_2x"}
 });
 }
 return {rows,review};
}
