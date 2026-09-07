import { merchantBridgeDir } from './merchant-onboarding.mjs';
import { merchantPreflightResultsDir, reconcileAutomaticPreflights } from './merchant-preflight-store.mjs';
import { drainMerchantMail } from './merchant-mail.mjs';
import { reconcileMerchantPublication } from './merchant-publication.mjs';

export function startMerchantWorkflow(server,{submissionsDb,db,adminOptions={}}) {
  if(!submissionsDb)return;
  const options={bridgeDir:adminOptions.merchantBridgeDir??merchantBridgeDir(submissionsDb),resultsDir:adminOptions.merchantPreflightResultsDir??merchantPreflightResultsDir(db)};
  const controller=new AbortController();
  let running=null;
  const tick=()=>{
    if(running||controller.signal.aborted)return;
    running=(async()=>{
      try { if(options.bridgeDir&&options.resultsDir)reconcileAutomaticPreflights(submissionsDb,options); }
      catch { console.error('[merchant-workflow] 自动检测排队失败，下轮重试'); }
      try { reconcileMerchantPublication(submissionsDb,db); }
      catch { console.error('[merchant-workflow] 上架通知核验失败，下轮重试'); }
      try { await drainMerchantMail(submissionsDb,{signal:controller.signal}); }
      catch { console.error('[merchant-workflow] 邮件处理失败，请检查发件配置'); }
    })().finally(()=>{running=null;});
  };
  const timer=setInterval(tick,15000);timer.unref();
  server.once('listening',tick);
  server.once('close',()=>{clearInterval(timer);controller.abort();});
  // Callers shutting down the private DB can wait for an in-flight SMTP attempt.
  server.merchantWorkflowDone=()=>running||Promise.resolve();
}
