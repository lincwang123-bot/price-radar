import {randomBytes} from 'node:crypto';
import {SubmissionError} from './submissions.mjs';

export const REVIEW_DELIVERIES={recharge:'代充',account:'成品号',shared:'共享 / 合租',key:'卡密',other:'其他'};
export const REVIEW_STATUSES={pending:'待审核',published:'已展示',rejected:'未通过',hidden:'已隐藏',withdrawn:'已撤回',erased:'已注销'};
export const REVIEW_REASONS={spam:'广告或重复灌水',fake:'疑似虚假经历',privacy:'包含隐私或敏感信息',conflict:'利益关联或诱导评价',abuse:'辱骂、人身攻击或无关内容',other:'其他明确违规'};
export const REVIEW_RISKS={new_account:'账号注册不足 24 小时',similar_content:'近期文案重复（忽略标点和空格）',shared_network:'短时间内多个账号来自同一网络',burst_shop:'店铺短时间内集中收到评价'};
const fail=(status,message)=>{throw new SubmissionError(status,message);};
const uuid=()=>randomBytes(16).toString('hex');
const idValid=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const boundedPage=(value,total,size=20)=>Math.min(Math.max(1,Math.ceil(total/size)),/^[1-9]\d{0,6}$/.test(String(value))?Number(value):1);
function field(value,label,min,max){
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(422,label+'格式不正确或过长');
 const text=value.trim();if([...text].length<min)fail(422,label+'至少填写 '+min+' 个字');
 if(/(?:password|api[_ -]?key|access[_ -]?token|secret|密码|口令|验证码|卡密)\s*[:=：]\s*\S+|\bsk-[\w-]{16,}|-----BEGIN .*PRIVATE KEY-----/i.test(text))fail(422,'请先移除密码、验证码、卡密、密钥或访问令牌');
 return text;
}
// Gmail's consumer aliases identify the same verified mailbox. Other domains
// retain their exact local part: never assume corporate providers share rules.
export function reviewMailbox(email){
 const [local,domain]=String(email||'').trim().toLowerCase().split('@');
 return ['gmail.com','googlemail.com'].includes(domain)?local.split('+')[0].replaceAll('.','')+'@gmail.com':local+'@'+domain;
}
const schema=`
CREATE TABLE IF NOT EXISTS shop_reviews(id TEXT PRIMARY KEY,shop_id TEXT NOT NULL,shop_name TEXT NOT NULL,author_key TEXT NOT NULL,account_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,submitted_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','hidden','withdrawn','erased')),version INTEGER NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),product TEXT NOT NULL,delivery TEXT NOT NULL,experience TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',evidence_at TEXT,content_hash TEXT NOT NULL,risk TEXT NOT NULL DEFAULT '[]',reason TEXT NOT NULL DEFAULT '',public_note TEXT NOT NULL DEFAULT '',published_at TEXT,UNIQUE(shop_id,author_key));
CREATE INDEX IF NOT EXISTS shop_review_queue ON shop_reviews(status,submitted_at);
CREATE INDEX IF NOT EXISTS shop_review_public ON shop_reviews(shop_id,status,published_at);
CREATE INDEX IF NOT EXISTS shop_review_author ON shop_reviews(author_key);
CREATE INDEX IF NOT EXISTS shop_review_content ON shop_reviews(content_hash,submitted_at);
CREATE TABLE IF NOT EXISTS shop_review_images(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,position INTEGER NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shop_review_images_review ON shop_review_images(review_id,position);
CREATE TABLE IF NOT EXISTS shop_review_purchase_images(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,position INTEGER NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,data BLOB NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shop_review_purchase_images_review ON shop_review_purchase_images(review_id,position);
CREATE TABLE IF NOT EXISTS shop_review_history(review_id TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(review_id,version));
CREATE TABLE IF NOT EXISTS shop_review_actions(id INTEGER PRIMARY KEY,review_id TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,previous_status TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '');
CREATE TRIGGER IF NOT EXISTS shop_review_actions_no_update BEFORE UPDATE ON shop_review_actions BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS shop_review_actions_no_delete BEFORE DELETE ON shop_review_actions BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TABLE IF NOT EXISTS shop_review_reports(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,review_version INTEGER NOT NULL,reporter_key TEXT NOT NULL,account_id TEXT,role TEXT NOT NULL,reason TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,reply TEXT NOT NULL DEFAULT '',UNIQUE(review_id,review_version,reporter_key));
CREATE INDEX IF NOT EXISTS shop_review_reports_queue ON shop_review_reports(status,created_at);
CREATE TABLE IF NOT EXISTS shop_review_events(id INTEGER PRIMARY KEY,author_key TEXT NOT NULL,client_hash TEXT,shop_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shop_review_event_author ON shop_review_events(author_key,created_at);
CREATE INDEX IF NOT EXISTS shop_review_event_client ON shop_review_events(client_hash,created_at);
`;
export function createShopReviews({db,digest,shopById,now=()=>new Date(),isMerchant}={}){
 db?.exec(schema);
 if(db&&!db.prepare('PRAGMA table_info(shop_reviews)').all().some(c=>c.name==='purchase_verified_at'))db.exec('ALTER TABLE shop_reviews ADD COLUMN purchase_verified_at TEXT');
 const at=()=>now().toISOString(),cut=ms=>new Date(+now()-ms).toISOString();
 const available=()=>{if(!db||typeof digest!=='function')fail(503,'评价服务暂不可用，请稍后重试');};
 function account(value){
  available();const row=value?.id&&db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(value.id);
  if(!row)fail(401,'请先登录并验证邮箱');return row;
 }
 const author=a=>digest('review-author|'+reviewMailbox(a.email));
 const raw=id=>idValid(id)?db?.prepare('SELECT * FROM shop_reviews WHERE id=?').get(id)||null:null;
 const imageTable=purchase=>purchase?'shop_review_purchase_images':'shop_review_images';
 const imageRows=(id,purchase=false)=>db.prepare('SELECT id,width,height,size,sha256,created_at FROM '+imageTable(purchase)+' WHERE review_id=? ORDER BY position').all(id);
 const imageDto=i=>({id:i.id,url:'/api/shop-reviews/images/'+i.id,width:i.width,height:i.height,size:i.size});
 const purchaseDto=i=>({id:i.id,url:'/api/shop-reviews/purchase-images/'+i.id,width:i.width,height:i.height,size:i.size,expiresAt:new Date(Date.parse(i.created_at)+90*86400000).toISOString()});
 function selectedImages(prior,prepared,purchase){
  const selected=prepared===undefined?(prior?imageRows(prior.id,purchase).map(i=>({id:i.id})):[]):prepared;
  if(!Array.isArray(selected)||selected.length>3)fail(422,purchase?'购买凭证最多上传 3 张图片':'每条评价最多上传 3 张图片');
  if(purchase&&!selected.length)fail(422,'请上传至少 1 张脱敏购买凭证，供后台核对购买记录');return selected;
 }
 function resolveImages(prior,prepared,purchase=false){
  const selected=selectedImages(prior,prepared,purchase).map(i=>{
   if(!i||typeof i!=='object'||Array.isArray(i))fail(422,'图片格式不正确，请重新上传');
   if(i.id){const r=prior&&idValid(i.id)&&db.prepare('SELECT * FROM '+imageTable(purchase)+' WHERE id=? AND review_id=?').get(i.id,prior.id);if(!r)fail(422,purchase?'购买凭证已过期、已变化或不属于这份评价，请重新上传':'配图已变化或不属于这份评价，请刷新后重新选择');return r;}
   if(!Buffer.isBuffer(i.data)||i.data.length>2*1024*1024||i.mime!=='image/webp'||!i.width||!i.height||!/^[a-f0-9]{64}$/.test(i.sha256||''))fail(422,'图片未经有效处理，请重新上传');
   return {...i,id:uuid(),size:i.data.length,created_at:at()};
  });
  if(new Set(selected.map(i=>i.sha256)).size!==selected.length)fail(422,'请不要重复上传同一张图片');return selected;
 }
 function shop(id){const s=typeof id==='string'&&/^[a-f0-9]{24}$/.test(id)&&shopById?.(id);if(!s)fail(404,'店铺暂不可评价，请返回店铺列表确认');return s;}
 const hasTable=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
 function merchant(a,s){
  if(isMerchant)return isMerchant(a,s);
  const email=reviewMailbox(a.email);
  if(hasTable('merchant_applications')&&db.prepare("SELECT email,applicant_account_id FROM merchant_applications WHERE identity=? AND status='approved'").all(s.identity).some(r=>r.applicant_account_id===a.id||r.email&&reviewMailbox(r.email)===email))return true;
  return hasTable('merchant_x_claims')&&db.prepare("SELECT email FROM merchant_x_claims WHERE shop_id=? AND status='approved'").all(s.id).some(r=>reviewMailbox(r.email)===email);
 }
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}}
 function snapshot(row){
  // Private evidence is not duplicated into revision history.
  const payload={rating:row.rating,product:row.product,delivery:row.delivery,experience:row.experience,status:row.status,images:imageRows(row.id).map(({sha256,width,height})=>({sha256,width,height}))};
  db.prepare('INSERT INTO shop_review_history VALUES(?,?,?,?)').run(row.id,row.version,at(),JSON.stringify(payload));
 }
 function audit(row,action,previous,actor,reason='',note=''){
  db.prepare('INSERT INTO shop_review_actions(review_id,created_at,actor,action,previous_status,status,version,reason,note) VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,at(),actor,action,previous,row.status,row.version,reason,note);
 }
 function ownDto(r){return r?{id:r.id,shopId:r.shop_id,status:r.status,version:r.version,rating:r.rating,product:r.product,delivery:r.delivery,experience:r.experience,evidence:r.evidence_at>cut(90*86400000)?r.evidence:'',reason:r.reason,publicNote:r.public_note,updatedAt:r.updated_at,images:imageRows(r.id).map(imageDto),purchaseImages:imageRows(r.id,true).map(purchaseDto),purchaseVerifiedAt:r.purchase_verified_at||null}:null;}
 function rate(key,client,kind,shopId){
  purge();const recent=db.prepare('SELECT COUNT(*) n FROM shop_review_events WHERE author_key=? AND kind=? AND created_at>?').get(key,kind,cut(86400000)).n;
  const last=db.prepare('SELECT created_at FROM shop_review_events WHERE author_key=? AND kind=? ORDER BY id DESC LIMIT 1').get(key,kind);
  if(recent>=(kind==='submit'?5:10)||last&&Date.parse(last.created_at)>+now()-60000)fail(429,'操作较频繁，请稍后再试');
  const clientHash=client?digest('review-network|'+String(client).slice(0,256)):null;
  if(clientHash&&db.prepare('SELECT COUNT(*) n FROM shop_review_events WHERE client_hash=? AND created_at>?').get(clientHash,cut(3600000)).n>=30)fail(429,'操作较频繁，请稍后再试');
  db.prepare('INSERT INTO shop_review_events(author_key,client_hash,shop_id,kind,created_at) VALUES(?,?,?,?,?)').run(key,clientHash,shopId,kind,at());
  return clientHash;
 }
 function purge(){
  if(!db)return;
  db.prepare('DELETE FROM shop_review_events WHERE created_at<?').run(cut(48*3600000));
  db.prepare("UPDATE shop_reviews SET evidence='',evidence_at=NULL WHERE evidence_at<?").run(cut(90*86400000));
  db.prepare("DELETE FROM shop_review_images WHERE review_id IN (SELECT id FROM shop_reviews WHERE status<>'published' AND updated_at<?)").run(cut(90*86400000));
  // Purchase records never become public, and edits do not extend their lifetime.
  db.prepare('DELETE FROM shop_review_purchase_images WHERE created_at<=?').run(cut(90*86400000));
 }
 const service={
  purge,
  canReply(value,shopId){if(!value||!db)return false;const a=account(value),s=shopById?.(shopId);return !!(s&&merchant(a,s));},
  purchaseImage(id,{viewer=null,admin=false}={}){
   if(!db||!idValid(id))return null;purge();
   const r=db.prepare('SELECT r.author_key,r.status,i.data FROM shop_reviews r JOIN shop_review_purchase_images i ON i.review_id=r.id WHERE i.id=?').get(id);
   if(!r||r.status==='erased'||!admin&&!(viewer&&r.author_key===author(account(viewer))))return null;
   return {data:Buffer.from(r.data)};
  },
  image(id,{viewer=null,admin=false}={}){
   if(!db||!idValid(id))return null;
   const r=db.prepare('SELECT r.id,r.shop_id,r.author_key,r.status FROM shop_reviews r JOIN shop_review_images i ON i.review_id=r.id WHERE i.id=?').get(id);if(!r||r.status==='erased')return null;
   if(!admin&&!(r.status==='published'&&shopById?.(r.shop_id))&&!(viewer&&r.author_key===author(account(viewer))))return null;
   const image=db.prepare('SELECT data FROM shop_review_images WHERE id=?').get(id);return image?{data:Buffer.from(image.data)}:null;
  },
  imageAttempt(value,{client=''}={}){
   const a=account(value),key=author(a);purge();const clientHash=client?digest('review-network|'+String(client).slice(0,256)):null;
   if(db.prepare("SELECT COUNT(*) n FROM shop_review_events WHERE author_key=? AND kind='image' AND created_at>?").get(key,cut(3600000)).n>=10||clientHash&&db.prepare("SELECT COUNT(*) n FROM shop_review_events WHERE client_hash=? AND kind='image' AND created_at>?").get(clientHash,cut(3600000)).n>=30)fail(429,'图片提交过于频繁，请稍后再试');
   db.prepare("INSERT INTO shop_review_events(author_key,client_hash,shop_id,kind,created_at) VALUES(?,?,'','image',?)").run(key,clientHash,at());
  },
  own(a,id){if(!a||!db)return null;purge();const user=account(a);return ownDto(db.prepare('SELECT * FROM shop_reviews WHERE author_key=? AND shop_id=?').get(author(user),id));},
  submit(value,input,{client='',images,purchaseImages}={}){
   const a=account(value),s=shop(input?.shopId),key=author(a);
   if(merchant(a,s))fail(403,'已关联的店主不能评价自己的店铺，可对现有评价提交说明或申诉');
   if(input.consent!==true||input.website)fail(422,'请确认评价来自本人真实经历，且不涉及返利、刷评或利益关联');
   if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5)fail(422,'请选择 1 至 5 星');
   if(!Number.isSafeInteger(input.version)||input.version<0)fail(422,'评价版本无效，请刷新页面');
   if(!Object.hasOwn(REVIEW_DELIVERIES,input.delivery))fail(422,'请选择交付方式');
   const product=field(input.product,'产品名称',2,80),experience=field(input.experience,'具体体验',15,1500),evidence=field(input.evidence||'','后台凭证说明',0,2000);
   if(input.images!==undefined&&images===undefined)fail(422,'图片未经处理，请重新提交');
   if(input.purchaseImages!==undefined&&purchaseImages===undefined)fail(422,'购买凭证未经处理，请重新提交');
   const contentHash=digest('review-text|'+experience.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,''));
   purge();
   return transaction(()=>{
    const prior=db.prepare('SELECT * FROM shop_reviews WHERE author_key=? AND shop_id=?').get(key,s.id);
    const selected=resolveImages(prior,images),sameImages=JSON.stringify(selected.map(i=>i.sha256))===JSON.stringify(prior?imageRows(prior.id).map(i=>i.sha256):[]);
    const purchaseSelected=resolveImages(prior,purchaseImages,true),samePurchases=JSON.stringify(purchaseSelected.map(i=>i.sha256))===JSON.stringify(prior?imageRows(prior.id,true).map(i=>i.sha256):[]);
    if(selected.some(i=>purchaseSelected.some(p=>p.sha256===i.sha256)))fail(422,'购买凭证仅供后台审核，请勿将同一张凭证同时用作公开配图');
    if(prior&&prior.status!=='erased'&&prior.rating===input.rating&&prior.product===product&&prior.delivery===input.delivery&&prior.experience===experience&&prior.evidence===evidence&&sameImages&&samePurchases&&['pending','published'].includes(prior.status))return ownDto(prior);
    if((prior?.version||0)!==input.version)fail(409,'评价已更新，请刷新后再提交；同一邮箱对同一家店只保留一条评价');
    if(prior?.status==='erased')fail(403,'这份评价已随账号注销，不能重新刷入；如需恢复请联系站长');
    const imageBytes=[...selected,...purchaseSelected].reduce((n,i)=>n+i.size,0),oldBytes=prior?[...imageRows(prior.id),...imageRows(prior.id,true)].reduce((n,i)=>n+i.size,0):0;
    const storedBytes=db.prepare('SELECT (SELECT COALESCE(SUM(size),0) FROM shop_review_images)+(SELECT COALESCE(SUM(size),0) FROM shop_review_purchase_images) n').get().n;
    if(imageBytes>oldBytes&&storedBytes-oldBytes+imageBytes>256*1024*1024)fail(503,'图片存储暂满，请稍后再试；购买凭证不能省略');
    const network=rate(key,client,'submit',s.id),risk=[];
    if(Date.parse(a.created_at)>+now()-86400000)risk.push('new_account');
    if(db.prepare('SELECT 1 FROM shop_reviews WHERE content_hash=? AND author_key<>? AND submitted_at>? LIMIT 1').get(contentHash,key,cut(30*86400000)))risk.push('similar_content');
    if(network&&db.prepare('SELECT COUNT(DISTINCT author_key) n FROM shop_review_events WHERE client_hash=? AND created_at>?').get(network,cut(3600000)).n>=3)risk.push('shared_network');
    if(db.prepare("SELECT COUNT(*) n FROM shop_reviews WHERE shop_id=? AND submitted_at>? AND author_key<>?").get(s.id,cut(3600000),key).n>=5)risk.push('burst_shop');
    const id=prior?.id||uuid(),version=(prior?.version||0)+1;
    if(prior)db.prepare("UPDATE shop_reviews SET account_id=?,shop_name=?,updated_at=?,submitted_at=?,status='pending',version=?,rating=?,product=?,delivery=?,experience=?,evidence=?,evidence_at=?,content_hash=?,risk=?,reason='',public_note='',published_at=NULL,purchase_verified_at=NULL WHERE id=?").run(a.id,s.name,at(),at(),version,input.rating,product,input.delivery,experience,evidence,evidence?at():null,contentHash,JSON.stringify(risk),id);
    else db.prepare("INSERT INTO shop_reviews(id,shop_id,shop_name,author_key,account_id,created_at,updated_at,submitted_at,status,version,rating,product,delivery,experience,evidence,evidence_at,content_hash,risk) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)").run(id,s.id,s.name,key,a.id,at(),at(),at(),version,input.rating,product,input.delivery,experience,evidence,evidence?at():null,contentHash,JSON.stringify(risk));
    db.prepare('DELETE FROM shop_review_images WHERE review_id=?').run(id);
    const insertImage=db.prepare('INSERT INTO shop_review_images VALUES(?,?,?,?,?,?,?,?,?,?)');
    selected.forEach((i,position)=>insertImage.run(i.id,id,position,'image/webp',i.width,i.height,i.size,i.sha256,i.data,i.created_at));
    db.prepare('DELETE FROM shop_review_purchase_images WHERE review_id=?').run(id);
    const insertPurchase=db.prepare('INSERT INTO shop_review_purchase_images VALUES(?,?,?,?,?,?,?,?,?,?)');
    purchaseSelected.forEach((i,position)=>insertPurchase.run(i.id,id,position,'image/webp',i.width,i.height,i.size,i.sha256,i.data,i.created_at));
    const row=raw(id);snapshot(row);audit(row,prior?'edit':'submit',prior?.status||'','reader');return ownDto(row);
   });
  },
  withdraw(value,input){
   const a=account(value);return transaction(()=>{
    const r=raw(input.id);if(!r||r.author_key!==author(a))fail(404,'评价不存在');
    if(r.version!==input.version)fail(409,'评价已更新，请刷新页面');
    if(['withdrawn','erased'].includes(r.status))fail(422,'当前评价已不可展示');
    db.prepare("UPDATE shop_reviews SET status='withdrawn',version=version+1,updated_at=?,published_at=NULL WHERE id=?").run(at(),r.id);
    const row=raw(r.id);snapshot(row);audit(row,'withdraw',r.status,'reader');return ownDto(row);
   });
  },
  publicCounts(shopIds=[]){
   const ids=[...new Set(shopIds.filter(id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id)))],counts=new Map(ids.map(id=>[id,0]));
   if(!db)return counts;
   // One grouped read per page-sized batch, never fetch review text or private fields.
   for(let offset=0;offset<ids.length;offset+=100){
    const batch=ids.slice(offset,offset+100);
    for(const row of db.prepare("SELECT shop_id,COUNT(*) n FROM shop_reviews WHERE status='published' AND shop_id IN ("+batch.map(()=>'?').join(',')+") GROUP BY shop_id").all(...batch))counts.set(row.shop_id,Number(row.n));
   }
   return counts;
  },
  publicList(id,{page=1}={}){
   if(!db)return {items:[],total:0,page:1,pages:1};
   const total=db.prepare("SELECT COUNT(*) n FROM shop_reviews WHERE shop_id=? AND status='published'").get(id).n,p=boundedPage(page,total);
   const items=db.prepare("SELECT * FROM shop_reviews WHERE shop_id=? AND status='published' ORDER BY published_at DESC,id DESC LIMIT 20 OFFSET ?").all(id,(p-1)*20).map(r=>({id:r.id,version:r.version,author:'用户 '+digest('review-display|'+r.shop_id+'|'+r.author_key).slice(0,6),rating:r.rating,product:r.product,delivery:r.delivery,experience:r.experience,publishedAt:r.published_at,images:imageRows(r.id).map(imageDto),purchaseVerified:!!r.purchase_verified_at,purchaseVerifiedAt:r.purchase_verified_at||null,legacyReview:!r.purchase_verified_at}));
   return {items,total,page:p,pages:Math.max(1,Math.ceil(total/20))};
  },
  moderate(id,input,{actor='admin'}={}){
   available();if(!['publish','reject','hide'].includes(input.action))fail(422,'审核操作无效');
   const note=field(input.note||'','审核说明',input.action==='publish'?0:5,1000),reason=input.action==='publish'?'':input.reason;
   if(input.action==='publish'?input.confirmed!==true:!Object.hasOwn(REVIEW_REASONS,reason))fail(422,'请确认统一审核标准，或选择具体违规原因并说明');
   purge();
   return transaction(()=>{
    const r=raw(id);if(!r)fail(404,'评价不存在');if(r.version!==input.version)fail(409,'评价已更新，请刷新后重新审核');
    const allowed=input.action==='hide'?['published']:['pending','rejected','hidden'];if(!allowed.includes(r.status))fail(422,'当前状态不能执行此操作');
    if(input.action==='publish'){
     if(input.purchaseConfirmed!==true)fail(422,'请逐张核对购买凭证，并确认购买记录与本店、本评价一致');
     if(!imageRows(r.id,true).length)fail(422,'购买凭证缺失或已过期，请作者重新上传后再审核');
     const s=shop(r.shop_id),a=db.prepare('SELECT * FROM retention_accounts WHERE id=?').get(r.account_id);
     if(!a||merchant(a,s))fail(422,'账号已不存在或已关联为店主，不能发布这条评价');
    }
    const status={publish:'published',reject:'rejected',hide:'hidden'}[input.action];
    db.prepare('UPDATE shop_reviews SET status=?,version=version+1,updated_at=?,reason=?,public_note=?,published_at=? WHERE id=?').run(status,at(),reason,note,status==='published'?at():null,id);
    if(status==='published')db.prepare('UPDATE shop_reviews SET purchase_verified_at=? WHERE id=?').run(at(),id);
    const row=raw(id);snapshot(row);audit(row,input.action,r.status,String(actor).slice(0,100),reason,note);return ownDto(row);
   });
  },
  report(value,input,{client=''}={}){
   const a=account(value),key=author(a),r=raw(input?.id);if(!r)fail(404,'评价不存在');
   const self=r.author_key===key;
   if(r.status!=='published'&&(!self||!['rejected','hidden'].includes(r.status)))fail(404,'评价不存在或不可申诉');
   if(self?input.reason!=='appeal':!Object.hasOwn(REVIEW_REASONS,input.reason))fail(422,'请选择具体原因');
   if(!Number.isSafeInteger(input.version)||input.version!==r.version)fail(409,'评价已变化，请刷新后核对');
   const details=field(input.details,'具体说明',10,1500),s=shop(r.shop_id);
   return transaction(()=>{
    const existing=db.prepare('SELECT id FROM shop_review_reports WHERE review_id=? AND review_version=? AND reporter_key=?').get(r.id,r.version,key);
    if(existing)return {id:existing.id,status:'received'};
    rate(key,client,'report',r.shop_id);const id=uuid();
    db.prepare('INSERT INTO shop_review_reports(id,review_id,review_version,reporter_key,account_id,role,reason,details,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,r.id,r.version,key,a.id,self?'author':merchant(a,s)?'merchant':'reader',input.reason,details,at());
    audit(r,'report',r.status,'reader',input.reason);return {id,status:'received'};
   });
  },
  myReports(a,shopId){if(!a||!db)return [];return db.prepare('SELECT t.id,t.review_id AS reviewId,t.created_at AS createdAt,t.status,t.reply FROM shop_review_reports t JOIN shop_reviews r ON r.id=t.review_id WHERE t.reporter_key=? AND r.shop_id=? ORDER BY t.created_at DESC LIMIT 20').all(author(account(a)),shopId);},
  resolveReport(id,input,{actor='admin'}={}){
   available();if(!['dismiss','handled'].includes(input.decision))fail(422,'请选择处理结论');
   const note=field(input.note||'','处理说明',5,1000);
   return transaction(()=>{
    const r=idValid(id)&&db.prepare('SELECT * FROM shop_review_reports WHERE id=?').get(id);if(!r)fail(404,'申诉不存在');
    if(r.version!==input.version||r.status!=='pending')fail(409,'申诉已被处理，请刷新页面');
    db.prepare('UPDATE shop_review_reports SET status=?,reply=?,version=version+1 WHERE id=?').run(input.decision,note,id);
    const review=raw(r.review_id);audit(review,'report_'+input.decision,review.status,String(actor).slice(0,100),r.reason,note);
    return {ok:true,reviewId:r.review_id};
   });
  },
  queue({status='pending',page=1}={}){
   available();if(!Object.hasOwn(REVIEW_STATUSES,status))status='pending';
   const total=db.prepare('SELECT COUNT(*) n FROM shop_reviews WHERE status=?').get(status).n,p=boundedPage(page,total);
   const rows=db.prepare('SELECT id,shop_name,product,rating,status,submitted_at,risk,version FROM shop_reviews WHERE status=? ORDER BY submitted_at ASC,id LIMIT 20 OFFSET ?').all(status,(p-1)*20);
   const reports=db.prepare("SELECT t.*,r.shop_name,r.status AS review_status,r.version AS current_version FROM shop_review_reports t JOIN shop_reviews r ON r.id=t.review_id WHERE t.status='pending' ORDER BY t.created_at LIMIT 50").all();
   return {items:rows,total,status,page:p,pages:Math.max(1,Math.ceil(total/20)),reports,reportTotal:db.prepare("SELECT COUNT(*) n FROM shop_review_reports WHERE status='pending'").get().n};
  },
  detail(id){
   available();purge();const r=raw(id);if(!r)return null;
   return {...r,images:imageRows(r.id).map(imageDto),purchaseImages:imageRows(r.id,true).map(purchaseDto),purchaseVerifiedAt:r.purchase_verified_at||null,risk:JSON.parse(r.risk),history:db.prepare('SELECT * FROM shop_review_history WHERE review_id=? ORDER BY version DESC').all(id),actions:db.prepare('SELECT * FROM shop_review_actions WHERE review_id=? ORDER BY id DESC').all(id),reports:db.prepare('SELECT * FROM shop_review_reports WHERE review_id=? ORDER BY created_at DESC').all(id)};
  },
  eraseAccount(value){
   const a=account(value),key=author(a);
   // Called inside the account-deletion transaction. Preserve only keyed
   // tombstones and moderation metadata, not the text, evidence or account link.
   for(const r of db.prepare('SELECT * FROM shop_reviews WHERE author_key=?').all(key)){
    db.prepare('DELETE FROM shop_review_images WHERE review_id=?').run(r.id);
    db.prepare('DELETE FROM shop_review_purchase_images WHERE review_id=?').run(r.id);
    db.prepare("UPDATE shop_reviews SET account_id=NULL,status='erased',version=version+1,product='',experience='',evidence='',evidence_at=NULL,content_hash='',risk='[]',reason='',public_note='',published_at=NULL,purchase_verified_at=NULL,updated_at=? WHERE id=?").run(at(),r.id);
    db.prepare("UPDATE shop_review_history SET payload='{}' WHERE review_id=?").run(r.id);
    audit(raw(r.id),'erase',r.status,'reader');
   }
   db.prepare("UPDATE shop_review_reports SET account_id=NULL,details='',reply='',status='erased',version=version+1 WHERE reporter_key=?").run(key);
   db.prepare('DELETE FROM shop_review_events WHERE author_key=?').run(key);
  },
 };
 return service;
}
