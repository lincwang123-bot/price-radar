import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFLIGHT_REASON_CODES, classifyPreflightError, preflightGuidance, listPreflightGuidance } from '../lib/merchant-preflight-guidance.mjs';

const application = { shopName: '真实样例店', shopUrl: 'https://merchant-shop.com/', contact: 'private-contact', id: 'MA-private-id', details: 'secret-material' };
test('每个原因都有可直接发店主的中文文案，且不包含私密申请字段', () => {
  const rows = listPreflightGuidance(application);
  assert.deepEqual(rows.map(row => row.code), [...PREFLIGHT_REASON_CODES, 'legacy_unknown']);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['code', 'explanation', 'merchantMessage', 'nextStep', 'requiresOperator', 'title']);
    for (const field of ['title', 'explanation', 'nextStep', 'merchantMessage']) assert.ok(row[field].length > 5, `${row.code}.${field}`);
    assert.match(row.merchantMessage, /真实样例店/); assert.match(row.merchantMessage, /https:\/\/merchant-shop.com/);
    assert.match(row.merchantMessage, /不需要.*密码.*私钥.*API Key/);
    assert.doesNotMatch(JSON.stringify(row), /private-contact|MA-private-id|secret-material/);
    assert.equal(typeof row.requiresOperator, 'boolean');
  }
});
test('旧失败不看历史message推断WAF；过期结果不继续给成功指引', () => {
  const legacy = preflightGuidance({ status: 'unavailable', result: { status: 'unavailable', message: 'WAF captcha secret-message' } }, application);
  assert.equal(legacy.code, 'legacy_unknown'); assert.match(legacy.explanation, /历史测试未记录具体原因，请重新测试/);
  assert.doesNotMatch(JSON.stringify(legacy), /secret-message|WAF/);
  assert.equal(preflightGuidance({ status: 'expired', result: { status: 'ready' } }, application).code, 'expired');
  const denied = preflightGuidance({ status: 'unavailable', result: { status: 'unavailable', reasonCode: 'access_denied', httpStatus: 200 } }, application);
  assert.equal(denied.code, 'access_denied'); assert.doesNotMatch(denied.merchantMessage, /店铺无法打开|店铺打不开/);
  const internal = preflightGuidance({ status: 'unavailable', reasonCode: 'internal_error' }, application);
  assert.equal(internal.requiresOperator, true); assert.match(internal.merchantMessage, /我们.*处理/);
  assert.match(internal.explanation, /测试服务或连接配置发生异常/);
  assert.match(internal.merchantMessage, /测试服务或连接配置发生异常/);
});
test('原因判断不使用不可信错误文本；上下文不带凭据、查询、内部ID或共享平台token', () => {
  assert.deepEqual(classifyPreflightError(new Error('WAF timeout DNS secret')), { reasonCode: 'unknown' });
  assert.equal(classifyPreflightError(Object.assign(new Error('secret'), { cause: { code: 'ENOTFOUND' } })).reasonCode, 'dns_error');
  const row = listPreflightGuidance({ ...application, shopUrl: 'https://wzyp.cn/shop/private-token?key=private-query#secret-fragment' })[0];
  assert.doesNotMatch(JSON.stringify(row), /private-token|private-query|secret-fragment/);
  const bad = listPreflightGuidance({ shopName: '店 secret@example.com https://evil.com/?token=secret 10.0.0.1', shopUrl: 'https://user:private@merchant-shop.com/?token=secret' });
  assert.doesNotMatch(JSON.stringify(bad), /secret@|evil.com|10\.0\.0\.1|user:private|token=secret/);
});

test('保留真实店铺完整公开路径，不把共享平台首页冒称店铺主页', () => {
  for (const shopUrl of ['https://wzyp.cn/shop/aiplus666', 'https://www.16688.com.cn/shop/S123456', 'https://merchant-shop.com/store/products/']) {
    assert.ok(preflightGuidance(null, { ...application, shopUrl }).merchantMessage.includes(shopUrl));
  }
  for (const shopUrl of ['https://wzyp.cn/', 'https://www.16688.com.cn/item/123', 'https://merchant-shop.com/?token=secret',
    'https://merchant-shop.com/#secret', 'https://user:pass@merchant-shop.com/', 'javascript:alert(1)', 'https://127.0.0.1/',
    'https://metadata.google.internal/', 'https://merchant-shop.com/%3Ftoken%3Dsecret']) {
    assert.doesNotMatch(preflightGuidance(null, { ...application, shopUrl }).merchantMessage, /主页：/);
  }
});
test('真实固定适配器错误有明确原因，中间代理认证由站方处理', () => {
  const checks = [
    ['AikaShop robots不再明确允许目录读取', 'robots_disallowed'], ['Aichong robots 不再明确允许目录读取', 'robots_disallowed'],
    ['Dujiao pagination 格式无效', 'invalid_catalog'], ['Dujiao pagination.page 不匹配：请求 1，返回 2', 'invalid_catalog'],
    ['ShopApi 分类返回失败 code: secret', 'invalid_catalog'], ['ShopApi 未返回可用公开分类', 'invalid_catalog'],
    ['Mooncake 目录 JSON 解析失败: secret', 'invalid_catalog'], ['IkunLove 响应标记为失败', 'invalid_catalog'],
    ['Aichong 目标未登记', 'internal_error'], ['AikaShop目标未登记', 'internal_error'],
  ];
  for (const [message, code] of checks) assert.equal(classifyPreflightError(new Error(message)).reasonCode, code, message);
  assert.equal(classifyPreflightError(Object.assign(new Error('secret'), { status: 407, code: 'ACCESS_DENIED' })).reasonCode, 'internal_error');
});

test('ShopApi 四条实际分类错误精确归类，不匹配相似商家文本', () => {
  const fixtures = [
    ['ShopApi 分类响应格式无效：缺少 data 数组', 'invalid_catalog'],
    ['ShopApi 分类返回失败 code: 0', 'invalid_catalog'],
    ['ShopApi 未返回可用公开分类', 'invalid_catalog'],
    ['ShopApi 分类未完整：达到 maxCategories', 'collector_limit'],
  ];
  for (const [message, reasonCode] of fixtures) assert.deepEqual(classifyPreflightError(new Error(message)), { reasonCode });
  for (const message of ['商家备注：ShopApi 分类响应格式无效：缺少 data 数组', 'ShopApi 分类响应格式无效：商家自定义内容',
    'ShopApi 未返回可用公开分类 secret', 'ShopApi 分类未完整：其他商家信息', 'ShopApi 分类未完整：达到 maxCategories secret']) {
    assert.deepEqual(classifyPreflightError(new Error(message)), { reasonCode: 'unknown' }, message);
  }
});
