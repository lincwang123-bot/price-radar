// Dry-run by default; only exact legacy defaults are eligible. No database writes.
import {readFileSync,writeFileSync,renameSync,statSync,unlinkSync,mkdirSync,chmodSync,lstatSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
export function migrateWatchDefaults(config){
 const next=structuredClone(config),changed=[];
 for(const rule of next.watch?.rules||[]){
  const min=rule.id==='chatgpt-plus-recharge-below-105'&&rule.kind==='min_below'&&rule.source==='priceai'&&rule.product==='chatgpt-plus-recharge'&&rule.threshold===105;
  const drop=rule.id==='chatgpt-any-drop-8pct'&&rule.kind==='drop_pct'&&rule.source==='priceai'&&rule.window===24&&rule.pct===8;
  const allowed=new Set(min?['id','kind','source','product','threshold','enabled']:['id','kind','source','window','pct','enabled']);
  if(!(min||drop)||Object.keys(rule).some(k=>!allowed.has(k)))continue;
  rule.source='direct-shops';if(min){rule.term='1m';rule.currency='CNY';}changed.push(rule.id);
 }
 return {config:next,changed};
}
export function migrateFile(file,{apply=false}={}){
 const path=resolve(file),original=readFileSync(path,'utf8'),result=migrateWatchDefaults(JSON.parse(original));
 if(apply&&result.changed.length){
  const directory=join(dirname(path),'backups');mkdirSync(directory,{recursive:true,mode:0o700});if(lstatSync(directory).isSymbolicLink())throw new Error('备份目录不能是符号链接');chmodSync(directory,0o700);
  const suffix=Date.now()+'-'+process.pid,backup=join(directory,basename(path)+'.before-watch-migration-'+suffix),temp=join(directory,basename(path)+'.watch-migration-'+suffix);
  // Exact-byte rollback copy, exclusive create, same-directory atomic replacement.
  writeFileSync(backup,original,{flag:'wx',mode:0o600});
  writeFileSync(temp,JSON.stringify(result.config,null,2)+'\n',{flag:'wx',mode:statSync(path).mode&0o777&0o600});
  let replaced=false;
  try{if(readFileSync(path,'utf8')!==original)throw new Error('配置已被其他进程修改，未替换原文件');renameSync(temp,path);replaced=true;}
  finally{if(!replaced)unlinkSync(temp);}
 }
 return {changed:result.changed,applied:apply&&result.changed.length>0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),index=args.indexOf('--config');
 if(index<0||!args[index+1]||args.some((v,i)=>!['--apply','--config'].includes(v)&&i!==index+1))throw new Error('用法: node scripts/migrate-watch-defaults.mjs --config /absolute/config.json [--apply]');
 console.log(JSON.stringify(migrateFile(args[index+1],{apply:args.includes('--apply')})));
}
