import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openDb,storeSnapshot} from '../../lib/db.mjs';
import {openSubmissionsDb} from '../../lib/submissions.mjs';
import {createApp} from '../../lib/web.mjs';
import {hashAdminPassword} from '../../lib/admin.mjs';
import {shopDescriptorForOffer} from '../../lib/merchant-x.mjs';

export async function reviewApp(){
 const db=openDb(':memory:'),privateDb=openSubmissionsDb(':memory:'),bridge=mkdtempSync(path.join(os.tmpdir(),'airadar-review-test-'));
 let time=new Date();const now=()=>time;
 const offer={offerId:'review-one',title:'ChatGPT Plus 官方代充 1个月',price:138,currency:'CNY',status:'in_stock',storeName:'演示店铺 · 星河 AI',url:'https://review.example/product/1',extra:{shopUrl:'https://review.example/'}};
 storeSnapshot(db,{source:'direct-shops',snapshotId:'synthetic-reviews',products:[{productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',currency:'CNY',offers:[offer]}]});
 const shop=shopDescriptorForOffer({...offer,source:'direct-shops'}),origin='https://airadar.test',password= 'example-fixture-sk-00000000000000000000000000000000';
 const app=createApp({db,submissionsDb:privateDb,retentionOptions:{now,env:{},secret:'test-only-review-secret-'.repeat(4)},adminOptions:{origin,username:'test-admin',passwordHash:await hashAdminPassword(password),now:()=>+time,merchantBridgeDir:bridge,merchantPreflightResultsDir:bridge},merchantXOptions:{now}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const get=(url,cookie='')=>fetch(base+url,{headers:{cookie},redirect:'manual'});
 const reader=async(n,{passwordSet=true}={})=>{
  const id=String(n).padStart(32,'0'),email='synthetic-reader-'+n+'@example.com',token=randomBytes(32).toString('hex');
  privateDb.prepare('INSERT INTO retention_accounts VALUES(?,?,?,0)').run(id,email,new Date(+time-3*86400000).toISOString());
  if(passwordSet)privateDb.prepare('INSERT INTO reader_credentials VALUES(?,?,?)').run(id,'test-fixture-not-a-password',time.toISOString());
  privateDb.prepare('INSERT INTO retention_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,new Date(+time+86400000).toISOString());
  const res=await get('/api/retention/state','airadar_reader='+token),state=await res.json();
  const cookie='airadar_reader='+token+'; '+res.headers.getSetCookie()[0].split(';')[0];
  return {id,email,token,cookie,csrf:state.csrf};
 };
 const post=(action,input,r,headers={})=>fetch(base+'/api/shop-reviews/'+action,{method:'POST',headers:{Origin:base,Cookie:r?.cookie||'','Content-Type':'application/json','X-CSRF-Token':r?.csrf||'','CF-Connecting-IP':r?.id||'guest',...headers},body:JSON.stringify(input)});
 const adminPost=(url,fields,cookie,headers={})=>fetch(base+url,{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(fields)});
 const admin=async()=>{
  const page=await get('/admin/login'),html=await page.text(),token=html.match(/name="csrf" value="([^"]+)"/)[1];
  const res=await adminPost('/admin/login',{username:'test-admin',password,csrf:token},page.headers.getSetCookie()[0].split(';')[0]);
  const cookie=res.headers.getSetCookie()[0].split(';')[0],content=await(await get('/admin/reviews',cookie)).text();
  return {cookie,csrf:content.match(/name="csrf" value="([^"]+)"/)[1]};
 };
 return {db,privateDb,app,base,origin,shop,get,post,reader,admin,adminPost,advance:ms=>{time=new Date(+time+ms);},close:async()=>{await new Promise(r=>app.close(r));await app.retentionWorkflowDone?.();await app.merchantWorkflowDone?.();db.close();privateDb.close();rmSync(bridge,{recursive:true,force:true});}};
}
const purchaseDataUrl='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:3,background:'#445566'}}).png().toBuffer()).toString('base64');
export const reviewPayload=shop=>({shopId:shop.id,version:0,rating:2,product:'ChatGPT Plus 月付',delivery:'recharge',experience:'下单后等待两小时才到账，联系客服后问题得到处理，希望交付速度能改进。',evidence:'仅供后台查看的脱敏交易经过',consent:true,purchaseImages:[{dataUrl:purchaseDataUrl}]});
