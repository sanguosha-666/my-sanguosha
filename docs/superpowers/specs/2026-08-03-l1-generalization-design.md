# 响应类全自动 AI 化（L1 泛化）设计

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认设计 §1；待审阅

**前置**：AI 可操作面决策总线 + 第一批决策覆盖（T1-T10）+ 强C + 信息层全部交付。本设计是 **L1 controlsChoice 的泛化**——把"3 个手工 allowlist 阶段"放宽为"所有渲染按钮的响应阶段"，实现响应类技能**零适配**全覆盖。

---

## 1. 背景与目标

### 现状

`BOT_DECISIONS.controlsChoice`（bot.js ~690）当前只接管 3 个阶段（`CONTROLS_CHOICE_ALLOWLIST = {wuxie, luoyingAsk, luoshen}`），原因是"无密钥回退必须与旧分支等价"这条红线要求**逐阶段论证**按钮点击 == 旧分支动作。其余约 70+ 响应阶段（骁果/据守/礼让/悲歌/遗计/流离/天香/忘隙…）走 `botSafePrompt` 兜底（点安全按钮）或旧分支——**AI 不参与**，新技能要 AI 化必须手工迁移。

### 目标

> 任何响应阶段，只要 UI 渲染了按钮：有密钥时 AI 从按钮里选；无密钥时行为与改动前逐字一致。**新技能/新武将零 bot 适配自动 AI 化。**

### 关键洞察（本设计的立身之本）

**用"有/无密钥路径解耦"取代"逐阶段等价性论证"**：

- 无密钥时 `match` 直接返回 false → `runBotDecision` 继续走**既有旧分支**（行为逐字不变，红线天然守住，不需要证明按钮等价）；
- 有密钥时接管按钮（AI 选），AI 失败 fallback 点安全按钮（尽力而为，与 `botSafePrompt` 同构）——不再要求 fallback 等价旧逻辑，因为无密钥路径已经与 L1 完全解耦；
- 例外：`wuxie`/`luoyingAsk`/`luoshen` 三阶段**保留现状**（无密钥也接管，fallback 点按钮=旧行为）——因为 wuxie 旧分支已删除、不能退回旧分支；这两阶段的等价性论证 B3 已做过，沿用。

---

## 2. 核心改动

### 2.1 `controlsChoiceMatch` 放宽（bot.js）

```js
function controlsChoiceMatch(g, seat){
  if(!g || !g.pending) return false;
  // 【L1 泛化】allowlist 三阶段无密钥也接管(旧分支已删/等价性已论证,见 B3);
  // 其余所有阶段仅 aiReady 时接管——无密钥时返回 false,runBotDecision 继续走
  // 该阶段既有旧分支,行为逐字不变(无密钥路径与 L1 完全解耦,不再需要逐阶段
  // "按钮点击 == 旧分支动作"的等价性论证)。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(!(aiReady || CONTROLS_CHOICE_ALLOWLIST.has(g.phase))) return false;
  // 【L1 泛化】已有专用注册的阶段不让 L1 抢(防止双重接管/绕过专用候选的隐藏信息处理)
  if(CONTROLS_CHOICE_EXCLUDE.has(g.phase)) return false;
  return botSeatForState(g)===seat;
}
```

### 2.2 新增 `CONTROLS_CHOICE_EXCLUDE` 集合

已有专用注册/专用逻辑的阶段（L1 不接管）：

```
wugu, pick, guicai, ganglieChoice, guhuoQuestion, qiaobianMove,
enyuanChooseOption, enyuanChoose, enyuanGiveCard, jiedaoChoice,
duanbingChoose, huogong, huogongReveal, fanjianSuit, quhuRespond,
tianyiRespond, xiaoguo, xiaoguoChoice, zhijiChoice,
huashenChangeAskStart, huashenChangeAskEnd, tieqi, liegong,
qilin, hanbing, mengjin, shaOffsetChoice
```

**清单来源**：实现时按 `runBotDecision` 现有接线逐一核对——凡有 `botDecide('Xxx')` 调用或专用硬编码分支的阶段全部加入；不确定的宁加勿漏（漏加 = L1 抢走专用逻辑，行为错乱）。**注释明确维护纪律**：新增专用注册时同步加入排除集。

**例外（刻意不加入排除集）**：dying/duel/aoeResp/guicaiHandPick 等在 `controlsChoice` 接线之前的注册项——它们在 runBotDecision 的 if 链中位于 L1 之前，天然先接管，L1 到不了（if 链先命中先 return）。若未来调整接线顺序导致冲突，再把它们加入排除集（记录于注释）。

### 2.3 其余行为不变

- `collectControlsCandidates`/`controlsChoiceLocalFallback`/`controlsChoiceExecute`/`buildControlsChoiceSystemPrompt`：**零改动**（候选收集、safe 按钮 fallback、botInvoke+dispose、prompt 全部沿用）。
- 有旧分支的阶段（qilin/hanbing/mengjin/shaOffsetChoice 等）**不删除旧分支**——无密钥时旧分支是唯一路径，有密钥时 L1 先命中（if 链中 L1 位置在其之前？**实现时确认接线位置**：L1 的 botDecide 调用必须位于这些旧分支**之前**才能接管；若旧分支在前，把 L1 接线提前或保持现状——以"有密钥必达 L1、无密钥必达旧分支"为准，实现时用测试锁定）。

---

## 3. 风险与处理

| 风险 | 处理 |
|------|------|
| 按钮点击只切客户端 mode 不提交（多步状态机）→ 状态不变可能卡 | 已知多步阶段（guicai/ganglie/guhuo/巧变）已在 EXCLUDE；实现时抽查其余阶段按钮（yijiAsk/wangxiAsk/lirangAsk/liuli/xiaoguo 等）是否"点即提交"，发现异常加入 EXCLUDE 并记录 |
| AI 失败 fallback 点 safe 按钮（不等价旧逻辑） | 接受：无密钥路径与 L1 解耦（走旧分支），fallback 只是有密钥路径的尽力而为，与 botSafePrompt 同构；文档记录 |
| EXCLUDE 集合维护漂移 | 注释 + 文档明确纪律；测试断言 EXCLUDE 阶段 L1 返回 false |
| L1 接线位置与旧分支顺序 | 实现时确认/调整；测试锁定"有密钥 L1 接管、无密钥旧分支"双向 |

---

## 4. 测试矩阵（扩展 run_ai_bus_l1_test.js）

| 用例 | 断言 |
|------|------|
| 代表阶段有密钥接管 | qilin/hanbing/骁果(xiaoguo)/礼让(lirangAsk) 构造 pending，aiReady → `botDecide('controlsChoice')` 返回 true、候选=按钮、mock 选目标 → 对应服务端函数收到 |
| 代表阶段无密钥走旧分支 | 同上但 `aiApiKey=''` → `botDecide('controlsChoice')` 返回 false（match 不命中），runBotDecision 走旧分支（spy 断言旧行为逐字） |
| allowlist 三阶段无密钥不变 | 现状回归（wuxie 无密钥 → respondWuxie(false)，l1 既有断言） |
| EXCLUDE 阶段不被抢 | wugu/pick/guicai/ganglieChoice/guhuoQuestion/qiaobianMove 等 → `botDecide('controlsChoice')` 返回 false（有密钥也不接管） |
| 多步状态机抽查 | yijiAsk/wangxiAsk/lirangAsk/liuli 按钮 onclick 是否直接调服务端函数（rg 核对，报告记录；异常者入 EXCLUDE） |
| 接线位置 | 有密钥时 L1 在旧分支之前命中（runBotDecision 端到端，spy 顺序） |
| 回归 | 既有 l1 8 项 + 全部 AI-bus 套件 + 仓库套件 + `node --check` |

---

## 5. 明确不做

- 不删任何旧分支（它们成为无密钥路径）。
- 不给座位卡类技能泛化（seatPick 已覆盖主动技能；座位点击不是"按钮"，L1 管不到——现状保持）。
- 不做"AI 失败后重试"（不重试原则不变）。
- 不引入新协议（仍 `{"choice":N}`）。

---

## 6. 验收标准

1. 有密钥：任何渲染按钮的响应阶段（抽样 qilin/hanbing/骁果/礼让 + 一个未抽到的随机阶段）AI 可接管并产生合法选择。
2. 无密钥：上述阶段行为与改动前逐字一致（测试锁定）。
3. EXCLUDE 阶段 L1 永不接管（双重接管零发生）。
4. `?v=` 同步 +1；progress-log-8.md 追加（当前最新分段）。
5. 无新增按武将 id 分支。

---

## 6.5 补充：seatPick 接线修复（bug）+ 分配类技能覆盖

### 6.5.1 seatPick 接线修复（必须，bug）

**现状**：`BOT_SEAT_PICKS` 注册了 11 个技能（蛊惑目标/旋风/断粮/奇袭/国色/武圣/双雄/挑衅/反间/青囊/驱虎伤害），但 `runBotDecision` 中**没有任何 `botDecide('seatPick')` 调用点**——T1-T3 的测试全部是直接调 `botDecide('seatPick', g, 0)` 的单元测试，从未测过 runBotDecision 全链路。**后果：机器人永远不会主动使用这 11 个技能**（武圣/双雄等转化技只有 seatPick 一条路，等于完全不可达）。

**修复**：
```js
// runBotDecision play 分支(四个多步之后、runBotActionWindow 之前):
if(g.phase==='play'&&g.turn===seat){
  if(await botDecide('jiedaoTwoStep', g, seat)) return;
  if(await botDecide('lijianTwoStep', g, seat)) return;
  if(await botDecide('zhangbaTwoStep', g, seat)) return;
  if(await botDecide('rendeTwoStep', g, seat)) return;
  if(await botDecide('seatPick', g, seat)) return;   // ← 新增接线
  await runBotActionWindow(g, seat); return;
}
// 三个 pending 阶段(guhuoTarget/xuanfengPick/quhuDamageChoice)各自加一处:
if(g.phase==='guhuoTarget' && d && d.type==='guhuoTarget' && d.sourceSeat===seat){
  if(await botDecide('seatPick', g, seat)) return;
}
// xuanfengPick / quhuDamageChoice 同理(实现时按 runBotDecision 现有结构插入)
```

**注意**：`seatPickMatch` 的 play 分支条件已存在（`g.phase==='play'` 且技能 match），接线后 play 阶段先试四个多步（有挂起守卫）→ seatPick（11 技能候选合并）→ runBotActionWindow（手牌枚举）——三者互不冲突。seatPick 命中的技能在 runBotActionWindow 的 `enumerateAllLegalOneStepActions` 里**不会重复出现**（断粮/奇袭/国色等无 CARD_PLAYS 入口；武圣/双雄走 CARD_PLAYS 的牌会在枚举里出现但那是"当杀/当决斗"的普通路径，与 seatPick 的"技能按钮"路径候选 label 不同——**实现时核对是否双候选，若重复则在 seatPick 候选生成时排除已在 CARD_PLAYS 枚举中的转化技，或接受双路径（AI 选哪个都合法）**，以测试锁定）。

### 6.5.2 分配类技能覆盖（6-8 个）

**探索结论：分配类技能分两种形态，覆盖方式不同**：

| 形态 | 阶段 | L1 泛化 | 需专用注册 |
|------|------|---------|-----------|
| **纯按钮**（弃X→目标组合已渲染成按钮） | `liuli`（流离：弃牌选项×目标组合）、`tianxiang`（天香：红桃×目标组合）、`lirangRecover`（获得/不获得）、`zhengyi`（争义：发动/不发动）、`xiaoguoChoice`（骁果选装备弃置） | ✅ **自动覆盖**（L1 泛化后无需任何注册） | 否 |
| **选牌/多步状态机** | `yijiAssign`（遗计分配：每张牌选接收者，累积到最后一张提交）、`lirangAsk`（礼让发动：选 2 张手牌→交人）、`xiaoguo`（骁果发动：按钮只切 xiaoguoMode，选牌在手牌点击） | ❌ 按钮点击只切 mode/累积、不提交 → **L1 覆盖不了，且直接接管会卡死**（点一下状态不变、无新调度） | ✅ 需专用注册 |

**专用注册设计（复用 handPick/两阶段模式）**：

1. **`yijiAssign`（遗计分配）**：候选 = 每张待分配牌 × 存活角色（`给 牌X → 角色Y`），**同一次 AI 选择提交全部**（AI 一次选"每张牌给谁"的完整组合？还是逐张选？）——**设计决定：逐张 AI 选**（仿真人"每张牌选接收者"）：候选 = 当前牌 `cards[idx]` × 存活角色按钮；`execute` 提交 `respondYijiAssign` 只在最后一张时调用，非最后一张时累积到客户端 `yijiPicks` 并**显式触发下一次调度**（关键：机器人端不能依赖"状态变化触发 render"，需要自己 `scheduleBotTurn` 或直接返回让调度器重入——实现时用 `botTwoStepA` 同款机制：非最后一张时设置 `botTwoStepA={decisionId:'yijiAssign', picks}`，runBotDecision 下轮重入继续）。
2. **`lirangAsk`（礼让发动）**：候选 = "选 2 张手牌"的完整组合（`buildHandPickCandidates` 复用，组合≤N）→ 目标角色；或两阶段（先组合后目标）。**设计决定：两阶段**——阶段A=2 张手牌组合（仿 discardSubset 组合生成），阶段B=目标角色（pending.to 是服务端算好的唯一目标？核实 lirangAsk 的 pending.to——render-controls 显示"交给 '目标'"是单个目标，即服务端已定目标 → 只需阶段A选组合，execute `respondLiRang(true, picks)`）。
3. **`xiaoguo`（骁果发动）**：按钮"发动【骁果】"只切 mode。**专用注册**：候选 = 手牌中每张基本牌（杀/闪/桃）→ `respondXiaoguo` 直接提交（服务端签名核实：`respondXiaoguo(cardIdx?)` 还是 `respondXiaoguo(true)+后续`？实现时 rg 确认，若无单步提交函数则用"选牌+提交"封装）。**或者简化：把 xiaoguo 加入 EXCLUDE（AI 不发动，保持 botSafePrompt 兜底）**——骁果价值低，可暂缓，实现时按成本决定（记录）。

**实现顺序**：先做纯按钮类（L1 泛化自动覆盖，零注册）→ yijiAssign → lirangAsk → xiaoguo（或 EXCLUDE 暂缓）。

### 6.5.3 验收补充

- seatPick 接线：runBotDecision 全链路测试（play 阶段 11 技能候选出现、mock 选择生效）——**第一批的测试缺口在此补齐**
- yijiAssign/lirangAsk：多步累积跨调度完成（复用 botTwoStepA 机制），无密钥 fallback 逐字
- liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice：L1 泛化后自动覆盖（测试断言候选=按钮）

---

## 7. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 有/无密钥路径解耦逻辑清晰，无密钥红线天然守住
- [x] EXCLUDE 清单来源明确（实现时按 runBotDecision 核对，宁加勿漏）
- [x] allowlist 三阶段例外有理由（旧分支已删/等价性已论证）
- [x] 用户已确认设计 §1（"ok"）
