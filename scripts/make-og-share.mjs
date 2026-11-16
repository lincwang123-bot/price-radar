// Rebuild the 1200×630 X summary card. Writes assets/brands/og-share.png.
// Brand name plus one short line only; the site copy already carries the disclaimer.
import sharp from 'sharp';
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const out=join(root,'../assets/brands/og-share.png');
const logoPath=join(root,'../assets/brands/airadar.png');

const svg=`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1220"/>
      <stop offset="58%" stop-color="#10192C"/>
      <stop offset="100%" stop-color="#14233A"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="42%">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#3B82F6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g fill="none" stroke="#3B82F6" stroke-opacity="0.22" stroke-width="1.5">
    <circle cx="600" cy="248" r="132"/>
    <circle cx="600" cy="248" r="188"/>
    <circle cx="600" cy="248" r="252"/>
  </g>
  <circle cx="600" cy="248" r="78" fill="#F8FAFC"/>
  <text x="600" y="392" text-anchor="middle" font-family="Arial, 'WenQuanYi Micro Hei', sans-serif" font-size="64" font-weight="700" fill="#F8FAFC" letter-spacing="1">AIradar</text>
  <text x="600" y="448" text-anchor="middle" font-family="'WenQuanYi Micro Hei', Arial, sans-serif" font-size="30" fill="#93C5FD">AI 订阅价格雷达</text>
  <rect x="560" y="478" width="80" height="4" rx="2" fill="#3B82F6"/>
</svg>`;

const logoSize=124;
const mask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}"><circle cx="${logoSize/2}" cy="${logoSize/2}" r="${logoSize/2}" fill="#fff"/></svg>`);
const logo=await sharp(logoPath).resize(logoSize,logoSize).png().toBuffer();
const roundLogo=await sharp(logo).composite([{input:await sharp(mask).png().toBuffer(),blend:'dest-in'}]).png().toBuffer();
const png=await sharp(Buffer.from(svg)).composite([{input:roundLogo,left:600-logoSize/2,top:248-logoSize/2}]).png().toBuffer();
writeFileSync(out,png);
console.log('wrote',out,png.length);
