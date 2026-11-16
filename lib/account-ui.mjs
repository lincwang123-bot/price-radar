import {esc} from './retention-ui.mjs';
import {safeAccountReturn,READER_PASSWORD_MIN,READER_PASSWORD_MAX} from './account-auth.mjs';
import {profileForm} from './account-profile-ui.mjs';
import {brandMark} from './brand-icons.mjs';

export const accountAssets='<link rel="stylesheet" href="/assets/account.css"><script src="/assets/account.js" defer></script>';
const consent=`<label class="reader-consent"><input name="consent" type="checkbox" required><span>我已阅读<a href="/privacy" target="_blank" rel="noopener noreferrer">隐私说明</a>，同意用邮箱验证身份。不会因此订阅营销邮件。</span></label>`;
export function accountContent(account,hasPassword,profile=null,next='/account',{googleLinked=false,merchantContext=false,phoneVerificationRequired=true}={}){
 next=safeAccountReturn(next);const applying=new URL(next,'https://airadar.vip').pathname==='/submit-shop',merchant=merchantContext||applying;
 return `<section class="reader-account" data-account-page data-profile-next="${esc(next)}"><a class="reader-back" href="/">← 返回报价</a>
 <div class="reader-panel"><h1>${applying?'商家入驻 · 联系资料':merchant?'商家联系资料':'我的账号'}</h1><p class="reader-intro">${merchant?(phoneVerificationRequired?'申请店铺审核前须保存联系资料并完成手机号短信验证，资料仅供站方联系。':'短信验证已暂停，保存商家联系资料后即可提交店铺申请；批准收录仍须完成当前账号已保存手机号的短信验证，资料仅供站方联系。'):'已验证邮箱，可以保存关注、写评价。普通用户不需要填写手机号或联系账号。'}</p>
 <dl class="reader-details"><div><dt>登录邮箱</dt><dd><!--email_off-->${esc(account.email)}<!--/email_off--></dd></div><div><dt>可用登录方式</dt><dd>${googleLinked?'Google / ':''}邮箱验证码${hasPassword?' / 密码':''}</dd></div></dl>
 <div class="reader-account-links"><a class="retention-button primary" href="/following">查看我的关注</a><a class="retention-button" href="/reset-password">${hasPassword?'重置密码':'设置密码（选填）'}</a></div>
 ${merchant?profileForm(profile,next,{phoneVerificationRequired}):`<div class="reader-merchant-entry"><strong>我是商家</strong><p>希望店铺出现在报价目录？申请时再补齐店铺与联系资料。</p><a href="/submit-shop">申请店铺入驻 →</a>${profile?'<p><a href="/account?role=merchant">管理商家联系资料 →</a></p>':''}</div>`}
 <button class="reader-text-button" type="button" data-account-logout>退出登录</button><p class="reader-message" data-account-status role="status" aria-live="polite"></p></div>
 <p class="reader-footnote">注册不代表店铺已收录，也没有管理员权限。商家入驻须另行审核。</p></section>`;
}
export function loginContent(mode,url,{googleConfigured=false,phoneVerificationRequired=true}={}){
 const reset=mode==='reset',passwordRegister=mode==='password-register',passwordLogin=mode==='login'&&url.searchParams.get('method')==='password';
 const emailOnly=!reset&&!passwordRegister&&!passwordLogin;
 let next=safeAccountReturn(url.searchParams.get('next'));
 const merchant=url.searchParams.get('role')==='merchant'||new URL(next,'https://airadar.vip').pathname==='/submit-shop';
 if(merchant&&next==='/account')next='/submit-shop';
 const title=reset?'设置 / 重置密码':passwordRegister?'设置账号密码':merchant?'商家入驻':mode==='register'?'用户注册':'登录 AIradar';
 const copy=reset?'验证邮箱后设置新密码。设置密码是可选的，你也可以一直使用邮箱验证码登录。':passwordRegister?'验证邮箱并设置密码，无需填写商家资料。':merchant?(phoneVerificationRequired?'先验证邮箱登录，再填写商家联系资料并完成手机号短信验证，随后提交店铺审核。已有账号可直接登录。':'先验证邮箱登录，再填写商家联系资料并提交店铺审核。短信验证已暂停，批准收录仍须完成当前账号已保存手机号的短信验证。已有账号可直接登录。'):emailOnly?'只需验证邮箱，即可关注产品、发表评价。首次验证会自动创建账号。':'使用原有邮箱和密码登录。';
 const action=emailOnly?'email-login':reset?'reset-password':passwordRegister?'register':'login';
 const purpose=emailOnly?'email':reset?'reset':'register';
 const methodHref=method=>'/login?'+new URLSearchParams({next,...(merchant?{role:'merchant'}:{}),...(method?{method}:{})});
 const roleHref=role=>'/register?'+new URLSearchParams({next:role==='merchant'?'/submit-shop':(merchant?'/account':next),...(role==='merchant'?{role}: {})});
 return `<section class="reader-account" data-auth-page data-auth-mode="${action}" data-code-purpose="${purpose}" data-auth-next="${esc(next)}">
 <a class="reader-back" href="/">← 先看看报价</a><div class="reader-panel">
 ${!reset&&!passwordRegister?`<nav class="reader-role-tabs" aria-label="注册用途"><a href="${esc(roleHref('user'))}"${merchant?'':' aria-current="page"'}>用户注册</a><a href="${esc(roleHref('merchant'))}"${merchant?' aria-current="page"':''}>商家入驻</a></nav>`:''}
 <h1>${title}</h1><p class="reader-intro">${copy}</p>
 ${googleConfigured&&!reset&&!passwordRegister?`<button type="button" class="reader-google-button" data-google-login disabled>${brandMark('google','reader-google-icon')}使用 Google 账号登录</button><p class="reader-google-note">仅获取登录身份和邮箱，不读取邮件内容。继续即表示同意<a href="/privacy">隐私说明</a>。</p><div class="reader-or">或使用邮箱</div>`:''}
 ${url.searchParams.get('auth_error')==='google'?'<p class="reader-message" role="alert">Google 登录未完成，请重试或使用邮箱验证码。取消授权不会影响原有账号。</p>':''}
 <form class="reader-form" data-auth-form method="post" action="/api/retention/${action}"><fieldset disabled data-auth-fields>
 <label for="reader-email">邮箱</label><input id="reader-email" name="email" type="email" autocomplete="username" required maxlength="254" placeholder="you@example.com" spellcheck="false" autocapitalize="none">
 ${passwordLogin?'':`<div class="reader-code"><label for="reader-code">邮箱验证码</label><div><input id="reader-code" name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码"><button class="retention-button" type="button" data-send-code>获取验证码</button></div><p class="reader-hint" data-code-status role="status">验证码 10 分钟内有效。</p></div>`}
 ${emailOnly?'':`<div class="reader-password-label"><label for="reader-password">${reset?'新密码':'密码'}</label><button class="reader-text-button" type="button" data-password-visibility aria-pressed="false">显示密码</button></div><input id="reader-password" name="password" type="password" autocomplete="${passwordLogin?'current-password':'new-password'}" required ${passwordLogin?'':`minlength="${READER_PASSWORD_MIN}"`} maxlength="${READER_PASSWORD_MAX}">${passwordLogin?'':`<p class="reader-hint">至少 ${READER_PASSWORD_MIN} 位，建议组合字母、数字或符号。</p><label for="reader-password-confirm">确认密码</label><input id="reader-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" required minlength="${READER_PASSWORD_MIN}" maxlength="${READER_PASSWORD_MAX}">`}`}
 ${passwordLogin?'':consent}<p class="reader-message" data-auth-error role="alert"></p><button class="retention-button primary reader-submit" type="submit">${emailOnly?merchant?'验证邮箱并继续入驻':'验证邮箱并继续':reset?'确认设置密码':passwordRegister?'验证并设置密码':'登录'}</button>
 </fieldset></form><p class="reader-message" data-auth-status role="status" aria-live="polite">正在连接登录服务…</p>
 <div class="reader-switch">${emailOnly?`<a href="${esc(methodHref('password'))}">使用密码登录</a><a href="/reset-password">设置 / 忘记密码</a>`:passwordLogin?`<a href="${esc(methodHref(''))}">使用邮箱验证码登录</a><a href="/reset-password">忘记密码？</a>`:`<a href="${esc(methodHref(''))}">返回邮箱登录</a>`}</div>
 <noscript><p>登录需要 JavaScript。请启用后刷新；浏览报价无需登录。</p></noscript></div>
 <p class="reader-footnote">游客浏览报价无需注册。同一邮箱登录可继续使用原有账号和关注，不会另建重复账号。</p></section>`;
}
