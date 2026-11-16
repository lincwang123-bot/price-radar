(()=>{
 const root=document.querySelector('[data-review-shop]');if(!root)return;
 const $=s=>root.querySelector(s),form=$('[data-review-form]'),status=$('[data-review-status]'),auth=$('[data-review-auth]'),compose=$('#write-review');
 const dialog=$('[data-review-dialog]'),reportForm=$('[data-review-report-form]'),reportMessage=$('[data-report-message]');
 const names={pending:'待审核：通过后才会展示。',published:'已展示。修改或追加后，会暂时撤下并重新审核。',rejected:'本次未通过，可补充修改或申请复核。',hidden:'评价已隐藏，可查看说明并申请复核。',withdrawn:'已撤回，不再公开展示。',erased:'评价已随账号注销，正文已清除。'};
 let csrf='',signedIn=false,ready=false,canReply=false,own=null,reportTarget=null,replyTarget=null,replies=[];
 let imagesInitialized=false,sending=false;
 const readImage=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({dataUrl:reader.result});reader.onerror=()=>reject(new Error('无法读取图片，请重新选择'));reader.readAsDataURL(file);});
 function uploader(kind,label){
  const input=$('[data-review-'+kind+'-input]'),previews=$('[data-review-'+kind+'-previews]'),message=$('[data-review-'+kind+'-status]');
  const state={items:[],busy:false};
  state.render=()=>{input.disabled=state.busy||sending;previews.replaceChildren();state.items.forEach((item,index)=>{const figure=document.createElement('figure'),img=document.createElement('img'),remove=document.createElement('button');img.src=item.url||item.dataUrl;img.alt=label+' '+(index+1)+' 预览';remove.type='button';remove.textContent='删除'+label+' '+(index+1);remove.disabled=state.busy||sending;remove.addEventListener('click',()=>{state.items.splice(index,1);state.render();});figure.append(img,remove);previews.append(figure);});message.textContent='已选 '+state.items.length+' / 3 张；'+(kind==='purchase'?'仅后台审核，不公开。':'随评价审核后公开。');};
  input.addEventListener('change',async()=>{const files=[...input.files];if(!files.length)return;state.busy=true;state.render();let errorText='';try{if(state.items.length+files.length>3)throw new Error(label+'最多 3 张，请先删除不需要的图片');for(const file of files){if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('只支持 JPG、PNG、WebP 静态图片');if(!file.size||file.size>5*1024*1024)throw new Error('每张图片不能超过 5MB，请缩小后再上传');}const added=[];for(const file of files)added.push(await readImage(file));state.items.push(...added);}catch(error){errorText=error.message;}finally{state.busy=false;input.value='';state.render();if(errorText)message.textContent=errorText;}});
  state.payload=()=>state.items.map(i=>i.id?{id:i.id}:{dataUrl:i.dataUrl});return state;
 }
 const images=uploader('image','公开配图'),purchase=uploader('purchase','购买凭证');
 const replyDialog=$('[data-reply-dialog]'),replyForm=$('[data-reply-form]'),replyMessage=$('[data-reply-message]');
 const next='/shop?id='+root.dataset.reviewShop+'#reviews';
 const login=()=>{location.href='/login?'+new URLSearchParams({next});};
 const show=(node,text)=>{node.textContent=text;node.hidden=false;};
 const header=document.querySelector('.app-header');
 const measureHeader=()=>root.style.setProperty('--review-scroll-offset',((header?.getBoundingClientRect().height||130)+16)+'px');
 const alignAnchor=()=>{measureHeader();const target=location.hash==='#reviews'?root:location.hash==='#write-review'?compose:location.hash==='#merchant-replies'?$('#merchant-replies'):null;if(target?.tagName==='DETAILS')target.open=true;target?.scrollIntoView({block:'start'});};
 measureHeader();if(header&&typeof ResizeObserver!=='undefined')new ResizeObserver(measureHeader).observe(header);
 addEventListener('hashchange',()=>requestAnimationFrame(alignAnchor));
 if(['#reviews','#write-review','#merchant-replies'].includes(location.hash))requestAnimationFrame(()=>requestAnimationFrame(alignAnchor));
 async function api(action,payload){
  const res=await fetch('/api/shop-reviews/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'提交未完成，请稍后重试');return data.result;
 }
 async function init(){
  try{
   const stateRes=await fetch('/api/retention/state',{cache:'no-store'});if(!stateRes.ok)throw new Error('登录状态暂不可用，请刷新后重试');const session=await stateRes.json();csrf=session.csrf;
   const res=await fetch('/api/shop-reviews/state?'+new URLSearchParams({shop:root.dataset.reviewShop}),{cache:'no-store'});if(!res.ok)throw new Error('评价进度暂不可用，请刷新后重试');
   const state=await res.json();signedIn=state.signedIn;own=state.own;ready=state.canSubmit;canReply=state.canReply;replies=state.replies||[];
   if(!imagesInitialized){images.items=own?.images||[];purchase.items=own?.purchaseImages||[];imagesInitialized=true;images.render();purchase.render();}
   renderMerchant();
   auth.textContent='';
   if(!signedIn){const link=document.createElement('a');link.href='/login?'+new URLSearchParams({next});link.textContent='验证邮箱登录后，上传购买凭证并写评价';auth.append(link);return;}
   if(!ready){auth.textContent='你是本店已关联店主，不能给自己的店铺评分。请使用下方店主回复入口。';form.hidden=true;}
   else{
   auth.textContent='邮箱不会公开，仅显示匿名编号。审核和申诉结果在这里查看。';form.hidden=own?.status==='erased';
   if(own){
    for(const k of ['product','delivery','experience','evidence'])form.elements[k].value=own[k]||'';
    const rating=form.querySelector('input[name="rating"][value="'+own.rating+'"]');if(rating)rating.checked=true;
    show(status,(names[own.status]||'')+(own.publicNote?'\n站方说明：'+own.publicNote:''));
    form.querySelector('[type=submit]').textContent='更新并重新审核';
    $('[data-review-withdraw]').hidden=['withdrawn','erased'].includes(own.status);
    $('[data-review-appeal]').hidden=!['rejected','hidden'].includes(own.status);
   }
   }
   const tickets=$('[data-review-tickets]');tickets.replaceChildren();
   for(const t of state.reports||[]){const p=document.createElement('p');p.className='review-status';p.textContent=(t.status==='pending'?'申诉 / 反馈已收到，等待站方处理。':'申诉 / 反馈结果：'+(t.reply||'已处理'))+'\n编号：'+t.id;tickets.append(p);}
   tickets.hidden=!tickets.childElementCount;
  }catch(error){show(auth,error.message);}
 }
 if(location.hash==='#write-review')compose.open=true;
 root.querySelector('a[href="#write-review"]').addEventListener('click',()=>{compose.open=true;});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!ready)return;if(images.busy||purchase.busy){show(status,'图片还在读取，请稍等后再提交');return;}if(!purchase.items.length){show(status,'请先上传至少 1 张购买记录，供后台审核购买资格。');$('[data-review-purchase-input]').focus();return;}const button=form.querySelector('[type=submit]');button.disabled=true;sending=true;images.render();purchase.render();
  try{
   const data=Object.fromEntries(new FormData(form));data.rating=Number(data.rating);data.version=own?.version||0;data.shopId=root.dataset.reviewShop;data.consent=form.elements.consent.checked;
   data.images=images.payload();data.purchaseImages=purchase.payload();show(status,'正在上传购买凭证与评价，请稍候。购买凭证仅供后台审核，不会公开。');
   await api('submit',data);location.hash='write-review';location.reload();
  }catch(error){show(status,error.message);}finally{button.disabled=false;sending=false;images.render();purchase.render();}
 });
 $('[data-review-withdraw]').addEventListener('click',async event=>{
  if(!own||!confirm('撤回后不会再公开展示，确定撤回吗？'))return;
  event.target.disabled=true;try{await api('withdraw',{id:own.id,version:own.version});location.hash='write-review';location.reload();}catch(error){show(status,error.message);event.target.disabled=false;}
 });
 function openReport(id,version,appeal=false){
  if(!signedIn){login();return;}reportTarget={id,version};reportForm.reset();reportMessage.hidden=true;
  const select=reportForm.elements.reason;for(const o of select.options)o.hidden=appeal?o.value!=='appeal':o.value==='appeal';select.value=appeal?'appeal':'fake';select.disabled=appeal;dialog.showModal();
 }
 root.querySelectorAll('[data-report-review]').forEach(button=>button.addEventListener('click',()=>openReport(button.dataset.reportReview,Number(button.dataset.reviewVersion),own?.id===button.dataset.reportReview)));
 $('[data-review-appeal]').addEventListener('click',()=>openReport(own.id,own.version,true));
 $('[data-review-dialog-close]').addEventListener('click',()=>dialog.close());
 reportForm.addEventListener('submit',async event=>{
  event.preventDefault();const button=reportForm.querySelector('[type=submit]');button.disabled=true;
  try{await api('report',{...reportTarget,reason:reportForm.elements.reason.value,details:reportForm.elements.details.value});show(reportMessage,'已收到，站方核对后会在你的评价进度中更新结果，不会自动删除评价。');await init();}
  catch(error){show(reportMessage,error.message);}finally{button.disabled=false;}
 });
 function renderMerchant(){
  const node=$('[data-merchant-auth]'),list=$('[data-merchant-replies]');node.replaceChildren();list.replaceChildren();
  if(!canReply){const link=document.createElement('a');link.href=signedIn?'/claim-shop?'+new URLSearchParams({shop:root.dataset.reviewShop}):'/login?'+new URLSearchParams({next:next.replace('#reviews','#merchant-replies')});link.textContent=signedIn?'先完成店主认领审核，再回复本店评价':'登录店主账号后回复评价';node.append(link);return;}
  node.textContent='店主身份已确认。点击对应评价下的「店主回复」可新增或修改回复；不支持通过回复入口删评。';
  for(const reply of replies){const card=document.createElement('div'),p=document.createElement('p'),body=document.createElement('p');card.className='review-status';p.textContent='回复进度：'+(names[reply.status]||reply.status)+(reply.publicNote?'\n审核说明：'+reply.publicNote:'');body.textContent=reply.body;card.append(p,body);if(!['withdrawn','erased'].includes(reply.status)){const button=document.createElement('button');button.type='button';button.className='review-button';button.textContent='撤回这条回复';button.addEventListener('click',async()=>{if(!confirm('确定撤回这条商家回复？'))return;button.disabled=true;try{await api('reply-withdraw',{id:reply.id,version:reply.version});location.hash='merchant-replies';location.reload();}catch(error){show(p,error.message);button.disabled=false;}});card.append(button);}list.append(card);}
 }
 root.querySelectorAll('[data-reply-review]').forEach(button=>button.addEventListener('click',()=>{
  if(!signedIn)return login();if(!canReply){const manager=$('#merchant-replies');manager.open=true;manager.scrollIntoView({block:'center'});return;}
  const prior=replies.find(r=>r.reviewId===button.dataset.replyReview);replyTarget={reviewId:button.dataset.replyReview,reviewVersion:Number(button.dataset.reviewVersion),version:prior?.version||0};replyForm.reset();replyForm.elements.body.value=prior?.body||'';replyMessage.hidden=true;replyDialog.showModal();
 }));
 $('[data-reply-dialog-close]').addEventListener('click',()=>replyDialog.close());
 replyForm.addEventListener('submit',async event=>{event.preventDefault();if(!canReply||!replyTarget)return;const button=replyForm.querySelector('[type=submit]');button.disabled=true;try{await api('reply-submit',{...replyTarget,body:replyForm.elements.body.value,consent:replyForm.elements.consent.checked});location.hash='merchant-replies';location.reload();}catch(error){show(replyMessage,error.message);}finally{button.disabled=false;}});
 if(location.hash==='#merchant-replies')$('#merchant-replies').open=true;
 init();
})();
