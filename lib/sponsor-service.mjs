import {merchantIdForUrl} from './offer-provenance.mjs';
import {projectProduct} from './quote-policy.mjs';
import {publicOfferAllowed} from './public-offers.mjs';
import {buildProductDirectory,DIRECTORY_CATEGORIES} from './product-directory.mjs';
import {resolveOutboundOffer,outboundHref,safeMerchantUrl,WEBSITE_SPONSOR_SOURCE,websiteSponsorOffer,quoteSponsorOffer} from './outbound.mjs';
import {sponsorPlan,sponsorError} from './sponsor-plans.mjs';
import {randomBytes} from 'node:crypto';
import {priceProduct} from './price-routes.mjs';
import {sponsorPagePath} from './sponsor-tracking.mjs';
import {loadSponsorReferencePrice} from './sponsor-reference-price.mjs';
import {reviewedSponsorDestination} from './sponsor-destinations.mjs';
export function sponsorDirectory(db){return buildProductDirectory(['direct-shops','ldxp-goods'].map(source=>{
 const latest=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);if(!latest)return null;
 const offers=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=?').all(source,latest.snapshot_id),groups=new Map();for(const o of offers){if(!publicOfferAllowed(source,o))continue;if(!groups.has(o.product_id))groups.set(o.product_id,[]);groups.get(o.product_id).push(o)}
 const products=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(source,latest.snapshot_id).map(p=>projectProduct(db,source,latest,p,{offers:groups.get(p.product_id)||[]}));return {source,snapshotId:latest.snapshot_id,fetchedAt:latest.fetched_at,products};
 }).filter(Boolean));}
export function sponsorEntries(directory){return directory.flatMap(category=>category.products.flatMap(product=>(product.quoteEntries||product.entries||[]).filter(e=>!e.reference).map(e=>({...e,categoryKey:category.key,categoryLabel:category.label,pageKey:product.key,pageLabel:product.name}))));}
export const sponsorOfferKey=e=>Buffer.from(JSON.stringify([e.list.source,e.product.product_id,e.offer.offer_id])).toString('base64url');
export function resolveSponsorChoice(db,key){
 let parts;try{if(typeof key!=='string'||key.length>2000)throw Error();parts=JSON.parse(Buffer.from(key,'base64url').toString());if(!Array.isArray(parts)||parts.length!==3||parts.some(v=>typeof v!=='string'||!v||v.length>250))throw Error();}catch{throw sponsorError('请从当前已收录报价中选择商家');}
 const entry=sponsorEntries(sponsorDirectory(db)).find(e=>e.list.source===parts[0]&&e.product.product_id===parts[1]&&e.offer.offer_id===parts[2]);
 const row=entry&&resolveOutboundOffer(db,{source:parts[0],snapshot:entry.list.snapshotId,product:parts[1],offer:parts[2]});
 if(!row||!row.merchant_id.startsWith('domain:'))throw sponsorError('报价不可用或店铺归属尚未核实；请先完成收录与身份核验');
 return {entry,row};
}
export function sponsorScope(entry,placement){const plan=sponsorPlan(placement);if(!plan)throw sponsorError('广告位置无效');return {placement:plan.placement,page_key:plan.key==='home'?'home':plan.key==='category'?entry.categoryKey:entry.pageKey,page_label:plan.key==='home'?'首页':plan.key==='category'?entry.categoryLabel:entry.pageLabel};}
export function saveAdminSponsor(db,analytics,fields,actor,now=new Date()){
 if(!analytics?.outbound)throw sponsorError('广告统计服务未配置',503);
 if(fields.action==='pause')return analytics.outbound.setCampaignStatus(fields.id,'paused',{version:Number(fields.version),actor,now});
 if(!['save','approve'].includes(fields.action))throw sponsorError('操作无效');
 let row,scope;
 const kind=fields.campaign_kind||'quote';
 if(kind==='website'){
  const destination=safeMerchantUrl(fields.destination_url),merchant_id=destination&&(reviewedSponsorDestination(destination)?.merchantId||merchantIdForUrl(destination));
  if(!merchant_id||!merchant_id.startsWith('domain:'))throw sponsorError('请填写有效的 HTTPS 官网地址');
  const plan=sponsorPlan(fields.placement);
  if(!['home','category','product'].includes(plan?.key))throw sponsorError('请选择有效的广告位置');
  const category=plan.key==='category'&&DIRECTORY_CATEGORIES.find(c=>c.key===fields.category_key);
  if(plan.key==='category'&&!category)throw sponsorError('请选择有效的投放分类');
  const product=plan.key==='product'&&priceProduct(fields.product_key);
  if(plan.key==='product'&&!product)throw sponsorError('请选择有效的投放产品');
  row={merchant_id,source:WEBSITE_SPONSOR_SOURCE,product_id:'website',offer_id:merchant_id.slice(7),destination_url:destination};
  scope=product?{placement:plan.placement,page_key:product.key,page_label:product.name}:category?{placement:plan.placement,page_key:category.key,page_label:category.label}:{placement:plan.placement,page_key:'home',page_label:'首页'};
 }else if(kind==='quote'){
  const previous=fields.id&&analytics.outbound.listCampaigns().find(c=>c.id===fields.id);
  const previousKey=previous&&Buffer.from(JSON.stringify([previous.source,previous.product_id,previous.offer_id])).toString('base64url');
  // Editing approved creative must remain possible while its SKU is sold out.
  if(previous&&quoteSponsorOffer(previous)&&fields.offer_key===previousKey&&sponsorPlan(fields.placement)?.placement===previous.placement){
   row={...quoteSponsorOffer(previous),destination_url:previous.destination_url};
   scope={placement:previous.placement,page_key:previous.page_key,page_label:previous.page_label};
  }else{
   const choice=resolveSponsorChoice(db,fields.offer_key);row={...choice.row,destination_url:choice.row.destination};scope=sponsorScope(choice.entry,fields.placement);
  }
 }else throw sponsorError('广告类型无效');
 if(fields.action==='approve'&&fields.reviewed!=='true')throw sponsorError('请确认已核对商家、素材、费用和档期');
 const parse=value=>{if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value||''))throw sponsorError('请填写北京时间的起止时间');return new Date(value+':00+08:00').toISOString()};
 if(!/^\d{1,7}$/.test(fields.amount_cny||''))throw sponsorError('请填写整数人民币金额');
 return analytics.outbound.saveCampaign({id:fields.id||'SP-'+randomBytes(10).toString('hex'),version:Number(fields.version||0),merchant_id:row.merchant_id,source:row.source,product_id:row.product_id,offer_id:row.offer_id,destination_url:row.destination_url||'',label:fields.label,...scope,start_at:parse(fields.start_at),end_at:parse(fields.end_at),amount_cny:Number(fields.amount_cny),note:fields.note||'',theme:fields.theme||'amber',headline:fields.headline||'',tagline:fields.tagline||''},{approve:fields.action==='approve',actor,now});
}
export function sponsorItems(entries,analytics,{placement,pageKey,db,date=new Date(),requestPath=''}={}){
 if(!analytics?.outbound)return [];
 const items=[],seen=new Set();
 for(const c of analytics.outbound.activeCampaigns(date)){
  if(c.placement!==placement)continue;
  if(c.source===WEBSITE_SPONSOR_SOURCE||c.destination_url){
   const row=c.source===WEBSITE_SPONSOR_SOURCE?websiteSponsorOffer(c):quoteSponsorOffer(c);if(!row||c.page_key!==pageKey||seen.has(c.merchant_id))continue;
   const viewToken=analytics.outbound.viewToken(c,date,sponsorPagePath(requestPath,c));
   const href=outboundHref(row,{}, {placement,campaignId:c.id,trackingToken:viewToken});if(!href)continue;
   seen.add(c.merchant_id);items.push({campaign:c,offer:row,href,referencePrice:loadSponsorReferencePrice(db,c,{now:date.getTime()}),viewToken});if(items.length===4)break;
   continue;
  }
  const e=entries.find(e=>e.list.source===c.source&&e.product.product_id===c.product_id&&e.offer.offer_id===c.offer_id);if(!e)continue;
  const scope=sponsorScope(e,placement),legacy=c.page_key===c.source+'/'+c.product_id||!c.page_key;
  if(scope.page_key!==pageKey||(!legacy&&c.page_key!==pageKey)||legacy&&placement!=='sponsored_product')continue;
  const row=resolveOutboundOffer(db,{source:e.list.source,snapshot:e.list.snapshotId,product:e.product.product_id,offer:e.offer.offer_id},date.getTime());if(!row||row.merchant_id!==c.merchant_id||seen.has(c.merchant_id))continue;
  const viewToken=analytics.outbound.viewToken(c,date,sponsorPagePath(requestPath,c));
   const href=outboundHref(row,{}, {placement,campaignId:c.id,trackingToken:viewToken});if(!href)continue;
  seen.add(c.merchant_id);items.push({campaign:c,offer:row,href,referencePrice:loadSponsorReferencePrice(db,{...c,destination_url:row.url},{now:date.getTime()}),viewToken});if(items.length===4)break;
 }
 return items;
}
export function migrateSponsorScopes(db,analytics){
 if(!analytics?.db)return;const rows=analytics.db.prepare("SELECT * FROM campaigns WHERE page_key='' OR page_key=source||'/'||product_id").all();if(!rows.length)return;
 const entries=sponsorEntries(sponsorDirectory(db));for(const c of rows){if(!sponsorPlan(c.placement))continue;const e=entries.find(e=>e.list.source===c.source&&e.product.product_id===c.product_id&&e.offer.offer_id===c.offer_id);if(e){const scope=sponsorScope(e,c.placement);analytics.db.prepare('UPDATE campaigns SET page_key=?,page_label=? WHERE id=?').run(scope.page_key,scope.page_label,c.id)}}
}
