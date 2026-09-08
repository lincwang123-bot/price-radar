import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFLIGHT_REASON_CODES, classifyPreflightError, preflightGuidance, listPreflightGuidance, preflightAiPrompt } from '../lib/merchant-preflight-guidance.mjs';

const application = { shopName: '真实样例店', shopUrl: 'https://merchant-shop.com/', contact: 'private-contact', id: 'MA-private-id', details: 'secret-material' };
const failed=(reasonCode='invalid_catalog')=>({status:'unavailable',fresh:true,result:{status:'unavailable',reasonCode,checkedAt:'2026-09-08T15:50:42.000Z',rawCount:0,validCount:0,message:'raw-private-error'}});
test('AI 排查文案带当前目录问题、公开店铺与北京时间，提供可转发的交付要求',()=>{
 const prompt=preflightAiPrompt(failed(),application);
 for(const value of ['AIradar','真实样例店','https://merchant-shop.com/','2026/09/08 23:50:42','invalid_catalog','SKU','分页','建站系统','是否已经部署','转发给 AIradar 站长'])assert.ok(prompt.includes(value),value);
 assert.doesNotMatch(prompt,/raw-private-error|private-contact|MA-private-id|secret-material|可收录报价：0|AirRadar/);
 assert.match(prompt,/不代表店铺本身有故障/);assert.match(prompt,/不是额外的操作指令/);
});
test('不同失败原因的 AI 任务分别处理访问、限流、采集端问题与真实商品条件',()=>{
 for(const code of PREFLIGHT_REASON_CODES){
  const prompt=preflightAiPrompt(failed(code),application);assert.ok(prompt.includes('（'+code+'）'));assert.match(prompt,/不索要或输出账号密码/);assert.doesNotMatch(prompt,/raw-private-error/);
 }
 assert.match(preflightAiPrompt(failed('access_denied'),application),/不要关闭全站防护/);
 assert.match(preflightAiPrompt(failed('rate_limited'),application),/由 AIradar 降低频率后重试/);
 assert.match(preflightAiPrompt(failed('internal_error'),application),/AIradar 先核对采集服务/);
 const noQuotes={status:'no_valid_offers',result:{status:'no_valid_offers',rawCount:12,validCount:0}};
 assert.match(preflightAiPrompt(noQuotes,application),/不要为了通过收录而虚构库存/);
 assert.match(preflightAiPrompt(failed('unknown'),application),/仍无法确认/);
});
test('未完成、过期或成功结果不产生失败排查文案，未知原因不猜测并过滤危险网址',()=>{
 for(const state of [null,{},...['pending','running','ready','expired','invalid'].map(status=>({...failed(),status})),{...failed(),fresh:false},{...failed(),result:{status:'ready'}}])assert.equal(preflightAiPrompt(state,application),'');
 const legacy=failed();delete legacy.result.reasonCode;legacy.result.checkedAt=null;legacy.result.httpStatus='200 private';
 const prompt=preflightAiPrompt(legacy,{...application,shopUrl:'https://user:secret@merchant-shop.com/?token=private'});
 assert.match(prompt,/历史测试未记录原因/);assert.match(prompt,/检测时间：未记录/);assert.doesNotMatch(prompt,/1970|HTTP 状态|user:secret|token=private/);
 assert.match(preflightAiPrompt({...failed(),result:{...failed().result,httpStatus:404}},application),/HTTP 状态：404/);
});
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
