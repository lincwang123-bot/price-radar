import {loadSponsorRuntimeConfig} from './sponsor-runtime-config.mjs';
// Reviewed cross-domain promotions. Match the whole URL, never just a tracker host.
// The merchant remains the product provider, not the affiliate network.
export function reviewedSponsorDestination(destination,merchantId){
 return loadSponsorRuntimeConfig().destinations.find(d=>d.destination===destination&&(!merchantId||d.merchantId===merchantId))||null;
}
