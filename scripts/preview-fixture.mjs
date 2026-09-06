// Manual local QA only. Never imported by production startup; all data is synthetic/in-memory.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
export async function startPreview(){
 const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','preview-only-synthetic-secret-000000000000');
 const makeOffer=(id,title,price)=>({offerId:id,storeName:'虚构演示店铺 '+id,title,price,currency:'CNY',status:'in_stock',stockCount:12,url:'https://demo-merchant.test/product/'+id});
 storeSnapshot(db,{source:'direct-shops',snapshotId:'synthetic-preview',products:[
  {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',productType:'订阅代充',offers:[...Array.from({length:13},(_,i)=>makeOffer('plus-'+i,'ChatGPT Plus 代充 1个月',100+i)),makeOffer('plus-year','ChatGPT Plus 代充 1年',999)]},
  {productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',productType:'订阅代充',offers:[makeOffer('claude-0','Claude Pro 代充 1个月',125)]},
 ]});
 analytics.outbound.saveCampaign({id:'synthetic-ad',merchant_id:'domain:demo-merchant.test',source:'direct-shops',product_id:'chatgpt-plus-recharge',offer_id:'plus-12',label:'虚构演示广告 · 非真实商家',placement:'sponsored_product',start_at:new Date(Date.now()-1000).toISOString(),end_at:new Date(Date.now()+86400000).toISOString()},{approve:true});
 const server=createApp({db,submissionsDb,analytics});let closed=false;
 const close=async()=>{if(closed)return;closed=true;if(server.listening)await new Promise(r=>server.close(r));analytics.close();submissionsDb.close();db.close();};
 try{await new Promise((yes,no)=>{server.once('error',no);server.listen(18091,'127.0.0.1',yes);});}catch(error){await close();throw error;}
 return {server,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const preview=await startPreview();console.log('Synthetic QA only: http://127.0.0.1:18091/ — Plus has an ad; Claude has none. All merchant destinations use .test.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>preview.close().catch(()=>{process.exitCode=1;}));
}
