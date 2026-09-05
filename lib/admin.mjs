import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { backupStatus } from "./backup.mjs";
import { updateSubmissionStatus, SubmissionError } from "./submissions.mjs";

const scrypt = promisify(scryptCallback);
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statuses = ["new", "reviewing", "resolved", "contacted", "accepted", "closed", "rejected"];
const token = () => randomBytes(32).toString("base64url");
const equal = (a,b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie = (req,name) => String(req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1) || "";
const cookieValue = (name,value,maxAge) => `${name}=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const page = (title,body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 站长后台</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f3f5f7;color:#192b35}main{max-width:980px;padding:24px;margin:auto}a{color:#1458a0}nav{display:flex;gap:18px;flex-wrap:wrap}section,article,form{background:white;border:1px solid #dce2e6;border-radius:12px;padding:18px;margin:18px 0}label{display:block;margin:12px 0}input,select,textarea,button{font:inherit;padding:10px;max-width:100%;box-sizing:border-box}textarea{width:100%;min-height:120px}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#526570}h1{font-size:26px}dl{overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0 0 14px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}.table{overflow:auto}</style><main><nav><a href="/admin">收件箱</a><a href="/admin/health">采集与备份</a><a href="/">公开站点</a></nav><h1>${escape(title)}</h1>${body}</main></html>`;
function html(res,status,title,body) { res.statusCode=status;res.setHeader("Content-Type","text/html; charset=utf-8");res.end(page(title,body)); }
function redirect(res,url) {res.statusCode=303;res.setHeader("Location",url);res.end();}
function csrfInput(value) {return `<input type="hidden" name="csrf" value="${escape(value)}">`;}
async function form(req) {
  if (!String(req.headers["content-type"]||"").startsWith("application/x-www-form-urlencoded")) throw new SubmissionError(415,"请求格式无效");
  let bytes=0;const chunks=[];
  for await(const part of req){bytes+=part.length;if(bytes>16384){throw new SubmissionError(413,"请求过大");}chunks.push(part);}
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}
export async function hashAdminPassword(password) {
  if(typeof password!=="string" || password.length<16 || password.length>256) throw new Error("管理员口令长度必须为16–256字符");
  const salt=randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString("hex")}`;
}
export function createAdmin({submissionsDb,db,backupDir,username=process.env.ADMIN_USERNAME,passwordHash=process.env.ADMIN_PASSWORD_HASH,origin=process.env.PUBLIC_ORIGIN,now=()=>Date.now()}) {
  const sessions=new Map(),attempts=new Map();
  let activePasswordChecks=0;
  const hash=/^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(passwordHash||"");
  const enabled=!!(submissionsDb&&username&&hash&&/^https:\/\/[^/]+$/.test(origin||""));
  function session(req){const key=cookie(req,"airadar_admin");const s=sessions.get(key);if(s&&s.expires>now())return s;sessions.delete(key);return null;}
  return async function admin(req,res,url) {
    if(!url.pathname.startsWith("/admin")) return false;
    res.setHeader("Cache-Control","no-store");res.setHeader("X-Robots-Tag","noindex, nofollow");
    res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if(!enabled){html(res,404,"页面不存在","后台尚未启用。");return true;}
    try {
      if(url.pathname==="/admin/login") {
        if(req.method==="GET") {const t=token();res.setHeader("Set-Cookie",cookieValue("airadar_admin_login",t,600));html(res,200,"站长登录",`<form method="post">${csrfInput(t)}<label>用户名 <input name="username" autocomplete="username" required maxlength="100"></label><label>口令 <input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>登录</button></form>`);return true;}
        if(req.method!=="POST")throw new SubmissionError(405,"请求方法无效");
        if(req.headers.origin!==origin)throw new SubmissionError(403,"提交来源无效");
        const f=await form(req);if(!equal(f.csrf,cookie(req,"airadar_admin_login"))||f.csrf.length<32)throw new SubmissionError(403,"请刷新登录页");
        const remote=String(req.socket.remoteAddress||"");const local=["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote);
        const client=local?String(req.headers["cf-connecting-ip"]||remote).slice(0,64):remote;
        for(const[k,v]of attempts)if(v.until<=now())attempts.delete(k);
        const rate=attempts.get(client)||{count:0,until:now()+15*60_000};
        if(rate.count>=5||attempts.size>=2000&&!attempts.has(client))throw new SubmissionError(429,"登录过于频繁，请15分钟后重试");
        rate.count++;attempts.set(client,rate);
        if(activePasswordChecks>=4)throw new SubmissionError(429,"登录繁忙，请稍后再试");
        let computed;activePasswordChecks++;
        try{computed=await scrypt(String(f.password||"").slice(0,256),hash[1],64);}finally{activePasswordChecks--;}
        if(!equal(f.username,username)||!timingSafeEqual(computed,Buffer.from(hash[2],"hex")))throw new SubmissionError(401,"用户名或口令错误");
        attempts.delete(client);for(const[k,v]of sessions)if(v.expires<=now())sessions.delete(k);
        if(sessions.size>=64)sessions.delete(sessions.keys().next().value);
        const t=token();sessions.set(t,{csrf:token(),expires:now()+3600_000});
        res.setHeader("Set-Cookie",[cookieValue("airadar_admin",t,3600),cookieValue("airadar_admin_login","",0)]);redirect(res,"/admin");return true;
      }
      const s=session(req);if(!s){redirect(res,"/admin/login");return true;}
      if(req.method==="POST") {
        if(req.headers.origin!==origin)throw new SubmissionError(403,"提交来源无效");
        const f=await form(req);if(!equal(f.csrf,s.csrf))throw new SubmissionError(403,"页面验证失败，请刷新");
        if(url.pathname==="/admin/logout"){sessions.delete(cookie(req,"airadar_admin"));res.setHeader("Set-Cookie",cookieValue("airadar_admin","",0));redirect(res,"/admin/login");return true;}
        const m=/^\/admin\/submission\/(FB-[A-Z0-9-]+|CO-[A-Z0-9-]+)$/.exec(url.pathname);
        if(!m)throw new SubmissionError(404,"页面不存在");
        if(!updateSubmissionStatus(submissionsDb,m[1],f.status,{actor:username,note:f.note||""}))throw new SubmissionError(404,"记录不存在");
        redirect(res,url.pathname);return true;
      }
      if(req.method!=="GET")throw new SubmissionError(405,"请求方法无效");
      const logout=`<form method="post" action="/admin/logout">${csrfInput(s.csrf)}<button>退出登录</button></form>`;
      if(url.pathname==="/admin/health") {
        const rows=db.prepare("SELECT source,MAX(fetched_at) last_snapshot,COUNT(*) snapshots FROM snapshots GROUP BY source").all();
        const health=db.prepare("SELECT key,value FROM meta WHERE key LIKE 'health:%'").all().map(r=>{try{return JSON.parse(r.value);}catch{return{source:r.key,status:"状态格式无效"};}});
        html(res,200,"采集与备份",`<section><h2>行情快照</h2><pre>${escape(JSON.stringify(rows,null,2))}</pre><h2>最近采集状态</h2><pre>${escape(JSON.stringify(health,null,2))}</pre></section><section><h2>本机备份</h2><pre>${escape(JSON.stringify(backupDir?backupStatus(backupDir):{ok:false,message:"未配置备份目录"},null,2))}</pre><p>本机备份不能防止整台主机丢失；尚未配置异地副本。</p></section>${logout}`);return true;
      }
      const m=/^\/admin\/submission\/(FB-[A-Z0-9-]+|CO-[A-Z0-9-]+)$/.exec(url.pathname);
      if(m){const table=m[1].startsWith("FB-")?"feedback_submissions":"cooperation_submissions";const row=submissionsDb.prepare(`SELECT * FROM ${table} WHERE public_id=?`).get(m[1]);if(!row)throw new SubmissionError(404,"记录不存在");
        const actions=submissionsDb.prepare("SELECT created_at,actor,previous_status,status,note FROM submission_actions WHERE public_id=? ORDER BY id DESC").all(m[1]);
        const fields=Object.entries(row).filter(([k])=>!["client_hash","content_hash","id"].includes(k));
        html(res,200,row.public_id,`<section><dl>${fields.map(([k,v])=>`<dt>${escape(k)}</dt><dd><pre>${escape(v)}</pre></dd>`).join("")}</dl></section><form method="post">${csrfInput(s.csrf)}<label>处理状态 <select name="status">${statuses.map(v=>`<option${v===row.status?' selected':''}>${v}</option>`).join("")}</select></label><label>内部备注<textarea name="note" maxlength="2000"></textarea></label><button>保存处理记录</button></form><section><h2>处理历史</h2>${actions.map(a=>`<article><small>${escape(a.created_at)} · ${escape(a.actor)} · ${escape(a.previous_status)} → ${escape(a.status)}</small><pre>${escape(a.note)}</pre></article>`).join("")||"尚未处理"}</section>${logout}`);return true;}
      if(url.pathname!=="/admin"&&url.pathname!=="/admin/")throw new SubmissionError(404,"页面不存在");
      const kind=["feedback","supply","demand"].includes(url.searchParams.get("kind"))?url.searchParams.get("kind"):"feedback";
      const status=statuses.includes(url.searchParams.get("status"))?url.searchParams.get("status"):"";
      const n=Math.max(1,Math.min(100000,parseInt(url.searchParams.get("page"),10)||1));
      const table=kind==="feedback"?"feedback_submissions":"cooperation_submissions";const clauses=[],args=[];
      if(kind!=="feedback"){clauses.push("topic=?");args.push(kind);}if(status){clauses.push("status=?");args.push(status);}
      const where=clauses.length?" WHERE "+clauses.join(" AND "):"";
      const total=Number(submissionsDb.prepare(`SELECT COUNT(*) n FROM ${table}${where}`).get(...args).n);
      const rows=submissionsDb.prepare(`SELECT public_id,created_at,subject,status FROM ${table}${where} ORDER BY id DESC LIMIT 25 OFFSET ?`).all(...args,(n-1)*25);
      const link=p=>`/admin?${new URLSearchParams({kind,status,page:String(p)})}`;
      html(res,200,"投稿收件箱",`<form method="get"><label>类型 <select name="kind">${[["feedback","反馈"],["supply","供应"],["demand","采购"]].map(([v,l])=>`<option value="${v}"${v===kind?' selected':''}>${l}</option>`).join("")}</select></label><label>状态 <select name="status"><option value="">全部</option>${statuses.map(v=>`<option${v===status?' selected':''}>${v}</option>`).join("")}</select></label><button>筛选</button></form><p>共 ${total} 条 · 第 ${n} 页</p>${rows.map(r=>`<article><a href="/admin/submission/${escape(r.public_id)}">${escape(r.subject||r.public_id)}</a><br><small>${escape(r.created_at)} · ${escape(r.status)}</small></article>`).join("")||"暂无投稿"}<nav>${n>1?`<a href="${escape(link(n-1))}">上一页</a>`:""}${n*25<total?`<a href="${escape(link(n+1))}">下一页</a>`:""}</nav>${logout}`);return true;
    }catch(error){if(error instanceof SubmissionError){html(res,error.status,"请求未完成",`<p>${escape(error.message)}</p><a href="/admin">返回后台</a>`);return true;}throw error;}
  };
}
