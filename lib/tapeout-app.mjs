import {readFileSync} from 'node:fs';
import {publicAsset, servePublicAsset} from './public-assets.mjs';

// Fixed bundled paths only: request paths never become filesystem paths.
const files = new Map([
  ['/tapeout/', ['index.html', 'text/html; charset=utf-8']],
  ['/tapeout/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/tapeout/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/tapeout/domain.js', ['domain.js', 'text/javascript; charset=utf-8']],
  ['/tapeout/airadar.png', ['airadar.png', 'image/png']],
]);
const assets = new Map();
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";

export function tapeoutRoute(req, res, url) {
  const rawPath = String(req.url || '').split(/[?#]/, 1)[0];
  const matches = path => path === '/tapeout' || path.startsWith('/tapeout/');
  if (!matches(url.pathname) && !matches(rawPath)) return false;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', policy);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow: 'GET, HEAD'});
    res.end();
    return true;
  }
  // Reject dot-segment normalization instead of routing it to another page.
  if (rawPath !== url.pathname || (url.pathname !== '/tapeout' && !files.has(url.pathname))) {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : 'Not found');
    return true;
  }
  if (url.pathname === '/tapeout') {
    res.writeHead(308, {Location: '/tapeout/' + url.search});
    res.end();
    return true;
  }
  if (!assets.has(url.pathname)) {
    const [file, mime] = files.get(url.pathname);
    assets.set(url.pathname, publicAsset(readFileSync(new URL('../assets/tapeout/' + file, import.meta.url)), mime));
  }
  // Keep the standalone document unchanged by edge analytics/script injection.
  servePublicAsset(req, res, url, assets.get(url.pathname), {noTransform: true});
  return true;
}
