import {esc} from './retention-ui.mjs';
import {safeAccountReturn} from './account-auth.mjs';

export const accountAssets='<link rel="stylesheet" href="/assets/account.css"><script src="/assets/account.js" defer></script>';
export function accountContent(account,hasPassword){
 return `<section class="reader-account" data-account-page>
 <a class="reader-back" href="/">← 返回报价</a>
 <div class="reader-panel"><h1>我的账号</h1><p class="reader-intro">关注随账号保存，换个设备也能继续看。</p>
 <dl class="reader-details"><div><dt>登录邮箱</dt><dd><!--email_off-->${esc(account.email)}<!--/email_off--></dd></div><div><dt>密码</dt><dd>${hasPassword?'已设置':'尚未设置'}</dd></div></dl>
 ${hasPassword?'':'<p class="reader-hint">你之前验证过邮箱。设置密码后，就能用邮箱和密码登录，原有关注不会丢失。</p>'}
 <div class="reader-account-links"><a class="retention-button primary" href="/following">查看我的关注</a><a class="retention-button" href="/${hasPassword?'reset-password':'register'}">${hasPassword?'重置密码':'验证邮箱并设置密码'}</a></div>
 <button class="reader-text-button" type="button" data-account-logout>退出登录</button><p class="reader-message" data-account-status role="status" aria-live="polite"></p>
 </div><p class="reader-footnote">此账号用于个人关注与提醒，不代表店铺已收录，也没有管理员权限。</p></section>`;
}
export function loginContent(mode,url){
 const login=mode==='login',reset=mode==='reset',title=login?'登录 AIradar':reset?'重置密码':'创建账号';
 const next=safeAccountReturn(url.searchParams.get('next'));
 const copy=login?'用邮箱和密码，继续查看你的关注。':reset?'验证你的邮箱，然后设置一个新密码。':'验证邮箱、设置密码，让关注随你同步。';
 return `<section class="reader-account" data-auth-page data-auth-mode="${mode}" data-auth-next="${esc(next)}">
 <a class="reader-back" href="/">← 先看看报价</a><div class="reader-panel">
 <h1>${title}</h1><p class="reader-intro">${copy}</p>
 <form class="reader-form" data-auth-form method="post" action="/api/retention/${login?'login':reset?'reset-password':'register'}">
 <fieldset disabled data-auth-fields><label for="reader-email">邮箱</label><input id="reader-email" name="email" type="email" autocomplete="username" required maxlength="254" placeholder="you@example.com" spellcheck="false" autocapitalize="none">
 ${login?'':`<div class="reader-code"><label for="reader-code">邮箱验证码</label><div><input id="reader-code" name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码"><button class="retention-button" type="button" data-send-code>获取验证码</button></div><p class="reader-hint" data-code-status role="status">验证码 10 分钟内有效。</p></div>`}
 <div class="reader-password-label"><label for="reader-password">${reset?'新密码':'密码'}</label><button class="reader-text-button" type="button" data-password-visibility aria-pressed="false">显示密码</button></div>
 <input id="reader-password" name="password" type="password" autocomplete="${login?'current-password':'new-password'}" required ${login?'':'minlength="15"'} maxlength="128" ${login?'':'aria-describedby="reader-password-help"'}>
 ${login?'':`<p class="reader-hint" id="reader-password-help">15–128 个字符，支持中文和空格。建议使用一段不易猜到的短句，不要与其他网站共用。</p><label for="reader-password-confirm">确认${reset?'新':''}密码</label><input id="reader-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" required minlength="15" maxlength="128"><label class="reader-consent"><input name="consent" type="checkbox" required><span>我已阅读<a href="/privacy" target="_blank" rel="noopener noreferrer">隐私说明</a>，同意用邮箱验证身份。不会因此订阅营销邮件。</span></label>`}
 <p class="reader-message" data-auth-error role="alert"></p><button class="retention-button primary reader-submit" type="submit">${login?'登录':reset?'确认重置密码':'验证并创建账号'}</button>
 </fieldset></form>
 <p class="reader-message" data-auth-status role="status" aria-live="polite">正在连接登录服务…</p>
 <div class="reader-switch">${login?`<a href="/register?next=${esc(encodeURIComponent(next))}">注册 / 首次设置密码</a><a href="/reset-password">忘记密码？</a>`:`<span>${reset?'想起密码了？':'已经有账号？'}</span><a href="/login?next=${esc(encodeURIComponent(next))}">返回登录</a>`}</div>
 <noscript><p>登录需要 JavaScript。请启用后刷新；浏览报价无需登录。</p></noscript>
 </div>${mode==='register'?'<p class="reader-footnote">之前用邮箱保存过关注？使用同一邮箱设置密码即可，原有关注会保留。</p>':''}</section>`;
}
