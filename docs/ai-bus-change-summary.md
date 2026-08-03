# AI 决策系统改造前后对比（详细说明）

**日期**：2026-08-03
**分支**：`wenwen_dev`（尚未并入 `main`）
**涉及改动**：AI 可操作面决策总线（Milestone B + C）+ 动态模型列表（M1）
**规格文档**：`docs/superpowers/specs/2026-08-03-ai-operable-surface-bus-design.md`
**实现计划**：`docs/superpowers/plans/2026-08-03-ai-operable-surface-bus.md`

---

## 1. 项目背景与改动动机

本项目是网页版联机三国杀（纯静态多文件 JS，无构建）。玩家可以往房间里添加**AI 机器人**（`bot.js` 里的机器人调度 + `ai-bot.js` 里的 AI 接入层）：机器人读取共享房间状态，在轮到自己的回合/响应时做出决策并提交动作。配置了 AI 密钥后，决策可以交给大模型（Claude / OpenRouter / Groq），由模型在合法候选里选一个动作；没有密钥时由本地启发式算法兜底。

### 改动前的问题

| # | 问题 | 具体表现 |
|---|------|---------|
| 1 | **覆盖窄** | 只有 5 个决策点接入了 AI：出牌、选目标、蛊惑质疑、刚烈抉择、鬼才改判。高价值决策（无懈可击、濒死求桃、弃牌、拆顺选牌）全是本地硬编码：无懈**永远不出**、弃牌**固定弃手牌末尾**、拆顺**固定选手牌**。 |
| 2 | **按技能适配** | 每接入一个新决策点，就要复制整套 `tryAiBotXxx`（密钥守卫 + 思考中 UI + callAI + 解析 + 越界回退），还要在 `runBotDecision` 的 30+ 个 `if` 分支里再插一个。新武将/新技能要写新分支，无法"换将即用"。 |
| 3 | **信息不足** | 武将技能说明字段 `generalSkill`/`generalDesc` 依赖一个从未传 `true` 的参数 `isFirstTurn`——**是死代码，AI 从头到尾没看到过任何技能说明**；出牌候选只给 action/目标/本地分数，不给牌面（AI 分不清红杀黑杀、哪张锦囊）；没有任何近期日志、出杀次数等上下文。 |
| 4 | **出牌动作空间被砍** | `botPlay` 枚举时硬排除三张牌：借刀杀人、铁索连环、闪电——永远不出。 |
| 5 | **模型选择写死** | 模型选择器（弹窗里的下拉框）只有一份手写候选表 `AI_MODEL_OPTIONS`（每家 provider 3~4 个预置模型），不能看到 provider 实时提供的全部模型，也没有搜索。 |

### 改动目标（用户原话对齐）

> 选择尽可能交给 AI；仅未填写 API 时保持现状由算法解决。系统级更改，使 AI 完整参与决策流程。AI 获得所有他可以操作的内容；使用不同武将/技能时**不需要单独适配**；由模型根据对武将的理解做最优选择。

---

## 2. 总览对比

| 维度 | 改动前 | 改动后 |
|------|--------|--------|
| 架构 | 5 个独立 `tryAiBot*` 函数，各写一套样板 | 统一决策总线 `botDecide` + `BOT_DECISIONS` 注册表 |
| AI 决策覆盖 | 5 类 | **8 类注册决策 + 出牌候选放开**（无懈/弃牌/拆顺/洛神/落英/闪电/铁索等新纳入） |
| 技能适配 | 按技能手写分支 | **可操作面发现**：按钮镜像（L1）+ 结构化候选（L2），新技能只要人类 UI 出了按钮/进了 `CARD_PLAYS`，AI 自动能选 |
| 出牌询问次数 | 先问牌、再问目标 = **2 次 AI 调用** | 牌×目标合并候选 = **1 次 AI 调用** |
| 武将信息 | 死代码，AI 看不到 | 常开：全场技能说明 + 牌面 + 近期日志 + 自身标志 |
| 无密钥行为 | 本地算法 | **逐字一致**（回归红线，测试锁定） |
| 模型选择 | 写死候选表 | **provider API 实时拉取 + 搜索过滤 + 失败回退静态表** |

---

## 3. 架构层对比（核心）

### 3.1 改动前：平铺式 tryAi*

```text
runBotDecision (30+ 个 if 分支)
├── phase==='play'      → botPlay → tryAiBotPlay      (自己的一套 callAI/解析/回退)
├── phase==='guhuoQuestion' → tryAiBotGuhuoQuestion   (又一套)
├── phase==='ganglieChoice' → tryAiBotGanglieChoice   (又一套)
├── phase==='guicai'        → tryAiBotGuicai          (又一套)
├── phase==='wuxie'         → respondWuxie(false)     ← 硬编码，永不无懈
├── phase==='discard'       → 弃手牌末尾 need 张      ← 硬编码
└── phase==='pick'          → 固定手牌优先            ← 硬编码
```

每个 `tryAiBot*` 内部结构重复：`if(!aiApiKey) return null` → `showAiThinkingIndicator` → `try/catch callAI` → `finally hideAiThinkingIndicator` → `parseBotPlayAiChoice` → 越界判断 → 回退。**五份样板，五处维护**。

### 3.2 改动后：统一决策总线

```text
runBotDecision (6 处 botDecide 接线 + 遗留分支)
└── botDecide(decisionId, g, seat)          ← 唯一入口，async
    ├── spec.match(g, seat)                 ← 该决策点是否命中当前状态
    ├── spec.buildCandidates(g, seat)       ← 生成合法候选（规范化 index）
    ├── [有密钥且候选>1] callAiChooseIndex  ← 一次 AI 询问（统一样板）
    │     ├── 密钥守卫 / 思考中 UI / 超时 / 解析 / 越界  ← 全部收敛在此
    ├── [无密钥或失败] spec.localFallback   ← 本地兜底（= 改动前算法）
    └── spec.execute(g, seat, choice)       ← 同步提交（内部 botInvoke）
```

**注册表** `BOT_DECISIONS`（`bot.js`）：

```js
BOT_DECISIONS.controlsChoice = { match, buildCandidates, localFallback, execute, buildSystemPrompt };
BOT_DECISIONS.discardSubset  = { match, buildCandidates, localFallback, execute, buildSystemPrompt, maxTokens };
BOT_DECISIONS.pickSlot       = { match, buildCandidates, localFallback, execute, buildSystemPrompt };
BOT_DECISIONS.guicaiHandPick = { match, buildCandidates, localFallback, execute, extraState, buildSystemPrompt, maxTokens };
BOT_DECISIONS.ganglieChoice  = { match, buildCandidates, localFallback, execute, extraState, buildSystemPrompt, maxTokens };
BOT_DECISIONS.guhuoQuestion  = { match, buildCandidates, localFallback, execute, extraState, buildSystemPrompt, maxTokens };
```

**统一 AI 询问** `callAiChooseIndex(opts)`：密钥守卫 → 单候选短路（省一次请求）→ 思考中指示 → `callAI` → 解析 → 范围校验。任何失败（无密钥/超时/非 JSON/越界）一律返回 `null`，调用方落 `localFallback`，**不重试、不阻塞、不抛异常**。

### 3.3 新决策接入成本对比

| 步骤 | 改动前 | 改动后 |
|------|--------|--------|
| 写 AI 调用样板 | 复制 ~30 行（容易漏） | 零（总线已含） |
| 写本地回退 | 与 AI 分支并列写一遍 | `localFallback` 一项 |
| 接线 | 在 runBotDecision 里插 if 分支 | 注册表一项 + 一行 `botDecide` 接线 |
| 测试 | 每套 tryAi* 单独测 | 复用总线测试基础设施 |

---

## 4. 可操作面分层（L1 / L2 / L3）——"换将免适配"的实现机制

用户的核心诉求是"不同武将/技能不需要单独适配"。实现机制是把技能差异**从 AI 分支代码挪进"数据 + 人类可点项"**：

### L1 — Controls 按钮镜像（响应类免适配）

**原理**：人类玩家的每个响应/选择在 UI 上都是 `#controls` 区域的一组按钮（出闪/不发动/质疑/不出/获得/受到伤害…）。`collectControlsCandidates` 克隆 `botSafePrompt` 的 DOM 隔离模式（真实 `#controls` 临时改名 → 挂一个隐藏 box → `mySeat=seat` → `renderControls(g)`），收集**全部** `button:not(:disabled)` 作为候选：

```text
候选 = [{index, label: 按钮文案, source:'controls', invoke: ()=>btn.click()}, ...]
```

AI 从按钮里选；`execute` 在 `botInvoke(seat)` 下点击该按钮（点击触发的是真人同款 onclick → 服务端函数），点击后销毁隐藏 box 并重渲染恢复真人视角。

**为什么敢用"点按钮"作为提交手段**：按钮的 onclick 就是真人点击时执行的同一段代码（`respondWuxie(true)` 等），没有第二条路径，不可能绕过服务端校验。

**关键纪律 —— allowlist 与无密钥等价性**：不是所有 phase 都能进 L1。只有满足以下两条的阶段才允许迁移：
1. 该 phase 在 `renderControls` 里真实渲染了可点按钮；
2. 旧本地分支的动作 == 按 `localFallback` 选择顺序（safe 正则 `/不发动|不使用|不出|取消|跳过|放弃|结束/` → mandatory 正则 → 第一项）点出来的按钮动作。

逐个读了 `render-controls.js` 核对，当前 allowlist 只含三个：

| phase | 按钮 | 旧本地分支 | 回退落点 | 等价 |
|-------|------|-----------|---------|------|
| `wuxie` | 打出【无懈可击】(无牌时 disabled) + 不出 | `respondWuxie(false)` | safe 正则第一命中「不出」 | ✓ |
| `luoyingAsk` | 获得 + 不获得 | `respondLuoying(true)` | 两者都不命中正则 → `candidates[0]`=「获得」 | ✓ |
| `luoshen` | 发动【洛神】判定 + 不再发动 | `respondLuoshen(true)` | 「不再发动」不含"不发动"子串 → `candidates[0]`=「发动」 | ✓ |

**刻意不迁移的例子**：铁骑/烈弓的按钮是 [发动X, 不发动]，safe 正则第一命中「不发动」，而旧分支是 `respondTieqi(true)`/`respondLiegong(true)` —— 回退会变行为，违反无密钥回归红线，所以不迁。guicai/ganglie/guhuo 的按钮是多步状态机或随机回退（见下），也走专用注册而非 L1。

### L2 — 结构化候选（主动出牌/弃牌/拆顺/选牌）

不依赖按钮文案，而依赖规则表与公开区，同样不写武将名：

| 注册项 | 候选来源 | 本地回退（= 旧算法） |
|--------|----------|---------------------|
| `playCard`（经 botPlay/弱C） | 手牌 × `CARD_PLAYS.canPlay/canTarget`，候选带牌面 | `value>25` 才打最高价值牌，否则结束 |
| `discardSubset` | 完整弃牌组合（默认组合恒在 = 旧"弃末尾 need 张"，+ 按价值升序的变体，去重 ≤20 组） | 默认组合 |
| `pickSlot` | 目标手牌（整体 1 项）/ 每件装备 / 判定区每张延时锦囊 | 手牌优先 → 第一个占用装备槽 → delay:0 |
| `guicaiHandPick` | index0 不发动 + 每张手牌一项 | `{replace:false}`（永不发动） |
| `ganglieChoice` | 弃 2 张 / 受伤（手牌<2 时只剩受伤） | 手牌≥2 弃 `[0,1]`，否则受伤 |
| `guhuoQuestion` | 质疑 / 不质疑 | `Math.random()<0.3`（随机，逐字复刻） |

**为什么这三个响应类不并入 L1**（实现时核实过的结构性原因）：
- `guicai` 按钮「发动【鬼才】」点击只进入 `guicaiMode` 本地状态机（再逐张选手牌），不会直接提交 → 需要专用 handPick 候选（AI 一次选"用哪张牌替换"，`outcomeIfKept` 描述 8 种判定后果）
- `ganglieChoice` 按钮是逐张切换选牌的累积状态机 → 需要专用二元候选
- `guhuoQuestion` 旧回退是**随机**，L1 的确定性回退顺序无法复现 → 专用注册保留随机

### L3 — 点座位卡 / 多步状态机（部分延期）

借刀杀人（A/B 两步流程）、丈八蛇矛、离间、断粮等"点座位卡"类交互没有进入第一批。当前状态：
- **闪电、铁索连环**：已纳入出牌候选（B6 审计后确认单步 `playCard` 可合法表达；闪电的 onlySelf 自目标用**通用** `allowSelf && canTarget(self)` 兜底，不按牌名特判）
- **借刀杀人**：保持排除（`effect` 留空、需要两个目标的专用流程，单目标模型无法表达），完整支持列入 Milestone C1b
- **其余座位卡类**：文档记录为已知缺口，C 阶段 `enumerateAllLegalOneStepActions` 未并入 controls 候选（v1 只做手牌×目标展开）

---

## 5. 信息层对比（AI 能看到什么）

统一局面投影 `buildBotVisibleState(g, seat)` 改动前后：

| 字段 | 改动前 | 改动后 | 说明 |
|------|--------|--------|------|
| 全场 `generalSkill`/`generalDesc` | ❌ 死代码 | ✅ 常开（desc 截断 120 字符） | 修掉 `isFirstTurn` 从未传 true 的 bug |
| 出牌候选牌面 | ❌ 只有 action/目标/分数 | ✅ `card:{name,suit,rank}` + `handIndex` + `label` | AI 能区分红杀/黑杀、哪张锦囊 |
| `recentLog` | ❌ 无 | ✅ 最近 10 条公开日志 | 身份推断/节奏参考 |
| `myFlags` | ❌ 无 | ✅ `{shaUsed, jiangchiNoSlash}` | 自己回合内标志 |
| 距离 | ✅ 已有 | ✅ 不变 | — |
| `suspicionHint`（身份局嫌疑分档） | ✅ 已有 | ✅ 不变 | — |
| 他人手牌 | 只张数 | 只张数（不变） | 隐藏信息红线 |
| 蛊惑 `actualCard` | 不出现 | 不出现（结构保证） | 见 §8 |

**Prompt 策略**：从"每决策点一部长篇 system prompt"收敛为**极简通用模板**（`buildBotDefaultSystemPrompt`："根据局面与武将技能说明，从候选列表选一个 index，只输出 {"choice":数字}"）+ 各决策点可选的短补充（如 guicai 的第三方视角提醒、蛊惑的缠怨后果说明）。靠技能描述 + 候选 label 让模型自己理解，不靠我们写战术。

---

## 6. Milestone C：同窗口多步（弱 C 设计）

### 6.1 探测结论（实现时实证）

`game.js` 的 `tx(fn)` 是 **fire-and-forget**：内部调 `gameRef.transaction(...)` 后直接返回 void，不返回 Promise、不 await。`playCard` 全部状态变更都发生在 tx 回调里（Firebase 事务收到的快照对象，不是调用方本地 `g` 引用）。因此一次 `playCard` 调用后，本地 `g`/`currentG` **不会同 tick 更新**——`currentG` 只在 Firebase 回声回来触发 `render(g)` 时才刷新。

**结论：强 C（一次调度内多步循环）在本架构下不可行**——循环体第二步枚举读到的还是旧状态，会把同一张牌打两次或打出已被服务端拒绝的动作。要支持强 C 必须给 `playCard`/`tx` 加"提交后回调"，那是 **C1b** 的未来工作（需要动 `game.js`，当时任务范围禁止）。

### 6.2 弱 C 语义（已交付）

```text
每次调度（scheduleBotTurn）恰好执行一步：
  runBotActionWindow(g, seat)
    ├── isBotActionWindow: phase==='play' && turn===seat && !g.pending
    ├── enumerateAllLegalOneStepActions: 手牌×目标展开成完整动作候选
    ├── AI 选一个（或本地回退）
    └── execute: playCard(handIndex, action, target) / endPlay
多步组合（拆马→杀）由 scheduleBotTurn 对同一 play 窗口的下一次调度再入窗推进，
跨步连续性由 recentLog 传达。
```

**C 相对 B 的关键收益**：候选**牌×目标合并**——AI 一次拿到"出什么牌、打给谁"的完整信息，消灭旧 botPlay 的"先问牌、再问目标"两次询问（实测 2 次 AI 调用 → 1 次）。

**无密钥兜底 = 旧规则逐字复刻**：旧 `botPlay` 启发式是"`options[0].value>25` 才打最高价值牌，否则结束出牌"。`localFallbackPlayWindow` 在合并候选里找 `localHeuristicScore` 最大的非结束候选，>25 就打它、否则打结束项——与旧行为每步一致（有逐条测试）。

**`BOT_WINDOW_MAX_STEPS = 8`** 常量保留，是未来强 C 的循环上限占位（弱 C 下每调度 1 步用不到）。

---

## 7. 无密钥回归保证（红线机制）

用户明确要求"仅未填写 API 时保持现状由算法解决"。三层保证：

1. **fallback 逐字复刻**：每个注册项的 `localFallback` 就是旧硬编码分支的同一段逻辑（wuxie→不出、discard→默认组合=末尾 need 张、pick→手牌优先、ganglie→手牌≥2 弃 [0,1]、guhuo→30% 随机、play→value>25 规则）。
2. **allowlist 等价性论证**：L1 只迁移经过逐按钮核对等价的三阶段（见 §4），其余 phase `match` 返回 false，旧分支原样运行。
3. **测试锁定**：无密钥测试断言"callAI 零调用 + 动作与旧行为一致"。

---

## 8. 隐藏信息保护（结构保证，非事后过滤）

沿袭项目既有原则"**从头只投影允许字段**，不先给全量再删"：

- 他人手牌只给 `handCount`（张数），不给 name/suit/rank；
- 未翻开身份 `knownRole=null`，不回退成猜测值；
- **蛊惑**：`buildBotGuhuoVisibleState` 的函数体从第一行到最后一行**没有出现过 `d.actualCard` 这个引用**——不是"塞进去再删掉"（那会存在漏删风险），是结构上不可能引用到；
- AI 收到的 userPrompt 由 `buildBotDefaultUserPrompt` 白名单字段序列化（index/label/action/card/seat/handIndex/pickKey/discardIndices），`invoke` 函数等内部字段不会进 JSON。

测试用真实构造的"actualCard=无中生有，claimedCard=杀"场景断言 userPrompt 不含真实牌名、含声明牌名（正反两条对照，防止"整个 state 被清空"的过度防御假象）。

---

## 9. 模型选择器对比（M1）

| 维度 | 改动前 | 改动后 |
|------|--------|--------|
| 数据来源 | 写死 `AI_MODEL_OPTIONS`（claude 3 项 / openrouter 4 项 / groq 4 项） | **实时拉取** provider 模型列表 API，失败回退静态表 |
| 交互 | 原生 `<select>` 下拉框，不可搜索 | **搜索框 + 过滤选项列表**（自定义组件，按 id/name 实时过滤；移动端支持好） |
| 缓存 | 无 | 模块级 `modelListCache`，同 provider 会话内只拉一次 |
| 默认档位 | 静态表第一项视觉预选不写入 | 动态列表里匹配 `AI_DEFAULT_MODEL` 的项标「(默认)」并预选，语义不变（`aiApiModel` 空 = 不覆盖，交给 buildRequest 默认值） |
| 自定义项 | 保留 | 保留（`__custom__` 手动输入模型 ID，input/blur 双保存） |

### 三个 provider 的模型列表 API（已查证）

| Provider | 端点 | 鉴权 | 响应要点 |
|----------|------|------|---------|
| OpenRouter | `GET https://openrouter.ai/api/v1/models` | 无（公开） | `{data:[{id,name,...}]}` 300+ 项 |
| Claude | `GET https://api.anthropic.com/v1/models?limit=1000` | `x-api-key` + `anthropic-version` + `anthropic-dangerous-direct-browser-access`（与 messages 端点同规则） | `{data:[{id,display_name,...}],has_more,...}` |
| Groq | `GET https://api.groq.com/openai/v1/models` | `Authorization: Bearer <key>` | OpenAI 兼容 `{data:[{id,...}]}` ~20-40 项 |

**失败处理**：fetch reject / 非 2xx / JSON 结构不符 / 超时（15s AbortController，复用 callAI 模式）一律 resolve `null` → `renderModelPicker` 回退 `AI_MODEL_OPTIONS` 静态表并提示「模型列表加载失败,使用内置列表」。
**竞态守卫**：拉取期间用户又改了 provider/密钥 → 结果返回时 `aiProvider !== provider` 直接丢弃（每次输入都会重新走拉取，不会丢列表）。
**未确认点与兜底**：Claude models 端点是否放行浏览器直连（dangerous 头）未实测（需要真实密钥）——代码已带齐三个头，若仍被拒则自动回退静态表，不影响使用。

### 渲染结构（顶层可测函数）

```text
renderModelListInto(modelWrap, list, {selectedId, defaultValueId, onPick})
├── 搜索框  #aiModelSearchInput  (input 事件只重建列表容器 → 打字不丢焦点)
├── 选项列表 #aiModelList        (过滤后的 button 列表；匹配默认档位加「(默认)」；
│                                选中项 class='selected'；点击 → onPick(id)+清空搜索框)
└── 自定义项 button               (→ 显示 #aiModelCustomInput 文本框，语义同旧版)
```

---

## 10. 测试与验证

### 新增测试（全部落盘到仓库）

| 测试文件 | 覆盖 | 断言数 |
|----------|------|--------|
| `run_ai_bus_core_test.js` | 总线骨架：解析/越界/超时/无密钥短路/未注册决策 | 7 |
| `run_ai_bus_info_test.js` | 信息层：技能常开/isFirstTurn 无关/recentLog/myFlags/蛊惑无 actualCard | 5 |
| `run_ai_bus_l1_test.js` | L1：按钮收集/等价回退/单候选短路/非 allowlist 不动/DOM 归还 | 8 |
| `run_ai_bus_l2_test.js` | L2：出牌/选目标/弃牌组合/拆顺/响应三兄弟 + 无密钥回归 | 23 |
| `run_ai_bus_c_window_test.js` | C：窗口谓词/一步枚举/弱C两步序列（拆马→杀）/value>25 兜底 | 15 |
| `run_ai_model_picker_test.js` | M1：三端点 header/解析/失败/缓存/搜索过滤/选中持久化/回退/默认标注 | 13 |
| **合计** | | **71** |

### 回归基线

- 仓库既有测试：lidian 3/0、青釭仁王 6/0、法正 11/0、旋风 5/0、cixiong 17/3（3 个失败为既有基线，与本次改动无关）
- `node --check` 全部通过
- **鉴别力验证**：B0/B5/M1 等多处用 mutation（临时改坏实现）确认断言会精确变红，不是空转

### 关键验证方法（TDD 证据）

每批实现均先写测试 → 确认 RED（新函数未定义/旧行为与预期差异）→ 实现 → GREEN。例如 C1 的两步序列测试：g1 有马时杀不合法 → mock 选拆桥 → 手工模拟 Firebase 回声更新状态 → 第二次调度 mock 选杀 → playCard(杀, 目标) 被调用，证明弱 C 跨调度多步成立。

---

## 11. 已知边界与未来工作

| 项 | 状态 | 说明 |
|----|------|------|
| **强 C（同 tick 多步）** | 延期 C1b | 需给 `game.js` 的 `tx`/`playCard` 加"提交后回调"；当前弱 C 已实现合并候选 + 跨调度多步 |
| **借刀杀人** | 保持排除 | 两步 A/B 流程，单目标模型无法表达 |
| **L3 点座位卡类**（丈八/离间/断粮/挑衅等） | 未接入 | `enumerateAllLegalOneStepActions` v1 只做手牌×目标展开，controls 候选合并是 C1 扩展项 |
| **`AI_DEFAULT_MODEL` 双处维护** | 已知 | 与 `PROVIDER_ADAPTERS.buildRequest` 的硬编码默认 id 需保持同步（测试钉死三个 id 兜底） |
| **bot.js 体积** | 增长至 ~1860 行 | 决策总线功能聚集；后续可按域拆分（bot-ai-bus.js 等），需理清 `<script>` 加载顺序 |
| **响应超时/托管** | 未做 | 项目既有待办，非本次范围 |
| **长期会话记忆** | 未做 | `aiConversations` 仅刷新警告用，决策无跨回合记忆（spec 非目标） |

---

## 12. 关键文件清单

| 文件 | 本次改动 |
|------|---------|
| `bot.js` | +470 行：总线骨架、6 个注册决策、L1/L2、弱 C 执行器、信息层增强；删除 3 个旧 tryAi* |
| `ai-bot.js` | +~210 行：`fetchProviderModels`/`modelListCache`/`renderModelListInto`；`renderModelPicker` 重构 |
| `index.html` | 动态模型列表 CSS 四件套；`?v=` 258 → 269 |
| `docs/progress-log-7.md` | B/C 两个里程碑 + M1 交付记录 |
| `run_ai_bus_*.js` ×5 + `run_ai_model_picker_test.js` | 新增测试（共 71 项断言） |
| `docs/superpowers/specs/2026-08-03-ai-operable-surface-bus-design.md` | 设计规格 |
| `docs/superpowers/plans/2026-08-03-ai-operable-surface-bus.md` | 实现计划 |

---

## 13. 一句话总结

**改动前**：5 个手写 AI 决策点（各带一套样板）+ 写死模型表；无懈/弃牌/拆顺等全是硬编码；AI 看不到技能说明。

**改动后**：统一决策总线覆盖 8 类注册决策 + 出牌候选放开（闪电/铁索）；按钮镜像与结构化候选实现"换将免适配"；信息层补齐（技能常开/牌面/日志/标志）；出牌一次 AI 拿完整动作；无密钥行为逐字不变；模型选择实时拉取 + 搜索。

**未变**：隐藏信息保护（结构保证）、候选+index 合法性铁律、不重试、`botDecisionInFlight` 并发保护、无密钥=本地算法。
