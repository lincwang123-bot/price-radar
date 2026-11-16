import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantIdentityForOffer} from '../lib/merchant-identity.mjs';
import {shopDescriptorForOffer,shopPublicId} from '../lib/merchant-x.mjs';
import {merchantReviewHref} from '../lib/merchant-x-ui.mjs';
const offer={source:'ldxp-goods',url:'https://wzyp.cn/item/ehu1m7',store_name:'G_plus_批发',extra:{upstreamSourceName:'G_plus_批发'}};
test('原站商品归属证据让链动报价关联到正确店铺，并打开同一店铺评价',()=>{
 const shop=shopDescriptorForOffer(offer);
 assert.ok(shop);assert.equal(shop.identity,'shop:wzyp:xiamai');assert.equal(shop.url,'https://wzyp.cn/shop/xiamai');
 assert.equal(merchantReviewHref(offer),'/shop?id='+shopPublicId('shop:wzyp:xiamai')+'#reviews');
 const direct=shopDescriptorForOffer({...offer,source:'direct-shops',extra:{shopUrl:'https://wzyp.cn/shop/xiamai'}});
 assert.equal(shop.id,direct.id);
});
test('不同商品、伪造店名或上游 shopUrl 不得套用已确认的商品归属',()=>{
 for(const url of ['https://wzyp.cn/item/other','https://wzyp.cn/item/ehu1m7/extra','http://wzyp.cn/item/ehu1m7','https://wzyp.cn/item/ehu1m7?shop=other'])assert.equal(merchantIdentityForOffer({...offer,url,extra:{shopUrl:'https://wzyp.cn/shop/xiamai'}}),null);
 assert.equal(merchantIdentityForOffer({...offer,url:'https://wzyp.cn/item/other',store_name:'G_plus_批发'}),null);
 assert.equal(merchantIdentityForOffer({...offer,source:'direct-shops',extra:{shopUrl:'https://wzyp.cn/shop/other'}}),'shop:wzyp:other','current direct evidence takes precedence');
});
