/* AirRadar opt-in follow list. Plain browser JavaScript; no external resources. */
(() => {
 'use strict';
 const $=(s,p=document)=>p.querySelector(s),$$=(s,p=document)=>[...p.querySelectorAll(s)];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const local={read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}};
 const guestKey='airadar_follows_v1',seenKey='airadar_follow_seen_v1';
 let state=null,market=null,loading=null,tab='all',requestId='',toastTimer;
 const guest=()=>{const value=local.read(guestKey,[]);return Array.isArray(value)?value.filter(w=>w&&typeof w.productKey==='string'&&typeof w.id==='string').slice(0,40):[];};
 const watches=()=>state?.account?state.watches:guest();
 function visitor(create=false){let id=local.read('airadar_follow_visitor_v1','');if(!id&&create){id=crypto.randomUUID();local.write('airadar_follow_visitor_v1',id);}return id;}
 function toast(message){const node=$('[data-retention-toast]');if(!node)return;node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{node.hidden=true;},6500);}
 async function api(action,input){
  const options=input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''},body:JSON.stringify(input)};
  const response=await fetch('/api/retention/'+action,{credentials:'same-origin',...options});
  let value;try{value=await response.json();}catch{throw new Error('服务器未返回有效结果，请稍后再试');}
  if(!response.ok)throw new Error(value.error||'操作未完成');return value;
 }
 async function init(force=false){
  if(loading)return loading;
  if(state&&market&&!force)return;
  loading=(async()=>{
   const results=await Promise.allSettled([api('state'),api('market')]);
   if(results[1].status==='rejected')throw results[1].reason;
   market=results[1].value;
   state=results[0].status==='fulfilled'?results[0].value:{account:null,watches:[],notices:[],mailConfigured:false,csrf:''};
  })().finally(()=>{loading=null;});return loading;
 }
 function event(kind,entity='',create=false){const id=visitor(create);if(!state?.csrf||!state.account&&!id)return;api('event',{kind,entity,visitor:id}).catch(()=>{});}
 const product=key=>market?.products.find(p=>p.key===key);
 const group=id=>market?.groups.find(g=>g.id===id);
 const money=g=>g&&g.state==='available'?g.currency+' '+Number(g.price).toLocaleString('zh-CN',{maximumFractionDigits:2}):g?.state==='unavailable'?'暂时售罄':'暂未确认';
 const href=w=>{const p=product(w.productKey),g=group(w.groupId),params=new URLSearchParams({family:p?.family||g?.family||'chatgpt',product:w.productKey});if(g?.comparisonKey)params.set('spec',g.comparisonKey);return '/?'+params;};
 function render(){
  const list=$('[data-watch-list]');if(!list)return;
  const a=state?.account;
  $('[data-account-title]').textContent=a?a.email:'本机关注清单';
  $('[data-account-copy]').textContent=a?(a.emailEnabled?'关注已同步。仅发送你选择的条件提醒，每个邮箱每天最多一封行情或续费汇总。':'邮箱提醒已停止，关注清单仍保留。'):'保存在当前浏览器。确认邮箱后可跨设备同步，并接收自选提醒。';
  $('[data-account-actions]').innerHTML=a?'<button class="retention-button" data-email-toggle>'+ (a.emailEnabled?'暂停全部邮件':'重新开启邮件')+'</button><button class="retention-button" data-logout>退出</button><button class="retention-link" data-delete-account>删除账号数据</button>':'<button class="retention-button" data-login>确认邮箱并同步</button>';
  const all=watches(),rows=tab==='renewal'?all.filter(w=>w.renewalDate):all;
  $('[data-watch-empty]').hidden=all.length>0||tab==='notices';
  $('[data-list-summary]').textContent=tab==='notices'?(a?'最近 90 天内的最新动态；历史通知保留当时信息。':'确认邮箱后可查看跨设备保存的提醒。'):`${all.length} 项关注${tab==='renewal'?' · '+rows.length+' 项到期记录':''} · 报价按明确规格比较`;
  if(tab==='notices'){
   list.innerHTML=(state?.notices||[]).map(n=>{const p=n.payload,w={productKey:p.productKey,groupId:p.groupId};return '<article class="retention-card"><h2>'+esc(p.name)+'</h2><p>'+esc(p.spec)+'</p><p>'+esc(p.kind==='renewal'?'你记录的到期日期：'+p.renewalDate:p.kind==='restock'?'已观察到恢复有货':p.kind==='weekly'?'本周关注报价':'已观察到符合条件的降价')+'</p><p class="retention-muted">'+esc(new Date(n.created_at).toLocaleString('zh-CN'))+'</p><a class="retention-button" href="'+esc(href(w))+'">查看当前报价</a></article>';}).join('')||'<div class="retention-empty"><h2>暂时没有新动态</h2><p>符合条件的价格变化和到期提醒会出现在这里。</p></div>';return;
  }
  const seen=local.read(seenKey,{});
  list.innerHTML=rows.map(w=>{
   const p=product(w.productKey),g=group(w.groupId),before=seen[w.groupId];
   const change=g?.state==='available'&&Number.isFinite(before)&&before>0&&g.price!==before?(g.price-before)/before*100:null;
   const mode=({off:'价格提醒关闭',target:'降至 '+(g?.currency||'')+' '+w.targetPrice+' 或更低时提醒',restock:'明确售罄后恢复有货时提醒',changes:'累计下降 '+w.dropPct+'% 提醒',weekly:'每周报价汇总'})[w.mode]||'只收藏';
   const quote=g?money(g):'选择规格查看价格';
   return '<article class="retention-card" data-watch-id="'+esc(w.id)+'"><div class="retention-card-top"><h2>'+esc(p?.name||g?.name||w.productKey)+'</h2><span class="retention-status">'+(w.paused?'提醒已暂停':a?'已同步':'本机收藏')+'</span></div><p>'+esc(g?.spec||'关注产品，尚未限定规格')+'</p><div class="retention-price">'+esc(quote)+'</div>'+(change!==null?'<p class="retention-change '+(change<0?'down':'up')+'">较本机上次查看 '+(change>0?'+':'')+change.toFixed(1)+'%</p>':'')+'<p>'+esc(mode)+(w.mode!=='off'&&!a?' · 确认邮箱后启用':'')+'</p>'+(w.renewalDate?'<p>到期 '+esc(w.renewalDate)+' · 提前 '+Number(w.leadDays||0)+' 天提醒</p>':'')+'<div class="retention-actions"><a class="retention-button" href="'+esc(href(w))+'">查看报价</a><button class="retention-button" data-edit-watch="'+esc(w.id)+'">修改</button>'+(w.renewalDate?'<button class="retention-button" data-calendar="'+esc(w.id)+'">加入日历</button>':'')+'<button class="retention-button" data-remove-watch="'+esc(w.id)+'">移除</button></div></article>';
  }).join('')||(all.length?'<div class="retention-empty"><h2>尚未设置到期日期</h2><p>修改关注，在“我正在使用”中添加日期。</p></div>':'');
  for(const w of all){const g=group(w.groupId);if(g?.state==='available')seen[g.id]=g.price;}local.write(seenKey,seen);
 }
 function refreshGroupOptions(preferred=''){
  const form=$('#retention-watch-form'),key=form.elements.productKey.value,options=market.groups.filter(g=>g.productKey===key);
  form.elements.groupId.innerHTML='<option value="">只关注产品，稍后选择规格</option>'+options.map(g=>'<option value="'+g.id+'">'+esc(g.spec+' · '+g.currency+(g.state==='available'?' · '+g.price+' 起':''))+'</option>').join('');
  form.elements.groupId.value=options.some(g=>g.id===preferred)?preferred:'';updateFields();
 }
 function updateFields(){
  const f=$('#retention-watch-form'),g=group(f.elements.groupId.value),mode=f.elements.mode.value;
  $('[data-target-field]',f).hidden=mode!=='target';f.elements.targetPrice.required=mode==='target';
  $('[data-drop-field]',f).hidden=mode!=='changes';
  $('[data-group-current]',f).textContent=g?'当前 '+money(g)+' · '+g.offerCount+' 条报价。'+(g.comparisonKey?.includes('地区未注明')?'店铺未注明适用地区，购买前需要确认。':'购买前请核对售后范围与最终实付金额。'):'未限定规格时只保存产品，不发送价格或库存提醒。';
 }
 async function openWatch(key='',id='',preferred='',spec=''){
  await init();const dialog=$('#retention-watch-dialog'),f=$('#retention-watch-form'),w=id?watches().find(w=>w.id===id):null;
  f.reset();$('[data-form-error]',f).textContent='';f.elements.productKey.innerHTML=market.products.map(p=>'<option value="'+esc(p.key)+'">'+esc(p.name)+'</option>').join('');
  f.elements.id.value=w?.id||'';f.elements.productKey.value=w?.productKey||key||market.products[0]?.key||'';
  const g=market.groups.find(g=>g.productKey===f.elements.productKey.value&&g.comparisonKey===spec);
  refreshGroupOptions(w?.groupId||preferred||g?.id||'');
  if(w)for(const name of ['mode','targetPrice','dropPct','renewalDate','leadDays'])f.elements[name].value=w[name]??'';
  f.elements.paused.checked=!!w?.paused;updateFields();
  if(w?.renewalDate)$('.retention-renewal',f).open=true;
  $('[data-save-note]',f).textContent=state.account?'关注将同步到此邮箱。可随时暂停或删除。':'先保存到本机。确认邮箱后，你设置的提醒才会发送。';
  dialog.showModal();
 }
 async function submitWatch(e){
  e.preventDefault();const f=e.currentTarget,error=$('[data-form-error]',f),button=$('[type=submit]',f);error.textContent='';button.disabled=true;
  try{
   const data=Object.fromEntries(new FormData(f));data.paused=f.elements.paused.checked;
   if(!data.groupId&&data.mode!=='off')throw new Error('请先选择明确规格，再启用提醒。');
   if(state.account){await api('save-watch',data);await init(true);}
   else{
    const rows=guest(),duplicate=rows.find(w=>w.productKey===data.productKey&&w.groupId===data.groupId&&w.id!==data.id);if(duplicate)throw new Error('已关注此规格，请修改原有关注。');
    if(!data.id&&rows.length>=40)throw new Error('最多关注 40 个规格');
    const w={...data,id:data.id||crypto.randomUUID(),dropPct:Number(data.dropPct||5),leadDays:Number(data.leadDays??3),targetPrice:data.targetPrice?Number(data.targetPrice):null,createdAt:new Date().toISOString()};
    if(!local.write(guestKey,[...rows.filter(x=>x.id!==w.id),w]))throw new Error('当前浏览器不能保存数据，请允许网站存储后再试。');
    if(!data.id)event('follow',w.id,true);if(w.renewalDate)event('renewal',w.id,true);
   }
   $('#retention-watch-dialog').close();render();toast(state.account?'关注已保存':data.mode==='off'?'已保存到当前浏览器':'已保存到本机；确认邮箱后才会收到提醒');
  }catch(err){error.textContent=err.message;}finally{button.disabled=false;}
 }
 async function openLogin(){await init();if(!state.mailConfigured){toast('邮件同步暂不可用，可继续保存本机关注。');return;}$('#retention-login-dialog').showModal();}
 async function emailSubmit(e){
  e.preventDefault();const f=e.currentTarget,b=$('[type=submit]',f),err=$('[data-form-error]',f);b.disabled=true;err.textContent='';
  try{requestId=(await api('request-code',{email:f.elements.email.value,consent:f.elements.consent.checked})).requestId;f.hidden=true;$('#retention-code-form').hidden=false;$('#retention-code-form input').focus();}
  catch(error){err.textContent=error.message;}finally{b.disabled=false;}
 }
 async function verifySubmit(e){
  e.preventDefault();const f=e.currentTarget,b=$('[type=submit]',f),err=$('[data-form-error]',f);b.disabled=true;err.textContent='';
  try{
   await api('verify-code',{requestId,code:f.elements.code.value});local.write('airadar_reader_hint_v1',true);await init(true);
   const localRows=guest(),remaining=[];let imported=0;
   for(const w of localRows){
    if(state.watches.some(x=>x.productKey===w.productKey&&x.groupId===w.groupId))continue;
    try{const {id,...input}=w;await api('save-watch',input);imported++;}catch{remaining.push(w);}
   }
   local.write(guestKey,remaining);await init(true);$('#retention-login-dialog').close();render();
   toast(remaining.length?'邮箱已确认；部分失效规格保留在本机，稍后退出邮箱可调整。':'邮箱已确认，已同步关注清单'+(imported?'（新增 '+imported+' 项）':''));
  }catch(error){err.textContent=error.message;}finally{b.disabled=false;}
 }
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
 function calendar(id){
  const w=watches().find(w=>w.id===id);if(!w?.renewalDate)return;
  const p=product(w.productKey),escape=v=>String(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,'\\$&');
  const date=w.renewalDate.replaceAll('-',''),next=new Date(Date.parse(w.renewalDate)+86400000).toISOString().slice(0,10).replaceAll('-','');
  const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AirRadar//Renewal//ZH','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+w.id+'@airadar.vip','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z'),'DTSTART;VALUE=DATE:'+date,'DTEND;VALUE=DATE:'+next,'SUMMARY:'+escape((p?.name||w.productKey)+' 订阅到期'),'DESCRIPTION:'+escape('你自行设置的到期记录。续费前查看最新报价：https://airadar.vip'+href(w)),'URL:https://airadar.vip'+href(w),'BEGIN:VALARM','TRIGGER:-P'+Number(w.leadDays||0)+'D','ACTION:DISPLAY','DESCRIPTION:订阅即将到期','END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n');
  download(new Blob([text],{type:'text/calendar;charset=utf-8'}),'AirRadar-'+w.productKey+'-'+date+'.ics');toast('日历文件已生成，导入后由日历应用提醒。');
 }
 function wrap(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){let line='',n=0;for(const char of text){if(ctx.measureText(line+char).width>maxWidth&&line){ctx.fillText(line,x,y+n*lineHeight);n++;line='';if(n>=maxLines)return y+n*lineHeight;}line+=char;}if(line)ctx.fillText(line,x,y+n*lineHeight);return y+(n+1)*lineHeight;}
 async function share(groupId,date=''){
  await init();const g=group(groupId);if(!g)throw new Error('该规格暂不可分享');
  const historical=date?await api('share?group='+encodeURIComponent(groupId)+'&date='+date):null;
  const data=historical?.group||g;if(!historical&&g.state!=='available')throw new Error('当前没有有效报价可生成卡片');
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=675;const c=canvas.getContext('2d');
  c.fillStyle='#f3f6ee';c.fillRect(0,0,1200,675);c.fillStyle='#1d654f';c.fillRect(0,0,16,675);c.font='600 22px system-ui';c.fillText('AIRRADAR / AI 产品价格观察',65,65);
  c.fillStyle='#1d3227';c.font='700 56px system-ui';wrap(c,data.name,65,158,1070,65,2);
  c.font='400 24px system-ui';c.fillStyle='#607567';wrap(c,data.spec+' · '+data.currency,65,260,1060,36,2);
  c.fillStyle='#1d654f';c.font='700 90px system-ui';c.fillText(data.currency+' '+data.price,65,425);c.font='400 22px system-ui';c.fillStyle='#607567';c.fillText(historical?'最后观察起价 · 此前 '+historical.firstPrice:'当前已收录的同规格挂牌起价',65,468);
  c.fillStyle='#d6e1d5';c.fillRect(65,522,1070,1);c.font='400 22px system-ui';c.fillStyle='#344e3d';c.fillText('airadar.vip · 查价格，看变化',65,570);
  c.font='400 17px system-ui';c.fillStyle='#788779';c.fillText('观察截至 '+(date||new Date(g.observedAt).toLocaleString('zh-CN'))+' · 最终价格与适用条件以店铺结算页为准',65,616);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('卡片生成失败');
  download(blob,'AirRadar-'+g.productKey+'-'+(date||new Date().toISOString().slice(0,10))+'.png');
  const link=date?'https://airadar.vip/weekly?date='+date:'https://airadar.vip'+href({productKey:g.productKey,groupId:g.id});
  try{await navigator.clipboard.writeText(link);toast('分享卡片已生成，页面链接已复制。');}catch{toast('分享卡片已生成；可复制浏览器中的页面地址。');}event('share',g.id,true);
 }
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-follow-product],[data-add-watch],[data-edit-watch],[data-login],[data-remove-watch],[data-list-tab],[data-close-dialog],[data-logout],[data-email-toggle],[data-calendar],[data-share-group],[data-delete-account],[data-retry-code]');if(!button)return;
  e.preventDefault();
  try{
   if(button.hasAttribute('data-close-dialog'))return button.closest('dialog').close();
   if(button.hasAttribute('data-retry-code')){$('#retention-code-form').hidden=true;$('#retention-email-form').hidden=false;return;}
   if(button.hasAttribute('data-follow-product'))return await openWatch(button.dataset.followProduct,'',button.dataset.followGroup,button.dataset.followSpec);
   if(button.hasAttribute('data-add-watch'))return await openWatch();
   if(button.hasAttribute('data-edit-watch'))return await openWatch('',button.dataset.editWatch);
   if(button.hasAttribute('data-login'))return await openLogin();
   if(button.hasAttribute('data-list-tab')){tab=button.dataset.listTab;$$('[data-list-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();return;}
   if(button.hasAttribute('data-calendar'))return calendar(button.dataset.calendar);
   if(button.hasAttribute('data-share-group')){button.disabled=true;try{await share(button.dataset.shareGroup,button.dataset.shareDate);}finally{button.disabled=false;}return;}
   if(button.hasAttribute('data-remove-watch')){
    const id=button.dataset.removeWatch;if(!confirm('移除此关注及其提醒？'))return;
    if(state.account){await api('remove-watch',{id});await init(true);}else{local.write(guestKey,guest().filter(w=>w.id!==id));event('unfollow',id);}render();return;
   }
   if(button.hasAttribute('data-logout')){await api('logout',{});local.write('airadar_reader_hint_v1',false);await init(true);render();return;}
   if(button.hasAttribute('data-email-toggle')){await api('email',{enabled:!state.account.emailEnabled});await init(true);render();return;}
   if(button.hasAttribute('data-delete-account')){if(!confirm('删除此邮箱账号、同步关注和通知记录？该操作不可撤销。'))return;await api('delete-account',{});local.write('airadar_reader_hint_v1',false);await init(true);render();toast('线上账号数据已删除。灾难恢复备份按既有保留周期处理。');}
  }catch(error){toast(error.message);}
 });
 $('#retention-watch-form')?.addEventListener('submit',submitWatch);
 $('#retention-watch-form')?.elements.productKey.addEventListener('change',()=>refreshGroupOptions());
 $('#retention-watch-form')?.elements.groupId.addEventListener('change',updateFields);
 $('#retention-watch-form')?.elements.mode.addEventListener('change',updateFields);
 $('#retention-email-form')?.addEventListener('submit',emailSubmit);
 $('#retention-code-form')?.addEventListener('submit',verifySubmit);
 $('[data-unsubscribe-form]')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('unsubscribe',{token:f.elements.token.value});$('[data-form-error]',f).textContent='已退订所有邮箱提醒，关注清单仍保留。';$('button',f).disabled=true;}catch(error){$('[data-form-error]',f).textContent=error.message;}});
 if($('[data-following-page]'))init().then(async()=>{
  render();event('visit');if(new URL(location.href).searchParams.get('from')==='reminder')event('notice_visit');
  const params=new URLSearchParams(location.search);if(params.get('product'))await openWatch(params.get('product'),'',params.get('group'),params.get('spec'));
 }).catch(error=>{toast(error.message);$('[data-list-summary]').textContent='关注暂时无法读取，请刷新重试。';});
 else if(location.pathname==='/'&&!location.search&&(guest().length||local.read('airadar_reader_hint_v1',false))){
  init().then(()=>{const rows=watches();if(!rows.length)return;const node=document.createElement('div');node.className='retention-preview';node.innerHTML='你关注了 '+rows.length+' 项产品：'+esc(rows.slice(0,3).map(w=>product(w.productKey)?.name||w.productKey).join('、'))+'。 <a href="/following">查看我的关注 →</a>';$('main')?.prepend(node);}).catch(()=>{});
 }
})();
