// Manual operator tool. No payments, merchant accounts or automatic campaign approval.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {initMerchantAnalytics} from '../lib/merchant-analytics.mjs';
import {resolveOutboundOffer} from '../lib/outbound.mjs';
const [command,analyticsPath,marketPath,inputPath,flag]=process.argv.slice(2);
let db,market;
try{
 if(!['list','put'].includes(command)||!analyticsPath||!path.isAbsolute(analyticsPath)||!existsSync(analyticsPath))throw new Error('Usage: sponsor.mjs list <absolute analytics.sqlite> | put <absolute analytics.sqlite> <absolute radar.sqlite> <campaign.json> [--approve]');
 db=new DatabaseSync(analyticsPath,{readOnly:command==='list'});db.exec('PRAGMA busy_timeout=0');
 if(command==='list')console.log(JSON.stringify(db.prepare('SELECT id,merchant_id,source,product_id,offer_id,label,placement,start_at,end_at,status,reviewed_at FROM campaigns ORDER BY start_at DESC LIMIT 200').all(),null,2));
 else{
  if(!marketPath||!path.isAbsolute(marketPath)||!existsSync(marketPath)||!inputPath||flag&&flag!=='--approve')throw new Error('Invalid campaign arguments');
  const input=JSON.parse(readFileSync(inputPath,'utf8'));market=new DatabaseSync(marketPath,{readOnly:true});
  const snapshot=market.prepare('SELECT snapshot_id FROM snapshots WHERE source=? ORDER BY fetched_at DESC,rowid DESC LIMIT 1').get(input.source);
  const offer=snapshot&&resolveOutboundOffer(market,{source:input.source,snapshot:snapshot.snapshot_id,product:input.product_id,offer:input.offer_id});
  if(!offer||offer.merchant_id!==input.merchant_id)throw new Error('Campaign must match a currently valid merchant offer');
  console.log(JSON.stringify(initMerchantAnalytics(db,'unused-cli-identity').saveCampaign(input,{approve:flag==='--approve'})));
 }
}catch(error){console.error(error.message);process.exitCode=1;}finally{market?.close();db?.close();}
