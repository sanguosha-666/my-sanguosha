// ---------- 身份局机器人 ----------
// 机器人完全运行在第一名真人的浏览器里，不使用服务器进程。它只能读取公开身份、自己身份
// 和公开行动形成的嫌疑值；除主公/已阵亡翻开的角色外，不读取其他人的隐藏 role。
let botTimer=null;
let botScheduledKey=null;

function botControllerSeat(g){
  return (g.players||[]).findIndex(p=>p && !p.isBot && p.cid);
}
function isBotController(g){
  const seat=botControllerSeat(g);
  return seat>=0 && g.players[seat].cid===myClientId;
}
// phase -> "这个阶段真正该行动的人存在 pending 的哪个字段"。
// 【为什么必须查表】旧实现是按固定顺序扫 [asking,active,currentSeat,targetSeat,sourceSeat,
// damagerSeat,from,to,seat],返回第一个"恰好是机器人"的字段,不判断这个座位是不是该行动的
// 那个人。respond/aoeResp 的 pending 都是 {from,to},该响应的是 to,但 from 排在前面 —— 机器人
// 对机器人出杀时会把攻击者当成响应者,runBotDecision 对应分支要求 d.to===seat 不匹配、全部
// 落空,而每次调度只算一个座位,真正该出闪的机器人永远等不到调度,对局必然死锁。
// 【这张表的权威来源】不是从 runBotDecision 抄的,是逐条对照各响应函数在服务端的身份守卫
// (respondShan 的 g.pending.to!==mySeat、duelResponse 的 active、respondJiedao 的 seatA 等)
// 核验过的,33 条与 runBotDecision 的分支一一对应,无遗漏无多余。
// 【安全性质】各 runBotDecision 分支仍保留自己的 d.X===seat 复核,所以万一某条表项写错,
// 只会退化成"不行动"(=修复前的行为),绝不会让错误的机器人替别人行动。
// 新增技能/阶段时:在 runBotDecision 里加分支,就要在这里补一条,否则该阶段会掉进下面的
// 未覆盖兜底(能走,但不如查表精确)。
const BOT_PHASE_ACTOR = {
  huashenPick:'seat', guanxingReview:'seat', xunxunPick:'seat',
  respond:'to', aoeResp:'to', huogongReveal:'to',
  duel:'active',
  dying:'asking', wuxie:'asking', guicai:'asking',
  tieqi:'from', liegong:'from', huogong:'from', pick:'from', qilin:'from',
  hanbing:'from', mengjin:'from', shaOffsetChoice:'from',
  duanbingChoose:'sourceSeat', ganglieChoice:'sourceSeat',
  fanjianSuit:'targetSeat', quhuRespond:'targetSeat', tianyiRespond:'targetSeat',
  enyuanChoose:'damagerSeat', enyuanChooseOption:'damagerSeat', enyuanGiveCard:'damagerSeat',
  jiedaoChoice:'seatA',
  // 新增(机器人兜底词汇盲区修复,问题3+4):这几个phase的按钮文案("获得"/"不获得"、
  // "不再发动"、"更改【化身】"/"不更改"、"质疑"/"不质疑"、"移动到XX"/"不移动")没有一个被
  // botSafePrompt 的正则(/不发动|不使用|不出|取消|跳过|放弃|结束/ 和 /选择|交给|弃置|摸牌|
  // 回复|打出/)覆盖到,兜底探测不出可点按钮,必然卡死。这里不是简单扩充正则(那治标不治本,
  // 且 guhuoQuestion 本身是有策略含义的判断题,随便点安全按钮=瞎选而不是决策),而是照
  // huashenPick/guanxingReview 等既有先例补专门决策分支——补分支就必须同时在这张表里登记,
  // 否则 botSeatForState 会继续把这些phase当"未覆盖阶段"扔给 botFallbackSeats+
  // botSafePrompt(=修复前的broken路径),新分支永远不会被调用到。
  luoyingAsk:'seat', luoshen:'seat',
  huashenChangeAskStart:'seat', huashenChangeAskEnd:'seat',
  guhuoQuestion:'asking', qiaobianMove:'seat',
  // 【真实bug修复】郭嘉【遗计】是否发动这第一问(yijiAsk):行动者是 pending.seat 本人
  // (服务端 respondYijiAsk 守卫 g.pending.seat!==mySeat)。此前只登记了第二步的
  // yijiAssign(分配看到的两张牌),这一步完全没有登记过——botSeatForState 解析不出
  // 行动者,请求掉进 botFallbackSeats+botSafePrompt 兜底,而"不发动"按钮的文案精确命中
  // botSafePrompt 的安全正则(/不发动|.../),于是每次都被无条件点掉"不发动",机器人
  // 因此永远不会主动发动遗计(第二步的分配逻辑接线再完整也用不上,因为永远走不到那一步)。
  yijiAsk:'seat',
  // 【G4】遗计分配:行动者是 pending.seat 本人,补登记后 botSeatForState 才能解析出
  // 行动者走 runBotDecision 专用分支;不登记会掉进 botFallbackSeats+botSafePrompt
  // (按钮文案"给 自己/给 玩家X"不命中任一正则 → 只告警不动作,机器人遗计必然卡死)。
  yijiAssign:'seat',
  // 【G5】礼让发动:行动者是 pending.from(孔融本人,服务端 respondLiRang 守卫
  // g.pending.from!==mySeat)。补登记后 botSeatForState 才能解析出行动者走 runBotDecision
  // 专用分支;不登记会掉进 botFallbackSeats+botSafePrompt(改动前即如此,靠安全正则点
  // "不发动"按钮收尾,见 BOT_DECISIONS.lirangAsk 上方注释)。
  lirangAsk:'from',
  // 【A类修复,机器人技能覆盖审计】这四个此前只靠L1 controlsChoice(且不在
  // CONTROLS_CHOICE_ALLOWLIST里,无密钥时L1直接放弃)接管,没有专属分支——落到最终
  // botSafePrompt兜底时,四个按钮文案("不发动"/"不获得")都命中safe正则,机器人因此
  // 永远不会主动发动,和郭嘉遗计是同一类"机器人技能形同虚设"问题(只是不卡死)。actor
  // 字段登记早就存在,这次补的是专属决策分支,见下方runBotDecision对应注释。
  liuli:'to', tianxiang:'seat', lirangRecover:'from', zhengyi:'asking',
  // 【A1】骁果:行动者是 pending.asking(乐进,服务端 respondXiaoguo 守卫
  // g.pending.asking!==mySeat)。登记后 botSeatForState 才能解析出行动者走 runBotDecision
  // 专用分支(botDecide('xiaoguo'));不登记会掉进 botFallbackSeats+botSafePrompt。
  xiaoguo:'asking',
  // 【A1】骁果询问目标的二选一(弃装备/受伤害):行动者是 pending.to(服务端
  // respondXiaoguoChoice 守卫 g.pending.to!==mySeat)。登记后 L1(有密钥)才能解析出
  // 行动者镜像"弃置X【装备】/受到1点伤害"按钮;不登记 botSeatForState -1,L1 够不到。
  xiaoguoChoice:'to',
  // 【B2a】主公技求助(激将/护驾):行动者是 pending.asking(被求助者,服务端
  // respondLordAskCore 守卫 g.pending.asking!==mySeat)。登记后 botSeatForState 才能
  // 解析出行动者走 runBotDecision 专用分支(botDecide('jijiangAsk'/'hujiaAsk'));
  // 不登记会掉进 botFallbackSeats+botSafePrompt(按钮文案"替主公打出【X】/不出"不命中
  // 任一正则 → 只告警不动作,机器人求助必然卡死)。
  jijiangAsk:'asking', hujiaAsk:'asking',
  // 【B2b】制霸拼点:行动者是 pending.lordSeat(被请求的主公)。
  // runBotDecision 专用分支(botDecide('zhibaAsk'))。
  zhibaAsk:'lordSeat', zhibaGain:'lordSeat',
  yinghunTarget:'seat', yinghunChoice:'seat', yinghunDiscard:'targetSeat',
  // 【调度盲区收尾】蔡文姬【悲歌】三段(是否发动/选弃置的牌/进行判定),行动者始终是
  // pending.sourceSeat(悲歌发动者本人,服务端 triggerBeige/beigeDiscard/doBeigeJudge
  // 三个函数守卫都是 pending.sourceSeat!==mySeat)。此前三个 phase 都不在这张表里,
  // botSeatForState 恒返回 -1,调度请求走 botFallbackSeats+botSafePrompt 兜底——
  // 兜底能点掉"不发动"（安全正则命中），但即便配置了AI密钥也永远碰不到 runBotDecision，
  // 更碰不到 L1 的 AI 判断入口(真实dump用mock callAI验证过:决策请求根本没有转发到
  // runBotDecision，callAI 从未被调用)。登记后 BOT_DECISIONS.beigeChoose 才能被
  // botDecide 调用到，无密钥回退＝不发动(与改动前逐字一致)，有密钥时才能真正问AI。
  beigeChoose:'sourceSeat', beigeDiscard:'sourceSeat', beigeJudge:'sourceSeat',
  // 【调度盲区收尾】贾诩【乱武】:行动者是 pending.currentSeat(被依次询问的角色本人,
  // 服务端 chooseLuanwuOption 守卫 g.pending.currentSeat!==mySeat)。同上，此前不在表里，
  // 机器人永远只能被 botSafePrompt 兜底，而兜底的正则够不到"对X使用【杀】"/"失去1点体力"
  // 这两个自定义文案按钮——两个按钮同时存在时(可以出杀的情况)botSafePrompt 连"只有一个
  // 按钮就点它"这条最后兜底都用不上，真正点不到任何按钮、卡死；只有不能出杀只剩一个按钮
  // 时才侥幸能靠"唯一按钮"兜底走通。登记后这条彻底走 runBotDecision 专用分支，不再依赖
  // 这种侥幸。
  luanwuChoose:'currentSeat',
  // 【调度盲区收尾】凌统【旋风】:行动者是 pending.from(旋风发动者本人，服务端
  // pickXuanfengTarget/pickXuanfengCard/finishXuanfengSelection/cancelXuanfeng 四个函数
  // 守卫都是 pending.from!==mySeat)。BOT_SEAT_PICKS.xuanfeng(本文件更下方，seatPick
  // 协议里"旋风目标"这一项)其实早就写好了 match/buildSeatCandidates/fallbackSeat/execute
  // 四件套、且已经在 runBotDecision 里接了线(g.phase==='xuanfengPick'&&...stage==='selecting'
  // 分支)——但这条接线全程都是死代码，因为 xuanfengPick 没登记进这张表，调度请求根本
  // 到不了 runBotDecision。登记后这套已经写好的 AI 接入立刻生效，不需要再补新代码。
  xuanfengPick:'from',
  // 【本地机器人服务阶段0调查顺带发现,和 xuanfengPick 同一类漏登记】于吉【蛊惑】选目标:
  // 行动者是 pending.sourceSeat(蛊惑发动者本人,服务端 guhuoChooseTarget/guhuoJiedaoPick/
  // guhuoJiedaoConfirm 三个函数守卫都是 g.pending.sourceSeat!==mySeat)。
  // BOT_SEAT_PICKS.guhuoTarget 四件套早就写好、runBotDecision 里也接了线(bot.js 下方
  // g.phase==='guhuoTarget' 分支),但因为没登记进这张表,botSeatForState 恒返回 -1,
  // 那条接线全程是死代码。
  // 【比 xuanfengPick 更严重】xuanfengPick 至少还渲染按钮,漏登记时能靠 botSafePrompt
  // 侥幸点掉;guhuoTarget 在 renderControls 里【只渲染 banner + 座位卡高亮,不产生任何
  // #controls 按钮】(见 render-controls.js:3544 段),botSafePrompt 一个按钮都找不到 →
  // runBotFallbackProbe 只打一条 console.warn 就返回 false → 状态一字不变、机器人不会
  // 改主意 → 真正的永久卡死(CLAUDE.md 第26条描述的那类"对真人只是卡一下、对机器人是
  // 永久卡死")。登记后走专用分支,已写好的 seatPick 接入立刻生效。
  guhuoTarget:'sourceSeat',
  // 【同上,同一批发现】荀彧【驱虎】拼点赢后选伤害目标:行动者是 pending.seat(荀彧本人,
  // 服务端 respondQuhuDamage 守卫 g.pending.seat!==mySeat)。同样早已写好
  // BOT_SEAT_PICKS.quhuDamage + runBotDecision 接线,同样因为漏登记而全程死代码。
  // 这个会渲染按钮("令 X 对 Y 造成1点伤害"),但文案既不命中 botSafePrompt 的安全正则
  // (/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/)也不命中必选正则(/选择|交给|弃置|
  // 摸牌|回复|打出/)——只有"目标恰好只剩1个"时才能靠"唯一按钮"这条最后兜底侥幸走通,
  // 目标≥2个时同样永久卡死。和 luanwuChoose 当初的情况一模一样。
  quhuDamageChoice:'seat',
  // 【系统性扫描发现的紧急盲区】祝融【烈刃】拼点响应:行动者是 pending.targetSeat(被拼点
  // 的目标本人,服务端 respondLieRen 守卫 g.pending.targetSeat!==mySeat)。真实dump确认过
  // 这个不只是"没有智能判断"——目标手牌数>1时,按钮文案是"【牌名】♠5"这种纯牌面拼接,不
  // 命中 botSafePrompt 任何正则、也没有取消选项,6轮驱动状态完全不变,真正永久卡死。
  lieRenRespond:'targetSeat',
  // 【系统性扫描发现的紧急盲区】典韦【强袭】选目标:行动者是 pending.seat(强袭发动者本人,
  // 服务端 pickQiangxiTarget 守卫 g.pending.seat!==mySeat)。按钮文案就是目标的纯姓名(代码
  // 里明确注释"消耗支付后不可取消,因此不提供取消按钮"),候选≥2个时同样不命中任何正则,
  // 真实dump确认过真正永久卡死。
  qiangxiPickTarget:'seat',
  // 【渲染层bug修复顺带补上,和luanjiChoose/luanjiConfirm同一批】典韦【强袭】前两段:
  // qiangxiChooseCost/qiangxiChooseWeaponFromHand 行动者都是 pending.seat(典韦本人,
  // 自主发动、机器人目前没有入口主动调用startQiangxi——防御性收录)。qiangxiPickTarget
  // 早就注册过(系统性扫描紧急排查那批),这次只补前两段。
  qiangxiChooseCost:'seat', qiangxiChooseWeaponFromHand:'seat',
  // 【第二批-第1组,每回合结束都可能触发,优先级最高】徐庶【举荐】三段:jujianPickCard/
  // jujianPickTarget 的行动者是 pending.sourceSeat(徐庶本人,服务端 respondJujianPickCard/
  // respondJujianPickTarget/cancelJujian 守卫都是 g.pending.sourceSeat!==mySeat);
  // jujianChooseEffect 的行动者是 pending.targetSeat(被举荐的目标,可能是另一个人,服务端
  // respondJujianEffect 守卫 g.pending.targetSeat!==mySeat)——三段行动者不是同一个字段,
  // 不能只登记一次。这三个 phase 都有"取消"按钮能命中 botSafePrompt 安全正则(不卡死),
  // 只是缺乏真正判断(永远"不发动"/永远随机点)，属于第二批"有兜底但不智能"批量修复项。
  jujianPickCard:'sourceSeat', jujianPickTarget:'sourceSeat', jujianChooseEffect:'targetSeat',
  // 【第二批-第1组】曹仁【据守】:行动者是 pending.seat(曹仁本人,服务端 confirmJushou/
  // cancelJushou 守卫都是 pending.seat!==mySeat)。有"取消"按钮能命中安全正则,不卡死，
  // 同上属于"有兜底但不智能"。
  jushouChoose:'seat',
  // 【第二批-第2组,装备类4个,同一套结构】雌雄双股剑:cixiongAsk 的行动者是 pending.from
  // (装备者/攻击者本人,服务端 respondCixiongAsk 守卫 g.pending.from!==mySeat);
  // cixiongChoice 的行动者是 pending.to(被指定的异性目标,服务端 respondCixiongChoice
  // 守卫 g.pending.to!==mySeat)——和举荐一样，前后两段行动者字段不同。
  cixiongAsk:'from', cixiongChoice:'to',
  // 贯石斧:行动者是 pending.from(装备者/攻击者本人,服务端 respondGuanshi 守卫
  // g.pending.from!==mySeat)。
  guanshi:'from',
  // 寒冰剑:是否发动这一问的行动者是 pending.from(装备者/攻击者本人,服务端
  // respondHanbingAsk 守卫 g.pending.from!==mySeat)。发动后进入的弃牌子阶段
  // (pending.type==='hanbing')已经登记过(见上方 hanbing:'from')，这里补的是"是否发动"
  // 这第一问。
  hanbingAsk:'from',
  // 青龙偃月刀:行动者是 pending.from(装备者/攻击者本人,服务端 respondQinglong 守卫
  // g.pending.from!==mySeat)。
  qinglong:'from',
  // 【第二批-第3组】颜良文丑【双雄】:摸牌阶段开始"是否发动"询问,行动者是 pending.seat
  // (双雄拥有者本人,服务端 respondShuangxiong 守卫 g.pending.seat!==mySeat)。
  shuangxiongAsk:'seat',
  // 【第二批-第3组】张角【雷击】:leijiChoose(是否发动+选目标)/leijiJudge(进行判定的
  // 确认点击)行动者都是 pending.sourceSeat(张角本人,服务端 triggerLeiji/cancelLeiji/
  // doLeijiJudge 对 leijiChoose 的守卫是 sourceSeat!==mySeat；leijiJudge 本身函数体没有
  // seat校验，但渲染层用 sourceSeat===mySeat 把关，行动者语义一致)。
  leijiChoose:'sourceSeat', leijiJudge:'sourceSeat',
  // 【第二批-剩余清单批量处理】鲁肃【好施】:行动者是 pending.seat(好施拥有者本人,
  // 服务端 respondHaoshi 守卫隐含在 pending.seat 上——只有平手多候选时才会开这个 pending)。
  haoshiPick:'seat',
  // 姜维【挑衅】发起者选弃哪张牌:行动者是 pending.from(挑衅发起者,服务端
  // pickTiaoxinDiscard 守卫 from!==mySeat)。目前机器人从不主动发起挑衅(无入口),这条
  // registration 是防御性收录,万一以后接了入口不会掉进盲区。
  tiaoxinDiscard:'from',
  // 貂蝉【闭月】:行动者是 pending.seat(服务端 respondBiyue 守卫 seat!==mySeat)。
  biyue:'seat',
  // 周泰【不屈】:行动者是 pending.seat(服务端 respondBuqu 守卫 seat!==mySeat)。
  buquAsk:'seat',
  // 曹冲【仁心】:行动者是 pending.seat(保护者本人,服务端 chooseRenxinEquip/cancelRenxin
  // 守卫 seat!==mySeat——注意不是被保护的目标 pending.target)。
  renxinChoose:'seat',
  // 曹冲【称象】:行动者是 pending.seat(曹冲本人)。注意 confirmChengxiangAsk 把
  // pending.type 从'chengxiangAsk'切到'chengxiangChoose'时,从来没有同步改g.phase——
  // g.phase 全程停留在'chengxiangAsk'不变(渲染层 renderCaochong 本来就只按
  // pending.type分派,不看phase),所以这里只登记一次'chengxiangAsk',不需要也不能
  // 登记'chengxiangChoose'(那个key在botSeatForState里永远查不到,登记了也是死代码)。
  chengxiangAsk:'seat',
  // 许褚【裸衣】:行动者是 pending.seat(服务端 respondLuoyi 守卫 seat!==mySeat)。
  luoyiAsk:'seat',
  // 荀彧【节命】:行动者是 pending.seat(服务端 respondJieming 守卫 seat!==mySeat)。
  jiemingAsk:'seat',
  // 左慈【新生】:行动者是 pending.seat(服务端 respondXinshengAsk 守卫 seat!==mySeat)。
  xinshengAsk:'seat',
  // 曹植【酒诗】翻面询问(受伤且背面朝上时):行动者是 pending.seat(服务端
  // respondJiushiFlip 守卫 seat!==mySeat)。
  jiushiFlipAsk:'seat',
  // 陆逊【连营】:行动者是 pending.seat(服务端 respondLianying 守卫 seat!==mySeat)。
  lianyingAsk:'seat',
  // 陈宫【明策】四段:mingcePickCard/mingcePickTarget/mingcePickTarget2 的行动者都是
  // pending.sourceSeat(陈宫本人,自主发动、机器人目前没有入口主动调用startMingce——
  // 这三段是防御性收录);mingceChoice 的行动者是 pending.targetSeat(接收牌的那个人,
  // 可能是另一个人的机器人,真实可达)。
  mingcePickCard:'sourceSeat', mingcePickTarget:'sourceSeat', mingcePickTarget2:'sourceSeat',
  mingceChoice:'targetSeat',
  // 【Part2补全】太史慈【天义】前两段(选拼点牌/选目标):行动者是 pending.seat(天义
  // 发动者本人,服务端 pickTianyiCard/pickTianyiTarget 守卫 pending.seat!==mySeat)。
  // 拼点响应段 tianyiRespond(目标本人)早就注册过(见上方 targetSeat 那一组)。
  tianyiPickCard:'seat', tianyiPickTarget:'seat',
  // 【Part2补全】丁奉【奋迅】两段:行动者是 pending.seat(奋迅发动者本人,服务端
  // pickFenxunDiscard/pickFenxunTarget 守卫 pending.seat!==mySeat)。
  fenxunDiscard:'seat', fenxunTarget:'seat',
  // 公孙瓒【趫猛】:qiaomengChoose/qiaomengPickEquip 行动者都是 pending.sourceSeat
  // (公孙瓒本人,被动触发——黑色杀命中且目标有装备,真实可达)。
  qiaomengChoose:'sourceSeat', qiaomengPickEquip:'sourceSeat',
  // 李典【忘隙】:行动者是 pending.seat(服务端 respondWangxi 守卫 seat!==mySeat)。
  wangxiAsk:'seat',
  // 【系统性扫描发现的遗漏,和郭嘉遗计yijiAsk同一批】夏侯惇【刚烈】是否发动这第一问:
  // 行动者是 pending.seat(服务端 respondGanglieAsk 守卫 g.pending.seat!==mySeat)。此前
  // 完全没有登记过,机器人永远被botSafePrompt兜底点掉"不发动"按钮。
  ganglieAsk:'seat',
  // 【系统性扫描发现的遗漏】张角【鬼道】是否发动:行动者是 pending.sourceSeat(被依次询问
  // 的候选人本人,服务端 triggerGuidu/cancelGuidu 守卫 g.pending.sourceSeat!==mySeat)。
  guiduAsk:'sourceSeat',
  // 【系统性扫描发现的遗漏】曹彰【将驰】摸牌阶段三选一:行动者是 pending.seat(曹彰本人,
  // 服务端 respondJiangchi 守卫 g.pending.seat!==mySeat)。
  jiangchiAsk:'seat',
  // 【B类修复,机器人技能覆盖审计】姜维【志继】觉醒选择:行动者是 pending.seat(姜维本人,
  // 服务端 respondZhijiChoice 守卫 g.pending.seat!==mySeat)。此前完全没有登记,且两个
  // 按钮("回复1点体力"/"摸两张牌")都不命中botSafePrompt任何安全正则、又恒为两个按钮
  // 同时存在(不是"唯一按钮"的侥幸边界)——姜维体力上限降到阈值后这是强制触发的觉醒,
  // 不是可选发动,机器人玩姜维、条件一满足就100%卡死,审计标为B类最高优先级。
  zhijiChoice:'seat',
  // 【B类修复,机器人技能覆盖审计】姜维【挑衅】目标二选一:行动者是 pending.to(被挑衅的
  // 目标本人,服务端 respondTiaoxinChoice 守卫 g.pending.to!==mySeat)。注意这和"是否
  // 发动挑衅"这个前置决策(BOT_SEAT_PICKS.tiaoxin,发动方)是两个不同座位视角——发动方
  // 早就接好了,被挑衅的目标如果是机器人,此前完全没有任何决策代码。目标有可用杀时会
  // 渲染两个按钮("对其使用【杀】"/"被弃置一张牌"),都不命中安全正则,真卡死;目标没有
  // 可用杀时只渲染"被弃置一张牌"一个按钮,能被botSafePrompt"唯一按钮"兜底侥幸点掉——
  // 这次补上确定性分支后不再依赖这个侥幸。
  tiaoxinChoice:'to',
  // 【B类修复,机器人技能覆盖审计,标注"潜在"风险的收尾】法正【眩惑】四个子阶段:行动者
  // 都是 pending.sourceSeat(法正本人,自主发动、服务端各自函数守卫都是
  // g.pending.sourceSeat!==mySeat)。这四个子阶段目前不会被机器人真正触发到(发动入口
  // startHuanhuo 本身没有任何机器人代码调用它,是此前"机器人主动技能解锁"任务里评估过的
  // 保守决策,这次不改),但既然审计已经指出"以后如果入口被接上、子阶段没预先补上决策会
  // 变成新的卡死点",这次一并把子阶段的决策补齐,不留隐患。
  huanhuoPick:'sourceSeat', huanhuoPickCard:'sourceSeat',
  huanhuoPickGotCard:'sourceSeat', huanhuoPickSecond:'sourceSeat',
  // 【A类修复,机器人技能覆盖审计】祝融【烈刃】发动+选牌:行动者都是 pending.sourceSeat
  // (祝融本人,服务端 triggerLieRen/pickLieRenCard/cancelLieRen 守卫都是
  // g.pending.sourceSeat!==mySeat)。此前完全没有登记,落到botFallbackSeats+
  // botSafePrompt,"不发动"命中safe正则,机器人从未主动拼点过。
  lieRenChoose:'sourceSeat', lieRenPickCard:'sourceSeat',
  // 【A类修复】夏侯渊【神速1】/【神速2】:是两个独立的决策点(分别在准备阶段判定/摸牌前、
  // 摸牌阶段结束出牌前触发,各自有自己的限一次标志shensuUsed1/shensuUsed2),不是同一
  // 决策的两个分支。行动者都是pending.seat(夏侯渊本人)。此前完全没有登记。
  shensuChoose1:'seat', shensuChoose2:'seat',
  // 【A类修复】张郃【巧变】回合开始询问:行动者是pending.seat(张郃本人,服务端
  // qiaobianDecline等守卫g.pending.seat!==mySeat)。此前完全没有登记。注意这和已经
  // 接线的qiaobianMove(出牌阶段中途版本)是同一技能的两个不同触发时机,分开处理。
  qiaobianTurnStart:'seat',
  // 华雄【耀武】:行动者是 pending.seat(造成伤害的那个人,服务端 respondYaowu 守卫
  // seat!==mySeat)。
  yaowu_choose:'seat',
  // 夏侯渊【神速】"视为杀"选目标:行动者是 pending.seat(夏侯渊本人,自主发动、机器人
  // 目前没有入口主动调用triggerShensu1/2——防御性收录)。
  shensuSha:'seat',
  // 马谡【制蛮】:zhimengAsk/zhimengPick 行动者都是 pending.from(马谡本人,被动触发——
  // 马谡即将造成伤害时,真实可达)。
  zhimengAsk:'from', zhimengPick:'from',
  // 左慈"更改化身"第二步(选具体武将+技能):huashenChangePickStart/huashenChangePickEnd
  // 行动者都是 pending.seat(左慈本人)。第一步(是否更改,huashenChangeAskStart/AskEnd)
  // 早就注册过、无密钥默认"不更改"——这两个第二步只有配了AI密钥且AI选择"更改"才会真正
  // 走到,此前一直未注册、属于"只在AI路径才会暴露"的潜在盲区,这次一并补上,防御性收录。
  huashenChangePickStart:'seat', huashenChangePickEnd:'seat',
  // 【渲染层bug修复顺带补上】袁绍【乱击】:luanjiChoose/luanjiConfirm 行动者都是
  // pending.sourceSeat(袁绍本人,自主发动、机器人目前没有入口主动调用startLuanji——
  // 防御性收录,和明策/神速等其它"自主发动类"技能同一类)。这两个phase此前从未在
  // BOT_PHASE_ACTOR里出现过,是配合render-controls.js渲染层bug一起修的:渲染bug修好后
  // 这两步对人类/机器人都变得可达,如果不补机器人分支,机器人反而会新出现"卡在这两步"
  // 的风险(此前渲染都渲染不出来,机器人靠botSafePrompt兜底点不到任何东西但至少不会
  // 被误判成"该我行动"——现在渲染修好,botSeatForState若查不到这两个key会走
  // botFallbackSeats兜底,同样安全,但既然要修就一并补齐,不留新盲区)。
  luanjiChoose:'sourceSeat', luanjiConfirm:'sourceSeat'
};
function botSeatForState(g){
  const d=g.pending||{};
  // 【AI托管】托管中的真人座位视同机器人:isBotSeat 覆盖为"托管座位即真"。
  // 一处改动覆盖 A/B 全部段落(各段都用 isBotSeat 判),托管座位在 draw/play/discard、
  // 响应类 pending(BOT_PHASE_ACTOR)等全部阶段都能被调度。托管关闭(active=false)时
  // aiTestAutopilot 判定恒 false,行为与托管前完全一致。
  const isAutopilotSeat=s=>s>=0 && (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
    && aiTestAutopilot.active && aiTestAutopilot.seat===s;
  const isBotSeat=s=>Number.isInteger(s)&&g.players[s]&&(g.players[s].isBot||isAutopilotSeat(s));
  // A. 行动者不在 pending 字段上的几个特殊阶段
  if(g.phase==='wugu'&&d.type==='wugu'&&Array.isArray(d.order)){
    const picker=d.order[d.idx||0];
    return isBotSeat(picker)?picker:-1;
  }
  if(g.phase==='pickingLordGeneral'){
    const lord=getLordSeat(g);
    return isBotSeat(lord)?lord:-1;
  }
  if(g.phase==='pickingGeneral'){
    // 选将是各选各的:任意一个还没选将的机器人都可以现在就选
    // (走 isBotSeat,和 A/B 其余段落一致:托管中的真人座位也视同机器人)
    const pick=(g.players||[]).findIndex((p,i)=>p&&isBotSeat(i)&&!p.general);
    return pick>=0?pick:-1;
  }
  if(g.phase==='draw'||g.phase==='play'||g.phase==='discard'){
    return isBotSeat(g.turn)?g.turn:-1;
  }
  // B. 其余已覆盖阶段:查表直取,不猜
  const field=BOT_PHASE_ACTOR[g.phase];
  if(field!==undefined){
    return isBotSeat(d[field])?d[field]:-1;
  }
  // C. runBotDecision 未覆盖的阶段(骁果/据守/礼让/悲歌/旋风等 70+ 个):这里不猜字段,
  //    交给 botFallbackSeats + botSafePrompt 逐个座位试。
  return -1;
}
// 上面 A/B 两段能解析出行动者的阶段集合。已知阶段就算解析结果是"该真人行动"(返回 -1),
// 也不该再去兜底试点 —— 那是真人的回合,机器人不该插手,试点只会白白渲染+刷告警。
const BOT_KNOWN_PHASES = new Set(
  Object.keys(BOT_PHASE_ACTOR).concat(
    ['wugu','pickingLordGeneral','pickingGeneral','draw','play','discard'])
);
// 未覆盖阶段的兜底候选:所有存活机器人。只在确实有人被询问(g.pending 非空)时才给,
// 避免正常轮次里空转渲染。真正"该不该由这个座位点"由 botSafePrompt 自证 —— renderControls
// 的各分支都按 ===mySeat 把关,不该他动的时候压根渲染不出可点按钮。
function botFallbackSeats(g){
  if(!g.pending || BOT_KNOWN_PHASES.has(g.phase)) return [];
  const out=[];
  (g.players||[]).forEach((p,i)=>{ if(p&&p.isBot&&p.alive) out.push(i); });
  return out;
}
function runBotFallbackProbe(g){
  for(const s of botFallbackSeats(g)){
    if(botSafePrompt(g,s)) return true;
  }
  console.warn('机器人兜底未找到可点按钮',g.phase,(g.pending||{}).type);
  return false;
}
function botStateKey(g,seat){
  const d=g.pending||{};
  const p=g.players[seat]||{};
  return [
    g.phase,g.turn,g.roundNum,seat,d.type,d.asking,d.active,d.stage,d.idx,d.to,d.from,
    p.hp,(p.hand||[]).length,(g.log||[]).length
  ].join(':');
}
// botDecisionInFlight:AI机器人接入第二阶段新增的并发保护——botPlay 改成 async 之后,
// "AI思考"这段等待(最长约15秒,见 tryAiBotPlay 顶部注释)期间,任何触发 render(g) 的
// 事件(比如别的玩家的操作、甚至只是网络重连推送)都会经过 render.js 里
// scheduleBotTurn(g) 这唯一的调用点重新跑一遍;而这段等待期间服务端状态其实完全没变
// (我们在等的是"自己"的决策结果,不是别人的行动),botStateKey 算出来的 key 会和上一次
// 一模一样,原有的"botTimer && botScheduledKey===key 就不重复排程"这条防重复守卫只挡得住
// "定时器还没触发"这一段,挡不住"定时器已经触发、决策还在异步进行中"这一段(触发那一刻
// botTimer 已经清空成 null)——不加这个标志位,会在同一个决策点上并发跑出两次
// runBotDecision,对 botPlay 而言就是两次并发的AI调用/两次 playCard,是这次改成 async
// 之后必须补的正确性保护,不是可选的优化。只在"确实有一个决策正在进行"时才为真,
// try/finally 保证不管走哪条路径(成功/AI失败回退本地/抛异常)最终都会被清空,不会永久
// 卡住机器人。
let botDecisionInFlight=false;
// botMissedSchedule:修复"botDecisionInFlight期间的调度请求被静默丢弃、永久卡死"这个
// 真实bug(真实dump复现过:郭嘉的guicai决策AI调用还没resolve期间,另一次无懈可击链式
// 询问轮到郭嘉,scheduleBotTurn 在124行直接return丢弃这次请求,不记录、不重试;
// botDecisionInFlight清零后没有任何机制补上这次机会,除非之后又有别的无关事件恰好
// 触发一次render(g),否则游戏永久卡死——这不是guicai特有的,用botPlay同样能复现,是
// Phase2引入botDecisionInFlight时就存在的架构缺口,只是Phase4新增的三个"由其它玩家
// 操作触发、可能命中旁观机器人"的决策点显著放大了真实触发概率)。
// 只在"因为botDecisionInFlight为true而被丢弃、且这次被丢的状态和当前正在进行中的那个
// 决策不是同一份"这种情况下才置真——!g/非机器人控制端/游戏结束/没有座位需要行动/同一个
// key已经在debounce队列里 这几种情况都是"本来就没事可做"或"已经有等价请求在排队",不是
// "漏掉了一次本该处理的机会",不应该触发重查。"和当前决策是不是同一份状态"这条判断是
// 必需的,不是可选的精细化——第一版实现漏了这一层,导致既有回归测试(test_bot_ai_playbook.js
// "端到端:选牌+选目标两次AI等待期间"那条)变红:那条测试专门验证"AI调用还没回应期间,
// 重复触发scheduleBotTurn(状态完全没变)不应该产生额外callAI调用",这本身是完全合理的
// 既有场景(Firebase的重复回声/无实质变化的重渲染,真实场景里会发生)——如果不加这层
// 区分,清零后的补查会把这类"重复的、状态没变的丢弃"也当成"漏掉的机会"重新处理一遍,
// 对同一份已经处理完的状态再决策一次,产生多余的AI调用甚至重复的动作提交。
// botScheduledKey 正是"当前正在进行中的这个决策对应的key"——从这个决策被 setTimeout
// 调度那一刻起,到它真正resolve、finally里清零botDecisionInFlight之前,不会被别的调用
// 覆盖(scheduleBotTurn只有在botDecisionInFlight为false时才会走到重新赋值这一行),
// 天然可以拿来判断"这次被丢的请求,和正在进行中的是不是同一回事"。
// scheduleBotTurn 本身是"读当前g、判断该轮到谁"的无状态判断,清零后不需要记住"当时具体
// 丢的是哪次请求",只需要知道"该拿最新状态再检查一次"——用 currentG(render(g) 函数体
// 第一行就会更新,早于调用 scheduleBotTurn,所以清零这一刻读到的必然是最新真相)重新调用
// scheduleBotTurn 自己即可自愈,不需要为多次丢弃分别记录/重放。
let botMissedSchedule=false;
function scheduleBotTurn(g){
  if(!g) return;
  // 【AI托管】托管自己座位时,即使自己不是 isBotController(不是第一个真人)也允许跑
  // 调度,但只限托管座位自己;其它机器人座位仍由控制器浏览器独占驱动(非控制器浏览器在
  // "轮到别的 bot 座位"时直接 return,双浏览器驱动会冲突)。非托管场景行为与原来一致
  // (isBotController 判定)。
  const aiTestSelf = (typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
    && aiTestAutopilot.seat===mySeat;
  if(!isBotController(g)&&!aiTestSelf) return;
  // 【AI摘要】游戏结束清空记忆;回合变化(roundNum/turn)且已有摘要时,异步更新记忆
  // (fire-and-forget,不阻塞决策;更新完成后的下一轮决策才带上新摘要)
  if(g.phase==='over'){ aiSummaryReset(); return; }
  const seat=botSeatForState(g);
  // 【AI托管】非控制器浏览器(靠 aiTestSelf 放行)只允许调度托管座位自己,
  // 绝不能驱动其它机器人座位(那是控制器浏览器的职责,双浏览器驱动会冲突)。
  if(!isBotController(g) && !(aiTestSelf && seat===aiTestAutopilot.seat)) return;
  // seat>=0 才碰摘要座位:seat===-1 是真人回合(scheduleBotTurn 每次渲染都跑),
  // 此时 reset 会把机器人的跨回合记忆清掉,2人局(1真人+1机器人)记忆永远活不过
  // 一个真人回合。只有"换到另一个机器人座位"(或首遇机器人座位)才该清空。
  if(seat >= 0 && aiSummarySeat !== seat) aiSummaryReset();
  if(seat >= 0){
    aiSummarySeat = seat;
    if(aiSummary && (aiSummaryRound !== g.roundNum || aiSummaryTurn !== g.turn)){
      aiSummaryRound = g.roundNum; aiSummaryTurn = g.turn;
      updateAiSummary(g, seat);
    }
  }
  if(botDecisionInFlight){
    if(seat>=0 || botFallbackSeats(g).length){
      const droppedKey=botStateKey(g,seat);
      if(droppedKey!==botScheduledKey) botMissedSchedule=true;
    }
    return;
  }
  // seat<0 有两种情况:该行动的是真人(不该我们插手),或这个阶段 runBotDecision 没覆盖
  // (需要走兜底逐个试)。只有后者才继续排程。
  if(seat<0 && !botFallbackSeats(g).length) return;
  const key=botStateKey(g,seat);
  if(botTimer && botScheduledKey===key) return;
  if(botTimer) clearTimeout(botTimer);
  botScheduledKey=key;
  botTimer=setTimeout(async ()=>{
    botTimer=null;
    const latest=(typeof currentG!=='undefined')?currentG:null;
    if(!latest) return;
    const nowSeat=botSeatForState(latest);
    // 【AI托管】回调第二道门与入口门同一口径:非控制器浏览器只在"轮到托管座位自己"
    // 时放行,否则 return(不执行决策);控制器浏览器行为与原来完全一致。
    const aiTestSelfNow = (typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
      && aiTestAutopilot.seat===mySeat;
    if(!isBotController(latest) && !(aiTestSelfNow && nowSeat===aiTestAutopilot.seat)) return;
    if(botStateKey(latest,nowSeat)!==key) return;
    botDecisionInFlight=true;
    try{
      if(nowSeat>=0) await runBotDecision(latest,nowSeat);
      else runBotFallbackProbe(latest);
    } finally {
      botDecisionInFlight=false;
      // 补检查:期间有调度请求被丢弃过,现在标志位已清零,用最新的 currentG 重新跑一遍
      // scheduleBotTurn 自己——它会自己判断"当前到底该谁行动",不需要外部传入具体信息。
      // 这一步是同步调用(不用 setTimeout(fn,0) 延迟):scheduleBotTurn 本身极轻(只做
      // 字段比较+最多设置一个定时器),真正的重活(runBotDecision)永远要再等一次
      // 650~1150ms 的debounce才会执行,不存在"同步递归导致调用栈爆炸"或"抢占式执行"的
      // 风险;currentG 在这一刻必然是最新的(render(g)把 currentG=g 放在函数体第一行,
      // 早于调用 scheduleBotTurn,不存在"还没更新完"的竞态)。用 try/catch 包一层,和
      // render.js 里"渲染与机器人调度双向隔离"的既有写法同一原则,避免这次补查自身出
      // 意外时把外层 finally 搞崩。
      if(botMissedSchedule){
        botMissedSchedule=false;
        try{ scheduleBotTurn(typeof currentG!=='undefined'?currentG:null); }
        catch(e){ console.warn('bot missed-schedule recheck',e); }
      } else if(botTwoStepA){
        // 【botTwoStepA 自我触发,真实bug修复】借刀杀人/离间/丈八蛇矛/仁德四个技能共享
        // 的两步/三步本地状态机——阶段A/B的 execute 只把选择存进这个纯客户端本地变量,
        // 完全不写入 Firebase(见各自 execute 里"等下一调度走阶段X"的注释)。机器人调度
        // (scheduleBotTurn)唯一的触发来源是 Firebase 的 onValue 事件:阶段A/B没有任何
        // 写入,就没有任何事件,就没有下一次调度——真实dump复现过,在没有其它玩家/事件
        // 同时触发新写入的"安静房间"里,这会导致永久卡死(banner冻结在"等待XX行动…"),
        // 和左慈/化身机制无关,原生武将(如貂蝉)同样会卡死,是这四个技能共享的架构缺陷。
        // 修法和上面 botMissedSchedule 同一个入口、同一次 try/catch 写法,不新增机制:
        // 只要刚才这轮调度落地后 botTwoStepA 还挂着(说明停在一个本地-only的中间阶段),
        // 就主动补一次 scheduleBotTurn,让下一轮调度能命中 botTwoStepA 已设置的分支、
        // 走完剩余阶段。丈八蛇矛有两个中间阶段(A→B、B→C)不需要特殊处理——A→B、B→C
        // 各自结束都会经过这同一个 finally,各自触发各自的下一次重查,不需要为它单独
        // 计数。用 else if(不是独立 if)避免和上面 botMissedSchedule 同帧重复调用两次
        // scheduleBotTurn(两个分支最终都是"拿最新状态重新走一遍完整判断"，命中一次就够,
        // scheduleBotTurn 自己的 debounce/key 匹配即使被调多次也不会真的排出重复定时器,
        // 这里用 else if 只是避免同一帧内的冗余调用,不是必需的正确性保护)。
        try{ scheduleBotTurn(typeof currentG!=='undefined'?currentG:null); }
        catch(e){ console.warn('bot two-step self-trigger recheck',e); }
      }
    }
  },650+Math.floor(Math.random()*500));
}
function botInvoke(seat,fn){
  const humanSeat=mySeat;
  mySeat=seat;
  try{ fn(); } finally { mySeat=humanSeat; }
}
function botKnownRole(g,viewerSeat,targetSeat){
  const target=g.players[targetSeat];
  if(!target) return null;
  if(targetSeat===viewerSeat || target.role==='zhu' || target.roleRevealed) return target.role;
  return null;
}
function botSuspicion(g,seat){
  return Number((g.aiRebelSuspicion||{})[seat]||0);
}
// 公开行动证据。正数=更像反贼，负数=更像忠臣；不按观察者分别保存，所有人看到的公开
// 行为相同。这里只记录真实造成的伤害，不把被迫响应【决斗】误算成主动敌意。
function recordBotDamageEvidence(g,sourceSeat,targetSeat,amount,srcType){
  if(g.gameMode!=='identity'||!Number.isInteger(sourceSeat)||amount<=0||srcType==='duel') return;
  const source=g.players[sourceSeat], target=g.players[targetSeat];
  if(!source||!target||source.roleRevealed) return;
  g.aiRebelSuspicion=g.aiRebelSuspicion||{};
  let delta=0;
  if(target.role==='zhu') delta=45*amount;
  else if(target.roleRevealed && target.role==='fan') delta=-28*amount;
  else if(target.roleRevealed && target.role==='zhong') delta=24*amount;
  if(delta) g.aiRebelSuspicion[sourceSeat]=Math.max(-100,Math.min(100,botSuspicion(g,sourceSeat)+delta));
  if(!Array.isArray(g.aiSuspicionEvents)) g.aiSuspicionEvents=[];
  g.aiSuspicionEvents.push({round:g.roundNum,source:sourceSeat,target:targetSeat,amount:amount,kind:'damage'});
  if(g.aiSuspicionEvents.length>20) g.aiSuspicionEvents=g.aiSuspicionEvents.slice(-20);
}
function recordBotRescueEvidence(g,rescuerSeat,dyingSeat){
  if(g.gameMode!=='identity'||!Number.isInteger(rescuerSeat)) return;
  const dying=g.players[dyingSeat], rescuer=g.players[rescuerSeat];
  if(!dying||!rescuer||rescuer.roleRevealed) return;
  g.aiRebelSuspicion=g.aiRebelSuspicion||{};
  let delta=0;
  if(dying.role==='zhu') delta=-50;
  else if(dying.roleRevealed&&dying.role==='fan') delta=25;
  if(delta) g.aiRebelSuspicion[rescuerSeat]=Math.max(-100,Math.min(100,botSuspicion(g,rescuerSeat)+delta));
  if(!Array.isArray(g.aiSuspicionEvents)) g.aiSuspicionEvents=[];
  g.aiSuspicionEvents.push({round:g.roundNum,source:rescuerSeat,target:dyingSeat,amount:1,kind:'rescue'});
  if(g.aiSuspicionEvents.length>20) g.aiSuspicionEvents=g.aiSuspicionEvents.slice(-20);
}
function botTargetScore(g,seat,targetSeat,kind){
  const me=g.players[seat], target=g.players[targetSeat];
  if(!me||!target||!target.alive||seat===targetSeat) return -Infinity;
  // 【组队模式修复】这个函数所有实际调用点传的kind('damage'/'steal'/或杀/决斗/火攻/
  // 铁索连环/顺手牵羊/过河拆桥这类action名)全部是有害/需要谨慎对待自己人的操作,没有
  // 任何一处走这里去"帮"目标——组队模式下同队目标一律当作不可选(-Infinity),不参与
  // 后面按身份局role分支打分。这个判断必须放在role分支之前:组队模式下p.role恒为null
  // (normalize()保证),不加这条会落进最后的兜底else分支,把队友当成和敌人一样的普通
  // 目标,只是加个随机数——这正是"机器人会打队友"的根因。sameTeam(data.js)是唯一的
  // 判队友入口,不在这里重复手写team比较。
  if(g.gameMode==='team' && sameTeam(g,seat,targetSeat)) return -Infinity;
  const known=botKnownRole(g,seat,targetSeat);
  const suspicion=botSuspicion(g,targetSeat);
  let score=(target.maxHp-target.hp)*8+(4-target.hp)*7+(target.hand||[]).length*2;
  if(g.gameMode==='team'){
    // 组队模式没有身份局那套role/suspicion语义,不生搬硬套——保留和乱斗模式一样的
    // 默认打分风格(优先打体力低/手牌多的敌方目标),只是多了"排除同队"这一步(已在上面
    // 处理)。kind==='steal'的额外加成在函数末尾统一处理,这里不用重复。
    score+=Math.random()*10;
  } else if(me.role==='zhong'){
    if(known==='zhu'||known==='zhong') return -Infinity;
    if(known==='fan') score+=180;
    else if(known==='nei') score+=55;
    else if(suspicion<35) return -Infinity; // 忠臣宁可不出牌，也不盲杀身份不明者
    else score+=suspicion*2;
  } else if(me.role==='fan'){
    if(known==='fan') return -Infinity;
    if(known==='zhu') score+=240;
    else if(known==='zhong') score+=100;
    else score-=suspicion;
  } else if(me.role==='zhu'){
    if(known==='zhong') return -Infinity;
    if(known==='fan') score+=190;
    else if(suspicion<30) return -Infinity;
    else score+=suspicion*2;
  } else if(me.role==='nei'){
    if(known==='zhu'&&target.hp<=2) return -Infinity; // 前中期不让主公突然死亡
    const lord=getLordSeat(g), rebels=g.players.filter(p=>p&&p.alive&&p.roleRevealed&&p.role==='fan').length;
    if(known==='fan') score+=(rebels>0?45:0);
    if(targetSeat===lord) score-=60;
    score+=(target.hand||[]).length+target.hp;
  } else {
    score+=Math.random()*10;
  }
  if(kind==='steal') score+=(target.hand||[]).length*4;
  return score;
}
function botBestTarget(g,seat,card,actionId){
  const me=g.players[seat], spec=CARD_PLAYS[actionId];
  let best=-1,bestScore=-Infinity;
  g.players.forEach((p,i)=>{
    if(!p||!p.alive||i===seat) return;
    if(spec&&spec.canTarget&&!spec.canTarget(g,me,card,i)) return;
    const kind=(actionId==='顺手牵羊'||actionId==='过河拆桥')?'steal':'damage';
    const score=botTargetScore(g,seat,i,kind);
    if(score>bestScore){bestScore=score;best=i;}
  });
  return best;
}
// ================= BOT_SEAT_PICKS 无密钥兜底解锁(第一部分) =================
// 【本次改动】此前13个seatPick注册项的fallbackSeat几乎全是"return null"(改动前机器人
// 从不主动发动对应技能的历史遗留保守默认)——现在要把"无密钥也能用"这些技能落地,不能
// 简单改成"永远选第一个候选"了事,需要按技能收益方向给一个有意义的本地评分。这两个
// 共用helper复用既有的botTargetScore(botBestTarget同款口径),不新造评分体系:
// pickBestCandidateSeat 用于"进攻/负面效果"类技能(伤害/拆牌/拼点等,越是该打的目标
// 分越高);pickHealFallbackSeat 用于"扶持/治疗"类技能(血量越低越优先,且避开已知敌方)。
function pickBestCandidateSeat(g, seat, candidates, kind){
  if(!candidates || !candidates.length) return null;
  if(candidates.length===1) return candidates[0].seat;
  let best=candidates[0].seat, bestScore=-Infinity;
  candidates.forEach(function(c){
    // 自己作为候选(allowSelf场景,如桃园结义)时botTargetScore(seat===targetSeat)恒
    // 返回-Infinity,不能直接套用——给中性分0,不让"自己"因为公式副作用被系统性排除,
    // 但也不会在有其他真实目标时被优先选中。
    const s = (c.seat===seat) ? 0 : botTargetScore(g, seat, c.seat, kind);
    if(s>bestScore){ bestScore=s; best=c.seat; }
  });
  return best;
}
function pickHealFallbackSeat(g, seat, candidates){
  if(!candidates || !candidates.length) return null;
  const me = g.players[seat];
  let best=null, bestKey=Infinity;
  candidates.forEach(function(c){
    const p = g.players[c.seat];
    if(!p) return;
    const known = botKnownRole(g, seat, c.seat);
    // 身份局:明确的敌方角色加一个大惩罚,让"血量再低也不主动扶持敌人"这个基本判断优先于
    // 血量高低本身;非身份局/未知身份不受影响,纯按血量选。
    let enemyPenalty = 0;
    if(me && me.role && known){
      if((me.role==='zhu'||me.role==='zhong') && known==='fan') enemyPenalty = 1000;
      else if(me.role==='fan' && (known==='zhu'||known==='zhong')) enemyPenalty = 1000;
    }
    const key = enemyPenalty + p.hp;
    if(key < bestKey){ bestKey = key; best = c.seat; }
  });
  return best;
}
// 【Part2】天义/强袭/乱武/乱击/奋迅"要不要主动发动"的判断,收敛到这一个函数,在出牌阶段
// 的play分支里调一次。每种技能都先读过它在skills.js/game.js里的完整发动条件与后续流程
// (见对应的runBotDecision分支和CLAUDE.md防复发规则26"先探测服务端到底允不允许"),不是
// 只看hasCap就发动。返回true表示已经botInvoke了某个start*,调用方应立即return,让下一次
// 调度接管随之产生的新phase。
// 陈宫【明策】、法正【眩惑】刻意不在这里:两者对发动者自己都是"净收益不明确、纯粹把资源
// 让给别人"(明策交出一张牌/装备,眩惑净手牌数不变、只是转移他人的牌),和举荐/仁心同一
// 基调保守默认不主动发动;它们各自的后续选择分支(mingcePickCard等/防御性收录)仍然保留,
// 供其它触发路径复用,只是没有一个"主动点火"的入口。
function botTryStartExtraSkills(g, seat){
  const me=g.players[seat];
  if(!me || !me.alive) return false;
  // 贾诩【乱武】:令所有其他角色各自选择出杀或掉血,对发动者自己零代价零风险,固定发动
  // (和落英/洛神同一基调,只要求场上还有其他存活角色)。
  if(hasCap(me,'luanwu') && !g.luanwuUsed){
    if(g.players.some((p,i)=>i!==seat && p && p.alive)){ botInvoke(seat, startLuanwu); return true; }
  }
  // 太史慈【天义】:拼点赢获得本阶段【杀】次数/距离/目标数加成,拼点输本阶段不能用杀,
  // 大致五五开的赌注,赢面收益明显大于输面代价(多数回合根本用不完已有的杀次数上限)。
  // 要求留至少2张手牌(拼点牌+至少1张备用),避免为了赌一次拼点把手牌梭哈到只剩0张。
  if(hasCap(me,'tianyi') && !g.tianyiUsed){
    const hasTarget=g.players.some((p,i)=>i!==seat && p && p.alive && (p.hand||[]).length>0);
    if(hasTarget && (me.hand||[]).length>=2){ botInvoke(seat, startTianyi); return true; }
  }
  // 典韦【强袭】:花1点体力或弃置一张武器牌,对攻击范围内一名角色造成1点伤害——进攻性
  // 资源投入,和贯石斧/寒冰剑等装备特效同一基调固定发动,但先探测真的有攻击范围内的
  // 目标、且至少一种支付方式可行(呼应规则26,避免发动后在选支付方式阶段无路可走)。
  // 优先弃武器省体力,只有武器不可弃且体力>2(留有余量)才用体力支付。
  if(hasCap(me,'qiangxi') && !g.qiangxiUsed){
    const myRange=attackRange(g, seat);
    const hasTarget=g.players.some((p,i)=>i!==seat && p && p.alive && distance(g,seat,i)<=myRange);
    const canPay=hasWeaponToDiscard(me) || me.hp>2;
    if(hasTarget && canPay){ botInvoke(seat, startQiangxi); return true; }
  }
  // 袁绍【乱击】:花2张同花色手牌当万箭齐发使用(全场AOE,自己免疫)。只有存在≥2名其他
  // 存活角色时才划算(否则花2张牌只打1个人,不如直接出一张杀更省资源)。
  if(hasCap(me,'luanji')){
    const otherAlive=g.players.filter((p,i)=>i!==seat && p && p.alive).length;
    if(otherAlive>=2){
      const suitCount={};
      (me.hand||[]).forEach(c=>{ if(c) suitCount[c.suit]=(suitCount[c.suit]||0)+1; });
      if(Object.values(suitCount).some(n=>n>=2)){ botInvoke(seat, startLuanji); return true; }
    }
  }
  // 丁奉【奋迅】:弃1张牌,本回合与指定角色距离视为1。只有存在"当前用canReachSha够不着、
  // 发动后就够得着"的目标、且手里确实有能当杀用的牌时才值得发动——不能只看"手牌够不够"
  // (规则26),否则就是白弃1张牌换不到任何实际用途。要求留至少2张手牌(备用杀+被弃的牌)。
  if(hasCap(me,'fenxun') && !me.fenxunUsed){
    if(findUsableAs(me.hand||[],me,'杀')>=0 && (me.hand||[]).length>=2){
      if(g.players.some((p,i)=>i!==seat && p && p.alive && !canReachSha(g,seat,i))){
        botInvoke(seat, startFenxun); return true;
      }
    }
  }
  // 【C类修复,机器人技能覆盖审计】于吉【蛊惑】:扣置一张手牌、声明为别的牌。这次只接
  // "声明为【杀】"这一种最常见/最有价值的用法(蛊惑理论上能声明成CARD_PLAYS里几乎任何
  // 非装备/非延时锦囊的牌,全量枚举决策空间过大,不是这次范围)——risk评估:即使声明为假
  // 被质疑戳穿,finishGuhuo的false分支只是把这张牌弃掉、不产生效果,和"直接弃这张没用的
  // 牌"完全同一代价,没有比正常弃牌更差的下场;质疑者猜对了也只是让这次蛊惑失效,不会
  // 反过来伤到发动者自己。所以这是一个"没有明显下行风险"的技能,固定尝试发动:找手牌里
  // 第一张能合法声明为【杀】(canPlay通过+guhuoHasLegalTarget确实有目标)的牌,不筛选
  // "这张牌是不是本来就有用"(蛊惑本身就是拿一张牌换一次杀的机会,不需要额外判断"值不值")。
  // 目标选择本身在后续guhuoTarget阶段(已经通过BOT_SEAT_PICKS.guhuoTarget接线),这里
  // 不需要关心。响应侧的guhuoQuestion(质疑与否)同样早就接线过(BOT_DECISIONS.
  // guhuoQuestion),这次不重复实现。
  if(hasCap(me,'guhuo') && !g.guhuoUsed){
    const spec=CARD_PLAYS[guhuoActionId('杀')];
    if(spec){
      const hand=me.hand||[];
      for(let i=0;i<hand.length;i++){
        const actual=hand[i];
        if(!actual) continue;
        const claimed={ id:actual.id, name:'杀', suit:actual.suit, rank:actual.rank, originalName:actual.name };
        if(spec.canPlay && !spec.canPlay(g, me, claimed)) continue;
        if(!guhuoHasLegalTarget(g, seat, claimed, spec)) continue;
        botInvoke(seat, ()=>startGuhuo(i, '杀'));
        return true;
      }
    }
  }
  return false;
}
function botActionId(card){ return isShaName(card.name)?'杀':card.name; }
function botCardPriority(name){
  if(name==='桃') return 100;
  if(name==='无中生有') return 92;
  if(EQUIPS[name]) return 82;
  if(name==='顺手牵羊'||name==='过河拆桥') return 74;
  if(name==='乐不思蜀'||name==='兵粮寸断') return 70;
  if(isShaName(name)) return 66;
  if(name==='决斗'||name==='火攻') return 62;
  if(name==='桃园结义') return 58;
  if(name==='五谷丰登') return 48;
  if(name==='酒') return 40;
  return 20;
}

// ================= AI机器人接入第二阶段起:botPlay(出什么牌)+ botBestTarget(选目标) =================
// 【范围声明】第二阶段先在 botPlay(出什么牌)这一个决策点上验证完整链路(AI调用→合法性
// 校验→超时/失败兜底→回退本地逻辑)稳固可靠;第三阶段(见下方"AI机器人接入第三阶段"
// 那段)在此基础上扩展到 botBestTarget(选目标)。四阶段方案里规划的三个决策点(第四阶段
// 是可选的更广范围扩展,不在此列)至此全部接入完毕。ai-bot.js 的 callAI/PROVIDER_ADAPTERS
// 等基础设施两个阶段都确认不需要改动,直接复用第一阶段已完成的成果。

// showAiThinkingIndicator/hideAiThinkingIndicator:index.html 里新增的 #aiThinkingIndicator
// 是一个独立于 #controls/#banner 的常驻占位元素(挂在 .panel.table 内,#banner 之后、
// #controls 之前),不会被 renderControls() 每次调用时的 c.innerHTML='' 清空覆盖——
// AI 调用发生在客户端本地的一次异步等待期间,不是由某次 render(g) 触发,不能指望常规
// 渲染周期去托管这个提示的显隐,只能在调用前后手动切换。只有 isBotController(g) 为真
// 的这一个客户端会真正执行到 botPlay/tryAiBotPlay(scheduleBotTurn 的既有门槛已经保证
// 了这一点,不需要额外判断),所以"仅在机器人控制者这一端显示"是这套调度结构天然带来的
// 效果,不用专门加判断。纯提示、不拦截点击(CSS pointer-events:none,和 .my-turn-banner
// 同一约定),不会挡住玩家同时进行的其它操作。
function showAiThinkingIndicator(g, seat){
  const el = document.getElementById('aiThinkingIndicator');
  if(!el) return;
  const name = (g.players[seat] && g.players[seat].name) || ('机器人'+(seat+1));
  el.textContent = '🤖 '+name+' 正在思考…';
  el.classList.remove('hidden');
}
function hideAiThinkingIndicator(){
  const el = document.getElementById('aiThinkingIndicator');
  if(el) el.classList.add('hidden');
}

// botCardBrief/botPublicEquipsView/botPublicDelaysView/buildBotVisibleState:
// 【隐藏信息保护,务必遵守】给 AI 的 game state 必须是"这个机器人视角下真实合法可见的信息"
// 投影——是从头只塞进这个座位真实能看到的字段,不是先把整个 g 塞给AI事后再过滤(那种
// 写法容易在新增字段时漏过滤,这里从设计上就不给 AI 任何超出范围的原始对象引用)。
// 装备区(equips)和判定区(delays)在这个项目里本来就是公开信息(见 CLAUDE.md「装备
// 系统」「延时锦囊」两节的既有规则),对所有玩家一视同仁完整展示;身份复用既有的
// botKnownRole(和 UI 渲染座位卡身份标识用的 canSeeRole 同一套规则:自己、主公、
// 已翻开的角色才可见,其余一律 null),不新发明一套可见性判断。不该出现的东西——
// 其他角色的真实手牌内容(只给张数 handCount,不给 name/suit/rank)、未翻开角色的
// 真实身份(botKnownRole 返回 null 就是 null,不回退成"猜测值")——从这个函数的结构上
// 就不可能被塞进去,不是靠事后删字段做到的。
function botCardBrief(c){ return c ? { name:c.name, suit:c.suit, rank:c.rank } : null; }
// botCardBriefMin:手牌投影精简版(去 rank 点数)——花色保留(黑杀打仁王盾/红桃无懈等
// 决策需要),点数对 AI 决策价值低(判定/拼点无需精确规划)却是 token 大头;判定牌/候选
// 牌等仍需 rank 的地方继续用 botCardBrief。token 优化,2026-08。
function botCardBriefMin(c){ return c ? { name:c.name, suit:c.suit } : null; }
function botPublicEquipsView(p){
  const out={};
  (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : []).forEach(slot=>{
    const c = p.equips && p.equips[slot];
    out[slot] = c ? c.name : null;
  });
  return out;
}
function botPublicDelaysView(p){ return (p.delays||[]).map(c=>c.name); }

// botSuspicionHint:身份局AI选目标/出牌决策的第一层(信息层)——把本地既有的
// aiRebelSuspicion嫌疑值机制(botSuspicion,详见其定义处的注释)转成AI能读的分档
// 描述性文本,不给裸数值。【不是新的隐藏信息接口,是把机器人已有的公开信息读能力
// 补给AI】——recordBotDamageEvidence/recordBotRescueEvidence(game.js里dealDamage/
// 救援响应路径调用)的每一条delta判断分支,输入全部是结构性公开信息:"谁对谁造成了
// 伤害"(dealDamage本身会产生公开日志)、"目标是不是主公"(身份局里主公从开局起就是
// 明牌)、"目标身份是否已翻开"(roleRevealed,和UI的canSeeRole同一套公开性规则)——
// 没有一个分支读取任何只有机器人内部才知道的私有状态。所以aiRebelSuspicion是纯粹
// 由公开事件推导出的聚合值,任何真人玩家盯着日志心算理论上能算出同一个数,这和
// buildBotVisibleState"结构上只投影真实可见信息"的既有安全原则完全兼容,不是新开
// 的口子。裸数值不给的原因:-100~100是内部实现刻度(45/24/-28/-50/25这几个和阈值
// 绑定的魔数),AI拿到一个孤立的数字不知道怎么校准,分档文本更符合"引导性描述、非
// 机械阈值判断"这条既有措辞原则。阈值30/60按现有delta量级校准:单次典型事件
// (24~50)落进"一定"档,两次以上复合(48~100+)落进"较强"档,不是拍脑袋定的。
// 只描述方向+强度,不编造具体事件次数/细节——机制本身只有累加后的最终值,没有保留
// 离散事件记录,编造"三次攻击"这类具体次数是虚构信息,不诚实。
// 返回 undefined(不是 null)是刻意的:JSON.stringify 会跳过值为 undefined 的键,
// 非身份局/证据不足时这个字段在发给AI的prompt里完全不出现,不占篇幅、不用"无证据"
// 这类空话填充每一条候选。
function botSuspicionHint(g, targetSeat){
  if(!g || g.gameMode!=='identity') return undefined;
  const s = botSuspicion(g, targetSeat);
  if(s>=60) return '公开行为显示出较强的反贼嫌疑';
  if(s>=30) return '公开行为显示出一定的反贼嫌疑';
  if(s<=-60) return '公开行为显示出较强的偏向忠于主公一方的倾向,反贼嫌疑很低';
  if(s<=-30) return '公开行为显示出一定的偏向忠于主公一方的倾向,反贼嫌疑较低';
  return undefined;
}
// isFirstTurn 参数保留仅为向后兼容(历史调用方可能传第三参),本函数不再依赖它:
// 武将技能/描述是公开信息(座位卡上人人可见),任何回合都该提供给 AI。
function buildBotVisibleState(g, seat, isFirstTurn=false){
  const me = g.players[seat];
  
  // 计算下一个玩家（用于AI判断行动顺序）
  const calculateNextPlayer = () => {
    if (typeof nextAlive === 'function') {
      return nextAlive(g, g.turn || 0);
    }
    // 兜底实现：如果nextAlive不可用，使用简单的下一个存活玩家逻辑
    const n = g.players.length;
    for(let k = 1; k <= n; k++){
      const s = (g.turn + k) % n;
      if(g.players[s] && g.players[s].alive) return s;
    }
    return g.turn || 0;
  };
  
  return {
    seat,
    gameMode: g.gameMode || 'ffa',
    myTeam: Number.isInteger(me.team) ? me.team : null,
    round: g.roundNum || 1,
    recentSuspicionEvents: (g.aiSuspicionEvents||[]).slice(-10).map(e=>({
      round:e.round, source:e.source, target:e.target, amount:e.amount, kind:e.kind
    })),
    phase: g.phase || '', // 当前游戏阶段
    nextPlayer: calculateNextPlayer(), // 下一个行动的玩家座位
    // 自己的手牌/身份完全可见——这是这个座位本来就该看到的东西,不是特权。
    myRole: me.role || null,
    myHp: me.hp, myMaxHp: me.maxHp,
    myHand: (me.hand||[]).map(botCardBriefMin),
    myEquips: botPublicEquipsView(me),
    myDelays: botPublicDelaysView(me),
    players: (g.players||[]).map((p,i)=>{
      if(!p) return null;
      const knownRole = botKnownRole(g, seat, i);
      return {
        seat: i, name: p.name, isSelf: i===seat, alive: p.alive,
        hp: p.hp, maxHp: p.maxHp,
        handCount: (p.hand||[]).length, // 只给张数,不给内容
        equips: botPublicEquipsView(p), delays: botPublicDelaysView(p),
        knownRole: knownRole, // 复用既有的安全揭示逻辑,不知道就是 null
        deadRole: !p.alive && g.gameMode==='identity' ? knownRole : undefined, // 已死玩家的身份
        team: Number.isInteger(p.team) ? p.team : null, // 队伍公开信息(组队模式);非team恒null
        general: p.general || null, // 武将本身是公开信息(座位卡对所有人可见),不是隐藏信息
        generalSkill: p.general && GENERALS && GENERALS[p.general] ? String(GENERALS[p.general].skill||'') : undefined, // 武将技能常开(公开信息)
        generalDesc: (p.general && typeof GENERALS!=='undefined' && GENERALS[p.general]) ? String(GENERALS[p.general].desc||'').slice(0, i===seat ? 9999 : 60) : undefined, // 武将描述常开;自己全量,他人截断60字(token优化)
        distance: i !== seat ? distance(g, seat, i) : 0, // 与自己的距离
        suspicionHint: botSuspicionHint(g, i), // 身份局限定,undefined 时 JSON 里不出现这个键
        // 特殊状态信息
        status: {
          faceup: typeof p.faceup === 'boolean' ? p.faceup : true, // 翻面状态（true=正面，false=背面）
          chained: p.chained === true, // 连环状态
          turnedOver: p.turnedOver === true, // 翻面状态（历史遗留字段，与faceup功能相同）
        },
      };
    }),
    // 最近日志:公开信息,取最近15条;log 项是 {seq,text} 对象,取 text 字段
    // 【降噪,2026-08】全量事件里"轮到X/摸了N张牌/弃置了N张牌/加入房间"等例行事件对 AI
    // 决策零价值(手牌数/轮次从局面就能看到),却占一半以上 token;改为过滤例行事件后
    // 只保留最近 6 条关键事件(使用/打出/装备/伤害/阵亡/濒死/判定/无懈等),信息密度
    // 提升、token 减半。同窗多步连贯由 runBotActionWindow 的 lastActions 意图链承担,
    // 跨回合记忆由 aiSummary(原料同样是这份降噪后日志,质量反而更高)承担。
    recentLog: buildBotKeyEvents(g),
    // 自身回合内标志:只投影自己的(shaUsed 全局、jiangchiNoSlash 每人一份),不含他人私有状态
    myFlags: { shaUsed: !!g.shaUsed, jiangchiNoSlash: !!(me.jiangchiNoSlash) },
    // 牌堆剩余张数:公开信息(牌堆背面可见,张数人人知道)
    deckLeft: (g.deck||[]).length,
    // 自己的攻击射程:读武器槽 range(无武器默认 1),公开信息(装备区人人可见)
    myAttackRange: attackRange(g, seat),
  };
}

// buildBotKeyEvents:recentLog 降噪提取——过滤"轮到X/摸了N张牌/弃置了N张牌/加入房间/
// 房间已创建/已添加机器人/游戏开始"等例行事件(手牌数/轮次可从局面推断,零决策价值),
// 只保留最近 6 条关键事件。注意:过河拆桥/顺手牵羊拆掉具体装备的日志格式是
// "X 弃置了 Y 的武器【…】"之类,不匹配"弃置了N张牌$"规则,不会被误滤。
function buildBotKeyEvents(g){
  return (g.log||[]).filter(function(e){
    const t = (e && typeof e==='object') ? (e.text||'') : String(e==null?'':e);
    if(!t) return false;
    if(/^轮到 /.test(t)) return false;                 // 轮到 X
    if(/摸了\d+张牌$/.test(t)) return false;            // X 摸了N张牌
    if(/弃置了\d+张牌$/.test(t)) return false;          // X 弃置了N张牌(例行弃牌阶段)
    if(/加入了房间/.test(t)) return false;              // X 加入了房间（座位N）
    if(/房间已创建/.test(t)) return false;
    if(/已添加机器人/.test(t)) return false;
    if(/^游戏开始/.test(t)) return false;
    return true;
  }).slice(-6).map(e => (e && typeof e==='object') ? e.text : String(e==null?'':e));
}

// buildBotPlayCandidates:AI能选的候选动作列表,直接由已经跑过 CARD_PLAYS 真实
// canPlay/canTarget 校验的 options 数组(botPlay 里现有的合法性枚举逻辑,完全不变)
// 转成给AI看的可读描述,index 和 options 数组下标一一对应;最后追加一项固定的
// "结束出牌阶段"(index===options.length)。AI 只能从这份列表里选一个 index,这就是
// 硬性合法性校验的入口——列表之外根本不存在其它选项可选。
function botPlayCandidateEntry(g, opt, index){
  const targetInfo = (opt.target!=null && g.players[opt.target])
    ? { seat: opt.target, name: g.players[opt.target].name }
    : null;
  // card:候选对应的物理牌牌面(botCardBrief 只给 name/suit/rank),供AI直接看这张牌
  // 具体是什么;handIndex 是对应手牌数组下标,AI 无法凭空发明牌,只能在这份列表里选。
  // botPlay 保证 g.turn===seat(出牌阶段),读 g.players[g.turn] 和读 seat 等价。
  const hand = (g.players[g.turn] && g.players[g.turn].hand) || [];
  const card = (opt.idx!=null && hand[opt.idx]) ? botCardBrief(hand[opt.idx]) : null;
  const parts = ['出【'+opt.action+'】'];
  if(card && card.name!==opt.action) parts.push('实际牌【'+card.name+'】');
  if(targetInfo) parts.push('目标:'+targetInfo.name);
  // 不拼"本地分N":localHeuristicScore 字段已单独给出,label 重复拼浪费 token(token优化)
  return {
    index, action: opt.action, target: targetInfo, localHeuristicScore: Math.round(opt.value),
    label: parts.join(' '), card, handIndex: (opt.idx!=null ? opt.idx : null)
  };
}
function buildBotPlayCandidates(g, options){
  const list = options.map((o,i)=>botPlayCandidateEntry(g, o, i));
  list.push({ index: options.length, action: '结束出牌阶段', target: null, localHeuristicScore: null,
    label: '结束出牌阶段', card: null, handIndex: null });
  return list;
}

// BOT_STRATEGY_GUIDANCE_PLAY:第一阶段"通用部分"策略指导(不区分是否身份局,详见
// CLAUDE.md"AI机器人策略指导"记录)。这是判断优先级的引导性文字,不是"若A则必须B"式的
// 硬规则——刻意不写死具体阈值/条件,避免把AI变成一个更贵的本地启发式复制品。三个来源:
// ①价值取舍格言"多干损人利己的事,慎干损己利人的事"+1血≈2手牌粗略汇率(physixfan.com
// 三国杀价值理论长文);②"不要为了试探不明身份的人无谓消耗"+"不要把手牌耗尽去互殴"
// (忠臣/反贼过度消耗都会让内奸坐收渔利,这是四阵营研究里反复出现的同一枚硬币两面,
// gaoshouyou.com新手误区清单同样点名);③"五谷/无懈不要随手挥霍"直接引用自
// gaoshouyou.com原文"五谷不要乱开,开了死得快。无懈不要随意乱用,暴殄天物终将要还的"。
// ④酒→杀顺序(真实bug复现后补的具体规则提醒,和上面三条"软性价值判断"不同,这是一条
// 硬机制事实——酒的伤害加成只对"本回合下一张杀"生效,顺序反了加成必然浪费,不存在
// "看情况"的判断空间。局面数据里的localHeuristicScore已经在候选层面做了对应修正
// (enumerateAllLegalOneStepActions,同一酒→杀场景把酒的分数拉到杀之上),这里额外
// 明说规则本身,双重保险——分数只是参考、AI仍可能选别的候选,但至少不会因为"不知道
// 这条规则"而选错顺序。写法上和BOT_STRATEGY_GUIDANCE_TARGET的"黑杀对仁王盾无效"提醒
// 同一先例:即使是硬事实,也放进同一份"决策参考"里,不单独开一段硬规则列表。
const BOT_STRATEGY_GUIDANCE_PLAY =
  '决策时可参考这些经验(是判断优先级的参考,不是必须遵守的硬规则):'
  +'总体上,多做"损人利己"的事,谨慎做"损己利人"的事——粗略换算,1点体力大致相当于2张'
  +'手牌的价值,可以据此判断值不值得为了某次效果搭上手牌或体力。几个容易踩的坑:不要为'
  +'了试探身份不明的角色而无谓消耗自己的资源;不要把手牌耗到几乎不剩就去和别人正面'
  +'互殴,那样往往是在替别人火中取栗;五谷丰登、无懈可击这类关键锦囊不要随手挥霍,该省'
  +'的时候要省。另外一条是具体的游戏机制,不是软性判断:【酒】的效果是"本回合下一张'
  +'【杀】造成的伤害+1",这个加成必须先使用【酒】、再使用【杀】才会生效——如果先出杀'
  +'再喝酒,杀已经结算完了,酒的加成会白白浪费,没有例外。如果候选列表里本回合同时有'
  +'酒和杀可以出,应该先选酒。';

// BOT_IDENTITY_GUIDANCE:第二阶段——身份局四阵营战术基调(详见 CLAUDE.md"AI机器人策略
// 指导第二阶段"记录)。只在 g.gameMode==='identity' 且这个座位的 role 有值时才启用,
// 复用 buildBotVisibleState 已经在读的 me.role 字段,不新增读取路径;普通局(ffa)完全
// 不受影响。四段内容都是"当前阶段大致该往哪个方向想"的引导,刻意不写成if-then硬规则——
// 尤其内奸那条(三阶段模型)是调研里最具体、也最容易被写歪成机械规则的一条,已按调研阶段
// 的提醒把它写成"局势提示→倾向"这种叙述式引导,不是条件判断语句。四条内容和第一阶段
// 通用指导共用同一句"是判断优先级的参考,不是必须遵守的硬规则"这条纪律声明。
// 来源(调研阶段已查证,详见方案设计对话记录):反贼集火节奏("本回合若能对主公形成两次
// 以上有效攻击应主动出手")+反贼不与忠臣内耗;忠臣"局势不明时宁可暂时被误伤也不要过早
// 暴露"+不把手牌耗尽单挑反贼(这两条和反贼的"不与忠臣内耗"是同一枚硬币的两面);内奸
// 三阶段模型(前期配合主公清理反贼但避免抢头功暴露自己→中期反贼减员后伺机针对忠臣→
// 终局三方对峙阶段绝不主动碰主公、必须先解决忠臣);主公优先血厚/防御倾向+生存优先于
// 输出+早期低调靠观察集火/护主反推身份。
//
// 【判断力层,身份推断线索接入步骤②】四段各追加一句"该怎么用 suspicionHint"——步骤①
// (信息层)已经把 buildBotVisibleState 的 players[].suspicionHint 字段接进两个决策
// 点的 prompt 了,但光有字段不等于AI会用好它,需要明说"这是什么、该怎么参考"。延续
// 既有措辞原则(引导性描述,不是"score>N就必须怎样"这种机械阈值判断)。zhu(主公)那句
// 是唯一的例外——不是新增一句,是修正:原文"可以通过观察谁在集火你、谁在护着你来反推
// 场上身份"这句话此前完全是空转的(AI没有任何字段能真的做这件事),现在 suspicionHint
// 就是这件事的现成答案,原句改写成直接点出这一点、让这句话真正落地,而不是另起一句。
const BOT_IDENTITY_GUIDANCE = {
  fan: '若本回合能对主公形成两次以上有效攻击,通常应该主动出手;避免和忠臣正面消耗,'
    +'那样容易让内奸坐收渔利。候选目标信息里如果带有嫌疑提示(suspicionHint),同样'
    +'值得参考——嫌疑很低的目标往往行为上更偏向保护主公一方,可能更值得优先处理;'
    +'这份线索是场上公开行为算出来的,理论上任何人都能观察到。',
  zhong: '核心任务是辅助并保护主公。局势不明时,宁可暂时被误伤,也不要过早暴露身份——'
    +'过早暴露容易成为反贼的首要目标,反而丧失后续保护主公的能力;也不要把手牌耗尽去'
    +'单挑反贼,那同样是在替内奸创造机会。候选目标信息里如果带有嫌疑提示'
    +'(suspicionHint),那是基于场上公开行为(比如是否打过主公、是否救过疑似反贼)'
    +'算出来的参考,不是凭空猜测——嫌疑越明显的目标,越值得优先怀疑、考虑针对性行动。',
  nei: '判断当前大致该往哪个方向想:场上还有较多反贼时,倾向于配合主公清理反贼,同时'
    +'避免抢头功、暴露自己;反贼所剩不多时,可以考虑找机会针对忠臣;若局面已经收缩到'
    +'只剩你、主公、忠臣三方,这个阶段不要主动招惹主公,优先设法解决忠臣,再考虑后续。'
    +'候选目标的嫌疑提示(suspicionHint)同样有用,帮助判断谁更可能是反贼、谁更可能是'
    +'忠臣,配合上面的阶段判断使用。',
  zhu: '生存优先于输出,倾向保留桃、杀等防身手段,不要轻易消耗殆尽;早期适度低调;'
    +'候选目标信息里的嫌疑提示(suspicionHint)就是"谁在集火你、谁在护着你"这类公开'
    +'行为的汇总,可以直接参考来反推场上身份,不用凭空猜测。',
};
const BOT_IDENTITY_ROLE_LABEL = { zhu:'主公', zhong:'忠臣', fan:'反贼', nei:'内奸' };
function botIdentityGuidance(g, seat){
  if(!g || g.gameMode!=='identity') return '';
  const me = g.players && g.players[seat];
  const role = me && me.role;
  const content = role && BOT_IDENTITY_GUIDANCE[role];
  if(!content) return '';
  return '这局是身份局,你当前的身份是'+BOT_IDENTITY_ROLE_LABEL[role]+':'+content;
}

// 【提示词增强 G2 统一拼接】响应类注册项的 buildSystemPrompt 都要带身份引导
// (botIdentityGuidance 对 ffa/无 role 返回空串,不影响原文)——统一走这个 helper,
// 避免逐处复制拼接逻辑。调用方统一传 (g, seat),无参调用(如早期测试直接调
// buildSystemPrompt())时 g 为 undefined,由 botIdentityGuidance 的 !g 守卫安全放行。
function botPromptWithIdentity(base, g, seat){
  return base + botIdentityGuidance(g, seat);
}

function buildBotPlaySystemPrompt(g, seat){
  return '你在扮演一款网页版三国杀里的AI机器人玩家,当前轮到你的出牌阶段。你会收到:'
  +'①你视角下真实合法可见的局面(自己的手牌与身份完全可见;其他角色只有公开信息——'
  +'血量、装备、判定区、已知身份,手牌只知道张数、不知道具体是什么牌);'
  +'②一份已经按游戏规则筛选好的合法候选动作列表(localHeuristicScore是一个简单的'
  +'启发式参考分,仅供参考、不代表最优解),列表最后一项固定是"结束出牌阶段"。'
  +'你的任务只有一件事:从候选列表里选出一个index,代表这次要执行的动作——'
  +'不能选择列表之外的动作,不能凭空发明新选项,不需要也不能指定目标(目标已经在候选'
  +'列表里算好了)。'+BOT_STRATEGY_GUIDANCE_PLAY+botIdentityGuidance(g, seat)
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},'
  +'不要输出任何解释文字、代码块标记或多余字段。';
}

function buildBotPlayUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选动作列表(index从0开始):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// ================= L1:controlsChoice(镜像真实 controls 按钮,Task B3) =================
// 【本决策点是什么】把"响应阶段由 renderControls 渲染出的一组按钮"整体镜像成候选列表:
// AI 从按钮里选、无密钥时本地回退按"和改动前硬编码分支完全一致"的顺序点按钮。与
// botSafePrompt 的关系:同一个 DOM 隔离模式(真实 #controls 临时改名 → 隐藏 box 渲染 →
// 收集按钮),区别是 ①收集所有 button:not(:disabled)(不筛安全正则);②box 在收集后
// 【保留】到 execute 点击完才销毁——botSafePrompt 的收集+点击在同一次同步调用里完成,
// L1 的 AI 等待期间 box 必须还活着、click 才有对象可点,所以销毁(defer)交给 execute,
// 不在 collect;③回退选择顺序与 botSafePrompt 相同(先 safe 正则、再 mandatory 正则、
// 最后第一项)。
// 【allowlist 判定,不可随意扩表】只有"旧本地分支的动作 == 按回退顺序点出来的按钮动作"
// 的阶段才允许迁移,否则无密钥行为会悄悄改变(回归红线,见 CLAUDE.md 无密钥回归原则)。
// 逐个读了 render-controls.js 对应分支核对:
//  wuxie      (2840行):按钮[打出【无懈可击】(手里无牌时 disabled), 不出];旧分支
//             respondWuxie(false);safe 正则第一命中"不出" → 等价。✓
//  luoyingAsk (847行) :按钮[获得, 不获得];旧分支 respondLuoying(true);"不获得"不命中
//             safe 正则、"获得/不获得"都不命中 mandatory 正则 → 回退 candidates[0]="获得"
//             → 等价。✓
//  luoshen    (2632行):按钮[发动【洛神】判定, 不再发动];旧分支 respondLuoshen(true);
//             "不再发动"不含"不发动"子串、两个按钮都含"发动"被 mandatory 排除 →
//             回退 candidates[0]="发动【洛神】判定" → 等价。✓
//  铁骑/烈弓刻意不迁移:按钮是[发动X, 不发动],safe 正则第一命中"不发动",而旧分支是
//  respondTieqi(true)/respondLiegong(true),回退会变行为 → 违反无密钥回归红线。
// 【L1 泛化(Task G2)】allowlist 之外的所有阶段不再逐阶段等价性论证:有密钥(aiReady)时
// L1 直接接管镜像按钮(有密钥=AI 决策,行为由 AI 负责);无密钥时 match 返回 false,继续走
// runBotDecision 既有分支/botSafePrompt,与改动前逐字一致。EXCLUDE 集合收录"已有专用注册
// 或专用逻辑"的阶段,防 L1 双重接管。
const CONTROLS_CHOICE_ALLOWLIST = new Set(['wuxie','luoyingAsk','luoshen']);
// 【L1 泛化】已有专用注册/专用逻辑的阶段,L1 不接管(防止双重接管/绕过专用候选的
// 隐藏信息处理)。维护纪律:新增专用注册时,把该 phase 同步加进这个集合。
// 除既定清单外,额外收录 guhuoTarget/xuanfengPick/quhuDamageChoice 三个 seatPick 专用
// 阶段(接线在 controlsChoice 之后,xuanfengPick/quhuDamageChoice 会渲染 #controls 按钮,
// 不排除会被 L1 抢先接管;guhuoTarget 不渲染按钮、纯防御性收录)。
// 【A1 移除】xiaoguo 已有专用注册(BOT_DECISIONS.xiaoguo)+接线在 controlsChoice 之前,
// 留在 EXCLUDE 会让 L1 永远够不到、专用注册白做;xiaoguoChoice 按钮纯由 pending 渲染
// (弃置X【装备】/受到1点伤害,单步可提交 respondXiaoguoChoice),改由 L1(有密钥)接管。
const CONTROLS_CHOICE_EXCLUDE = new Set([
  'wugu','pick','guicai','ganglieChoice','guhuoQuestion','qiaobianMove',
  'enyuanChooseOption','enyuanChoose','enyuanGiveCard','jiedaoChoice',
  'duanbingChoose','huogong','huogongReveal','fanjianSuit','quhuRespond',
  'tianyiRespond','zhijiChoice',
  'huashenChangeAskStart','huashenChangeAskEnd','tieqi','liegong',
  'qilin','hanbing','mengjin','shaOffsetChoice',
  'guhuoTarget','xuanfengPick','quhuDamageChoice',
  // 【G4】遗计分配有专用注册(BOT_DECISIONS.yijiAssign,跨调度累积),且 render-controls.js
  // 1977行 会给每张牌渲染"给 自己/给 玩家X"按钮——不排除会被 L1 抢先接管,必须收录。
  'yijiAssign',
  // 【G5】礼让发动有专用注册(BOT_DECISIONS.lirangAsk),且 render-controls.js 2129行
  // 会给"发动【礼让】/不发动"按钮(发动按钮还依赖客户端 lirangPicks 模式状态)——不排除
  // 会被 L1 抢先接管(有密钥时 L1 会镜像到"不发动"并点击,绕开专用候选),必须收录。
  'lirangAsk',
  // 【B2a】主公技求助有专用注册(BOT_DECISIONS.jijiangAsk/hujiaAsk,接线在 controlsChoice
  // 之前),且 render-controls.js 会给"替主公打出【X】/不出"按钮——不排除会被 L1 抢先
  // 接管(有密钥时 L1 会镜像按钮并点击,绕开专用候选),必须收录。
  'jijiangAsk','hujiaAsk',
  // 【B2b】制霸拼点有专用注册(BOT_DECISIONS.zhibaAsk,接线在 controlsChoice 之前),且
  // render-controls.js 会给"拼点【X】"按钮——不排除会被 L1 抢先接管,必须收录。
  'zhibaAsk',
  // 【调度盲区收尾】蔡文姬【悲歌】三段有专用注册/分支(BOT_DECISIONS.beigeChoose +
  // beigeDiscard/beigeJudge 的确定性分支,接线在 controlsChoice 之前),且
  // render-controls.js 会渲染真实按钮("发动"/"不发动"、逐张选牌、"进行判定")——
  // 不排除会被 L1 抢先接管:L1 按钮扫描顺序(DOM渲染顺序)和 BOT_DECISIONS.beigeChoose
  // 自己的候选顺序(不发动=index0/发动=index1)刚好相反，真实踩过这个坑——L1 抢先接管后
  // AI 选的 index 会按 L1 自己的按钮顺序执行，和专用注册的语义错位，表现为"AI明明选了
  // '发动'却执行成了'不发动'"，必须收录排除,让专用分支先接管。
  'beigeChoose','beigeDiscard','beigeJudge',
  // 【调度盲区收尾】贾诩【乱武】有专用注册(BOT_DECISIONS.luanwuChoice,接线在
  // controlsChoice 之前),且 render-controls.js 会渲染"对X使用【杀】"/"失去1点体力"
  // 真实按钮——同上，不排除会被 L1 抢先接管、候选顺序错位,必须收录。
  'luanwuChoose',
  // 【系统性扫描发现的紧急盲区】祝融【烈刃】拼点响应/典韦【强袭】选目标都有专用的确定性
  // runBotDecision分支(接线在controlsChoice之前)，且各自渲染真实按钮("【牌名】♠5"/纯
  // 目标姓名)——不排除同样会被L1抢先接管；虽然这两个分支本身不走AI候选顺序（没有注册
  // BOT_DECISIONS，不存在候选顺序错位风险），但收录进来能让"无密钥固定选第一项"这套确定性
  // 兜底的行为不受AI密钥状态影响，保持这两个分支的可预期性，和其它专用分支收录同一原则。
  'lieRenRespond','qiangxiPickTarget','qiangxiChooseCost','qiangxiChooseWeaponFromHand',
  // 【第二批-第1组】徐庶【举荐】三段+曹仁【据守】都有专用的确定性runBotDecision分支
  // (接线在controlsChoice之前)，且各自渲染真实按钮——同上原则收录，保持确定性兜底不受
  // AI密钥状态影响。
  'jujianPickCard','jujianPickTarget','jujianChooseEffect','jushouChoose',
  // 【第二批-第2组】雌雄双股剑/贯石斧/寒冰剑/青龙偃月刀四个装备特效都有专用的确定性
  // runBotDecision分支(接线在controlsChoice之前)——同上原则收录。
  'cixiongAsk','cixiongChoice','guanshi','hanbingAsk','qinglong',
  // 【第二批-第3组】双雄+雷击都有专用的确定性runBotDecision分支(接线在controlsChoice
  // 之前)——同上原则收录。
  'shuangxiongAsk','leijiChoose','leijiJudge',
  // 【第二批-剩余清单批量处理】以下全部有专用的确定性runBotDecision分支(接线在
  // controlsChoice之前)——同上原则收录。
  'haoshiPick','tiaoxinDiscard','biyue','buquAsk','renxinChoose',
  'chengxiangAsk','luoyiAsk','jiemingAsk','xinshengAsk','yijiAsk',
  'ganglieAsk','guiduAsk','jiangchiAsk',
  'jiushiFlipAsk','lianyingAsk',
  'mingcePickCard','mingcePickTarget','mingcePickTarget2','mingceChoice',
  'qiaomengChoose','qiaomengPickEquip','wangxiAsk','yaowu_choose','shensuSha',
  'zhimengAsk','zhimengPick','huashenChangePickStart','huashenChangePickEnd',
  'luanjiChoose','luanjiConfirm',
  // 【B类修复,机器人技能覆盖审计】这批都有专属的确定性runBotDecision分支(接线在
  // controlsChoice之前)——同上原则收录,防L1抢先镜像按钮。
  // 【注意:xiaoguoChoice 不在这里】它是刻意保留在 EXCLUDE 之外的——有AI密钥时应该让
  // L1 controlsChoice 接管(镜像真实按钮,AI能对"弃哪件装备"做更聪明的判断),这次新增
  // 的确定性分支只是补"没有AI密钥时"的兜底,分支位置特意放在 L1 调用之后(见
  // runBotDecision 里对应注释),不能通过加进 EXCLUDE 来"保护"——那样会连有密钥时也
  // 抢在 L1 前面,破坏 T19/T20(run_ai_bus_l1_test.js)锁定的既有设计。
  'tiaoxinChoice',
  'huanhuoPick','huanhuoPickCard','huanhuoPickGotCard','huanhuoPickSecond',
]);
// collect 与 execute 之间跨 AI await 传递的 DOM 上下文(box 必须在点击后才销毁)
let controlsChoiceCtx = null;
// botClickInProgress:"当前这一次按钮点击是机器人发出的,不是真人点的"。
// 【为什么需要】renderControls 里有一批按钮的 onclick 是 confirmAndPlay(msg, fn) ——
// 它先弹一个确认框、等真人点"确定"才执行 fn。这套二次确认是给真人防误触用的,机器人
// 走 L1(collectControlsCandidates→click)或 botSafePrompt 时会把这类按钮一起点掉,
// 结果就是:确认框弹出来了(弹在担任机器人控制者的那名真人屏幕上),而机器人自己的
// 动作 fn 永远没执行 —— 机器人的决策被静默转交给了人类。
// 真实可达路径(已由 run_bot_domhost_probe_test.js 复现):wuxie 无懈询问阶段 +
// 于吉【蛊惑】。wuxie 在 CONTROLS_CHOICE_ALLOWLIST 里且不在 EXCLUDE 里,所以【即使
// 没有 AI 密钥】L1 也会接管它;而 addGuhuoResponseButtons 挂的按钮 onclick 正是
// confirmAndPlay。
// 【修法】不改 renderControls 的按钮定义(那 15 处 confirmAndPlay 对真人的行为必须
// 原样保留),只在"点击来自机器人"这一刻让 confirmAndPlay 跳过确认框直接执行 ——
// 由 confirmAndPlay(render.js) 读这个标志。置位范围严格限制在同步的 click() 那一瞬,
// finally 里无条件复位,不跨 await、不影响真人的任何一次点击。
let botClickInProgress = false;

function collectControlsCandidates(g, seat){
  const real = document.getElementById('controls');
  if(!real || typeof renderControls!=='function') return { candidates: [], dispose: null };
  const oldId = real.id; real.id = 'human-controls';
  const box = document.createElement('div');
  box.id = 'controls'; box.style.display = 'none';
  document.body.appendChild(box);
  const humanSeat = mySeat; mySeat = seat;
  const list = [];
  try{
    renderControls(g);
    const buttons = [...box.querySelectorAll('button:not(:disabled)')];
    buttons.forEach((btn, i)=>{
      const label = (btn.textContent||'').trim() || ('按钮'+i);
      list.push({
        index: i,
        label,
        source: 'controls',
        invoke: ()=>{ btn.click(); },
      });
    });
  } catch(e){ console.warn('collectControlsCandidates', e); }
  finally { mySeat = humanSeat; }
  return {
    candidates: list,
    dispose: function(){
      box.remove();
      real.id = oldId;
      // 与 botSafePrompt 同一约定:借用期间 setBanner 写的是机器人文案,归还后重渲染一次,
      // 把 banner/controls 恢复成真人视角(仅当渲染快照可用时;沙箱测试里 currentG 不存在则跳过)
      if(typeof currentG!=='undefined' && currentG) renderControls(currentG);
    }
  };
}
function controlsChoiceMatch(g, seat){
  if(!g || !g.pending) return false;
  // 【L1 泛化】allowlist 三阶段无密钥也接管(旧分支已删/等价性已论证);其余所有阶段
  // 仅 aiReady 时接管——无密钥返回 false,runBotDecision 继续走该阶段既有旧分支,
  // 行为逐字不变(有/无密钥路径解耦,不再需要逐阶段等价性论证)。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(!(aiReady || CONTROLS_CHOICE_ALLOWLIST.has(g.phase))) return false;
  if(CONTROLS_CHOICE_EXCLUDE.has(g.phase)) return false;
  return botSeatForState(g)===seat;
}
function controlsChoiceBuildCandidates(g, seat){
  const res = collectControlsCandidates(g, seat);
  if(!res.candidates.length){
    // 没有可点按钮:立即归还 DOM(否则真实 #controls 会一直顶着改名后的 id,真人界面坏掉),
    // 返回空让 botDecide 走 false → 旧分支继续处理。
    if(res.dispose) res.dispose();
    return [];
  }
  controlsChoiceCtx = res;
  return res.candidates;
}
function controlsChoiceLocalFallback(g, seat, candidates){
  // 与 botSafePrompt 同款选择顺序:先 safe 正则、再 mandatory 正则、最后第一项。
  // 对 allowlist 三个阶段逐项核对过:落点与旧硬编码分支完全一致(见上面 allowlist 注释)。
  const safe = candidates.find(c=>/不发动|不使用|不出|取消|跳过|放弃|结束/.test(c.label));
  if(safe) return safe;
  const mandatory = candidates.find(c=>!/发动/.test(c.label)&&/选择|交给|弃置|摸牌|回复|打出/.test(c.label));
  if(mandatory) return mandatory;
  return candidates[0];
}
function controlsChoiceExecute(g, seat, choice){
  const ctx = controlsChoiceCtx;
  try{
    // botClickInProgress:见其声明处注释——让 confirmAndPlay 类按钮直接执行而不是弹确认框
    botClickInProgress = true;
    botInvoke(seat, ()=>{ if(choice && typeof choice.invoke==='function') choice.invoke(); });
  } finally {
    botClickInProgress = false;
    if(ctx && ctx.dispose) ctx.dispose();
    controlsChoiceCtx = null;
  }
}
function buildControlsChoiceSystemPrompt(g, seat, ctx){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。当前阶段,游戏界面为你渲染了一组'
    +'可点击的按钮(候选列表里的每一项对应一个按钮),每个按钮是一个合法动作。请结合当前'
    +'局面(你视角下真实合法可见的信息)与按钮文案,选出你认为最合适的动作。只能选择候选'
    +'列表里的按钮,不能发明列表之外的选项。'
    +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},不要输出任何解释文字、'
    +'代码块标记或多余字段。'
    +'多数情况先判断值不值得,再点。', g, seat);
}
BOT_DECISIONS.controlsChoice = {
  match: controlsChoiceMatch,
  buildCandidates: controlsChoiceBuildCandidates,
  localFallback: controlsChoiceLocalFallback,
  execute: controlsChoiceExecute,
  buildSystemPrompt: buildControlsChoiceSystemPrompt,
};

// ================= L2:discardSubset(弃牌阶段选弃哪几张,Task B4) =================
// 【本决策点是什么】弃牌阶段"弃掉哪 need 张"是资源取舍判断,不是纯机械规则——候选列表
// 是若干组"完整的弃牌下标集合"(每组都恰好 need 张、从自己的手牌里弃掉),AI 从中选一组;
// 无密钥回退默认组合 = 末尾 need 张(与旧硬编码分支逐字一致,无密钥回归红线)。
// 【候选生成策略】默认组合永远在场;变体1 = 按 botCardPriority 价值升序(优先弃低价值)
// 取前 need 张;变体2+ = 从价值组合出发逐位换成"下一位未选中下标"的小变异,凑足 20 个
// 上限。下标一律升序(服务端 discardCards 内部自己按降序 splice,顺序不影响结果)。
function discardSubsetMatch(g, seat){
  return g.phase==='discard' && g.turn===seat;
}
function discardSubsetBuildCandidates(g, seat){
  const p = g.players[seat];
  const hand = p.hand || [];
  const need = hand.length - handCapLimit(g, seat);
  if(need <= 0) return []; // need<=0 的 endTurn 短路径在 runBotDecision 里处理,这里永不触发
  // 默认组合:末尾 need 张(旧算法)
  const defaultIndices = [];
  for(let i = hand.length - need; i < hand.length; i++) defaultIndices.push(i);
  const seen = new Set();
  const out = [];
  function addVariant(idxArr, isDefault){
    const sorted = idxArr.slice().sort((a,b)=>a-b);
    const key = sorted.join(',');
    if(seen.has(key) || out.length >= 20) return;
    seen.add(key);
    out.push({
      label: (isDefault ? '默认弃牌(与本地一致):' : '弃牌组合'+out.length+':')
        + sorted.map(i=>hand[i].name).join('/'),
      discardIndices: sorted,
      isDefault: isDefault
    });
  }
  addVariant(defaultIndices, true);
  // 变体1:按价值升序(优先弃低价值)取前 need 张
  const byValue = hand.map((c,i)=>({ i:i, v: botCardPriority(c.name) }))
    .sort((a,b)=>a.v-b.v || a.i-b.i);
  addVariant(byValue.slice(0, need).map(x=>x.i), false);
  // 变体2+:从价值组合出发,逐位换成"下一位未选中的更高下标"(小变异)
  for(let k = 0; k < need && out.length < 20; k++){
    const base = byValue.slice(0, need).map(x=>x.i).sort((a,b)=>a-b);
    let next = base[k] + 1;
    while(base.indexOf(next) >= 0) next++;
    if(next >= hand.length) continue;
    const v = base.slice(); v[k] = next;
    addVariant(v, false);
  }
  return out;
}
function discardSubsetLocalFallback(g, seat, candidates){
  return candidates.find(c=>c.isDefault===true) || candidates[0];
}
function discardSubsetExecute(g, seat, choice){
  botInvoke(seat, ()=>discardCards(choice.discardIndices));
}
function buildDiscardSubsetSystemPrompt(){
  return '你在扮演网页版三国杀的AI机器人。当前是你的弃牌阶段,你必须恰好弃置 need 张牌'
    +'(候选列表每一项是一组完整的弃牌下标集合,均从你当前手牌中弃掉,弃哪组都一样合法)。'
    +'思考要保留哪些牌:闪/桃/无懈等关键防御牌与装备优先保留,酒/多余的同名牌等价值低的优先弃置。'
    +'只能选择列表内的组合,不能发明列表之外的选项。只输出 {"choice":数字}，不要解释。'
    +'先想保留什么(关键防御牌优先),再弃低价值牌。';
}
BOT_DECISIONS.discardSubset = {
  match: discardSubsetMatch,
  buildCandidates: discardSubsetBuildCandidates,
  localFallback: discardSubsetLocalFallback,
  execute: discardSubsetExecute,
  buildSystemPrompt: buildDiscardSubsetSystemPrompt,
  maxTokens: 120,
};

// ================= L2:pickSlot(顺手/拆桥选拿/拆哪个对象,Task B4) =================
// 【本决策点是什么】顺手牵羊/过河拆桥的选牌子阶段:目标的手牌(整体1个随机选项)、每件
// 装备、判定区每张延时锦囊各算一个候选。AI 从中选拿/拆哪个;无密钥回退与旧分支顺序
// 逐字一致(手牌优先 → 第一个占用装备槽 → delay:0)。
function pickSlotMatch(g, seat){
  return g.phase==='pick' && g.pending && g.pending.type==='pick' && g.pending.from===seat;
}
function pickSlotBuildCandidates(g, seat){
  const d = g.pending || {};
  const target = g.players[d.to];
  if(!target || !target.alive) return [];
  const out = [];
  if((target.hand||[]).length > 0){
    out.push({ pickKey: 'hand', label: '随机手牌(共'+(target.hand||[]).length+'张)' });
  }
  (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : []).forEach(slot=>{
    const c = target.equips && target.equips[slot];
    if(c) out.push({ pickKey: slot, label: '装备:' + c.name });
  });
  (target.delays||[]).forEach((c, i)=>{
    out.push({ pickKey: 'delay:'+i, label: '判定区:' + c.name });
  });
  return out;
}
function pickSlotLocalFallback(g, seat, candidates){
  const byKey = {};
  candidates.forEach(c=>{ byKey[c.pickKey] = c; });
  const target = g.players[(g.pending||{}).to];
  if((target && target.hand || []).length && byKey.hand) return byKey.hand;
  const slot = (typeof EQUIP_SLOTS!=='undefined' ? EQUIP_SLOTS : [])
    .find(s=>target && target.equips && target.equips[s]);
  if(slot && byKey[slot]) return byKey[slot];
  if(byKey['delay:0']) return byKey['delay:0'];
  return candidates[0];
}
function pickSlotExecute(g, seat, choice){
  botInvoke(seat, ()=>pickResolve(choice.pickKey));
}
function buildPickSlotSystemPrompt(){
  return '你在扮演网页版三国杀的AI机器人。你使用了顺手牵羊/过河拆桥,需要从目标处选择'
    +'拿/拆的对象(候选列表每一项是一个具体对象:随机手牌/某件装备/判定区某张延时锦囊)。'
    +'结合当前局面判断哪个对象价值最高(拆武器/拆+1马/拿装备/拆延时锦囊等)。只能选择'
    +'列表内的选项,不能发明列表之外的选项。请只输出 {"choice":数字},不要解释。'
    +'先看目标装备/判定区的价值,再选拿/拆哪个。';
}
BOT_DECISIONS.pickSlot = {
  match: pickSlotMatch,
  buildCandidates: pickSlotBuildCandidates,
  localFallback: pickSlotLocalFallback,
  execute: pickSlotExecute,
  buildSystemPrompt: buildPickSlotSystemPrompt,
};

// ================= L2:响应类三兄弟(guicai/ganglieChoice/guhuoQuestion,Task B5) =================
// 【本批是什么】三个响应类决策点从"第四阶段各自独立的 tryAiBotXxx + runBotDecision 硬编码
// 分支"收敛进 BOT_DECISIONS 注册表,删除 tryAi* 包装函数,避免双路径。三个都无法用 L1
// controlsChoice 镜像:guicai/ganglieChoice 的 controls 按钮是"进入本地多步选牌状态机"
// (点击不提交,见 render-controls.js 对应分支),guhuoQuestion 的本地回退是固定30%概率的
// 随机数(非确定性),都不是"点一个按钮即提交"的形状,故各自专用注册。
// 【无密钥回归红线】三条 localFallback 与改动前硬编码分支逐字一致:guicai 不发动、
// ganglieChoice 手牌够2张弃牌否则受伤、guhuoQuestion 30%随机质疑。
function guicaiHandPickMatch(g, seat){
  return g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===seat;
}
function guicaiHandPickBuildCandidates(g, seat){
  // 复用 buildBotGuicaiCandidates 的形状(index0=不发动+每张手牌一项),补 replace 标志:
  // 候选0→replace:false,候选>0→replace:true + 对应 handIndex,execute 直接映射到
  // respondGuicai(useReplace,cardIdx) 两个参数。
  return buildBotGuicaiCandidates(g, seat).map((c, i)=>({
    action: c.action, handIndex: c.handIndex, card: c.card,
    replace: i===0 ? false : true,
  }));
}
function guicaiHandPickLocalFallback(){
  return { replace:false, handIndex:null };
}
function guicaiHandPickExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGuicai(choice.replace, choice.handIndex));
}
BOT_DECISIONS.guicaiHandPick = {
  match: guicaiHandPickMatch,
  buildCandidates: guicaiHandPickBuildCandidates,
  localFallback: guicaiHandPickLocalFallback,
  execute: guicaiHandPickExecute,
  extraState: buildBotGuicaiVisibleState,
  buildSystemPrompt: buildBotGuicaiSystemPrompt,
  maxTokens: 100,
};

function ganglieChoiceMatch(g, seat){
  return g.phase==='ganglieChoice' && g.pending && g.pending.type==='ganglieChoice' && g.pending.sourceSeat===seat;
}
function ganglieChoiceBuildCandidates(g, seat){
  // 候选顺序与 buildBotGanglieSystemPrompt 的 choice 语义对齐(1=弃牌、0=受伤):
  // index0=受伤、index1=弃置,AI 按 prompt 选 index 时动作不会错位。
  // 手牌不足2张时 finishGanglieJudge 会直接跳过这个 pending 自动结算伤害,这里镜像同一
  // 规则只保留"受伤"一个候选(botDecide 单候选短路,不浪费AI调用)。
  const me = g.players[seat];
  const out = [];
  out.push({ action:'受到1点伤害', discard:false });
  if((me.hand||[]).length>=2) out.push({ action:'弃置2张手牌', discard:true });
  return out;
}
function ganglieChoiceLocalFallback(g, seat, candidates){
  // 与旧硬编码分支逐字一致:手牌够两张就弃牌,否则只能受伤。
  const wantDiscard = (g.players[seat].hand||[]).length>=2;
  return candidates.find(c=>c.discard===wantDiscard) || candidates[0];
}
function ganglieChoiceExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGanglieChoice(choice.discard?'discard':'damage', choice.discard?[0,1]:[]));
}
BOT_DECISIONS.ganglieChoice = {
  match: ganglieChoiceMatch,
  buildCandidates: ganglieChoiceBuildCandidates,
  localFallback: ganglieChoiceLocalFallback,
  execute: ganglieChoiceExecute,
  extraState: buildBotGanglieVisibleState,
  buildSystemPrompt: buildBotGanglieSystemPrompt,
  maxTokens: 80,
};

// ================= 调度盲区收尾:蔡文姬【悲歌】是否发动(Task 遗留清理) =================
// 【本条是什么】beigeChoose 此前不在 BOT_PHASE_ACTOR 里，调度请求走 botFallbackSeats+
// botSafePrompt 兜底——兜底能点掉"不发动"（安全正则命中"不发动"两个字），但即便配置了
// AI 密钥也永远碰不到这里，真实dump用mock callAI验证过：决策请求根本没有转发到
// runBotDecision。BOT_PHASE_ACTOR 补登记后（见上方注册表），这条注册才会真正被调用到。
// 【无密钥回归红线】localFallback 恒选"不发动"，与改动前 botSafePrompt 点击"不发动"逐字
// 一致——这不是偷懒，是这次收尾任务明确认可的默认("哪怕只是保守默认不发动")。
function beigeChoiceMatch(g, seat){
  return g.phase==='beigeChoose' && g.pending && g.pending.type==='beigeChoose' && g.pending.sourceSeat===seat;
}
function beigeChoiceBuildCandidates(g, seat){
  // 候选顺序:index0=不发动，index1=发动——与 triggerBeige(doTrigger) 的布尔参数直接对应。
  // 发动选项只在"确实有牌可弃"时才提供(镜像 triggerBeige 自己的 canDiscard 判断，避免
  // AI 选一个必被服务端拒绝/静默回退的选项)。
  const me = g.players[seat];
  const canDiscard = !!((me.hand||[]).length>0
    || (me.equips && Object.values(me.equips).some(Boolean)));
  const out = [{ action:'不发动', trigger:false }];
  if(canDiscard) out.push({ action:'发动【悲歌】', trigger:true });
  return out;
}
function beigeChoiceLocalFallback(g, seat, candidates){
  return candidates.find(c=>!c.trigger) || candidates[0];
}
function beigeChoiceExecute(g, seat, choice){
  botInvoke(seat, ()=>triggerBeige(choice.trigger));
}
function buildBotBeigeVisibleState(g, seat){
  const d = g.pending || {};
  const damaged = g.players[d.damagedSeat], source = g.players[d.damageSource];
  return {
    beige: {
      damagedSeatIsSelf: d.damagedSeat===seat,
      damagedSeatName: damaged ? damaged.name : null,
      damageSourceIsSelf: d.damageSource===seat,
      damageSourceName: source ? source.name : null,
    }
  };
}
function buildBotBeigeSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。你拥有蔡文姬'
  +'【悲歌】技能，场上刚有一名角色受到【杀】造成的伤害，你可以选择弃置一张牌（手牌或'
  +'装备）令其进行判定：判定为红桃回复1体力，方块摸2张牌，梅花令造成伤害的那个人弃置'
  +'2张牌，黑桃令造成伤害的那个人翻面。局面数据里 beige 字段说明了受伤角色'
  +'(damagedSeatIsSelf/damagedSeatName)和伤害来源(damageSourceIsSelf/damageSourceName)'
  +'是否是你自己——判断值不值得牺牲一张牌去发动，取决于判定结果对你有利还是有害。'
  +'请只输出一个严格的JSON对象，格式固定为 {"choice": 数字}，不要输出任何解释文字、'
  +'代码块标记或多余字段。', g, seat);
}
BOT_DECISIONS.beigeChoose = {
  match: beigeChoiceMatch,
  buildCandidates: beigeChoiceBuildCandidates,
  localFallback: beigeChoiceLocalFallback,
  execute: beigeChoiceExecute,
  extraState: buildBotBeigeVisibleState,
  buildSystemPrompt: buildBotBeigeSystemPrompt,
  maxTokens: 80,
};

// ================= 调度盲区收尾:贾诩【乱武】使用杀/失去体力(Task 遗留清理) =================
// 【本条是什么】luanwuChoose 此前不在 BOT_PHASE_ACTOR 里，"对X使用【杀】"/"失去1点体力"
// 两个自定义文案按钮都不命中 botSafePrompt 的安全/必选正则——两个按钮同时存在时(可以出杀)
// 连"唯一按钮"兜底都用不上，真正卡死；只有不能出杀只剩一个按钮时才侥幸走通。登记后彻底
// 改走这条专用注册。
// 【本地默认】镜像 render-controls.js 的 shaAvailable 判断(hasShaCard+canReachSha+目标存活)；
// 无密钥默认"能出杀就出杀，否则失去体力"——这是个强制二选一(不是"要不要发动")，选进攻
// 默认符合"多做损人利己的事"这条既有策略基调,不是新发明的判断。
function luanwuChoiceMatch(g, seat){
  return g.phase==='luanwuChoose' && g.pending && g.pending.type==='luanwuChoose' && g.pending.currentSeat===seat;
}
function luanwuChoiceBuildCandidates(g, seat){
  const d = g.pending || {};
  const map = d.targetMap || {};
  const nearestSeat = map[seat];
  const nearestPlayer = (typeof nearestSeat==='number' && nearestSeat!==seat) ? g.players[nearestSeat] : null;
  const shaAvailable = !!(nearestPlayer && nearestPlayer.alive
    && hasShaCard(g, seat) && canReachSha(g, seat, nearestSeat));
  const out = [{ action:'失去1点体力', option:'hp' }];
  if(shaAvailable) out.push({ action:'对'+nearestPlayer.name+'使用【杀】', option:'sha' });
  return out;
}
function luanwuChoiceLocalFallback(g, seat, candidates){
  return candidates.find(c=>c.option==='sha') || candidates.find(c=>c.option==='hp') || candidates[0];
}
function luanwuChoiceExecute(g, seat, choice){
  botInvoke(seat, ()=>chooseLuanwuOption(choice.option));
}
function buildBotLuanwuVisibleState(g, seat){
  const d = g.pending || {};
  const map = d.targetMap || {};
  const nearestSeat = map[seat];
  const nearestPlayer = (typeof nearestSeat==='number' && nearestSeat!==seat) ? g.players[nearestSeat] : null;
  const source = g.players[d.sourceSeat];
  return {
    luanwu: {
      sourceName: source ? source.name : null,
      nearestTargetName: nearestPlayer ? nearestPlayer.name : null,
      nearestTargetIsSelf: nearestSeat===seat,
    }
  };
}
function buildBotLuanwuSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。场上一名角色'
  +'(贾诩)发动了【乱武】，轮到你选择:对局面数据 luanwu.nearestTargetName 标注的最近'
  +'角色使用一张【杀】(若该选项存在于候选列表)，或者失去1点体力——这是强制二选一，'
  +'不选也必须承担其中一个后果。请结合你与最近角色的敌我关系判断是否值得消耗一张杀。'
  +'请只输出一个严格的JSON对象，格式固定为 {"choice": 数字}，不要输出任何解释文字、'
  +'代码块标记或多余字段。', g, seat);
}
BOT_DECISIONS.luanwuChoice = {
  match: luanwuChoiceMatch,
  buildCandidates: luanwuChoiceBuildCandidates,
  localFallback: luanwuChoiceLocalFallback,
  execute: luanwuChoiceExecute,
  extraState: buildBotLuanwuVisibleState,
  buildSystemPrompt: buildBotLuanwuSystemPrompt,
  maxTokens: 80,
};

function guhuoQuestionMatch(g, seat){
  return g.phase==='guhuoQuestion' && g.pending && g.pending.type==='guhuoQuestion' && g.pending.asking===seat;
}
function guhuoQuestionBuildCandidates(){
  // 候选顺序与 buildBotGuhuoSystemPrompt 的 choice 语义对齐(1=质疑、0=不质疑):
  // index0=不质疑、index1=质疑,AI 按 prompt 选 index 时动作不会错位。
  return [
    { action:'不质疑', question:false },
    { action:'质疑', question:true },
  ];
}
function guhuoQuestionLocalFallback(g, seat, candidates){
  // 与旧硬编码分支逐字一致:固定30%概率随机质疑,不偷看 d.actualCard(隐藏信息)。
  return Math.random()<0.3 ? candidates.find(c=>c.question) : candidates.find(c=>!c.question);
}
function guhuoQuestionExecute(g, seat, choice){
  botInvoke(seat, ()=>respondGuhuoQuestion(choice.question));
}
BOT_DECISIONS.guhuoQuestion = {
  match: guhuoQuestionMatch,
  buildCandidates: guhuoQuestionBuildCandidates,
  localFallback: guhuoQuestionLocalFallback,
  execute: guhuoQuestionExecute,
  extraState: buildBotGuhuoVisibleState,
  buildSystemPrompt: buildBotGuhuoSystemPrompt,
  maxTokens: 50,
};

// ================= L3:高价值响应三兄弟(dying/duel/aoeResp,Task T6) =================
// 【本批是什么】濒死求桃/决斗出杀/南蛮万箭响应三个"要不要打出一张牌"的决策点,从
// runBotDecision 硬编码分支收敛进 BOT_DECISIONS 注册表。三条 localFallback 与改动前
// 分支逐字一致(dying 的 botCanSave&&canBotUseTaoForDying&&有桃、duel/aoeResp 的
// canBotPlaySha&&findUsableAs),无密钥行为零变化。execute 只传 useTao/useSha/useCard
// 一个布尔(和旧分支一致;respondDying 的 jijiuChoice 第二参是华佗急救专用,机器人
// 不主动走那条路,不传)。
function dyingMatch(g, seat){
  return g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===seat;
}
function dyingBuildCandidates(g, seat){
  const p = g.players[seat];
  const d = g.pending;
  const hasTao = findUsableAs(p.hand, p, '桃') >= 0;
  const out = [];
  if(hasTao) out.push({ action:'打出【桃】救援', save:true });
  // 【涅槃修复,机器人技能覆盖审计后续】只有濒死者是自己(d.seat===seat)、自己拥有niepan能力
  // (庞统)、且这局还没用过限定技时才有这个选项——这是庞统专属候选,守卫条件对齐服务端
  // useNiepan 的守卫(g.pending.seat===mySeat && hasCap(me,'niepan') && !me.nirvanaUsed)。
  // 其它角色/庞统已用过涅槃时不会加这个候选,不影响原有桃/不出两个选项的判断。
  if(d.seat===seat && hasCap(p,'niepan') && !p.nirvanaUsed) out.push({ action:'发动【涅槃】', niepan:true });
  out.push({ action:'不出', save:false });
  return out;
}
function dyingExtraState(g, seat){
  const d = g.pending;
  const dyingP = g.players[d.seat];
  return { dying: {
    dyingSeat: d.seat,
    dyingName: dyingP ? dyingP.name : '?',
    dyingHp: dyingP ? dyingP.hp : null,
    isSelf: d.seat===seat,
  } };
}
function dyingLocalFallback(g, seat, candidates){
  const d = g.pending;
  const p = g.players[seat];
  const niepanChoice = candidates.find(function(c){ return c.niepan; });
  const taoChoice = candidates.find(function(c){ return c.save && !c.niepan; });
  if(niepanChoice && d.seat===seat){
    // 【涅槃默认发动规则】涅槃效果=弃光手牌+装备+判定区的牌,复原武将牌,回复至3点体力,摸3张牌
    // (game.js:useNiepan)——是一次"清空重置",值不值得发动关键看"这次要弃掉的东西值多少":
    //  1) 没有桃可用时,不发动涅槃就是坐视自己阵亡——涅槃怎么都比等死强,直接选涅槃。
    //  2) 有桃可用时,只有"手牌+已装备件数很少"(粗略按 <=2 判断,相当于身上基本没什么值得
    //     留的东西)才选涅槃换满血+摸3张;否则手牌/装备里可能压着更值钱的牌(比如别的桃、
    //     强力装备),弃了不划算,继续走原来"有桃就救"的逻辑,不抢占更优的省资源选项。
    if(!taoChoice) return niepanChoice;
    const equipCount = EQUIP_SLOTS.filter(function(s){ return p.equips && p.equips[s]; }).length;
    const cheapToDiscard = (p.hand.length + equipCount) <= 2;
    if(cheapToDiscard) return niepanChoice;
  }
  const save = botCanSave(g, seat, d.seat) && canBotUseTaoForDying(g, seat, d.seat) && findUsableAs(p.hand, p, '桃') >= 0;
  return candidates.find(function(c){ return c.save === save && !c.niepan; }) || candidates[candidates.length-1];
}
function dyingExecute(g, seat, choice){
  if(choice && choice.niepan){ botInvoke(seat, function(){ useNiepan(); }); return; }
  botInvoke(seat, function(){ respondDying(!!(choice && choice.save)); });
}
function dyingSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。现在轮到你对濒死角色决定是否打出【桃】救援。'
    +'如果候选列表里出现"发动【涅槃】"选项(仅当濒死的是你自己、你是庞统、且这局还没用过涅槃时才会出现):'
    +'涅槃会弃掉你当前所有手牌、装备和判定区的牌,复原武将牌,回复至3点体力,并摸3张新牌——是一次"清空重置",'
    +'手牌/装备越少代价越低越划算,如果你手里压着好几张有价值的牌(尤其是桃、强力装备)弃了可能不划算。'
    +'参考自己的身份、已知身份信息与当前手牌,权衡救与不救(或发动涅槃)的利弊。'
    +'只有列表内选项。只输出 {"choice":数字}，不要解释。'
    +'先判断濒死者是敌是友、值不值得救,再选。', g, seat);
}
BOT_DECISIONS.dying = {
  match: dyingMatch,
  buildCandidates: dyingBuildCandidates,
  extraState: dyingExtraState,
  localFallback: dyingLocalFallback,
  execute: dyingExecute,
  buildSystemPrompt: dyingSystemPrompt,
  maxTokens: 80,
};

function duelMatch(g, seat){
  return g.phase==='duel' && g.pending && g.pending.type==='duel' && g.pending.active===seat;
}
function duelBuildCandidates(g, seat){
  const p = g.players[seat];
  const canSha = canBotPlaySha(p) && findUsableAs(p.hand, p, '杀') >= 0;
  const out = [];
  if(canSha) out.push({ action:'打出【杀】', play:true });
  out.push({ action:'不出', play:false });
  return out;
}
function duelLocalFallback(g, seat, candidates){
  // 与旧分支逐字一致(含将驰禁杀判断,见 canBotPlaySha 注释——盲答"出杀"会被服务端拒)。
  const p = g.players[seat];
  const play = canBotPlaySha(p) && findUsableAs(p.hand, p, '杀') >= 0;
  return candidates.find(function(c){ return c.play === play; }) || candidates[candidates.length-1];
}
function duelExecute(g, seat, choice){
  botInvoke(seat, function(){ duelResponse(!!(choice && choice.play)); });
}
function duelSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。决斗中轮到你是否打出【杀】应战。'
    +'参考双方体力、手牌与已知身份信息判断优劣——注意当前是否受【将驰】等限制不能使用或打出杀。'
    +'只有列表内选项。只输出 {"choice":数字}，不要解释。'
    +'先判断这轮决斗的胜负预期,再决定出不出杀。', g, seat);
}
BOT_DECISIONS.duel = {
  match: duelMatch,
  buildCandidates: duelBuildCandidates,
  localFallback: duelLocalFallback,
  execute: duelExecute,
  buildSystemPrompt: duelSystemPrompt,
  maxTokens: 80,
};

function aoeRespMatch(g, seat){
  return g.phase==='aoeResp' && g.pending && g.pending.type==='aoeResp' && g.pending.to===seat;
}
function aoeRespBuildCandidates(g, seat){
  const d = g.pending;
  const p = g.players[seat];
  const canResp = (d.need==='杀' ? canBotPlaySha(p) : true) && findUsableAs(p.hand, p, d.need) >= 0;
  const out = [];
  if(canResp) out.push({ action:'打出【'+d.need+'】', play:true });
  out.push({ action:'不出', play:false });
  return out;
}
function aoeRespLocalFallback(g, seat, candidates){
  // 与旧分支逐字一致:need==='杀'(南蛮)受将驰限制,need==='闪'(万箭)不受。
  const d = g.pending;
  const p = g.players[seat];
  const play = (d.need==='杀' ? canBotPlaySha(p) : true) && findUsableAs(p.hand, p, d.need) >= 0;
  return candidates.find(function(c){ return c.play === play; }) || candidates[candidates.length-1];
}
function aoeRespExecute(g, seat, choice){
  botInvoke(seat, function(){ aoeRespond(!!(choice && choice.play)); });
}
function aoeRespSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。南蛮入侵/万箭齐发轮到你响应,决定是否打出要求的牌。'
    +'参考自己当前手牌与体力判断——注意当前是否受【将驰】等限制不能使用或打出杀。'
    +'只有列表内选项。只输出 {"choice":数字}，不要解释。'
    +'先判断自己血量与手牌是否宽裕,再决定出不出。', g, seat);
}
BOT_DECISIONS.aoeResp = {
  match: aoeRespMatch,
  buildCandidates: aoeRespBuildCandidates,
  localFallback: aoeRespLocalFallback,
  execute: aoeRespExecute,
  buildSystemPrompt: aoeRespSystemPrompt,
  maxTokens: 80,
};

// ================= B2a 主公技求助(激将/护驾) =================
// 服务端 respondLordAskCore 统一处理两种求助(need 由 pending 决定)。机器人被求助时
// 引导性决策:有能当 need 的牌就替出、没有就不出。无密钥 localFallback 同样"有牌就出"——
// 与改动前行为的关系:改动前机器人从不参与主公技求助,该阶段走 botSafePrompt 兜底点
// "不出"(安全正则命中),无牌时行为一致;有牌时"替出"是新能力(主公技本身是本次新功能,
// 不属于"无密钥零变化"承诺范围——零变化承诺只针对非身份局/非主公路径,见测试 F 组)。
// 将驰禁杀同时约束替出杀(服务端 respondLordAskCore 同样拒绝,规则26:先探测服务端)。
function lordAskMatch(type){
  return function(g, seat){
    const d=g.pending;
    return g.phase===type && d && d.type===type && d.asking===seat;
  };
}
function lordAskBuildCandidates(g, seat, need){
  const p=g.players[seat];
  const canResp = !(need==='杀' && p.jiangchiNoSlash) && findUsableAs(p.hand, p, need) >= 0;
  const out=[];
  if(canResp) out.push({ action:'替主公打出【'+need+'】', play:true });
  out.push({ action:'不出', play:false });
  return out;
}
function lordAskLocalFallback(g, seat, candidates, need){
  const p=g.players[seat];
  const play = !(need==='杀' && p.jiangchiNoSlash) && findUsableAs(p.hand, p, need) >= 0;
  return candidates.find(function(c){ return c.play === play; }) || candidates[candidates.length-1];
}
BOT_DECISIONS.jijiangAsk = {
  match: lordAskMatch('jijiangAsk'),
  buildCandidates: function(g, seat){ return lordAskBuildCandidates(g, seat, '杀'); },
  localFallback: function(g, seat, candidates){ return lordAskLocalFallback(g, seat, candidates, '杀'); },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondJijiangAsk(!!(choice && choice.play)); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。主公刘备发动【激将】,向你求助一张【杀】:候选为'
      +'"替主公打出【杀】"或"不出"。请结合局面决定。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};
BOT_DECISIONS.hujiaAsk = {
  match: lordAskMatch('hujiaAsk'),
  buildCandidates: function(g, seat){ return lordAskBuildCandidates(g, seat, '闪'); },
  localFallback: function(g, seat, candidates){ return lordAskLocalFallback(g, seat, candidates, '闪'); },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondHujiaAsk(!!(choice && choice.play)); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。主公曹操发动【护驾】,向你求助一张【闪】:候选为'
      +'"替主公打出【闪】"或"不出"。请结合局面决定。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};

// ================= B2b 制霸拼点(孙策主公响应) =================
BOT_DECISIONS.zhibaAsk = {
  match: function(g, seat){
    const d=g.pending;
    return g.phase==='zhibaAsk' && d && d.type==='zhibaAsk' && d.lordSeat===seat;
  },
  buildCandidates: function(g, seat){
    const p=g.players[seat];
    const candidates=(p.hand||[]).map(function(c, i){
      return { action:'拼点【'+c.name+'】', cardIdx:i };
    });
    if(p.hunziAwakened) candidates.push({action:'拒绝拼点',cardIdx:-1,refuse:true});
    return candidates;
  },
  localFallback: function(g, seat, candidates){
    const hand=g.players[seat].hand||[];
    const cards=candidates.filter(function(c){return c.cardIdx>=0;}).sort(function(a,b){
      return ((hand[b.cardIdx]&&hand[b.cardIdx].rank)||0) - ((hand[a.cardIdx]&&hand[a.cardIdx].rank)||0);
    });
    if(g.players[seat].hunziAwakened && (!cards.length || ((hand[cards[0].cardIdx]&&hand[cards[0].cardIdx].rank)||0)<10))
      return candidates.find(function(c){return c.refuse;});
    return cards[0] || candidates[0];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondZhiba(choice.cardIdx); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。吴势力角色请求发动你的主公技【制霸】。'
      +'候选为你的每张手牌,请选择最有利的一张拼点。'
      +'只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};

BOT_DECISIONS.jiedaoResponse = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='jiedaoChoice' && d && d.type==='jiedaoChoice' && d.seatA===seat;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const cardIdx = findUsableAs(p.hand, p, '杀');
    const canSha = canBotPlaySha(p) && cardIdx >= 0;
    const out = [];
    if(canSha) out.push({ play:true, cardIdx, label:'打出【杀】' });
    out.push({ play:false, cardIdx:null, label:'弃置武器' });
    return out;
  },
  localFallback: function(g, seat, candidates){
    const p = g.players[seat];
    const play = canBotPlaySha(p) && findUsableAs(p.hand, p, '杀') >= 0;
    return candidates.find(function(c){ return c.play === play; }) || candidates[candidates.length-1];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondJiedao(!!choice.play, choice.cardIdx); });
  },
  buildSystemPrompt: function(g, seat){
    return botPromptWithIdentity('你在扮演网页版三国杀的AI机器人。你被【借刀杀人】要求对目标使用【杀】:候选为'
      +'"打出【杀】"或"弃置武器"。请结合局面决定。只输出 {"choice":数字},不要解释。', g, seat);
  },
  maxTokens: 60,
};

// ================= L3:wugu挑牌 + pickGeneral(选将,含主公)进总线(Task T7) =================
// 【本批是什么】五谷丰登"从公共池挑一张"和开局选将两个决策点,从 runBotDecision 硬编码
// 分支收敛进 BOT_DECISIONS 注册表。两条 localFallback 与改动前分支逐字一致(wugu=池首张、
// 选将=botPickGeneral 打分公式),无密钥行为零变化。
// 【字段真相】选将的服务端校验(room-lifecycle.js respondPickGeneral/respondPickLordGeneral)
// 统一读 p.generalChoices——主公候选也是 room-lifecycle.js 把 g.lordGeneralPool 直接赋给
// 主公的 generalChoices,项目里不存在 p.lordChoices 字段;buildCandidates 用
// p.lordChoices||p.generalChoices 的写法对不存在字段自然回退,行为正确。
// 【expectedIdx 约定】wuguPick(poolIdx,expectedIdx,expectedCardId) 的 expectedIdx 是乐观
// 并发校验("我看到的时候轮到第几个人挑"),必须传当前真实的 d.idx,不能硬编码 0——曾经
// 硬编码成 0 导致机器人不是第一个挑牌人时服务端静默 return、挑牌轮次卡死。
BOT_DECISIONS.wuguPick = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='wugu' && d && d.type==='wugu' && Array.isArray(d.order) && d.order[d.idx||0]===seat && Array.isArray(d.pool) && d.pool.length>0;
  },
  buildCandidates: function(g, seat){
    const d = g.pending;
    return (d.pool||[]).map(function(c, i){
      return { poolIdx: i, cardId: c && c.id, label: '拿【'+(c&&c.name||'?')+'】' };
    });
  },
  extraState: function(g, seat){
    const d = g.pending;
    return { wugu: { orderIdx: d.idx || 0, poolCount: (d.pool||[]).length } };
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:wuguPick(0, d.idx||0, d.pool[0]&&d.pool[0].id)
    return candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const d = g.pending;
    botInvoke(seat, function(){ wuguPick(choice.poolIdx, d.idx || 0, choice.cardId); });
  },
};

BOT_DECISIONS.pickGeneral = {
  match: function(g, seat){
    if(g.phase==='pickingGeneral'){ const p=g.players[seat]; return !!p && p.isBot && !p.general; }
    if(g.phase==='pickingLordGeneral'){ return getLordSeat(g)===seat; }
    return false;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const lordPick = g.phase==='pickingLordGeneral';
    const ids = lordPick ? (p.lordChoices||p.generalChoices||[]) : (p.generalChoices||[]);
    return ids.filter(function(id){ return GENERALS[id]; }).map(function(id){
      const gen = GENERALS[id];
      return { generalId: id, label: gen.name + (gen.skill ? '('+gen.skill+')' : ''), generalName: gen.name };
    });
  },
  localFallback: function(g, seat, candidates){
    // 旧 botPickGeneral 打分逐字(直接复用现有函数):选打分最高者
    const p = g.players[seat], lordPick = g.phase==='pickingLordGeneral';
    const choices = (p.generalChoices||[]).filter(function(id){ return GENERALS[id]; });
    if(!choices.length) return candidates[0] || null;
    const score = function(id){
      const gen = GENERALS[id], text = (gen.skill||'') + (gen.desc||'');
      return generalMaxHp(id)*12 +
        (/回复|摸.*牌|防止|免疫|闪/.test(text)?16:0) +
        (/伤害|杀|弃置/.test(text)?10:0) + (lordPick && /主公|回复|防止/.test(text)?20:0);
    };
    choices.sort(function(a,b){ return score(b)-score(a); });
    const best = choices[0];
    return candidates.find(function(c){ return c.generalId===best; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){
      if(g.phase==='pickingLordGeneral') respondPickLordGeneral(choice.generalId);
      else respondPickGeneral(choice.generalId);
    });
  },
};

// ================= L3: 观星(诸葛亮【观星】)进总线(Task T8) =================
// 【本批是什么】观星"把牌堆顶几张按顺序放回顶/底"从 runBotDecision 硬编码分支收敛进
// BOT_DECISIONS 注册表。旧分支=全部置顶原序;localFallback 与旧分支逐字一致(默认方案
// 恒在),无密钥行为零变化。
// 【方案A:有限排列候选】默认方案(全置顶原序)恒在;+价值排序置顶方案;+最多6个相邻
// 置换变体。观星牌最多5张(continueGuanxingCheck 里 min(5,存活数)),变体上限8足够
// 覆盖候选空间,AI 不会面对空列表。候选 topOrder/bottomOrder 都是 pending.cards 的
// 下标数组,label 带牌名(观星者本人查看牌堆顶,牌名对该机器人合法可见,不是泄露)。
function buildGuanxingCandidates(g, seat){
  const d = g.pending;
  const n = (d.cards||[]).length;
  const all = (d.cards||[]).map(function(_, i){ return i; });
  const seen = new Set();
  const out = [];
  function add(top, isDefault){
    const key = JSON.stringify(top) + '|' + JSON.stringify(all.filter(function(i){ return top.indexOf(i)<0; }));
    if(seen.has(key) || out.length >= 8) return;
    seen.add(key);
    const bottom = all.filter(function(i){ return top.indexOf(i)<0; });
    const topNames = top.map(function(i){ return d.cards[i].name; }).join(',');
    const bottomNames = bottom.map(function(i){ return d.cards[i].name; }).join(',');
    out.push({ topOrder: top.slice(), bottomOrder: bottom, isDefault: isDefault,
      label: (isDefault?'默认方案':'方案'+out.length)+':顶['+topNames+'] 底['+(bottomNames||'无')+']' });
  }
  add(all, true); // 默认:全部置顶原序(旧行为)
  // 价值排序:按 botCardPriority 降序置顶
  const byValue = all.slice().sort(function(a, b){ return botCardPriority(d.cards[b].name) - botCardPriority(d.cards[a].name); });
  add(byValue, false);
  // 变体:相邻置换
  for(let i=0;i<n-1 && out.length<8;i++){
    const v = all.slice(); const t = v[i]; v[i]=v[i+1]; v[i+1]=t;
    add(v, false);
  }
  return out;
}
BOT_DECISIONS.guanxing = {
  match: function(g, seat){ return g.phase==='guanxingReview' && g.pending && g.pending.type==='guanxingReview' && g.pending.seat===seat; },
  buildCandidates: function(g, seat){ return buildGuanxingCandidates(g, seat); },
  localFallback: function(g, seat, candidates){ return candidates.find(function(c){ return c.isDefault; }) || candidates[0] || null; },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondGuanxing(choice.topOrder, choice.bottomOrder); });
  },
};

// ================= T9: 化身/巧变移动/恩怨选项进总线 =================
// 五个决策点的 localFallback 与改动前 runBotDecision 硬编码分支逐字一致:
// huashenSkill=池里第一个可用技能将(取其第一个技能名);huashenChangeStart/End=不更改;
// qiaobianMove=不移动;enyuanOption=有红桃给牌否则掉血。
// 守卫字段:huashenChangeAskStart/End 与 qiaobianMove 的 pending.type 均=phase 同名
// (skills.js/room-lifecycle.js 各自 respond 函数守卫),和 render-controls.js 真人分支
// 同源;enyuanChooseOption 的 pending.type 由 game.js chooseEnyuanOption 守卫。
BOT_DECISIONS.huashenSkill = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='huashenPick' && d && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    return (p.huashenPool||[]).filter(function(id){ return HUASHEN_SKILL_TABLE[id] && (HUASHEN_SKILL_TABLE[id]||[]).length; }).map(function(id){
      const entry = HUASHEN_SKILL_TABLE[id][0];
      return { generalId: id, skillName: entry && entry.name, label: (entry&&entry.name?entry.name+'('+id+')':id) };
    });
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:取池里第一个可用技能将
    const p = g.players[seat];
    const generalId = (p.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(generalId===undefined || generalId===null) return candidates[0] || null;
    return candidates.find(function(c){ return c.generalId===generalId; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const entry = (HUASHEN_SKILL_TABLE[choice.generalId]||[])[0];
    botInvoke(seat, function(){ respondHuashenPick(choice.generalId, entry && entry.name); });
  },
};
BOT_DECISIONS.huashenChangeStart = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='huashenChangeAskStart' && d && d.type==='huashenChangeAskStart' && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    return [{ action: '更改【化身】', change: true }, { action: '不更改', change: false }];
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:不更改
    return candidates.find(function(c){ return c.change===false; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    botInvoke(seat, function(){ respondHuashenChangeAskStart(!!(choice && choice.change)); });
  },
};
BOT_DECISIONS.huashenChangeEnd = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='huashenChangeAskEnd' && d && d.type==='huashenChangeAskEnd' && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    return [{ action: '更改【化身】', change: true }, { action: '不更改', change: false }];
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:不更改
    return candidates.find(function(c){ return c.change===false; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    botInvoke(seat, function(){ respondHuashenChangeAskEnd(!!(choice && choice.change)); });
  },
};
BOT_DECISIONS.qiaobianMove = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='qiaobianMove' && d && d.type==='qiaobianMove' && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    // 候选=「不移动」+ 至多8个「装备源槽→目标角色」组合(源槽=任一存活角色非空装备槽,
    // 目标=任一存活角色且同槽为空;同一源槽→同一目标去重,共≤9项)。只列装备移动:
    // 判定区延时牌移动(doQiaobianMove 的 kind==='delay')机器人生成不出有意义评估,保守
    // 不列,与旧分支"不移动"的保守口径一致。
    const out = [{ action: '不移动', move: null }];
    const seen = {};
    if(!g.players[seat]) return out;
    g.players.forEach(function(src, srcSeat){
      if(!src || !src.alive) return;
      EQUIP_SLOTS.forEach(function(slot){
        const card = src.equips && src.equips[slot];
        if(!card) return;
        g.players.forEach(function(dst, dstSeat){
          if(!dst || !dst.alive || dstSeat===srcSeat) return;
          if(dst.equips && dst.equips[slot]) return; // 目标同槽已占用
          const key = srcSeat+':'+slot+':'+dstSeat;
          if(seen[key] || out.length>=9) return;
          seen[key] = true;
          out.push({
            action: '移'+src.name+'的'+card.name+'→'+dst.name,
            move: { srcSeat: srcSeat, dstSeat: dstSeat, kind: 'equip', slot: slot }
          });
        });
      });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:不移动
    return candidates[0] || null;
  },
  execute: function(g, seat, choice){
    botInvoke(seat, function(){ respondQiaobianMove(choice && choice.move!==undefined ? choice.move : null); });
  },
};
BOT_DECISIONS.enyuanOption = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='enyuanChooseOption' && d && d.damagerSeat===seat;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const hasHeart = (p.hand||[]).some(function(c){ return c.suit==='♥'; });
    if(hasHeart) return [{ action: '给一张红桃牌', option: 'giveCard' }, { action: '失去1点体力', option: 'loseHp' }];
    return [{ action: '失去1点体力', option: 'loseHp' }];
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:有红桃给牌否则掉血
    const p = g.players[seat];
    const want = (p.hand||[]).some(function(c){ return c.suit==='♥'; }) ? 'giveCard' : 'loseHp';
    return candidates.find(function(c){ return c.option===want; }) || candidates[candidates.length-1] || null;
  },
  execute: function(g, seat, choice){
    botInvoke(seat, function(){ chooseEnyuanOption(choice && choice.option || 'loseHp'); });
  },
};
BOT_DECISIONS.enyuanGiveCard = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='enyuanGiveCard' && d && d.type==='enyuanGiveCard' && d.damagerSeat===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    (me.hand||[]).forEach(function(c, i){
      if(c && c.suit==='♥') out.push({ cardIdx: i, label: '给【'+c.name+'】' });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    return candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ giveEnyuanCard(choice.cardIdx); });
  },
  buildSystemPrompt: function(g, seat){
    return botPromptWithIdentity('你在扮演网页版三国杀的AI机器人。请选择一张红桃手牌交给法正。'
      +'只输出 {"choice":数字},不要解释。', g, seat);
  },
  maxTokens: 60,
};

// ================= L3: seatPick 通用座位协议(第一批扩展,Task L3-T1) =================
// 【本协议是什么】把"从合法座位里选一个"这一大类交互收敛成通用协议:BOT_SEAT_PICKS
// 按技能注册 {match, buildSeatCandidates, fallbackSeat, execute},seatPick 动态收集
// 全部命中技能的候选合并成一张表(AI 一次选"哪个技能打向哪个座位",label 带技能名前缀),
// 不命中任何技能时返回 false 走旧分支。与 render.js 真人交互的关系:候选合法性与
// render.js 座位卡分支同源但独立实现(不读客户端 mode 变量,只读 g/玩家状态),
// 真人 onclick 路径零改动。
const BOT_SEAT_PICKS = Object.create(null);

function seatPickMatch(g, seat){
  if(!g || g.phase!=='play' && !(g.pending && (g.pending.type==='guhuoTarget'||g.pending.type==='xuanfengPick'||g.pending.type==='quhuDamageChoice'))) return false;
  return Object.keys(BOT_SEAT_PICKS).some(function(key){
    const s = BOT_SEAT_PICKS[key];
    return typeof s.match==='function' && s.match(g, seat);
  });
}
function seatPickBuildCandidates(g, seat){
  const out = [];
  Object.keys(BOT_SEAT_PICKS).forEach(function(key){
    const s = BOT_SEAT_PICKS[key];
    if(typeof s.match!=='function' || !s.match(g, seat)) return;
    const list = s.buildSeatCandidates(g, seat) || [];
    list.forEach(function(c){
      out.push({
        index: 0, // botDecide 会重新规范化
        label: c.label,
        skillKey: key,
        seat: c.seat,
        source: 'seatPick',
      });
    });
  });
  return out;
}
function seatPickLocalFallback(g, seat, candidates){
  // 遍历注册表,对第一个 match 的技能取 fallbackSeat(旧行为);匹配到目标则返回对应候选
  const keys = Object.keys(BOT_SEAT_PICKS);
  for(let i=0;i<keys.length;i++){
    const key = keys[i], s = BOT_SEAT_PICKS[key];
    if(typeof s.match!=='function' || !s.match(g, seat)) continue;
    const fs = s.fallbackSeat(g, seat);
    if(fs===null || fs===undefined) return null; // 旧行为=不发动 → botDecide 拿 null 会崩,须返回候选或由 execute 处理
    const hit = candidates.find(function(c){ return c.skillKey===key && c.seat===fs; });
    return hit || null;
  }
  return null;
}
function seatPickExtraState(g, seat){
  // 聚合所有命中技能的 extraState(如蛊惑的声明牌名——公开信息,AI 决策需要知道
  // "这次蛊惑声明的是什么牌"),与 guhuoQuestion 的 buildBotGuhuoVisibleState 同款
  // 只投影公开字段、绝不带隐藏信息(actualCard/他人手牌)。
  const out = {};
  Object.keys(BOT_SEAT_PICKS).forEach(function(key){
    const s = BOT_SEAT_PICKS[key];
    if(typeof s.match!=='function' || !s.match(g, seat)) return;
    if(typeof s.extraState==='function') Object.assign(out, s.extraState(g, seat) || {});
  });
  return out;
}
function seatPickExecute(g, seat, choice){
  if(!choice || !choice.skillKey) return;
  const s = BOT_SEAT_PICKS[choice.skillKey];
  if(!s || typeof s.execute!=='function') return;
  s.execute(g, seat, choice.seat);
}
BOT_DECISIONS.seatPick = {
  match: seatPickMatch,
  buildCandidates: seatPickBuildCandidates,
  localFallback: seatPickLocalFallback,
  execute: seatPickExecute,
  extraState: seatPickExtraState,
  buildSystemPrompt: function(g, seat, ctx){
    return '你在扮演网页版三国杀的AI机器人。当前你的出牌阶段/技能阶段,候选列表里的每一项'
      +'是"发动某个技能并指定某个目标"的完整动作(技能名前缀区分)。请结合局面与目标公开'
      +'状态选择最合适的动作。只能选列表内选项,不能发明。只输出 {"choice":数字},不要解释。';
  },
};

// ================= L3: 蛊惑目标(于吉【蛊惑】无人质疑后由发起者选目标) =================
// 【合法性来源】render.js 座位卡分支(guhuoTarget 高亮段):claimed 声明牌走
// guhuoActionId → CARD_PLAYS[actionId].target/.canTarget/.allowSelf 三重校验,
// 这里逐条镜像(只读 g/pending,不读客户端 mode 变量)。
BOT_SEAT_PICKS.guhuoTarget = {
  match: function(g, seat){
    const d = g.pending;
    return !!(d && d.type==='guhuoTarget' && d.sourceSeat===seat);
  },
  buildSeatCandidates: function(g, seat){
    const d = g.pending;
    const claimed = d && d.claimedCard;
    const spec = claimed ? CARD_PLAYS[guhuoActionId(claimed.name)] : null;
    const meP = g.players[seat];
    const out = [];
    if(!claimed || !spec || !spec.target) return out;
    g.players.forEach(function(p, i){
      if(!p || !p.alive) return;
      const selfAllowed = i!==seat || !!(spec && spec.allowSelf);
      if(!selfAllowed) return;
      if(spec.canTarget && !spec.canTarget(g, meP, claimed, i)) return;
      out.push({ seat: i, label: '蛊惑→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】声明牌已经通过质疑生效,必须选一个目标(不选=扣置牌白白浪费),
    // 用botTargetScore('damage')挑一个进攻价值最高的目标——和guhuoTarget自身"任意基本牌/
    // 普通锦囊"的通用性一致,不区分具体声明的是哪张牌。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.guhuoTarget.buildSeatCandidates(g, seat), 'damage');
  },
  extraState: function(g, seat){
    const d = g.pending || {};
    const out = {};
    if(d.claimedCard && d.claimedCard.name) out.claimedCardName = d.claimedCard.name;
    return out;
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ guhuoChooseTarget(targetSeat); });
  },
};

// ================= L3: 旋风目标(凌统【旋风】失去装备后选弃置目标) =================
// 【合法性来源】render.js 座位卡分支(xuanfengPick 高亮段):存活且非自己。
BOT_SEAT_PICKS.xuanfeng = {
  match: function(g, seat){
    const d = g.pending;
    return !!(d && d.type==='xuanfengPick' && d.from===seat && d.stage==='selecting');
  },
  buildSeatCandidates: function(g, seat){
    // 【调度盲区收尾接线时发现并修的一个真实边界】必须把"这个目标已经被选过多少张"
    // (pending.selections)从其原始牌数里扣掉再判断是否还有余量——否则一个已经被弃完的
    // 目标会一直留在候选表里,AI(或本地兜底)反复选中它又被 pickXuanfengTarget 自己的
    // available<=0 守卫静默拒绝(不改变任何状态),造成"选目标→选牌阶段发现没牌可选→退回
    // 选目标→又选中同一个已耗尽的目标"的死循环，真实dump用mock AI固定选同一index复现过。
    // render-controls.js 715行左右人类UI按钮的可见性判断同样是"原始牌数>0"（不扣除已选
    // 数量），这是既有UI本身的次要瑕疵（人类点了也只会看到一个空的选牌页面，靠"返回选择
    // 目标"退出，不会死循环——机器人没有这种"看一眼发现没得选就不选"的能力，必须在候选
    // 层面就排除掉）。
    const d = g.pending || {};
    const selected = d.selections || [];
    const takenOf = function(targetSeat, kind){
      return selected.filter(function(s){ return s.targetSeat===targetSeat && s.kind===kind; }).length;
    };
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      const remainingHand = (p.hand||[]).length - takenOf(i,'hand');
      const remainingEquip = EQUIP_SLOTS.filter(function(slot){ return p.equips && p.equips[slot]; }).length - takenOf(i,'equip');
      const remainingDelay = (p.delays||[]).length - takenOf(i,'delay');
      if(remainingHand + remainingEquip + remainingDelay <= 0) return;
      out.push({ seat: i, label: '旋风→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】旋风是"弃置对手一张牌"的负面效果,用botTargetScore('steal')
    // (顺手/拆桥同款口径,额外按手牌数加权)挑一个最该被拆的目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.xuanfeng.buildSeatCandidates(g, seat), 'steal');
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ pickXuanfengTarget(targetSeat); });
  },
};

// ================= L3: 出牌阶段转化技能 5 个(断粮/奇袭/国色/武圣/双雄,Task L3-T2) =================
// 【合法性来源】render.js 座位卡分支(断粮距离≤2/奇袭有牌可拆/国色无乐/武圣·双雄走真
// canTarget)+ render-controls.js 入口按钮门槛(hasCap/断粮限一次)+ 服务端函数逐条守卫。
// 【与 brief 的偏差,以 render.js 为准】①断粮的"黑色基本牌"判定用 render-hand.js 的
// BASIC_CARDS.includes||getEquip(比 brief 的 杀/闪/桃 多覆盖"酒");②断粮 match 额外加
// hasCap(me,'duanliang')&&!g.duanliangUsed(render-controls 入口门槛+服务端守卫,防 AI
// 选一个必被服务端拒的选项);③奇袭/国色 match 加 hasCap(入口门槛,同上);④武圣 match
// 加 CARD_PLAYS['杀'].canPlay(render.js:1449 isWushengShaSel 真身就含这一条)。
// 【选牌语义】牌维度第一批不交 AI,execute 内 findIndex 第一张合法牌(与 render.js 真人
// "点牌"一致)——AI 只选目标座位,牌由 execute 决定。每个技能的选牌谓词独立成函数,
// match/buildSeatCandidates/execute 三处复用同一谓词(同手牌+同谓词→确定性同 idx)。
function isDuanliangCard(me, c){
  return !!(c && (c.suit==='♠'||c.suit==='♣')
    && (BASIC_CARDS.includes(c.name) || !!getEquip(c.name)));
}
function isQixiCard(c){ return !!(c && (c.suit==='♠'||c.suit==='♣')); }
function isGuoseCard(c){ return !!(c && c.suit==='♦'); }
// isWushengShaCard:红+可当杀+杀可打出。【候选真空修复,2026-08】此前多了一条
// resolveActionId(g,me,c)!=='杀' 排除条件,设计假设是"resolveActionId 已经解析成杀,
// 说明常规枚举(enumerateAllLegalOneStepActions)那边肯定已经收录了"——但常规枚举用的是
// 不认转化能力的哑函数 botActionId(只看牌名本身),resolveActionId 是给人类点击弹窗用的
// 智能解析函数,两者对同一张牌的判断根本不是一回事:resolveActionId 解析成'杀'的场景
// (①闪:没有 CARD_PLAYS 入口,ownSpec 检查永远失败,恒定解析成'杀';②红色 target:false
// 牌自己此刻打不出,如满血的桃)常规枚举反而完全不收录这张牌(botActionId 走的是牌名本身、
// CARD_PLAYS[原名].canPlay 失败就整条跳过)——于是排除条件精确排掉了本该由这个函数兜底的
// 真空区间,变成"两头都以为对方已经覆盖,实际上谁都没覆盖"。真实dump验证:关羽满血+只有
// 一张闪/一张桃时,常规枚举与本函数都不收录,机器人整回合无法用武圣。去掉这条排除条件后,
// 函数不再依赖"常规枚举已覆盖"这个错误假设,自己独立判断——对已经在常规枚举里出现的牌
// (如未满血的桃、target:true的过河拆桥等 ownSpec.canPlay 成功的牌)本函数原本就同样返回
// true(resolveActionId 在这些场景本来就解析成牌名本身而不是'杀',这条排除条件对它们是
// 恒真、从未排除过),这部分候选集合不受本次改动影响,纯粹是新增闪/满血桃两类此前的真空。
// 【真实dump顺带发现的latent bug,同一次一并修掉】不能只查 canUseAs(...)——canUseAs('杀')
// 对红色闪也会因为龙胆(名字判断,不看颜色)独立返回 true,和武圣(颜色判断)是两条互不相干
// 的分支;若只查 canUseAs 的总返回值,一个只有龙胆、没有武圣的赵云拿到红色闪时会被误判成
// "命中武圣",多出一条错误打标的候选(功能上不出错,playCard仍会走longdan那条canUseAs
// 判断,真正执行时不受影响,但候选标注错了技能来源,且和龙胆产生重复候选)。必须显式限定
// hasCap(me,'wusheng')。
// 【真实dump又发现的第二个latent bug,同一次一并修掉】去掉 resolveActionId!=='杀' 之后,
// 一张红色的**真杀**(card.name本身就是'杀')也会满足 canUseAs('杀')——canUseAs 的第一行
// isShaName(card.name) 对真杀恒真,和任何cap无关。真杀不是"转化",常规枚举本来就会按它
// 自己的名字正确收录一条"出杀"候选,不需要武圣再重复注册一条——旧的 resolveActionId!=='杀'
// 条件其实同时兼顾了两件不相关的事:①(错的)把闪/满血桃这些真空一并滤掉;②(对的)把真杀
// 本身滤掉不重复注册。去掉整条判断会把②也丢了。改成显式判断 card.name!=='杀'(这张牌
// 本身不是杀,才谈得上"转化"),精确只保留②这一个意图,不影响①的修复效果。
function isWushengShaCard(g, me, c){
  if(!c || c.name==='杀') return false;
  const red = c.suit==='♥'||c.suit==='♦';
  return red && hasCap(me, 'wusheng') && canUseAs(me, c, '杀') && CARD_PLAYS['杀'].canPlay(g, me, c);
}
// isLongdanShaCard:赵云【龙胆】闪→杀方向。和 isWushengShaCard 刻意不同结构——闪没有
// CARD_PLAYS['闪']这个入口(纯被动响应牌,从未有主动使用路径),resolveActionId 的
// ownSpec 检查对闪永远失败,于是它对任意一张闪恒定解析成'杀'(step2永远走不到、
// step3 canUseAs('杀')靠 longdan 命中即真)。这意味着闪不存在"武圣那种——自己有
// 独立效果、同时也能转化"的双候选场景,是纯粹的单一候选真空:botActionId(闪)固定
// 返回'闪'这个name,而CARD_PLAYS['闪']不存在,常规枚举整条直接判false跳过、
// 完全不落地——不需要也不能复用 isWushengShaCard 那个"resolveActionId!=='杀'"的排除
// 条件(闪恒等于'杀',排除条件会把所有闪都滤掉,等于零覆盖)。
function isLongdanShaCard(g, me, c){
  if(!c || c.name!=='闪') return false;
  // 【本次武圣修复顺带发现的latent bug】不能只查 canUseAs(...)——canUseAs('杀') 对红色
  // 闪也会因为武圣(颜色判断,不看名字)独立返回 true,和 longdan(名字判断)是两条互不相干
  // 的分支;若只查 canUseAs 的总返回值,一个只有武圣、没有龙胆的关羽拿到红色闪时会被
  // 误判成"命中龙胆",多出一条错误打标的候选(功能上不出错——playCard仍会走wusheng那条
  // canUseAs判断,真正执行时不受影响,但候选标注错了技能来源,且和武圣产生重复候选)。
  // 必须显式限定 hasCap(me,'longdan')。
  return hasCap(me, 'longdan') && canUseAs(me, c, '杀') && CARD_PLAYS['杀'].canPlay(g, me, c);
}
// 镜像 render.js:1162 hasHandOrEquip(顺手/拆桥同款:手牌/装备/判定区任一非空)
function seatHasTargetableCards(p){
  return !!p && ((p.hand||[]).length>0
    || EQUIP_SLOTS.some(s=>p.equips && p.equips[s])
    || (p.delays||[]).length>0);
}

BOT_SEAT_PICKS.duanliang = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'duanliang') || g.duanliangUsed) return false;
    return (me.hand||[]).some(function(c){ return isDuanliangCard(me, c); });
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(distance(g, seat, i) > 2) return;
      out.push({ seat: i, label: '断粮→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】兵粮寸断是负面判定效果,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.duanliang.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return isDuanliangCard(me, c); });
    if(idx>=0) botInvoke(seat, function(){ duanLiang(idx, targetSeat); });
  },
};

BOT_SEAT_PICKS.qixi = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'qixi')) return false;
    return (me.hand||[]).some(isQixiCard);
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!seatHasTargetableCards(p)) return;
      out.push({ seat: i, label: '奇袭→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】奇袭是拆牌效果,用steal口径(顺手/拆桥同款)挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.qixi.buildSeatCandidates(g, seat), 'steal');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(isQixiCard);
    if(idx>=0) botInvoke(seat, function(){ qiXi(idx, targetSeat); });
  },
};

BOT_SEAT_PICKS.guose = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'guose')) return false;
    return (me.hand||[]).some(isGuoseCard);
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if((p.delays||[]).some(c=>c && c.name==='乐不思蜀')) return;
      out.push({ seat: i, label: '国色→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】国色令目标乐不思蜀(跳过出牌阶段),按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.guose.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(isGuoseCard);
    if(idx>=0) botInvoke(seat, function(){ guoSe(idx, targetSeat); });
  },
};

BOT_SEAT_PICKS.wusheng = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me) return false;
    return (me.hand||[]).some(function(c){ return isWushengShaCard(g, me, c); });
  },
  buildSeatCandidates: function(g, seat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return isWushengShaCard(g, me, c); });
    const selCard = idx>=0 ? me.hand[idx] : null;
    const out = [];
    if(!selCard) return out;
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!CARD_PLAYS['杀'].canTarget(g, me, selCard, i)) return;
      out.push({ seat: i, label: '武圣→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】武圣转化后仍是杀,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.wusheng.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return isWushengShaCard(g, me, c); });
    if(idx>=0) botInvoke(seat, function(){ playCard(idx, '杀', targetSeat); });
  },
};

BOT_SEAT_PICKS.longdan = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me) return false;
    return (me.hand||[]).some(function(c){ return isLongdanShaCard(g, me, c); });
  },
  buildSeatCandidates: function(g, seat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return isLongdanShaCard(g, me, c); });
    const selCard = idx>=0 ? me.hand[idx] : null;
    const out = [];
    if(!selCard) return out;
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!CARD_PLAYS['杀'].canTarget(g, me, selCard, i)) return;
      out.push({ seat: i, label: '龙胆→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】龙胆闪→杀转化后仍是杀,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.longdan.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return isLongdanShaCard(g, me, c); });
    if(idx>=0) botInvoke(seat, function(){ playCard(idx, '杀', targetSeat); });
  },
};

BOT_SEAT_PICKS.shuangxiong = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me) return false;
    return (me.hand||[]).some(function(c){ return canShuangxiongDuelCard(me, c); });
  },
  buildSeatCandidates: function(g, seat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return canShuangxiongDuelCard(me, c); });
    const selCard = idx>=0 ? me.hand[idx] : null;
    const out = [];
    if(!selCard) return out;
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!CARD_PLAYS['决斗'].canTarget(g, me, selCard, i)) return;
      out.push({ seat: i, label: '双雄→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】双雄转化后是决斗,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.shuangxiong.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return canShuangxiongDuelCard(me, c); });
    if(idx>=0) botInvoke(seat, function(){ playCard(idx, '决斗', targetSeat); });
  },
};

// ================= L3: 剩余简单单选 4 个(挑衅/反间/青囊/驱虎伤害,Task L3-T3) =================
// 【合法性来源】render.js 座位卡分支 + render-controls.js 入口按钮门槛(hasCap/限一次/手牌非空)。
// 【与 brief 的偏差,以 render-controls.js 为准】①反间 match 在 brief 的 hasCap+play+turn
// 之外,加 render-controls.js:3750 入口门槛的 !g.fanJianUsed && (me.hand||[]).length>=1
// (服务端 fanJian 同样以这两条为前置守卫,不加会导致 AI 选一个必被服务端拒的选项);
// ②青囊 match 同样加 !g.qingNangUsed(render-controls.js:3762 门槛);③挑衅经 rg 确认
// render-controls.js:3730 是"点按钮→进入 tiaoxinMode→点座位"两步 UI,但服务端
// respondTiaoxin(targetSeat) 可直接调用、无"发动"前置阶段,属简单单选,按本任务
// 注册进 seatPick(非 Task 4 多步框架)。④驱虎伤害是独立阶段
// (quhuDamageChoice,pending.seat===本人),seatPickMatch 外层闸门已加
// pending.type==='quhuDamageChoice' 放行;quhuRespond 拼点阶段不在本任务。
BOT_SEAT_PICKS.tiaoxin = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'tiaoxin') || g.tiaoxinUsed) return false;
    return true;
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if((p.hand||[]).length===0) return;
      out.push({ seat: i, label: '挑衅→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】挑衅令目标下回合出牌阶段只能对来源出杀,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.tiaoxin.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ respondTiaoxin(targetSeat); });
  },
};

BOT_SEAT_PICKS.fanjian = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'fanjian') || g.fanJianUsed) return false;
    return (me.hand||[]).length>=1;
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      out.push({ seat: i, label: '反间→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】反间是负面判定效果,按damage口径挑目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.fanjian.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ fanJian(targetSeat); });
  },
};

BOT_SEAT_PICKS.qingnang = {
  match: function(g, seat){
    if(!g || g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players && g.players[seat];
    if(!me || !hasCap(me,'qingnang') || g.qingNangUsed) return false;
    return (me.hand||[]).length>=1;
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive) return;
      if(p.hp>=p.maxHp) return;
      out.push({ seat: i, label: '青囊→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】青囊是治疗效果,用pickHealFallbackSeat——挑血量最低、且不是
    // 已知敌方角色的目标(candidates本身已经过滤了p.hp>=p.maxHp的满血角色)。
    return pickHealFallbackSeat(g, seat, BOT_SEAT_PICKS.qingnang.buildSeatCandidates(g, seat));
  },
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return !!c; }); // 弃第一张手牌(与真人"点一张手牌"一致)
    if(idx>=0) botInvoke(seat, function(){ qingNang(idx, targetSeat); });
  },
};

BOT_SEAT_PICKS.quhuDamage = {
  match: function(g, seat){
    const d = g.pending;
    return !!(g && g.phase==='quhuDamageChoice' && d && d.type==='quhuDamageChoice'
      && d.seat===seat && Array.isArray(d.targets));
  },
  buildSeatCandidates: function(g, seat){
    const d = g.pending;
    const out = [];
    (d.targets||[]).forEach(function(i){
      const p = g.players[i];
      if(!p || !p.alive) return;
      out.push({ seat: i, label: '驱虎伤害→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 【无密钥兜底解锁】驱虎伤害是选谁挨这1点伤害,按damage口径在给定候选(pending.targets)
    // 里挑最该承受伤害的目标。
    return pickBestCandidateSeat(g, seat, BOT_SEAT_PICKS.quhuDamage.buildSeatCandidates(g, seat), 'damage');
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ respondQuhuDamage(targetSeat); });
  },
};

// ================= L3: 多步两阶段框架(借刀杀人,Task T4) =================
// 【两阶段状态】botTwoStepA 仅客户端本地、不入 Firebase(仿 render.js 的 jiedaoSeatA),
// 不新增 pending 类型:阶段A选中 A 后挂起,等下一调度走阶段B;阶段B提交后立即重置。
// runBotDecision 每轮调度入口先检查 botTwoStepA 是否属于当前决策(decisionId 防跨决策
// 残留)。【无密钥兜底语义】改动前机器人从不用借刀(botPlay 枚举排除借刀),这里取
// candidates[0](最小合法组合)而不是"不动作"——因为 jiedaoTwoStep 的 match 只看
// "手牌有借刀",若阶段A选完不落子,每个调度都会再次命中 match 重新问一遍、永无终局;
// 阶段B提交后借刀被 jieDaoShaRen 消耗,下一调度 match 自然为 false 收尾。
let botTwoStepA = null;
function resetBotTwoStep(){ botTwoStepA = null; }

BOT_DECISIONS.jiedaoTwoStep = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    // 挂起守卫:另一个多步决策进行中时本决策不参与(防阶段A覆盖别人已选的状态)
    if(botTwoStepA && botTwoStepA.decisionId!=='jiedaoTwoStep') return false;
    const me = g.players[seat];
    const hasJiedao = (me.hand||[]).some(function(c){ return c.name==='借刀杀人'; });
    return hasJiedao;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const jiedaoIdx = (me.hand||[]).findIndex(function(c){ return c.name==='借刀杀人'; });
    const out = [];
    if(botTwoStepA && botTwoStepA.decisionId==='jiedaoTwoStep'){
      // 阶段 B:镜像 render.js 1473 —— A 攻击范围内、非A、非空城的存活者。
      // 【组队模式修复】额外排除"B和A同队"——借刀杀人是"逼A打B",A/B同队等于逼队友互相
      // 伤害,不能选。阶段A的hasSomeB已经保证选中的A至少有一个非同队的合法B,这里正常
      // 情况下不会因为这条过滤导致候选变空;万一状态变化(比如B临时变成同队)真的导致
      // 候选为空,交给下面execute阶段处理(不会卡住,见execute注释)。
      const A = botTwoStepA.a;
      g.players.forEach(function(p, i){
        if(!p || !p.alive || i===A) return;
        if(!canReachSha(g, A, i)) return;
        if(hasCap(p,'kongcheng') && (p.hand||[]).length===0) return;
        if(sameTeam(g, A, i)) return;
        out.push({ index: 0, label: '借刀:令 '+g.players[A].name+' 杀 '+p.name, step:'B', seatA: A, seatB: i, jiedaoIdx: jiedaoIdx });
      });
      return out;
    }
    // 阶段 A:镜像 render.js 1467-1468 —— 有武器且存在合法B(hasSomeB)的存活其他角色。
    // 【组队模式修复】hasSomeB 额外要求"至少一个B和A不同队",保证阶段A选中的A在阶段B
    // 一定能找到合法的非同队B(不会出现"选完A才发现B全是队友"的空候选场景)。
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!p.equips || !p.equips.weapon) return;
      const hasSomeB = g.players.some(function(B, bi){
        return B && B.alive && bi!==i && canReachSha(g, i, bi)
          && !(hasCap(B,'kongcheng') && (B.hand||[]).length===0)
          && !sameTeam(g, i, bi);
      });
      if(!hasSomeB) return;
      out.push({ index: 0, label: '借刀:选 '+p.name, step:'A', a: i, jiedaoIdx: jiedaoIdx });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    if(!candidates.length) return null;
    return candidates[0];
  },
  // 【组队模式修复,曾经加过onEmpty又移除】阶段A的hasSomeB已经保证选中的A至少有一个
  // 非同队的合法B,阶段B正常不会出现候选为空——万一因为状态变化(极端边界,如B恰好在
  // 两次调度之间阵亡)真的遇到候选为空,和"完全没有武器持有者"这种阶段A候选为空的既有
  // 场景走的是同一条路(botDecide返回false,runBotDecision继续走runBotActionWindow,
  // 不会卡死,run_ai_bus_l3_test.js"候选空应返回false"那两条既有测试锁定的就是这个
  // 契约)——不需要额外加onEmpty去主动resetBotTwoStep,那样反而会改变"候选空→false→
  // 继续走其它决策"这个既有约定,导致这一轮什么都不做。botTwoStepA留着等下一次调度
  // 重新判断即可,不是卡死,只是这一步"什么都不选"。
  execute: function(g, seat, choice){
    if(!choice) return;
    if(choice.step==='A'){
      botTwoStepA = { decisionId: 'jiedaoTwoStep', a: choice.a };
      return; // 等下一调度走阶段 B
    }
    // 阶段 B:提交借刀专属流程(jieDaoShaRen(cardIdx,seatA,seatB),render.js 1478 分支同款)
    resetBotTwoStep();
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return c.name==='借刀杀人'; });
    if(idx<0) return;
    botInvoke(seat, function(){ jieDaoShaRen(idx, choice.seatA, choice.seatB); });
  },
};

// ================= L3: 离间(liJian,两阶段) =================
// 入口门槛镜像 render-controls.js:3746(hasCap+限一次+手牌≥1+存活男性≥2);
// 阶段A=存活男性(render.js 1358 isMale(p) 无自己排除——左慈化身借用离间时自己也可以是男性,
//   服务端 liJian 只查 isMale(from),不查性别与座位关系,镜像 render 含自己);
// 阶段B=≠from 的存活男性(render.js 1364 else if 分支整体嵌在 isMale(p) 块内)。
BOT_DECISIONS.lijianTwoStep = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    if(botTwoStepA && botTwoStepA.decisionId!=='lijianTwoStep') return false;
    const me = g.players[seat];
    if(!me || !me.alive || !hasCap(me,'lijian') || g.liJianUsed) return false;
    if((me.hand||[]).length < 1) return false;
    const maleCount = g.players.filter(function(p){ return p && p.alive && isMale(p); }).length;
    return maleCount >= 2;
  },
  buildCandidates: function(g, seat){
    const out = [];
    if(botTwoStepA && botTwoStepA.decisionId==='lijianTwoStep'){
      // 【组队模式修复】排除"B和A同队"——离间是"逼A对B使用决斗",A/B同队等于逼队友互相
      // 伤害。阶段A的hasSomeB已经保证选中的A至少有一个非同队的合法B。
      const from = botTwoStepA.a;
      g.players.forEach(function(p, i){
        if(!p || !p.alive || i===from || !isMale(p)) return;
        if(sameTeam(g, from, i)) return;
        out.push({ index: 0, label: '离间:令 '+g.players[from].name+' 对 '+p.name+' 使用【决斗】', step:'B', fromSeat: from, toSeat: i });
      });
      return out;
    }
    // 【组队模式修复】hasSomeB 额外要求"至少一个B和A不同队",保证阶段A选中的A在阶段B
    // 一定能找到合法的非同队B。
    g.players.forEach(function(p, i){
      if(!p || !p.alive || !isMale(p)) return;
      const hasSomeB = g.players.some(function(B, bi){
        return B && B.alive && bi!==i && isMale(B) && !sameTeam(g, i, bi);
      });
      if(!hasSomeB) return;
      out.push({ index: 0, label: '离间:选 '+p.name+' 为【决斗】使用者', step:'A', a: i });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    return candidates.length ? candidates[0] : null;
  },
  // 【组队模式修复,同jiedaoTwoStep同一处理】不加onEmpty——理由见jiedaoTwoStep同位置注释。
  execute: function(g, seat, choice){
    if(!choice) return;
    if(choice.step==='A'){
      botTwoStepA = { decisionId: 'lijianTwoStep', a: choice.a };
      return; // 等下一调度走阶段 B
    }
    resetBotTwoStep();
    const me = g.players[seat];
    if(!(me.hand||[]).length) return;
    const idx = 0; // 离间可弃任意手牌(render-hand.js 205-207 usable=true),取第一张
    botInvoke(seat, function(){ liJian(idx, choice.fromSeat, choice.toSeat); });
  },
};

// ================= L3: 丈八蛇矛(zhangbaTwoStep,三阶段) =================
// botTwoStepA 扩展为 {decisionId,a,b?}:阶段A=第一张手牌、阶段B=第二张(≠a)、阶段C=杀目标。
// 入口门槛镜像 render-controls.js:3712(hasCap twoAsSha+手牌≥2+canSha)叠加服务端
// playZhangbaSha 的次数/将驰守卫(!jiangchiNoSlash、shaUsed 且无 unlimitedSha 且无
// jiangchiExtraShaLeft 时拒绝)。match 额外要求存在至少一个合法杀目标——目标不可达时
// 服务端必然拒绝、三阶段流程白挂起,且陈旧挂起态会堵住其它多步决策,不如不进流程。
BOT_DECISIONS.zhangbaTwoStep = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    if(botTwoStepA && botTwoStepA.decisionId!=='zhangbaTwoStep') return false;
    const me = g.players[seat];
    if(!me || !me.alive || !hasCap(me,'twoAsSha')) return false;
    if(me.jiangchiNoSlash) return false; // 曹彰【将驰】选项1:本回合不能使用/打出杀
    if(g.shaUsed && !hasCap(me,'unlimitedSha') && !(g.jiangchiExtraShaLeft > 0)) return false;
    if((me.hand||[]).length < 2) return false;
    return g.players.some(function(p, i){
      if(!p || !p.alive || i===seat) return false;
      if(!canReachSha(g, seat, i)) return false;
      if(hasCap(p,'kongcheng') && (p.hand||[]).length===0) return false;
      return true;
    });
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    if(botTwoStepA && botTwoStepA.decisionId==='zhangbaTwoStep'){
      const a = botTwoStepA.a;
      if(botTwoStepA.b === undefined){
        // 阶段 B:镜像 render-hand.js 223-230 —— 第二张手牌,≠第一张
        (me.hand||[]).forEach(function(c, i){
          if(i===a) return;
          out.push({ index: 0, label: '丈八:第2张牌 '+c.name, step:'B', a: a, b: i });
        });
        return out;
      }
      // 阶段 C:镜像 render.js 1234-1252 —— 存活、非自己、canReachSha、非空城
      const b = botTwoStepA.b;
      g.players.forEach(function(p, i){
        if(!p || !p.alive || i===seat) return;
        if(!canReachSha(g, seat, i)) return;
        if(hasCap(p,'kongcheng') && (p.hand||[]).length===0) return;
        out.push({ index: 0, label: '丈八:两张牌当【杀】打 '+p.name, step:'C', a: a, b: b, targetSeat: i });
      });
      return out;
    }
    // 阶段 A:镜像 render-hand.js 223-230 —— 第一张手牌
    (me.hand||[]).forEach(function(c, i){
      out.push({ index: 0, label: '丈八:第1张牌 '+c.name, step:'A', a: i });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    return candidates.length ? candidates[0] : null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    if(choice.step==='A'){ botTwoStepA = { decisionId: 'zhangbaTwoStep', a: choice.a }; return; }
    if(choice.step==='B'){ botTwoStepA = { decisionId: 'zhangbaTwoStep', a: choice.a, b: choice.b }; return; }
    resetBotTwoStep();
    botInvoke(seat, function(){ playZhangbaSha(choice.a, choice.b, choice.targetSeat); });
  },
};

function botFangtianTargets(g, seat){
  const me=g.players[seat], out=[];
  if(!me) return out;
  g.players.forEach(function(p, i){
    if(!p || !p.alive || i===seat) return;
    if(!(me.jiangchiNoDistance && g.turn===seat) && !canReachSha(g, seat, i)) return;
    if(hasCap(p,'kongcheng') && (p.hand||[]).length===0) return;
    out.push(i);
  });
  return out;
}
function botFangtianCombinations(g, seat){
  const targets=botFangtianTargets(g, seat), out=[];
  const add=function(combo){ if(out.length<10) out.push(combo); };
  for(let i=0;i<targets.length;i++) add([targets[i]]);
  for(let i=0;i<targets.length;i++) for(let j=i+1;j<targets.length;j++) add([targets[i],targets[j]]);
  for(let i=0;i<targets.length;i++) for(let j=i+1;j<targets.length;j++) for(let k=j+1;k<targets.length;k++) add([targets[i],targets[j],targets[k]]);
  return out;
}
BOT_DECISIONS.fangtian = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat || botTwoStepA) return false;
    const me=g.players[seat], card=me && (me.hand||[])[0];
    if(!me || !me.alive || !hasCap(me,'fangtian') || (me.hand||[]).length!==1) return false;
    if(!card || !canUseAs(me, card, '杀') || me.jiangchiNoSlash) return false;
    if(g.shaUsed && !hasCap(me,'unlimitedSha') && !(g.jiangchiExtraShaLeft>0)) return false;
    return botFangtianCombinations(g, seat).length>0;
  },
  buildCandidates: function(g, seat){
    const cardIdx=0;
    return botFangtianCombinations(g, seat).map(function(targets){
      return {
        target:targets.slice(), targets:targets.slice(), cardIdx:cardIdx,
        label:'方天画戟：'+targets.map(function(i){ return g.players[i].name; }).join('、')
      };
    });
  },
  localFallback: function(g, seat, candidates){ return candidates[0]; },
  execute: function(g, seat, choice){
    if(!choice) return;
    const targets=choice.targets || choice.target;
    botInvoke(seat, function(){ playShaFangtian(choice.cardIdx, targets); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。请选择一个合法的方天画戟目标组合。候选项的 targets 是完整目标座位数组，只能选择列表内组合。只输出 {"choice":数字}，不要解释。';
  },
};

// ================= L3: 仁德(rendeTwoStep,两阶段) =================
// 入口=render.js 1401-1410(选中任意手牌后目标座位出现"仁德:交给此人"按钮):hasCap(rende)+
// 手牌非空+存活非自己目标;服务端 renDe 无本回合次数限制(renDeCount 只用于第2张后的回复),
// 故 match 不加次数守卫。阶段A=目标(存活非自己)、阶段B=每张手牌一项。
BOT_DECISIONS.rendeTwoStep = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    if(botTwoStepA && botTwoStepA.decisionId!=='rendeTwoStep') return false;
    const me = g.players[seat];
    if(!me || !me.alive || !hasCap(me,'rende')) return false;
    if((me.hand||[]).length < 1){
      // A6:continue 态手牌已空仍需调度一次,让 AI 选「停止」清掉挂起(候选只剩停止);
      // 非 continue 态空手牌照旧不命中。
      if(botTwoStepA && botTwoStepA.decisionId==='rendeTwoStep' && botTwoStepA.continue) return true;
      return false;
    }
    return true;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    if(botTwoStepA && botTwoStepA.decisionId==='rendeTwoStep'){
      const targetSeat = botTwoStepA.a;
      const cont = !!botTwoStepA.continue;
      (me.hand||[]).forEach(function(c, i){
        out.push({ index: 0, label: '仁德:交给 '+g.players[targetSeat].name+' '+c.name, step:'B', cardIdx: i, targetSeat: targetSeat });
      });
      // A6:continue 态追加「停止给牌」选项;手牌空时候选只剩它。
      if(cont) out.push({ index: 0, label: '仁德:停止给牌', step:'B', stop: true });
      return out;
    }
    // 【组队模式修复】仁德是纯粹单向的"把手牌白送给目标"(skills.js的renDe:
    // me.hand.splice(...)+target.hand.push(card),目标没有任何反向代价/回报;
    // 给出2张后的回体力也是刘备自己触发,和收牌人是谁无关)——组队模式下没有任何
    // 场景值得把这份纯增益送给敌方,直接把敌方从候选里排除(和伤害类操作的
    // -Infinity同一处理力度,不是"降权仍可选"这种暧昧写法)。如果场上没有任何
    // 队友(候选为空),交给下面buildCandidates返回[]→botDecide返回false→
    // runBotDecision继续走其它决策——"这一轮不发动仁德"永远比"发动仁德资敌"更好,
    // 不需要额外的兜底分支去强行选一个敌方目标。
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(g.gameMode==='team' && !sameTeam(g, seat, i)) return;
      out.push({ index: 0, label: '仁德:选目标 '+p.name, step:'A', a: i });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    if(!candidates.length) return null;
    // A6:无密钥只给一张即停(改动前行为)。stopAfter 让 execute 提交后不设 continue。
    return Object.assign({}, candidates[0], { stopAfter: true });
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    if(choice.step==='A'){
      botTwoStepA = { decisionId: 'rendeTwoStep', a: choice.a };
      return; // 等下一调度走阶段 B
    }
    const me = g.players[seat];
    if(choice.stop){ resetBotTwoStep(); return; } // A6:选停止→不再给
    botInvoke(seat, function(){ renDe(choice.cardIdx, choice.targetSeat); });
    if(choice.stopAfter){ resetBotTwoStep(); return; } // A6:无密钥一张即停,不设 continue
    // A6:逐张给牌——renDeCount<2 且手牌还有牌就继续(下一调度给下一张或停止),否则收尾。
    if(g.renDeCount < 2 && (me.hand||[]).length > 0){
      botTwoStepA = { decisionId: 'rendeTwoStep', a: choice.targetSeat, continue: true };
    } else {
      resetBotTwoStep();
    }
  },
};

// ============ 分配类:yijiAssign(郭嘉遗计分配,跨调度累积) ============
// 【本决策点是什么】遗计判定后摸 2 张牌,依次为每张牌选择接收者(人类是"每张牌点一个
// 角色,最后一张点击即提交",见 render-controls.js yijiAssign 分支)。机器人侧复用
// botTwoStepA 跨调度累积:非最后一张的选择存进 {decisionId:'yijiAssign',picks},下一
// 调度继续选下一张;最后一张选完一次性提交 respondYijiAssign(picks)。
// 【改动前行为】runBotDecision 无本阶段分支、BOT_PHASE_ACTOR 无登记 → botSafePrompt
// 兜底;按钮文案"给 自己/给 玩家X"不命中 safe(/不发动|不出|取消|跳过|放弃|结束/)与
// mandatory(/选择|交给|弃置|摸牌|回复|打出/)任一正则、按钮数>1 → chosen=null → 只
// 告警不动作,机器人遗计分配卡死。localFallback 保守默认"给 自己"让机器人至少能把牌
// 分出去,是明确改进(测试锁定),不是回归。
BOT_DECISIONS.yijiAssign = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='yijiAssign' && d && d.type==='yijiAssign' && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    const d = g.pending;
    const cards = d.cards || [];
    const picks = (botTwoStepA && botTwoStepA.decisionId==='yijiAssign') ? botTwoStepA.picks : [];
    const idx = picks.length; // 当前正在为第几张选接收者
    const card = cards[idx];
    if(!card || idx >= cards.length) return [];
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive) return;
      out.push({ idx: idx, targetSeat: i, label: '给 '+(i===seat?'自己':p.name)+' 【'+card.name+'】' });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 保守默认:当前这张牌给 自己(改动前无覆盖;有密钥 AI 失败时也用它)
    return candidates.find(function(c){ return c.targetSeat===seat; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const picks = (botTwoStepA && botTwoStepA.decisionId==='yijiAssign') ? botTwoStepA.picks.slice() : [];
    picks.push(choice.targetSeat);
    const cards = (g.pending && g.pending.cards) || [];
    if(picks.length >= cards.length){
      // 最后一张:提交并清状态
      resetBotTwoStep();
      botInvoke(seat, function(){ respondYijiAssign(picks); });
    } else {
      // 非最后一张:累积,等下一调度继续
      botTwoStepA = { decisionId: 'yijiAssign', picks: picks };
    }
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。当前是【遗计】分配阶段:候选列表里的每一项'
      +'是"把当前这张牌交给某名角色"。请结合局面选择每张牌最合适的接收者(自己/队友/'
      +'敌人按需判断)。只能选列表内选项。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 80,
};

// ============ 分配类:lirangAsk(孔融礼让发动,单阶段选组合) ============
// 【本决策点是什么】礼让:摸牌阶段开始时交给目标两张手牌。目标(pending.to)由服务端
// 算好(render-controls 显示"交给 '目标'"),AI 只需选"哪两张手牌"——候选=2 张手牌
// 组合(仿 discardSubset 组合生成,默认组合恒在=第一张+第二张),选完即提交
// respondLiRang(true, picks)。
// 【改动前行为核对】runBotDecision 无 lirangAsk 分支、BOT_PHASE_ACTOR 无登记 →
// botSeatForState 返回 -1 → 走 botFallbackSeats+botSafePrompt;lirangAsk 渲染的
// "发动【礼让】"按钮依赖客户端 lirangPicks 模式状态(机器人从不置位,不渲染)、
// "不发动"按钮命中 safe 正则第一替代项 → botSafePrompt 点击"不发动" →
// respondLiRang(false,[]) 收尾推进。即改动前机器人恒不发动、流程正常推进。
// localFallback=不发动(decline 动作)忠实复刻此行为;刻意不用 null——null=无动作,
// respondLiRang 不被调用、pending 永不清空,机器人会永久卡死在 lirangAsk
// (CLAUDE.md 第26条同款卡死模式)。
BOT_DECISIONS.lirangAsk = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='lirangAsk' && d && d.type==='lirangAsk' && d.from===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const hand = me.hand || [];
    if(hand.length < 2) return [];
    const out = [];
    const seen = new Set();
    for(let a=0; a<hand.length && out.length<8; a++){
      for(let b=a+1; b<hand.length && out.length<8; b++){
        const key = a+','+b;
        if(seen.has(key)) continue;
        seen.add(key);
        out.push({ cardIdxs: [a, b], isDefault: out.length===0, label: '交【'+hand[a].name+'】与【'+hand[b].name+'】' });
      }
    }
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 不发动(与改动前 botSafePrompt 点击"不发动"按钮逐字等价;见上方改动前行为核对)
    return { decline: true, label: '不发动' };
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){
      if(choice.decline){ respondLiRang(false, []); return; }
      respondLiRang(true, choice.cardIdxs);
    });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。当前是【礼让】发动阶段:候选列表每一项是'
      +'"交给目标的两张手牌"组合。请结合手牌价值选择是否发动、交哪两张(通常交价值低的)。'
      +'只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 80,
};

// ============ A类补角:xiaoguo(乐进骁果,路径A) ============
// 【本决策点是什么】骁果:回合结束阶段被问"是否弃一张基本牌发动【骁果】"——候选=手里
// 每张基本牌(弃之发动,单步可提交 respondXiaoguo(true, cardIdx)) + 恒有「不发动」
// (respondXiaoguo(false) → advanceXiaoguo 推进到下一个候选人)。服务端守卫
// (skills.js respondXiaoguo):phase/pending.type/pending.asking!==mySeat;发动时校验
// hand[cardIdx] 是 BASIC_CARDS 成员,否则原地拒绝。
// 【改动前行为核对】runBotDecision 无 xiaoguo 分支、BOT_PHASE_ACTOR 无登记、EXCLUDE
// 收录 xiaoguo → botSeatForState -1 → botFallbackSeats+botSafePrompt 兜底:xiaoguo
// 渲染"发动【骁果】/不发动",发动按钮依赖客户端 xiaoguoMode 模式状态(机器人从不置位)、
// "不发动"命中 safe 正则第一替代项 → botSafePrompt 点击"不发动" → respondXiaoguo(false)
// → advanceXiaoguo 推进。即改动前机器人恒不发动、流程正常推进。localFallback=不发动
// 忠实复刻此行为;刻意不用 null(null=无动作,respondXiaoguo 不被调用、pending 永不清空,
// 机器人永久卡死,CLAUDE.md 第26条同款卡死模式)。
BOT_DECISIONS.xiaoguo = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='xiaoguo' && d && d.type==='xiaoguo' && d.asking===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    (me.hand||[]).forEach(function(c, i){
      if(BASIC_CARDS.includes(c.name)) out.push({ cardIdx: i, activate: true, label: '弃【'+c.name+'】发动' });
    });
    out.push({ cardIdx: null, activate: false, label: '不发动' });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 不发动(与 EXCLUDE 时行为一致:机器人不发动,advanceXiaoguo 推进)
    return candidates.find(function(c){ return !c.activate; }) || candidates[candidates.length-1];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondXiaoguo(!!choice.activate, choice.cardIdx); });
  },
  buildSystemPrompt: function(g, seat){
    return botPromptWithIdentity('你在扮演网页版三国杀的AI机器人。当前是【骁果】发动询问:候选列表每一项是'
      +'"弃一张基本牌发动"或"不发动"。请结合局面决定是否发动。只输出 {"choice":数字},不要解释。', g, seat);
  },
  maxTokens: 60,
};

// buildSummaryPrompt:摘要任务的系统提示——要求"只记发生过的事、只记对后续决策有
// 用的事实",不写推测,直接输出纯文本。刻意和 callAiChooseIndex 的"只输出
// {"choice":数字}"约定分开,因为这是文本任务,不是选 index。
function buildSummaryPrompt(g, seat){
  return '你是网页版三国杀的AI机器人。请把"本局摘要"更新为最近状态的版本:'
    +'结合旧的摘要(如有)与最近发生的公开事件,重写一份不超过200字的摘要,'
    +'只记对后续决策有用的事实:谁对谁造成了伤害、谁救过谁、谁翻开了身份、'
    +'你自己的出牌意图与留牌计划、你观察到的嫌疑。只写发生过的事,不要写推测。'
    +'直接输出摘要文本,不要输出JSON、不要解释。';
}

// tryAiBotPlay:唯一的AI决策入口,返回 options 数组里的一项、或字符串 'pass'(选中了
// "结束出牌阶段"那个候选)、或 null(没有密钥/AI没有正确响应/索引不合法——这几种情况
// 一视同仁,统一交给 botPlay 落回本地启发式,不重试、不阻塞游戏)。
//
// 【超时上限,已确认的取舍】8~10秒的超时上限要求,直接复用 ai-bot.js 的 callAI 自带的
// AbortController 超时机制(目前是 AI_CALL_TIMEOUT_MS=15000),这里不额外包一层
// Promise.race 或 setTimeout——那是"重新发明"一套并行的超时逻辑,和"直接复用、不要
// 重新发明"这条要求矛盾。而这次任务的收尾范围明确写了"ai-bot.js的callAI等基础设施
// 本阶段不需要改动",两条要求字面上有一点冲突(15秒略宽于"8~10秒"),这里选择遵守
// "不改ai-bot.js"这条更明确的收尾约束、如实记录这个取舍,而不是为了凑那个数字回头
// 改动本阶段确认不动的文件。
async function tryAiBotPlay(g, seat, options){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const candidates = buildBotPlayCandidates(g, options);
  const state = buildBotVisibleState(g, seat);
  // 候选列表→索引的AI询问统一走 callAiChooseIndex(密钥守卫/单候选短路/思考指示/
  // 解析/越界校验/超时兜底全部收敛在总线骨架里,和 botDecide 共用同一套基础设施)。
  const idx = await callAiChooseIndex({
    g, seat,
    systemPrompt: buildBotPlaySystemPrompt(g, seat),
    userPrompt: buildBotPlayUserPrompt(state, candidates),
    candidates, maxTokens: 200,
  });
  if(idx===null) return null;
  if(idx===options.length) return 'pass';
  return options[idx];
}

// ================= AI机器人接入第三阶段:接入 botBestTarget(选目标)这个决策点 =================
// 【范围声明】唯一新增的AI决策点是"给已经决定要打出的、需要目标的牌挑一个目标"——不是
// 让 botBestTarget 本身变 async 后塞进 botPlay 枚举阶段的 forEach 里。枚举阶段要给
// options 里每一个候选算 value 才能排序,如果每张需要目标的手牌都在枚举时先问一次AI,
// 会在"到底决定出哪张牌"之前就打出多次AI请求,既偏离第二阶段"一次决策一次AI调用"的
// 既有形状,又没有意义(还没决定要不要打这张牌,选目标的决策没有意义)。
//
// 实现方式:botBestTarget(本地启发式)在枚举阶段完全不变,继续为每个候选算出一个默认
// 目标——这个默认目标就是"没有AI介入/AI失败时"的兜底,和第二阶段"无密钥回归行为完全
// 一致"同一原则,不需要额外的回退计算。等 botPlay 最终决定了 chosen(可能来自AI选牌、
// 也可能来自本地兜底)之后,如果这张牌需要目标且有AI密钥,才调用 tryAiBotBestTarget
// 针对这一张牌单独问一次AI该打谁——问到就用AI的答案覆盖 chosen.target,问不到就保留
// 枚举阶段已经算好的默认值。
//
// buildBotTargetCandidates:候选目标列表只包含真实通过 spec.canTarget 校验的座位(和
// botBestTarget 自己筛选合法目标的判断逐字一致),每一项直接复用 buildBotVisibleState
// 里对应座位已经算好的公开信息投影(seat/name/hp/maxHp/handCount/equips/delays/
// knownRole/general)——和"选牌"AI看到的隐藏信息范围是同一份、同一个函数产出,不重新
// 定义一套可见性规则。
function buildBotTargetCandidates(g, seat, card, actionId){
  const me = g.players[seat];
  const spec = CARD_PLAYS[actionId];
  const state = buildBotVisibleState(g, seat);
  const list = [];
  g.players.forEach((p,i)=>{
    if(!p||!p.alive||i===seat) return;
    if(spec && spec.canTarget && !spec.canTarget(g, me, card, i)) return;
    list.push(Object.assign({ index: list.length }, state.players[i]));
  });
  return list;
}

// BOT_STRATEGY_GUIDANCE_TARGET:第一阶段"通用部分"策略指导,选目标专用。两条来源:
// ①免疫检查提醒——直接对应调研中查到的AI常见错误反面案例"酒黑杀仁王"(黑杀对装备
// 仁王盾/拥有毅重这类"黑杀无效"能力的目标完全不生效,加成/强化这张杀纯属浪费),这类
// 具体规则错误值得专门提醒一句,让AI在选目标前先看一眼候选的公开装备/技能信息。
// ②手牌数量提醒——本地 botTargetScore(bot.js)的评分公式里,体力相关权重合计约
// (maxHp-hp)*8+(4-hp)*7,每点体力差贡献7~8分,而手牌数量只有(hand.length)*2,每张
// 手牌差只贡献2分,两者相差约7.5倍。调研查到的社区经验("没有手牌的人通常很容易死,
// 连反抗的余地都没有")说明手牌枯竭本身就是一个很强的"容易解决"信号,但本地公式对这个
// 维度的权重明显偏低、可能覆盖不足。这里刻意写成引导性描述而非"手牌数比血量更重要"这
// 种硬结论,只是让AI在本地分数接近的边界情况下多一个参考维度,不是要求AI推翻本地启发式
// 算出的顺序——避免二者经常正面对冲。若以后要优化本地公式本身,这条注释里的具体权重
// 数字和调研依据可以直接复用,不需要重新查证。
const BOT_STRATEGY_GUIDANCE_TARGET =
  '选目标前,留意这两点(是判断优先级的参考,不是必须遵守的硬规则):'
  +'先看候选目标当前的公开装备/技能信息,判断这次进攻会不会被直接免疫或化解——例如'
  +'黑色的杀对装备了仁王盾、或拥有"黑色杀无效"类技能的目标完全不生效,这种情况下换个'
  +'目标或换张牌通常更划算,不要平白浪费一次机会。除了看血量,也要留意候选目标的手牌'
  +'数量——手牌枯竭的目标往往比看起来血厚但手牌充足的目标更容易迅速解决,值得作为'
  +'参考维度之一。';

function buildBotTargetSystemPrompt(g, seat){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。你刚决定要使用/打出一张需要指定目标的牌,'
  +'现在需要从候选目标列表里选一名目标——列表每一项是一个座位真实合法可见的公开信息'
  +'(血量、装备、判定区、已知身份;其他角色的手牌你只知道张数,不知道具体是什么牌)。'
  +'你的任务只有一件事:从候选列表里选出一个index,代表这次要指定的目标——不能选择'
  +'列表之外的座位,不能凭空指定目标。'+BOT_STRATEGY_GUIDANCE_TARGET+botIdentityGuidance(g, seat)
  +'请只输出一个严格的JSON对象,格式固定为'
  +'{"choice": 数字},不要输出任何解释文字、代码块标记或多余字段。';
}

function buildBotTargetUserPrompt(state, card, actionId, candidates){
  return '你正在使用【'+actionId+'】(实际打出的牌:'+card.name+')。\n\n'
    +'当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选目标列表(index从0开始):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// tryAiBotBestTarget:和 tryAiBotPlay 同一套结构——返回一个合法座位号、或 null(没有
// 密钥/AI没有正确响应/索引不合法,统一交给调用方保留本地启发式已经算好的默认目标,
// 不重试、不阻塞)。解析直接复用 parseBotPlayAiChoice(两处AI回复都是同一个
// {"choice":N}格式,没必要另写一份)。超时同样直接复用 callAI 自带的机制,不额外包
// 一层——和 tryAiBotPlay 同一个已确认的取舍(见其顶部注释)。
async function tryAiBotBestTarget(g, seat, card, actionId){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  const candidates = buildBotTargetCandidates(g, seat, card, actionId);
  if(!candidates.length) return null; // 理论上不会发生:调用方已经确认至少有一个合法目标
  const state = buildBotVisibleState(g, seat);
  const idx = await callAiChooseIndex({
    g, seat,
    systemPrompt: buildBotTargetSystemPrompt(g, seat),
    userPrompt: buildBotTargetUserPrompt(state, card, actionId, candidates),
    candidates, maxTokens: 100,
  });
  if(idx===null) return null;
  return candidates[idx].seat;
}

// ================= AI机器人接入第四阶段:guhuoQuestion(于吉【蛊惑】质疑判断) =================
// 【范围声明】这批只接入 guhuoQuestion 一个决策点;ganglieChoice/guicai 留给以后单独的
// 批次分别验证,不在这次任务范围内(见 CLAUDE.md"AI机器人策略指导第四阶段"设计报告的
// 优先级排序)。
//
// 【隐藏信息约束,本次唯一需要新设计的部分,务必做对】d.actualCard(于吉扣置的那张牌的
// 真实内容)是对玩家隐藏的信息——本地启发式(runBotDecision 原有分支)用固定30%概率的
// 随机数模拟不完全信息决策,绝不偷看这张牌;AI决策同样不能看到它。buildBotGuhuoVisibleState
// 从头只构造这个决策真正该看到的字段:局面 state 部分直接复用 buildBotVisibleState——
// 它本身从不涉及 pending/actualCard,复用它不会引入风险;guhuoQuestion 专属的字段是
// 手工逐个挑选加进去的——sourceSeat/sourceName(于吉是谁,公开信息)、claimedCardName
// (于吉声明的内容本身就是公开动作,规则上任何人都能看到"他声称这是什么牌")。整个函数体
// 从第一行到最后一行都没有出现过 d.actualCard 这个引用,不是"先塞进完整视图再删掉这个
// 字段"那种更容易出错的写法(万一漏删就会真的泄露),是结构上从一开始就不可能引用到它。
function buildBotGuhuoVisibleState(g, seat){
  const d = g.pending;
  const state = buildBotVisibleState(g, seat);
  state.guhuo = {
    sourceSeat: d.sourceSeat,
    sourceName: (g.players[d.sourceSeat] && g.players[d.sourceSeat].name) || null,
    claimedCardName: d.claimedCard && d.claimedCard.name,
  };
  return state;
}

// buildBotGuhuoSystemPrompt:独立的、比 BOT_PLAY_SYSTEM_PROMPT 更短的专用 system
// prompt——这是一道二选一的判断题,不需要候选动作列表描述。第四阶段设计报告曾结论
// "不接身份局四阵营指导"(纯粹是"这张声明牌可信度"的判断),提示词增强批次 G2 按
// spec §2.2 决定改为接入(质疑与不质疑同样受敌我立场影响),统一走 botPromptWithIdentity。
// choice 的语义在这里显式约定:choice=1 表示"质疑"(question=true),choice=0 表示
// "不质疑"(question=false)——和 respondGuhuoQuestion(question) 的参数语义直接对应,
// 不需要额外的映射表。
function buildBotGuhuoSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。场上一名角色(于吉)刚扣置一张手牌,'
  +'声明它是某张具体的牌,并表示要当那张牌使用——你现在需要判断要不要质疑这个声明。'
  +'若你选择质疑:声明为真,你会获得一个负面效果(【缠怨】,此后永远不能再质疑于吉的'
  +'蛊惑);声明为假,这张牌会直接作废、不产生任何效果。若你选择不质疑:声明为真则'
  +'照常生效,声明为假也没有任何影响。你完全不知道这张牌真实是什么,只能根据这名角色'
  +'的行为倾向、场上局势等信息合理推断这次声明的可信度做出判断。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},其中 1 表示质疑、'
  +'0 表示不质疑,不要输出任何解释文字、代码块标记或多余字段。', g, seat);
}
function buildBotGuhuoUserPrompt(state){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象,1表示质疑、0表示不质疑。';
}

// 【本决策点的注册入口】BOT_DECISIONS.guhuoQuestion(见文件前面"响应类三兄弟"段):
// 候选=[不质疑,质疑](顺序与 prompt 的 choice 语义对齐:1=质疑在index1),localFallback
// 是旧硬编码分支的固定30%随机,execute 提交 respondGuhuoQuestion(question);AI视角经
// extraState=buildBotGuhuoVisibleState 构造,结构上不可能引用到 d.actualCard。
//
// 【mySeat 借用窗口,已核实确认不需要】respondGuhuoQuestion(skills.js)内部对 mySeat
// 的唯一引用是标准的调用者身份守卫(g.pending.asking!==mySeat)和 g.players[mySeat]
// 取值,这两处都由 botDecide 的 execute 用既有的 botInvoke(seat,fn) 包装(mySeat=seat;
// 同步执行;立刻归还)正确处理,和其余30多个响应类分支(respondShan/duelResponse等)
// 完全一样——不是 botPlay 枚举阶段那种"需要在调用真正的动作函数之前,先用全局 mySeat
// 跑一遍 CARD_PLAYS.canPlay/canTarget 筛出候选"的特殊场景(这个决策是二选一判断题,
// 不涉及任何候选枚举,不读 CARD_PLAYS)。函数内部另有一处 mySeat 的临时切换
// (runGuhuoAsSource,发生在蛊惑判定为真、真正结算 spec.effect 时),但那是把 mySeat
// 切到"于吉自己的座位"、且完全内嵌在 respondGuhuoQuestion 触发的同一次同步 tx 调用
// 链里、finally 里会自动切回去——是游戏引擎自身的既有机制,和"谁/怎么触发了
// respondGuhuoQuestion"无关,不需要机器人决策层做任何特殊处理。因此这次不需要额外的
// 借用窗口,直接用标准的 botInvoke 包装即可。

// ================= AI机器人接入第四阶段第二批:ganglieChoice(夏侯惇【刚烈】弃牌还是
// 受伤) =================
// 【范围声明】这批是第四阶段第二批的第一个,和第一批 guhuoQuestion 同一个"判断题型"
// 决策模式,复用同一套解析/回退/并发保护机制,只新增决策本身的视图构造和 prompt。
// guicai 是第二批的第二个,单独一次commit,不和这次合并。
//
// 【mySeat 借用窗口,已实际核实、不是照抄guhuoQuestion的结论就假设一定适用】读了
// respondGanglieChoice(game.js)的完整函数体:守卫是标准的调用者身份守卫
// (g.pending.sourceSeat!==mySeat),函数体内部只用 g.pending 解出的 seat/sourceSeat/
// resume 这几个局部变量操作 g.players[sourceSeat].hand,从头到尾没有第二处引用
// mySeat,也不调用任何依赖全局 mySeat 的 CARD_PLAYS.canPlay/canTarget——和
// respondGuhuoQuestion 是完全相同的形状(响应者对自己的一次判断,不涉及候选枚举),
// 结论同样是:不需要额外借用窗口,标准 botInvoke(seat,fn) 包装即可正确处理身份守卫。
//
// 【隐藏信息】这个决策的响应者(sourceSeat)判断的是关于他自己的选择(弃自己的手牌还是
// 自己受伤),不涉及需要对他隐藏的信息——但仍然构造专门的 buildBotGanglieVisibleState,
// 不直接把完整的 g/player 对象喂给AI,做法和 buildBotGuhuoVisibleState 一致:复用
// buildBotVisibleState(g,seat)得到的安全投影(已经包含myHand的完整内容——这是这个
// 座位自己的手牌,对他自己公开完全合理),再补一个 ganglie 专属字段:discardIndices——
// 若选择"弃牌",游戏规则固定弃掉 myHand 数组下标0和1这两张(respondGanglieChoice 的
// 本地回退/AI回退都不做选牌,只做"弃牌还是受伤"这个二元判断,选牌维度不在这次范围内),
// 让AI能直接对着 myHand[0]/myHand[1] 判断这两张具体的牌值不值得留,而不是凭空猜测
// "弃牌"这个选项到底会弃掉哪两张。
function buildBotGanglieVisibleState(g, seat){
  const state = buildBotVisibleState(g, seat);
  state.ganglie = {
    hpIfDamaged: state.myHp - 1,
    discardIndices: state.myHand.length>=2 ? [0,1] : [],
  };
  return state;
}

// BOT_GANGLIE_SYSTEM_PROMPT:choice=1 表示"弃牌"(discard),choice=0 表示"受伤"
// (damage)——respondGanglieChoice(action,picks) 的 action 参数直接对应
// ('discard'/'damage'),不需要额外映射表。直接引用第一阶段"通用部分"里已经写好的
// "1点体力≈2张手牌"这句价值判断(和调研阶段的结论一致:这条经验本身就足够覆盖大部分
// 场景,不需要另起一套框架),再补一句提醒AI同时评估"这两张即将被弃掉的牌具体值不值得
// 留"和"当前体力安全边际"——这两个维度是本地固定启发式(总是选弃牌,只要手牌够两张)
// 完全没有考虑的,正是调研阶段指出的、AI能比机械规则做得更好的地方。
function buildBotGanglieSystemPrompt(g, seat){
  return botPromptWithIdentity('你在扮演一款网页版三国杀里的AI机器人玩家。你(被夏侯惇【刚烈】判定命中后需要'
  +'做选择的伤害来源)现在需要在两个选项里选一个:弃置手牌中两张具体的牌(不能挑,固定'
  +'弃掉局面里 myHand 数组下标0和1对应的那两张,已在局面数据的 ganglie.discardIndices'
  +'里标出),或者受到1点伤害。判断依据可以参考:1点体力大致相当于2张手牌的价值,可以据此'
  +'判断值不值得为了保命搭上这两张牌——但这不是唯一维度,还要具体看这两张即将被弃掉的牌'
  +'本身值不值得留(是不是杀/闪/桃/装备/关键锦囊这类高价值牌),以及你当前的体力安全'
  +'边际(血量已经很低、手里又缺桃这类救命牌时,即使多花两张牌也应该优先保留体力;血量'
  +'充裕、这两张牌明显有用时,选择受伤反而更划算)。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},其中 1 表示弃牌、'
  +'0 表示受到伤害,不要输出任何解释文字、代码块标记或多余字段。', g, seat);
}
function buildBotGanglieUserPrompt(state){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象,1表示弃牌、0表示受伤。';
}

// 【本决策点的注册入口】BOT_DECISIONS.ganglieChoice(见文件前面"响应类三兄弟"段):
// 候选=[受伤, 弃置2张(手牌>=2时)](顺序与 prompt 的 choice 语义对齐:1=弃牌在index1),
// localFallback 与旧硬编码分支逐字一致,execute 提交 respondGanglieChoice(action,picks)。

// ================= AI机器人接入第四阶段第二批:guicai(郭嘉【鬼才】要不要发动改判)
// =================
// 【范围声明】这批是第四阶段第二批的第二个,独立于 ganglieChoice 单独commit。覆盖面
// 最广(8种判定类型,由 finishGuicai 的 resume.kind 分派表决定),需要专门设计一个能
// 适配不同判定上下文的通用prompt结构,不是照抄guhuoQuestion/ganglieChoice就能直接用。
//
// 【mySeat 借用窗口,已实际核实、不是照抄前两批的结论就假设一定适用】读了
// respondGuicai(game.js)的完整函数体:守卫是标准的调用者身份守卫
// (g.pending.asking!==mySeat),函数体内部只用 g.players[mySeat] 取自己、操作自己的
// 手牌,从头到尾没有第二处引用 mySeat,也不调用任何依赖全局 mySeat 的
// CARD_PLAYS.canPlay/canTarget——和 guhuoQuestion/ganglieChoice 是完全相同的形状,
// 结论同样是:不需要额外借用窗口,标准 botInvoke(seat,fn) 包装即可。
//
// 【隐藏信息】判定牌(judgeCard)本身在 judge() 里就已经写进公开日志("判定牌:红桃3"),
// 是公开信息,不是需要对响应者隐藏的东西;响应者自己的手牌通过 buildBotVisibleState 里
// 的 myHand 天然可见(这本来就是他自己的手牌)。这个决策不涉及需要隐藏的信息,但仍然
// 构造专门的 buildBotGuicaiVisibleState,不直接把完整的 g/player 对象喂给AI。
//
// 【选牌维度:设计决定,不是"沿用现有本地逻辑"——因为本地逻辑此前压根没有选牌能力】
// respondGuicai(useReplace,cardIdx) 允许用任意一张手牌替换判定牌,没有额外限制;而
// 改动前的本地启发式是硬编码 respondGuicai(false)(永远不发动,从不需要选牌)。这意味着
// "只做要不要发动、选牌沿用本地逻辑"这个方案没有本地逻辑可沿用——一旦AI决定要发动,
// 必须由这次AI调用自己选出用哪张牌,不存在第二层可独立复用的既有默认值。采用的方案是
// 把"要不要发动"和"发动的话用哪张牌"合并进同一次AI调用、同一个候选列表——完全复用
// botPlay 已经验证过的"候选列表+index"模式(不是发明新的响应格式):
// buildBotGuicaiCandidates 产出 index=0("不发动")+ 每张手牌各一项("打出这张牌替换")的
// 列表,AI 选一个 index,解析仍然是现成的 parseBotPlayAiChoice({"choice":N}),不需要
// 引入新的JSON字段。无密钥/AI失败/index不合法时的回退是 {replace:false}——和改动前
// respondGuicai(false) 这个硬编码默认完全一致,是这次改动的回归基线。
// 手牌为空的座位理论上不会被问到(firstGuicaiAsker/nextGuicaiAsker 已经要求候选人
// (p.hand||[]).length>0 才算有资格),但 guicaiHandPick 注册项仍防御性地在候选列表只有
// "不发动"这一项时跳过AI调用、不浪费一次网络请求(botDecide 的单候选短路)。
function buildBotGuicaiCandidates(g, seat){
  const me = g.players[seat];
  const list = [{ index:0, action:'不发动【鬼才】', handIndex:null, card:null }];
  (me.hand||[]).forEach((c,i)=>{
    list.push({ index:list.length, action:'发动【鬼才】,打出这张牌替换判定牌', handIndex:i, card:botCardBrief(c) });
  });
  return list;
}

// guicaiOutcomeDescription:这批唯一需要新设计的部分——把"当前是哪种判定+判定结果对
// 局势的具体影响"组织进prompt。按 resume.kind(及 delayJudge 下的 trickName)分派,
// 每种判定类型各自描述"如果不替换,当前这张已经判定出来的牌具体会带来什么后果"(不是
// 抽象讲规则,是结合真实的 judgeCard 花色/点数给出确定性的结论)——这样AI不需要自己
// 从头理解八卦阵/闪电/铁骑/洛神/双雄/悲歌/刚烈/雷击这8种判定各自的规则,直接看这句
// 结论就知道"保留 vs 替换"分别意味着什么。覆盖 finishGuicai 分派表里全部 resume.kind
// (包括这次顺带补齐的 leijiJudge,见 game.js 的 finishGuicai 修复注释)。
function guicaiOutcomeDescription(g, resume, judgeCard, judgedSeat){
  const jp = g.players[judgedSeat];
  const judgedName = (jp && jp.name) || '判定者';
  const cardDesc = judgeCard.suit+rankText(judgeCard.rank);
  const isRed = judgeCard.suit==='♥' || judgeCard.suit==='♦';
  switch(resume.kind){
    case 'bagua': {
      if(resume.type==='sha'){
        return isRed
          ? judgedName+' 当前判定'+cardDesc+'(红色),若不替换将视为出闪抵消这张杀,'+judgedName+' 不受伤害。'
          : judgedName+' 当前判定'+cardDesc+'(黑色),若不替换八卦阵判定失败,'+judgedName+' 仍需正常打出闪或受到伤害。';
      }
      return isRed
        ? judgedName+' 当前判定'+cardDesc+'(红色),若不替换将抵消这次群体锦囊效果,'+judgedName+' 不受影响。'
        : judgedName+' 当前判定'+cardDesc+'(黑色),若不替换八卦阵判定失败,'+judgedName+' 仍需正常应战。';
    }
    case 'delayJudge': {
      if(resume.trickName==='闪电'){
        const hit = judgeCard.suit==='♠' && judgeCard.rank>=2 && judgeCard.rank<=9;
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(黑桃2~9),若不替换【闪电】生效,'+judgedName+' 将受到3点无来源伤害。'
          : judgedName+' 当前判定'+cardDesc+',若不替换【闪电】判定失败,将传给下家,'+judgedName+' 本人不受影响。';
      }
      if(resume.trickName==='乐不思蜀'){
        const hit = judgeCard.suit!=='♥';
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(非红桃),若不替换【乐不思蜀】生效,'+judgedName+' 将跳过下一个出牌阶段。'
          : judgedName+' 当前判定'+cardDesc+'(红桃),若不替换【乐不思蜀】判定失败,'+judgedName+' 不受影响。';
      }
      if(resume.trickName==='兵粮寸断'){
        const hit = judgeCard.suit!=='♣';
        return hit
          ? judgedName+' 当前判定'+cardDesc+'(非梅花),若不替换【兵粮寸断】生效,'+judgedName+' 将跳过下一个摸牌阶段。'
          : judgedName+' 当前判定'+cardDesc+'(梅花),若不替换【兵粮寸断】判定失败,'+judgedName+' 不受影响。';
      }
      return judgedName+' 当前判定'+cardDesc+'。';
    }
    case 'tieqiJudge': {
      return isRed
        ? '攻击者的【铁骑】当前判定'+cardDesc+'(红色),若不替换,这张杀将不可被闪抵消。'
        : '攻击者的【铁骑】当前判定'+cardDesc+'(黑色),若不替换,判定无效,这张杀可以正常被闪抵消。';
    }
    case 'luoshenJudge': {
      const isBlack = judgeCard.suit==='♠' || judgeCard.suit==='♣';
      return isBlack
        ? judgedName+' 的【洛神】当前判定'+cardDesc+'(黑色),若不替换,'+judgedName+' 将获得这张判定牌并可以选择继续判定。'
        : judgedName+' 的【洛神】当前判定'+cardDesc+'(红色),若不替换,判定结束,'+judgedName+' 不获得这张牌。';
    }
    case 'shuangxiongJudge': {
      return judgedName+' 的【双雄】当前判定'+cardDesc+'('+(isRed?'红色':'黑色')+'),若不替换,本回合 '+judgedName+' 可以将'+(isRed?'黑色':'红色')+'手牌当决斗使用。';
    }
    case 'beigeJudge': {
      const isRedPeach = judgeCard.suit==='♥';
      return isRedPeach
        ? '蔡文姬的【悲歌】当前判定'+cardDesc+'(红桃),若不替换,伤害来源将回复1点体力。'
        : '蔡文姬的【悲歌】当前判定'+cardDesc+'(非红桃),若不替换,伤害来源需要弃置2张手牌。';
    }
    case 'ganglieJudge': {
      const isRedPeach = judgeCard.suit==='♥';
      return isRedPeach
        ? '夏侯惇的【刚烈】当前判定'+cardDesc+'(红桃),若不替换,无事发生。'
        : '夏侯惇的【刚烈】当前判定'+cardDesc+'(非红桃),若不替换,伤害来源需要在弃两张手牌与受到1点伤害之间选择。';
    }
    case 'leijiJudge': {
      const isSpade = judgeCard.suit==='♠';
      return isSpade
        ? '张角的【雷击】当前判定'+cardDesc+'(黑桃),若不替换,目标将受到2点雷电伤害。'
        : '张角的【雷击】当前判定'+cardDesc+'(非黑桃),若不替换,【雷击】无效。';
    }
    default:
      return judgedName+' 当前判定'+cardDesc+'。';
  }
}

function buildBotGuicaiVisibleState(g, seat){
  const d = g.pending;
  const state = buildBotVisibleState(g, seat);
  state.guicai = {
    judgedSeat: d.seat,
    judgedSeatIsSelf: d.seat===seat,
    judgeCard: botCardBrief(d.judgeCard),
    outcomeIfKept: guicaiOutcomeDescription(g, d.resume, d.judgeCard, d.seat),
  };
  return state;
}

// BOT_GUICAI_SYSTEM_PROMPT:不接身份局四阵营guidance(这批的核心是"这次改判对局势具体
// 有什么影响"这个判定上下文本身,和guhuoQuestion/ganglieChoice同一原则先保持简单;
// guicai天然更贴近阵营博弈——判定往往发生在别人身上,是否要干预确实可能和敌我关系有关——
// 但任务范围没有要求接入,这里刻意不做,留作以后如果需要再单独评估的候选项,不是这次
// 顺手写死的架构决定)。明确提醒"判定发生在别人身上时,你是第三方视角在决定要不要干预",
// 这是调研阶段指出的、guicai和前两批本质不同的地方("响应者是被动的第三方,不是发起者")。
function buildBotGuicaiSystemPrompt(){
  return '你在扮演一款网页版三国杀里的AI机器人玩家。场上刚发生一次判定,你(拥有郭嘉'
  +'【鬼才】技能)可以选择打出一张手牌替换这张判定牌,或者不发动、保留原判定结果。'
  +'局面数据里的 guicai 字段会说明:这次判定是谁的(judgedSeat)、判定牌具体是什么'
  +'(judgeCard)、如果保留不替换会发生什么(outcomeIfKept)。你需要判断:这个结果对'
  +'局势是有利还是不利,值不值得牺牲一张手牌去改变它——判定发生在别的角色身上时'
  +'(guicai.judgedSeatIsSelf为false),你是以第三方视角在决定要不要干预这次判定,'
  +'不是替判定者本人做决定。合法候选列表里,每一项对应"不发动"或"打出某张具体手牌'
  +'替换",请从候选列表里选出一个index,不能凭空发明选项。'
  +'请只输出一个严格的JSON对象,格式固定为 {"choice": 数字},不要输出任何解释文字、'
  +'代码块标记或多余字段。';
}
function buildBotGuicaiUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选动作列表(index从0开始,0是"不发动"):\n'+JSON.stringify(candidates)
    +'\n\n只返回 {"choice": 数字} 这一个JSON对象。';
}

// 【本决策点的注册入口】BOT_DECISIONS.guicaiHandPick(见文件前面"响应类三兄弟"段):
// buildCandidates 复用 buildBotGuicaiCandidates 的形状并补 replace 标志;无密钥回退
// {replace:false} 与改动前 respondGuicai(false) 这个硬编码默认完全一致,是回归基线。
// 手牌为空的座位理论上不会被问到(firstGuicaiAsker/nextGuicaiAsker 已经要求候选人
// (p.hand||[]).length>0 才算有资格),但候选列表只剩"不发动"一项时 botDecide 的单候选
// 短路也会跳过AI调用、不浪费一次网络请求。

// 【遗留实现,仅测试引用】Milestone C1 起 runBotDecision 的 play 分支改走 runBotActionWindow
// (弱C:一次调度一步、牌×目标合并候选)。botPlay 保留不删——run_ai_bus_l2 测试仍直接
// 调用它,且它的"最高价值>25 才打"本地启发式是弱C兜底(localFallbackPlayWindow)的行为基准。
async function botPlay(g,seat){
  // CARD_PLAYS 的合法性函数沿用旧架构，会读取全局 mySeat；评估阶段也必须切到机器人
  // 视角，不能只在最后真正提交动作时才切。
  const humanSeat=mySeat;
  mySeat=seat;
  let options;
  try{
    const me=g.players[seat];
    options=[];
    (me.hand||[]).forEach((card,idx)=>{
      const action=botActionId(card),spec=CARD_PLAYS[action];
      // 【Milestone B L3 最小集——出牌排除牌审计,行号对照 game.js】
      // ①借刀杀人(game.js ~2579):effect:()=>{} 刻意留空,真实效果是"选A(持武器者)→
      //   选B(A攻击范围内)"两步专用流程 jieDaoShaRen,单目标 playCard 模型无法表达 →
      //   保持排除,完整支持(同窗口多步)属 Milestone C。
      // ②铁索连环(game.js ~2626):target:true/allowSelf:true,effect 接受单目标或数组
      //   (单目标 [targetSeat] 合法,startTieSuoTargets 收 1 目标)→ 纳入,由
      //   botBestTarget 照常选他人为目标;重铸(recast)是独立动作、不经 playCard →
      //   不在本模型内,记录为后续候选,不视为缺口。
      // ③闪电(delayTrickPlay,game.js ~2701):target:true/allowSelf:true 且
      //   DELAY_TRICKS['闪电'].onlySelf:true(合法目标只有自己)→ botBestTarget
      //   跳过自己返回 -1,由下方 allowSelf 自目标兜底纳入——通用写法,不按牌名特判。
      if(!spec||action==='借刀杀人') return;
      if(!spec.canPlay(g,me,card)) return;
      // 忠臣不主动使用会伤到主公的群体牌。
      if(me.role==='zhong'&&(action==='南蛮入侵'||action==='万箭齐发')) return;
      let target=null;
      if(spec.target){
        target=botBestTarget(g,seat,card,action);
        // L3 最小集:onlySelf 型延时锦囊(闪电)的合法目标只有自己,botBestTarget 刻意跳过
        // 自己(i===seat)会返回 -1。generic 兜底:allowSelf 且 canTarget 对己为真时直接以
        // 自己为目标(不查 botTargetScore —— 它对 seat===targetSeat 恒为 -Infinity,会
        // 把 value 污染成 -Infinity)。铁索连环有他人可打,botBestTarget 正常返回,不走这里。
        if(target<0 && spec.allowSelf && spec.canTarget(g,me,card,seat)) target=seat;
        if(target<0) return;
      }
      let value=botCardPriority(action);
      if(action==='桃'&&me.hp>=me.maxHp) return;
      if(target!==null && target!==seat) value+=botTargetScore(g,seat,target,action);
      options.push({idx,action,target,value});
    });
    options.sort((a,b)=>b.value-a.value);
  } finally {
    // 【正确性要点,不是可选优化】枚举阶段(需要 mySeat=seat 供 CARD_PLAYS 的
    // canPlay/canTarget 读取)到此结束就立刻交还 mySeat,不能跨越接下来可能出现的
    // AI 网络等待(最长约15秒,见 tryAiBotPlay 顶部注释)——mySeat 是全局的、瞬时的
    // "当前视角",如果在 await 期间继续占着它,这段等待期间真人一切读取 mySeat 的
    // 操作(渲染/点击)都会被误判成机器人自己的座位。这是把 botPlay 从同步改成 async
    // 之后必须处理的正确性问题:改动前 mySeat 的借用窗口和整个函数体一样短(纯同步、
    // 微秒级);改动后如果不提前归还,借用窗口会被 AI 等待拉长到最多15秒,足以让真人
    // 在这段时间内的任何交互读到错误的座位号。
    mySeat=humanSeat;
  }

  // aiReady 只算一次,card选择/target选择两处AI决策共用同一个判断,不重复写三遍
  // 同一个条件表达式。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;

  let chosen=null;
  if(aiReady){
    chosen = await tryAiBotPlay(g, seat, options);
  }
  if(chosen===null){
    // 与改动前逐字一致的本地启发式——没有密钥、AI没有正确响应(网络/超时/解析失败/
    // 索引越权)全部落到这里,是同一条兜底路径,不单独区分失败原因(第一阶段方案确认
    // 的原则)。没有密钥这一支和改动前行为完全相同,是这次改动的回归基线。
    if(options.length && options[0].value>25) chosen = options[0];
    else chosen = 'pass';
  }

  // 【第三阶段新增】chosen 需要目标、且有AI密钥时,针对这一张已经确定要打出的牌单独
  // 问一次AI该指定谁为目标——这是"决定出什么牌"之后紧接着的第二个、独立的AI决策,不是
  // 提前塞进上面的枚举阶段。mySeat 此刻已经在上面枚举阶段的 finally 里还给真人了,这里
  // 完全没有再碰 mySeat——buildBotTargetCandidates/buildBotVisibleState/
  // tryAiBotBestTarget 全部只读 g/seat 参数,不依赖也不修改 mySeat,这段AI等待期间
  // mySeat 全程保持人类自己的座位。这不是"重新实现"第二阶段那套mySeat窗口处理方式,
  // 是天然沿用——这段新代码从头到尾没有任何一行触碰 mySeat,自然不会重新踩那个坑。
  // AI选中的目标为 null(没有密钥/AI失败/索引越权)时,chosen.target 保留 botBestTarget
  // 在枚举阶段已经算好的本地默认目标,不需要额外的回退计算。
  if(aiReady && chosen!=='pass' && CARD_PLAYS[chosen.action] && CARD_PLAYS[chosen.action].target){
    const me = g.players[seat];
    const card = me.hand[chosen.idx];
    const aiTarget = await tryAiBotBestTarget(g, seat, card, chosen.action);
    if(aiTarget!==null) chosen.target = aiTarget;
  }

  // 真正执行决策的这一刻,再借用一次 mySeat——botInvoke 本身就是"借用→同步执行→立刻
  // 归还"这套既有写法(见文件前面 botInvoke 的定义),不会跨越任何 await,和改动前的
  // 借用窗口性质完全相同。
  if(chosen==='pass') botInvoke(seat, endPlay);
  else botInvoke(seat, ()=>playCard(chosen.idx, chosen.action, chosen.target));
}
// 机器人"此刻能不能打出【杀】"的统一判断。手里有没有杀是一回事,规则允不允许是另一回事 ——
// 曹彰【将驰】选项1 期间服务端 respondJiedao/duelResponse/aoeRespond 都会一上来就
// if(jiangchiNoSlash) return g 原地拒绝,而机器人是无状态重算的:盲答"用杀"会被拒 → 状态不变
// → 下次醒来重算得到同样结论 → 永久死循环(真人能改点别的选项逃出来,机器人不会改主意)。
// 【通用要求】新增任何"要不要打出某张牌"的决策分支时,都要先问一句"服务端除了牌够不够,
// 还有没有别的前置条件会拒绝我" —— 照 pick 分支"先探测实际可选项、再决定答什么"的写法,
// 不要盲答。
function canBotPlaySha(p){
  return !!p && !p.jiangchiNoSlash;
}
// 机器人"此刻能不能用桃救这个濒死者"的统一判断(respond 的 noShan、这里的贾诩【完杀】,
// 都是同一类"决策先探测服务端再决定"的实例,见上面 canBotPlaySha 那段注释——不要每次
// 重新论证,直接照这个范式补)。逐字对照 respondDying 服务端那段"辅诩【完杀】"检查写的,
// 不是简化版:完杀生效期间(g.wanshaActive 且濒死者正是 g.wanshaDyingSeat)、且贾诩本人
// 正在其回合内(findPlayerWithCap 找到的贾诩座位===g.turn)时,只有贾诩自己或濒死者本人
// 能用桃,其余人一律不能——盲答"能救"会被服务端原地拒绝、状态不变,永久死循环。
function canBotUseTaoForDying(g, seat, dyingSeat){
  if(!(g.wanshaActive && g.wanshaDyingSeat===dyingSeat)) return true;
  const jiaxuSeat = findPlayerWithCap(g, 'wansha');
  if(jiaxuSeat===null || jiaxuSeat!==g.turn) return true;
  return seat===jiaxuSeat || seat===dyingSeat;
}
function botCanSave(g,seat,dyingSeat){
  const me=g.players[seat], dying=g.players[dyingSeat];
  if(seat===dyingSeat) return true;
  // 【组队模式修复,主动助攻第一项】自救之外的"该不该救"判断此前完全按身份局role分支
  // 走,组队模式没有role(恒null),落进最后的return false——机器人永远不会用桃救队友,
  // 只能自救。加一条team分支:队友无条件救(和sameTeam同一个唯一判队友入口),敌方不救
  // (团队对抗里没有"内奸/反贼"这类中间身份需要权衡,直接二元判断)。
  if(g.gameMode==='team') return sameTeam(g,seat,dyingSeat);
  if(me.role==='zhong') return dying.role==='zhu'||(dying.roleRevealed&&dying.role==='zhong');
  if(me.role==='zhu') return dying.roleRevealed&&dying.role==='zhong';
  if(me.role==='fan') return dying.roleRevealed&&dying.role==='fan';
  if(me.role==='nei') return dying.role==='zhu'&&dying.hp<=0;
  return false;
}
function botPickGeneral(g,seat,lordPick){
  const p=g.players[seat], choices=(p.generalChoices||[]).filter(id=>GENERALS[id]);
  if(!choices.length) return;
  const score=id=>{
    const gen=GENERALS[id], text=(gen.skill||'')+(gen.desc||'');
    return generalMaxHp(id)*12+
      (/回复|摸.*牌|防止|免疫|闪/.test(text)?16:0)+
      (/伤害|杀|弃置/.test(text)?10:0)+(lordPick&&/主公|回复|防止/.test(text)?20:0);
  };
  choices.sort((a,b)=>score(b)-score(a));
  botInvoke(seat,()=>lordPick?respondPickLordGeneral(choices[0]):respondPickGeneral(choices[0]));
}
function botSafePrompt(g,seat){
  // 使用现有 UI 的“拒绝/取消/跳过”按钮作为未知技能的防卡兜底。它只点击会立即提交的
  // 保守按钮，不尝试驱动需要多步本地选牌的发动流程。
  const real=document.getElementById('controls');
  if(!real) return false;
  const oldId=real.id; real.id='human-controls';
  const box=document.createElement('div'); box.id='controls'; box.style.display='none';
  document.body.appendChild(box);
  const humanSeat=mySeat; mySeat=seat;
  try{
    renderControls(g);
    const buttons=[...box.querySelectorAll('button:not(:disabled)')];
    const safe=buttons.find(b=>/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/.test(b.textContent||''));
    const mandatory=buttons.find(b=>!/发动/.test(b.textContent||'')&&/选择|交给|弃置|摸牌|回复|打出/.test(b.textContent||''));
    const chosen=safe||mandatory||(buttons.length===1?buttons[0]:null);
    // botClickInProgress:见其声明处注释——和 L1 的 controlsChoiceExecute 同一约定,
    // 兜底点击同样不该弹真人专属的确认框。
    if(chosen){
      botClickInProgress = true;
      try{ chosen.click(); } finally { botClickInProgress = false; }
      return true;
    }
  } catch(e) {
    console.warn('bot fallback',e);
  } finally {
    botClickInProgress = false;
    mySeat=humanSeat; box.remove(); real.id=oldId;
    if(typeof currentG!=='undefined'&&currentG) renderControls(currentG);
  }
  return false;
}
// 【async 的唯一理由】这个函数的绝大多数分支(respond/aoeResp/duel/dying/…30+个)全部
// 保持同步不变——只有 g.phase==='play' 这一条分支需要 await botPlay(g,seat)。botPlay
// 内部可能因为AI调用而异步等待,且可能连续等待两次(先问"出什么牌",牌需要目标时再问
// "打给谁",见 tryAiBotPlay/tryAiBotBestTarget 的注释)——这两次AI调用都完整嵌套在这
// 一次 await botPlay(g,seat) 里,不需要在这里(runBotDecision)单独再 await 一次
// botBestTarget,那不是它现在的调用形状。async function 包裹一段同步代码不影响其行为
// (相当于自动包一层 resolved promise),所以其它分支原样照抄、零改动。
// 【调试日志系统 bot_decision_failed TODO】目前只在 runBotActionWindow(强C同窗多步循环)
// 里接了"等不到提交确认"这一处(见其内部 executePlayWindowChoiceAwait 超时分支),因为那里
// 恰好已经有"execute后拿到提交后的新快照"这个现成信号。这个函数(runBotDecision)下面绝大
// 多数分支都是 botInvoke(seat, fn) 后直接 return,fire-and-forget、没有等提交回调,要接入
// "提交前后状态是否真的变化"需要给每个分支都补 onCommitted 参数,改动面较大,这次不做——
// 留 TODO,以后要接的话优先从 seatPick/botTwoStepA 这类高频分支开始。
async function runBotDecision(g,seat){
  const p=g.players[seat];
  if(!p||!p.alive&&g.phase!=='pickingGeneral') return;
  // 【AI托管】托管中的真人座位视同机器人:放行其进入决策(各分支的 d.X===seat 复核
  // 仍然有效,托管座位同样要满足所在阶段的身份守卫)。托管关闭时判定恒 false,行为与
  // 托管前完全一致(非机器人一律被拦)。
  const isAutopilot=(typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
    && aiTestAutopilot.seat===seat;
  if(!p.isBot&&!isAutopilot) return;
  // 【AI托管】每次托管决策追加一条信息窗 record。hook 内部自行组装 stateInfo/reason
  // (reason 回退 aiTestLastReason);prompt/rawResponse 来自 callAiChooseIndex 写下的
  // aiTestLastCall(托管命中时有值)。choice 传 null 表示"未知具体动作"(execute 后的真实
  // 动作摘要由后续任务回填)。采集失败绝不影响决策主流程,故外层再包一层 try/catch。
  if(isAutopilot && typeof aiTestDecisionHook==='function'){
    try{
      // 注意:hook 在决策分支执行前调用,此时本次 AI 调用尚未发生——prompt/rawResponse
      // 一律传空,绝不读 aiTestLastCall/aiTestLastReason(那是上一条决策的缓存,读了会把
      // 上一条 AI 数据错误地贴到本条记录上,多条记录重复显示同一内容)。本次 AI 调用的
      // prompt/rawResponse/choice/reason 由 callAiChooseIndex 解析完成后经
      // aiTestFillLastRecord 回填到"最后一条待填充记录"。
      aiTestDecisionHook(g, seat, {
        summary: '决策(' + g.phase + ')',
        prompt: '',
        rawResponse: '',
        choice: undefined,  // hook 内部不再回退旧值(避免上一条数据污染),待回填
        reason: undefined
      });
    }catch(e){ /* 防御:采集异常不影响决策主流程 */ }
  }
  const d=g.pending||{};
  if(g.phase==='pickingLordGeneral'){
    // 决策已进 BOT_DECISIONS.pickGeneral(无密钥回退=botPickGeneral 打分,与旧分支逐字
    // 一致,见注册表上方注释)。phase 守卫保留作双保险。
    if(await botDecide('pickGeneral',g,seat)) return;
  }
  if(g.phase==='pickingGeneral'){
    if(await botDecide('pickGeneral',g,seat)) return;
  }
  if(g.phase==='huashenPick'&&d.seat===seat){
    // 决策已进 BOT_DECISIONS.huashenSkill(无密钥回退=池里第一个可用技能将,与旧分支
    // 逐字一致,见注册表上方注释)。phase+seat 守卫保留作双保险,命中即 return。
    if(await botDecide('huashenSkill',g,seat)) return;
  }
  if(g.phase==='guanxingReview'&&d.seat===seat){
    // 决策已进 BOT_DECISIONS.guanxing(默认方案=旧行为"全置顶原序",逐字一致,见注册表
    // 上方注释)。phase+pending.seat 守卫保留作双保险,命中即 return。
    if(await botDecide('guanxing',g,seat)) return;
  }
  if(g.phase==='xunxunPick'&&d.seat===seat){
    const all=(d.cards||[]).map((_,i)=>i),take=d.takeN||2;
    botInvoke(seat,()=>respondXunxun(all.slice(0,take),all.slice(take))); return;
  }
  if(g.phase==='yijiAssign' && d && d.type==='yijiAssign' && d.seat===seat){
    // 决策已进 BOT_DECISIONS.yijiAssign(无密钥回退=给 自己;改动前无覆盖=botSafePrompt
    // 兜底点不到"给 X"按钮只告警不动作,机器人遗计分配必然卡死,见注册表上方注释)。
    // phase+type+seat 守卫保留作双保险,命中即 return。跨调度累积:挂起期间本阶段
    // phase 仍是 yijiAssign、上面 botTwoStepA 的 play 分支(要求 phase==='play')不
    // 会挡路,下一调度自然回到本分支继续选下一张。
    if(await botDecide('yijiAssign',g,seat)) return;
  }
  if(g.phase==='lirangAsk' && d && d.type==='lirangAsk' && d.from===seat){
    // 决策已进 BOT_DECISIONS.lirangAsk(无密钥回退=不发动,与改动前 botSafePrompt 点击
    // "不发动"按钮逐字等价;有密钥 AI 从 2 张手牌组合里选,选完即提交 respondLiRang)。
    // phase+type+from 守卫保留作双保险,命中即 return。单阶段决策:目标=pending.to 由
    // 服务端定,AI 只选组合,一次 botDecide 即完成,无跨调度累积。
    if(await botDecide('lirangAsk',g,seat)) return;
  }
  if(g.phase==='xiaoguo' && d && d.type==='xiaoguo' && d.asking===seat){
    // 【A1】决策已进 BOT_DECISIONS.xiaoguo(无密钥回退=不发动,与改动前 botSafePrompt 点击
    // "不发动"按钮逐字等价;有密钥 AI 从基本牌候选里选,选完即提交 respondXiaoguo)。
    // phase+type+asking 守卫保留作双保险,命中即 return。位置刻意在 controlsChoice(L1)
    // 之前:xiaoguo 已从 EXCLUDE 移除,若接在 L1 后面,有密钥时 L1 会抢先镜像"发动【骁果】"
    // 按钮——那个按钮是客户端 xiaoguoMode 模式状态的第一步(点了只改 mode 不提交服务端),
    // 机器人会卡死;专用分支必须先于 L1 命中。
    if(await botDecide('xiaoguo',g,seat)) return;
  }
  if(g.phase==='jijiangAsk' && d && d.type==='jijiangAsk' && d.asking===seat){
    // 【B2a】激将求助:决策已进 BOT_DECISIONS.jijiangAsk(无密钥回退=有杀就替出,没有就
    // 不出)。phase+type+asking 守卫保留作双保险,命中即 return。位置刻意在 L1 之前 +
    // EXCLUDE 收录,双保险防 L1 镜像"替主公打出【杀】"按钮抢先。
    if(await botDecide('jijiangAsk',g,seat)) return;
  }
  if(g.phase==='hujiaAsk' && d && d.type==='hujiaAsk' && d.asking===seat){
    // 【B2a】护驾求助:同 jijiangAsk 一套接线,need='闪'。
    if(await botDecide('hujiaAsk',g,seat)) return;
  }
  if(g.phase==='zhibaAsk' && d && d.type==='zhibaAsk' && d.lordSeat===seat){
    // 【B2b】制霸拼点:主公(机器人)选一张手牌出。
    // EXCLUDE 收录,双保险防 L1 镜像"拼点【X】"按钮抢先。
    if(await botDecide('zhibaAsk',g,seat)) return;
  }
  if(g.phase==='zhibaGain' && d && d.type==='zhibaGain' && d.lordSeat===seat){
    botInvoke(seat,function(){ respondZhibaGain(true); }); return;
  }
  if(g.phase==='yinghunTarget' && d && d.type==='yinghunTarget' && d.seat===seat){
    const allies=g.players.map(function(p,i){return {p:p,i:i};}).filter(function(x){
      return x.i!==seat && x.p && x.p.alive && botCanSave(g,seat,x.i);
    }).sort(function(a,b){ return (a.p.hand||[]).length-(b.p.hand||[]).length || a.p.hp-b.p.hp; });
    const target=allies.length?allies[0].i:-1;
    if(target>=0) botInvoke(seat,function(){ chooseYinghunTarget(target); });
    else botInvoke(seat,cancelYinghun);
    return;
  }
  if(g.phase==='yinghunChoice' && d && d.type==='yinghunChoice' && d.seat===seat){
    botInvoke(seat,function(){ respondYinghunChoice('drawX'); }); return;
  }
  if(g.phase==='yinghunDiscard' && d && d.type==='yinghunDiscard' && d.targetSeat===seat){
    const p=g.players[seat],slot=EQUIP_SLOTS.find(function(s){return p.equips&&p.equips[s];});
    botInvoke(seat,function(){ discardYinghunCard((p.hand||[]).length?0:{kind:'equip',slot:slot}); }); return;
  }
  if(g.phase==='draw'&&g.turn===seat){ botInvoke(seat,doDraw); return; }
  if(g.phase==='play'&&g.turn===seat && canUseHuangtian(g,seat)){
    const idx=(g.players[seat].hand||[]).findIndex(function(c){ return c.name==='闪'||c.name==='闪电'; });
    if(idx>=0){ botInvoke(seat,function(){ useHuangtian(idx); }); return; }
  }
  if(g.phase==='play'&&g.turn===seat && canTriggerZhiba(g,seat)){
    const hand=g.players[seat].hand||[],idx=hand.reduce(function(best,c,i){ return best<0||(c.rank||0)<(hand[best].rank||0)?i:best; },-1);
    if(idx>=0){ botInvoke(seat,function(){ startZhiba(idx); }); return; }
  }
  // L3 多步两阶段(借刀/离间/丈八/仁德):阶段A选中后 botTwoStepA 本地挂起,等下一调度走
  // 阶段B(丈八再等第三调度选目标);命中即 return,不让 runBotActionWindow 重复决策
  // (借刀在出牌枚举里已被排除,其余三项也不在 CARD_PLAYS 里,两路天然不冲突)。
  // 优先级 借刀 > 离间 > 丈八 > 仁德,if 链先命中者胜——同一时刻只会有一个决策匹配
  // (各 match 带 "!botTwoStepA||botTwoStepA.decisionId===id" 挂起守卫,挂起期间其它
  // 决策的 match 直接 false,不会覆盖阶段A已选的状态)。
  if(botTwoStepA && g.phase==='play' && g.turn===seat){
    const pid = botTwoStepA.decisionId;
    if(pid==='jiedaoTwoStep' && await botDecide('jiedaoTwoStep', g, seat)) return;
    if(pid==='lijianTwoStep' && await botDecide('lijianTwoStep', g, seat)) return;
    if(pid==='zhangbaTwoStep' && await botDecide('zhangbaTwoStep', g, seat)) return;
    if(pid==='rendeTwoStep' && await botDecide('rendeTwoStep', g, seat)) return;
  }
  if(g.phase==='play'&&g.turn===seat){
    if(await botDecide('jiedaoTwoStep', g, seat)) return;
    if(await botDecide('lijianTwoStep', g, seat)) return;
    if(await botDecide('zhangbaTwoStep', g, seat)) return;
    if(await botDecide('rendeTwoStep', g, seat)) return;
    // 【L1泛化批次】seatPick 接线修复:11 个座位技能(断粮/奇袭/国色/武圣/双雄/挑衅/
    // 反间/青囊等)此前只注册未接线,机器人从不主动使用。命中的技能候选(技能→目标)
    // 合并成一张表 AI 选;未命中返回 false 走 runBotActionWindow(手牌枚举),两者不冲突
    // (seatPick 技能无 CARD_PLAYS 入口;武圣/双雄的 CARD_PLAYS 路径与 seatPick 的
    // "技能按钮"路径候选 label 不同,双路径都合法,不排除——测试锁定)。
    // 【解锁无密钥兜底】此前这里的 aiReady 门槛是因为13个fallbackSeat几乎全是
    // "return null"——G1修复那次的注释写"否则fallback null → botDecide true →
    // play分支return,机器人整回合卡死"是当时真实存在的风险,但那是"fallbackSeat恒为
    // null"这个前提下的推论。这次已经把13个fallbackSeat全部换成有意义的本地评分
    // (pickBestCandidateSeat/pickHealFallbackSeat,见各自注册处),只要对应技能的
    // buildSeatCandidates确实有合法目标,fallbackSeat就不会是null,不会再触发那个
    // "选了但什么都没做"的卡死路径——去掉aiReady门槛,让无密钥模式也能走本地兜底决策。
    // 【已知的残余边界,不在本次修复范围】seatPickLocalFallback是"取第一个match的技能,
    // 用它自己的fallbackSeat"——如果排在前面的技能matched但自身buildSeatCandidates为空
    // (比如断粮满足出牌条件但所有人距离都>2),它的fallbackSeat会是null,
    // seatPickLocalFallback会直接返回null而不去尝试排在后面的、真正有候选的技能。
    // 这是seatPickLocalFallback本身"取第一个matched技能"的既有设计,不是这次新增
    // fallbackSeat引入的问题,这次不改这个架构(一次只改一件事)。
    if(await botDecide('seatPick', g, seat)) return;
    if(await botDecide('fangtian', g, seat)) return;
    // 【Part2】天义/强袭/乱武/乱击/奋迅:此前完全没有代码调用这几个start*函数,机器人
    // 从不主动发动。明策/眩惑经评估保守默认不主动发动(净收益不明确/纯粹利他,和
    // 举荐/仁心同一基调),不在这里触发,见 botTryStartExtraSkills 上方注释。
    if(botTryStartExtraSkills(g, seat)) return;
    await runBotActionWindow(g, seat); return;
  }
  if(g.phase==='discard'&&g.turn===seat){
    const need=Math.max(0,(p.hand||[]).length-handCapLimit(g, seat));
    if(need<=0){ botInvoke(seat,endTurn); return; }
    // L2 discardSubset:弃牌组合决策由总线接管(无密钥回退=旧算法末尾 need 张,逐字一致)。
    // botDecide 返回 true 表示已执行;need>0 时候选必非空,不存在"无候选落空"的分支。
    if(await botDecide('discardSubset', g, seat)) return;
  }
  if(g.phase==='respond'&&d.to===seat){
    // 不能只看"手里有没有能当闪的牌":马超【铁骑】判红/黄忠【烈弓】触发时 d.noShan===true,
    // 这张杀不可被闪抵消,respondShan 服务端一上来就 if(g.pending.noShan) return g 原地拒绝。
    // 盲答"出闪"会被拒、状态不变,机器人下次醒来重算又是同样结论,永久死循环。
    botInvoke(seat,()=>respondShan(!d.noShan && findUsableAs(p.hand,p,'闪')>=0));
    return;
  }
  if(g.phase==='aoeResp'&&d.to===seat){
    // 决策已进 BOT_DECISIONS.aoeResp(候选生成/本地回退与旧分支逐字一致,见注册表上方
    // 注释——need==='杀'(南蛮)受将驰限制,need==='闪'(万箭)不受)。此处保留
    // phase+pending.to 守卫作为冗余复核,命中即 return。
    if(await botDecide('aoeResp',g,seat)) return;
  }
  if(g.phase==='duel'&&d.active===seat){
    // 决策已进 BOT_DECISIONS.duel(本地回退含将驰禁杀判断,与旧分支逐字一致,见注册表
    // 上方注释——盲答"出杀"会被服务端原地拒绝、永久死循环)。
    if(await botDecide('duel',g,seat)) return;
  }
  if(g.phase==='dying'&&d.asking===seat){
    // 决策已进 BOT_DECISIONS.dying(本地回退=botCanSave&&canBotUseTaoForDying&&有桃,
    // 与旧分支逐字一致,见注册表上方注释)。
    if(await botDecide('dying',g,seat)) return;
  }
  // L1 controlsChoice:镜像真实 controls 按钮的响应决策(wuxie/luoyingAsk/luoshen 无密钥
  // 也接管 + 有密钥时所有非 EXCLUDE 响应阶段接管,L1 泛化见 BOT_DECISIONS.controlsChoice
  // 上方注释)。命中则整条决策链由总线接管并 return;未命中(无密钥非 allowlist 阶段/
  // EXCLUDE 阶段/没有可点按钮)返回 false,继续走下面既有的硬编码分支,行为零变化。
  // 旧的 respondWuxie(false) 硬编码分支已删除:回退顺序 safe 正则第一命中"不出",等价。
  if(await botDecide('controlsChoice', g, seat)) return;
  if(g.phase==='wugu'&&d.type==='wugu'&&Array.isArray(d.order)&&d.order[d.idx||0]===seat&&Array.isArray(d.pool)&&d.pool.length){
    // 决策已进 BOT_DECISIONS.wuguPick(无密钥回退=池首张,与旧分支逐字一致;expectedIdx
    // 乐观并发校验必须传当前真实 d.idx,见注册表上方注释)。phase+pending 守卫保留作
    // 双保险,命中即 return。
    if(await botDecide('wuguPick',g,seat)) return;
  }
  if(g.phase==='tieqi'&&d.from===seat){ botInvoke(seat,()=>respondTieqi(true)); return; }
  if(g.phase==='liegong'&&d.from===seat){ botInvoke(seat,()=>respondLiegong(true)); return; }
  if(g.phase==='duanbingChoose'&&d.sourceSeat===seat){
    const targets=(d.availableTargets||[]).slice().sort((a,b)=>botTargetScore(g,seat,b,'damage')-botTargetScore(g,seat,a,'damage'));
    if(targets.length&&botTargetScore(g,seat,targets[0],'damage')>-Infinity) botInvoke(seat,()=>triggerDuanbing(targets[0]));
    else botInvoke(seat,cancelDuanbing);
    return;
  }
  if(g.phase==='huogongReveal'&&d.to===seat){ botInvoke(seat,()=>respondHuogongReveal(0)); return; }
  if(g.phase==='huogong'&&d.from===seat){ botInvoke(seat,()=>respondHuogong(false)); return; }
  if(g.phase==='pick'&&d.from===seat){
    // L2 pickSlot:顺手/拆桥选对象决策由总线接管(无密钥回退=旧分支 hand→装备槽→delay:0)。
    // d.from===seat 与 pickSlotMatch 是同一道守卫,保留作双保险。
    if(await botDecide('pickSlot', g, seat)) return;
  }
  if(g.phase==='qilin'&&d.from===seat){
    const target=g.players[d.to];
    const slot=['plus1','minus1'].find(s=>target&&target.equips&&target.equips[s]);
    if(slot) botInvoke(seat,()=>qilinResolve(slot));
    return;
  }
  if(g.phase==='hanbing'&&d.from===seat){
    const target=g.players[d.to];
    const choice=(target.hand||[]).length?'hand':EQUIP_SLOTS.find(s=>target.equips&&target.equips[s]);
    if(choice) botInvoke(seat,()=>hanbingPick(choice));
    return;
  }
  if(g.phase==='mengjin'&&d.from===seat){
    const choice=(d.available||[])[0];
    if(choice) botInvoke(seat,()=>mengjinPick(choice));
    return;
  }
  if(g.phase==='shaOffsetChoice'&&d.from===seat){
    botInvoke(seat,()=>respondShaOffsetChoice((d.available||[])[0]||null)); return;
  }
  // 【系统性扫描发现的紧急盲区收尾】祝融【烈刃】拼点响应:确定性兜底,不追求判断哪张牌更好,
  // 固定选手牌第一张——目的只是消除卡死，不是让这一步变聪明。手牌为空时(理论上不会,
  // respondLieRen自己的cardIdx<0校验会拒绝)不动作，交给上游服务端自身的容错。
  if(g.phase==='lieRenRespond'&&d.type==='lieRenRespond'&&d.targetSeat===seat){
    const me=g.players[seat];
    if((me.hand||[]).length>0) botInvoke(seat,()=>respondLieRen(0));
    return;
  }
  // 【系统性扫描发现的紧急盲区收尾】典韦【强袭】选目标:确定性兜底，固定选候选列表第一个
  // 目标——"消耗支付后不可取消"是既有设计，这里不加取消，只补选目标这一步不再卡死。
  if(g.phase==='qiangxiPickTarget'&&d.type==='qiangxiPickTarget'&&d.seat===seat){
    const target=(d.candidates||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>pickQiangxiTarget(target));
    return;
  }
  // 【渲染层bug修复顺带补上】典韦【强袭】选支付方式(防御性收录,机器人目前不会主动发动
  // 强袭):优先弃武器牌(保留体力),武器不可弃时选失去1点体力——和"选候选第一项"这类
  // 确定性兜底同一基调,不追求判断哪个更划算。
  if(g.phase==='qiangxiChooseCost'&&d.type==='qiangxiChooseCost'&&d.seat===seat){
    const me=g.players[seat];
    const opt=(me&&hasWeaponToDiscard(me))?'weapon':'hp';
    if(opt==='hp'&&!(me&&me.hp>1)) return; // 两种都不可行时(理论上不会发生)保持不动,不误发无效请求
    botInvoke(seat,()=>chooseQiangxiCost(opt));
    return;
  }
  // 典韦【强袭】手牌选武器(防御性收录):固定选第一个武器牌下标。
  if(g.phase==='qiangxiChooseWeaponFromHand'&&d.type==='qiangxiChooseWeaponFromHand'&&d.seat===seat){
    const idx=(d.weaponIndices||[])[0];
    if(typeof idx==='number') botInvoke(seat,()=>chooseQiangxiWeaponFromHand(idx));
    return;
  }
  // 【第二批-第1组,高频】徐庶【举荐】:确定性兜底,不接AI。固定"不发动"(和断粮/奇袭等
  // L3转化技能的既定默认一致——举荐是纯粹利他技能,发动要付出一张非基本牌的代价,保守
  // 默认不发动符合项目里"没有明确收益就不主动消耗资源"的既定基调)。
  if(g.phase==='jujianPickCard'&&d.type==='jujianPickCard'&&d.sourceSeat===seat){
    botInvoke(seat,cancelJujian); return;
  }
  // 理论上只有先选了要弃的牌才会走到这一步,而上面的分支固定不发动、永远不会推进到这里——
  // 这条分支是防御性兜底(万一以后接了AI或有别的入口把状态推进到这里),固定选候选第一个
  // 目标,不追求判断哪个更好。
  if(g.phase==='jujianPickTarget'&&d.type==='jujianPickTarget'&&d.sourceSeat===seat){
    const target=(d.candidates||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>respondJujianPickTarget(target));
    else botInvoke(seat,cancelJujian);
    return;
  }
  // 这一步的行动者是被举荐的目标(可能是另一个人的机器人),牌已经弃出去了、不可取消
  // (cancelJujian对jujianChooseEffect直接拒绝)，三个选项对目标都是纯收益，选一个最贴切
  // 当前状态的:体力未满时回复更划算,体力已满时摸牌(避免"体力已满仍选回复"变成日志里的
  // 无效果)。
  if(g.phase==='jujianChooseEffect'&&d.type==='jujianChooseEffect'&&d.targetSeat===seat){
    const me=g.players[seat];
    const opt=(me && me.hp<me.maxHp) ? 'recover' : 'draw';
    botInvoke(seat,()=>respondJujianEffect(opt));
    return;
  }
  // 【第二批-第1组,高频】曹仁【据守】:确定性兜底,不接AI。摸3张牌的收益 vs 翻面(相当于
  // 跳过下个回合正常摸牌/出牌)的代价——简单条件:手牌不多时(≤3张)值得用一次翻面换3张牌,
  // 手牌已经充裕时没必要再承担翻面代价。不追求比这更细的判断。
  if(g.phase==='jushouChoose'&&d.type==='jushouChoose'&&d.seat===seat){
    const me=g.players[seat];
    if(me && (me.hand||[]).length<=3) botInvoke(seat,confirmJushou);
    else botInvoke(seat,cancelJushou);
    return;
  }
  // 【第二批-第2组,装备类4个,同一套结构】雌雄双股剑是否发动:对装备者/攻击者本人没有
  // 任何下行风险(要么令目标弃牌,要么自己白摸一张),固定发动,不接AI。
  if(g.phase==='cixiongAsk'&&d.type==='cixiongAsk'&&d.from===seat){
    botInvoke(seat,()=>respondCixiongAsk(true)); return;
  }
  // 雌雄双股剑目标选弃牌还是让攻击者摸牌:两者对目标都是纯损失,固定选"弃一张手牌"
  // (代码保证走到这一步时目标手牌非空),不接AI、不追求判断哪个更优。
  if(g.phase==='cixiongChoice'&&d.type==='cixiongChoice'&&d.to===seat){
    botInvoke(seat,()=>respondCixiongChoice('discard',0)); return;
  }
  // 贯石斧是否发动:固定发动(花2张牌让已被闪抵消的杀依然命中,和这批其余三个装备特效
  // 同一基调——攻击性投入,不接AI)。选牌不追求判断哪张更值,手牌优先、装备槽垫底,固定
  // 取前2个可弃项。
  if(g.phase==='guanshi'&&d.type==='guanshi'&&d.from===seat){
    const me=g.players[seat];
    const picks=[];
    (me&&me.hand||[]).forEach((c,i)=>{ if(picks.length<2) picks.push('hand:'+i); });
    if(picks.length<2){
      EQUIP_SLOTS.forEach(s=>{ if(picks.length<2 && s!=='weapon' && me&&me.equips&&me.equips[s]) picks.push('equip:'+s); });
    }
    if(picks.length===2) botInvoke(seat,()=>respondGuanshi(picks));
    else botInvoke(seat,()=>respondGuanshi(null));
    return;
  }
  // 寒冰剑是否发动:固定发动(防止本次杀的伤害,改为让目标弃两张牌——通常比单纯造成1点
  // 伤害更有价值，和这批其余三个装备特效同一基调)。发动后进入的弃牌子阶段(hanbing)
  // 已经有专用分支覆盖，这里只补"是否发动"这第一问。
  if(g.phase==='hanbingAsk'&&d.type==='hanbingAsk'&&d.from===seat){
    botInvoke(seat,()=>respondHanbingAsk(true)); return;
  }
  // 青龙偃月刀是否发动:和悲歌/张郃巧变等其它响应函数同一个既有坑(CLAUDE.md规则26)——
  // 曹彰【将驰】本回合禁杀时(jiangchiNoSlash)、或手里没有能当杀的牌时,发动请求会被
  // 服务端respondQinglong原地拒绝,盲目发动会让机器人卡在原地。这里先探测能不能真的
  // 发动,能则发动(再来一次杀,进攻性投入,同这批其余三个装备特效基调),不能则不发动。
  if(g.phase==='qinglong'&&d.type==='qinglong'&&d.from===seat){
    const me=g.players[seat];
    const shaIdx=me?findUsableAs(me.hand,me,'杀'):-1;
    if(me && !me.jiangchiNoSlash && shaIdx>=0) botInvoke(seat,()=>respondQinglong(true,shaIdx));
    else botInvoke(seat,()=>respondQinglong(false));
    return;
  }
  // 【第二批-第3组】颜良文丑【双雄】是否发动:固定不发动,不接AI。发动的代价是放弃本回合
  // 正常摸牌(损失2张牌),换来的只是给后续决斗设一个可用花色(shuangxiongColor),收益不
  // 确定、代价明确,保守默认不发动(和举荐同一基调:没有明确收益不主动付代价)。
  if(g.phase==='shuangxiongAsk'&&d.type==='shuangxiongAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondShuangxiong(false)); return;
  }
  // 【第二批-第3组】张角【雷击】选目标:对发动者(张角本人)没有任何下行风险——不用弃牌、
  // 不用摸牌,纯粹是"判定一张牌,黑桃就白得2点伤害"的免费加成,固定发动+固定选候选目标
  // 第一个,不追求判断打谁更好(和落英/洛神同一基调:没有下行风险就默认总是尝试)。
  if(g.phase==='leijiChoose'&&d.type==='leijiChoose'&&d.sourceSeat===seat){
    const target=(d.availableTargets||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>triggerLeiji(target));
    else botInvoke(seat,cancelLeiji);
    return;
  }
  // 张角【雷击】进行判定:纯确认点击,没有选择,直接触发(和悲歌的beigeJudge同一模式)。
  if(g.phase==='leijiJudge'&&d.type==='leijiJudge'&&d.sourceSeat===seat){
    botInvoke(seat,doLeijiJudge); return;
  }
  // 【第二批-剩余清单批量处理】鲁肃【好施】平手多候选:固定选候选第一个(不追求判断
  // "谁更缺牌",这几个候选本身已经是"手牌最少"的并列结果,选谁都一样合理)。
  if(g.phase==='haoshiPick'&&d.type==='haoshiPick'&&d.seat===seat){
    const target=(d.candidates||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>respondHaoshi(target));
    return;
  }
  // 姜维【挑衅】发起者选弃哪张牌:防御性收录(机器人目前不会主动发起挑衅),固定选
  // tiaoxinDiscardOptions 的第一个候选。
  if(g.phase==='tiaoxinDiscard'&&d.type==='tiaoxinDiscard'&&d.from===seat){
    const target=g.players[d.to];
    const opts=target?tiaoxinDiscardOptions(target):[];
    const opt=opts[0];
    if(opt) botInvoke(seat,()=>pickTiaoxinDiscard(opt.kind, opt.kind==='hand'?opt.idx:opt.slot));
    return;
  }
  // 貂蝉【闭月】:回合结束摸1张牌,零下行风险,固定发动(和落英/洛神同一基调)。
  if(g.phase==='biyue'&&d.type==='biyue'&&d.seat===seat){
    botInvoke(seat,()=>respondBiyue(true)); return;
  }
  // 周泰【不屈】:发动只有"可能防止死亡"这一种结果,即便防死条件不满足也只是回到正常
  // 濒死流程、不会更差,是严格意义上"不会更坏、可能更好"的选择,固定发动。
  if(g.phase==='buquAsk'&&d.type==='buquAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondBuqu(true)); return;
  }
  // 曹冲【仁心】:保护目标(伤害本身不是打在自己身上)要付出弃1件装备+翻面的代价,收益
  // 是帮别人挡伤害——利他+代价明确,和举荐同一基调,保守默认不发动。
  if(g.phase==='renxinChoose'&&d.type==='renxinChoose'&&d.seat===seat){
    botInvoke(seat,cancelRenxin); return;
  }
  // 曹冲【称象】是否发动:亮4张牌选组合,没有下行风险(最差也能选0张,不会倒贴任何资源),
  // 固定发动。
  if(g.phase==='chengxiangAsk'&&d.type==='chengxiangAsk'&&d.seat===seat){
    botInvoke(seat,confirmChengxiangAsk); return;
  }
  // 曹冲【称象】选组合:固定选sum最大的那个组合(拿到的牌/点数最多),不追求比"选最大"更细
  // 的判断;没有合法组合时(理论上selectable至少含{indices:[],sum:0})退化选0张。
  // 注意守卫是 g.phase==='chengxiangAsk'(不是'chengxiangChoose')——confirmChengxiangAsk
  // 切换pending.type时从未同步改过g.phase,真实dump验证过'chengxiangChoose'这个phase值
  // 永远不会出现,守卫写它会导致这个分支永远不触发(死代码)。
  if(g.phase==='chengxiangAsk'&&d.type==='chengxiangChoose'&&d.seat===seat){
    const options=d.selectable||[];
    let best=options[0]||{indices:[],sum:0};
    options.forEach(o=>{ if(o.sum>best.sum) best=o; });
    if(best.indices && best.indices.length>0) botInvoke(seat,()=>confirmChengxiang(best));
    else botInvoke(seat,cancelChengxiang);
    return;
  }
  // 许褚【裸衣】:少摸1张牌换本回合杀/决斗伤害+1——代价明确(-1张牌)、收益不确定(要看
  // 这回合到底打不打得出去),保守默认不发动。
  if(g.phase==='luoyiAsk'&&d.type==='luoyiAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondLuoyi(false)); return;
  }
  // 荀彧【节命】:帮目标摸牌到手牌上限,对自己没有资源代价,但是纯粹资助别人(可能是敌人),
  // 收益方向不明确,和举荐同一基调保守默认不发动(targetSeat传null=不发动)。
  if(g.phase==='jiemingAsk'&&d.type==='jiemingAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondJieming(null)); return;
  }
  // 左慈【新生】:随机获得一个新武将加入化身池,纯粹是自己的资源增益,没有任何代价,固定
  // 发动。(已知的"新生会阻塞其它onDamaged判断"是完全独立的既有bug,不影响这里"该不该
  // 发动"这个判断本身的正确性,不在这次修复范围内。)
  if(g.phase==='xinshengAsk'&&d.type==='xinshengAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondXinshengAsk(true)); return;
  }
  // 【真实bug修复】郭嘉【遗计】是否发动:看牌堆顶2张分给任意角色(含自己),对发动者自己
  // 没有任何资源代价(不需要弃牌/掉血),和落英respondLuoying(true)/洛神respondLuoshen(true)
  // 这类"没有下行风险就默认发动"的既有先例同一基调,固定发动。分配阶段(yijiAssign)早就
  // 接过线,这里补的是此前完全没有登记过的"是否发动"这第一问(见BOT_PHASE_ACTOR.yijiAsk
  // 上方注释)。
  if(g.phase==='yijiAsk'&&d.type==='yijiAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondYijiAsk(true)); return;
  }
  // 【系统性扫描发现的遗漏,和郭嘉遗计同一批】夏侯惇【刚烈】是否发动:判定若非红桃,伤害
  // 来源要弃2张手牌或受1点伤害反击——对发动者自己零资源代价(只是判定,没有弃牌/掉血),
  // 且没有下行风险(红桃时无事发生,不会反噬自己),和落英/洛神同一基调固定发动。
  if(g.phase==='ganglieAsk'&&d.type==='ganglieAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondGanglieAsk(true)); return;
  }
  // 【系统性扫描发现的遗漏】张角【鬼道】是否发动:要打出一张黑色手牌去替换别人的判定牌,
  // 有真实资源代价(消耗1张手牌)且方向不确定(替换后对被判定者是好是坏,取决于原判定/
  // 新判定内容,需要局面判断),和举荐/仁心这类"有代价+方向不明确"的既有基调一致,保守
  // 默认不发动。
  if(g.phase==='guiduAsk'&&d.type==='guiduAsk'&&d.sourceSeat===seat){
    botInvoke(seat,cancelGuidu); return;
  }
  // 【系统性扫描发现的遗漏】曹彰【将驰】摸牌阶段三选一:"多摸1张但本回合不能出杀"和
  // "少摸1张但本回合杀无距离限制且可多出1张"都是有真实代价、方向不确定的取舍(要看这回合
  // 到底打不打得出去/有没有杀在手),不像忘隙/耀武那种纯收益,保守默认不发动(维持正常
  // 摸牌数,不做任何取舍)。
  if(g.phase==='jiangchiAsk'&&d.type==='jiangchiAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondJiangchi('none')); return;
  }
  // 【B类修复】姜维【志继】觉醒选择:体力上限已经-1(不可逆,两个选项都不能挽回这个代价),
  // 摸两张牌/回复1点体力对自己都是纯收益、没有下行风险,唯一要判断的是"哪个更划算"——
  // 觉醒条件本身就是"手牌为0",这一刻正好最缺资源,摸两张牌通常比单点体力更有价值;
  // 但如果体力已经很低(<=1,濒死风险高),优先保命选回复体力。和华雄耀武
  // respondYaowu(hp<maxHp?'recover':'draw')同一种"看体力决定"判断方式,不重新发明。
  if(g.phase==='zhijiChoice'&&d.type==='zhijiChoice'&&d.seat===seat){
    const me=g.players[seat];
    const healOrDraw = !!(me && me.hp<=1);
    botInvoke(seat,()=>respondZhijiChoice(healOrDraw)); return;
  }
  // 【B类修复】姜维【挑衅】目标二选一:对己方使用一张杀反击挑衅发起者,代价是自己的一张
  // 杀(和被弃置一张牌同一个"损失一张牌"量级),但额外换来对发起者造成伤害的进攻收益,
  // 比被动弃牌(对方还能挑你损失最大的那张)更划算——先探测确定真能打出杀(有牌+距离够,
  // 遵循规则26不能只看牌够不够),能则用杀反击,不能则回退被弃牌(反正也是唯一合法选项)。
  if(g.phase==='tiaoxinChoice'&&d.type==='tiaoxinChoice'&&d.to===seat){
    const me=g.players[seat];
    const shaIdx = me?findUsableAs(me.hand,me,'杀'):-1;
    const canSha = shaIdx>=0 && canReachSha(g, seat, d.from);
    botInvoke(seat,()=>respondTiaoxinChoice(canSha, canSha?shaIdx:undefined)); return;
  }
  // 【B类审计收尾,标注"潜在"】法正【眩惑】四个子阶段:发动入口startHuanhuo目前没有任何
  // 机器人代码调用它,这四条分支实际上永远不会被触发到,只是提前补好、避免"以后接上入口
  // 却忘了接子阶段"这种情况。决策不追求判断,和明策/旋风子阶段选牌同一基调"确定性兜底,
  // 固定选第一个候选"。
  if(g.phase==='huanhuoPick'&&d.type==='huanhuoPick'&&d.sourceSeat===seat){
    const target=(d.candidates||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>pickHuanhuoTarget(target));
    else botInvoke(seat,cancelHuanhuo);
    return;
  }
  if(g.phase==='huanhuoPickCard'&&d.type==='huanhuoPickCard'&&d.sourceSeat===seat){
    const me=g.players[seat];
    const idx=(me&&me.hand||[]).findIndex(c=>c&&c.suit==='♥');
    if(idx>=0) botInvoke(seat,()=>pickHuanhuoHeartCard(idx));
    else botInvoke(seat,cancelHuanhuo);
    return;
  }
  if(g.phase==='huanhuoPickGotCard'&&d.type==='huanhuoPickGotCard'&&d.sourceSeat===seat){
    const target=g.players[d.targetSeat];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(s=>target.equips[s]);
    if(slot) botInvoke(seat,()=>pickHuanhuoGotCard('equip',slot));
    else if(target&&(target.hand||[]).length>0) botInvoke(seat,()=>pickHuanhuoGotCard('hand',null));
    return;
  }
  if(g.phase==='huanhuoPickSecond'&&d.type==='huanhuoPickSecond'&&d.sourceSeat===seat){
    const target=(d.candidates||[])[0];
    if(typeof target==='number') botInvoke(seat,()=>pickHuanhuoSecondTarget(target));
    return;
  }
  // 【A类修复,机器人技能覆盖审计】大乔【流离】:弃一张牌(手牌优先,避免丢装备)把这张【杀】
  // 转移给别人——对发动者自己没有明显下行风险(用1张牌换完全免疫这次伤害,划算),固定
  // 发动。目标从服务端已经算好的pending.targets里用botTargetScore('damage')选"最该
  // 承受这次伤害"的那个(和duanbingChoose同一套评分,不重新发明)。
  if(g.phase==='liuli'&&d.type==='liuli'&&d.to===seat){
    const me=g.players[seat];
    const hand=(me&&me.hand)||[];
    const targets=(d.targets||[]).slice().sort((a,b)=>botTargetScore(g,seat,b,'damage')-botTargetScore(g,seat,a,'damage'));
    const newTarget=targets.length&&botTargetScore(g,seat,targets[0],'damage')>-Infinity?targets[0]:null;
    let choice=null;
    if(newTarget!==null){
      if(hand.length>0) choice={kind:'hand', idx:0};
      else{
        const slot=me&&me.equips&&EQUIP_SLOTS.find(s=>me.equips[s]);
        if(slot) choice={kind:'equip', slot};
      }
    }
    if(choice) botInvoke(seat,()=>respondLiuli(choice,newTarget));
    else botInvoke(seat,()=>respondLiuli(null,null));
    return;
  }
  // 【A类修复】小乔【天香】:弃一张红桃手牌把伤害转移给别人——同样是"1张牌换免疫这次
  // 伤害",没有明显下行风险,固定发动。目标同上用botTargetScore('damage')从
  // pending.targets里选。
  if(g.phase==='tianxiang'&&d.type==='tianxiang'&&d.seat===seat){
    const me=g.players[seat];
    const hearts=(me&&me.hand||[]).map((c,i)=>({c,i})).filter(x=>x.c&&x.c.suit==='♥');
    const targets=(d.targets||[]).slice().sort((a,b)=>botTargetScore(g,seat,b,'damage')-botTargetScore(g,seat,a,'damage'));
    const newTarget=targets.length&&botTargetScore(g,seat,targets[0],'damage')>-Infinity?targets[0]:null;
    if(hearts.length>0 && newTarget!==null) botInvoke(seat,()=>respondTianxiang({idx:hearts[0].i}, newTarget));
    else botInvoke(seat,()=>respondTianxiang(null,null));
    return;
  }
  // 【A类修复】孔融【礼让】回收:白得目标本弃牌阶段弃掉的牌,对孔融自己零代价、纯收益
  // (respondLiRangRecover(true)只是把这些牌塞回手牌,不需要付出任何东西),固定发动。
  if(g.phase==='lirangRecover'&&d.type==='lirangRecover'&&d.from===seat){
    botInvoke(seat,()=>respondLiRangRecover(true)); return;
  }
  // 【A类修复】孔融【争义】:替孔融承受本该由他承受的这次伤害,对发动者自己是纯粹的
  // 自我牺牲(承担一次实际伤害,换不到任何直接回报),和举荐/仁心这类"有代价+纯粹利他"
  // 的既有基调一致,保守默认不发动。
  if(g.phase==='zhengyi'&&d.type==='zhengyi'&&d.asking===seat){
    botInvoke(seat,()=>respondZhengyi(false)); return;
  }
  // 【A类修复】祝融【烈刃】发动:拼点赢面接近五成、代价只是自己拼点牌本身要弃出去
  // (赢/输都要弃,和天义拼点同一结构),赢了能白得对方一张牌,没有额外的下行风险,固定
  // 发动(和天义respondYijiAsk同一基调)。
  if(g.phase==='lieRenChoose'&&d.type==='lieRenChoose'&&d.sourceSeat===seat){
    botInvoke(seat,triggerLieRen); return;
  }
  // 【A类修复】祝融【烈刃】选拼点牌:固定选点数最大的一张(和天义pickTianyiCard同一
  // 判断——拼点点数越大赢面越高,既然已经决定发动就该尽量选能赢的牌)。
  if(g.phase==='lieRenPickCard'&&d.type==='lieRenPickCard'&&d.sourceSeat===seat){
    const me=g.players[seat];
    const hand=(me&&me.hand)||[];
    let bestIdx=0;
    hand.forEach((c,i)=>{ if(c && (c.rank||0)>((hand[bestIdx]&&hand[bestIdx].rank)||0)) bestIdx=i; });
    if(hand.length) botInvoke(seat,()=>pickLieRenCard(bestIdx));
    else botInvoke(seat,cancelLieRen);
    return;
  }
  // 【A类修复】夏侯渊【神速1】:跳过判定和摸牌阶段(代价是放弃本回合正常摸到的牌,通常
  // 2张),换1张无距离限制的杀——和许褚裸衣respondLuoyi(-1张牌换本回合伤害加成)同一类
  // "有代价+收益不确定"结构,裸衣的既定默认是保守不发动,这里代价更大(整个摸牌阶段,
  // 不只是1张牌),同一基调保守默认不发动。
  if(g.phase==='shensuChoose1'&&d.type==='shensuChoose1'&&d.seat===seat){
    botInvoke(seat,skipShensu1); return;
  }
  // 【A类修复】夏侯渊【神速2】:跳过整个出牌阶段+弃1件装备,换1张无距离限制的杀——代价
  // 比神速1更大(丢掉出牌阶段能做的所有事+1件装备),同一基调保守默认不发动。
  if(g.phase==='shensuChoose2'&&d.type==='shensuChoose2'&&d.seat===seat){
    botInvoke(seat,skipShensu2); return;
  }
  // 【A类修复】张郃【巧变】回合开始:弃1张手牌+跳过判定/摸牌/出牌/弃牌阶段之一,是否
  // 划算取决于跳过哪个阶段(跳摸牌是明显净损失,跳弃牌可能是净收益),局面判断复杂,和
  // 已经接线的qiaobianMove(出牌阶段中途版本)保守默认"不移动"同一基调,这里保守默认
  // 不发动,不重新发明一套局面评估。
  if(g.phase==='qiaobianTurnStart'&&d.type==='qiaobianTurnStart'&&d.seat===seat){
    botInvoke(seat,qiaobianDecline); return;
  }
  // 曹植【酒诗】翻回正面:没有下行风险(翻正面只是解除背面朝上状态,不需要额外代价),
  // 固定发动。
  if(g.phase==='jiushiFlipAsk'&&d.type==='jiushiFlipAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondJiushiFlip(true)); return;
  }
  // 陆逊【连营】:摸1张牌,零代价,固定发动。
  if(g.phase==='lianyingAsk'&&d.type==='lianyingAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondLianying(true)); return;
  }
  // 【Part2补全】太史慈【天义】选拼点牌:固定选手牌里点数最大的一张(拼点点数越大赢面
  // 越高,和"发动"这一步的判断方向一致——既然已经决定发动,就该尽量选能赢的牌)。
  if(g.phase==='tianyiPickCard'&&d.type==='tianyiPickCard'&&d.seat===seat){
    const me=g.players[seat];
    const hand=(me&&me.hand)||[];
    let bestIdx=0;
    hand.forEach((c,i)=>{ if(c && (c.rank||0)>((hand[bestIdx]&&hand[bestIdx].rank)||0)) bestIdx=i; });
    if(hand.length) botInvoke(seat,()=>pickTianyiCard(bestIdx));
    else botInvoke(seat,cancelTianyi);
    return;
  }
  // 【Part2补全】太史慈【天义】选拼点目标:候选=有手牌的其他存活角色,用既有的
  // pickBestCandidateSeat('damage')按身份嫌疑/血量等评分挑一个,和guose/wusheng等
  // seatPick技能选目标同一套评分口径,不重新发明。
  if(g.phase==='tianyiPickTarget'&&d.type==='tianyiPickTarget'&&d.seat===seat){
    const cardIdx=d.cardIdx;
    const candidates=[];
    g.players.forEach((p,i)=>{ if(i!==seat && p && p.alive && (p.hand||[]).length>0) candidates.push({seat:i}); });
    const target=pickBestCandidateSeat(g, seat, candidates, 'damage');
    if(typeof target==='number') botInvoke(seat,()=>pickTianyiTarget(cardIdx,target));
    else botInvoke(seat,cancelTianyi);
    return;
  }
  // 【Part2补全】丁奉【奋迅】选弃牌:优先弃一张不能当杀用的牌(保留手里能当杀用的牌,
  // 否则发动奋迅本身就没意义了——呼应"发动"这一步已经校验过hasSha的判断方向)。
  if(g.phase==='fenxunDiscard'&&d.type==='fenxunDiscard'&&d.seat===seat){
    const me=g.players[seat];
    const hand=(me&&me.hand)||[];
    let idx=hand.findIndex(c=>c && !canUseAs(me,c,'杀'));
    if(idx<0) idx=0;
    if(hand.length) botInvoke(seat,()=>pickFenxunDiscard(idx));
    else botInvoke(seat,cancelFenxun);
    return;
  }
  // 【Part2补全】丁奉【奋迅】选目标:固定选候选里"当前够不着"的第一个(呼应"发动"那一步
  // 已经校验过的真实用途——奋迅本来就是为了打够不着的目标),找不到这种目标才退化选
  // 候选第一个(理论上不会发生,发动前已校验过)。
  if(g.phase==='fenxunTarget'&&d.type==='fenxunTarget'&&d.seat===seat){
    const avail=d.availableTargets||[];
    let target=avail.find(i=>!canReachSha(g,seat,i));
    if(typeof target!=='number') target=avail[0];
    if(typeof target==='number') botInvoke(seat,()=>pickFenxunTarget(target));
    else botInvoke(seat,cancelFenxun);
    return;
  }
  // 陈宫【明策】三段选牌/选目标(防御性收录,机器人目前不会主动发动明策):固定选第一个
  // 合法候选——手牌里第一张符合条件的牌/装备槽,选目标固定选第一个存活非自己的角色。
  if(g.phase==='mingcePickCard'&&d.type==='mingcePickCard'&&d.sourceSeat===seat){
    const me=g.players[seat];
    const handIdx=me?(me.hand||[]).findIndex(c=>c&&(isEquipment(c)||canUseAs(me,c,'杀'))):-1;
    if(handIdx>=0) botInvoke(seat,()=>pickMingceCard(handIdx,false));
    else {
      const slot=me&&me.equips&&EQUIP_SLOTS.find(s=>me.equips[s]);
      if(slot) botInvoke(seat,()=>pickMingceCard(slot,true));
      else botInvoke(seat,cancelMingce);
    }
    return;
  }
  if(g.phase==='mingcePickTarget'&&d.type==='mingcePickTarget'&&d.sourceSeat===seat){
    const target=g.players.findIndex((p,i)=>p&&p.alive&&i!==seat);
    if(target>=0) botInvoke(seat,()=>pickMingceTarget(target));
    else botInvoke(seat,cancelMingce);
    return;
  }
  if(g.phase==='mingcePickTarget2'&&d.type==='mingcePickTarget2'&&d.sourceSeat===seat){
    const target2=(d.candidates||[])[0];
    if(typeof target2==='number') botInvoke(seat,()=>pickMingceTarget2(target2));
    else botInvoke(seat,cancelMingce);
    return;
  }
  // 陈宫【明策】接收牌的人选效果:'sha'对选择者没有任何资源代价(视为使用一张普通杀,
  // 不消耗自己的手牌),是纯粹的免费进攻机会,有第二目标时固定选'sha'(和"多做损人利己
  // 的事"这条既定基调一致),没有第二目标时只能选'draw'。
  if(g.phase==='mingceChoice'&&d.type==='mingceChoice'&&d.targetSeat===seat){
    const opt=(typeof d.target2Seat==='number')?'sha':'draw';
    botInvoke(seat,()=>chooseMingceOption(opt));
    return;
  }
  // 公孙瓒【趫猛】:黑色杀命中且目标有装备时被动触发,拿/弃目标一件装备,对自己没有任何
  // 代价,固定发动+固定选第一个可用装备槽。
  if(g.phase==='qiaomengChoose'&&d.type==='qiaomengChoose'&&d.sourceSeat===seat){
    botInvoke(seat,triggerQiaomeng); return;
  }
  if(g.phase==='qiaomengPickEquip'&&d.type==='qiaomengPickEquip'&&d.sourceSeat===seat){
    const slot=(d.availableSlots||[])[0];
    if(slot) botInvoke(seat,()=>pickQiaomengEquip(slot));
    return;
  }
  // 李典【忘隙】:发动后自己(可能连同对方)各摸牌,对自己永远是净收益(即便对方也摸牌,
  // 自己的手牌不会因此变少),固定发动。
  if(g.phase==='wangxiAsk'&&d.type==='wangxiAsk'&&d.seat===seat){
    botInvoke(seat,()=>respondWangxi(true)); return;
  }
  // 华雄【耀武】:两个选项(回复1点体力/摸1张牌)对造成伤害的自己都是纯收益、必须二选一,
  // 体力未满选recover更划算,体力已满选draw避免空转(同举荐jujianChooseEffect的既定
  // 判断方式)。
  if(g.phase==='yaowu_choose'&&d.type==='yaowu_choose'&&d.seat===seat){
    const me=g.players[seat];
    botInvoke(seat,()=>respondYaowu(me&&me.hp<me.maxHp?'recover':'draw'));
    return;
  }
  // 夏侯渊【神速】选目标(防御性收录,机器人目前不会主动发动神速1/2):固定选第一个存活
  // 非自己的角色,respondShensuSha内部无距离限制、不受canReachSha约束。
  if(g.phase==='shensuSha'&&d.type==='shensuSha'&&d.seat===seat){
    const target=g.players.findIndex((p,i)=>p&&p.alive&&i!==seat);
    if(target>=0) botInvoke(seat,()=>respondShensuSha(target));
    return;
  }
  // 马谡【制蛮】是否发动:发动会防止自己刚造成的这次伤害(改为获得目标一张牌)——代价是
  // 放弃已经命中的伤害,收益是拿1张不确定的牌,伤害通常比1张随机牌更有价值,保守默认
  // 不发动(保留伤害)。
  if(g.phase==='zhimengAsk'&&d.type==='zhimengAsk'&&d.from===seat){
    botInvoke(seat,()=>respondZhimeng(false)); return;
  }
  // 马谡【制蛮】选牌(防御性收录,上面固定不发动理论上不会走到这一步):固定选第一个候选。
  if(g.phase==='zhimengPick'&&d.type==='zhimengPick'&&d.from===seat){
    const opt=(d.options||[])[0];
    if(opt) botInvoke(seat,()=>respondZhimengPick(opt.type, opt.index));
    return;
  }
  // 左慈"更改化身"第二步选具体武将+技能(防御性收录,第一步已经固定"不更改",理论上
  // 只有配了AI密钥且AI选择"更改"才会走到这里):固定选化身池里第一个有技能条目的武将,
  // 和BOT_DECISIONS.huashenPick的localFallback同一逻辑,不重新发明。
  if(g.phase==='huashenChangePickStart'&&d.type==='huashenChangePickStart'&&d.seat===seat){
    const me=g.players[seat];
    const generalId=me&&(me.huashenPool||[]).find(id=>(HUASHEN_SKILL_TABLE[id]||[]).length);
    if(generalId){
      const entry=(HUASHEN_SKILL_TABLE[generalId]||[])[0];
      botInvoke(seat,()=>respondHuashenChangePickStart(generalId, entry&&entry.name));
    } else {
      // 【真实bug修复】huashenPool 里找不到任何"在 HUASHEN_SKILL_TABLE 里有可用技能
      // 条目"的武将时,不能什么都不做——这个卡死条件本局内恒定,不会因重试而改变,
      // pending 会永久悬空。按"放弃这次更改"处理,推进到 continueGuanxingCheck
      // (等价于respondHuashenChangeAskStart的activate=false分支),不重新发明收尾逻辑。
      botInvoke(seat,abandonHuashenChangePickStart);
    }
    return;
  }
  if(g.phase==='huashenChangePickEnd'&&d.type==='huashenChangePickEnd'&&d.seat===seat){
    const me=g.players[seat];
    const generalId=me&&(me.huashenPool||[]).find(id=>(HUASHEN_SKILL_TABLE[id]||[]).length);
    if(generalId){
      const entry=(HUASHEN_SKILL_TABLE[generalId]||[])[0];
      botInvoke(seat,()=>respondHuashenChangePickEnd(generalId, entry&&entry.name));
    } else {
      // 同上,回合结束一侧的同款修复,推进到 continueBiyueCheck。
      botInvoke(seat,abandonHuashenChangePickEnd);
    }
    return;
  }
  // 【渲染层bug修复顺带补上】袁绍【乱击】选牌对(防御性收录,机器人目前不会主动发动乱击):
  // 固定选可用牌对里的第一个,不追求判断哪对牌更值得留手。
  if(g.phase==='luanjiChoose'&&d.type==='luanjiChoose'&&d.sourceSeat===seat){
    const pairIndex=(d.availablePairs||[]).length?0:-1;
    if(pairIndex>=0) botInvoke(seat,()=>pickLuanjiPair(pairIndex));
    return;
  }
  // 袁绍【乱击】确认使用(防御性收录):已经选好牌对、视为使用万箭齐发,没有新增判断空间,
  // 固定确认。
  if(g.phase==='luanjiConfirm'&&d.type==='luanjiConfirm'&&d.sourceSeat===seat){
    botInvoke(seat,confirmLuanji); return;
  }
  if(g.phase==='jiedaoChoice'&&d && d.type==='jiedaoChoice'&&d.seatA===seat){
    if(await botDecide('jiedaoResponse',g,seat)) return;
  }
  if(g.phase==='guicai'&&d.asking===seat){
    // 郭嘉【鬼才】改判决策由总线接管(候选=不发动+每张手牌;无密钥回退=respondGuicai(false),
    // 与旧硬编码分支逐字一致)。guard 与 guicaiHandPickMatch 同一道,保留作双保险。
    if(await botDecide('guicaiHandPick', g, seat)) return;
  }
  if(g.phase==='fanjianSuit'&&d.targetSeat===seat){
    const suits=['♠','♥','♣','♦'];
    botInvoke(seat,()=>respondFanjianSuit(suits[Math.floor(Math.random()*suits.length)])); return;
  }
  if(g.phase==='quhuRespond'&&d.targetSeat===seat){
    botInvoke(seat,()=>respondQuhu(0)); return;
  }
  if(g.phase==='tianyiRespond'&&d.targetSeat===seat){
    botInvoke(seat,()=>respondTianyi(0)); return;
  }
  if(g.phase==='enyuanChoose'&&d.damagerSeat===seat){
    botInvoke(seat,triggerEnyuan); return;
  }
  if(g.phase==='enyuanChooseOption'&&d.damagerSeat===seat){
    // 决策已进 BOT_DECISIONS.enyuanOption(无密钥回退=有红桃给牌否则掉血,与旧分支逐字
    // 一致,见注册表上方注释)。phase+damagerSeat 守卫保留作双保险,命中即 return。
    if(await botDecide('enyuanOption',g,seat)) return;
  }
  if(g.phase==='enyuanGiveCard'&&d.damagerSeat===seat){
    if(await botDecide('enyuanGiveCard',g,seat)) return;
  }
  if(g.phase==='ganglieChoice'&&d.sourceSeat===seat){
    // 夏侯惇【刚烈】弃牌/受伤决策由总线接管(无密钥回退=手牌够2张弃牌、否则受伤,与旧
    // 分支逐字一致)。guard 与 ganglieChoiceMatch 同一道,保留作双保险。
    if(await botDecide('ganglieChoice', g, seat)) return;
  }
  // 【调度盲区收尾】蔡文姬【悲歌】是否发动:决策已进 BOT_DECISIONS.beigeChoose(无密钥
  // 回退=不发动,与改动前 botSafePrompt 点击"不发动"逐字一致)。guard 与 beigeChoiceMatch
  // 同一道,保留作双保险。
  if(g.phase==='beigeChoose'&&d.type==='beigeChoose'&&d.sourceSeat===seat){
    if(await botDecide('beigeChoose', g, seat)) return;
  }
  // 【调度盲区收尾】蔡文姬【悲歌】选弃置哪张牌:这一步已经决定"发动"，只是选具体弃哪张，
  // 没有真正的策略含量(类似断粮/奇袭"牌维度不交AI"的既有惯例)——手牌优先(不暴露隐藏
  // 信息给选择本身,反正只弃1张不需要挑),没手牌则弃第一个非空装备槽。
  if(g.phase==='beigeDiscard'&&d.type==='beigeDiscard'&&d.sourceSeat===seat){
    const me=g.players[seat];
    if((me.hand||[]).length>0) botInvoke(seat,()=>beigeDiscard(0,false,null));
    else {
      const slot=EQUIP_SLOTS.find(s=>me.equips&&me.equips[s]);
      if(slot) botInvoke(seat,()=>beigeDiscard(null,true,slot));
    }
    return;
  }
  // 【调度盲区收尾】蔡文姬【悲歌】进行判定:纯确认点击,没有选择,直接触发。
  if(g.phase==='beigeJudge'&&d.type==='beigeJudge'&&d.sourceSeat===seat){
    botInvoke(seat,doBeigeJudge); return;
  }
  // 【调度盲区收尾】贾诩【乱武】使用杀/失去体力:决策已进 BOT_DECISIONS.luanwuChoice
  // (无密钥回退=能出杀就出杀、否则失去体力,镜像 render-controls.js 的 shaAvailable 判断)。
  // guard 与 luanwuChoiceMatch 同一道,保留作双保险。
  if(g.phase==='luanwuChoose'&&d.type==='luanwuChoose'&&d.currentSeat===seat){
    if(await botDecide('luanwuChoice', g, seat)) return;
  }
  // 【调度盲区收尾】凌统【旋风】选具体弃哪张牌(chooseCard阶段):这一步已经在'selecting'
  // 阶段由 BOT_SEAT_PICKS.xuanfeng(AI/本地兜底,见其注册处)选定了目标座位，这里只是
  // 选"从这个已选目标身上弃哪张牌"——同样是"牌维度不交AI"的既有惯例(断粮/奇袭同款)。
  // 优先弃装备/判定区(公开信息，不需要猜)，都没有才弃一张随机手牌；若目标已经没有任何
  // 可弃的牌(理论上不会发生，selecting阶段选目标时已经校验过available>0，这里仍双重
  // 保险)则退回选择目标阶段，不留死循环隐患。
  if(g.phase==='xuanfengPick'&&d.type==='xuanfengPick'&&d.from===seat&&d.stage==='chooseCard'){
    const targetSeat=d.currentTargetSeat;
    const target=g.players[targetSeat];
    const selected=d.selections||[];
    const pickedEquipSlot=target&&EQUIP_SLOTS.find(s=>target.equips&&target.equips[s]
      &&!selected.some(x=>x.targetSeat===targetSeat&&x.kind==='equip'&&x.value===s));
    const pickedDelayIdx=target?(target.delays||[]).findIndex((c,idx)=>
      !selected.some(x=>x.targetSeat===targetSeat&&x.kind==='delay'&&x.value===idx)):-1;
    const selectedHands=selected.filter(x=>x.targetSeat===targetSeat&&x.kind==='hand').length;
    if(pickedEquipSlot) botInvoke(seat,()=>pickXuanfengCard('equip',pickedEquipSlot));
    else if(pickedDelayIdx>=0) botInvoke(seat,()=>pickXuanfengCard('delay',pickedDelayIdx));
    else if(target&&(target.hand||[]).length>selectedHands) botInvoke(seat,()=>pickXuanfengCard('hand'));
    else botInvoke(seat,()=>{
      tx(g2=>{
        if(g2.pending&&g2.pending.type==='xuanfengPick'&&g2.pending.from===mySeat){
          g2.pending.stage='selecting'; g2.pending.currentTargetSeat=null;
        }
        return g2;
      });
    });
    return;
  }
  // ---- 机器人兜底词汇盲区修复(问题3+4):以下几个phase的按钮文案够不到botSafePrompt的
  // 正则,分两类处理——纯流程性的(选哪个都不影响游戏走向)给合理默认;guhuoQuestion真的
  // 有策略含义,用不偷看隐藏信息的随机决策,不是随便点安全按钮。----
  if(g.phase==='luoyingAsk'&&d.seat===seat){
    // 曹植【落英】:白拿弃牌堆里的梅花牌,没有下行风险,合理默认是总是获得。
    botInvoke(seat,()=>respondLuoying(true)); return;
  }
  if(g.phase==='luoshen'&&d.seat===seat){
    // 甄姬【洛神】:循环判定,黑色继续拿牌、红色才结束,没有下行风险,合理默认是总是尝试
    // 发动(反正判红也只是这个技能结束,不会有额外损失)。
    botInvoke(seat,()=>respondLuoshen(true)); return;
  }
  if(g.phase==='huashenChangeAskStart'&&d.seat===seat){
    // 决策已进 BOT_DECISIONS.huashenChangeStart(无密钥回退=不更改,与旧分支逐字一致,
    // 见注册表上方注释)。phase+seat 守卫保留作双保险,命中即 return。
    if(await botDecide('huashenChangeStart',g,seat)) return;
  }
  if(g.phase==='huashenChangeAskEnd'&&d.seat===seat){
    // 决策已进 BOT_DECISIONS.huashenChangeEnd(无密钥回退=不更改,与旧分支逐字一致,
    // 见注册表上方注释)。phase+seat 守卫保留作双保险,命中即 return。
    if(await botDecide('huashenChangeEnd',g,seat)) return;
  }
  if(g.phase==='guhuoQuestion'&&d.asking===seat){
    // 于吉【蛊惑】质疑判断由总线接管(无密钥回退=固定30%随机质疑,与旧分支逐字一致;
    // AI视角经 buildBotGuhuoVisibleState 不含 d.actualCard,不偷看隐藏信息)。
    if(await botDecide('guhuoQuestion', g, seat)) return;
  }
  if(g.phase==='qiaobianMove'&&d.seat===seat){
    // 决策已进 BOT_DECISIONS.qiaobianMove(无密钥回退=不移动,与旧分支逐字一致,见注册表
    // 上方注释)。phase+seat 守卫保留作双保险,命中即 return。
    if(await botDecide('qiaobianMove',g,seat)) return;
  }
  // 【G1接线】seatPick 三个 pending 阶段(蛊惑选目标/旋风选目标/驱虎选伤害目标):
  // 与 play 分支同一套 seatPick 协议(候选合并表+AI 选),此前未接线时这三个阶段对
  // 机器人是死路径(botSafePrompt 够不到座位卡点击),命中即 return。
  // 【解锁无密钥兜底】原来这里也有一道 seatPickAiReady 门槛,和 play 分支那道 aiReady
  // 门槛同一个历史原因(13个fallbackSeat当时全是null)。这三个阶段各自的fallbackSeat
  // (guhuoTarget/xuanfeng/quhuDamage)这次已经换成有意义的本地评分,同一次去掉门槛,
  // 不留一半解锁一半没解锁的不一致状态。
  if(g.phase==='guhuoTarget' && d && d.type==='guhuoTarget' && d.sourceSeat===seat){
    if(await botDecide('seatPick', g, seat)) return;
  }
  if(g.phase==='xuanfengPick' && d && d.type==='xuanfengPick' && d.from===seat && d.stage==='selecting'){
    if(await botDecide('seatPick', g, seat)) return;
  }
  if(g.phase==='quhuDamageChoice' && d && d.type==='quhuDamageChoice' && d.seat===seat){
    if(await botDecide('seatPick', g, seat)) return;
  }
  // 【B类修复,机器人技能覆盖审计】骁果目标二选一:按钮是"弃置X【装备名】"(按已有装备槽
  // 各一个)+"受到1点伤害"。此前(无密钥)靠botSafePrompt的mandatory正则侥幸命中"弃置"
  // 类按钮,不是真的判断过——这次补一条确定性分支替换掉这个侥幸,同一个选择逻辑(优先
  // 弃装备,没有装备时受伤害)。位置刻意放在L1 controlsChoice之后、最终botSafePrompt
  // 之前:有AI密钥时应该让L1接管(AI能对"弃哪件装备"做更聪明的判断,run_ai_bus_l1_test.js
  // 的T19/T20锁定了这个设计,xiaoguoChoice故意不在CONTROLS_CHOICE_EXCLUDE里);没有
  // 密钥时L1直接返回false,落到这里,用确定性判断而不是碰运气的正则匹配。
  if(g.phase==='xiaoguoChoice' && d && d.type==='xiaoguoChoice' && d.to===seat){
    const target=g.players[seat];
    const slot=target&&target.equips&&EQUIP_SLOTS.find(s=>target.equips[s]);
    botInvoke(seat,()=>respondXiaoguoChoice(slot||'damage'));
    return;
  }
  if(botSafePrompt(g,seat)) return;
  console.warn('机器人暂未覆盖阶段',g.phase,d.type,seat);
}

// ================= Milestone C 基础:窗口谓词 + 一步动作枚举(Task C0) =================
// 【窗口谓词】C 循环的"该不该让 AI 接管"判定:只有"自己的出牌阶段、且当前没有任何挂起的
// 询问/结算(pending 为空)"才属于 C 的可操作窗口。第一版刻意只做 play 窗——响应类一步
// (出闪/无懈/濒死求桃等)足够,不强制进 C 循环;g.pending 非空(无懈窗口、濒死询问、选牌
// 子阶段等)一律不属于 play 窗。注意:本函数只判窗口,不负责执行——runBotDecision 现在
// 仍走 botPlay 老链路,C 循环接入是后续任务。
function isBotActionWindow(g, seat){
  if(!g || !g.players[seat] || !g.players[seat].alive) return false;
  if(g.phase==='play' && g.turn===seat && !g.pending) return true;
  return false;
}
// 【一步动作枚举】C 相对 B 的关键:一个候选 = 一个完整的合法动作(牌+目标合并成一条),
// AI 只问一次就能拿到"出什么牌、打给谁",消灭 botPlay 的"先问牌、再问目标"两次询问。
// 合法性枚举与 botPlay(botPlay ~1392)逐字同源:同一套 CARD_PLAYS.canPlay/canTarget、
// 借刀杀人排除、忠臣禁用群体AOE、满血桃排除——差别只在把需要目标的牌按目标展开成一条
// 条独立候选(botPlay 用 botBestTarget 挑一个最优目标,这里每个合法目标都各占一条)。
// 【C1 弱C新增】每条非结束候选补 localHeuristicScore,与 botPlay ~1428-1431 的本地启发式
// 逐字同源:botCardPriority(action) + (target!=null && target!==seat ? botTargetScore(...) : 0),
// 供无密钥兜底 localFallbackPlayWindow 复刻旧规则"最高价值牌 value>25 才打、否则结束出牌"
// (见 runBotActionWindow 上方弱C探测注释)。不四舍五入、不额外加权——弱C每步的兜底选择
// 必须和旧 botPlay 完全一致,这是 C1 的回归红线。botTargetScore 的 kind 参数照 botPlay
// 原样传 action 名(顺手/拆桥的 'steal' 加成都因此不生效,保持逐字同源)。
// 【mySeat 借用窗口】与 botPlay 枚举阶段同一约定:CARD_PLAYS 的 canPlay/canTarget 读取
// 全局 mySeat(杀的距离 canReachSha、闪电的 onlySelf 判定都读),评估期间必须切到机器人
// 座位、结束立刻归还。本函数纯同步,借用窗口和 botPlay 枚举段一样短,不跨越任何 await。
// 【v1 刻意不含】play 阶段 renderControls 渲染的主动技按钮(collectControlsCandidates)
// 没有并入——C0 只做"手牌×目标"展开,合并 controls 候选是 C1 的扩展项。
// 【T2 token 优化】候选 Top-K 截断:手牌×目标展开后可能几十上百条(5张杀×5目标=25条,
// 再叠拆桥/无中生有等轻松破50),全量塞给 AI 每步都烧 token。按 localHeuristicScore 降序
// 只保留前 25 条——排序让 AI 先看到最高价值的候选;结束项在截断之后才 push,恒在末尾、
// 不参与截断。无密钥兜底零变化:localFallbackPlayWindow 只取最高分非结束候选,Top-1
// (最高分)恒在截断结果里,fallback 选择与截断前一致(测试锁定)。
const AI_PLAY_CANDIDATE_LIMIT = 25;
function enumerateAllLegalOneStepActions(g, seat){
  const out = [];
  const me = g.players[seat];
  const humanSeat = mySeat;
  mySeat = seat;
  try{
    (me.hand||[]).forEach((card, idx)=>{
      const action = botActionId(card), spec = CARD_PLAYS[action];
      if(!spec || action==='借刀杀人') return;
      if(!spec.canPlay(g, me, card)) return;
      if(me.role==='zhong' && (action==='南蛮入侵'||action==='万箭齐发')) return;
      if(action==='桃' && me.hp>=me.maxHp) return;
      if(spec.target && action==='铁索连环'){
        const targets = [];
        g.players.forEach((p,i)=>{
          if(!p || !p.alive || i===seat) return;
          if(spec.canTarget && !spec.canTarget(g, me, card, i)) return;
          targets.push(i);
        });
        if(spec.allowSelf && spec.canTarget && spec.canTarget(g, me, card, seat)) targets.push(seat);
        targets.forEach(t=>{
          out.push({ label: '出【'+action+'】→'+g.players[t].name, action, card: botCardBrief(card), handIndex: idx, seat: t, target: t, localHeuristicScore: botCardPriority(action) + (t!==seat ? botTargetScore(g, seat, t, action) : 0) });
        });
        const pairs = [];
        for(let a=0; a<targets.length; a++){
          for(let b=a+1; b<targets.length; b++){
            const score = botTargetScore(g, seat, targets[a], action) + botTargetScore(g, seat, targets[b], action);
            pairs.push({ t1: targets[a], t2: targets[b], score });
          }
        }
        pairs.sort((x,y)=>y.score-x.score);
        pairs.slice(0,10).forEach(pair=>{
          out.push({ label: '出【'+action+'】→'+g.players[pair.t1].name+'+'+g.players[pair.t2].name, action, card: botCardBrief(card), handIndex: idx, seat: pair.t1, target: [pair.t1,pair.t2], localHeuristicScore: botCardPriority(action) + pair.score });
        });
      } else if(spec.target){
        // 展开:每个合法目标一条候选(合法性判定与 botBestTarget 同一道 canTarget)
        g.players.forEach((p,i)=>{
          if(!p || !p.alive || i===seat) return;
          if(spec.canTarget && !spec.canTarget(g, me, card, i)) return;
          out.push({ label: '出【'+action+'】→'+p.name, action, card: botCardBrief(card), handIndex: idx, seat: i, target: i, localHeuristicScore: botCardPriority(action) + botTargetScore(g, seat, i, action) });
        });
        // allowSelf 自目标兜底(沿用 botPlay 的 L3 通用写法,不按牌名特判):onlySelf 型
        // 延时锦囊(闪电)的合法目标只有自己,上面循环跳过自己后一个都不剩,这里补上;
        // 铁索连环这类 allowSelf 但可打他人的牌,canTarget 对己为真时同样多出一条合法候选
        // (playCard 的 allowSelf 放行自选目标,是完整合法的一步,不算越权)。
        if(spec.allowSelf && spec.canTarget && spec.canTarget(g, me, card, seat)){
          out.push({ label: '出【'+action+'】→自己', action, card: botCardBrief(card), handIndex: idx, seat, target: seat, localHeuristicScore: botCardPriority(action) });
        }
      } else {
        out.push({ label: '出【'+action+'】', action, card: botCardBrief(card), handIndex: idx, target: null, localHeuristicScore: botCardPriority(action) });
      }
    });
  } finally {
    mySeat = humanSeat;
  }
  // 【酒→杀顺序修复】酒的效果是"本回合下一张杀伤害+1"——这个加成必须先喝酒、再出杀才
  // 生效(game.js 的 jiuShaBonus 在酒使用时置真,由下一次结算杀时消耗;先出杀再喝酒,
  // 杀已经结算完了,加成纯粹浪费)。botCardPriority 是一张不带上下文的静态表(同一张表
  // 还用于弃牌优先级排序,那里"酒排在杀前面弃"本身没错,不能整体改表),杀的基础分
  // (66)天然高于酒(40),若本回合杀和酒同时是合法候选,不加处理时 localFallbackPlayWindow
  // (无密钥兜底,取最高分候选)和喂给 AI 的 localHeuristicScore 参考分都会把杀排在酒前面,
  // 导致机器人先出杀、酒的加成永远吃不到。这里只在"酒和杀同时是本次候选"这个具体场景下
  // 现算一次修正:把酒的候选分数拉到比场上所有杀候选都高一点,只影响这一次出牌决策的
  // 候选排序,不改动 botCardPriority 这张表本身(酒单独出现时的评分、以及弃牌场景的
  // 优先级都不受影响)。
  const jiuCandidate = out.find(function(c){ return c.action==='酒'; });
  if(jiuCandidate){
    const maxShaScore = out.reduce(function(m,c){ return c.action==='杀' ? Math.max(m,c.localHeuristicScore) : m; }, -Infinity);
    if(maxShaScore > -Infinity) jiuCandidate.localHeuristicScore = maxShaScore + 1;
  }
  // 按 localHeuristicScore 降序截断:保留最高分前 25 条(-Infinity 目标分正常参与排序,
  // 排序稳定,同分保持原枚举顺序);结束项在截断之后才 push,恒在末尾、不参与截断。
  out.sort(function(a,b){ return ((b.localHeuristicScore||0) - (a.localHeuristicScore||0)); });
  if(out.length > AI_PLAY_CANDIDATE_LIMIT) out.length = AI_PLAY_CANDIDATE_LIMIT;
  out.push({ label: '结束出牌阶段', action: '结束出牌阶段', card: null, handIndex: null, target: null, localHeuristicScore: null, isEndPlay: true });
  return out;
}

// ================= Milestone C1:弱C出牌窗执行器 =================
// ================= Milestone C2:强C出牌窗执行器(同窗多步循环) =================
// 【弱C→强C】C1 的探测结论(tx fire-and-forget、currentG 不同 tick 更新、同窗多步不可行)
// 在 SC1 给 tx/playCard/endPlay 加了可选提交回调之后不再成立:execute 后能拿到提交后的
// 新快照,循环体重枚举读到的就是最新状态。因此 runBotActionWindow 恢复循环——每次 execute
// 后 await 提交回调,拿新快照重枚举再决策,直到 结束出牌/步数上限/窗口失效/提交失败。
// 【无密钥兜底=旧规则逐字复刻】旧 botPlay 的启发式是"options[0].value>25 才打最高价值
// 牌,否则结束出牌"。localFallbackPlayWindow 在合并候选里找 localHeuristicScore 最大的
// 非结束候选,>25 就打它、否则打结束项——和旧 botPlay 每步行为完全一致(回归红线,
// run_ai_bus_c_window_test 有逐条断言)。无密钥时只执行一步即 return,不等待提交、
// 不循环(与 C1 弱C 逐字一致)——强C 只在 aiReady 时启用。
const BOT_WINDOW_MAX_STEPS = 8; // 强C循环步数上限(有密钥同窗多步时真正生效;无密钥每调度1步用不到)
// 提交回调超时兜底(毫秒):executePlayWindowChoiceAwait 等不到 onCommitted 时 resolve null,
// 防 stub/异常环境把 runBotActionWindow 挂死。测试可用裸标识符赋值覆盖(缩小到几十毫秒
// 加速超时路径——注意这是 let 不是 const,正是为了可覆盖)。
let BOT_COMMIT_TIMEOUT_MS = 5000;
function localFallbackPlayWindow(g, seat, candidates){
  let best = null;
  candidates.forEach(c=>{
    if(c.isEndPlay) return;
    if(best===null || (c.localHeuristicScore||0) > (best.localHeuristicScore||0)) best = c;
  });
  if(best && (best.localHeuristicScore||0) > 25) return best;
  return candidates.find(c=>c.isEndPlay) || candidates[candidates.length-1];
}
function executePlayWindowChoiceAwait(g, seat, choice){
  return new Promise(function(resolve){
    let settled = false;
    const timer = setTimeout(function(){ if(!settled){ settled = true; resolve(null); } }, BOT_COMMIT_TIMEOUT_MS);
    const onCommitted = function(newG){
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(newG);
    };
    if(choice && choice.isEndPlay){
      botInvoke(seat, function(){ endPlay(onCommitted); });
    } else {
      botInvoke(seat, function(){ playCard(choice.handIndex, choice.action, (choice.target != null ? choice.target : null), onCommitted); });
    }
  });
}
async function runBotActionWindow(g, seat){
  // 强C(Part A):有密钥时启用同窗多步循环——每次 execute 后等提交回调拿新快照,
  // 重枚举再决策,直到结束出牌/步数上限/窗口失效/提交失败。无密钥时保持弱C行为
  // (执行一步直接 return,不等待提交、不循环)——回归红线,测试锁定。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  let steps = 0;
  let lastG = (typeof currentG!=='undefined' && currentG) ? currentG : g;
  // 【意图链,2026-08】记录本出牌窗口内 AI 已做的每一步选择(label 如"出【顺手牵羊】→机器人1"),
  // 以 lastActions 字段注入后续每步的可见状态——AI 每次调用虽独立,但能明确看到自己上一步
  // 干了什么,不再靠 recentLog 猜"上一步结果",连续决策连贯性直接提升(token 增量:每步一条 label)。
  const windowHistory = [];
  while(steps < BOT_WINDOW_MAX_STEPS){
    if(!isBotActionWindow(lastG, seat)) break;
    const candidates = enumerateAllLegalOneStepActions(lastG, seat);
    if(!candidates.length) break;
    candidates.forEach((c,i)=>{ c.index=i; });
    let idx = null;
    if(aiReady && candidates.length>1){
      const state = buildBotVisibleState(lastG, seat);
      state.windowStep = steps;
      state.lastActions = windowHistory.slice();
      idx = await callAiChooseIndex({
        g: lastG, seat,
        systemPrompt: buildBotDefaultSystemPrompt()
          + '你处于同一出牌窗口的连续决策,每步只选一个完整合法动作(牌+目标已合并)。'
          + '你上一步执行后局面已经变化,请根据最新局面继续选择,直到选择结束出牌。',
        userPrompt: buildBotDefaultUserPrompt(state, candidates),
        candidates, maxTokens: 100,
      });
    } else if(candidates.length===1){
      idx = 0;
    }
    let choice;
    if(idx===null){
      choice = localFallbackPlayWindow(lastG, seat, candidates);
    } else {
      choice = candidates[idx];
    }
    if(choice && !(choice.isEndPlay || choice.action==='结束出牌阶段') && choice.label){
      windowHistory.push(choice.label);
    }
    const newG = await executePlayWindowChoiceAwait(lastG, seat, choice);
    steps++;
    if(choice && (choice.isEndPlay || choice.action==='结束出牌阶段')) break;
    // 无密钥:执行一步即返回(与弱C逐字一致);有密钥:等提交回调,拿不到新快照就 break
    if(!aiReady) return;
    if(!newG || newG===lastG){
      // 【bot_decision_failed 第一批接入点】强C同窗多步循环里最容易判断"提交是否真的
      // 生效"的地方:executePlayWindowChoiceAwait 等不到 tx 的 onCommitted 回调(超时
      // BOT_COMMIT_TIMEOUT_MS后resolve null),意味着这次选择的动作(playCard/endPlay)
      // 执行了但没能成功提交——很可能是服务端守卫拒绝、或提交过程本身出了问题。其余
      // 决策分支(seatPick/botTwoStepA等)大多是fire-and-forget、没有现成的"提交后拿到
      // 新快照"信号,接入需要较大改动,先不做,留 TODO(见下方 runBotDecision 顶部注释)。
      if(!newG && typeof writeDebugLog==='function'){
        writeDebugLog(typeof roomId!=='undefined'?roomId:null, 'bot_decision_failed', {
          phase: lastG.phase, pendingType: lastG.pending&&lastG.pending.type||null,
          turn: lastG.turn, roundNum: lastG.roundNum, seat: seat,
          message: '机器人在出牌窗口选择了动作('+(choice&&choice.action)+')但等不到提交确认(可能被服务端守卫拒绝)',
          // 【隐私修复,2026-08】原来直接 JSON.parse(JSON.stringify(lastG.pending)) 原样转存,
          // 和 logPendingOrphan 同一个漏洞——改用白名单化的 sanitizePendingForLog(debug-log.js),
          // 不在这里重新发明一套过滤规则。
          pendingSnapshot: (function(){ try{ return lastG.pending && typeof sanitizePendingForLog==='function' ? sanitizePendingForLog(lastG.pending) : null; }catch(e){ return null; } })(),
          playersSummary: typeof debugLogPlayersSummary==='function' ? debugLogPlayersSummary(lastG) : null
        });
      }
      break;
    }
    lastG = newG;
  }
}
