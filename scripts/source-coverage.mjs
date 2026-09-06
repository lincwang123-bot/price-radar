#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../lib/config.mjs';
import { coverageFromDb, replacementGate, coverageMarkdown, recordCoverageDaily } from '../lib/source-coverage.mjs';
const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const dbPath=path.resolve(arg('--db')||loadConfig().dbPath);
const db=new DatabaseSync(dbPath,{readOnly:true});
try {
 const result=coverageFromDb(db),record=arg('--record');
 if(record&&path.resolve(record)===dbPath)throw new Error('验收记录不能覆盖行情库');
 const gate=record?recordCoverageDaily(db,record).gate:replacementGate([result]);
 const report=coverageMarkdown(result,gate),reportPath=arg('--report');
 if(reportPath){if([dbPath,record&&path.resolve(record)].includes(path.resolve(reportPath)))throw new Error('报告不能覆盖数据库或验收记录');writeFileSync(reportPath,report,{flag:'wx'});}
 console.log(args.includes('--json')?JSON.stringify({...result,gate},null,2):report);
} finally {db.close();}
