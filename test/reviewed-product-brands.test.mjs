import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedProductBrand} from '../lib/reviewed-product-brands.mjs';
import {classifyDirectOffer,groupDirectOffers} from '../collectors/direct/catalog.mjs';
import {parse16688Goods} from '../collectors/direct/platform16688.mjs';
import {authorizeMerchantTarget} from '../lib/merchant-target-capability.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';

const items=[
 ['G65081818','plus官方充值月卡（质保30天）直冲个人账号 自动发货-(24h全自动充值)----限时优惠',121.24,1,'chatgpt-plus-recharge'],
 ['G70188866','plus 月卡|官方直充自己账号|保订阅不包封号|菲区 可囤',121,25,'chatgpt-plus-recharge'],
 ['G49190071','PRO 5X官方充值月卡(质保一个月) 自动发货-(24小时全自动充值)',680.68,0,'chatgpt-pro-5x'],
 ['G60886382','菲区专用Pro5X 月卡|官方直充自己账号|保订阅不包封号| 可囤',685.8,17,'chatgpt-pro-5x'],
 ['G66979862','PRO 20X官方充值月卡(质保一个月) 24小时全自动充值 ---自动发货 ----仅支持之前充值过pro20的账号',1169.58,0,'chatgpt-pro-20x'],
];
const target=()=>authorizeMerchantTarget({id:'reviewed-shop',shopNo:'S678924',origin:'https://www.16688.com.cn',name:'测试商家'});
const offers=()=>parse16688Goods({code:1,data:{list:items.map(([goods_no,name,price,stock_available_quantity])=>({goods_no,name,price,stock_available_quantity}))}},target());

test('AI源头 exact reviewed Pro20X is retained at its own price; other bare PRO listings stay unconfirmed',()=>{
 const name='PRO 20X官方充值月卡(全程质保) 24小时全自动充值（支持续费和新开） ---自动发货 ----仅支持之前充值过pro20的账号';
 const shop=authorizeMerchantTarget({id:'reviewed-ai-source',shopNo:'S686646',origin:'https://www.16688.com.cn',name:'AI源头'});
 const [row]=parse16688Goods({code:1,data:{list:[{goods_no:'G75387439',name,price:1015,stock_available_quantity:5}]}},shop);
 assert.equal(classifyDirectOffer(row)?.id,'chatgpt-pro-20x');assert.equal(summarizeMerchantOffers([row]).validCount,1);
 assert.equal(summarizeMerchantOffers([row]).samples[0].price,1015);assert.equal(row.title,name);
 for(const patch of [{title:name+' 年卡'},{url:'https://www.16688.com.cn/goods/G123'},{extra:{...row.extra,shopNo:'S123'}}])assert.equal(reviewedProductBrand({...row,...patch}),null);
 assert.equal(summarizeMerchantOffers([{...row,status:'out_of_stock',stockCount:0}]).validCount,0);
});

test('confirmed exact listings keep original titles and prices through SQLite/public projection; sold out still excluded',()=>{
 const rows=offers(),before=JSON.stringify(rows);
 rows.forEach((row,i)=>assert.equal(classifyDirectOffer(row)?.id,items[i][4]));
 const summary=summarizeMerchantOffers(rows);
 assert.equal(summary.rawCount,5);assert.equal(summary.validCount,3);
 assert.deepEqual(new Set(summary.samples.map(row=>row.url)),new Set([items[0],items[1],items[3]].map(row=>'https://www.16688.com.cn/goods/'+row[0])));
 assert.deepEqual(summary.samples.map(row=>row.title).sort(),[items[0],items[1],items[3]].map(row=>row[1]).sort());
 assert.deepEqual(summary.samples.map(row=>row.price).sort(),[121,121.24,685.8].sort());
 assert.equal(JSON.stringify(rows),before);
 assert.equal(groupDirectOffers(rows.map(row=>({...row,price:0}))).length,0);
});

test('operator brand confirmation cannot spread to another shop, product, source, or changed title',()=>{
 const row=offers()[1];
 assert.equal(classifyDirectOffer({...row,url:'https://www.16688.com.cn/goods/G62568146',title:'PRO 20X续费版， 到期前1-2天可以续费 只限卡冲已有pro20的账号 IOS的不要下单'}),null); // G62568146 delisted 2026-11-05, binding removed
 for(const patch of [{source:'ldxp-goods'},{url:'https://evil.example.org/goods/G70188866'},{url:'https://www.16688.com.cn/goods/G99999999'},{url:row.url+'?shop=S2'},
  {extra:{...row.extra,shopNo:'S2'}},{extra:{...row.extra,shopUrl:'https://www.16688.com.cn/shop/S2'}},{extra:'invalid'},{title:row.title.replace('plus','PRO 20X')},{title:row.title+' 年卡'},{title:'Claude Pro 月卡'}]){
  assert.equal(reviewedProductBrand({...row,...patch}),null,JSON.stringify(patch));
 }
 // 人工确认不能外溢；无店铺绑定的同文案仍可按无品牌规格归类。
 assert.equal(classifyDirectOffer({title:row.title})?.id,'chatgpt-plus-recharge');
 assert.equal(classifyDirectOffer({...row,title:'Claude Pro 月卡'})?.id,'claude-pro-month');
});


test('S878919 G30720814 live title is ChatGPT Pro 5x; bare G Pro without the reviewed goods id stays unbound',()=>{
 const live='【美区IOS】质保30天（可覆盖plus）G pro 100 5x 订阅 官方充值 免排队 秒充 可开票 有ios官方账单 #039';
 const previous='【美区IOS】质保30天（可覆盖）G pro 100 5x 订阅 官方充值 免排队 秒充(5-10分钟到账)';
 const plus='IOS 【质保30天】 PLUS 订阅 官方充值 免排队 秒充(1-10分钟到账)（可屯卡）';
 const pro20='【美区IOS】质保30天（可覆盖）G pro 20x 订阅 官方充值 免排队 秒充(5-10分钟到账)';
 const shop=authorizeMerchantTarget({id:'reviewed-s878919',shopNo:'S878919',origin:'https://www.16688.com.cn',name:'16688 shop'});
 const rows=parse16688Goods({code:1,data:{list:[
  {goods_no:'G30720814',name:live,price:688,stock_available_quantity:3},
  {goods_no:'G40240306',name:plus,price:128,stock_available_quantity:2},
  {goods_no:'G96954851',name:pro20,price:1188,stock_available_quantity:1},
 ]}},shop);
 assert.equal(reviewedBinding(rows[0])?.status,'bound');
 assert.equal(reviewedBinding(rows[0])?.renamed,undefined);
 assert.equal(reviewedProductBrand(rows[0]),'chatgpt');
 assert.equal(classifyDirectOffer(rows[0])?.id,'chatgpt-pro-5x');
 assert.equal(reviewedProductBrand(rows[1]),'chatgpt');
 assert.equal(classifyDirectOffer(rows[1])?.id,'chatgpt-plus-recharge');
 assert.equal(reviewedProductBrand(rows[2]),'chatgpt');
 assert.equal(classifyDirectOffer(rows[2])?.id,'chatgpt-pro-20x');
 const summary=summarizeMerchantOffers(rows);
 assert.equal(summary.validCount,3);
 assert.equal(summary.samples.find(row=>row.url.endsWith('/goods/G30720814'))?.title,live);
 // 按商品 ID 绑定：更新前的旧标题仍是同一规格，继续绑定。
 const renamed={...rows[0],title:previous};
 assert.equal(reviewedProductBrand(renamed),'chatgpt');
 assert.equal(classifyDirectOffer(renamed)?.id,'chatgpt-pro-5x');
 assert.equal(classifyDirectOffer({title:live}),null);
 assert.equal(classifyDirectOffer({title:'G Pro X20'}),null);
 for(const patch of [{title:live+' 年卡'},{url:'https://www.16688.com.cn/goods/G123'},{extra:{...rows[0].extra,shopNo:'S123'}}])assert.equal(reviewedProductBrand({...rows[0],...patch}),null);
});

test('authenticated Business clarification binds only the reviewed shop, SKU and unchanged title',()=>{
 const title='【可续费且随时上车】Business独立席位｜100元/月｜全程质保·售后无忧';
 const target=authorizeMerchantTarget({id:'reviewed-business',shopNo:'S557522',origin:'https://www.16688.com.cn',name:'测试店'});
 const [row]=parse16688Goods({code:1,data:{list:[{goods_no:'G54457093',name:title,price:100,stock_available_quantity:10}]}},target);
 assert.equal(classifyDirectOffer(row)?.id,'chatgpt-team-business');
 assert.equal(summarizeMerchantOffers([row]).validCount,1);
 for(const patch of [{title:title+' 年卡'},{url:'https://www.16688.com.cn/goods/G123'},{extra:{...row.extra,shopNo:'S123'}}])assert.equal(reviewedProductBrand({...row,...patch}),null);
});

import {reviewedBinding} from '../lib/reviewed-product-brands.mjs';
test('goods-id binding: same id + cosmetic rename binds; same id + spec conflict is pending; other id unbound',()=>{
 const live='【美区IOS】质保30天（可覆盖plus）G pro 100 5x 订阅 官方充值 免排队 秒充 可开票 有ios官方账单 #039';
 const shop=authorizeMerchantTarget({id:'reviewed-s878919',shopNo:'S878919',origin:'https://www.16688.com.cn',name:'16688 shop'});
 const [row]=parse16688Goods({code:1,data:{list:[{goods_no:'G30720814',name:live,price:688,stock_available_quantity:3}]}},shop);
 for(const title of [...['可覆盖plus','可覆盖 plus','可覆蓋plus','兼容 plus'].map(text=>live.replace('可覆盖plus',text)+' 限时'),live+' 限时',live.replace(' #039',' #040'),'【美区IOS】质保30天 G pro 5x 订阅 官方充值 秒充']){
  assert.equal(reviewedProductBrand({...row,title}),'chatgpt',title);
  assert.equal(reviewedBinding({...row,title})?.renamed,true);
  assert.equal(classifyDirectOffer({...row,title})?.id,'chatgpt-pro-5x',title);
 }
 const warn=console.warn,logs=[];console.warn=msg=>logs.push(msg);
 try{
  for(const title of [live.replace('5x','20x'),live.replace('G pro 100 5x','PLUS'),live+' PLUS 订阅',live+' ios正规plus年卡全程质保','Claude Max 5x 月卡 官方充值','G pro 100 5x 年卡 官方充值','G pro 订阅 官方充值']){
   assert.equal(reviewedProductBrand({...row,title}),null,title);
   assert.equal(reviewedBinding({...row,title})?.status,'pending',title);
  }
 }finally{console.warn=warn;}
 assert.ok(logs.length>=5&&logs.every(msg=>msg.startsWith('[reviewed-binding] pending review S878919/G30720814')));
 assert.equal(reviewedBinding({...row,url:'https://www.16688.com.cn/goods/G30720815'}),null);
 assert.equal(reviewedProductBrand({...row,url:'https://www.16688.com.cn/goods/G30720815'}),null);
 assert.equal(reviewedProductBrand({...row,extra:{...row.extra,shopNo:'S678924',shopUrl:'https://www.16688.com.cn/shop/S678924'}}),null);
});

test('2026-11-05 delisted goods ids are no longer reviewed bindings; G66979862 kept as approved',async()=>{
 const {reviewedGoodsIds}=await import('../lib/reviewed-product-brands.mjs');
 const ids=new Set(reviewedGoodsIds().map(row=>row.goods));
 for(const id of ['G65081818','G60886382','G62568146','G71033192'])assert.equal(ids.has(id),false,id);
 for(const id of ['G66979862','G70188866','G49190071','G54457093','G30720814','G75387439'])assert.equal(ids.has(id),true,id);
});

test('2026-11-05 approved G66979862 "PRO 10X 200$" binds as Pro 20x at ¥1200; Pro 100 (10X) still 5x',()=>{
 const live='PRO 10X 200$ 官方充值月卡(质保30天) 24小时全自动充值 直冲个人账号 -全自动发货-可开票-可自助升级';
 const [row]=parse16688Goods({code:1,data:{list:[{goods_no:'G66979862',name:live,price:1200,stock_available_quantity:3}]}},target());
 assert.equal(reviewedBinding(row)?.status,'bound');assert.equal(row.title,live);
 assert.equal(classifyDirectOffer(row)?.id,'chatgpt-pro-20x');
 assert.equal(summarizeMerchantOffers([row]).samples[0].price,1200);
 // Gate: cosmetic rename keeping 200$ still binds; the 10X label alone is not tier evidence.
 assert.equal(reviewedBinding({...row,title:live.replace('-可开票','')})?.renamed,true);
 const warn=console.warn;console.warn=()=>{};
 try{
  for(const title of [live.replace(' 200$',''),live.replace('200$','100$ 5X'),live.replace('月卡','年卡')])assert.equal(reviewedBinding({...row,title})?.status,'pending',title);
  // The 200$ exemption is id-specific.
  const other=parse16688Goods({code:1,data:{list:[{goods_no:'G49190071',name:'PRO 10X 200$ 月卡',price:1,stock_available_quantity:1}]}},target())[0];
  assert.equal(reviewedBinding(other)?.status,'pending');
 }finally{console.warn=warn;}
 assert.equal(classifyDirectOffer({title:'ChatGPT Pro 100（10X）月卡 官方充值'})?.id,'chatgpt-pro-5x');
 const p5=parse16688Goods({code:1,data:{list:[{goods_no:'G49190071',name:'PRO 5X 官方充值月卡(质保一个月) -全自动发货-充值个人账号-(24小时全自动充值)-可开票 -可自助升级',price:669,stock_available_quantity:4}]}},target())[0];
 assert.equal(classifyDirectOffer(p5)?.id,'chatgpt-pro-5x');
});
