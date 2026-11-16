// Explicit product-title evidence only. Never infer a subscription tier from
// the offer's selling price, a balance amount, credits, or a parent search term.
export function hasPro25xTitle(value){
 const title=String(value||'').normalize('NFKC').toLowerCase().replace(/[×✕✖]/g,'x');
 if(/(?<![\d.])500\s*(?:\$|美元|美金|美刀|刀|usd)?\s*(?:额度|积分|点数|余额|credits?\b)/.test(title))return false;
 // Slash menus that also list 100/200 are not a dedicated Pro 500 / 25x title.
 if(/(?<![\d.])100\s*\/\s*200(?:\s*\/\s*500)?/.test(title))return false;
 // Multi-tier menus that also list a 100 tier beside 500 (slash or spaced) are not a dedicated Pro 500 / 25x title.
 if(/(?<![\d.])100\b/.test(title) && /(?<![\d.])500\b/.test(title) && /档/.test(title))return false;
 return /(?<![\d.])25\s*(?:x(?![a-z\d.])|倍)|(?<![a-z\d.])x\s*25(?![\d.])/.test(title)
  || /\bpro\s*(?:max\s*)?(?:\$\s*|usd\s*)?500(?![\d.]|\s*(?:元|积分|点|credits?\b|cny\b|rmb\b))(?=$|\s|\$|美元|美金|美刀|刀|档|套餐|月|年)/.test(title)
  // Some shops retain the older 50X label. The named USD 500 plan is
  // required as well; 50X alone or a numeric selling price is insufficient.
  || /(?<![\d.])50\s*x(?![a-z\d.])/.test(title)&&/(?<![\d.])500\s*(?:美元|美金|美刀|刀|usd\b|\$)/.test(title)
  || /(?<![\d.])500\s*(?:美元|美金|刀|usd)\s*(?:档|套餐)/.test(title);
}
