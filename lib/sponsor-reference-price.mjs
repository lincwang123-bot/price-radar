import {safeMerchantUrl,WEBSITE_SPONSOR_SOURCE} from './outbound.mjs';
import {merchantIdForUrl} from './offer-provenance.mjs';
import {quoteStale} from './quote-policy.mjs';
import {publicOfferAllowed} from './public-offers.mjs';
import {offerSpec} from './offer-spec.mjs';

const MAX_AGE=24*3600000,FUTURE_TOLERANCE=5*60000;
const extraOf=o=>{try{return typeof o.extra==='string'?JSON.parse(o.extra):o.extra||{};}catch{return {};}};

// Optional display data only. Never replace the campaign's destination,
// accounting identity, availability or scheduled lifetime with a market quote.
export function sponsorReferenceFromOffers(c,offers,{now=Date.now()}={}){
 const target=safeMerchantUrl(c?.destination_url);
 if(!target||c.source===WEBSITE_SPONSOR_SOURCE||merchantIdForUrl(target)!==c.merchant_id)return null;
 const matches=offers.filter(o=>o.source===c.source&&safeMerchantUrl(o.url)===target&&(!o.merchant_id||o.merchant_id===c.merchant_id));
 // One URL can occasionally represent several variants; do not guess a price.
 if(matches.length!==1)return null;
 const o=matches[0],price=Number(o.price),verified=Date.parse(o.last_verified_at||o.captured_at||''),captured=Date.parse(o.captured_at||o.last_verified_at||''),evidence=extraOf(o).quoteHealth;
 const maxAge=Math.min(MAX_AGE,Number(evidence?.maxAgeMinutes||1440)*60000),expiry=Date.parse(o.expires_at||'');
 if(o.price==null||!Number.isFinite(price)||price<=0||!Number.isFinite(maxAge)||maxAge<=0||!Number.isFinite(verified)||!Number.isFinite(captured)||!Number.isFinite(now))return null;
 if(!/^[A-Z]{3}$/.test(o.currency||'')||o.quote_stale||evidence&&!['ok','cached'].includes(evidence.status)||!publicOfferAllowed(c.source,o))return null;
 if(Math.max(verified,captured)>now+FUTURE_TOLERANCE||now-Math.min(verified,captured)>=maxAge||Number.isFinite(expiry)&&expiry<=now)return null;
 const term=offerSpec(o).key.split(':')[0];
 const period=term==='1m'?'／月':/^\d+m$/.test(term)?'／'+parseInt(term)+'个月':/^\d+d$/.test(term)?'／'+parseInt(term)+'天':'';
 return {price,currency:o.currency,verifiedAt:new Date(verified).toISOString(),validUntil:Math.min(verified+maxAge,captured+maxAge,Number.isFinite(expiry)?expiry:Infinity),period};
}

export function loadSponsorReferencePrice(db,c,{now=Date.now()}={}){
 if(!db||c?.source===WEBSITE_SPONSOR_SOURCE)return null;
 try{
  const latest=db.prepare('SELECT * FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(c.source);
  if(!latest)return null;
  const at=Date.parse(latest.fetched_at);if(!Number.isFinite(at)||now-at>=MAX_AGE||at-now>FUTURE_TOLERANCE)return null;
  const offers=db.prepare('SELECT * FROM offers WHERE source=? AND snapshot_id=? AND url=?').all(c.source,latest.snapshot_id,safeMerchantUrl(c.destination_url));
  if(offers.length!==1||quoteStale(db,c.source,latest,offers[0],{now}))return null;
  return sponsorReferenceFromOffers(c,offers,{now});
 }catch{return null;} // A missing/failed price lookup must not remove an ad.
}
