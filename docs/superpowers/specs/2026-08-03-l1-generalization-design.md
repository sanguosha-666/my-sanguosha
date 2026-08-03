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

## 7. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 有/无密钥路径解耦逻辑清晰，无密钥红线天然守住
- [x] EXCLUDE 清单来源明确（实现时按 runBotDecision 核对，宁加勿漏）
- [x] allowlist 三阶段例外有理由（旧分支已删/等价性已论证）
- [x] 用户已确认设计 §1（"ok"）
