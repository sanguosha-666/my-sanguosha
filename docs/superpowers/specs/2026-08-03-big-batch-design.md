# 大批次：响应超时托管 + 主公技 + bot.js 拆分 设计

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认参数（超时30s+倒数、主公技全做含袁术、推荐拆分、放弃AI名字标记）；待审阅

**前置**：AI 决策系统全部交付（B+C、L1泛化、A类补角）。本批做：A1 响应超时托管、A2 断线重连、B2 主公技、D2 bot.js 拆分、D3 AI_DEFAULT_MODEL 单源、D4 响应阶段 UI 回归、D1 真机验证。

---

## 1. 目标与非目标

### 1.1 目标

| ID | 目标 |
|----|------|
| G1 | **A1 响应超时托管**：询问型 pending 30s 超时自动提交最保守动作，画面显示明显倒数，不卡局 |
| G2 | **A2 断线重连状态恢复**：重连后 pending/阶段状态正确恢复 |
| G3 | **B2 主公技**：刘备激将、曹操护驾、孙策制霸、袁术妄尊全部实现，仅主公可发动 |
| G4 | **D2 bot.js 拆分**：只拆 `bot-ai-bus.js`（总线核心），按推荐方案 |
| G5 | **D3 AI_DEFAULT_MODEL 单源**：从 buildRequest 读默认档位 |
| G6 | **D4 响应阶段 UI 回归**：逐一核对 70+ 阶段按钮 |
| G7 | **D1 真机验证**：用户实操多浏览器联机 |

### 1.2 非目标

- AI 名字标记（用户放弃）。
- A9 ReAct。
- A8(b) 之外的整局其他超时（出牌阶段超时另议）。

---

## 2. A1 响应超时托管

### 2.1 机制

**服务端 pending 打时间戳 + 客户端定时器检测超时自动提交保守动作。**

- **哪些 pending 计时**：所有"询问某玩家的响应型 pending"——`respond`/`aoeResp`/`duel`/`dying`/`wuxie`/`guicai`/`jiedaoChoice`/`ganglieChoice`/`guhuoQuestion`/`xiaoguo`/`xiaoguoChoice`/`lirangAsk`/`lirangRecover`/`zhengyi`/`tianxiang`/`liuli`/`quhuRespond`/`fanjianSuit`/`huogong`/`huogongReveal` 等。
- **打戳**：`normalize` 里对响应型 pending 若无 `askedAt` 则补当前 `Date.now()`（首次询问即打戳，每次切换 asking 重新打戳）。
- **检测**：客户端 `setInterval`（如每 1s）读 `currentG`，对 `askedAt` 超过 30s 的响应型 pending 自动提交**保守动作**（出/不出、发动/不发动按各阶段保守默认）。
- **画面倒数**：`render()` 中响应型 pending 时，若 `askedAt` 存在，在 banner 或 controls 区显示"⏱ Ns 后自动…"倒计时。

### 2.2 保守动作表（超时自动提交）

| 阶段 | 保守动作 |
|------|---------|
| respond 出闪 | 不出（`respondShan(false)`） |
| aoeResp | 不出（`aoeRespond(false)`） |
| duel | 不出杀（`duelResponse(false)`） |
| dying 求桃 | 不救（`respondDying(false)`） |
| wuxie | 不出（`respondWuxie(false)`） |
| guicai | 不发动（`respondGuicai(false)`） |
| jiedaoChoice | 弃武器（`respondJiedao(false)`） |
| ganglieChoice | 受伤（`respondGanglieChoice('damage',[])`） |
| guhuoQuestion | 不质疑（`respondGuhuoQuestion(false)`） |
| xiaoguo | 不发动（`respondXiaoguo(false)`） |
| xiaoguoChoice | 受伤害（`respondXiaoguoChoice('damage')`） |
| lirangAsk | 不发动（`respondLiRang(false,[])`） |
| lirangRecover | 不获得（`respondLiRangRecover(false)`） |
| zhengyi | 不发动（`respondZhengyi(false)`） |
| tianxiang | 不发动（`respondTianxiang(null,null)`） |
| liuli | 不发动（`respondLiuli(null,null)`） |
| quhuRespond | 不出（`respondQuhu(0)`） |
| fanjianSuit | 随机花色 |
| huogong | 不跟（`respondHuogong(false)`） |
| huogongReveal | 不出（`respondHuogongReveal(0)`） |

**自动提交须幂等**：超时后服务端守卫校验通过才生效；若阶段已变（对方已操作）则提交被拒，无副作用。

### 2.3 关键设计

- **计时起点**：`askedAt` 在每次"询问轮到 X"时打戳（`normalize` 无法感知"切换"，需在服务端 `startXxx`/`openXxxRound` 打戳？——**实现时确认**：在 pending 创建/asking 切换处打 `askedAt`；`normalize` 只兜底补戳，不重复打）。
- **检测器生命周期**：仅机器人控制端启动 `setInterval` 检测（真人自己超时会自己看倒计时；机器人超时由控制端提交）。**或者**：任意客户端都可检测（幂等，谁先到谁提交）——**实现时选**：控制端启动检测器，真人端只显示倒计时不自动提交（真人挂机由下次任一客户端检测？——**决定：任何客户端都可自动提交，幂等**，最稳妥）。
- **`?v=` 同步**、progress-log 记录。

### 2.4 测试

- 超时提交：构造超时 pending → 定时器 tick → 保守动作 spy 被调。
- 未超时不提交；阶段已变（他人已操作）→ 提交被拒无副作用。
- `askedAt` normalize 兜底补戳。
- 倒数显示：banner/controls 出现倒计时文案。

---

## 3. A2 断线重连状态恢复

- **现状**：刷新后 `render(snap.val())` 恢复；pending/阶段在 Firebase 快照中，重连即恢复。需验证是否有遗漏（如客户端 mode 状态、botTwoStepA 本地态）。
- **实现**：D4/D1 回归时验证重连场景；发现缺口修复。`botTwoStepA`/`aiSummary` 是客户端内存态，刷新丢失——重连后 A6 类多步挂起会残留？——**记录边界**：重连清空 `botTwoStepA`/`aiSummary`（安全回退），不引入持久化。

---

## 4. B2 主公技

### 4.1 技能定义

| 主公技 | 拥有者 | 效果 | 触发点 |
|--------|--------|------|--------|
| **激将** | 刘备 | 需出杀时可求助其他角色替出 | respond/duel/aoeResp 需杀时 |
| **护驾** | 曹操 | 需出闪时可求助其他角色替出 | respond/aoeResp 需闪时 |
| **制霸** | 孙策 | 出牌阶段限一次，与一名其他角色拼点（需主公身份） | play 阶段 |
| **妄尊** | 袁术 | 主公的准备阶段，袁术摸一张牌、主公手牌上限-1 | 主公准备阶段 |

### 4.2 守卫

- 激将/护驾/制霸：**仅 `p.role==='zhu'` 且玩家拥有该技能**才可发动（身份局）。
- 妄尊：袁术（非主公）在"主公存在且主公准备阶段"触发（袁术摸牌，主公手牌上限-1）。
- 求助流程：激将/护驾求助时，从主公下家按序询问其他角色是否替出杀/闪（复用 `nextAskee` 类遍历）；有人替出则消耗求助者次数或直接结算。

### 4.3 实现要点

- data.js：为 liubei 加 `caps:{rende:true, jijiang:true}`、caocao 加 `hujia:true`、sunce 加 `zhiba:true`、yuanshu 加 `wangzun:true`（caps 声明能力，业务点 `hasCap` 查）。
- game.js：respond/duel/aoeResp 需杀/闪处，若 `hasCap(p,'jijiang'/'hujia')` 且 `p.role==='zhu'` 且未用过主公技，进入求助 pending（`jijiangAsk`/`hujiaAsk`）逐个问。
- 制霸：play 阶段新增 `zhiba` 注册/入口（拼点复用现有拼点机制）。
- 妄尊：主公 `startTurn` 准备阶段，若有袁术存活且拥有 `wangzun`，袁术摸一张、主公手牌上限-1（`g.lordHandCap` 或 per-turn 标志）。
- 求助技能只身份局且主公可用；非身份局/非主公角色不触发。
- **机器人侧**：新 pending 类型需 `BOT_PHASE_ACTOR` 登记 + `BOT_DECISIONS` 注册（求助响应=出/不出）+ 超时保守动作表补充。

### 4.4 测试

- 各主公技触发/守卫/求助流程/无密钥/机器人响应。
- 身份局主公专用；非身份局不触发；袁术妄尊仅在主公存在时。

---

## 5. D2 bot.js 拆分（只拆 bot-ai-bus.js）

- 新建 `bot-ai-bus.js`：`callAiChooseIndex`/`botDecide`/`BOT_DECISIONS` 骨架/`parseBotPlayAiChoice`/`buildBotDefaultSystemPrompt`/`buildBotDefaultUserPrompt`/`aiSummary` 相关（不含具体注册项与调度）。
- `bot.js` 保留：调度（scheduleBotTurn/runBotDecision/botSeatForState/BOT_PHASE_ACTOR）、注册项、出牌窗口、seatPick 表。
- `index.html` 加载顺序：`bot-ai-bus.js` 在 `bot.js` 之前（`callAI` 需 ai-bot.js 之前？——`bot-ai-bus.js` 引用 `callAI`/`aiApiKey`（ai-bot.js 声明，bot.js 之后加载但运行时调用，函数声明提升无碍）；**实现时按"bot-ai-bus 在 bot 之前、ai-bot 顺序不变"验证**。
- 拆分收益：bot.js 3200→~2800，总线核心独立可单测。
- 测试：拆分后全部 AI-bus 套件回归（行为零变化）。

---

## 6. D3 AI_DEFAULT_MODEL 单源

- 现状：`AI_DEFAULT_MODEL`（ai-bot.js:289）与 `PROVIDER_ADAPTERS[x].buildRequest` 的 `opts.model || '默认'` 双处维护。
- 实现：`AI_DEFAULT_MODEL` 改为从 `PROVIDER_ADAPTERS` 读取——新增 `defaultModelOf(provider)`：读取 `buildRequest` 的默认 model（提取到 `adapter.defaultModel` 字段），`AI_DEFAULT_MODEL` 删除或改为 `{claude:defaultModelOf('claude'),...}`。
- 测试：三家默认档位与 buildRequest 一致；模型选择器回退/标注不变。

---

## 7. D4 响应阶段 UI 回归 + D1 真机验证

- D4：逐一核对 70+ 响应阶段按钮渲染（L1 泛化后），有问题的补注册/修按钮。
- D1：真机多浏览器联机（需用户操作）——AI 摘要跨回合、L1 按钮、清除记忆、超时倒数、主公技。

---

## 8. 批次划分与依赖

| 批 | 项 | 依赖 |
|----|----|------|
| 批1 | D2 拆分 + D3 单源 | 独立（先做，减少后续改动面） |
| 批2 | A1 超时托管 + A2 重连 | 独立 |
| 批3 | B2 主公技 | 独立 |
| 批4 | D4 回归 + D1 真机 | 依赖前 3 批 |

## 9. 明确不做

- AI 名字标记（用户放弃）
- A9 ReAct
- 出牌阶段超时

---

## 10. 审阅检查清单

- [x] 超时 30s + 倒数确认
- [x] 主公技全做（含袁术妄尊）
- [x] D2 只拆 bot-ai-bus.js
- [x] AI 名字标记放弃
- [x] 各主公技守卫/触发点明确
- [x] 无密钥零变化、隐藏信息红线保持
