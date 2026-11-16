import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {SubmissionError} from './submissions.mjs';

export const REVIEW_IMAGE_LIMIT=3;
export const REVIEW_IMAGE_BYTES=5*1024*1024;
export const REVIEW_IMAGE_BODY_BYTES=21*1024*1024;
let active=0;
const invalid=message=>{throw new SubmissionError(422,message);};
export async function prepareReviewImages(images){
 if(images===undefined)return undefined;
 if(!Array.isArray(images)||images.length>REVIEW_IMAGE_LIMIT)invalid('每条评价最多上传 3 张图片');
 if(active>=2)throw new SubmissionError(429,'图片处理繁忙，请稍后再试');
 active++;
 try{
  const result=[];
  for(const item of images){
   if(!item||typeof item!=='object'||Array.isArray(item))invalid('图片格式不正确，请重新选择');
   if(Object.keys(item).length===1&&/^[a-f0-9]{32}$/.test(item.id||'')){result.push({id:item.id});continue;}
   if(Object.keys(item).length!==1||typeof item.dataUrl!=='string'||item.dataUrl.length>Math.ceil(REVIEW_IMAGE_BYTES/3)*4+64)invalid('每张图片不能超过 5MB');
   const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);if(!match)invalid('只支持 JPG、PNG、WebP 静态图片');
   const input=Buffer.from(match[2],'base64');if(!input.length||input.length>REVIEW_IMAGE_BYTES||input.toString('base64')!==match[2])invalid('图片内容无效或超过 5MB');
   const format=input[0]===0xff&&input[1]===0xd8?'jpeg':input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP'?'webp':null;
   if(format!==match[1])invalid('图片实际格式与文件类型不符，请重新导出图片');
   try{
    const image=sharp(input,{limitInputPixels:20000000,failOn:'warning'});
    const meta=await image.metadata();if(meta.format!==format||(meta.pages||1)!==1)invalid('不支持动图，请上传静态图片');
    // Decode and re-encode pixels; never retain original bytes, names or EXIF/GPS.
    const {data,info}=await image.rotate().resize({width:1600,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85,effort:3}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    if(data.length>2*1024*1024)invalid('处理后的图片仍过大，请缩小图片后重试');
    result.push({data,mime:'image/webp',width:info.width,height:info.height,sha256:createHash('sha256').update(data).digest('hex')});
   }catch(error){if(error instanceof SubmissionError)throw error;invalid('图片无法读取、已损坏或像素过大，请重新截图或导出后再上传');}
  }
  return result;
 }finally{active--;}
}
export function sendReviewImage(req,res,image){
 res.setHeader('Cache-Control','private, no-store, no-transform');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Referrer-Policy','no-referrer');
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.statusCode=405;res.end();return;}
 if(!image){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type','image/webp');res.setHeader('Content-Length',image.data.length);res.setHeader('Content-Disposition','inline; filename="review-image.webp"');res.end(req.method==='HEAD'?'':image.data);
}
