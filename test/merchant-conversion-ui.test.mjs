import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {conversionPanel} from '../lib/merchant-conversion-ui.mjs';
import {ADMIN_COPY_HASH,ADMIN_COPY_SCRIPT,copyMessageContent} from '../lib/admin-copy.mjs';
import {adminPage} from '../lib/admin-ui.mjs';
const submission={public_id:'CO-EXAMPLE',subject:'供应多种产品，并非店名',source_url:'https://merchant-qa-only.com/',product_area:'claude',details:'原投稿说明',contact:'private@example.org'};
test('conversion prefills source facts but requires actual shop name and fresh confirmations',()=>{
 const html=conversionPanel({submission,csrfToken:'csrf-token'});
 assert.match(html,/name="shopName"[^>]*value=""/);
 assert.match(html,/name="shopUrl"[^>]*value="https:\/\/merchant-qa-only.com\/"/);
 assert.match(html,/name="contact"[^>]*value="private@example.org"/);
 assert.match(html,/<option value="claude" selected/);
 assert.match(html,/name="note" required minlength="5"/);
 assert.match(html,/name="ownershipConfirmed" value="true" required/);
 assert.match(html,/name="permissionConfirmed" value="true" required/);
 assert.doesNotMatch(html,/<input[^>]*checked/);
 assert.match(html,/不批准店铺、不发起测试，也不发布报价/);
});
test('linked and conflicting applications have distinct safe links and no silent merge',()=>{
 const linked=conversionPanel({submission,linkedApplication:{id:'MA-LINK',shopName:'已转店铺'}});
 assert.match(linked,/\/admin\/merchants\/MA-LINK/);assert.doesNotMatch(linked,/merchant-conversion-form/);
 const conflict=conversionPanel({submission,existingApplication:{id:'MA-CONFLICT',shopName:'同网址店铺'},error:'该网址已存在'});
 assert.match(conflict,/\/admin\/merchants\/MA-CONFLICT/);assert.match(conflict,/不会自动合并联系方式或关联当前投稿/);
});
test('conversion errors retain edited values while resetting confirmations and escaping markup',()=>{
 const html=conversionPanel({submission,values:{shopName:'<script>x</script>',details:'</textarea><img onerror=x>',ownershipConfirmed:'true',permissionConfirmed:'true'},error:'<script>alert(1)</script>'});
 assert.doesNotMatch(html,/<script|<img|<input[^>]*checked/);assert.match(html,/&lt;script&gt;x/);
});
test('admin copy source has an exact stable hash and message payload never enters the script',()=>{
 assert.equal(ADMIN_COPY_HASH,'sha256-'+createHash('sha256').update(ADMIN_COPY_SCRIPT).digest('base64'));
 const message='秘密正文 </textarea><script>alert(1)</script>';
 const body=copyMessageContent(message,'current-message');
 assert.match(body,/readonly rows="6"/);assert.match(body,/data-copy-target="current-message"/);assert.match(body,/role="status" aria-live="polite"/);assert.doesNotMatch(body,/<script>/);
 const page=adminPage('test',body);assert.equal(page.match(/<script>/g).length,1);assert.ok(page.includes('<script>'+ADMIN_COPY_SCRIPT+'</script>'));assert.doesNotMatch(ADMIN_COPY_SCRIPT,/秘密正文|innerHTML|fetch\(/);
});
