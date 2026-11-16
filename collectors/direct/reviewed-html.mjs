import {collectPublicHtml} from './public-html.mjs';
import {isAuthorizedMerchantTarget} from '../../lib/merchant-target-capability.mjs';

// This shop's Product metadata omits these exact decorations. Compare only
// after removing them; full visible titles and warranty evidence stay intact.
const beibeiName=value=>value.normalize('NFKC')
 .replace(/【(?:质保30天|质保订阅|秒冲|同步官方售后|卡密可囤[三五]天|只限GPT接码)】/gi,'')
 .replace(/官方|正规/g,'').replace(/[\s|｜]/g,'').toLowerCase();

export async function collectReviewedHtml(target,options={}){
 if(!isAuthorizedMerchantTarget(target))throw new Error('公开目录来源未授权');
 if(target.origin==='https://bei-bei.shop')return collectPublicHtml(target,{...options,productNameNormalizer:beibeiName});
 // Invalid or pricing-unavailable products are omitted, never filled from old
 // cache. The complete live list still validates IDs, pagination and categories.
 if(target.origin==='https://alivip.vip')return collectPublicHtml(target,{...options,isolateInvalidProducts:true});
 throw new Error('公开目录来源未登记');
}
