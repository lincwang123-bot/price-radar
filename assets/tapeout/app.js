import {validateEntry,summarize,buildCalendar,paymentAdvice} from './domain.js';

const $=id=>document.getElementById(id);
const STORAGE_KEY='airadar.tapeout.costs.v1';
const MAX_ENTRIES=100;
const periodLabel={monthly:'每月',yearly:'每年',once:'一次性 / 充值'};
const money=(value,currency)=>new Intl.NumberFormat('zh-CN',{minimumFractionDigits:currency==='BEM'?0:2,maximumFractionDigits:currency==='BEM'?6:2}).format(value);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
let entries=[],editingId=null,mode='tapecode',deleted=null,noticeTimer=null,storageAvailable=true,persistenceBlocked=false,storedSnapshot=null;
let blockedMessage='原有本机数据未覆盖。本次修改请用“导出清单”保存。';
const text=(tag,className,content)=>{const e=document.createElement(tag);if(className)e.className=className;e.textContent=content;return e;};
function notice(message,{undo=false}={}){
 clearTimeout(noticeTimer);$('notice-text').textContent=message;$('undo-delete').hidden=!undo;$('notice').hidden=false;
 if(!undo)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},7000);
}
function persist(){
 if(persistenceBlocked){notice(blockedMessage);return;}
 try{
  if(localStorage.getItem(STORAGE_KEY)!==storedSnapshot){
   persistenceBlocked=true;storageAvailable=false;blockedMessage='另一个标签页已更新清单，未覆盖它。本页修改请先导出保存，再刷新。';
   $('storage-status').textContent='检测到其他标签更新，请先导出本页修改';notice(blockedMessage);return;
  }
  const next=JSON.stringify({version:1,entries});localStorage.setItem(STORAGE_KEY,next);storedSnapshot=next;storageAvailable=true;
 }
 catch{storageAvailable=false;notice('当前浏览器无法保存数据。请在离开前导出清单。');}
 $('storage-status').textContent=storageAvailable?'已保存在当前浏览器':'无法本机保存，请导出清单';
}
function restore(){
 try{
  const raw=localStorage.getItem(STORAGE_KEY);storedSnapshot=raw;if(!raw)return;
  const parsed=JSON.parse(raw);if(parsed.version!==1||!Array.isArray(parsed.entries)||parsed.entries.length>MAX_ENTRIES)throw new Error();
  const checks=parsed.entries.map(validateEntry);if(checks.some(x=>!x.ok)||new Set(checks.map(x=>x.entry.id)).size!==checks.length)throw new Error();
  entries=checks.map(x=>x.entry);
 }catch{notice('原有清单未能读取，已保留原数据。本次修改请导出保存。');storageAvailable=false;persistenceBlocked=true;$('storage-status').textContent='原数据已保留，本次修改请导出';}
}
function render(){
 const list=$('entries');list.replaceChildren();$('empty-state').hidden=entries.length>0;
 for(const entry of entries){
  const row=text('article','entry-row','');
  const initial=text('div','entry-initial',[...entry.name][0].toLocaleUpperCase());initial.setAttribute('aria-hidden','true');row.append(initial);
  const info=text('div','entry-info','');info.append(text('h3','',entry.name));
  let dateLabel='尚未设置提醒日期',past=false;
  if(entry.renewalDate){past=entry.renewalDate<today();dateLabel=`${entry.renewalDate} · ${past?'日期已过，请更新':entry.reminderDays?`提前 ${entry.reminderDays} 天提醒`:'当天提醒'}`;}
  info.append(text('div','entry-meta'+(past?' past':''),dateLabel));row.append(info);
  const amount=text('div','entry-money',`${money(entry.amount,entry.currency)} ${entry.currency}`);amount.append(text('small','',periodLabel[entry.period]));
  const actions=text('div','entry-actions','');
  for(const [label,fn] of [['编辑',()=>openForm(entry)],['删除',()=>removeEntry(entry.id)]]){const b=text('button','',label);b.type='button';b.setAttribute('aria-label',`${label} ${entry.name}`);b.addEventListener('click',fn);actions.append(b);}
  amount.append(actions);row.append(amount);list.append(row);
 }
 $('entry-count').textContent=`${entries.length} 项记录`;
 const totals=$('totals');totals.replaceChildren();
 if(!entries.length){const empty=text('div','total-empty','—');empty.append(text('span','','添加费用后，按币种显示'));totals.append(empty);}
 for(const total of summarize(entries)){
  const group=text('div','total-group',''),monthly=text('div','monthly-total','');
  monthly.append(text('span','currency',total.currency),document.createTextNode(money(total.monthly,total.currency)));
  group.append(monthly,text('div','annual-total',`按当前周期，一年合计 ${money(total.yearly,total.currency)} ${total.currency}`));
  if(entries.some(e=>e.currency===total.currency&&e.period==='once'))group.append(text('div','once-total',`另记一次性费用 ${money(total.once,total.currency)} ${total.currency}`));
  totals.append(group);
 }
 const future=entries.filter(e=>e.renewalDate&&e.renewalDate>=today()).length;
 $('calendar-note').textContent=future?`${future} 项有可导出的日期，导入后由日历提醒。`:'填写下次日期，即可导出提醒。';
 $('export-data').disabled=!entries.length;
}
function renderAdvice(){
 const advice=paymentAdvice(mode,$('has-subscription').checked);
 $('advice-title').textContent=advice.title;$('advice-body').textContent=advice.body;
 const link=$('advice-link');link.hidden=!advice.actionUrl;
 if(advice.actionUrl){link.href=advice.actionUrl;link.textContent=advice.actionLabel+' ↗';}else link.removeAttribute('href');
 $('tapecode-link').hidden=mode!=='tapecode';
}
function openForm(entry){
 if(!entry&&entries.length>=MAX_ENTRIES){notice('最多保存 100 项费用，请先整理现有清单。');return;}
 editingId=entry?.id||null;$('entry-form').reset();$('form-error').textContent='';
 $('form-title').textContent=entry?'编辑 AI 费用':'添加一笔 AI 费用';
 if(entry)for(const field of ['name','amount','currency','period','renewalDate','reminderDays'])$('entry-form').elements.namedItem(field).value=entry[field];
 $('entry-amount').step=$('entry-currency').value==='BEM'?'0.000001':'0.01';
 $('entry-dialog').showModal();$('entry-name').focus();
}
function removeEntry(id){
 const index=entries.findIndex(e=>e.id===id);if(index<0)return;
 deleted={entry:entries[index],index};entries.splice(index,1);persist();render();notice(`已删除「${deleted.entry.name}」`,{undo:true});
}
function download(content,mime,filename){
 const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('entry-form').addEventListener('submit',event=>{
 event.preventDefault();
 const raw=Object.fromEntries(new FormData(event.currentTarget));raw.id=editingId||(globalThis.crypto?.randomUUID?.()||`local-${Date.now()}-${Math.random().toString(16).slice(2)}`);
 const result=validateEntry(raw);if(!result.ok){$('form-error').textContent=result.error;return;}
 if(!editingId&&entries.length>=MAX_ENTRIES){$('form-error').textContent='最多保存 100 项费用。';return;}
 if(editingId)entries=entries.map(e=>e.id===editingId?result.entry:e);else entries.push(result.entry);
 persist();render();$('entry-dialog').close();if(storageAvailable)notice(editingId?'费用已更新。':'费用已保存。');
});
$('entry-currency').addEventListener('change',()=>{$('entry-amount').step=$('entry-currency').value==='BEM'?'0.000001':'0.01';});
for(const id of ['add-entry','empty-add'])$(id).addEventListener('click',()=>openForm());
for(const id of ['close-dialog','cancel-dialog'])$(id).addEventListener('click',()=>$('entry-dialog').close());
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderAdvice();}));
$('has-subscription').addEventListener('change',renderAdvice);
$('export-calendar').addEventListener('click',()=>{try{download(buildCalendar(entries),'text/calendar;charset=utf-8','AIradar-续费提醒.ics');notice('已下载日历文件，请打开它并导入你的日历。');}catch(error){notice(error.message);}});
$('export-data').addEventListener('click',()=>{download(JSON.stringify({version:1,exportedAt:new Date().toISOString(),entries},null,2),'application/json;charset=utf-8','AIradar-费用清单.json');notice('费用清单已导出，里面包含你填写的金额与日期，请自行保管。');});
const importLabel=document.querySelector('.import-label');importLabel.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('import-data').click();}});
$('import-data').addEventListener('change',async event=>{
 const file=event.target.files[0];event.target.value='';if(!file)return;
 try{
  if(file.size>250000)throw new Error('文件过大，请选择本工具导出的清单（最大 250 KB）。');
  const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.entries)||data.entries.length>MAX_ENTRIES)throw new Error('清单格式不正确，请选择本工具导出的 JSON 文件。');
  const incoming=data.entries.map(e=>{const check=validateEntry(e);if(!check.ok)throw new Error(check.error);return check.entry;});
  if(new Set(incoming.map(e=>e.id)).size!==incoming.length)throw new Error('清单中有重复记录编号，未导入。');
  const merged=new Map(entries.map(e=>[e.id,e]));let added=0,skipped=0;
  for(const entry of incoming){if(merged.has(entry.id)){skipped++;continue;}merged.set(entry.id,entry);added++;}
  if(merged.size>MAX_ENTRIES)throw new Error('合并后超过 100 项，未导入。请先整理清单。');
  entries=[...merged.values()];persist();render();if(storageAvailable)notice(`已导入 ${added} 项${skipped?`，保留了 ${skipped} 项已有记录`:''}。`);
 }catch(error){notice(error instanceof SyntaxError?'文件不是有效的 JSON，原有清单未改变。':error.message);}
});
$('undo-delete').addEventListener('click',()=>{if(!deleted)return;if(entries.length>=MAX_ENTRIES){notice('清单已满，请先整理后再恢复。',{undo:true});return;}if(!entries.some(e=>e.id===deleted.entry.id))entries.splice(Math.min(deleted.index,entries.length),0,deleted.entry);deleted=null;persist();render();if(storageAvailable)notice('已恢复删除的费用。');});
$('close-notice').addEventListener('click',()=>{$('notice').hidden=true;});
restore();render();renderAdvice();
