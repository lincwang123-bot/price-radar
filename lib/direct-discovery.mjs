import {mkdirSync,readFileSync,renameSync,writeFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {safeFetchJson,safeFetchText,isAccessDeniedError} from './safe-fetch.mjs';
import {classifyPreflightError} from './merchant-preflight-guidance.mjs';
import {authorizeMerchantTarget} from './merchant-target-capability.mjs';
import {PLATFORM16688_SHOPS} from '../collectors/direct/platform16688.mjs';

const ORIGIN='https://www.16688.com.cn';
const MAX_STORES=200,MAX_PAGES=10,PAGE_SIZE=20,MAX_GOODS=200;
const invalid=()=>{throw Object.assign(new Error('16688 公开发现目录不完整或身份不一致'),{code:'INVALID_CATALOG'});};
const fileFor=dataDir=>path.join(dataDir,'direct-discovery','16688.json');
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const shopNumber=value=>typeof value==='string'&&/^S\d{1,20}$/.test(value);
const goodsNumber=value=>typeof value==='string'&&/^G\d{1,20}$/.test(value);
function targetFor(row) {
  if(!shopNumber(row?.shopNo)||!goodsNumber(row.seedGoodsNo)||typeof row.name!=='string'||!row.name.trim()||row.name.length>120||/[\u0000-\u001f]/.test(row.name)||!validDate(row.verifiedAt))invalid();
  const target={id:`16688-${row.shopNo.toLowerCase()}`,kind:'platform16688',origin:ORIGIN,shopNo:row.shopNo,name:row.name,
    currency:'CNY',intervalMinutes:60,seedUrl:`${ORIGIN}/goods/${row.seedGoodsNo}`,discoveryUrl:`${ORIGIN}/source`};
  authorizeMerchantTarget(target);return target;
}
function readState(dataDir) {
  try {
    const file=fileFor(dataDir);if(statSync(file).size>256*1024)return null;
    const state=JSON.parse(readFileSync(file,'utf8'));
    if(state.schemaVersion!==1||!validDate(state.checkedAt)||!Array.isArray(state.stores)||state.stores.length>MAX_STORES||new Set(state.stores.map(s=>s.shopNo)).size!==state.stores.length)return null;
    state.stores.forEach(targetFor);
    return state;
  }catch{return null;}
}
export function loadDiscovered16688(dataDir){return(readState(dataDir)?.stores||[]).map(targetFor);}
function saveState(dataDir,state){const file=fileFor(dataDir);mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(state));renameSync(temp,file);}
function resultFor(state){return{status:state.status,checkedAt:state.checkedAt,reasonCode:state.reasonCode??null,
  discoveredCount:state.discoveredCount||0,catalogTotal:state.catalogTotal||0,inspectedGoodsCount:state.inspectedGoodsCount||0,
  pendingGoodsCount:state.pendingGoodsCount||0,failures:state.failures||0,
  blockedOrigin:['access_denied','rate_limited','login_required','robots_disallowed'].includes(state.reasonCode)?ORIGIN:null,
  targets:state.stores.map(targetFor)};}

// This is a bounded original-platform roster refresh, not an offer feed. Only
// goods numbers -> retail goods/detail -> shop/detail are retained. No wholesale
// price, supplier contact, claimed certification or merchant API is imported.
export async function discover16688({dataDir,fetchImpl=globalThis.fetch,sleep=delay,now=Date.now(),refresh=false}={}) {
  const previous=readState(dataDir),age=now-Date.parse(previous?.checkedAt);
  if(!refresh&&age>=0&&age<6*3600000)return {...resultFor(previous),reused:true,discoveredCount:0};
  const state={schemaVersion:1,checkedAt:new Date(now).toISOString(),status:'ok',stores:previous?.stores||[],checkedGoods:{},discoveredCount:0,failures:0};
  const deadline=Date.now()+60000;let lastStart=0;
  const options={allowedOrigins:[ORIGIN],fetchImpl,maxBytes:2*1024*1024,maxRedirects:0};
  const read=async(endpoint,body)=>{
    const wait=Math.max(0,1000-(Date.now()-lastStart));
    if(Date.now()+wait+100>=deadline)throw Object.assign(new Error('公开目录采集超时'),{code:'ETIMEDOUT'});
    await sleep(wait);lastStart=Date.now();
    const opts={...options,timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now()))};
    return body===undefined?safeFetchText(ORIGIN+endpoint,opts):safeFetchJson(ORIGIN+endpoint,{...opts,method:'POST',allowedMethods:['POST'],headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  };
  try {
    let robots='';try{robots=await read('/robots.txt');}catch(error){if(error.status!==404)throw error;}
    // Empty/404 robots was observed. Stop on any new non-empty restriction until
    // its scope is reviewed; do not guess that a directory restriction is safe.
    if(robots.split(/\r?\n/).some(line=>/^\s*Disallow:\s*\S/i.test(line.split('#')[0])))throw Object.assign(new Error('16688 公开目录读取规则发生限制'),{code:'ROBOTS_DISALLOWED'});
    const goods=[],seen=new Set(),priority=new Map();let total=null;
    for(let page=1;page<=MAX_PAGES;page++) {
      const payload=await read('/index/SourceGoods/list',{page_no:page,page_size:PAGE_SIZE});
      const data=payload?.data,n=Number(data?.total);
      if(Number(payload?.code)!==1||!Array.isArray(data?.list)||!Number.isSafeInteger(n)||n<0||n>MAX_GOODS||data.list.length>PAGE_SIZE||(total!==null&&n!==total))invalid();
      total=n;
      for(const row of data.list){if(!goodsNumber(row?.goods_no)||seen.has(row.goods_no))invalid();seen.add(row.goods_no);goods.push(row.goods_no);
        priority.set(row.goods_no,/(?:gpt|codex|claude|gemini|grok|cursor|perplexity|notion|manus|api|邮箱|接码)/i.test(String(row.name||''))?1:0);}
      if(goods.length>total)invalid();
      if(goods.length===total)break;
      if(!data.list.length||page===MAX_PAGES)invalid();
    }
    state.catalogTotal=goods.length;
    for(const id of goods)if(validDate(previous?.checkedGoods?.[id]))state.checkedGoods[id]=previous.checkedGoods[id];
    const knownSeeds=new Set(PLATFORM16688_SHOPS.map(row=>new URL(row.seedUrl).pathname.split('/').at(-1)));
    const knownShops=new Set(PLATFORM16688_SHOPS.map(row=>row.shopNo));
    for(const id of goods)if(knownSeeds.has(id))state.checkedGoods[id]=state.checkedAt;
    const candidates=goods.filter(id=>!knownSeeds.has(id)).sort((a,b)=>(Date.parse(state.checkedGoods[a])||0)-(Date.parse(state.checkedGoods[b])||0)||(priority.get(b)-priority.get(a)));
    let inspected=0;
    for(const id of candidates.slice(0,20)) {
      if(Date.now()+2000>=deadline||state.stores.length>=MAX_STORES)break;
      try {
        const detail=await read('/shopApi/goods/detail',{goods_no:id});
        if(Number(detail?.code)!==1||detail?.data?.goods_no!==id||!shopNumber(detail.data.shop_no))invalid();
        const shopNo=detail.data.shop_no;
        if(!knownShops.has(shopNo)&&!state.stores.some(row=>row.shopNo===shopNo)) {
          const shop=await read('/shopApi/shop/detail',{shop_no:shopNo});
          if(Number(shop?.code)!==1||shop?.data?.shop_no!==shopNo)invalid();
          const row={shopNo,name:String(shop.data.name||'').replace(/\s+/g,' ').trim(),seedGoodsNo:id,verifiedAt:state.checkedAt};
          targetFor(row);state.stores.push(row);state.discoveredCount++;
        }
      }catch(error) {
        if(isAccessDeniedError(error))throw error;
        state.failures++;
      }
      state.checkedGoods[id]=state.checkedAt;inspected++;
    }
    state.inspectedGoodsCount=inspected;state.pendingGoodsCount=candidates.filter(id=>!state.checkedGoods[id]).length;
    if(state.pendingGoodsCount||state.failures)state.status='partial';
  }catch(error){state.status='failed';state.reasonCode=classifyPreflightError(error).reasonCode;}
  saveState(dataDir,state);return resultFor(state);
}
