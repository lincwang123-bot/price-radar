import test from 'node:test';
import assert from 'node:assert/strict';
import {localizePublicHtml,englishPublicHref,englishText,englishReviewBrowsing} from '../lib/public-translation.mjs';
test('localization only transforms UI, never scripts, values, original reviews or merchant identities',()=>{
 const original='<script>const label="搜索";const html="<p>取消</p>";</script><style>.a:after{content:"搜索"}</style>';
 const html=localizePublicHtml('<html lang="zh-CN"><body>'+original+'<button title="搜索">搜索</button><input value="搜索"><div class="directory-quote-main"><h2>搜索</h2><p class="directory-quote-title" title="搜索">取消 &lt;script&gt;bad&lt;/script&gt;</p></div><p class="review-body">搜索 &amp; 取消</p><a href="https://example.com/搜索">Example</a></body></html>');
 assert.ok(html.includes(original));assert.match(html,/<button title="Search">Search<\/button>/);assert.match(html,/<input value="搜索">/);assert.match(html,/<h2>搜索<\/h2>/);assert.match(html,/取消 &lt;script&gt;bad&lt;\/script&gt;/);assert.match(html,/搜索 &amp; 取消<\/p>/);assert.match(html,/href="https:\/\/example.com\/搜索"/);assert.doesNotMatch(html,/<script>bad/);
 assert.equal(englishText('constructor'),'constructor');assert.equal(englishText('toString'),'toString');
});
test('localized hrefs retain filters and original values without rewriting external or private links',()=>{
 assert.equal(englishPublicHref('/prices/chatgpt-plus?delivery=recharge&page=2#quotes'),'/en/prices/chatgpt-plus?page=2&delivery=recharge#quotes');
 assert.equal(englishPublicHref('/?shop_q=搜索'),'/en/?shop_q=%E6%90%9C%E7%B4%A2');
 for(const href of ['/login','/api/review-images/123','//example.com/shop','https://example.com/shop'])assert.equal(englishPublicHref(href),href);
 const html=localizePublicHtml('<a href="/login" title="登录 / 注册">登录 / 注册</a><form action="/product"><input value="搜索"></form>');
 assert.equal((html.match(/title=/g)||[]).length,1);assert.match(html,/data-chinese-page="true"/);assert.match(html,/action="\/en\/official-prices"/);
});
test('review write links intentionally return to the Chinese form, not a dead English fragment',()=>{
 const html=localizePublicHtml(englishReviewBrowsing('<a class="review-button" href="#write-review">写评价</a>','a'.repeat(24)));
 assert.match(html,/href="\/shop\?id=a{24}#write-review"/);assert.doesNotMatch(html,/href="\/en\/shop/);
});
