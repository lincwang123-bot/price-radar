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
 for(const family of ['grok','x','mail','cursor','other'])assert.equal(canonical(render('?family='+family,`data-directory-family="${family}"`)),'https://airadar.vip/?family='+family);
});

test('only a renderer-confirmed selected product gets a product directory canonical',()=>{
 const attrs='data-directory-family="claude" data-directory-product="claude-pro" data-directory-product-name="Claude Pro"';
 const html=render('?family=claude&product=claude-pro&sort=price&channel=all',attrs);
 assert.equal(canonical(html),'https://airadar.vip/prices/claude-pro');
 assert.match(html,/<title>Claude Pro 月付价格比较：账号、地区与续费条件/);
 assert.match(html,/<meta name="description" content="比较 Claude Pro 月度订阅公开报价/);
 assert.equal(schema(html)[1].url,'https://airadar.vip/prices/claude-pro');
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


test('high intent landing metadata distinguishes Plus, Claude and each official Pro tier',()=>{
 const titles=new Set(),descriptions=new Set();
 for(const [key,name,family] of [['chatgpt-plus','ChatGPT Plus','chatgpt'],['claude-pro','Claude Pro','claude'],['chatgpt-pro-5x','ChatGPT Pro 100','chatgpt'],['chatgpt-pro-20x','ChatGPT Pro 200','chatgpt'],['chatgpt-pro-25x','ChatGPT Pro 500','chatgpt']]){
  const html=render('?family='+family+'&product='+key,`data-directory-family="${family}" data-directory-product="${key}" data-directory-product-name="${name}"`);
  const title=html.match(/<title>(.*?)<\/title>/)[1],description=html.match(/name="description" content="([^"]+)"/)[1];
  assert.ok(title.includes(name));assert.ok(description.includes(name));assert.doesNotMatch(title,/Pro (?:5x|20x|25x)/);
  titles.add(title);descriptions.add(description);
 }
 assert.equal(titles.size,5);assert.equal(descriptions.size,5);
});
