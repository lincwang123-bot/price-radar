// Table-based, inline-styled email: no remote fonts, images, scripts or tracking pixels.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MAIL_STAGES = {
  received:['店铺申请已收到','感谢你提交店铺。我们已经保存申请，将先检测公开商品目录，再由站方核对店铺归属、采集授权和商品信息。','暂时无需重复提交。请保留申请编号，后续重要处理结果会发送到此邮箱。'],
  testing:['正在检测店铺接入','你的店铺已进入公开目录接入测试队列。我们正在确认能否读取商品、价格与库存信息。','本阶段无需操作。如需补充资料，我们会另行通知；检测成功不代表审核通过。'],
  ready:['接入测试完成，等待审核','我们已读取到可供核对的商品样例。接下来由站方人工审核店铺归属、采集授权及商品信息，目前尚未正式收录。','请留意后续审核通知。无需重复提交相同申请。'],
  test_delayed:['接入检测暂未完成','本次自动检测尚未完成，我们需要先核对测试记录或采集服务。具体情况请见下方说明，这不代表你的店铺存在故障。','暂时无需重复提交申请或修改店铺配置。若需要你协助，我们会另行说明具体资料。'],
  need_info:['申请需要补充资料','为了继续处理你的申请，我们还需要核对部分资料。请查看下面的站方回复；如未附具体说明，可回复此邮件询问。','回复时请保留申请编号。不要发送账号密码、验证码、卡密、私钥或 API Key。'],
  approved:['店铺审核已通过','你的店铺审核已通过，已进入正式采集接入流程。符合规则的有效报价将在采集成功后展示。','审核通过不等于已经上架。确认有报价正式展示后，我们会再发一封上架通知。'],
  published:['店铺报价已上线','你的店铺已有符合展示规则的有效报价，现已出现在 Airadar 的产品目录中。','可以前往网站查看。报价和库存会随后续核验更新；售罄、过期或不符合规则的商品不会持续展示。'],
  rejected:['店铺申请暂未通过','我们已完成本次审核，目前暂未批准这份店铺申请。你可以查看站方回复，了解需要调整或补充的内容。','如有新的证明材料或需要进一步说明，请直接回复此邮件并保留申请编号。'],
  paused:['店铺收录已暂停','你的店铺收录流程已暂停。暂停期间不会作为已批准店铺继续接入。','请查看站方回复，核对资料后与我们联系，再按审核流程申请恢复。'],
  submission_received:['你的提交已收到','感谢你帮助完善 Airadar。你的反馈或合作信息已成功保存，我们会核查相关内容后再处理。','请保留提交编号。回复、采纳或其他处理结果会通过此邮箱通知；无需重复提交。'],
  submission_reviewing:['正在核实你的提交','我们已开始查看你提交的信息，并核实相关数据或合作事项。','如需进一步说明，我们会联系你；你也可以直接回复此邮件补充信息。'],
  submission_resolved:['你的问题已处理','站方已将这条提交标记为已解决。具体处理说明如有补充，会显示在下面的站方回复中。','如果问题仍然存在，请回复此邮件说明当前情况，便于我们继续核查。'],
  submission_accepted:['你的建议或信息已采纳','感谢你的参与。站方已采纳这条建议或合作信息，并会按实际安排继续推进。','采纳不等于功能或商品已经上线，也不代表合作已经成交。请以具体处理说明和页面实际展示为准。'],
  submission_closed:['本次提交已结束处理','站方已结束这条提交的当前处理流程。若有具体说明，请查看下面的站方回复。','如有新的情况或需要补充资料，你可以回复此邮件，并保留提交编号。'],
  submission_rejected:['本次提交暂未采纳','我们已查看你的提交，目前暂未采纳这条建议或合作信息。感谢你提供线索和时间。','如有进一步的事实或证明材料，可以直接回复此邮件补充。'],
  reply:['你收到一条站方回复','Airadar 已回复你的提交，请查看下方内容。','如果需要继续沟通，直接回复此邮件即可；请保留提交编号。'],
};

export function notificationContent(row, {replyEnabled = false} = {}) {
  const [title, originalBody, originalNext] = MAIL_STAGES[row.stage] || [];
  if (!title) throw new Error('Invalid notification stage');
  const contactCopy = value => replyEnabled ? value : value.replace(/直接回复此邮件|回复此邮件|回复时/g,'通过原联系渠道联系站方');
  const body = contactCopy(originalBody), next = contactCopy(originalNext);
  const id = row.application_id;
  const referenceLabel = String(id).startsWith('MA-') ? '申请编号' : '提交编号';
  const reply = typeof row.public_reply === 'string' ? row.public_reply : '';
  const footer = '此邮件仅用于提交进度通知，不是交易担保或营销邮件。如果你没有提交过相关信息，请忽略此邮件。';
  const text = `Airadar · 提交进度通知\n\n${title}\n\n${body}\n\n${referenceLabel}：${id}${reply ? `\n\n站方回复：\n${reply}` : ''}\n\n接下来\n${next}\n\n访问 Airadar：https://airadar.vip/\n\n${footer}`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:#f3f6f4;color:#243a30;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;line-height:1.75;word-break:break-word"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(title)} · ${esc(referenceLabel)} ${esc(id)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f4"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td style="padding:0 16px 20px"><span style="font-size:25px;letter-spacing:-1px;font-weight:750;color:#235b46">Airadar<span style="color:#67a583">.</span></span><span style="display:block;font-size:12px;color:#6b7c72;letter-spacing:1px">AI 订阅价格雷达</span></td></tr><tr><td style="border:1px solid #dce6df;border-top:4px solid #28634b;border-radius:12px;background:#ffffff;padding:28px 24px"><p style="margin:0 0 12px;font-size:12px;font-weight:650;color:#557364;letter-spacing:1px">提交进度通知</p><h1 style="margin:0 0 18px;font-size:25px;line-height:1.45;color:#20382c;letter-spacing:-.5px">${esc(title)}</h1><p style="margin:0 0 24px;font-size:15px;color:#435b4d">${esc(body)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f4;border-radius:8px"><tr><td style="padding:14px 16px"><span style="display:block;font-size:12px;color:#718376">${esc(referenceLabel)}</span><span style="font-family:ui-monospace,Consolas,monospace;font-size:14px;color:#2b4938">${esc(id)}</span></td></tr></table>${reply ? `<div style="margin-top:24px;padding:16px;border-left:3px solid #8eb39b;background:#fafcfb"><h2 style="font-size:14px;margin:0 0 8px;color:#2b4e3a">站方回复</h2><p style="margin:0;font-size:15px;color:#435b4d;white-space:pre-wrap">${esc(reply)}</p></div>` : ''}<h2 style="margin:24px 0 8px;font-size:14px;color:#294936">接下来</h2><p style="margin:0 0 24px;font-size:14px;color:#607266">${esc(next)}</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:7px;background:#28634b"><a href="https://airadar.vip/" style="display:inline-block;padding:11px 22px;color:#ffffff;font-weight:650;font-size:14px;text-decoration:none">访问 Airadar →</a></td></tr></table>${replyEnabled ? '<p style="margin:18px 0 0;font-size:12px;color:#738477">需要补充说明？直接回复这封邮件即可。</p>' : ''}</td></tr><tr><td style="padding:20px 16px;font-size:12px;color:#78877e"><p style="margin:0 0 8px">${footer}</p><p style="margin:0">Airadar · airadar.vip</p></td></tr></table></td></tr></table></body></html>`;
  return {subject:`Airadar：${title}`,text,html};
}
