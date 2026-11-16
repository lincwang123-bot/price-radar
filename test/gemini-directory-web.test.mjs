import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,storeSnapshot} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {IncomingMessage,ServerResponse} from 'node:http';
import {PassThrough} from 'node:stream';
// Exercise the real request handler without opening a listening socket.
function request(app,path){
 return new Promise(resolve=>{
  const socket=new PassThrough();socket.remoteAddress='127.0.0.1';
  const req=new IncomingMessage(socket);req.method='GET';req.url=path;req.headers={host:'localhost'};
  const res=new ServerResponse(req);
  res.end=body=>{res.emit('finish');resolve({status:res.statusCode,html:String(body||'')});};
  app.emit('request',req,res);
 });
}

test('Gemini SSR shows independent pending dimensions and preserves eligibility filters in navigation',async()=>{
 const db=openDb(':memory:');let app;
 try{
  const offers=Array.from({length:12},(_,i)=>({offerId:'gemini-web-'+i,storeName:'Gemini shop '+i,title:'Gemini Pro 成品号 1个月',price:10+i,currency:'CNY',status:'in_stock',stockCount:2,url:'https://gemini-web-'+i+'.example.org/product'}));
  storeSnapshot(db,{source:'direct-shops',snapshotId:'gemini-web',products:[{productId:'gemini-pro-recharge',name:'Gemini Pro',currency:'CNY',offers}]});
  app=createApp({db,adsenseEnv:{},retentionOptions:{env:{}}});
  const origin='http://localhost';
  const response=await request(app,'/prices/gemini-pro?eligibility=unknown');assert.equal(response.status,200);
  const html=response.html;
  assert.match(html,/aria-label="订阅资格"/);
  assert.match(html,/订阅资格：待核验 · 交付核验：待核验 · 资格核验：待核验/);
  assert.match(html,/分类纠错 \/ 误折叠反馈/);
  assert.equal((html.match(/data-directory-quote data-price/g)||[]).length,10);
  assert.doesNotMatch(html,/<details class="gemini-same-source">/);
  const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1].replaceAll('&amp;','&'),origin));
  const next=links.find(u=>u.searchParams.get('page')==='2');
  assert.equal(next.searchParams.get('eligibility'),'unknown');
  const nextHtml=(await request(app,next.pathname+next.search)).html;
  assert.equal((nextHtml.match(/data-directory-quote data-price/g)||[]).length,2);
  const empty=(await request(app,'/prices/gemini-pro?eligibility=paid')).html;
  assert.equal((empty.match(/data-directory-quote data-price/g)||[]).length,0);
 }finally{app?.emit('close');db.close();}
});
