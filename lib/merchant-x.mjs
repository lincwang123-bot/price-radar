import {createHash,createHmac,randomBytes} from 'node:crypto';
import {MerchantApplicationError} from './merchant-onboarding.mjs';
import {normalizeEmail} from './merchant-mail.mjs';
import {merchantIdentityForOffer} from './merchant-identity.mjs';
import {directoryQuotes} from './product-directory.mjs';

const fail=(status,message)=>{throw new MerchantApplicationError(status,message);};
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const random=bytes=>randomBytes(bytes).toString('hex');
const reserved=new Set(['home','explore','search','intent','settings','messages','notifications','login','logout','signup','share','compose','i','tos','privacy']);
export function normalizeXHandle(input){
 if(typeof input!=='string'||input.length>250)fail(422,'请填写有效的 X 用户名或主页链接');
 let value=input.trim();
 if(/^https?:\/\//i.test(value)){
  let u;try{u=new URL(value);}catch{fail(422,'X 主页链接无效');}
  if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port||!/^\/[A-Za-z0-9_]{1,15}\/?$/.test(u.pathname))fail(422,'请填写 x.com 或 twitter.com 的账号主页，不是帖子或跳转链接');
  value=u.pathname.replaceAll('/','');
 }
 value=value.replace(/^@/,'').toLowerCase();
 // Short historical handles are allowed; existence and control are checked by the reviewer.
 if(!/^[a-z0-9_]{1,15}$/.test(value)||reserved.has(value))fail(422,'X 用户名只能包含字母、数字和下划线，最长 15 位');
 return value;
}
export const shopPublicId=identity=>hash('airadar-shop|'+identity).slice(0,24);
export function shopDescriptorForOffer(offer){
 const identity=merchantIdentityForOffer(offer);if(!identity)return null;
 try{
  const extra=typeof offer.extra==='string'?JSON.parse(offer.extra):offer.extra||{};
  const url=identity.startsWith('domain:')?new URL(offer.url).origin:extra.shopUrl;
  if(!url)return null;
  return {id:shopPublicId(identity),identity,name:String(offer.store_name||new URL(url).hostname).slice(0,100),url};
 }catch{return null;}
}
export function buildShopCatalog(directory){
 const stores=new Map();
 for(const category of directory)for(const product of category.products)for(const entry of directoryQuotes(product).entries){
  if(entry.reference)continue;const offer={...entry.offer,source:entry.list.source},shop=shopDescriptorForOffer(offer);if(!shop)continue;
  if(!stores.has(shop.id))stores.set(shop.id,{...shop,entries:[]});
  stores.get(shop.id).entries.push({...entry,productName:product.name,productKey:product.key,family:category.key});
 }
 return stores;
}
function text(value,label,max=1500){
 if(value==null)return '';
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail(422,label+'格式不正确或过长');
 const v=value.trim();
 if(/(?:password|api[_ -]?key|access[_ -]?token|secret|密码|口令)\s*[:=：]\s*\S+|\bsk-[\w-]{16,}|-----BEGIN .*PRIVATE KEY-----/i.test(v))fail(422,'请勿提交密码、API Key 或私钥');
 return v;
}
function proofUrl(value,handle,kind){
 if(kind==='profile')return 'https://x.com/'+handle;
 let u;try{u=new URL(value);}catch{fail(422,'请填写认领帖链接');}
 if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname.toLowerCase())||u.protocol!=='https:'||u.port||u.username||u.password)fail(422,'认领帖必须是 X 的 HTTPS 帖子链接');
 const match=/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/.exec(u.pathname);
 if(!match||match[1].toLowerCase()!==handle)fail(422,'认领帖必须由你填写的 X 账号发布');
 return 'https://x.com/'+handle+'/status/'+match[2];
}
export const merchantXSchema=`
CREATE TABLE IF NOT EXISTS merchant_x_shops(id TEXT PRIMARY KEY,identity TEXT NOT NULL UNIQUE,name TEXT NOT NULL,url TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS merchant_x_claims(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,shop_id TEXT NOT NULL,x_handle TEXT NOT NULL,email TEXT NOT NULL,code TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected','revoked')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,consent_at TEXT NOT NULL,client_hash TEXT,proof_type TEXT,proof_url TEXT,shop_proof_url TEXT NOT NULL DEFAULT '',details TEXT NOT NULL DEFAULT '',public_reply TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS merchant_x_queue ON merchant_x_claims(status,created_at);
CREATE INDEX IF NOT EXISTS merchant_x_client ON merchant_x_claims(client_hash,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_x_one_owner ON merchant_x_claims(shop_id) WHERE status='approved';
CREATE TABLE IF NOT EXISTS merchant_x_actions(id INTEGER PRIMARY KEY,claim_id TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,previous_status TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,x_confirmed INTEGER NOT NULL,shop_confirmed INTEGER NOT NULL,version INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS merchant_x_actions_no_update BEFORE UPDATE ON merchant_x_actions BEGIN SELECT RAISE(ABORT,'merchant X audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS merchant_x_actions_no_delete BEFORE DELETE ON merchant_x_actions BEGIN SELECT RAISE(ABORT,'merchant X audit is append-only'); END;
`;
export function createMerchantX({privateDb,readDirectory,secret=process.env.SUBMISSION_HASH_SECRET||random(32),now=()=>new Date()}){
 const db=privateDb;db?.exec(merchantXSchema);
 let cache=null,loadedAt=0;
 const stamp=()=>now().toISOString();
 const get=id=>db?.prepare('SELECT c.*,s.name AS shop_name,s.url AS shop_url,s.identity FROM merchant_x_claims c JOIN merchant_x_shops s ON s.id=c.shop_id WHERE c.id=?').get(id)||null;
 const requireDb=()=>{if(!db)fail(503,'认领服务暂不可用，请稍后再试');};
 function catalog(){
  if(cache&&+now()-loadedAt<60000)return cache;
  const stores=buildShopCatalog(readDirectory());
  if(db)for(const s of stores.values())db.prepare('INSERT INTO merchant_x_shops VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,observed_at=excluded.observed_at').run(s.id,s.identity,s.name,s.url,stamp());
  cache=stores;loadedAt=+now();return stores;
 }
 function receipt(row){
  return {id:row.id,shopId:row.shop_id,shopName:row.shop_name,shopUrl:row.shop_url,xHandle:row.x_handle,code:row.code,status:row.status,expiresAt:row.expires_at,proofType:row.proof_type,proofUrl:row.proof_url,publicReply:row.public_reply};
 }
 function authorized(input){
  requireDb();if(!/^[a-f0-9]{32}$/.test(input?.id||'')||!/^[a-f0-9]{64}$/.test(input?.token||''))fail(404,'认领查询凭据无效');
  const row=get(input.id);if(!row||row.token_hash!==hash(input.token))fail(404,'认领查询凭据无效');return row;
 }
 const service={catalog,
  shop(id){const active=catalog().get(id);if(active)return active;const s=db?.prepare('SELECT * FROM merchant_x_shops WHERE id=?').get(id);return s?{...s,entries:[]}:null;},
  profiles(){if(!db)return [];return db.prepare("SELECT s.identity,c.x_handle AS xHandle,c.updated_at AS reviewedAt,c.shop_id AS shopId FROM merchant_x_claims c JOIN merchant_x_shops s ON s.id=c.shop_id WHERE c.status='approved'").all();},
  start(input,{clientAddress='unknown'}={}){
   requireDb();if(!input||typeof input!=='object'||Array.isArray(input)||input.website)fail(422,'申请未通过校验');
   if(typeof input.shopId!=='string'||!/^[a-f0-9]{24}$/.test(input.shopId))fail(422,'请选择要认领的店铺');
   const shop=service.shop(input.shopId);if(!shop)fail(422,'请选择已收录的店铺；尚未收录请先提交店铺申请');
   const handle=normalizeXHandle(input.xHandle),email=normalizeEmail(input.email)?.toLowerCase();if(!email)fail(422,'请填写有效联系邮箱');
   if(input.consent!==true)fail(422,'请确认代表店铺申请并同意公开 X 账号关联');
   const client=createHmac('sha256',secret).update(String(clientAddress)).digest('hex'),hour=new Date(+now()-3600000).toISOString(),day=new Date(+now()-86400000).toISOString();
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('UPDATE merchant_x_claims SET client_hash=NULL WHERE created_at<? AND client_hash IS NOT NULL').run(new Date(+now()-48*3600000).toISOString());
    db.prepare("DELETE FROM merchant_x_claims WHERE status='draft' AND expires_at<?").run(stamp());
    const hourly=db.prepare('SELECT COUNT(*) n FROM merchant_x_claims WHERE client_hash=? AND created_at>=?').get(client,hour).n;
    const daily=db.prepare('SELECT COUNT(*) n FROM merchant_x_claims WHERE (client_hash=? OR email=?) AND created_at>=?').get(client,email,day).n;
    const total=db.prepare('SELECT COUNT(*) n FROM merchant_x_claims WHERE created_at>=?').get(day).n;
    if(hourly>=3||daily>=5||total>=150)fail(429,'申请较频繁，请稍后再试');
    if(db.prepare("SELECT 1 FROM merchant_x_claims WHERE shop_id=? AND x_handle=? AND status='pending'").get(shop.id,handle))fail(409,'这组店铺和 X 账号已有待审认领，请使用原进度链接或联系站长');
    const id=random(16),token=random(32),code='AIR-'+random(5).toUpperCase();
    db.prepare('INSERT INTO merchant_x_claims(id,token_hash,shop_id,x_handle,email,code,created_at,updated_at,expires_at,consent_at,client_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,hash(token),shop.id,handle,email,code,stamp(),stamp(),new Date(+now()+7*86400000).toISOString(),stamp(),client);
    db.exec('COMMIT');return {...receipt(get(id)),token};
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  },
  submit(input){
   const row=authorized(input);if(row.status!=='draft')fail(409,'此认领已提交，请查看审核进度');if(row.expires_at<=stamp())fail(410,'认领码已过期，请重新申请');
   if(!['post','profile'].includes(input.proofType))fail(422,'请选择认领帖或 X 简介核验');
   const xUrl=proofUrl(input.proofUrl,row.x_handle,input.proofType),details=text(input.details,'店铺归属说明');
   if(details.length<5)fail(422,'请说明可以核对店铺归属的位置或方法');
   let shopProof='';if(input.shopProofUrl){
    try{const u=new URL(input.shopProofUrl),home=new URL(row.shop_url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.origin!==home.origin||u.search||u.hash||row.identity.startsWith('shop:')&&u.pathname.replace(/\/$/,'')!==home.pathname.replace(/\/$/,''))throw new Error();shopProof=u.href;}catch{fail(422,'店铺核验链接需位于这家店铺的同一域名；平台店铺请使用自己的店铺主页');}
   }
   db.prepare("UPDATE merchant_x_claims SET status='pending',proof_type=?,proof_url=?,shop_proof_url=?,details=?,updated_at=?,version=version+1 WHERE id=? AND status='draft'").run(input.proofType,xUrl,shopProof,details,stamp(),row.id);return receipt(get(row.id));
  },
  status(input){return receipt(authorized(input));},
  get,
  list(status='pending'){return db?db.prepare('SELECT c.*,s.name AS shop_name,s.url AS shop_url FROM merchant_x_claims c JOIN merchant_x_shops s ON s.id=c.shop_id WHERE c.status=? ORDER BY c.created_at DESC LIMIT 100').all(['pending','approved','rejected','revoked'].includes(status)?status:'pending'):[];},
  actions(id){return db?.prepare('SELECT * FROM merchant_x_actions WHERE claim_id=? ORDER BY id DESC').all(id)||[];},
  review(id,input,{actor='admin'}={}){
   requireDb();const note=text(input.note,'内部核验说明'),reply=text(input.publicReply,'发给店主的说明',1000);
   if(!['approve','reject','revoke'].includes(input.action))fail(422,'审核操作无效');
   db.exec('BEGIN IMMEDIATE');try{
    const row=get(id);if(!row)fail(404,'认领不存在');if(Number(input.version)!==row.version)fail(409,'认领已被更新，请刷新后重试');
    if(input.action==='approve'&&row.status!=='pending'||input.action==='reject'&&row.status!=='pending'||input.action==='revoke'&&row.status!=='approved')fail(409,'当前状态不支持此操作');
    if(input.action==='approve'&&(!input.xConfirmed||!input.shopConfirmed||!row.proof_url||note.length<5))fail(422,'批准前需核对 X 认领码、店铺归属，并记录核验依据');
    if(input.action!=='approve'&&note.length<5)fail(422,'请记录拒绝或撤销原因，至少 5 个字');
    const record=(claim,action,status,body,publicReply)=>{
     db.prepare('UPDATE merchant_x_claims SET status=?,updated_at=?,public_reply=?,version=version+1 WHERE id=?').run(status,stamp(),publicReply,claim.id);
     db.prepare('INSERT INTO merchant_x_actions(claim_id,created_at,actor,action,previous_status,status,note,x_confirmed,shop_confirmed,version) VALUES(?,?,?,?,?,?,?,?,?,?)').run(claim.id,stamp(),String(actor).slice(0,100),action,claim.status,status,body,input.xConfirmed?1:0,input.shopConfirmed?1:0,claim.version+1);
    };
    if(input.action==='approve'){
     const prior=db.prepare("SELECT * FROM merchant_x_claims WHERE shop_id=? AND status='approved'").get(row.shop_id);
     if(prior&&!input.replaceConfirmed)fail(409,'这家店铺已有 X 关联，请核对归属变更并明确确认替换');
     if(prior)record(prior,'replace','revoked',note,'店铺的 X 关联已更新；如有异议请联系站长。');
    }
    record(row,input.action,{approve:'approved',reject:'rejected',revoke:'revoked'}[input.action],note,reply);
    db.exec('COMMIT');return get(id);
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }
 };
 return service;
}
