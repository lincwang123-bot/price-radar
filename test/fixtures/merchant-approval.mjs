import {verifyApplicationPhone} from '../helpers/merchant-phone.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getMerchantApplication,reviewMerchantApplication} from '../../lib/merchant-onboarding.mjs';
import {queueAutomaticPreflight} from '../../lib/merchant-preflight-store.mjs';

// Legacy mail/UI fixtures still exercise the real approval gate. Supply a
// current result rather than bypassing production validation for tests.
export function reviewWithProductFixture(db,id,review,options={}){
 if(review.action!=='approve')return reviewMerchantApplication(db,id,review,options);
 const app=getMerchantApplication(db,id),now=options.now||new Date();
 if(!app?.email||!app.consentAt||app.version!==review.expectedVersion)return reviewMerchantApplication(db,id,review,options);
 verifyApplicationPhone(db,id);
 const dir=mkdtempSync(path.join(tmpdir(),'merchant-product-fixture-'));
 try{
  const req=queueAutomaticPreflight(db,id,{bridgeDir:dir,resultsDir:dir,now,force:true});
  writeFileSync(path.join(dir,req.id+'.json'),JSON.stringify({schemaVersion:1,id:req.id,applicationId:id,
   applicationVersion:app.version,identity:app.identity,startedAt:req.requestedAt,checkedAt:req.requestedAt,
   status:'ready',rawCount:1,validCount:1,message:'测试用有效商品',samples:[{title:'ChatGPT Plus 1个月',price:120,currency:'CNY',url:new URL('product/test',app.shopUrl).href}]}));
  return reviewMerchantApplication(db,id,review,{...options,now,resultsDir:dir});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
