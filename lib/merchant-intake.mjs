import { canonicalShopIdentity, MerchantApplicationError, linkedMerchantApplication, supplySubmissionForConversion } from './merchant-onboarding.mjs';
import { normalizeEmail, queueMerchantMail } from './merchant-mail.mjs';

export function initSupplyIntakeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_supply_intake (
    source_submission_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, email TEXT
  );`);
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
      const email=normalizeEmail(source.contact);
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
  return {id,shopName:source.subject.slice(0,100),shopUrl:source.source_url,identity,urlError,version:1,status:'pending',
    platform:identity?.startsWith('shop:16688:')?'16688':identity?.startsWith('shop:')?'ldxp':'independent',
    productAreas:[source.product_area],contact:source.contact,details:source.details,email:intake.email,
    createdAt:intake.created_at,sourceCreatedAt:source.created_at,existingApplication:existing,linkedApplication:linked,isSupplyIntake:true};
}
export function listSupplyIntakes(db) {
  initSupplyIntakeSchema(db);
  return db.prepare('SELECT source_submission_id FROM merchant_supply_intake ORDER BY created_at DESC,source_submission_id LIMIT 1000').all()
    .map(row=>getSupplyIntake(db,row.source_submission_id)).filter(row=>!row.linkedApplication);
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
