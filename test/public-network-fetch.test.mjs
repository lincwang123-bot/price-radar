import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createPublicNetworkFetch,isPublicAddress,publicHttpsUrl} from '../lib/public-network-fetch.mjs';

test('SSRF拒绝IPv4/IPv6私网、保留、混合与特殊地址',()=>{
  for(const ip of ['127.0.0.1','0.0.0.0','10.2.3.4','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','192.0.0.1','198.19.1.1','198.51.100.1','203.0.113.1','224.1.1.1','255.255.255.255','::1','::','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1','2002:808:808::1','2001:10::1','3fff::1']) assert.equal(isPublicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(ip),true,ip);
  for(const url of ['http://public-shop.com','https://public-shop.com:8443','https://u:p@public-shop.com','https://127.1','https://0x7f000001','https://[::1]','https://server.local','https://metadata.google.internal','https://localhost.com']) assert.throws(()=>publicHttpsUrl(url),url);
});

function harness({addresses=[{address:'8.8.8.8',family:4}],status=200,body='{}',headers={'content-type':'application/json'}}={}) {
  const captured=[];
  const request=(url,options,callback)=>{
    captured.push({url,options});
    const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};
    req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;callback(res);if(!res.destroyed)res.end(body);});
    return req;
  };
  return {captured,request,lookup:async()=>addresses};
}
test('校验所有DNS答案，任一非公开地址则零连接',async()=>{
  for(const addresses of [[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'2606:4700::1111',family:6},{address:'::1',family:6}]]) {
    const h=harness({addresses});await assert.rejects(createPublicNetworkFetch('https://public-shop.com',h)('https://public-shop.com/api'),/DNS/);assert.equal(h.captured.length,0);
  }
});
test('DNS固定连接地址且保留TLS hostname、SNI、证书验证；无代理及Cookie',async()=>{
  const h=harness();const response=await createPublicNetworkFetch('https://public-shop.com',h)('https://public-shop.com/api',{headers:{Cookie:'private',Authorization:'secret',Host:'evil.com'}});
  assert.equal(await response.text(),'{}');assert.equal(response.url,'https://public-shop.com/api');
  const {url,options}=h.captured[0];assert.equal(url.hostname,'public-shop.com');assert.equal(options.servername,'public-shop.com');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
  assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.host,undefined);
  options.lookup('ignored.attacker.com',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  options.lookup('ignored.attacker.com',{all:true},(error,addresses)=>assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]));
});
test('拒绝重定向、跨源、超大响应、无限请求与DNS超时',async()=>{
  const redirected=harness({status:302,headers:{location:'https://127.0.0.1/'}});
  await assert.rejects(createPublicNetworkFetch('https://public-shop.com',redirected)('https://public-shop.com/api'),/重定向/);assert.equal(redirected.captured.length,1);
  const h=harness(),fetch=createPublicNetworkFetch('https://public-shop.com',{...h,maxRequests:1});
  await assert.rejects(fetch('https://evil.com/api'),/授权/);await fetch('https://public-shop.com/api');await assert.rejects(fetch('https://public-shop.com/api'),/上限/);
  await assert.rejects(createPublicNetworkFetch('https://public-shop.com',{...harness({body:'12345'}),maxBytes:3})('https://public-shop.com/api'),/限制/);
  await assert.rejects(createPublicNetworkFetch('https://public-shop.com',{lookup:()=>new Promise(()=>{}),timeoutMs:5})('https://public-shop.com/api'),/超时/);
});
