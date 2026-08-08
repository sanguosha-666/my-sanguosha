# 机器人技能覆盖审计清单

> **生成时间**：2026-08-08，对应代码版本 commit `e735561d5b0b435889229f8e58d7916d05772cb6`（分支 `chengcheng`）。
> 这份清单是对**当时那一份代码**做的静态审计，代码继续演进后清单会过时——复核方式见文末「如何验证这份清单是否过时」。
> **这次任务只做审计，不做修复**（和"郭嘉遗计"那次任务分开），下面列出的每一条都还没有被改动。

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
| A 类 | 9 条（对应 9 个 `pending.type`） | 兜底命中"不发动/取消"类按钮，等价于永远不发动 |
| B 类 | 4 条（对应 3+4=7 个 `pending.type`，其中 `xiaoguoChoice`/`tiaoxinChoice` 视具体局面可能命中安全按钮、也可能真卡死；`huanhuoPick`链4个子阶段合并为1条，标记"潜在"，见表内说明） | 兜底可能找不到任何可点按钮，存在卡死风险 |
| C 类 | 3 条 | 多步流程只接了后半段，发动入口本身缺失 |
| D 类 | 0 | 未发现新的"只在有 AI 密钥时才生效"的登记项（上一轮 `BOT_SEAT_PICKS` 那批已经在此前任务解锁） |
| E 类 | 约 85 个 `pending.type`（见文末列表逐一列名） | 已完整接线、无密钥也能正常触发 |

这次审计一共交叉核对了约 **105 个** `pending.type`/`g.phase` 决策入口点（A9+B7+C3(仅入口函数，不计入phase统计)+E约85+已修复的ganglieAsk/guiduAsk/jiangchiAsk/yijiAsk等计入E类，不包含 `play`/`draw`/`discard`/`respond`/`duel` 等基础引擎阶段——这些属于核心机制而不是"武将/装备/锦囊技能"，且早已被大量既有测试覆盖，不在这次审计范围内）。

---

## A 类：兜底命中"不发动"类按钮，等价于永远不发动

和"郭嘉遗计"是同一类 bug——机器人技术上"会点一下"，但点的永远是放弃选项，效果上等于这个技能对机器人形同虚设。

| 技能/武将 | phase / pending.type | 代码位置 | 现状路径 | 判定依据 |
|---|---|---|---|---|
| 大乔【流离】 | `liuli` | 创建：`game.js:` grep `type:'liuli'`；按钮：`render-controls.js:2426-2445` | `BOT_PHASE_ACTOR.liuli='to'` 已登记，但 `runBotDecision` 无专属分支，`CONTROLS_CHOICE_ALLOWLIST` 不含 `liuli`（无密钥时L1直接返回false）→ 落到末尾 `botSafePrompt` | 按钮含"不发动"（`render-controls.js:2440`），命中安全正则 |
| 小乔【天香】 | `tianxiang` | 按钮：`render-controls.js:2451-2470` | 同上（`BOT_PHASE_ACTOR.tianxiang='seat'` 已登记，无专属分支，非 allowlist） | 按钮含"不发动"（`render-controls.js:2466`） |
| 孔融【礼让】回收 | `lirangRecover` | 按钮：`render-controls.js:2267-2280` | 同上（`BOT_PHASE_ACTOR.lirangRecover='from'` 已登记，无专属分支） | 按钮"不获得"（`render-controls.js:2275`），"不获得"在安全正则里 |
| 孔融【争义】 | `zhengyi` | 按钮：`render-controls.js:2286-2298` | 同上（`BOT_PHASE_ACTOR.zhengyi='asking'` 已登记，无专属分支） | 按钮含"不发动"（`render-controls.js:2293`） |
| 祝融【烈刃】发动 | `lieRenChoose` | 创建：`game.js` 触发伤害后 `pending.type==='lieRenChoose'`；按钮：`render-controls.js:1488-1507` | **完全没有 `BOT_PHASE_ACTOR` 登记**、也没有专属分支——比上面几条更彻底，连"actor 能不能解析"这一步都没有，直接靠 `botFallbackSeats` 扫描全部机器人座位逐个尝试 `botSafePrompt` | 按钮"发动烈刃"/"不发动"（`render-controls.js:1499-1503`），"不发动"命中安全正则 |
| 祝融【烈刃】选牌 | `lieRenPickCard` | 按钮：`render-controls.js:1516-1539` | 同上，无 `BOT_PHASE_ACTOR` 登记、无专属分支 | 按钮是每张手牌 + "取消"（`render-controls.js:1534-1535`），"取消"命中安全正则；且由于 `lieRenChoose` 本身就默认被点"不发动"，这个阶段实际上永远走不到 |
| 夏侯渊【神速1】 | `shensuChoose1` | 按钮：`render-controls.js:1672-1690` | 无 `BOT_PHASE_ACTOR` 登记、无专属分支 | 按钮"发动神速1"/"不发动"（`render-controls.js:1680-1685`），"不发动"命中安全正则 |
| 夏侯渊【神速2】 | `shensuChoose2` | 按钮：`render-controls.js:1698-1716` | 同上 | 按钮"发动神速2"/"不发动"（`render-controls.js:1706-1711`） |
| 张郃【巧变】回合开始 | `qiaobianTurnStart` | 按钮：`render-controls.js:2782-2812` | 无 `BOT_PHASE_ACTOR` 登记、无专属分支。**注意**：巧变还有另一个入口 `qiaobianMove`（出牌阶段中途）**已经**完整接线（`BOT_DECISIONS.qiaobianMove`），只有"回合开始"这一个变体缺失 | 首屏按钮"发动【巧变】"/"不发动"（`render-controls.js:2785-2788`），"不发动"命中安全正则 |

> 上面几条里，`liuli`/`tianxiang`/`lirangRecover`/`zhengyi` 这 4 条有一个共同的、值得单独记一笔的细节：它们**都在 `BOT_PHASE_ACTOR` 里正确登记了行动者字段**（不是完全没人认识），但因为没有专属决策分支、又不在 `CONTROLS_CHOICE_ALLOWLIST`（`bot.js` 里硬编码只有 `wuxie`/`luoyingAsk`/`luoshen` 三项），**只有配置了 AI 密钥时才会走 L1 的通用按钮镜像机制**；无密钥时 L1 直接放弃（`bot.js:1041` 那行 `if(!(aiReady || allowlist)) return false;`），照样落到最后的 `botSafePrompt`。这和"完全没有 `BOT_PHASE_ACTOR` 登记"效果相同（都在无密钥时兜底点安全按钮），但**原因不同**——以后如果要修，只需要给这 4 项加一条专属分支或者扩大 allowlist，不需要像 `lieRenChoose`/`shensuChoose1/2`/`qiaobianTurnStart` 那样从头补 `BOT_PHASE_ACTOR` 登记。

---

## B 类：兜底可能找不到任何可点按钮，存在卡死风险

| 技能/武将 | phase / pending.type | 代码位置 | 现状路径 | 判定依据 |
|---|---|---|---|---|
| 姜维【志继】觉醒 | `zhijiChoice` | 创建：体力上限-1时触发；按钮：`render-controls.js:2681-2689` | 无 `BOT_PHASE_ACTOR` 登记、无专属分支；**且 `zhijiChoice` 被列进了 `CONTROLS_CHOICE_EXCLUDE`**（`bot.js` 里那个 exclude 集合），但由于本身就没有 actor 解析，这条 exclude 目前是"死记录"（永远不会被真正用到，因为 `botSeatForState` 解析不出行动者时根本不会走到 L1 那一步）；最终落到 `botFallbackSeats`+`botSafePrompt` | 按钮"回复1点体力"/"摸两张牌"（`render-controls.js:2684-2686`），**两个都不匹配任何安全正则**，且**始终是这两个按钮同时存在**（不是"只剩一个"的边界情况）——这是姜维体力上限降到某个阈值后**强制触发**的觉醒效果，不是可选发动，只要机器人玩姜维、体力降到阈值，这个卡死必然发生，不是低概率边界 |
| 典韦【骁果】受害者二选一 | `xiaoguoChoice` | 按钮：`render-controls.js:2634-2645` | `BOT_PHASE_ACTOR.xiaoguoChoice='to'` 已登记，无专属分支，非 allowlist → 落到 `botSafePrompt` | 按钮是"弃置X【装备名】"（每件装备各一个）+ "受到1点伤害"（`render-controls.js:2638-2642`），全部不匹配安全正则。**分两种情况**：目标**没有任何装备**时只有"受到1点伤害"这一个按钮，`botSafePrompt` 的"唯一按钮直接点"兜底能侥幸走通（等价于"总是选受伤害"，行为上凑巧合理但纯属侥幸）；目标**有≥1件装备**时是2个以上按钮、无一匹配，**真正卡死** |
| 姜维【挑衅】目标选择 | `tiaoxinChoice` | 按钮：`render-controls.js:2696-2714` | 无 `BOT_PHASE_ACTOR` 登记、无专属分支（注意这和"是否发动挑衅"这个前置决策是两回事——挑衅的**发动方**已经通过 `BOT_SEAT_PICKS.tiaoxin` 完整接线，能主动发动；但被挑衅的**目标**如果是机器人，它对这个二选一毫无准备） | 按钮"对其使用【杀】"（仅目标有可用的杀时才渲染）+ "被弃置一张牌"（`render-controls.js:2704-2711`，恒渲染）。目标**没有可用杀**时只有"被弃置一张牌"这一个按钮，侥幸能被"唯一按钮"兜底点掉；目标**有可用杀**时是2个按钮、都不匹配安全正则，真正卡死 |
| 法正【眩惑】完整链条 | `huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond` | 创建：`game.js` `startHuanhuo`/`pickHuanhuoTarget`/`pickHuanhuoHeartCard`/`pickHuanhuoGotCard`；按钮：`render-controls.js` 对应 `huanhuoPick*` 分支 | **这四个子阶段全部没有 `BOT_PHASE_ACTOR` 登记、也没有专属分支**——但由于 `startHuanhuo()` 本身从未被任何机器人代码调用过（见 C 类），机器人**实际上永远不会真的走到这四个阶段**，此处列为 B 类是"如果有一天有人给 `startHuanhuo` 接上机器人触发入口、却忘了同时接这四个子阶段"的**潜在**风险，不是当前会实际发生的卡死（当前谁都不会触发它） | 未逐一读按钮文案(链条本身不会被触发，暂不深入)——标记为**潜在 B 类**，等 C 类的"眩惑发动入口"被接上之后需要重新评估 |

---

## C 类：多步流程只接了后半段，发动入口本身缺失

和"郭嘉遗计只接了 `yijiAssign` 没接 `yijiAsk`"是同一类问题——技能真正的"发动决策"从未被机器人做出过，即便后续步骤接线完整也用不上。

| 技能/武将 | 发动入口 | 代码位置 | 已接线的后续步骤 | 备注 |
|---|---|---|---|---|
| 于吉【蛊惑】 | `startGuhuo(cardIdx, claimedName)` / `startGuhuoResponse(cardIdx, claimedName)` | `skills.js:530`、`skills.js:559` | `guhuoQuestion`（`BOT_DECISIONS.guhuoQuestion`）、`guhuoTarget`（`BOT_SEAT_PICKS.guhuoTarget`）均完整接线 | `bot.js` 里对 `startGuhuo`/`startGuhuoResponse` 的引用次数为 0（`grep -c`已核实）。机器人可以**回应**别人发动的蛊惑（质疑/选目标），但永远不会**自己主动**扣一张牌声明成别的牌——这需要"选哪张手牌"+"声明成什么牌"两个参数的联合决策，比之前修的几个技能复杂，属于需要专门设计决策逻辑的一类，不是简单补一行 `botInvoke` |
| 陈宫【明策】 | `startMingce()` | `game.js:3211` | `mingcePickCard`/`mingcePickTarget`/`mingcePickTarget2`/`mingceChoice` 全部有专属 `runBotDecision` 分支（"防御性收录"） | `bot.js` 对 `startMingce` 引用次数为 0。**这是此前"机器人主动技能解锁"任务里已经评估过、明确记录在案的保守决策**（见该次任务的commit说明："明策...对发动者自己净收益不明确，和举荐/仁心同一基调保守默认不主动发动"），不是这次审计的新发现，这里列出只是为了让清单完整、不遗漏 |
| 法正【眩惑】 | `startHuanhuo()` | `game.js:7242` | **无**——`huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond` 全部没有接线（见上方 B 类"潜在"条目） | `bot.js` 对 `startHuanhuo` 引用次数为 0。和"明策"同样是此前任务里明确记录的保守决策（该次commit说明："眩惑...净手牌数不变、只是转移他人的牌，保守默认不主动发动"），但**和明策不同的是**：明策的后续步骤已经全部接好，眩惑的后续步骤**一个都没接**——如果以后要解锁，工作量明显更大（需要从"要不要发动"到"选目标/选牌/选获得的牌/选第二目标"四步全部设计决策逻辑），这次审计把这个工作量差异记录下来供以后排期参考 |

---

## D 类：已完整接线但仅在配置 AI 密钥时生效

本次审计**没有发现新的 D 类实例**。此前"机器人主动技能解锁"任务已经把 `BOT_SEAT_PICKS` 的全部 13 项从"仅 `aiReady` 时生效"解锁为"无密钥也能走本地兜底"（`bot.js:3623` 注释可查）；这次交叉核对 `BOT_SEAT_PICKS`/`BOT_DECISIONS`/`BOT_PHASE_ACTOR` 全表，未找到类似的残留门槛。

（A 类里 `liuli`/`tianxiang`/`lirangRecover`/`zhengyi` 那 4 条，虽然表面上也是"和 AI 密钥有关"，但严格来说不算 D 类——D 类的定义是"有密钥时能正常工作、无密钥时不工作"，而这 4 条**即使配置了 AI 密钥**，由于不在 `CONTROLS_CHOICE_ALLOWLIST` 里，L1 通用镜像机制依然不会接管它们，是否有密钥对它们的行为没有区别，一直都是靠 `botSafePrompt` 兜底点"不发动"——这也是为什么归进 A 类而不是 D 类。)

---

## E 类：已完整接线，无密钥也能正常触发（仅列名单，佐证清单完整性）

以下这批 `pending.type`/`g.phase` 都在 `BOT_PHASE_ACTOR` 登记了行动者字段，且在 `runBotDecision` 里能找到引用该字面量的专属分支（硬编码 if 分支，或 `BOT_DECISIONS`/`BOT_SEAT_PICKS` 注册项），交叉核对后确认无密钥模式下也能正常决策，不需要逐条展开细节：

`aoeResp`、`beigeChoose`、`beigeDiscard`、`beigeJudge`、`biyue`、`buquAsk`、`chengxiangAsk`、`chengxiangChoose`（经 `chengxiangAsk` 的actor+内部按 `d.type` 二次分派，见 `bot.js:3886`）、`cixiongAsk`、`cixiongChoice`、`duanbingChoose`、`duel`、`dying`、`enyuanChoose`、`enyuanChooseOption`、`enyuanGiveCard`、`fanjianSuit`（`BOT_SEAT_PICKS.fanjian`）、`fenxunDiscard`、`fenxunTarget`、`ganglieAsk`（本次"郭嘉遗计"任务里刚修过）、`ganglieChoice`、`guanshi`、`guanxingReview`、`guhuoQuestion`、`guhuoTarget`（经 `BOT_SEAT_PICKS.guhuoTarget` 特殊路径，见 `bot.js:1956,2028,4238`(行号已核对)）、`guicai`、`guiduAsk`（本次"郭嘉遗计"任务里刚修过）、`hanbing`、`hanbingAsk`、`haoshiPick`、`huashenChangeAskEnd`、`huashenChangeAskStart`、`huashenChangePickEnd`、`huashenChangePickStart`、`huashenPick`、`hujiaAsk`、`huogong`、`huogongReveal`、`jiangchiAsk`（本次"郭嘉遗计"任务里刚修过）、`jiedaoChoice`、`jiemingAsk`、`jijiangAsk`、`jiushiFlipAsk`、`jujianChooseEffect`、`jujianPickCard`、`jujianPickTarget`、`jushouChoose`、`leijiChoose`、`leijiJudge`、`lianyingAsk`、`lieRenRespond`（注意这是烈刃**响应方**，和上面 A 类的 `lieRenChoose`/`lieRenPickCard`（**发动方**）是两个不同的座位视角，响应方已经接好）、`liegong`、`lirangAsk`、`luanjiChoose`、`luanjiConfirm`、`luanwuChoose`、`luoshen`（`CONTROLS_CHOICE_ALLOWLIST`）、`luoyiAsk`、`luoyingAsk`（`CONTROLS_CHOICE_ALLOWLIST`）、`mengjin`、`mingceChoice`、`mingcePickCard`、`mingcePickTarget`、`mingcePickTarget2`（这四个属于"陈宫明策"链条**后半段**接线，本身没问题，只是永远走不到——见上方 C 类说明）、`pick`、`qiangxiChooseCost`、`qiangxiChooseWeaponFromHand`、`qiangxiPickTarget`、`qiaobianMove`、`qiaomengChoose`、`qiaomengPickEquip`、`qilin`、`qinglong`、`quhuDamageChoice`（`BOT_SEAT_PICKS.quhuDamage`）、`quhuRespond`、`renxinChoose`、`respond`、`shaOffsetChoice`、`shensuSha`、`shuangxiongAsk`、`tianyiPickCard`、`tianyiPickTarget`、`tianyiRespond`、`tiaoxinDiscard`（`BOT_SEAT_PICKS.tiaoxin` 发动方，和上面 B 类 `tiaoxinChoice` 目标方是两个视角）、`tieqi`、`wangxiAsk`、`wugu`、`wuxie`（`CONTROLS_CHOICE_ALLOWLIST`）、`xiaoguo`、`xinshengAsk`、`xuanfengPick`（`BOT_SEAT_PICKS.xuanfeng`）、`xunxunPick`、`yaowu_choose`、`yijiAsk`、`yijiAssign`（本次"郭嘉遗计"任务里刚修过）、`zhibaAsk`、`zhimengAsk`、`zhimengPick`。

（未列入 E 类清单的 `over`/`play`/`draw`/`discard`/`pickingGeneral`/`pickingLordGeneral` 等属于核心引擎阶段，走 `botSeatForState` 的 Category A 特殊分支或既有的 `draw`/`play`/`discard` 通用逻辑，不属于"武将/装备/锦囊技能"范畴，不计入这份清单的统计口径。）

---

## 如何验证这份清单是否过时

1. 确认当前 HEAD 相对 `e735561d5b0b435889229f8e58d7916d05772cb6` 有没有改动过 `bot.js`/`render-controls.js`/`skills.js`/`game.js`/`data.js` 里涉及机器人决策或按钮渲染的部分（`git log e735561..HEAD -- bot.js render-controls.js skills.js game.js data.js`）。
2. 如果有改动，优先看改动是否覆盖了上面 A/B/C 类列出的具体 `pending.type`——如果某一条已经被修复，应该从清单里移除（或标注"已修复于 commit XXX"），不要让清单继续显示过时信息。
3. 如果新增了武将/装备/锦囊，按本文档开头"审计方法"那四步重新过一遍新增的技能，不需要重新审计已经确认过的部分。
