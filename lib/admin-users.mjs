// Read-only reporting over existing private tables. No schema changes, credentials,
// session material, delivery payloads, or inferred email-to-merchant ownership.
const DAY=86400000;
const day=value=>new Date(+new Date(value)+8*3600000).toISOString().slice(0,10);
const midnight=value=>new Date(value+'T00:00:00+08:00').toISOString();
const tables=db=>new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
const count=(db,known,table,where='',args=[])=>known.has(table)
  ?Number(db.prepare(`SELECT COUNT(*) n FROM ${table}${where}`).get(...args).n):null;

export function readAdminOverview(db,{now=new Date(),days=7}={}){
  const known=tables(db);
  if(!known.has('retention_accounts'))return {available:false};
  days=Number(days)===30?30:7;
  const today=day(now),stamp=new Date(now).toISOString();
  const start=n=>midnight(day(+new Date(now)-(n-1)*DAY));
  const recent=n=>count(db,known,'retention_accounts',' WHERE created_at>=? AND created_at<=?',[start(n),stamp]);
  const registrations=db.prepare(`SELECT date(created_at,'+8 hours') day,COUNT(*) count FROM retention_accounts WHERE created_at>=? AND created_at<=? GROUP BY day`).all(start(days),stamp);
  const byDay=new Map(registrations.map(r=>[r.day,Number(r.count)]));
  let pendingMerchants=count(db,known,'merchant_applications'," WHERE status='pending'");
  // Match the existing review queue: transferred supply intakes must not count twice.
  if(pendingMerchants!==null&&known.has('merchant_supply_intake')){
    if(!known.has('cooperation_submissions')||!known.has('merchant_submission_links'))pendingMerchants=null;
    else pendingMerchants+=Number(db.prepare(`SELECT COUNT(*) n FROM merchant_supply_intake i JOIN cooperation_submissions s ON s.public_id=i.source_submission_id WHERE i.status='pending' AND NOT EXISTS(SELECT 1 FROM merchant_submission_links l WHERE l.source_submission_id=i.source_submission_id)`).get().n);
  }
  return {
    available:true,days,checkedAt:stamp,today,
    accounts:{total:count(db,known,'retention_accounts'),today:recent(1),last7:recent(7),last30:recent(30)},
    series:Array.from({length:days},(_,i)=>{const date=day(+new Date(now)-(days-1-i)*DAY);return {day:date,count:byDay.get(date)||0};}),
    pendingMerchants,
    approvedApplications:count(db,known,'merchant_applications'," WHERE status='approved'"),
    pendingReviews:count(db,known,'shop_reviews'," WHERE status='pending'"),
    publishedReviews:count(db,known,'shop_reviews'," WHERE status='published'"),
    pendingFeedback:count(db,known,'feedback_submissions'," WHERE status='new'"),
    merchantAccounts:known.has('merchant_applications')?Number(db.prepare('SELECT COUNT(*) n FROM retention_accounts a WHERE EXISTS(SELECT 1 FROM merchant_applications m WHERE m.applicant_account_id=a.id)').get().n):null,
    followingAccounts:known.has('retention_watches')?Number(db.prepare('SELECT COUNT(DISTINCT w.account_id) n FROM retention_watches w JOIN retention_accounts a ON a.id=w.account_id').get().n):null,
  };
}

function accountProjection(known){
  const scalar=(table,sql)=>known.has(table)?sql:'NULL';
  return `a.id,a.email,a.created_at createdAt,a.email_enabled emailEnabled,
    ${scalar('reader_credentials','EXISTS(SELECT 1 FROM reader_credentials c WHERE c.account_id=a.id)')} hasPassword,
    ${scalar('reader_google_identities','EXISTS(SELECT 1 FROM reader_google_identities g WHERE g.account_id=a.id)')} hasGoogle,
    ${scalar('merchant_applications','(SELECT COUNT(*) FROM merchant_applications m WHERE m.applicant_account_id=a.id)')} applicationCount,
    ${scalar('retention_watches','(SELECT COUNT(*) FROM retention_watches w WHERE w.account_id=a.id)')} watchCount,
    ${scalar('shop_reviews',"(SELECT COUNT(*) FROM shop_reviews r WHERE r.account_id=a.id AND r.status!='erased')")} reviewCount`;
}

export function listAdminUsers(db,{q='',role='',login='',page=1}={}){
  const known=tables(db);
  if(!known.has('retention_accounts'))return {available:false};
  q=String(q||'').trim().slice(0,254);
  role=['merchant','reader'].includes(role)?role:'';
  login=['google','password','email_only'].includes(login)?login:'';
  const clauses=[],args=[];
  // instr rather than LIKE: percent/underscore in an email are literal characters.
  if(q){clauses.push('instr(lower(a.email),lower(?))>0');args.push(q);}
  if(role){clauses.push(known.has('merchant_applications')?`${role==='reader'?'NOT ':''}EXISTS(SELECT 1 FROM merchant_applications m WHERE m.applicant_account_id=a.id)`:'0');}
  if(login){
    const password=known.has('reader_credentials')?'EXISTS(SELECT 1 FROM reader_credentials c WHERE c.account_id=a.id)':'NULL';
    const google=known.has('reader_google_identities')?'EXISTS(SELECT 1 FROM reader_google_identities g WHERE g.account_id=a.id)':'NULL';
    clauses.push(login==='password'?password:login==='google'?google:`NOT (${password}) AND NOT (${google})`);
  }
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=Number(db.prepare(`SELECT COUNT(*) n FROM retention_accounts a${where}`).get(...args).n);
  const pageSize=20,pages=Math.max(1,Math.ceil(total/pageSize));
  page=Math.max(1,Math.min(pages,Math.floor(Number(page))||1));
  const items=db.prepare(`SELECT ${accountProjection(known)} FROM retention_accounts a${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  return {available:true,q,role,login,page,pages,pageSize,total,items};
}

export function readAdminUser(db,id){
  const known=tables(db);
  if(!known.has('retention_accounts'))return null;
  const account=db.prepare(`SELECT ${accountProjection(known)} FROM retention_accounts a WHERE a.id=?`).get(id);
  if(!account)return null;
  const rows=(table,sql)=>known.has(table)?db.prepare(sql).all(id):null;
  return {...account,
    applications:rows('merchant_applications','SELECT public_id id,shop_name name,status,created_at createdAt FROM merchant_applications WHERE applicant_account_id=? ORDER BY created_at DESC,id DESC LIMIT 20'),
    watches:rows('retention_watches','SELECT product_key product,mode,paused,created_at createdAt FROM retention_watches WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 20'),
    reviews:rows('shop_reviews',"SELECT id,shop_name name,status,rating,submitted_at createdAt FROM shop_reviews WHERE account_id=? AND status!='erased' ORDER BY submitted_at DESC,id DESC LIMIT 20"),
  };
}
