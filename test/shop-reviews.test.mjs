import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createShopReviews} from '../lib/shop-reviews.mjs';

const purchaseWebp=await sharp({create:{width:32,height:32,channels:3,background:'#445566'}}).webp().toBuffer();
const purchaseImage={data:purchaseWebp,mime:'image/webp',width:32,height:32,sha256:createHash('sha256').update(purchaseWebp).digest('hex')};

export function reviewFixture(){
 const db=openSubmissionsDb(':memory:');let time=new Date('2026-09-10T08:00:00Z');
 const store=createRetentionStore(db,{secret:'review-test-secret-'.repeat(4),now:()=>time});
 const shop={id:'a'.repeat(24),identity:'domain:review.example',name:'测试店铺',url:'https://review.example/',entries:[]};
 const account=(n,email=`reader${n}@example.com`,created='2026-09-01T00:00:00Z')=>{
  const id=String(n).padStart(32,'0');db.prepare('INSERT OR IGNORE INTO retention_accounts VALUES(?,?,?,0)').run(id,email,created);
  return db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(id);
 };
 const raw=createShopReviews({db,digest:store.digest,shopById:id=>id===shop.id?shop:null,now:()=>time});
 const service={...raw,submit:(value,input,opts={})=>raw.submit(value,input,{...opts,purchaseImages:opts.purchaseImages===undefined?[purchaseImage]:opts.purchaseImages})};
 return {db,store,shop,account,service,advance:ms=>{time=new Date(+time+ms);},close:()=>db.close()};
}
export const reviewInput=(f,overrides={})=>({shopId:f.shop.id,version:0,rating:2,product:'ChatGPT Plus',delivery:'recharge',experience:'购买一个月代充，等了两小时才到账，客服有回复。',evidence:'仅后台可见的交易经过说明',consent:true,...overrides});
const publish=(f,r)=>f.service.moderate(r.id,{action:'publish',version:r.version,confirmed:true,purchaseConfirmed:true},{actor:'test-admin'});

test('published counts are shop-scoped, batchable and exclude pending, hidden, withdrawn and erased reviews',()=>{
 const f=reviewFixture();try{
  const other='b'.repeat(24),ids=[f.shop.id,other,f.shop.id,'invalid'];
  assert.deepEqual([...f.service.publicCounts(ids)],[[f.shop.id,0],[other,0]]);
  const a=f.account(1),b=f.account(2),first=f.service.submit(a,reviewInput(f)),second=f.service.submit(b,reviewInput(f));
  assert.equal(f.service.publicCounts(ids).get(f.shop.id),0);publish(f,first);publish(f,second);
  assert.equal(f.service.publicCounts(ids).get(f.shop.id),2);assert.equal(f.service.publicCounts([other]).get(other),0);
  let current=f.service.own(a,f.shop.id);f.service.moderate(current.id,{action:'hide',version:current.version,reason:'privacy',note:'请移除未经打码的私人信息。'});
  assert.equal(f.service.publicCounts(ids).get(f.shop.id),1);current=f.service.own(b,f.shop.id);f.service.withdraw(b,{id:current.id,version:current.version});assert.equal(f.service.publicCounts(ids).get(f.shop.id),0);
  publish(f,f.service.own(a,f.shop.id));assert.equal(f.service.publicCounts(ids).get(f.shop.id),1);f.service.eraseAccount(a);assert.equal(f.service.publicCounts(ids).get(f.shop.id),0);
  assert.equal(f.service.publicCounts([null,undefined,'?']).size,0);
 }finally{f.close();}
});

test('reviews stay private until explicit moderation; public DTO never exposes private fields',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),r=f.service.submit(a,reviewInput(f),{client:'client-1'});
  assert.equal(r.status,'pending');assert.equal(f.service.publicList(f.shop.id).total,0);
  assert.throws(()=>f.service.moderate(r.id,{action:'publish',version:r.version}),e=>e.status===422);
  publish(f,r);const data=f.service.publicList(f.shop.id);
  assert.equal(data.total,1);assert.equal(data.items[0].rating,2);
  const output=JSON.stringify(data);for(const hidden of [a.email,a.id,'仅后台','client-1','author_key','evidence','risk'])assert.ok(!output.includes(hidden),hidden);
 }finally{f.close();}
});
test('one account/shop, stale writes rejected, idempotent retry and edited text must be moderated again',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),input=reviewInput(f),r=f.service.submit(a,input,{client:'one'});
  assert.equal(f.service.submit(a,input,{client:'one'}).id,r.id);
  publish(f,r);const own=f.service.own(a,f.shop.id);
  assert.throws(()=>f.service.submit(a,{...input,experience:'这是一段不同的购买体验，希望店家改进响应速度。'}),e=>e.status===409);
  f.advance(61000);
  const updated=f.service.submit(a,{...input,version:own.version,rating:4,experience:'追加体验：客服后来完成了处理，已经正常使用三天。'});
  assert.equal(updated.id,r.id);assert.equal(updated.status,'pending');assert.equal(f.service.publicList(f.shop.id).total,0);
  assert.throws(()=>publish(f,r),e=>e.status===409);
  publish(f,updated);assert.equal(f.service.publicList(f.shop.id).total,1);
  assert.ok(f.service.detail(r.id).history.length>=3);
 }finally{f.close();}
});
test('known merchant cannot rate own shop; other users cannot edit or withdraw a review',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),b=f.account(2),r=f.service.submit(a,reviewInput(f));
  assert.throws(()=>f.service.withdraw(b,{id:r.id,version:r.version}),e=>e.status===404);
  const s=createShopReviews({db:f.db,digest:f.store.digest,shopById:()=>f.shop,isMerchant:(account)=>account.id===b.id});
  assert.throws(()=>s.submit(b,reviewInput(f)),e=>e.status===403);
 }finally{f.close();}
});
test('rating is validated strictly, affiliation/consent and meaningful experience required',()=>{
 const f=reviewFixture();try{
  const a=f.account(1);
  for(const changes of [{rating:0},{rating:6},{rating:1.5},{rating:'5'},{consent:false},{experience:'好评'},{delivery:'bad'},{product:''},{shopId:'b'.repeat(24)},{version:-1},{website:'bot'},{experience:'密码：my-secret-123 这是不能提交的私人凭据。'}])assert.throws(()=>f.service.submit(a,reviewInput(f,changes)));
  assert.throws(()=>f.service.submit(null,reviewInput(f)),e=>e.status===401);
 }finally{f.close();}
});
test('review write rate limits, network flags and private evidence expiry are enforced',()=>{
 const f=reviewFixture();try{
  const a=f.account(1);let r=f.service.submit(a,reviewInput(f),{client:'network'});
  assert.throws(()=>f.service.submit(a,reviewInput(f,{version:r.version,experience:'补充内容：希望店家尽快处理，当前仍然等待开通。'})),e=>e.status===429);
  for(let n=1;n<5;n++){f.advance(61000);r=f.service.submit(a,reviewInput(f,{version:r.version,experience:'这是一份追加的具体使用体验，当前记录编号为 '+n+'。'}),{client:'network'});}
  f.advance(61000);assert.throws(()=>f.service.submit(a,reviewInput(f,{version:r.version,experience:'今天已经提交五次，不能继续刷入更多修改记录。'})),e=>e.status===429);
  for(let n=2;n<5;n++)f.service.submit(f.account(n),reviewInput(f,{experience:'不同用户记录各自体验，当前内容编号为 '+n+'。'}),{client:'network'});
  const last=f.service.own(f.account(4),f.shop.id);assert.ok(f.service.detail(last.id).risk.includes('shared_network'));
  f.advance(91*86400000);f.service.purge();assert.equal(f.service.detail(r.id).evidence,'');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM shop_review_events').get().n,0);
  assert.ok(!JSON.stringify(f.service.detail(r.id).history).includes('仅后台可见'));
 }finally{f.close();}
});
test('risk signals apply equally to positive and negative reviews and do not publish or convict',()=>{
 const f=reviewFixture();try{
  const text='一个月代充已经完成，描述与实际一致，记录这次具体使用体验。';
  f.service.submit(f.account(1),reviewInput(f,{rating:5,experience:text}),{client:'shared-network'});
  const r=f.service.submit(f.account(2,'new@example.com','2026-09-10T07:50:00Z'),reviewInput(f,{rating:1,experience:text}),{client:'shared-network'});
  const flags=f.service.detail(r.id).risk;
  assert.ok(flags.includes('new_account'));assert.ok(flags.includes('similar_content'));
  assert.equal(f.service.publicList(f.shop.id).total,0);
  publish(f,r);assert.equal(f.service.publicList(f.shop.id).total,1);
 }finally{f.close();}
});
test('Gmail dot/plus aliases share one author key; account ID is never accepted from request',()=>{
 const f=reviewFixture();try{
  const a=f.account(1,'shop.reader+one@gmail.com'),b=f.account(2,'shopreader+two@googlemail.com');
  const r=f.service.submit(a,reviewInput(f));assert.equal(f.service.own(b,f.shop.id).id,r.id);
  assert.throws(()=>f.service.submit(b,reviewInput(f,{experience:'另一个别名不能再次对同家店提交第二条独立评价。'})),e=>e.status===409);
 }finally{f.close();}
});
test('reports are private and idempotent, cannot auto-hide; admin outcome does not mutate the rating',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),b=f.account(2),r=f.service.submit(a,reviewInput(f));publish(f,r);
  const input={id:r.id,version:f.service.own(a,f.shop.id).version,reason:'fake',details:'我认为内容与事实不符，请站方核对交付时间。'};
  const ticket=f.service.report(b,input,{client:'reporter'});
  assert.equal(f.service.report(b,input).id,ticket.id);assert.equal(f.service.publicList(f.shop.id).total,1);
  assert.throws(()=>f.service.resolveReport(ticket.id,{version:1,decision:'dismiss',note:''}),e=>e.status===422);
  f.service.resolveReport(ticket.id,{version:1,decision:'dismiss',note:'现有资料不足以确认违规，评价保留。'},{actor:'admin'});
  assert.equal(f.service.myReports(b,f.shop.id)[0].reply,'现有资料不足以确认违规，评价保留。');assert.equal(f.service.publicList(f.shop.id).total,1);
  assert.throws(()=>f.service.resolveReport(ticket.id,{version:1,decision:'handled',note:'重复处理会被版本锁拒绝。'}),e=>e.status===409);
 }finally{f.close();}
});
test('reject/hide require a policy reason and explanation; author can appeal but cannot republish',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),r=f.service.submit(a,reviewInput(f));
  assert.throws(()=>f.service.moderate(r.id,{action:'reject',version:1,note:'不喜欢差评'}),e=>e.status===422);
  const rejected=f.service.moderate(r.id,{action:'reject',version:1,reason:'privacy',note:'请先移除文字中的第三方联系方式。'},{actor:'admin'});
  const appeal=f.service.report(a,{id:r.id,version:rejected.version,reason:'appeal',details:'这条评价没有第三方联系方式，请重新核对。'});
  assert.ok(appeal.id);assert.equal(f.service.publicList(f.shop.id).total,0);
  publish(f,rejected);const current=f.service.own(a,f.shop.id);
  f.service.withdraw(a,{id:r.id,version:current.version});assert.equal(f.service.publicList(f.shop.id).total,0);
  assert.throws(()=>f.service.moderate(r.id,{action:'publish',version:f.service.own(a,f.shop.id).version,confirmed:true}),e=>e.status===422);
 }finally{f.close();}
});
test('account erasure removes review text and evidence, leaves only minimal audit and anti-duplication tombstone',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),r=f.service.submit(a,reviewInput(f));publish(f,r);
  f.service.eraseAccount(a);
  assert.equal(f.service.publicList(f.shop.id).total,0);
  const d=f.service.detail(r.id);assert.equal(d.status,'erased');assert.equal(d.experience,'');assert.equal(d.evidence,'');
  assert.ok(d.history.every(h=>!h.payload||h.payload==='{}'));
  assert.throws(()=>f.db.prepare('DELETE FROM shop_review_actions').run());
 }finally{f.close();}
});
test('pagination is bounded and distinct shops are never merged',()=>{
 const f=reviewFixture();try{
  const a=f.account(1),r=f.service.submit(a,reviewInput(f));publish(f,r);
  assert.equal(f.service.publicList('b'.repeat(24)).total,0);
  assert.equal(f.service.publicList(f.shop.id,{page:'NaN'}).page,1);
  assert.equal(f.service.publicList(f.shop.id,{page:'9999999999999'}).page,1);
 }finally{f.close();}
});
