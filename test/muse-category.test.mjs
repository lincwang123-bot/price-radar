import {verifyApplicationPhone} from './helpers/merchant-phone.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {classifyDirectOffer,groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {offerSpec} from '../lib/offer-spec.mjs';
import {openDb,storeSnapshot,productsOfSnapshot} from '../lib/db.mjs';
import {projectProduct} from '../lib/quote-policy.mjs';
import {DIRECTORY_CATEGORIES,buildProductDirectory,directoryQuotes} from '../lib/product-directory.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';
import {openSubmissionsDb,createSubmission} from '../lib/submissions.mjs';
import {createMerchantApplication,getMerchantApplication,convertSupplySubmission,reviewMerchantApplication} from '../lib/merchant-onboarding.mjs';
import {queueMerchantPreflight,latestMerchantPreflight} from '../lib/merchant-preflight-store.mjs';
import {readApprovedManifest,collectApprovedMerchants} from '../lib/merchant-collection.mjs';
import {merchantIdentityForUrl} from '../lib/merchant-identity.mjs';
import {createApp} from '../lib/web.mjs';

const now=new Date('2026-10-17T12:00:00Z');
const quote=(title,id,patch={})=>({offerId:id,title,storeName:'Muse Fixture Shop',sourceId:'muse-fixture',price:100,currency:'CNY',status:'in_stock',stockCount:3,url:'https://muse-merchant.example.com/item/'+id,...patch});
const titles={month:'Muse Power 代充 1个月 新开续费均可',year:'Muse Power 代充 12个月 新开续费均可',account:'Muse Power 成品号 1个月',max:'Muse Maximum 成品号 1个月',unknown:'Muse Power 会员'};

test('Muse retail classification requires an explicit brand and supported tier or supplied-account evidence',()=>{
  assert.ok(DIRECTORY_CATEGORIES.some(row=>row.key==='muse'&&row.label==='Muse'));
  for(const [title,id] of [
    [titles.month,'muse-power'],['MUSE POWER monthly recharge','muse-power'],
    ['Muse Max 月卡成品号','muse-max'],['Muse Maximum 12 months account','muse-max'],
    ['Muse Ai【含10亿token】成品号','muse-account-10b'],['Muse Ai【含310亿token】成品号','muse-account-300b'],['Muse 成品号 300亿 token','muse-account-300b'],['Muse account 1B tokens','muse-account-10b'],['Muse AI成品310亿token（类似于SuperGroK bot）','muse-account-300b'],['muse 50亿 token 成品号','muse-account'],['Muse 成品号 10亿&300亿 token','muse-account'],['Muse AI成品号','muse-account'],
  ])assert.equal(classifyDirectOffer({title})?.id,id,title);
  for(const title of [
    'Power 月卡代充','Max 月卡成品号','Maximum 月卡','Muse 月卡',
    'Muse Code Power 月卡','Muse Spark Max 月卡','Muse Power API 中转 100美元额度',
    'Muse Maximum 余额充值','Muse Power 视频托管 hosting 套餐',
    'Muse Ai 邀请码','Muse Ai token 充值服务','Muse Ai 代刷成品号','Muse Ai 接码服务',
    'Museum Power 月卡','amusement Max 月卡','Muse Power + Maximum 组合套餐',
    'Muse Power / Muse Max 月卡','Muse Power + Claude Pro 代充',
    'ChatGPT Plus + Muse Maximum 成品号',
    'Muse Power 20美元额度 月卡','Muse Maximum 充值 1000 积分 月卡',
    'Muse Power / Pro 月卡代充','Muse Power 非会员 普通账号','Muse Maximum 仅开通资格服务',
    'Muse account X Premium 月卡','Muse account Twitter Premium 月卡','Muse account Codex 1个月',
    'Muse Power X Premium 月卡',
  ])assert.equal(classifyDirectOffer({title,category:'Muse',price:20}),null,title);
});

test('real Muse Ai token-bearing account titles are collected without guessing a paid tier or subscription period',()=>{
  const offers=[quote('Muse Ai【含10亿token】成品号','account-10'),quote('Muse Ai【含310亿token】成品号','account-310')];
  const grouped=groupDirectOffers(offers);
  assert.equal(grouped.length,2);assert.deepEqual(grouped.map(g=>g.productId).sort(),['muse-account-10b','muse-account-300b']);
  assert.ok(grouped.every(g=>g.offers.length===1));
  const specs=offers.map(offer=>offerSpec(offer,{product_id:'muse-account'}));
  for(const spec of specs){
    assert.equal(spec.known,false);assert.equal(spec.comparison_eligible,false);
    assert.equal(spec.delivery_kind,'account');assert.equal(spec.purchase_conditions.subscriptionTerm,'unknown');
    assert.doesNotMatch(spec.key,/:power:|:max:/);
  }
  assert.notEqual(specs[0].key,specs[1].key,'10 亿 tokens and 310 亿 tokens must not share a comparison identity');
  assert.equal(summarizeMerchantOffers(offers,{now:+now}).validCount,2);
  const unspecified=[10,310].map(n=>offerSpec(quote(`Muse Ai ${n}亿成品号 月卡`,'unqualified-'+n),{product_id:'muse-account'}));
  assert.ok(unspecified.every(spec=>!spec.known));
  assert.notEqual(unspecified[0].key,unspecified[1].key);
});

test('Muse comparison specs preserve tier, purchased duration and delivery without borrowing the official billing period',()=>{
  const spec=title=>offerSpec({title,currency:'CNY'},{product_id:classifyDirectOffer({title})?.id});
  const month=spec(titles.month),year=spec(titles.year),account=spec(titles.account),maximum=spec(titles.max);
  for(const row of [month,year,account,maximum])assert.equal(row.known,true);
  assert.equal(month.purchase_conditions.subscriptionTerm,'1m');
  assert.equal(year.purchase_conditions.subscriptionTerm,'12m');
  assert.equal(month.delivery_kind,'recharge');assert.equal(account.delivery_kind,'account');
  assert.equal(new Set([month.key,year.key,account.key,maximum.key]).size,4);
  assert.equal(spec('Muse Max 成品号 1个月').key,maximum.key,'Max is an alias of Maximum, not a third plan');
  for(const title of [titles.unknown,'Muse Power 代充','Muse Maximum 1个月','Muse Power 代充 质保30天']){
    const row=spec(title);assert.equal(row.known,false,title);assert.equal(row.comparison_eligible,false,title);
  }
  assert.equal(spec('Muse Power 代充').purchase_conditions.subscriptionTerm,'unknown');
  assert.equal(spec('Muse Power 代充 质保30天').purchase_conditions.subscriptionTerm,'unknown');
});

test('real preview and SQLite directory projection retain Muse quotes while isolating specs and excluding unrelated products',()=>{
  const offers=Object.entries(titles).map(([id,title])=>quote(title,id));
  offers.push(quote('Muse Code Power 月卡','code'),quote('Muse Power 余额充值','balance'),quote('Muse Power 视频托管','video'));
  const summary=summarizeMerchantOffers(offers,{now:+now});
  assert.equal(summary.rawCount,8);assert.equal(summary.validCount,5);
  assert.equal(summary.diagnostics.items[5].reasonCodes[0],'classification_unmatched');
  const db=openDb(':memory:');
  try{
    const snapshot={source:'direct-shops',snapshotId:'muse-directory-fixture',fetchedAt:now.toISOString(),products:groupDirectOffers(offers)};
    storeSnapshot(db,snapshot);
    const products=productsOfSnapshot(db,snapshot.source,snapshot.snapshotId).map(product=>projectProduct(db,snapshot.source,{snapshot_id:snapshot.snapshotId,fetched_at:snapshot.fetchedAt,stale:0},product,{now:+now}));
    const directory=buildProductDirectory([{...snapshot,products}]);
    const muse=directory.find(row=>row.key==='muse');
    assert.deepEqual(muse.products.map(row=>row.key),['muse-power','muse-max']);
    const power=muse.products.find(row=>row.key==='muse-power'),maximum=muse.products.find(row=>row.key==='muse-max');
    const quotes=directoryQuotes(power);
    assert.equal(quotes.total,4);assert.equal(directoryQuotes(maximum).total,1);
    assert.equal(quotes.specs.length,3,'unknown delivery and term stay visible but do not create a comparable spec');
    assert.equal(quotes.shopCount,1);
    assert.equal(directoryQuotes(power,{delivery:'recharge'}).total,2);
    assert.equal(directoryQuotes(power,{delivery:'account'}).total,1);
    const month=quotes.entries.find(row=>row.offer.offer_id==='month');
    const sameSpec=directoryQuotes(power,{spec:month.offer.comparison_key});
    assert.deepEqual(sameSpec.entries.map(row=>row.offer.offer_id),['month']);
    assert.equal(quotes.entries.find(row=>row.offer.offer_id==='unknown').offer.comparison_known,false);
    assert.equal(directory.flatMap(row=>row.products).flatMap(product=>directoryQuotes(product).entries).length,5);
  }finally{db.close();}
});

test('Muse merchant and supply intake survive conversion, validated preflight approval and public manifest projection',t=>{
  const db=openSubmissionsDb(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'muse-intake-'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const fields={shopName:'Muse Fixture Shop',shopUrl:'https://muse-merchant.example.com/',platform:'auto',email:'owner@example.org',contact:'owner@example.org',productAreas:['muse'],details:'Muse 公开商品目录与订阅交付说明',consent:true};
  const created=createMerchantApplication(db,fields,{now});
  assert.deepEqual(getMerchantApplication(db,created.id).productAreas,['muse']);
  const supply=createSubmission(db,{kind:'cooperation',topic:'supply',subject:'Muse 订阅供货',details:'Muse Power 与 Maximum 的公开供货信息',contextUrl:'https://muse-supply.example.com/',contact:'supply@example.org',consent:true,metadata:{productArea:'muse',scale:'small',assurance:'conditional',settlement:'cny'}},{now});
  assert.equal(db.prepare('SELECT product_area FROM cooperation_submissions WHERE public_id=?').get(supply.id).product_area,'muse');
  const converted=convertSupplySubmission(db,supply.id,{...fields,shopUrl:'https://muse-supply.example.com/',ownershipConfirmed:true,permissionConfirmed:true,note:'已核对申请人提供的公开目录许可'},{actor:'fixture-reviewer',now});
  assert.deepEqual(getMerchantApplication(db,converted.id).productAreas,['muse']);
  const request=queueMerchantPreflight(db,created.id,{expectedVersion:1,actor:'fixture-reviewer'},{bridgeDir:dir,resultsDir:dir,now});
  const app=getMerchantApplication(db,created.id),result=summarizeMerchantOffers([quote(titles.month,'verified')],{now:+now});
  writeFileSync(path.join(dir,request.id+'.json'),JSON.stringify({schemaVersion:1,id:request.id,applicationId:created.id,applicationVersion:1,identity:app.identity,startedAt:request.requestedAt,checkedAt:request.requestedAt,status:'ready',message:'本次已读取到有效商品样例',...result}));
  assert.equal(latestMerchantPreflight(db,created.id,{bridgeDir:dir,resultsDir:dir,now}).canApprove,true);
  verifyApplicationPhone(db,created.id);
  const approved=reviewMerchantApplication(db,created.id,{action:'approve',actor:'fixture-reviewer',expectedVersion:1},{bridgeDir:dir,resultsDir:dir,now,notify:false});
  assert.equal(approved.status,'approved');assert.equal(approved.identityVerifiedAt,null);
  const manifest=readApprovedManifest(dir);
  assert.equal(manifest.valid,true);assert.equal(manifest.merchants.length,1);
  assert.equal(manifest.merchants[0].identity,app.identity);
  assert.doesNotMatch(readFileSync(path.join(dir,'approved.json'),'utf8'),/owner@example|supply@example|公开商品目录与订阅交付说明/);
});

test('approved merchant collection reads Muse from the existing public Dujiao adapter and reports only eligible catalog items',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'muse-collection-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const shopUrl='https://muse-merchant.example.com/',identity=merchantIdentityForUrl(shopUrl);
  const merchant={id:'merchant-'+createHash('sha256').update(identity).digest('hex').slice(0,16),identity,shopName:'Muse Fixture Shop',shopUrl,platform:'independent',status:'approved',version:1,approvedAt:now.toISOString(),identityVerifiedAt:null};
  writeFileSync(path.join(dir,'approved.json'),JSON.stringify({schemaVersion:1,merchants:[merchant]}));
  const calls=[],catalog=[titles.month,titles.max,'Muse Code Power 月卡','Museum Power 月卡'];
  const ctx={dataDir:dir,merchantBridgeDir:dir,sleep:async()=>{},merchantFetchFactory:()=>async url=>{
    calls.push(url);
    if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
    if(url===shopUrl)return new Response('not found',{status:404});
    assert.match(url,/\/api\/v1\/public\/products\?/);
    return new Response(JSON.stringify({status_code:200,data:catalog.map((title,i)=>({id:i+1,title,skus:[{id:i+1,price_amount:100+i,auto_stock_available:3}]})),pagination:{total:4,total_page:1,page:1}}),{headers:{'content-type':'application/json'}});
  }};
  const result=await collectApprovedMerchants(ctx,{manifest:readApprovedManifest(dir),capturedAt:new Date().toISOString()});
  assert.equal(result.health[0].status,'active');assert.equal(result.health[0].validCount,2);
  assert.deepEqual(groupDirectOffers(result.offers).map(row=>row.productId).sort(),['muse-max','muse-power']);
  assert.equal(calls[0],shopUrl+'robots.txt');
  for(const offer of result.offers){assert.equal(offer.extra.merchantIdentity,identity);assert.equal(new URL(offer.url).origin,new URL(shopUrl).origin);}
});

test('Muse category and both plan pages work in Chinese and English without fabricating shops, then render collected quotes',async()=>{
  const db=openDb(':memory:'),app=createApp({db});
  try{
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+app.address().port;
    const get=async route=>{const response=await fetch(origin+route,{headers:{cookie:'airadar_nocache=1'}});assert.equal(response.status,200,route);return response.text();};
    for(const prefix of ['','/en']){
      const category=await get(prefix+'/?family=muse');
      assert.match(category,/data-directory-product="muse-power"/);assert.match(category,/data-directory-product="muse-max"/);
      for(const [key,name] of [['muse-power','Muse Power'],['muse-max','Muse Maximum']]){
        const html=await get(prefix+'/prices/'+key);
        assert.match(html,new RegExp('<h1[^>]*>[\\s\\S]*?'+name));
        assert.match(html,new RegExp('data-official-baseline="'+key+'"'));
        assert.doesNotMatch(html,/data-directory-quote /);
        assert.match(html,prefix?/No current merchant quotes/:/暂无有效报价/);
      }
    }
    for(const table of ['snapshots','products','offers'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
    const offers=[quote(titles.month,'power-month',{price:88}),quote(titles.account,'power-account',{price:66}),quote(titles.max,'maximum',{price:388})];
    storeSnapshot(db,{source:'direct-shops',snapshotId:'muse-web-fixture',fetchedAt:new Date().toISOString(),products:groupDirectOffers(offers)});
    for(const prefix of ['','/en']){
      const power=await get(prefix+'/prices/muse-power');
      assert.equal((power.match(/data-directory-quote /g)||[]).length,2);
      assert.match(power,/data-price="88"/);assert.match(power,/data-price="66"/);assert.doesNotMatch(power,/data-price="388"/);
      const filtered=await get(prefix+'/prices/muse-power?delivery=recharge');
      assert.equal((filtered.match(/data-directory-quote /g)||[]).length,1);assert.match(filtered,/data-price="88"/);
      const maximum=await get(prefix+'/prices/muse-max');
      assert.equal((maximum.match(/data-directory-quote /g)||[]).length,1);assert.match(maximum,/data-price="388"/);
    }
  }finally{
    app.closeAllConnections();if(app.listening)await new Promise(resolve=>app.close(resolve));
    await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();
  }
});

test('Muse token split pages compare one explicit allowance and keep mixed titles in the fallback',()=>{
  const spec=title=>offerSpec({title,currency:'CNY'},{product_id:classifyDirectOffer({title})?.id});
  const a=spec('Muse AI 成品号 10亿token'),b=spec('Muse 词元10亿 普通成品号'),c=spec('Muse Ai 独享成品号（310亿token）'),d=spec('Muse 成品号 300亿 token');
  for(const row of [a,b,c,d]){assert.equal(row.known,true);assert.equal(row.comparison_eligible,true);assert.notEqual(row.purchase_conditions.quality,'C');}
  assert.equal(a.key,b.key);assert.equal(c.key,d.key,'300 亿 and 310 亿 share the 300 亿+ page identity');assert.notEqual(a.key,c.key);
  for(const t of ['Muse 成品号 10亿&300亿 token','muse 50亿 token 成品号','Muse 20亿 成品号']){const r=spec(t);assert.equal(classifyDirectOffer({title:t})?.id,'muse-account',t);assert.equal(r.comparison_eligible,false,t);}
  for(const t of ['Muse邀请助力30次 300亿词元成品号','Muse AI 代刷310亿词元','Muse Ai 接码 10亿 成品号'])assert.equal(classifyDirectOffer({title:t}),null,t);
});
