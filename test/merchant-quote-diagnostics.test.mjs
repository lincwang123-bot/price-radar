import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';
import {normalizeMerchantQuoteDiagnostics, merchantQuoteDiagnosticSummary} from '../lib/merchant-quote-diagnostics.mjs';
import {preflightContent} from '../lib/merchant-ui.mjs';

const now=Date.parse('2026-10-10T00:00:00Z');
const raw=(id,changes={})=>({sourceId:'diagnostic-fixture',offerId:id,storeName:'测试店',title:'ChatGPT Plus 月卡代充',price:100,currency:'CNY',status:'in_stock',stockCount:3,url:`https://fixture-shop.com/item/${id}`,capturedAt:new Date(now).toISOString(),...changes});

test('逐商品诊断沿真实过滤链区分库存、质保、分类、价格和URL，不伪造时长或交付原因',()=>{
 const rows=[raw('ok'),raw('sold',{status:'out_of_stock',stockCount:0}),raw('unknown',{status:'unknown',stockCount:null}),raw('warranty',{title:'ChatGPT Plus 月卡 无任何质保'}),raw('category',{title:'普通桌椅'}),raw('price',{price:0}),raw('url',{url:'javascript:alert(1)'}),raw('unsafe',{url:'https://127.0.0.1/item/1'}),raw('stale',{capturedAt:'2026-10-01T00:00:00Z'}),raw('currency',{currency:'NOT_CURRENCY'})];
 const result=summarizeMerchantOffers(rows,{now});
 assert.equal(result.validCount,1);
 assert.deepEqual(result.diagnostics.items.map(item=>item.reasonCodes),[[],['out_of_stock'],['inventory_unconfirmed'],['no_warranty'],['classification_unmatched'],['invalid_price'],['invalid_url'],['unsafe_url'],['quote_stale'],['directory_rule_rejected']]);
 const unknownTerms=summarizeMerchantOffers([raw('terms',{title:'ChatGPT Plus'})],{now});
 assert.equal(unknownTerms.validCount,1);assert.deepEqual(unknownTerms.diagnostics.items[0].reasonCodes,[]);
});

test('诊断分清商品ID重复与公开报价合并；被排除的先行商品不消费ID',()=>{
 const same=raw('same'),duplicateQuote={...same,offerId:'other'};
 const result=summarizeMerchantOffers([same,{...same,price:101},duplicateQuote],{now});
 assert.equal(result.validCount,1);
 assert.deepEqual(result.diagnostics.items.map(item=>item.reasonCodes),[[],['duplicate_offer'],['duplicate_quote']]);
 const recovered=summarizeMerchantOffers([{...same,status:'out_of_stock'},same],{now});
 assert.equal(recovered.validCount,1);assert.deepEqual(recovered.diagnostics.items.map(item=>item.reasonCodes),[['out_of_stock'],[]]);
});

test('诊断最多20项且不包含原始商品正文或私有字段',()=>{
 const rows=Array.from({length:25},(_,i)=>raw(String(i),{title:'ChatGPT Plus 月卡代充',extra:{contact:'private@example.com',secret:'do-not-copy'}}));
 const result=summarizeMerchantOffers(rows,{now});
 assert.equal(result.rawCount,25);assert.equal(result.validCount,25);
 assert.equal(result.diagnostics.items.length,20);assert.equal(result.diagnostics.truncated,true);
 assert.doesNotMatch(JSON.stringify(result.diagnostics),/private|do-not-copy|ChatGPT|https:|title|url/);
 const extra={...result.diagnostics,body:'untrusted',items:result.diagnostics.items.map(item=>({...item,title:'untrusted'}))};
 assert.deepEqual(normalizeMerchantQuoteDiagnostics(extra,{rawCount:25,validCount:25}),result.diagnostics);
});

test('结果诊断校验拒绝伪造代码、越界索引、不一致计数和不完整样本',()=>{
 const good={schemaVersion:1,rawCount:1,validCount:0,items:[{index:0,reasonCodes:['inventory_unconfirmed']}],truncated:false};
 for(const value of [{...good,schemaVersion:2},{...good,rawCount:2},{...good,validCount:2},{...good,truncated:true},{...good,items:[{index:1,reasonCodes:[]}]},{...good,items:[{index:0,reasonCodes:['<script>evil</script>']}]},{...good,items:[{index:0,reasonCodes:['invalid_price','no_warranty']}]}])assert.throws(()=>normalizeMerchantQuoteDiagnostics(value));
 assert.throws(()=>normalizeMerchantQuoteDiagnostics(good,{rawCount:3,validCount:0}));
 assert.equal(merchantQuoteDiagnosticSummary({...good,items:[]}),null);
});

test('后台显示有界过滤原因与商品序号，未知诊断不会进入HTML',()=>{
 const preview=summarizeMerchantOffers([raw('unknown',{status:'unknown',stockCount:null})],{now});
 const result={...preview,status:'no_valid_offers',reasonCode:'no_valid_quotes',checkedAt:new Date(now).toISOString()};
 const app={id:'MA-fixture',version:1,status:'pending',shopName:'测试店',shopUrl:'https://fixture-shop.com/'};
 const html=preflightContent(app,{status:result.status,fresh:true,result},'csrf-fixture');
 assert.match(html,/逐商品展示规则核对/);assert.match(html,/商品 1：解析结果未确认商品在售/);
 assert.match(html,/不等于商品实际缺货/);
 const poisoned={...result,diagnostics:{...result.diagnostics,items:[{index:0,reasonCodes:['<script>secret</script>']}]}};
 assert.doesNotMatch(preflightContent(app,{status:result.status,fresh:true,result:poisoned},'csrf'),/secret|逐商品展示规则核对/);
});
