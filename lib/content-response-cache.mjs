import {CONTENT_PATHS} from './guides.mjs';

const paths=new Set(CONTENT_PATHS);
const edgeCookies=new Set(['cf_clearance','__cf_bm','_cfuvid','airadar_hv']);
const replayHeaders=['content-type','content-language','x-robots-tag'];
function publicHtml(body){
 const html=Buffer.isBuffer(body)?body.toString('utf8'):body;
 if(!/^\s*<!doctype html>/i.test(html)||!/<\/html>\s*$/i.test(html))return false;
 if(/\bdata-(?:auth-page|account-page|following-page|unsubscribe-form|sponsor-id|sponsor-token)\b/i.test(html))return false;
 if(/<meta\b[^>]*\bname\s*=\s*(['"])csrf(?:-token)?\1/i.test(html)||/<[^>]+\bnonce\s*=/i.test(html))return false;
 return !(html.match(/<a\b[^>]*\bdata-reader-nav\b[^>]*>/gi)||[]).some(tag=>!/\bhref\s*=\s*(['"])\/login\1/i.test(tag));
}

// Cache only anonymous rendered content inside this process. Every request
// still reaches the server and emits finish for analytics; browser/edge HTML
// remains no-store. A deployment restart discards content and ad configuration.
export function createContentResponseCache({now=Date.now,maxAgeMs=300000,maxBytes=256*1024}={}){
 const entries=new Map();
 return {clear:()=>entries.clear(),handle(req,res){
  if(!['GET','HEAD'].includes(req.method)||!paths.has(req.url)||req.headers.authorization)return false;
  if(String(req.headers.cookie||'').split(';').some(pair=>pair.trim()&&!edgeCookies.has(pair.trim().split('=')[0])))return false;
  const host=String(req.headers.host||'');if(!host||host.length>256)return false;
  const time=now(),key=host+' '+req.url,entry=entries.get(key);
  res.setHeader('Cache-Control','no-store');
  if(entry&&time>=entry.at&&time<entry.at+maxAgeMs){
   for(const [name,value] of Object.entries(entry.headers))res.setHeader(name,value);
   res.setHeader('X-Price-Radar-Content-Cache','HIT');
   res.end(req.method==='HEAD'?undefined:entry.body);return true;
  }
  entries.delete(key);
  if(req.method!=='GET')return false;
  res.setHeader('X-Price-Radar-Content-Cache','MISS');
  const end=res.end;
  res.end=function(...args){
   const body=args[0];
   if(!res.headersSent)res.setHeader('Cache-Control','no-store');
   if(res.statusCode===200&&!res.headersSent&&!res.getHeader('set-cookie')&&!res.getHeader('vary')&&/^text\/html(?:;|$)/i.test(String(res.getHeader('content-type')||''))&&(typeof body==='string'||Buffer.isBuffer(body))&&Buffer.byteLength(body)<=maxBytes&&publicHtml(body)){
    const headers={};for(const name of replayHeaders){const value=res.getHeader(name);if(value!==undefined)headers[name]=value;}
    if(entries.size>=32)entries.delete(entries.keys().next().value);
    entries.set(key,{at:time,body:Buffer.isBuffer(body)?Buffer.from(body):body,headers});
   }
   return end.apply(this,args);
  };
  return false;
 }};
}
