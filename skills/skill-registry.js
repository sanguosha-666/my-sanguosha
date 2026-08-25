// skills/skill-registry.js —— CORE-78(issue #123)第一期:技能注册表骨架。
//
// 【本期范围,严格限定】只做"登记",不改任何行为:本文件不被任何既有代码读取,
// 没有一处 normalize()/BOT_DECISIONS/canTarget 改成查这张表——那是第二、三期的
// 工作。本期唯一的产出是"把散落在 game.js/skills.js/weapons.js/sha-resolution.js
// 里的技能触发时机/条件/接入点,集中登记成一份可被机器校验的清单"。
//
// 【为什么是单文件而不是每技能一个文件】issue 正文写的是"每武将/技能一个独立
// 定义文件"。本项目是无构建流程、全靠 index.html 里 <script src> 顺序加载的架构,
// 107+ 个独立文件意味着同样数量的 <script> 标签,加载顺序维护成本和首屏请求数都
// 不可接受。改为单文件 + 中文字段名(仍满足"中文命名"这一条),已与用户确认。
//
// 【这份表的可信度来自哪里】不是人工审阅"看着对",而是由 testclass/
// run_skill_registry_test.js 用 9 条规则回到真实代码逐条核对(正向 7 条:武将/技能名/
// caps/hooks/阶段/机器人接入点/效果函数都必须在 GENERALS、STAGE_TABLE、
// BOT_DECISIONS、BOT_SEAT_PICKS 和沙箱全局里真实存在且完全一致;反向 2 条:
// GENERALS 里每一条 caps/hooks 声明都必须被本表覆盖、STAGE_TABLE/BOT_DECISIONS/
// BOT_SEAT_PICKS 每一项要么被本表引用要么在显式白名单里)。任何摘录错误——抄错
// cap 名、漏登记某个技能、写了一个不存在的函数名——都会让那条测试变红。
//
// 【字段说明】
//   武将      : GENERALS 的 key(英文 id)
//   技能名    : 中文技能名,取自 GENERALS[id].skill 的斜杠拆分
//   实现方式  : 'cap-被动查询'(只被 hasCap 内联查询,无独立阶段)
//               'cap-主动阶段'(有专属 pending 阶段)
//               'hook'(挂 GENERALS[id].hooks,无 cap)
//               'cap+hook'(两者都有)
//               '状态字段'(既无 cap 也无 hook,靠 player 上的状态字段)
//   能力标识  : 对应 GENERALS[id].caps 的键,必须与之完全一致(不多不少)
//   钩子      : 对应 GENERALS[id].hooks 的键,必须与之完全一致
//   触发阶段  : STAGE_TABLE 里属于本技能的 phase
//   机器人接入: BOT_DECISIONS / BOT_SEAT_PICKS 里属于本技能的注册项
//   效果函数  : 本技能专属的服务端函数(可选——大量被动技能是内联 hasCap 判断,
//               没有独立函数,这类留空数组是正确的,不是漏登记)
//   查询点    : 该技能的 cap 被 hasCap 类函数查询到的源文件(用于快速定位实现位置)
//   主公技    : 是否仅 role==='zhu' 可发动(经 canTriggerLordAsk 一类守卫)
//
// 【CORE-117(issue #125)已修复的历史数据缺口】simayi(司马懿)的 GENERALS.skill
// 原本只写了'反馈'、漏了'鬼才'——本表当初按"不改data.js、按真实实现登记"的原则,
// 把 simayi/鬼才 补登记为独立一条并在测试里用显式豁免记录这个偏差。CORE-117 已把
// data.js 本身改成 skill:'反馈/鬼才',这条豁免和这里的说明一并撤下,simayi/鬼才
// 现在和其它107条一样,是从 GENERALS.skill 斜杠拆分自然得到的正常条目,不是特例。
//
// 【仍然存在的一处 GENERALS 数据特征,不是缺口】
//   yuji(于吉)的'缠怨'既没有 cap 也没有 hook,靠 player.chanyuan 状态字段实现,
//   登记为 '状态字段' 类——这是技能本身的真实实现方式,不是数据遗漏。
const 技能注册表 = Object.create(null);
function 登记技能(条目){ 技能注册表[条目.武将+'/'+条目.技能名] = 条目; }

// ===== 批次 1/3:22 名武将,37 条技能 =====
登记技能({ 武将:'zhangfei', 技能名:'咆哮', 实现方式:'cap-被动查询',
  能力标识:['unlimitedSha'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['bot.js','game.js','render-controls.js','sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'guojia', 技能名:'天妒', 实现方式:'cap-被动查询',
  能力标识:['tiandu'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'guojia', 技能名:'遗计', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:['yijiAsk','yijiAssign'],
  机器人接入:{ 决策:['yijiAssign'], 座位选择:[] },
  效果函数:['respondYijiAsk','respondYijiAssign'],
  查询点:[], 主公技:false });
登记技能({ 武将:'sunshangxiang', 技能名:'枭姬', 实现方式:'hook',
  能力标识:[], 钩子:['onLoseEquip'],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'diaochan', 技能名:'离间', 实现方式:'cap-被动查询',
  能力标识:['lijian'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:['lijianTwoStep'], 座位选择:[] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'diaochan', 技能名:'闭月', 实现方式:'cap-主动阶段',
  能力标识:['biyue'], 钩子:[],
  触发阶段:['biyue'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondBiyue'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'kongrong', 技能名:'礼让', 实现方式:'cap-主动阶段',
  能力标识:['lirang'], 钩子:[],
  触发阶段:['lirangAsk','lirangRecover'],
  机器人接入:{ 决策:['lirangAsk'], 座位选择:[] },
  效果函数:[],
  查询点:['game.js','skills.js'], 主公技:false });
登记技能({ 武将:'kongrong', 技能名:'争义', 实现方式:'cap-主动阶段',
  能力标识:['zhengyi'], 钩子:[],
  触发阶段:['zhengyi'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondZhengyi','maybeStartZhengyi'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'zhaoyun', 技能名:'龙胆', 实现方式:'cap-被动查询',
  能力标识:['longdan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['longdan'] },
  效果函数:[],
  查询点:['bot.js','game.js','sha/sha-resolution.js','skills.js'], 主公技:false });
登记技能({ 武将:'luxun', 技能名:'谦逊', 实现方式:'cap-被动查询',
  能力标识:['qianxun'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'luxun', 技能名:'连营', 实现方式:'cap-主动阶段',
  能力标识:['lianying'], 钩子:[],
  触发阶段:['lianyingAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLianying','maybeStartLianying'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'lvmeng', 技能名:'克己', 实现方式:'cap-被动查询',
  能力标识:['keji'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'simayi', 技能名:'反馈', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'simayi', 技能名:'鬼才', 实现方式:'cap-主动阶段',
  能力标识:['guicai'], 钩子:[],
  触发阶段:['guicai'],
  机器人接入:{ 决策:['guicaiHandPick'], 座位选择:[] },
  效果函数:['respondGuicai','finishGuicai'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'xiahoudun', 技能名:'刚烈', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:['ganglieAsk','ganglieChoice'],
  机器人接入:{ 决策:['ganglieChoice'], 座位选择:[] },
  效果函数:['respondGanglieAsk','respondGanglieChoice'],
  查询点:[], 主公技:false });
登记技能({ 武将:'xuchu', 技能名:'裸衣', 实现方式:'cap-主动阶段',
  能力标识:['luoyi'], 钩子:[],
  触发阶段:['luoyingAsk','luoyiAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLuoyi'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'yanliangwenchou', 技能名:'双雄', 实现方式:'cap-主动阶段',
  能力标识:['shuangxiong'], 钩子:[],
  触发阶段:['shuangxiongAsk'],
  机器人接入:{ 决策:[], 座位选择:['shuangxiong'] },
  效果函数:['respondShuangxiong'],
  查询点:['game.js','render.js'], 主公技:false });
登记技能({ 武将:'xunyu', 技能名:'驱虎', 实现方式:'cap-主动阶段',
  能力标识:['quhu'], 钩子:[],
  触发阶段:['quhuRespond','quhuDamageChoice'],
  机器人接入:{ 决策:[], 座位选择:['quhuDamage'] },
  效果函数:['respondQuhu','finishQuhu'],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'xunyu', 技能名:'节命', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:['jiemingAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'daqiao', 技能名:'国色', 实现方式:'cap-被动查询',
  能力标识:['guose'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['guose'] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'daqiao', 技能名:'流离', 实现方式:'cap-主动阶段',
  能力标识:['liuli'], 钩子:[],
  触发阶段:['liuli'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLiuli','maybeStartLiuli'],
  查询点:['sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'xiaoqiao', 技能名:'天香', 实现方式:'cap-主动阶段',
  能力标识:['tianxiang'], 钩子:[],
  触发阶段:['tianxiang'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondTianxiang','maybeStartTianxiang'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'xiaoqiao', 技能名:'红颜', 实现方式:'cap-被动查询',
  能力标识:['hongyan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'pangtong', 技能名:'连环', 实现方式:'cap-被动查询',
  能力标识:['lianhuan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'pangtong', 技能名:'涅槃', 实现方式:'cap-被动查询',
  能力标识:['niepan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['bot.js','game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'masu', 技能名:'散谣', 实现方式:'cap-被动查询',
  能力标识:['sanyao'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['sanyao'],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'masu', 技能名:'制蛮', 实现方式:'cap-主动阶段',
  能力标识:['zhimeng'], 钩子:[],
  触发阶段:['zhimengAsk','zhimengPick'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondZhimeng','finishZhimeng','triggerZhimeng','respondZhimengPick'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'machao', 技能名:'马术', 实现方式:'cap-被动查询',
  能力标识:['extraMinus1'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'machao', 技能名:'铁骑', 实现方式:'cap-主动阶段',
  能力标识:['tieqi'], 钩子:[],
  触发阶段:['tieqi'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondTieqi'],
  查询点:['sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'lidian', 技能名:'恂恂', 实现方式:'cap-主动阶段',
  能力标识:['xunxun'], 钩子:[],
  触发阶段:['xunxunPick'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondXunxun'],
  查询点:['game.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'lidian', 技能名:'忘隙', 实现方式:'cap-主动阶段',
  能力标识:['wangxi'], 钩子:[],
  触发阶段:['wangxiAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondWangxi'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'pangde', 技能名:'马术', 实现方式:'cap-被动查询',
  能力标识:['extraMinus1'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'pangde', 技能名:'猛进', 实现方式:'cap-主动阶段',
  能力标识:['mengjin'], 钩子:[],
  触发阶段:['mengjin'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondMengjin'],
  查询点:['sha/sha-resolution.js','weapons.js'], 主公技:false });
登记技能({ 武将:'menghuo', 技能名:'祸首', 实现方式:'cap-被动查询',
  能力标识:['huoshou'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'menghuo', 技能名:'再起', 实现方式:'cap-被动查询',
  能力标识:['zaiqi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondZaiqi'],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'zhenji', 技能名:'洛神', 实现方式:'cap-自动生效',
  能力标识:['luoshen'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['autoLuoshenRound','finishLuoshenJudge'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhenji', 技能名:'倾国', 实现方式:'cap-被动查询',
  能力标识:['qingguo'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
// ===== 批次 2/3:22 名武将,31 条技能 =====
登记技能({ 武将:'zhangliao', 技能名:'突袭', 实现方式:'cap-被动查询',
  能力标识:['tuxi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondTuxi'],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'ganning', 技能名:'奇袭', 实现方式:'cap-被动查询',
  能力标识:['qixi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['qixi'] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'huanggai', 技能名:'苦肉', 实现方式:'cap-被动查询',
  能力标识:['kurou'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'huaxiong', 技能名:'耀武', 实现方式:'cap-主动阶段',
  能力标识:['yaowu'], 钩子:[],
  触发阶段:['yaowu_choose'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondYaowu'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'huangyueying', 技能名:'集智', 实现方式:'cap-被动查询',
  能力标识:['jizhi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'sunquan', 技能名:'制衡', 实现方式:'cap-被动查询',
  能力标识:['zhiheng'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'sunquan', 技能名:'救援', 实现方式:'cap-被动查询',
  能力标识:['jiuyuan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:true });
登记技能({ 武将:'zhouyu', 技能名:'英姿', 实现方式:'cap-被动查询',
  能力标识:['extraDrawPhase'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhouyu', 技能名:'反间', 实现方式:'cap-主动阶段',
  能力标识:['fanjian'], 钩子:[],
  触发阶段:['fanjianSuit'],
  机器人接入:{ 决策:[], 座位选择:['fanjian'] },
  效果函数:['respondFanjianSuit'],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'sunce', 技能名:'激昂', 实现方式:'cap-主动阶段',
  能力标识:['jiang'], 钩子:[],
  触发阶段:['jiangchiAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'sunce', 技能名:'魂姿', 实现方式:'cap-主动阶段',
  能力标识:['hunzi'], 钩子:[],
  触发阶段:['yinghunTarget','yinghunChoice','yinghunDiscard'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondYinghunChoice'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'sunce', 技能名:'制霸', 实现方式:'cap-主动阶段',
  能力标识:['zhiba'], 钩子:[],
  触发阶段:['zhibaAsk','zhibaGain'],
  机器人接入:{ 决策:['zhibaAsk'], 座位选择:[] },
  效果函数:['respondZhiba','startZhiba','respondZhibaGain'],
  查询点:['game.js'], 主公技:true });
登记技能({ 武将:'huatuo', 技能名:'青囊', 实现方式:'cap-被动查询',
  能力标识:['qingnang'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['qingnang'] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'huatuo', 技能名:'急救', 实现方式:'cap-被动查询',
  能力标识:['jijiu'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'liubei', 技能名:'仁德', 实现方式:'cap-被动查询',
  能力标识:['rende'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:['rendeTwoStep'], 座位选择:[] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','render.js','skills.js'], 主公技:false });
登记技能({ 武将:'liubei', 技能名:'激将', 实现方式:'cap-主动阶段',
  能力标识:['jijiang'], 钩子:[],
  触发阶段:['jijiangAsk'],
  机器人接入:{ 决策:['jijiangAsk'], 座位选择:[] },
  效果函数:['respondJijiangAsk'],
  查询点:[], 主公技:true });
登记技能({ 武将:'caocao', 技能名:'奸雄', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'caocao', 技能名:'护驾', 实现方式:'cap-主动阶段',
  能力标识:['hujia'], 钩子:[],
  触发阶段:['hujiaAsk'],
  机器人接入:{ 决策:['hujiaAsk'], 座位选择:[] },
  效果函数:['respondHujiaAsk'],
  查询点:[], 主公技:true });
登记技能({ 武将:'guanyu', 技能名:'武圣', 实现方式:'cap-被动查询',
  能力标识:['wusheng'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['wusheng'] },
  效果函数:[],
  查询点:['bot.js','game.js','sha/sha-resolution.js','skills.js'], 主公技:false });
登记技能({ 武将:'huangzhong', 技能名:'烈弓', 实现方式:'cap-主动阶段',
  能力标识:['liegong'], 钩子:[],
  触发阶段:['liegong'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLiegong'],
  查询点:['sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'xuhuang', 技能名:'断粮', 实现方式:'cap-被动查询',
  能力标识:['duanliang'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:['duanliang'] },
  效果函数:[],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'yujin', 技能名:'毅重', 实现方式:'cap-被动查询',
  能力标识:['yizhong'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['sha/sha-resolution.js','weapons.js'], 主公技:false });
登记技能({ 武将:'yuejin', 技能名:'骁果', 实现方式:'cap-主动阶段',
  能力标识:['xiaoguo'], 钩子:[],
  触发阶段:['xiaoguo','xiaoguoChoice'],
  机器人接入:{ 决策:['xiaoguo'], 座位选择:[] },
  效果函数:['respondXiaoguo','advanceXiaoguo','respondXiaoguoChoice'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'zhanghe', 技能名:'巧变', 实现方式:'cap-主动阶段',
  能力标识:['qiaobian'], 钩子:[],
  触发阶段:['qiaobianTurnStart','qiaobianMove'],
  机器人接入:{ 决策:['qiaobianMove'], 座位选择:[] },
  效果函数:['respondQiaobianMove','doQiaobianMove'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'lvbu', 技能名:'无双', 实现方式:'cap-被动查询',
  能力标识:['wushuang'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js','render-controls.js','sha/sha-resolution.js','skills.js'], 主公技:false });
登记技能({ 武将:'zhuge', 技能名:'观星', 实现方式:'cap-主动阶段',
  能力标识:['guanxing'], 钩子:[],
  触发阶段:['guanxingReview'],
  机器人接入:{ 决策:['guanxing'], 座位选择:[] },
  效果函数:['respondGuanxing'],
  查询点:['skills.js'], 主公技:false });
登记技能({ 武将:'zhuge', 技能名:'空城', 实现方式:'cap-被动查询',
  能力标识:['kongcheng'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['bot.js','game.js','render.js','sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'jiangwei', 技能名:'挑衅', 实现方式:'cap-主动阶段',
  能力标识:['tiaoxin'], 钩子:[],
  触发阶段:['tiaoxinDiscard','tiaoxinChoice'],
  机器人接入:{ 决策:[], 座位选择:['tiaoxin'] },
  效果函数:['respondTiaoxin','startTiaoxinDiscard','respondTiaoxinChoice'],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'jiangwei', 技能名:'志继', 实现方式:'cap-主动阶段',
  能力标识:['zhiji'], 钩子:[],
  触发阶段:['zhijiChoice'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondZhijiChoice'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhoutai', 技能名:'不屈', 实现方式:'cap-主动阶段',
  能力标识:['buqu'], 钩子:[],
  触发阶段:['buquAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondBuqu'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'weiyan', 技能名:'狂骨', 实现方式:'cap-被动查询',
  能力标识:['kuanggu'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
// ===== 批次 3/3:22 名武将,40 条技能 =====
登记技能({ 武将:'lusu', 技能名:'好施', 实现方式:'cap-主动阶段',
  能力标识:['haoshi','extraDrawPhase'], 钩子:[],
  触发阶段:['haoshiPick'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondHaoshi'],
  查询点:['game.js','skills.js'], 主公技:false });
登记技能({ 武将:'lusu', 技能名:'缔盟', 实现方式:'cap-被动查询',
  能力标识:['dimeng'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondDimeng'],
  查询点:['render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'xiahouyuan', 技能名:'神速', 实现方式:'cap-主动阶段',
  能力标识:['shensu'], 钩子:[],
  触发阶段:['shensuChoose1','shensuSha','shensuChoose2','shensuShaRespond'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondShensuSha','finishShensuSha'],
  查询点:['game.js','skills.js'], 主公技:false });
登记技能({ 武将:'taishici', 技能名:'天义', 实现方式:'cap-主动阶段',
  能力标识:['tianyi'], 钩子:[],
  触发阶段:['tianyiPickCard','tianyiPickTarget','tianyiRespond'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondTianyi','startTianyi','finishTianyi'],
  查询点:['bot.js','game.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'dianwei', 技能名:'强袭', 实现方式:'cap-主动阶段',
  能力标识:['qiangxi'], 钩子:[],
  触发阶段:['qiangxiPickTarget','qiangxiChooseCost','qiangxiChooseWeaponFromHand'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['startQiangxi'],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'gongsunzan', 技能名:'趫猛', 实现方式:'cap-主动阶段',
  能力标识:['qiaomeng'], 钩子:[],
  触发阶段:['qiaomengChoose','qiaomengPickEquip'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['maybeStartQiaomeng','triggerQiaomeng'],
  查询点:['sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'gongsunzan', 技能名:'义从', 实现方式:'cap-被动查询',
  能力标识:['yicong'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'jiaxu', 技能名:'完杀', 实现方式:'cap-被动查询',
  能力标识:['wansha'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'jiaxu', 技能名:'乱武', 实现方式:'cap-主动阶段',
  能力标识:['luanwu'], 钩子:[],
  触发阶段:['luanwuChoose'],
  机器人接入:{ 决策:['luanwuChoice'], 座位选择:[] },
  效果函数:['startLuanwu'],
  查询点:['bot.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'jiaxu', 技能名:'帷幕', 实现方式:'cap-被动查询',
  能力标识:['weimu'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'yuanshao', 技能名:'乱击', 实现方式:'cap-主动阶段',
  能力标识:['luanji'], 钩子:[],
  触发阶段:['luanjiChoose','luanjiConfirm'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['startLuanji'],
  查询点:['bot.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'yuanshao', 技能名:'血裔', 实现方式:'cap-被动查询',
  能力标识:['xueyi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:true });
登记技能({ 武将:'yuanshu', 技能名:'妄尊', 实现方式:'cap-被动查询',
  能力标识:['wangzun'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:true });
登记技能({ 武将:'yuanshu', 技能名:'同疾', 实现方式:'cap-被动查询',
  能力标识:['tongji'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhangjiao', 技能名:'雷击', 实现方式:'cap-主动阶段',
  能力标识:['leiji'], 钩子:[],
  触发阶段:['leijiChoose','leijiJudge'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['maybeStartLeiji','triggerLeiji','doLeijiJudge'],
  查询点:['game.js','sha/sha-resolution.js'], 主公技:false });
登记技能({ 武将:'zhangjiao', 技能名:'鬼道', 实现方式:'cap-主动阶段',
  能力标识:['guidu'], 钩子:[],
  触发阶段:['guiduAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['finishGuidu','triggerGuidu'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhangjiao', 技能名:'黄天', 实现方式:'cap-被动查询',
  能力标识:['huangtian'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:true });
登记技能({ 武将:'caiwenji', 技能名:'悲歌', 实现方式:'cap-主动阶段',
  能力标识:['beige'], 钩子:[],
  触发阶段:['beigeChoose','beigeDiscard','beigeJudge'],
  机器人接入:{ 决策:['beigeChoose'], 座位选择:[] },
  效果函数:['triggerBeige','beigeDiscard','doBeigeJudge'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'caiwenji', 技能名:'断肠', 实现方式:'cap-被动查询',
  能力标识:['duanchang'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'caoren', 技能名:'据守', 实现方式:'cap-主动阶段',
  能力标识:['jushou'], 钩子:[],
  触发阶段:['jushouChoose'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'chengong', 技能名:'明策', 实现方式:'cap-主动阶段',
  能力标识:['mingce'], 钩子:[],
  触发阶段:['mingcePickCard','mingceChoice','mingcePickTarget','mingcePickTarget2'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['startMingce'],
  查询点:['game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'chengong', 技能名:'智迟', 实现方式:'cap-被动查询',
  能力标识:['zhichi'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhurong', 技能名:'巨象', 实现方式:'cap-被动查询',
  能力标识:['juxiang'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'zhurong', 技能名:'烈刃', 实现方式:'cap-主动阶段',
  能力标识:['lieRen'], 钩子:[],
  触发阶段:['lieRenRespond','lieRenChoose','lieRenPickCard'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLieRen','maybeStartLieRen','triggerLieRen'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'lingtong', 技能名:'旋风', 实现方式:'cap+hook',
  能力标识:['xuanfeng'], 钩子:['onLoseEquip'],
  触发阶段:['xuanfengPick'],
  机器人接入:{ 决策:[], 座位选择:['xuanfeng'] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'fazheng', 技能名:'恩怨', 实现方式:'cap-主动阶段',
  能力标识:['enyuan'], 钩子:[],
  触发阶段:['enyuanChoose','enyuanChooseOption','enyuanGiveCard'],
  机器人接入:{ 决策:['enyuanOption','enyuanGiveCard'], 座位选择:[] },
  效果函数:['triggerEnyuan'],
  查询点:['game.js','skills.js'], 主公技:false });
登记技能({ 武将:'fazheng', 技能名:'眩惑', 实现方式:'cap-主动阶段',
  能力标识:['huanhuo'], 钩子:[],
  触发阶段:['huanhuoPick','huanhuoPickGotCard','huanhuoPickCard','huanhuoPickSecond'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['startHuanhuo'],
  查询点:['game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'dingfeng', 技能名:'短兵', 实现方式:'cap-主动阶段',
  能力标识:['duanbing'], 钩子:[],
  触发阶段:['duanbingChoose'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['triggerDuanbing'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'dingfeng', 技能名:'奋迅', 实现方式:'cap-主动阶段',
  能力标识:['fenxun'], 钩子:[],
  触发阶段:['fenxunDiscard','fenxunTarget'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['startFenxun'],
  查询点:['bot.js','game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'caochong', 技能名:'称象', 实现方式:'cap-主动阶段',
  能力标识:['chengxiang'], 钩子:[],
  触发阶段:['chengxiangAsk','chengxiangChoose'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'caochong', 技能名:'仁心', 实现方式:'cap-主动阶段',
  能力标识:['renxin'], 钩子:[],
  触发阶段:['renxinChoose'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'xushu', 技能名:'无言', 实现方式:'cap-被动查询',
  能力标识:['wuyan'], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'xushu', 技能名:'举荐', 实现方式:'cap-主动阶段',
  能力标识:['jujian'], 钩子:[],
  触发阶段:['jujianPickCard','jujianPickTarget','jujianChooseEffect'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondJujianPickCard','respondJujianPickTarget'],
  查询点:['game.js'], 主公技:false });
登记技能({ 武将:'caozhang', 技能名:'将驰', 实现方式:'cap-主动阶段',
  能力标识:['jiangchi'], 钩子:[],
  触发阶段:['jiangchiAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondJiangchi'],
  查询点:['game.js','skills/late-generals.js'], 主公技:false });
登记技能({ 武将:'caozhi', 技能名:'落英', 实现方式:'cap-主动阶段',
  能力标识:['luoying'], 钩子:[],
  触发阶段:['luoyingAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondLuoying','maybeStartLuoying'],
  查询点:['skills/late-generals.js'], 主公技:false });
登记技能({ 武将:'caozhi', 技能名:'酒诗', 实现方式:'cap-主动阶段',
  能力标识:['jiushi'], 钩子:[],
  触发阶段:['jiushiFlipAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:['game.js','render-controls.js'], 主公技:false });
登记技能({ 武将:'yuji', 技能名:'蛊惑', 实现方式:'cap-主动阶段',
  能力标识:['guhuo'], 钩子:[],
  触发阶段:['guhuoTarget','guhuoQuestion'],
  机器人接入:{ 决策:['guhuoQuestion'], 座位选择:['guhuoTarget'] },
  效果函数:['startGuhuo','finishGuhuo','respondGuhuoQuestion'],
  查询点:['bot.js','game.js','render-controls.js','skills.js'], 主公技:false });
登记技能({ 武将:'yuji', 技能名:'缠怨', 实现方式:'状态字段',
  能力标识:[], 钩子:[],
  触发阶段:[],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:[],
  查询点:[], 主公技:false });
登记技能({ 武将:'zuoci', 技能名:'化身', 实现方式:'cap-主动阶段',
  能力标识:['huashen'], 钩子:[],
  触发阶段:['huashenPick','huashenChangeAskStart','huashenChangePickStart','huashenChangeAskEnd','huashenChangePickEnd'],
  机器人接入:{ 决策:['huashenSkill','huashenChangeStart','huashenChangeEnd'], 座位选择:[] },
  效果函数:['respondHuashenPick','respondHuashenChangeAskStart','respondHuashenChangePickStart','respondHuashenChangeAskEnd','respondHuashenChangePickEnd'],
  查询点:['game.js','room-lifecycle.js','skills.js'], 主公技:false });
登记技能({ 武将:'zuoci', 技能名:'新生', 实现方式:'hook',
  能力标识:[], 钩子:['onDamaged'],
  触发阶段:['xinshengAsk'],
  机器人接入:{ 决策:[], 座位选择:[] },
  效果函数:['respondXinshengAsk'],
  查询点:[], 主公技:false });

// ===== 非技能阶段/决策白名单 =====
// 反向完备性校验(规则9)要求 STAGE_TABLE / BOT_DECISIONS / BOT_SEAT_PICKS 的每一项
// 要么被上面某条技能登记引用,要么出现在这里。白名单本身也是登记的一部分——不允许
// 用"没登记就算了"糊弄过去,每一项都是经过确认"确实不属于任何武将技能"的通用机制
// (基本牌/锦囊牌/装备特效/通用响应窗口/机器人通用调度)。
const 非技能阶段白名单 = ['respond','aoeResp','duel','dying','dyingPublicWait','wuxie','wuxiePublicWait','pick','wugu',
  'huogong','huogongReveal','hanbing','hanbingAsk','guanshi','qinglong','qilin',
  'cixiongAsk','cixiongChoice','shaOffsetChoice','jiedaoChoice'];
const 非技能机器人决策白名单 = ['controlsChoice','discardSubset','pickSlot','pickGeneral','seatPick',
  'dying','duel','aoeResp','wuguPick','jiedaoResponse','jiedaoTwoStep','zhangbaTwoStep','fangtian'];
