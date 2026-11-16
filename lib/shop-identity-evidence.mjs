// Site-owned evidence, not fields accepted from an aggregator or user form.
// Confirmed using the original public goodsInfo response AND goodsList membership.
// This maps an exact product URL to its shop, not the shop's display name.
const evidence=new Map([
 ['https://wzyp.cn/item/ehu1m7',Object.freeze({
  shopUrl:'https://wzyp.cn/shop/xiamai',shopName:'G_plus_批发',goodsKey:'ehu1m7',
  checkedOn:'2026-09-12',
  detailEndpoint:'https://wzyp.cn/shopApi/Shop/goodsInfo',
  catalogEndpoint:'https://wzyp.cn/shopApi/Shop/goodsList',
 })],
]);
export function verifiedShopEvidence(offer={}){
 if(offer.source!=='ldxp-goods')return null;
 try{
  const u=new URL(offer.url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
  return evidence.get(u.href)||null;
 }catch{return null;}
}
