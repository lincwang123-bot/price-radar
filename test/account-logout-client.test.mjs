import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../assets/account.js',import.meta.url),'utf8');
for(const failure of ['html','network','json'])test(`logout ${failure} failure restores button after the DOM event has ended`,async()=>{
 let handler,resolveLogout,rejectLogout,destination;
 const status={textContent:'earlier message'},button={disabled:false,addEventListener(type,callback){handler=callback;}};
 const root={dataset:{},querySelector(selector){return selector==='[data-account-logout]'?button:selector==='[data-account-status]'?status:null;}};
 const logout=new Promise((resolve,reject)=>{resolveLogout=resolve;rejectLogout=reject;});
 vm.runInNewContext(script,{document:{querySelector:()=>root},fetch:async url=>url.endsWith('/state')?{ok:true,json:async()=>({csrf:'a'.repeat(64),account:{email:'reader@example.com'}})}:logout,addEventListener(){},localStorage:{setItem(){}},location:{replace(path){destination=path;}},clearInterval,setInterval,URL});
 await new Promise(setImmediate);
 const event={currentTarget:button};const pending=handler(event);event.currentTarget=null;
 assert.equal(button.disabled,true);
 if(failure==='network')rejectLogout(new Error('Failed to fetch'));
 else resolveLogout(failure==='html'?{ok:false,json:async()=>{throw new SyntaxError('unexpected HTML');}}:{ok:false,json:async()=>({error:'页面验证已失效，请刷新后重试'})});
 await assert.doesNotReject(pending);
 assert.equal(button.disabled,false);assert.ok(status.textContent);assert.equal(destination,undefined);
});
