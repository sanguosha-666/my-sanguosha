# AI 可操作面决策总线（Operable-Surface Bus）设计

**日期**：2026-08-03  
**分支**：`wenwen_dev`（不进 `main` 直至验收）  
**状态**：用户确认分阶段 B→C；待实现计划  

---

## 0. 定位：通用性 vs 模型智慧（诚实边界）

本设计 **不是** 理论上「最能压榨模型智慧」的形态，而是：

> 在本项目约束（联机合法性、客户端 bot、无密钥可玩、失败不重试、免武将特判）下，**通用性最强且可落地** 的第一架构；并预留升级到更能体现模型水平的形态。

| 形态 | 通用性 | 模型智慧空间 | 本规格角色 |
|------|--------|--------------|------------|
| A. 按技能 `tryAiBot*` | 差 | 中（细但碎） | **淘汰方向** |
| **B. 可操作面总线**（单步：投影→候选→选 index→执行） | **很强** | **中**（聪明的合法选择器） | **先落地（Milestone B）** |
| **C. 同窗口多步合法动作**（动作图 + 短循环 2～N 次 AI） | 强 | **较高** | **B 验收后升级（Milestone C）** |
| D. 多轮 ReAct/工具调用 | 强 | 高 | 远期，非本规格承诺 |
| E. 自由 DSL / 任意动作生成 | 假性通用 | 看似高 | **明确不做**（校验与联机风险） |

**用户已选路径：先 B 落地，再升 C**（见 §12、§12.1）。

**B 的智慧天花板（已知，不靠文案否认）**：

1. 决策碎片化（出牌/目标/无懈各问一次），难做跨步计划。  
2. 候选过窄时模型只能二选一。  
3. L3 未齐前操作面不完整。  
4. 无局面搜索/假设推演。  

**C 如何抬高天花板（仍保持候选合法性）**：同一「人类可连续操作」窗口内，重复「枚举当前全部合法一步动作 → AI 选一步 → 执行 → 再枚举」，直到窗口结束或步数/时间预算用尽；禁止自由发明动作。

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
| G4 | **统一总线**：所有 AI 决策收敛为「局面投影 → 合法候选 → `{"choice":N}` → 执行」；公共网络/解析/思考中指示只实现一次。（Milestone C 将同一 primitive 在同窗口内短循环，而非换协议。） |
| G5 | **信息够用**：AI 能看到自己合法可见的全部操作相关信息（含全场武将技能说明、牌面、公开 pending 摘要、近期公开日志等），以便「靠理解」而非靠我们写死战术。 |
| G6 | **分阶段智慧**：先交付可验收的 Milestone B（单步可操作面）；再交付 Milestone C（同窗口多步），不在 B 未稳时并行上 D/E。 |

### 2.2 非目标（本设计明确不做）

- 不改 Firebase 权限、不把密钥写入共享状态。  
- 不引入后端代理；继续浏览器直连 + 用户自备密钥（`ai-bot.js`）。  
- 第一批不要求覆盖全部「点座位卡」多步技能（L3）；不强制放开借刀/铁索/闪电（可列入第二批）。  
- **永不**改为自由 DSL / 任意动作生成（形态 E）；Milestone B 与 C 均强制 **候选列表 + index**。  
- Milestone B **不**实现同窗口多步循环（形态 C）；C 有独立验收，不与 B 混在同一「是否完成」判定里。  
- 不把 `AI_CALL_TIMEOUT_MS` 改为重试或按决策分化超时（保持失败立刻 fallback）。C 阶段可增加「整窗总预算」，但仍是不重试单次 call。  
- 不在 Milestone B 做跨对局/跨回合的长期会话记忆（`aiConversations` 若存在，不作为决策依赖）。  
- 不以形态 D（ReAct）为交付承诺。

---

## 3. 已确认的产品决策

| 项 | 选择 |
|----|------|
| 推进方式 | **先 B 后 C**：Milestone B 单步可操作面总线 → 验收后再 Milestone C 同窗口多步 |
| 架构 | **统一决策总线**（非逐 `if` 复制 `tryAiBot*`，非自由 DSL）；C 复用同一 `botDecide` primitive |
| 失败策略 | 立刻本地回退，不重试 |
| 无密钥 | 与当前本地算法一致 |
| 技能适配 | **可操作面发现**，不按武将写 AI 分支 |
| 策略文案 | **极简化**通用约束；主要靠技能描述 + 候选 label，不靠长篇阵营/技能战术（既有身份 guidance / suspicionHint 可保留为轻量可选，不新增按将战术） |
| 选牌类 | 通用「手牌/组合候选 + 可选不发动」，不写郭嘉/具体将名 |
| 智慧预期 | B = 合法单步选择器；C = 同窗连续合法操作，更能体现规划；均不宣称「最强牌力 AI」 |

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

### 12.0 Milestone B — 单步可操作面（先做完并验收）

| 阶段 | 内容 |
|------|------|
| B0 | 信息层 + `callAiChooseIndex` + `botDecide` 骨架 + 无密钥回归 |
| B1 | 迁入 play/target + 候选牌面；删重复 tryAi 样板 |
| B2 | L1 `controlsChoice` 替换大量响应硬编码；wuxie/dying 等吃进 L1 |
| B3 | `discardSubset` + `pickSlot` + `handPick`（鬼才类 pending 形态） |
| B4 | 清理旧分支、测试加固、progress-log 记录 |
| B5 | **L3 点座位卡 / 借刀·铁索·闪电**（建议仍属 Milestone B 的完成定义，或作为 B 的硬前置再开 C——见 §12.1；实现计划须选定一种并写死） |

**Milestone B 验收（全部满足才算 B 完成）**：

1. §10.2 用户可见标准成立。  
2. 有密钥时，L1+L2（及已纳入的 L3）路径走总线；无密钥与改动前一致。  
3. 无新增按武将 id 的 AI 策略分支。  
4. 文档与代码均承认：B 是单步选择器，**不**声称同窗多步规划。  

### 12.1 Milestone C — 同窗口多步合法动作（B 验收后）

**动机**：抬高模型智慧空间，同时 **不** 放弃候选合法性、不引入自由 DSL。

**核心机制**：

```text
loop 最多 maxSteps 次，且未超过 windowTimeBudget：
  actions = enumerateAllLegalOneStepActions(g, seat)  // L1∪L2∪L3 合并
  if actions 空或不需再操作: break
  if 仅 1 个强制动作: 直接执行；continue
  choice = AI 选 index 或 fallback
  execute(choice)
  // 等待状态回到可决策（既有 scheduleBotTurn / tx 回声）；禁止在 await 占用 mySeat
```

**「同窗口」定义（实现计划须写成可判定谓词）**：

- 例 A：同一 `g.turn===seat` 且 `phase==='play'` 的连续出牌直至 `endPlay`。  
- 例 B：同一 pending 链上该 seat 的连续响应（若存在多步本地 UI）。  
- 跨 turn、跨其他玩家行动的「长期记忆规划」**不属于** C。  

**C 相对 B 的约束继承**：

| 项 | C 是否改变 |
|----|------------|
| 候选 + index | 否，必须 |
| 无密钥 fallback | 否，每步仍可 fallback |
| 失败不重试 | 否；单步失败 fallback 后可决定 break 或继续窗（实现计划定，默认 fallback 后 **break 出 AI 循环、交回调度**，避免半残窗） |
| 免武将特判 | 否 |
| 隐藏信息 | 否，更严（多步不得泄漏） |
| 费用 | 上升；必须有 `maxSteps` + 可选总时间预算 |

**C 验收**：

1. 出牌窗内 AI 可连续做出多个合法操作（非仅一拍即交权），直至选择结束出牌或预算用尽。  
2. 每步仍可通过服务端/规则校验；无密钥整窗行为不劣于 B 的逐步 fallback。  
3. 对比 B：至少一类场景（如「先拆再杀」或「连续两张牌」）在有密钥时可出现与单步碎片化不同的合法组合（测试用 mock AI 脚本化 choice 序列锁定，不依赖真模型聪明）。  

**C 不做**：ReAct 自由工具、跨局记忆、自由自然语言动作。

### 12.2 更远期（非承诺）

- 形态 D：多轮 ReAct——仅当 C 稳定且费用可接受再评估。  
- 弃牌堆记牌、离散嫌疑事件流等纯信息增强——可随时插入 B/C，不改变总线形态。  

### 12.3 建议依赖顺序

```text
B0→B1→B2→B3→B4 →（建议 B5 L3）→ 【B 验收门】→ C 设计细化 + 实现 → C 验收门
```

若实现中发现 L3 过大：允许 **B 验收不含完整 L3**，但则 **C 不得宣称操作面完整**，且 C 的 `enumerateAllLegalOneStepActions` 只能枚举已接线子集——须在 progress-log 写明缺口。

---

## 13. 成功标准

### 13.1 Milestone B（一句话）

**有密钥时，AI 在「当前合法可操作列表」上做单步选择，并靠完整可见信息与武将说明理解局势；无密钥时与今日本地机器人一致；新武将不靠 bot 特判接入。**

### 13.2 Milestone C（一句话）

**在同一可操作窗口内，AI 可对合并后的合法一步动作表进行有预算的多步选择与执行，从而体现连续决策；仍不发明列表外动作，无密钥仍安全回退。**

### 13.3 全项目（用户原话对齐）

| 用户原话 | 对应里程碑 |
|----------|------------|
| 尽可能交给 AI，无 API 时算法 | B 起 |
| 系统级、完整参与决策流程 | B 骨架 + C 同窗 |
| 所有可操作内容、换将不适配 | B 的 L1+L2+L3；C 复用枚举 |
| 靠理解做最优 | 信息层 + 底模；C 提高「最优」的可达上限 |

---

## 14. 审阅检查清单（作者自检）

- [x] 无 TBD 占位（C 的窗口谓词/ maxSteps 数值留给 writing-plans 写死，规格层已定义机制）  
- [x] 与「候选 + index」及隐藏信息原则一致  
- [x] Milestone B / C 边界明确  
- [x] 无密钥与失败策略无歧义  
- [x] 明确反对按武将适配 AI  
- [x] 诚实写明 B 非智慧上限；升级路径为 C 而非 E  
- [x] 用户确认：先 B 后 C 

---

*本文件为设计规格，不含实现代码。批准后进入 implementation plan（writing-plans）。*
