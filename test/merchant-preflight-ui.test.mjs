import test from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalLink } from '../lib/admin-links.mjs';
import { merchantReviewContent } from '../lib/merchant-ui.mjs';

const application = {id:'MA-EXAMPLE',shopName:'Example',email:'owner@example.org',shopUrl:'https://wzyp.cn/shop/zhipuai',status:'pending',version:3};
test('proof and shop links only link safe HTTP(S) URLs in isolated new tabs',()=>{
  for (const value of ['https://wzyp.cn/shop/zhipuai','http://example.com/path?q=a&b=c']) {
    const html = safeExternalLink(value);
    assert.match(html,/<a href=/);
    assert.match(html,/target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"/);
  }
  for (const value of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://user:secret@example.com','https://example.com/\nfoo','https://example.com/\u007ffoo','//example.com','email@example.com']) {
    assert.doesNotMatch(safeExternalLink(value),/<a|<script>/);
  }
  assert.doesNotMatch(safeExternalLink('https://example.com/','<img src=x onerror=alert(1)>'),/<img/);
});
test('public preflight recheck is independent while manual approval retains all confirmations',()=>{
  const html = merchantReviewContent({application,csrfToken:'test-token'});
  const form = html.match(/<form[^>]*id="merchant-preflight">([\s\S]*?)<\/form>/)[1];
  assert.match(form,/name="version" value="3"/);
  assert.match(form,/name="csrf" value="test-token"/);
  assert.doesNotMatch(form,/name="ownershipConfirmed"/);
  assert.doesNotMatch(form,/name="permissionConfirmed"/);
  assert.match(form,/name="action" value="auto_test"/);
  assert.doesNotMatch(form,/name="note"/);
  assert.match(html,/value="approve" type="submit" disabled/);
  assert.match(html,/name="sampleReviewed"/);
});
test('preflight renders actionable states, counts and escaped bounded samples',()=>{
  for (const status of ['pending','queued','expired','invalid','no_valid_offers','waiting_adapter','unavailable']) {
    const html = merchantReviewContent({application,preflight:{status,canApprove:false}});
    assert.match(html,/value="approve" type="submit" disabled/);
    assert.match(html,/立即测试接入/);
    assert.doesNotMatch(html,/<script|fetch\(/);
    if (status==='queued') assert.match(html,/通常 5 分钟/);
  }
  const html = merchantReviewContent({application,preflight:{status:'ready',canApprove:true,result:{rawCount:9,validCount:6,checkedAt:'2026-09-07T00:00:00Z',message:'<script>x</script>',samples:Array.from({length:8},(_,i)=>({title:`商品${i}<img>`,currency:'CNY',price:19.9,url:'https://example.com/item'}))}}});
  assert.match(html,/可收录报价：6 条/);
  assert.match(html,/原始解析：9 条/);
  assert.equal(html.match(/>打开商品页 ↗<\/a>/g).length,5);
  assert.doesNotMatch(html,/<script|<img>|value="approve" type="submit" disabled/);
  assert.match(html,/不自动发布报价，也不验证真实交易/);
});
test('unread catalogues keep diagnostics and email status without manual copy templates',()=>{
 for(const status of ['unavailable','waiting_adapter']){
  const html=merchantReviewContent({application,preflight:{status,result:{status,rawCount:0,validCount:0,reasonCode:status==='unavailable'?'not_found':'invalid_catalog',message:'Private stacktrace'}}});
  assert.doesNotMatch(html,/可收录报价：0 条|原始解析：0 条|Private stacktrace/);
  assert.match(html,status==='unavailable'?/未读取成功/:/尚未识别目录/);
  assert.doesNotMatch(html,/preflight-current-message|其他情况的沟通文案|复制文案|发给店主的文案/);
  assert.match(html,/邮件通知/);
 }
 for(const preflight of [null,{status:'unavailable',result:{status:'unavailable'}}]){
  const html=merchantReviewContent({application,preflight});
  assert.doesNotMatch(html,/guidance-library|data-copy-target/);
  if(preflight)assert.match(html,/历史测试未记录具体原因，请重新测试/);
 }
});
test('conversion provenance links back to original supply record and escapes audit note',()=>{
 const html=merchantReviewContent({application:{...application,conversion:{sourceSubmissionId:'CO-EXAMPLE',convertedAt:'2026-09-07T00:00:00Z',note:'<img onerror=x>'}}});
 assert.match(html,/href="\/admin\/submission\/CO-EXAMPLE"/);assert.match(html,/转入核验依据/);assert.doesNotMatch(html,/<img/);
});
