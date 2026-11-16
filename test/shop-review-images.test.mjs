import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {prepareReviewImages,REVIEW_IMAGE_BYTES} from '../lib/shop-review-images.mjs';
import {reviewApp,reviewPayload} from './fixtures/shop-review-app.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createShopReviews} from '../lib/shop-reviews.mjs';

async function photo(format='png',color='#3b8164',metadata=false){
 let pipeline=sharp({create:{width:240,height:160,channels:3,background:color}});
 if(metadata)pipeline=pipeline.withMetadata({exif:{IFD0:{Artist:'synthetic-private-metadata'}}});
 const data=await pipeline[format]().toBuffer();return {dataUrl:'data:image/'+format+';base64,'+data.toString('base64')};
}
test('review images decode allowed raster types, strip metadata and enforce bounds',async()=>{
 for(const format of ['jpeg','png','webp']){
  const [image]=await prepareReviewImages([await photo(format,'#608561',format==='jpeg')]);
  assert.equal(image.mime,'image/webp');assert.equal(image.width,240);assert.equal(image.height,160);
  const meta=await sharp(image.data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.equal(meta.xmp,undefined);assert.equal(meta.icc,undefined);
  assert.ok(!image.data.includes(Buffer.from('synthetic-private-metadata')));
 }
 const wide=await sharp({create:{width:2400,height:800,channels:3,background:'white'}}).png().toBuffer();const [resized]=await prepareReviewImages([{dataUrl:'data:image/png;base64,'+wide.toString('base64')}]);assert.equal(resized.width,1600);
 const image=await photo();
 for(const input of [null,{},[image,image,image,image],[{dataUrl:'data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')}],[{dataUrl:'data:image/png;base64,'+Buffer.from('<svg onload="alert(1)"/>').toString('base64')}],[{dataUrl:image.dataUrl.replace('image/png','image/jpeg')}],[{dataUrl:'data:image/png;base64,invalid!'}],[{dataUrl:'data:image/png;base64,'+Buffer.alloc(REVIEW_IMAGE_BYTES+1).toString('base64')}],[{id:'a'.repeat(32),dataUrl:image.dataUrl}]])await assert.rejects(prepareReviewImages(input),e=>e.status===422);
 const large=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(prepareReviewImages([{dataUrl:'data:image/png;base64,'+large.toString('base64')}]),e=>e.status===422);
 const frames=Buffer.concat([Buffer.alloc(32*32*3,255),Buffer.alloc(32*32*3,40)]),animation=await sharp(frames,{raw:{width:32,height:64,channels:3,pageHeight:32}}).webp({delay:[100,100],loop:0}).toBuffer();
 assert.equal((await sharp(animation).metadata()).pages,2);await assert.rejects(prepareReviewImages([{dataUrl:'data:image/webp;base64,'+animation.toString('base64')}]),e=>e.status===422&&/动图/.test(e.message));
 assert.deepEqual(await prepareReviewImages([{id:'a'.repeat(32)}]),[{id:'a'.repeat(32)}]);
});

test('image lifecycle: owner/admin only before moderation, public after approval, edit/hide/withdraw/erase revoke access',async()=>{
 const f=await reviewApp();try{
  const a=await f.reader(21),b=await f.reader(22),admin=await f.admin(),input={...reviewPayload(f.shop),images:[await photo('png'),await photo('jpeg','#346db1')]};
  const submitted=await f.post('submit',input,a);assert.equal(submitted.status,200);let r=(await submitted.json()).result;assert.equal(r.status,'pending');assert.equal(r.images.length,2);
  const originalIds=r.images.map(i=>i.id),url=r.images[0].url;
  assert.equal((await f.get(url)).status,404);assert.equal((await f.get(url,b.cookie)).status,404);
  const ownImage=await f.get(url,a.cookie);assert.equal(ownImage.status,200);assert.equal(ownImage.headers.get('content-type'),'image/webp');assert.match(ownImage.headers.get('cache-control'),/no-store/);assert.equal(ownImage.headers.get('x-content-type-options'),'nosniff');assert.equal(ownImage.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal((await f.get('/admin/review-images/'+originalIds[0])).status,303);assert.equal((await f.get('/admin/review-images/'+originalIds[0],admin.cookie)).status,200);
  let adminPage=await f.get('/admin/reviews/'+r.id,admin.cookie);assert.match(adminPage.headers.get('content-security-policy'),/img-src 'self'/);assert.match(await adminPage.text(),/评价配图 · 2 张|逐张查看全部配图/);
  const approve=()=>f.adminPost('/admin/reviews/'+r.id,{csrf:admin.csrf,version:r.version,action:'publish',confirmed:'true',purchaseConfirmed:'true'},admin.cookie);
  const state=async()=>{r=(await(await f.get('/api/shop-reviews/state?shop='+f.shop.id,a.cookie)).json()).own;};
  assert.equal((await approve()).status,303);await state();assert.equal((await f.get(url)).status,200);
  let html=await(await f.get('/shop?id='+f.shop.id)).text();assert.ok(html.includes(url));assert.ok(!html.includes(input.images[0].dataUrl));
  const head=await fetch(f.base+url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))>0);
  assert.equal((await fetch(f.base+url,{method:'POST'})).status,405);
  const same=await f.post('submit',input,a);assert.equal(same.status,200);assert.equal((await same.json()).result.version,r.version);
  const stolen=await f.post('submit',{...reviewPayload(f.shop),images:[{id:originalIds[0]}]},b);assert.equal(stolen.status,422);
  f.advance(61000);const oldVersion=r.version;
  const edit=await f.post('submit',{...reviewPayload(f.shop),version:r.version,images:[{id:originalIds[0]},await photo('webp','#9e524c')]},a);assert.equal(edit.status,200);r=(await edit.json()).result;assert.equal(r.status,'pending');assert.equal(r.images[0].id,originalIds[0]);
  assert.equal((await f.get(url)).status,404);assert.equal((await f.get('/api/shop-reviews/images/'+originalIds[1],a.cookie)).status,404);
  assert.equal((await f.adminPost('/admin/reviews/'+r.id,{csrf:admin.csrf,version:oldVersion,action:'publish',confirmed:'true'},admin.cookie)).status,409);
  assert.equal((await approve()).status,303);await state();assert.equal((await f.get(url)).status,200);
  assert.equal((await f.adminPost('/admin/reviews/'+r.id,{csrf:admin.csrf,version:r.version,action:'hide',reason:'privacy',note:'配图中发现未打码的私人信息，请修改。'},admin.cookie)).status,303);await state();assert.equal((await f.get(url)).status,404);
  assert.equal((await approve()).status,303);await state();assert.equal((await f.post('withdraw',{id:r.id,version:r.version},a)).status,200);await state();assert.equal((await f.get(url)).status,404);
  f.advance(61000);const restored=await f.post('submit',{...reviewPayload(f.shop),version:r.version},a);assert.equal(restored.status,200);r=(await restored.json()).result;assert.equal(r.images.length,2,'old client omission must retain existing images');
  f.advance(61000);const removed=await f.post('submit',{...reviewPayload(f.shop),version:r.version,images:[]},a);assert.equal(removed.status,200);r=(await removed.json()).result;assert.equal(r.images.length,0);assert.equal((await f.get(url,a.cookie)).status,404);
  f.advance(61000);const fresh=await f.post('submit',{...reviewPayload(f.shop),version:r.version,images:[await photo()]},a);assert.equal(fresh.status,200);r=(await fresh.json()).result;const erasedUrl=r.images[0].url;
  assert.equal(f.privateDb.prepare('SELECT count(*) n FROM shop_review_images').get().n,1);
  const erased=await fetch(f.base+'/api/retention/delete-account',{method:'POST',headers:{Origin:f.base,Cookie:a.cookie,'Content-Type':'application/json','X-CSRF-Token':a.csrf},body:'{}'});assert.equal(erased.status,200);
  assert.equal(f.privateDb.prepare('SELECT count(*) n FROM shop_review_images').get().n,0);assert.equal((await f.get(erasedUrl)).status,404);assert.equal((await f.get('/admin/review-images/'+r.images[0].id,admin.cookie)).status,404);
  assert.ok(f.privateDb.prepare('SELECT payload FROM shop_review_history WHERE review_id=?').all(r.id).every(h=>h.payload==='{}'));
 }finally{await f.close();}
});

test('invalid image submission is atomic and request/attempt limits do not publish or store files',async()=>{
 const f=await reviewApp();try{
  const a=await f.reader(31),input=reviewPayload(f.shop),image=await photo();
  assert.equal((await f.post('submit',{...input,images:[image]},null)).status,403);
  assert.equal((await f.post('submit',{...input,images:[image]},a,{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.post('submit',{...input,images:[image,image,image,image]},a)).status,422);
  assert.equal((await f.post('submit',{...input,images:[image,{dataUrl:'data:image/png;base64,YmFk'}]},a)).status,422);
  assert.equal((await f.post('submit',{...input,images:[image,image]},a)).status,422);
  assert.equal(f.privateDb.prepare('SELECT COUNT(*) n FROM shop_reviews').get().n,0);assert.equal(f.privateDb.prepare('SELECT COUNT(*) n FROM shop_review_images').get().n,0);
  assert.equal((await f.post('submit',{...input,images:[],evidence:'x'.repeat(17000)},a)).status,413);
  assert.equal((await f.post('submit',{...input,images:[{dataUrl:'a'.repeat(22*1024*1024)}]},a)).status,422);
  for(let i=0;i<7;i++)assert.equal((await f.post('submit',{...input,images:[{dataUrl:'data:image/png;base64,YmFk'}]},a)).status,422);
  assert.equal((await f.post('submit',{...input,images:[image]},a)).status,429);
  assert.equal(f.privateDb.prepare('SELECT COUNT(*) n FROM shop_review_images').get().n,0);
 }finally{await f.close();}
});

test('private photo retention, removed-shop access and storage quota fail closed without orphan writes',async()=>{
 const db=openSubmissionsDb(':memory:');let time=new Date('2026-09-11T08:00:00Z'),listed=true;
 const now=()=>time,store=createRetentionStore(db,{secret:'image-retention-test-secret-'.repeat(3),now}),shop={id:'a'.repeat(24),name:'本地测试店铺',identity:'domain:review.example',entries:[]};
 const service=createShopReviews({db,digest:store.digest,shopById:id=>listed&&id===shop.id?shop:null,now});
 const account=n=>{const id=String(n).padStart(32,'0');db.prepare('INSERT INTO retention_accounts VALUES(?,?,?,0)').run(id,'image-reader-'+n+'@example.com',time.toISOString());return db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(id);};
 try{
  const a=account(1),b=account(2),c=account(3),input=reviewPayload(shop),images=await prepareReviewImages([await photo()]),purchaseImages=await prepareReviewImages([await photo('png','#223344')]);
  const pending=service.submit(a,input,{images,purchaseImages}),published=service.submit(b,input,{images,purchaseImages});service.moderate(published.id,{action:'publish',version:published.version,confirmed:true,purchaseConfirmed:true});
  const publishedImage=published.images[0].id;assert.ok(service.image(publishedImage));listed=false;assert.equal(service.image(publishedImage),null);assert.ok(service.image(publishedImage,{admin:true}));listed=true;
  time=new Date(+time+91*86400000);service.purge();assert.equal(service.image(pending.images[0].id,{viewer:a}),null);assert.deepEqual(service.own(a,shop.id).images,[]);assert.ok(service.image(publishedImage));
  // Simulate the byte quota using metadata only, never allocate 256MB in a test.
  db.prepare('UPDATE shop_review_images SET size=? WHERE id=?').run(256*1024*1024,publishedImage);
  assert.throws(()=>service.submit(c,input,{images,purchaseImages}),e=>e.status===503);assert.equal(service.own(c,shop.id),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM shop_review_images').get().n,1);
  assert.throws(()=>service.submit(c,input),e=>e.status===422);
 }finally{db.close();}
});
