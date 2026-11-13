const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(!["POST","GET"].includes(req.method))return json({error:"GET or POST required"},405);
 const base=Deno.env.get("SUPABASE_URL")!;
 const r=await fetch(base+"/functions/v1/ai-apparel-shopify-sync",{method:"POST",headers:{"Content-Type":"application/json","Authorization":req.headers.get("Authorization")||"","x-ai-financial-cron-token":req.headers.get("x-ai-financial-cron-token")||""},body:JSON.stringify({dry_run:new URL(req.url).searchParams.get("dry_run")==="1"})});
 return new Response(await r.text(),{status:r.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
});