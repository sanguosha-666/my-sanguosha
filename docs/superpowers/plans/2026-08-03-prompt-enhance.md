# 提示词增强 Implementation Plan（P1-P4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 4 项提示词引导：G1 通用策略入默认 system、G2 响应类身份引导、G3 localHeuristicScore 语义、G5 决策思考链。（G4 记牌感知已取消）

**Architecture:** 纯文本 prompt 增强，零逻辑改动：G1/G3 在 bot-ai-bus.js 默认 prompt；G2/G5 在 bot.js 各注册项 buildSystemPrompt。无密钥路径不涉及。

**Tech Stack:** 纯静态多文件 JS；vm 沙箱测试（run_ai_bus_core_test.js/info/l3）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-prompt-enhance-design.md`

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送（push 走 https 覆盖：`git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev`）
- **无密钥零变化**：提示词只影响有密钥 AI 决策，不触碰本地路径（回归锁定）
- **不引入第二种 AI 响应协议**：仍 `{"choice":N}`
- **token 增量可控**：G1 ~20、G2 身份局响应时 ~40、G3 条件 ~10、G5 ~10/决策
- **`?v=`**：改动带 `?v=` 脚本时全部 14 处同步 +1（当前基线 304）
- **测试**：vm 加载真实源码；断言 prompt 字符串内容
- **收尾**：progress-log-8 追加
- **执行顺序**：P1→P2→P3→P4（原 P2 记牌已取消），各自独立 commit

---

## File map

| File | Responsibility |
|------|----------------|
| `bot-ai-bus.js` | G1 默认 system 通用策略、G3 userPrompt score 语义 |
| `bot.js` | G5 注册项思考链、G2 响应类身份引导 |
| `run_ai_bus_core_test.js` | P1 测试（默认 prompt 断言） |
| `run_ai_bus_l3_test.js` | P3/P5 测试（响应类身份引导/思考链） |
| `index.html` | `?v=` 同步 |

---

### Task P1: G1 通用策略 + G3 score 语义（bot-ai-bus.js）

**Files:**
- Modify: `bot-ai-bus.js` — `buildBotDefaultSystemPrompt`、`buildBotDefaultUserPrompt`
- Modify: `run_ai_bus_core_test.js`

**Interfaces:**
- Produces: 增强后的默认 system/user prompt
- Consumes: 无

- [ ] **Step 1: 写失败测试**

`run_ai_bus_core_test.js` 追加：
1. `buildBotDefaultSystemPrompt()` 含"1点体力"或"参考"字样（通用策略已入）
2. `buildBotDefaultUserPrompt(state, [{localHeuristicScore:50}])` 含"参考分"说明
3. `buildBotDefaultUserPrompt(state, [{action:'出',label:'x'}])`（无 score）**不含**"参考分"说明（条件拼接）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。'
    +'决策参考(是判断优先级的参考,不是必须遵守的硬规则):1点体力大致相当于2张手牌的价值;'
    +'关键防御牌(无懈/闪/桃)要留到关键时刻,别为试探而消耗;手牌耗尽裸拼往往替别人火中取栗;'
    +'多数决策宁可保守不出,也不要打空自己。';
}
function buildBotDefaultUserPrompt(state, candidates){
  const hasScore = (candidates||[]).some(function(c){ return typeof c.localHeuristicScore === 'number'; });
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action, card:c.card, seat:c.seat,
      handIndex:c.handIndex, cardIdx:c.cardIdx, target:c.target, targets:c.targets,
      pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +(hasScore ? '\n\n说明:localHeuristicScore是本地算法的参考分,只是排序参考,不代表最优解;请结合局面与你的判断选择,不一定要选分数最高的。' : '')
    +'\n\n只返回 {"choice":数字}';
}
```

- [ ] **Step 5: 回归 + `?v=304→305` + Commit**

```bash
node run_ai_bus_core_test.js && node run_ai_bus_l3_test.js && node run_ai_bus_l1_test.js && node --check bot-ai-bus.js
git add bot-ai-bus.js run_ai_bus_core_test.js index.html
git commit -m "feat(ai): 提示词G1通用策略+G3score语义"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task P2: G5 决策思考链（bot.js 注册项 prompt）

**Files:**
- Modify: `bot.js` — 各注册项 `buildSystemPrompt`
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: 5 个高价值决策点 prompt 追加思考引导
- Consumes: `BOT_DECISIONS.*`（bot.js）

- [ ] **Step 1: 写失败测试**

`run_ai_bus_l3_test.js` 追加（对每个注册项调用 `buildSystemPrompt(g, seat)` 断言含思考句）：
1. `BOT_DECISIONS.playCard` 出牌 prompt 含"威胁"或"留牌"
2. `BOT_DECISIONS.dying` 求桃 prompt 含"敌我"或"值得"
3. `BOT_DECISIONS.wuxie` 无懈 prompt 含"值不值得"
4. `BOT_DECISIONS.discardSubset` 弃牌 prompt 含"保留"
5. `BOT_DECISIONS.pickSlot` 拆顺 prompt 含"价值"

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

各注册项 `buildSystemPrompt` 追加 1-2 句（**引导性，非硬规则**）：
- `playCard`：'先看目标威胁与距离,再想留牌,最后选'
- `dying`：'先判断濒死者敌我、值不值得救,再选'
- `wuxie`：'先判断这张锦囊被无懈后的影响,值不值得留无懈,再选'
- `discardSubset`：'先想保留什么(关键牌),再弃低价值'
- `pickSlot`：'先看目标装备/判定价值,再选拆哪个'

- [ ] **Step 4: 回归 + `?v=306→307` + Commit**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_l2_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(ai): 提示词G5决策思考链"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task P3: G2 响应类身份引导（bot.js 响应注册项）

**Files:**
- Modify: `bot.js` — 响应类注册项 `buildSystemPrompt`
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: 统一 helper `botPromptWithIdentity(base, g, seat)` + 响应类注册项接入
- Consumes: `botIdentityGuidance(g, seat)`（bot.js 既有）

- [ ] **Step 1: 写失败测试**

`run_ai_bus_l3_test.js` 追加：
1. `botPromptWithIdentity('base', identityG, zhuSeat)` 含"你当前是"（身份局主公）
2. `botPromptWithIdentity('base', ffaG, seat)` 不含"你当前是"（ffa）
3. `BOT_DECISIONS.dying.buildSystemPrompt(identityG, zhuSeat)` 含身份引导；ffa 不含
4. 抽样 wuxie/duel/aoeResp/jiedaoResponse 同断言

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// bot.js 新增 helper(botIdentityGuidance 附近):
function botPromptWithIdentity(base, g, seat){
  return base + botIdentityGuidance(g, seat);
}
// 响应类注册项 buildSystemPrompt 改为 (g, seat) => botPromptWithIdentity('原短prompt', g, seat)
// 涉及:dying/wuxie/duel/aoeResp/jiedaoResponse/xiaoguo/enyuanOption/ganglieChoice/guhuoQuestion
```

**注意**：这些注册项 buildSystemPrompt 原是无参函数（`function(){ return '...' }`）——改为 `function(g, seat){ return botPromptWithIdentity('...', g, seat); }`。`botDecide` 调用 `spec.buildSystemPrompt(g, seat, ctx)` 已传参，兼容。

- [ ] **Step 4: 回归 + `?v=307→308` + Commit**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_l1_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(ai): 提示词G2响应类身份引导"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task P4: 验收 + progress-log-8 追加

**Files:**
- Modify: `docs/progress-log-8.md`

- [ ] **Step 1: 全量回归**

```bash
source ~/.nvm/nvm.sh 2>/dev/null
node run_ai_timeout_test.js && node run_ai_lordskill_test.js && node run_ai_summary_test.js
node run_ai_bus_core_test.js && node run_ai_bus_info_test.js && node run_ai_bus_l1_test.js
node run_ai_bus_l2_test.js && node run_ai_bus_c_window_test.js && node run_ai_bus_l3_test.js
node run_ai_model_picker_test.js
node --check bot.js && node --check bot-ai-bus.js && node --check ai-bot.js
```

- [ ] **Step 2: 验收核对**

- [ ] 默认 system 含通用策略（P1 断言）
- [ ] 5 决策思考链（P3 断言）
- [ ] 响应类身份引导（身份局含/ffa 不含）（P4 断言）
- [ ] 无密钥零变化（回归全绿）
- [ ] `?v=308` 已 push；progress-log-8 追加

- [ ] **Step 3: progress-log 追加 + Commit**

```bash
git add docs/progress-log-8.md
git commit -m "docs: 提示词增强批次交付记录"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| §2.1 G1 通用策略 | P1 |
| §2.2 G2 响应类身份 | P3 |
| §2.3 G3 score 语义 | P1 |
| §2.5 G5 思考链 | P2 |
| §3 测试 | 各 Task |
| §4 批次 | 计划结构强制 |
| §5 不做 | 各 Task 明确不做 |

## Placeholder 扫描

- 所有 prompt 文本已写死（spec §2 逐字），无开放式 TODO
- P4 无参 buildSystemPrompt 改有参：给了明确规则（botDecide 传参兼容）

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；P5 验收门最后执行。
