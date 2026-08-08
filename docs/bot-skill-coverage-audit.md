# 机器人技能覆盖审计清单

> **生成时间**：2026-08-08，对应代码版本 commit `e735561d5b0b435889229f8e58d7916d05772cb6`（分支 `chengcheng`）。
> 这份清单是对**当时那一份代码**做的静态审计，代码继续演进后清单会过时——复核方式见文末「如何验证这份清单是否过时」。
> **这次任务只做审计，不做修复**（和"郭嘉遗计"那次任务分开），下面列出的每一条都还没有被改动。
>
> **2026-08-08 更新（commit `9334e76`）**：原文档标记的全部 4 条 B 类已经修复，详见文末新增的
> 「B 类修复记录（commit 9334e76）」一节——修复过程中用真实 DOM harness 重新验证发现，原始的
> 静态审计**只检查了 `botSafePrompt` 的"safe"正则，漏看了另一条"mandatory"正则**，导致
> `zhijiChoice`/`xiaoguoChoice`/`tiaoxinChoice` 这 3 条的严重程度被高估（实际是"侥幸命中一个
> 正则匹配出来的默认选项"，不是真卡死）；只有 `huanhuoPickGotCard` 子阶段被验证为真卡死。
> 这个方法论纠正也记录在下面新增的小节里，供以后审计类似问题时参考。

## 审计方法（供复核者对照）

1. 枚举所有"需要玩家主动决策"的入口：`skills.js`/`game.js`/`weapons.js` 里的 `start*` 系列函数；所有创建 `g.pending={type:'xxx',...}` 的代码位置；`render-controls.js` 里渲染出真实按钮的 `g.phase===`/`.type===` 分支；`data.js` 里 `GENERALS` 表的 `hooks`。
2. 对每一个找到的 `pending.type`/`g.phase` 标识符，交叉核对：
   - `bot.js` 的 `BOT_PHASE_ACTOR` 表里是否登记了行动者字段；
   - `runBotDecision` 函数体（`bot.js:3533`-`4249`）里是否有直接引用这个字面量的硬编码分支、或对应的 `BOT_SEAT_PICKS`/`BOT_DECISIONS` 注册项；
   - 如果两者都没有，进一步确认它是否落进 `botFallbackSeats`+`botSafePrompt`（`bot.js:284`-`296`）这条兜底路径；`botSafePrompt` 的安全正则是 `/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/`。
   - **一个关键的、审计过程中发现的细节**：`runBotDecision` 最末尾（`bot.js:4247` 附近）有一句 `if(botSafePrompt(g,seat)) return;` 兜底，这意味着即使某个 phase 在 `BOT_PHASE_ACTOR` 里**已经登记了行动者**（能正确解析出该谁行动），只要它没有专属的决策分支、也没有落进 `CONTROLS_CHOICE_ALLOWLIST`（无密钥时只有 `wuxie`/`luoyingAsk`/`luoshen` 三项能走 L1 通用镜像机制），一样会落到这条 `botSafePrompt` 兜底——和"完全没有任何机器人代码认识"的阶段是**同一条兜底路径、同一套判定标准**，只是走到这条路径的原因不同。这次审计按**实际兜底行为**（能不能点到安全按钮）分类，不是按"有没有 BOT_PHASE_ACTOR 登记"分类。
3. 每一条判断"兜底命中的是安全按钮还是卡死"，都去 `render-controls.js` 读了实际渲染的按钮文案，不是猜测。

## 汇总统计

| 分类 | 数量 | 说明 |
|---|---|---|
| A 类 | 0（**原 9 条已于 commit `4b37520` 全部修复**，见文末「A 类修复记录」） | 兜底命中"不发动/取消"类按钮，等价于永远不发动 |
| B 类 | 0（**原 4 条已于 commit `9334e76` 全部修复**，见文末「B 类修复记录」） | 兜底可能找不到任何可点按钮，存在卡死风险 |
| C 类 | 2 条（**原 3 条，于吉蛊惑发动入口已于 commit `4b37520` 修复**；明策/眩惑的发动入口评估后维持现状，非遗漏，见下方说明） | 多步流程只接了后半段，发动入口本身缺失 |
| D 类 | 0 | 未发现新的"只在有 AI 密钥时才生效"的登记项（上一轮 `BOT_SEAT_PICKS` 那批已经在此前任务解锁） |
| E 类 | 约 101 个 `pending.type`（见文末列表逐一列名，含本次两轮修复后转入的合计 16 个） | 已完整接线、无密钥也能正常触发 |

这次审计一共交叉核对了约 **105 个** `pending.type`/`g.phase` 决策入口点（A9+B7+C3(仅入口函数，不计入phase统计)+E约85+已修复的ganglieAsk/guiduAsk/jiangchiAsk/yijiAsk等计入E类，不包含 `play`/`draw`/`discard`/`respond`/`duel` 等基础引擎阶段——这些属于核心机制而不是"武将/装备/锦囊技能"，且早已被大量既有测试覆盖，不在这次审计范围内）。

---

## A 类：兜底命中"不发动"类按钮，等价于永远不发动

**本次审计当时列出的 9 条已经全部修复，见文末「A 类修复记录（commit `4b37520`）」。**这一节原有的表格内容已经移到该小节存档，不再作为"待处理"清单出现在这里。

---

## B 类：兜底可能找不到任何可点按钮，存在卡死风险

**本次审计当时列出的 4 条已经全部修复，见文末「B 类修复记录（commit 9334e76）」。**这一节原有的表格内容已经移到该小节存档（保留原始判断和修复后纠正的对比），不再作为"待处理"清单出现在这里。

---

## C 类：多步流程只接了后半段，发动入口本身缺失

和"郭嘉遗计只接了 `yijiAssign` 没接 `yijiAsk`"是同一类问题——技能真正的"发动决策"从未被机器人做出过，即便后续步骤接线完整也用不上。

| 技能/武将 | 发动入口 | 代码位置 | 已接线的后续步骤 | 备注 |
|---|---|---|---|---|
| 于吉【蛊惑】 | `startGuhuo(cardIdx, claimedName)` / `startGuhuoResponse(cardIdx, claimedName)` | `skills.js:530`、`skills.js:559` | `guhuoQuestion`（`BOT_DECISIONS.guhuoQuestion`）、`guhuoTarget`（`BOT_SEAT_PICKS.guhuoTarget`）均完整接线 | **已于 commit `4b37520` 修复**：加进 `botTryStartExtraSkills`（和天义/强袭/乱武/乱击/奋迅同一套play阶段主动发动检测入口），只接"声明为【杀】"这一种最常见用法（`startGuhuoResponse` 那种响应上下文里的"诡称"仍未接，见下方新增说明）。 |
| 陈宫【明策】 | `startMingce()` | `game.js:3211` | `mingcePickCard`/`mingcePickTarget`/`mingcePickTarget2`/`mingceChoice` 全部有专属 `runBotDecision` 分支（"防御性收录"） | **评估后维持现状，非遗漏**。这是此前"机器人主动技能解锁"任务里已经评估过、明确记录在案的保守决策（见该次任务的commit说明："明策...对发动者自己净收益不明确，和举荐/仁心同一基调保守默认不主动发动"）。本次A类修复任务的说明里明确要求"这两个不用改"，继续保持现状。 |
| 法正【眩惑】 | `startHuanhuo()` | `game.js:7242` | `huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond` 四个子阶段**已于 commit `9334e76`（B类修复）补齐决策**（见「B 类修复记录」），但发动入口本身仍未接线 | **评估后维持现状，非遗漏**。同上，此前任务里已经评估过的保守决策，本次A类修复任务明确要求不碰。子阶段已经预先打好补丁（见B类修复记录），如果以后要接发动入口，只需要在 `botTryStartExtraSkills` 里补"是否发动+选目标"这一步，不需要再担心子阶段卡死。 |

**关于于吉【蛊惑】的 `startGuhuoResponse` 补充说明**：`startGuhuoResponse(cardIdx, claimedName)` 是蛊惑的另一种用法——在自己被要求响应杀/闪/桃/无懈可击时，"诡称"手里一张不相关的牌就是对应的响应牌（一种响应上下文里的博弈/伪装）。这次**只修了 `startGuhuo`（出牌阶段主动声明），没有修 `startGuhuoResponse`**——原因是后者是在别人的响应决策点上叠加一层"是否诡称"的判断，比"出牌阶段主动发动"复杂得多（需要先读懂原本的respondShan/duelResponse/respondDying/respondWuxie各自的决策，再叠加一层诡称是否有利的判断），这次任务范围内没有覆盖，留作以后单独评估。

---

## D 类：已完整接线但仅在配置 AI 密钥时生效

本次审计**没有发现新的 D 类实例**。此前"机器人主动技能解锁"任务已经把 `BOT_SEAT_PICKS` 的全部 13 项从"仅 `aiReady` 时生效"解锁为"无密钥也能走本地兜底"（`bot.js:3623` 注释可查）；这次交叉核对 `BOT_SEAT_PICKS`/`BOT_DECISIONS`/`BOT_PHASE_ACTOR` 全表，未找到类似的残留门槛。

（A 类里 `liuli`/`tianxiang`/`lirangRecover`/`zhengyi` 那 4 条，虽然表面上也是"和 AI 密钥有关"，但严格来说不算 D 类——D 类的定义是"有密钥时能正常工作、无密钥时不工作"，而这 4 条**即使配置了 AI 密钥**，由于不在 `CONTROLS_CHOICE_ALLOWLIST` 里，L1 通用镜像机制依然不会接管它们，是否有密钥对它们的行为没有区别，一直都是靠 `botSafePrompt` 兜底点"不发动"——这也是为什么归进 A 类而不是 D 类。)

---

## E 类：已完整接线，无密钥也能正常触发（仅列名单，佐证清单完整性）

以下这批 `pending.type`/`g.phase` 都在 `BOT_PHASE_ACTOR` 登记了行动者字段，且在 `runBotDecision` 里能找到引用该字面量的专属分支（硬编码 if 分支，或 `BOT_DECISIONS`/`BOT_SEAT_PICKS` 注册项），交叉核对后确认无密钥模式下也能正常决策，不需要逐条展开细节：

`aoeResp`、`beigeChoose`、`beigeDiscard`、`beigeJudge`、`biyue`、`buquAsk`、`chengxiangAsk`、`chengxiangChoose`（经 `chengxiangAsk` 的actor+内部按 `d.type` 二次分派，见 `bot.js:3886`）、`cixiongAsk`、`cixiongChoice`、`duanbingChoose`、`duel`、`dying`（**注意**：`dying` 这个 phase/pending.type 本身早就完整接线（桃/不出两个通用选项），但审计当时漏看了"同一个 pending.type 下，庞统自己濒死时还有第三个专属候选——发动限定技【涅槃】"，导致机器人庞统永远不会主动发动涅槃自救；已于涅槃修复任务里补上，见文末「涅槃修复记录」）、`enyuanChoose`、`enyuanChooseOption`、`enyuanGiveCard`、`fanjianSuit`（`BOT_SEAT_PICKS.fanjian`）、`fenxunDiscard`、`fenxunTarget`、`ganglieAsk`（"郭嘉遗计"任务里修过）、`ganglieChoice`、`guanshi`、`guanxingReview`、`guhuoQuestion`、`guhuoTarget`（经 `BOT_SEAT_PICKS.guhuoTarget` 特殊路径，见 `bot.js:1956,2028,4238`(行号已核对)）、`guicai`、`guiduAsk`（"郭嘉遗计"任务里修过）、`hanbing`、`hanbingAsk`、`haoshiPick`、`huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond`（本次B类修复任务补齐，见文末修复记录——发动入口`startHuanhuo`仍未接线，这四个子阶段目前实际不会被触发，属于"预先打好补丁"）、`huashenChangeAskEnd`、`huashenChangeAskStart`、`huashenChangePickEnd`、`huashenChangePickStart`、`huashenPick`、`hujiaAsk`、`huogong`、`huogongReveal`、`jiangchiAsk`（"郭嘉遗计"任务里修过）、`jiedaoChoice`、`jiemingAsk`、`jijiangAsk`、`jiushiFlipAsk`、`jujianChooseEffect`、`jujianPickCard`、`jujianPickTarget`、`jushouChoose`、`leijiChoose`、`leijiJudge`、`lianyingAsk`、`lieRenChoose`/`lieRenPickCard`（本次A类修复任务补齐，专属分支+askedAt，见文末「A类修复记录」——发动方，拼点结构同天义，固定发动+选点数最大牌）、`lieRenRespond`（响应方，早就接好，和发动方是两个不同的座位视角）、`liegong`、`lirangAsk`、`luanjiChoose`、`luanjiConfirm`、`luanwuChoose`、`luoshen`（`CONTROLS_CHOICE_ALLOWLIST`）、`luoyiAsk`、`luoyingAsk`（`CONTROLS_CHOICE_ALLOWLIST`）、`mengjin`、`mingceChoice`、`mingcePickCard`、`mingcePickTarget`、`mingcePickTarget2`（这四个属于"陈宫明策"链条**后半段**接线，本身没问题，只是永远走不到——见上方 C 类说明）、`pick`、`qiangxiChooseCost`、`qiangxiChooseWeaponFromHand`、`qiangxiPickTarget`、`qiaobianMove`、`qiaomengChoose`、`qiaomengPickEquip`、`qilin`、`qinglong`、`quhuDamageChoice`（`BOT_SEAT_PICKS.quhuDamage`）、`quhuRespond`、`renxinChoose`、`respond`、`shaOffsetChoice`、`shensuSha`、`shuangxiongAsk`、`tianyiPickCard`、`tianyiPickTarget`、`tianyiRespond`、`tiaoxinChoice`（本次B类修复任务补齐，专属分支+askedAt，见文末修复记录；改动前经真实验证是"mandatory正则侥幸命中"而非真卡死）、`tiaoxinDiscard`（`BOT_SEAT_PICKS.tiaoxin` 发动方，和 `tiaoxinChoice` 目标方是两个视角）、`tieqi`、`wangxiAsk`、`wugu`、`wuxie`（`CONTROLS_CHOICE_ALLOWLIST`）、`xiaoguo`、`xiaoguoChoice`（本次B类修复任务补齐专属分支，位置特意放在L1之后——见文末修复记录）、`xinshengAsk`、`xuanfengPick`（`BOT_SEAT_PICKS.xuanfeng`）、`xunxunPick`、`yaowu_choose`、`yijiAsk`、`yijiAssign`（"郭嘉遗计"任务里修过）、`zhibaAsk`、`zhimengAsk`、`zhimengPick`、`zhijiChoice`（本次B类修复任务补齐，见文末修复记录；改动前经真实验证是"mandatory正则侥幸命中"而非真卡死）、`liuli`（本次A类修复任务补齐专属分支，位置放在L1之后、不进EXCLUDE——和xiaoguoChoice同一原因，有密钥时仍交给L1/AI接管，见文末「A类修复记录」）、`tianxiang`（同liuli，位置同理放在L1之后）、`lirangRecover`（同上，位置放在L1之后；决策是主动回收，零代价纯收益）、`zhengyi`（同上，位置放在L1之后；决策是保守默认不发动）、`shensuChoose1`/`shensuChoose2`（本次A类修复任务补齐，两个独立决策点，各自有自己的限一次标志，均保守默认不发动）、`qiaobianTurnStart`（本次A类修复任务补齐，保守默认不发动，和已接线的qiaobianMove同一基调）、`guhuoTarget`初始发动侧的`startGuhuo`（本次A类修复任务加进`botTryStartExtraSkills`，声明为【杀】，见文末「A类修复记录」，注意这不是新增pending.type，只是新增了一个play阶段主动发动检测点）。

（未列入 E 类清单的 `over`/`play`/`draw`/`discard`/`pickingGeneral`/`pickingLordGeneral` 等属于核心引擎阶段，走 `botSeatForState` 的 Category A 特殊分支或既有的 `draw`/`play`/`discard` 通用逻辑，不属于"武将/装备/锦囊技能"范畴，不计入这份清单的统计口径。）

---

## A 类修复记录（commit `4b37520`）

这一节存档原始审计判断（"兜底命中`safe`正则里的'不发动/不获得/取消'类按钮，永远不发动"）以及这次修复时的根因确认、修复方式、默认决策理由。9 条 A 类 + 1 条 C 类（于吉蛊惑发动入口）一并记录，因为后者本质是同一类问题。

| 技能/武将 | phase / pending.type | 原始审计判断 | 根因确认 | 修复方式与默认决策理由 |
|---|---|---|---|---|
| 大乔【流离】 | `liuli`，actor=`pending.to` | 兜底命中"不获得"，永远不转移伤害 | `respondLiuli(choice,newTarget)`：`choice=null` 即不发动，代价是自己承受伤害；有明确的"转嫁给别人"收益，无额外下行代价 | 补 `BOT_PHASE_ACTOR.liuli='to'` + 专属分支：能找到有效新目标（`botTargetScore>-Infinity`）就发动，出牌用手牌第一张（不够则用装备槽第一件），否则不发动；补 `setResponseAskedAt`+超时兜底（`respondLiuli(null,null)`）。**位置故意放在 L1 `controlsChoice` 之后、不进 EXCLUDE**——有密钥时仍可能被 AI 接管，这只是无密钥时的确定性默认 |
| 小乔【天香】 | `tianxiang`，actor=`pending.seat` | 兜底命中"不获得"，永远不转移伤害 | `respondTianxiang(cardChoice,newTarget)`：同流离机制（转移伤害给别人，代价是打出一张红桃） | 同流离：有红桃手牌+有效目标就发动，否则不发动；`setResponseAskedAt`+超时兜底；位置同样放 L1 之后 |
| 孔融【礼让】回收 | `lirangRecover`，actor=`pending.from` | 兜底命中"不获得" | 读完 `respondLiRangRecover` 才发现：这是**零代价纯收益**（孔融白拿回之前送出的牌），审计报告把它错误归类为"给别人东西换回报"的博弈类技能，实际不是 | 固定发动（`respondLiRangRecover(true)`），不是保守默认——这条已有 `setResponseAskedAt`，只补专属分支+超时兜底（同样是 `true`） |
| 孔融【争义】 | `zhengyi`，actor=`pending.asking` | 兜底命中"不发动" | `respondZhengyi(true)` 是孔融主动把手牌给别人换取对方感激（纯粹自我牺牲，无确定性回报） | 保守默认不发动（`respondZhengyi(false)`）；已有 `setResponseAskedAt`，补专属分支+超时兜底；位置同样放 L1 之后（有密钥时留给 AI 判断局面） |
| 祝融【烈刃】发动 | `lieRenChoose`，actor=`pending.sourceSeat` | 兜底命中"不发动" | `triggerLieRen`/`pickLieRenCard`/`cancelLieRen`：拼点机制，赢家造成伤害，输家自己受伤（拼点结构和天义类似，正向期望） | 固定发动（`triggerLieRen`），两步流程第二步见下一条；补 `BOT_PHASE_ACTOR`+`setResponseAskedAt`+超时兜底（`cancelLieRen`） |
| 祝融【烈刃】选牌 | `lieRenPickCard`，actor=`pending.sourceSeat` | 兜底命中"不发动"（第二步同样被挡） | 拼点选牌无隐藏信息博弈价值，选点数最大的牌胜率最高 | 选手牌里 `rank` 最大的一张（`pickLieRenCard(bestIdx)`），无手牌则 `cancelLieRen`；补 `BOT_PHASE_ACTOR`+`setResponseAskedAt`+超时兜底 |
| 夏侯渊【神速1】 | `shensuChoose1`，actor=`pending.seat` | 兜底命中"不发动" | 确认是**独立决策点**（准备阶段判定/摸牌前触发，有专属限一次标志 `shensuUsed1`，和神速2是两个完全独立的触发时机，不是同一决策的两个分支） | 保守默认不发动（`skipShensu1`）；补 `BOT_PHASE_ACTOR`+`setResponseAskedAt`+超时兜底 |
| 夏侯渊【神速2】 | `shensuChoose2`，actor=`pending.seat` | 兜底命中"不发动" | 确认是另一个独立决策点（摸牌阶段结束/出牌前触发，`shensuUsed2`） | 保守默认不发动（`skipShensu2`）；补 `BOT_PHASE_ACTOR`+`setResponseAskedAt`+超时兜底 |
| 张郃【巧变】回合开始 | `qiaobianTurnStart`，actor=`pending.seat` | 兜底命中"不发动" | 这是巧变技能在**回合开始时**的独立触发入口，和出牌阶段中途版本 `qiaobianMove`（已接线）是同一技能两个不同触发时机 | 保守默认不发动（`qiaobianDecline`），不重新发明局面评估逻辑，和 `qiaobianMove` 的既有保守基调一致；补 `BOT_PHASE_ACTOR`+`setResponseAskedAt`+超时兜底 |
| 于吉【蛊惑】发动入口（C类） | 无新增 phase，`startGuhuo(cardIdx,claimedName)` 挂在 `play` 阶段 | 审计标注"响应侧已完整接线，发动入口从未被调用" | `finishGuhuo(g,false)`（诡称被戳穿）只是把这张牌正常弃置，和普通打出一张没用的牌代价相同——没有额外惩罚，纯粹的"低成本试探" | 加进 `botTryStartExtraSkills`（和天义/强袭/乱武/乱击/奋迅同一批play阶段主动发动检测入口）：手牌里找一张能声明为【杀】且对某个存活目标有合法目标的牌，声明后发动；找不到就不发动。只接"声明为杀"这一种最常见用法，`startGuhuoResponse`（响应上下文里的诡称）留作后续单独评估，不在这次范围内 |

**测试**：新增 `run_aclass_fix_test.js`（17 个场景，覆盖上述全部 9 条 A 类 + 1 条 C 类的 `BOT_PHASE_ACTOR` 登记、专属分支真实调用、`askedAt` 设置、以及 guhuo 的"有/无合法目标"两种边界）。差分验证（`git stash` 还原修复前代码重跑）确认 14/17 断言在修复前会失败（其余 3 条是 askedAt-已存在检查和 guhuo 无目标负控制，修复前后行为本就一致）。另外修正了 `run_ai_bus_l1_test.js` 里两处因为这次设计变更而变得"语义已经不成立但仍然侥幸通过"的旧断言（liuli/tianxiang 的 T13/T18 场景，原先断言修复前的 `(null,null)` 兜底结果；发现原因是这两个测试的 `mkG` fixture 遗留了 `role:'zhu'`，触发 `botTargetScore` 的身份模式嫌疑度逻辑返回 `-Infinity`，加 `role=null` 清理后改为断言新的主动发动行为）；以及 lirangRecover 的一处真实回归断言（旧断言期望 `respondLiRangRecover(false)`，现在正确的行为是 `true`）。

---

## 涅槃修复记录（新增独立问题，非当年审计里列出的 A/B/C 类条目）

**这条问题的性质和 A/B/C 类都不一样，单独记录**：`dying` 这个 `pending.type` 本身在当年审计里被正确归为 E 类（已完整接线），因为通用的"打出【桃】救援 / 不出"两个候选确实早就有专属分支、无密钥也能正常决策——审计当时的检查方法（对照 `BOT_PHASE_ACTOR` + `runBotDecision` 里能不能找到引用该字面量的分支）在这条上完全命中，没有走到 `botSafePrompt` 兜底那一条判断链。**真正的盲区是审计方法本身没有考虑"同一个 pending.type 下，不同角色可能有不同数量的专属候选项"这种情况**——庞统自己濒死时，除了桃/不出，服务端还接受第三种动作（`useNiepan()`，发动限定技【涅槃】自救），但这第三个候选完全没有反映在 `dyingBuildCandidates` 里，机器人技术上"该谁行动"、"落哪个分支"全都正确，只是分支内部枚举的候选列表本身不完整，这种"看起来完整接线、实际漏了角色专属分支"的情况，用"检查 phase 是否有专属分支"这个粗粒度方法是查不出来的，需要针对具体角色能力（`hasCap`）逐条核对该阶段是否有这类附加分支。

| phase / pending.type | 涉及角色 | 原始审计判断 | 根因确认 | 修复方式 |
|---|---|---|---|---|
| `dying`（自己濒死时） | 庞统【涅槃】(niepan) | 归为 E 类"已完整接线"，未发现问题（审计方法本身的盲区，不是误判——通用桃/不出分支确实是完整的） | `dyingBuildCandidates(g,seat)` 只枚举了"打出【桃】救援"和"不出"两个候选，从未把"发动【涅槃】"纳入——即使当事人是庞统、拥有 `niepan` 能力、且这局还没用过限定技、且当前正是自己被问（`d.seat===seat`，涅槃唯一合法的发动时机，对齐服务端 `useNiepan()` 的守卫 `g.pending.seat===mySeat && hasCap(me,'niepan') && !me.nirvanaUsed`） | `dyingBuildCandidates` 补上第三候选（仅当 `d.seat===seat && hasCap(p,'niepan') && !p.nirvanaUsed` 时才加，其它角色/已用过涅槃时候选列表不变，还是只有桃/不出两项）；`dyingExecute` 选中该候选时调用 `useNiepan()` 而不是 `respondDying`；`dyingLocalFallback` 补默认触发规则（见下）；`dyingSystemPrompt` 补充说明涅槃效果，让有密钥时 AI 也能看到并权衡这个选项 |

**涅槃默认触发规则（无密钥时的本地兜底逻辑，`dyingLocalFallback`）**：涅槃效果是"弃光手牌+装备+判定区的牌，复原武将牌，回复至 3 点体力，摸 3 张牌"（`game.js:useNiepan`）——本质是一次"清空重置"，值不值得发动关键看"这次要弃掉的东西值多少"：
1. **没有桃可用时**：不发动涅槃就是坐视自己阵亡，涅槃怎么都比等死强——直接选涅槃。
2. **有桃可用时**：只有"手牌张数 + 已装备件数"总和 ≤ 2（相当于身上基本没什么值得留的东西）才选涅槃换满血 + 摸 3 张；超过这个阈值就继续走原有"有桃就救"的逻辑，不抢占更省资源的选项（手牌/装备里可能压着更值钱的牌，比如别的桃、强力装备，弃了不划算）。

这不是精细的收益评估模型，是一个"说得过去"的启发式阈值，和项目里其它技能默认决策的一贯风格一致（给一个合理默认，在注释里写清楚理由，不追求最优解）。

**测试**：新增 `run_niepan_dying_bot_test.js`（10 个场景），覆盖：候选列表在"自己濒死+庞统+未用过"时含涅槃选项、"已用过涅槃"和"非庞统"时不含涅槃选项、"救别人"时不含涅槃选项（涅槃只能自救）；`dyingLocalFallback` 在无桃/有桃但资源少/有桃且资源多三种条件下分别选中涅槃/涅槃/打桃；`dyingExecute` 选中涅槃后真实调用 `useNiepan()` 并验证装备清空、体力回复至 `min(maxHp,3)`、摸到牌、`nirvanaUsed` 置真、濒死流程结束；以及两条回归（非庞统场景桃/不出判断不受影响）。`git stash` 差分验证：还原 `bot.js` 后 10 条里 4 条（涉及涅槃候选/涅槃默认选择/涅槃执行）失败，其余 6 条（涅槃不该出现的三个负向场景 + 两条既有回归）修复前后一致，证明测试对新代码路径有真实检测力。另确认 `run_ai_bus_l3_test.js`（224 项全过）、`run_identity_mode_test.js`（35 项全过）、`run_cixiong_test.js`（17 过 3 败，这 3 条失败在改动前后一致，是该文件里与本次改动无关的既有失败，不是新引入的回归）不受影响。

---

## B 类修复记录（commit `9334e76`）

这一节存档原始审计判断 vs 修复时真实验证的结果，供以后对照。

| 技能/武将 | phase / pending.type | 原始审计判断 | 修复时真实验证的结果 | 修复方式 |
|---|---|---|---|---|
| 姜维【志继】觉醒 | `zhijiChoice` | 两个按钮"回复1点体力"/"摸两张牌"都不匹配安全正则，真卡死 | **误判**——"回复1点体力"命中 `botSafePrompt` 的 mandatory 正则（含"回复"），改动前已经能稳定点掉，只是"侥幸命中"不是真判断 | 补 `BOT_PHASE_ACTOR.zhijiChoice='seat'` + 专属分支：体力≤1时回复体力（保命），否则摸两张牌（觉醒条件本身是手牌为0，最缺资源）；补 `setResponseAskedAt` + 超时兜底 |
| 典韦【骁果】受害者二选一 | `xiaoguoChoice` | 无装备时侥幸走通，有装备时真卡死 | **部分误判**——有装备时"弃置武器【X】"命中 mandatory 正则（含"弃置"），改动前已经能稳定点掉，不是真卡死；askedAt 此前已经正确设置（不是遗漏点） | 补专属分支：优先弃装备，无装备时受伤害（结果和 mandatory 正则侥幸命中一致，但这次是真判断）。**位置特别注意**：放在 L1 `controlsChoice` 之后、不进 `CONTROLS_CHOICE_EXCLUDE`——`xiaoguoChoice` 是 `run_ai_bus_l1_test.js` T19/T20 锁定的"有密钥时故意留给 L1/AI 接管"的既定设计，第一版改动误放位置导致这两条测试失败，已改正 |
| 姜维【挑衅】目标二选一 | `tiaoxinChoice` | 无可用杀时侥幸走通，有可用杀时真卡死 | **误判**——有可用杀时"被弃置一张牌"命中 mandatory 正则（含"弃置"），改动前已经能稳定点掉（点的是被弃牌，不是出杀），不是真卡死 | 补 `BOT_PHASE_ACTOR.tiaoxinChoice='to'` + 专属分支：能出杀就出杀反击（进攻收益），不能则回退被弃牌；补 `setResponseAskedAt` + 超时兜底（默认被弃牌，保守） |
| 法正【眩惑】四个子阶段 | `huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond` | 标记"潜在"B类，未逐一验证按钮 | **部分确认**——`huanhuoPick`/`huanhuoPickCard` 都有"取消"按钮命中 safe 正则（不是真卡死）；`huanhuoPickGotCard` 在目标同时有手牌和装备时两个按钮都不匹配任何正则，是这次唯一验证为**真卡死**的子阶段 | 四个子阶段全部补 `BOT_PHASE_ACTOR`(`sourceSeat`) + 专属分支 + `setResponseAskedAt` + 超时兜底，决策走"确定性兜底，固定选第一个候选"（和明策同一基调）。发动入口 `startHuanhuo` 仍未接线，这四个子阶段目前实际不会被触发 |

**方法论纠正（供以后审计参考）**：`botSafePrompt`（`bot.js:3522`）实际有两条正则依次尝试：
```js
const safe=buttons.find(b=>/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/.test(b.textContent||''));
const mandatory=buttons.find(b=>!/发动/.test(b.textContent||'')&&/选择|交给|弃置|摸牌|回复|打出/.test(b.textContent||''));
const chosen=safe||mandatory||(buttons.length===1?buttons[0]:null);
```
原始审计只检查了 `safe` 这一条，凡是不匹配 `safe` 的按钮就断定"卡死"——但只要按钮文案含"弃置"/"回复"/"选择"/"交给"/"摸牌"/"打出"这几个字（且不含"发动"），就会命中 `mandatory`，不会卡死。**以后判断某个 phase 是否真的会卡死，必须对着这两条正则都测一遍，不能只测第一条**；更可靠的做法是像这次修复时那样，用真实 DOM harness（`run_ai_bus_l1_test.js`/`run_bot_bclass_fix_test.js` 的 `mkEl`/`documentStub` 那套）直接跑一次 `botSafePrompt(g,seat)`，看它的真实返回值和真实点击的按钮，不要只读正则源码做人工推断。

## 修复前"侥幸命中"版本在非巧合局面下的实际后果复盘（追加于 commit 后）

针对 `zhijiChoice`/`xiaoguoChoice` 这两条修复前"命中 mandatory 正则、不是真卡死"的结论，进一步复盘：这两条历史上（在这次修复之前）到底做出过什么实际决策，是不是存在"没有卡死、但一直在做次优甚至有害选择"的情况。**这类分析针对的是已经发生过的对局，没有办法追溯修复，只能说清楚后果、帮助判断影响范围。**

- **姜维【志继】觉醒（`zhijiChoice`）**：两个按钮"回复1点体力"/"摸两张牌"是**无条件都渲染、顺序恒定**的（`render-controls.js:2684-2686`，不随游戏状态变化）。`botSafePrompt` 的 `buttons.find(mandatory)` 取的是数组里第一个匹配项——由于"回复1点体力"排在"摸两张牌"前面，且只有前者命中 mandatory 正则（含"回复"二字），**这个选择是 100% 确定性的，不是"运气好坏"，是每一次触发都会选同一个按钮**。也就是说：修复前，只要机器人玩姜维觉醒（一局仅一次），**无论当时体力是不是已经满、无论手牌多缺，永远选"回复1点体力"，从未真正选过"摸两张牌"**。后果：觉醒条件本身要求"手牌为0"，这一刻恰好是全局最缺资源的时刻——如果姜维当时体力已经不低（比如满血或体力还剩2点以上），"摸两张牌"通常比单点体力更有价值，但机器人从未选过这个更优选项。这不是"卡死"，但确实是一个**从技能上线起就存在的、系统性偏向单一选项的次优决策**，只是代价相对温和（两个选项都是纯收益，差的是"哪个更划算"，不是"选错了会掉血/送人头"那种量级的伤害）。
- **典韦【骁果】受害者二选一（`xiaoguoChoice`）**：按钮集合会随目标装备情况变化（`EQUIP_SLOTS.forEach` 按 weapon→armor→plus1→minus1 固定顺序生成弃装备按钮，最后追加"受到1点伤害"）。`mandatory` 正则会命中**第一件已装备的槽位对应的按钮**（因为"弃置X【装备】"含"弃置"二字，恒排在"受到1点伤害"之前）。这次修复时新写的确定性分支用的是同一个 `EQUIP_SLOTS.find(s=>target.equips[s])` 逻辑——**和修复前 mandatory 正则命中的结果完全一致**（这也是为什么差分测试里这条的两个断言修复前后都通过，见上次提交说明）。也就是说：`xiaoguoChoice` 历史上的实际决策是"总是弃置按 weapon→armor→plus1→minus1 顺序里第一件存在的装备，没有任何装备时受到1点伤害"——这个默认本身是不是"最优"（比如weapon可能是更值得保留的关键道具，未必总该最先舍弃）是一个可以再讨论的价值判断，但**它不是随机的、也没有"有害"到明显错误的程度**，历史决策和这次修复后的决策是同一个结果，没有额外暴露风险。

**结论**：`zhijiChoice` 存在一个确定性的、持续性的次优决策（每次都放弃"摸两张牌"这个通常更优的选项），影响的是"决策质量"不是"游玩体验会不会卡住"，代价温和；`xiaoguoChoice` 的历史决策和修复后的决策实际上完全一致，没有隐藏的负面后果。两者都不是"卡死"级别的问题，`zhijiChoice` 这一条的价值判断偏差理论上已经通过这次修复（体力≤1时改选回复、否则摸牌）纠正，不需要再单独处理历史影响（无法追溯已结束的对局）。

## E 类抽样复核（追加审计，未发现问题）

针对"审计方法本身有盲区（`mandatory` 正则此前未被纳入判断）"这一发现，抽样复核了 E 类名单里 16 条"有明显下行风险/多种选择差异较大"的技能（弃牌类：`beigeDiscard`/`guanshi`/`hanbing`；选择伤害承受方式类：`ganglieChoice`/`yaowu_choose`；资源分配/目标选择类：`duanbingChoose`/`jujianChooseEffect`/`jujianPickTarget`/`mengjin`/`qiaomengPickEquip`/`renxinChoose`/`shaOffsetChoice`/`zhimengPick`/`chengxiangChoose`/`haoshiPick`/`huogongReveal`），逐条验证方法：构造最小 `g`/`pending`，spy 对应的 `respond*`/其它服务端函数，直接调用 `runBotDecision(g,seat)`，确认**真的调用到了预期的专属函数**（不是靠 `botSafePrompt` 的 safe/mandatory 正则侥幸命中）。测试代码见 `run_eclass_sample_audit_test.js`（新增，16 个场景全部通过）。

**抽样结果：16 条全部确认是真实生效的专属 `runBotDecision` 分支（硬编码 if 分支或 `BOT_DECISIONS` 注册），0 条依赖 `botSafePrompt` 兜底侥幸命中——抽样比例 0/16，未发现新的"看似 E 类、实际靠正则侥幸"问题。**

这个结果和 B 类那批的性质不同，值得说明原因：B 类当年的 4 条问题根源是**完全没有专属分支、只能落到 `botSafePrompt` 兜底**，`botSafePrompt` 依赖 DOM 渲染出的按钮文案做正则匹配，才会有"侥幸命中/真卡死"这种依赖运气的风险。而这次抽样的 16 条 E 类技能，**每一条在 `runBotDecision` 函数体里都能找到直接写死的 `g.phase===`/`d.type===` 判断分支，调用具体的 `respond*` 函数**——这类分支是纯 JS 逻辑判断，不经过 DOM 渲染、不依赖 `botSafePrompt`，只要分支的 guard 条件（`d.sourceSeat===seat`/`d.to===seat` 等）和创建 pending 时的真实字段名对得上，就必然会命中，不存在"运气"的空间。抽样过程里额外核对了这一点：16 条的 guard 字段名逐一对照了各自 pending 创建位置（`game.js`/`skills.js`/`weapons.js`）的真实字段，全部吻合。

**是否建议做全量 85 条复核**：不建议现在就做。理由：
1. B 类问题的本质是"完全没有专属分支代码"，这类缺口在上一轮系统性扫描（对照 `BOT_PHASE_ACTOR` 全表 + `runBotDecision` 函数体逐字检索）时已经暴露无遗（正是这样才找出了原来的 4 条 B 类）——E 类之所以被归为 E，前提就是"已经确认存在专属分支代码"，这个前提和"是否依赖正则侥幸"是两件不同的事：前者是本次抽样验证的对象，抽样结果是 0/16，没有证据支持"E 类普遍存在同样的问题"。
2. 抽样挑的 16 条已经覆盖了"下行风险明显/选择差异大"这一类里能想到的绝大多数子类型（弃牌、伤害承受方式、资源分配、目标选择、组合选择），如果这类技能里真的还藏着同样的问题，抽样理论上有较高机会命中——抽样比例 0/16 是一个有意义的负结果，不是"样本太小看不出来"。
3. 剩下约 69 条大多是"是否发动"类简单二元决策（比如各种 `xxxAsk` 的"发动/不发动"）或已经在其它任务里逐条读过代码确认的技能，边际复核价值较低，全量复核 85 条的工作量（逐条构造最小场景+spy+验证）预估和这次 16 条的耗时线性放大，性价比不高。

如果以后又有新的理由怀疑某个具体技能（比如该技能本身出现了运行时报错、或者有人反馈机器人在那个技能上表现奇怪），可以针对那一条单独复核，不需要现在批量做。

## 如何验证这份清单是否过时

1. 确认当前 HEAD 相对 `e735561d5b0b435889229f8e58d7916d05772cb6` 有没有改动过 `bot.js`/`render-controls.js`/`skills.js`/`game.js`/`data.js` 里涉及机器人决策或按钮渲染的部分（`git log e735561..HEAD -- bot.js render-controls.js skills.js game.js data.js`）。
2. 如果有改动，优先看改动是否覆盖了上面 A/B/C 类列出的具体 `pending.type`——如果某一条已经被修复，应该从清单里移除（或标注"已修复于 commit XXX"），不要让清单继续显示过时信息。
3. 如果新增了武将/装备/锦囊，按本文档开头"审计方法"那四步重新过一遍新增的技能，不需要重新审计已经确认过的部分。
