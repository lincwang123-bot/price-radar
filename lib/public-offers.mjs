import {directOfferExclusionReason} from '../collectors/direct/catalog.mjs';
import {merchantOfferBlocked} from './merchant-blocklist.mjs';
import {retiredCatalogItem} from './catalog-policy.mjs';
export const SHOP_SOURCES=new Set(['direct-shops','priceai','ldxp-goods']);
export function publicOfferAllowed(source,offer,product={}){return !retiredCatalogItem(product)&&!retiredCatalogItem(offer)&&!merchantOfferBlocked(offer)&&(!SHOP_SOURCES.has(source)||!directOfferExclusionReason({...offer,stockCount:offer.stock_count??offer.stockCount}));}
