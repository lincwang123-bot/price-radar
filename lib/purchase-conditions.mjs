import {createHash} from 'node:crypto';
import {deliveryEvidence} from './delivery-evidence.mjs';
const clean=v=>String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim().slice(0,1600);
const number='(?:\\d+|十二|十一|十|九|八|七|六|五|四|三|两|二|一)';
const duration=`${number}\\s*(?:个)?\\s*(?:个月|月|年|天|日|小时)`;
const redemption=new RegExp(`(?:卡密)?(?:兑换|激活|核销)(?:码)?(?:有效期|期限|时限|期)?\\s*[:：]?\\s*(${duration})(?:内|以内)?|(${duration})\\s*(?:内|以内)\\s*(?:兑换|激活|核销)`,'g');
const warranty=new RegExp(`(?:质保|保修|售后)(?:订阅)?(?:期限|时长|期)?\\s*[:：]?\\s*(${duration})|(${duration})\\s*(?:质保|保修|售后)`,'g');
// Strip only explicitly named windows; never infer subscription time from them.
export function withoutOtherWindows(text){return clean(text).replace(redemption,' ').replace(warranty,' ');}
export function purchaseEvidence(offer){
 let extra={};try{extra=typeof offer.extra==='string'?JSON.parse(offer.extra):offer.extra||{};}catch{}
 const e=deliveryEvidence(extra.deliveryEvidence);
 const description=['sku','product'].includes(e.descriptionScope)&&!/(?:常见问题|本店|全店|\bFAQ\b)/i.test(e.description)?e.description:'';
 // URLs and 手续费 are not renewal eligibility evidence.
 return clean([offer.title,e.skuTitle,description].filter(Boolean).join('；')).replace(/https?:\/\/\S+/gi,' ').replace(/手续费/g,'支付费用');
}
const windowValue=(text,re)=>[...new Set([...text.matchAll(re)].map(m=>clean(m[1]||m[2]).replace(/\s/g,'')))].join(' / ');
export function purchaseConditions(offer,{term='unknown',delivery={kind:'unknown',known:false},subscription=true,region='',currency=offer.currency||''}={}){
 const text=purchaseEvidence(offer);
 const noMembership=/(?:无需|不需要|不要求|不用)\s*(?:已开通|已有|现有)?\s*(?:会员|订阅)/.test(text);
 const requiresMembership=!noMembership&&/(?:需要|需|要求|仅限|必须|只限)\s*(?:已有|现有|已开通|有效)?\s*(?:会员|订阅)|已有(?:有效)?会员/.test(text);
 const both=/新开\s*(?:和|与|及|或|、|\/)?\s*续费\s*(?:均可|皆可|都可|通用|均支持)|(?:支持|可)(?:新开\s*(?:和|与|及|或|、|\/)\s*续费)|新老(?:用户|账号)通用/.test(text);
 const deniedNew=/(?:不支持|不可|不能|不接受|限制)\s*新开(?:通)?/.test(text);
 const deniedRenewal=/(?:不支持|不可|不能|不接受)\s*(?:续费|续订)/.test(text);
 const positive=text.replace(/(?:不支持|不可|不能|不接受|限制)\s*(?:提前)?\s*(?:新开(?:通)?|续费|续订)/g,' ');
 const newOnly=!deniedNew&&/新开|首开|新订阅|首次订阅|仅限新用户/.test(positive);
 const renewal=!deniedRenewal&&/续费|续订|临期/.test(positive);
 const accountState=both?'both':newOnly&&renewal?'unknown':renewal?'renewal':newOnly?'new':'unknown';
 const redemptionWindow=windowValue(text,redemption),warrantyWindow=windowValue(text.replace(redemption,' '),warranty);
 const timing=[...text.matchAll(/(?:剩余|还剩|到期前|仅限|只限)?\s*(?:\d+|[一二两三四五六七八九十]+)\s*(?:[-~至]\s*\d+)?\s*(?:天|日)\s*(?:内|以内)?\s*(?:到期|过期)|(?:到期前|剩余|还剩)\s*(?:\d+|[一二两三四五六七八九十]+)\s*(?:天|日)(?:以内|内)?/g)].map(m=>clean(m[0]));
 const prerequisites=[...text.matchAll(/[^；。\n]{0,35}(?:指定账号状态|需符合|需满足|指定地区|仅限[^；。\n]{0,25}|换绑卡|换绑|自动续订)[^；。\n]{0,35}/g)].map(m=>clean(m[0]));
 const vague=/指定账号状态|指定地区|需符合|需满足/.test(text);
 const afterExpiry=/(?:请|须|需|需要|必须|等|等待|确认).{0,10}(?:会员|订阅)到期后?.{0,10}(?:续费|续订|充值)|(?:会员|订阅)到期(?:后|再).{0,10}(?:续费|续订|充值)|(?:不可|不能|不支持)提前续费/.test(text);
 const beforeExpiry=/(?:可以|支持|允许)提前续费|(?:支持|可以).{0,15}到期前提前续费/.test(text);
 const effectText=text.replace(/(?:不会|不能|不|无需|不需要)(?:直接)?覆盖[^。；，,！!?？]{0,20}/g,' ');
 const replaceTime=/(?:会|将|直接)?覆盖(?:原有|原来|现有|剩余|会员|订阅)?(?:的)?(?:时间|时长|天数|权益)|(?:并非|不是|不)(?:累计|累加|叠加)/.test(effectText);
 const extendTime=/(?:时间|时长|天数)(?:会|将|可以|可)?(?:累计|累加|叠加)|(?:支持|可以)(?:累计|累加|叠加)(?:时间|时长|天数)/.test(text);
 const renewalTiming=afterExpiry&&beforeExpiry?'conflict':afterExpiry?'after_expiry':beforeExpiry?'before_expiry':'unknown';
 const renewalEffect=replaceTime&&extendTime?'conflict':replaceTime?'replace':extendTime?'extend':'unknown';
 const renewalRestrictions=[...(afterExpiry?['需等当前会员到期后续费']:[]),...(beforeExpiry?['支持提前续费']:[]),...(replaceTime?['续费覆盖原有时间，不累计']:[]),...(extendTime?['续费时间可累计']:[])];
 const restrictions=[...(region&&region!=='全球'?['标注地区：'+region]:[]),...(accountState==='new'?['仅适用新开']:accountState==='renewal'?['续费条件']:[]),...(requiresMembership?['需要已有会员']:[]),...timing,...prerequisites,...renewalRestrictions];
 const reasons=[];
 if(subscription&&!['CNY','USD','EUR','GBP','HKD','TWD','JPY','KRW','SGD','AUD','CAD','INR','TRY','BRL','MYR','THB','VND','IDR','CHF','AED','USDT','USDC'].includes(currency))reasons.push('币种待确认');
 if(both&&/(?:不支持|不可|不能|不接受)\s*(?:新开|续费)/.test(text))reasons.push('新开续费条件有冲突');
 if(renewalTiming==='conflict'||renewalEffect==='conflict')reasons.push('续费时间条件有冲突');
 if(subscription&&!delivery.known)reasons.push('交付待确认');
 if(subscription&&['unknown','ambiguous'].includes(term))reasons.push('订阅期限待确认');
 if(subscription&&delivery.kind==='recharge'&&accountState==='unknown')reasons.push('新开或续费条件未注明');
 if(region.includes(','))reasons.push('地区条件不一致');
 if(vague)reasons.push('账号或地区限制需确认');
 if(redemptionWindow.includes(' / ')||warrantyWindow.includes(' / '))reasons.push('时间条件不一致');
 const quality=reasons.length?'C':restrictions.length?'B':'A';
 const signature=JSON.stringify([accountState,requiresMembership,[...new Set(timing)].sort(),[...new Set(prerequisites)].sort(),redemptionWindow,warrantyWindow,...(renewalRestrictions.length?[renewalTiming,renewalEffect]:[])]);
 // Extend only when actual conditions are present. Original raw records and
 // ordinary legacy spec URLs keep their identity; restrictions form new groups.
 const hasConditions=['new','renewal'].includes(accountState)||requiresMembership||timing.length||prerequisites.length||redemptionWindow||warrantyWindow||renewalRestrictions.length;
 return {version:2,subscriptionTerm:term,accountState,requiresMembership,redemptionWindow,warrantyWindow,renewalTiming,renewalEffect,restrictions:[...new Set(restrictions)],reasons,quality,platformVerified:false,
  key:hasConditions?createHash('sha256').update(signature).digest('hex').slice(0,16):'',evidence:text};
}
export const PURCHASE_STATES=Object.freeze([{key:'all',label:'还不确定'},{key:'new',label:'新开订阅'},{key:'renewal',label:'给已有订阅续费'}]);
export function matchesPurchase(conditions,state){return state==='all'||!state||conditions?.accountState===state||conditions?.accountState==='both';}
