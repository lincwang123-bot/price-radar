// Public checkout estimates are a separate observation from catalog prices.
// Never overwrite stored prices or silently change historical/alert baselines.
export const CHECKOUT_MAX_AGE_MS=2*60*60*1000;
const endpoint='https://www.16688.com.cn/shopApi/payment/quotePrice';
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value||{};}catch{return {};}};
const cents=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100_000_000&&Math.abs(value*100-Math.round(value*100))<0.000001?Math.round(value*100):null;

export function checkoutQuote(offer,{now=Date.now()}={}) {
 if(!offer||offer.source&&offer.source!=='direct-shops'||offer.quote_stale||offer.quote_retained)return null;
 const extra=parse(offer.extra),q=extra.checkoutQuote;
 if(!q||q.version!==1||q.status!=='verified'||q.source!=='16688'||q.currency!=='CNY'||offer.currency!=='CNY'||q.quantity!==1||q.paymentMethod!=='alipay'||typeof q.paymentChannelId!=='string'||!/^\d{1,12}$/.test(q.paymentChannelId)||q.pricingUrl!==endpoint)return null;
 if(!/^S\d{1,20}$/.test(q.shopNo)||(extra.resolvedShopNo??extra.shopNo)!==q.shopNo||!/^G\d{1,20}$/.test(q.goodsNo))return null;
 try{const url=new URL(offer.url);if(url.protocol!=='https:'||!['www.16688.com.cn','16688.com.cn'].includes(url.hostname)||url.port||url.username||url.password||url.pathname!=='/goods/'+q.goodsNo||url.search||url.hash)return null;}catch{return null;}
 const listed=cents(offer.listed_price??offer.price),unit=cents(q.listedPrice),goods=cents(q.goodsAmount),discount=cents(q.discountAmount),fee=cents(q.feeAmount),total=cents(q.totalAmount);
 if([listed,unit,goods,discount,fee,total].some(v=>v===null)||listed<=0||unit!==listed||goods!==listed||discount>goods||total<=0||goods-discount+fee!==total)return null;
 const checked=Date.parse(q.capturedAt);
 // An unchanged catalog price may reuse a still-fresh checkout observation.
 // Its own timestamp/expiry never advances merely because the catalog refreshed.
 if(!Number.isFinite(now)||!Number.isFinite(checked)||checked>now+300000||checked+CHECKOUT_MAX_AGE_MS<=now)return null;
 // Return only validated fields. Merchant strings are not payment labels or HTML.
 return {version:1,status:'verified',source:'16688',currency:'CNY',quantity:1,paymentMethod:'alipay',paymentChannelId:q.paymentChannelId,paymentLabel:'支付宝',shopNo:q.shopNo,goodsNo:q.goodsNo,
  listedPrice:listed/100,goodsAmount:goods/100,discountAmount:discount/100,feeAmount:fee/100,totalAmount:total/100,capturedAt:new Date(checked).toISOString(),expiresAt:new Date(checked+CHECKOUT_MAX_AGE_MS).toISOString(),pricingUrl:endpoint};
}

export function projectCheckoutPrice(offer,options={}) {
 const q=checkoutQuote(offer,options),listed=offer.listed_price??offer.price;
 const includeFee=options.priceBasis==='checkout'&&!!q;
 return {...offer,listed_price:listed,price:includeFee?q.totalAmount:listed,price_basis:includeFee?'checkout':'listed',checkout_quote:q,checkout_status:q?'verified':'unknown'};
}

export function compareCheckoutPrices(a,b,{descending=false}={}) {
 // Fee coverage is never a ranking advantage. The request-scoped projection
 // determines the amount; checkout-only views exclude unknown fees upstream.
 return (Number(a.price)-Number(b.price))*(descending?-1:1);
}
