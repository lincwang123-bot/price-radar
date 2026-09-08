import {esc} from './retention-ui.mjs';
import {CONTACT_TYPES} from './account-profile.mjs';

export function profileFields(profile={}){
 return `<label for="reader-phone">手机号（必填）</label><input id="reader-phone" name="phone" type="tel" autocomplete="tel" required maxlength="32" value="${esc(profile?.phone||'')}" placeholder="中国大陆手机号，或 +国家区号 手机号" aria-describedby="reader-phone-help"><p class="reader-hint" id="reader-phone-help">仅检查格式，未进行短信验证。手机号和联系账号仅供站方联系，不公开展示。</p>
 <label for="reader-contact-type">联系渠道（微信、TG、QQ 选一项）</label><select id="reader-contact-type" name="contactType" required><option value="">请选择联系渠道</option>${Object.entries(CONTACT_TYPES).map(([key,label])=>`<option value="${key}"${profile?.contactType===key?' selected':''}>${label}</option>`).join('')}</select>
 <label for="reader-contact-value">联系账号（必填）</label><input id="reader-contact-value" name="contactValue" required maxlength="64" autocomplete="off" value="${esc(profile?.contactValue||'')}" placeholder="微信号、TG 用户名或 QQ 号码">`;
}
export function profileForm(profile,next){
 const continuing=next!=='/account';
 return `<form class="reader-form reader-profile" data-profile-form method="post" action="/api/retention/profile"><h2>联系资料</h2><p class="reader-hint">${profile?'可以在这里更新联系资料。':'提交店铺前，请补齐手机号和一项联系账号。'}</p><fieldset disabled data-profile-fields>${profileFields(profile)}<button class="retention-button primary reader-submit" type="submit">${continuing?'保存并继续提交店铺':'保存联系资料'}</button></fieldset><p class="reader-message" data-profile-status role="status" aria-live="polite"></p></form>`;
}
