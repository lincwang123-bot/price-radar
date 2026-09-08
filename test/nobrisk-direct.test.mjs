import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNobrisk, enrichNobriskOffer } from '../collectors/direct/nobrisk.mjs';
import { directTargets } from '../collectors/direct/registry.mjs';
import { groupDirectOffers, directOfferExclusionReason } from '../collectors/direct/catalog.mjs';
import { offerDelivery, offerSpec } from '../lib/offer-spec.mjs';

const target = directTargets(['nobrisk'])[0];
const name = 'ChatGPT Plus自助卡密一个月（ios渠道）';
const row = (id, title = name, category = 'AI工具') => ({ id, name: title, category: { name: category }, price: 130, user_price: 125, stock: 49, status: 1 });
const detail = (id = 2, title = name, extra = '') => `<script>setVar("_var_item",${JSON.stringify({id,name:title})});</script><h4>${title}</h4><div class="panel-body">其他区域提到共享，不是本商品说明</div><div class="panel mt-3 item-detail"><h6>宝贝详情</h6><div class="panel-body"><p>正规IOS充值，无需上号</p><p>常见封号原因：帐号共享，会造成封号</p><p>可以提前续费，会覆盖时间并非累计</p>${extra}</div></div></main>`;

test('BriskAI publishes subscription details and listed prices without misclassifying Apple ID or usage warnings', async () => {
  const requests = [];
  const offers = await collectNobrisk(target, { sleep: async () => {}, fetchImpl: async url => {
    requests.push(String(url));
    return String(url).includes('/commodity')
      ? new Response(JSON.stringify({ data: [row(2), row(5, 'APPLE ID 可订阅GPT', 'AppleID'), { ...row(32, 'claude成品普通号'), stock: 0 }], total: 3 }), { headers: { 'content-type': 'application/json' } })
      : new Response(detail(), { headers: { 'content-type': 'text/html' } });
  } });
  assert.deepEqual(requests.map(url => new URL(url).pathname), ['/user/api/index/commodity', '/item/2']);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].price, 130);
  assert.equal(offerDelivery(offers[0]).kind, 'recharge');
  assert.match(offers[0].extra.deliveryEvidence.description, /覆盖时间/);
  assert.match(offers[0].extra.publicDescription, /帐号共享/);
  assert.doesNotMatch(offers[0].extra.publicDescription, /其他区域/);
  assert.match(offerSpec(offers[0]).key, /^1m:plus:代充:/);
  assert.equal(groupDirectOffers(offers).flatMap(p => p.offers).length, 1);
});

test('BriskAI rejects a wrong product, missing details and unregistered targets', async () => {
  const offer = { offerId: 'nobrisk:2', title: name, category: 'AI工具', price: 130, listedPrice: 130 };
  assert.throws(() => enrichNobriskOffer(offer, detail(3)), /不一致/);
  assert.throws(() => enrichNobriskOffer(offer, detail(2, '另一个商品')), /不一致/);
  assert.throws(() => enrichNobriskOffer(offer, '<h4>登录</h4>'), /不一致/);
  await assert.rejects(collectNobrisk({ ...target, origin: 'https://example.com' }), /未登记/);
  assert.equal(directOfferExclusionReason(enrichNobriskOffer(offer, detail(2, name, '<p>无质保，不售后</p>'))), 'no_warranty');
});
