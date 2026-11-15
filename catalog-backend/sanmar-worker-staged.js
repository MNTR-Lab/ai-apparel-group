/*
 AI Apparel Group - SanMar API
 Version: sanmar-color-parser-6

 Full replacement.
 Preserves product and live Net pricing routes.
*/

const VERSION = "sanmar-color-parser-6";

const PRODUCT_ENDPOINT =
  "https://ws.sanmar.com:8080/promostandards/ProductDataServiceBindingV2";

const PRICE_ENDPOINT =
  "https://ws.sanmar.com:8080/promostandards/PricingAndConfigurationServiceBinding";

const PRODUCT_NS =
  "http://www.promostandards.org/WSDL/ProductDataService/2.0.0/";

const PRICE_NS =
  "http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/";

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, c => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  }[c]));
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n) => {
      try {
        return String.fromCodePoint(
          n[0].toLowerCase() === "x"
            ? parseInt(n.slice(1), 16)
            : Number(n)
        );
      } catch {
        return m;
      }
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function sections(xml, name) {
  const re = new RegExp(
    "<(?:[\\w.-]+:)?" + name +
    "\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" +
    name + "\\s*>",
    "gi"
  );

  return [...String(xml || "").matchAll(re)]
    .map(m => m[1]);
}

function field(xml, name) {
  const value = sections(xml, name)[0];

  return value === undefined
    ? ""
    : decodeXml(
        value.replace(/<[^>]*>/g, "").trim()
      );
}

function first(xml, names) {
  for (const name of names) {
    const value = field(xml, name);
    if (value) return value;
  }
  return "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function safeError(value, env) {
  let message = String(value ?? "");

  for (const secret of [
    env.SANMAR_USERNAME,
    env.SANMAR_PASSWORD,
    env.SANMAR_API_TOKEN
  ]) {
    if (secret && secret.length >= 3) {
      message = message
        .split(secret)
        .join("[REDACTED]");
    }
  }

  return message
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\s+/g, " ")
    .slice(0, 450);
}

function soapTags(tags) {
  return Object.entries(tags)
    .filter(([, value]) =>
      value !== null && value !== undefined
    )
    .map(([name, value]) =>
      "<shar:" + name + ">" +
      escapeXml(value) +
      "</shar:" + name + ">"
    ).join("");
}

async function soap(
  env,
  kind,
  operation,
  productId,
  extra = {}
) {
  const pricing = kind === "price";
  const ns = pricing ? PRICE_NS : PRODUCT_NS;

  let tags;

  if (!pricing) {
    tags = {
      wsVersion: "2.0.0",
      id: env.SANMAR_USERNAME,
      password: env.SANMAR_PASSWORD,
      localizationCountry: "US",
      localizationLanguage: "en",
      productId,
      ...extra
    };
  } else if (operation === "GetFobPoints") {
    tags = {
      wsVersion: "1.0.0",
      id: env.SANMAR_USERNAME,
      password: env.SANMAR_PASSWORD,
      productId,
      localizationCountry: "US",
      localizationLanguage: "en"
    };
  } else if (
    operation === "GetConfigurationAndPricing"
  ) {
    tags = {
      wsVersion: "1.0.0",
      id: env.SANMAR_USERNAME,
      password: env.SANMAR_PASSWORD,
      productId,
      partId: extra.partId,
      currency: "USD",
      fobId: extra.fobId,
      priceType: "Net",
      localizationCountry: "US",
      localizationLanguage: "EN",
      configurationType: "Blank"
    };
  } else {
    throw new Error("Unsupported operation");
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope ' +
    'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:ns="' + ns + '" ' +
    'xmlns:shar="' + ns + 'SharedObjects/">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<ns:" + operation + "Request>" +
    soapTags(tags) +
    "</ns:" + operation + "Request>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>";

  const response = await fetch(
    pricing ? PRICE_ENDPOINT : PRODUCT_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8"
      },
      body,
      signal: AbortSignal.timeout(20000)
    }
  );

  const xml = await response.text();
  const fault = sections(xml, "Fault")[0] || "";

  if (!response.ok || fault) {
    const detail = first(fault, [
      "faultstring",
      "Text",
      "description",
      "message"
    ]);

    throw new Error(
      operation + " failed (" +
      response.status + ")" +
      (detail
        ? ": " + safeError(detail, env)
        : "")
    );
  }

  const messages = sections(xml, "ServiceMessage");

  if (messages.length) {
    throw new Error(
      operation + ": " +
      safeError(
        first(messages[0], [
          "description",
          "message"
        ]) || "SanMar service error",
        env
      )
    );
  }

  return xml;
}

// --------------------------------------
// COLOR PARSER
// --------------------------------------

function directText(xml) {
  const text = String(xml || "").trim();

  // A scalar color value must not contain
  // additional XML elements.
  if (/<[A-Za-z/]/.test(text)) {
    return "";
  }

  return decodeXml(text).trim();
}

function colorCandidates(part) {
  const candidates = [];

  function add(value, source) {
    const name = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (
      name &&
      !candidates.some(
        x => x.name === name
      )
    ) {
      candidates.push({ name, source });
    }
  }

  // Prefer individually structured names
  // inside the product's color array.
  const colorArray =
    sections(part, "ColorArray")[0] || "";

  for (const block of sections(
    colorArray,
    "Color"
  )) {
    for (const tag of [
      "colorName",
      "colorDescription"
    ]) {
      for (const value of sections(block, tag)) {
        const scalar = directText(value);

        if (scalar) {
          add(scalar, "ColorArray." + tag);
        }
      }
    }
  }

  // Inspect primaryColor as a scalar,
  // never concatenate nested XML nodes.
  for (const value of sections(
    part,
    "primaryColor"
  )) {
    const scalar = directText(value);

    if (scalar) {
      add(scalar, "primaryColor");
    }
  }

  // Alternative individual color fields.
  for (const tag of [
    "colorName",
    "colorDescription"
  ]) {
    for (const value of sections(part, tag)) {
      const scalar = directText(value);

      if (scalar) {
        add(scalar, tag);
      }
    }
  }

  return candidates;
}

function parseProduct(xml, sellableIds) {
  const product =
    sections(xml, "Product")[0] || xml;

  let parts = sections(
    product,
    "ProductPart"
  );

  if (!parts.length) {
    parts = sections(product, "Part");
  }

  const variants = [];
  const seen = new Set();
  const samples = [];
  const colorSources = {};

  let missingColor = 0;
  let missingSize = 0;
  let ambiguousColor = 0;

  for (const part of parts) {
    const partId = first(part, [
      "partId",
      "partID"
    ]);

    if (!partId) continue;

    if (
      sellableIds.size &&
      !sellableIds.has(partId)
    ) {
      continue;
    }

    const candidates =
      colorCandidates(part);

    /*
     If the source contains a structured
     ColorArray, use its first individual
     color name, rather than concatenating
     all XML text into one color label.

     The diagnostics retain all candidates
     for review.
    */

    const selected = candidates[0] || null;

    if (candidates.length > 1) {
      ambiguousColor++;
    }

    const apparel =
      sections(part, "ApparelSize")[0] || "";

    const size =
      first(apparel, [
        "labelSize",
        "customSize",
        "sizeName",
        "size"
      ]) ||
      first(part, [
        "labelSize",
        "customSize",
        "sizeName",
        "size"
      ]);

    if (samples.length < 12) {
      samples.push({
        partId,
        selectedColor:
          selected?.name || "",
        source:
          selected?.source || "",
        candidates,
        size
      });
    }

    if (!selected) {
      missingColor++;
      continue;
    }

    if (!size) {
      missingSize++;
      continue;
    }

    const key =
      partId + "|" +
      selected.name + "|" +
      size;

    if (seen.has(key)) continue;

    seen.add(key);

    colorSources[selected.source] =
      (colorSources[selected.source] || 0) + 1;

    variants.push({
      partId,
      color: selected.name,
      size
    });
  }

  return {
    productName: first(product, [
      "productName",
      "name"
    ]),
    variants,
    partDetailCount: parts.length,
    missingColor,
    missingSize,
    ambiguousColor,
    colorSources,
    samples
  };
}

async function getProduct(env, productId) {
  const sellable = await soap(
    env,
    "product",
    "GetProductSellable",
    productId,
    { isSellable: "true" }
  );

  const partIds = unique(
    sections(sellable, "partId")
      .map(x => decodeXml(x.trim()))
  );

  let details = "";
  let detailsError = "";

  try {
    details = await soap(
      env,
      "product",
      "GetProduct",
      productId
    );
  } catch (error) {
    detailsError =
      error.message ||
      "Product details unavailable";
  }

  const parsed = details
    ? parseProduct(
        details,
        new Set(partIds)
      )
    : {
        productName: "",
        variants: [],
        partDetailCount: 0,
        missingColor: 0,
        missingSize: 0,
        ambiguousColor: 0,
        colorSources: {},
        samples: []
      };

  const colors = unique(
    parsed.variants.map(v => v.color)
  );

  if (
    !detailsError &&
    !parsed.variants.length
  ) {
    detailsError =
      "SanMar returned no usable variants";
  }

  return {
    success: true,
    supplier: "SanMar",
    productId,
    productName:
      parsed.productName || productId,
    partIds,
    partCount: partIds.length,
    variants: parsed.variants,
    detailsError,
    diagnostics: {
      parserVersion: VERSION,
      productParts: parsed.partDetailCount,
      distinctColors: colors.length,
      mappedVariants: parsed.variants.length,
      missingColor: parsed.missingColor,
      missingSize: parsed.missingSize,
      ambiguousColor:
        parsed.ambiguousColor,
      colorSources:
        parsed.colorSources,
      partSamples: parsed.samples
    }
  };
}

// --------------------------------------
// LIVE NET PRICING
// --------------------------------------

function parsePriceBreaks(part) {
  const breaks = [];

  for (const p of sections(
    part,
    "PartPrice"
  )) {
    const quantity =
      Number(field(p, "minQuantity"));

    const cost =
      Number(field(p, "price"));

    const priceUom =
      field(p, "priceUom")
        .toUpperCase();

    if (
      Number.isSafeInteger(quantity) &&
      quantity >= 1 &&
      Number.isFinite(cost) &&
      cost > 0
    ) {
      breaks.push({
        minQuantity: quantity,
        unitCost: cost,
        priceUom
      });
    }
  }

  return breaks.sort(
    (a, b) =>
      a.minQuantity - b.minQuantity
  );
}

async function getPricing(
  env,
  productId,
  partId,
  quantity
) {
  const fobXml = await soap(
    env,
    "price",
    "GetFobPoints",
    productId
  );

  const fobIds = unique(
    sections(fobXml, "fobId")
      .map(x => decodeXml(x.trim()))
  );

  if (!fobIds.length) {
    throw new Error(
      "SanMar returned no FOB warehouses"
    );
  }

  const diagnostics = [];

  for (const fobId of fobIds.slice(0, 12)) {
    try {
      const xml = await soap(
        env,
        "price",
        "GetConfigurationAndPricing",
        productId,
        { partId, fobId }
      );

      const configs =
        sections(xml, "Configuration");

      const parts =
        sections(xml, "Part");

      const matching = parts.filter(
        p => field(p, "partId") === partId
      );

      const confirmedNet = configs.some(
        c =>
          field(c, "priceType")
            .toLowerCase() === "net"
      );

      const confirmedUSD = configs.some(
        c =>
          field(c, "currency")
            .toUpperCase() === "USD"
      );

      diagnostics.push({
        fobId,
        configurations: configs.length,
        matchingParts: matching.length,
        confirmedNet,
        confirmedUSD
      });

      if (
        !confirmedNet ||
        !confirmedUSD ||
        !matching.length
      ) {
        continue;
      }

      for (const part of matching) {
        const breaks =
          parsePriceBreaks(part);

        const eligible = breaks
          .filter(
            b => b.minQuantity <= quantity
          )
          .at(-1);

        if (!eligible) continue;

        if (
          !["CA", "EA", "PC"].includes(
            eligible.priceUom
          )
        ) {
          continue;
        }

        return {
          success: true,
          verified: true,
          supplier: "SanMar",
          productId,
          partId,
          quantity,
          currency: "USD",
          fobId,
          supplierCost:
            eligible.unitCost,
          priceUom:
            eligible.priceUom,
          pricingBasis:
            eligible.priceUom === "CA"
              ? "Account case-tier Net price treated as per garment"
              : "Net price per unit",
          priceBreaks: breaks,
          pricingStatus:
            "SanMar Net supplier price",
          source:
            "Live SanMar Pricing and Configuration API"
        };
      }

    } catch (error) {
      diagnostics.push({
        fobId,
        error: safeError(
          error.message,
          env
        )
      });
    }
  }

  return {
    success: false,
    verified: false,
    supplier: "SanMar",
    productId,
    partId,
    quantity,
    supplierCost: null,
    error:
      "No matching SanMar Net supplier cost found",
    diagnostics
  };
}

// --------------------------------------
// HTTP ROUTES
// --------------------------------------


const CATALOG_CATEGORIES = ["Polos/Knits","T-Shirts","Outerwear","Sweatshirts/Fleece","Caps","Bags","Woven Shirts","Activewear","Workwear","Bottoms","Youth"];
const CATALOG_ORIGINS = new Set(["https://aiapparelgroup.com","https://www.aiapparelgroup.com","https://aiapparelgroup.myshopify.com"]);
const publicText = v => decodeXml(String(v || "")).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
function publicUrl(v) { try { const u=new URL(v); return u.protocol==="https:" ? u.href : ""; } catch { return ""; } }
async function boundedText(r,limit=24000000) {
  const reader=r.body.getReader(), chunks=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw Error("Catalog response too large");}chunks.push(value);}
  const out=new Uint8Array(total);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return new TextDecoder().decode(out);
}
function normalizeStandard(xml,category) {
  const by=new Map();
  for(const row of sections(xml,"listResponse")){
    const b=sections(row,"productBasicInfo")[0]||row,im=sections(row,"productImageInfo")[0]||"";
    const id=field(b,"style");if(!id||/discontinued/i.test(field(b,"productStatus")))continue;
    let p=by.get(id);
    if(!p){p={id,source:"sanmar",name:publicText(field(b,"productTitle")||id),brand:publicText(field(b,"brandName")),category,description:publicText(field(b,"productDescription")),image:publicUrl(first(im,["productImage","frontFlat","colorProductImage","thumbnailImage"])),colors:[],sizes:[]};by.set(id,p);}
    const color=publicText(first(b,["catalogColor","color"])),size=publicText(field(b,"size"));
    if(color&&!p.colors.includes(color))p.colors.push(color);
    if(size&&!p.sizes.includes(size))p.sizes.push(size);
  }
  return [...by.values()];
}

const FEATURED_STYLES={
"Polos/Knits":["K500","K540","K100","ST650","ST640","LK500","L540","LST650"],
"T-Shirts":["PC54","PC61","PC55","ST350","DT6000","DM130","LPC54","YST350"],
"Outerwear":["J317","L317","J790","L790","J730","J354"],
"Sweatshirts/Fleece":["PC78H","PC90H","ST253","F217","L217","F219"],
"Caps":["C112","C112LP","CP90","CP80","C812","NE1020"],
"Bags":["BG1050","BG615","BG410","BG76S","BG600","BG202"],
"Woven Shirts":["S608","L608","S508","W808","LW700","S658"],
"Activewear":["ST350","ST360","ST550","LST350","ST650","PST74"],
"Workwear":["CS412","CS410","CS402","CS401","CS430","CSJ24"],
"Bottoms":["PC78P","PST74","ST237","LPST880","CSW24","LST299"],
"Youth":["PC54Y","PC90YH","YST350","YST650","YPC78H","YST253"]
};
async function catalogCategory(env,category,req,ctx){
  const key=new Request(new URL("/_featured_v2/"+encodeURIComponent(category),req.url));
  const cached=await caches.default.match(key);if(cached)return cached.json();
  const results=await Promise.allSettled((FEATURED_STYLES[category]||[]).map(id=>catalogStyle(env,id,req,ctx)));
  const products=results.filter(r=>r.status==="fulfilled").map(r=>r.value);
  if(!products.length)throw Error("Apparel connection unavailable");
  ctx.waitUntil(caches.default.put(key,Response.json(products,{headers:{"Cache-Control":"public,max-age=1800"}})));return products;
}
async function catalogStyle(env,id,req,ctx){
  const key=new Request(new URL("/_public_style_v1/"+id,req.url));const cached=await caches.default.match(key);if(cached)return cached.json();
  const xml=await soap(env,"product","GetProduct",id);
  const p=sections(xml,"Product")[0]||xml,parsed=parseProduct(xml,new Set());
  const result={id,source:"sanmar",name:publicText(first(p,["productName","name"])||id),brand:publicText(field(p,"productBrand")),category:publicText(field(p,"category")),description:publicText(field(p,"description")),image:publicUrl(field(p,"primaryImageUrl")),colors:unique(parsed.variants.map(v=>v.color)),sizes:unique(parsed.variants.map(v=>v.size)),variants:parsed.variants.map(v=>({id:v.partId,color:v.color,size:v.size}))};
  if(!result.brand&&!result.image&&!result.colors.length)throw Error("Style unavailable");
  ctx.waitUntil(caches.default.put(key,Response.json(result,{headers:{"Cache-Control":"public,max-age=3600"}})));return result;
}

async function publicPromo(req,ctx){
  const u=new URL(req.url),id=u.searchParams.get("id"),q=(u.searchParams.get("q")||"tumbler").slice(0,100);
  const key=new Request(new URL("/_promo_v1/"+(id?"detail/"+id:encodeURIComponent(q)),req.url));
  const cached=await caches.default.match(key);if(cached)return cached.json();
  const upstream=new URL("https://qpavspvpdebtbbffdcmo.supabase.co/functions/v1/ai-apparel-sage-products");upstream.searchParams.set(id?"productId":"q",id||q);
  const r=await fetch(upstream,{signal:AbortSignal.timeout(25000)});const d=JSON.parse(await boundedText(r,6000000));if(!r.ok||!d.ok)throw Error("Promotional catalog unavailable");
  let result;
  if(id){
    const p=d.product?.product||d.product||{};
    result={ok:true,product:{id,source:"sage",name:publicText(p.prName||p.name),code:publicText(p.spc||p.itemNum),brand:"",category:publicText(p.category),description:publicText(p.description),image:publicUrl((p.pics||[]).find(p=>!p.hasLogo)?.url||(p.pics||[])[0]?.url),colors:String(p.colors||"").split(",").map(c=>c.trim()).filter(Boolean),sizes:[],decoration:publicText(p.decorationMethod),minimum:String(p.qty?.[0]||""),production:publicText(p.prodTime)},attribution:publicText(d.product?.legalNote)};
  } else {
    result={ok:true,products:(d.products||[]).map(p=>({id:String(p.id),source:"sage",name:publicText(p.name),code:publicText(p.code),image:publicUrl(p.image),brand:"",colors:[],sizes:[]})),total:Math.min(Number(d.totalFound)||0,(d.products||[]).length),attribution:"Product data © SAGE. All rights reserved."};
  }
  ctx.waitUntil(caches.default.put(key,Response.json(result,{headers:{"Cache-Control":"public,max-age=900"}})));return result;
}

async function publicCatalog(req,env,ctx){
  const origin=req.headers.get("Origin")||"",headers={"Content-Type":"application/json","Access-Control-Allow-Origin":CATALOG_ORIGINS.has(origin)?origin:"https://aiapparelgroup.com","Access-Control-Allow-Methods":"GET,OPTIONS","Vary":"Origin","X-Content-Type-Options":"nosniff"};
  const reply=(v,s=200)=>Response.json(v,{status:s,headers});
  if(origin&&!CATALOG_ORIGINS.has(origin))return reply({error:"Origin not allowed"},403);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="GET")return reply({error:"GET required"},405);
  const u=new URL(req.url);
  try {
    if(u.pathname==="/public/promo") {if(u.searchParams.get("id")&&!/^\d{1,14}$/.test(u.searchParams.get("id")))return reply({error:"Invalid product"},400);return reply(await publicPromo(req,ctx));}
    if(u.pathname==="/public/product"){const id=(u.searchParams.get("id")||"").toUpperCase();if(!/^[A-Z0-9-]{1,40}$/.test(id))return reply({error:"Invalid style"},400);return reply({ok:true,product:await catalogStyle(env,id,req,ctx)});}
    const category=u.searchParams.get("category")||"Polos/Knits";if(!CATALOG_CATEGORIES.includes(category))return reply({error:"Invalid category"},400);
    const q=(u.searchParams.get("q")||"").trim().slice(0,100).toLowerCase(),brand=(u.searchParams.get("brand")||"").slice(0,100),color=(u.searchParams.get("color")||"").slice(0,100);
    const page=Math.max(1,Math.min(500,Number(u.searchParams.get("page"))||1)),limit=24;
    if(q&&/^[a-z0-9-]{2,20}$/.test(q)&&/\d/.test(q)){try{return reply({ok:true,products:[await catalogStyle(env,q.toUpperCase(),req,ctx)],total:1,page:1,hasMore:false,brands:[],colors:[]});}catch{}}
    const all=await catalogCategory(env,category,req,ctx);
    const products=all.filter(p=>(!q||(p.id+" "+p.name+" "+p.brand+" "+p.description).toLowerCase().includes(q))&&(!brand||p.brand===brand)&&(!color||p.colors.includes(color)));
    if(!products.length&&/^[a-z0-9-]{2,20}$/.test(q)&&/\d/.test(q)){try{return reply({ok:true,products:[await catalogStyle(env,q.toUpperCase(),req,ctx)],total:1,page:1,hasMore:false,brands:[],colors:[]});}catch{}}
    return reply({ok:true,products:products.slice((page-1)*limit,page*limit),total:products.length,page,hasMore:page*limit<products.length,brands:unique(all.map(p=>p.brand)).sort(),colors:unique(all.flatMap(p=>p.colors)).sort()});
  }catch(e){console.error(JSON.stringify({event:"public_catalog_error",message:String(e.message).slice(0,100)}));return reply({ok:false,error:"The apparel catalog is temporarily unavailable. Please try again or contact our team."},502);}
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (["/public/catalog","/public/product","/public/promo"].includes(url.pathname)) return publicCatalog(req,env,ctx);

    if (
      req.method === "GET" &&
      url.pathname === "/health"
    ) {
      return json({
        service: "AI Apparel SanMar API",
        status: "online",
        version: VERSION,
        configured: !!(
          env.SANMAR_USERNAME &&
          env.SANMAR_PASSWORD &&
          env.SANMAR_API_TOKEN
        )
      });
    }

    if (
      req.method !== "POST" ||
      ![
        "/api/sanmar/product",
        "/api/sanmar/price"
      ].includes(url.pathname)
    ) {
      return json({
        error: "Not found"
      }, 404);
    }

    if (
      !env.SANMAR_API_TOKEN ||
      req.headers.get("X-API-Key") !==
        env.SANMAR_API_TOKEN
    ) {
      return json({
        error: "Unauthorized"
      }, 401);
    }

    if (
      !env.SANMAR_USERNAME ||
      !env.SANMAR_PASSWORD
    ) {
      return json({
        error:
          "SanMar credentials missing"
      }, 503);
    }

    let data;

    try {
      data = await req.json();
    } catch {
      return json({
        error: "Invalid JSON"
      }, 400);
    }

    const productId =
      String(data?.productId || "")
        .trim()
        .toUpperCase();

    if (
      !/^[A-Z0-9-]{1,40}$/.test(productId)
    ) {
      return json({
        error: "Invalid product ID"
      }, 400);
    }

    try {
      if (
        url.pathname ===
        "/api/sanmar/product"
      ) {
        return json(
          await getProduct(
            env,
            productId
          )
        );
      }

      const partId =
        String(data?.partId || "")
          .trim();

      const quantity =
        Number(data?.quantity ?? 1);

      if (
        !/^[A-Za-z0-9._-]{1,80}$/.test(partId) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 1000000
      ) {
        return json({
          error:
            "Invalid part ID or quantity"
        }, 400);
      }

      const result = await getPricing(
        env,
        productId,
        partId,
        quantity
      );

      return json(
        result,
        result.success ? 200 : 502
      );

    } catch (error) {
      return json({
        error: safeError(
          error.message ||
          "SanMar request failed",
          env
        )
      }, 502);
    }
  }
};

