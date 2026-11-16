import {publicCacheUrl} from './public-cache-key.mjs';
const paths=new Set(['/', '/index.html', '/en', '/en/']);
const edgeCookies=new Set(['cf_clearance','__cf_bm','_cfuvid','airadar_hv']);
const replayHeaders=['content-type','content-language','x-robots-tag'];

// Origin render cache. Browsers still receive Cache-Control: no-store.
// nginx may keep a copy for X-Accel-Expires; those hits are counted by the
// page's edge beacon, not by another origin render. Personalized cookies never share HTML.
export function createHomeResponseCache({revision,now=Date.now,maxAgeMs=30000,maxBytes=512*1024,onImpressions=()=>{}}) {
 const entries=new Map();
 return {handle(req,res){
  const cacheUrl=publicCacheUrl(req.url);
  if(!['GET','HEAD'].includes(req.method)||!paths.has(cacheUrl)||req.headers.authorization)return false;
  if(String(req.headers.cookie||'').split(';').some(pair=>pair.trim()&&!edgeCookies.has(pair.trim().split('=')[0])))return false;
  if(maxAgeMs<=0){res.setHeader('X-Accel-Expires','0');return false;}
  const host=String(req.headers.host||'');if(host.length>256)return false;
  let version;try{version=revision();}catch{return false;}
  const time=now(),key=host+' '+cacheUrl,entry=entries.get(key);
  if(entry&&entry.version===version&&time>=entry.at&&time<entry.at+maxAgeMs){
   for(const [name,value] of Object.entries(entry.headers))res.setHeader(name,value);
   res.setHeader('X-Price-Radar-Home-Cache','HIT');
   res.setHeader('X-Accel-Expires','30');
   if(entry.growthContext)res.growthContext=entry.growthContext;
   onImpressions(req,res,entry.impressions);
   res.end(req.method==='HEAD'?undefined:entry.body);return true;
  }
  entries.delete(key);
  if(req.method!=='GET')return false;
  res.setHeader('X-Price-Radar-Home-Cache','MISS');
  res.homeCacheImpressions=[];
  const end=res.end;
  res.end=function(...args){
   const body=args[0];
   if(!res.headersSent)res.setHeader('X-Accel-Expires','0');
   if(res.statusCode===200&&!res.headersSent&&!res.getHeader('set-cookie')&&(typeof body==='string'||Buffer.isBuffer(body))&&Buffer.byteLength(body)<=maxBytes){
    try{
     if(revision()===version){
      const headers={};for(const name of replayHeaders){const value=res.getHeader(name);if(value!==undefined)headers[name]=value;}
      if(entries.size>=8)entries.delete(entries.keys().next().value);
      entries.set(key,{version,at:time,body:Buffer.isBuffer(body)?Buffer.from(body):body,headers,impressions:[...res.homeCacheImpressions],growthContext:res.growthContext||null});
      if(!res.headersSent)res.setHeader('X-Accel-Expires','30');
     }
    }catch{/* A cache failure must not prevent a live response. */}
   }
   return end.apply(this,args);
  };
  return false;
 }};
}

// Quote rows change constantly. Freshness is the cache TTL (30s by default),
// not SQLite's data_version. Campaign edits still drop the page immediately.
export function homeResponseRevision(_db,_privateDb,analytics){
 return ()=>{
  const campaigns=analytics?.outbound?.activeCampaigns?.()||[];
  return JSON.stringify(campaigns.map(campaign=>[campaign.id,campaign.status,campaign.version,campaign.start_at,campaign.end_at,campaign.placement,campaign.page_key]));
 };
}
