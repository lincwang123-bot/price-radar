import test from 'node:test';
import assert from 'node:assert/strict';
import { retiredCatalogItem, filterCatalogSnapshot } from '../lib/catalog-policy.mjs';
import { classifyDirectOffer, groupDirectOffers } from '../collectors/direct/catalog.mjs';
import { publicOfferAllowed } from '../lib/public-offers.mjs';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createRetention} from '../lib/retention.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {observeMarket,weeklyMarket} from '../lib/retention-market.mjs';

const services = ['OpenAI 哥伦比亚手机号短效接码 SMS', 'Gmail 接马（两次码）', 'gopay GOJEK長效接碼 印尼', 'Codex 短效接🐎 包接到', 'ChatGPT Plus 单次手机验证', 'Receive SMS online', 'OTP phone verification', '短信验证码代收服务', '推广返利10%可提现｜Codex接马｜GPlus接马｜Plus成品号接马｜0.5元起'];
test('retired service titles cannot hide behind subscription or email categories', () => {
  for (const title of services) {
    assert.equal(retiredCatalogItem({title}), true, title);
    assert.equal(classifyDirectOffer({title}), null, title);
    for (const source of ['direct-shops','priceai','ldxp-goods','cardnav-official']) assert.equal(publicOfferAllowed(source,{title}), false, source+title);
  }
  assert.equal(retiredCatalogItem({title:'Gpt/Codex 美国实卡手机号 临时单次',category:'实卡/接码'}),true);
  assert.equal(retiredCatalogItem({product_id:'openai-phone-verification',title:'美国号码'}),true);
  assert.equal(groupDirectOffers(services.map((title,i)=>({title,offerId:String(i),price:5,url:'https://example.org/'+i,status:'in_stock'}))).length,0);
});
test('email accounts and verified-account attributes are not the retired service', () => {
  for (const title of ['Gmail 老号带辅助邮箱','Google个人邮箱 2FA 原手机号链接','ChatGPT Plus 已接码 成品号','Plus 已接马 仅反代','OpenAI Free codex未接码 outlook邮箱','G free账号【双接马】【独立邮箱】','Claude Pro CDK 代充 月卡','Claude KYC认证']) assert.equal(retiredCatalogItem({title}),false,title);
  assert.equal(retiredCatalogItem({title:'ChatGPT Plus 成品号',extra:{deliveryEvidence:{category:'邮箱/接码',description:'本店另售接码服务',descriptionScope:'product_multi'}}}),false);
});
test('future snapshots omit retired products and quotes without mutating source history', () => {
  const snapshot={products:[{productId:'verification-service',name:'接码',offers:[{title:'号码',price:5}]},{productId:'chatgpt-plus',name:'ChatGPT Plus',lowestPrice:1,offers:[{title:'Codex 接码',price:1},{title:'ChatGPT Plus 成品号',price:50}]}]};
  const filtered=filterCatalogSnapshot(snapshot);
  assert.equal(filtered.products.length,1);assert.equal(filtered.products[0].offers.length,1);
  assert.notEqual(filtered.products[0].lowestPrice,1);
  assert.equal(snapshot.products[1].offers.length,2);
});

test('legacy snapshots cannot expose retired products through pages, search, sitemap, market or outbound links', async () => {
  const db=openDb(':memory:');let app;
  const offer=(offerId,title,storeName,price)=>({offerId,title,storeName,price,currency:'CNY',status:'in_stock',url:'https://'+(storeName==='保留店'?'kept':'retired')+'.example.org/'+offerId});
  try {
    // Stored legacy rows deliberately bypass the new ingestion filter.
    for(const source of ['direct-shops','priceai','ldxp-goods']) storeSnapshot(db,{source,snapshotId:'legacy',products:[
      {productId:'openai-phone-verification',name:'OpenAI 接码',offers:[offer('old','号码','退役店',1)]},
      {productId:'verification-service',name:'接码 / 验证服务',offers:[offer('old2','验证码','退役店',1)]},
      {productId:'old-custom-id',name:'短信验证码代收',offers:[offer('custom','美国号码','退役店',1)]},
      {productId:'chatgpt-plus',name:'ChatGPT Plus',currency:'CNY',offers:[offer('hidden','ChatGPT Plus 单次接码','退役店',2),offer('kept','ChatGPT Plus 成品号 1个月','保留店',50)]},
      {productId:'email-accounts',name:'邮箱账号',currency:'CNY',offers:[offer('gmail','Gmail 老号带辅助邮箱','保留店',10),offer('gmail-code','Gmail 接码服务','退役店',1)]}
    ]});
    const before=db.prepare('SELECT COUNT(*) n FROM offers').get().n;
    app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+app.address().port;
    for(const path of ['/','/?family=mail','/?family=chatgpt&product=chatgpt-plus','/?shop_q='+encodeURIComponent('退役店'),'/sitemap.xml','/api/retention/market','/submit']) {
      const res=await fetch(base+path),body=await res.text();assert.equal(res.status,200,path);
      assert.doesNotMatch(body,/openai-phone-verification|verification-service|Gmail 接码服务|Plus 单次接码|邮箱 \/ 接码/,path);
      if(path==='/?family=mail')assert.match(body,/邮箱账号/);
    }
    for(const path of ['/?product=verification-service','/?family=otp']) {
      const res=await fetch(base+path);assert.equal(res.status,410);assert.match(res.headers.get('x-robots-tag'),/noindex/);
    }
    for(const source of ['direct-shops','priceai','ldxp-goods']) for(const [product,offerId] of [['old-custom-id','custom'],['openai-phone-verification','old'],['verification-service','old2'],['chatgpt-plus','hidden'],['email-accounts','gmail-code']]) {
      const out=await fetch(base+'/go?'+new URLSearchParams({source,snapshot:'legacy',product,offer:offerId}),{redirect:'manual'});assert.equal(out.status,404,source+product);assert.equal(out.headers.get('location'),null);
      if(product.includes('verification'))assert.equal((await fetch(base+'/product?'+new URLSearchParams({source,id:product}))).status,404);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n,before,'history remains intact');
  } finally {if(app){await new Promise(r=>app.close(r));await app.merchantWorkflowDone?.();await app.retentionWorkflowDone?.();}db.close();}
});

test('retired historical market groups are not restored to watch choices or weekly reports', () => {
  const db=openDb(':memory:'),privateDb=new DatabaseSync(':memory:');
  try {
    createRetentionStore(privateDb,{secret:'s'.repeat(64)});
    const group={id:'a'.repeat(24),productKey:'verification-service',name:'接码服务',family:'mail',state:'available',price:10,fingerprint:'first'};
    observeMarket(privateDb,{groups:[group]},new Date('2026-09-08T01:00:00Z'));
    observeMarket(privateDb,{groups:[{...group,price:5,fingerprint:'second'}]},new Date('2026-09-09T01:00:00Z'));
    const service=createRetention({db,submissionsDb:privateDb,env:{},now:()=>new Date('2026-09-09T02:00:00Z')});
    const market=service.market();assert.equal(market.groups.length,0);assert.equal(market.products.length,0);
    assert.equal(weeklyMarket(privateDb,market,{now:new Date('2026-09-09T02:00:00Z')}).items.length,0);
    assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM retention_market_daily').get().n,2);
  } finally {privateDb.close();db.close();}
});

test('API and relay retirement catches mixed subscription titles and source-only legacy records', () => {
  for(const title of ['API Cursor Pro 2600积分','Claude-Kiro API KEY 100M Token','100刀Codex API中转额度(纯Pro号池)','AI平台直充100美元额度-Claude Max / 官API','Claude Pro 网页镜像','GPT Pro 中转余额','api Gplus月订阅','Claude 10刀余额充值']){
    assert.equal(retiredCatalogItem({title}),true,title);
    assert.equal(classifyDirectOffer({title}),null,title);
    assert.equal(publicOfferAllowed('priceai',{title},{product_id:'claude-pro'}),false,title);
  }
  for(const title of ['Claude Pro CDK 代充 月卡','ChatGPT Plus 官方月订阅代充 需先余额充值后付款','Cursor Pro 1个月账号 全保（不含API额度）','Cursor Pro 月卡 附API配置教程','Gmail 老号带辅助邮箱','Claude Max 5x 月卡 Max 5x额度'])assert.equal(retiredCatalogItem({title}),false,title);
  assert.equal(publicOfferAllowed('goaihop-relay',{title:'普通套餐'},{product_id:'unexpected-name'}),false);
  assert.equal(filterCatalogSnapshot({source:'goaihop-relay',products:[{productId:'unknown',name:'套餐'}]}).products.length,0);
});

test('retired relay catalog is absent from legacy routes, SEO, sponsors and retention while subscriptions survive', async () => {
 const db=openDb(':memory:');let app;
 try{
  const offer=(id,title,price)=>({offerId:id,title,price,currency:'CNY',status:'in_stock',stockCount:1,storeName:'测试店',url:'https://merchant.example.org/'+id});
  for(const source of ['priceai','direct-shops','ldxp-goods'])storeSnapshot(db,{source,snapshotId:'legacy-api',products:[
   {productId:'api-cdk-credits',name:'API / CDK / 额度',offers:[offer('retired','100刀余额',1)]},
   {productId:'claude-pro',name:'Claude Pro',currency:'CNY',offers:[offer('api','Claude Pro API 100刀额度',1),offer('kept','Claude Pro 代充 1个月',100)]}
  ]});
  storeSnapshot(db,{source:'goaihop-relay',snapshotId:'legacy-api',products:[{productId:'unknown-id',name:'普通套餐',offers:[offer('unknown','入门套餐',0)]}]});
  const before=db.prepare('SELECT COUNT(*) n FROM offers').get().n;
  app=createApp({db});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
  for(const path of ['/','/?family=claude','/?family=claude&product=claude-pro','/?shop_q='+encodeURIComponent('API'),'/sources','/sitemap.xml','/api/retention/market','/advertise','/submit','/submit-shop']){
   const res=await fetch(base+path);const body=await res.text();assert.ok([200,302].includes(res.status),path);
   assert.doesNotMatch(body.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g,''),/data-category="relay"|data-family-filter="relay"|api-cdk-credits|value="api_relay"|Claude Pro API 100刀额度|goaihop-relay/,path);
  }
  for(const path of ['/?family=relay','/?family=api','/?product=api-cdk-credits','/?source=goaihop-relay']){const res=await fetch(base+path);assert.equal(res.status,410,path);assert.match(res.headers.get('x-robots-tag'),/noindex/);}
  for(const source of ['priceai','direct-shops','ldxp-goods','goaihop-relay']){
   const id=source==='goaihop-relay'?'unknown-id':'api-cdk-credits';
   assert.equal((await fetch(base+'/product?'+new URLSearchParams({source,id}))).status,404);
   const res=await fetch(base+'/go?'+new URLSearchParams({source,snapshot:'legacy-api',product:id,offer:source==='goaihop-relay'?'unknown':'retired',ack:'1'}),{redirect:'manual'});assert.equal(res.status,404);assert.equal(res.headers.get('location'),null);
  }
  const kept=await fetch(base+'/go?source=priceai&snapshot=legacy-api&product=claude-pro&offer=kept&ack=1',{redirect:'manual'});assert.equal(kept.status,302);
  const hidden=await fetch(base+'/go?source=priceai&snapshot=legacy-api&product=claude-pro&offer=api&ack=1',{redirect:'manual'});assert.equal(hidden.status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n,before);
 }finally{if(app){await new Promise(r=>app.close(r));await app.merchantWorkflowDone?.();await app.retentionWorkflowDone?.();}db.close();}
});

test('retired source cannot be pulled even if legacy configuration enables it', async () => {
 const {runPull}=await import('../lib/pull.mjs');const {registry,listSources}=await import('../sources/registry.mjs');const {loadConfig}=await import('../lib/config.mjs');
 assert.equal(registry['goaihop-relay'],undefined);assert.equal(listSources().some(s=>s.id==='goaihop-relay'),false);assert.equal(loadConfig().sources['goaihop-relay'].enabled,false);
 let called=false;registry['goaihop-relay']={pull:()=>{called=true;throw Error('must not call')}};
 const db=openDb(':memory:');try{const results=await runPull({db,config:{sources:{'goaihop-relay':{enabled:true}}},dataDir:'/dev/null',log:()=>{}},['goaihop-relay']);assert.equal(called,false);assert.deepEqual(results,[]);}finally{delete registry['goaihop-relay'];db.close();}
});

test('bottom sponsor invitation names suitable businesses and all quote cells lead to owner Telegram', async () => {
 const {sponsorInvite,sponsorAdvertiseContent}=await import('../lib/sponsor-ui.mjs');
 for(const placement of ['home','category','product']){
  const invite=sponsorInvite(placement);assert.match(invite,/云服务器、IP 服务、网络检测、域名与开发者工具/);assert.match(invite,/href="https:\/\/t.me\/lincwang"/);
  const html=sponsorAdvertiseContent(new URL('https://airadar.vip/advertise?placement='+placement));
  const rates=html.match(/<section class="sponsor-rates">[\s\S]*?<\/section>/)[0];
  assert.equal((rates.match(/href="https:\/\/t.me\/lincwang" target="_blank" rel="noopener noreferrer"/g)||[]).length,9);
  assert.doesNotMatch(rates,/¥|￥/);assert.match(html,/class="sponsor-starter sponsor-fit"/);
 }
});
