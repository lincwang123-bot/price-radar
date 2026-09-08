import { MerchantApplicationError, getMerchantApplication } from './merchant-onboarding.mjs';
import { initSupplyIntakeSchema, getSupplyIntake } from './merchant-intake.mjs';

// Filter and paginate both sources together, so older imports cannot displace new applications.
const queue=`WITH queue AS (
  SELECT public_id AS id,status,created_at AS submitted_at FROM merchant_applications
  UNION ALL
  SELECT i.source_submission_id,i.status,s.created_at FROM merchant_supply_intake i
  JOIN cooperation_submissions s ON s.public_id=i.source_submission_id
  WHERE NOT EXISTS (SELECT 1 FROM merchant_submission_links l WHERE l.source_submission_id=i.source_submission_id)
)`;
export function listMerchantReviewQueue(db,{status='pending',page=1}={}) {
  initSupplyIntakeSchema(db);
  if(!['pending','approved','rejected','paused'].includes(status))throw new MerchantApplicationError(422,'审核状态无效');
  const counts={pending:0,approved:0,rejected:0,paused:0};
  for(const row of db.prepare(`${queue} SELECT status,COUNT(*) count FROM queue GROUP BY status`).all())counts[row.status]=Number(row.count);
  const total=counts[status],pageSize=30;
  const pageNumber=Math.max(1,Math.min(Math.ceil(total/pageSize)||1,Number.parseInt(page,10)||1));
  const rows=db.prepare(`${queue} SELECT id FROM queue WHERE status=? ORDER BY submitted_at DESC,id DESC LIMIT ? OFFSET ?`).all(status,pageSize,(pageNumber-1)*pageSize);
  const items=rows.map(row=>row.id.startsWith('CO-')?getSupplyIntake(db,row.id):getMerchantApplication(db,row.id));
  return {items,total,counts,page:pageNumber,pageSize};
}
