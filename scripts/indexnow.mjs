// Manual release helper and opt-in semantic catalog task. No crawler hook or cookie access.
import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {indexNowAutoEnabled,indexNowDocuments,autoManifest} from '../lib/indexnow-auto.mjs';
import {randomUUID} from 'node:crypto';
import {planIndexNow,verifyIndexNowKey,verifyIndexNowPage,notifyIndexNow} from '../lib/indexnow.mjs';
const args=process.argv.slice(2),flags=new Map(),automatic=args.includes('--auto');
// Disabled automation exits before database/state access or network requests.
if(args.includes('--auto')){
 args.splice(args.indexOf('--auto'),1);
 if(!indexNowAutoEnabled(process.env.AIRADAR_INDEXNOW_AUTO)){console.log(JSON.stringify({disabled:true,submitted:0}));process.exit(0);}
 if(!args.includes('--state'))args.push('--state',process.env.AIRADAR_INDEXNOW_STATE||'seo-state/indexnow.json');
 if(!args.includes('--send'))args.push('--send');
}
for(let i=0;i<args.length;i++){
 const flag=args[i];if(!['--init','--send','--state','--manifest','--help'].includes(flag)||flags.has(flag))throw new Error('Unknown or duplicate option');
 if(['--state','--manifest'].includes(flag)){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing option value');flags.set(flag,args[++i]);}else flags.set(flag,true);
}
if(flags.has('--help')){
 console.log('Optional semantic task: --auto (requires AIRADAR_INDEXNOW_AUTO=1, AIRADAR_INDEXNOW_DB and initialized private state).\nInitialize after the public key is deployed: node scripts/indexnow.mjs --init --state /absolute/new-state.json\nDry run: node scripts/indexnow.mjs --state /absolute/state.json --manifest /absolute/reviewed-changes.json\nSend only a reviewed release: add --send. Successful receipt does not mean indexed.');
 process.exit(0);
}
if(!flags.has('--state')||(flags.has('--init')&&(flags.has('--send')||flags.has('--manifest'))))throw new Error('Use --state and either --init or --manifest [--send]');
const statePath=resolve(flags.get('--state')),lock=statePath+'.lock';
const fd=openSync(lock,'wx',0o600);
function save(state){
 const tmp=statePath+'.'+randomUUID()+'.tmp';
 try{writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,statePath);}finally{if(existsSync(tmp))unlinkSync(tmp);}
}
try{
 if(flags.has('--init')){
  if(existsSync(statePath))throw new Error('State exists; activation must not be reset');
  await verifyIndexNowKey();
  save({version:1,activatedAt:new Date().toISOString(),accepted:[],pending:[]});
  console.log(JSON.stringify({initialized:true,statePath,submitted:0}));
 }else{
  if(!flags.has('--manifest')&&!automatic)throw new Error('--manifest is required');
  const state=JSON.parse(readFileSync(statePath,'utf8'));
  let manifest;
  if(automatic){
   if(flags.has('--manifest'))throw new Error('--auto derives its semantic manifest; omit --manifest');
   if(!process.env.AIRADAR_INDEXNOW_DB)throw new Error('AIRADAR_INDEXNOW_DB must identify the local public catalog database');
   const db=new DatabaseSync(resolve(process.env.AIRADAR_INDEXNOW_DB),{readOnly:true});
   let documents;try{documents=indexNowDocuments(db);}finally{db.close();}
   const generated=autoManifest(documents,state);manifest=generated.manifest;
   // Save only after planning below; malformed state never gets initialized here.
   state.nextFingerprints=generated.fingerprints;
  }else manifest=JSON.parse(readFileSync(resolve(flags.get('--manifest')),'utf8'));
  const plan=planIndexNow(manifest,state);
  if(automatic){
   // Cooldown skips remain detectable on the next timer. Pending attempts do not retry.
   for(const item of plan.skipped.filter(x=>x.why==='five_minute_cooldown')){const path=new URL(item.url).pathname;if(state.fingerprints?.[path])state.nextFingerprints[path]=state.fingerprints[path];else delete state.nextFingerprints[path];}
   state.fingerprints=state.nextFingerprints;delete state.nextFingerprints;save(state);
  }
  if(!flags.has('--send')||!plan.selected.length){console.log(JSON.stringify({dryRun:!flags.has('--send'),submitted:0,...plan},null,2));}
  else{
   try{await verifyIndexNowKey();for(const item of plan.selected)await verifyIndexNowPage(item.url);}catch(error){state.lastResponse={at:new Date().toISOString(),error:String(error.message),stage:'preflight'};save(state);throw error;}
   // Save intent before sending. A timeout/crash leaves it pending, never auto-retried.
   const attemptedAt=new Date().toISOString();state.pending.push(...plan.selected.map(x=>({...x,attemptedAt})));save(state);
   let result;
   try{result=await notifyIndexNow(plan.selected);}catch(error){state.lastResponse={at:attemptedAt,error:String(error.message)};save(state);throw error;}
   if(result.accepted){state.accepted.push(...plan.selected.map(x=>({...x,submittedAt:attemptedAt,status:result.status})));state.pending=state.pending.filter(x=>!plan.selected.some(y=>x.url===y.url&&x.revision===y.revision));}
   // Rejections also remain pending until an operator reviews status/retry-after.
   state.lastResponse={at:new Date().toISOString(),...result};save(state);
   console.log(JSON.stringify({submitted:plan.selected.length,...result,skipped:plan.skipped},null,2));
   if(!result.accepted)process.exitCode=1;
  }
 }
}finally{closeSync(fd);unlinkSync(lock);}
