(() => {
'use strict';
const root=document.getElementById('ai-catalog');if(!root||root.dataset.ready)return;root.dataset.ready='true';
const $=id=>document.getElementById('aic-'+id),api=root.dataset.api,formUrl=root.dataset.form;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:'';}catch{return '';}};
const categories={sanmar:[['Polos/Knits','Polos'],['T-Shirts','T-Shirts'],['Outerwear','Outerwear'],['Sweatshirts/Fleece','Fleece & Hoodies'],['Caps','Headwear'],['Bags','Bags'],['Woven Shirts','Woven Shirts'],['Activewear','Activewear'],['Workwear','Workwear'],['Bottoms','Bottoms'],['Youth','Youth']],sage:[['tumbler','Drinkware'],['pen','Pens & Writing'],['tote bag','Bags & Totes'],['notebook','Office & Notebooks'],['technology','Technology'],['golf','Golf & Outdoors'],['gift','Gifts & Recognition'],['trade show','Events & Trade Shows']]};
let source=new URL(location.href).searchParams.get('view')==='promotional'?'sage':'sanmar',page=1,requestVersion=0,current=[],promoProducts=[],promoKey='',hasMore=false,quote=[],detailProduct=null;
try{const stored=JSON.parse(localStorage.getItem('ai_catalog_quote_v1')||'[]');if(Array.isArray(stored))quote=stored.filter(p=>p&&['sanmar','sage'].includes(p.source)&&typeof p.id==='string'&&typeof p.name==='string'&&Number.isInteger(p.quantity)&&p.quantity>0&&p.quantity<=100000).slice(0,10);}catch{}
function save(){try{localStorage.setItem('ai_catalog_quote_v1',JSON.stringify(quote));}catch{}$('count').textContent=quote.length;}
const tileStyles={'T-Shirts':'PC54','Polos/Knits':'K500','Sweatshirts/Fleece':'PC78H','Outerwear':'J317','Caps':'CP90','Bags':'BG1050'};
function configure(){
 $('category-section').hidden=source!=='sanmar';
 $('category-tiles').innerHTML=categories.sanmar.filter(([v])=>tileStyles[v]).map(([v,l])=>`<button type="button" data-category="${esc(v)}" aria-pressed="false"><img src="https://cdnm.sanmar.com/catalog/images/${tileStyles[v]}.jpg" alt="" loading="lazy" width="200" height="160"><span>${esc(l)}</span></button>`).join('');
 root.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.source===source)));
 $('category').innerHTML=categories[source].map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
 $('apparel-filters').hidden=source!=='sanmar';$('query').placeholder=source==='sanmar'?'Search apparel by product, brand, or style number':'Search promotional products by keyword or code';
 $('heading').textContent=source==='sanmar'?'Featured apparel':'Promotional products';$('scope').textContent=source==='sanmar'?'Browse our apparel selection, or search by style number.':'Explore our promotional product catalog. Product choices and decoration are confirmed with your quote.';
 $('brand').innerHTML='<option value="">All brands</option>';$('color').innerHTML='<option value="">All colors</option>';page=1;
}
function options(id,values,label){const select=$(id),value=select.value;select.innerHTML=`<option value="">${esc(label)}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(values.includes(value))select.value=value;}
async function get(path,params){const u=new URL(api+path);Object.entries(params).forEach(([k,v])=>{if(v)u.searchParams.set(k,String(v));});const r=await fetch(u,{signal:AbortSignal.timeout(55000)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Catalog could not be loaded.');return d;}
function render(products){
 current=products;const displayed=$('sort').value==='az'?[...products].sort((a,b)=>a.name.localeCompare(b.name)):products;
 $('grid').innerHTML=displayed.map((p)=>{const i=current.indexOf(p);return `<article class="aic-product"><button type="button" class="aic-product-photo" data-detail="${i}" aria-label="View ${esc(p.name)}">${safeUrl(p.image)?`<img src="${esc(safeUrl(p.image))}" alt="${esc(p.name)}" loading="lazy" width="300" height="300">`:'<span>View product</span>'}</button><h3>${esc(p.name)}</h3><p>${esc(p.brand||'Promotional product')} · ${esc(p.code||p.id)}</p><small>${p.colors?.length?esc(p.colors.length+' colors · '+p.sizes.length+' sizes'):'Options available with quote'}</small><button class="aic-add" type="button" data-detail="${i}">Choose & add to quote</button></article>`;}).join('');
 $('grid').querySelectorAll('img').forEach(im=>im.addEventListener('error',()=>{im.hidden=true;const label=document.createElement('span');label.textContent='View product';im.parentElement.append(label);},{once:true}));
}
async function load(){
 const version=++requestVersion;root.setAttribute('aria-busy','true');$('status').textContent='Loading products…';$('grid').innerHTML='';$('prev').hidden=true;$('next').hidden=true;
 try{
  let d,products,q=$('query').value.trim();
  if(source==='sanmar'){d=await get('/public/catalog',{category:$('category').value,q,brand:$('brand').value,color:$('color').value,page});products=d.products;if(version!==requestVersion)return;options('brand',d.brands||[],'All brands');options('color',d.colors||[],'All colors');hasMore=d.hasMore;}
  else{const term=q||$('category').value;if(promoKey!==term){const result=await get('/public/promo',{q:term});if(version!==requestVersion)return;promoProducts=result.products;promoKey=term;}d={total:promoProducts.length};products=promoProducts.slice((page-1)*24,page*24);hasMore=page*24<promoProducts.length;}
  if(version!==requestVersion)return;render(products);$('status').textContent=products.length?`${d.total} ${source==='sanmar'?'matching styles':'matching products'}${source==='sanmar'?' in this selection':''}. Select a product to choose options.`:'No matches. Try another search, category, or a style number.';
  $('prev').hidden=page===1;$('next').hidden=!hasMore;$('page').textContent=products.length?'Page '+page:'';$('credit').textContent=source==='sage'?'Product availability, decoration, and specifications are confirmed with your quote.':'Color and size options do not guarantee current stock. Availability is confirmed with your quote.';
 }catch(e){if(version===requestVersion){$('status').textContent=e.message+' Please try again or contact our team.';$('page').textContent='';}}finally{if(version===requestVersion)root.removeAttribute('aria-busy');}
}
async function detail(index){
 const p=current[index];if(!p)return;detailProduct=null;$('detail-content').innerHTML='<p role="status">Loading product details…</p>';$('detail').showModal();
 try{const d=await get(source==='sanmar'?'/public/product':'/public/promo',{id:p.id});detailProduct={...p,...d.product};const x=detailProduct;
 $('detail-content').innerHTML=`<div class="aic-detail-grid"><div>${safeUrl(x.image)?`<img src="${esc(safeUrl(x.image))}" alt="${esc(x.name)}">`:''}</div><div><p>${esc(x.brand||'Promotional product')} · ${esc(x.code||x.id)}</p><h2 id="aic-detail-title">${esc(x.name)}</h2><p>${esc(x.description||'Tell us what you need and our team will confirm the best product and decoration options.')}</p><label for="aic-detail-color">Color</label><select id="aic-detail-color"><option value="">Help me choose</option>${(x.colors||[]).map(v=>`<option>${esc(v)}</option>`).join('')}</select>${x.sizes?.length?`<label for="aic-detail-size">Size</label><select id="aic-detail-size"><option value="">Mixed sizes / confirm later</option>${x.sizes.map(v=>`<option>${esc(v)}</option>`).join('')}</select>`:''}<label for="aic-detail-qty">Quantity</label><input id="aic-detail-qty" type="number" min="1" max="100000" step="1" value="${Math.max(1,Number(x.minimum)||1)}"><p id="aic-detail-message" role="status"></p><button id="aic-detail-add" class="ai-button" type="button">Add to quote</button><p style="font-size:12px;margin-top:14px">Product options and stock are subject to confirmation. No prices are shown.</p></div></div>`;
 $('detail-color').addEventListener('change',()=>{if(!x.variants?.length||!$('detail-size'))return;const color=$('detail-color').value,sizes=[...new Set(x.variants.filter(v=>!color||v.color===color).map(v=>v.size))];$('detail-size').innerHTML='<option value="">Mixed sizes / confirm later</option>'+sizes.map(s=>`<option>${esc(s)}</option>`).join('');});
 $('detail-add').addEventListener('click',addDetail);
 }catch(e){$('detail-content').innerHTML=`<h2 id="aic-detail-title">Product details unavailable</h2><p>${esc(e.message)}</p><p>Please try again or <a href="/pages/contact">contact our team</a>.</p>`;}
}
function addDetail(){
 const quantity=Number($('detail-qty').value);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000){$('detail-message').textContent='Enter a whole quantity from 1 to 100,000.';return;}
 const p=detailProduct,color=$('detail-color').value,size=$('detail-size')?.value||'',found=quote.find(v=>v.source===p.source&&v.id===p.id&&v.color===color&&v.size===size);
 if(found){if(found.quantity+quantity>100000){$('detail-message').textContent='The maximum quantity per selection is 100,000.';return;}found.quantity+=quantity;}
 else{if(quote.length>=10){$('detail-message').textContent='Your list has 10 selections. Submit this request first, or contact our team for a larger assortment.';return;}quote.push({source:p.source,id:String(p.id),code:p.code||p.id,name:p.name,image:safeUrl(p.image),color,size,quantity});}
 save();$('detail-message').textContent='Added to your quote list.';$('detail-add').textContent='Added';setTimeout(()=>{if($('detail-add'))$('detail-add').textContent='Add to quote';},1200);
}
function showQuote(){renderQuote();$('quote').showModal();}
function renderQuote(){
 $('request-form').hidden=true;$('form-frame').removeAttribute('src');$('continue').hidden=!quote.length;
 $('quote-items').innerHTML=quote.length?quote.map((p,i)=>`<div class="aic-quote-row">${safeUrl(p.image)?`<img src="${esc(safeUrl(p.image))}" alt="">`:'<span></span>'}<div><strong>${esc(p.name)}</strong><small>${esc(p.source==='sanmar'?'Apparel':'Promotional')} · ${esc(p.code)}<br>${esc([p.color,p.size].filter(Boolean).join(' / ')||'Options to be confirmed')}</small></div><label><span class="ai-sr">Quantity for ${esc(p.name)}</span><input type="number" min="1" max="100000" step="1" data-quantity="${i}" value="${p.quantity}"></label><button type="button" data-remove="${i}">Remove</button></div>`).join(''):'<p>Your list is empty. Choose products from either catalog to get started.</p>';
 $('quote-status').textContent='';
}
function continueRequest(){
 if(!quote.length)return;const invalid=[...$('quote-items').querySelectorAll('input')].find(i=>!i.checkValidity());if(invalid){invalid.reportValidity();return;}
 const summary=quote.map((p,i)=>`${i+1}. ${p.source==='sanmar'?'Apparel':'Promotional'} | ${String(p.code).slice(0,40)}\n${p.name.slice(0,65)}\nQty ${p.quantity} | ${(p.color||'Color TBD').slice(0,30)} | ${(p.size||'Size TBD').slice(0,20)}`).join('\n\n').slice(0,1990);
 const u=new URL(formUrl);u.searchParams.set('catalog_items',summary);$('form-link').href=u.href;u.pathname=u.pathname.replace('/forms/','/forms/embed/');$('form-frame').src=u.href;$('request-form').hidden=false;$('request-form').scrollIntoView({behavior:'smooth',block:'start'});
}
root.querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',()=>{if(source===b.dataset.source)return;source=b.dataset.source;root.querySelectorAll('[data-source]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));$('query').value='';configure();load();}));
['category','brand','color'].forEach(id=>$(id).addEventListener('change',()=>{page=1;load();}));$('sort').addEventListener('change',()=>render(current));
 $('search').addEventListener('submit',e=>{e.preventDefault();page=1;load();});$('reset').addEventListener('click',()=>{$('query').value='';configure();load();});
 $('prev').addEventListener('click',()=>{page--;load();});$('next').addEventListener('click',()=>{page++;load();});
 $('category-tiles').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;$('category').value=b.dataset.category;$('query').value='';$('brand').value='';$('color').value='';page=1;$('category-tiles').querySelectorAll('button').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));load();$('heading').scrollIntoView({behavior:'smooth',block:'start'});});
 $('grid').addEventListener('click',e=>{const b=e.target.closest('[data-detail]');if(b)detail(Number(b.dataset.detail));});
 $('quote-open').addEventListener('click',showQuote);root.querySelectorAll('dialog .aic-close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
 $('quote-items').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){quote.splice(Number(b.dataset.remove),1);save();renderQuote();}});
 $('quote-items').addEventListener('change',e=>{const i=e.target;if(!i.matches('[data-quantity]'))return;const n=Number(i.value);if(!Number.isSafeInteger(n)||n<1||n>100000){i.reportValidity();return;}quote[Number(i.dataset.quantity)].quantity=n;save();$('request-form').hidden=true;});
 $('continue').addEventListener('click',continueRequest);configure();save();load();
})();
