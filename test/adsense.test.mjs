import test from 'node:test';
import assert from 'node:assert/strict';
import {adsenseConfig} from '../lib/adsense.mjs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

// Syntax fixtures only; never contact Google or deploy these account values.
const verify = {ADSENSE_MODE:'verify',ADSENSE_PUBLISHER_ID:'pub-1234567890123456'};
const pilot = {...verify,ADSENSE_MODE:'guide',ADSENSE_GUIDE_SLOT:'1234567890',ADSENSE_PILOT_READY:'true'};
const guide = '/guides/chatgpt-plus-delivery';
async function withApp(env, run) {
  const db=openDb(':memory:'),app=createApp({db,adsenseEnv:env});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  try {await run(`http://127.0.0.1:${app.address().port}`);}
  finally {await new Promise(r=>app.close(r));await app.merchantWorkflowDone?.();await app.retentionWorkflowDone?.();db.close();}
}

test('missing or malformed configuration fails closed; verification cannot enable ads',()=>{
  for(const env of [{}, {...pilot,ADSENSE_MODE:'off'}, {...pilot,ADSENSE_MODE:'typo'}, {...pilot,ADSENSE_PUBLISHER_ID:''}, {...pilot,ADSENSE_PUBLISHER_ID:'pub-0000000000000000'}, {...pilot,ADSENSE_PUBLISHER_ID:'pub-1234567890123456"><script>'}]){
    const config=adsenseConfig(env);assert.equal(config.publisher,'');assert.equal(config.live,false);
  }
  assert.equal(adsenseConfig({...verify,ADSENSE_GUIDE_SLOT:'123',ADSENSE_PILOT_READY:'true'}).live,false);
  assert.equal(adsenseConfig({...pilot,ADSENSE_PILOT_READY:'false'}).live,false);
  assert.equal(adsenseConfig({...pilot,ADSENSE_PILOT_READY:''}).live,false);
  assert.equal(adsenseConfig({...pilot,ADSENSE_GUIDE_SLOT:'123" onclick="bad'}).live,false);
  assert.equal(adsenseConfig({...verify,ADSENSE_PUBLISHER_ID:' ca-pub-1234567890123456 '}).publisher,verify.ADSENSE_PUBLISHER_ID);
  assert.equal(adsenseConfig(pilot).live,true);
});

test('default public pages expose publisher information without Google code or empty ad space',()=>withApp({},async origin=>{
  for(const path of ['/', '/about', '/contact', '/privacy', '/guides', guide]){
    const response=await fetch(origin+path);assert.equal(response.status,200,path);const html=await response.text();
    assert.doesNotMatch(html,/google-adsense-account|adsbygoogle|class="guide-ad"|pagead2\.googlesyndication/);
    assert.match(html,/href="\/about"/);assert.match(html,/href="\/privacy"/);assert.match(html,/href="\/contact"/);assert.match(html,/mailto:hello@airadar\.vip/);
    if(path==='/about'){
      assert.match(html,/把订阅信息放在一起/);assert.match(html,/rel="canonical" href="https:\/\/airadar.vip\/about"/);
      assert.equal([...html.matchAll(/<h1\b/g)].length,1);
      for(const link of ['/sources','/help/data-and-ranking','/advertise','/guides','/contact'])assert.ok(html.includes(`href="${link}"`));
      assert.match(html,/mailto:hello@airadar\.vip/);
    }
    if(path==='/contact'){
      assert.match(html,/联系本站/);assert.match(html,/rel="canonical" href="https:\/\/airadar.vip\/contact"/);
      assert.equal([...html.matchAll(/<h1\b/g)].length,1);
      assert.match(html,/mailto:hello@airadar\.vip/);
      assert.match(html,/hello@airadar\.vip/);
    }
    if(path==='/privacy'){assert.match(html,/准备接入 Google AdSense/);assert.match(html,/若启用第三方广告/);assert.match(html,/Cookie、设备标识/);assert.match(html,/直接赞助/);}
  }
  const map=await(await fetch(origin+'/sitemap.xml')).text();assert.match(map,/<loc>https:\/\/airadar.vip\/about<\/loc>/);assert.match(map,/<loc>https:\/\/airadar.vip\/contact<\/loc>/);
  const slash=await fetch(origin+'/about/',{redirect:'manual'});assert.equal(slash.status,301);assert.equal(slash.headers.get('location'),'/about');
  const contactSlash=await fetch(origin+'/contact/',{redirect:'manual'});assert.equal(contactSlash.status,301);assert.equal(contactSlash.headers.get('location'),'/contact');
  assert.equal((await fetch(origin+'/about',{method:'POST'})).status,405);
  const head=await fetch(origin+'/about',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(origin+'/ads.txt')).status,404);
}));

test('verification publishes the supplied identity and ads.txt while advertising stays inactive',()=>withApp(verify,async origin=>{
  for(const path of ['/', '/about', '/contact', '/privacy', '/guides', guide]){
    const html=await(await fetch(origin+path)).text();
    assert.match(html,/<head>[\s\S]*<meta name="google-adsense-account" content="ca-pub-1234567890123456">[\s\S]*<\/head>/);
    assert.doesNotMatch(html,/adsbygoogle|class="guide-ad"|pagead2\.googlesyndication/);
    if(path==='/privacy'){assert.match(html,/已配置 Google AdSense 网站归属验证/);assert.match(html,/准备接入广告/);assert.match(html,/不加载 Google 广告脚本/);assert.match(html,/若启用第三方广告/);assert.doesNotMatch(html,/永不启用/);}
  }
  const response=await fetch(origin+'/ads.txt');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/plain/);
  assert.equal(await response.text(),'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  const head=await fetch(origin+'/ads.txt',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const post=await fetch(origin+'/ads.txt',{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
}));

test('ready pilot renders one unit after a real guide, never on directories, help, private or error pages',()=>withApp(pilot,async origin=>{
  const html=await(await fetch(origin+guide+'?utm_source=x')).text();
  assert.equal([...html.matchAll(/<ins class="adsbygoogle"/g)].length,1);
  assert.equal([...html.matchAll(/<script async src="https:\/\/pagead2\.googlesyndication/g)].length,1);
  assert.ok(html.indexOf('<aside class="guide-ad"')>html.indexOf('</article>'));
  assert.ok(html.indexOf('<aside class="guide-ad"')<html.indexOf('</main>'));
  assert.match(html,/data-ad-slot="1234567890"/);assert.match(html,/href="\/privacy#google-advertising"/);
  for(const path of ['/', '/?family=chatgpt', '/about', '/privacy', '/guides', '/help', '/help/compare-prices', '/advertise', '/official-prices', '/login', '/following', '/claim-shop', '/submit', '/guides/missing', '/shop?id=invalid', '/admin']){
    const response=await fetch(origin+path),body=await response.text();
    assert.doesNotMatch(body,/adsbygoogle|class="guide-ad"|pagead2\.googlesyndication/,path);
    if(['/login','/following','/claim-shop','/submit','/guides/missing','/shop?id=invalid','/admin'].includes(path))assert.doesNotMatch(body,/google-adsense-account/,path);
    if(path==='/privacy'){assert.match(body,/展示 Google AdSense 广告/);assert.match(body,/合作伙伴可能接收 IP/);assert.match(body,/非个性化广告也可能/);assert.match(body,/若启用第三方广告/);assert.doesNotMatch(body,/尚未启用 Google 广告/);assert.doesNotMatch(body,/永不启用/);}
  }
}));
