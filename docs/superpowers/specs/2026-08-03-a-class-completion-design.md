# A 类补角批次设计（决策覆盖 + 信息层 + 机制）

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认（A8 做 (a) 机器人兜底完整性、批次划分 OK）；待审阅

**前置**：AI 总线 + 决策覆盖 + L1 泛化 + 摘要/记忆 + token 优化全部交付。本批次补 A 类剩余缺口（A1-A8，A9 ReAct 明确不做），分三批实现。

---

## 1. 目标与非目标

### 1.1 目标

| ID | 目标 |
|----|------|
| G1 | **A1 骁果路径 A**：乐进骁果接入 AI（候选=手牌基本牌 → `respondXiaoguo(true, idx)`），无密钥 fallback=不发动（与 EXCLUDE 时一致） |
| G2 | **A2 铁索连环双目标**：候选=单目标 + 双目标组合 → `playCard(铁索, [t1,t2])`（服务端已接受数组） |
| G3 | **A5 借刀响应侧**：`jiedaoChoice` 阶段接 AI（出杀/弃武器），无密钥 fallback=旧逻辑逐字 |
| G4 | **A4 恩怨选牌维度**：giveCard 后 AI 选具体红桃（`giveEnyuanCard(idx)`），无密钥 fallback=第一张红桃 |
| G5 | **A7 嫌疑事件流**：结构化"谁打了谁/谁救了谁"事件进 AI 视角 |
| G6 | **A3 方天画戟多目标**（先探索触发，能做则做） |
| G7 | **A6 多张仁德**：一次给牌后可继续（继续给哪张/停止） |
| G8 | **A8(a) 机器人侧兜底完整性**：扫描未覆盖阶段，确认每个都有 fallback/兜底不卡 |

### 1.2 非目标

- **A9 ReAct**：明确不做（强C 已落地，远期评估）。
- **A8(b) 整局响应超时托管**：用户确认本批不做——游戏机制级大功能（服务端 pending 时间戳 + 超时自动跳过），另行排期。
- 不引入新 AI 响应协议（仍 `{"choice":N}`）。
- 不新增按武将 id 分支。

---

## 2. 各项设计

### 2.1 A1 骁果路径 A

**现状**：`respondXiaoguo(activate, cardIdx)`（skills.js:1660）单步可提交；`xiaoguo`/`xiaoguoChoice` 在 `CONTROLS_CHOICE_EXCLUDE`（G2 加入，路径 B）。

**设计**：
- `BOT_DECISIONS.xiaoguo` 专用注册：match=`g.phase==='xiaoguo' && pending.type==='xiaoguo' && pending.asking===seat`；候选=手牌每张基本牌（`BASIC_CARDS.includes(name)`）→ `{cardIdx, label:'弃【牌名】发动'}` + 恒有「不发动」项；localFallback=不发动（`respondXiaoguo(false)`，与 EXCLUDE 时行为一致）；execute=`respondXiaoguo(choice.activate, choice.cardIdx)`。
- **从 EXCLUDE 移除 `'xiaoguo'`**（保留 `'xiaoguoChoice'`——那是被问方选装备/受伤，纯按钮 L1 可覆盖？核实：xiaoguoChoice 渲染装备槽按钮+受伤按钮，L1 泛化后可覆盖——若保留在 EXCLUDE 则也补专用注册或维持现状；**实现时按"L1 覆盖 xiaoguoChoice"验证，若按钮可收集则从 EXCLUDE 移除让它走 L1，否则补专用注册**）。
- `BOT_PHASE_ACTOR` 登记 `xiaoguo:'asking'`（若未登记）。
- **无密钥回归**：EXCLUDE 时行为=机器人不发动、`advanceXiaoguo` 推进——专用注册 fallback=不发动（`respondXiaoguo(false)`→`advanceXiaoguo`），行为逐字一致。

### 2.2 A2 铁索连环双目标

**现状**：真人 `lianhuanTargets`/`tiesuoTargets` 点 1-2 目标累积（render.js:1330-1347）；机器人单目标已进候选（`enumerateAllLegalOneStepActions` 对铁索展开单目标）。

**设计**：
- `enumerateAllLegalOneStepActions` 对 `action==='铁索连环'` 的候选**扩展为单目标 + 双目标组合**：每个合法目标单独一项 + 两两组合项（组合≤N 去重，如 ≤10 项防膨胀）。
- execute：单目标走 `playCard(idx, '铁索连环', targetSeat)`（现有）；双目标走 `playCard(idx, '铁索连环', [t1,t2])`（服务端 `startTieSuoTargets` 接受数组，game.js:2814 核实）。
- **无密钥零变化**：`localFallbackPlayWindow` 选最高分项——双目标项的 localHeuristicScore 计算照单目标（`botTargetScore` 对数组怎么处理？实现时给双目标项算 `max(target1,target2)` 或 `sum/2`，测试锁定与改动前一致——**最稳妥：双目标项分数=两目标分数之和，通常高于单目标，AI 选双目标合理**；无密钥 fallback 若选中双目标项，playCard 传数组即可）。
- 上限：组合数过多时只生成 Top-K（按目标分数排序）。

### 2.3 A5 借刀响应侧

**现状**：`respondJiedao(useSha, cardIdx)`（game.js:2949）；runBotDecision 旧分支 `canBotPlaySha(p) && findUsableAs(手牌,'杀')>=0` → `respondJiedao(bool)`（不传 cardIdx——实现时核实：旧分支 `botInvoke(seat,()=>respondJiedao(canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0))` 只传 1 参，respondJiedao 第 2 参可能可选）。

**设计**：
- `BOT_DECISIONS.jiedaoResponse` 专用注册：match=`g.phase==='jiedaoChoice' && pending.type==='jiedaoChoice' && pending.seatA===seat`；候选=出杀（有可转化杀时）/ 弃武器（恒有）；localFallback=旧逻辑逐字（`canBotPlaySha && 有杀`）；execute=`respondJiedao(choice.play, choice.cardIdx?)`（cardIdx 按服务端签名核实，旧分支不传则 AI 也不传或传第一张杀）。
- **从 EXCLUDE 移除 `'jiedaoChoice'`**（防 L1 抢——但 jiedaoChoice 是专用注册，EXCLUDE 保留也可以；**实现时确认**：专用注册分支在 runBotDecision 位置若先于 L1 则无需移除，若 L1 更早则保留 EXCLUDE 即可——两种都行，以"专用注册优先"为准，EXCLUDE 保留 jiedaoChoice 防止 L1 抢）。
- `BOT_PHASE_ACTOR` 已有 `jiedaoChoice:'seatA'`（核实）。

### 2.4 A4 恩怨选牌维度

**现状**：`enyuanOption` 已做 giveCard/loseHp 二元；`giveEnyuanCard(cardIndex)`（game.js:6795）选具体红桃，旧逻辑固定第一张红桃。

**设计**：
- 扩展 `BOT_DECISIONS.enyuanOption`：giveCard 选中后**再问一次选牌**——候选=每张红桃手牌 → `giveEnyuanCard(idx)`；无密钥 fallback=第一张红桃（旧逻辑）。
- 实现方式：新增 `BOT_DECISIONS.enyuanGiveCard`（match=`g.phase==='enyuanGiveCard' && pending.damagerSeat===seat`）——服务端在 chooseEnyuanOption('giveCard') 后进入 enyuanGiveCard 阶段（核实 game.js:6756-6810 流程）；候选=红桃手牌每张；localFallback=第一张红桃；execute=`giveEnyuanCard(idx)`。
- runBotDecision 接线：`enyuanGiveCard` 分支（现有旧分支 `findIndex(红桃)` 替换为 botDecide）。
- `BOT_PHASE_ACTOR` 已有 `enyuanGiveCard:'damagerSeat'`（核实）。

### 2.5 A7 嫌疑事件流

**现状**：`recordBotDamageEvidence/RescueEvidence`（bot.js:237/248）在 dealDamage/救援处调用，只聚合嫌疑分档；AI 只见 `suspicionHint` 文本。

**设计**：
- 新增 `g.aiSuspicionEvents`：`[{round, source, target, amount, kind:'damage'|'rescue'}]`，**最近 20 条**（循环覆盖），`normalize` 防御（`Array.isArray` 校验 + 逐条字段过滤，防脏数据）。
- 写入点：`recordBotDamageEvidence`/`recordBotRescueEvidence` 内 push（它们已在 dealDamage/救援路径被调用，是现成的唯一入口）；`kind` 区分 damage/rescue。
- `buildBotVisibleState` 投影 `recentSuspicionEvents: (g.aiSuspicionEvents||[]).slice(-10)`（公开信息——伤害/救援本来就在日志里）。
- **隐藏信息**：事件只含公开字段（谁打谁/谁救谁/数量），不涉及手牌。
- **normalize 注意**：新数组字段必须防御（CLAUDE.md 规则 6）；`recordBot*Evidence` 只在 `g.gameMode==='identity'` 写入（沿用现状）。

### 2.6 A3 方天画戟多目标（先探索）

**现状**：`fangtianMode`（render.js:1259-1264）真人选 ≤min(3,合法目标) 额外目标；触发条件=杀命中后？需探索。

**设计（探索后定）**：
- 实现时先 rg `fangtianMode`/`fangtianPicks` 触发链（render-controls.js 入口按钮 → 服务端哪个阶段）。
- 若触发是"出杀时可选额外目标"（服务端阶段），补专用注册/候选扩展；若复杂（杀结算中途），记录边界留后续。
- **探索结论优先**：以代码现实为准，能做则做，不能做记录为已知边界（不在本批硬做）。

### 2.7 A6 多张仁德

**现状**：`rendeTwoStep` 已做"目标+一张牌"；真人逐张给（render.js:1402-1410 每张手牌一个"仁德:交给此人"按钮）；`renDe(cardIdx, targetSeat)`（skills.js）逐张提交，`renDeCount` 计数（第 2 张后触发回复）。

**设计**：
- 扩展 `rendeTwoStep`：阶段B 选完一张牌提交后，**若 `renDeCount<2`（还有回复收益）且手牌还有牌**，AI 可继续——候选增加「继续给牌（下一张）」流程。
- 实现方式：复用 `botTwoStepA`——阶段B 提交后若继续，设 `botTwoStepA={decisionId:'rendeTwoStep', target, continue:true}`，下一调度阶段B 候选=剩余手牌每张 + 「停止给牌」；停止则 reset。
- **无密钥零变化**：fallback=旧逻辑（目标+第一张牌，给 1 张即停——与改动前一致）。
- **注意 renDeCount 回复收益**：AI 看到 `myFlags`/局面自己判断要不要给满 2 张。

### 2.8 A8(a) 机器人侧兜底完整性

**现状**：runBotDecision 末尾 `botSafePrompt` 兜底——渲染 controls 找 safe/mandatory 按钮点击，找不到则 warn 不动作（可能卡死：G3 发现 lirangRecover 就是正则盲区）。

**设计**：
- 扫描 runBotDecision 所有 phase（`BOT_PHASE_ACTOR` 全表 + botFallbackSeats 可达阶段），逐个确认：有专用注册 / L1 可覆盖 / botSafePrompt 能点安全按钮 / **或需要补 fallback**。
- 已知盲区：lirangRecover（G3 发现，safe/mandatory 正则都命中不了）——已由 L1 泛化覆盖（有密钥时 AI 接管）；**无密钥时仍盲区**（warn 不动作）。补：`botSafePrompt` 的正则扩展或该阶段专用 fallback。
- **产出**：盲区清单 + 修复（每处小补丁，模式化）。

---

## 3. 批次划分（用户已确认）

- **A-批1（决策覆盖）**：A1 骁果 / A2 铁索双目标 / A5 借刀响应 / A4 恩怨选牌
- **A-批2（信息层）**：A7 嫌疑事件流 / A3 方天画戟（先探索）
- **A-批3（机制）**：A6 多张仁德 / A8(a) 机器人兜底完整性

## 4. 测试矩阵（各批扩展对应套件）

| 批 | 测试 |
|----|------|
| A-批1 | l3：骁果候选=基本牌/fallback 不发动/从 EXCLUDE 移除断言；铁索双目标候选/playCard 传数组/无密钥零变化；借刀响应候选/fallback 旧逻辑；恩怨选牌候选/fallback 第一张红桃 |
| A-批2 | info 或新套件：aiSuspicionEvents normalize 防御/投影最近 10 条/隐藏信息；方天画戟探索结论 |
| A-批3 | l3：仁德继续给/停止/无密钥 1 张即停；l1 或新：盲区清单修复断言 |

## 5. 明确不做

- A9 ReAct、A8(b) 整局超时（另行排期）。
- 不引入新协议、不新增按武将 id 分支。

## 6. 验收标准

1. A-批1：四项决策 AI 可达，无密钥 fallback 逐字（测试锁定）。
2. A-批2：嫌疑事件流进 AI 视角（normalize 防御 + 隐藏信息安全）；方天画戟探索结论记录。
3. A-批3：仁德多张 + 机器人兜底盲区修复（lirangRecover 无密钥不再 warn 卡死）。
4. `?v=` 同步；progress-log-8 追加；无新增按武将 id 分支。

---

## 7. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 各项沿用既有模式（专用注册/botTwoStepA/L1），不发明新机制
- [x] 无密钥回归红线逐字（各项 fallback 明确定义）
- [x] A8 范围确认（a 机器人兜底，b 另行排期）
- [x] 用户已确认：A8(a) + 批次划分 OK
