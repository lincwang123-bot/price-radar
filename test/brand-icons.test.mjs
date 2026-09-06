import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {brandMark} from '../lib/brand-icons.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('brand marks use local hashed decorative assets, generic categories are not brand logos',()=>{
  for(const brand of ['ChatGPT','Claude','Gemini','Grok','X','Suno','Cursor','Perplexity','Notion AI','Manus','Microsoft']) {
    const html=brandMark(brand);
    assert.match(html,/^<img class="brand-logo" src="\/assets\/brands\/[a-z]+\.(?:svg|png)\?v=[a-f0-9]{16}" width="24" height="24" alt="" aria-hidden="true">$/);
    const file=/\/assets\/brands\/([^?]+)/.exec(html)[1];
    const svg=readFileSync(new URL('../assets/brands/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(svg,/<(?:script|foreignObject)\b|\son[a-z]+\s*=/i);
    for(const match of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)/gi))assert.ok(/^(?:#|data:image\/(?:png|jpeg);base64,)/.test(match[1]),`${file}: embedded raster or local fragment only`);
    assert.doesNotMatch(svg,/@import|url\(\s*["']?https?:/i);
  }
  for(const key of ['relay','mail','other','<img onerror=x>'])assert.match(brandMark(key),/^<svg class="brand-generic"/);
  assert.doesNotMatch(brandMark('Claude','" onerror="alert(1)'),/class="[^"]*" onerror=/);
});
test('static brand allowlist GET HEAD cache and MIME remain isolated from HTML routes',async()=>{
  const db=openDb(':memory:'),app=createApp({db});
  try {
    await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
    const src=/src="([^"]+)"/.exec(brandMark('ChatGPT'))[1];
    const get=await fetch(base+src),body=Buffer.from(await get.arrayBuffer());
    assert.equal(get.status,200);assert.equal(get.headers.get('content-type'),'image/svg+xml');assert.equal(get.headers.get('x-content-type-options'),'nosniff');assert.match(get.headers.get('cache-control'),/immutable/);
    assert.equal(get.headers.get('content-security-policy'),"default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    assert.deepEqual(body,readFileSync(new URL('../assets/brands/chatgpt.svg',import.meta.url)));
    assert.equal(new URL(src,base).searchParams.get('v'),createHash('sha256').update(body).digest('hex').slice(0,16));
    const head=await fetch(base+src,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(Number(head.headers.get('content-length')),body.length);
    for(const path of ['/assets/brands/unknown.svg','/assets/brands/%2e%2e%2fweb.mjs','/assets/brands/chatgpt.svg/extra','/assets/brands/sources.md'])assert.equal((await fetch(base+path)).status,404,path);
    assert.equal((await fetch(base+src,{method:'POST'})).status,405);
    assert.doesNotMatch((await fetch(base+'/assets/brands/chatgpt.svg?v=wrong')).headers.get('cache-control'),/immutable/);
  } finally {if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
test('navigation category headings product rows and detail title share official brand image',async()=>{
  const db=openDb(':memory:'),app=createApp({db}),now=new Date().toISOString();
  try {
    storeSnapshot(db,{source:'priceai',snapshotId:'brands',fetchedAt:now,products:[{productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',offers:[{offerId:'brand-qa',title:'Claude Pro 代充 1个月',price:120,status:'in_stock',stockCount:2,currency:'CNY',url:'https://16688.com.cn/goods/brand-qa',capturedAt:now}]}]});
    await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
    const html=await(await fetch(base+'/')).text();
    assert.match(html,/<h2 class="directory-category-title"><img[^>]*claude[^>]*>Claude<\/h2>/);
    assert.match(html,/<h3><img[^>]*claude[^>]*>Claude Pro<\/h3>/);
    assert.match(html,/data-family-filter="claude"[^>]*><span[^>]*><img[^>]*claude/);
    assert.match(html,/class="category-more-menu">[\s\S]*suno\.(?:svg|png)/);
    assert.doesNotMatch(html,/platform-wordmark" aria-hidden="true">AI/);
    const detail=await(await fetch(base+'/?family=claude&product=claude-pro')).text();assert.match(detail,/<h1><img[^>]*claude[^>]*>Claude Pro<\/h1>/);assert.match(detail,/前往店铺/);
  }finally{if(app.listening){app.closeAllConnections();await new Promise(r=>app.close(r));}db.close();}
});
