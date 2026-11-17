import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sponsorBrandCreative} from '../lib/sponsor-brand-creatives.mjs';
import {resetSponsorRuntimeConfigCache} from '../lib/sponsor-runtime-config.mjs';
import {sponsorPagePath,sponsorContactHref} from '../lib/sponsor-tracking.mjs';

test('sponsor page path keeps only canonical surfaces',()=>{
 const home={placement:'sponsored_home',page_key:'home'};
 assert.equal(sponsorPagePath('/',home),'/');
 assert.equal(sponsorPagePath('/catalog',home),'/catalog');
 assert.equal(sponsorPagePath('/?utm=1',home),'/');
 assert.equal(sponsorPagePath('/?family=chatgpt&product=chatgpt-plus',home),'');
 const category={placement:'sponsored_category',page_key:'chatgpt'};
 assert.equal(sponsorPagePath('/?family=chatgpt',category),'/?family=chatgpt');
 assert.equal(sponsorPagePath('/?family=claude',category),'');
 const product={placement:'sponsored_product',page_key:'chatgpt-plus',source:'sponsor-websites',product_id:'website'};
 assert.equal(sponsorPagePath('/prices/chatgpt-plus',product),'/prices/chatgpt-plus');
 assert.equal(sponsorPagePath('/prices/chatgpt-plus?page=2',product),'/prices/chatgpt-plus');
 assert.equal(sponsorContactHref({id:'SP-1'},'tok'),'/sponsor/contact?campaign=SP-1&token=tok');
 assert.equal(sponsorContactHref({id:'SP-1'},''),'');
});

test('gateway keeps HTML no-store and lets static images use origin cache headers',()=>{
 const conf=readFileSync(new URL('./fixtures/gateway-cache-headers.conf',import.meta.url),'utf8');
 const image=conf.slice(conf.indexOf('location ~* ^/assets/'),conf.indexOf('location @radar_busy'));
 assert.match(image,/png\|jpe\?g\|webp\|gif\|svg\|ico/);
 assert.doesNotMatch(image,/no-store/);
 assert.match(image,/proxy_pass http:\/\/radar_web_keepalive/);
 const pages=conf.slice(conf.indexOf('location / {'));
 assert.match(pages,/add_header Cache-Control "no-store" always/);
 assert.match(pages,/proxy_ignore_headers Cache-Control Expires/);
});


test('brand creative uses only exact runtime matches',()=>{
 const directory=mkdtempSync(join(tmpdir(),'sponsor-brand-'));
 const previous=process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;
 const config=JSON.parse(readFileSync(new URL('./fixtures/sponsor-runtime.json',import.meta.url),'utf8'));
 const creative=config.creatives[0];
 const campaign={source:creative.source,merchant_id:creative.merchant_id,destination_url:creative.destinations[0],placement:creative.placement,page_key:creative.page_key};
 try{
  delete process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;resetSponsorRuntimeConfigCache();
  assert.equal(sponsorBrandCreative(campaign),null);
  const path=join(directory,'config.json');writeFileSync(path,JSON.stringify(config));
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=path;resetSponsorRuntimeConfigCache();
  assert.deepEqual(sponsorBrandCreative(campaign),creative);
  for(const change of [
   {source:'direct-shops'},
   {merchant_id:'domain:other.example.test'},
   {destination_url:campaign.destination_url+'?extra=1'},
   {placement:'sponsored_product'},
   {page_key:'other'},
  ])assert.equal(sponsorBrandCreative({...campaign,...change}),null);
  delete creative.placement;delete creative.page_key;
  writeFileSync(path,JSON.stringify(config));resetSponsorRuntimeConfigCache();
  assert.deepEqual(sponsorBrandCreative({...campaign,placement:'sponsored_product',page_key:'other'}),creative);
 }finally{
  if(previous===undefined)delete process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;else process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=previous;
  resetSponsorRuntimeConfigCache();rmSync(directory,{recursive:true,force:true});
 }
});
