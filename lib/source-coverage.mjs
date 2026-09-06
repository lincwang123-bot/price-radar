import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { projectProduct, productQuoteGroups, quoteAvailable, sourceHealth } from './quote-policy.mjs';
import { publicOfferAllowed } from './public-offers.mjs';
import { classifyDirectOffer } from '../collectors/direct/catalog.mjs';

const keyOf=p=>JSON.stringify([p.product_id,p.comparison_key]);
function canonicalGroups(groups) {
  const result=new Map();
  for(const p of groups)for(const offer of p.offers||[]) {
    // Only the already-tested direct classifier is allowed to establish an alias.
    // A generic label or matching price is never evidence of SKU equivalence.
    const canonical=classifyDirectOffer({...offer,sourceId:offer.source_id||offer.sourceId});
    const warranty=String(offer.title||'').match(/全程质保|质保\s*\d+\s*(?:天|日|个月|月|年)/)?.[0].replace(/\s/g,'')||'保障未注明';
    const row={...p,product_id:canonical?.id||p.product_id,comparison_key:`${p.comparison_key}:warranty=${warranty}`,offers:[]};
    const key=keyOf(row);if(!result.has(key))result.set(key,row);result.get(key).offers.push(offer);
  }
  return [...result.values()];
}
function validOffers(source,p) { return (p.offers||[]).filter(o=>publicOfferAllowed(source,o)&&quoteAvailable(source,o)&&o.comparison_known); }
function uniqueShops(offers) { return new Set(offers.map(o=>{try{return new URL(o.url).hostname;}catch{return null;}}).filter(Boolean)).size; }
export function evaluateCoverage({baseline=[],direct=[],baselineStale=false,directStale=false,checkedAt=new Date().toISOString(),minIndependentShops=1}={}) {
  baseline=canonicalGroups(baseline);direct=canonicalGroups(direct);
  const candidates=new Map(direct.map(p=>[keyOf(p),p]));
  const rows=baseline.map(p=>{
    const reference=validOffers('priceai',p), independent=validOffers('direct-shops',candidates.get(keyOf(p))||{});
    const comparable=p.comparable!==false&&reference.length>0;
    const shops=uniqueShops(independent);
    const baselineMinimum=reference.length?Math.min(...reference.map(o=>Number(o.price))):null;
    const directMinimum=independent.length?Math.min(...independent.map(o=>Number(o.price))):null;
    return {key:keyOf(p),productId:p.product_id,spec:p.comparison_label||p.comparison_key,comparable,baselineOffers:reference.length,directOffers:independent.length,directShops:shops,baselineMinimum,directMinimum,priceCompetitive:directMinimum!=null&&baselineMinimum!=null&&directMinimum<=baselineMinimum,covered:comparable&&shops>=minIndependentShops};
  });
  const unresolved=rows.filter(r=>!r.comparable).length, comparable=rows.filter(r=>r.comparable), covered=comparable.filter(r=>r.covered).length;
  const determinate=!baselineStale&&!directStale&&comparable.length>0;
  const scopeHash=createHash('sha256').update(JSON.stringify({keys:rows.map(r=>r.key).sort(),minIndependentShops,version:1})).digest('hex');
  return {version:1,checkedAt,date:checkedAt.slice(0,10),status:determinate?'assessed':'indeterminate',reason:baselineStale?'PriceAI基准陈旧或失败':directStale?'直采快照整体不可用':!comparable.length?'没有有效可比基准':null,scope:'PriceAI公开报价样本，不是全站或全市场',scopeHash,minIndependentShops,baselineGroups:rows.length,comparableGroups:comparable.length,unresolvedGroups:unresolved,coveredGroups:determinate?covered:null,coverageRatio:determinate?covered/comparable.length:null,passes:determinate&&unresolved===0&&covered===comparable.length&&comparable.every(r=>r.priceCompetitive),rows};
}
export function replacementGate(history,{days=7,now=Date.now()}={}) {
  const byDay=new Map();
  for(const row of history) {if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))continue;const old=byDay.get(row.date);byDay.set(row.date,old?{...row,passes:old.passes&&row.passes,status:old.status==='assessed'?row.status:old.status,scopeHash:old.scopeHash===row.scopeHash?row.scopeHash:null}:row);}
  const rows=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-days);
  const consecutive=rows.length===days&&rows.every((r,i)=>i===0||Date.parse(r.date)-Date.parse(rows[i-1].date)===86400000);
  const latestDay=rows.at(-1)?.date;
  const recent=latestDay&&now-Date.parse(latestDay)<2*86400000&&Date.parse(latestDay)<=now;
  const ready=consecutive&&recent&&rows.every(r=>r.passes&&r.status==='assessed'&&r.scopeHash&&r.scopeHash===rows[0].scopeHash);
  return {requiredDays:days,observedDays:rows.length,recommendation:ready?'eligible_for_manual_review':'keep_supplement',note:ready?'连续每日样本验收通过；仅建议人工复核必要品类与旧URL后停用，不会自动关闭来源。':'尚未满足连续同范围验收；继续保留补缺源。每日采样不代表全天持续可用。'};
}
export function coverageFromDb(db,options={}) {
  const read=source=>{const snapshot=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(source);if(!snapshot)return {snapshot:null,groups:[]};const products=db.prepare('SELECT * FROM products WHERE source=? AND snapshot_id=?').all(source,snapshot.snapshot_id);return {snapshot,groups:products.flatMap(p=>productQuoteGroups(projectProduct(db,source,snapshot,p,options)))};};
  const baseline=read('priceai'),direct=read('direct-shops');
  const bad=source=>['failed','stale'].includes(sourceHealth(db,source).status);
  const now=options.now??Date.now();
  const referenceTime=Date.parse(baseline.snapshot?.generated_at||baseline.snapshot?.published_at||'');
  const referenceOld=!Number.isFinite(referenceTime)||now-referenceTime>(options.maxReferenceAgeMinutes??60)*60000;
  const directOld=!direct.snapshot||now-Date.parse(direct.snapshot.fetched_at)>1440*60000;
  const directOffers=direct.groups.flatMap(p=>p.offers||[]);
  const directUnavailable=directOffers.length>0&&directOffers.every(o=>o.quote_stale);
  const result=evaluateCoverage({...options,checkedAt:new Date(now).toISOString(),baseline:baseline.groups,direct:direct.groups,baselineStale:!baseline.snapshot||!!baseline.snapshot.stale||bad('priceai')||referenceOld,directStale:directOld||directUnavailable||sourceHealth(db,'direct-shops').status==='failed'});
  return {...result,snapshots:{priceai:baseline.snapshot?.snapshot_id||null,direct:direct.snapshot?.snapshot_id||null}};
}
export function recordCoverageDaily(db,file,options={}) {
  const result=coverageFromDb(db,options);
  let history=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
  if(!Array.isArray(history))throw new Error('覆盖验收记录格式错误');
  const previous=history.find(r=>r.date===result.date);
  if(previous?.snapshots?.priceai===result.snapshots.priceai&&previous?.snapshots?.direct===result.snapshots.direct&&previous?.status===result.status&&(previous?.latestPasses??previous?.passes)===result.passes)return {result:previous,gate:replacementGate(history,options),written:false};
  const allValidPassed=(previous?.allValidPassed??true)&&(result.status!=='assessed'||result.passes);
  const daily={...result,latestPasses:result.passes,passes:result.passes&&allValidPassed,allValidPassed,observations:(previous?.observations||0)+1,indeterminateObservations:(previous?.indeterminateObservations||0)+Number(result.status==='indeterminate')};
  history=[...history.filter(r=>r.date!==result.date),daily].sort((a,b)=>a.date.localeCompare(b.date)).slice(-90);
  const temp=`${file}.${process.pid}.tmp`;
  try{writeFileSync(temp,JSON.stringify(history,null,2),{flag:'wx',mode:0o600});renameSync(temp,file);}finally{if(existsSync(temp))unlinkSync(temp);}
  return {result:daily,gate:replacementGate(history,options),written:true};
}
export function readCoverageLedger(dataDir) {
  if(!dataDir||!path.isAbsolute(dataDir))return [];
  const file=path.join(dataDir,'source-coverage-ledger.json');
  if(!existsSync(file))return [];
  const rows=JSON.parse(readFileSync(file,'utf8'));
  if(!Array.isArray(rows))throw new Error('覆盖验收记录格式错误');
  return rows.slice(-90);
}
export function coverageMarkdown(result,gate) {
  return `# 独立采集覆盖验收\n\n检查时间：${result.checkedAt}\n\n口径：${result.scope}。同产品ID、规格键、周期、币种、在售、公开保障过滤与新鲜度；不同口径不合并。\n\n状态：${result.status}${result.reason?'（'+result.reason+'）':''}\n\n可比较 ${result.comparableGroups} 组；信息不足 ${result.unresolvedGroups} 组；覆盖 ${result.coveredGroups??'不可判定'} 组；覆盖率 ${result.coverageRatio==null?'不可判定':(result.coverageRatio*100).toFixed(1)+'%'}。\n\n${gate.note}\n\n| 产品 | 规格 | 直采独立域名数 | 状态 |\n|---|---|---:|---|\n${result.rows.map(r=>`| ${r.productId} | ${String(r.spec).replaceAll('|','/')} | ${r.directShops} | ${!r.comparable?'规格或基准不足':r.covered?'样本已覆盖':'待补齐'} |`).join('\n')}\n`;
}
