import {setTimeout as delay} from 'node:timers/promises';
import {collectKami} from './kami.mjs';
import {safeFetchJson,safeFetchText} from '../../lib/safe-fetch.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';

const ORIGIN='https://zhanghao66.com';
// This public Go product has different card/iOS channel prices. Quote the
// explicitly verified card channel; its catalogue base price is not an SKU.
const ITEM_ID='152';
const CATEGORY='卡充【不可覆盖】';
const invalid=()=>{throw Object.assign(new Error('账号66 商品渠道价格无法核验'),{code:'PRICE_EVIDENCE_MISMATCH'});};

export async function collectZhanghao66(target,options={}) {
  if(target?.id!=='zhanghao66'||target.origin!==ORIGIN||target.endpoint!=='/user/api/index/commodity')invalid();
  const offers=await collectKami(target,options);
  const index=offers.findIndex(o=>o.offerId===`${target.id}:${ITEM_ID}`&&o.status!=='out_of_stock');
  if(index<0)return offers;
  const offer=offers[index];
  const fetchOptions={allowedOrigins:[ORIGIN],fetchImpl:options.fetchImpl,timeoutMs:options.timeoutMs??15000,maxBytes:512*1024,maxRedirects:0};
  const wait=()=> (options.sleep??delay)(Math.max(500,Math.min(60000,Number(options.requestDelayMs)||500)));
  await wait();
  const html=await safeFetchText(offer.url,fetchOptions);
  let item;
  try {item=JSON.parse(html.match(/setVar\("_var_item",(\{[^\n]*?\})\);/)?.[1]);}catch{invalid();}
  const listedPrice=Number(item?.config?.category?.[CATEGORY]);
  if(String(item?.id)!==ITEM_ID||item.name!==offer.title||!Number.isFinite(listedPrice)||listedPrice<=0)invalid();
  await wait();
  // The storefront's read-only calculator uses race to select this channel.
  // No customer identity, account login, order creation or payment is involved.
  const value=await safeFetchJson(`${ORIGIN}/user/api/index/valuation`,{...fetchOptions,
    allowedMethods:['POST'],method:'POST',body:new URLSearchParams({item_id:ITEM_ID,num:'1',race:CATEGORY}).toString(),
    headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest',Referer:offer.url}});
  const price=Number(value?.data?.price);
  if(Number(value?.code)!==200||!Number.isFinite(price)||price<=0||Math.abs(price-listedPrice)>.000001)invalid();
  const title=`${offer.title} · ${CATEGORY}`;
  offers[index]={...offer,title,price,listedPrice,extra:{...offer.extra,catalogPrice:offer.price,selectedCategory:CATEGORY,
    priceEvidence:'所选卡充渠道公开价格与数量为1的游客计价一致；不使用目录基础价或批量价',
    deliveryEvidence:deliveryEvidence({productTitle:title,skuTitle:CATEGORY,category:offer.category,descriptionScope:'sku'})}};
  return offers;
}
