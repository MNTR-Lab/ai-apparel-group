import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, authorization, apikey","Access-Control-Allow-Methods":"GET,OPTIONS"};
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="GET") return out({error:"GET required"},405);
 try{
  const url=new URL(req.url); const requestedOrg=url.searchParams.get("organization_id");
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const authHeader=req.headers.get("Authorization")||""; if(!authHeader.startsWith("Bearer ")) return out({error:"Sign in required"},401);
  const {data:userData,error:userError}=await sb.auth.getUser(authHeader.slice(7)); const userEmail=userData.user?.email?.toLowerCase();
  if(userError||!userEmail) return out({error:"Invalid or expired session"},401);
  const {data:admin,error:adminError}=await sb.from("ai_apparel_admins").select("email,role,active").eq("email",userEmail).eq("role","super_admin").eq("active",true).maybeSingle();
  if(adminError) throw adminError;
  const isSuperAdmin=Boolean(admin);
  if(url.searchParams.get("list_organizations")==="1"){
    if(!isSuperAdmin) return out({error:"Super admin access required"},403);
    const {data:organizations,error:listError}=await sb.from("ai_apparel_organizations").select("id,name").eq("status","active").order("name",{ascending:true});
    if(listError) throw listError;
    return out({organizations:organizations||[],isSuperAdmin:true});
  }
  const {data:member,error:memberError}=await sb.from("ai_apparel_organization_members").select("organization_id,email,first_name,last_name,role,active").eq("email",userEmail).eq("active",true).maybeSingle();
  if(memberError) throw memberError;
  if(!isSuperAdmin&&!member) return out({error:"No active organization access is assigned to this account"},403);
  // Only verified super admins can select another organization.
  // For admins with no organization membership, default to the first active organization.
  let org=member?.organization_id||"";
  if(isSuperAdmin){
    if(requestedOrg) org=requestedOrg;
    else if(!org){
      const {data:defaultOrg,error:defaultError}=await sb.from("ai_apparel_organizations").select("id").eq("status","active").order("name",{ascending:true}).limit(1).maybeSingle();
      if(defaultError) throw defaultError;
      org=defaultOrg?.id||"";
    }
  }else if(requestedOrg&&requestedOrg!==org){
    return out({error:"You do not have access to this organization"},403);
  }
  if(!org) return out({error:"No active organization available"},404);
  const {data:organization,error:oerr}=await sb.from("ai_apparel_organizations").select("id,name,tag,short_name,status,logo_url").eq("id",org).eq("status","active").single(); if(oerr) throw oerr;
  const {data:rewards,error:rewardsError}=await sb.rpc("ai_apparel_rewards_summary",{p_organization_id:org});
  if(rewardsError)throw rewardsError;
  const {data:integration,error:integrationError}=await sb.from("ai_apparel_organization_integrations").select("provider,customer_tag,store_url,enabled,metadata,product_title_matcher").eq("organization_id",org); if(integrationError) throw integrationError;
  const {data:orders,error:ordersError}=await sb.from("ai_apparel_orders").select("order_number,order_type,source,customer_name,subtotal,rewards_points,discount_codes,discount_amount,payment_status,fulfillment_status,ordered_at").eq("organization_id",org).order("ordered_at",{ascending:false}); if(ordersError) throw ordersError;
  const formattedOrders=(orders||[]).map((x:any)=>({id:x.order_number,type:x.order_type,source:x.source,customer:x.customer_name||null,total:Number(x.subtotal||0),points:Number(x.rewards_points||0),discountCodes:Array.isArray(x.discount_codes)?x.discount_codes:[],discountAmount:Number(x.discount_amount||0),date:x.ordered_at?String(x.ordered_at).slice(0,10):null,paymentStatus:x.payment_status,fulfillmentStatus:x.fulfillment_status}));
  const {data:promotionalOrders,error:promotionalError}=await sb.from("ai_apparel_promotional_history").select(`id,sage_document_id,sage_client_id,sage_form_type_text,order_date,status,job_number,po_number,ship_to_company,ship_to_contact,merchandise_total,additional_charge_total,historical_order_total,item_count,rewards_eligible,metadata,ai_apparel_promotional_history_items(sage_item_id,sage_product_id,item_number,supplier_item_number,description,quantity,color,size,imprint,historical_unit_price,historical_extended_price)`).eq("organization_id",org).order("order_date",{ascending:false}); if(promotionalError) throw promotionalError;
  const promotionalPreviousOrders=(promotionalOrders||[]).map((order:any)=>{const items=order.ai_apparel_promotional_history_items||[]; return {id:order.sage_document_id,historicalOrderId:order.id,source:"Promotional",type:"Previous Order",date:order.order_date?String(order.order_date).slice(0,10):null,status:order.status||null,jobNumber:order.job_number||null,poNumber:order.po_number||null,shipTo:{company:order.ship_to_company||null,contact:order.ship_to_contact||null},merchandiseTotal:Number(order.merchandise_total||0),additionalCharges:Number(order.additional_charge_total||0),total:Number(order.historical_order_total||0),itemCount:Number(order.item_count||0),rewardsEligible:false,points:0,linkedInvoice:order.metadata?.linkedCompanyStoreDraft?{draftNumber:order.metadata?.shopifyDraftOrderNumber||null,invoiceNumber:order.metadata?.shopifyOrderNumber||order.metadata?.shopifyDraftOrderNumber||null,orderNumber:order.metadata?.shopifyOrderNumber||null,subtotal:Number(order.metadata?.shopifyDraftSubtotal||0),shipping:Number(order.metadata?.shopifyDraftShipping||0),tax:Number(order.metadata?.shopifyDraftTax||0),total:Number(order.metadata?.shopifyDraftTotal||0),paymentStatus:order.metadata?.shopifyPaymentStatus||"UNPAID",paymentUrl:order.metadata?.companyStorePaymentUrl||order.metadata?.shopifyInvoiceUrl||null}:null,items:items.map((item:any)=>({id:item.sage_item_id,productId:item.sage_product_id,itemNumber:item.item_number||null,supplierItemNumber:item.supplier_item_number||null,description:item.description||null,quantity:Number(item.quantity||0),color:item.color||null,size:item.size||null,imprint:item.imprint||null,previousUnitPrice:Number(item.historical_unit_price||0),previousExtendedPrice:Number(item.historical_extended_price||0)}))};});
  const historicalUnpaid=promotionalPreviousOrders.filter((x:any)=>x.linkedInvoice&&!["PAID","COMPLETED","VOID","CANCELLED"].includes(String(x.linkedInvoice.paymentStatus||"").toUpperCase())).map((x:any)=>({invoiceNumber:x.linkedInvoice.invoiceNumber||x.linkedInvoice.draftNumber||null,draftNumber:x.linkedInvoice.draftNumber||null,jobNumber:x.jobNumber||null,historicalOrderId:x.historicalOrderId||null,date:x.date||null,subtotal:Number(x.linkedInvoice.subtotal||0),shipping:Number(x.linkedInvoice.shipping||0),tax:Number(x.linkedInvoice.tax||0),total:Number(x.linkedInvoice.total||0),paymentStatus:x.linkedInvoice.paymentStatus||"UNPAID",paymentUrl:x.linkedInvoice.paymentUrl||null,source:"Promotional"}));
  // Live quote-created Company Store invoices. This makes every newly invoiced approved quote appear automatically in Open Invoices.
  const {data:quoteInvoices,error:qInvErr}=await sb.from("ai_apparel_quote_requests").select("id,request_number,status,quoted_subtotal,quoted_total,freight_charge,shopify_draft_order_id,company_store_invoice_url,invoiced_at,metadata").eq("organization_id",org).eq("status","invoiced").not("shopify_draft_order_id","is",null).order("invoiced_at",{ascending:false}); if(qInvErr) throw qInvErr;
  const liveQuoteUnpaid=(quoteInvoices||[]).filter((q:any)=>q.metadata?.exclude_from_open_invoices!==true).map((q:any)=>({invoiceNumber:q.metadata?.company_store_draft_order_name||q.request_number,draftNumber:q.metadata?.company_store_draft_order_name||null,quoteNumber:q.request_number,quoteId:q.id,jobNumber:null,historicalOrderId:null,date:q.invoiced_at?String(q.invoiced_at).slice(0,10):null,subtotal:Number(q.quoted_subtotal||q.quoted_total||0),shipping:Number(q.freight_charge||0),tax:0,total:Number(q.quoted_total||0),paymentStatus:"UNPAID",paymentUrl:q.company_store_invoice_url||null,source:"Promotional Quote"}));
  const {data:crmDrafts,error:crmDraftError}=await sb.rpc("ai_apparel_org_crm_pending_drafts",{p_organization_id:org});
  if(crmDraftError)throw crmDraftError;
  const crmPending=(crmDrafts||[]).map((q:any)=>({
    invoiceNumber:q.shopify_draft_name||q.quote_number,draftNumber:q.shopify_draft_name||null,
    quoteNumber:q.quote_number,quoteId:q.quote_id,jobNumber:null,historicalOrderId:null,
    date:q.quote_date?String(q.quote_date).slice(0,10):null,
    subtotal:Number(q.quote_subtotal||0),shipping:Number(q.quote_shipping||0),tax:Number(q.quote_tax||0),
    total:Number(q.shopify_invoice_total||q.quote_total||0),
    paymentStatus:q.invoice_status==="DRAFT_CREATED"?"DRAFT — PENDING REVIEW":(["SENT","INVOICE_SENT"].includes(q.invoice_status)?"UNPAID":"STATUS NEEDS REVIEW"),
    paymentUrl:["SENT","INVOICE_SENT"].includes(q.invoice_status)?q.invoice_url:null,
    source:"CRM Quote",invoiceStatus:q.invoice_status,title:q.quote_title
  }));
  const {data:crmQuotes,error:crmQuotesError}=await sb.rpc("ai_apparel_org_crm_quotes",{p_organization_id:org});
  if(crmQuotesError)throw crmQuotesError;
  const {data:legacyQuotes,error:legacyQuotesError}=await sb.from("ai_apparel_quote_requests").select("id,request_number,status,project_name,quoted_subtotal,quoted_total,submitted_at,updated_at").eq("organization_id",org).order("submitted_at",{ascending:false});
  if(legacyQuotesError)throw legacyQuotesError;
  const currentQuotes=[
    ...(Array.isArray(crmQuotes)?crmQuotes:[]).map((q:any)=>({...q,source:"CRM",number:q.quoteNumber})),
    ...(legacyQuotes||[]).map((q:any)=>({id:q.id,quoteNumber:q.request_number,number:q.request_number,title:q.project_name,status:q.status,subtotal:Number(q.quoted_subtotal||0),total:Number(q.quoted_total||0),date:q.submitted_at?String(q.submitted_at).slice(0,10):null,source:"Partner Portal"}))
  ].sort((a:any,b:any)=>String(b.date||"").localeCompare(String(a.date||"")));
  const seen=new Set<string>(); const unpaidInvoices=[...crmPending,...liveQuoteUnpaid,...historicalUnpaid].filter((x:any)=>{const key=String(x.draftNumber||x.invoiceNumber||x.quoteNumber||""); if(!key||seen.has(key)) return false; seen.add(key); return true;});
  return out({organization,rewards,member:{email:userEmail,firstName:member?.first_name||null,lastName:member?.last_name||null,role:isSuperAdmin?"super_admin":member.role},isSuperAdmin,integrations:integration||[],orders:formattedOrders,promotionalPreviousOrders,unpaidInvoices,currentQuotes,quotes:currentQuotes});
 }catch(e){return out({error:e instanceof Error?e.message:String(e)},500);}
});