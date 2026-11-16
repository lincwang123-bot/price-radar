// Explicit maintenance cutoff, never a public HTTP/user-controlled bypass.
// Returning the normalized ISO value also gives a stable per-round marker.
export function normalizeRefreshBefore(value,now=Date.now()){
  if(value===undefined)return undefined;
  const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const ms=match?Date.parse(value):NaN;
  const calendar=match?new Date(Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5],+match[6])):null;
  if(!match||!Number.isFinite(ms)||ms>now+1000||calendar.getUTCFullYear()!==+match[1]||calendar.getUTCMonth()!==+match[2]-1
    ||calendar.getUTCDate()!==+match[3]||calendar.getUTCHours()!==+match[4]||calendar.getUTCMinutes()!==+match[5]||calendar.getUTCSeconds()!==+match[6])
    throw new Error('refreshBefore 必须是有效 ISO 时间，且不能晚于当前时间 1 秒以上');
  return new Date(ms).toISOString();
}

export function refreshPending(refreshBefore,checkedAt,lastRefreshBefore){
  if(!refreshBefore)return false;
  const cutoff=Date.parse(refreshBefore),checked=Date.parse(checkedAt),completed=Date.parse(lastRefreshBefore);
  return (!Number.isFinite(checked)||checked<cutoff)&&(!Number.isFinite(completed)||completed<cutoff);
}
