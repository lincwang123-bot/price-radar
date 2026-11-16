// Meta's personal Muse subscription, not Muse Code, Spark/API usage or a
// similarly named product. A shop category or a bare Power/Max is insufficient.
export function museSubscriptionTier(value) {
  const text=String(value??'').normalize('NFKC').toLowerCase().replace(/[_/|·:：【】()[\]（）-]+/g,' ');
  if(!/\bmuse\b/.test(text))return null;
  if(/\b(?:pro|plus|ultra|premier|basic)\b|非会员|不含\s*(?:会员|订阅)|普通账号|免费版|普号|白号|仅\s*(?:开通|订阅)?资格|资格服务|权限激活|代注册|注册服务/.test(text))return null;
  // A weekly allowance explains a subscription; sold balances/credits do not.
  if(/\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)\s*(?:额度|余额)|(?:额度|余额)\s*\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd)|(?:充值|购买|兑换)\s*\d+(?:[,.]\d+)*\s*(?:积分|点数|credits?|tokens?|额度)|(?:积分|点数|credits?)\s*(?:充值|兑换)/.test(text))return null;
  if(/\bmuse\s*(?:code|spark)\b|\bapi\b|中转|镜像|余额|积分\s*(?:充值|兑换)|(?:购买|充值|兑换)\s*(?:tokens?|点数|额度)|(?:tokens?|点数|额度)\s*(?:充值|兑换)|视频|video|hosting|全家桶|多合一|组合套餐|套餐组合|二选一|任选/.test(text))return null;
  if(/chat\s*gpt|\bgpt\b|openai|claude|cladue|gemini|google|grok|suno|cursor|perplexity|notion|manus|copilot|microsoft|midjourney|canva|adobe|\bcodex\b|\btwitter\b|\bx\s*(?:premium|basic)\b/.test(text))return null;
  const power=/\bpower\b/.test(text),max=/\bmax(?:imum)?\b/.test(text);
  return power!==max?(power?'power':'max'):null;
}

// An explicitly supplied account is its own product. Token balances never
// establish a paid plan, even when their size resembles an official allowance.
export function isMuseAccount(value) {
  const text=String(value??'').normalize('NFKC').toLowerCase().replace(/[_/|·:：【】()[\]（）-]+/g,' ');
  // A comparison note ("类似于 SuperGrok bot") is not a second product.
  const plain=text.replace(/(?:类似于?|对标)\s*super\s*grok\s*bot/g,' ');
  return /\bmuse\b/.test(plain)
    && /成品(?:账号|账户|号)|成品\s*\d+(?:\.\d+)?\s*亿|独享(?:账号|账户)|普通账号|普号|白号|\baccounts?\b/.test(plain)
    && !/\b(?:power|max(?:imum)?|pro|plus|ultra|code|spark|api)\b|中转|镜像|余额|视频|video|hosting|邀请|代刷|接码|资格|代注册|注册服务|教程|充值|兑换|全家桶|多合一|组合套餐|套餐组合/.test(plain)
    && !/chat\s*gpt|\bgpt\b|openai|claude|gemini|google|grok|suno|cursor|perplexity|notion|manus|copilot|microsoft|midjourney|canva|adobe|\bcodex\b|\btwitter\b|\bx\s*(?:premium|basic)\b/.test(plain);
}

// Split supplied accounts by one explicit token allowance. Mixed or other
// allowances (e.g. 10亿&300亿, 20亿, 50亿) stay on the generic muse-account page.
export function museAccountTokenAmounts(value){
  const text=String(value??'').normalize('NFKC').toLowerCase();
  const amounts=new Set();
  for(const m of text.matchAll(/(\d+(?:\.\d+)?)\s*亿/g))amounts.add(Number(m[1]));
  for(const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:b|billion)\b(?=\s*(?:tokens?|词元)?)/g))amounts.add(Number(m[1])*10);
  return [...amounts];
}
export function museAccountTokenTier(value){
  if(!isMuseAccount(value))return null;
  const amounts=museAccountTokenAmounts(value);
  if(amounts.length!==1)return null;
  return amounts[0]===10?'10b':[300,310].includes(amounts[0])?'300b':null;
}
