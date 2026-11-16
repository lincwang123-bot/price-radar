import {articleForPath} from './guides.mjs';

// Verification never loads Google's advertising runtime. PILOT_READY records
// operator checks; it cannot determine approval, CMP or Auto ads account state.
export function adsenseConfig(env = process.env) {
  const candidate = String(env.ADSENSE_PUBLISHER_ID || '').trim().replace(/^ca-pub-/, 'pub-');
  const publisher = /^pub-\d{16}$/.test(candidate) && candidate !== 'pub-0000000000000000' ? candidate : '';
  const enabled = ['verify', 'guide'].includes(env.ADSENSE_MODE) && Boolean(publisher);
  const slot = /^\d{1,20}$/.test(String(env.ADSENSE_GUIDE_SLOT || '')) ? String(env.ADSENSE_GUIDE_SLOT) : '';
  return Object.freeze({
    publisher: enabled ? publisher : '',
    client: enabled ? 'ca-' + publisher : '',
    slot,
    live: enabled && env.ADSENSE_MODE === 'guide' && Boolean(slot) && env.ADSENSE_PILOT_READY === 'true',
  });
}

export function adsenseRoute(req, res, url, config) {
  if (url.pathname !== '/ads.txt') return false;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow: 'GET, HEAD'}); res.end(); return true;
  }
  const body = config.publisher ? `google.com, ${config.publisher}, DIRECT, f08c47fec0942fa0\n` : 'Not configured\n';
  res.statusCode = config.publisher ? 200 : 404;
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

export function adsensePrivacy(config) {
  const status = config.live
    ? '本站在订阅指南文章结束后展示 Google AdSense 广告。广告标为“广告”，与报价和编辑内容分开。'
    : config.publisher
      ? '本站已配置 Google AdSense 网站归属验证，并准备接入广告。当前仍处于验证 / 准备阶段：页面不加载 Google 广告脚本，也不展示 AdSense 广告单元。接入后将在订阅指南等约定位置展示标为“广告”的内容。'
      : '本站准备接入 Google AdSense。当前尚未配置可投放的发布商身份，页面不加载 Google 广告脚本，也不展示 AdSense 广告单元。接入并启用后，将按本说明披露并在约定位置展示广告。';
  // Disclosure covers both current verify mode and future serving, so reviewers
  // see cookie / opt-out language before ads go live.
  const details = '<p>若启用第三方广告（Google AdSense），Google 及其广告合作伙伴可能接收 IP 地址、浏览器和设备信息、页面信息，并使用 Cookie、设备标识或类似技术，用于提供个性化或非个性化广告、衡量效果及防止滥用。这些第三方数据处理与本站下述第一方统计不同，不适用本站统计摘要的保留期限；处理方式及保留期限由对应服务的隐私政策说明。</p><p>你可以通过浏览器设置限制或删除 Cookie，也可以在 <a href="https://myadcenter.google.com/" rel="noopener noreferrer">Google 我的广告中心</a>及 <a href="https://adssettings.google.com/" rel="noopener noreferrer">Google 广告设置</a>管理或退出个性化广告；这些设置不替代访问地区可能另行提供的同意选择。非个性化广告也可能使用存储技术。</p><p>在需要征求同意的地区，广告隐私消息会说明合作伙伴及数据用途，并提供接受、拒绝或管理选择的入口；可通过该消息提供的隐私设置入口调整或撤回选择。</p><p>了解 <a href="https://policies.google.com/technologies/partner-sites?hl=zh-CN" rel="noopener noreferrer">Google 如何使用合作伙伴网站的数据</a>及 <a href="https://policies.google.com/technologies/ads?hl=zh-CN" rel="noopener noreferrer">Google 广告技术与 Cookie</a>。本站不读取 Google 广告点击者的身份，也无法据此确认第三方网站的订单。现有直接赞助位的统计方式见下文，不包含 Google AdSense 广告。</p>';
  return `<section id="google-advertising"><h2>Google 广告与隐私选择</h2><p>${status}</p>${details}</section>`;
}

export function decorateAdSense(html, url, status, config) {
  if (status !== 200) return html;
  if (url.pathname === '/privacy') html = html.replace('<h2>第一方访问统计</h2>', adsensePrivacy(config) + '<h2>第一方访问统计</h2>');
  const article = url.pathname.startsWith('/guides/') && articleForPath(url.pathname);
  if (!config.publisher || !article && !['/', '/about', '/privacy', '/contact', '/guides'].includes(url.pathname)) return html;
  html = html.replace('</head>', `<meta name="google-adsense-account" content="${config.client}"></head>`);
  if (!config.live || !article || !html.includes('</article>')) return html;
  const ad = `<aside class="guide-ad" aria-label="广告"><div class="guide-ad-label"><span>广告</span><a href="/privacy#google-advertising">广告与隐私</a></div><ins class="adsbygoogle" style="display:block" data-ad-client="${config.client}" data-ad-slot="${config.slot}" data-ad-format="auto" data-full-width-responsive="true"></ins></aside>`;
  html = html.replace('</article>', '</article>' + ad);
  return html.replace('</head>', `<style>.guide-ad{max-width:820px;margin:40px auto 0;padding-top:20px;border-top:1px solid var(--line,#dce5e0)}.guide-ad-label{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;font-size:12px;color:#68766f}.guide-ad-label a{color:inherit}.guide-ad .adsbygoogle{min-height:250px}.guide-ad:has(.adsbygoogle[data-ad-status="unfilled"]){display:none}</style><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.client}" crossorigin="anonymous"></script></head>`)
    .replace('</body>', '<script>(window.adsbygoogle=window.adsbygoogle||[]).push({});</script></body>');
}
