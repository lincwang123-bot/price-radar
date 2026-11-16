import {readHtml,htmlText,htmlFailure,publicPageUrl} from './public-catalog-html.mjs';
import {deliveryEvidence} from './delivery-evidence.mjs';

const text=node=>htmlText(node.parts.map(p=>typeof p==='string'?p:text(p)).join(' '));
const same=(a,b)=>String(a).normalize('NFKC').replace(/\s+/g,'').toLowerCase()===String(b).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const hasClass=(node,name)=>(node.attrs.class||'').split(/\s+/).includes(name);
const within=(node,parent)=>{for(let p=node;p;p=p.parent)if(p===parent)return true;return false;};

function reviewedNativeCheckout(html,doc,main,item,product,conditions){
 // Reviewed Plus checkout only: its static amount is a loading placeholder.
 // Read the two agreeing public price declarations without running scripts or
 // fetching payment APIs. Do not treat a different product name as an alias.
 if(item.id!==1||item.minimum!==1||item.maximum!==1||item.delivery_way!==1
  ||main.attrs.id!=='native-purchase'||!['liuneng-item','ln-checkout','ln-approved-purchase'].every(c=>hasClass(main,c))
  ||doc.all.filter(n=>n.attrs.id==='native-purchase').length!==1||conditions.length!==1
  ||doc.graph.filter(p=>p['@type']==='Product').length!==1||product.sku!=='liunengai-1'
  ||product.offers.availability!==`https://schema.org/${item.status===1&&item.is_stock?'InStock':'OutOfStock'}`)return false;
 const schemas=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m=>/(?:^|\s)data-ln-product-schema(?:\s|=|$)/i.test(m[1])&&/\btype\s*=\s*["']application\/ld\+json["']/i.test(m[1]));
 if(schemas.length!==1)return false;
 try{if(JSON.stringify(JSON.parse(schemas[0][2]))!==JSON.stringify(product))return false;}catch{return false;}
 const cards=doc.all.filter(n=>n.attrs.id==='checkout-form');
 if(cards.length!==1||!within(cards[0],main)||!hasClass(cards[0],'checkout-form-card'))return false;
 const nodes=doc.all.filter(n=>within(n,cards[0]));
 const headings=nodes.filter(n=>hasClass(n,'checkout-heading'));
 const names=nodes.filter(n=>n.tag==='p'&&headings.some(h=>within(n,h)));
 const amounts=nodes.filter(n=>hasClass(n,'order-amount')),prices=nodes.filter(n=>hasClass(n,'price'));
 return headings.length===1&&names.length===1&&same(text(names[0]),item.name)
  &&amounts.length===1&&prices.length===1&&within(prices[0],amounts[0])
  &&text(prices[0])==='正在读取…'&&same(text(amounts[0]),'商品金额 正在读取…');
}
// Read a JSON literal, never evaluate the surrounding JavaScript. Restrict this
// reviewed contract to the storefront whose public markup was inspected.
export function parseReviewedAcgItem(html,entry,target,capturedAt){
 if(target.origin!=='https://liunenglabs.xyz'||!/^https:\/\/liunenglabs\.xyz\/item\/[1-9]\d*$/.test(entry.url))return null;
 const matches=[...html.matchAll(/<script\b[^>]*>\s*setVar\("_var_item",([\s\S]*?)\);\s*<\/script>/gi)];
 if(matches.length!==1)throw htmlFailure();
 let item;try{item=JSON.parse(matches[0][1]);}catch{throw htmlFailure();}
 if(!item||Array.isArray(item)||String(item.id)!==new URL(entry.url).pathname.split('/').at(-1)
  ||typeof item.name!=='string'||!item.name.trim()||item.name.length>300
  ||typeof item.price!=='number'||!Number.isFinite(item.price)||item.price<=0||item.price>1e6
  ||![0,1].includes(item.status)||item.only_user!==0||item.login!==false
  ||item.seckill_status!==0||item.draft_status!==0||item.inventory_hidden!==0
  ||!Array.isArray(item.widget)||item.widget.length||!Array.isArray(item.config)||item.config.length
  ||!Number.isSafeInteger(item.stock)||item.stock<0||typeof item.is_stock!=='boolean'
  ||![0,1].includes(item.delivery_way))throw htmlFailure();
 const doc=readHtml(html),headings=doc.all.filter(n=>n.tag==='h1');
 const products=doc.graph.filter(p=>p['@type']==='Product'&&p.url===entry.url);
 const plans=doc.all.filter(n=>n.tag==='a'&&n.attrs['data-plan-link']&&publicPageUrl(n.attrs.href,target.origin)===entry.url);
 if(headings.length!==1||products.length!==1||!same(text(headings[0]),item.name))throw htmlFailure();
 const product=products[0],offer=product.offers;
 if(!same(product.name,item.name)||offer?.['@type']!=='Offer'||offer.url!==entry.url||offer.priceCurrency!=='CNY'
  ||Number(offer.price)!==item.price
  ||(item.is_stock&&item.stock===0)||(!item.is_stock&&item.stock>0))throw htmlFailure();
 // Stock is a service availability declaration, not counted card inventory.
 const status=item.status===1&&item.is_stock?'in_stock':'out_of_stock';
 let main=headings[0];while(main&&main.tag!=='main')main=main.parent;
 if(!main)throw htmlFailure();
 const conditions=doc.all.filter(n=>(n.attrs.class||'').split(/\s+/).includes('ln-purchase-conditions'));
 if(conditions.length>1||conditions.some(n=>{let p=n;while(p&&p!==main)p=p.parent;return !p;}))throw htmlFailure();
 let priceEvidence='同商品公开方案标价、JSON-LD 和页面内嵌游客价格一致';
 if(plans.length){
  if(plans.length!==1)throw htmlFailure();
  const priced=/^(.+?)\s*[¥￥]\s*(\d+(?:\.\d{1,2})?)(?:\s|$)/.exec(text(plans[0]));
  if(!priced||!same(priced[1],item.name)||Number(priced[2])!==item.price)throw htmlFailure();
 }else{
  if(!reviewedNativeCheckout(html,doc,main,item,product,conditions))throw htmlFailure();
  priceEvidence='同商品 JSON-LD 与页面内嵌游客标价一致；金额区需动态显示，结算手续费未核验';
 }
 const description=htmlText([product.description,...conditions.map(text)].filter(Boolean).join('\n')).slice(0,6000);
 return {offerId:`${target.id}:acg:${item.id}`,sourceId:target.id,sourceName:target.name,storeName:target.name,
  title:item.name,price:item.price,listedPrice:item.price,priceBasis:'listed',currency:'CNY',status,
  stockCount:status==='out_of_stock'?0:item.delivery_way===1?null:item.stock,url:entry.url,capturedAt,
  deliveryMode:item.delivery_way===1?'manual':'auto',extra:{catalogFormat:'reviewed-acg-item',
   publicDescription:description,deliveryEvidence:deliveryEvidence({productTitle:item.name,description,descriptionScope:'product'}),
   priceEvidence,
   stockEvidence:item.delivery_way===1?'公开商品页声明服务可售状态，未将服务数量作为卡密库存':'公开商品页内嵌库存'}};
}
