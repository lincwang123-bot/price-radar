import {projectProduct} from './quote-policy.mjs';
import {publicOfferAllowed} from './public-offers.mjs';
import {buildProductDirectory} from './product-directory.mjs';
import {resolveOutboundOffer,outboundHref} from './outbound.mjs';
import {sponsorPlan,sponsorError} from './sponsor-plans.mjs';
import {randomBytes} from 'node:crypto';
export function sponsorDirectory(db){return buildProductDirectory(['direct-shops','priceai','ldxp-goods','goaihop-relay'].map(source=>{
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
 const {entry,row}=resolveSponsorChoice(db,fields.offer_key),scope=sponsorScope(entry,fields.placement);
 if(fields.action==='approve'&&fields.reviewed!=='true')throw sponsorError('请确认已核对商家、素材、费用和档期');
 const parse=value=>{if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value||''))throw sponsorError('请填写北京时间的起止时间');return new Date(value+':00+08:00').toISOString()};
 if(!/^\d{1,7}$/.test(fields.amount_cny||''))throw sponsorError('请填写整数人民币金额');
 return analytics.outbound.saveCampaign({id:fields.id||'SP-'+randomBytes(10).toString('hex'),version:Number(fields.version||0),merchant_id:row.merchant_id,source:row.source,product_id:row.product_id,offer_id:row.offer_id,label:fields.label,...scope,start_at:parse(fields.start_at),end_at:parse(fields.end_at),amount_cny:Number(fields.amount_cny),note:fields.note||'',theme:fields.theme||'amber',headline:fields.headline||'',tagline:fields.tagline||''},{approve:fields.action==='approve',actor,now});
}
export function sponsorItems(entries,analytics,{placement,pageKey,db,date=new Date()}={}){
 if(!analytics?.outbound)return [];
 const items=[],seen=new Set();
 for(const c of analytics.outbound.activeCampaigns(date)){
  if(c.placement!==placement)continue;
  const e=entries.find(e=>e.list.source===c.source&&e.product.product_id===c.product_id&&e.offer.offer_id===c.offer_id);if(!e)continue;
  const scope=sponsorScope(e,placement),legacy=c.page_key===c.source+'/'+c.product_id||!c.page_key;
  if(scope.page_key!==pageKey||(!legacy&&c.page_key!==pageKey)||legacy&&placement!=='sponsored_product')continue;
  const row=resolveOutboundOffer(db,{source:e.list.source,snapshot:e.list.snapshotId,product:e.product.product_id,offer:e.offer.offer_id},date.getTime());if(!row||row.merchant_id!==c.merchant_id||seen.has(c.merchant_id))continue;
  const href=outboundHref(row,{}, {placement,campaignId:c.id});if(!href)continue;
  seen.add(c.merchant_id);items.push({campaign:c,offer:row,href,viewToken:analytics.outbound.viewToken(c,date)});if(items.length===4)break;
 }
 return items;
}
export function migrateSponsorScopes(db,analytics){
 if(!analytics?.db)return;const rows=analytics.db.prepare("SELECT * FROM campaigns WHERE page_key='' OR page_key=source||'/'||product_id").all();if(!rows.length)return;
 const entries=sponsorEntries(sponsorDirectory(db));for(const c of rows){const e=entries.find(e=>e.list.source===c.source&&e.product.product_id===c.product_id&&e.offer.offer_id===c.offer_id);if(e){const scope=sponsorScope(e,c.placement);analytics.db.prepare('UPDATE campaigns SET page_key=?,page_label=? WHERE id=?').run(scope.page_key,scope.page_label,c.id)}}
}
