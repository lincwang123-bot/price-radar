import {createHash} from 'node:crypto';

// For bundled, non-personal assets only; never pass request/DB content here.
export function publicAsset(content,mime) {
 const body=Buffer.from(content),hash=createHash('sha256').update(body).digest('hex').slice(0,16);
 return {body,hash,mime,etag:'"'+hash+'"'};
}
export function servePublicAsset(req,res,url,asset,{noTransform=false}={}) {
 if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.end();return;}
 res.setHeader('Content-Type',asset.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('ETag',asset.etag);
 const cache=url.searchParams.get('v')===asset.hash?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate';
 res.setHeader('Cache-Control',cache+(noTransform?', no-transform':''));
 const matches=String(req.headers['if-none-match']||'').split(',').map(s=>s.trim().replace(/^W\//,''));
 if(matches.includes(asset.etag)||matches.includes('*')){res.statusCode=304;res.end();return;}
 res.setHeader('Content-Length',asset.body.length);res.end(req.method==='HEAD'?undefined:asset.body);
}
