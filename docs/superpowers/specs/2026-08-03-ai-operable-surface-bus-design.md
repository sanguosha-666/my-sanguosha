# AI 可操作面决策总线（Operable-Surface Bus）设计

**日期**：2026-08-03  
**分支**：`wenwen_dev`（不进 `main` 直至验收）  
**状态**：待用户审阅  

---

## 1. 背景与问题

当前 AI 机器人（`bot.js` + `ai-bot.js`）只在 **5 个决策点** 调用模型：

- 出牌 `play`、选目标 `playTarget`
- 蛊惑质疑 `guhuoQuestion`、刚烈抉择 `ganglieChoice`、鬼才改判 `guicai`

其余约 30+ 个 `runBotDecision` 分支仍是本地硬编码 / 固定默认（例如无懈永远不出、弃牌从手牌末尾弃）。  
扩展方式是「每个 phase / 技能再写一套 `tryAiBot*`」，导致：

1. **覆盖窄**：高价值决策（无懈、求桃、弃牌、拆顺等）未交给 AI。  
2. **按技能适配**：新武将往往要新分支，无法「换将即用」。  
3. **信息不足**：武将 `skill`/`desc` 字段依赖死代码 `isFirstTurn`（调用处从未传 `true`）；出牌候选缺少牌面；无近期公开日志等。  

用户目标：

> 选择尽可能交给 AI；仅未填写 API 时保持现状由算法解决。  
> 系统级更改，使 AI 完整参与决策流程。  
> AI 获得所有他可以操作的内容；使用不同武将/技能时**不需要单独适配**；由模型根据对武将的理解做最优选择。

---

## 2. 目标与非目标

### 2.1 目标

| ID | 目标 |
|----|------|
| G1 | **有密钥**：凡本设计覆盖的「可操作面」上的选择，优先由 AI 在合法候选内决策。 |
| G2 | **无密钥 / AI 失败（超时、非 JSON、越界）**：立刻走各条目的 `localFallback`，行为与改动前本地算法一致；**不重试**。 |
| G3 | **免武将特判**：AI 策略代码路径不得新增 `if (general===...)` / 按武将名写的 prompt 分支；技能差异来自数据（`GENERALS`）与人类已能点的 UI/规则枚举。 |
| G4 | **统一总线**：所有 AI 决策收敛为「局面投影 → 合法候选 → `{"choice":N}` → 执行」；公共网络/解析/思考中指示只实现一次。 |
| G5 | **信息够用**：AI 能看到自己合法可见的全部操作相关信息（含全场武将技能说明、牌面、公开 pending 摘要、近期公开日志等），以便「靠理解」而非靠我们写死战术。 |

### 2.2 非目标（本设计明确不做）

- 不改 Firebase 权限、不把密钥写入共享状态。  
- 不引入后端代理；继续浏览器直连 + 用户自备密钥（`ai-bot.js`）。  
- 第一批不要求覆盖全部「点座位卡」多步技能（L3）；不强制放开借刀/铁索/闪电（可列入第二批）。  
- 不改为「单次大决策 DSL / 任意动作生成」；仍强制 **候选列表 + index**，保证合法性。  
- 不把 `AI_CALL_TIMEOUT_MS` 改为重试或按决策分化超时（保持失败立刻 fallback）。  
- 不在第一批做跨对局/跨回合的长期会话记忆（`aiConversations` 若存在，不作为本设计的决策依赖）。

---

## 3. 已确认的产品决策

| 项 | 选择 |
|----|------|
| 推进方式 | 分批；第一批 = 系统骨架 + 信息 + 高覆盖可操作面 |
| 架构 | **统一决策总线**（非逐 `if` 复制 `tryAiBot*`，非单次自由 DSL） |
| 失败策略 | 立刻本地回退，不重试 |
| 无密钥 | 与当前本地算法一致 |
| 技能适配 | **可操作面发现**，不按武将写 AI 分支 |
| 策略文案 | **极简化**通用约束；主要靠技能描述 + 候选 label，不靠长篇阵营/技能战术（既有身份 guidance / suspicionHint 可保留为轻量可选，不新增按将战术） |
| 选牌类 | 通用「手牌/组合候选 + 可选不发动」，不写郭嘉/具体将名 |

---

## 4. 架构总览

```text
                    ┌──────────────────────┐
                    │  scheduleBotTurn /   │
                    │  runBotDecision      │
                    └──────────┬───────────┘
                               ▼
              ┌────────────────────────────────┐
              │  botDecide(decisionId, g, seat) │
              └──────────┬─────────────────────┘
         aiReady?        │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   buildVisible    discover/build    callAiChooseIndex
   State(+)        Candidates        或 skip(仅1候选)
         │               │               │
         └───────► user/system prompt ◄──┘
                         │
              choice null? ──► localFallback
                         │
                         ▼
                      execute
                   (botInvoke +
                    人类同款提交路径)
```

### 4.1 核心模块

| 模块 | 职责 |
|------|------|
| `buildBotVisibleState`（加强） | 合法可见局面投影；技能文本常开；日志；自身标志；pending 公开摘要 |
| `discoverOperableActions` / 各 `buildCandidates` | 生成 **当前 seat 合法可操作** 候选，带稳定 `index` + 人类可读 `label` + 执行载荷 |
| `callAiChooseIndex` | 合并现有 5 处 `callAI` 样板：思考中 UI、timeout、`parseBotPlayAiChoice`、model 覆盖 |
| `botDecide` | match → candidates → AI 或 fallback → execute |
| `BOT_DECISIONS` | 按 **交互形态** 注册，不按武将名注册 |
| `localFallback` | 绑定改动前算法，作为回归基线 |

### 4.2 候选合法性铁律

- AI **只能**返回候选 `index`。  
- 服务端 / 既有 `respond*` / `playCard` 校验仍然是最后防线。  
- 隐藏信息（他人手牌、未翻身份、蛊惑 `actualCard` 等）**不得**进入投影；采用「从头只塞允许字段」，禁止先全量再删。

---

## 5. 可操作面分层

技能差异进入「数据 + 人类可点项」，不进入「AI 分支」。

### 5.1 L1 — Controls 镜像（响应类免武将适配）

**做法**：对机器人 seat 使用与现 `botSafePrompt` 同构的隐藏 `#controls` + `renderControls(g)`，收集**全部**启用中的 `button`（不再只匹配「取消/跳过」正则）。

每项候选：

```text
{
  index: number,
  label: string,          // 按钮文案
  source: 'controls',
  invoke: function        // 在 botInvoke(seat) 下 button.click()
}
```

**命中决策 id**：`controlsChoice`（当 `phase` 不属于 L2 专属结构化决策、且 controls 存在可点按钮时）。

**效果**：洛神、落英、铁骑、刚烈、蛊惑质疑、无懈、求桃、多数「发动/不发动」——只要 UI 出了按钮，**新技能无需改 bot 策略代码**即可进入 AI 候选。

**Fallback**：

- 若该 phase 在改动前有专用本地逻辑 → 调用等价逻辑（保持现状）。  
- 否则 → 现 `botSafePrompt` 的 safe/mandatory 选择规则。

**注意**：

- 仅 1 个合法按钮时：可跳过 AI，直接执行（省费用）。  
- 0 个按钮：不命中 L1，交给后续 L2/旧链/L3。  
- click 路径必须测 `mySeat` 借用窗口，不得在 `await` 期间占用 `mySeat`。

### 5.2 L2 — 结构化枚举（主动出牌 / 弃牌 / 拆顺等）

不依赖按钮文案，而依赖规则表与公开区（**仍无武将名分支**）：

| decisionId | 候选来源 | execute |
|------------|----------|---------|
| `playCard` | 手牌 × `CARD_PLAYS` / `canPlay`（及既有转化）；含「结束出牌」；**带牌面** | `playCard` / `endPlay` |
| `playTarget` | `canTarget` 合法座位 | 写回目标后 `playCard` |
| `discardSubset` | 需弃 `need` 张时的**完整弃牌组合**列表（见 §6） | `discardCards` |
| `pickSlot` | 手/装/判定可选项（与 `pickResolve` 的 choice 对齐） | `pickResolve` |
| `handPick`（通用） | 「不发动」+ 每张手牌一项；用于鬼才类 **pending 形态**，不写将名 | 对应 `respond*(..., cardIdx)` |

出牌阶段若同时存在「主动技按钮」（L1）与「出牌枚举」（L2）：  
**约定**：`phase==='play'` 时以 L2 `playCard` 为主路径；主动技若仅以 controls 出现且无 CARD_PLAYS 入口，则在 play 阶段先收集 L1 按钮与 L2 出牌候选 **合并为一张候选表**（同一 `botDecide('playTurn')`），避免漏技。  
实现计划阶段需对照 `renderControls` 的 play 分支核实合并规则；以「人类在该时刻能点的全部」为准。

### 5.3 L3 — 点座位卡 / 多步本地状态机（第二批）

含：借刀、丈八、离间、断粮、挑衅、蛊惑选目标等。  

**第一批不做完整 L3**。第二批方向：把「当前步骤合法座位/手牌点击」暴露为候选，逐步 AI 选择。  
第一批可继续排除 `借刀杀人`/`铁索连环`/`闪电` 与现 `botPlay` 一致，或仅文档标记为已知缺口。

---

## 6. 信息层（所有 AI 决策共享）

加强 `buildBotVisibleState(g, seat)`（及候选 entry），**不改** `normalize` / Firebase 字段。

| 补丁 | 规格 |
|------|------|
| 技能说明常开 | 对每名有 `general` 的角色附带 `generalSkill` / `generalDesc`（来自 `GENERALS`）；**删除对 `isFirstTurn===true` 的依赖**（或默认常开）。`desc` 过长时可截断到固定上限（实现时定，需测 token）。 |
| 出牌候选牌面 | 每项含 `card: {name,suit,rank}`、`handIndex`、`action`、可选预填 `target`、`localHeuristicScore` |
| 自身可知标志 | 投影自身已有标量：如 `shaUsed`、酒相关、将驰禁杀等（仅自身/公开，不引入新隐藏） |
| 近期公开日志 | `recentLog = (g.log\|\|[]).slice(-N)`，`N` 建议 8～12 |
| pending 摘要 | 公开字段组成的短结构或一句话：phase、锦囊名、from/to/asking、判定牌等；**禁止** `actualCard` |
| 身份局 | 保留 `suspicionHint`；可选保留极简 `botIdentityGuidance`（非按将） |
| 距离 | 保留 `distance`；可选附带自身攻击距离便于理解 |

**Prompt 策略（极简）**：

- System：身份（AI 机器人）+「只从候选选 index」+「参考武将技能说明与牌面」+ 输出 `{"choice":N}`。  
- 不新增长篇「郭嘉应如何」；通用价值句可保留极短或不保留。  
- User：`visibleState` JSON + `candidates` JSON。

---

## 7. 总线 API 规格

```text
BOT_DECISIONS[decisionId] = {
  match(g, seat) -> boolean
  buildCandidates(g, seat) -> Array<Candidate>
  extraState?(g, seat) -> object      // 并入 visibleState
  buildSystemPrompt?(g, seat, ctx) -> string
  localFallback(g, seat, candidates) -> choice
  execute(g, seat, choice) -> void    // 同步；内部 botInvoke
}

Candidate = {
  index: number,       // 0..n-1 连续
  label: string,
  // 以下按类型可选：
  invoke?: Function,
  handIndex?: number,
  seat?: number,
  action?: string,
  card?: {name,suit,rank},
  pickKey?: string,
  discardIndices?: number[],
  ...
}

async function botDecide(decisionId, g, seat) -> boolean
  // true = 已处理（含 fallback 执行）；false = match 失败

async function callAiChooseIndex({ systemPrompt, userPrompt, candidates, maxTokens }) -> number|null
```

**调度**（`runBotDecision`）：

1. 按稳定顺序尝试注册表中的 `botDecide`。  
2. 未命中则保留**尚未迁入**的旧本地分支（迁入完成的删除对应旧分支，避免双路径）。  
3. 最后 `botSafePrompt` / warn。  

**并发**：继续使用现有 `botDecisionInFlight` + `botMissedSchedule`；不新造模型。

**文件**：第一批优先仍在 `bot.js`；若体积不可接受，再拆 `bot-ai-bus.js` 并理清 `<script>` 顺序（须在依赖 `renderControls` / `CARD_PLAYS` 之后）。

---

## 8. 第一批交付范围

### 8.1 必须交付

1. `callAiChooseIndex` + `botDecide` + `BOT_DECISIONS` 骨架。  
2. 信息层补丁（§6）。  
3. **L1 `controlsChoice`**：覆盖当前由 buttons 表达的响应决策（含原 wuxie/dying/guhuo/ganglie 等若 UI 为按钮）。  
4. **L2**：`playCard`、`playTarget`、`discardSubset`、`pickSlot`；鬼才类若需选手牌则用通用 `handPick`（由 pending 形态触发，非将名）。  
5. 现有 5 个 `tryAiBot*` **迁入总线或删除重复实现**，行为与隐藏信息约束不回归。  
6. 无密钥 / 失败路径测试锁定 = 改动前本地行为。  

### 8.2 弃牌组合（`discardSubset`）规则

- `need = max(0, hand.length - hp)`；`need===0` → `endTurn`，不调 AI。  
- 候选必须是 **完整下标组合**，禁止模型自由输出任意数组。  
- 始终包含 **本地默认组合**（与现「从手牌末尾弃 need 张」一致）作为 fallback 对应项。  
- 若组合数过大：只生成有限集合（默认组合 + 按本地牌价值启发式的「优先弃低价值」等变体，上限实现时定，建议 ≤20～30），AI 仅从中选。  

### 8.3 明确延期（第二批+）

- L3 点座位卡与多步状态机全覆盖。  
- 借刀/铁索/闪电进入出牌候选（若 L3 未就绪则仍排除）。  
- 观星排序、选将、巧变移动等的「最优」专用优化（L1 有按钮则可先被 AI 选文案；观星多牌排序若 UI 非单按钮，另案）。  
- 身份局长战术调参、离散嫌疑事件流。  

---

## 9. 与旧设计片段的关系

此前讨论过的「9 个 decision 逐项注册（含独立 wuxie/dying prompt）」**降级为过渡思路**。  
正式方向以本文件为准：

- 优先 **L1 按钮发现** 吃掉大量响应项；  
- 仅当按钮无法表达（完整弃牌子、拆顺槽位、出牌枚举、手牌替换）时用 **L2 结构化候选**；  
- 禁止回到「每技能一个 tryAiBot」。  

---

## 10. 测试与验收

### 10.1 测试矩阵

| 层 | 用例要点 |
|----|----------|
| 总线 | 无密钥 callAI 次数=0；timeout/非 JSON/越界 → fallback；单候选跳过 AI |
| 信息 | 技能字段出现且不依赖 isFirstTurn；候选含牌面；recentLog；蛊惑无 actualCard |
| L1 | 新按钮文案出现在候选中；click 后服务端 phase 推进；mySeat 在 await 期间正确 |
| L2 | play/target/discard/pick 合法；fallback=旧算法 |
| 回归 | 既有 bot/ai 相关测试；仓库既有 run_* 套件零新增失败 |
| 无密钥 | 端到端与改动前关键分支一致 |

### 10.2 验收标准（用户可见）

1. 填写密钥后：无懈/求桃/弃牌/拆顺/出牌/多数带按钮的技能响应会显示思考中，并可能做出与本地默认不同的合法选择。  
2. 不填密钥：观感与逻辑与现在一致。  
3. 换武将：只要技能走标准 controls/CARD_PLAYS，**无需改 bot 策略代码**即可被 AI 选到对应按钮或出牌项。  
4. 代码审查：无新增按武将 id 的 AI 策略分支。  

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 按钮文案歧义导致误选 | fallback；可选为 button 增加稳定 `data-bot-action`（若改 render-controls，保持人类 UI 不变） |
| AI 调用次数与费用上升 | 单候选跳过；失败不重试；15s 超时 |
| 隐藏 DOM click 与渲染竞态 | 沿用 botSafePrompt 隔离模式；单测锁 mySeat |
| L1 无法覆盖座位卡 | 文档标明 L3；不宣称 100% 操作覆盖直至 L3 完成 |
| 模型不懂冷门技能 | 技能 desc 常开；仍可能弱于特制逻辑——用覆盖率与免适配换取 |
| `bot.js` 体积 | 可拆文件；加载顺序回归 |

---

## 12. 实现分期建议（供 writing-plans）

| 阶段 | 内容 |
|------|------|
| P0 | 信息层 + `callAiChooseIndex` + `botDecide` 骨架 + 无密钥回归 |
| P1 | 迁入 play/target + 候选牌面；删重复 tryAi 样板 |
| P2 | L1 controlsChoice 替换大量响应硬编码；wuxie/dying 等吃进 L1 |
| P3 | discardSubset + pickSlot + handPick（鬼才） |
| P4 | 清理旧分支、测试加固、progress-log 记录 |
| P5+ | L3 座位卡 / 三张被排除的牌 |

---

## 13. 成功标准（一句话）

**有密钥时，AI 在「当前合法可操作列表」上做选择，并靠完整可见信息与武将说明理解局势；无密钥时与今日本地机器人一致；新武将不靠 bot 特判接入。**

---

## 14. 审阅检查清单（作者自检）

- [x] 无 TBD 占位  
- [x] 与「候选 + index」及隐藏信息原则一致  
- [x] 第一批 / 第二批边界明确  
- [x] 无密钥与失败策略无歧义  
- [x] 明确反对按武将适配 AI  

---

*本文件为设计规格，不含实现代码。批准后进入 implementation plan（writing-plans）。*
