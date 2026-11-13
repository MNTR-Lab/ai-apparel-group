import {createClient} from "jsr:@supabase/supabase-js@2.57.4";
import {classifyOrder,round} from "./rewards-rules.mjs";
const query="query RewardsSync($after:String,$draftIds:[ID!]!){orders(first:50,after:$after,sortKey:CREATED_AT,reverse:true,query:\"created_at:>=2026-08-15\"){pageInfo{hasNextPage endCursor} nodes{id name createdAt updatedAt cancelledAt test tags sourceName taxesIncluded currentSubtotalPriceSet{shopMoney{amount currencyCode}} displayFinancialStatus displayFulfillmentStatus customer{firstName lastName email tags} discountCodes lineItems(first:100){pageInfo{hasNextPage endCursor} nodes{id title quantity currentQuantity originalUnitPriceSet{shopMoney{amount currencyCode}} discountedUnitPriceAfterAllDiscountsSet{shopMoney{amount currencyCode}} taxLines{priceSet{shopMoney{amount}}}}}}} nodes(ids:$draftIds){... on DraftOrder{id name status order{id name displayFinancialStatus}}}}";
const json=(v:any,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store","Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(!["POST","GET"].includes(req.method))return json({error:"GET or POST required"},405);
 const base=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const db=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const cron=Deno.env.get("AI_APPAREL_FINANCIAL_CRON_TOKEN"),auth=req.headers.get("authorization")||"";
 let authorized=Boolean(cron&&req.headers.get("x-ai-financial-cron-token")===cron)||auth==="Bearer "+key;
 if(!authorized&&auth.startsWith("Bearer ")){
 const {data:u}=await db.auth.getUser(auth.slice(7));
 if(u.user?.email){const {data:a}=await db.from("ai_apparel_admins").select("role").eq("email",u.user.email.toLowerCase()).eq("active",true).maybeSingle();authorized=a?.role==="super_admin";}
 }
 if(!authorized)return json({error:"Administrator or scheduler authentication required"},401);
 const params=new URL(req.url).searchParams,body=req.method==="POST"?await req.json().catch(()=>({})):{};const dryRun=params.get("dry_run")==="1"||body.dry_run===true;
 try{
 const shop=Deno.env.get("AI_APPAREL_SHOPIFY_SHOP_DOMAIN")||"aiapparelgroup.myshopify.com";
 if(shop.toLowerCase()!=="aiapparelgroup.myshopify.com")throw Error("Incorrect Shopify store configured");
 const clientId=Deno.env.get("AI_APPAREL_SHOPIFY_CLIENT_ID")||Deno.env.get("SHOPIFY_CLIENT_ID");
 const clientSecret=Deno.env.get("AI_APPAREL_SHOPIFY_CLIENT_SECRET")||Deno.env.get("SHOPIFY_CLIENT_SECRET");
 if(!clientId||!clientSecret)throw Error("AI Apparel store credentials missing");
 const tokenResponse=await fetch("https://"+shop+"/admin/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret})});
 const token=await tokenResponse.json();if(!tokenResponse.ok||!token.access_token)throw Error("AI Apparel Shopify authentication failed");
 const {data:context,error}=await db.rpc("ai_apparel_rewards_sync_context");if(error)throw error;
 const orgFilter=params.get("organization_id")||body.organization_id;
 const draftIds=[...new Set(context.quotes.map((q:any)=>q.draft_id).filter(Boolean))];
 let after:string|null=null,pages=0,scanned=0,imported=0,skipped=0;
 const matches:any[]=[],review:any[]=[],errors:any[]=[],missingDrafts:any[]=[];
 do{
 const r=await fetch("https://"+shop+"/admin/api/2026-10/graphql.json",{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":token.access_token},body:JSON.stringify({query,variables:{after,draftIds:pages===0?draftIds:[]}}),signal:AbortSignal.timeout(35000)});
 const result=await r.json();if(!r.ok||result.errors?.length)throw Error("Shopify order query failed: "+JSON.stringify(result.errors||{status:r.status}));
 const data=result.data;
 if(pages===0)for(let i=0;i<draftIds.length;i++){const draft=data.nodes?.[i];if(!draft){missingDrafts.push({draft_id:draftIds[i],reason:"not_found_in_ai_apparel_store"});continue;}for(const q of context.quotes)if(q.draft_id===draft.id&&draft.order)q.order_id=draft.order.id;}
 for(const order of data.orders.nodes){
 scanned++;
 const classified=classifyOrder(order,context);review.push(...classified.review);
 for(const row of classified.rows){
 if(orgFilter&&row.organization_id!==orgFilter)continue;
 let status:any={ok:true};
 if(!dryRun){const {data:saved,error:e}=await db.rpc("ai_apparel_rewards_sync_order",{p_order:row});if(e){errors.push({order:row.order_number,error:e.message});continue;}status=saved;if(status.skipped)skipped++;else imported++;}
 matches.push({order:row.order_number,organization_id:row.organization_id,type:row.order_type,subtotal:row.subtotal,points:row.rewards_points,payment_status:row.payment_status,review:row.raw_data.review_required,skipped:status.skipped||null});
 }
 }
 after=data.orders.pageInfo.hasNextPage?data.orders.pageInfo.endCursor:null;pages++;
 }while(after&&pages<20);
 if(after)errors.push({error:"Order scan incomplete; pagination limit reached"});
 const organizations=[...new Set(matches.map(x=>x.organization_id))].map(id=>({organization_id:id,orders:matches.filter(x=>x.organization_id===id).length,points:round(matches.filter(x=>x.organization_id===id&&!x.skipped).reduce((n,x)=>n+x.points,0))}));
 return json({ok:errors.length===0,dryRun,shop,scanned,imported,skipped,pages,organizations,matches,review,missingDrafts,errors},errors.length?502:200);
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}
});
