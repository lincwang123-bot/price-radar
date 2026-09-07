import { isAccessDeniedError } from './safe-fetch.mjs';
import { merchantIdentityForUrl } from './merchant-identity.mjs';

export const PREFLIGHT_REASON_CODES = Object.freeze([
  'rate_limited', 'login_required', 'access_denied', 'robots_disallowed', 'not_found',
  'timeout', 'dns_error', 'tls_error', 'network_error', 'server_error', 'invalid_catalog',
  'unsupported_platform', 'no_valid_quotes', 'collector_limit', 'redirect_disallowed', 'internal_error', 'unknown',
]);
export const isPreflightReasonCode = value => typeof value === 'string' && PREFLIGHT_REASON_CODES.includes(value);
export const isPreflightHttpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'EAI_FAIL']);
const TLS_CODES = new Set(['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_REVOKED']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_SOCKET']);

// Inspect structured transport errors and known *locally generated* diagnostics.
// Never classify arbitrary merchant prose by words such as captcha, DNS or JSON.
export function classifyPreflightError(error) {
  const chain = []; let current = error;
  while (current && typeof current === 'object' && chain.length < 4 && !chain.includes(current)) { chain.push(current); current = current.cause; }
  const status = chain.map(item => item.status).find(isPreflightHttpStatus);
  const codes = chain.map(item => item.code).filter(value => typeof value === 'string');
  const message = typeof error?.message === 'string' ? error.message : '';
  let reasonCode;
  if (status === 429) reasonCode = 'rate_limited';
  else if (status === 401) reasonCode = 'login_required';
  else if (status === 407) reasonCode = 'internal_error';
  else if (chain.some(isAccessDeniedError)) reasonCode = 'access_denied';
  else if (codes.includes('ROBOTS_DISALLOWED') || ['AikaShop robots不再明确允许目录读取', 'Aichong robots 不再明确允许目录读取'].includes(message)) reasonCode = 'robots_disallowed';
  else if (status === 404) reasonCode = 'not_found';
  else if (codes.some(code => TIMEOUT_CODES.has(code)) || /^safe-fetch: 请求超时（\d+ms）$/.test(message)
    || ['公开目录采集超时', '公开目录请求超时'].includes(message)) reasonCode = 'timeout';
  else if (codes.some(code => DNS_CODES.has(code)) || message === '店铺 DNS 包含非公开地址') reasonCode = 'dns_error';
  else if (codes.some(code => TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_'))) reasonCode = 'tls_error';
  else if (codes.some(code => NETWORK_CODES.has(code))) reasonCode = 'network_error';
  else if (status >= 500) reasonCode = 'server_error';
  else if (['公开目录请求达到上限', '公开目录响应超过限制', '公开查询请求过大', 'ShopApi 分类未完整：达到 maxCategories'].includes(message)
    || /^safe-fetch: 响应过大（/.test(message)) reasonCode = 'collector_limit';
  else if (message === '公开目录不允许重定向' || /^safe-fetch: 重定向超过上限 \d+$/.test(message)) reasonCode = 'redirect_disallowed';
  else if (codes.includes('PREFLIGHT_INTERNAL_ERROR') || codes.some(code => ['SQLITE_ERROR', 'ERR_SQLITE_ERROR', 'ENOSPC', 'EACCES', 'EROFS'].includes(code))
    || ['Aichong 目标未登记', 'AikaShop目标未登记'].includes(message)) reasonCode = 'internal_error';
  else if (codes.includes('INVALID_CATALOG') || /^(?:safe-fetch: JSON (?:响应类型无效（|解析失败:)|(?:Kami|Dujiao|ShopApi)(?: 分类)? 响应格式无效：|(?:Kami|Dujiao|ShopApi) 返回失败 |16688 目录失败:)/.test(message)
    || /^(?:Kami 目录超过分页上限|Dujiao (?:单页商品数量超过上限|商品数量超过上限|商品总数超过上限|报价数量超过上限|分页超过上限)|ShopApi 分页(?:商品 ID 重复|重复| total 变化|超出 total|未完整))/.test(message)
    || /^(?:Dujiao pagination(?: 格式无效|\.page 不匹配：)|ShopApi 分类返回失败 code: |Mooncake 目录(?:必须是文本|缺少 window\.MOONCAKE_CATALOG 赋值|赋值不是 JSON 数组| JSON (?:数组不完整|解析失败:)|根值不是数组)|IkunLove 响应格式无效：)/.test(message)
    || /^Dujiao 商品 .* 的 (?:skus 不是数组|SKU 数量超过上限 \d+)$/.test(message)
    || ['目录格式无效或超限', '商品来源验证失败', '16688 目录超限或不完整', '16688 店铺身份不匹配', 'ShopApi 未返回可用公开分类', 'ShopApi 分类响应格式无效：缺少 data 数组',
      'IkunLove 响应标记为失败', 'AikaShop缺少明确Suno SKU目录', 'AikaShop SKU数量无效', 'AikaShop SKU规格/价格不可靠',
      'Aichong 独立目录无效或超过上限', 'Aichong 商品 ID 重复'].includes(message)) reasonCode = 'invalid_catalog';
  else reasonCode = 'unknown';
  // safeFetchJson uses status for a JSON business code too; it is not a
  // trustworthy HTTP response status in that exact local error branch.
  const apiBusinessStatus = chain.some(item => item.message === 'safe-fetch: API 访问拒绝或需要认证/验证码');
  return { reasonCode, ...(status === undefined || apiBusinessStatus ? {} : { httpStatus: status }) };
}

// All explanation/message text is owned by this module, never an error body.
const COPY = {
  rate_limited: ['请求受到限流', '本次目录请求返回限流状态，暂未读取完整目录。', '先等待一段时间再测试；若持续发生，请确认允许的读取频率。', '本次读取公开商品目录时遇到限流。请帮忙确认允许的读取频率；我们会降低频率并稍后重试，不需要关闭安全防护。', false],
  login_required: ['目录要求登录', '目录请求返回需要身份认证的状态；测试没有登录店铺。', '请确认是否有无需登录的公开目录，或提供公开只读接口说明。', '本次商品目录请求要求登录。请确认是否有无需登录的公开商品目录，或提供公开只读接口说明。我们不会使用店铺账号登录采集。', false],
  access_denied: ['访问被拒绝或需要安全校验', '本次目录请求被拒绝或返回安全校验，未读取完整目录；这不代表店铺主页无法正常打开。', '请确认是否允许公开目录读取，并提供合规读取方式；不要关闭防护或提供验证码。', '本次自动读取目录时遇到访问拒绝或安全校验，这不代表您的店铺主页无法正常打开。请确认是否允许读取公开目录，并告知合规的公开读取方式。我们不会绕过验证码、登录或安全防护，也不需要您关闭防护。', false],
  robots_disallowed: ['自动读取规则未允许', '本次读取未通过 robots 自动访问规则检查，测试已停止。', '请确认店铺公开读取政策；在规则明确允许前不继续测试。', '本次读取未通过网站的 robots 自动访问规则检查，我们已停止。请确认贵店是否允许公开目录读取，以及规则允许的目录或公开接口；在允许前我们不会继续。', false],
  not_found: ['公开目录接口未找到', '本次已探测的公开目录接口返回 404；不能据此判断店铺主页不存在。', '请确认建站系统及版本，并提供公开目录路径或只读接口说明，由站方核对适配。', '本次尝试的公开商品目录接口返回 404，但这并不表示您的店铺主页不存在。请告知建站系统及版本，或提供正确的公开目录路径、公开只读接口说明，我们会核对适配。', true],
  timeout: ['读取目录超时', '本次请求未在规定时间内完成；可能与网络或服务响应有关，暂不能确定具体原因。', '稍后重新测试；若持续超时，由站方先检查网络，再与店主核对目录响应情况。', '本次读取公开目录超时，暂不能确定是网络还是目录响应造成。我们会先检查并稍后重试；若仍有问题，再请您协助确认目录是否正常响应。', true],
  dns_error: ['域名解析未通过', '本次域名解析失败，或解析结果未通过公开地址安全检查；暂未读取目录。', '站方先检查解析及安全限制；如需更新店铺网址，再请店主确认。', '本次目录读取未通过域名解析或公开地址安全检查。我们会先检查解析和采集限制；如需您确认公开店铺域名，会再说明，不需要提供服务器地址。', true],
  tls_error: ['安全连接未建立', '本次 HTTPS 安全连接校验失败，测试没有降低证书验证要求。', '由站方核对连接错误；若证书配置确有问题，再请店主协助处理。', '本次未能建立通过校验的 HTTPS 安全连接。我们会先核对连接原因；如确认与店铺证书配置有关，再请您协助处理。我们不会跳过证书校验。', true],
  network_error: ['网络连接未完成', '本次连接中断、被拒绝或不可达，尚不能确定是网络路径还是店铺服务原因。', '由站方先检查网络并稍后重试，持续失败再联系店主核对。', '本次读取目录的网络连接未完成，暂不能确定具体原因。我们会先检查网络并重试；若仍失败，再请您协助核对公开目录的可用性。', true],
  server_error: ['目录服务返回错误', '本次请求返回服务端 5xx 状态；可能来自店铺服务或中间网关，暂未读取完整目录。', '稍后重试；若持续发生，请协助确认公开目录或网关的状态。', '本次目录请求收到服务端错误，可能来自目录服务或中间网关。我们会稍后重试；如果持续出现，请协助确认公开目录是否正常。', false],
  invalid_catalog: ['目录内容尚不能完整识别', '返回内容不是当前适配器可完整识别的商品目录，或超过本轮读取限制；不代表店铺本身有故障。', '请提供建站系统及版本、公开目录样例或接口说明，由站方检查适配和读取限制。', '本次返回内容尚不能被我们的适配器完整识别，也可能超过本轮读取限制，不代表您的店铺有故障。请告知建站系统及版本，或提供不含敏感信息的公开目录样例、接口说明，我们会检查适配。', true],
  unsupported_platform: ['店铺系统暂未适配', '当前未识别到兼容的公开商品目录，尚不能确认是否有其他可用读取方式。', '请提供建站系统及版本或公开只读接口说明，由站方评估适配。', '目前我们的采集器尚未适配到贵店的公开商品目录。请告知建站系统及版本，或提供公开只读商品接口说明，我们会评估适配；暂不能承诺完成时间或已经接入。', true],
  no_valid_quotes: ['没有符合展示规则的报价', '目录已读取，但本次没有通过网站展示规则的有效报价；不等于店铺没有商品。', '人工核对价格、库存、质保、品类及规格；只核实真实信息，不要求修改事实来通过。', '本次已读取目录，但暂未找到符合本站展示规则的有效报价，并不等于贵店没有商品。请协助核对真实的价格、库存、质保、品类和规格信息；不需要为了通过测试修改实际商品条件。', false],
  collector_limit: ['达到本轮安全读取限制', '目录分类数量、响应大小或请求数量达到本站测试限制，未取得完整结果；这不是店铺故障的证据。', '由站方检查分类、分页和读取预算；需要时向店主确认有界的公开目录方式，不直接提高或绕过安全限制。', '本次读取达到我们测试服务的分类数量、响应大小或请求数量限制，暂未取得完整目录。这不代表贵店故障，我们会先检查采集方式；如需分页或有界的公开目录说明，再请您协助。', true],
  redirect_disallowed: ['目录发生跳转，测试已停止', '本次目录请求发生跳转，或达到当前适配器的跳转限制；测试没有继续跳转。', '由站方核对店铺最终公开地址及目录路径；如地址已更换，请店主提供不带凭据的最终 HTTPS 主页。', '本次目录请求发生跳转，触发了我们测试服务的安全限制。我们会先核对最终公开地址；如果店铺网址已更换，请提供不带登录信息的最终 HTTPS 主页。我们不会绕过跳转限制。', true],
  internal_error: ['本站测试服务异常', '本站测试服务或连接配置发生异常，不能据此判断店铺是否可接入。', '由站方排查测试服务及连接配置并重新测试；暂不要求店主修改任何配置。', '本次是我们的测试服务或连接配置发生异常，暂不能判断贵店接入情况。请暂时无需修改店铺配置，由我们排查处理后重新测试。', true],
  unknown: ['失败原因暂未确定', '本次测试未完成，但没有足够可靠的信息确定原因。', '由站方核对测试记录并重新测试；原因明确后再向店主提出具体请求。', '本次目录测试未完成，目前还没有足够信息确认具体原因。我们会先检查并重新测试，原因明确后再告知需要您协助的事项，请暂时无需修改配置。', true],
  legacy_unknown: ['历史测试未记录原因', '历史测试未记录具体原因，请重新测试。', '先重新测试获得当前原因；不要根据历史通用提示推断为安全校验或店铺故障。', '历史测试没有记录具体失败原因，我们需要重新测试后再确认。暂时无法判断是否与访问限制或目录适配有关，请暂时无需修改配置。', true],
  pending: ['等待测试采集', '测试正在排队，尚未读取商品目录。', '等待测试完成后查看结果，再决定是否需要联系店主。', '公开目录测试正在排队，尚未取得结果。我们会在完成后反馈，请暂时无需修改配置。', false],
  not_tested: ['尚未测试采集', '当前没有可用的测试结果，尚不能判断目录是否可读取。', '核实店铺归属和公开读取许可后，由审核人员发起测试。', '我们尚未完成公开目录测试，需要先确认店铺归属和公开读取许可，再安排测试。当前不代表已接入或已认证。', true],
  expired: ['测试结果已过期', '测试结果已过期或不再对应当前申请版本，不能用于本次批准。', '确认当前申请信息和许可后重新测试。', '此前测试已过期或不再对应当前申请信息，需要重新测试后才能核对接入情况，当前不代表已接入或已认证。', true],
  ready: ['目录已读取，待人工核对', '本次已取得有效商品样例，但测试成功不等于已批准、已接入或已认证。', '人工核对样例的价格、规格和商品页，再按审核流程处理。', '本次已读取到可供审核的商品样例，我们还需人工核对价格、规格及商品页。这不代表已批准、已接入或已认证，也不构成交易或售后保证。', true],
};

function contextFor(application) {
  const rawName = typeof application?.shopName === 'string' ? application.shopName.trim() : '';
  // Preserve ordinary real shop names; do not copy pasted contact/URL/ID material.
  const safeName = rawName && rawName.length <= 100 && !/[<>\u0000-\u001f\u007f@]|https?:|(?:\d{1,3}\.){3}\d{1,3}|\d{7,}|(?:MA|MT)-[A-Z0-9-]+|(?:token|api[ _-]?key|私钥|密码|微信|联系方式)\s*[:：=]/i.test(rawName) ? rawName : '这家店铺';
  let homepage = '';
  try {
    const url = new URL(application?.shopUrl);
    const rawUrl = application?.shopUrl, decodedPath = decodeURIComponent(url.pathname);
    if (typeof rawUrl === 'string' && rawUrl.length <= 500 && url.href.length <= 500 && !/[\\\u0000-\u0020\u007f]/.test(rawUrl)
      && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && !/[<>?\u0000-\u0020\u007f]|(?:password|passwd|api[_ -]?key|access[_ -]?token|secret|token|密码|口令)\s*[:=：]/i.test(decodedPath)
      && url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && /\.[a-z]{2,63}$/.test(url.hostname)
      && !/(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/.test(url.hostname)
      && !/^(?:localhost|metadata)(?:\.|$)/.test(url.hostname) && merchantIdentityForUrl(url.href)) homepage = url.href;
  } catch { /* No URL context is safer than echoing malformed/private input. */ }
  return `关于「${safeName}」${homepage ? `（主页：${homepage}）` : ''}：`;
}
function guidanceForCode(code, application) {
  const [title, explanation, nextStep, message, requiresOperator] = COPY[code];
  return { code, title, explanation, nextStep,
    merchantMessage: `${contextFor(application)}${message} 不需要提供密码、私钥或 API Key。`, requiresOperator };
}
export function listPreflightGuidance(application) {
  return [...PREFLIGHT_REASON_CODES, 'legacy_unknown'].map(code => guidanceForCode(code, application));
}
export function preflightGuidance(preflight, application) {
  const result = preflight?.result || preflight;
  const status = preflight?.status || result?.status;
  if (!preflight) return guidanceForCode('not_tested', application);
  if (['pending', 'queued', 'expired', 'ready'].includes(status)) return guidanceForCode(status === 'queued' ? 'pending' : status, application);
  if (status === 'invalid') return guidanceForCode('internal_error', application);
  // A legacy failure remains unknown even if its old message mentions WAF.
  return guidanceForCode(isPreflightReasonCode(result?.reasonCode) ? result.reasonCode : 'legacy_unknown', application);
}
