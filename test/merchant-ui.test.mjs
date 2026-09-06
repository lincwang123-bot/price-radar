import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantSubmissionContent,merchantInboxContent,merchantReviewContent} from '../lib/merchant-ui.mjs';

const application={id:'MA-20260907-abc',shopName:'Example',shopUrl:'https://example.com',platform:'independent',productAreas:['chatgpt'],contact:'private@example.com',details:'Private evidence',status:'pending',version:1,createdAt:'2026-09-07',updatedAt:'2026-09-07'};
test('merchant times use Beijing timezone across day boundary and tolerate invalid dates',()=>{
  const app={...application,createdAt:'2026-09-06T16:45:23.000Z',updatedAt:'bad timestamp'};
  const review=merchantReviewContent({application:app,actions:[{action:'approve',note:'核验记录',createdAt:app.createdAt},{action:'pause',createdAt:null}]});
  assert.equal(review.match(/2026\/09\/07 00:45:23（北京时间）/g)?.length,2);
  assert.match(review,/<dt>更新时间<\/dt><dd>—<\/dd>/);
  assert.ok(!review.includes('Invalid Date'));
  const inbox=merchantInboxContent({items:[app]});
  assert.match(inbox,/2026\/09\/07 00:45:23（北京时间）/);
  assert.ok(!inbox.includes('2026-09-06T16:45'));
});
test('submission is a POST form with progressive enhancement and escaped prefills',()=>{
  const html=merchantSubmissionContent('token"<>',{shopName:'<img src=x onerror=alert(1)>',shopUrl:'https://example.com/?q="'});
  assert.match(html,/action="\/api\/merchant-applications" method="post"/);
  assert.match(html,/name="csrf" value="token&quot;&lt;&gt;"/);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html,/x-csrf-token/);
  assert.match(html,/message\.textContent=/);
  assert.ok(!html.includes('innerHTML'));
  assert.match(html,/message\.focus\(\)/);
  assert.match(html,/name="consent" value="true" required/);
  assert.match(html,/name="website" tabindex="-1"/);
  assert.match(html,/审核通过且采集成功后展示有效报价/);
  for(const area of ['grok_x','api_relay','mail_verify'])assert.ok(html.includes(`name="productAreas" value="${area}"`));
  assert.match(html,/maxlength="500"/);
  assert.match(html,/<select name="platform"><option value="auto" selected>自动识别<\/option>/);
});
test('inbox hides contact and evidence and rejects executable or credentialed URL links',()=>{
  for(const shopUrl of ['javascript:alert(1)','https://user:password@example.com']) {
    const html=merchantInboxContent({items:[{...application,shopUrl,shopName:'<script>alert(1)</script>'}],total:1});
    assert.ok(!html.includes('private@example.com'));
    assert.ok(!html.includes('Private evidence'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('href="'+shopUrl));
  }
  const html=merchantInboxContent({items:[application],total:31,page:1,counts:{pending:31,approved:2}});
  assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/已通过 · 2/);
  assert.match(html,/status=pending&amp;page=2/);
});
test('review has no scripts and escapes private fields, audit records and CSRF metadata',()=>{
  const html=merchantReviewContent({application:{...application,contact:'<script>secret</script>'},actions:[{action:'<b>',note:'<img onerror=x>',createdAt:'"'}],csrfToken:'"><script>'});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html,/name="version" value="1"/);
  assert.match(html,/name="note" required minlength="5"/);
  assert.match(html,/name="ownershipConfirmed"/);
  assert.match(html,/name="permissionConfirmed"/);
  for(const action of ['approve','reject','pause'])assert.ok(html.includes('value="'+action+'"'));
});
test('approval is separate from collection and verified badge requires approval and verification',()=>{
  const render=(status,health)=>merchantReviewContent({application:{...application,status,identityVerifiedAt:'2026-09-07'},health});
  assert.ok(!render('pending',{}).includes('class="badge">店主已核验'));
  assert.match(render('approved',{}),/class="badge">店主已核验/);
  assert.match(render('approved',{}),/class="badge">等待采集/);
  for(const [status,label] of [['ok','已接入'],['unsupported','待适配'],['waiting_adapter','待适配'],['failed','采集暂不可用']])assert.ok(render('approved',{status}).includes('class="badge">'+label));
});
