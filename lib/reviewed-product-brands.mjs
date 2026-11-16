import { plusCoverageOnly } from './plus-coverage.mjs';

// Operator confirmation:
// these exact S678924 listings are ChatGPT subscriptions. Bind to both the
// shop and the observed product/title; never infer a brand from bare Plus/Pro
// elsewhere. Renames keep the binding only while the title still matches the
// reviewed spec (see reviewedSpecConflict below).
const xiaobaiChatgpt = new Map([
  ['G70188866','plus 月卡|官方直充自己账号|保订阅不包封号|菲区 可囤'],
  ['G49190071','PRO 5X官方充值月卡(质保一个月) 自动发货-(24小时全自动充值)'],
  // 2026-11-05 operator approval: G66979862 renamed to "PRO 10X 200$ …" (live
  // goods/detail, ¥1200). Keep it on Pro 20x; the $200 price is the tier basis.
  ['G66979862','PRO 10X 200$ 官方充值月卡(质保30天) 24小时全自动充值 直冲个人账号 -全自动发货-可开票-可自助升级'],
]);
// Follow-up review: this exact ai跑起来 listing has the same Plus recharge
// wording and its own description explicitly names the Go / Plus / Pro tiers.
const confirmedChatgpt = new Map([
  // Operator confirmation:
  // only these S878919 listings are GPT products. This confirms product brand,
  // not the applicant's email, ownership or merchant identity. Bound by goods
  // id; the title below is the reviewed reference.
  // 2026-11-02: G30720814's live title now says "G pro 100 5x" (goods still
  // G30720814). The previous "G pro5x" string is no longer the listing.
  // 2026-11-05: seller appended a literal " #039" to G30720814's title
  // (confirmed via public goods/detail); rebind to that exact live string.
  ['S878919', new Map([
    ['G40240306','IOS 【质保30天】 PLUS 订阅 官方充值 免排队 秒充(1-10分钟到账)（可屯卡）'],
    // “可覆盖plus”是覆盖已有订阅的能力说明，不是改档。
    ['G30720814','【美区IOS】质保30天（可覆盖plus）G pro 100 5x 订阅 官方充值 免排队 秒充 可开票 有ios官方账单 #039'],
    ['G96954851','【美区IOS】质保30天（可覆盖）G pro 20x 订阅 官方充值 免排队 秒充(5-10分钟到账)'],
    ['G65523543','ios正规plus年卡全程质保'],
  ])],
  // 2026-10-10, verified original applicant reply, round 21. Exact listing only.
  ['S557522', new Map([
    // 2026-11-05: live title now 100元 with a prefix (public goods/detail).
    ['G54457093','【可续费且随时上车】Business独立席位｜100元/月｜全程质保·售后无忧'],
  ])],
  // 2026-09-25: exact AI源头 listing; its own product image names ChatGPT Pro
  // 20X and its description says GTP recharge. Do not generalize bare PRO.
  ['S686646', new Map([
    ['G75387439','PRO 20X官方充值月卡(全程质保) 24小时全自动充值（支持续费和新开） ---自动发货 ----仅支持之前充值过pro20的账号'],
  ])],
  ['S678924', xiaobaiChatgpt],
]);

// 2026-11-05 operator approval: bind by stable shop + goods id instead of the
// exact title, so a seller's cosmetic rename (e.g. appending " #039") does not
// drop a reviewed listing. The reviewed title is kept as the reference; each
// goods id also carries the reviewed spec. If the live title contradicts that
// spec (another tier, another brand, or another term), the listing is NOT
// bound and is logged as pending review — a seller may reuse a goods id for a
// different product.
// 2026-11-05: removed G65081818, G60886382, G62568146 (S678924) and G71033192
// (S704668, shop now has no reviewed listing) - public goods/detail returned
// code 0 "商品不存在" for each, i.e. delisted at the original shop.
const reviewedSpecs=new Map([
  ['G70188866',{tier:'plus',term:'month'}],
  ['G49190071',{tier:'pro5x',term:'month'}],
  // Seller labels this $200 plan "10X"; only for this id, a literal 200$ in
  // the title is the tier evidence and the 10X label is not a conflict.
  ['G66979862',{tier:'pro20x',term:'month',dollarTier:/(?<![\d.])200\s*\$|\$\s*200(?![\d.])/,ignoreWithDollar:'pro-other'}],
  ['G40240306',{tier:'plus',term:'month'}],['G30720814',{tier:'pro5x',term:'month'}],
  ['G96954851',{tier:'pro20x',term:'month'}],['G65523543',{tier:'plus',term:'year'}],
  ['G54457093',{tier:'business',term:'month'}],['G75387439',{tier:'pro20x',term:'month'}],
]);
const otherBrand=/claude|cladue|克劳德|gemini|google|grok|cursor|midjourney|\bmj\b|kimi|deepseek|perplexity|copilot|windsurf|suno|poe\b|豆包|通义|文心|apple\s*music|netflix|spotify|youtube|奈飞/i;
function titleTiers(title){
  const t=title.toLowerCase(),tiers=new Set();
  if(/plus/.test(t)&&!plusCoverageOnly(t))tiers.add('plus');
  if(/(?<![\d.])20\s*x|x\s*20(?!\d)/.test(t))tiers.add('pro20x');
  if(/(?<![\d.])5\s*x|x\s*5(?![\d.])/.test(t))tiers.add('pro5x');
  if(/(?<![\d.])(?:2|10|25)\s*x(?![a-z])/.test(t))tiers.add('pro-other');
  if(/business|team|团队|企业/.test(t))tiers.add('business');
  if(/\bgo\b/.test(t))tiers.add('go');
  if(/\bpro\b|pro\d/.test(t)&&!tiers.has('pro5x')&&!tiers.has('pro20x'))tiers.add('pro-unspecified');
  return tiers;
}
export function reviewedSpecConflict(goods,title){
  const spec=reviewedSpecs.get(goods);
  if(!spec)return 'no reviewed spec for goods id';
  if(typeof title!=='string'||!title.trim())return 'empty title';
  if(otherBrand.test(title))return 'title names another brand';
  const tiers=titleTiers(title);
  if(spec.dollarTier?.test(title)&&!tiers.has('pro5x')){tiers.add(spec.tier);tiers.delete(spec.ignoreWithDollar);tiers.delete('pro-unspecified');}
  if(!tiers.has(spec.tier))return `reviewed tier ${spec.tier} missing from title`;
  const others=[...tiers].filter(x=>x!==spec.tier);
  if(others.length)return `title also names tier ${others.join('/')}`;
  if(spec.term==='month'&&/年卡|年付|年费|包年|一年|12\s*个?月|365\s*天/.test(title))return 'reviewed monthly listing now says yearly';
  if(spec.term==='year'&&/月卡|包月|月付/.test(title))return 'reviewed yearly listing now says monthly';
  return null;
}
const pendingLogged=new Set();
function logPending(shopNo,goods,title,reason){
  const key=`${shopNo}|${goods}|${title}`;
  if(pendingLogged.has(key))return;
  pendingLogged.add(key);
  if(pendingLogged.size>5000)pendingLogged.clear();
  console.warn(`[reviewed-binding] pending review ${shopNo}/${goods}: ${reason}; title=${JSON.stringify(String(title).slice(0,200))}`);
}

export function reviewedBinding(offer={}) {
  if (offer.source && offer.source !== 'direct-shops') return null;
  try {
    const extra=typeof offer.extra==='string'?JSON.parse(offer.extra):offer.extra||{};
    const product=new URL(offer.url),shop=new URL(extra.shopUrl);
    const validHost=url=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash
      &&['www.16688.com.cn','16688.com.cn'].includes(url.hostname);
    if(!validHost(product)||!validHost(shop)||!confirmedChatgpt.has(extra.shopNo)||shop.pathname.replace(/\/$/,'')!==`/shop/${extra.shopNo}`)return null;
    const goods=/^\/goods\/(G\d+)$/.exec(product.pathname)?.[1];
    const reviewedTitle=goods&&confirmedChatgpt.get(extra.shopNo).get(goods);
    if(!reviewedTitle)return null;
    if(offer.title===reviewedTitle)return {status:'bound',brand:'chatgpt',shopNo:extra.shopNo,goods};
    const reason=reviewedSpecConflict(goods,offer.title);
    if(reason){logPending(extra.shopNo,goods,offer.title,reason);return {status:'pending',reason,shopNo:extra.shopNo,goods};}
    return {status:'bound',brand:'chatgpt',shopNo:extra.shopNo,goods,renamed:true};
  } catch { return null; }
}

export function reviewedProductBrand(offer={}) {
  const binding=reviewedBinding(offer);
  return binding?.status==='bound'?binding.brand:null;
}

export const reviewedGoodsIds=()=>[...confirmedChatgpt].flatMap(([shopNo,items])=>[...items].map(([goods,title])=>({shopNo,goods,title,...reviewedSpecs.get(goods)})));
