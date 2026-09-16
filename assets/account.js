/* Password credentials stay in form memory only: no URL, storage or analytics. */
(() => {
 'use strict';
 const root=document.querySelector('[data-auth-page],[data-account-page]');if(!root)return;
 const $=s=>root.querySelector(s);
 let state=null,requestId='',challengeEmail='',sending=false,resendAt=0;
 const form=$('[data-auth-form]'),status=$('[data-auth-status]')||$('[data-account-status]'),error=$('[data-auth-error]');
 const mode=root.dataset.authMode;
 const profileForm=$('[data-profile-form]');
 async function api(action,input){
  const r=await fetch('/api/retention/'+action,{credentials:'same-origin',...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''},body:JSON.stringify(input)})});
  let data;try{data=await r.json();}catch{throw new Error('暂时无法连接，请刷新后重试');}
  if(!r.ok)throw new Error(data.error||'操作未完成，请重试');return data;
 }
 function hint(value){try{localStorage.setItem('airadar_reader_hint_v1',JSON.stringify(value));}catch{}}
 function updateSend(){
  const b=$('[data-send-code]');if(!b)return;
  const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
  b.disabled=sending||seconds>0||!state?.mailConfigured;
  b.textContent=sending?'正在发送…':seconds?`${seconds} 秒后重发`:'获取验证码';
 }
 const timer=form&&mode!=='login'?setInterval(updateSend,1000):null;
 addEventListener('pagehide',()=>{clearInterval(timer);form?.reset();},{once:true});
 // A back/forward-cache restore must not show an account whose session ended.
 addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 $('[data-password-visibility]')?.addEventListener('click',e=>{
  const showing=form.elements.password.type==='password';
  for(const name of ['password','confirmPassword'])if(form.elements[name])form.elements[name].type=showing?'text':'password';
  e.currentTarget.textContent=showing?'隐藏密码':'显示密码';e.currentTarget.setAttribute('aria-pressed',String(showing));
 });
 form?.elements.email.addEventListener('input',()=>{if(challengeEmail!==form.elements.email.value.trim().toLowerCase()){requestId='';form.elements.code&&(form.elements.code.value='');}});
 $('[data-send-code]')?.addEventListener('click',async()=>{
  if(sending||Date.now()<resendAt)return;
  if(!form.elements.email.reportValidity()||!form.elements.consent.reportValidity())return;
  error.textContent='';sending=true;updateSend();
  const email=form.elements.email.value.trim().toLowerCase();
  try{
   const data=await api('request-code',{email,purpose:mode,consent:true});
   requestId=data.requestId;challengeEmail=email;resendAt=Date.now()+60000;
   $('[data-code-status]').textContent=mode==='reset'?'如果此邮箱已有账号，你会收到重置验证码。请查看收件箱和垃圾邮件。':'验证码已提交发送，请查看收件箱和垃圾邮件，10 分钟内有效。';
   if(form.elements.email.value.trim().toLowerCase()!==email){requestId='';throw new Error('邮箱已改变，请稍后为当前邮箱重新获取验证码');}
   form.elements.code.focus();
  }catch(e){error.textContent=e.message;}finally{sending=false;updateSend();}
 });
 form?.addEventListener('submit',async e=>{
  e.preventDefault();error.textContent='';status.textContent='';
  const email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password.value;
  if(mode!=='login'){
   if(!requestId||challengeEmail!==email){error.textContent='请先获取当前邮箱的验证码';return;}
   if(password!==form.elements.confirmPassword.value){error.textContent='两次输入的密码不一致';form.elements.confirmPassword.focus();return;}
  }
  const b=form.querySelector('[type=submit]');b.disabled=true;
  try{
   await api(mode==='reset'?'reset-password':mode,{email,password,requestId,code:form.elements.code?.value,...(mode==='register'?{phone:form.elements.phone.value,contactType:form.elements.contactType.value,contactValue:form.elements.contactValue.value}:{})});
   form.reset();
   if(mode==='reset'){
    hint(false);form.hidden=true;clearInterval(timer);
    status.textContent='密码已重置，所有设备上的旧登录已退出。请用新密码登录。';
    const link=document.createElement('a');link.href='/login';link.className='retention-button primary';link.textContent='使用新密码登录';status.after(link);link.focus();
   }else{
    hint(true);let next=root.dataset.authNext||'/account';
    try{const u=new URL(next,location.origin);if(u.origin!==location.origin||!['/','/following','/account','/product','/shop','/weekly','/submit','/submit-shop','/claim-shop'].includes(u.pathname))next='/account';}catch{next='/account';}
    location.assign(next);
   }
  }catch(e){error.textContent=e.message;}finally{b.disabled=false;}
 });
 $('[data-account-logout]')?.addEventListener('click',async e=>{
  e.currentTarget.disabled=true;
  try{await api('logout',{});hint(false);location.replace('/login');}catch(err){status.textContent=err.message;e.currentTarget.disabled=false;}
 });
 profileForm?.addEventListener('submit',async e=>{
  e.preventDefault();if(!profileForm.reportValidity())return;
  const button=profileForm.querySelector('[type=submit]'),message=$('[data-profile-status]');button.disabled=true;message.textContent='正在保存…';
  try{
   await api('profile',{phone:profileForm.elements.phone.value,contactType:profileForm.elements.contactType.value,contactValue:profileForm.elements.contactValue.value});
   message.textContent='联系资料已保存。手机号尚未进行短信验证。';
   const next=root.dataset.profileNext;if(next&&next!=='/account'){const u=new URL(next,location.origin);if(u.origin===location.origin&&u.pathname==='/submit-shop')location.assign(u.href);}
  }catch(err){message.textContent=err.message;}finally{button.disabled=false;}
 });
 api('state').then(value=>{
  state=value;status.textContent='';
  if(form){$('[data-auth-fields]').disabled=false;
   if(mode!=='login'&&!state.mailConfigured){$('[data-auth-fields]').disabled=true;status.textContent='验证码邮件暂不可用，请稍后再试。已有账号仍可返回登录。';}
   updateSend();
  }else if(!state.account)location.replace('/login?next=%2Faccount');
  else if(profileForm)$('[data-profile-fields]').disabled=false;
 }).catch(e=>{status.textContent=e.message;});
})();
