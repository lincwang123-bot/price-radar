import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {loadSponsorRuntimeConfig,resetSponsorRuntimeConfigCache,runtimeSponsorAsset} from '../lib/sponsor-runtime-config.mjs';
import {reviewedSponsorDestination} from '../lib/sponsor-destinations.mjs';
import {sponsorBrandCreative} from '../lib/sponsor-brand-creatives.mjs';
import {websiteSponsorOffer} from '../lib/outbound.mjs';
import {saveAdminSponsor} from '../lib/sponsor-service.mjs';
import {openDb} from '../lib/db.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
import {sponsorBlock} from '../lib/sponsor-ui.mjs';

const fixture=new URL('./fixtures/sponsor-runtime.json',import.meta.url).pathname;
const destination='https://tracker.example.test/shared/reviewed';
const campaign={source:'sponsor-websites',merchant_id:'domain:merchant.example.test',destination_url:destination,product_id:'website',offer_id:'merchant.example.test',placement:'sponsored_home',page_key:'home',version:1};

test('runtime configuration is optional, exact, validated and rendered',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'sponsor-runtime-'));
 const previousConfig=process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG,previousAssets=process.env.AIRADAR_SPONSOR_ASSET_DIR;
 const db=openDb(':memory:'),analytics=openAnalytics(':memory:','fictional-runtime-test-signing-value');
 let app;
 try{
  delete process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;delete process.env.AIRADAR_SPONSOR_ASSET_DIR;resetSponsorRuntimeConfigCache();
  assert.equal(reviewedSponsorDestination(destination),null);
  assert.equal(websiteSponsorOffer(campaign),null);
  assert.equal(sponsorBrandCreative(campaign),null);
  assert.equal(runtimeSponsorAsset('/assets/runtime.png'),null);
  for(const [name,body] of [['empty',''],['invalid','{'],['typo','{"creative":[]}'],['entries','{"destinations":[null,5,{}],"creatives":[null,5,{}]}']]){
   const path=join(directory,name+'.json');writeFileSync(path,body);process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=path;
   assert.doesNotThrow(()=>reviewedSponsorDestination(destination));
   assert.equal(sponsorBrandCreative(campaign),null);
  }
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=join(directory,'missing.json');
  assert.deepEqual(loadSponsorRuntimeConfig(),{destinations:[],creatives:[]});
  app=createApp({db,analytics});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.address().port;
  for(const configPath of [undefined,join(directory,'missing.json'),join(directory,'empty.json')]){
   if(configPath===undefined)delete process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;else process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=configPath;
   resetSponsorRuntimeConfigCache();
   assert.equal((await fetch(base+'/')).status,200);
   const advertise=await fetch(base+'/advertise');assert.equal(advertise.status,200);
   assert.match(await advertise.text(),/广告合作|获取报价|赞助/);
   assert.equal((await fetch(base+'/assets/unknown.png')).status,404);
   assert.equal((await fetch(base+'/assets/runtime.png')).status,404);
  }
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=fixture;process.env.AIRADAR_SPONSOR_ASSET_DIR=directory;resetSponsorRuntimeConfigCache();
  assert.equal(loadSponsorRuntimeConfig().creatives.length,1);
  assert.equal(reviewedSponsorDestination(destination).merchantId,campaign.merchant_id);
  assert.equal(websiteSponsorOffer(campaign).website_url,'https://merchant.example.test/');
  assert.equal(websiteSponsorOffer({...campaign,destination_url:'https://tracker.example.test/shared/other'}),null);
  assert.equal(reviewedSponsorDestination(destination,'domain:brand.example.test'),null);
  assert.equal(sponsorBrandCreative({...campaign,page_key:'other'}),null);
  const png=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();
  writeFileSync(join(directory,'runtime.png'),png);
  writeFileSync(join(directory,'runtime.webp'),await sharp(png).webp().toBuffer());
  writeFileSync(join(directory,'unlisted.png'),png);
  const local=t=>new Date(t+8*3600000).toISOString().slice(0,16);
  saveAdminSponsor(db,analytics,{action:'approve',campaign_kind:'website',destination_url:destination,placement:'home',label:'Fictional sponsor',reviewed:'true',version:'0',start_at:local(Date.now()-60000),end_at:local(Date.now()+86400000),amount_cny:'0',theme:'violet'},'fixture');
  const html=await (await fetch(base+'/')).text();
  assert.match(html,/Runtime artwork/);assert.match(html,/src="\/assets\/runtime.png"/);
  assert.match(html,/联系商家/);
  const card=html.slice(html.indexOf('sponsor-brand-card'),html.indexOf('sponsor-brand-card')+1800);
  assert.match(card,/source srcset="\/assets\/runtime.webp" type="image\/webp"/);
  assert.match(card,/width="16" height="16"/);
  assert.match(card,/loading="eager"/);assert.match(card,/fetchpriority="high"/);assert.doesNotMatch(card,/loading="lazy"/);
  assert.match(card,/alt="Fictional creative"/);
  assert.match(card,/Fictional offer/);
  const contactPath=html.match(/href="([^"]*\/sponsor\/contact[^"]*)"/)[1].replaceAll('&amp;','&');
  const contact=await fetch(base+contactPath,{redirect:'manual'});
  assert.equal(contact.status,302);assert.equal(contact.headers.get('location'),'https://brand.example.test/contact');
  const updated=structuredClone(loadSponsorRuntimeConfig());
  updated.creatives[0].title='Updated runtime artwork';delete updated.creatives[0].telegram;
  const updatedPath=join(directory,'updated.json');writeFileSync(updatedPath,JSON.stringify(updated));
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=updatedPath;
  const updatedHtml=sponsorBlock([{campaign,offer:websiteSponsorOffer(campaign),href:'/go'}]);
  assert.match(updatedHtml,/Updated runtime artwork/);assert.doesNotMatch(updatedHtml,/sponsor-telegram-button/);
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=fixture;
  for(const [name,type] of [['runtime.png','image/png'],['runtime.webp','image/webp']]){
   const response=await fetch(base+'/assets/'+name);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);assert.equal(response.headers.get('cache-control'),'public, max-age=86400');
   const body=Buffer.from(await response.arrayBuffer()),meta=await sharp(body).metadata();
   assert.equal(meta.width,16);assert.equal(meta.height,16);
   const head=await fetch(base+'/assets/'+name,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),'public, max-age=86400');assert.equal(await head.text(),'');
  }
  for(const path of ['/assets/%2e%2e%2fruntime.png','/assets/nested/runtime.png','/assets/unlisted.png'])assert.equal((await fetch(base+path)).status,404);
  rmSync(join(directory,'runtime.png'));symlinkSync(join(directory,'unlisted.png'),join(directory,'runtime.png'));
  assert.equal((await fetch(base+'/assets/runtime.png')).status,404);
  process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=join(directory,'invalid.json');
  assert.equal((await fetch(base+'/')).status,200);
 }finally{
  if(app?.listening)await new Promise(resolve=>app.close(resolve));
  analytics.close();db.close();rmSync(directory,{recursive:true,force:true});
  if(previousConfig===undefined)delete process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG;else process.env.AIRADAR_SPONSOR_RUNTIME_CONFIG=previousConfig;
  if(previousAssets===undefined)delete process.env.AIRADAR_SPONSOR_ASSET_DIR;else process.env.AIRADAR_SPONSOR_ASSET_DIR=previousAssets;
  resetSponsorRuntimeConfigCache();
 }
});
