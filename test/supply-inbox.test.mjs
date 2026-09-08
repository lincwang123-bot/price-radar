import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../lib/db.mjs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { createAdmin, hashAdminPassword } from '../lib/admin.mjs';
import { importSupplyIntakes } from '../lib/merchant-intake.mjs';

test('transferred supplies leave the inbox and its counts while originals remain reachable', async () => {
  const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:');
  const origin='https://airadar.test',password='supply-inbox-fixture-password';
  const id=n=>`CO-20260908-${String(n).padStart(12,'0')}`;
  const stamp=new Date().toISOString();
  for(let n=1;n<=31;n++)submissionsDb.prepare(`INSERT INTO cooperation_submissions
    (public_id,created_at,topic,subject,product_area,scale,assurance,settlement,source_url,details,contact,consent_at,content_hash,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(n),stamp,n===31?'demand':'supply',`供应样本${n}`,'chatgpt','small','conditional','cny',`https://supply-${n}.example.org/`,'原始供应资料','owner@example.org',stamp,String(n),n===2?'reviewing':'new');
  const admin=createAdmin({db,submissionsDb,origin,username:'owner',passwordHash:await hashAdminPassword(password)});
  const server=createServer(async(req,res)=>{try{if(!await admin(req,res,new URL(req.url,origin))){res.statusCode=404;res.end();}}catch(error){res.statusCode=500;res.end(error.message);}});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
    const post=(url,fields,cookie)=>request(url,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams(fields)});
    const login=await request('/admin/login'),loginHtml=await login.text();
    const signed=await post('/admin/login',{username:'owner',password,csrf:/name="csrf" value="([^"]+)"/.exec(loginHtml)[1]},login.headers.getSetCookie()[0].split(';')[0]);
    assert.equal(signed.status,303);
    const cookie=signed.headers.getSetCookie()[0].split(';')[0];
    const get=async url=>{const res=await request(url,{headers:{cookie}});assert.equal(res.status,200);return res.text();};
    const before=await get('/admin?kind=supply');
    assert.match(before,/共 30 条/);assert.match(before,/下一页/);
    const detail=await get('/admin/submission/'+id(3));
    const csrf=/name="csrf" value="([^"]+)"/.exec(detail)[1];
    assert.match(detail,/加入店铺审核并自动检测/);
    assert.equal((await post('/admin/merchant-intake',{id:id(3),csrf},cookie)).status,303);
    // Existing transfers must disappear too, before filtering or pagination.
    importSupplyIntakes(submissionsDb,Array.from({length:26},(_,i)=>id(i+5)));
    const transferred=await get('/admin?kind=supply');
    assert.match(transferred,/共 3 条/);assert.doesNotMatch(transferred,/下一页/);
    assert.doesNotMatch(transferred,new RegExp('/admin/submission/'+id(3)));
    const original=await get('/admin/submission/'+id(3));
    assert.match(original,/原始供应资料/);
    assert.match(original,new RegExp('/admin/merchants/'+id(3)));
    assert.doesNotMatch(original,/加入店铺审核并自动检测/);
    assert.match(await get('/admin/merchants/'+id(3)),new RegExp('/admin/submission/'+id(3)));
    // Direct conversion without an intake record is another transfer path.
    const converted=await post('/admin/submission/'+id(4)+'/merchant',{
      csrf,shopName:'已转正式申请',shopUrl:'https://supply-4.example.org/',contact:'owner@example.org',
      details:'原始供应资料',productAreas:'chatgpt',ownershipConfirmed:'true',permissionConfirmed:'true',note:'已核实店铺归属及公开目录展示授权'
    },cookie);
    assert.equal(converted.status,303);
    const target=converted.headers.get('location');
    const after=await get('/admin?kind=supply');
    assert.match(after,/共 2 条/);
    for(const n of [1,2])assert.match(after,new RegExp('/admin/submission/'+id(n)));
    for(const n of [3,4,30])assert.doesNotMatch(after,new RegExp('/admin/submission/'+id(n)));
    const newOnly=await get('/admin?kind=supply&status=new');
    assert.match(newOnly,/共 1 条/);assert.doesNotMatch(newOnly,new RegExp('/admin/submission/'+id(2)));
    assert.match(await get('/admin?kind=supply&status=reviewing'),/共 1 条/);
    const page2=await get('/admin?kind=supply&page=2');
    assert.match(page2,/共 2 条/);assert.match(page2,/暂无投稿/);
    const convertedOriginal=await get('/admin/submission/'+id(4));
    assert.match(convertedOriginal,new RegExp(target));
    assert.doesNotMatch(convertedOriginal,/加入店铺审核并自动检测/);
    assert.match(await get(target),new RegExp('/admin/submission/'+id(4)));
    assert.match(await get('/admin?kind=demand'),/共 1 条/);
    assert.match(await get('/admin?kind=feedback'),/共 0 条/);
    assert.equal(submissionsDb.prepare('SELECT COUNT(*) n FROM cooperation_submissions').get().n,31);
    assert.equal(submissionsDb.prepare('SELECT status FROM cooperation_submissions WHERE public_id=?').get(id(3)).status,'new');
    assert.equal(submissionsDb.prepare('SELECT status FROM cooperation_submissions WHERE public_id=?').get(id(4)).status,'new');
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();submissionsDb.close();
  }
});
