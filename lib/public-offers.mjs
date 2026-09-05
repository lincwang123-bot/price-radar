import {directOfferExclusionReason} from '../collectors/direct/catalog.mjs';
export const SHOP_SOURCES=new Set(['direct-shops','priceai','ldxp-goods']);
export function publicOfferAllowed(source,offer){return !SHOP_SOURCES.has(source)||!directOfferExclusionReason({...offer,stockCount:offer.stock_count??offer.stockCount});}
