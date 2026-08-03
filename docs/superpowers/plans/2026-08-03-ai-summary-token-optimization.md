# AI 自维护摘要 + Token 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①AI 自维护回合摘要（跨回合记忆：回合变化时 AI 自己总结，每次决策注入）；②清除 AI 记忆按钮 + 移除刷新警告；③token 优化（删 discardPile、recentLog 20→15、候选 Top-K=25）。

**Architecture:** 三块都叠加在现有决策总线上：①`aiSummary` 模块级状态 + `scheduleBotTurn` 回合变化检测 + `updateAiSummary` 异步总结调用（复用 callAI，三家 adapter 零改动）+ `callAiChooseIndex` 注入摘要到 systemPrompt；②`showAiKeyModal` 按钮区加清除按钮、删 `setupRefreshWarning` 死代码；③`buildBotVisibleState` 删 discardPile/recentLog 缩 15、`enumerateAllLegalOneStepActions` 按分排序截断 Top-25（结束项恒在）。

**Tech Stack:** 纯静态多文件 JS（无构建）；vm 沙箱测试（`run_ai_summary_test.js` 新建 + `run_ai_bus_info_test.js`/`run_ai_bus_c_window_test.js` 更新）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-ai-summary-design.md`（含 §4.5 清除按钮+移除警告、§4.6 token 优化）

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送（push 走 https 路径：`git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev`——SSH 443 当前不通）
- **摘要**：回合变化才触发（roundNum/turn 与上次不同且座位匹配）；首回合无摘要不触发；异步 fire-and-forget 不阻塞决策；失败沿用旧摘要；≤200 字（硬上限 500）
- **生命周期**：`aiSummarySeat` 座位绑定（变化清空）；`phase==='over'` 清空（scheduleBotTurn 早退前）；清除按钮主动清空
- **注入**：`callAiChooseIndex` 的 systemPrompt 追加"本局记忆摘要"段（有摘要且座位匹配时）
- **清除按钮**：showAiKeyModal 按钮区 ghost 按钮「清除AI记忆」；只清记忆（密钥/模型/aiPromptDismissed 配置不清）；点击后弹窗不关闭、就地提示
- **移除刷新警告**：删 `setupRefreshWarning` 函数+调用+`window.aiConversations` 引用（全项目仅一处）
- **token 优化**：删 `discardPile`；`recentLog` slice(-15)；候选按 `localHeuristicScore` 降序截断 Top-25 + 结束项恒在
- **无密钥零变化**：`localFallbackPlayWindow` Top-1 恒在（Top-K 截断不影响）；摘要不参与无密钥路径
- **隐藏信息**：摘要输入 = buildBotVisibleState 输出（该座位视角）；回放给同一座位（aiSummarySeat 校验）
- **`?v=`**：改动 bot.js/ai-bot.js 时全部 13 处同步 +1（当前基线 282）
- **测试**：vm 加载真实源码；`let` 变量用 `vm.runInContext('x=...')`；函数声明可替换 spy
- **收尾**：progress-log-8.md 追加（最新分段）
- **执行顺序**：S1→S2→T1→T2→S3，各自独立 commit

---

## File map

| File | Responsibility |
|------|----------------|
| `bot.js` | `aiSummary` 状态、`updateAiSummary`、scheduleBotTurn 检测/清空、`callAiChooseIndex` 注入、token 优化（buildBotVisibleState/enumerateAllLegalOneStepActions） |
| `ai-bot.js` | 清除按钮（showAiKeyModal）、删 setupRefreshWarning |
| `run_ai_summary_test.js` | 新建：摘要测试矩阵（§3） |
| `run_ai_bus_info_test.js` | token 优化断言更新（删 discardPile/recentLog 15） |
| `run_ai_bus_c_window_test.js` | Top-K 截断断言 |
| `index.html` | `?v=` 同步（282→283→284…） |
| `docs/progress-log-8.md` | S3 追加交付记录 |

---

### Task S1: AI 摘要状态 + 总结调用 + 注入

**Files:**
- Modify: `bot.js` — 模块级状态、`updateAiSummary`、`callAiChooseIndex` 注入
- Create: `run_ai_summary_test.js`（harness 复制 run_ai_bus_core_test.js 结构：加载 ai-bot.js+bot.js，mock callAI）

**Interfaces:**
- Produces: `aiSummary`/`aiSummarySeat`/`aiSummaryRound`/`aiSummaryTurn`、`aiSummaryReset()`、`updateAiSummary(g,seat)`（async）、`buildSummaryPrompt(g,seat)`、`callAiChooseIndex` 的摘要注入段
- Consumes: `callAI`（ai-bot.js，零改动）、`buildBotVisibleState`、`aiApiKey`/`aiProvider`/`aiApiModel`

- [ ] **Step 1: 写失败测试**

`run_ai_summary_test.js`（harness：vm 加载 ai-bot.js + bot.js，mock `callAI` 记录收到的 opts；`aiApiKey`/`aiProvider` 用 runInContext 裸赋值）：
1. 首回合：`aiSummary===''`；`callAiChooseIndex` 的 systemPrompt **不含**"本局记忆摘要"段
2. `updateAiSummary(g,0)` 直接调用 → mock `callAI` 被调 1 次、收到总结 prompt（含"摘要"字样）；mock 返回 `{ok:true,text:'反贼倾向明显,我留着桃'}` → `aiSummary==='反贼倾向明显,我留着桃'`
3. 摘要注入：摘要非空后 `callAiChooseIndex` → mock 收到的 systemPrompt **含**摘要文本
4. 失败沿用：mock 返回 `{ok:false}` → `aiSummary` 不变
5. 迭代更新：第二次 `updateAiSummary` → mock 收到的 userPrompt 含"旧摘要"（第一次的输出）
6. 座位变化：seat 1 摘要后 `aiSummarySeat!==seat2`（调用 `callAiChooseIndex({seat:1})` 后改 seat 2 → 内部 reset）——断言 `aiSummary===''`
7. 上限：mock 返回超长文本（600 字）→ `aiSummary` 长度 ≤500
8. 不阻塞：`updateAiSummary` 调用后立即返回（不 await 卡住；断言调用是 fire-and-forget——用同步断言调用后 aiSummary 仍可能为空，因为异步未完成；改为断言函数返回 undefined 且不抛错）

- [ ] **Step 2: 跑测试确认失败**（`aiSummary`/`updateAiSummary` 未定义）

```bash
source ~/.nvm/nvm.sh 2>/dev/null; node run_ai_summary_test.js
```

- [ ] **Step 3: 实现 bot.js**

照 spec §2.1/§2.3/§2.4 逐字（模块级状态、`aiSummaryReset`、`updateAiSummary`、`buildSummaryPrompt`、`callAiChooseIndex` 注入段 `const summaryNote = ...`）。**注意**：`aiSummaryReset` 的座位清空逻辑在 `callAiChooseIndex` 里（`if(aiSummarySeat!==opts.seat) aiSummaryReset(); aiSummarySeat=opts.seat;`——每次决策都校验座位）。

- [ ] **Step 4: 跑测试确认通过** + 回归（core 7/l2 23/l3 93 等既有套件——摘要注入段在无摘要时不改变 systemPrompt，零影响）

- [ ] **Step 5: `?v=282→283` + Commit**

```bash
git add bot.js run_ai_summary_test.js index.html
git commit -m "feat(bot): AI自维护回合摘要+决策注入"
git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task S2: 回合检测 + 清除按钮 + 移除刷新警告

**Files:**
- Modify: `bot.js` — `scheduleBotTurn` 检测/清空
- Modify: `ai-bot.js` — showAiKeyModal 清除按钮、删 setupRefreshWarning
- Extend: `run_ai_summary_test.js`

**Interfaces:**
- Consumes: `aiSummaryReset`/`aiSummaryRound`/`aiSummaryTurn`（S1）
- Produces: `scheduleBotTurn` 回合检测逻辑、`#aiMemoryClearBtn` 按钮

- [ ] **Step 1: 写失败测试**

1. `scheduleBotTurn`（构造 isBotController 为真的 g，回合号变化）→ `updateAiSummary` 被调用（spy）；回合号不变 → 不调用；首回合（aiSummary 空）→ 不调用
2. `phase==='over'` → `aiSummary===''`（清空）
3. 弹窗含 `aiMemoryClearBtn`（结构性断言：驱动 showAiKeyModal 或 rg 断言——参考 test_ai_key_modal.js 的驱动方式，vm 中驱动 showAiKeyModal 需要 document stub；简单做法：加载 ai-bot.js + 假 DOM，调用 showAiKeyModal，查询 btnRow 内按钮 id）
4. 点击清除按钮 → `aiSummary===''` 且 `aiSummarySeat===null`；`aiApiKey`/`aiApiModel` 不受影响；弹窗不关闭（`#aiKeyModal` 仍可见）；就地提示出现
5. `rg "setupRefreshWarning" ai-bot.js` → 无输出

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

**scheduleBotTurn**（bot.js，`phase==='over'` 早退处）：

```js
function scheduleBotTurn(g){
  if(!g || !isBotController(g)) return;
  // 【AI摘要】游戏结束清空记忆;回合变化(roundNum/turn)且已有摘要时,异步更新记忆
  // (fire-and-forget,不阻塞决策;更新完成后的下一轮决策才带上新摘要)
  if(g.phase==='over'){ aiSummaryReset(); return; }
  const seat = botSeatForState(g);
  if(aiSummarySeat !== seat) aiSummaryReset();
  if(seat >= 0){
    aiSummarySeat = seat;
    if(aiSummary && (aiSummaryRound !== g.roundNum || aiSummaryTurn !== g.turn)){
      aiSummaryRound = g.roundNum; aiSummaryTurn = g.turn;
      updateAiSummary(g, seat);
    }
  }
  if(botDecisionInFlight){ ... 既有逻辑不变 ... }
  ...
}
```

**注意**：`botSeatForState` 在 over 早退之后调用（现状早退在 isBotController 后立即 return——需要调整顺序：先 isBotController → over 清空 return → seat 计算 → 摘要检测 → 原逻辑）。**实现时以现有 scheduleBotTurn 结构为准，插入摘要逻辑并保持既有过滤链行为不变（回归锁定）**。

**ai-bot.js 清除按钮**（showAiKeyModal 内 btnRow，照 spec §4.5-B 逐字）+ **删 setupRefreshWarning**（函数+调用+`window.aiConversations` 引用）。

- [ ] **Step 5: 回归 + `?v=283→284` + Commit**

```bash
node run_ai_summary_test.js && node run_ai_bus_core_test.js && node run_ai_bus_c_window_test.js && node --check bot.js && node --check ai-bot.js
git add bot.js ai-bot.js run_ai_summary_test.js index.html
git commit -m "feat: AI摘要回合检测+清除按钮+移除刷新警告"
git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task T1: token 优化 — 删 discardPile + recentLog 15

**Files:**
- Modify: `bot.js` — `buildBotVisibleState`
- Modify: `run_ai_bus_info_test.js`

**Interfaces:**
- Consumes: 无
- Produces: `buildBotVisibleState` 无 `discardPile` 字段、`recentLog` slice(-15)

- [ ] **Step 1: 写失败测试（更新既有断言）**

`run_ai_bus_info_test.js`：
1. 删除 discardPile 相关断言（`hasDiscardPile`/count/byName 检查）
2. recentLog 断言从"30 条→20"改为"30 条→15"（长度 15 且末项对齐日志30）
3. 新增：`buildBotVisibleState` 输出**不含** `discardPile` 键（`JSON.stringify(state).includes('discardPile')===false`）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// buildBotVisibleState 移除 discardPile 块;recentLog:
recentLog: (g.log||[]).slice(-15).map(e => (e && typeof e==='object') ? e.text : String(e==null?'':e)),
```

- [ ] **Step 5: 回归 + `?v=284→285` + Commit**

```bash
node run_ai_bus_info_test.js && node run_ai_bus_core_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node run_ai_bus_c_window_test.js && node --check bot.js
git add bot.js run_ai_bus_info_test.js index.html
git commit -m "feat(bot): token优化 删discardPile+recentLog 15条"
git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task T2: token 优化 — 候选 Top-K=25

**Files:**
- Modify: `bot.js` — `enumerateAllLegalOneStepActions`
- Modify: `run_ai_bus_c_window_test.js`

**Interfaces:**
- Consumes: `localHeuristicScore`（候选已有字段）
- Produces: 截断后的候选列表（≤26 项：25+结束项，结束项恒在）

- [ ] **Step 1: 写失败测试**

`run_ai_bus_c_window_test.js` 追加：
1. 构造 30+ 原始候选的场景（多手牌 × 多目标：如 6 张需目标牌 × 5 存活目标）→ `enumerateAllLegalOneStepActions` 返回 ≤26 条且最后一条 `isEndPlay===true`
2. Top-1 恒在：原始最高 localHeuristicScore 的候选在截断结果里（按 action+target 找）
3. 无密钥回归：`localFallbackPlayWindow` 在截断列表上选出的与未截断一致（构造明确最高分项，断言 fallback 选它）——可复用既有 fallback 断言或新增
4. 少候选场景（<26）不截断（全部保留+结束项）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// enumerateAllLegalOneStepActions 末尾,结束项 push 之前:
const AI_PLAY_CANDIDATE_LIMIT = 25;
// 按 localHeuristicScore 降序截断:保留最高分前 25 条(结束项恒在末尾,不参与截断)
out.sort(function(a,b){ return ((b.localHeuristicScore||0) - (a.localHeuristicScore||0)); });
if(out.length > AI_PLAY_CANDIDATE_LIMIT) out.length = AI_PLAY_CANDIDATE_LIMIT;
```

**注意**：结束项在截断**之后**再 push（保证恒在末尾）。**无密钥零变化论证**：`localFallbackPlayWindow` 取 `candidates` 里最高 `localHeuristicScore` 的非结束项——截断后 Top-1（最高分）恒在，fallback 选择不变（测试锁定）。

- [ ] **Step 5: 回归 + `?v=285→286` + Commit**

```bash
node run_ai_bus_c_window_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node --check bot.js
git add bot.js run_ai_bus_c_window_test.js index.html
git commit -m "feat(bot): token优化 出牌候选Top-K=25截断"
git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task S3: 验收门 + progress-log-8 追加

**Files:**
- Modify: `docs/progress-log-8.md`（追加）
- 无代码改动预期（除非回归）

- [ ] **Step 1: 全量回归**

```bash
source ~/.nvm/nvm.sh 2>/dev/null
node run_ai_summary_test.js && node run_ai_bus_core_test.js && node run_ai_bus_info_test.js
node run_ai_bus_l1_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_c_window_test.js
node run_ai_bus_l3_test.js && node run_ai_bus_model_picker_test.js && node --check bot.js && node --check ai-bot.js
```

- [ ] **Step 2: 验收门核对**

- [ ] 摘要：回合变化触发（scheduleBotTurn）、首回合不触发、失败沿用、迭代更新、座位清空、over 清空、≤500 上限（S1/S2 测试）
- [ ] 注入：有摘要时 systemPrompt 含摘要段；无摘要时不含（零影响既有）
- [ ] 清除按钮：点击清空记忆、配置不清、弹窗不关闭、就地提示
- [ ] 刷新警告：`rg "setupRefreshWarning" ai-bot.js` 无输出
- [ ] token 优化：无 discardPile、recentLog 15、候选 ≤26 且结束项恒在、无密钥 fallback 不变
- [ ] `?v=286` 已 push；progress-log-8 已追加
- [ ] 0 处按武将 id 分支

- [ ] **Step 3: progress-log-8 追加**

内容：AI 摘要（自维护/回合触发/迭代/注入/生命周期）、清除按钮+移除刷新警告、token 优化（删 discardPile/recentLog 15/Top-K 25 及无密钥零变化论证）、测试计数、`?v=286`。

```bash
git add docs/progress-log-8.md
git commit -m "docs: AI摘要+token优化批次交付记录"
git push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| §2.1 数据结构 | S1 |
| §2.2 回合触发 | S2 |
| §2.3 总结调用 | S1 |
| §2.4 注入 | S1 |
| §2.5 隐藏信息 | S1/S2（座位校验） |
| §3 测试矩阵 | S1/S2 |
| §4.5-A 移除刷新警告 | S2 |
| §4.5-B 清除按钮 | S2 |
| §4.6 token 优化（discardPile/recentLog/Top-K） | T1/T2 |

## Placeholder 扫描

- S2 scheduleBotTurn 插入位置：给了明确规则（先 isBotController → over 清空 → seat 计算 → 摘要检测 → 原逻辑），实现时按现有结构插入并回归锁定
- 所有代码块为完整实现，无开放式 TODO

## 建议提交节奏

每 Task 一次 commit + push（https 路径）；S3 验收门最后执行。
