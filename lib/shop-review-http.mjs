import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {SubmissionError} from './submissions.mjs';
import {prepareReviewImages,sendReviewImage,REVIEW_IMAGE_BODY_BYTES} from './shop-review-images.mjs';
const script=readFileSync(new URL('../assets/shop-reviews.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/shop-reviews.css',import.meta.url),'utf8');
const cookie=(req,name)=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const same=(a,b)=>/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,payload)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload));};
async function body(req,limit=16000){
 if(String(req.headers['content-type']||'').split(';')[0]!=='application/json')throw new SubmissionError(415,'请使用 JSON 提交');
 if(Number(req.headers['content-length']||0)>limit)throw new SubmissionError(413,'提交内容过长');
 const chunks=[];let length=0;
 for await(const part of req){length+=part.length;if(length>limit)throw new SubmissionError(413,'提交内容过长');chunks.push(part);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new SubmissionError(422,'提交格式无效');}
}
export function createShopReviewHttp({reviews,replies,retention,shopById,env=process.env}){
 return async(req,res,url)=>{
  if(['/assets/shop-reviews.js','/assets/shop-reviews.css'].includes(url.pathname)){
   if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');json(res,405,{error:'请求方法无效'});return true;}
   const style=url.pathname.endsWith('.css');res.setHeader('Content-Type',style?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(req.method==='HEAD'?'':style?css:script);return true;
  }
  if(!url.pathname.startsWith('/api/shop-reviews/'))return false;
  res.setHeader('Cache-Control','no-store, no-transform');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
  try{
   const action=url.pathname.slice('/api/shop-reviews/'.length),a=retention.account(req);
   if(action.startsWith('images/')){const id=action.slice(7);sendReviewImage(req,res,reviews.image(id,{viewer:a}));return true;}
   if(action.startsWith('purchase-images/')){sendReviewImage(req,res,reviews.purchaseImage(action.slice(16),{viewer:a}));return true;}
   if(action==='state'&&req.method==='GET'){
    const id=url.searchParams.get('shop');
    if(!/^[a-f0-9]{24}$/.test(id||'')||!shopById(id))throw new SubmissionError(404,'店铺不存在');
    const merchant=reviews.canReply(a,id);
    json(res,200,{signedIn:!!a,canSubmit:!!a&&!merchant,canReply:merchant,own:reviews.own(a,id),reports:reviews.myReports(a,id),replies:merchant&&replies?replies.own(a,id):[]});return true;
   }
   if(!['submit','withdraw','report','reply-submit','reply-withdraw'].includes(action))throw new SubmissionError(404,'接口不存在');
   if(req.method!=='POST'){res.setHeader('Allow','POST');throw new SubmissionError(405,'仅支持 POST');}
   const origin=env.PUBLIC_ORIGIN||`http://${req.headers.host}`;
   if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'||!same(String(req.headers['x-csrf-token']||''),cookie(req,'airadar_reader_csrf')))throw new SubmissionError(403,'页面验证已失效，请刷新后重试');
   if(!a)throw new SubmissionError(401,'请先登录');
   const input=await body(req,action==='submit'?REVIEW_IMAGE_BODY_BYTES*2:16000),remote=req.socket.remoteAddress||'';
   const client=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)?String(req.headers['cf-connecting-ip']||remote):remote;
   const {images:rawImages,purchaseImages:rawPurchaseImages,...textInput}=input;if(Buffer.byteLength(JSON.stringify(textInput))>16000)throw new SubmissionError(413,'文字内容过长');
   let images,purchaseImages;
   if(action==='submit'&&(rawImages!==undefined||rawPurchaseImages!==undefined)){
    if(!/^[a-f0-9]{24}$/.test(input.shopId||'')||!shopById(input.shopId))throw new SubmissionError(404,'店铺不存在');
    for(const raw of [rawImages,rawPurchaseImages])if(raw!==undefined&&(!Array.isArray(raw)||raw.length>3))throw new SubmissionError(422,'购买凭证和公开配图各最多上传 3 张');
    if([...(rawImages||[]),...(rawPurchaseImages||[])].some(i=>i?.dataUrl))reviews.imageAttempt(a,{client});
    images=await prepareReviewImages(rawImages);
    purchaseImages=await prepareReviewImages(rawPurchaseImages);
   }
   if(action.startsWith('reply-')&&!replies)throw new SubmissionError(503,'商家回复暂不可用');
   const result=action==='reply-submit'?replies.submit(a,input,{client}):action==='reply-withdraw'?replies.withdraw(a,input,{client}):reviews[action](a,input,{client,images,purchaseImages});
   json(res,200,{ok:true,result});
  }catch(error){
   if(error instanceof SubmissionError)json(res,error.status,{error:error.message});
   else{console.error('[shop-reviews] request failed');json(res,503,{error:'评价服务暂不可用，请稍后重试'});}
  }
  return true;
 };
}
