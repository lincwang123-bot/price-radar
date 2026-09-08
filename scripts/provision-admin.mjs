// Run locally with an absolute, private handoff directory outside the repository.
// The cleartext password never leaves this machine; SSH receives only its scrypt hash.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { hashAdminPassword } from "../lib/admin.mjs";

const dir=process.argv[2];
if(!dir||!path.isAbsolute(dir)||path.resolve(dir).startsWith(process.cwd()+path.sep)||path.resolve(dir)===process.cwd())throw new Error("请指定仓库之外的私密绝对路径目录");
mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
const password=randomBytes(24).toString("base64url");
const config={ADMIN_USERNAME:"admin",ADMIN_PASSWORD_HASH:await hashAdminPassword(password),ANALYTICS_HASH_SECRET:randomBytes(32).toString("hex")};
const file=path.join(dir,`airadar-admin-${new Date().toISOString().replace(/[:.]/g,"-")}.txt`);
writeFileSync(file,`AI订阅价格雷达：站长后台一次性凭据交付\n登录地址：https://airadar.vip/admin/login\n用户名：admin\n口令：请查看运行本脚本时的终端输出（出于安全考虑，口令不落盘）。\n\n此文件生成后须以部署验证为准；原口令不上传服务器，服务器仅保存scrypt hash。\n`,{mode:0o600,flag:"wx"});
console.log(`一次性口令（请立即保存到密码管理器，本工具不会再次显示且不会写入磁盘）：${password}`);
const remote=`const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const c=JSON.parse(input);const file='/etc/price-radar/web.env';if(fs.existsSync(file))throw new Error('web config already exists; refusing overwrite');if(c.ADMIN_USERNAME!=='admin'||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(c.ADMIN_PASSWORD_HASH)||!/^[a-f0-9]{64}$/.test(c.ANALYTICS_HASH_SECRET))throw new Error('invalid config');fs.mkdirSync('/etc/price-radar',{recursive:true});fs.writeFileSync(file,Object.entries(c).map(([k,v])=>k+'='+v).join('\\n')+'\\n',{mode:0o600,flag:'wx'});fs.chmodSync(file,0o600);console.log('web config provisioned');});`;
const quoted="'"+remote.replaceAll("'","'\\''")+"'";
try{execFileSync("ssh",["linc-vps","sudo /usr/bin/node -e "+quoted],{input:JSON.stringify(config),encoding:"utf8",stdio:["pipe","pipe","pipe"]});console.log(JSON.stringify({configured:true,username:"admin",handoffFile:file}));}
catch{console.error("配置未完成；未输出凭据。请检查服务器web.env是否已存在，并保留本机交付文件核对。");process.exitCode=1;}
