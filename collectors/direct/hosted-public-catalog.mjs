import {createHash} from 'node:crypto';
import {safeFetchText} from '../../lib/safe-fetch.mjs';
import {readHtml,htmlText,htmlFailure} from '../../lib/public-catalog-html.mjs';
import {deliveryEvidence} from '../../lib/delivery-evidence.mjs';
import {reviewedHostedCatalog,reviewedHostedBuyUrl} from '../../lib/reviewed-hosted-catalogs.mjs';
const text=n=>htmlText(n.parts.map(p=>typeof p==='string'?p:text(p)).join(' '));
export async function collectHostedPublicCatalog(target,shopUrl,access,options){
 const pageUrl=access.publicUrls[0],reviewed=reviewedHostedCatalog(shopUrl,pageUrl);
 if(!reviewed)throw htmlFailure('公开价目页尚未核实来源');
 const doc=readHtml(await safeFetchText(pageUrl,{...options,allowedOrigins:[reviewed.origin],maxRedirects:0,headers:{accept:'text/html'}}));
 if(!doc.all.some(n=>n.tag==='a'&&n.attrs.href===shopUrl))throw htmlFailure('价目页未声明原申请店铺');
 const tables=doc.all.filter(n=>n.tag==='table');
 if(tables.length!==1)throw htmlFailure();
 const rows=doc.all.filter(n=>n.tag==='tr'&&function(){for(let p=n.parent;p;p=p.parent)if(p===tables[0])return true;return false;}());
 const headers=rows[0]?.children.filter(n=>n.tag==='th').map(text);
 if(JSON.stringify(headers)!==JSON.stringify(['商品名称和规格','价格（CNY）','在售状态','原店购买链接'])||rows.length>101)throw htmlFailure();
 const offers=[],seen=new Set();
 for(const row of rows.slice(1)){
  const cells=row.children.filter(n=>n.tag==='td');if(cells.length!==4)throw htmlFailure();
  const title=text(cells[0]),priceText=text(cells[1]).replace(/\s/g,''),stock=text(cells[2]);
  const links=cells[3].children.filter(n=>n.tag==='a'),url=links[0]?.attrs.href;
  const amount=/^[¥￥](\d+(?:\.\d{1,2})?)(?:\/(?:月|\d+个月|\d+年|份|个|次))?$/.exec(priceText);
  if(!title||title.length>300||!amount||!['在售','暂停售卖'].includes(stock)||links.length!==1||!reviewedHostedBuyUrl(shopUrl,pageUrl,url))throw htmlFailure();
  const price=Number(amount[1]),key=title+'\n'+url;if(!(price>0&&price<=1000000)||seen.has(key))throw htmlFailure();seen.add(key);
  offers.push({offerId:target.id+':hosted:'+createHash('sha256').update(key).digest('hex').slice(0,16),sourceId:target.id,
   sourceName:target.name,storeName:target.name,title,price,listedPrice:price,priceBasis:'listed',currency:'CNY',
   status:stock==='在售'?'in_stock':'out_of_stock',stockCount:stock==='在售'?null:0,url,capturedAt:options.capturedAt,
   extra:{deliveryEvidence:deliveryEvidence({productTitle:title}),catalogFormat:'reviewed-hosted-table',collectionMethod:'visible-product',
    catalogUrl:pageUrl,priceEvidence:'店主公开价目页 CNY 标价',stockEvidence:stock,shopUrl}});
 }
 return offers;
}
