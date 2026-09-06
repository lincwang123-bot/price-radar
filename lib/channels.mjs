import { directTargets, DEFAULT_DIRECT_TARGET_IDS } from "../collectors/direct/registry.mjs";

const sites=new Map(directTargets(DEFAULT_DIRECT_TARGET_IDS).map(t=>[new URL(t.origin).hostname,t.kind]));
export const CHANNELS=[{id:"all",label:"全部渠道"},{id:"16688",label:"16688"},{id:"ldxp",label:"链动小铺"},{id:"independent",label:"独立站"},{id:"unknown",label:"未确认渠道"}];
export function normalizeChannel(value){return CHANNELS.some(c=>c.id===value)?value:"all";}
export function offerChannel(offer){
  let host;try{const u=new URL(offer.url);if(!["https:","http:"].includes(u.protocol)||u.username||u.password)throw new Error();host=u.hostname;}catch{return{id:"unknown",label:"未确认渠道",framework:null};}
  if(host==="16688.com.cn")return{id:"16688",label:"16688",framework:null};
  if(["wzyp.cn","ldxp.cn"].includes(host))return{id:"ldxp",label:"链动小铺",framework:null};
  if(sites.has(host)){const kind=sites.get(host);return{id:"independent",label:"独立站",framework:kind==="dujiao"?"Dujiao 接口":kind==="kami"?"Kami 接口":null};}
  return{id:"unknown",label:"未确认渠道",framework:null};
}
export function filterChannel(offers,channel){return channel==="all"?offers:offers.filter(o=>offerChannel(o).id===channel);}
export const FRAMEWORKS=[{id:'all',label:'全部框架'},{id:'dujiao',label:'独角数卡 Dujiao'},{id:'kami',label:'Kami'},{id:'unknown',label:'未确认框架'}];
export function normalizeFramework(value){return FRAMEWORKS.some(f=>f.id===value)?value:'all';}
export function filterFramework(offers,framework){return framework==='all'?offers:offers.filter(o=>{const c=offerChannel(o);return c.id==='independent'&&(framework==='unknown'?!c.framework:c.framework?.toLowerCase().startsWith(framework));});}
