// Reviewed editorial content. Billing facts stay scoped to their actual channel.
export const PURCHASE_GUIDE_PATHS={apple:'/guides/apple-balance-ai-subscription',play:'/guides/google-play-ai-subscription',payment:'/guides/ai-subscription-payment-failed'};
const a=(href,label)=>`<a href="${href}">${label}</a>`;
const s=(id,title,html)=>({id,title,html});
const ref=(href,label)=>({href,label});
const appleBalance='https://support.apple.com/en-us/118245';
const appleGift='https://support.apple.com/en-us/108285';
const appleCancel='https://support.apple.com/en-us/118428';
const playCountry='https://support.google.com/googleplay/answer/7431675';
const playManage='https://support.google.com/googleplay/answer/7018481';
const playOrders='https://support.google.com/googleplay/answer/2850369';
const playPayment='https://support.google.com/googleplay/answer/1267137?hl=en';
export const PURCHASE_ARTICLES=[
 {
  path:PURCHASE_GUIDE_PATHS.apple,title:'Apple 账户余额和礼品卡能订阅 AI 吗？',
  description:'准备通过 iPhone 订阅 ChatGPT、Claude 或其他 AI 服务时，核对 App Store 内购入口、礼品卡地区、余额、续费与账单账号。',
  takeaway:'先确认目标套餐支持 App Store 内购，再确认账户与礼品卡地区、余额和付款要求。给 Apple 账户充值，不等于已经为 AI 账号开通订阅。',
  sections:[
   s('eligible','余额可以用于哪些订阅？',`<p>${a(appleBalance,'Apple 官方说明')}允许使用账户余额支付部分 App Store 应用订阅，但也列出了不适用情况，某些购买仍需登记信用卡。因此，“余额足够”只是其中一个条件，不能推定所有 AI 套餐、所有地区都支持。</p><p>先打开你要订阅的官方 App，登录准备长期使用的 AI 账号，检查是否确实出现该套餐的 Apple 内购结算页。若只有官网购买入口，不要先买礼品卡再寻找兑换方法。最终可用付款方式应在自己的购买页面确认。</p>`),
   s('accounts','先分清 Apple 账户与 AI 账号',`<p>建议在付款前记下两个对象：负责 App Store 付款的 Apple 账户，以及将获得权益的 ChatGPT、Claude 等产品账号。它们可能使用不同邮箱；两者一致与否，也不能只看收据的收件地址。</p><p>例如，已在浏览器订阅过的人换用 iPhone，并不自动需要再买一次。先检查现有计划和收据，确认是否只是登录了另一个产品账号。${a('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI 的 Plus 说明')}提供了“已扣款但仍显示 Free”的账号与恢复购买排查入口；其他产品请使用各自的官方帮助。</p>`),
   s('gift-card','礼品卡购买前确认什么？',`<p>${a(appleGift,'Apple 的兑换问题说明')}指出，礼品卡不能在购买国家或地区之外兑换。不要只凭币种相同就认定通用，也不要把 Apple Store 硬件礼品卡、App Store 礼品卡和已充值余额混作同一种商品。</p><ul><li>确认礼品卡类型、购买地区与本人账户的适用条件。</li><li>记录结算总额与币种；标价、税费和礼品卡实际购买成本分别核对。</li><li>先确认套餐能够购买，再判断余额是否足够覆盖本次及之后的费用。</li></ul><p>如果卖家只承诺“能充值”，但不能说明卡种或地区，这不足以回答“能否订阅目标 AI 服务”。保存商品说明和官方核验结果，再作购买决定。</p>`),
   s('renewal','开通后怎样管理续费？',`<p>完成付款后，在相同 Apple 账户的订阅列表确认计划、下次扣款或到期日期；取消入口见 ${a(appleCancel,'Apple 订阅管理说明')}。取消订阅与申请退款是两件事，应分别查看处理结果。</p><p>本站 ${a('/following','我的 AI 订阅')}可以保存你已核对的到期日期；它不能读取 Apple 账单或替你取消服务。需要比较官网与内购渠道时，先看 ${a('/guides/official-subscription-channels','官方购买渠道的区别')}，再按同一套餐、周期与地区比较。</p>`),
  ],
  sources:[ref(appleBalance,'Apple：余额可以购买什么'),ref(appleGift,'Apple：礼品卡兑换与地区限制'),ref(appleCancel,'Apple：取消订阅'),ref('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI：Plus 与已扣款未开通的排查')],
  actions:[ref('/official-prices','查看官方价格与地区参考'),ref(PURCHASE_GUIDE_PATHS.payment,'遇到付款问题，按渠道排查')],related:['/guides/official-subscription-channels','/guides/regional-price-total-cost','/help/price-alerts'],
 },
 {
  path:PURCHASE_GUIDE_PATHS.play,title:'Google Play 怎么管理 AI 订阅？购买资格、续费与重复扣费排查',
  updated:'2026-09-20',
  description:'按步骤查找 Google Play 订单、管理 AI 订阅与取消续费，用订单核对清单区分账号、账单渠道、金额、周期和付款状态。',
  takeaway:'使用 Android 手机不代表订阅一定由 Google Play 扣费。先用订单确认购买渠道和账号，再处理付款、取消或权益问题，避免重复开通。',
  sections:[
   s('channel','第一步：查订单，确认购买渠道和账号',`<ol><li><strong>核对付款账号：</strong>打开 Play 商店，点右上角头像，确认当前 Google 账号；同时记下实际使用 AI 服务的账号，两者可能不同。</li><li><strong>打开订单历史：</strong>进入“付款和订阅 → 预算和历史记录”。也可以在 Play 网页版头像菜单中打开“付款和订阅 → 预算和订单记录”；界面文字以当前版本为准。</li><li><strong>找到原始订单：</strong>用产品、日期和金额查找，并对照购买确认邮件。${a(playOrders,'Google 的订单说明')}指出，确认邮件发送到购买所用的 Google 账号；其他 Google 付款未必出现在 Play 订单历史中，可到 Google 付款中心继续核对。</li><li><strong>仍找不到时先查渠道：</strong>检查自己是否用了另一个 Google 账号，或原本在官网、App Store 购买。确认原账单方后，再去对应入口管理。</li></ol><p>换设备、重装 App 或更换登录方式，不代表需要重新购买。先查清原订阅，再决定是否开通。</p>`),
   s('eligibility','地区、付款资料与套餐入口怎样核对？',`<p>${a(playCountry,'Google Play 国家或地区说明')}指出，地区会影响可获得的内容；更改地区有资格与操作限制，也会影响原地区余额的使用。不要把地区设置当成随时可以切换的折扣选项。</p><p>先核对本人所在地区、付款资料和目标 App 的购买入口，再看 ${a('https://support.google.com/googleplay/answer/2651410','当地支持的付款方式')}。该帮助页需要选择实际国家或地区，不能直接套用美国列表。看得到某个 App，也不等于它的每个套餐都提供 Play 内购。</p><p>比较报价时，记录周期、优惠结束后的价格与结算总额。本站的 App Store 地区参考不是 Google Play 报价，不能把那里的低价直接套到 Android 订单。${a('/guides/regional-price-total-cost','查看地区标价与实付成本的核对方法')}。</p>`),
   s('manage','第二步：查看续费，按需要取消并确认结果',`<ol><li><strong>进入订阅列表：</strong>使用购买所用 Google 账号打开 Play 商店“付款和订阅 → 订阅”，也可从 ${a(playManage,'Google 官方订阅管理说明')}进入列表。</li><li><strong>打开目标订阅：</strong>核对计划、付款周期、下次扣费或到期日期，以及页面显示的付款方式与金额。</li><li><strong>需要停止续费时：</strong>选择“取消订阅”，按页面提示完成全部步骤。仅卸载 App 不会取消订阅。</li><li><strong>回到订阅详情确认：</strong>保存取消后的状态和权益结束日期；普通订阅通常仍可用到已付费周期结束，取消不等于已获退款。</li></ol><p>上述步骤以普通自动续费订阅为例。预付计划和分期承诺可能有不同规则；停止下一轮续订未必免除本期剩余分期款项，需核对具体计划条款。</p>`),
   s('duplicate','第三步：逐笔填写订单核对清单',`<p>怀疑重复扣费或已扣款未开通时，把每笔订单按下表记录；不要只凭银行账单上的两个金额判断重复付款。</p><div class="guide-table"><table><thead><tr><th>核对项</th><th>记录什么</th><th>从哪里查</th></tr></thead><tbody><tr><td>产品账号与计划</td><td>实际使用 AI 的账号、计划名称和权益状态</td><td>该 AI 服务的账号设置</td></tr><tr><td>付款账号与渠道</td><td>购买所用 Google 账号；是否确属 Play 账单</td><td>Play 账号菜单、原始收据</td></tr><tr><td>订单与日期</td><td>订单编号、付款日期；保留原始邮件</td><td>订单历史、购买确认邮件</td></tr><tr><td>金额与币种</td><td>本次总额、币种和已列出的税费</td><td>收据与付款明细</td></tr><tr><td>周期与后续费用</td><td>本期覆盖时间、下次扣费或到期日、页面所列续费金额</td><td>订阅详情与计划条款</td></tr><tr><td>订单和权益状态</td><td>成功、待处理或退款状态；权益是否到账</td><td>订单结果与产品账号分别核对</td></tr><tr><td>取消结果</td><td>是否已停止续费、权益何时结束</td><td>操作后的订阅详情</td></tr></tbody></table></div><p>两笔费用可能属于不同渠道、账号或周期。先核对这些差异；已扣款但没有权益时，保留收据并联系对应官方支持，不反复点购买来测试。Google Play 的订单入口和状态查询见 ${a(playOrders,'订单历史说明')}。</p><p>必要订单资料只提交给官方支持渠道，不在公开评论或本站反馈中张贴密码、验证码、完整卡号。确认续费日后，可以在 ${a('/following','我的 AI 订阅')}设提醒；本站不会代替 Google Play 取消、退款或管理扣款。</p>`),

  ],
  sources:[ref(playOrders,'Google Play：查询订单历史与购买确认邮件'),ref(playCountry,'Google Play：国家或地区'),ref('https://support.google.com/googleplay/answer/2651410','Google Play：按地区查看付款方式'),ref(playManage,'Google Play：取消、更改与管理订阅')],
  actions:[ref('/official-prices','核对价格参考的实际渠道'),ref(PURCHASE_GUIDE_PATHS.payment,'查看付款失败排查步骤')],related:['/guides/official-subscription-channels','/guides/renewal-checklist','/help/price-alerts'],
 },
 {
  path:PURCHASE_GUIDE_PATHS.payment,title:'AI 订阅支付失败怎么办？按官网、Apple 和 Google Play 分别排查',
  description:'区分付款被拒、已扣款未开通、续费失败和疑似重复付款，先确认订单与账单渠道，再使用对应的官方处理入口。',
  takeaway:'先判断钱有没有实际扣款、订单是否成功，再看权益。付款失败不一定是余额不足；已扣款未开通时，先核对账号与订单，避免重复购买。',
  sections:[
   s('state','先把问题归到正确的一类',`<div class="guide-table"><table><thead><tr><th>看到的情况</th><th>先核对什么</th><th>下一步</th></tr></thead><tbody><tr><td>结算提示被拒</td><td>付款信息、银行提示、地区与可用付款方式</td><td>按实际账单渠道排查</td></tr><tr><td>已有成功收据，仍无权益</td><td>订单状态、产品账号与原登录方式</td><td>走恢复购买或官方支持</td></tr><tr><td>原订阅续费失败</td><td>到期日、付款方式有效期与渠道通知</td><td>先处理原订阅，避免另开一份</td></tr><tr><td>出现两笔费用</td><td>是否同账号、同周期、同渠道</td><td>逐笔核对订单，再申请处理</td></tr></tbody></table></div><p>这张表用来整理问题，不是对某笔扣款原因的诊断。把提示原文、时间和订单结果保存下来，比只描述“买不了”更便于客服定位。</p>`),
   s('website','官网付款被拒怎么处理？',`<p>${a('https://help.openai.com/en/articles/7232916-why-was-my-credit-card-declined','OpenAI 的卡片被拒说明')}建议核对卡片资料、账单信息、余额及银行限制，也要求确认服务与发卡地区是否受支持。先向发卡行确认拒付原因；换卡或反复重试不能保证解决资格问题。</p><p>按照官方结算页填写真实资料，不要根据网上所谓“必过地址”修改账单身份。其他 AI 产品的支持范围和付款规则要分别检查，不能把某个平台的成功经验当成通用办法。</p>`),
   s('stores','Apple 和 Google Play 分别看哪里？',`<p><strong>Apple：</strong>从 ${a('https://support.apple.com/en-us/108095','Apple 的付款方式被拒说明')}进入排查。检查所用 Apple 账户、付款方式及未结清订单；如果涉及礼品卡，另核对卡种与地区。${a(PURCHASE_GUIDE_PATHS.apple,'查看余额和礼品卡订阅条件')}。</p><p><strong>Google Play：</strong>按 ${a(playPayment,'Google Play 的付款问题说明')}核对付款资料、验证提示、卡片信息及地区要求。有未完成的付款验证时，使用官方页面处理。${a(PURCHASE_GUIDE_PATHS.play,'查看 Play 订阅和账号排查')}。</p><p>看到两家应用商店的不同错误提示时，分别记录。不要为了尝试开通而在官网和应用商店同时购买；先确认前一笔订单是否已经成功。</p>`),
   s('charged','已经扣款，怎样避免再次付款？',`<p>先保存收据，核对真正获得权益的产品账号。${a('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI Plus 帮助')}列出了检查登录方式、在支持的 App 中恢复购买等步骤；其他服务使用对应的官方流程。</p><p>如果处理后仍有异常，把订单状态、问题发生时间和尝试过的步骤整理给账单渠道或产品方。不要把银行预授权、成功订单和退款处理中混为一个状态，具体结果以银行及服务方确认为准。</p><p>本站可以提供 ${a('/official-prices','价格与来源参考')}，不能查询或更改你的支付订单。公开反馈报价错误时，只需给出商品链接与错误位置；私人付款资料留在官方支持渠道处理。</p>`),
  ],
  sources:[ref('https://help.openai.com/en/articles/7232916-why-was-my-credit-card-declined','OpenAI：付款卡片被拒'),ref('https://support.apple.com/en-us/108095','Apple：付款方式被拒'),ref(playPayment,'Google Play：付款问题'),ref('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI：已扣款但未显示订阅')],
  actions:[ref('/guides/renewal-checklist','购买与续费前核对清单'),ref('/official-prices','核对套餐与购买渠道')],related:[PURCHASE_GUIDE_PATHS.apple,PURCHASE_GUIDE_PATHS.play,'/guides/official-subscription-channels'],
 },
].map(article=>({...article,section:{path:'/guides',label:'订阅指南'},published:'2026-09-18',updated:article.updated||'2026-09-18'}));
