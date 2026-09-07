import { projectProduct } from './quote-policy.mjs';
import { buildProductDirectory, directoryQuotes } from './product-directory.mjs';
import { merchantIdentityForOffer } from './merchant-identity.mjs';
import { queueMerchantMail } from './merchant-mail.mjs';

// Approval and a successful preflight are NOT publication. Require a committed
// public snapshot, the public directory's own filters, and a fresh successful
// exact-shop collection after this approval. No third-party provenance counts.
export function reconcileMerchantPublication(privateDb, publicDb, {now=new Date()}={}) {
  if(!publicDb)return {queued:0};
  let observed=[];
  publicDb.exec('BEGIN');
  try {
    const health=JSON.parse(publicDb.prepare("SELECT value FROM meta WHERE key='health:merchant-onboarding'").get()?.value||'{}');
    if(health.manifestValid!==true)return {queued:0};
    const snapshot=publicDb.prepare("SELECT * FROM snapshots WHERE source='direct-shops' ORDER BY fetched_at DESC,rowid DESC LIMIT 1").get();
    if(!snapshot)return {queued:0};
    const products=publicDb.prepare("SELECT * FROM products WHERE source='direct-shops' AND snapshot_id=?").all(snapshot.snapshot_id)
      .map(p=>projectProduct(publicDb,'direct-shops',snapshot,p,{now:+now}));
    const categories=buildProductDirectory([{source:'direct-shops',fetchedAt:snapshot.fetched_at,stale:!!snapshot.stale,products}]);
    const targets=new Map((health.targets||[]).map(t=>[t.identity,t]));
    for(const category of categories)for(const product of category.products)for(const {offer} of directoryQuotes(product).entries) {
      const identity=merchantIdentityForOffer(offer), target=targets.get(identity);
      const at=Date.parse(offer.captured_at||snapshot.fetched_at),checked=Date.parse(target?.lastSuccess);
      if(identity&&target?.status==='active'&&Number.isFinite(at)&&Number.isFinite(checked)&&at<=+now+60000&&checked<=+now+60000&&+now-checked<=86400000) observed.push({identity,at,checked});
    }
  } finally {publicDb.exec('ROLLBACK');}
  let queued=0;
  privateDb.exec('BEGIN IMMEDIATE');
  try {
    for(const app of privateDb.prepare("SELECT * FROM merchant_applications WHERE status='approved' AND email IS NOT NULL").all()) {
      const approved=Date.parse(app.approved_at);
      if(!Number.isFinite(approved)||!observed.some(o=>o.identity===app.identity&&o.at>=approved&&o.checked>=approved))continue;
      queued+=Number(queueMerchantMail(privateDb,{id:app.public_id,email:app.email,stage:'published',eventKey:app.public_id+':published:'+app.approved_at,now}));
    }
    privateDb.exec('COMMIT');
  }catch(error){if(privateDb.isTransaction)privateDb.exec('ROLLBACK');throw error;}
  return {queued};
}
