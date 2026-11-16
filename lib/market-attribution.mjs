// Compare the exact quote sets behind two daily closing observations.
// Missing evidence stays unknown; a newly observed source is not a price cut.
export function marketAttribution(db,id,history,{legacy=false}={}){
 const unknown={kind:'unknown',label:'变化原因待确认',detail:legacy?'旧记录未保存当时的商品来源集合。':'两端的同店同商品记录尚不完整，暂不能区分调价与来源变化。'};
 if(!db||legacy||history.series.length<2)return unknown;
 const endpoints=[history.series[0],history.series.at(-1)].map(point=>{
  const row=db.prepare('SELECT observed_at,payload FROM retention_market_evidence WHERE day=? AND group_id=?').get(point.day,id);
  const daily=db.prepare('SELECT last_at FROM retention_market_daily_v2 WHERE day=? AND group_id=?').get(point.day,id);
  if(!row||row.observed_at!==daily?.last_at)return null;
  let data;try{data=JSON.parse(row.payload);}catch{return null;}
  if(data.version!==1||!Array.isArray(data.quotes)||!data.quotes.length||data.quotes.some(q=>typeof q.id!=='string'||!Number.isFinite(q.price)||q.price<=0)||Math.min(...data.quotes.map(q=>q.price))!==point.price)return null;
  return {identityVersion:data.identityVersion||1,quotes:new Map(data.quotes.map(q=>[q.id,q]))};
 });
 const [first,last]=endpoints;if(!first||!last||first.identityVersion!==last.identityVersion)return unknown;
 const before=first.quotes,after=last.quotes;
 const shared=[...after.keys()].filter(id=>before.has(id)),added=[...after.values()].filter(q=>!before.has(q.id)),removed=[...before.values()].filter(q=>!after.has(q.id));
 const changed=shared.filter(id=>before.get(id).price!==after.get(id).price),drops=changed.filter(id=>after.get(id).price<before.get(id).price).length;
 const sourceChanged=added.length>0||removed.length>0;
 const kind=changed.length?(sourceChanged?'mixed':'same_offer_changed'):added.some(q=>q.price<history.series[0].price)?'new_lower_source':sourceChanged?'coverage_changed':'unknown';
 if(kind==='unknown')return unknown;
 return {kind,label:({same_offer_changed:'同店同商品标价变化',new_lower_source:'新观察到更低价来源',coverage_changed:'可用报价来源变化',mixed:'标价与来源同时变化'})[kind],
  shared:shared.length,changed:changed.length,drops,added:added.length,removed:removed.length,
  detail:`两端共同观察到 ${shared.length} 条同店同商品报价；${drops} 条降价、${changed.length-drops} 条涨价，新增观察 ${added.length} 条、末次未观察到 ${removed.length} 条。`+(sourceChanged?'新增或消失只表示采样集合变化，不代表商家刚上架或已下架。':'此处说明公开标价的变化，不推断商家的调价动机。')};
}
