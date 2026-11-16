import Dypnsapi from '@alicloud/dypnsapi20170525';

// Mainland PNVS, not the separate dysmsapi (SendSms) or international product.
// https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode
// https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-checksmsverifycode
const ENDPOINT='dypnsapi.aliyuncs.com';
const TIMEOUT_MS=8000;
const CONNECT_TIMEOUT_MS=3000;
const READ_TIMEOUT_MS=4000;
const DEFINITE_REJECTIONS=new Set([
 'MOBILE_NUMBER_ILLEGAL','BUSINESS_LIMIT_CONTROL','FREQUENCY_FAIL',
 'INVALID_PARAMETERS','FUNCTION_NOT_OPENED',
 'InvalidAccessKeyId.NotFound','InvalidAccessKeyId','SignatureDoesNotMatch',
 'Forbidden.RAM','Forbidden.NoPermission','Forbidden.AccessDenied',
]);
const ERRORS={
 phone_sms_not_configured:['短信验证服务尚未配置。',503,'not_sent'],
 phone_sms_invalid_input:['短信验证请求无效。',400,'not_sent'],
 phone_sms_cancelled:['短信验证请求已取消。',503,'not_sent'],
 phone_sms_rejected:['短信验证服务暂不可用。',503,'rejected'],
 phone_sms_uncertain:['短信验证结果暂时无法确认，请稍后重试。',503,'unknown'],
};

// Never attach a provider exception, request, response, phone or verification code.
export class PhoneSmsProviderError extends Error{
 constructor(code){
  const safeCode=Object.hasOwn(ERRORS,code)?code:'phone_sms_uncertain';
  const [message,statusCode,outcome]=ERRORS[safeCode];
  super(message);
  this.name='PhoneSmsProviderError';
  this.code=safeCode;
  this.statusCode=statusCode;
  this.outcome=outcome;
  this.uncertain=outcome==='unknown';
 }
}
const failure=code=>new PhoneSmsProviderError(code);
const setting=value=>typeof value==='string'?value.trim():'';
function validSetting(value,max){return !!value&&value.length<=max&&!/[\r\n\0]/.test(value);}
function validateInput(phone,outId,code){
 if(typeof phone!=='string'||!/^\+861[3-9]\d{9}$/.test(phone)
  ||typeof outId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(outId)
  ||(code!==undefined&&(typeof code!=='string'||!/^\d{6}$/.test(code))))throw failure('phone_sms_invalid_input');
}
function rejected(error){
 // The SDK wraps HTTP errors. Inspect only its structured code, never its text.
 return DEFINITE_REJECTIONS.has(error?.code)||DEFINITE_REJECTIONS.has(error?.data?.Code);
}
function assertApiSuccess(response){
 const body=response?.body;
 if(body?.success===true&&body.code==='OK'
  &&(response.statusCode===undefined||response.statusCode===200))return body;
 // Internal errors, malformed responses and unfamiliar error codes may occur
 // after acceptance. Do not treat these as proof that no SMS was sent.
 if(body?.success===false&&rejected(body))throw failure('phone_sms_rejected');
 throw failure('phone_sms_uncertain');
}
function metadata(value,secrets){
 if(typeof value!=='string'||!value||value.length>160||!/^[A-Za-z0-9_^.-]+$/.test(value))return '';
 return secrets.some(secret=>secret&&value.includes(secret))?'':value;
}

export function createPhoneSmsProvider({env=process.env,client}={}){
 const accessKeyId=setting(env.AIRADAR_SMS_ACCESS_KEY_ID);
 const accessKeySecret=setting(env.AIRADAR_SMS_ACCESS_KEY_SECRET);
 const securityToken=setting(env.AIRADAR_SMS_SECURITY_TOKEN);
 const signName=setting(env.AIRADAR_SMS_SIGN_NAME);
 const templateCode=setting(env.AIRADAR_SMS_TEMPLATE_CODE);
 const schemeName=setting(env.AIRADAR_SMS_SCHEME_NAME)||'airadar-phone-v1';
 const configured=validSetting(accessKeyId,256)&&validSetting(accessKeySecret,256)
  &&validSetting(signName,200)&&validSetting(templateCode,64)
  &&validSetting(schemeName,20)&&(!securityToken||validSetting(securityToken,16384));
 let sdk=client;
 function getClient(){
  if(!sdk)sdk=new Dypnsapi.default({
   accessKeyId,accessKeySecret,...(securityToken?{securityToken}:{}),
   endpoint:ENDPOINT,protocol:'HTTPS',regionId:'cn-hangzhou',
   connectTimeout:CONNECT_TIMEOUT_MS,readTimeout:READ_TIMEOUT_MS,
   // SDK 2.x reads config.retryOptions, not the legacy runtime.autoretry.
   retryOptions:{retryable:false},
  });
  return sdk;
 }
 async function invoke(method,request,signal){
  if(!configured)throw failure('phone_sms_not_configured');
  if(signal?.aborted)throw failure('phone_sms_cancelled');
  let timer,onAbort;
  try{
   const api=getClient();
   // The official SDK has no HTTP AbortSignal option. Stop waiting at our
   // deadline; its own connect/read limits bound the underlying request.
   // A cancellation after dispatch cannot prove the carrier did not accept it.
   return await new Promise((resolve,reject)=>{
    let dispatched=false,finished=false;
    const finish=(callback,value)=>{if(!finished){finished=true;callback(value);}};
    timer=setTimeout(()=>finish(reject,failure('phone_sms_uncertain')),TIMEOUT_MS);
    onAbort=()=>finish(reject,failure(dispatched?'phone_sms_uncertain':'phone_sms_cancelled'));
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){onAbort();return;}
    Promise.resolve().then(()=>{
     if(finished)return;
     dispatched=true;
     return api[method](request,{
      autoretry:false,maxAttempts:1,connectTimeout:CONNECT_TIMEOUT_MS,readTimeout:READ_TIMEOUT_MS,
     });
    }).then(value=>finish(resolve,value),error=>finish(reject,error));
   });
  }catch(error){
   if(error instanceof PhoneSmsProviderError)throw error;
   throw failure(rejected(error)?'phone_sms_rejected':'phone_sms_uncertain');
  }finally{
   clearTimeout(timer);
   if(onAbort)signal?.removeEventListener('abort',onAbort);
  }
 }
 function requestId(response,phone,code){
  // SDK 2.0.0 omits RequestId from the check response model; its HTTP header
  // remains available. IDs are optional diagnostics, never verification proof.
  return metadata(response?.body?.requestId??response?.headers?.['x-acs-request-id'],
   [phone,phone.slice(3),code,accessKeyId,accessKeySecret,securityToken]);
 }
 return Object.freeze({
  configured,
  async send(input={}){
   if(!configured)throw failure('phone_sms_not_configured');
   const {phone,outId,signal}=input&&typeof input==='object'?input:{};
   validateInput(phone,outId);
   const request=new Dypnsapi.SendSmsVerifyCodeRequest({
    schemeName,countryCode:'86',phoneNumber:phone.slice(3),signName,templateCode,
    templateParam:JSON.stringify({code:'##code##',min:'5'}),outId,
    codeLength:6,validTime:300,duplicatePolicy:1,interval:60,codeType:1,
    returnVerifyCode:false,autoRetry:0,
   });
   const response=await invoke('sendSmsVerifyCodeWithOptions',request,signal);
   const body=assertApiSuccess(response);
   return {requestId:requestId(response,phone,body.model?.verifyCode),bizId:metadata(body.model?.bizId,
    [phone,phone.slice(3),body.model?.verifyCode,accessKeyId,accessKeySecret,securityToken])};
  },
  async verify(input={}){
   if(!configured)throw failure('phone_sms_not_configured');
   const {phone,code,outId,signal}=input&&typeof input==='object'?input:{};
   validateInput(phone,outId,code);
   // Missing code must never become an API request with an omitted parameter.
   if(code===undefined)throw failure('phone_sms_invalid_input');
   const request=new Dypnsapi.CheckSmsVerifyCodeRequest({
    schemeName,countryCode:'86',phoneNumber:phone.slice(3),verifyCode:code,outId,caseAuthPolicy:2,
   });
   const response=await invoke('checkSmsVerifyCodeWithOptions',request,signal);
   const body=assertApiSuccess(response);
   return {passed:body.model?.verifyResult==='PASS'&&body.model?.outId===outId,
    requestId:requestId(response,phone,code)};
  },
 });
}
