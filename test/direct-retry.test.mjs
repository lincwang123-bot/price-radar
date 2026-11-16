import test from 'node:test';
import assert from 'node:assert/strict';
import {withPublicReadRetry,retryingPublicFetch} from '../lib/direct-read-retry.mjs';

test('one bounded retry for transport timeout/reset/5xx across public collectors',async()=>{
  for(const error of [Object.assign(new Error('reset'),{code:'ECONNRESET'}),Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),Object.assign(new Error('server'),{status:503})]) {
    let calls=0;const waits=[];
    assert.equal(await withPublicReadRetry(async()=>{if(++calls===1)throw error;return 'ok';},{sleep:async ms=>waits.push(ms)}),'ok');
    assert.equal(calls,2);assert.deepEqual(waits,[1500]);
  }
});
test('fetch retry budget spans pages; HTML errors/challenges and aborts are not retried',async()=>{
  let calls=0;
  const f=retryingPublicFetch(async()=>{calls++;return Response.json({error:'unavailable'},{status:502});},{sleep:async()=>{},maxRetries:2});
  await assert.rejects(f('https://shop.com/'));assert.equal(calls,2);
  assert.equal((await f('https://shop.com/')).status,502);assert.equal(calls,4);
  for(const response of [new Response('<title>Just a moment</title>',{status:503}),Response.json({error:'challenge'},{status:502,headers:{'cf-mitigated':'challenge'}})]) {
    let n=0;const limited=retryingPublicFetch(async()=>{n++;return response;},{sleep:async()=>{}});
    assert.equal(await limited('https://shop.com/'),response);assert.equal(n,1);
  }
  const controller=new AbortController();controller.abort(new Error('cancelled'));
  let n=0;await assert.rejects(retryingPublicFetch(async()=>{n++;},{sleep:async()=>{}})('https://shop.com/',{signal:controller.signal}),/cancelled/);assert.equal(n,0);
});
test('never retries access restrictions, unknown failures or invalid data; never loops forever',async()=>{
  for(const error of [Object.assign(new Error('denied'),{status:403}),Object.assign(new Error('limited'),{status:429}),Object.assign(new Error('robots'),{code:'ROBOTS_DISALLOWED'}),Object.assign(new Error('bad'),{code:'INVALID_CATALOG'}),new Error('unknown')]) {
    let calls=0;await assert.rejects(withPublicReadRetry(async()=>{calls++;throw error;},{sleep:async()=>{}}));assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(withPublicReadRetry(async()=>{calls++;throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});},{sleep:async()=>{}}));assert.equal(calls,2);
});
