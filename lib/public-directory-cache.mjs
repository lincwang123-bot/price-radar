// One public-data projection per DB connection. Never cache HTML, readers,
// review decisions, badges or other state from the private submissions DB.
export function createPublicDirectoryCache(load,{now=Date.now,maxAgeMs=15000}={}) {
 const connections=new WeakMap();
 return db=>{
  let cache=connections.get(db);
  if(!cache){cache={version:db.prepare('PRAGMA data_version'),changes:db.prepare('SELECT total_changes() AS n')};connections.set(db,cache);}
  // data_version detects other connections; total_changes detects this one.
  const revision=cache.version.get().data_version+':'+cache.changes.get().n,time=now();
  if(cache.revision===revision&&time>=cache.builtAt&&time<cache.until)return cache.value;
  const result=load(db,time);
  cache.revision=revision;cache.builtAt=time;
  cache.until=Math.min(time+maxAgeMs,result.validUntil??Infinity);cache.value=result.value;
  return result.value;
 };
}
