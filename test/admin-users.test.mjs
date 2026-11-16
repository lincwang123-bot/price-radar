import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openDb} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createRetentionStore} from '../lib/retention-store.mjs';
import {createAccountAuth} from '../lib/account-auth.mjs';
import {createGoogleLogin} from '../lib/account-google.mjs';
import {createShopReviews} from '../lib/shop-reviews.mjs';
import {initSupplyIntakeSchema} from '../lib/merchant-intake.mjs';
import {createApp} from '../lib/web.mjs';
import {hashAdminPassword} from '../lib/admin.mjs';
import {readAdminOverview,listAdminUsers,readAdminUser} from '../lib/admin-users.mjs';
import {overviewContent,usersContent,userDetailContent} from '../lib/admin-users-ui.mjs';

const now=new Date('2026-09-26T02:00:00.000Z');
const id=n=>String(n).padStart(32,'0');
function fixture(){
  const db=openSubmissionsDb(':memory:');
  const store=createRetentionStore(db,{secret:'admin-users-fixture-secret-'.repeat(2),now:()=>now});
  createAccountAuth(store);createGoogleLogin({store});
  createShopReviews({db,digest:store.digest,shopById:()=>null});
  const account=(n,email,created='2026-09-25T16:00:00.000Z')=>db.prepare('INSERT INTO retention_accounts VALUES(?,?,?,0)').run(id(n),email,created);
  const merchant=(n,accountId,status='pending',email='historical@example.test')=>db.prepare(`INSERT INTO merchant_applications(public_id,created_at,updated_at,shop_name,shop_url,identity,platform,product_areas,contact,consent_at,applicant_account_id,status,email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('MA-TEST-'+n,now.toISOString(),now.toISOString(),'<img src=x onerror=alert(1)>','https://shop.example.test/','fixture:'+n,'independent','[]','private-contact',now.toISOString(),accountId,status,email);
  return {db,account,merchant};
}

test('overview uses Beijing calendar boundaries, current accounts and zero-filled date distribution without writing',()=>{
  const f=fixture();try{
    f.account(1,'old@example.test','2026-08-01T00:00:00.000Z');
    f.account(2,'today@example.test');
    f.account(3,'seven@example.test','2026-09-19T16:00:00.000Z');
    f.account(4,'before-seven@example.test','2026-09-19T15:59:59.999Z');
    f.account(5,'thirty@example.test','2026-08-27T16:00:00.000Z');
    f.account(6,'future@example.test','2026-09-27T00:00:00.000Z');
    f.merchant(1,id(2));f.merchant(2,id(2),'approved');
    const before=f.db.prepare('SELECT total_changes() n').get().n;
    const r=readAdminOverview(f.db,{now,days:7});
    assert.deepEqual(r.accounts,{total:6,today:1,last7:2,last30:4});
    assert.equal(r.series.length,7);assert.equal(r.series[0].day,'2026-09-20');
    assert.deepEqual(r.series.at(-1),{day:'2026-09-26',count:1});
    assert.equal(r.pendingMerchants,1);assert.equal(r.pendingReviews,0);
    assert.equal(r.merchantAccounts,1);
    assert.equal(readAdminOverview(f.db,{now,days:30}).series.length,30);
    assert.equal(readAdminOverview(f.db,{now,days:10000}).days,7);
    assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
  }finally{f.db.close();}
});

test('user list searches email literally, distinguishes overlapping login methods, paginates and deduplicates merchant accounts',()=>{
  const f=fixture();try{
    for(let n=1;n<=27;n++)f.account(n,`user${n}@example.test`);
    f.account(28,'percent%_@example.test');
    f.db.prepare('INSERT INTO reader_credentials VALUES(?,?,?)').run(id(2),'SECRET_PASSWORD_HASH',now.toISOString());
    f.db.prepare('INSERT INTO reader_google_identities VALUES(?,?,?)').run('PRIVATE_GOOGLE_SUBJECT',id(2),now.toISOString());
    f.merchant(1,id(2));f.merchant(2,id(2),'approved');f.merchant(3,null,'pending','user3@example.test');
    const all=listAdminUsers(f.db,{});
    assert.equal(all.total,28);assert.equal(all.items.length,20);assert.equal(all.pages,2);
    const last=listAdminUsers(f.db,{page:'999999999999'});assert.equal(last.page,2);assert.equal(last.items.length,8);
    assert.equal(listAdminUsers(f.db,{page:'-1'}).page,1);
    assert.equal(listAdminUsers(f.db,{q:'%_'}).total,1);
    assert.equal(listAdminUsers(f.db,{q:"' OR 1=1 --"}).total,0);
    assert.equal(listAdminUsers(f.db,{q:'USER2@EXAMPLE.TEST'}).total,1);
    const merchants=listAdminUsers(f.db,{role:'merchant',login:'google'});
    assert.equal(merchants.total,1);assert.equal(merchants.items[0].applicationCount,2);
    assert.equal(merchants.items[0].hasPassword,1);assert.equal(merchants.items[0].hasGoogle,1);
    assert.equal(listAdminUsers(f.db,{role:'reader'}).total,27);
    assert.equal(listAdminUsers(f.db,{login:'email_only'}).total,27);
    assert.doesNotMatch(JSON.stringify(all),/SECRET_PASSWORD_HASH|PRIVATE_GOOGLE_SUBJECT/);
    const detail=readAdminUser(f.db,id(2));assert.equal(detail.applications.length,2);
    assert.equal(readAdminUser(f.db,id(999)),null);
    const html=usersContent(merchants)+userDetailContent(detail);
    assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x|SECRET_PASSWORD_HASH|PRIVATE_GOOGLE_SUBJECT|private-contact|mailto:/);
    assert.match(usersContent(listAdminUsers(f.db,{q:'missing'})),/没有匹配的账号/);
  }finally{f.db.close();}
});

test('missing metrics remain unavailable, never fabricated as zero; UI explains account and visitor boundaries',()=>{
  const db=new DatabaseSync(':memory:');try{
    assert.equal(readAdminOverview(db,{now}).available,false);
    assert.equal(listAdminUsers(db).available,false);
    assert.match(overviewContent(readAdminOverview(db,{now})),/暂不可用/);
    assert.match(usersContent(listAdminUsers(db)),/暂不可用/);
    db.exec('CREATE TABLE retention_accounts(id TEXT,email TEXT,created_at TEXT,email_enabled INTEGER)');
    const r=readAdminOverview(db,{now});assert.equal(r.accounts.total,0);assert.equal(r.pendingMerchants,null);
    const html=overviewContent(r);assert.match(html,/注销/);assert.match(html,/不等于访客/);assert.match(html,/未采集/);
  }finally{db.close();}
});

test('overview includes unconverted supply intakes but excludes transferred and orphan intake records',()=>{
  const f=fixture();try{
    initSupplyIntakeSchema(f.db);f.merchant(1,null);
    for(const n of [1,2])f.db.prepare(`INSERT INTO cooperation_submissions(public_id,created_at,topic,subject,product_area,scale,assurance,settlement,details,contact,consent_at,content_hash) VALUES(?,?,'supply','fixture','chatgpt','large','none','cny','fixture','fixture',?,?)`).run('CO-TEST-'+n,now.toISOString(),now.toISOString(),'content-'+n);
    for(const n of [1,2,3])f.db.prepare('INSERT INTO merchant_supply_intake(source_submission_id,created_at,actor) VALUES(?,?,?)').run('CO-TEST-'+n,now.toISOString(),'fixture');
    f.db.prepare('INSERT INTO merchant_submission_links VALUES(?,?,?)').run('CO-TEST-2','MA-TEST-1',now.toISOString());
    assert.equal(readAdminOverview(f.db,{now}).pendingMerchants,2);
  }finally{f.db.close();}
});

test('detail counts and recent related records match while excluding erased review bodies and secrets',()=>{
  const f=fixture();try{
    f.account(1,'reader@example.test');
    for(let n=1;n<=22;n++){
      f.merchant(n,id(1));
      f.db.prepare(`INSERT INTO retention_watches(id,account_id,product_key,mode,created_at,updated_at) VALUES(?,?,?,'off',?,?)`).run('watch-'+n,id(1),'product-'+n,now.toISOString(),now.toISOString());
    }
    for(const [n,status] of [[1,'published'],[2,'pending'],[3,'erased']])f.db.prepare(`INSERT INTO shop_reviews(id,shop_id,shop_name,author_key,account_id,created_at,updated_at,submitted_at,status,version,rating,product,delivery,experience,evidence,content_hash) VALUES(?,?,?,?,?,?,?,?,?,1,4,'fixture','recharge','SECRET_REVIEW_BODY','SECRET_EVIDENCE','hash')`).run(id(n),'shop-'+n,'Fixture shop','author-'+n,id(1),now.toISOString(),now.toISOString(),now.toISOString(),status);
    const u=readAdminUser(f.db,id(1));
    assert.equal(u.applicationCount,22);assert.equal(u.applications.length,20);
    assert.equal(u.watchCount,22);assert.equal(u.watches.length,20);
    assert.equal(u.reviewCount,2);assert.equal(u.reviews.length,2);
    assert.equal(readAdminOverview(f.db,{now}).pendingReviews,1);
    assert.equal(readAdminOverview(f.db,{now}).publishedReviews,1);
    assert.doesNotMatch(JSON.stringify(u),/SECRET_REVIEW_BODY|SECRET_EVIDENCE/);
    assert.match(userDetailContent(u),/仅展示最近 20 条/);
  }finally{f.db.close();}
});

test('admin user pages require existing admin auth, private cache headers and GET-only access; login lands on overview',async()=>{
  const market=openDb(':memory:'),f=fixture(),origin='https://airadar.test';
  f.account(1,'private-user@example.test');
  const password='fixture-admin-password-2026',passwordHash=await hashAdminPassword(password);
  const app=createApp({db:market,submissionsDb:f.db,retentionOptions:{env:{}},adminOptions:{username:'fixture-owner',passwordHash,origin,now:()=>+now}});
  await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.address().port}`;
  const request=(path,options={})=>fetch(base+path,{redirect:'manual',...options});
  try{
    for(const path of ['/admin/overview','/admin/users','/admin/users/'+id(1)]){
      for(const cookie of ['', 'airadar_admin=forged']){
        const res=await request(path,{headers:{cookie}});assert.equal(res.status,303);
        assert.doesNotMatch(await res.text(),/private-user/);
      }
    }
    const login=await request('/admin/login'),loginHtml=await login.text();
    const csrf=/name="csrf" value="([^"]+)"/.exec(loginHtml)[1];
    const signed=await request('/admin/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie:login.headers.getSetCookie()[0].split(';')[0]},body:new URLSearchParams({csrf,username:'fixture-owner',password})});
    assert.equal(signed.status,303);assert.equal(signed.headers.get('location'),'/admin/overview');
    const cookie=signed.headers.getSetCookie()[0].split(';')[0];
    for(const path of ['/admin/overview','/admin/users','/admin/users/'+id(1)]){
      const res=await request(path,{headers:{cookie}});assert.equal(res.status,200);
      assert.match(res.headers.get('cache-control'),/no-store/);assert.match(res.headers.get('cache-control'),/no-transform/);
      assert.match(res.headers.get('x-robots-tag'),/noindex/);
      assert.equal(res.headers.get('referrer-policy'),'same-origin');
      assert.match(await res.text(),/用户管理/);
      assert.equal((await request(path,{method:'PUT',headers:{cookie}})).status,405);
    }
    assert.equal((await request('/admin/users/'+id(99),{headers:{cookie}})).status,404);
    assert.equal((await request('/admin',{headers:{cookie}})).status,200);
  }finally{await new Promise(r=>app.close(r));market.close();f.db.close();}
});
