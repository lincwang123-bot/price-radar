import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTORY_CSS} from '../lib/directory-styles.mjs';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../lib/web.mjs';

test('compact hero spacing is scoped to the adjacent shop search, without changing other search layouts',()=>{
 assert.match(DIRECTORY_CSS,/\.shop-search\s*\+\s*\.growth-hero\s*\{padding-top:12px\}/);
 assert.match(DIRECTORY_CSS,/\.shop-search\s*\+\s*\.growth-hero\s*>\s*\.growth-eyebrow\s*\{margin-top:0\}/);
 assert.match(DIRECTORY_CSS,/\.shop-search\{margin:0 0 28px;max-width:680px\}/);
 assert.match(DIRECTORY_CSS,/\.shop-search\{margin-inline:auto\}/);
 assert.match(DIRECTORY_CSS,/@media\(max-width:600px\)\{\.shop-search\{margin-bottom:22px\}/);
});

test('only the homepage places the hero directly after the search form',async()=>{
 const db=openDb(':memory:'),app=createApp({db});
 try{
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.address().port;
  const home=await(await fetch(origin+'/')).text();
  assert.match(home,/<form class="shop-search"[\s\S]*?<\/form><header class="growth-hero">/);
  for(const path of ['/catalog','/?family=chatgpt','/?shop_q=missing']){
   const html=await(await fetch(origin+path)).text();
   assert.match(html,/<form class="shop-search"/);
   assert.doesNotMatch(html,/<header class="growth-hero">/);
  }
 }finally{
  app.closeAllConnections();
  if(app.listening)await new Promise(resolve=>app.close(resolve));
  await app.merchantWorkflowDone?.();
  await app.retentionWorkflowDone?.();
  db.close();
 }
});
