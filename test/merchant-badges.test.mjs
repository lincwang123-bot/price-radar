import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantBadgeForOffer,merchantApplicationHref,MERCHANT_BADGE_CSS} from '../lib/merchant-badges.mjs';

const approved=[{identity:'domain:shop.example.com',identityVerifiedAt:'2026-09-07T00:00:00Z'},
 {identity:'shop:16688:S123',identityVerifiedAt:'2026-09-07T00:00:00Z'}];
test('listing badges have compact green styling that overrides generic offer metadata',()=>{
 assert.match(MERCHANT_BADGE_CSS,/\.offer-title \.merchant-verified/);
 assert.match(MERCHANT_BADGE_CSS,/background:#ecfdf3/);
 assert.match(MERCHANT_BADGE_CSS,/color:#16713a/);
 assert.match(MERCHANT_BADGE_CSS,/white-space:nowrap/);
});
test('listing badge is neutral, exact-host, and revoked with approval',()=>{
 const offer={source:'direct-shops',url:'https://shop.example.com/buy/1'};
 assert.match(merchantBadgeForOffer(offer,approved),/>店铺已收录<\/span>/);
 assert.match(merchantBadgeForOffer(offer,approved),/仅表示店铺信息已收录，不代表商家信用、商品质量或交易安全保证/);
 assert.doesNotMatch(merchantBadgeForOffer(offer,approved),/店主已核验|身份|已认证|商家直连|Sponsored|保真|安全商家/);
 assert.equal(merchantBadgeForOffer(offer,[]),'');
 assert.equal(merchantBadgeForOffer({...offer,url:'https://other.shop.example.com/buy'},approved),'');
});
test('shared-platform badge binds original collector shop identity, never domain or payload claims',()=>{
 const offer={source:'direct-shops',url:'https://www.16688.com.cn/goods/G111',extra:JSON.stringify({shopNo:'S123',shopUrl:'https://www.16688.com.cn/shop/S123'})};
 assert.match(merchantBadgeForOffer(offer,approved),/店铺已收录/);
 assert.equal(merchantBadgeForOffer({...offer,extra:JSON.stringify({shopNo:'S456'})},approved),'');
 assert.equal(merchantBadgeForOffer({...offer,source:'priceai'},approved),'');
 assert.equal(merchantBadgeForOffer({...offer,extra:'invalid'},approved),'');
 assert.equal(merchantBadgeForOffer({...offer,url:'https://wzyp.cn/other',extra:JSON.stringify({merchantIdentity:'shop:16688:S123'})},approved),'');
});
