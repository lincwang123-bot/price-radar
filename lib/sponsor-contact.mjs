import {sponsorBrandCreative} from './sponsor-brand-creatives.mjs';

// Contact targets come from reviewed server configuration.
export function handleSponsorContact(req,res,url,{analytics,now=Date.now()}={}){
 if(url.pathname!=='/sponsor/contact')return false;
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 const fail=status=>{res.statusCode=status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(req.method==='HEAD'?'':'联系链接暂不可用，请返回页面刷新后重试。');return true;};
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return fail(405);}
 if([...url.searchParams.keys()].some(k=>!['campaign','token'].includes(k)||url.searchParams.getAll(k).length!==1))return fail(400);
 const id=url.searchParams.get('campaign'),token=url.searchParams.get('token');
 if(!id||id.length>250||!token||token.length>1200)return fail(400);
 const date=new Date(now),c=analytics?.outbound?.activeCampaigns(date).find(c=>c.id===id);
 const creative=c&&sponsorBrandCreative(c);
 if(!creative?.telegram)return fail(404);
 // Expired attribution must not strand someone who left a tab open. The reviewed
 // destination still works, but a missing/forged/expired token never counts.
 const pagePath=analytics.outbound.verifyViewToken(c,token,date);
 res.statusCode=302;res.setHeader('Location',creative.telegram);res.end();
 try{if(req.method==='GET'&&pagePath!=null)analytics.outbound.recordContact(req,c,{placement:c.placement,campaign:c,pagePath},date);}catch{/* Navigation does not depend on analytics. */}
 return true;
}
