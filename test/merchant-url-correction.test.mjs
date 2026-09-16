import test from 'node:test';
import assert from 'node:assert/strict';
import {openSubmissionsDb} from '../lib/submissions.mjs';
import {createMerchantApplication,getMerchantApplication,correctPendingMerchantUrl} from '../lib/merchant-onboarding.mjs';
import {queueMerchantMail} from '../lib/merchant-mail.mjs';

function fixture(t){
 const db=openSubmissionsDb(':memory:');t.after(()=>db.close());
 const {id}=createMerchantApplication(db,{shopName:'测试商店',shopUrl:'https://bbshare.site/',productAreas:['chatgpt'],email:'owner@example.org',contact:'owner@example.org',consent:true});
 const options={expectedVersion:1,expectedUrl:'https://bbshare.site/',confirmedReplyEmail:'owner@example.org',note:'申请人在原邮箱回复中补充 www 地址，站方已核对。'};
 return {db,id,options};
}
test('confirmed www correction is audited, keeps pending and email history, invalidates old version',t=>{
 const {db,id,options}=fixture(t);
 db.exec("UPDATE merchant_mail_outbox SET status='accepted',attempts=1");
 const app=correctPendingMerchantUrl(db,id,'https://www.bbshare.site/',options);
 assert.equal(app.shopUrl,'https://www.bbshare.site/');assert.equal(app.identity,'domain:www.bbshare.site');
 assert.equal(app.status,'pending');assert.equal(app.version,2);assert.equal(app.identityVerifiedAt,null);
 assert.equal(app.actions.at(-1).action,'correct_url');assert.match(app.actions.at(-1).note,/https:\/\/bbshare.site\/ → https:\/\/www.bbshare.site\//);
 assert.equal(app.actions.at(-1).ownershipConfirmed,0);assert.equal(app.actions.at(-1).permissionConfirmed,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM merchant_mail_outbox').get().n,1);
 assert.equal(db.prepare('SELECT status FROM merchant_mail_outbox').get().status,'accepted');
});
test('URL correction rejects stale state, another sender, unrelated domains and unsafe URLs',t=>{
 const {db,id,options}=fixture(t);
 for(const change of [{expectedVersion:2},{expectedUrl:'https://wrong.com/'},{confirmedReplyEmail:'other@example.org'},{note:''}])assert.throws(()=>correctPendingMerchantUrl(db,id,'https://www.bbshare.site/',{...options,...change}));
 for(const url of ['https://other.site/','https://shop.bbshare.site/','https://www.bbshare.site/other','https://127.0.0.1/','https://www.bbshare.site/?token=abc'])assert.throws(()=>correctPendingMerchantUrl(db,id,url,options));
 assert.equal(getMerchantApplication(db,id).version,1);assert.equal(getMerchantApplication(db,id).actions.length,0);
 db.exec("UPDATE merchant_applications SET status='approved'");
 assert.throws(()=>correctPendingMerchantUrl(db,id,'https://www.bbshare.site/',options));
});
test('duplicate target and failed audit do not mutate the original application',t=>{
 const {db,id,options}=fixture(t);
 createMerchantApplication(db,{shopName:'另一个店铺',shopUrl:'https://www.bbshare.site/',productAreas:['chatgpt'],email:'second@example.org',contact:'second@example.org',consent:true});
 assert.throws(()=>correctPendingMerchantUrl(db,id,'https://www.bbshare.site/',options),{status:409});
 assert.equal(getMerchantApplication(db,id).version,1);
 const f=fixture(t);f.db.exec("CREATE TRIGGER reject_url_audit BEFORE INSERT ON merchant_application_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.throws(()=>correctPendingMerchantUrl(f.db,f.id,'https://www.bbshare.site/',f.options),/audit unavailable/);
 assert.equal(getMerchantApplication(f.db,f.id).shopUrl,'https://bbshare.site/');
});
test('correcting www never resets the two-mail lifetime budget',t=>{
 const {db,id,options}=fixture(t);
 queueMerchantMail(db,{id,email:'owner@example.org',stage:'need_info',eventKey:id+':old-result',publicReply:'请核对最终网址。'});
 db.exec("UPDATE merchant_mail_outbox SET status='accepted',attempts=1");
 correctPendingMerchantUrl(db,id,'https://www.bbshare.site/',options);
 assert.equal(queueMerchantMail(db,{id,email:'owner@example.org',stage:'need_info',eventKey:id+':new-result',publicReply:'新的目录结果。'}),false);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM merchant_mail_outbox WHERE status='accepted'").get().n,2);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM merchant_mail_outbox WHERE status IN ('queued','retry')").get().n,0);
});
