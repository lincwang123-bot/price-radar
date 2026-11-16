import {sponsorError} from './sponsor-plans.mjs';

export const sponsorReportDay = value => new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,10);
const emptyMetrics = () => ({impressions:0,visible:0,clicks:0,contact_clicks:0});
export function sponsorReportRange({from,to}={},date=new Date()){
 const last=sponsorReportDay(date);
 from=from||sponsorReportDay(new Date(date.getTime()-29*86400000));to=to||last;
 const valid=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
 if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365||to>last)throw sponsorError('请选择有效的北京时间日期范围，最多 366 天，结束日期不能晚于今天。',400);
 return {from,to};
}
// All reads are SELECT-only: viewing/exporting reports must not prune raw evidence.
export function reportSponsorDetail(db,{merchantId='',campaignId='',from,to}={},date=new Date()){
 ({from,to}=sponsorReportRange({from,to},date));
 if(typeof merchantId!=='string'||merchantId.length>250||merchantId&&!/^domain:[a-z0-9.-]+$/i.test(merchantId)||typeof campaignId!=='string'||campaignId.length>250||/[\u0000-\u001f\u007f]/.test(campaignId))throw sponsorError('商家或活动筛选条件无效。',400);
 const campaignWhere=[],campaignArgs=[];
 if(merchantId){campaignWhere.push('merchant_id=?');campaignArgs.push(merchantId);}
 if(campaignId){campaignWhere.push('id=?');campaignArgs.push(campaignId);}
 const campaigns=db.prepare('SELECT * FROM campaigns'+(campaignWhere.length?' WHERE '+campaignWhere.join(' AND '):'')+' ORDER BY start_at,id').all(...campaignArgs);
 if(campaignId&&!campaigns.length)throw sponsorError('活动不存在，或不属于所选商家。',400);
 if(merchantId&&!campaigns.length)throw sponsorError('未找到该商家的赞助活动。',400);
 const where=["campaign_id<>''",'day>=?','day<=?'],args=[from,to];
 if(merchantId){where.push('merchant_id=?');args.push(merchantId);}
 if(campaignId){where.push('campaign_id=?');args.push(campaignId);}
 const rows=db.prepare(`SELECT day,merchant_id,campaign_id,placement,product_id,page_path,SUM(impressions) impressions,SUM(visible) visible,SUM(clicks) clicks,SUM(contact_clicks) contact_clicks FROM merchant_outbound_days WHERE ${where.join(' AND ')} GROUP BY day,merchant_id,campaign_id,placement,product_id,page_path ORDER BY day,campaign_id,page_path`).all(...args);
 const totals=rows.reduce((sum,row)=>{for(const key of Object.keys(sum))sum[key]+=Number(row[key]||0);return sum;},emptyMetrics());
 return {from,to,asOf:date.toISOString(),campaigns,rows,totals};
}
