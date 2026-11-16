/* Password credentials stay in form memory only: no URL, storage or analytics. */
(() => {
 'use strict';
 const root=document.querySelector('[data-auth-page],[data-account-page]');if(!root)return;
 const $=s=>root.querySelector(s);
 let state=null,requestId='',challengeEmail='',sending=false,resendAt=0;
 const form=$('[data-auth-form]'),status=$('[data-auth-status]')||$('[data-account-status]'),error=$('[data-auth-error]');
 const mode=root.dataset.authMode;
 const profileForm=$('[data-profile-form]');
 const phoneForm=$('[data-phone-verification]'),phoneFields=$('[data-phone-fields]'),phoneSend=$('[data-phone-send]'),phoneSummary=$('[data-phone-summary]'),phoneStatus=$('[data-phone-status]'),phoneExpiry=$('[data-phone-expiry]');
 const phoneCode=phoneForm?.elements.code,phoneVerify=phoneForm?.querySelector('[type=submit]');
 let phoneHasProfile=phoneForm?.dataset.phoneHasProfile==='true';
 let phoneState=null,phoneStateError='',phoneChallengeId='',phoneExpiresAt=0,phoneResendAt=0,phoneBusy='',phoneRevision=0,phoneTimer=null,phoneDisposed=false,profileDirty=false,profileSaving=false,profileRevision=0;
 const googleButton=$('[data-google-login]');
 async function api(action,input){
  const r=await fetch('/api/retention/'+action,{credentials:'same-origin',...(input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf||''},body:JSON.stringify(input)})});
  let data;try{data=await r.json();}catch{throw new Error('暂时无法连接，请刷新后重试');}
  if(!r.ok)throw new Error(data.error||'操作未完成，请重试');return data;
 }
 function phoneMessage(message,isError=false){if(phoneStatus){phoneStatus.textContent=message;phoneStatus.setAttribute('role',isError?'alert':'status');}}
 function merchantApplicationNext(){
  const next=root.dataset.profileNext;if(!next)return null;
  try{const url=new URL(next,location.origin);return url.origin===location.origin&&url.pathname==='/submit-shop'?url.href:null;}catch{return null;}
 }
 function clearPhoneChallenge(){
  phoneRevision++;phoneChallengeId='';phoneExpiresAt=0;phoneBusy='';
  if(phoneCode)phoneCode.value='';
  clearInterval(phoneTimer);phoneTimer=null;
 }
 function phoneReady(){return !phoneDisposed&&!profileDirty&&!profileSaving&&phoneState?.hasProfile&&phoneState.configured&&phoneState.supported&&!phoneState.phoneVerified;}
 function updatePhone(){
  if(!phoneForm||phoneDisposed)return;
  const now=Date.now(),seconds=Math.max(0,Math.ceil((phoneResendAt-now)/1000));
  if(phoneChallengeId&&now>=phoneExpiresAt){phoneChallengeId='';phoneCode.value='';phoneMessage('验证码已过期，请重新获取。');}
  const ready=phoneReady();phoneFields.hidden=!ready;phoneFields.disabled=!ready||!!phoneBusy;
  phoneCode.disabled=!ready||!phoneChallengeId||!!phoneBusy;
  phoneSend.disabled=!ready||!!phoneBusy||seconds>0;
  phoneSend.textContent=phoneBusy==='send'?'正在发送…':seconds?`${seconds} 秒后重发`:'获取短信验证码';
  phoneVerify.disabled=!ready||!!phoneBusy||!phoneChallengeId;
  phoneVerify.textContent=phoneBusy==='verify'?'正在验证…':merchantApplicationNext()?'验证并继续提交店铺':'验证手机号';
  phoneForm.setAttribute('aria-busy',String(!!phoneBusy||profileSaving||(!phoneState&&!profileDirty&&!phoneStateError)));
  phoneExpiry.textContent=phoneChallengeId?`验证码剩余 ${Math.max(1,Math.ceil((phoneExpiresAt-now)/1000))} 秒有效。`:'';
  if(profileSaving)phoneSummary.textContent='联系资料正在保存，请稍候。';
  else if(profileDirty)phoneSummary.textContent='联系资料已修改，请先保存，再验证手机号。';
  else if(!phoneState)phoneSummary.textContent=phoneStateError||'正在检查短信验证是否可用…';
  else if(!phoneState.hasProfile)phoneSummary.textContent='请先保存联系资料，再验证手机号。';
  else if(phoneState.phoneVerified){
   const at=phoneState.phoneVerifiedAt&&Number.isFinite(Date.parse(phoneState.phoneVerifiedAt))?new Date(phoneState.phoneVerifiedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';
   phoneSummary.textContent='手机号已验证。'+(at?'验证时间：'+at+'（北京时间）。':'');
  }else if(!phoneState.supported)phoneSummary.textContent='商家入驻目前仅支持中国大陆 +86 手机号短信验证，请保存可接收短信的大陆手机号。';
  else if(!phoneState.configured)phoneSummary.textContent='短信验证暂未开通，开通后即可验证手机号。';
  else phoneSummary.textContent='将向当前账号已保存的手机号发送短信验证码，5 分钟内有效。';
  if(ready&&(phoneChallengeId||seconds>0)){if(!phoneTimer)phoneTimer=setInterval(updatePhone,1000);}
  else{clearInterval(phoneTimer);phoneTimer=null;}
 }
 async function loadPhoneState(){
  if(!phoneForm||phoneDisposed||profileDirty||profileSaving)return;
  if(!phoneHasProfile){phoneState={configured:false,hasProfile:false,supported:false,phoneVerified:false,phoneVerifiedAt:null};phoneStateError='';updatePhone();return;}
  const revision=++phoneRevision;phoneState=null;phoneStateError='';updatePhone();
  try{
   const value=await api('phone/state');
   if(revision!==phoneRevision||phoneDisposed)return;
   phoneState={configured:value.configured===true,supported:value.supported===true,hasProfile:value.hasProfile===true,phoneVerified:value.phoneVerified===true,phoneVerifiedAt:value.phoneVerifiedAt||null};
   updatePhone();
  }catch(err){if(revision===phoneRevision&&!phoneDisposed){phoneStateError='暂时无法读取短信验证状态，请刷新后重试。';phoneMessage(err.message,true);updatePhone();}}
 }
 profileForm?.addEventListener('input',()=>{profileRevision++;profileDirty=true;clearPhoneChallenge();phoneMessage('');updatePhone();});
 profileForm?.addEventListener('change',()=>{profileRevision++;profileDirty=true;clearPhoneChallenge();phoneMessage('');updatePhone();});
 phoneSend?.addEventListener('click',async()=>{
  if(!phoneReady()||phoneBusy||Date.now()<phoneResendAt)return;
  clearPhoneChallenge();const revision=phoneRevision;phoneBusy='send';phoneMessage('');updatePhone();
  try{
   const value=await api('phone/request-code',{});
   if(revision!==phoneRevision||phoneDisposed)return;
   if(typeof value.challengeId!=='string'||!value.challengeId)throw new Error('验证码发送状态异常，请稍后重试');
   phoneChallengeId=value.challengeId;phoneCode.value='';
   phoneExpiresAt=Date.now()+Math.min(300,Math.max(1,Number(value.expiresIn)||300))*1000;
   phoneResendAt=Date.now()+Math.min(3600,Math.max(60,Number(value.retryAfter)||60))*1000;
   phoneMessage('验证码已发送，请在 5 分钟内输入。');
  }catch(err){if(revision===phoneRevision&&!phoneDisposed)phoneMessage(err.message,true);}
  finally{if(revision===phoneRevision&&!phoneDisposed){phoneBusy='';updatePhone();if(phoneChallengeId)phoneCode.focus();}}
 });
 phoneForm?.addEventListener('submit',async e=>{
  e.preventDefault();updatePhone();
  if(!phoneReady()||phoneBusy||!phoneChallengeId)return;
  if(!phoneForm.reportValidity())return;
  const code=phoneCode.value.trim();
  if(!/^[0-9]{6}$/.test(code)){phoneMessage('请输入 6 位数字验证码',true);phoneCode.focus();return;}
  const revision=++phoneRevision;phoneBusy='verify';phoneMessage('');updatePhone();
  try{
   const value=await api('phone/verify-code',{challengeId:phoneChallengeId,code});
   if(revision!==phoneRevision||phoneDisposed)return;
   if(value.ok!==true||value.phoneVerified!==true)throw new Error('手机号验证未完成，请重试');
   phoneState={...phoneState,phoneVerified:true,phoneVerifiedAt:value.phoneVerifiedAt||null};
   clearPhoneChallenge();phoneMessage('手机号已验证。');updatePhone();
   const next=merchantApplicationNext();if(next)location.assign(next);
  }catch(err){if(revision===phoneRevision&&!phoneDisposed)phoneMessage(err.message,true);}
  finally{if(revision===phoneRevision&&!phoneDisposed){phoneBusy='';updatePhone();}}
 });
 function hint(value){try{localStorage.setItem('airadar_reader_hint_v1',JSON.stringify(value));}catch{}}
 function updateSend(){
  const b=$('[data-send-code]');if(!b)return;
  const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));
  b.disabled=sending||seconds>0||!state?.mailConfigured;
  b.textContent=sending?'正在发送…':seconds?`${seconds} 秒后重发`:'获取验证码';
 }
 const timer=form&&mode!=='login'?setInterval(updateSend,1000):null;
 addEventListener('pagehide',()=>{clearInterval(timer);form?.reset();phoneDisposed=true;clearPhoneChallenge();},{once:true});
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
   const data=await api('request-code',{email,purpose:root.dataset.codePurpose,consent:true});
   requestId=data.requestId;challengeEmail=email;resendAt=Date.now()+60000;
   $('[data-code-status]').textContent=mode==='reset-password'?'如果此邮箱已有账号，你会收到重置验证码。请查看收件箱和垃圾邮件。':'验证码已提交发送，请查看收件箱和垃圾邮件，10 分钟内有效。';
   if(form.elements.email.value.trim().toLowerCase()!==email){requestId='';throw new Error('邮箱已改变，请稍后为当前邮箱重新获取验证码');}
   form.elements.code.focus();
  }catch(e){error.textContent=e.message;}finally{sending=false;updateSend();}
 });
 form?.addEventListener('submit',async e=>{
  e.preventDefault();error.textContent='';status.textContent='';
  const email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password?.value;
  if(mode!=='login'){
   if(!requestId||challengeEmail!==email){error.textContent='请先获取当前邮箱的验证码';return;}
   if(form.elements.confirmPassword&&password!==form.elements.confirmPassword.value){error.textContent='两次输入的密码不一致';form.elements.confirmPassword.focus();return;}
  }
  const b=form.querySelector('[type=submit]');b.disabled=true;
  try{
   await api(mode,{email,password,requestId,code:form.elements.code?.value});
   form.reset();
   if(mode==='reset-password'){
    hint(false);form.hidden=true;clearInterval(timer);
    status.textContent='密码已重置，所有设备上的旧登录已退出。请用新密码登录。';
    const link=document.createElement('a');link.href='/login?method=password';link.className='retention-button primary';link.textContent='使用新密码登录';status.after(link);link.focus();
   }else{
    hint(true);let next=root.dataset.authNext||'/account';
    try{const u=new URL(next,location.origin);if(u.origin!==location.origin||!['/','/following','/account','/product','/shop','/weekly','/submit','/submit-shop','/claim-shop'].includes(u.pathname))next='/account';}catch{next='/account';}
    location.assign(next);
   }
  }catch(e){error.textContent=e.message;}finally{b.disabled=false;}
 });
 $('[data-account-logout]')?.addEventListener('click',async e=>{
  const button=e.currentTarget;button.disabled=true;status.textContent='正在退出…';
  try{await api('logout',{});hint(false);location.replace('/login');}
  catch(err){status.textContent=err.message;}
  finally{button.disabled=false;}
 });
 googleButton?.addEventListener('click',async()=>{
  googleButton.disabled=true;error.textContent='';
  try{
   const result=await api('google-start',{next:root.dataset.authNext||'/account',consent:true});
   const target=new URL(result.url);if(target.origin!=='https://accounts.google.com')throw new Error('Google 登录地址无效');
   location.assign(target.href);
  }catch(err){error.textContent=err.message;googleButton.disabled=false;}
 });
 profileForm?.addEventListener('submit',async e=>{
  e.preventDefault();if(profileSaving||!state?.account||!profileForm.reportValidity())return;
  const button=profileForm.querySelector('[type=submit]'),message=$('[data-profile-status]'),fields=$('[data-profile-fields]'),revision=profileRevision;
  profileSaving=true;clearPhoneChallenge();phoneMessage('');updatePhone();fields.disabled=true;button.disabled=true;message.textContent='正在保存…';
  try{
   const value=await api('profile',{phone:profileForm.elements.phone.value,contactType:profileForm.elements.contactType.value,contactValue:profileForm.elements.contactValue.value});
   if(phoneDisposed)return;
   if(revision!==profileRevision){message.textContent='联系资料已保存。页面中的修改尚未保存，请再次保存。';return;}
   for(const name of ['phone','contactType','contactValue'])if(typeof value.profile?.[name]==='string')profileForm.elements[name].value=value.profile[name];
   profileDirty=false;profileSaving=false;phoneState=null;phoneHasProfile=true;
   const next=merchantApplicationNext();
   const required=value.phoneVerificationRequired!==false;
   message.textContent='联系资料已保存。'+(!required?'短信验证已暂停，可继续提交店铺申请。':value.profile?.phoneVerified===true?'手机号已验证。':next?'请完成短信验证后继续提交店铺。':'请完成商家手机号短信验证。');
   if(next&&(!required||value.profile?.phoneVerified===true)){location.assign(next);return;}
   if(!phoneForm){location.reload();return;}
   await loadPhoneState();
  }catch(err){message.textContent=err.message;}
  finally{profileSaving=false;fields.disabled=false;button.disabled=false;updatePhone();}
 });
 api('state').then(value=>{
  state=value;status.textContent='';
  if(googleButton)googleButton.disabled=!state.googleConfigured;
  if(form){$('[data-auth-fields]').disabled=false;
   if(mode!=='login'&&!state.mailConfigured){$('[data-auth-fields]').disabled=true;status.textContent='验证码邮件暂不可用，请稍后再试。已有账号仍可返回登录。';}
   updateSend();
  }else if(!state.account)location.replace('/login?next=%2Faccount');
  else if(profileForm){$('[data-profile-fields]').disabled=false;loadPhoneState();}
 }).catch(e=>{status.textContent=e.message;});
})();
