import test from 'node:test';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScrapeGuard, signVisitor, priceSurfaceKey, signQuote, quoteTokenValid, visitorCookieValid} from '../lib/scrape-guard.mjs';
import {BOT_ALLOWLIST, identifyBot, botRobotsAgents} from '../lib/bot-allowlist.mjs';
import {robotsText} from '../lib/seo.mjs';
import {homeResponseRevision} from '../lib/home-response-cache.mjs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {openAnalytics} from '../lib/analytics.mjs';

const ranges = JSON.parse(readFileSync(new URL('../lib/bot-ranges.json', import.meta.url), 'utf8'));
const silent = {log(){}};
const networkOf = key => ranges[key].cidrs.find(cidr => !cidr.includes(':')).split('/')[0];
function response() {
  const headers = {};
  return {statusCode:200, headers, body:'', setHeader(name, value){headers[name.toLowerCase()]=value;}, getHeader(name){return headers[name.toLowerCase()];}, end(body){this.body=body;}};
}
function request({ip='203.0.113.10', ua='Mozilla/5.0 Chrome/125', path='/prices/chatgpt-plus', headers={}}={}) {
  return {method:'GET', url:path, socket:{remoteAddress:'127.0.0.1'}, headers:{host:'airadar.vip', 'user-agent':ua, 'cf-connecting-ip':ip, accept:'text/html', 'accept-language':'zh-CN', ...headers}};
}
const browser = {'sec-fetch-dest':'document', 'sec-fetch-mode':'navigate', 'sec-fetch-site':'cross-site', 'sec-fetch-user':'?1'};
const guardEnv = {AIRADAR_SCRAPE_LOG_PATH:'', AIRADAR_SCRAPE_GUARD:'enforce', AIRADAR_SCRAPE_CLUSTER_IPS:'6', AIRADAR_SCRAPE_CLUSTER_PATHS:'4', AIRADAR_SCRAPE_BLOCK_AFTER:'3', AIRADAR_SCRAPE_UA_BOT_PER_MIN:'4'};
function makeGuard(env = {}, lookup) {
  return createScrapeGuard({env:{...guardEnv, ...env}, logger:silent, ...(lookup?{lookup}:{})});
}
async function hit(guard, fields) {
  const res = response();
  const url = new URL(fields.path || '/prices/chatgpt-plus', 'http://localhost');
  const handled = await guard.handle(request(fields), res, url);
  return {handled, res};
}

test('published crawler ranges verify real addresses and reject spoofed user agents', async () => {
  const gpt = networkOf('openai-gptbot');
  const google = networkOf('google-common');
  const bing = networkOf('bingbot');
  const apple = networkOf('applebot');
  const perplexity = networkOf('perplexitybot');
  const anthropic = networkOf('anthropic');
  const cc = networkOf('ccbot');
  const cases = [
    ['Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)', gpt, 'verified', 'openai-gptbot'],
    ['Mozilla/5.0 (compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot)', networkOf('openai-searchbot'), 'verified', 'openai-searchbot'],
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', networkOf('openai-chatgpt-user'), 'verified', 'openai-chatgpt-user'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', google, 'verified', 'google'],
    ['Mozilla/5.0 (compatible; Google-Extended)', google, 'verified', 'google'],
    ['Mozilla/5.0 (compatible; GoogleOther)', networkOf('google-special'), 'verified', 'google'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', bing, 'verified', 'bingbot'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1)', apple, 'verified', 'applebot'],
    ['Mozilla/5.0 (compatible; Applebot-Extended/1.0)', apple, 'verified', 'applebot'],
    ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', perplexity, 'verified', 'perplexitybot'],
    ['Mozilla/5.0 (compatible; Perplexity-User/1.0)', networkOf('perplexity-user'), 'verified', 'perplexity-user'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@example.com)', anthropic, 'verified', 'anthropic'],
    ['Mozilla/5.0 (compatible; Claude-SearchBot/1.0)', anthropic, 'verified', 'anthropic'],
    ['Mozilla/5.0 (compatible; Claude-User/1.0)', anthropic, 'verified', 'anthropic'],
    ['anthropic-ai', anthropic, 'verified', 'anthropic'],
    ['CCBot/2.0 (https://commoncrawl.org/faq/)', cc, 'verified', 'ccbot'],
  ];
  for (const [ua, ip, access, id] of cases) {
    const found = await identifyBot(ua, ip, {lookup:{reverse(){throw new Error('dns should not run');}, resolve(){throw new Error('dns');}}});
    assert.equal(found.access, access, ua);
    assert.equal(found.bot.id, id, ua);
  }
  const fake = await identifyBot('Mozilla/5.0 (compatible; GPTBot/1.4)', '203.0.113.8', {});
  assert.equal(fake.access, 'unverified');
  const ipv6 = ranges['google-common'].cidrs.find(cidr => cidr.includes(':'));
  const v6 = await identifyBot('Googlebot/2.1', ipv6.split('/')[0], {});
  assert.equal(v6.access, 'verified');
  const baidu = await identifyBot('Mozilla/5.0 (compatible; Baiduspider/2.0)', '203.0.113.9', {lookup:{
    async reverse(){return ['crawl.baidu.com'];},
    async resolve(host){assert.equal(host, 'crawl.baidu.com'); return ['203.0.113.9'];},
  }});
  assert.equal(baidu.access, 'verified');
  const forgedBaidu = await identifyBot('Baiduspider/2.0', '203.0.113.9', {lookup:{async reverse(){return ['evil.example'];}, async resolve(){return [];}}});
  assert.equal(forgedBaidu.access, 'unverified');
  const bytes = await identifyBot('Mozilla/5.0 (compatible; Bytespider; https://zhanzhang.toutiao.com/)', '203.0.113.9', {});
  assert.equal(bytes.access, 'ua');
  assert.equal((await identifyBot('Mozilla/5.0 Chrome/125', '203.0.113.9', {})), null);
  for (const name of ['GPTBot','OAI-SearchBot','ChatGPT-User','Googlebot','Google-Extended','GoogleOther','ClaudeBot','Claude-User','Claude-SearchBot','anthropic-ai','PerplexityBot','Perplexity-User','GrokBot','xAI-SearchBot','bingbot','Applebot','Applebot-Extended','meta-externalagent','DuckDuckBot','Baiduspider','YandexBot','Bytespider','CCBot']) {
    assert.ok(botRobotsAgents().includes(name), name);
    assert.match(robotsText, new RegExp('User-agent: '+name.replace('-','\\-')+'\\n'));
    assert.doesNotMatch(robotsText, new RegExp('User-agent: '+name.replace('-','\\-')+'\\nDisallow'));
  }
  assert.match(robotsText, /Search engines and AI indexing or assistant fetchers are welcome/);
  assert.match(robotsText, /Third-party bulk price scraping, mirroring, and resale are prohibited/);
  assert.match(robotsText, /User-agent: \*\nAllow: \/\nDisallow: \/admin/);
  assert.match(robotsText, /Sitemap: https:\/\/airadar\.vip\/sitemap\.xml/);
  assert.ok(BOT_ALLOWLIST.every(bot => bot.verify !== 'cidr' || bot.networks.length > 0));
});

test('normal browser flows are never challenged or blocked', async () => {
  const guard = makeGuard();
  const google = await hit(guard, {path:'/', headers:{...browser, referer:'https://www.google.com/search?q=chatgpt+price'}});
  assert.equal(google.handled, false);
  for (let i = 0; i < 15; i++) {
    const opened = await hit(guard, {path:'/prices/p'+i, headers:{...browser, referer:'https://airadar.vip/', 'sec-fetch-site':'same-origin'}});
    assert.equal(opened.handled, false, 'tab '+i);
  }
  for (let user = 0; user < 8; user++) {
    for (const path of ['/prices/chatgpt-plus','/prices/claude-pro','/product?source=direct-shops&id=one']) {
      const shared = await hit(guard, {ip:'198.51.100.20', ua:'Mozilla/5.0 Chrome/'+(120+user), path, headers:browser});
      assert.equal(shared.handled, false, user+' '+path);
    }
  }
  guard.close();
});

test('rotating-IP price scraping is challenged, then 429, while verified and cookied clients pass', async () => {
  const guard = makeGuard();
  const scraper = {ua:'Mozilla/5.0 Chrome/125', headers:{...browser, accept:'text/html', referer:'https://airadar.vip/prices/chatgpt-plus'}};
  let challenged = null;
  for (let i = 0; i < 8; i++) {
    const result = await hit(guard, {...scraper, ip:'198.51.100.'+i, path:'/prices/item'+i});
    if (result.handled) challenged = result;
  }
  assert.equal(challenged?.res.statusCode, 200);
  assert.match(challenged.res.body, /data-airadar-challenge="1"/);
  assert.match(challenged.res.body, /document\.cookie='airadar_hv=/);
  assert.doesNotMatch(challenged.res.body, /captcha|人机验证|点击/i);
  assert.equal(challenged.res.headers['x-accel-expires'], '0');
  const token = challenged.res.body.match(/airadar_hv=([^;']+)/)[1];
  assert.equal(visitorCookieValid(guard.secret, token, Date.now()), true);
  const human = await hit(guard, {...scraper, ip:'198.51.100.50', path:'/prices/item9', headers:{...scraper.headers, cookie:'airadar_hv='+token}});
  assert.equal(human.handled, false);
  assert.equal(guard.stats().humanPass, 1);
  assert.ok(guard.stats().falsePositiveRate > 0);
  let blocked = null;
  for (let n = 0; n < 6 && !blocked; n++) {
    const again = await hit(guard, {...scraper, ip:'198.51.100.9', path:'/prices/more'+n});
    if (again.res.statusCode === 429) blocked = again;
  }
  assert.equal(blocked?.res.statusCode, 429);
  const real = makeGuard();
  for (let i = 0; i < 8; i++) {
    const bot = await hit(real, {ip:networkOf('openai-gptbot'), ua:'Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)', path:'/prices/item'+i, headers:{referer:'https://airadar.vip/'}});
    assert.equal(bot.handled, false, 'real GPTBot');
  }
  const cc = makeGuard({AIRADAR_SCRAPE_UA_BOT_PER_MIN:'2'});
  for (let i = 0; i < 5; i++) {
    const bot = await hit(cc, {ip:networkOf('ccbot'), ua:'CCBot/2.0 (https://commoncrawl.org/faq/)', path:'/prices/item'+i});
    assert.equal(bot.handled, false, 'verified CCBot is not on the UA ceiling');
  }
  const fake = makeGuard();
  let fakeChallenge = false;
  for (let i = 0; i < 8; i++) {
    const bot = await hit(fake, {ip:'203.0.113.'+(10+i), ua:'Mozilla/5.0 (compatible; GPTBot/1.4)', path:'/prices/item'+i, headers:{referer:'https://airadar.vip/'}});
    fakeChallenge ||= bot.handled && /data-airadar-challenge/.test(bot.res.body||'');
  }
  assert.equal(fakeChallenge, false);
  const ceiling = makeGuard();
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const bot = await hit(ceiling, {ip:'203.0.113.40', ua:'Mozilla/5.0 (compatible; Bytespider)', path:'/prices/item'+i});
    limited ||= bot.res.statusCode === 429;
  }
  assert.equal(limited, true);
  const logged = makeGuard({AIRADAR_SCRAPE_GUARD:'log'});
  let loggedBody = false;
  for (let i = 0; i < 8; i++) loggedBody ||= (await hit(logged, {...scraper, ip:'198.51.100.'+i, path:'/prices/item'+i})).handled;
  assert.equal(loggedBody, false);
  assert.ok(logged.stats().wouldChallenge > 0);
  const off = makeGuard({AIRADAR_SCRAPE_GUARD:'off'});
  assert.equal((await hit(off, {...scraper, path:'/prices/item0'})).handled, false);
  for (const item of [guard, real, cc, fake, ceiling, logged, off]) item.close();
});

test('quote history tokens are not enumerable and Baidu reverse DNS failure stays allowed', async () => {
  const guard = makeGuard();
  const params = {source:'direct-shops', id:'chatgpt-plus', spec:'1m', channel:'all', framework:'all'};
  const token = signQuote(guard.secret, params, Date.now());
  const ok = new URL('http://localhost/api/quote-history?'+new URLSearchParams({...params, t:token}));
  assert.equal(guard.quoteAllowed(ok), true);
  assert.equal(quoteTokenValid(guard.secret, token, {...params, id:'other'}, Date.now()), false);
  assert.equal(guard.quoteAllowed(new URL('http://localhost/api/quote-history?source=direct-shops&id=chatgpt-plus')), false);
  const lookup = {async reverse(){return [];}, async resolve(){return [];}};
  const baidu = makeGuard({}, lookup);
  let challenged = false;
  for (let i = 0; i < 8; i++) {
    const result = await hit(baidu, {ip:'203.0.113.'+(20+i), ua:'Baiduspider/2.0', path:'/prices/item'+i, headers:{referer:'https://airadar.vip/'}});
    challenged ||= result.handled;
  }
  assert.equal(challenged, false);
  guard.close(); baidu.close();
});

test('home page revision follows campaigns and ignores database counters', () => {
  let campaigns = [{id:'a', status:'approved', version:1, start_at:'s', end_at:'e', placement:'sponsored_home', page_key:'home'}];
  const revision = homeResponseRevision({prepare(){throw new Error('database counters must not bust the page cache');}}, null, {outbound:{activeCampaigns:()=>campaigns}});
  const first = revision();
  campaigns = [{...campaigns[0], version:2}];
  assert.notEqual(revision(), first);
  assert.equal(homeResponseRevision(null, null, null)(), '[]');
});

test('gateway microcache stays generous and browsers keep no-store', () => {
  const conf = readFileSync(new URL('../deploy/price-radar-gateway.conf', import.meta.url), 'utf8');
  for (const line of ['proxy_cache_valid 200 30s','proxy_cache_use_stale updating error timeout','proxy_cache_lock on','proxy_read_timeout 15s','proxy_ignore_headers Cache-Control Expires','zone=radar_cache_total:1m rate=2000r/s','limit_conn radar_conn_total 400','add_header Cache-Control "no-store" always']) assert.match(conf, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const image=conf.slice(conf.indexOf('location ~* ^/assets/'),conf.indexOf('location @radar_busy'));
  assert.doesNotMatch(image,/no-store/);
  for (const name of ['cf_clearance','__cf_bm','_cfuvid','airadar_hv']) assert.match(conf, new RegExp(name));
  const cookie = /(?:^|;\s*)(?!(?:cf_clearance|__cf_bm|_cfuvid|airadar_hv)=)[A-Za-z0-9_]+=/;
  assert.equal(cookie.test('cf_clearance=a; __cf_bm=b; _cfuvid=c; airadar_hv=d'), false);
  assert.equal(cookie.test('airadar_reader=secret'), true);
  assert.equal(cookie.test('cf_clearance=a; airadar_reader=secret'), true);
});

test('anonymous price pages cache, edge beacons count, and live browsers are not challenged', async () => {
  const db = openDb(':memory:');
  const analytics = openAnalytics(':memory:', 'edge-hit-test-secret-value-32chars');
  const app = createApp({db, analytics, retentionOptions:{env:{}, secret:'edge-hit-retention'.repeat(3)}});
  try {
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:'+app.address().port;
    const headers = {'user-agent':'Mozilla/5.0 Chrome/125', 'cf-connecting-ip':'203.0.113.77', ...browser, referer:'https://www.google.com/search?q=airadar'};
    const first = await fetch(base+'/catalog', {headers});
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-price-radar-page-cache'), 'MISS');
    assert.doesNotMatch(await first.text(), /data-airadar-challenge/);
    const second = await fetch(base+'/catalog', {headers:{...headers, 'cf-connecting-ip':'203.0.113.78'}});
    assert.equal(second.headers.get('x-price-radar-page-cache'), 'HIT');
    assert.equal(second.headers.get('cache-control'), 'no-store');
    await second.text();
    const robots = await (await fetch(base+'/robots.txt')).text();
    assert.match(robots, /User-agent: GPTBot/);
    assert.match(robots, /bulk price scraping/);
    const beacon = await fetch(base+'/api/public-hit', {method:'POST', headers:{'content-type':'application/json', 'user-agent':'Mozilla/5.0 Chrome/125', 'cf-connecting-ip':'203.0.113.79', origin:base}, body:JSON.stringify({p:'/catalog', s:''})});
    assert.equal(beacon.status, 204);
    await new Promise(setImmediate); await new Promise(setImmediate);
    assert.ok(analytics.report().pv >= 3);
    const cross = await fetch(base+'/api/public-hit', {method:'POST', headers:{'content-type':'application/json', origin:'https://evil.test', 'sec-fetch-site':'cross-site'}, body:'{"p":"/"}'});
    assert.equal(cross.status, 403);
    const history = await fetch(base+'/api/quote-history?source=direct-shops&id=chatgpt-plus');
    assert.equal(history.status, 404);
    const bot = await fetch(base+'/', {headers:{'user-agent':'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'cf-connecting-ip':networkOf('google-common')}});
    assert.equal(bot.status, 200);
    assert.doesNotMatch(await bot.text(), /data-airadar-challenge/);
  } finally {
    if (app.listening) { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
    await app.retentionWorkflowDone?.();
    await app.merchantWorkflowDone?.();
    analytics.close(); db.close();
  }
});

test('every search and AI claim bypasses JS challenges with stale or unavailable verification',async()=>{
 const guard=makeGuard({AIRADAR_SCRAPE_UA_BOT_PER_MIN:'100'}, {async reverse(){throw Error('fixture timeout');},async resolve(){return [];}});
 try{
  for(const bot of BOT_ALLOWLIST)for(const ua of bot.robots){
   for(let i=0;i<10;i++){
    const result=await hit(guard,{ua,ip:'198.51.100.'+(i+30),path:'/prices/fixture'+i,headers:{referer:'https://airadar.vip/'}});
    assert.equal(result.handled,false,ua);
   }
  }
  assert.equal(guard.stats().challenged,0);assert.equal(guard.stats().blocked,0);
 }finally{guard.close();}
 const ceiling=makeGuard({AIRADAR_SCRAPE_UA_BOT_PER_MIN:'2'});
 try{
  for(let i=0;i<3;i++)await hit(ceiling,{ua:'GPTBot',path:'/prices/fixture'+i});
  assert.equal(ceiling.stats().crawlerBlocked,1);assert.equal(ceiling.stats().otherBlocked,0);assert.equal(ceiling.stats().challenged,0);
 }finally{ceiling.close();}
});
test('legacy browsers and shared NAT navigations are allowed while non-browser bursts remain protected',async()=>{
 const guard=makeGuard({AIRADAR_SCRAPE_BURST:'5'});
 try{
  for(let i=0;i<15;i++)assert.equal((await hit(guard,{path:'/prices/fixture'+i})).handled,false,'missing sec-fetch alone is not scraping');
  for(let i=0;i<10;i++)assert.equal((await hit(guard,{ip:'198.51.100.'+(i+70),path:'/prices/fixture'+i,headers:{...browser,referer:'https://www.google.com/'}})).handled,false);
  let blocked=false;
  for(let i=0;i<10;i++){const result=await hit(guard,{ua:'price-harvester-fixture',path:'/prices/fixture'+i});blocked ||= result.res.statusCode===429;}
  assert.equal(blocked,true);assert.ok(guard.stats().otherBlocked>0);assert.equal(guard.stats().crawlerBlocked,0);
 }finally{guard.close();}
});
test('gateway crawler labels work on unknown routes and cache args preserve meaningful filters',()=>{
 const conf=readFileSync(new URL('../deploy/price-radar-gateway.conf',import.meta.url),'utf8');
 const claims=conf.match(/map "\$radar_log_route:\$http_user_agent" \$radar_crawler_claim \{([\s\S]*?)\n\}/)[1];
 assert.doesNotMatch(claims,/~\^other:/);
 const rules=[...claims.matchAll(/~\*([^\s]+) "([a-z-]+)";/g)].map(([,pattern,label])=>[new RegExp(pattern,'i'),label]);
 for(const ua of ['GPTBot','Googlebot','Google-Extended','OAI-SearchBot','ChatGPT-User','bingbot','ClaudeBot','Claude-SearchBot','PerplexityBot','GrokBot','xAI-SearchBot'])assert.ok(rules.some(([pattern])=>pattern.test('other:'+ua)),ua);
 assert.ok(rules.every(([,label])=>/^[a-z-]+$/.test(label)));
 const args=conf.match(/map \$args \$airadar_cache_args \{([\s\S]*?)\n\}/)[1];
 const pattern=new RegExp(args.match(/~\*([^\s]+) "";/)[1],'i');
 for(const query of ['utm_source=a','utm_campaign=x&gclid=a&fbclid=b','msclkid=c&gbraid=d&wbraid=e&dclid=f'])assert.equal(pattern.test(query),true,query);
 for(const query of ['utm_source=a&family=chatgpt','page=2','spec=1m','q=one','shop_q=a','unknown=a'])assert.equal(pattern.test(query),false,query);
 assert.match(conf,/proxy_cache_key "\$request_method\$host\$uri\$airadar_cache_args"/);
});

test('non-browser enumeration still trips the distinct-page protection independently of burst limits',async()=>{
 const guard=makeGuard({AIRADAR_SCRAPE_IP_PAGES:'5',AIRADAR_SCRAPE_BURST:'100000'});
 try{
  let blocked=false;
  for(let i=0;i<10;i++){
   const result=await hit(guard,{ua:'competitor-price-client-fixture',path:'/prices/fixture'+i,headers:{accept:'application/json'}});
   blocked ||= result.res.statusCode===429;
  }
  assert.equal(blocked,true);assert.ok(guard.stats().otherBlocked>0);
 }finally{guard.close();}
});


test('known crawlers do not consume the non-crawler quote-history rate pool',async()=>{
 const guard=makeGuard({AIRADAR_QUOTE_HISTORY_PER_MIN:'1'});
 try{
  for(let i=0;i<3;i++)assert.equal((await hit(guard,{ua:'GPTBot',path:'/api/quote-history'})).handled,false);
  assert.equal((await hit(guard,{path:'/api/quote-history'})).handled,false);
  assert.equal((await hit(guard,{path:'/api/quote-history'})).res.statusCode,429);
  assert.equal(guard.stats().otherBlocked,1);assert.equal(guard.stats().crawlerBlocked,0);
 }finally{guard.close();}
});

test('browser enumeration counts quote selectors across fingerprints and blocks HEAD; sponsors bypass',async()=>{
 const guard=makeGuard();
 try{
  const paths=Array.from({length:40},(_,i)=>['/prices/fixture'+i,'/prices/chatgpt-plus?spec='+i,'/?family=chatgpt&product=p'+i,'/official-prices/p'+i,'/en/official-prices/p'+i][i%5]);
  let challenge=false,block=false;
  for(let i=0;i<paths.length;i++){
   const r=await hit(guard,{path:paths[i],ua:'Mozilla/5.0 Chrome/'+i,headers:browser});
   challenge ||= r.res.scrapeGuardAction==='challenge';block ||= r.res.statusCode===429;
  }
  assert.ok(challenge);assert.ok(block);
  const req=request({path:paths[0],headers:browser});req.method='HEAD';
  const res=response();assert.equal(await guard.handle(req,res,new URL(req.url,'https://airadar.vip')),true);assert.equal(res.statusCode,429);
  for(let i=0;i<150;i++)for(const path of ['/advertise','/assets/sponsor.png'])assert.equal((await hit(guard,{path,headers:browser})).handled,false);
  assert.notEqual(priceSurfaceKey(new URL('https://airadar.vip/?product=a')),priceSurfaceKey(new URL('https://airadar.vip/?product=b')));
 }finally{guard.close();}
});
test('shared personalized cookies and IPv6 /64 enumeration are detected, ordinary cookie movement passes',async()=>{
 const guard=makeGuard({AIRADAR_SCRAPE_CLUSTER_IPS:'100'});
 const token=signVisitor(guard.secret,Date.now());
 try{
  for(let i=0;i<2;i++)assert.equal((await hit(guard,{ip:'198.51.100.'+i,headers:{...browser,cookie:'airadar_hv='+token}})).handled,false);
  let blocked=false;
  for(let i=2;i<20;i++)blocked ||= (await hit(guard,{ip:'198.51.100.'+i,headers:{...browser,cookie:'airadar_hv='+token}})).res.statusCode===429;
  assert.ok(blocked);
  let prefix=false;
  for(let i=0;i<70;i++)prefix ||= (await hit(guard,{ip:'2001:db8:abcd:1234::'+(i+1).toString(16),path:'/prices/p'+i,headers:browser})).handled;
  assert.ok(prefix);
 }finally{guard.close();}
});
test('diagnostics are private, retained by day, and log mode reaches would_block',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'guard-')), logPath=join(dir,'guard');
 writeFileSync(logPath+'.2000-01-01.jsonl','expired');
 const guard=makeGuard({AIRADAR_SCRAPE_GUARD:'log',AIRADAR_SCRAPE_LOG_PATH:logPath});
 try{
  for(let i=0;i<32;i++)await hit(guard,{path:'/prices/p'+i+'?spec=1m&private=do-not-log',headers:{...browser,cookie:'private=never-log'}});
  const files=readdirSync(dir);assert.equal(files.length,1);
  const raw=readFileSync(join(dir,files[0]),'utf8'),rows=raw.trim().split('\n').map(JSON.parse);
  assert.doesNotMatch(raw,/203\.0\.113\.10|never-log|do-not-log/);
  assert.ok(rows.some(row=>row.action==='would_block'));
  assert.equal(rows[0].ipPrefix,'203.0.113.0/24');assert.equal(rows[0].method,'GET');assert.match(rows[0].path,/spec=1m/);assert.match(rows[0].signal,/enumeration/);assert.ok(rows[0].ua.length<=160);
 }finally{guard.close();rmSync(dir,{recursive:true,force:true});}
});
test('verified search and AI crawlers bypass all browser enumeration selectors',async()=>{
 const guard=makeGuard();
 try{for(const [ua,key] of [['GPTBot','openai-gptbot'],['Googlebot','google-common'],['bingbot','bingbot'],['ClaudeBot','anthropic'],['PerplexityBot','perplexitybot']]){
  for(let i=0;i<80;i++)assert.equal((await hit(guard,{ua,ip:networkOf(key),path:'/en/official-prices/p'+i+'?spec='+i,headers:{...browser,referer:'https://airadar.vip/'}})).handled,false);
 }}finally{guard.close();}
});
test('legacy cached cookies cannot bypass per-IP enumeration and cluster exemption can roll back',async()=>{
 const guard=makeGuard({AIRADAR_SCRAPE_BROWSER_CLUSTER:'0'});
 try{
  for(let i=0;i<15;i++)assert.equal((await hit(guard,{ip:'198.51.100.'+i,path:'/prices/p'+i,headers:{...browser,referer:'https://airadar.vip/'}})).handled,false);
  const exp=Math.floor(Date.now()/1000)+1800;
  const token=exp+'.'+createHmac('sha256',guard.secret).update('hv|'+exp).digest('base64url').slice(0,32);
  assert.ok(visitorCookieValid(guard.secret,token,Date.now()));
  let challenge=false;
  for(let i=0;i<30;i++)challenge ||= (await hit(guard,{path:'/prices/p'+i,headers:{...browser,cookie:'airadar_hv='+token}})).handled;
  assert.ok(challenge);
 }finally{guard.close();}
});
