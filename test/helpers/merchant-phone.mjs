import {initAccountProfileSchema} from '../../lib/account-profile.mjs';

// Synthetic contact data; no SMS provider is called.
export function verifyApplicationPhone(db,id){
 initAccountProfileSchema(db);
 const account='fixture-'+id,phone='+861'+ '3800000000',at='2026-09-01T00:00:00Z';
 db.prepare('INSERT OR REPLACE INTO reader_profiles(account_id,phone,contact_type,contact_value,updated_at) VALUES(?,?,?,?,?)').run(account,phone,'telegram','fixture_owner',at);
 db.prepare('INSERT OR REPLACE INTO reader_phone_verifications(account_id,phone,verified_at) VALUES(?,?,?)').run(account,phone,at);
 db.prepare('UPDATE merchant_applications SET applicant_account_id=?,phone=? WHERE public_id=?').run(account,phone,id);
}
