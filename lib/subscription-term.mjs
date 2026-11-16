// Subscription time is independent of redemption, storage and warranty windows.
// Parse a complete duration token; unsupported numerals must never fall back to
// a suffix such as the “5个月” inside “1.5个月”, or the bare 年 inside 半年.
const number = String.raw`(?:\d+(?:\.\d+)?|\.\d+|[零〇一二两三四五六七八九十百千万点]+|半)`;
const duration = String.raw`${number}\s*(?:个\s*)?(?:个月|月|年|天|日|小时|days?|months?|years?)`;
const dayWindow = String.raw`${number}\s*(?:[-~至]\s*${number}\s*)?(?:天|日)`;
const numeralChars = '零〇一二两三四五六七八九十百千万半点';

function positiveInteger(token) {
  if (/^\d+$/.test(token)) {
    const n=Number(token);return Number.isSafeInteger(n)&&n>0?n:null;
  }
  const digits={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  if (digits[token]) return digits[token];
  const tens=/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(token);
  return tens?(digits[tens[1]]||1)*10+(digits[tens[2]]||0):null;
}

function withoutNonSubscriptionWindows(text) {
  return text
    .replace(new RegExp(`(?:卡密)?(?:兑换|激活|核销)(?:码)?(?:有效期|期限|时限|期)?\\s*[:：]?\\s*${duration}(?:以内|内)?|${duration}\\s*(?:以内|内)\\s*(?:兑换|激活|核销)`,'gi'),' ')
    .replace(new RegExp(`(?:只能|可以|可|最多|允许|支持)?\\s*囤(?:卡|货)?(?:有效期|期限|时限)?\\s*(?:[:：]|不超过|最多)?\\s*${duration}`,'gi'),' ')
    .replace(new RegExp(`(?:质保|保修|售后|warranty)(?:订阅)?\\s*(?:期限|时长|期)?\\s*[:：]?\\s*${duration}|${duration}\\s*(?:质保|保修|售后|warranty)`,'gi'),' ')
    .replace(/(?:永久|终身)(?:质保|售后)|(?:质保|售后)(?:永久|终身)/g,' ')
    .replace(new RegExp(`${dayWindow}\\s*(?:以内|内)\\s*(?:即将)?(?:到期|过期)|(?:剩余|还剩|余期|到期前|过期前)\\s*${dayWindow}(?:\\s*(?:以内|内))?`,'g'),' ')
    .replace(new RegExp(`提前\\s*${dayWindow}\\s*(?:预约|预定|预订|下单|续费|充值|购买)|${dayWindow}\\s*(?:以内|内|后)\\s*(?:发货|到账|处理|完成|开通)`,'g'),' ')
    .replace(new RegExp(`(?:超过|超|退款|不退|保障|保证|保)\\s*${number}\\s*(?:天|日)`,'g'),' ')
    .replace(new RegExp(`(?:差不多|大概|大约|预计|估计|可能|约|about\\s+|around\\s+)\\s*${duration}(?:以内|内|左右)?|${duration}\\s*(?:以内|内|左右|上下|不保证|不打包票)`,'gi'),' ');
}

export function subscriptionTerm(value) {
  let text=withoutNonSubscriptionWindows(String(value||'').normalize('NFKC').toLowerCase())
    .replace(/(?<![\d.])30\s*(天|日)\s*月卡/g,'30$1')
    .replace(/(?:卡密|兑换码|激活码|\bcdk)\s*永久有效/g,' ');
  if (/永久|终身|lifetime|全家桶|多合一|组合套餐|套餐组合|任选|二选一|三选一|买\s*\d+\s*送\s*\d+|月年卡|月\/年/.test(text)
      || new RegExp(`${number}\\s*[/、~\\-至]\\s*${number}\\s*(?:个)?(?:月|年|天|日)`).test(text)) return 'ambiguous';
  const periods=new Set();let unsupported=false;
  const add=(token,unit,half)=>{
    if(token==='半'&&unit==='年'&&!half){periods.add('6m');return;}
    const n=positiveInteger(token);
    if(n===null||half){unsupported=true;return;}
    periods.add(`${n*(unit==='年'||unit.startsWith('year')?12:1)}${unit==='天'||unit==='日'||unit.startsWith('day')?'d':'m'}`);
  };
  text=text.replace(new RegExp(`(?<![\\d.${numeralChars}])(${number})\\s*(?:个\\s*)?(月|年|天|日)(半)?(?:卡)?`,'g'),(_match,n,unit,half)=>{add(n,unit,half);return ' ';});
  text=text.replace(/(?<![a-z\d.])(\d+(?:\.\d+)?|\.\d+)\s*(months?|years?|days?)\b/g,(_match,n,unit)=>{add(n,unit);return ' ';});
  // An unqualified 月卡/年卡 is explicit, while bare units within another
  // word (“今年”, “年月”) are not evidence of a purchased period.
  for(const match of text.matchAll(new RegExp(`(?<![\\d.${numeralChars}个壹贰叁肆伍陆柒捌玖拾佰仟萬])(?:月(?:卡|付|费|度|订阅|会员)|年(?:卡|付|费|度|订阅|会员)|季(?:卡|付|费|度)|(?:包|每|单)(月|年))`,'g')))periods.add(match[0].includes('年')?'12m':match[0].includes('季')?'3m':'1m');
  for(const match of text.matchAll(/(?:^|[\s([（【·|/])(月|年)(?=$|[\s)\]）】·|/])/g))periods.add(match[1]==='年'?'12m':'1m');
  if(/\bmonthly\b/.test(text))periods.add('1m');
  if(/\bannual(?:ly)?\b|\byearly\b/.test(text))periods.add('12m');
  if(unsupported)return periods.size?'ambiguous':'unknown';
  return periods.size===1?[...periods][0]:periods.size>1?'ambiguous':'unknown';
}
