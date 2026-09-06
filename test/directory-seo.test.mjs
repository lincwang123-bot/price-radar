import test from 'node:test';
import assert from 'node:assert/strict';
import {decorateSeo} from '../lib/seo.mjs';

const db={prepare(){throw new Error('A directory without quote links must not invent product schema from the database');}};
const render=(query,attributes='')=>decorateSeo(`<html><head><title>目录</title></head><body><section ${attributes}></section></body></html>`,new URL('https://airadar.vip/'+query),db);
const canonical=html=>html.match(/rel="canonical" href="([^"]+)"/)?.[1];
const schema=html=>JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);

test('brand directory keeps its canonical identity while stripping secondary filters',()=>{
 const html=render('?family=claude&q=test&channel=independent&spec=month&utm_source=example','data-directory-family="claude"');
 assert.equal(canonical(html),'https://airadar.vip/?family=claude');
 assert.match(html,/<title>Claude产品目录与公开报价/);
 assert.ok(!schema(html).some(item=>item['@type']==='ItemList'));
 for(const family of ['grok','x','mail','relay','cursor','other'])assert.equal(canonical(render('?family='+family,`data-directory-family="${family}"`)),'https://airadar.vip/?family='+family);
});

test('only a renderer-confirmed selected product gets a product directory canonical',()=>{
 const attrs='data-directory-family="claude" data-directory-product="claude-pro" data-directory-product-name="Claude Pro"';
 const html=render('?family=claude&product=claude-pro&sort=price&channel=all',attrs);
 assert.equal(canonical(html),'https://airadar.vip/?family=claude&amp;product=claude-pro');
 assert.match(html,/<title>Claude Pro公开报价与规格/);
 assert.match(html,/<meta name="description" content="查看Claude Pro多家店铺的公开报价/);
 assert.equal(schema(html)[1].url,'https://airadar.vip/?family=claude&product=claude-pro');
 assert.equal(canonical(render('?family=claude&product=missing',attrs)),'https://airadar.vip/?family=claude');
 assert.equal(canonical(render('?family=claude&product=claude-pro','data-directory-family="claude"')),'https://airadar.vip/?family=claude');
});

test('unknown or unrendered families canonicalize to root without query-derived metadata',()=>{
 for(const [query,attrs] of [['?family=claude',''],['?family=made-up','data-directory-family="made-up"'],['?family=claude','data-directory-family="gemini"'],['?product=claude-pro','']]){
  const html=render(query,attrs);
  assert.equal(canonical(html),'https://airadar.vip/');
  assert.ok(!schema(html).some(item=>item['@type']==='ItemList'));
 }
});

test('rendered escaped product labels remain escaped and structured data remains valid',()=>{
 const html=render('?family=other&product=custom-product','data-directory-family="other" data-directory-product="custom-product" data-directory-product-name="A &amp; B &lt;/script&gt;"');
 assert.match(html,/<title>A &amp; B &lt;\/script&gt;公开报价/);
 assert.equal(schema(html)[1].name,'A & B </script>公开报价与规格 · AI订阅价格雷达');
});
