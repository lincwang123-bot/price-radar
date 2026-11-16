import {readFileSync} from 'node:fs';
import {publicAsset,servePublicAsset} from './public-assets.mjs';

// Fixed, reviewed public observations only. Never resolve request paths or read a database.
const versions=['2026-09-30-v1','2026-10-13-v1','2026-10-28-v1'];
const downloads=new Map(versions.flatMap(version=>['csv','json'].map(format=>{
 const filename='chatgpt-go-'+version.slice(0,10).replaceAll('-','')+version.slice(10)+'.'+format;
 const body=readFileSync(new URL('../assets/research/'+filename,import.meta.url));
 return ['/research/chatgpt-go/'+version+'.'+format,{filename,asset:publicAsset(body,(format==='csv'?'text/csv':'application/json')+'; charset=utf-8')}];
})));

export function serveResearchDownload(req,res,url){
 const file=downloads.get(url.pathname);if(!file)return false;
 // The article is the indexable explanation; these are the raw reproducible attachments.
 res.setHeader('X-Robots-Tag','noindex');
 res.setHeader('Content-Disposition','attachment; filename="'+file.filename+'"');
 servePublicAsset(req,res,url,file.asset);
 return true;
}
