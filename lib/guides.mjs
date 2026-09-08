// Editorial content is versioned with the site. Dates change only after a
// substantive review, not when quotes refresh. Never interpolate request data.
export const CONTENT_SECTIONS = [
 {path:'/guides',title:'订阅指南',description:'看懂交付方式、报价差异与续费条件，再选择适合自己的 AI 订阅。',intro:'价格之外，也把条件看清楚。'},
 {path:'/help',title:'帮助中心',description:'学习如何比较报价、设置关注提醒，了解 AI订阅雷达的数据与排序方法。',intro:'从第一次比价，到下一次续费。'},
];
const plus='/?family=chatgpt&amp;product=chatgpt-plus';
const help={path:'/help',label:'帮助中心'};
const guides={path:'/guides',label:'订阅指南'};
const link=(href,label)=>`<a href="${href}">${label}</a>`;
const section=(id,title,html)=>({id,title,html});
const source=(href,label)=>({href,label});
const commonSources=[source('/sources','本站数据说明'),source('/privacy','隐私与访问统计说明')];

export const ARTICLES = [
 {
  path:'/help/compare-prices',section:help,title:'如何用 AI订阅雷达比较价格？',
  description:'从产品、交付方式到期限与币种，按实际页面完成一次同条件比价，识别不能直接比较的报价。',
  takeaway:'先限定你需要的购买条件，再看价格排序。不同期限或交付方式的最低总价，回答的不是同一个购买问题。',
  sections:[
   section('choose-product','先选产品，再选交付方式',`<p>在总览中选择品牌，再进入具体产品。以 ${link(plus,'ChatGPT Plus 报价页')} 为例，同一产品可能同时有代充、成品号、共享或合租、卡密等报价。先选与你需求相符的交付方式，页面才会列出该组店铺报价。</p><p>如果你希望继续使用自己的账号，应先查看明确写出给买家现有账号开通权益的商品；如果交付说明不明确，不要仅凭产品名称认定适用。“卡密”只是交付载体，仍要核对它用于充值、兑换账号还是加入其他服务。</p>`),
   section('same-conditions','把需要一致的条件选出来',`<p>展开“规格与币种筛选”，选择所需期限、地区和币种。还可以按交易平台筛选，方便回到自己熟悉的平台核验。产品页列出的规格来自已识别的商品信息，不是站方额外承诺的权益。</p><div class="guide-table"><table><thead><tr><th>看到的条件</th><th>怎样处理</th></tr></thead><tbody><tr><td>1 个月与 12 个月</td><td>分别看总价；年付折算月均支出时，还要保留全年预付金额。</td></tr><tr><td>1 个月与 30 天</td><td>按页面原有规格分别比较，不擅自合并有效期。</td></tr><tr><td>期限未注明</td><td>去原商品页确认，不能拿“质保 30 天”补成订阅 30 天。</td></tr><tr><td>不同币种或地区</td><td>分别核对；本站价格排序不会把不同币种换算成同一货币。</td></tr></tbody></table></div>`),
   section('sort','理解你正在使用的排序',`<p>“综合排序”优先展示 X 已关联的店铺，其次是店铺已收录的报价，同类内再按价格从低到高。它不等于全列表最低价排序。如果现在只想按金额查看，请主动选择“价格从低到高”。${link('/help/data-and-ranking','查看完整排序与标记说明')}。</p><p>即使选了价格排序，仍需留意所选范围里有没有期限、人数或适用条件不一致的商品。规格筛选能缩小范围，无法替代购买前核验。官方订阅或 API 参考报价单独展示，不计入店铺报价。</p>`),
   section('verify','比较完成后，回原店核验',`<ol><li>核对报价时间和当前状态。上次记录不代表现在仍有货。</li><li>打开“前往店铺”，检查相同商品、相同规格的结算金额，有没有额外费用。</li><li>确认自己的账号是否适用，以及交付步骤、开始计时方式、续费和退款条件。</li><li>还没决定时，点击“关注这个产品”；选好可比规格后，可以保存目标价格或到期日期。</li></ol><p>发现标题、规格或跳转不一致，可通过 ${link('/submit?type=feedback','数据反馈')} 提交商品链接和错误位置。无需提供账号密码。</p>`),
  ],sources:[...commonSources,source('/?family=chatgpt&product=chatgpt-plus','ChatGPT Plus 当前报价与筛选')],
  actions:[source('/?family=chatgpt&product=chatgpt-plus','用 ChatGPT Plus 试一次比价'),source('/help/price-alerts','下一步：设置关注提醒')],related:['/guides/why-prices-differ','/help/data-and-ranking'],
 },
 {
  path:'/help/price-alerts',section:help,title:'如何设置降价提醒和订阅到期提醒？',
  description:'了解本机关注、账号同步、目标价格、到期日期和日历导出；按实际流程开启或暂停邮件提醒。',
  takeaway:'关注可以先保存在本机。要接收邮件，需要登录账号，并在“我的关注”里主动开启自选邮件提醒。',
  sections:[
   section('save','先保存一个关注',`<p>从产品报价页点击“关注这个产品”，或到 ${link('/following','我的关注')} 点击“添加关注”。在弹出的“关注条件”中选择产品，再选择期限、交付方式与适用条件。</p><p>只想收藏时，选择“关闭价格提醒（仅收藏）”，然后保存。还没有明确可比规格的产品可以先关注，等规格信息足够时再调整条件；不要为了设置一个低价提醒而选与自己需求不同的规格。</p><p>未登录时，清单保存在当前浏览器。换设备、换浏览器或清除站点数据后，本机清单可能无法继续使用。需要跨设备同步时，注册并验证邮箱、设置密码后登录。已有本机关注时，按页面提示选择是否加入当前账号。</p>`),
   section('price','选择符合需求的价格条件',`<div class="guide-table"><table><thead><tr><th>提醒方式</th><th>适合什么需求</th></tr></thead><tbody><tr><td>降至目标价格或更低</td><td>已经知道预算，输入所选规格币种下的目标金额。</td></tr><tr><td>价格明显下降</td><td>设定累计下降幅度，等待同规格报价出现符合条件的变化。</td></tr><tr><td>明确售罄后恢复有货</td><td>等待有明确售罄记录的规格恢复；暂未获取数据不等于售罄。</td></tr><tr><td>每周查看一次报价</td><td>希望定期了解所关注规格的报价。</td></tr></tbody></table></div><p>保存条件不会自动开启邮件。登录后，在“我的关注”点击“开启自选邮件提醒”，才会启用你选择的邮件通知。注册账号本身不订阅行情邮件。本站当前按邮箱每天最多发送一封提醒汇总，不承诺价格一变就即时送达。</p>`),
   section('renewal','添加到期日期，或导出到日历',`<p>在关注条件里展开“我正在使用：添加到期日期”，填写你核实过的到期日，并选择提前 1 天、3 天、7 天或到期当天提醒。保存后，可在关注卡片点击“加入日历”，下载并导入日历文件。</p><p>日历文件需要实际导入你的日历应用，并允许该应用通知，才能由日历提醒你。网站不会读取你的订阅账单，也不会自动知道真实到期时间。续费后，要自行更新本站关注里的日期；此前导入日历的旧事件也需要在日历中检查或修改。</p>`),
   section('manage','没有收到邮件时，按顺序检查',`<ol><li>确认当前已登录，并已开启自选邮件提醒；本机收藏不会自动发送邮件。</li><li>确认这一项关注没有暂停，价格提醒方式没有关闭，需要价格提醒时已选择明确规格。</li><li>查看目标价格或变化条件是否真的满足；没有有效可比报价时，不会凭缺失数据推断降价或补货。</li><li>检查邮箱垃圾邮件和过滤规则，并留意汇总发送频率。</li></ol><p>可以修改或移除单项关注，也可以暂停这一项的所有提醒。在“我的关注”可暂停全部邮件，邮件内也提供退订入口。暂停邮件不等于取消第三方订阅；取消续费仍需在实际购买渠道处理。</p>`),
  ],sources:[source('/following','我的关注与关注条件'),source('/register','注册流程'),source('/privacy','账号与提醒的数据说明')],
  actions:[source('/following','打开我的关注'),source('/','先选择一个产品')],related:['/help/compare-prices','/guides/renewal-checklist'],
 },
 {
  path:'/help/data-and-ranking',section:help,title:'报价、综合排序和店铺标记是怎么来的？',
  description:'解释公开报价来源、更新时间、综合与价格排序、店铺收录和 X 关联，以及参考起价的范围。',
  takeaway:'本站展示收录范围内的公开信息。报价来源、排序位置与店铺标记各有含义，需要分别理解。',
  sections:[
   section('sources','报价来自哪些地方',`<p>本站读取部分原始店铺的公开商品目录，也使用第三方公开汇总补充条目。每条报价尽量保留原商品入口、公开店铺信息、交易平台和记录时间。并非所有报价都由本站直接读取原店，不能把“本站可见”理解成“本站已逐笔确认可成交”。</p><p>官方订阅参考和 API 套餐可能同样来自第三方汇总。“官方参考”描述报价类别，不代表品牌方对本站数据的实时确认。它们与店铺报价分开展示，购买前还需回到对应服务的官方页面或结算页面核对。</p>`),
   section('ranking','三种排序分别怎样工作',`<div class="guide-table"><table><thead><tr><th>模式</th><th>当前依据</th></tr></thead><tbody><tr><td>综合排序</td><td>X 已关联优先，其次店铺已收录，其余报价随后；同类内按价格从低到高。</td></tr><tr><td>价格从低到高</td><td>在当前筛选条件下按报价金额升序，关联标记不增加优先级。</td></tr><tr><td>价格从高到低</td><td>在当前筛选条件下按报价金额降序，便于查看不同价格段。</td></tr></tbody></table></div><p>不同币种分别排序，不做汇率换算。先选产品、交付方式和明确规格，再比较排序结果。Sponsored 广告有独立标识与展示位置，不改变自然报价的排序规则。</p>`),
   section('badges','“店铺已收录”和“X 已关联”说明什么',`<p>“店铺已收录”表示店铺申请经过站方审核，已建立公开店铺与报价的收录关系。“X 已关联”表示店主自愿认领，站方核对 X 账号控制和店铺归属后，公开展示关联账号。</p><p>这些标记用于帮助识别和联系商家，不是用户评价、交易履约评分，也不代表对商品质量或账号长期可用性的保证。没有标记也不能直接推断商家有问题，可能只是尚未申请或完成核对。店主可通过 ${link('/submit-shop','提交店铺')} 或 ${link('/claim-shop?new=1','认领 X')} 发起流程。</p>`),
   section('timing','更新时间与历史起价怎样理解',`<p>报价时间表示本站记录或核验这条信息的时间。待核验、暂时缺少数据和明确售罄是不同状态，不能互相替代。保留历史记录有助于回看，但不意味着旧价格仍然可以购买。</p><p>同规格起价只覆盖本站在对应观察时刻收录、可用且条件已识别的报价。某家低价店铺退出收录范围，也可能让起价上升；这不必然意味着所有商家同时涨价。${link('/weekly','行情周报')} 比较同一规格在观察窗口内的记录，历史不足时不会补造整周变化。</p><p>如果发现来源错误、时间异常、关联有误或商品条件未正确识别，请提交原链接、你看到的内容和核对时间。站方通过 ${link('/submit?type=feedback','数据反馈')} 接收复核线索，私人联系方式不会自动成为公开商家资料。</p>`),
  ],sources:[...commonSources,source('/advertise','广告合作与 Sponsored 说明')],
  actions:[source('/','按自己的条件查看报价'),source('/submit?type=feedback','反馈一处数据问题')],related:['/help/compare-prices','/guides/why-prices-differ'],
 },
 {
  path:'/guides/chatgpt-plus-delivery',section:guides,title:'ChatGPT Plus 代充、成品号和共享席位怎么比较？',
  description:'区分给现有账号开通权益、交付另一账号、多人共享和独立席位，结合本站报价标签核对购买条件。',
  takeaway:'名称都写 ChatGPT Plus，不代表交付的是同一种东西。先确认你最终登录哪个账号、由谁控制、获得什么权益。',
  sections:[
   section('delivery','先看交付对象，而不是商品标题里的低价',`<div class="guide-table"><table><thead><tr><th>页面分类</th><th>通常描述什么</th><th>需要进一步确认</th></tr></thead><tbody><tr><td>代充</td><td>为买家已有账号开通或续费权益</td><td>账号资格、开通渠道、能否续费或覆盖已有权益</td></tr><tr><td>成品号</td><td>交付另一个已准备好的账号</td><td>账号及恢复方式由谁控制、订阅剩余期限、是否支持更改资料</td></tr><tr><td>共享或合租</td><td>多人使用同一账号或第三方服务</td><td>实际登录入口、访问范围、数据可见性与服务条款</td></tr><tr><td>席位</td><td>某个工作区或服务中的成员权限</td><td>具体产品与计划、是否独立成员身份、管理员权限和退出后的影响</td></tr><tr><td>卡密</td><td>交付兑换码或凭据</td><td>兑换后究竟得到什么，不能仅由“卡密”判断交付类型</td></tr></tbody></table></div><p>这些是对商品描述的分类，不是对商家承诺的背书。遇到“交付待确认”或描述冲突，应先问清楚商品内容。</p>`),
   section('account','共享账号与独立成员席位不能混为一谈',`<p>OpenAI 的公开账号政策说明，个人账号供创建者本人使用，其他人需要使用时应注册自己的账号。自己在多台设备登录，与多人共用一套登录凭据是不同情形。${link('https://help.openai.com/en/articles/10471989-openai-account-sharing-policy','查看 OpenAI 账号共享政策')}。</p><p>商家写“共享”“车位”或“席位”，并不足以证明交付的是官方工作区成员资格，也不足以确认其符合服务条款。应核对准确的产品计划与官方说明。不要把其他计划或第三方镜像的权限，直接视为个人 Plus 订阅的等价替代。</p>`),
   section('example','用本站报价标签做一次判断',`<p>截至本文核对时，${link(plus,'ChatGPT Plus 页面')} 中可见“1 个月 · 代充 · 菲律宾”“12 个月 · 代充 · 美国”，也有“期限未注明 · 菲律宾”等标签。这里举的是页面条件，不是对地区方案的购买推荐。</p><ul><li>你想用一个月，就先排除需要全年预付的报价；年价除以 12 只是月均成本，付款义务仍是全年。</li><li>你要续自己的账号，就先核对该商品明确支持你的现有账号状态。</li><li>商品只写“质保 30 天”时，不能直接认定开通期限就是 30 天。</li><li>地区标签描述商品条件，不代表任何地区的账号都适用。</li></ul><p>本文不固定一个“最低价”。当前金额、报价时间和库存以报价页及原店结算页为准，避免把过去的价格当成今天的购买条件。</p>`),
   section('before-paying','付款前，把模糊条件问成具体答案',`<p>至少确认实际交付对象、订阅有效期、开始计时方式、原账号适用条件和退款范围。若需要提交个人账号资料，先了解为何需要、通过什么方式处理；不要向本站反馈表单提交密码或验证码。</p><p>保存原商品说明和订单中确认的条件。发现无法说明交付方式、商品和结算规格不一致，或所谓“独享”实际需要多人共用时，先停止购买并核对。还没决定，可以在产品页关注适合自己的规格，等待价格条件合适后再回来。</p>`),
  ],sources:[source('/?family=chatgpt&product=chatgpt-plus','本站 ChatGPT Plus 报价与购买参考'),source('https://help.openai.com/en/articles/10471989-openai-account-sharing-policy','OpenAI 账号共享政策（核对于 2026-09-08）'),source('/sources','本站报价范围')],
  actions:[source('/?family=chatgpt&product=chatgpt-plus','查看 ChatGPT Plus 当前报价'),source('/help/price-alerts','了解关注与价格提醒')],related:['/guides/renewal-checklist','/guides/why-prices-differ'],
 },
 {
  path:'/guides/why-prices-differ',section:guides,title:'为什么同一个 AI 订阅的报价相差很大？',
  description:'从期限、交付、地区、人数、优惠资格和售后拆解 AI 订阅价差，避免把不同商品的起价直接比较。',
  takeaway:'价差可能来自不同购买条件，也可能来自同条件下的商家报价差异。先排除条件差异，才知道自己是否真的买得更便宜。',
  sections:[
   section('conditions','先检查六组会改变价格的条件',`<ol><li><strong>产品档位：</strong>同一品牌下的不同计划、额度或附加权益不能只按品牌名合并。</li><li><strong>有效期限：</strong>一个月、30 天、一年、剩余期限账号和短期试用，应分别确认。</li><li><strong>交付方式：</strong>为自己的账号开通、交付另一个账号、多人共享或工作区成员权限，是不同购买对象。</li><li><strong>地区与资格：</strong>限定地区、学生或新用户条件的报价，只有满足条件时才有比较意义。</li><li><strong>人数与单位：</strong>整组价格、单席位价格、多个账号和 API 额度的计价单位可能不同。</li><li><strong>售后和实付：</strong>标价之外是否有手续费、退款限制或单独付费的保障，需要在原店核对。</li></ol>`),
   section('examples','三个容易误判的场景',`<div class="guide-table"><table><thead><tr><th>看到的现象</th><th>还不能得出的结论</th><th>下一步</th></tr></thead><tbody><tr><td>共享商品总价低于自有账号代充</td><td>代充商家一定卖贵了</td><td>先比较交付对象、使用权限与适用条款。</td></tr><tr><td>年付折算月均更低</td><td>当月只需支付这个月均金额</td><td>核对全年实付、退款方式和自己的使用时间。</td></tr><tr><td>标题写质保 30 天</td><td>订阅有效期就是 30 天</td><td>分别确认权益期限与售后期限。</td></tr></tbody></table></div><p>本站 ${link(plus,'ChatGPT Plus 报价页')} 同时存在多种期限和交付方式，可以用这些条件实际筛选。其他产品也应采用同样的核对顺序，不能照搬某一个品牌的购买规则。</p>`),
   section('same-spec','条件一致之后，价差仍可能存在',`<p>同规格下，商家报价策略、临时优惠和收费项目仍可能不同。仅从抓取到的标价，无法确认商家的采购成本，也无法解释每一笔价差。应把能查证的商品条件与暂时不知道的原因分开。</p><p>低价本身不能证明欺诈，高价也不能证明服务可靠。更有用的证据是原商品说明、最终结算、商家公开身份、交付与退款条款。本站的收录标记不是成交担保，综合排序也不是基于历史履约形成的信誉评分。</p>`),
   section('history','价格变化也要看观察范围',`<p>本站的同规格起价只反映已收录且当前有效的报价。低价店铺暂时无法核验、某条商品下架，或者新增一家店铺，都可能改变起价。因此“起价下降”不一定表示你上次看中的那家商店降价了。</p><p>看历史记录时，核对规格、币种、实际记录日期和报价覆盖。看 ${link('/weekly','行情周报')} 时，注意它展示的是已有观察数据，历史不足不会推算整周。决定继续观察时，保存明确规格的关注；决定购买时，再回原店核验对应商品。</p>`),
  ],sources:[source('/sources','本站比较方法与报价范围'),source('/weekly','行情周报观察口径'),source('/?family=chatgpt&product=chatgpt-plus','ChatGPT Plus 规格筛选示例')],
  actions:[source('/','选择产品，比较同条件报价'),source('/help/compare-prices','查看比价操作步骤')],related:['/guides/chatgpt-plus-delivery','/help/data-and-ranking'],
 },
 {
  path:'/guides/renewal-checklist',section:guides,title:'购买或续费前，怎样确认报价适用于自己的账号？',
  description:'整理账号状态、现有订阅、购买渠道、续费开始时间和售后条件，避免买到无法使用或无法覆盖的套餐。',
  takeaway:'先确认自己的账号现状，再核对商品要求。网站可以帮助比较报价和记录提醒，无法替你验证账号是否符合某个套餐的开通条件。',
  sections:[
   section('current','先把当前订阅情况查清楚',`<p>在实际服务和购买渠道里确认：现在使用的是哪个账号、什么计划、权益什么时候到期、是否开启自动续费、上次从哪里购买。不要只凭支付记录上的品牌名称判断具体权益。</p><p>如果涉及网站、应用商店或第三方渠道，应在对应渠道确认当前状态及管理入口。不同产品和渠道的续费、取消与退款规则可能不同，本文不把某一家服务的规则套到所有 AI 订阅上，也不提供未核实的统一操作路径。</p>`),
   section('ask','把商品条件问清楚，再决定付款',`<div class="guide-table"><table><thead><tr><th>需要确认的事情</th><th>可以这样提问</th></tr></thead><tbody><tr><td>现有账号是否适用</td><td>我已有该计划，尚未到期；这个商品是否支持续费，是否要求新账号？</td></tr><tr><td>权益怎样接续</td><td>从开通时开始计算，还是接在原到期日之后？有重叠时怎样处理？</td></tr><tr><td>地区与资格</td><td>需要满足哪些账号地区、购买渠道或优惠资格？无法满足时怎样处理？</td></tr><tr><td>实际交付</td><td>是在我现有账号开通，还是交付另一账号或邀请加入其他服务？</td></tr><tr><td>失败与退款</td><td>无法开通、权益提前结束或重复购买时，具体退款和补偿范围是什么？</td></tr></tbody></table></div><p>保存可以回看的回答和订单条件。商家标题写“可续费”“官方”或“质保”，都不能替代上述具体说明。“质保天数”与“订阅天数”要单独确认。</p>`),
   section('avoid-duplicates','避免把提醒当成自动续费管理',`<p>购买新商品之前，先核实原有订阅是否还会自动扣费。本站不能读取你的账单，不能替你取消原订阅，也不会自动更改服务方的续费设置。不要因为在本站设了到期提醒，就认为原渠道已经停止续费。</p><p>也不要只为使用一条优惠报价，先删除账号或取消尚未核实的权益。涉及变更时，应先查看对应服务的当前官方帮助和渠道说明，确认对现有权益的影响，再按实际情况操作。</p>`),
   section('after','开通后，核对结果并更新日期',`<ol><li>回服务内检查计划名称、权益状态和到期时间，确认与订单约定一致。</li><li>保存订单、商品规格与售后入口，发现不一致及时通过原购买渠道处理。</li><li>在 ${link('/following','我的关注')} 修改到期日期，选择需要提前提醒的天数。</li><li>如果以前导入过日历提醒，检查旧事件是否需要修改，避免继续按旧日期提醒。</li></ol><p>价格还不合适时，可以先关注明确规格，再设置目标价格。${link('/help/price-alerts','查看提醒设置教程')}。续费前需要再次比价时，从 ${link('/','产品目录')} 重新核对当前报价，不把上次订单或旧截图当作现在的购买承诺。</p>`),
  ],sources:[source('/sources','本站购买前核验说明'),source('/following','我的关注与到期日期'),source('/help/price-alerts','提醒设置与日历导出教程')],
  actions:[source('/','查找准备续费的产品'),source('/following','记录我的到期日期')],related:['/help/price-alerts','/guides/chatgpt-plus-delivery'],
 },
].map(article=>({...article,published:'2026-09-08',updated:'2026-09-08',author:'AI订阅雷达'}));

export const CONTENT_PATHS = [...CONTENT_SECTIONS.map(s=>s.path),...ARTICLES.map(a=>a.path)];
export const articleForPath=path=>ARTICLES.find(a=>a.path===path);
export const contentForPath=path=>articleForPath(path)||CONTENT_SECTIONS.find(s=>s.path===path);

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=({href,label})=>`<a href="${esc(href)}"${href.startsWith('https://')?' rel="noopener noreferrer"':''}>${esc(label)}</a>`;
function card(article){return `<a class="guide-card" href="${article.path}"><span class="guide-card-kind">${article.section.label}</span><h2>${esc(article.title)}</h2><p>${esc(article.description)}</p><span class="guide-card-bottom">阅读指南 <span aria-hidden="true">↗</span></span></a>`;}
export function contentPage(path){
 const page=contentForPath(path);if(!page)return null;
 const tabs=`<nav class="guide-tabs" aria-label="指南栏目">${CONTENT_SECTIONS.map(s=>`<a href="${s.path}"${(page.section?.path||page.path)===s.path?' aria-current="page"':''}>${s.title}</a>`).join('')}</nav>`;
 if(!page.sections)return `<section class="guide-index">${tabs}<div class="guide-index-heading"><p class="guide-kicker">AIradar / ${page.title}</p><h1>${page.title}</h1><p class="guide-lead">${page.intro}</p><p>${page.description}</p></div><div class="guide-grid">${ARTICLES.filter(a=>a.section.path===path).map(card).join('')}</div><aside class="guide-next"><div><h2>${path==='/guides'?'准备开始比价？':'先看懂购买条件'}</h2><p>${path==='/guides'?'从你需要的产品开始，筛选规格后查看当前报价。':'交付方式、价差和续费条件，都会影响最终选择。'}</p></div><a class="guide-button" href="${path==='/guides'?'/':'/guides'}">${path==='/guides'?'查看产品目录':'阅读订阅指南'} <span aria-hidden="true">→</span></a></aside></section>`;
 return `<article class="guide-article">${tabs}<nav class="guide-breadcrumb" aria-label="当前位置"><a href="/">首页</a><span aria-hidden="true">/</span><a href="${page.section.path}">${page.section.label}</a></nav><header class="guide-article-heading"><p class="guide-kicker">AIradar / ${page.section.label}</p><h1>${esc(page.title)}</h1><p class="guide-lead">${esc(page.description)}</p><p class="guide-meta">${page.author} · 更新于 <time datetime="${page.updated}">${page.updated}</time></p></header><p class="guide-takeaway">${esc(page.takeaway)}</p><div class="guide-reading-layout"><nav class="guide-toc" aria-label="本文目录"><strong>本文内容</strong><ol>${page.sections.map(s=>`<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol></nav><div class="guide-prose">${page.sections.map(s=>`<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('')}<section class="guide-sources"><h2>依据与相关说明</h2><p>依据本站公开页面、实际功能与所列资料整理，AI 辅助撰写。本文示例核对于 ${page.updated}；实时价格请查看报价页，服务规则以对应官方最新说明为准。</p><ul>${page.sources.map(s=>'<li>'+safeLink(s)+'</li>').join('')}</ul><p>内容有误？${link('/submit?type=feedback','提交反馈')}，请附上本文标题和需要更正的位置。</p></section><aside class="guide-next"><h2>接下来可以做什么</h2><div class="guide-actions">${page.actions.map((a,i)=>`<a class="guide-button${i?' secondary':''}" href="${esc(a.href)}">${esc(a.label)} <span aria-hidden="true">→</span></a>`).join('')}</div></aside><nav class="guide-related" aria-label="相关阅读"><h2>相关阅读</h2>${page.related.map(path=>articleForPath(path)).filter(Boolean).map(a=>`<a href="${a.path}">${esc(a.title)} <span aria-hidden="true">→</span></a>`).join('')}</nav></div></div></article>`;
}
export function productGuideLinks(productKey=''){
 return `<aside class="product-guide-links" aria-label="选购与使用指南"><span>选购与使用指南</span><a href="/help/compare-prices">如何比较这些报价</a>${productKey==='chatgpt-plus'?'<a href="/guides/chatgpt-plus-delivery">ChatGPT Plus 交付方式怎么选</a>':'<a href="/guides/why-prices-differ">为什么价格不同</a>'}<a href="/guides/renewal-checklist">购买与续费前核对</a></aside>`;
}
