import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';
import { buildProductDirectory, directoryQuotes } from '../lib/product-directory.mjs';
import { offerSpec } from '../lib/offer-spec.mjs';

const free = 'codex free已接短信 家宽注册1号1家宽出口，注册和短信为同一地区 2fa 支持网页/codex/少量带plus试用';
const leonardo = 'Leonardo 8500分成品号 (不支持sd和H3，有image2，gemini2图片模型)-带cookie';
const quotaReset = 'Codex周额度重置 联系客服确认账号是否资格 加V：DBS0234 享plus会员 pro会员底价';

test('referral adverts, notices and invitation discounts are not retail subscriptions', () => {
  for (const title of ['推广赚10%可提现返利｜Codex验证码接马｜G Plus接马｜低至0.5元', '邀请推广返利可提现 Codex接马', '接马推广 可提现返利', 'codex api 更变', 'Cursor ultra半价邀请链接']) {
    assert.equal(classifyDirectOffer({ title }), null, title);
  }
  assert.equal(classifyDirectOffer({ title: '推广优惠 Codex验证码接马 单次' })?.id, 'verification-service');
  assert.equal(classifyDirectOffer({ title: 'ChatGPT Plus 月卡 推广优惠' })?.id, 'chatgpt-plus-recharge');
  for (const title of ['API Cursor Pro 2600 积分 1 个月全保', 'API Cursor Pro 6500积分', 'API Cursor Pro 每天400积分']) {
    assert.equal(classifyDirectOffer({ title })?.id, 'api-cdk-credits', title);
  }
  assert.equal(classifyDirectOffer({ title: 'Cursor Pro 1个月账号 全保' })?.id, 'cursor-pro-1m');
  for (const title of ['Cursor Pro 1个月账号 全保（不含API额度）', 'Cursor Pro 月卡 附API配置教程']) {
    assert.equal(classifyDirectOffer({ title })?.id, 'cursor-pro-1m', title);
  }
});

test('quota reset services are not subscriptions while actual monthly packages retain reset descriptions', () => {
  for (const title of [quotaReset, 'Codex Plus 账号额度恢复服务', 'ChatGPT Plus 周额度重置服务 联系客服']) {
    assert.equal(classifyDirectOffer({ title }), null, title);
  }
  for (const title of ['ChatGPT Plus 月卡 每周额度重置', 'ChatGPT Plus 1个月订阅 周额度自动恢复', 'ChatGPT Plus 月卡 额度重置时间请联系客服确认']) {
    assert.equal(classifyDirectOffer({ title })?.id, 'chatgpt-plus-recharge', title);
  }
});

test('free accounts with uncertain paid extras and Leonardo models are not paid subscriptions', () => {
  for (const title of [free, 'Codex Free账号 随机附带Plus试用', 'ChatGPT免费账号 概率带Plus', 'Codex free账号 不保证Plus权益', 'Codex账号 不含Plus', leonardo]) {
    assert.equal(classifyDirectOffer({ title }), null, title);
  }
  for (const title of ['【质保一个月】G Plus网页镜像', '【质保三个月】G Plus网页镜像', '【质保一个月】Claude网页镜像']) {
    assert.equal(classifyDirectOffer({ title })?.id, 'api-cdk-credits');
  }
  for (const title of ['ChatGPT Plus 7天 日抛 成品号', 'ChatGPT Plus 合租 月卡', 'pixel Gemini 3个月 pro 成品号（随机地区，22-25年账号）']) {
    assert.ok(classifyDirectOffer({ title }), title);
  }
  const title = 'ChatGPT Plus 7天 日抛 成品号';
  assert.match(offerSpec({ title, currency: 'CNY' }, classifyDirectOffer({ title })).key, /^7d:plus:成品账号:试用\/短期:/);
  assert.equal(classifyDirectOffer({ title: 'codex api 10刀卡（无free号）' })?.id, 'api-cdk-credits');
  assert.doesNotMatch(classifyDirectOffer({ title: 'Plus试用资格free号未接马，iC邮箱 发货格式：邮箱-密码-2FA-取件URL-AT' })?.id ?? '', /chatgpt-plus/);
});

test('legacy Plus mirror product ID projects to development services, not Plus minimum', () => {
  const directory = buildProductDirectory([{ source: 'direct-shops', stale: false, products: [{ product_id: 'chatgpt-plus', offers: [{ title: '【质保一个月】G Plus网页镜像', offer_id: 'wzyp-harvey:9mcaxy', price: 50, currency: 'CNY', status: 'in_stock', stock_count: 1, url: 'https://harvey.wzyp.vip/buy/9mcaxy' }] }] }]);
  const shown = directory.flatMap(row => row.products.flatMap(product => directoryQuotes(product).entries.map(() => product.key)));
  assert.deepEqual(shown, ['api-cdk-credits']);
});

test('old paid product IDs cannot restore uncertain freebies or Leonardo into paid directory minima', () => {
  for (const source of ['direct-shops', 'priceai', 'ldxp-goods']) {
    const products = [[free, 'chatgpt-plus'], [leonardo, 'gemini-pro-recharge'], [quotaReset, 'chatgpt-plus-recharge'],
      ['推广赚10%可提现返利｜Codex验证码接马｜G Plus接马｜低至0.5元', 'verification-service'],
      ['codex api 更变', 'api-cdk-credits'], ['Cursor ultra半价邀请链接', 'cursor-ultra'],
    ].map(([title, product_id]) => ({ product_id, name: product_id, offers: [{ title, offer_id: title, price: 0.6, currency: 'CNY', status: 'in_stock', stock_count: 1, url: 'https://www.16688.com.cn/goods/G88202399' }] }));
    const directory = buildProductDirectory([{ source, stale: false, products }]);
    assert.equal(directory.flatMap(row => row.products.flatMap(product => directoryQuotes(product).entries)).length, 0, source);
  }
});
