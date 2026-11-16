import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewApp,reviewPayload} from './fixtures/shop-review-app.mjs';
import {merchantReviewHref,merchantStoreLinks} from '../lib/merchant-x-ui.mjs';

test('directory review action sits below the outbound shop button and opens the exact shop reviews',async()=>{
 const f=await reviewApp();try{
  const html=await(await f.get('/prices/chatgpt-plus')).text();
  const row=html.match(/<article class="directory-quote"[\s\S]*?<\/article>/)?.[0];assert.ok(row);
  const [main,buy]=row.split('<div class="directory-quote-buy">');assert.ok(buy);
  assert.doesNotMatch(main,/店铺与评价|directory-review-button/);assert.match(main,/我是店主 · 认领 X 账号/);
  assert.ok(buy.indexOf('>前往店铺')<buy.indexOf('class="directory-review-button"'));
  assert.ok(buy.indexOf('class="directory-review-button"')<buy.indexOf('class="directory-history"'));
  assert.match(buy,new RegExp('class="directory-review-button" href="/shop\\?id='+f.shop.id+'#reviews"'));
  assert.match(buy,/查看评价/);assert.match(buy,/data-review-count="0"/);
  assert.equal((row.match(/class="directory-review-button"/g)||[]).length,1);
  const target=await f.get('/shop?id='+f.shop.id);assert.equal(target.status,200);const targetHtml=await target.text();assert.match(targetHtml,/id="reviews"/);assert.match(targetHtml,/真实经历，彼此参考。感谢你为下一位购买者提供有用的信息。/);
  const offer={source:'direct-shops',url:'https://review.example/product/1',storeName:'演示店铺',extra:{shopUrl:'https://review.example/'}};
  assert.equal(merchantReviewHref(offer),'/shop?id='+f.shop.id+'#reviews');
  assert.match(merchantStoreLinks(offer),/店铺与评价/);assert.equal(merchantStoreLinks(offer,{showClaim:false,showShop:false}),'');
  assert.equal(merchantReviewHref({url:'javascript:alert(1)'}),'');
  assert.equal(merchantReviewHref({source:'ldxp-goods',url:'https://wzyp.cn/'}),'');
 }finally{await f.close();}
});

test('published review counts update immediately across quote buttons, legacy offers and shop search',async()=>{
 const f=await reviewApp();try{
  const paths=['/prices/chatgpt-plus','/?shop_q=review.example'];
  const check=async count=>{for(const path of paths){const response=await f.get(path,'airadar_nocache=1');assert.equal(response.status,200);const html=await response.text();assert.match(html,new RegExp('data-review-count="'+count+'"'),path);assert.doesNotMatch(html,new RegExp('data-review-count="'+(count?0:1)+'"'),path);}};
  await check(0);const a=await f.reader(70),input=reviewPayload(f.shop),r=(await(await f.post('submit',input,a)).json()).result;await check(0);
  const admin=await f.admin();assert.equal((await f.adminPost('/admin/reviews/'+r.id,{csrf:admin.csrf,version:r.version,action:'publish',confirmed:'true',purchaseConfirmed:'true'},admin.cookie)).status,303);await check(1);
  const own=(await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,a.cookie)).json()).own;f.advance(61000);
  assert.equal((await f.post('submit',{...input,version:own.version,experience:'追加评价：售后跟进后已经恢复正常，这里记录我自己的使用经历。'},a)).status,200);await check(0);
 }finally{await f.close();}
});

test('review HTTP boundary requires verified email, same-origin CSRF and private owner-scoped state, not password',async()=>{
 const f=await reviewApp();try{
  const a=await f.reader(1),b=await f.reader(2),legacy=await f.reader(3,{passwordSet:false}),input=reviewPayload(f.shop);
  const state=await f.get('/api/shop-reviews/state?shop='+f.shop.id);assert.equal(state.status,200);assert.match(state.headers.get('cache-control'),/no-store/);assert.deepEqual(await state.json(),{signedIn:false,canSubmit:false,canReply:false,own:null,reports:[],replies:[]});
  assert.equal((await f.post('submit',input,a,{Origin:'https://attacker.test'})).status,403);
  assert.equal((await f.post('submit',input,a,{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.post('submit',input,a,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.post('submit',input,{cookie:a.cookie.replace(/airadar_reader=[^;]+; /,''),csrf:a.csrf})).status,401);
  assert.equal((await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,legacy.cookie)).json()).canSubmit,true);
  assert.equal((await f.post('submit',input,legacy)).status,200);
  assert.equal((await f.get('/api/shop-reviews/submit')).status,405);
  assert.equal((await f.post('submit',input,a,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.post('submit',{...input,evidence:'a'.repeat(17000)},a)).status,413);
  const res=await f.post('submit',{...input,accountId:b.id,status:'published'},a);assert.equal(res.status,200);const r=(await res.json()).result;assert.equal(r.status,'pending');
  const own=await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,a.cookie)).json();assert.equal(own.own.id,r.id);
  const other=await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,b.cookie)).json();assert.equal(other.own,null);
  assert.equal((await f.post('withdraw',{id:r.id,version:r.version},b)).status,404);
  assert.equal((await f.get('/admin/reviews/'+r.id,a.cookie)).status,303);
  const html=await(await f.get('/shop?id='+f.shop.id)).text();assert.match(html,/用户评价/);assert.ok(!html.includes(input.experience));assert.ok(!html.includes(input.evidence));assert.ok(!html.includes(a.email));
  for(const asset of ['shop-reviews.js','shop-reviews.css'])assert.equal((await f.get('/assets/'+asset)).status,200);
 }finally{await f.close();}
});

test('admin publish -> public -> edit re-review -> appeal -> resolution -> account erasure works end to end',async()=>{
 const f=await reviewApp();try{
  const a=await f.reader(1),b=await f.reader(2),input=reviewPayload(f.shop),r=(await(await f.post('submit',input,a)).json()).result,admin=await f.admin();
  const path='/admin/reviews/'+r.id,fields={csrf:admin.csrf,version:r.version,action:'publish'};
  const before=await(await f.get('/prices/chatgpt-plus')).text();
  assert.equal((await f.adminPost(path,{...fields,confirmed:'true'},admin.cookie,{Origin:'https://attacker.test'})).status,403);
  assert.equal((await f.adminPost(path,{...fields,csrf:'bad',confirmed:'true'},admin.cookie)).status,403);
  assert.equal((await f.adminPost(path,fields,admin.cookie)).status,422);
  assert.equal((await f.adminPost(path,{...fields,confirmed:'true',purchaseConfirmed:'true'},admin.cookie)).status,303);
  const html=await(await f.get('/shop?id='+f.shop.id)).text();assert.ok(html.includes(input.experience));assert.ok(!html.includes(input.evidence));assert.ok(!html.includes(a.email));
  const after=await(await f.get('/prices/chatgpt-plus')).text();assert.deepEqual([...after.matchAll(/data-price="([^"]+)"/g)].map(m=>m[1]),[...before.matchAll(/data-price="([^"]+)"/g)].map(m=>m[1]));
  const state=await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,a.cookie)).json();
  const report=(await(await f.post('report',{id:r.id,version:state.own.version,reason:'fake',details:'交付时间存在异议，请核对公开说明与评价内容。'},b)).json()).result;
  assert.ok((await(await f.get('/shop?id='+f.shop.id)).text()).includes(input.experience));
  const resolved=await f.adminPost('/admin/review-reports/'+report.id,{csrf:admin.csrf,version:1,decision:'dismiss',note:'未找到明确违规依据，保留用户评价。'},admin.cookie);assert.equal(resolved.status,303);assert.equal(resolved.headers.get('location'),path);
  assert.match(JSON.stringify(await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,b.cookie)).json()),/未找到明确违规依据/);
  f.advance(61000);const revised={...input,version:state.own.version,experience:'追加记录：客服已完成售后处理，目前正常使用。<script>alert(1)</script>'};
  const updated=(await(await f.post('submit',revised,a)).json()).result;assert.equal(updated.status,'pending');assert.ok(!(await(await f.get('/shop?id='+f.shop.id)).text()).includes(input.experience));
  assert.equal((await f.adminPost(path,{...fields,confirmed:'true'},admin.cookie)).status,409);
  assert.equal((await f.adminPost(path,{...fields,version:updated.version,action:'reject',reason:'other',note:'请补充所述变更发生的具体时间。'},admin.cookie)).status,303);
  const current=await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,a.cookie)).json();assert.equal(current.own.status,'rejected');
  assert.equal((await f.post('report',{id:r.id,version:current.own.version,reason:'appeal',details:'变更发生在今天下午，愿补充脱敏说明，请重新核对。'},a)).status,200);
  assert.equal((await f.adminPost(path,{...fields,version:current.own.version,confirmed:'true',purchaseConfirmed:'true'},admin.cookie)).status,303);
  const safeHtml=await(await f.get('/shop?id='+f.shop.id)).text();assert.match(safeHtml,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.ok(!safeHtml.includes('<script>alert(1)</script>'));
  const deleted=await fetch(f.base+'/api/retention/delete-account',{method:'POST',headers:{Origin:f.base,Cookie:a.cookie,'Content-Type':'application/json','X-CSRF-Token':a.csrf},body:'{}'});assert.equal(deleted.status,200);
  const row=f.privateDb.prepare('SELECT * FROM shop_reviews WHERE id=?').get(r.id);assert.equal(row.status,'erased');assert.equal(row.experience,'');assert.equal(row.evidence,'');assert.equal(row.account_id,null);
  assert.equal(f.privateDb.prepare('SELECT * FROM retention_accounts WHERE id=?').get(a.id),undefined);
  assert.ok(!(await(await f.get('/shop?id='+f.shop.id)).text()).includes(revised.experience));
 }finally{await f.close();}
});
