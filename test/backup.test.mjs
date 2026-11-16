import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openSubmissionsDb, createSubmission } from "../lib/submissions.mjs";
import { backupSubmissions, verifyBackup } from "../lib/backup.mjs";
import { openAnalytics } from "../lib/analytics.mjs";

test("在线备份包含已提交 WAL，隔离恢复且保护原库", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "radar-backup-test-"));
  const dbPath = path.join(root, "live.sqlite"), directory = path.join(root, "backups");
  const db = openSubmissionsDb(dbPath);
  try {
    createSubmission(db, { kind: "feedback", topic: "suggestion", details: "fixture-only" });
    const result = await backupSubmissions(dbPath, directory);
    assert.equal(result.counts.feedback_submissions, 1);
    assert.equal(statSync(path.join(directory, result.file)).mode & 0o777, 0o600);
    assert.deepEqual(verifyBackup(path.join(directory, result.file)).counts, result.counts);
    assert.equal(db.prepare("select count(*) n from feedback_submissions").get().n, 1);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("统计库独立一致性备份，验证统计表而不暴露明细",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"radar-metrics-backup-")),file=path.join(root,"analytics.sqlite"),dir=path.join(root,"backups");const a=openAnalytics(file,"fixture-analytics-secret-32-characters");
 try{const result=await backupSubmissions(file,dir,{kind:"analytics"});assert.equal(result.counts.analytics_days,0);assert.equal(result.quickCheck,"ok");assert.equal(statSync(path.join(dir,result.file)).mode&0o777,0o600);}
 finally{a.close();rmSync(root,{recursive:true,force:true});}
});

test("两类备份默认各保留最近三份，轮换不影响另一类及无关文件，保留副本可恢复",async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"radar-backup-retention-")),directory=path.join(root,"backups");
 const sources={submissions:path.join(root,"submissions.sqlite"),analytics:path.join(root,"analytics.sqlite")};
 const submissions=openSubmissionsDb(sources.submissions),analytics=openAnalytics(sources.analytics,"fixture-analytics-secret-32-characters");
 try {
  mkdirSync(directory);
  const unrelated={"operator-notes.txt":"retain notes","submissions-handwritten.sqlite":"retain unrelated sqlite","analytics-handwritten.sqlite":"retain other unrelated sqlite"};
  for(const [name,content] of Object.entries(unrelated))writeFileSync(path.join(directory,name),content);
  const generated={submissions:[],analytics:[]};
  const namesFor=kind=>readdirSync(directory).filter(name=>name.startsWith(kind+"-")).sort();
  for(let day=1;day<=4;day++) {
   createSubmission(submissions,{kind:"feedback",topic:"suggestion",details:`fixture retention day ${day}`});
   for(const kind of ["submissions","analytics"]) {
    const other=kind==="submissions"?"analytics":"submissions",otherBefore=namesFor(other);
    const result=await backupSubmissions(sources[kind],directory,{kind,now:new Date(Date.UTC(2026,0,day))});
    assert.equal(result.keep,3);generated[kind].push(result);
    assert.deepEqual(namesFor(other),otherBefore);
   }
  }
  for(const kind of ["submissions","analytics"]) {
   assert.equal(existsSync(path.join(directory,generated[kind][0].file)),false);
   const retained=generated[kind].slice(1);
   assert.deepEqual(namesFor(kind).filter(name=>!Object.hasOwn(unrelated,name)),retained.map(result=>result.file).sort());
   for(const result of retained) {
    const verified=verifyBackup(path.join(directory,result.file),{kind});
    assert.equal(verified.quickCheck,"ok");assert.deepEqual(verified.counts,result.counts);
   }
  }
  assert.deepEqual(generated.submissions.slice(1).map(result=>result.counts.feedback_submissions),[2,3,4]);
  for(const [name,content] of Object.entries(unrelated))assert.equal(readFileSync(path.join(directory,name),"utf8"),content);
 } finally {submissions.close();analytics.close();rmSync(root,{recursive:true,force:true});}
});
