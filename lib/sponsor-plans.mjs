// Prices are site-owned introductory offers, not market-rate or ROI claims.
export const SPONSOR_RATE_VERSION='2026-09-09';
export const SPONSOR_CAPACITY=4;
export const SPONSOR_THEMES=Object.freeze([{key:'amber',label:'暖橙'},{key:'blue',label:'晴蓝'},{key:'violet',label:'浅紫'},{key:'green',label:'青绿'}]);
export const SPONSOR_PLANS=Object.freeze([
 {key:'product',placement:'sponsored_product',label:'产品页',description:'指定产品的当页报价与分页之后',prices:{'7d':99,'14d':179,'28d':329}},
 {key:'category',placement:'sponsored_category',label:'分类页',description:'指定分类的产品列表之后',prices:{'7d':199,'14d':359,'28d':659}},
 {key:'home',placement:'sponsored_home',label:'首页',description:'首页产品导航和分类内容之后',prices:{'7d':299,'14d':539,'28d':999}},
]);
export const sponsorPlan=key=>SPONSOR_PLANS.find(p=>p.key===key||p.placement===key);
export function sponsorQuote(key,duration){const plan=sponsorPlan(key),amount=plan?.prices[duration];return amount==null?null:{amount,currency:'CNY',days:Number(duration.replace('d','')),duration,placement:plan.key,version:SPONSOR_RATE_VERSION};}
export function sponsorError(message,status=422){return Object.assign(new Error(message),{status});}
