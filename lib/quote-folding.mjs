// Presentation only: do not merge merchants, prices, samples or history.
// Fold within the already sorted page so filters and pagination stay stable.
export function foldQuoteEntries(entries) {
  const groups=[],byKey=new Map();
  for(const entry of entries){
    const o=entry.offer,title=String(o.title||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const eligible=!entry.reference&&o.comparison_known===true&&o.comparison_eligible===true&&title&&o.comparison_key;
    const key=eligible?JSON.stringify([title,o.comparison_key,o.currency||entry.product.currency,entry.rechargeMethod?.kind||'']):null;
    let group=key&&byKey.get(key);
    if(!group){group={entry,alternatives:[]};groups.push(group);if(key)byKey.set(key,group);}
    else group.alternatives.push(entry);
  }
  return groups;
}
