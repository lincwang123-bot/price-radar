import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPublicDirectoryCache} from '../lib/public-directory-cache.mjs';

test('public directory cache reuses computation but invalidates on either connection and quote expiry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'directory-cache-')),path=join(dir,'public.sqlite');
 const db=new DatabaseSync(path),writer=new DatabaseSync(path);let now=1000,calls=0;
 db.exec('CREATE TABLE quotes(price INTEGER); INSERT INTO quotes VALUES(100)');
 const read=createPublicDirectoryCache(connection=>({value:{price:connection.prepare('SELECT price FROM quotes').get().price,sequence:++calls},validUntil:now+100}),{now:()=>now,maxAgeMs:15000});
 try{
  const first=read(db);assert.strictEqual(read(db),first);assert.equal(calls,1);
  writer.exec('UPDATE quotes SET price=120');assert.equal(read(db).price,120);assert.equal(calls,2);
  db.exec('UPDATE quotes SET price=140');assert.equal(read(db).price,140);assert.equal(calls,3);
  now=1099;assert.equal(read(db).sequence,3);now=1100;assert.equal(read(db).sequence,4);
  const other=new DatabaseSync(':memory:');try{other.exec('CREATE TABLE quotes(price INTEGER); INSERT INTO quotes VALUES(7)');assert.equal(read(other).price,7);}finally{other.close();}
  now=900;assert.equal(read(db).sequence,6,'clock rollback never reuses future projection');
 }finally{writer.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('TTL is bounded and failed loads are never cached',()=>{
 const db=new DatabaseSync(':memory:');let now=0,calls=0,fail=false;
 const read=createPublicDirectoryCache(()=>{calls++;if(fail)throw new Error('read failed');return {value:{calls}};},{now:()=>now,maxAgeMs:100});
 try{assert.equal(read(db).calls,1);now=99;assert.equal(read(db).calls,1);now=100;fail=true;assert.throws(()=>read(db),/read failed/);fail=false;assert.equal(read(db).calls,3);}finally{db.close();}
});
