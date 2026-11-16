import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/public-traffic.js',import.meta.url),'utf8');
function fixture({reduced=false,intersection=true,media=true,legacyMedia=false,count=2,replay=false}={}){
 const attributes=new Map(),listeners=new Set(),timers=new Map(),observers=[],clicks=new Set(),pageListeners=new Set();
 const button={hidden:true,disabled:false,addEventListener:(name,cb)=>{assert.equal(name,'click');clicks.add(cb);},removeEventListener:(name,cb)=>{assert.equal(name,'click');clicks.delete(cb);}};
 const counters=Array.from({length:count},(_,i)=>{
  const classes=new Set();
  return {textContent:i?'45,868':'6,198',classes,classList:{add:cls=>classes.add(cls),remove:cls=>classes.delete(cls)}};
 });
 let sequence=0;
 const motion={matches:reduced};
 if(legacyMedia){motion.addListener=cb=>listeners.add(cb);motion.removeListener=cb=>listeners.delete(cb);}
 else{motion.addEventListener=(name,cb)=>{assert.equal(name,'change');listeners.add(cb);};motion.removeEventListener=(name,cb)=>{assert.equal(name,'change');listeners.delete(cb);};}
 const context=vm.createContext({
  document:{documentElement:{hasAttribute:name=>attributes.has(name),setAttribute:(name,value)=>attributes.set(name,value)},querySelectorAll:selector=>{assert.equal(selector,'[data-traffic-flip]');return counters;},querySelector:selector=>{assert.equal(selector,'[data-traffic-replay]');return replay?button:null;}},
  ...(media?{matchMedia:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return motion;}}:{}),
  ...(intersection?{IntersectionObserver:class{
   constructor(callback,options){this.callback=callback;this.options=options;this.observed=new Set();this.unobserved=[];this.disconnected=0;observers.push(this);}
   observe(counter){this.observed.add(counter);}
   unobserve(counter){this.observed.delete(counter);this.unobserved.push(counter);}
   disconnect(){this.observed.clear();this.disconnected++;}
  }}:{}),
  setTimeout:(callback,delay)=>{assert.equal(delay,1200);const id=++sequence;timers.set(id,callback);return id;},
  clearTimeout:id=>timers.delete(id),
  addEventListener:(name,cb)=>{assert.equal(name,'pagehide');pageListeners.add(cb);},
  removeEventListener:(name,cb)=>{assert.equal(name,'pagehide');pageListeners.delete(cb);},
  fetch:()=>assert.fail('traffic decoration must not fetch'),
  setInterval:()=>assert.fail('traffic decoration must not poll'),
 });
 const run=()=>vm.runInContext(source,context);
 const emit=(target,isIntersecting=true,intersectionRatio=1)=>observers[0].callback([{target,isIntersecting,intersectionRatio}]);
 const flush=()=>{for(const [id,callback] of [...timers]){timers.delete(id);callback();}};
 const setReduced=value=>{motion.matches=value;for(const callback of [...listeners])callback({matches:value});};
 const click=()=>{for(const callback of [...clicks])callback();};
 const pagehide=()=>{for(const callback of [...pageListeners])callback();};
 return {run,emit,flush,setReduced,click,pagehide,counters,observers,timers,listeners,button,clicks,pageListeners};
}

test('traffic animation runs once on sufficient visibility and cleans transient resources',()=>{
 const f=fixture();f.run();const [a,b]=f.counters,observer=f.observers[0];
 assert.equal(observer.options.threshold,0.35);assert.equal(observer.observed.size,2);
 f.emit(a,false,0);f.emit(a,true,0.34);assert.equal(f.timers.size,0);assert.equal(a.classes.size,0);
 f.emit(a,true,0.35);assert.ok(a.classes.has('is-flipping'));assert.equal(f.timers.size,1);
 assert.deepEqual(observer.unobserved,[a]);
 f.emit(a);assert.equal(f.timers.size,1);assert.equal(observer.unobserved.length,1);
 f.flush();assert.equal(a.classes.size,0);assert.equal(observer.disconnected,0);assert.equal(f.listeners.size,1);
 f.emit(a);assert.equal(f.timers.size,0);
 f.emit(b);assert.ok(b.classes.has('is-flipping'));f.flush();
 assert.equal(b.classes.size,0);assert.equal(observer.disconnected,1);assert.equal(f.listeners.size,1);
 f.emit(a);assert.equal(f.timers.size,0);
 assert.deepEqual(f.counters.map(counter=>counter.textContent),['6,198','45,868']);
 f.pagehide();assert.equal(f.listeners.size,0);assert.equal(f.pageListeners.size,0);
});

test('repeated script execution does not add observers, listeners or animations',()=>{
 const f=fixture();f.run();f.run();assert.equal(f.observers.length,1);assert.equal(f.listeners.size,1);
 f.emit(f.counters[0]);f.run();assert.equal(f.timers.size,1);assert.equal(f.observers.length,1);
});

test('reduced motion at load keeps final digits static without observers or timers',()=>{
 const f=fixture({reduced:true,replay:true});f.run();assert.equal(f.observers.length,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
 assert.equal(f.button.hidden,true);assert.equal(f.clicks.size,0);assert.equal(f.pageListeners.size,0);
 assert.ok(f.counters.every(counter=>counter.classes.size===0));
});

test('enabling reduced motion stops active animation and offscreen observation',()=>{
 for(const legacyMedia of [false,true]){
  const f=fixture({legacyMedia,replay:true});f.run();f.emit(f.counters[0]);assert.equal(f.timers.size,1);
  f.setReduced(true);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,1);assert.equal(f.observers[0].disconnected,1);assert.equal(f.button.hidden,true);
  assert.ok(f.counters.every(counter=>counter.classes.size===0));
  f.emit(f.counters[1]);f.setReduced(false);assert.equal(f.timers.size,0);assert.equal(f.observers.length,1);assert.equal(f.button.hidden,false);
  f.click();assert.equal(f.timers.size,2);f.pagehide();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
 }
});

test('missing enhancement APIs or counters leave static values without work',()=>{
 for(const options of [{intersection:false},{media:false},{count:0}]){
  const f=fixture({...options,replay:true});f.run();assert.equal(f.observers.length,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.equal(f.button.hidden,true);
  assert.ok(f.counters.every(counter=>counter.classes.size===0));
 }
});

test('optional replay plays all real digits once, disables during animation and cancels pending autoplay',()=>{
 const f=fixture({replay:true});f.run();assert.equal(f.button.hidden,false);assert.equal(f.button.disabled,false);
 f.click();assert.equal(f.timers.size,2);assert.equal(f.button.disabled,true);assert.equal(f.observers[0].observed.size,0);
 assert.ok(f.counters.every(counter=>counter.classes.has('is-flipping')));
 const timerIds=[...f.timers.keys()];f.click();f.emit(f.counters[0]);assert.deepEqual([...f.timers.keys()],timerIds);
 f.flush();assert.equal(f.button.disabled,false);assert.ok(f.counters.every(counter=>counter.classes.size===0));
 f.emit(f.counters[1]);assert.equal(f.timers.size,0);
 f.click();assert.equal(f.timers.size,2);f.flush();
 assert.deepEqual(f.counters.map(counter=>counter.textContent),['6,198','45,868']);
 f.pagehide();assert.equal(f.button.hidden,true);assert.equal(f.clicks.size,0);
});

test('autoplay disables replay and reduced-motion changes still apply after animation finishes',()=>{
 const f=fixture({replay:true});f.run();f.emit(f.counters[0]);assert.equal(f.button.disabled,true);
 f.click();assert.equal(f.timers.size,1);f.flush();f.emit(f.counters[1]);f.flush();
 assert.equal(f.button.disabled,false);assert.equal(f.listeners.size,1);
 f.setReduced(true);assert.equal(f.button.hidden,true);f.click();assert.equal(f.timers.size,0);
 f.pagehide();assert.equal(f.listeners.size,0);assert.equal(f.pageListeners.size,0);
});

test('pagehide cancels timers, disconnects observation and removes every active listener',()=>{
 const f=fixture({replay:true});f.run();f.emit(f.counters[0]);f.pagehide();
 assert.equal(f.timers.size,0);assert.equal(f.observers[0].observed.size,0);
 assert.equal(f.listeners.size,0);assert.equal(f.clicks.size,0);assert.equal(f.pageListeners.size,0);
 assert.equal(f.button.hidden,true);assert.equal(f.button.disabled,true);
 assert.ok(f.counters.every(counter=>counter.classes.size===0));
 f.emit(f.counters[1]);f.click();f.flush();assert.equal(f.timers.size,0);
});
