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
const proGuide='/guides/chatgpt-pro-5x-vs-20x';
const grokGuide='/guides/grok-trial-and-subscription';
const proOfficial='https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers';
const grokOfficial='https://docs.x.ai/grok/faq';
const proKeys=new Set(['chatgpt-pro-5x','chatgpt-pro-20x']);
const grokKeys=new Set(['super-grok','super-grok-heavy','grok-account','grok-supergrok','grok-supergrok-lite','grok-supergrok-heavy']);

export const ARTICLES = [
 {
  path:proGuide,section:guides,title:'ChatGPT Pro 5x 和 20x 怎么选？价格、额度与开通条件',
  published:'2026-09-11',updated:'2026-09-11',
  description:'比较 ChatGPT Pro 5x 与 20x 的用量档位、购买渠道和续费条件，了解 2026 年 9 月 Pro 20x 新订阅暂停对选购的影响。',
  takeaway:'先确认能否开通，再比较价格。核对截至 2026-09-11：Pro 20x 新订阅和升级已暂停，现有订阅仍可正常续费；Pro 5x 不受这次暂停影响。',
  sections:[
   section('availability','Pro 20x 现在还能新开吗？',`<p>OpenAI 于 2026 年 9 月 10 日起暂停 Pro $200（20x）的新订阅和升级。现有 20x 订阅续费，以及 Pro $100（5x）的新订阅和现有订阅不受影响。若 20x 取消或降档生效，暂停期间无法重新购买。${link(proOfficial,'查看 OpenAI 当前说明')}；本文核对于 2026-09-11，暂停是否解除请以该说明为准。</p><p>因此，比价前先分清“已有 20x 续费”和“从其他套餐新开 20x”。商品仍在售、标题写着“官方充值”，都不能单独证明它适用于你的账号。请让实际购买渠道明确确认交付对象、开通条件和失败处理方式。</p>`),
   section('tiers','5x 和 20x 比较的是什么？',`<p>官方把两档 Pro 的主要区别归为用量额度：5x 对应 $100 档，20x 对应 $200 档，相对 Plus 分别提供 5 倍和 20 倍用量，两档包含相同的核心能力。部分模型另有额度限制；这些倍数不代表回答速度、准确率或账号数量。${link(proOfficial,'核对套餐与额度定义')}。</p><div class="guide-table"><table><thead><tr><th>比较项目</th><th>Pro 5x</th><th>Pro 20x</th></tr></thead><tbody><tr><td>页面识别名称</td><td>ChatGPT Pro $100 档</td><td>ChatGPT Pro $200 档</td></tr><tr><td>选购时先问</td><td>自己的工作量是否需要 Pro 档位？</td><td>是否已有可续费的 20x 订阅？</td></tr><tr><td>比较报价</td><td>在同期限、同渠道下核对金额</td><td>先确认新开或续费条件，再比较金额</td></tr><tr><td>实际使用</td><td colspan="2">查看自己账号内的剩余额度与重置提示</td></tr></tbody></table></div><p>可以先记录一周真实工作：哪些任务会触及当前额度、多久触及一次、能否等待重置。然后用这些记录判断是否需要更高档位。不要把“20x”直接当成每项功能都有固定次数的承诺，也不要只为偶尔一次等待就长期购买超出需要的套餐。</p>`),
   section('compare','同样写 Pro，价格为什么不能直接比？',`<p>打开 ${link('/?family=chatgpt&product=chatgpt-pro-5x','Pro 5x 报价页')} 或 ${link('/?family=chatgpt&product=chatgpt-pro-20x','Pro 20x 报价页')}，先选择期限、交付方式与币种，再看价格排序。给自有账号开通、交付另一账号、共享账号或第三方服务入口，需要分别判断。</p><ol><li><strong>套餐：</strong>确认交付后的账号显示哪个计划；不能用标题里的“Pro”“Codex”替代实际权益。</li><li><strong>期限：</strong>确认开始和结束时间；“质保 30 天”不能填成“订阅 30 天”。</li><li><strong>渠道与地区：</strong>网页、iOS、Android，以及商家所写地区，分别核实是否适用于你的账号。</li><li><strong>费用：</strong>同时记录本次实付和下一次续费金额，不把限时优惠当长期月费。</li></ol><p>OpenAI 的 ${link('https://help.openai.com/en/articles/10421635-multicurrency-billing','多币种说明')} 区分网页订阅和应用商店计费。人民币换算只可作参考；实际币种、费用及购买资格仍需看自己的结算页。</p>`),
   section('billing','Codex、API 余额和第三方服务怎么区分？',`<p>ChatGPT 订阅与 API 平台分别计费。${link('https://help.openai.com/en/articles/9039756','OpenAI 账单说明')} 明确要求在对应平台管理费用。因此，商品含有“Codex”“API”“额度”时，先问它是账号订阅、API 余额，还是商家提供的另一种服务，再选对应报价。</p><p>例如，你需要在自己的 ChatGPT 账号里使用 Pro，而报价交付的是 API 密钥或第三方入口，两者就不是相同的购买对象；即使金额更低，也不能算作同一档 Pro 的折扣。核对后再回本站按确切产品和交付规格筛选。</p>`),
   section('renewal','已经有 20x，续费前先保留什么信息？',`<p>先记下现有账号、计划名称、账单渠道、续费日和当前续费状态。特别是在新开暂停期间，不要为了换地区或尝试低价，未经核实就取消原有订阅；上面的官方暂停说明解释了取消或降档生效后的影响。</p><p>准备比较其他报价时，可以把问题说具体：“我已有 Pro 20x，当前周期尚未结束，这个商品是在同一账号续费，还是会替换账号或现有计划？最终套餐、开始时间与失败退款条件是什么？”保留可回看的商品说明与答复，再决定是否购买。</p><p>本站可在 ${link('/following','我的关注')} 记录你已核实的到期日，不能读取官方账单或替你管理续费。${link('/guides/renewal-checklist','查看完整续费核对表')}。</p>`),
  ],sources:[source(proOfficial,'OpenAI：Pro 档位与 20x 新订阅暂停（核对于 2026-09-11）'),source('https://help.openai.com/en/articles/10421635-multicurrency-billing','OpenAI：多币种与应用商店计费'),source('https://help.openai.com/en/articles/9039756','OpenAI：ChatGPT 与 API 分别计费'),...commonSources],
  actions:[source('/?family=chatgpt&product=chatgpt-pro-5x','比较 Pro 5x 报价'),source('/?family=chatgpt&product=chatgpt-pro-20x','核对 Pro 20x 报价条件')],related:['/guides/chatgpt-go-vs-plus','/guides/renewal-checklist','/help/compare-prices'],
 },
 {
  path:grokGuide,section:guides,title:'Grok 7 天试用是什么？免费试用、短期账号和月付怎么区分',
  published:'2026-09-11',updated:'2026-09-11',
  description:'看懂 Grok 7 天试用、短期成品账号与 SuperGrok 月付的区别，核对资格、账号归属、自动续费和取消入口，再比较同条件报价。',
  takeaway:'“7 天”只是期限线索，不能证明它是官方免费试用。先确认由谁提供、交付哪个账号、什么时候到期，以及到期后是否扣费。',
  sections:[
   section('trial','Grok 是否人人都有 7 天免费试用？',`<p>截至 2026-09-11，本次查阅的 ${link(grokOfficial,'Grok 官方帮助')} 和 ${link('https://docs.x.ai/grok/overview','Grok 官方介绍')} 没有提供适用于所有账号的“7 天免费试用”承诺。官方说明可以免费开始使用 Grok，付费 SuperGrok 提供更高用量；免费使用与限期试用订阅需要分开理解。</p><p>如果你自己的官方网页或应用商店结算页显示试用，应以那里列出的资格、时长、试用后费用与取消规则为准。没有看到对应优惠时，不能拿别人截图、搜索词或第三方商品标题，认定自己的账号也能领取。</p>`),
   section('offers','四种常见描述，分别确认什么？',`<div class="guide-table"><table><thead><tr><th>看到的描述</th><th>需要确认</th><th>容易混淆的地方</th></tr></thead><tbody><tr><td>官方页面上的免费试用</td><td>自己的账号是否符合资格，结束后是否自动续费</td><td>优惠截图不代表所有人都适用</td></tr><tr><td>7 天成品账号</td><td>交付哪个账号，实际剩余期限和账号控制方式</td><td>付费购买短期账号不等于免费领取官方试用</td></tr><tr><td>月付代充或卡密</td><td>是否给自己的账号开通，卡密具体用于什么</td><td>卡密是交付形式，不能单凭名称确认权益</td></tr><tr><td>共享、合租或拼车</td><td>多人共用账号、成员权限还是第三方入口</td><td>人数、数据可见范围和服务提供方可能不同</td></tr></tbody></table></div><p>这是一张阅读商品说明的核对表，不代表品牌认可这些第三方交付方式。没有写清的条件应回原店确认，而不是自己补成最有利的解释。</p>`),
   section('seven-days','“7 天”到底从什么时候开始？',`<p>以本站收录的“7 天 · 成品账号”与“1 个月 · 代充”为例，前者说明的是短期账号规格，后者说明的是另一种期限和交付对象。两者总价不能直接排序后就得出哪一家更便宜；网站默认展示的月付规格，也不等于所有短期规格已售罄。</p><p>付款前，把期限问成可以核对的时间：“从下单、发货、首次登录还是兑换成功开始算？能否查看准确到期时间？如果拿到的是已开通账号，剩余几天？”另外单独询问质保期限与处理范围，避免把售后天数误当成订阅天数。</p><p>这一步尤其适合只准备短期体验的人。如果你希望保留自己的长期账号，应先确认商品能否满足这一点，再比较短期价格。</p>`),
   section('cancel','试用或订阅的续费在哪里管理？',`<p>Grok 官方帮助按购买渠道区分管理入口：网页购买在 Grok 的 Settings → Billing；Apple App Store 或 Google Play 购买则回对应应用商店处理。${link(grokOfficial,'核对 Grok 订阅管理说明')}。先找付款收据，确认是谁扣费、使用哪个账号，不要因设备变了就重复购买。</p><ul><li><strong>Apple：</strong>可在设备“设置 → 你的姓名 → 订阅”查看。Apple 建议不准备续费免费或优惠试用的用户，至少提前 24 小时取消。${link('https://support.apple.com/en-us/118428','Apple 取消订阅说明')}。</li><li><strong>Google Play：</strong>在购买所用 Google 账号的订阅列表管理；卸载应用不会取消订阅。${link('https://support.google.com/googleplay/answer/7018481','Google Play 取消说明')}。</li><li><strong>第三方短期账号：</strong>确认是谁管理付款和续费，以及你能否自行管理。本站的关注和提醒不改变该账号的官方订阅状态。</li></ul><p>不要把某一个渠道的取消期限套到所有购买方式。操作后回相同渠道确认结果，并保存下次扣费或到期信息。</p>`),
   section('compare','怎样在 AI订阅雷达里比较？',`<ol><li>进入 ${link('/?family=grok&product=super-grok','Super Grok 报价页')}，先选择需要的交付方式，再查看期限、人数与币种。</li><li>只比较相同购买对象和期限；条件不明的报价回原店核验，不并入确定的低价。</li><li>记录本次付款和后续费用，检查更新时间、实际库存与商品条款。</li><li>需要等价格时保存明确规格的关注；已开通时，记录自己核对过的到期日。</li></ol><p>如果当前页面没有目标短期规格，不用月付商品代替它，也不把旧价格当成今天必然可买到的报价。${link('/help/compare-prices','查看比价步骤')}；${link('/help/price-alerts','了解价格与到期提醒')}。</p>`),
  ],sources:[source(grokOfficial,'Grok 官方：订阅管理与账号（核对于 2026-09-11）'),source('https://docs.x.ai/grok/overview','Grok 官方：免费使用与付费计划'),source('https://support.apple.com/en-us/118428','Apple：取消订阅及试用续费'),source('https://support.google.com/googleplay/answer/7018481','Google Play：管理与取消订阅'),source('/product?source=direct-shops&id=super-grok','本站 Super Grok 规格示例（会随报价变化）')],
  actions:[source('/?family=grok&product=super-grok','按规格比较 Super Grok'),source('/help/price-alerts','记录价格与到期提醒')],related:['/guides/why-prices-differ','/guides/renewal-checklist','/guides/official-subscription-channels'],
 },
 {
  path:'/help/compare-prices',updated:'2026-09-09',section:help,title:'如何用 AI订阅雷达比较价格？',
  description:'从产品、交付方式到期限与币种，按实际页面完成一次同条件比价，识别不能直接比较的报价。',
  takeaway:'先限定你需要的购买条件，再看价格排序。不同期限或交付方式的最低总价，回答的不是同一个购买问题。',
  sections:[
   section('choose-product','先选产品，再选交付方式',`<p>在总览中选择品牌，再进入具体产品。以 ${link(plus,'ChatGPT Plus 报价页')} 为例，同一产品可能同时有代充、成品号、共享或合租、卡密等报价。先选与你需求相符的交付方式，页面才会列出该组店铺报价。</p><p>如果你希望继续使用自己的账号，应先查看明确写出给买家现有账号开通权益的商品；如果交付说明不明确，不要仅凭产品名称认定适用。“卡密”只是交付载体，仍要核对它用于充值、兑换账号还是加入其他服务。</p>`),
   section('same-conditions','把需要一致的条件选出来',`<p>展开“规格与币种筛选”，选择所需期限、地区和币种。还可以按交易平台筛选，方便回到自己熟悉的平台核验。产品页列出的规格来自已识别的商品信息，不是站方额外承诺的权益。</p><div class="guide-table"><table><thead><tr><th>看到的条件</th><th>怎样处理</th></tr></thead><tbody><tr><td>1 个月与 12 个月</td><td>分别看总价；年付折算月均支出时，还要保留全年预付金额。</td></tr><tr><td>1 个月与 30 天</td><td>按页面原有规格分别比较，不擅自合并有效期。</td></tr><tr><td>期限未注明</td><td>去原商品页确认，不能拿“质保 30 天”补成订阅 30 天。</td></tr><tr><td>不同币种或地区</td><td>分别核对；本站价格排序不会把不同币种换算成同一货币。</td></tr></tbody></table></div>`),
   section('sort','理解你正在使用的排序',`<p>“综合排序”优先展示 X 已关联的店铺，其次是店铺已收录的报价，同类内再按价格从低到高。它不等于全列表最低价排序。如果现在只想按金额查看，请主动选择“价格从低到高”。${link('/help/data-and-ranking','查看完整排序与标记说明')}。</p><p>即使选了价格排序，仍需留意所选范围里有没有期限、人数或适用条件不一致的商品。规格筛选能缩小范围，无法替代购买前核验。官方订阅参考报价单独展示，不计入店铺报价。需要核对地区原币价格，可打开 ${link('/official-prices','官方地区价总览')}，该表使用单独的数据与换算说明。</p>`),
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
  description:'核对 ChatGPT Plus 代充、成品号和共享席位的账号归属、有效期与续费条件，理解 GPT 菲区报价、结算币种和购买资格的区别。',
  takeaway:'名称都写 ChatGPT Plus，不代表交付的是同一种东西。先确认你最终登录哪个账号、由谁控制、获得什么权益。',
  updated:'2026-09-09',
  sections:[
   section('delivery','先看交付对象，而不是商品标题里的低价',`<div class="guide-table"><table><thead><tr><th>页面分类</th><th>通常描述什么</th><th>需要进一步确认</th></tr></thead><tbody><tr><td>代充</td><td>为买家已有账号开通或续费权益</td><td>账号资格、开通渠道、能否续费或覆盖已有权益</td></tr><tr><td>成品号</td><td>交付另一个已准备好的账号</td><td>账号及恢复方式由谁控制、订阅剩余期限、是否支持更改资料</td></tr><tr><td>共享或合租</td><td>多人使用同一账号或第三方服务</td><td>实际登录入口、访问范围、数据可见性与服务条款</td></tr><tr><td>席位</td><td>某个工作区或服务中的成员权限</td><td>具体产品与计划、是否独立成员身份、管理员权限和退出后的影响</td></tr><tr><td>卡密</td><td>交付兑换码或凭据</td><td>兑换后究竟得到什么，不能仅由“卡密”判断交付类型</td></tr></tbody></table></div><p>这些是对商品描述的分类，不是对商家承诺的背书。遇到“交付待确认”或描述冲突，应先问清楚商品内容。</p>`),
   section('account','共享账号与独立成员席位不能混为一谈',`<p>OpenAI 的公开账号政策说明，个人账号供创建者本人使用，其他人需要使用时应注册自己的账号。自己在多台设备登录，与多人共用一套登录凭据是不同情形。${link('https://help.openai.com/en/articles/10471989-openai-account-sharing-policy','查看 OpenAI 账号共享政策')}。</p><p>商家写“共享”“车位”或“席位”，并不足以证明交付的是官方工作区成员资格，也不足以确认其符合服务条款。应核对准确的产品计划与官方说明。不要把其他计划或第三方镜像的权限，直接视为个人 Plus 订阅的等价替代。</p>`),
   section('example','用本站报价标签做一次判断',`<p>截至本文核对时，${link(plus,'ChatGPT Plus 页面')} 中可见“1 个月 · 代充 · 菲律宾”“12 个月 · 代充 · 美国”，也有“期限未注明 · 菲律宾”等标签。这里举的是页面条件，不是对地区方案的购买推荐。</p><ul><li>你想用一个月，就先排除需要全年预付的报价；年价除以 12 只是月均成本，付款义务仍是全年。</li><li>你要续自己的账号，就先核对该商品明确支持你的现有账号状态。</li><li>商品只写“质保 30 天”时，不能直接认定开通期限就是 30 天。</li><li>地区标签描述商品条件，不代表任何地区的账号都适用。</li></ul><p>本文不固定一个“最低价”。当前金额、报价时间和库存以报价页及原店结算页为准，避免把过去的价格当成今天的购买条件。</p>`),
   section('region','“GPT 菲区”报价能直接套用到我的账号吗？',`<p>不能只凭地区标签判断。商家写“菲律宾”可能是在描述商品的适用地区或开通条件，不代表所有买家都能按这个金额在官方订阅。OpenAI 的多币种结算说明包含菲律宾比索（PHP）；是否适用以及实际应付多少，仍需看自己的账号和结算页面。</p><p>还要分清购买渠道：网页订阅由网页结算处理，iOS 或 Android 内购买由 Apple App Store 或 Google Play 管理。比较时记下套餐、渠道、币种、最终费用和续费金额，不把其中一个入口的价格直接当作另一个入口的承诺。${link('https://help.openai.com/en/articles/10421635-multicurrency-billing','核对官方多币种与移动端计费说明')}。</p><p>如果你正在比较 Go 与 Plus，应先 ${link('/guides/chatgpt-go-vs-plus','确认套餐差别')}，再比较地区报价。低价对应另一档套餐时，省下的金额也伴随权益变化。</p>`),
   section('ownership','成品号：能改密码不等于掌握账号归属',`<p>购买前分别核对登录邮箱、恢复邮箱、手机号和其他恢复方式由谁控制，哪些资料确实可以变更。只确认能登录或能改密码，无法证明交付者不再拥有恢复入口，也不能替代对官方账号使用政策的检查。</p><p>到期时间也需要单独确认：账号可能已有一段生效中的订阅，交付日不一定是订阅开始日。请商家写明交付时剩余多久、是否会续费、续费由谁操作。把“订阅有效期”“商家质保期”和“承诺服务期”分开记录。</p>`),
   section('before-paying','付款前，把模糊条件问成具体答案',`<p>至少确认实际交付对象、订阅有效期、开始计时方式、原账号适用条件和退款范围。若需要提交个人账号资料，先了解为何需要、通过什么方式处理；不要向本站反馈表单提交密码或验证码。</p><p>保存原商品说明和订单中确认的条件。发现无法说明交付方式、商品和结算规格不一致，或所谓“独享”实际需要多人共用时，先停止购买并核对。还没决定，可以在产品页关注适合自己的规格，等待价格条件合适后再回来。</p>`),
  ],sources:[source('/?family=chatgpt&product=chatgpt-plus','本站 ChatGPT Plus 报价与购买参考'),source('https://help.openai.com/en/articles/10471989-openai-account-sharing-policy','OpenAI 账号共享政策'),source('https://help.openai.com/en/articles/10421635-multicurrency-billing','OpenAI 多币种与移动端结算'),source('/sources','本站报价范围')],
  actions:[source('/?family=chatgpt&product=chatgpt-plus','查看 ChatGPT Plus 当前报价'),source('/help/price-alerts','了解关注与价格提醒')],related:['/guides/chatgpt-go-vs-plus','/guides/chatgpt-plus-trial-day-pass','/guides/renewal-checklist','/guides/why-prices-differ'],
 },
 {
  path:'/guides/chatgpt-go-vs-plus',section:guides,title:'ChatGPT Go 和 Plus 怎么选？代充前核对套餐、账号与续费',
  description:'比较 ChatGPT Go 与 Plus 的适用需求，说明 GPT Go 代充、地区报价和长期套餐要核对什么，以及已有 Plus 切换 Go 的计费注意事项。',
  takeaway:'Go 是独立的官方订阅档位。先确认它能完成你的工作，再比较同套餐、同期限、同交付方式的价格；便宜的 Go 不能直接当作便宜的 Plus。',
  published:'2026-09-09',updated:'2026-09-09',
  sections:[
   section('choose','先按实际任务选 Go 或 Plus',`<p>如果免费版主要卡在传文件、分析表格或生成图片的使用限制，Go 可以作为下一档选择；如果工作依赖更高阶的推理、深度研究或较多 Codex 用量，再核对 Plus。这是按需求做选择的建议，不是对每个人都适用的升级结论。</p><div class="guide-table"><table><thead><tr><th>你正在解决的问题</th><th>Go 与 Plus 怎样比较</th></tr></thead><tbody><tr><td>日常问答已经够用</td><td>先保留免费版，记录真正遇到的限制，不必为了付费而升级。</td></tr><tr><td>文件、图片或数据分析用量不够</td><td>Go 扩大部分常用工具的使用范围；Plus 提供进一步扩展，按自己的使用频率核对。</td></tr><tr><td>依赖高阶推理、深度研究或编程工作</td><td>查看官方套餐表中 Plus 对应的模型与工具权限，以及实际用量限制。</td></tr><tr><td>主要需要调用 API</td><td>ChatGPT 订阅与 API 分开计费，不能把 Go 或 Plus 当作 API 余额。</td></tr></tbody></table></div><p>以上对照依据 ${link('https://chatgpt.com/pricing/','ChatGPT 官方套餐表')} 与 ${link('https://help.openai.com/en/articles/11989085-what-is-chatgpt-go','Go 官方说明')}。功能与额度可能调整，旧文章或商家截图不能替代当前账号中显示的权益。Go 也不应被概括成“完全不能推理”。</p>`),
   section('delivery','搜索“GPT Go 代充”时，先核对实际交付',`<p>“Go”说明套餐档位，“代充”说明商家声称的开通方式，两者回答不同问题。打开 ${link('/?family=chatgpt&amp;product=chatgpt-go','ChatGPT Go 报价页')} 后，先确认产品，再筛交付方式、期限、地区和币种。</p><ol><li><strong>套餐：</strong>开通后应能在官方账号设置中确认具体计划，不能只看商品标题或第三方网站上的标识。</li><li><strong>账号：</strong>明确给你的现有账号开通，还是另外交付一个账号；这两种商品不能直接按低价排序后混买。</li><li><strong>登录入口：</strong>确认是在官方服务使用，还是第三方镜像或共享服务。</li><li><strong>期限与售后：</strong>分别确认权益结束日期、开始计时方式和售后截止日期。</li></ol><p>本站的“代充”分类只整理商家描述，不表示官方授权。若需要转交密码、验证码或恢复信息，应先停下来核实交付方式与账号控制风险。${link('/guides/chatgpt-plus-delivery','阅读账号交付与归属的详细核对方法')}。</p>`),
   section('billing','“Go 年费”和地区低价应该怎样核对',`<p>截至本文核对时，OpenAI 的 Go 说明写明：Go、Plus、Pro 暂不支持官方年付或预付多个月。因此，第三方标为“12 个月”的商品，需要问清是商家逐月续费的服务承诺，还是另有交付安排，不能据此认定为官方年付套餐。</p><p>例如同样写“12 个月”，一次交付已生效的权益与承诺未来每月代续费，买家面对的后续履约条件不同。比较前把总实付、每次续费时间、中断后的退款范围写清楚；折算月均时，也保留全年预付金额。</p><p>地区价格同样要与适用条件一起看。${link('https://help.openai.com/en/articles/10421635-multicurrency-billing','官方多币种说明')} 列有菲律宾比索等结算币种，但币种列表本身不证明你的账号或支付方式符合某一地区方案。以自己的官方结算页面为准，不把地区标签当作购买资格。</p>`),
   section('switch','已经订阅 Plus，切换 Go 会立即退款吗？',`<p>按 ${link('https://help.openai.com/en/articles/11989085-what-is-chatgpt-go','Go 官方常见问题')}，从 Plus 或 Pro 改为 Go，不会因此退还当前周期费用；原计划保留至当前计费周期结束，之后切换到 Go 并按新档位收费。操作前在账号设置中确认生效日期和下次账单。</p><p>这个规则描述官方订阅切换，不自动适用于第三方商家的退款承诺。如果现有权益由商家处理，先查清当前套餐状态、真实到期日和原购买渠道，再决定是否购买新的服务，避免重复付款。可以在本站 ${link('/help/price-alerts','保存到期提醒')}，日期需由你核实并填写。</p>`),
   section('compare','在本站完成一次有意义的比价',`<ol><li>确定目标是 Go 还是 Plus，分别进入对应产品页。</li><li>只比较自己能够使用的交付方式，保留明确的期限和币种。</li><li>回原店核对相同规格的当前结算价、库存、续费与退款条件。</li><li>拿自己的官方结算价格作参照，再判断第三方报价是否值得继续核实。</li></ol><p>页面暂无有效报价时，可以先关注产品；不要把历史起价当作今天一定能买到的金额。本文也不固定一个跨地区通用的“最低价”。</p>`),
  ],sources:[source('https://help.openai.com/en/articles/11989085-what-is-chatgpt-go','OpenAI：ChatGPT Go、计费与套餐切换'),source('https://chatgpt.com/pricing/','ChatGPT 官方套餐对照'),source('https://help.openai.com/en/articles/10421635-multicurrency-billing','OpenAI：多币种结算说明')],
  actions:[source('/?family=chatgpt&product=chatgpt-go','查看 ChatGPT Go 报价'),source('/?family=chatgpt&product=chatgpt-plus','查看 ChatGPT Plus 报价')],related:['/guides/chatgpt-plus-delivery','/guides/renewal-checklist','/help/compare-prices'],
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
 {
  path:'/guides/claude-pro-buying',section:guides,title:'Claude Pro 代充、成品号和 API 额度怎么区分？',
  published:'2026-09-09',updated:'2026-09-09',
  description:'先区分 Claude 个人订阅与 API 计费，再核对代充、成品号、期限和续费条件，按同一种购买对象比较报价。',
  takeaway:'Claude Pro 是个人订阅计划；Claude Console 的 API 使用另行计费。商品都写 Claude，也可能交付完全不同的服务。',
  sections:[
   section('plan','先确认个人订阅的适用范围',`<p>如果你要购买 Claude Pro，先在官方计划说明中确认它是否覆盖自己的使用场景。官方将 Pro 描述为面向个人消费者的付费计划，并明确说明不包含 Claude Console 的 API 用量。不要因为商品标题出现“Claude”“额度”或“API”，就把它当成 Pro 会员。</p><p>在 ${link('/?family=claude&product=claude-pro','Claude Pro 报价页')} 比较个人订阅。具体功能和用量限制请以官方当前计划页面为准。</p>`),
   section('delivery','代充、成品号和成员权限分别要核对什么',`<div class="guide-table"><table><thead><tr><th>商品描述</th><th>要确认的购买对象</th><th>付款前问清楚</th></tr></thead><tbody><tr><td>Pro 代充</td><td>是否给你现有的账号开通权益</td><td>账号是否适用，是否支持已有订阅续费，权益何时开始。</td></tr><tr><td>Pro 成品号</td><td>是否交付另一个账号</td><td>剩余有效期、邮箱和恢复方式由谁控制，是否已经使用。</td></tr><tr><td>共享或合租</td><td>多人共用账号还是第三方服务入口</td><td>具体访问方式、数据可见范围、使用限制和适用条款。</td></tr><tr><td>团队或成员席位</td><td>具体计划下的成员权限</td><td>计划名称、管理员权限、席位到期或被移除后的影响。</td></tr></tbody></table></div><p>这里是帮助阅读商家描述的核对表，不表示任何一种第三方交付获得品牌授权。尤其不要把不同计划的成员权限并入 Pro 个人订阅最低价。</p>`),
   section('compare','同样写月卡，也要继续核对期限和币种',`<p>先在产品页选择交付方式，再选择明确期限、地区和币种。一个月、30 天、剩余期限和期限未注明的商品，不能直接合并；质保天数也不能用来补全订阅天数。条件一致后，再选择价格从低到高。</p><p>本站展示的是收录范围内的公开报价。遇到暂缺可比报价，或只剩交付待确认的条目，应回原商品页核对，不用其他计划或 API 余额凑一个“Claude 最低价”。${link('/help/compare-prices','查看完整比价步骤')}。</p>`),
   section('faq','三个常见购买问题',`<h3>买了 Pro，是否就不用支付 API 费用？</h3><p>不能这样理解。官方说明 Pro 不包含 Claude Console API 使用，API 需要另外设置和计费。第三方商品捆绑的其他服务，也需要单独确认提供方与条件。</p><h3>成品号比代充便宜，能直接选便宜的吗？</h3><p>先确认是否接受换账号，以及账号控制、剩余期限和售后条件。两者交付对象不同，差价不能直接当作同一商品的折扣。</p><h3>已经有订阅，怎样避免续费买重？</h3><p>先核实当前账号、到期日和自动续费状态，再向实际购买渠道确认商品能否接续现有权益。可以在 ${link('/following','我的关注')} 记录你核实过的到期日，网站不会自动读取 Claude 账单或替你取消续费。</p>`),
  ],sources:[source('https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Claude 官方：Pro 计划与 API 计费说明（核对于 2026-09-09）'),source('/?family=claude&product=claude-pro','本站 Claude Pro 当前报价'),...commonSources],
  actions:[source('/?family=claude&product=claude-pro','比较 Claude Pro 当前报价'),source('/help/price-alerts','保存规格并设置提醒')],related:['/guides/why-prices-differ','/guides/renewal-checklist'],
 },
 {
  path:'/guides/gemini-membership-options',section:guides,title:'Gemini / Google AI Pro 成品号、代开和家庭权益怎么比较？',
  published:'2026-09-09',updated:'2026-09-09',
  description:'区分 Google AI Pro 订阅、账号交付、家庭共享与权限激活服务，检查账号资格、有效期和可用权益后再比较价格。',
  takeaway:'先问清楚买到的是哪项计划、哪个账号上的什么权益。标题里的“Gemini 年卡”“家庭组”或“激活”，不能代替完整的交付说明。',
  sections:[
   section('membership','先找到实际计划名称和适用账号',`<p>商家可能用“Gemini”“Google AI Pro”或其他简称描述商品。先核对实际计划名称、使用账号、权益期限和可用服务，再去 ${link('/?family=gemini&product=gemini-pro','Gemini / Google AI Pro 报价页')} 查对应分类，不能只按 Gemini 这个品牌词比较。</p><p>Google 官方的 AI Pro 说明要求使用个人 Google 账号申请，具体地区、功能、账号资格和优惠条件需要继续查看官方页面。学生、新用户、地区限定等标签都可能附带条件；不满足条件的报价不应作为自己的可购价格。</p>`),
   section('delivery','四种描述，四组核对重点',`<div class="guide-table"><table><thead><tr><th>商品描述</th><th>先确认什么</th></tr></thead><tbody><tr><td>成品号</td><td>交付哪个账号，账号恢复方式由谁控制，权益还剩多久。</td></tr><tr><td>代充或代开</td><td>能否用于自己的现有账号，是否要求新用户，如何确认开通成功。</td></tr><tr><td>家庭组或共享权益</td><td>是否加入家庭组，实际共享哪些功能，谁管理订阅，移出后有什么影响。</td></tr><tr><td>权限激活、资格检查或领取链接</td><td>是完整订阅还是辅助服务，后续是否还要付款、满足其他资格或自行开通。</td></tr></tbody></table></div><p>本站把 ${link('/?family=gemini&product=gemini-activation-service','Gemini 权限激活服务')} 单独列为一种购买对象。辅助开通的服务费不能拿来充当完整订阅的最低价。名称、交付与说明冲突时，先向原店确认。</p>`),
   section('family','家庭权益不等于每个人都有完全相同的套餐',`<p>Google 官方说明，AI Pro 家庭组成员可以共享部分 AI 权益；但共享范围因产品而异，并非计划管理者拥有的所有权益都会共享。购买前应列出自己需要的功能，逐项核对家庭成员是否适用。</p><p>家庭组成员使用自己的账号，与多人共用同一账号是两种情况。不要仅凭“独享”“家庭”“共享”等商品标题作判断。实际加入条件、家庭组管理和权益范围，以官方规则与原商品的明确说明共同核对。</p>`),
   section('faq','付款前再检查这三个问题',`<h3>标着年卡，就一定从今天起可用一年吗？</h3><p>需要确认开始计时方式、结束日期和是否为剩余期限账号。售后保障的时长也要单独核对，不能拿质保期替代订阅期。</p><h3>激活服务很便宜，可以当作会员价格吗？</h3><p>不能只凭名称或价格确定。先确认最终交付的是订阅权益、资格协助还是领取入口，以及是否还需其他付款或条件。本站将不同购买对象分开展示。</p><h3>官方更新了套餐权益，旧文章还能直接照着买吗？</h3><p>本文帮助你核对购买条件，不固定承诺某个存储容量、额度或共享功能。购买当日请查看官方当前说明，回原店核实实际商品；选定可比规格后，可在报价页保存关注。</p>`),
  ],sources:[source('https://support.google.com/googleone/answer/16476811?hl=zh-Hans','Google 官方：申请 Google AI Pro（核对于 2026-09-09）'),source('https://support.google.com/googleone/answer/9004015?hl=zh-Hans','Google 官方：开始或停止与家人共享'),source('/?family=gemini&product=gemini-pro','本站 Gemini / Google AI Pro 报价'),...commonSources],
  actions:[source('/?family=gemini&product=gemini-pro','比较 Google AI Pro 当前报价'),source('/help/compare-prices','了解规格与币种筛选')],related:['/guides/why-prices-differ','/guides/renewal-checklist'],
 },
 {
  path:'/guides/chatgpt-plus-trial-day-pass',section:guides,title:'ChatGPT Plus 试用、日抛和月付订阅有什么区别？',
  published:'2026-09-09',updated:'2026-09-09',
  description:'想找 Plus 试用或 ChatGPT Plus 日抛？先分清官方活动与商家商品名称，再核对账号归属、剩余期限、质保和自动续费。',
  takeaway:'Plus 试用要看官方活动与账号资格；“日抛”不能直接理解为官方按天套餐。判断是否适合自己，关键是最终使用哪个账号、权益到何时、到期后是否扣款。',
  sections:[
   section('differences','先分清试用、日抛和月付分别指什么',`<div class="guide-table"><table><thead><tr><th>看到的名称</th><th>怎样理解</th><th>首先核对</th></tr></thead><tbody><tr><td>官方试用或促销邀请</td><td>有活动期限与资格条件的推广安排</td><td>官方活动原文、本人账号是否符合条件、优惠结束后的费用。</td></tr><tr><td>商家所称“日抛”或“短期”</td><td>商品描述；单凭名称无法确认交付内容</td><td>哪个账号、何时开始和结束、是否共享、失效后的处理。</td></tr><tr><td>官方 Plus 月付</td><td>官方帮助所说明的按月计费订阅</td><td>订阅账号、账单周期、续费设置与实际结算金额。</td></tr><tr><td>商家所称“月卡”</td><td>仍需确认交付方式和实际期限</td><td>是自己的账号开通，还是另一个账号；是新开整月还是剩余期限。</td></tr></tbody></table></div><p>“试用”有时被用于描述官方活动，有时只是商品标题用语，两者不能相互证明。官方 ${link('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','ChatGPT Plus 说明')} 描述的是月付计划；本文核对的官方资料没有确认一个人人可购买的 Plus“日抛”套餐。</p>`),
   section('official-trial','Plus 有没有免费试用？先看自己的活动资格',`<p>OpenAI 的 ${link('https://help.openai.com/en/articles/8381046-chatgpt-promotional-subscriptionsfree-trial-invites-faq','促销订阅与试用邀请说明')} 表明，试用邀请可能只向部分符合条件的用户提供。适用计划、地区、期限和领取条件取决于具体活动，不能由他人的成功截图推定自己也能领取。</p><p>部分活动需要有效付款方式，并会在优惠结束后自动转为付费订阅。领取前查看活动条款和结算页，记下试用结束日、届时价格和取消入口。收到链接不等于资格验证通过，卖家称“免费试用”也不能证明它来自官方。</p><p>如果当前账号没有适用活动，就把它视为暂时没有已核实的试用方案。不要为了碰运气先取消已有权益；先确认活动是否接受当前或曾经订阅过的账号。</p>`),
   section('duration','怎样核对日抛和短期账号的真实可用时间',`<p>把“可以用多久”拆成三个时间：<strong>交付时间、权益结束时间、售后结束时间</strong>。例如，晚上收到账号、次日零点到期，并不等于交付后可用 24 小时；“质保 30 天”也不自动代表每个交付账号都有完整 30 天订阅。</p><ol><li>要求明确开始计时条件：付款、发货、首次登录，还是权益此前已经开始。</li><li>核对具体结束时间与时区，确认是剩余期限还是从开通起计算。</li><li>确认实际计划和可用功能；能登录或能打开某个页面，不足以证明拥有 Plus 权益。</li><li>单独核对售后：提前失效时退款、补时还是换号，原有记录能否继续保留。</li></ol><p>短期使用需求不代表可以忽略账号归属。换一个账号是否影响已有对话和使用习惯，应在付款前考虑。多人共用凭据、独立账号和工作区席位的区别，可以继续看 ${link('/guides/chatgpt-plus-delivery','Plus 交付方式指南')}。</p>`),
   section('compare','在 AI订阅雷达上怎样比较这些报价',`<p>在 ${link(plus+'&amp;delivery=account','ChatGPT Plus 成品号报价页')}，本次核对可见“1 个月”“30 天”和“期限未注明”等不同期限标签。先按交付方式和明确期限缩小范围，再回原商品页确认。本站分类来自商品信息，不能用于证明某条报价是官方试用活动。</p><p>要用自己的账号，先核对商品是否明确支持自己的现有账号；要比较短期商品，则同时写下实付总价、确认可用的时长和账号控制条件。没有确认期限时，不计算日均成本，也不把它与完整月付作价格高低结论。</p><p>即使一个短期商品折算更便宜，也要考虑更换账号的时间成本、资料能否保留，以及是否满足服务方规则。本站收录和店铺标记不构成对活动资格、账号归属或长期可用性的保证。</p>`),
   section('renewal','只想试一试，怎样避免后续费用不清楚',`<p>如果通过官方活动体验 Plus，完成领取后再到实际订阅渠道核对计划、优惠结束时间和自动续费状态。不要只保存邀请截图，也不要把试用开始日当成最后取消日期。</p><p>如果看到第三方短期商品，先问清交付是否附带其他付款义务，以及到期后是自动结束、需要主动续费，还是更换账号。本站无法代你检查服务方账单或取消订阅；在 ${link('/following','我的关注')} 填写已核实的日期，只是辅助提醒。${link('/guides/renewal-checklist','查看购买与续费前核对清单')}。</p>`),
  ],sources:[source('https://help.openai.com/en/articles/8381046-chatgpt-promotional-subscriptionsfree-trial-invites-faq','OpenAI 官方：促销订阅与试用邀请（核对于 2026-09-09）'),source('https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus','OpenAI 官方：ChatGPT Plus 与月付说明（核对于 2026-09-09）'),source('/?family=chatgpt&product=chatgpt-plus&delivery=account','本站 Plus 成品号规格示例'),source('/sources','本站数据说明')],
  actions:[source('https://help.openai.com/en/articles/8381046-chatgpt-promotional-subscriptionsfree-trial-invites-faq','查看官方试用规则'),source('/?family=chatgpt&product=chatgpt-plus','查看 Plus 报价与交付条件')],related:['/guides/chatgpt-plus-delivery','/guides/renewal-checklist','/help/price-alerts'],
 },
 {
  path:'/guides/cursor-discount-links',section:guides,title:'Cursor 半价链接怎么核实？优惠资格、账号归属与续费价格',
  published:'2026-09-09',updated:'2026-09-09',
  description:'搜索 Cursor 半价链接、学生优惠或成品号时，怎样核对官方来源、优惠资格、订阅档位、续费和用量费用，避免把不同商品当成同一种折扣。',
  takeaway:'先确认有没有当前有效、适用于本人账号的官方优惠。Cursor 官方明确不授权第三方转售订阅；低价成品号和店铺收录标记都不能证明它是官方折扣。',
  sections:[
   section('official','找 Cursor 半价链接，先核对官方来源',`<p>本文不提供未经验证的“通用半价链接”。搜索结果、群聊截图或商品标题，只能说明有人这样宣传，不能证明优惠仍有效，也不能证明适用于你的账号。</p><p>${link('https://cursor.com/pricing','Cursor 官方定价页')} 在第三方购买说明中明确表示：订阅应直接通过 cursor.com 购买，Cursor 不授权转售商或第三方卖家，非授权来源账号可能被暂停或终止。这是购买判断的前提，不能只比较卖家是否便宜、是否承诺质保。</p><p>核对优惠时，自己打开官方定价页或从官方账号进入账单页面，检查活动原文和本人结算结果。链接中带有品牌字样、页面使用品牌标志，或卖家称“官方渠道”，都不能替代这个核对过程。</p>`),
   section('offer','“半价”“学生优惠”和“成品号”要分别判断',`<div class="guide-table"><table><thead><tr><th>看到的说法</th><th>需要核实的证据</th><th>不能直接认定</th></tr></thead><tbody><tr><td>半价链接、优惠码</td><td>当前官方活动、适用账号、有效期和结算减免</td><td>别人能领取，自己也能领取；首期优惠会一直保留。</td></tr><tr><td>学生优惠</td><td>官方当前活动和具体资格要求</td><td>有教育邮箱就必然免费，或旧教程中的期限仍有效。</td></tr><tr><td>年付折算月均价格</td><td>全年实付、续费周期与对应计划</td><td>每个月只扣展示的月均金额。</td></tr><tr><td>Cursor 成品号或第三方代开</td><td>实际交付对象与订阅来源</td><td>价格低就是本人账号的官方折扣，或者获得了转售授权。</td></tr></tbody></table></div><p>截至本文核对，${link('https://cursor.com/students','Cursor 官方学生页面')} 引导学生关注校园及线上活动中的升级优惠，没有承诺所有学生统一获得一年免费 Pro。具体能领什么、何时结束，应以你参加的活动规则为准，不能照抄旧文章的结论。</p>`),
   section('account','优惠是否落在自己的账号上，为什么重要',`<p>即使商品写着相同计划，给自己账号订阅与收到另一个成品号，也是不同的交付。先确认登录邮箱、账号恢复方式和账单管理入口由谁控制，是否需要加入他人管理的工作区，以及订阅终止后还能保留什么。</p><p>但账号控制条件清楚，也不代表第三方转售符合官方规则。卖家的换号或补偿承诺无法阻止服务方按规则暂停账号；这种承诺不能换算成与官方直订相同的连续使用保障。需要长期用于学习或工作时，应把可持续使用和账单可管理性放在标价前面。</p><p>如果只是想先体验编辑器，可以先查看官方定价页当前列出的免费 Hobby 方案及其限制，再决定是否升级。免费方案可用，不等于它具备付费方案的所有功能和额度。</p>`),
   section('billing','续费价格之外，还要看哪些费用',`<p>${link('https://cursor.com/help/account-and-billing/billing','Cursor 官方账单说明')} 将订阅周期与额外用量费用分开：月付或年付会按相应周期续订，按需用量可能在订阅续费日前单独计费。因此“本月还没到续费日”不能用来判断是否还会产生其他扣款。</p><ol><li><strong>本次实际支付：</strong>看结算总额、币种、税费与付款周期，不只看折算月均价。</li><li><strong>优惠覆盖范围：</strong>确认减免适用于哪个计划、首期还是多个周期，是否包含额外用量。</li><li><strong>优惠后续费：</strong>核对下一次扣费日期及价格，不用宣传截图替代自己的账单。</li><li><strong>用量设置：</strong>查看已用额度、按需用量与相关设置，区分订阅费和使用费。</li></ol><p>官方帮助将账单管理入口指向 ${link('https://cursor.com/dashboard/billing','Cursor 账单页面')}。自己的支付与订阅状态以该账号实际展示为准，不能用本站报价推断。</p>`),
   section('radar','怎样使用本站的 Cursor 报价信息',`<p>Cursor Pro、Pro+ 与 Ultra 是不同档位，先去官方定价页确认所需计划。在本站查看 ${link('/?family=cursor','Cursor 目录')} 或 ${link('/?family=cursor&amp;product=cursor-pro','Cursor Pro 报价')} 时，再核对期限、交付方式和币种。没有收录对应商品时，不用其他档位或不同付款周期的价格凑出一个“半价”。</p><p>第三方报价可作为了解公开市场描述的线索，本站收录不代表 Cursor 授权销售，也不保证优惠资格和账号持续可用。购买入口应优先核对官方页面。发现商品名称、期限或链接不一致，可通过 ${link('/submit?type=feedback','数据反馈')} 提交原链接；不要提交账号密码或验证码。</p><p>需要整理下一次续费安排时，可参考 ${link('/guides/renewal-checklist','购买与续费前核对清单')}。只有先查明账号、计划、费用和来源，价格比较才有意义。</p>`),
  ],sources:[source('https://cursor.com/pricing','Cursor 官方：计划、免费方案与第三方购买说明（核对于 2026-09-09）'),source('https://cursor.com/students','Cursor 官方：当前学生活动说明（核对于 2026-09-09）'),source('https://cursor.com/help/account-and-billing/billing','Cursor 官方：订阅周期和用量账单（核对于 2026-09-09）'),source('/sources','本站报价范围与来源')],
  actions:[source('https://cursor.com/pricing','先核对 Cursor 官方方案'),source('/?family=cursor&product=cursor-pro','查看本站 Cursor Pro 报价说明')],related:['/guides/renewal-checklist','/help/compare-prices','/guides/why-prices-differ'],
 },

 {
  path:'/guides/official-subscription-channels',section:guides,title:'ChatGPT、Claude 官网与 App Store、Google Play 价格为什么不同？',
  published:'2026-09-09',updated:'2026-09-09',
  description:'比较 AI 官方订阅时，先区分官网、App Store 与 Google Play 的账单渠道，再核对套餐、付款周期、币种和续费管理，避免重复订阅。',
  takeaway:'同名套餐在不同渠道的显示金额可能不同。先确认是同一个计划、同一个付款周期，再比较自己的结账总额；换渠道前先查清原订阅状态。',
  sections:[
   section('answer','为什么官网和手机内购显示的价格不一样？',`<p>价格页面展示的通常是某个地区、某种币种和付款周期下的报价。渠道不同，显示口径与账单管理方式也可能不同。不要看到两个金额就把差额全部归因于平台抽成，或认定其中一个报价失效；单凭标价无法确定具体原因。</p><p>OpenAI 的 ${link('https://help.openai.com/en/articles/10421635-multicurrency-billing','多币种计费说明')} 区分了网页订阅与移动端订阅：在 iOS 或 Android 应用内购买时，订阅由 Apple 或 Google Play 管理，按相应本地币种显示。Claude 的 ${link('https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Pro 官方说明')} 也提示地区价格可能不同，税费可能已包含，也可能在结账时加入。因此，税前金额与含税总额需要分开看。</p>`),
   section('channels','三个购买渠道，应分别保存哪些信息',`<div class="guide-table"><table><thead><tr><th>购买入口</th><th>先核对</th><th>账单核对位置</th></tr></thead><tbody><tr><td>服务官网</td><td>登录账号、计划、付款周期、币种与结账总额</td><td>该服务的订阅管理与购买回执</td></tr><tr><td>iPhone / iPad 应用内</td><td>应用内实际商品、Apple 账号地区、订阅周期</td><td>Apple 订阅列表与付款回执</td></tr><tr><td>Android 应用内</td><td>应用内实际商品、Google Play 付款资料与周期</td><td>Google Play 订阅列表与付款回执</td></tr></tbody></table></div><p>这张表是核对顺序，不代表每个 AI 产品都在三个渠道提供完全相同的计划。先打开该产品实际支持的购买入口；没有看到某个计划时，不用另一个档位或第三方商品代替它。</p><p>把“每月折算”和“按月扣款”分开记录。年付页上醒目的月均金额，可能需要一次支付全年费用。比较时既保留月均成本，也写下本次要支付的总额，以及优惠结束后的续费金额。</p>`),
   section('same-plan','比较 ChatGPT Plus、Go 或 Claude Pro 的正确顺序',`<ol><li><strong>先确认计划：</strong>ChatGPT Go 与 Plus 分开比较，Claude Pro 与其他档位分开比较，不因品牌相同就合并。</li><li><strong>再确认周期：</strong>以结账页的月付、年付或具体有效期为准。只写套餐名、没有周期的价格，暂不用于月费高低结论。</li><li><strong>记录原币与总额：</strong>保留原币标价，确认税费是否已计入，再核对支付方式的实际换汇与费用。</li><li><strong>确认本人能否购买：</strong>看到某个地区有报价，不等于当前账号和付款方式符合该地区条件。</li></ol><p>可以从 ${link('/official-prices','官方订阅地区价总览')} 进入 ${link('/product?source=cardnav-official&amp;id=chatgpt-plus','ChatGPT Plus')}、${link('/product?source=cardnav-official&amp;id=chatgpt-go','ChatGPT Go')} 或 ${link('/product?source=cardnav-official&amp;id=claude-pro','Claude Pro')} 的参考表。本站当前这组记录来自 CardNav 对 App Store 的公开汇总，未逐条核验官方结账页，也不包含可据此推定的官网和 Google Play 价格。</p>`),
   section('switch','换一个渠道购买前，先避免两边都在续费',`<p>OpenAI 的 ${link('https://help.openai.com/en/articles/20001043-how-do-i-avoid-being-charged-twice-if-i-subscribe-to-chatgpt-on-ios-android-and-the-web','避免重复扣费说明')} 要求在原购买渠道管理和取消订阅；卸载应用不等于取消。如果先后通过不同渠道订阅，同一个使用需求可能对应多个独立账单。</p><p>准备换渠道时，先打开原订阅的管理页面，查看是否仍有效、是否已经取消续费、何时结束。尤其不要把一次付款失败直接当成订阅已经结束：官方说明提到，Apple 可能继续尝试恢复付款。原状态没有确认之前，先不要在另一个渠道重复开通。</p><p>价格比较完成后，保留购买回执，记录订阅平台、登录账号、当前计划与下次账单日期。需要退款或处理扣款时，先确认是哪一个渠道开出的账单，再按对应官方流程处理。</p>`),
   section('next','怎样用报价表辅助决定，而不被一个低数字带偏',`<p>地区表适合帮你发现需要进一步核验的候选价格。它无法代替自己的结账页，也无法判断账号资格。看到“周期未提供”或“汇率日期未提供”，就把这一项留待核验，不把未知条件补成最有利的条件。</p><p>下一步可阅读 ${link('/guides/regional-price-total-cost','地区标价与实际支付金额怎么比较')}，把税费、换汇和续费放进同一张核对表。购买完成后，按自己账单的真实日期设置 ${link('/help/price-alerts','到期提醒')}；提醒日期由你确认，网站不会自动读取 Apple、Google 或服务官网的账单。</p>`),
  ],sources:[source('https://help.openai.com/en/articles/10421635-multicurrency-billing','OpenAI 官方：多币种与移动端计费'),source('https://help.openai.com/en/articles/20001043-how-do-i-avoid-being-charged-twice-if-i-subscribe-to-chatgpt-on-ios-android-and-the-web','OpenAI 官方：跨渠道订阅与重复扣费'),source('https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Claude 官方：Pro 地区价格与税费'),source('/official-prices','本站官方地区参考及数据口径')],
  actions:[source('/official-prices','查看官方地区价格参考'),source('/guides/regional-price-total-cost','核算实际支付条件')],related:['/guides/chatgpt-go-vs-plus','/guides/claude-pro-buying','/guides/renewal-checklist'],
 },
 {
  path:'/guides/regional-price-total-cost',section:guides,title:'AI 订阅哪个地区便宜？先比较标价、税费与实际支付条件',
  published:'2026-09-09',updated:'2026-09-09',
  description:'看到 ChatGPT 或 Claude 低价地区时，怎样核对原币、周期、税费、换汇、续费和账号地区资格，避免将人民币参考价当成最终实付。',
  takeaway:'地区最低标价只能帮助筛选候选项。能否购买、是否同周期，以及结账税费和支付换汇都会影响选择；资料缺失时，暂时无法判断哪个地区对你最便宜。',
  sections:[
   section('answer','哪个地区最便宜，为什么不能只看人民币排序？',`<p>地区价格比较有两个不同问题：已经收录的参考记录中，哪个金额更低；符合你实际购买条件的方案中，哪个总成本更低。报价排序能回答前一个问题的一部分，不能直接替你回答后一个问题。</p><p>例如，同为一个套餐名称，一项没有注明周期，另一项明确是年付，就不能把两个总金额当作月费来比较。即使周期一致，也要检查是否为相同计划、是否有首期优惠，以及自己是否具备该地区的购买条件。任一关键条件未知，就先保留为候选，等待原渠道核验。</p>`),
   section('cost','实际支付金额应怎样拆开核对',`<div class="guide-table"><table><thead><tr><th>需要记录的项目</th><th>从哪里核对</th><th>容易出现的误读</th></tr></thead><tbody><tr><td>原币标价与订阅周期</td><td>对应渠道的当前套餐与结账页</td><td>把年付月均价当作每月只扣这笔钱。</td></tr><tr><td>税费是否已包含</td><td>结账明细与收据</td><td>在含税金额上又加一次税。</td></tr><tr><td>实际结账币种和总额</td><td>付款确认页</td><td>把页面的人民币参考换算当作结算承诺。</td></tr><tr><td>支付换汇与手续费</td><td>所用支付服务的费用说明及入账明细</td><td>默认所有支付方式都使用同一汇率。</td></tr><tr><td>优惠后续费</td><td>订阅条款与下一次账单信息</td><td>用首期优惠推算长期总成本。</td></tr></tbody></table></div><p>从原币结账总额出发，在实际发生换汇时采用付款渠道的换汇口径，再考虑尚未计入的费用。已经包括的税费或手续费不要重复相加；原币直接扣款时，也不要无依据再叠加一次假设换汇。</p><p>${link('https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Claude Pro 官方说明')} 明确提醒，地区价格和税费展示方式可能不同。这就是为什么“标价 × 搜到的汇率”最多只能做预算参考，不能直接当作已确认的账单金额。</p>`),
   section('eligibility','低价地区有记录，是否就能切过去购买？',`<p>不能据此推定。${link('https://support.apple.com/en-au/118283','Apple 官方地区更改说明')} 列出了账号余额、部分订阅、家庭共享和付款方式等限制。${link('https://support.google.com/googleplay/answer/7431675?hl=en-uk','Google Play 官方地区说明')} 也涉及所在地、对应付款方式和家庭组等条件。地区设置会影响其他内容和购买安排，不只是改变某一个订阅的显示价格。</p><p>因此，地区表中的国家名称是该条参考数据的范围，不是购买资格证明。准备长期使用时，先核对自己现有账号的真实条件，检查更改地区是否影响余额、其他订阅或已有内容，不为了一个未经核实的参考差价匆忙更改设置。</p><p>同样，换币种和换地区也不是同一个操作。OpenAI 的 ${link('https://help.openai.com/en/articles/10421635-multicurrency-billing','多币种说明')} 提到，现有订阅通常继续按原有币种计费；看到支持另一币种，并不代表当前账单会自动切换。</p>`),
   section('reference','在 AI订阅雷达上，怎样读时间和资料缺口',`<p>${link('/official-prices','官方地区价总览')} 将 App Store 地区参考单列。打开某个套餐后，可以筛选国家或地区、原币币种、周期和购买渠道，每行保留原币标价与汇总来源链接。未提供的周期不会自动补成月付，未提供的汇率日期也不会用本站采集日期代替。</p><p><strong>上游刷新</strong>是汇总来源显示的时间，<strong>本站采集</strong>是本次取得记录的时间。它们都不表示官方恰好在那个时刻调整了价格。来源时间未知或超过本站 72 小时复核提示门槛时，会标为“待复核”；这只是本站提示口径，不是官方报价有效期。</p><p>当前人民币参考额沿用上游换算，本站没有据此承诺最新汇率或最低实付价。若原币相同但人民币数值有差异，也不能仅凭这一点断言官方涨价或降价；需要回到原币、周期和实际结账明细检查。</p>`),
   section('decision','准备付款时，最后保留一份能回查的记录',`<ol><li>写下计划名称、购买渠道和实际付款周期，确认比较对象一致。</li><li>保留结账币种、总额和税费明细，记录核对日期。</li><li>确认账号地区、付款方式以及活动资格适用，核对续费金额。</li><li>确认原订阅是否仍在扣费，避免重复开通。</li><li>完成购买后，以本人收据和订阅管理页面为准，记录下一次扣费日期。</li></ol><p>如果还有关键资料缺失，可以先把候选方案和待核对事项记下来，而不是宣布某个地区“全球最低”。需要进一步区分渠道，请阅读 ${link('/guides/official-subscription-channels','官网、App Store 与 Google Play 的价格区别')}；准备续费时，再用 ${link('/guides/renewal-checklist','购买与续费清单')} 检查条件有没有变化。</p>`),
  ],sources:[source('https://support.claude.com/en/articles/8325606-what-is-the-pro-plan','Claude 官方：地区价格与税费'),source('https://support.apple.com/en-au/118283','Apple 官方：更改账号国家或地区'),source('https://support.google.com/googleplay/answer/7431675?hl=en-uk','Google Play 官方：国家或地区与付款条件'),source('https://help.openai.com/en/articles/10421635-multicurrency-billing','OpenAI 官方：订阅币种'),source('/official-prices','本站地区参考、排序与时间说明')],
  actions:[source('/official-prices','查看地区价格及来源'),source('/guides/official-subscription-channels','比较不同官方购买渠道')],related:['/guides/renewal-checklist','/guides/why-prices-differ','/help/data-and-ranking'],
 },
].map(article=>({...article,published:article.published||'2026-09-08',updated:article.updated||'2026-09-08',author:'AI订阅雷达'}));

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
 const cursorGuide=['/guides/cursor-discount-links','Cursor 优惠与账号来源怎么核实'];
 const buyingGuide=proKeys.has(productKey)?[proGuide,'Pro 5x、20x 与当前开通条件']:grokKeys.has(productKey)?[grokGuide,'Grok 试用、短期账号与月付怎么区分']:{'chatgpt-go':['/guides/chatgpt-go-vs-plus','ChatGPT Go 与 Plus 怎么选'],'chatgpt-plus':['/guides/chatgpt-plus-delivery','ChatGPT Plus 交付方式怎么选'],'claude-pro':['/guides/claude-pro-buying','Claude Pro 购买条件怎么核对'],'gemini-pro':['/guides/gemini-membership-options','Google AI Pro 交付与家庭权益'],'gemini-activation-service':['/guides/gemini-membership-options','激活服务与完整订阅的区别'],'cursor-pro':cursorGuide,'cursor-pro-plus':cursorGuide,'cursor-ultra':cursorGuide,'cursor-account':cursorGuide}[productKey]||['/guides/why-prices-differ','为什么价格不同'];
 const trialGuide=productKey==='chatgpt-plus'?link('/guides/chatgpt-plus-trial-day-pass','Plus 试用、日抛和月付有什么区别'):'';
 return `<aside class="product-guide-links" aria-label="选购与使用指南"><span>选购与使用指南</span><a href="/help/compare-prices">如何比较这些报价</a>${link(...buyingGuide)}${trialGuide}<a href="/official-prices">官方订阅地区价格参考</a><a href="/guides/renewal-checklist">购买与续费前核对</a></aside>`;
}

// Editorial notes use established product identities, never raw request text.
export function productBuyingNote(productKey=''){
 if(proKeys.has(productKey))return `<aside class="guide-takeaway" aria-label="Pro 套餐与开通条件"><strong>${productKey==='chatgpt-pro-5x'?'Pro 5x：先核对档位，再比较同条件价格':'Pro 20x：购买前先核对新开与续费资格'}</strong><p>5x 与 20x 表示不同用量档位。核对于 2026-09-11：OpenAI 自 9 月 10 日起暂停 Pro 20x 新订阅和升级，现有订阅续费及 Pro 5x 不受影响。商家在售不等于你的账号可开通；请先核对官方最新状态，再分别比较期限、地区和充值渠道。</p>${link(proGuide,'查看 Pro 5x / 20x 选购说明')} · ${link(proOfficial,'核对官方当前规则')}</aside>`;
 if(grokKeys.has(productKey))return `<aside class="guide-takeaway" aria-label="Grok 试用与订阅条件"><strong>寻找 Grok 7 天试用？先看账号与期限</strong><p>7 天成品账号、官方页面显示的试用和月付代充，可能是不同的购买对象。先在规格中确认交付方式与有效期；商家写“7 天”不能证明人人都有官方免费试用。</p>${link(grokGuide,'查看 Grok 试用、短期账号与续费说明')}</aside>`;
 return '';
}
