import test from 'node:test';
import assert from 'node:assert/strict';
import {openAnalytics} from '../lib/analytics.mjs';
import {PRICE_PRODUCTS} from '../lib/price-routes.mjs';
const now=new Date('2026-10-11T08:00:00Z');
const request=url=>({method:'GET',url,socket:{remoteAddress:'127.0.0.1'},headers:{'cf-connecting-ip':'203.0.113.1','user-agent':'Mozilla/5.0 Chrome/150 Safari/537.36','sec-fetch-dest':'document'}});
test('supported Chinese and English public pages each record one view without widening private routes',()=>{
 const a=openAnalytics(':memory:','test-secret-more-than-thirty-two-characters',{now});
 try{
  let count=0;
  for(const url of ['/catalog','/about','/en/','/en/catalog','/en/official-prices','/en/shop?id=fixture','/en/about','/en/sources',...PRICE_PRODUCTS.map(p=>'/en'+p.path)]){
   a.record(request(url),200,now);assert.equal(a.report(30,now).pv,++count,url);
  }
  for(const url of ['/en/admin','/en/admin/login','/en/api/submissions','/en/health','/en/assets/main.js','/en/prices/unknown','/en/arbitrary','/en/product','/en/alerts','/en/weekly','/en/privacy','/en/guides/unknown']){
   a.record(request(url),200,now);assert.equal(a.report(30,now).pv,count,url);
  }
  a.record({...request('/en/'),method:'HEAD'},200,now);a.record(request('/en/'),404,now);a.record(request('/en/'),307,now);
  a.record({...request('/en/'),headers:{...request('/en/').headers,'user-agent':'Mozilla/5.0 Googlebot'}},200,now);
  a.record({...request('/en/'),headers:{...request('/en/').headers,cookie:'airadar_admin=private'}},200,now);
  assert.equal(a.report(30,now).pv,count);assert.equal(a.report(30,now).uv,1);
 }finally{a.close();}
});
