// Manual local QA only. Never imported by production startup; all data is synthetic/in-memory.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {openAnalytics} from '../lib/analytics.mjs';
import {createApp} from '../lib/web.mjs';
export async function startPreview(){
 const db=openDb(':memory:'),submissionsDb=openSubmissionsDb(':memory:'),analytics=openAnalytics(':memory:','preview-only-synthetic-secret-000000000000');
 const makeOffer=(id,title,price)=>({offerId:id,storeName:'虚构演示店铺 '+id,title,price,currency:'CNY',status:'in_stock',stockCount:12,url:'https://shop-'+id+'.example.test/product/'+id});
 storeSnapshot(db,{source:'direct-shops',snapshotId:'synthetic-preview',products:[
  {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',productType:'订阅代充',offers:Array.from({length:13},(_,i)=>makeOffer('plus-'+i,'ChatGPT Plus 代充 1个月',100+i))},
  {productId:'chatgpt-plus-recharge-12m',name:'ChatGPT Plus 年卡',platform:'ChatGPT',currency:'CNY',productType:'订阅代充',offers:[makeOffer('plus-year','ChatGPT Plus 代充 1年',999)]},
  {productId:'claude-pro-month',name:'Claude Pro',platform:'Claude',currency:'CNY',productType:'订阅代充',offers:[makeOffer('claude-0','Claude Pro 代充 1个月',125)]},
 ]});
 storeSnapshot(db,{source:'priceai',snapshotId:'synthetic-priceai',products:[
  {productId:'chatgpt-plus-recharge',name:'ChatGPT Plus',platform:'ChatGPT',currency:'CNY',offers:[
   ...Array.from({length:10},(_,i)=>({...makeOffer('platform-'+i,'ChatGPT Plus 代充 30天',80+i),url:'https://16688.com.cn/shop/'+i+'/goods/'+i})),
   {...makeOffer('plus-0','ChatGPT Plus 代充 1个月',100),offerId:'duplicate-direct'},
   makeOffer('unknown-spec','【自营】Plus 已接码',75),
   {...makeOffer('usd','ChatGPT Plus 代充 1个月',20),currency:'USD'},
   {...makeOffer('sold-out','ChatGPT Plus 代充 1个月',1),stockCount:0,status:'out_of_stock'},
   makeOffer('no-warranty','ChatGPT Plus 1个月 无质保',2),
  ]},
 ]});
 storeSnapshot(db,{source:'ldxp-goods',snapshotId:'synthetic-ldxp',products:[
  {productId:'search-plus',name:'关键词 Plus',currency:'CNY',offers:[
   {...makeOffer('ldxp-plus','ChatGPT Plus 代充 月卡',95),url:'https://wzyp.cn/shop/demo/goods/plus'},
   {...makeOffer('ldxp-claude','Claude Pro 代充 月卡',126),url:'https://wzyp.cn/shop/demo/goods/claude'},
  ]},
 ]});
 analytics.outbound.saveCampaign({id:'synthetic-ad',merchant_id:'domain:shop-plus-12.example.test',source:'direct-shops',product_id:'chatgpt-plus-recharge',offer_id:'plus-12',label:'虚构演示广告 · 非真实商家',placement:'sponsored_product',start_at:new Date(Date.now()-1000).toISOString(),end_at:new Date(Date.now()+86400000).toISOString()},{approve:true});
 const server=createApp({db,submissionsDb,analytics});let closed=false;
 const close=async()=>{if(closed)return;closed=true;if(server.listening)await new Promise(r=>server.close(r));analytics.close();submissionsDb.close();db.close();};
 try{await new Promise((yes,no)=>{server.once('error',no);server.listen(18091,'127.0.0.1',yes);});}catch(error){await close();throw error;}
 return {server,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const preview=await startPreview();console.log('Synthetic QA only: http://127.0.0.1:18091/ — Multiple sources, pagination, duplicate/unknown-spec quotes, and a demo ad. Never follow merchant links: all offers are synthetic.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>preview.close().catch(()=>{process.exitCode=1;}));
}
