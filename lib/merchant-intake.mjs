import { canonicalShopIdentity, MerchantApplicationError, linkedMerchantApplication, supplySubmissionForConversion } from './merchant-onboarding.mjs';
import { normalizeEmail, queueMerchantMail } from './merchant-mail.mjs';
import { reconcileMerchantMailPolicy } from './merchant-mail-policy.mjs';

export function initSupplyIntakeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_supply_intake (
    source_submission_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, email TEXT
  );`);
  const columns=new Set(db.prepare('PRAGMA table_info(merchant_supply_intake)').all().map(row=>row.name));
  if(!columns.has('status'))db.exec("ALTER TABLE merchant_supply_intake ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rejected','paused'))");
  if(!columns.has('version'))db.exec('ALTER TABLE merchant_supply_intake ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  if(!columns.has('updated_at'))db.exec('ALTER TABLE merchant_supply_intake ADD COLUMN updated_at TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_intake_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_submission_id TEXT NOT NULL, created_at TEXT NOT NULL,
    actor TEXT NOT NULL, action TEXT NOT NULL, previous_status TEXT NOT NULL, status TEXT NOT NULL,
    note TEXT NOT NULL, version INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_intake_actions ON merchant_intake_actions(source_submission_id,id);
  CREATE TRIGGER IF NOT EXISTS intake_actions_no_update BEFORE UPDATE ON merchant_intake_actions
    BEGIN SELECT RAISE(ABORT,'merchant intake audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS intake_actions_no_delete BEFORE DELETE ON merchant_intake_actions
    BEGIN SELECT RAISE(ABORT,'merchant intake audit is append-only'); END;`);
}
export function importSupplyIntakes(db,ids,{actor='admin',now=new Date()}={}) {
  initSupplyIntakeSchema(db);
  if(!Array.isArray(ids)||!ids.length||ids.length>100)throw new MerchantApplicationError(422,'请选择 1–100 条供应投稿');
  db.exec('BEGIN IMMEDIATE');
  try {
    let imported=0;
    for(const id of [...new Set(ids)]) {
      const source=supplySubmissionForConversion(db,id);
      // Only reuse an entire, syntactically valid email supplied in the contact field.
      // Never extract a guessed address from prose or from another application.
      const email=normalizeEmail(source.email)||normalizeEmail(source.contact);
      const added=Number(db.prepare('INSERT OR IGNORE INTO merchant_supply_intake(source_submission_id,created_at,actor,email) VALUES(?,?,?,?)').run(id,new Date(now).toISOString(),String(actor).slice(0,100),email).changes);
      if(added)queueMerchantMail(db,{id,email,stage:'received',eventKey:id+':intake',now});
      imported+=added;
    }
    db.exec('COMMIT');return {imported};
  } catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export function getSupplyIntake(db,id) {
  const intake=db.prepare('SELECT * FROM merchant_supply_intake WHERE source_submission_id=?').get(id);
  if(!intake)return null;
  const source=supplySubmissionForConversion(db,id);
  let identity=null, urlError=null;
  try {identity=canonicalShopIdentity(source.source_url);}catch(error){urlError=error instanceof MerchantApplicationError?error.message:'请核对店铺网址';}
  const existing=identity?db.prepare('SELECT public_id AS id,shop_name AS shopName FROM merchant_applications WHERE identity=?').get(identity):null;
  const linked=linkedMerchantApplication(db,id);
  const actions=db.prepare('SELECT created_at AS createdAt,actor,action,previous_status AS previousStatus,status,note,version FROM merchant_intake_actions WHERE source_submission_id=? ORDER BY id').all(id);
  return {id,shopName:source.subject.slice(0,100),shopUrl:source.source_url,identity,urlError,version:intake.version,status:intake.status,actions,
    platform:identity?.startsWith('shop:16688:')?'16688':identity?.startsWith('shop:')?'ldxp':'independent',
    productAreas:[source.product_area],contact:source.contact,details:source.details,email:intake.email,
    createdAt:intake.created_at,updatedAt:intake.updated_at||intake.created_at,sourceCreatedAt:source.created_at,existingApplication:existing,linkedApplication:linked,isSupplyIntake:true};
}
export function listSupplyIntakes(db,{status='pending'}={}) {
  initSupplyIntakeSchema(db);
  if(!['pending','rejected','paused','all'].includes(status))throw new MerchantApplicationError(422,'审核状态无效');
  return db.prepare(`SELECT source_submission_id FROM merchant_supply_intake ${status==='all'?'':'WHERE status=?'} ORDER BY created_at DESC,source_submission_id LIMIT 1000`).all(...(status==='all'?[]:[status]))
    .map(row=>getSupplyIntake(db,row.source_submission_id)).filter(row=>!row.linkedApplication);
}
export function reviewSupplyIntake(db,id,review,{now=new Date()}={}) {
  initSupplyIntakeSchema(db);
  if(!['reject','pause','restore'].includes(review?.action))throw new MerchantApplicationError(422,'审核操作无效');
  const note=String(review.note||'').trim(),actor=String(review.actor||'admin').trim();
  if(note.length>1500||!actor||actor.length>100||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note+actor))throw new MerchantApplicationError(422,'处理意见或审核人格式不正确');
  db.exec('BEGIN IMMEDIATE');
  try {
    const app=getSupplyIntake(db,id);
    if(!app)throw new MerchantApplicationError(404,'记录不存在');
    if(app.linkedApplication)throw new MerchantApplicationError(409,'已转为正式申请，请在正式申请中处理');
    if(!Number.isSafeInteger(review.expectedVersion)||app.version!==review.expectedVersion)throw new MerchantApplicationError(409,'记录已更新，请刷新后再处理');
    if(review.action==='restore'? !['paused','rejected'].includes(app.status):app.status!=='pending')throw new MerchantApplicationError(422,'当前状态不能执行此操作，请刷新后重试');
    const status={reject:'rejected',pause:'paused',restore:'pending'}[review.action],stamp=new Date(now).toISOString();
    db.prepare('UPDATE merchant_supply_intake SET status=?,version=version+1,updated_at=? WHERE source_submission_id=?').run(status,stamp,id);
    db.prepare('INSERT INTO merchant_intake_actions(source_submission_id,created_at,actor,action,previous_status,status,note,version) VALUES(?,?,?,?,?,?,?,?)').run(id,stamp,actor,review.action,app.status,status,note,app.version+1);
    reconcileMerchantMailPolicy(db,id);
    db.exec('COMMIT');return getSupplyIntake(db,id);
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
export function updateIntakeEmail(db,id,email,{actor='admin',confirmed=false,now=new Date()}={}) {
  const app=getSupplyIntake(db,id), address=normalizeEmail(email);
  if(!app)throw new MerchantApplicationError(404,'记录不存在');
  if(!address||!confirmed)throw new MerchantApplicationError(422,'请核对申请人提供的有效邮箱并确认');
  db.exec('BEGIN IMMEDIATE');
  try {
    const stamp=new Date(now).toISOString();
    db.prepare('UPDATE merchant_supply_intake SET email=? WHERE source_submission_id=?').run(address,id);
    db.prepare("UPDATE merchant_mail_outbox SET status='superseded' WHERE application_id=? AND recipient<>? AND status IN ('queued','retry','failed')").run(id,address);
    const action=db.prepare('INSERT INTO merchant_email_actions(application_id,email,created_at,actor) VALUES(?,?,?,?)').run(id,address,stamp,String(actor).slice(0,100));
    queueMerchantMail(db,{id,email:address,stage:'received',eventKey:id+':email:'+action.lastInsertRowid,now});
    db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
