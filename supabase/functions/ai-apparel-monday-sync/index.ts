import {createClient} from "jsr:@supabase/supabase-js@2.57.4";
type Row={kind:string,id:string,name:string,group:string,values:Record<string,unknown>,details:string};
const CONFIG:Record<string,{board:string,key:string}>={
 customers:{board:"18435175593",key:"CRM Customer ID"},
 quotes:{board:"18435175618",key:"CRM Quote ID"},
 jobs:{board:"18435175633",key:"CRM Job ID"},
 invoices:{board:"18435175721",key:"CRM Quote ID"},
 tasks:{board:"18435175746",key:"CRM Task/Event ID"},
 accounting:{board:"18435176264",key:"CRM Job ID"}
};
const CRM="https://ai-apparel-group.pages.dev/crm/";
const day=(v:any)=>v?String(v).slice(0,10):null;
const text=(v:any)=>v==null?"":String(v);
const norm=(v:any)=>text(v).toLowerCase().replace(/[_-]/g," ").trim();
const title=(v:any)=>text(v).toLowerCase().replace(/\b\w/g,(c:string)=>c.toUpperCase());
function readable(value:any,depth=0):string{
 if(value==null)return "";
 if(Array.isArray(value))return value.map((v,i)=>"Item "+(i+1)+"\n"+readable(v,depth+1)).join("\n\n");
 if(typeof value!=="object")return String(value);
 const hidden=new Set(["id","client_id","business_id","online_customer_id","quote_id","job_id","staff_id","auth_user_id","source_quote_request_id","product_id","variant_id"]);
 return Object.entries(value).filter(([k,v])=>v!=null&&v!==""&&!hidden.has(k)).map(([k,v])=>{
 const label=k.replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase());
 return typeof v==="object"?label+"\n"+readable(v,depth+1):label+": "+v;
 }).join("\n");
}
function exportRows(s:any):Row[]{
 const rows:Row[]=[];
 const by=(a:any[],id:string)=>a.find(x=>x.id===id);
 const workflow=(id:string)=>s.workflows.find((x:any)=>x.quote_id===id)||{};
 const jobFor=(id:string)=>s.jobs.find((x:any)=>x.quote_id===id)||{};
 const lines=(id:string)=>s.lines.filter((x:any)=>x.quote_id===id);
 const costs=(id:string)=>(s.costs||[]).filter((x:any)=>x.quote_id===id);
 const customer=(x:any)=>by(s.businesses,x.business_id)?.name||by(s.clients,x.client_id)?.name||[by(s.customers,x.online_customer_id)?.first_name,by(s.customers,x.online_customer_id)?.last_name].filter(Boolean).join(" ")||by(s.customers,x.online_customer_id)?.email||"Unassigned customer";
 const customerId=(x:any)=>x.business_id?"business:"+x.business_id:x.client_id?"client:"+x.client_id:x.online_customer_id?"online:"+x.online_customer_id:"";
 const add=(kind:string,id:string,name:string,group:string,values:any,details:any)=>rows.push({kind,id,name,group,values,details:typeof details==="string"?details:readable(details)});
 for(const b of s.businesses){
 const contacts=s.contacts.filter((x:any)=>x.business_id===b.id);
 add("customers","business:"+b.id,b.name,norm(b.status)==="inactive"?"Inactive":"Active",{
 "CRM Customer ID":"business:"+b.id,"Customer Name":b.name,"Company":b.name,"Customer Type":"Customer",
 "Email":contacts.find((x:any)=>x.email)?.email||"","Phone":contacts.find((x:any)=>x.phone)?.phone||"",
 "Active/Inactive Status":norm(b.status)==="inactive"?"Inactive":"Active","Created Date":b.created_at,"Last Updated":b.created_at,"CRM Link":CRM
 },{record_type:"Business account",business:b,contacts});
 }
 for(const c of s.clients)add("customers","client:"+c.id,c.name,norm(c.status)==="inactive"?"Inactive":"Active",{
 "CRM Customer ID":"client:"+c.id,"Customer Name":c.contact_name||c.name,"Company":c.name,"Customer Type":"Customer","Email":c.email||"","Phone":c.phone||"","Active/Inactive Status":norm(c.status)==="inactive"?"Inactive":"Active","Created Date":c.created_at,"Last Updated":c.updated_at,"CRM Link":CRM
 },{record_type:"CRM client",...c});
 for(const c of s.customers){
 const businesses=s.links.filter((l:any)=>l.customer_id===c.id).map((l:any)=>by(s.businesses,l.business_id)?.name).filter(Boolean);
 const name=[c.first_name,c.last_name].filter(Boolean).join(" ")||c.email||"Customer "+c.external_customer_id;
 add("customers","online:"+c.id,name,"Active",{"CRM Customer ID":"online:"+c.id,"Customer Name":name,"Company":businesses.join(", "),"Customer Type":"Customer","Email":c.email||"","Phone":c.phone||"","Active/Inactive Status":"Active","Created Date":c.created_at,"Last Updated":c.updated_at,"CRM Link":CRM},{record_type:"Online customer",...c,businesses});
 }
 for(const q of s.quotes){
 const w=workflow(q.id),j=jobFor(q.id);
 const status=({"changes requested":"Changes Requested",approved:"Approved",sent:"Sent",expired:"Expired",archived:"Archived",draft:"Draft",declined:"Changes Requested",rejected:"Changes Requested"} as any)[norm(q.status)]||"Draft";
 add("quotes",q.id,q.quote_number+" | "+q.title,status,{
 "CRM Quote ID":q.id,"Quote Number":q.quote_number,"Quote Title":q.title,"Quote Status":status,"CRM Customer ID":customerId(q),"Customer Name":customer(q),"Amount (USD)":q.total,"Approval Status":status==="Approved"?"Approved":status==="Changes Requested"?"Rejected":"Pending","Approval Date":w.customer_approved_at,"Expiration Date":w.expires_at,"Last Updated":q.updated_at,"Production Job Number":j.job_number||"","Revision/Replacement Quote ID":w.replacement_quote_id||"","Artwork Proof Reference/URL":s.proofs.filter((p:any)=>p.quote_id===q.id).map((p:any)=>p.filename).join(", ")
 },{quote:q,customer:customer(q),line_items:lines(q.id),approval:{sent_at:w.sent_at,customer_approved_at:w.customer_approved_at,expires_at:w.expires_at,follow_up_needed:w.follow_up_needed},proofs:s.proofs.filter((p:any)=>p.quote_id===q.id),crm_url:CRM});
 }
 for(const j of s.jobs){
 const q=by(s.quotes,j.quote_id)||{},w=workflow(j.quote_id);
 const status=({"new":"Not Started","not started":"Not Started","in production":"In Progress","in progress":"In Progress",completed:"Completed",fulfilled:"Completed",approved:"Approved","waiting approval":"Waiting Approval","on hold":"On Hold",cancelled:"Cancelled",canceled:"Cancelled"} as any)[norm(j.status)]||"In Progress";
 const group=status==="Completed"?"Completed":status==="Cancelled"?"Archived":status==="Not Started"?"New":["Waiting Approval","On Hold"].includes(status)?"Waiting":"In Production";
 const production=s.production.filter((p:any)=>p.job_id===j.id).map((p:any)=>({...p,stage:by(s.stages,p.stage_id)?.name,employee:by(s.staff,p.employee_id)?.display_name}));
 add("jobs",j.id,j.job_number+" | "+j.title,group,{
 "CRM Job ID":j.id,"Job Number":j.job_number,"Job Name":j.title,"Customer":customer(j),"CRM Customer ID":customerId(j),"CRM Quote ID":j.quote_id||"","Quote Number":q.quote_number||"","Job Status":status,"Artwork Status":norm(q.status)==="approved"?"Approved":"Not Started","Production Due Date":j.due_date,"Completion Date":j.fulfilled_at,"Approval Date":w.customer_approved_at,"Last Updated":j.updated_at
 },{job:j,customer:customer(j),production,line_items:lines(j.quote_id),crm_url:CRM});
 add("accounting",j.id,j.job_number+" | "+j.title,status==="Completed"?"Completed Jobs":status==="Cancelled"?"Archived":"Active Jobs",{
 "CRM Job ID":j.id,"CRM Quote ID":j.quote_id||"","Job Number":j.job_number,"Quote Number":q.quote_number||"","Customer Name":customer(j),"Customer Subtotal USD":q.subtotal,"Discount USD":q.discount_amount,"Shipping & Handling Charged USD":q.shipping_amount,"Total Due USD":w.shopify_invoice_total??q.total,"Quantity":lines(j.quote_id).reduce((n:number,l:any)=>n+Number(l.quantity||0),0),"Shopify Draft Order Number":w.shopify_draft_name||w.shopify_draft_order_id||"","Shopify Order Number":j.shopify_order_id||"","Shopify Invoice Link":w.shopify_invoice_url||"","Invoice Date":w.invoice_sent_at,"Payment Date":w.paid_at,"Payment Status":norm(w.payment_status)==="paid"?"Paid":norm(w.payment_status)==="partial"?"Partial Payment":w.shopify_draft_order_id?"Invoiced":"Not Invoiced","Tracking Number":j.tracking_number||"","Fulfillment Status":j.status
 },{job:j,quote_number:q.quote_number,line_items:lines(j.quote_id),payment_status:w.payment_status||"UNPAID",internal_cost_estimates:costs(j.quote_id),note:"Quote/invoice amounts only. Cash receipts, taxes collected, costs and profit are not inferred. Verify payment and costs before financial reporting."});
 }
 for(const w of s.workflows.filter((x:any)=>x.shopify_draft_order_id||x.shopify_invoice_url)){
 const q=by(s.quotes,w.quote_id)||{},j=jobFor(w.quote_id);
 const paid=({"paid":"Paid","unpaid":"Unpaid","partial":"Partial","partially paid":"Partial",overdue:"Overdue",refunded:"Refunded"} as any)[norm(w.payment_status)]||"Review";
 const invoice=paid==="Paid"?"Paid":({"sent":"Sent","draft created":"Draft",failed:"Failed",archived:"Archived"} as any)[norm(w.invoice_status)]||"Review";
 add("invoices",w.quote_id,(w.shopify_draft_name||q.quote_number)+" | "+(q.title||"Invoice"),invoice==="Paid"?"Paid":invoice==="Sent"?"Sent":["Failed","Review"].includes(invoice)?"Failed/Review":invoice==="Archived"?"Archived":"Draft Created",{
 "CRM Quote ID":w.quote_id,"Quote Number":q.quote_number||"","Invoice Number":w.shopify_draft_name||"","Customer":customer(q),"Job Number":j.job_number||"","Invoice Total (USD)":w.shopify_invoice_total??q.total,"Shopify Draft Order ID":w.shopify_draft_order_id||"","Shopify Order ID":j.shopify_order_id||"","Shopify Invoice URL":w.shopify_invoice_url||"","Invoice Status":invoice,"Payment Status":paid,"Invoice Sent Date":w.invoice_sent_at,"Paid Date":w.paid_at,"Last Updated":w.updated_at
 },{quote_number:q.quote_number,customer:customer(q),workflow:{invoice_status:w.invoice_status,payment_status:w.payment_status,shopify_draft_order_id:w.shopify_draft_order_id,shopify_invoice_url:w.shopify_invoice_url,last_error:w.last_error},line_items:lines(w.quote_id)});
 }
 for(const t of s.tasks){
 const j=by(s.jobs,t.job_id)||{},employee=by(s.staff,t.assigned_staff_id);
 const status=({"new":"Not Started","open":"Not Started","not started":"Not Started","in progress":"In Progress","awaiting review":"Awaiting Review",completed:"Completed",done:"Completed",blocked:"Blocked"} as any)[norm(t.status)]||"Not Started";
 add("tasks",t.id,t.title,status==="Completed"?"Completed":status==="Awaiting Review"?"Awaiting Review":"Open Tasks",{
 "CRM Task/Event ID":t.id,"Title":t.title,"Task Status":status,"Event Type":"Task","Related Job ID":t.job_id||"","Related Quote ID":j.quote_id||"","Related Customer ID":customerId(j),"Due Date":t.due_date,"Activity Timestamp":t.created_at
 },{task:t,assigned_employee:employee||null,crm_url:CRM});
 }
 // Prioritize operational records before the initial online-customer backfill.
 return rows.sort((a,b)=>(a.id.startsWith("online:")?1:0)-(b.id.startsWith("online:")?1:0)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
}
async function fingerprint(r:Row){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(r))))).map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async req=>{
 const out=(v:any,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
 if(req.method!=="POST")return out({error:"POST required"},405);
 const token=Deno.env.get("AI_APPAREL_FINANCIAL_CRON_TOKEN");
 if(!token||req.headers.get("x-ai-financial-cron-token")!==token)return out({error:"Unauthorized"},401);
 const base=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,mondayToken=Deno.env.get("MONDAY_API_TOKEN");
 if(!mondayToken)return out({error:"Monday API token is not configured"},503);
 const db=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(action:string,payload:any={})=>{const {data,error}=await db.rpc("ai_apparel_monday_sync_internal",{p_action:action,p_payload:payload});if(error)throw Error(error.message);return data;};
 const monday=async(query:string,variables:any={},partial=false)=>{
 const response=await fetch("https://api.monday.com/v2",{method:"POST",headers:{"Authorization":mondayToken,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(35000)});
 const j=await response.json();if(!response.ok||(!partial&&j.errors?.length))throw Error(JSON.stringify(j.errors||{status:response.status}).slice(0,1500));return j;};
 const owner=crypto.randomUUID(),started=Date.now();
 let acquired=false;
 try{
 acquired=(await rpc("lock",{owner})).acquired;
 if(!acquired)return out({ok:true,busy:true});
 const s=await rpc("snapshot"),rows=exportRows(s),state=new Map(s.state.map((x:any)=>[x.kind+":"+x.source_id,x]));
 const pending:any[]=[];
 for(const row of rows){const hash=await fingerprint(row),old:any=state.get(row.kind+":"+row.id);if(old?.fingerprint!==hash||old?.last_error)pending.push({row,hash,old});}
 const proofResults:any[]=[];
 for(const proof of s.files||[]){
 const sourceId=proof.id,hash=proof.storage_path,old:any=state.get("proofs:"+sourceId);
 if(old?.fingerprint===hash&&!old?.last_error)continue;
 const quote:any=state.get("quotes:"+proof.quote_id);if(!quote?.item_id)continue;
 try{
 const b=(await monday("query($ids:[ID!]!){boards(ids:$ids){columns{id title}}}",{ids:[CONFIG.quotes.board]})).data.boards[0];
 let column=b.columns.find((c:any)=>c.title==="CRM Files");
 if(!column)column=(await monday("mutation($b:ID!){create_column(board_id:$b,title:\"CRM Files\",column_type:file){id title}}",{b:CONFIG.quotes.board})).data.create_column;
 const filename=proof.filename.replace(/(\\.[^.]+)?$/,(_:string,ext:string)=>" ["+proof.id+"]"+(ext||""));
 const assets=(await monday("query($ids:[ID!]!){items(ids:$ids){assets{id name}}}",{ids:[quote.item_id]})).data.items[0]?.assets||[];
 let asset=assets.find((a:any)=>a.name===filename);
 if(!asset){
 const {data,error}=await db.storage.from("ai-apparel-quote-proofs").download(proof.storage_path);if(error||!data)throw Error(error?.message||"Proof file unavailable");
 const form=new FormData();
 form.append("query","mutation($file:File!){add_file_to_column(item_id:"+quote.item_id+",column_id:"+JSON.stringify(column.id)+",file:$file){id name}}");
 form.append("map",JSON.stringify({file:"variables.file"}));
 form.append("file",data,filename);
 const response=await fetch("https://api.monday.com/v2/file",{method:"POST",headers:{"Authorization":mondayToken},body:form,signal:AbortSignal.timeout(35000)});
 const result=await response.json();
 if(!response.ok||result.errors?.length||!result.data?.add_file_to_column?.id)throw Error(JSON.stringify(result.errors||{status:response.status}));
 asset=result.data.add_file_to_column;
 }
 await rpc("ack",{kind:"proofs",source_id:sourceId,item_id:asset.id,fingerprint:hash});
 proofResults.push({id:sourceId,ok:true});
 }catch(e){await rpc("ack",{kind:"proofs",source_id:sourceId,error:String(e).slice(0,1800)});proofResults.push({id:sourceId,ok:false});}
 if(Date.now()-started>80000)break;
 }
 const detailResults:any[]=[];
 for(const row of rows.filter(x=>x.details.length>1800)){
 const sourceId=row.kind+":"+row.id,hash=await fingerprint(row),record:any=state.get(sourceId),old:any=state.get("details:"+sourceId);
 if(!record?.item_id||(old?.fingerprint===hash&&!old?.last_error))continue;
 try{
 const esc=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
 const heading="CRM details (automatically synchronized)";
 const body="<p><strong>"+heading+"</strong></p><p>"+esc(row.details).replace(/\n/g,"<br />")+"</p>";
 let updateId=old?.item_id;
 if(!updateId){
 const existing=(await monday("query($ids:[ID!]!){items(ids:$ids){updates(limit:100){id body}}}",{ids:[record.item_id]})).data.items[0]?.updates||[];
 updateId=existing.find((u:any)=>u.body?.includes(heading))?.id;
 }
 const result=updateId?await monday("mutation($id:ID!,$body:String!){edit_update(id:$id,body:$body){id body}}",{id:updateId,body}):await monday("mutation($item:ID!,$body:String!){create_update(item_id:$item,body:$body){id body}}",{item:record.item_id,body});
 const update=result.data.edit_update||result.data.create_update;
 if(!update?.id||!update.body?.includes(esc(row.details.split("\n").pop()||"")))throw Error("Full detail update was not confirmed");
 await rpc("ack",{kind:"details",source_id:sourceId,item_id:update.id,fingerprint:hash});
 detailResults.push({id:sourceId,ok:true});
 }catch(e){await rpc("ack",{kind:"details",source_id:sourceId,item_id:old?.item_id,error:String(e).slice(0,1800)});detailResults.push({id:sourceId,ok:false});}
 if(Date.now()-started>80000)break;
 }
 if(!pending.length)return out({ok:proofResults.every(x=>x.ok)&&detailResults.every(x=>x.ok),total:rows.length,synced:0,pending:0,proofs:proofResults,details:detailResults});
 const batch=pending.slice(0,200),kinds=[...new Set(batch.map(x=>x.row.kind))];
 const boards:any={};
 for(const kind of kinds){
 const cfg=CONFIG[kind];
 const r=await monday("query($ids:[ID!]!){boards(ids:$ids){id columns{id title type settings_str} groups{id title}}}",{ids:[cfg.board]});
 const board=r.data?.boards?.[0];if(!board)throw Error("Monday board inaccessible: "+cfg.board);
 if(!board.columns.some((c:any)=>c.title==="CRM Details")){
 const cr=await monday("mutation($board:ID!){create_column(board_id:$board,title:\"CRM Details\",column_type:long_text){id title type settings_str}}",{board:cfg.board});
 board.columns.push(cr.data.create_column);
 }
 const idColumn=board.columns.find((c:any)=>c.title===cfg.key);
 if(!idColumn)throw Error("Missing source ID column: "+kind);
 board.existing=new Map();
 // Recover IDs from Monday before creating, including after a crash between creation and acknowledgement.
 if(batch.some(x=>x.row.kind===kind&&!x.old?.item_id)){
 let page=(await monday("query($ids:[ID!]!,$cols:[String!]){boards(ids:$ids){items_page(limit:500){cursor items{id column_values(ids:$cols){text}}}}}",{ids:[cfg.board],cols:[idColumn.id]})).data.boards[0].items_page;
 while(true){for(const item of page.items)if(item.column_values[0]?.text)board.existing.set(item.column_values[0].text,item.id);if(!page.cursor)break;
 page=(await monday("query($cursor:String!,$cols:[String!]){next_items_page(limit:500,cursor:$cursor){cursor items{id column_values(ids:$cols){text}}}}",{cursor:page.cursor,cols:[idColumn.id]})).data.next_items_page;}
 }
 boards[kind]=board;
 }
 let synced=0,failed=0;
 const errors:any[]=[];
 for(let offset=0;offset<batch.length;offset+=10){
 if(Date.now()-started>95000)break;
 const chunk=batch.slice(offset,offset+10),variables:any={},decl:string[]=[],mut:string[]=[];
 for(let i=0;i<chunk.length;i++){
 const {row,old}=chunk[i],b=boards[row.kind],values:any={};
 for(const [label,value] of Object.entries({...row.values,"CRM Details":row.details,"Last Synced":new Date().toISOString(),"Sync Status":row.kind==="jobs"||row.kind==="invoices"?"Success":"Synced"})){
 const c=b.columns.find((c:any)=>c.title===label);if(!c)throw Error("Unmapped column: "+row.kind+" "+label);
 if(value==null){values[c.id]=null;continue;}
 if(c.type==="status"){const labels=JSON.parse(c.settings_str||"{}").labels||{};if(!Object.values(labels).includes(value))throw Error("Unknown status "+label+": "+value);values[c.id]={label:value};}
 else if(c.type==="date")values[c.id]=day(value)?{date:day(value)}:null;
 else if(c.type==="email")values[c.id]=value?{email:value,text:value}:null;
 else if(c.type==="phone"){const phone=text(value).replace(/[^\d+]/g,"");values[c.id]=phone.length>=7?{phone,countryShortName:"US"}:null;}
 else if(c.type==="dropdown")values[c.id]={labels:[value]};
 else if(c.type==="long_text")values[c.id]={text:text(value).length>1800?text(value).slice(0,1800)+"\n\nFull details are in this item’s Updates section.":text(value)};
 else values[c.id]=text(value);
 }
 const id=old?.item_id||b.existing.get(row.id);chunk[i].itemId=id;chunk[i].group=b.groups.find((g:any)=>g.title===row.group)?.id;
 if(!chunk[i].group)throw Error("Unmapped group "+row.kind+" "+row.group);
 variables["b"+i]=CONFIG[row.kind].board;variables["v"+i]=JSON.stringify(id?{...values,name:row.name}:values);
 decl.push("$b"+i+":ID!","$v"+i+":JSON!");
 if(id){variables["i"+i]=id;decl.push("$i"+i+":ID!");mut.push("r"+i+":change_multiple_column_values(board_id:$b"+i+",item_id:$i"+i+",column_values:$v"+i+"){id}");}
 else{variables["n"+i]=row.name;variables["g"+i]=chunk[i].group;decl.push("$n"+i+":String!","$g"+i+":String!");mut.push("r"+i+":create_item(board_id:$b"+i+",item_name:$n"+i+",group_id:$g"+i+",column_values:$v"+i+"){id}");}
 }
 const result=await monday("mutation("+decl.join(",")+"){"+mut.join(" ")+"}",variables,true);
 await Promise.all(chunk.map(async (_:any,i:number)=>{
 const {row,hash,itemId,group}=chunk[i],id=result.data?.["r"+i]?.id;
 if(!id){const error=JSON.stringify(result.errors||[{message:"Monday did not confirm write"}]).slice(0,1800);await rpc("ack",{kind:row.kind,source_id:row.id,item_id:itemId,error});failed++;errors.push({kind:row.kind,id:row.id,error});return;}
 // Persist ID before group update so a later failure cannot duplicate the item.
 await rpc("ack",{kind:row.kind,source_id:row.id,item_id:id,fingerprint:hash,group_title:row.group});
 if(itemId&&chunk[i].old?.group_title!==row.group){try{await monday("mutation($i:ID!,$g:String!){move_item_to_group(item_id:$i,group_id:$g){id}}",{i:id,g:group});}catch(e){await rpc("ack",{kind:row.kind,source_id:row.id,item_id:id,error:String(e),group_title:chunk[i].old?.group_title||"__unknown__"});failed++;return;}}
 synced++;
 }));
 if(result.errors?.some((e:any)=>/limit|budget|throttl/i.test(JSON.stringify(e))))break;
 }
 return out({ok:failed===0&&proofResults.every(x=>x.ok)&&detailResults.every(x=>x.ok),total:rows.length,synced,failed,pending:pending.length-synced,errors,proofs:proofResults});
 }catch(e){return out({error:String(e)},500);}
 finally{if(acquired)await rpc("release",{owner}).catch(()=>{});}
});
