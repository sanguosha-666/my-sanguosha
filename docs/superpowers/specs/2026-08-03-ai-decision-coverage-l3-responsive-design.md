# AI 决策覆盖扩展：L3 座位卡 + 高价值响应（第一批）设计

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认 §1（架构延伸）+ §2（详细设计）；待审阅

**前置**：AI 可操作面决策总线（`docs/superpowers/specs/2026-08-03-ai-operable-surface-bus-design.md`，B+C 已完成）——本设计是它的**第一批扩展**，完全复用其总线骨架（`BOT_DECISIONS`/`botDecide`/`callAiChooseIndex`/`botInvoke`/`buildBotVisibleState` 等），不新建机制。

---

## 1. 目标与非目标

### 1.1 目标

| ID | 目标 |
|----|------|
| G1 | **L3 座位卡交互接入 AI**：15 处"点座位卡"类技能（见 §3），AI 可在合法候选内选择，不再只能由真人操作。 |
| G2 | **高价值响应接入 AI**：濒死求桃、决斗出杀、南蛮/万箭响应、五谷挑牌、选将（含主公选将）共 5 类，AI 决策。 |
| G3 | **观星接入 AI**：有限排列候选（方案 A，用户已确认），不引入第二种 AI 响应协议。 |
| G4 | 化身/巧变移动/恩怨等剩余响应类接入 AI（§2.5 清单）。 |
| G5 | **无密钥回归红线**：所有新注册项的 `localFallback` 与改动前本地行为**逐字一致**（测试锁定）。 |
| G6 | **隐藏信息红线**：座位候选只含公开合法性（存活/距离/装备区/判定区），不投影他人手牌内容。 |

### 1.2 非目标（本批不做）

- **强 C（同 tick 多步）**：第二批，需动 `game.js` 的 `tx` 加提交回调（已向用户说明，用户确认本批不动 game.js 时一并延后）。
- 信息层增强（跨回合记忆/弃牌堆投影/距离解释/desc 去截断/嫌疑事件流）：第三批。
- 借刀杀人的 A/B 两阶段属于**本批**（见 §3.2 多步 L3），但借刀**响应**（`jiedaoChoice`，被问"出杀还是弃武器"）留在旧本地分支——它已是二元判断且现有 `canBotPlaySha` 逻辑正确，不属"扩大覆盖"缺口，本批不迁（记录于 §9 边界）。
- 不修改真人 UI 交互路径（render.js/render-controls.js 的 onclick 不动）；座位候选生成是独立的新代码，与真人点击同源但独立实现。
- 不引入第二种 AI 响应协议：全部保持 `{"choice":N}`（观星用有限排列方案候选）。

---

## 2. 总架构

```text
runBotDecision
├── 既有 6 处 botDecide 接线（B 阶段）
├── 新增:botDecide('seatPick')           ← L3 通用座位协议
├── 新增:botDecide('multiStepL3')        ← 借刀/离间/丈八/仁德 两阶段
├── 新增:botDecide('dying')/'duel'/'aoeResp'/'wugu'/'pickGeneral'  ← 高价值响应
├── 新增:botDecide('guanxing')           ← 有限排列候选
├── 新增:botDecide('huashenSkill')/'huashenChange'/'qiaobianMove'/'enyuanOption'  ← 剩余响应
└── 既有遗留分支（未迁移部分原样）
```

**统一入口不变**：`botDecide(decisionId, g, seat)`；候选规范化、AI 询问、越界回退、`callAiChooseIndex` 全部复用。

---

## 3. L3 座位卡交互（15 处）

### 3.1 通用 seatPick 协议（11 处简单单选）

**新增模块**：`BOT_SEAT_PICKS`（按技能注册的座位候选源表）+ `BOT_DECISIONS.seatPick`（通用入口）。

```js
BOT_SEAT_PICKS[skillKey] = {
  match(g, seat),                 // 该技能当前可发动的判定（读 mode 标志/阶段/手牌，照抄 render.js 触发条件）
  buildSeatCandidates(g, seat),   // -> [{seat, label}] 合法座位（照抄 render.js 对应分支的合法性判断）
  fallbackSeat(g, seat),          // 旧行为（本地硬编码/启发式，逐字保留）
  execute(g, seat, targetSeat),   // botInvoke 内调服务端函数（duanLiang(idx,i) 等）
}
```

`BOT_DECISIONS.seatPick = { match, buildCandidates(合并全部命中 BOT_SEAT_PICKS 的候选), localFallback, execute }`——同一时刻只有一个技能处于"可发动"态（各 mode 互斥），候选合并天然不冲突；若两个技能同时可发动（如武圣+双雄同时可用），**候选合并列出**，AI 一次选"哪个技能打向哪个座位"（label 前缀技能名），execute 按候选记录的 skillKey 分派。

**11 个简单单选技能**（合法性判断源：render.js 行号，实现时逐条核对）：

| # | 技能 | 服务端函数 | 候选合法性（照抄源） |
|---|------|-----------|---------------------|
| 1 | 挑衅 | `respondTiaoxin(i)` | 存活；render.js ~1257 分支条件 |
| 2 | 断粮 | `duanLiang(idx, i)` | 存活；render.js ~1295 分支条件（黑色基本/装备当兵粮） |
| 3 | 奇袭 | `qiXi(idx, i)` | 存活；render.js ~1308 分支条件（黑色牌当拆） |
| 4 | 国色 | `guoSe(idx, i)` | 存活；render.js ~1322 分支条件 |
| 5 | 武圣 | `playCard(idx,'杀',i)` | 存活 + `canReachSha(g, seat, i)`（距离） |
| 6 | 双雄 | `playCard(idx,'决斗',i)` | 存活；render.js ~1425 分支条件 |
| 7 | 蛊惑目标 | `guhuoChooseTarget(i)` | 存活；render.js ~1227 分支条件 |
| 8 | 青囊 | `qingNang(idx, i)` | 存活；render.js ~1391 分支条件 |
| 9 | 驱虎伤害 | `respondQuhuDamage(i)` | 存活；render.js ~1355 分支条件 |
| 10 | 反间 | `fanJian(i)` | 存活；render.js ~1383 分支条件 |
| 11 | 旋风目标 | `pickXuanfengTarget(i)` | 存活；render.js ~1508 分支条件 |

**候选 label**：`技能名→目标名`（如「国色→关羽」）。**隐藏信息**：不投影他人手牌。

**fallback（旧行为逐字）**：各技能改动前的本地处理（大部分是"固定第一个合法目标"或"不发动"——实现时逐个核实现有 `runBotDecision` 分支；对**从未被机器人触发过**的技能（如国色/断粮/青囊，机器人此前从不出这些），fallback 定义为「不发动」（与改动前一致：机器人从不主动使用这些技能，行为不变）。

### 3.2 多步 L3（4 处，两阶段专用注册）

沿用项目既有"客户端累积选择、最后一次性原子提交"模式（张郃巧变先例）：

| # | 技能 | 阶段 1 | 阶段 2 | 提交 |
|---|------|--------|--------|------|
| 12 | 借刀杀人 | A=持有武器的存活角色 | B=在 A 攻击范围内且 ≠A 的存活角色 | 借刀专属流程（服务端问 A 出杀/弃武器） |
| 13 | 离间 | from=需出杀的来源（非自己？照抄 render.js 1363 分支） | to=与 from 不同的存活角色 | `liJian(idx, from, to)` |
| 14 | 丈八蛇矛 | 第一张手牌 | 第二张手牌（≠第一张） | `playZhangbaSha(a, b, target)` 再选目标（第三阶段选目标座位） |
| 15 | 仁德 | 目标座位 | 交给的手牌（每张一项） | `renDe(idx, targetSeat)` |

**两阶段实现**：客户端本地状态（仿 `jiedaoSeatA` 模式，不入 Firebase）：阶段 1 AI 选定后存 `pendingStepA`，下一调度阶段 2 候选基于 A 生成；全部选完才提交服务端函数。**无密钥**：阶段 1/2 各自走 fallback（借刀 A=第一个合法武器持有者、B=第一个合法者；离间固定最小合法组合；丈八默认前两张手牌+第一个合法目标；仁德默认第一个合法目标+第一张手牌——全部与"改动前机器人行为"对齐，改动前这些技能机器人同样不主动使用，fallback 取"最保守合法默认"并测试锁定）。

**丈八第三阶段（选目标）**：`playZhangbaSha(a, b, i)` 的 i 是目标座位——候选为存活+距离合法者；选完三阶段才提交。

---

## 4. 高价值响应（5 类）

| 决策 | 候选 | fallback（=旧逻辑逐字） |
|------|------|------------------------|
| `dying` 濒死求桃 | 出桃/不出（`findUsableAs(手牌,'桃')` 无桃时只有"不出"单候选） | `botCanSave(g,seat,d.seat) && canBotUseTaoForDying(g,seat,d.seat) && findUsableAs(手牌,'桃')>=0`（旧分支 1552 行附近逐字） |
| `duel` 决斗响应 | 出杀/不出（`canBotPlaySha` 且可转化杀时才有"出杀"候选） | `canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0`（旧分支逐字） |
| `aoeResp` 群体响应 | 出牌/不出（need='杀'/'闪' 各自找可转化牌） | `(d.need==='杀'?canBotPlaySha(p):true) && findUsableAs(p.hand,p,d.need)>=0`（旧分支逐字） |
| `wugu` 五谷挑牌 | 牌池 `pool` 每张一项（label 含牌名） | `pool[0]`（旧分支 `wuguPick(0,d.idx||0,pool[0].id)` 逐字） |
| `pickGeneral` 选将 | `p.generalChoices` 每项一个武将（label 含武将名+技能名+简短 desc） | 旧 `botPickGeneral` 打分（`generalMaxHp*12 + 关键词加分`）逐字 |

**主公选将**（`pickingLordGeneral`）：同 `pickGeneral`，候选=5 选 1（主公池），fallback 同样走 `botPickGeneral(g,seat,true)`。

**extraState**：dying 给濒死者公开信息（名字/hp/knownRole/是否自己）；duel/aoeResp 给攻击者公开信息；wugu 给 pool 全量（公开，五谷亮出的牌本就公开）。

---

## 5. 观星（方案 A：有限排列候选）

- `buildGuanxingCandidates(g, seat)`：恒包含**默认方案**（旧行为：前 N 张全置顶、原序，`respondGuanxing(all.map((_,i)=>i), [])` 之类——实现时照抄旧分支 1202 行附近）+ 按 `botCardPriority` 价值降序的置顶方案 + 最多 6 个变体（相邻置换），≤8 个完整方案。
- 每项 label：`方案N:顶[牌1,牌2] 底[牌3,...]`。
- AI 选 index → `respondGuanxing(topOrder, bottomOrder)`（候选记录的数组）。
- fallback = 默认方案（旧逻辑逐字）。
- **候选生成规则**：`topOrder`+`bottomOrder` 必须恰好覆盖全部观星牌、无重复、无遗漏（生成器保证；AI 只能选整体方案，无法拼出非法组合）。

---

## 6. 剩余响应类（化身/巧变/恩怨）

| 决策 | 候选 | fallback（=旧逻辑逐字） |
|------|------|------------------------|
| `huashenSkill` 化身选技能 | `huashenPool` 里 `HUASHEN_SKILL_TABLE[id]` 非空的将（label 含技能名） | 第一个可用（旧分支逐字：`(HUASHEN_SKILL_TABLE[id]||[])[0]`） |
| `huashenChangeStart` / `huashenChangeEnd` | 更改/不更改 | 不更改（旧分支逐字） |
| `qiaobianMove` 巧变移动 | 「不移动」+ 常见移动组合（来源装备槽→目标角色，≤8 个；简化：仅源槽=自己/他人装备区+目标=任意角色，去重） | 不移动（旧分支逐字） |
| `enyuanOption` 恩怨选项 | 给红桃牌/掉血 | 有红桃给牌否则掉血（旧分支逐字） |

**恩怨选牌维度**：`enyuanGiveCard`（选哪张红桃）保持旧逻辑（第一张红桃）——选牌维度不是本批范围，记录于 §9。

---

## 7. 无密钥回归与隐藏信息

- 每个新注册项 `localFallback` = 旧分支逻辑**逐字**（实现时直接对照 `runBotDecision` 现有分支代码，不允许"重新实现一遍语义"）。
- 座位候选只含公开合法性；dying/wugu 的 extraState 只含公开字段。
- 测试：每个决策点至少 1 条"无密钥 → 行为与旧逻辑一致"断言 + 1 条"有密钥 mock 选非默认 → 服务端函数收到 AI 选择"断言。

---

## 8. 测试矩阵（新增 run_ai_bus_l3_test.js + 扩展既有）

| 层 | 用例要点 |
|----|----------|
| seatPick | 11 技能各至少 1 条：候选合法（照抄条件）、fallback 行为、有密钥 mock 选目标→execute 收到目标座位、隐藏信息（userPrompt 无他人手牌名） |
| 多步 L3 | 借刀/离间/丈八/仁德各：两阶段候选依赖正确、全部选完才提交、任一阶段 fallback 走旧默认 |
| dying/duel/aoeResp | 出/不出双态、无桃/无杀/将驰禁杀时单候选短路、fallback=旧条件逐字 |
| wugu | 池子每张一个候选、选非第一张生效、fallback=pool[0] |
| 选将 | 候选=choices 每项、mock 选第 N 个→respondPickGeneral 收到、fallback=旧打分 |
| 观星 | 默认方案恒在、方案覆盖全部牌无重复、mock 选变体→respondGuanxing 收到对应数组、fallback=默认 |
| 化身/巧变/恩怨 | 候选形状、fallback 逐字 |
| 回归 | 既有 `run_ai_bus_*` 5 套 + `run_ai_model_picker_test.js` 全绿；仓库 6 套 `run_*_test.js` 零新失败；`node --check` |

---

## 9. 明确不做（本批边界）

- 强 C、信息层增强（跨回合记忆/弃牌堆/距离解释/desc 去截断/嫌疑事件流）——第二/三批。
- `jiedaoChoice`（借刀**响应**：出杀还是弃武器）——二元判断已有正确本地逻辑（`canBotPlaySha`），不属覆盖缺口，留在旧分支。
- `enyuanGiveCard` 选牌维度——保持第一张红桃。
- 丈八/离间/仁德的"选牌"维度若与目标选择耦合过深（如仁德可给多张牌），第一批只做"给 1 张"（照抄 render.js 现有交互，真人也是逐张给），多张批量留后续。
- 不引入第二种 AI 响应协议。

---

## 10. 验收标准

1. 填密钥：上述 24 处（11 seatPick + 4 多步 + 5 响应 + 观星 + 3 剩余）机器人决策可被 AI 选择，mock 验证能产生与本地默认不同的合法结果。
2. 无密钥：行为与改动前逐字一致（测试锁定）。
3. 隐藏信息：所有 userPrompt 不含他人手牌名（测试断言）。
4. `?v=` 同步 +1；progress-log 记录。
5. 无新增按武将 id 的 AI 策略分支（rg 自检）。

---

## 11. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 与"候选+index"铁律及隐藏信息原则一致
- [x] 无密钥回归红线逐字保证
- [x] 本批/后续批边界明确（强C/信息层/借刀响应/恩怨选牌/多张仁德）
- [x] 用户已确认：第一批全量（15 L3 + 5 响应 + 观星 + 3 剩余）、观星方案 A、强C 延后
