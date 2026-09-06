import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { backupStatus } from "./backup.mjs";
import {offsiteReceiptStatus} from './offsite-backup.mjs';
import {coverageFromDb,replacementGate,readCoverageLedger} from './source-coverage.mjs';
import {loadConfig} from './config.mjs';

export function coverageSummary(db) {
  try{const r=coverageFromDb(db),gate=replacementGate(readCoverageLedger(loadConfig().dataDir));
    return `<details><summary>独立采集覆盖验收：${escape(r.status)} · ${r.comparableGroups} 个可比组</summary><p>样本覆盖 ${r.coveredGroups??'不可判定'} 组；信息不足 ${r.unresolvedGroups} 组。${escape(gate.note)}</p><p>PriceAI 仅为可见公开样本，不代表其全站覆盖。这是内部独立采集替代验收，不是商家主动提交/API 第一方报价占比。</p></details>`;
  }catch{return '<details><summary>独立采集覆盖验收暂不可用</summary><p>继续保留补缺来源，等待可核对的同范围样本。</p></details>';}
}

export function backupEvidenceLabel(b) {
  if(!b.ok)return '暂无有效备份或备份已过期';
  return b.integrity==='sha256'?'文件 SHA-256 与大小校验通过；备份生成时已执行 SQLite 隔离恢复检查':'旧版备份仅核对文件存在与大小；没有 SHA-256，不能确认内容完整性';
}
export function macReceiptContent(receipt) {
  const label={recent:'最近同步已确认',stale:'回执已过期：超过 36 小时未确认同步',unconfigured:'尚无 Mac 回执：未配置或尚未首次同步',invalid:'回执无效，无法确认同步'}[receipt.state];
  return `<h2>Mac 异机备份</h2><p>${label}</p>${receipt.checkedAt?`<p>Mac 最近验证：${escape(displayTime(receipt.checkedAt))} · 加密档案 ${Math.ceil(receipt.encryptedBytes/1024)} KB</p>`:''}<p>回执由 Mac 完成 AES-256-GCM 鉴别、SHA-256 与三个 SQLite quick_check 后经 SSH 上传。它说明当次本地数据副本校验成功，不表示服务器能持续访问 Mac 文件，也不表示已验证整机灾难恢复。</p><p>服务器投稿与统计备份各保留最多 14 份；Mac 独立加密版本保留全部历史。密钥与环境配置仍需单独安全保管。</p>`;
}
import { updateSubmissionStatus, SubmissionError } from "./submissions.mjs";
import { analyticsContent, exportAnalytics,merchantSummary } from "./admin-analytics.mjs";
import { adminPage } from "./admin-ui.mjs";

const scrypt = promisify(scryptCallback);
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statuses = ["new", "reviewing", "resolved", "contacted", "accepted", "closed", "rejected"];
const words={sponsor_apply:"广告申请",merchant_claim:"店铺认领",new:"待处理",reviewing:"核实中",resolved:"已解决",contacted:"已联系",accepted:"已采纳",closed:"已关闭",rejected:"不采纳",suggestion:"建议",other:"其他",supply:"供应",demand:"采购",price_wrong:"价格有误",sold_out:"库存有误",warranty_wrong:"质保有误",category_wrong:"分类有误",dead_link:"链接失效",missing_item:"缺少商品",page_problem:"页面问题",full_warranty:"全程质保",subscription_cover:"订阅期保障",activation_only:"仅保激活",conditional:"有条件保障",none:"无保障",negotiable:"可协商",trial:"试单",small:"小批量",monthly:"按月",large:"大批量",cny:"人民币",usdt:"USDT",both:"人民币或USDT",ok:"正常",cached:"使用有效缓存",stale:"核验失败，暂用缓存",unavailable:"暂不可用",failed:"失败"};
const fieldsZh={public_id:"投稿编号",created_at:"提交时间",topic:"类型",subject:"标题",details:"详细说明",context_url:"相关链接",source_url:"证明链接",contact:"联系方式",status:"处理状态",product_area:"产品方向",scale:"合作规模",assurance:"保障方式",settlement:"结算方式",consent_at:"确认提交时间"};
const label=value=>words[value]||value;
const options=current=>statuses.map(v=>`<option value="${v}"${v===current?' selected':''}>${words[v]}</option>`).join("");
const displayTime=value=>value?new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}):"暂无记录";
const token = () => randomBytes(32).toString("base64url");
const equal = (a,b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie = (req,name) => String(req.headers.cookie || "").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1) || "";
const cookieValue = (name,value,maxAge) => `${name}=${value}; Path=${name==="airadar_admin"?"/":"/admin"}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
function html(res,status,title,body) { res.statusCode=status;res.setHeader("Content-Type","text/html; charset=utf-8");res.end(adminPage(title,body)); }
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
export function createAdmin({submissionsDb,db,backupDir,analytics,username=process.env.ADMIN_USERNAME,passwordHash=process.env.ADMIN_PASSWORD_HASH,origin=process.env.PUBLIC_ORIGIN,now=()=>Date.now()}) {
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
      if(url.pathname==="/admin/analytics"){html(res,200,"访问统计",analyticsContent(analytics,Number(url.searchParams.get("days")))+merchantSummary(analytics)+logout);return true;}
      if(url.pathname==="/admin/analytics.csv"){exportAnalytics(res,analytics,Number(url.searchParams.get("days")));return true;}
      if(url.pathname==="/admin/health") {
        const rows=db.prepare("SELECT source,MAX(fetched_at) last_snapshot,COUNT(*) snapshots FROM snapshots GROUP BY source").all();
        const health=db.prepare("SELECT key,value FROM meta WHERE key LIKE 'health:%'").all().map(r=>{try{return JSON.parse(r.value);}catch{return{source:r.key,status:"状态格式无效"};}});
        const backups=[['投稿',backupDir],['访问统计',process.env.ANALYTICS_BACKUP_DIR]].map(([name,dir])=>{const b=dir?backupStatus(dir):{ok:false};return `<article><h3>${name}</h3><p>${backupEvidenceLabel(b)}</p><p>最近备份：${escape(displayTime(b.createdAt))} · 大小：${b.bytes?Math.ceil(b.bytes/1024)+" KB":"—"}</p></article>`;}).join("")+macReceiptContent(offsiteReceiptStatus())+coverageSummary(db);
        html(res,200,"采集与备份",`<section><h2>行情快照</h2><div class="table"><table><thead><tr><th>数据来源</th><th>最后快照（北京时间）</th><th>累计快照</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.source)}</td><td>${escape(displayTime(r.last_snapshot))}</td><td>${Number(r.snapshots)}</td></tr>`).join("")}</tbody></table></div><h2>最近采集状态</h2>${health.map(h=>`<article><strong>${escape(h.source)}</strong> · ${escape(label(h.status||""))}<p>${escape(displayTime(h.checkedAt))}</p>${h.targets?`<ul>${h.targets.map(t=>`<li>${escape(t.name)}：${escape(label(t.status))} · 最近成功 ${escape(displayTime(t.lastSuccess))}</li>`).join("")}</ul>`:""}</article>`).join("")||"尚无采集状态记录"}</section><section><h2>本机备份</h2>${backups}<p>服务器本机副本不能防止整台主机丢失，异机确认以以上回执为准。</p></section>${logout}`);return true;
      }
      const m=/^\/admin\/submission\/(FB-[A-Z0-9-]+|CO-[A-Z0-9-]+)$/.exec(url.pathname);
      if(m){const table=m[1].startsWith("FB-")?"feedback_submissions":"cooperation_submissions";const row=submissionsDb.prepare(`SELECT * FROM ${table} WHERE public_id=?`).get(m[1]);if(!row)throw new SubmissionError(404,"记录不存在");
        const actions=submissionsDb.prepare("SELECT created_at,actor,previous_status,status,note FROM submission_actions WHERE public_id=? ORDER BY id DESC").all(m[1]);
        const fields=Object.entries(row).filter(([k])=>!["client_hash","content_hash","id"].includes(k));
        html(res,200,"投稿详情",`<section><dl>${fields.map(([k,v])=>`<dt>${escape(fieldsZh[k]||k)}</dt><dd><pre>${escape(k.endsWith("_at")?displayTime(v):["status","topic","scale","assurance","settlement"].includes(k)?label(v):v||"未填写")}</pre></dd>`).join("")}</dl></section><form method="post">${csrfInput(s.csrf)}<label>处理状态 <select name="status">${options(row.status)}</select></label><label>内部备注<textarea name="note" maxlength="2000"></textarea></label><button>保存处理记录</button></form><section><h2>处理历史</h2>${actions.map(a=>`<article><small>${escape(displayTime(a.created_at))} · ${escape(a.actor)} · ${escape(label(a.previous_status))} → ${escape(label(a.status))}</small><pre>${escape(a.note)}</pre></article>`).join("")||"尚未处理"}</section>${logout}`);return true;}
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
      html(res,200,"投稿收件箱",`<form method="get"><label>类型 <select name="kind">${[["feedback","反馈"],["supply","供应"],["demand","采购"]].map(([v,l])=>`<option value="${v}"${v===kind?' selected':''}>${l}</option>`).join("")}</select></label><label>状态 <select name="status"><option value="">全部</option>${options(status)}</select></label><button>筛选</button></form><p>共 ${total} 条 · 第 ${n} 页</p>${rows.map(r=>`<article><a href="/admin/submission/${escape(r.public_id)}">${escape(r.subject||r.public_id)}</a><br><small>${escape(displayTime(r.created_at))} · ${escape(label(r.status))}</small></article>`).join("")||"暂无投稿"}<nav>${n>1?`<a href="${escape(link(n-1))}">上一页</a>`:""}${n*25<total?`<a href="${escape(link(n+1))}">下一页</a>`:""}</nav>${logout}`);return true;
    }catch(error){if(error instanceof SubmissionError){html(res,error.status,"请求未完成",`<p>${escape(error.message)}</p><a href="/admin">返回后台</a>`);return true;}throw error;}
  };
}
