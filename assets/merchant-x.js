(() => {
 'use strict';
 const root=document.querySelector('[data-x-claim-page]');if(!root)return;
 const $=s=>root.querySelector(s),csrf=$('[data-x-csrf]').value;
 let claim=null,capability=null;
 const message=(value,error=false)=>{const p=$('[data-x-message]');p.textContent=value;p.className='message'+(error?' error':'');p.hidden=false;p.focus();};
 async function api(action,input){const response=await fetch('/api/shop-claims/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(input)});let result;try{result=await response.json();}catch{throw new Error('服务器暂时没有返回有效结果，请稍后再试。');}if(!response.ok)throw new Error(result.error||'操作未完成');return result;}
 const saved=()=>{try{return JSON.parse(localStorage.getItem('airadar_x_claim_receipt_v1'));}catch{return null;}};
 function storeReceipt(value){try{localStorage.setItem('airadar_x_claim_receipt_v1',JSON.stringify(value));}catch{};}
 const receiptUrl=()=>location.origin+'/claim-shop#'+new URLSearchParams(capability);
 async function copy(value){try{await navigator.clipboard.writeText(value);message('已复制。');}catch{message('无法自动复制，请手动选中内容复制。',true);}}
 function render(row){
  claim=row;$('[data-x-start]').hidden=true;$('[data-x-receipt]').hidden=false;
  $('[data-x-status]').textContent=({draft:'下一步：提交核验资料',pending:'已提交，等待人工审核',approved:'已通过，店主 X 账号已展示',rejected:'本次认领未通过',revoked:'此 X 关联已撤销'})[row.status]||'认领进度';
  $('[data-x-summary]').textContent=row.shopName+' · @'+row.xHandle+' · 认领编号 '+row.id;
  $('[data-x-public-reply]').textContent=row.publicReply||'';
  const expired=row.status==='draft'&&Date.parse(row.expiresAt)<=Date.now();$('[data-x-proof]').hidden=row.status!=='draft'||expired;
  if(expired)$('[data-x-status]').textContent='认领码已过期，请重新申请';
  $('[data-x-code]').textContent=row.code;
  const proof='我是这家店铺的经营者，申请在 AirRadar 关联我的 X 账号 @'+row.xHandle+'。\n店铺：'+row.shopUrl+'\n认领码：'+row.code+'\n店铺页：https://airadar.vip/shop?id='+row.shopId;
  $('[data-x-proof-text]').value=proof;
  $('[data-x-intent]').href='https://twitter.com/intent/tweet?'+new URLSearchParams({text:proof});
  $('[data-x-published]').hidden=row.status!=='approved';
  $('[data-x-shop]').href='/shop?id='+row.shopId;
  $('[data-x-share]').href='https://twitter.com/intent/tweet?'+new URLSearchParams({text:'我的店铺 '+row.shopName+' 已在 AirRadar 关联 X 账号 @'+row.xHandle+'，欢迎查看公开报价。',url:'https://airadar.vip/shop?id='+row.shopId});
 }
 const start=$('[data-x-start]');
 start.addEventListener('submit',async e=>{e.preventDefault();const b=start.querySelector('button[type=submit]');b.disabled=true;try{const input=Object.fromEntries(new FormData(start));input.consent=start.elements.consent.checked;const row=await api('start',input);capability={id:row.id,token:row.token};storeReceipt(capability);history.replaceState(null,'',receiptUrl());render(row);message('认领码已生成。请保存进度链接，完成证明后再提交审核。');}catch(error){message(error.message,true);}finally{b.disabled=false;}});
 const submit=$('[data-x-submit]');
 submit.elements.proofType.addEventListener('change',()=>{const post=submit.elements.proofType.value==='post';$('[data-x-post-field]').hidden=!post;submit.elements.proofUrl.required=post;});
 submit.addEventListener('submit',async e=>{e.preventDefault();const b=submit.querySelector('button[type=submit]');b.disabled=true;try{render(await api('submit',{...Object.fromEntries(new FormData(submit)),...capability}));message('核验资料已提交。审核前不会展示 X 关联，请通过本进度链接查看结果。');}catch(error){message(error.message,true);}finally{b.disabled=false;}});
 $('[data-x-copy-receipt]').addEventListener('click',()=>copy(receiptUrl()));$('[data-x-copy-proof]').addEventListener('click',()=>copy($('[data-x-proof-text]').value));
 $('[data-x-refresh]').addEventListener('click',async()=>{try{render(await api('status',capability));message('审核进度已刷新。');}catch(error){message(error.message,true);}});
 const select=start.elements.shopId,options=[...select.options].map(o=>({value:o.value,text:o.textContent}));
 $('[data-shop-search]').addEventListener('input',e=>{const key=e.target.value.trim().toLowerCase(),chosen=select.value;select.replaceChildren(...options.filter(o=>!o.value||o.text.toLowerCase().includes(key)).map(o=>new Option(o.text,o.value,false,o.value===chosen)));});
 const fragment=new URLSearchParams(location.hash.slice(1)),fromHash={id:fragment.get('id'),token:fragment.get('token')};
 const restore=/^[a-f0-9]{32}$/.test(fromHash.id||'')&&/^[a-f0-9]{64}$/.test(fromHash.token||'')?fromHash:!new URLSearchParams(location.search).has('shop')&&!new URLSearchParams(location.search).has('new')?saved():null;
 if(restore&&/^[a-f0-9]{32}$/.test(restore.id||'')&&/^[a-f0-9]{64}$/.test(restore.token||'')){capability=restore;api('status',restore).then(row=>{storeReceipt(restore);history.replaceState(null,'',receiptUrl());render(row);}).catch(error=>message(error.message,true));}
})();
