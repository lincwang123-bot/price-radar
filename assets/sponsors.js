(()=>{
 document.addEventListener('click',event=>{if(event.target.closest('[data-sponsor-demo]')){const status=document.getElementById('sponsor-demo-status');if(status)status.textContent='这是虚构示例。正式广告会跳转到审核后的商家页面，并单独统计广告出站点击。';}});
 if(!('IntersectionObserver' in window))return;
 const timers=new Map(),eligible=new Set(),sent=new Set();
 function stop(el){clearTimeout(timers.get(el));timers.delete(el)}
 function start(el){if(document.visibilityState!=='visible'||sent.has(el)||timers.has(el))return;timers.set(el,setTimeout(()=>{timers.delete(el);if(document.visibilityState!=='visible'||!eligible.has(el)||sent.has(el))return;sent.add(el);fetch('/api/sponsor-view',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'content-type':'application/json'},body:JSON.stringify({id:el.dataset.sponsorId,token:el.dataset.sponsorToken})}).catch(()=>{});},1000))}
 const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting&&entry.intersectionRatio>=.5){eligible.add(entry.target);start(entry.target)}else{eligible.delete(entry.target);stop(entry.target)}}},{threshold:[0,.5]});
 document.querySelectorAll('[data-sponsor-id][data-sponsor-token]').forEach(el=>observer.observe(el));
 document.addEventListener('visibilitychange',()=>{for(const el of eligible){stop(el);if(document.visibilityState==='visible')start(el)}});
 window.addEventListener('pagehide',()=>{observer.disconnect();timers.forEach(clearTimeout);timers.clear();eligible.clear()});
 window.addEventListener('pageshow',event=>{if(event.persisted)document.querySelectorAll('[data-sponsor-id][data-sponsor-token]').forEach(el=>{if(!sent.has(el))observer.observe(el)})});
})();
