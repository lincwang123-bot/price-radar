// 商品标题是报价粒度的证据；目录 ID、质保与分类名不能替代 SKU 期限。
export function offerSpec(offer, product = {}) {
  const title = String(offer.title || '').normalize('NFKC').toLowerCase();
  const units = [...title.matchAll(/(?:\d+|十二|一|二|两|三|六)\s*(?:张|份|套|枚|人|席位|个账号|个号|个账户|个卡密|accounts?|seats?)|\d+(?:\.\d+)?\s*(?:tb|gb|credits?|积分|额度)/g)].map(m=>m[0].replace(/\s/g,'')).sort().join(',');
  const unresolvedBundle = /永久|终身|lifetime|全家桶|多合一|组合套餐|套餐组合|任选|二选一|三选一|买\s*\d+\s*送\s*\d+|月年卡|月\/年|\d+\s*[/、~\-至]\s*\d+\s*(?:个)?(?:月|年|天|日)/.test(title.replace(/(?:永久|终身)(?:质保|售后)|(?:质保|售后)(?:永久|终身)/g,''));
  const freeAccount = /(?:免费(?:版|账号)|普号|白号|\bfree\b)/.test(title) && !/plus|\bpro\b|premium|ultra|\bmax\b|代充|直充|充值|赠送/.test(title);
  const subscription = /chatgpt|gpt|claude|gemini|grok|premium|cursor|perplexity|notion|suno/i.test(`${title} ${product.product_id || product.id || ''}`) && !/api|额度|积分|接码|邮箱|辅助服务|activation-service|claim-link|verification-service|email-accounts|(?:^|-)free(?:-|$)/.test(`${product.product_type || product.productType || ''} ${product.product_id || product.id || ''}`) && !freeAccount;
  if (!subscription) return { key: `other:${freeAccount?'free-account:':''}${units}:${offer.currency || product.currency || '币种未注明'}`, label: unresolvedBundle?'组合或永久权益待确认':units, known: !unresolvedBundle };
  const clean = title.replace(/(?:质保|保修|售后|warranty)\s*(?:期)?\s*(?:\d+|十二|一|二|两|三|六)\s*(?:个)?\s*(?:个月|月|年|天|日|days?|months?|years?)/g, '').replace(/(?:\d+|十二|一|二|两|三|六)\s*(?:个)?\s*(?:天|日|个月|月|年)\s*(?:质保|保修|售后)/g, '').replace(/(?:囤卡|超过|超|退款|不退|保障|保证|保)\s*\d+\s*(?:天|日)/g,'');
  const nums = { 一:1, 二:2, 两:2, 三:3, 六:6, 十二:12 };
  const periods = new Set();
  for (const m of clean.matchAll(/(\d+|十二|一|二|两|三|六)?\s*(?:个)?(月|年)(?:卡)?/g)) periods.add(`${(nums[m[1]] || Number(m[1] || 1)) * (m[2] === '年' ? 12 : 1)}m`);
  for (const m of clean.matchAll(/(\d+|十二|一|二|两|三|六)\s*(天|日)(?:卡)?/g)) periods.add(`${nums[m[1]] || Number(m[1])}d`);
  for (const m of clean.matchAll(/\b(\d+)\s*(months?|years?|days?)\b/g)) periods.add(`${Number(m[1]) * (m[2].startsWith('year') ? 12 : 1)}${m[2].startsWith('day') ? 'd' : 'm'}`);
  if (/\bmonthly\b/.test(clean)) periods.add('1m');
  if (/\bannual(?:ly)?\b|\byearly\b/.test(clean)) periods.add('12m');
  const term = unresolvedBundle ? 'ambiguous' : periods.size === 1 ? [...periods][0] : periods.size > 1 ? 'ambiguous' : 'unknown';
  const form = /共享|合租|拼车|镜像/.test(title) ? '共享' : /成品|账号|独享号/.test(title) ? '成品账号' : /席位|车位/.test(title) ? '席位' : /代充|直充|充值/.test(title) ? '代充' : /卡密|cdk|兑换/.test(title) ? '卡密' : '交付未注明';
  const variant = /试用|体验|trial|日抛|周抛/.test(title) ? '试用/短期' : /教育|学生|student|education/.test(title) ? '教育优惠' : '常规';
  const aliases={美区:'美国',美国:'美国',菲区:'菲律宾',菲律宾:'菲律宾',土区:'土耳其',土耳其:'土耳其',印区:'印度',印度:'印度',尼区:'尼日利亚',尼日利亚:'尼日利亚',港区:'香港',香港:'香港',日区:'日本',日本:'日本',国区:'中国',中国:'中国',全球:'全球'};
  const regions = new Set([...title.matchAll(/美区|美国|菲区|菲律宾|土区|土耳其|印区|印度|尼区|尼日利亚|港区|香港|日区|日本|全球|国区|中国/g)].map(m=>aliases[m[0]]));
  const region=[...regions].sort().join(',');
  const tier = /(?:20\s*x|x\s*20)/.test(title)?'20x':/(?:5\s*x|x\s*5)/.test(title)?'5x':/premium\s*(?:\+|plus)/.test(title)?'premium+':/pro\s*(?:\+|plus)/.test(title)?'pro+':/ultra/.test(title)?'ultra':/heavy/.test(title)?'heavy':/\bpremier\b/.test(title)?'premier':/\bmax\b/.test(title)?'max':/\bpro\b/.test(title)?'pro':/plus/.test(title)?'plus':/premium/.test(title)?'premium':'';
  const label = `${term === 'unknown' ? '期限未注明' : term === 'ambiguous' ? '期限/组合待确认' : term.replace('m',' 个月').replace('d',' 天')} · ${form}${variant==='常规'?'':` · ${variant}`}${region?` · ${region}`:''}${units?` · ${units}`:''}`;
  return { key: `${term}:${tier}:${form}:${variant}:${region || '地区未注明'}:${units || '单位未注明'}:${offer.currency || product.currency || '币种未注明'}`, label, known: !['unknown','ambiguous'].includes(term) && regions.size <= 1 };
}
