import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const files = Object.freeze({chatgpt:'chatgpt.svg',claude:'claude.svg',gemini:'gemini.svg',grok:'grok.svg',x:'x.svg',suno:'suno.svg',cursor:'cursor.svg',perplexity:'perplexity.svg',notion:'notion.svg',manus:'manus.svg',microsoft:'microsoft.svg'});
const assets = new Map(Object.entries(files).map(([key,file])=>{
  const body = readFileSync(new URL('../assets/brands/'+file,import.meta.url));
  return [key,{file,body,hash:createHash('sha256').update(body).digest('hex').slice(0,16),mime:file.endsWith('.svg')?'image/svg+xml':'image/png'}];
}));
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function brandMark(platform, cls = '') {
  const key = String(platform ?? '').toLowerCase().replace(/ ai$/, '');
  const asset = assets.get(key);
  if(asset)return `<img class="brand-logo${cls?' '+esc(cls):''}" src="/assets/brands/${asset.file}?v=${asset.hash}" width="24" height="24" alt="" aria-hidden="true">`;
  const paths = key === 'relay' || key === 'api / 中转' ? '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>' : key === 'mail' || key === '邮箱 / 接码' ? '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>' : '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>';
  return `<svg class="brand-generic${cls?' '+esc(cls):''}" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
export function brandAssetRoute(req,res,url) {
  if(!url.pathname.startsWith('/assets/brands/'))return false;
  const asset = [...assets.values()].find(item=>url.pathname==='/assets/brands/'+item.file);
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!asset){res.statusCode=404;res.end();return true;}
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.end();return true;}
  res.setHeader('Content-Type',asset.mime);
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.setHeader('Cache-Control',url.searchParams.get('v')===asset.hash?'public, max-age=31536000, immutable':'public, max-age=3600');
  res.setHeader('Content-Length',asset.body.length);
  res.end(req.method==='HEAD'?undefined:asset.body);return true;
}
