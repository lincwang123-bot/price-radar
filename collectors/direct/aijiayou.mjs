import {collectPublicHtml} from './public-html.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';

// The reviewed store's API reports every stock count as zero, while its public
// product pages expose both qualitative inventory and matching Product offers.
// Read those pages directly; never reinterpret the API's zero as available.
const comparableName=value=>{
 let name=value.normalize('NFKC')
  .replace(/【(?:质保\d+天|秒[充冲]|到期自动扣款|新开20X|新老号均可充值)】/gi,'')
  .replace(/官方|正规/g,'').replace(/[\s|｜]/g,'').toLowerCase();
 // This suffix repeats the explicit eligibility clause. Keep that clause in
 // both compared names, so a different plan or unrestricted account still fails.
 if(name.includes('chatgptpro20x')&&name.includes('订阅过20x均可'))name=name.replace(/【续约或再次开启20x】/g,'');
 return name;
};

export async function collectAijiayou(target,options={}){
 if(target.origin!=='https://aijiayou.win'||!isAuthorizedMerchantTarget(target))throw new Error('Ai加油站公开目录来源未授权');
 return collectPublicHtml(target,{...options,productNameNormalizer:comparableName,isolateInvalidProducts:true});
}
