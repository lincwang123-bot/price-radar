import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBBShareCatalog,parseBBShareProduct,collectBBShare} from '../collectors/direct/bbshare.mjs';
import {probeMerchantCatalog} from '../lib/merchant-collection.mjs';
import {deliveryForm} from '../lib/offer-spec.mjs';
import {directTargets,DEFAULT_DIRECT_TARGET_IDS} from '../collectors/direct/registry.mjs';
import {summarizeMerchantOffers} from '../lib/merchant-quote-preview.mjs';
const origin='https://www.bbshare.site',target={id:'bbshare',origin,name:'BBShare'};
const jsonld=graph=>`<script id="bbshare-prerender-jsonld" type="application/ld+json">${JSON.stringify({'@graph':graph})}</script>`;
const item=(id='gpt-plus')=>({'@type':'ListItem',name:id,url:origin+'/products/'+id});
const catalog=rows=>jsonld([{'@type':'ItemList',itemListElement:rows}]);
function detail({id='gpt-plus',name='GPT Plus · 1个月',brand='ChatGPT',price='138',currency='CNY',availability='https://schema.org/InStock',duration='1个月',warranty='30天',url=origin+'/products/'+id}={}){
 return jsonld([{'@type':'Product',sku:id,name,description:name+'代充',brand:{name:brand},offers:{'@type':'Offer',price,priceCurrency:currency,availability,url}}])+`<main><h1>${name}</h1><strong>微信支付¥${price}</strong><dl><dt>订阅周期</dt><dd>${duration}</dd><dt>质保期限</dt><dd>${warranty}</dd></dl></main>`;
}
const robots='User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n';
const response=body=>new Response(body,{headers:{'content-type':'text/html'}});

test('abbreviated GPT and Claude tiers survive the stored quote and directory projection',()=>{
 const offers=['5x','20x'].flatMap(tier=>['GPT','Claude'].map(brand=>{
  const id=brand.toLowerCase()+'-'+tier;
  return parseBBShareProduct(detail({id,brand:brand==='GPT'?'ChatGPT':brand,name:`${brand} ${tier} · 1个月`}),origin+'/products/'+id,target);
 }));
 const preview=summarizeMerchantOffers(offers);assert.equal(preview.rawCount,4);assert.equal(preview.validCount,4);
});

test('public detail validates real price/currency/period/availability and separates account from recharge',()=>{
 const offer=parseBBShareProduct(detail(),origin+'/products/gpt-plus',target);
 assert.equal(parseBBShareProduct(detail().replace('<h1>GPT Plus · 1个月</h1>','<h1>ChatGPT Plus代充1个月</h1>'),origin+'/products/gpt-plus',target).price,138);
 assert.equal(offer.price,138);assert.equal(offer.status,'in_stock');assert.equal(deliveryForm(offer),'代充');assert.match(offer.title,/1个月/);
 const account=parseBBShareProduct(detail({id:'gpt-account',name:'GPT成品号含1个月plus',price:'238'}),origin+'/products/gpt-account',target);
 assert.equal(deliveryForm(account),'成品账号');assert.doesNotMatch(account.extra.deliveryEvidence.description,/代充/);
 const unknown=parseBBShareProduct(detail({duration:'以商品名称为准',name:'GPT Plus'}),origin+'/products/gpt-plus',target);
 assert.doesNotMatch(unknown.title,/1个月/);assert.match(unknown.title,/质保30天/);
 assert.equal(parseBBShareProduct(detail({availability:'https://schema.org/OutOfStock'}),origin+'/products/gpt-plus',target).status,'out_of_stock');
 assert.equal(parseBBShareProduct(detail({availability:'unknown'}),origin+'/products/gpt-plus',target).status,'unknown');
});
test('fails closed on mismatched product, foreign URL, missing detail and conflicting visible price',()=>{
 for(const html of [detail({id:'other'}),detail({url:'https://evil.com/products/gpt-plus'}),detail({price:'0'}),detail({currency:'USD'}),detail().replace('微信支付¥138','微信支付¥128'),detail().replace('<h1>GPT Plus · 1个月</h1>','<h1>another</h1>'),'fallback']){
  assert.throws(()=>parseBBShareProduct(html,origin+'/products/gpt-plus',target),{code:'INVALID_CATALOG'});
 }
 for(const rows of [[item(),item()],[{...item(),url:'https://evil.com/products/a'}],Array.from({length:19},(_,i)=>item('p'+i))])assert.throws(()=>parseBBShareCatalog(catalog(rows)),{code:'INVALID_CATALOG'});
 assert.throws(()=>parseBBShareProduct(detail(),origin+'/products/gpt-plus',{...target,id:'arbitrary',approved:true}));
});
test('collector only follows listed public product pages, not forbidden API or scripts, and never returns partial data',async()=>{
 const calls=[];const fetchImpl=async url=>{calls.push(url);return response(url.endsWith('/robots.txt')?robots:url===origin+'/'?catalog([item()]):detail());};
 const offers=await collectBBShare(target,{fetchImpl,sleep:async()=>{}});
 assert.equal(offers.length,1);assert.deepEqual(calls,[origin+'/robots.txt',origin+'/',origin+'/products/gpt-plus']);
 for(const policy of ['User-agent: *\nDisallow: /','User-agent: *\nAllow: /\nDisallow: /products/']){
  let n=0;await assert.rejects(collectBBShare(target,{fetchImpl:async()=>{n++;return response(policy);},sleep:async()=>{}}),{code:'ROBOTS_DISALLOWED'});assert.equal(n,1);
 }
 await assert.rejects(collectBBShare(target,{sleep:async()=>{},fetchImpl:async url=>response(url.endsWith('/robots.txt')?robots:url===origin+'/'?catalog([item(),item('missing')]):url.endsWith('/missing')?'missing':detail())}),{code:'INVALID_CATALOG'});
});
test('adapter is application-only, and the real preflight uses it with bounded public requests',async()=>{
 assert.ok(!DEFAULT_DIRECT_TARGET_IDS.includes('bbshare'));assert.equal(directTargets().some(x=>x.id==='bbshare'),false);
 let limits;const calls=[];
 const result=await probeMerchantCatalog({id:'merchant-test',identity:'domain:www.bbshare.site',shopUrl:origin+'/',shopName:'BBShare',platform:'independent'},
 {merchantFetchFactory:(_origin,options)=>{limits=options;return async url=>{calls.push(url);return response(url.endsWith('/robots.txt')?robots:url===origin+'/'?catalog([item()]):detail());};}},new Date().toISOString(),Date.now()+30000);
 assert.equal(result.offers.length,1);assert.equal(result.offers[0].sourceId,'merchant-test');assert.equal(limits.maxRequests,20);
 assert.ok(calls.every(url=>!url.includes('/api/')));
});
