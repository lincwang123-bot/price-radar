// Explicit, bounded private-data migration. Never approves, grants consent or merges contacts.
import path from 'node:path';
import {existsSync} from 'node:fs';
import { openSubmissionsDb } from '../lib/submissions.mjs';
import { importSupplyIntakes, listSupplyIntakes } from '../lib/merchant-intake.mjs';
const [file,...ids]=process.argv.slice(2);
if(!file||!path.isAbsolute(file)||!ids.length)throw new Error('Usage: node scripts/import-supply-intakes.mjs /absolute/submissions.sqlite CO-id ...');
if(!existsSync(file))throw new Error('Target private database does not exist');
const db=openSubmissionsDb(file);
try {
  const result=importSupplyIntakes(db,ids,{actor:'owner-requested-import'});
  const targets=listSupplyIntakes(db).filter(row=>ids.includes(row.id));
  console.log(JSON.stringify({...result,requested:ids.length,present:targets.length,needsEmail:targets.filter(x=>!x.email).length,invalidUrl:targets.filter(x=>x.urlError).length,existingApplication:targets.filter(x=>x.existingApplication).length}));
}finally{db.close();}
