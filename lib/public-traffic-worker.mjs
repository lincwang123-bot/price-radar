import {DatabaseSync} from 'node:sqlite';
import {parentPort,workerData} from 'node:worker_threads';

const day=value=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
let db;
try{
 const date=new Date(workerData.date),today=day(date),start=day(new Date(date.getTime()-29*86400000));
 db=new DatabaseSync(workerData.dbPath,{readOnly:true});
 db.exec('PRAGMA busy_timeout=5; PRAGMA query_only=ON; BEGIN');
 const totals=db.prepare('SELECT COALESCE(SUM(pv),0) totalPv,COALESCE(SUM(CASE WHEN day>=? AND day<=? THEN pv ELSE 0 END),0) monthPv FROM analytics_days').get(start,today);
 const unique=db.prepare('SELECT COUNT(DISTINCT visitor) uv FROM analytics_visitors WHERE day>=? AND day<=?').get(start,today);
 const meta=db.prepare("SELECT value FROM analytics_meta WHERE key='started_at'").get();
 db.exec('COMMIT');
 parentPort.postMessage({available:true,healthy:true,historicalPv:Number(totals.totalPv),pv:Number(totals.monthPv),uv:Number(unique.uv),startedAt:meta?.value});
}catch{
 // Do not pass database paths, SQL errors or visitor data to the public worker consumer.
 parentPort.postMessage({available:false});
}finally{try{db?.close();}catch{}}
