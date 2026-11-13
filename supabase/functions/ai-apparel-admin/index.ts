import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://ai-apparel-group.pages.dev",
  "https://mntr-lab.github.io",
  "https://portal.aiapparelgroup.com"
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://ai-apparel-group.pages.dev";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json"
  };
}
const json = (req: Request, data: unknown, status=200) => new Response(JSON.stringify(data), {status, headers:cors(req)});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors(req)});
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(req,{error:"Authentication required"},401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminDb = createClient(url, service, {auth:{persistSession:false}});
  const token = auth.slice(7);
  const {data:userData,error:userError} = await adminDb.auth.getUser(token);
  const email = userData.user?.email?.toLowerCase();
  if (userError || !email) return json(req,{error:"Invalid session"},401);

  const {data:admin} = await adminDb.from("ai_apparel_admins").select("email,role,active").eq("email",email).eq("active",true).maybeSingle();
  if (!admin || admin.role !== "super_admin") return json(req,{error:"Super Admin access required"},403);

  if (req.method === "GET") {
    const {data:orgs,error} = await adminDb.from("ai_apparel_organizations").select("id,tag,name,short_name,logo_url,status").order("name");
    if (error) return json(req,{error:error.message},500);

    const {data:quoteRows,error:quoteError} = await adminDb
      .from("ai_apparel_quote_requests")
      .select("id,request_number,organization_id,status,contact_name,contact_email,contact_phone,project_name,needed_by,event_date,notes,source,submitted_at,updated_at,setup_charge,decoration_charge,freight_charge,additional_charge,discount_amount,customer_quote_notes,internal_notes,quoted_subtotal,quoted_total,priced_at,quote_ready_at,shopify_draft_order_id,company_store_invoice_url,invoiced_at,approved_at,approved_by_email,shopify_order_id,paid_at,completed_at,rewards_order_id,ai_apparel_quote_request_items(id,sage_product_id,product_code,product_name,quantity,quoted_quantity,unit_selling_price,line_total,color,decoration,customer_notes,image_url,created_at)")
      .order("submitted_at",{ascending:false});
    if (quoteError) return json(req,{error:quoteError.message},500);

    const orgMap = new Map((orgs || []).map((o:any)=>[o.id,o.name]));
    const promotionalQuotes = (quoteRows || []).map((q:any)=>({
      ...q,
      organization_name: orgMap.get(q.organization_id) || q.organization_id,
      items: (q.ai_apparel_quote_request_items || []).sort((a:any,b:any)=>String(a.created_at||"").localeCompare(String(b.created_at||""))).map(({created_at,...i}:any)=>i)
    })).map(({ai_apparel_quote_request_items,...q}:any)=>q);

    return json(req,{ok:true,admin:{email,role:admin.role},organizations:orgs || [],promotionalQuotes});
  }

  if (req.method !== "POST") return json(req,{error:"Method not allowed"},405);
  const body = await req.json();
  if (body.action === "cancel_quote" || body.action === "delete_test_quote") {
    const quoteId=String(body.quote_id||"");
    if(!quoteId) return json(req,{error:"Quote ID is required"},400);
    const {data:quote,error:qErr}=await adminDb.from("ai_apparel_quote_requests").select("*").eq("id",quoteId).maybeSingle();
    if(qErr||!quote) return json(req,{error:qErr?.message||"Quote not found"},404);
    if(body.action==="cancel_quote"){
      if(quote.status==="completed"||quote.rewards_order_id) return json(req,{error:"Completed/rewarded quotes cannot be cancelled here."},409);
      const {data:updated,error:uErr}=await adminDb.from("ai_apparel_quote_requests").update({status:"cancelled"}).eq("id",quoteId).select().single();
      if(uErr) return json(req,{error:uErr.message},400);
      await adminDb.from("ai_apparel_admin_audit_log").insert({admin_email:email,organization_id:quote.organization_id,action:"CANCEL_QUOTE",entity_type:"quote_request",entity_id:quoteId,before_data:quote,after_data:updated,note:"Cancelled from Super Admin"});
      return json(req,{ok:true,quote:updated});
    }
    if(quote.status==="completed"||quote.rewards_order_id||quote.shopify_order_id) return json(req,{error:"This quote is tied to a completed Company Store order/rewards and cannot be deleted."},409);
    if(quote.shopify_draft_order_id||quote.invoiced_at) return json(req,{error:"This quote already created a Company Store invoice. Cancel/archive it instead of deleting it."},409);
    const {error:dErr}=await adminDb.from("ai_apparel_quote_requests").delete().eq("id",quoteId);
    if(dErr) return json(req,{error:dErr.message},400);
    await adminDb.from("ai_apparel_admin_audit_log").insert({admin_email:email,organization_id:quote.organization_id,action:"DELETE_TEST_QUOTE",entity_type:"quote_request",entity_id:quoteId,before_data:quote,note:"Permanently deleted test quote from Super Admin"});
    return json(req,{ok:true,deleted:true,request_number:quote.request_number});
  }

  if (body.action === "sync_promotional_store") {
    const organizationId=String(body.organization_id||"");
    if(!organizationId) return json(req,{error:"Organization is required"},400);
    const {data:syncData,error:syncErr}=await adminDb.functions.invoke("ai-apparel-promotional-store-sync",{body:{organization_id:organizationId},headers:{Authorization:auth}});
    if(syncErr) return json(req,{error:syncErr.message||"Unable to sync connected Promotional store"},502);
    return json(req,{ok:true,sync:"ai-apparel-promotional-store-sync",result:syncData,synced_at:new Date().toISOString()});
  }

  if (body.action === "sync_company_store" || body.action === "sync_promotional_history") {
    const functionName=body.action==="sync_company_store"?"ai-apparel-shopify-sync":"ai-apparel-sage-sync";
    const invokeBody=body.action==="sync_promotional_history"?{import:true,endDate:new Date().toISOString().slice(0,10)}:{};
    const {data:syncData,error:syncErr}=await adminDb.functions.invoke(functionName,{body:invokeBody});
    if(syncErr) return json(req,{error:syncErr.message||("Unable to run "+functionName)},502);
    await adminDb.from("ai_apparel_admin_audit_log").insert({admin_email:email,organization_id:null,action:body.action==="sync_company_store"?"SYNC_COMPANY_STORE":"SYNC_PROMOTIONAL_HISTORY",entity_type:"data_sync",entity_id:functionName,after_data:syncData,note:"Manual sync from Super Admin"});
    return json(req,{ok:true,sync:functionName,result:syncData,synced_at:new Date().toISOString()});
  }

  if (body.action === "get_quote_catalog") {
    const organizationId=String(body.organization_id||"").trim();
    if(!organizationId) return json(req,{error:"Organization is required"},400);
    const {data:org,error:oErr}=await adminDb.from("ai_apparel_organizations").select("id,name,status").eq("id",organizationId).maybeSingle();
    if(oErr||!org) return json(req,{error:oErr?.message||"Organization not found"},404);

    const {data:shows,error:sErr}=await adminDb.from("ai_apparel_organization_showrooms").select("id").eq("organization_id",organizationId).eq("enabled",true);
    if(sErr) return json(req,{error:sErr.message},400);
    const showIds=(shows||[]).map((x:any)=>x.id);
    let promotional:any[]=[];
    if(showIds.length){
      const {data:p,error:pErr}=await adminDb.from("ai_apparel_organization_showroom_products")
        .select("id,sage_product_id,showroom_product_id,item_number,product_name,customer_price_text,image_url,product_url,sort_order")
        .in("showroom_id",showIds).eq("enabled",true).order("sort_order",{ascending:true});
      if(pErr) return json(req,{error:pErr.message},400);
      promotional=(p||[]).map((x:any)=>({...x,source:"promotional"}));
    }

    // Company Store catalog: return any organization-specific catalog data already stored in integration metadata.
    const {data:ints}=await adminDb.from("ai_apparel_organization_integrations")
      .select("provider,store_url,metadata").eq("organization_id",organizationId).eq("enabled",true);
    const companyStore:any[]=[];
    for(const it of (ints||[])){
      const meta:any=it.metadata||{};
      const candidates=[meta.products,meta.catalog_products,meta.company_store_products].find((v:any)=>Array.isArray(v))||[];
      for(const p of candidates){
        companyStore.push({
          id:p.id||p.product_id||p.variant_id||crypto.randomUUID(),source:"company_store",
          product_name:p.product_name||p.title||p.name||"Company Store Product",
          product_code:p.product_code||p.sku||p.item_number||"",
          image_url:p.image_url||p.image||"",price:p.price??p.customer_price??null,
          product_url:p.product_url||p.url||""
        });
      }
    }
    return json(req,{ok:true,organization:{id:org.id,name:org.name},promotional,companyStore});
  }

  if (body.action === "create_promotional_quote") {
    const clean=(v:unknown,max=1000)=>{if(v===null||v===undefined)return null;const s=String(v).trim();return s?s.slice(0,max):null};
    const organizationId=String(body.organization_id||"").trim();
    const items=Array.isArray(body.items)?body.items:[];
    if(!organizationId) return json(req,{error:"Organization is required"},400);
    if(!items.length) return json(req,{error:"Add at least one quote item"},400);
    if(items.length>50) return json(req,{error:"Too many quote items"},400);
    const {data:org,error:oErr}=await adminDb.from("ai_apparel_organizations").select("id,name,status").eq("id",organizationId).eq("status","active").maybeSingle();
    if(oErr||!org) return json(req,{error:oErr?.message||"Organization not found or inactive"},404);
    const now=new Date().toISOString();
    const {data:quote,error:qErr}=await adminDb.from("ai_apparel_quote_requests").insert({
      organization_id:organizationId,
      contact_name:clean(body.contact_name,200),contact_email:clean(body.contact_email,320),contact_phone:clean(body.contact_phone,100),
      project_name:clean(body.project_name,300),needed_by:clean(body.needed_by,20),event_date:clean(body.event_date,20),
      notes:clean(body.notes,4000),source:"SUPER_ADMIN",
      metadata:{created_by_admin:email,created_from:"super_admin"},
      internal_notes:clean(body.internal_notes,4000)
    }).select("id,request_number,status,organization_id,submitted_at").single();
    if(qErr) return json(req,{error:qErr.message},400);
    const rows=items.map((item:any)=>({
      quote_request_id:quote.id,
      sage_product_id:Number.isFinite(Number(item.sage_product_id))&&String(item.sage_product_id||"").trim()!==""?Number(item.sage_product_id):null,
      product_code:clean(item.product_code,200),product_name:clean(item.product_name,500)||"Promotional Product",
      quantity:Number.isFinite(Number(item.quantity))&&Number(item.quantity)>0?Number(item.quantity):null,
      color:clean(item.color,300),decoration:clean(item.decoration,500),customer_notes:clean(item.customer_notes,2000),
      image_url:clean(item.image_url,2000),metadata:{created_by_admin:true}
    }));
    const {data:createdItems,error:iErr}=await adminDb.from("ai_apparel_quote_request_items").insert(rows).select("id,product_name,product_code,quantity,color,decoration");
    if(iErr){await adminDb.from("ai_apparel_quote_requests").delete().eq("id",quote.id);return json(req,{error:iErr.message},400)}
    await adminDb.from("ai_apparel_admin_audit_log").insert({
      admin_email:email,organization_id:organizationId,action:"CREATE_PROMOTIONAL_QUOTE",entity_type:"quote_request",entity_id:quote.id,
      after_data:{...quote,items:createdItems||[]},note:clean(body.internal_notes,1000)||"Created from Super Admin"
    });
    return json(req,{ok:true,quote:{...quote,organization_name:org.name,items:createdItems||[]},message:"Promotional quote created"},201);
  }

  if (body.action === "save_quote_pricing" || body.action === "mark_quote_ready") {
    const quoteId = String(body.quote_id || "");
    if (!quoteId) return json(req,{error:"Quote ID is required"},400);
    const {data:quote,error:qErr}=await adminDb.from("ai_apparel_quote_requests").select("id,request_number,status").eq("id",quoteId).maybeSingle();
    if(qErr||!quote) return json(req,{error:qErr?.message||"Quote not found"},404);

    const items = Array.isArray(body.items) ? body.items : [];
    let subtotal = 0;
    for (const item of items) {
      const qty = Number(item.quoted_quantity ?? item.quantity ?? 0);
      const price = Number(item.unit_selling_price ?? 0);
      if (qty < 0 || price < 0) return json(req,{error:"Quantity and selling price cannot be negative"},400);
      const lineTotal = Math.round(qty * price * 100) / 100;
      subtotal += lineTotal;
      const {error:iErr}=await adminDb.from("ai_apparel_quote_request_items").update({
        quoted_quantity: qty, unit_selling_price: price, line_total: lineTotal
      }).eq("id",String(item.id)).eq("quote_request_id",quoteId);
      if(iErr) return json(req,{error:iErr.message},400);
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const setup = Math.max(0,Number(body.setup_charge||0));
    const decoration = Math.max(0,Number(body.decoration_charge||0));
    const freight = Math.max(0,Number(body.freight_charge||0));
    const additional = Math.max(0,Number(body.additional_charge||0));
    const discount = Math.max(0,Number(body.discount_amount||0));
    const total = Math.max(0,Math.round((subtotal+setup+decoration+freight+additional-discount)*100)/100);
    const ready = body.action === "mark_quote_ready";
    const update:any = {
      setup_charge:setup,decoration_charge:decoration,freight_charge:freight,additional_charge:additional,
      discount_amount:discount,customer_quote_notes:body.customer_quote_notes||null,internal_notes:body.internal_notes||null,
      quoted_subtotal:subtotal,quoted_total:total,priced_at:new Date().toISOString(),
      status: ready ? "quote_ready" : "pricing"
    };
    if(ready) update.quote_ready_at=new Date().toISOString();
    const {data:updated,error:uErr}=await adminDb.from("ai_apparel_quote_requests").update(update).eq("id",quoteId).select().single();
    if(uErr) return json(req,{error:uErr.message},400);
    await adminDb.from("ai_apparel_admin_audit_log").insert({
      admin_email:email,organization_id:updated.organization_id,action:ready?"MARK_QUOTE_READY":"SAVE_QUOTE_PRICING",
      entity_type:"quote_request",entity_id:quoteId,after_data:updated,note:body.internal_notes||null
    });
    return json(req,{ok:true,quote:updated,subtotal,total,status:update.status});
  }


  if (body.action === "create_company_store_invoice") {
    const quoteId = String(body.quote_id || "");
    if (!quoteId) return json(req,{error:"Quote ID is required"},400);

    const {data:quote,error:qErr}=await adminDb
      .from("ai_apparel_quote_requests")
      .select("*,ai_apparel_quote_request_items(*)")
      .eq("id",quoteId).maybeSingle();
    if(qErr||!quote) return json(req,{error:qErr?.message||"Quote not found"},404);
    if(quote.status !== "approved") return json(req,{error:"Only an approved quote can be invoiced"},409);
    if(quote.shopify_draft_order_id) return json(req,{error:"A Company Store invoice already exists for this quote",invoice_url:quote.company_store_invoice_url},409);
    if(!quote.contact_email) return json(req,{error:"Customer email is required before invoicing"},400);

    const {data:org,error:oErr}=await adminDb.from("ai_apparel_organizations").select("id,tag,name").eq("id",quote.organization_id).maybeSingle();
    if(oErr||!org) return json(req,{error:oErr?.message||"Organization not found"},404);

    const shop=Deno.env.get("AI_APPAREL_SHOPIFY_SHOP_DOMAIN")||"aiapparelgroup.myshopify.com";
    if(shop.toLowerCase()!=="aiapparelgroup.myshopify.com") return json(req,{error:"Incorrect AI Apparel store configured"},409);
    const clientId=Deno.env.get("AI_APPAREL_SHOPIFY_CLIENT_ID")||Deno.env.get("SHOPIFY_CLIENT_ID");
    const clientSecret=Deno.env.get("AI_APPAREL_SHOPIFY_CLIENT_SECRET")||Deno.env.get("SHOPIFY_CLIENT_SECRET");
    if(!shop||!clientId||!clientSecret) return json(req,{error:"Company Store credentials are not configured"},500);

    const tokenRes=await fetch(`https://${shop}/admin/oauth/access_token`,{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret})
    });
    const tokenPayload=await tokenRes.json().catch(()=>({}));
    if(!tokenRes.ok||!tokenPayload.access_token) return json(req,{error:"Unable to authenticate with Company Store"},502);
    const accessToken=tokenPayload.access_token;

    const scopeRes=await fetch(`https://${shop}/admin/oauth/access_scopes.json`,{headers:{"X-Shopify-Access-Token":accessToken}});
    const scopePayload=await scopeRes.json().catch(()=>({}));
    const scopes=(scopePayload.access_scopes||[]).map((s:any)=>s.handle);
    if(!scopes.includes("write_draft_orders") && !scopes.includes("write_quick_sale")) {
      return json(req,{error:"Company Store app needs write_draft_orders permission before invoices can be created",required_scope:"write_draft_orders",current_scopes:scopes},409);
    }

    const lineItems=(quote.ai_apparel_quote_request_items||[]).map((item:any)=>({
      title:String(item.product_name||"Promotional Product"),
      quantity:Math.max(1,Math.round(Number(item.quoted_quantity ?? item.quantity ?? 1))),
      originalUnitPrice:Number(item.unit_selling_price||0).toFixed(2),
      customAttributes:[
        ...(item.product_code?[{key:"Product Code",value:String(item.product_code)}]:[]),
        ...(item.color?[{key:"Color",value:String(item.color)}]:[]),
        ...(item.decoration?[{key:"Decoration",value:String(item.decoration)}]:[])
      ]
    }));

    const addCharge=(title:string,amount:any)=>{
      const n=Number(amount||0);
      if(n>0) lineItems.push({title,quantity:1,originalUnitPrice:n.toFixed(2),customAttributes:[]});
    };
    addCharge("Setup Charge",quote.setup_charge);
    addCharge("Decoration Charge",quote.decoration_charge);
    addCharge("Additional Charge",quote.additional_charge);
    if(!lineItems.length) return json(req,{error:"Quote has no invoiceable line items"},400);

    const input:any={
      email:String(quote.contact_email).trim(),
      note:`AI Apparel Promotional Quote ${quote.request_number} • ${org.name}`,
      tags:["AI_APPAREL_PROMOTIONAL",String(org.tag),String(quote.request_number)],
      lineItems,
      customAttributes:[
        {key:"AI Apparel Quote",value:String(quote.request_number)},
        {key:"Organization",value:String(org.name)},
        {key:"Organization ID",value:String(org.id)}
      ]
    };
    if(Number(quote.freight_charge||0)>0) input.shippingLine={title:"Freight",price:Number(quote.freight_charge).toFixed(2)};
    if(Number(quote.discount_amount||0)>0) input.appliedDiscount={
      title:"AI Apparel Quote Discount",
      description:`Discount from ${quote.request_number}`,
      valueType:"FIXED_AMOUNT",
      value:Number(quote.discount_amount)
    };

    const mutation=`mutation CreateInvoice($input:DraftOrderInput!){
      draftOrderCreate(input:$input){
        draftOrder{id name invoiceUrl totalPriceSet{shopMoney{amount currencyCode}}}
        userErrors{field message}
      }
    }`;
    const apiRes=await fetch(`https://${shop}/admin/api/2026-10/graphql.json`,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Shopify-Access-Token":accessToken},
      body:JSON.stringify({query:mutation,variables:{input}})
    });
    const apiPayload=await apiRes.json();
    const create=apiPayload?.data?.draftOrderCreate;
    if(!apiRes.ok||apiPayload.errors?.length||create?.userErrors?.length||!create?.draftOrder){
      return json(req,{error:"Company Store invoice could not be created",details:create?.userErrors||apiPayload.errors||apiPayload},502);
    }

    const draft=create.draftOrder;
    const now=new Date().toISOString();
    const existingMeta=(quote.metadata && typeof quote.metadata==="object")?quote.metadata:{};
    const {data:updated,error:uErr}=await adminDb.from("ai_apparel_quote_requests").update({
      status:"invoiced",
      shopify_draft_order_id:draft.id,
      company_store_invoice_url:draft.invoiceUrl,
      invoiced_at:now,
      metadata:{...existingMeta,company_store_draft_order_name:draft.name,company_store_invoice_created_at:now}
    }).eq("id",quoteId).select().single();
    if(uErr) return json(req,{error:"Invoice was created but quote could not be updated. Contact support before retrying.",draft_order_id:draft.id,invoice_url:draft.invoiceUrl,details:uErr.message},500);

    await adminDb.from("ai_apparel_admin_audit_log").insert({
      admin_email:email,organization_id:quote.organization_id,action:"CREATE_COMPANY_STORE_INVOICE",
      entity_type:"quote_request",entity_id:quoteId,after_data:updated,note:`Company Store draft ${draft.name}`
    });

    return json(req,{ok:true,quote:updated,draftOrder:{id:draft.id,name:draft.name,invoiceUrl:draft.invoiceUrl,total:draft.totalPriceSet?.shopMoney||null}});
  }

  if (body.action !== "add_transaction") return json(req,{error:"Unsupported action"},400);

  const organizationId = String(body.organization_id || "");
  const orderType = String(body.order_type || "").toUpperCase();
  const allowed = ["ONLINE","QUOTE","PROMO","REFUND","ADJUSTMENT"];
  if (!organizationId || !allowed.includes(orderType)) return json(req,{error:"Organization and valid transaction type are required"},400);

  const deferred = body.rewards_entry_method === "deferred_coupon";
  if (body.rewards_entry_method != null && !["standard","deferred_coupon"].includes(String(body.rewards_entry_method)))
    return json(req,{error:"Invalid rewards entry method"},400);

  const subtotal = Number(body.subtotal || 0);
  const discountAmount = Number(body.discount_amount || 0);
  if (![subtotal,discountAmount].every(Number.isFinite) || subtotal < 0 || discountAmount < 0)
    return json(req,{error:"Amounts must be valid nonnegative numbers"},400);

  const orderNumber = String(body.order_number || (deferred ? "" : "ADMIN-" + Date.now())).trim();
  if (!orderNumber || orderNumber.length > 180)
    return json(req,{error:"A valid original order/reference number is required"},400);
  const date = body.ordered_at ? new Date(body.ordered_at) : new Date();
  if (Number.isNaN(date.getTime())) return json(req,{error:"Invalid order date"},400);
  const orderedAt = date.toISOString();
  const coupon = String(body.discount_code || "").trim();
  const multiplier = deferred ? 1 : (body.rewards_multiplier === "" || body.rewards_multiplier == null
    ? (orderType === "ONLINE" ? 2 : (orderType === "QUOTE" || orderType === "PROMO" ? 1 : 0))
    : Number(body.rewards_multiplier));
  const points = deferred ? Math.round(subtotal * 100) / 100 : (body.rewards_points === "" || body.rewards_points == null
    ? Math.round(subtotal * multiplier * 100) / 100
    : Number(body.rewards_points));
  if (![multiplier,points].every(Number.isFinite) || multiplier < 0 || points < 0)
    return json(req,{error:"Invalid rewards calculation"},400);
  if (deferred && subtotal <= 0)
    return json(req,{error:"Original qualifying merchandise subtotal must exceed zero"},400);

  // A deferred coupon entry awards points but is not a second sale or invoice.
  // The original merchandise subtotal is retained in raw_data for auditing.
  const creditNumber = deferred ? "DEFERRED-REWARDS-" + orderNumber : orderNumber;
  if (deferred) {
    const {data:prior,error:priorError}=await adminDb.from("ai_apparel_orders")
      .select("id").eq("organization_id",organizationId)
      .eq("order_number",creditNumber).limit(1);
    if (priorError) return json(req,{error:priorError.message},400);
    if (prior?.length) return json(req,{error:"Deferred coupon rewards already credited for this order."},409);

    const {data:originals,error:originalError}=await adminDb.from("ai_apparel_orders")
      .select("id,rewards_points").eq("organization_id",organizationId)
      .eq("order_number",orderNumber).limit(10);
    if (originalError) return json(req,{error:originalError.message},400);
    if ((originals||[]).some((o:any)=>Number(o.rewards_points||0)>0))
      return json(req,{error:"The original order already has rewards points. Review it before adding another credit."},409);
  }

  const {data:order,error:orderError} = await adminDb.from("ai_apparel_orders").insert({
    organization_id: organizationId, external_order_id: null, order_number: creditNumber,
    order_type: deferred ? "ADJUSTMENT" : orderType, source: "admin",
    customer_name: body.customer_name || null, customer_email: body.customer_email || null,
    subtotal: deferred ? 0 : subtotal, rewards_multiplier: multiplier,
    rewards_points: points, payment_status: deferred ? "REWARDS_ONLY" : (body.payment_status || null),
    fulfillment_status: body.fulfillment_status || null, ordered_at: orderedAt,
    discount_codes: coupon ? [coupon] : [], discount_amount: deferred ? 0 : discountAmount,
    raw_data: {manual:true, admin_email:email, note:body.note || null,
      ...(deferred ? {rewards_only:true,rewards_entry_method:"deferred_coupon",
        original_order_number:orderNumber,original_qualifying_subtotal:subtotal,
        original_discount_amount:discountAmount,original_discount_code:coupon,
        financial_revenue:0,sales_tax:0} : {})}
  }).select().single();
  if (orderError) return json(req,{error:orderError.message},400);

  const txType = deferred ? "ADJUSTMENT" : (orderType === "REFUND" ? "REFUND" : orderType === "ADJUSTMENT" ? "ADJUSTMENT" : "EARN");
  const {error:ledgerError} = await adminDb.from("ai_apparel_rewards_ledger").insert({
    organization_id: organizationId, order_id: order.id, transaction_type: txType, points,
    description: deferred ? ("Deferred coupon rewards only for original order " + orderNumber + (body.note ? " — " + body.note : "")) : (body.note || ("Manual " + orderType + " transaction " + orderNumber)),
    source: "admin", external_reference: "admin-order-" + order.id, occurred_at: orderedAt
  });
  if (ledgerError) {
    await adminDb.from("ai_apparel_orders").delete().eq("id",order.id);
    return json(req,{error:ledgerError.message},400);
  }

  await adminDb.from("ai_apparel_admin_audit_log").insert({
    admin_email:email, organization_id:organizationId, action:deferred?"ADD_DEFERRED_COUPON_REWARDS":"ADD_TRANSACTION",
    entity_type:"order", entity_id:String(order.id), after_data:order, note:body.note || null
  });
  return json(req,{ok:true,order,points});
});