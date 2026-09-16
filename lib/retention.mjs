import {randomBytes,timingSafeEqual} from 'node:crypto';
import {retiredCatalogItem} from './catalog-policy.mjs';
import {readFileSync} from 'node:fs';
import {createRetentionStore,RetentionError,retentionDay} from './retention-store.mjs';
import {readRetentionMarket,observeMarket,marketHistory,weeklyMarket} from './retention-market.mjs';
import {drainRetentionMail} from './retention-mail.mjs';
import {mailConfiguration} from './merchant-mail.mjs';
import {createAccountAuth} from './account-auth.mjs';
import {accountProfile,saveAccountProfile} from './account-profile.mjs';

const clientScript=readFileSync(new URL('../assets/retention.js',import.meta.url),'utf8');
const clientStyle=readFileSync(new URL('../assets/retention.css',import.meta.url),'utf8');
const accountScript=readFileSync(new URL('../assets/account.js',import.meta.url),'utf8');
const accountStyle=readFileSync(new URL('../assets/account.css',import.meta.url),'utf8');
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='))?.slice(name.length+1)||'';
const same=(a,b)=>/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
function cookies(res,req,name,value,age,env){
 const secure=env.PUBLIC_ORIGIN?.startsWith('https://')||req.headers['x-forwarded-proto']==='https';
 const item=`${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure?'; Secure':''}`;
 res.setHeader('Set-Cookie',[...(Array.isArray(res.getHeader('Set-Cookie'))?res.getHeader('Set-Cookie'):[]),item]);
}
async function body(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new RetentionError('请使用 JSON 提交',415);
 if(Number(req.headers['content-length']||0)>20000)throw new RetentionError('提交内容过长',413);
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>20000)throw new RetentionError('提交内容过长',413);chunks.push(Buffer.from(chunk));}
 const data=Buffer.concat(chunks).toString('utf8');
 try{const value=JSON.parse(data);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new RetentionError('提交内容格式不正确');}
}
export function createRetention({db,submissionsDb,env=process.env,now=()=>new Date(),mailTransport,secret=env.RETENTION_SECRET||env.SUBMISSION_HASH_SECRET||randomBytes(32).toString('hex')}={}){
 const store=submissionsDb?createRetentionStore(submissionsDb,{secret,now}):null;
 const auth=store?createAccountAuth(store,{now}):null;
 let cached=null,last=0,running=null;const controller=new AbortController();
 const limits=new Map();let limitMinute=-1,total=0;
 function market(force=false){
  if(!cached||force||+now()-last>60000){
   cached=readRetentionMarket(db,{now:now()});last=+now();
   if(store){observeMarket(store.db,cached,now());
    const known=new Set(cached.groups.map(g=>g.id));
    for(const row of store.db.prepare('SELECT payload FROM retention_market').all()){
     const g=JSON.parse(row.payload);if(retiredCatalogItem(g))continue;if(!known.has(g.id))cached.groups.push({...g,state:'unknown',price:null,maxPrice:null});
     if(!cached.products.some(p=>p.key===g.productKey))cached.products.push({key:g.productKey,name:g.name,family:g.family});
    }
   }
  }
  return cached;
 }
 const service={store,market,
  account:req=>store?.session(cookie(req,'airadar_reader'))||null,
  hasPassword:id=>auth?.hasPassword(id)||false,
  profile:id=>store?accountProfile(store.db,id):null,
  history:(id,days=30)=>marketHistory(store?.db,id,days,now()),
  weekly:date=>weeklyMarket(store?.db,market(),{now:now(),date:date||retentionDay(now())}),
  async route(req,res,url){
   if(['/assets/retention.js','/assets/retention.css','/assets/account.js','/assets/account.css'].includes(url.pathname)){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');json(res,405,{error:'不支持的请求方法'});return true;}
    const css=url.pathname.endsWith('.css'),account=url.pathname.includes('/account.');res.setHeader('Content-Type',css?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(req.method==='HEAD'?'':account?(css?accountStyle:accountScript):(css?clientStyle:clientScript));return true;
   }
   if(!url.pathname.startsWith('/api/retention/'))return false;
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
   try{
    const action=url.pathname.slice('/api/retention/'.length);
    if(action==='market'&&req.method==='GET'){
     const m=market();json(res,200,{...m,groups:m.groups.map(({fingerprint,...g})=>g)});return true;
    }
    if(action==='share'&&req.method==='GET'){
     const date=url.searchParams.get('date'),report=service.weekly(date),g=report?.items.find(g=>g.id===url.searchParams.get('group'));
     if(!g)throw new RetentionError('该日期没有足够的同规格行情记录',404);
     json(res,200,{group:{...g,price:g.lastPrice},firstPrice:g.firstPrice,date:report.date});return true;
    }
    if(!store)throw new RetentionError('同步与提醒服务暂不可用，本机关注仍可使用',503);
    const a=store.session(cookie(req,'airadar_reader'));
    if(action==='state'&&req.method==='GET'){
     let csrf=cookie(req,'airadar_reader_csrf');if(!/^[a-f0-9]{64}$/.test(csrf)){csrf=randomBytes(32).toString('hex');cookies(res,req,'airadar_reader_csrf',csrf,86400,env);}
     json(res,200,{csrf,mailConfigured:mailConfiguration(env).configured,account:a?{email:a.email,emailEnabled:!!a.email_enabled,hasPassword:auth.hasPassword(a.id)}:null,watches:a?store.watches(a.id):[],notices:a?store.notices(a.id):[]});return true;
    }
    if(req.method!=='POST'){res.setHeader('Allow','POST');throw new RetentionError('仅支持 POST',405);}
    if(action==='unsubscribe'){
     // RFC 8058 one-click unsubscribe: possession of the scoped signature is
     // authorization. GET only displays a confirmation page, never mutates.
     let token=url.searchParams.get('token');
     if(!token)token=(await body(req)).token;
     store.unsubscribe(token);json(res,200,{ok:true});return true;
    }
    const origin=String(req.headers.origin||''),expected=env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
    if(origin!==expected||req.headers['sec-fetch-site']==='cross-site'||!same(String(req.headers['x-csrf-token']||''),cookie(req,'airadar_reader_csrf')))throw new RetentionError('页面验证已失效，请刷新后重试',403);
    const remote=req.socket.remoteAddress||'';
    const ip=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)?String(req.headers['cf-connecting-ip']||remote):remote;
    const minute=Math.floor(+now()/60000);if(minute!==limitMinute){limits.clear();total=0;limitMinute=minute;}
    const client=store.digest('request|'+ip),count=limits.get(client)||0;
    if(total>=600||count>=40)throw new RetentionError('请求较频繁，请稍后再试',429);limits.set(client,count+1);total++;
    const input=await body(req);
    if(action==='request-code'){
     if(!mailConfiguration(env).configured)throw new RetentionError('验证码邮件暂不可用，请稍后再试；已有账号仍可用密码登录',503);
     if(input.consent!==true)throw new RetentionError('请确认邮箱验证用途和隐私说明');
     json(res,200,auth.requestCode(input.email,client,input.purpose));return true;
    }
    if(action==='verify-code'){
     throw new RetentionError('本站已升级为邮箱和密码登录，请刷新页面后注册、登录或设置密码',410);
    }
    if(action==='login'||action==='register'){
     const result=action==='login'?await auth.login(input.email,input.password,client):await auth.register(input);
     store.logout(cookie(req,'airadar_reader'));
     cookies(res,req,'airadar_reader',result.token,30*86400,env);
     cookies(res,req,'airadar_reader_csrf',randomBytes(32).toString('hex'),86400,env);
     json(res,200,{ok:true});return true;
    }
    if(action==='reset-password'){
     await auth.reset(input);
     cookies(res,req,'airadar_reader','',0,env);
     cookies(res,req,'airadar_reader_csrf',randomBytes(32).toString('hex'),86400,env);
     json(res,200,{ok:true});return true;
    }
    if(action==='event'){
     const identity=a?.id||(/^[a-f0-9-]{20,64}$/.test(input.visitor||'')?'guest:'+input.visitor:null);
     if(identity)store.event(identity,input.kind,String(input.entity||''));json(res,200,{ok:true});return true;
    }
    if(!a)throw new RetentionError('请先登录',401);
    if(action==='profile'){
     if(!auth.hasPassword(a.id))throw new RetentionError('请先验证邮箱并设置账号密码',403);
     saveAccountProfile(store.db,a.id,input,now().toISOString());json(res,200,{ok:true});return true;
    }
    if(action==='save-watch'){json(res,200,{watch:store.saveWatch(a.id,input,market())});return true;}
    if(action==='remove-watch'){store.removeWatch(a.id,input.id);json(res,200,{ok:true});return true;}
    if(action==='email'){if(typeof input.enabled!=='boolean')throw new RetentionError('请选择提醒状态');store.setEmail(a.id,input.enabled);json(res,200,{ok:true});return true;}
    if(action==='logout'){store.logout(cookie(req,'airadar_reader'));cookies(res,req,'airadar_reader','',0,env);json(res,200,{ok:true});return true;}
    if(action==='delete-account'){
     store.setEmail(a.id,false);
     for(const table of ['retention_watches','retention_sessions','retention_notices','retention_mail','reader_credentials','reader_profiles'])store.db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(a.id);
     store.db.prepare('DELETE FROM retention_codes WHERE email=?').run(a.email);
     store.db.prepare('DELETE FROM retention_events WHERE visitor=?').run(store.digest('events|'+a.id));
     store.db.prepare('DELETE FROM retention_accounts WHERE id=?').run(a.id);
     store.db.prepare('DELETE FROM retention_meta WHERE key=?').run('last_digest:'+a.id);
     cookies(res,req,'airadar_reader','',0,env);json(res,200,{ok:true});return true;
    }
    throw new RetentionError('接口不存在',404);
   }catch(error){
    if(error instanceof RetentionError)json(res,error.status,{error:error.message});
    else{console.error('[retention] 请求未完成');json(res,503,{error:'服务暂时不可用，请稍后再试'});}
   }
   return true;
  },
  start(server){
   if(!store)return;
   const tick=()=>{
    if(running||controller.signal.aborted)return;
    running=(async()=>{try{const m=market();store.observe(m);store.purge();auth.purge();await drainRetentionMail(store,m,{env,transport:mailTransport,now:now(),signal:controller.signal});}catch{console.error('[retention] 提醒处理未完成，下轮重试');}})().finally(()=>{running=null;});
   };
   const timer=setInterval(tick,15000);timer.unref();server.once('listening',tick);
   server.once('close',()=>{clearInterval(timer);controller.abort();});server.retentionWorkflowDone=()=>running||Promise.resolve();
  },
 };
 return service;
}
