import test from 'node:test';
import assert from 'node:assert/strict';
import { directOfferExclusionReason, groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { parse16688Goods, PLATFORM16688_SHOPS } from '../collectors/direct/platform16688.mjs';
import { summarizeMerchantOffers } from '../lib/merchant-quote-preview.mjs';
import { publicOfferAllowed } from '../lib/public-offers.mjs';

const row = description => ({ title:'Gemini 18个月激活链接 无需绑卡', status:'in_stock', extra:{deliveryEvidence:{descriptionScope:'sku',skuTitle:'激活链接',description}} });
const description = '卡密质保24小时，购买后请于24小时内兑换超时无质保无售后！！！卡密兑换后1小时内激活。超时无质保无售后！！！仅售后24小时内卡密无法兑换或者兑换的链接1h内显示需要新的激活链接。有问题请联系客服。';

test('finite warranty expiry disclaimers retain an eligible Gemini activation link through the public preview', () => {
  const target = PLATFORM16688_SHOPS.find(t => t.shopNo === 'S311799');
  const rows = parse16688Goods({code:1,data:{list:[{
    goods_no:'G51084823', name:'Gemini 18个月激活链接 无需绑卡 直接激活', price:5.6,
    stock_available_quantity:52, stock_available_status:'high', description,
  }]}}, target, new Date().toISOString());
  assert.equal(rows.length,1);
  assert.equal(groupDirectOffers(rows)[0].productId,'gemini-claim-link');
  assert.equal(publicOfferAllowed('direct-shops',rows[0]),true);
  assert.match(rows[0].extra.deliveryEvidence.description,/超时无质保无售后/,'original conditions must remain intact');
  const preview = summarizeMerchantOffers(rows);
  assert.equal(preview.validCount,1);
  assert.equal(preview.samples[0].price,5.6);
  assert.equal(preview.samples[0].url,'https://www.16688.com.cn/goods/G51084823');
});

test('only explicit finite warranty admits a bounded expiry clause, including stored evidence',()=>{
  for(const text of [description,'质保7天，逾期不售后','30天质保；超过30天不予售后','質保24小时，超时無質保無售後']){
    for(const stringify of [false,true]){
      const offer=row(text);if(stringify)offer.extra=JSON.stringify(offer.extra);
      assert.equal(directOfferExclusionReason(offer),null,text);
    }
  }
});

test('expiry exception cannot hide whole-product disclaimers or invent warranty from other SKU evidence',()=>{
  for(const text of [
    '超时无质保无售后','质保首登，超时无售后','质保0小时，超时无售后',
    description+'。本商品无售后', '质保24小时，超时无质保。本商品不提供售后',
    '质保24小时。超时请联系客服。本商品无售后','无质保24小时，超时无售后',
    '质保24小时，超时无质保，任何问题无售后',
  ])assert.equal(directOfferExclusionReason(row(text)),'no_warranty',text);
  const offer=row('质保24小时');offer.title='Gemini 激活链接 超时无售后';
  offer.extra.deliveryEvidence.descriptionScope='product_multi';
  assert.equal(directOfferExclusionReason(offer),'no_warranty');
  assert.equal(directOfferExclusionReason({...row(description),stockCount:0}),'out_of_stock');
});
