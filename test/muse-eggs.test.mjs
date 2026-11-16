import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';
import {MUSE_EGGS,museEggHtml} from '../lib/muse-eggs.mjs';

const cardLike=/(?:卡密|兑换码|激活码)\s*[:：]?\s*[A-Za-z0-9]{8,}|[A-Za-z0-9]{16,}/;

test('muse clues are numbered hints only',()=>{
 assert.deepEqual(MUSE_EGGS.map(egg=>egg.id),['Muse-03','Muse-05']);
 assert.equal(new Set(MUSE_EGGS.map(egg=>egg.path)).size,2);
 for(const path of ['/help','/about','/weekly'])assert.equal(museEggHtml(path),'',path);
 const source=readFileSync(new URL('../lib/muse-eggs.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,cardLike);
 assert.equal(museEggHtml('/contact'),'');
 for(const egg of MUSE_EGGS){
  const html=museEggHtml(egg.path);
  assert.match(html,new RegExp('#MUSE彩蛋 '+egg.id));
  assert.match(html,/限时 5 名/);
  assert.match(html,/不售号、不代充、不担保/);
  assert.doesNotMatch(html,cardLike);
  assert.doesNotMatch(html,/<!--/);
 }
});

test('public pages show exactly one visible muse clue and no card code',async()=>{
 const db=openDb(':memory:');
 const app=createApp({db});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${app.address().port}`;
 try{
  for(const egg of MUSE_EGGS){
   const response=await fetch(origin+egg.path);
   assert.equal(response.status,200,egg.path);
   const html=await response.text();
   const visible=html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
   assert.match(visible,new RegExp('#MUSE彩蛋 '+egg.id),egg.path);
   const clues=[...visible.matchAll(/<aside class="muse-egg"[\s\S]*?<\/aside>/g)];
   assert.equal(clues.length,1,egg.path);
   assert.match(clues[0][0],new RegExp('data-muse-egg="'+egg.id+'"'));
   assert.doesNotMatch(clues[0][0],cardLike);
   for(const other of MUSE_EGGS)if(other.id!==egg.id)assert.doesNotMatch(visible,new RegExp('#MUSE彩蛋 '+other.id),egg.path);
  }
  for(const path of ['/help','/about','/weekly','/contact','/help/data-and-ranking','/help/price-alerts','/en/about']){
   const html=await(await fetch(origin+path)).text();
   assert.doesNotMatch(html,/#MUSE彩蛋/,path);
  }
 }finally{await new Promise(r=>app.close(r));db.close();}
});

test('og share card is a 1200×630 png written beside the brand assets',async()=>{
 const png=readFileSync(new URL('../assets/brands/og-share.png',import.meta.url));
 const meta=await sharp(png).metadata();
 assert.equal(meta.format,'png');
 assert.equal(meta.width,1200);
 assert.equal(meta.height,630);
 const script=readFileSync(new URL('../scripts/make-og-share.mjs',import.meta.url),'utf8');
 assert.match(script,/assets\/brands\/og-share\.png/);
 assert.doesNotMatch(script,/\/tmp\//);
});
