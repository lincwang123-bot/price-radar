// Catalog prices remain the default basis. A payment-fee-inclusive reference applies
// only to the observed payment method and quantity, never every checkout path.
export const MERCHANT_FEE_NOTICE_ZH='默认按商品标价比较全部报价；可切换为按含手续费价比较，仅显示手续费已确认的报价。含手续费参考价基于查询时的支付方式、单件数量及自动优惠，不使用优惠码；其他支付方式可能不同，最终实付以店铺结算页为准。';
export const MERCHANT_FEE_NOTICE_EN='Compare all listed product prices by default, or switch to payment-fee-inclusive prices for quotes with confirmed fees only. Payment-fee-inclusive references use the queried payment method, one item and automatic discounts, without a coupon code. Other payment methods may differ; confirm the final total at merchant checkout.';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(value,currency='CNY')=>(currency==='CNY'?'¥':currency+' ')+Number(value).toFixed(2);

export function checkoutPriceLabel(offer){
 return offer?.price_basis==='checkout'&&offer.checkout_status==='verified'&&offer.checkout_quote?'含手续费参考价':'商品标价';
}
export function checkoutPriceDetailsHtml(offer,{compact=false}={}){
 const quote=offer?.checkout_status==='verified'&&offer.checkout_quote;
 const label='<span class="checkout-price-label">'+checkoutPriceLabel(offer)+'</span>';
 if(compact)return '<div class="note checkout-price-detail" data-checkout-status="'+(quote?'verified':'unknown')+'">'+label+'</div>';
 if(!quote)return '<div class="note checkout-price-detail" data-checkout-status="unknown">'+label+'<span>手续费待确认</span></div>';
 const currency=quote.currency||offer.currency||'CNY';
 const line=(label,value)=>'<span>'+label+'</span> <span>'+esc(money(value,currency))+'</span>';
 const time=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(quote.capturedAt));
 const reference=offer.price_basis==='checkout'?'':'<div class="checkout-reference">'+line('含手续费参考价',quote.totalAmount)+'</div>';
 return '<div class="note checkout-price-detail" data-checkout-status="verified">'+label+reference+'<details><summary>费用明细与支付口径</summary><div><span>查询口径：支付宝 · 单件 · 不使用优惠码</span></div><div>'+line('商品标价',quote.listedPrice)+' · '+line('手续费',quote.feeAmount)+(quote.discountAmount>0?' · '+line('自动优惠 −',quote.discountAmount):'')+'</div><div><span>费用查询时间：</span><time datetime="'+esc(quote.capturedAt)+'">'+esc(time)+'</time><span>（北京时间）</span></div></details></div>';
}
export function checkoutCohortHeading(currency,_offer,{tag='h2'}={}){
 return '<'+tag+' class="quote-currency">'+esc(currency)+' 报价</'+tag+'>';
}

export function merchantFeeNoticeHtml(){
 return '<p class="note quote-fee-notice" data-quote-fee-notice><strong>费用说明：</strong><span>'+MERCHANT_FEE_NOTICE_ZH+'</span></p>';
}
