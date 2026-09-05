import test from "node:test";
import assert from "node:assert/strict";
import { offerChannel,filterChannel } from "../lib/channels.mjs";
import { openDb,storeSnapshot } from "../lib/db.mjs";
import { createApp } from "../lib/web.mjs";
test("渠道只按登记原站识别，不根据来源名称冒认平台",()=>{
 assert.equal(offerChannel({url:"https://16688.com.cn/goods/1"}).id,"16688");
 assert.equal(offerChannel({url:"https://wzyp.cn/item/1"}).id,"ldxp");
 assert.equal(offerChannel({url:"https://morimm.com/products/1"}).framework,"Dujiao 接口");
 for(const url of ["https://16688.com.cn.evil.test/","https://evil.test/","javascript:alert(1)"])assert.equal(offerChannel({url,source_id:"16688-fake"}).id,"unknown");
});
test("渠道筛选重算当前价、保留翻页和返回品牌参数",async()=>{
 const db=openDb(":memory:"),app=createApp({db});
 try{const offers=Array.from({length:14},(_,i)=>({offerId:String(i),price:100+i,status:"in_stock",stockCount:1,url:`https://${i<12?'16688.com.cn':'wzyp.cn'}/goods/${i}`}));
 storeSnapshot(db,{source:"priceai",snapshotId:"fixture",products:[{productId:"claude-pro-month",name:"Claude Pro",platform:"Claude",lowestPrice:1,currency:"CNY",offers}]});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));const html=await(await fetch(`http://127.0.0.1:${app.address().port}/product?source=priceai&id=claude-pro-month&channel=16688&page=2`)).text();
 assert.match(html,/共 12 条公开报价/);assert.match(html,/price-display">¥100</);assert.match(html,/第 2 \/ 2 页/);assert.match(html,/family=claude&amp;channel=16688/);assert.match(html,/channel=16688#offers/);assert.doesNotMatch(html,/https:\/\/wzyp.cn\/goods/);
 }finally{await new Promise(r=>app.close(r));db.close();}
});
