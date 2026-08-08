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
| A 类 | 9 条（对应 9 个 `pending.type`） | 兜底命中"不发动/取消"类按钮，等价于永远不发动 |
| B 类 | 0（**原 4 条已于 commit `9334e76` 全部修复**，见文末「B 类修复记录」） | 兜底可能找不到任何可点按钮，存在卡死风险 |
| C 类 | 3 条 | 多步流程只接了后半段，发动入口本身缺失 |
| D 类 | 0 | 未发现新的"只在有 AI 密钥时才生效"的登记项（上一轮 `BOT_SEAT_PICKS` 那批已经在此前任务解锁） |
| E 类 | 约 92 个 `pending.type`（见文末列表逐一列名，含本次修复后转入的 7 个） | 已完整接线、无密钥也能正常触发 |

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

**本次审计当时列出的 4 条已经全部修复，见文末「B 类修复记录（commit 9334e76）」。**这一节原有的表格内容已经移到该小节存档（保留原始判断和修复后纠正的对比），不再作为"待处理"清单出现在这里。

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

`aoeResp`、`beigeChoose`、`beigeDiscard`、`beigeJudge`、`biyue`、`buquAsk`、`chengxiangAsk`、`chengxiangChoose`（经 `chengxiangAsk` 的actor+内部按 `d.type` 二次分派，见 `bot.js:3886`）、`cixiongAsk`、`cixiongChoice`、`duanbingChoose`、`duel`、`dying`、`enyuanChoose`、`enyuanChooseOption`、`enyuanGiveCard`、`fanjianSuit`（`BOT_SEAT_PICKS.fanjian`）、`fenxunDiscard`、`fenxunTarget`、`ganglieAsk`（"郭嘉遗计"任务里修过）、`ganglieChoice`、`guanshi`、`guanxingReview`、`guhuoQuestion`、`guhuoTarget`（经 `BOT_SEAT_PICKS.guhuoTarget` 特殊路径，见 `bot.js:1956,2028,4238`(行号已核对)）、`guicai`、`guiduAsk`（"郭嘉遗计"任务里修过）、`hanbing`、`hanbingAsk`、`haoshiPick`、`huanhuoPick`/`huanhuoPickCard`/`huanhuoPickGotCard`/`huanhuoPickSecond`（本次B类修复任务补齐，见文末修复记录——发动入口`startHuanhuo`仍未接线，这四个子阶段目前实际不会被触发，属于"预先打好补丁"）、`huashenChangeAskEnd`、`huashenChangeAskStart`、`huashenChangePickEnd`、`huashenChangePickStart`、`huashenPick`、`hujiaAsk`、`huogong`、`huogongReveal`、`jiangchiAsk`（"郭嘉遗计"任务里修过）、`jiedaoChoice`、`jiemingAsk`、`jijiangAsk`、`jiushiFlipAsk`、`jujianChooseEffect`、`jujianPickCard`、`jujianPickTarget`、`jushouChoose`、`leijiChoose`、`leijiJudge`、`lianyingAsk`、`lieRenRespond`（注意这是烈刃**响应方**，和上面 A 类的 `lieRenChoose`/`lieRenPickCard`（**发动方**）是两个不同的座位视角，响应方已经接好）、`liegong`、`lirangAsk`、`luanjiChoose`、`luanjiConfirm`、`luanwuChoose`、`luoshen`（`CONTROLS_CHOICE_ALLOWLIST`）、`luoyiAsk`、`luoyingAsk`（`CONTROLS_CHOICE_ALLOWLIST`）、`mengjin`、`mingceChoice`、`mingcePickCard`、`mingcePickTarget`、`mingcePickTarget2`（这四个属于"陈宫明策"链条**后半段**接线，本身没问题，只是永远走不到——见上方 C 类说明）、`pick`、`qiangxiChooseCost`、`qiangxiChooseWeaponFromHand`、`qiangxiPickTarget`、`qiaobianMove`、`qiaomengChoose`、`qiaomengPickEquip`、`qilin`、`qinglong`、`quhuDamageChoice`（`BOT_SEAT_PICKS.quhuDamage`）、`quhuRespond`、`renxinChoose`、`respond`、`shaOffsetChoice`、`shensuSha`、`shuangxiongAsk`、`tianyiPickCard`、`tianyiPickTarget`、`tianyiRespond`、`tiaoxinChoice`（本次B类修复任务补齐，专属分支+askedAt，见文末修复记录；改动前经真实验证是"mandatory正则侥幸命中"而非真卡死）、`tiaoxinDiscard`（`BOT_SEAT_PICKS.tiaoxin` 发动方，和 `tiaoxinChoice` 目标方是两个视角）、`tieqi`、`wangxiAsk`、`wugu`、`wuxie`（`CONTROLS_CHOICE_ALLOWLIST`）、`xiaoguo`、`xiaoguoChoice`（本次B类修复任务补齐专属分支，位置特意放在L1之后——见文末修复记录）、`xinshengAsk`、`xuanfengPick`（`BOT_SEAT_PICKS.xuanfeng`）、`xunxunPick`、`yaowu_choose`、`yijiAsk`、`yijiAssign`（"郭嘉遗计"任务里修过）、`zhibaAsk`、`zhimengAsk`、`zhimengPick`、`zhijiChoice`（本次B类修复任务补齐，见文末修复记录；改动前经真实验证是"mandatory正则侥幸命中"而非真卡死）。

（未列入 E 类清单的 `over`/`play`/`draw`/`discard`/`pickingGeneral`/`pickingLordGeneral` 等属于核心引擎阶段，走 `botSeatForState` 的 Category A 特殊分支或既有的 `draw`/`play`/`discard` 通用逻辑，不属于"武将/装备/锦囊技能"范畴，不计入这份清单的统计口径。）

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
