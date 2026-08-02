# AI 可操作面决策总线（先 B 后 C）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地可操作面决策总线：Milestone B 让有密钥时 AI 在合法候选上做单步选择（L1 按钮镜像 + L2 结构化出牌/弃牌/拆顺/手牌选），无密钥保持现有本地算法；Milestone B 验收后实现 Milestone C（同一可操作窗口内有预算的多步合法动作循环）。

**Architecture:** 统一 `botDecide` + `callAiChooseIndex` + 按交互形态注册的 `BOT_DECISIONS`（不按武将名）。局面经加强版 `buildBotVisibleState` 投影；候选来自 controls 镜像（L1）或 `CARD_PLAYS`/公开区枚举（L2），AI 只返回 `{"choice":N}`，失败立刻 `localFallback`。C 复用同一 primitive，在窗口谓词为真时循环 `enumerate → choose → execute`。禁止自由 DSL / 按武将 AI 分支。

**Tech Stack:** 纯静态多文件 JS（无构建）；既有 `callAI`（`ai-bot.js`）；`bot.js` 机器人调度；vm 沙箱测试（对齐 `run_lidian_test.js` / 既有 AI scratch 测试写法）；`index.html` 脚本 `?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-ai-operable-surface-bus-design.md`

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送，不进 `main` 直至用户明确要求
- **有密钥**：注册表覆盖的决策走 AI 选 index；**无密钥 / AI 失败（超时、非 JSON、越界）**：立刻 `localFallback`，**不重试**
- **无密钥行为** = 改动前本地算法（回归基线，测试锁定）
- **禁止** AI 策略路径新增 `if (general===...)` / 按武将名 prompt；技能差来自 `GENERALS` + 人类可点项
- **禁止** 自由动作 DSL（形态 E）；B/C 均强制候选 + index
- **隐藏信息**：从头投影允许字段；蛊惑 **不得** 出现 `actualCard`；他人手牌只 `handCount`
- **超时**：复用 `AI_CALL_TIMEOUT_MS`（15000），B 阶段不改 `ai-bot.js` 超时语义
- **并发**：保持 `botDecisionInFlight` + `botMissedSchedule`；`await` 期间不得占用全局 `mySeat`
- **加载顺序**：`bot.js` 在 `render-controls.js` **之前**；L1 仅在**运行时**调 `renderControls`（与现 `botSafePrompt` 相同）。第一批总线代码放 `bot.js`，不新建须插在 controls 前的文件
- **cache-bust**：改 `bot.js` / `ai-bot.js` / `index.html` 样式或任一已带 `?v=` 的脚本内容时，`index.html` 内 **全部** `?v=N` 同步 +1（当前基线 **258**，以改时文件为准）
- **测试**：vm 加载真实源码；`let aiApiKey` 等用 `vm.runInContext('aiApiKey=...',sandbox)` 赋值，禁止 `sandbox.aiApiKey=...`
- **收尾**：B/C 各自验收后追加 `docs/progress-log-*.md`（最新分段）；架构约定变更才改 `CLAUDE.md` 正文
- **执行顺序**：**先完成 Milestone B 全部 Task 并验收门，再做 Milestone C**

---

## File map

| File | Responsibility |
|------|----------------|
| `bot.js` | 总线 API、信息层、`BOT_DECISIONS`、L1/L2、`runBotDecision` 改挂注册表、Milestone C 窗口循环；迁移/删除重复 `tryAiBot*` 样板 |
| `ai-bot.js` | B 阶段原则上不改；若 C 需要整窗预算常量可只加注释级常量或由 bot.js 自管 |
| `index.html` | `?v=` 同步；一般无新 DOM（沿用 `#aiThinkingIndicator`） |
| `render-controls.js` | **可选** B5：给关键 button 加 `data-bot-action` 稳定键（人类 UI 不变）；非必须若 label 足够 |
| `run_ai_bus_core_test.js` | 新建：总线/解析/无密钥/越界 fallback |
| `run_ai_bus_info_test.js` | 新建：技能常开、牌面、log、无 actualCard |
| `run_ai_bus_l1_test.js` | 新建：controls 镜像候选与 click 路径 |
| `run_ai_bus_l2_test.js` | 新建：play/discard/pick/handPick |
| `run_ai_bus_c_window_test.js` | 新建（C）：同窗多步 mock choice 序列 |
| 既有 `run_*.js` | 回归；无密钥 bot 行为不恶化 |

**不修改（B 默认）：** `game.js` / `skills.js` 的规则函数体（只调用）；`normalize` 无新持久化字段。

---

## 目标接口（全计划统一命名）

```js
// 候选
// { index:number, label:string, source?:string, invoke?:Function,
//   handIndex?:number, seat?:number, action?:string, card?:{name,suit,rank},
//   pickKey?:string, discardIndices?:number[], payload?:any }

function buildBotVisibleState(g, seat) // 去掉 isFirstTurn 死参或忽略之；技能常开
function callAiChooseIndex(opts) // async -> number|null
// opts: { g, seat, systemPrompt, userPrompt, candidates, maxTokens? }

function botDecide(decisionId, g, seat) // async -> boolean  true=已处理

const BOT_DECISIONS = {
  // decisionId -> { match, buildCandidates, extraState?, buildSystemPrompt?, localFallback, execute }
}

// L1
function collectControlsCandidates(g, seat) // -> Candidate[]  (invoke 已绑定)

// L2 helpers
function buildPlayCardCandidates(g, seat)
function buildDiscardSubsetCandidates(g, seat)
function buildPickSlotCandidates(g, seat)
function buildHandPickCandidates(g, seat, opts) // opts: { includeSkip:true, skipLabel, filterFn? }

// C
function isBotActionWindow(g, seat) // boolean
function enumerateAllLegalOneStepActions(g, seat) // Candidate[]
function runBotActionWindow(g, seat) // async；内循环
const BOT_WINDOW_MAX_STEPS = 8
```

默认 system 骨架（极简）：

```text
你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。
只能选列表内选项。只输出 {"choice":数字}，不要解释。
```

---

# Milestone B — 单步可操作面

## B 验收门（全部 Task B0–B6 完成后检查）

- [ ] 有密钥：出牌/选目标/弃牌/拆顺/带按钮响应 可走 AI（mock 可选与本地不同的合法 index）
- [ ] 无密钥：与改动前关键分支一致（测试绿）
- [ ] 蛊惑 userPrompt 无真实 `actualCard` 名
- [ ] 全场 `generalSkill` 不依赖 `isFirstTurn`
- [ ] 无新增按武将 id 的 AI 策略分支（`rg` 自检）
- [ ] `?v=` 已 +1 并 push `wenwen_dev`
- [ ] `docs/progress-log-*.md` 已记 B 交付
- [ ] **不**声称同窗多步（C）已完成

---

### Task B0: 测试 harness 与 `callAiChooseIndex` + 空 `botDecide` 骨架

**Files:**
- Create: `run_ai_bus_core_test.js`
- Modify: `bot.js`（在 `parseBotPlayAiChoice` 之后、`tryAiBotPlay` 附近插入）
- Modify: `index.html`（全部 `?v=` +1，本 task 末若已改 bot.js）

**Interfaces:**
- Produces: `callAiChooseIndex`, `botDecide`（可先只支持空 `BOT_DECISIONS`）, `BOT_DECISIONS = {}`
- Consumes: `callAI`, `aiApiKey`, `aiProvider`, `aiApiModel`, `parseBotPlayAiChoice`, `showAiThinkingIndicator`, `hideAiThinkingIndicator`

- [ ] **Step 1: 写失败测试 `run_ai_bus_core_test.js`**

Harness 要求（对齐项目惯例）：
- `fs` + `vm` 加载：`config.js`（可 stub firebase）、`data.js`、最小 stub 的 `game.js` 依赖若过重则只 load `bot.js` + `ai-bot.js` 并注入 `CARD_PLAYS`/`renderControls` 等空函数
- 推荐：与 `test_bot_ai_playbook` 同类——能 load 完整链则完整链；至少保证 `parseBotPlayAiChoice`、`callAiChooseIndex`、`botDecide` 可测

断言：
1. `parseBotPlayAiChoice('{"choice":2}') === 2`
2. `parseBotPlayAiChoice('not json') === null`
3. mock `callAI` 返回 `ok+{"choice":1}` 且 candidates.length===3 → `callAiChooseIndex` 返回 `1`
4. 返回 `{"choice":99}` → `null`
5. `callAI` 返回 `{ok:false,reason:'timeout'}` → `null`
6. 沙箱 `aiApiKey=''` → `callAiChooseIndex` **不**调用 `callAI`，返回 `null`
7. `botDecide('nope', g, 0)` → `false`（未注册）

- [ ] **Step 2: 跑测试确认失败**

```bash
node run_ai_bus_core_test.js
```

Expected: 失败（`callAiChooseIndex` / `botDecide` 未定义）

- [ ] **Step 3: 实现最小骨架**

在 `bot.js` 中实现：

```js
const BOT_DECISIONS = Object.create(null);

function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。';
}

function buildBotDefaultUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(candidates.map(c=>({
      index:c.index, label:c.label, action:c.action, card:c.card, seat:c.seat,
      handIndex:c.handIndex, pickKey:c.pickKey, discardIndices:c.discardIndices
    })))
    +'\n\n只返回 {"choice":数字}';
}

async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  if(candidates.length<=1) return candidates.length===1 ? 0 : null;
  const g = opts.g, seat = opts.seat;
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: opts.systemPrompt || buildBotDefaultSystemPrompt(),
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
  return idx;
}

async function botDecide(decisionId, g, seat){
  const spec = BOT_DECISIONS[decisionId];
  if(!spec || typeof spec.match!=='function' || !spec.match(g, seat)) return false;
  const candidates = spec.buildCandidates(g, seat) || [];
  if(!candidates.length){
    if(typeof spec.onEmpty==='function'){ spec.onEmpty(g, seat); return true; }
    return false;
  }
  // 规范 index
  candidates.forEach((c,i)=>{ c.index = i; });
  let idx = null;
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(aiReady && candidates.length>1){
    const state = buildBotVisibleState(g, seat);
    if(typeof spec.extraState==='function'){
      Object.assign(state, spec.extraState(g, seat) || {});
    }
    const systemPrompt = (typeof spec.buildSystemPrompt==='function')
      ? spec.buildSystemPrompt(g, seat, { state, candidates })
      : buildBotDefaultSystemPrompt(g, seat);
    const userPrompt = buildBotDefaultUserPrompt(state, candidates);
    idx = await callAiChooseIndex({ g, seat, systemPrompt, userPrompt, candidates, maxTokens: spec.maxTokens||80 });
  } else if(aiReady && candidates.length===1){
    idx = 0;
  }
  let choice;
  if(idx===null){
    choice = spec.localFallback(g, seat, candidates);
  } else {
    choice = candidates[idx];
  }
  spec.execute(g, seat, choice);
  return true;
}
```

注意：`buildBotVisibleState` 若仍在后文定义，把 `callAiChooseIndex`/`botDecide` 放在其**之后**，或先 function declaration 提升。以「不出现 TDZ」为准插入位置。

- [ ] **Step 4: 跑测试确认通过**

```bash
node run_ai_bus_core_test.js
```

Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add bot.js run_ai_bus_core_test.js index.html
git commit -m "feat(bot): AI总线骨架 callAiChooseIndex/botDecide"
git push origin wenwen_dev
```

---

### Task B1: 信息层 — 技能常开、recentLog、自身标志

**Files:**
- Modify: `bot.js` — `buildBotVisibleState`
- Create: `run_ai_bus_info_test.js`

**Interfaces:**
- Produces: 加强后的 `buildBotVisibleState(g,seat)`（`isFirstTurn` 参数删除或忽略）
- 每名玩家：`generalSkill` / `generalDesc` 在有 `GENERALS[general]` 时始终尝试填充（`desc` 可 `slice(0,120)`）
- 顶层：`recentLog: (g.log||[]).slice(-10)` 映射为字符串数组（若 log 项是对象则 `JSON.stringify` 或 `.text` 字段——**先读真实 `g.log` 元素形状再写**，与 `render-log.js` 一致）
- 自身：`myFlags: { shaUsed:!!g.shaUsed, jiangchiNoSlash:!!me.jiangchiNoSlash }`（仅确认字段在项目中已存在的才加入；用 `rg` 核对后写死列表）

- [ ] **Step 1: 写失败测试**

```js
// 1) buildBotVisibleState 后 players[i].generalSkill 在 general='guojia' 等已知 id 时为非空字符串
// 2) 调用 buildBotVisibleState(g,seat) 不传第三参也有 skill（证明不依赖 isFirstTurn）
// 3) g.log = ['a','b',...] 长度 15 时 recentLog.length===10 且末项对齐
// 4) buildBotGuhuoVisibleState 的 JSON 字符串不含 actualCard 真实牌名（回归）
```

- [ ] **Step 2: 跑测失败 → 实现 → 跑通**

修改 `buildBotVisibleState`：删除 `isFirstTurn` 条件，改为：

```js
generalSkill: (p.general && typeof GENERALS!=='undefined' && GENERALS[p.general])
  ? String(GENERALS[p.general].skill||'') : undefined,
generalDesc: (p.general && typeof GENERALS!=='undefined' && GENERALS[p.general])
  ? String(GENERALS[p.general].desc||'').slice(0,120) : undefined,
```

并增加 `recentLog`、`myFlags`。

- [ ] **Step 3: Commit**

```bash
git add bot.js run_ai_bus_info_test.js index.html
git commit -m "feat(bot): AI可见状态技能常开与recentLog"
git push origin wenwen_dev
```

---

### Task B2: 迁入 `playCard` + `playTarget` 到总线（含候选牌面）

**Files:**
- Modify: `bot.js` — `botPlay`、`botPlayCandidateEntry`/`buildBotPlayCandidates`、`tryAiBotPlay`/`tryAiBotBestTarget` 改为走 `BOT_DECISIONS` 或内部调 `callAiChooseIndex`
- Create/extend: `run_ai_bus_l2_test.js`

**Interfaces:**
- `BOT_DECISIONS.playCard` / 或保持 `botPlay` 为编排者但选 index 只经 `callAiChooseIndex`
- 候选每项必须含：`label`, `card`（pass 项 card 为 null）, `handIndex`, `action`, `target`（若有）, `localHeuristicScore`
- `localFallback`：与现逻辑一致——`options[0].value>25 ? options[0] : pass`
- 需目标时：第二次 `callAiChooseIndex` 选座位；fallback `botBestTarget`

**推荐实现策略（减风险）：**  
不一次性删光 `botPlay`：先让 `tryAiBotPlay` 内改用 `callAiChooseIndex` + 带牌面 candidates；`runBotDecision` 的 play 分支仍 `await botPlay`。行为锁住后再标 `@deprecated` 旧 system 长文案（可改为极简 default + 可选保留一行身份 guidance）。

- [ ] **Step 1: 测试**

```js
// 无密钥：options 有高分桃时 playCard 被调用（spy），与旧行为一致
// 有密钥 mock choice 选「结束」→ endPlay
// userPrompt 含牌 name（如「无中生有」）在 candidates 里
// 选目标：mock 选非默认座位 → playCard target 为该座位
```

- [ ] **Step 2: 实现 + 跑通 + 跑既有相关回归若有**

```bash
node run_ai_bus_l2_test.js
node --check bot.js
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bot): 出牌/选目标经总线且候选带牌面"
```

---

### Task B3: L1 `controlsChoice` — 镜像全部 controls 按钮

**Files:**
- Modify: `bot.js` — 新增 `collectControlsCandidates`；注册 `BOT_DECISIONS.controlsChoice`；改 `runBotDecision` 对响应 phase 优先 `botDecide('controlsChoice')`；收缩与 L1 重复的硬编码分支
- Create: `run_ai_bus_l1_test.js`

**Interfaces:**
- `collectControlsCandidates(g, seat)`：克隆现 `botSafePrompt` 的 DOM 隔离模式，但收集**所有** `button:not(:disabled)`，不是只 safe 正则

```js
function collectControlsCandidates(g, seat){
  const real = document.getElementById('controls');
  if(!real || typeof renderControls!=='function') return [];
  const oldId = real.id; real.id = 'human-controls';
  const box = document.createElement('div');
  box.id = 'controls'; box.style.display = 'none';
  document.body.appendChild(box);
  const humanSeat = mySeat; mySeat = seat;
  const list = [];
  try{
    renderControls(g);
    const buttons = [...box.querySelectorAll('button:not(:disabled)')];
    buttons.forEach((btn, i)=>{
      const label = (btn.textContent||'').trim() || ('按钮'+i);
      list.push({
        index: i,
        label,
        source: 'controls',
        invoke: ()=>{ btn.click(); },
      });
    });
  }catch(e){ console.warn('collectControlsCandidates', e); }
  finally {
    mySeat = humanSeat;
    // 注意：不能销毁 buttons 后再 click——invoke 必须在 box 仍存在时调用
    // 设计：execute 内先 click 再 remove；故 collect 返回前不要 box.remove()
    // 改为返回 { candidates, cleanup } 或 execute 同步 click 后 cleanup
  }
  return list;
}
```

**重要：** `botSafePrompt` 是 click 后立即 remove。L1 必须：

```js
// collect 返回 { candidates, dispose }
// execute: botInvoke(seat, ()=> choice.invoke()); dispose();
```

`localFallback`：
1. 若 `candidates` 中存在匹配原 safe 正则的按钮 → 选第一个 safe  
2. 否则原 mandatory 规则  
3. 否则 `candidates[0]`  
（与 `botSafePrompt` 选择顺序对齐，再 invoke）

`match(g,seat)`：  
- `botSeatForState` 已是该 seat 或 fallback 探测 seat  
- **排除** 已由 L2 专责的 phase：`play` / `discard` / `pick`（pick 用 L2）  
- `collect` 后 `candidates.length>=1`  
- 对于仍用结构化 handPick 的 `guicai`：若需要选具体手牌而非仅按钮，见 Task B5——若 UI 已是「每张牌一个按钮」则 L1 足够

`runBotDecision` 调整顺序（概念）：

```js
// 1. 选将/摸牌等纯本地短分支保留
// 2. if play -> botPlay (L2)
// 3. if discard -> botDecide('discardSubset')
// 4. if pick -> botDecide('pickSlot')
// 5. if await botDecide('controlsChoice') return
// 6. 残留旧分支（尚未迁移）
// 7. botSafePrompt
```

- [ ] **Step 1: 测试（jsdom 或 minimal DOM stub）**

注入假 `document`/`renderControls` 渲染两个按钮「出桃」「不出」。  
- mock AI 选 0 → spy 到出桃 click  
- 无密钥 → fallback 点「不出」（若标成 safe）或按规则  

- [ ] **Step 2: 实现、删掉已被 L1 覆盖的重复 `respondWuxie(false)` 等硬编码前，确认 fallback 等价**

特别：`wuxie` 旧 fallback 永不无懈 → fallback 必须选「不出无懈」类按钮 label 匹配 `/不出|不使用|取消|不无懈/`。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bot): L1 controlsChoice 镜像全部可点按钮"
```

---

### Task B4: L2 `discardSubset` + `pickSlot`

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l2_test.js`

**discardSubset:**

```js
// match: phase==='discard' && turn===seat
// need = max(0, hand.length - hp)
// need===0 -> execute endTurn via onEmpty/match 前短路径
// candidates: 
//   - 永远包含 defaultIndices = 末尾 need 张下标（与现 bot 一致）
//   - 另生成最多 19 个变体：按 botCardPriority 升序（优先弃低价值）取前 need 张等
//   - 去重 key=indices.join(',')
// localFallback: default 那一项
// execute: discardCards(choice.discardIndices)
```

**pickSlot:**

```js
// match: phase==='pick' && pending.from===seat
// candidates 与现 bot 分支可选项一致：hand / 各装备槽 / delay:i
// label 含牌名或「随机手牌」
// localFallback: 现逻辑 hand 优先
// execute: pickResolve(choice.pickKey)
```

- [ ] **Step 1: 测试无密钥弃牌下标序列等于旧算法；有密钥 mock 选另一组合则 spy 参数匹配**
- [ ] **Step 2: 实现 + `runBotDecision` 挂载**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bot): L2 弃牌组合与拆顺选牌总线化"
```

---

### Task B5: L2 `handPick`（鬼才等）+ 收敛旧 `tryAiBotGuicai` / ganglie / guhuo

**Files:**
- Modify: `bot.js`

**策略：**
- `guicai`：`buildHandPickCandidates` = index0 不发动 + 每张手牌；fallback `{replace:false}`；execute `respondGuicai`  
  若 L1 已能覆盖则测两者不双执行——**guicai 优先 handPick 注册 match，controlsChoice 对 phase==='guicai' 返回 false**
- `ganglieChoice` / `guhuoQuestion`：优先 L1 按钮；保留 extraState 钩子给 guhuo（无 actualCard）若 L1 label 不足可在 `extraState` 塞公开 claimedCard  
- 删除重复的 `tryAiBotGuhuoQuestion` 等大段，改为 `botDecide` 注册项，避免双路径

- [ ] **Step 1: 测试 guicai fallback 不发动；mock 选牌 index→ respondGuicai(true, handIndex)；guhuo 无 actualCard**
- [ ] **Step 2: 实现 + 删除死代码**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bot): handPick与响应类统一进BOT_DECISIONS"
```

---

### Task B6: L3 最小集 — 出牌枚举放宽 + 座位一步候选（B 完成定义）

**Files:**
- Modify: `bot.js` — `botPlay` 枚举

**Spec 允许 L3 完整第二批；本 Task 取 B 验收最小集：**

1. **评估**能否安全去掉对 `借刀杀人`/`铁索连环`/`闪电` 的 `return` 排除：  
   - 若 `canPlay` 为真但机器人无法完成多步目标 → **保持排除**，在 progress-log 写明缺口  
   - 若存在单步 `playCard` 即可（如闪电 target false）→ **纳入候选**
2. 对 `phase==='play'` 且存在「仅座位点击」的全局 mode 变量（`zhangbaMode` 等）：若能从 `render-controls`/`render.js` 读到合法座位列表函数，增加 `BOT_DECISIONS.seatPick`；否则文档记录延期 C 前必修

- [ ] **Step 1: `rg` 审计排除牌与 mode 变量，写审计结果注释块于 bot.js 或 progress-log**
- [ ] **Step 2: 能做的纳入 + 测试「闪电在 canPlay 时出现在候选」**
- [ ] **Step 3: B 验收门清单人工勾选 + progress-log + commit**

```bash
git commit -m "feat(bot): Milestone B L3最小集与验收记录"
```

---

# Milestone C — 同窗口多步（仅 B 验收后开始）

## C 验收门

- [ ] `isBotActionWindow` / `runBotActionWindow` 有单测
- [ ] mock AI 序列可实现「先拆后杀」两步（构造手牌与距离）
- [ ] 无密钥不进多步 AI 循环（逐步本地或单步 fallback）
- [ ] `maxSteps` 上限生效，不死循环
- [ ] progress-log 记 C；说明与 B 差异

---

### Task C0: 窗口谓词与 `enumerateAllLegalOneStepActions`

**Files:**
- Modify: `bot.js`
- Create: `run_ai_bus_c_window_test.js`

**写死谓词（本计划选定）：**

```js
function isBotActionWindow(g, seat){
  if(!g || !g.players[seat] || !g.players[seat].alive) return false;
  // 窗 A：自己的出牌阶段
  if(g.phase==='play' && g.turn===seat && !g.pending) return true;
  return false;
}
```

第一版 **只做 play 窗**（响应类一步足够，不强制进 C 循环）。若 `g.pending` 非空则不属于 play 窗。

```js
function enumerateAllLegalOneStepActions(g, seat){
  // 合并：
  // 1) buildPlayCardCandidates 每项变为「完整一步」：若 action 需 target，展开为 每(牌,目标) 一条候选
  //    （这是 C 相对 B 的关键：消灭 play+target 双次 AI）
  // 2) collectControlsCandidates 若 play 阶段 controls 仍有主动技按钮，合并入列表（label 去重）
  // 3) 始终可有「结束出牌阶段」
}
```

- [ ] **Step 1: 测试** 无 pending 的 play → window true；有 pending → false；枚举含展开后的杀+座位
- [ ] **Step 2: 实现**
- [ ] **Step 3: Commit** `feat(bot): C窗谓词与一步动作枚举`

---

### Task C1: `runBotActionWindow` 循环接入 `runBotDecision`

**Files:**
- Modify: `bot.js` — `runBotDecision` 在 play 分支改为 `await runBotActionWindow(g,seat)`（有密钥或无密钥均可走循环；无密钥每步 localFallback）

```js
const BOT_WINDOW_MAX_STEPS = 8;

async function runBotActionWindow(g, seat){
  let steps = 0;
  while(steps < BOT_WINDOW_MAX_STEPS){
    const latest = (typeof currentG!=='undefined' && currentG) ? currentG : g;
    if(!isBotActionWindow(latest, seat)) break;
    // 注意：execute 后 g 可能过期，每步用 currentG
    const candidates = enumerateAllLegalOneStepActions(latest, seat);
    if(!candidates.length) break;
    candidates.forEach((c,i)=> c.index=i);
    let idx = null;
    const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
    if(aiReady && candidates.length>1){
      const state = buildBotVisibleState(latest, seat);
      state.windowStep = steps;
      idx = await callAiChooseIndex({
        g: latest, seat,
        systemPrompt: buildBotDefaultSystemPrompt()
          + '你处于同一出牌窗口的连续决策，每步只选一个合法动作。',
        userPrompt: buildBotDefaultUserPrompt(state, candidates),
        candidates,
        maxTokens: 100,
      });
    } else if(candidates.length===1){
      idx = 0;
    }
    let choice;
    if(idx===null){
      // fallback：复用 botPlay 本地启发式——从 candidates 里找 action 非结束的最高 localHeuristicScore，或结束
      choice = localFallbackPlayWindow(latest, seat, candidates);
    } else {
      choice = candidates[idx];
    }
    // 若选结束 → execute endPlay; break
    executePlayWindowChoice(latest, seat, choice);
    steps++;
    // 若 execute 是异步 tx，必须 await 等待 currentG 更新——
    // 本项目 playCard 经 tx 回调；bot 侧通常 fire-and-forget。
    // **实现时**：若无法同步得到新状态，则 break 出循环交 scheduleBotTurn（降级为 B 行为），
    // 并在 progress-log 记录；优先尝试在 botInvoke 同步路径能完成的动作上循环。
    if(choice.action==='结束出牌阶段' || choice.isEndPlay) break;
  }
}
```

**tx 异步现实约束（必须遵守）：**  
若一步 `playCard` 不能在同 tick 反映到 `currentG`，C 循环无法安全继续。处理层级：

1. **优先**：对可同步 stub 的测试环境验证循环逻辑。  
2. **生产**：`execute` 后 `break`，依赖现有 `scheduleBotTurn` 再入窗（=弱 C / 多步跨调度），**或**  
3. 在 `playCard` 的本地路径增加 optional callback（**禁止大改 game.js 除非必要**）  

本计划要求 Task C1 实现者：**先写探测实验**（测 playCard 后 currentG 是否同步更新）；若否，采用「弱 C」：`runBotActionWindow` 每调度只执行 **1** 步 AI，但候选已是 **牌×目标合并**，并在 userPrompt 带 `windowStep` 与 `recentLog`——仍比 B 少一次 target AI，完整强 C 列为 C1b。

- [ ] **Step 1: 探测 + 文档写清强/弱 C 结论**
- [ ] **Step 2: 实现可工作的一档 + 测试 mock 两步序列（弱 C 则两次 schedule + 合并候选）**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bot): Milestone C 出牌窗多步/合并候选"
```

---

### Task C2: C 验收、回归、progress-log

- [ ] **Step 1: 跑全部 `run_ai_bus_*.js` + 仓库 `run_*_test.js`**
- [ ] **Step 2: 人工勾选 C 验收门**
- [ ] **Step 3: 写 `docs/progress-log-*.md`；`?v=` +1；push `wenwen_dev`**

```bash
git commit -m "docs: Milestone C 验收与progress-log"
git push origin wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| callAiChooseIndex / botDecide 总线 | B0 |
| 信息层技能/log/标志 | B1 |
| 出牌/目标 + 牌面 | B2 |
| L1 controls | B3 |
| 弃牌/拆顺 | B4 |
| handPick / 收敛 tryAi* | B5 |
| L3 最小 / 缺口记录 | B6 |
| B 验收门 | B6 末 |
| C 窗 + 枚举 | C0 |
| C 循环 / 合并候选 | C1 |
| C 验收 | C2 |
| 无密钥 fallback | 各 Task 测试 |
| 禁止自由 DSL / 按将分支 | Global + B6 rg |
| 先 B 后 C | 计划结构强制 |

## Placeholder 扫描

- 无 TBD 实现步骤；C1 对 tx 异步保留**可判定分支**（强 C / 弱 C），实现时写死一种并测。  
- `g.log` 元素形状、`myFlags` 字段列表要求实现时 `rg` 后写死，不在计划留空函数体。

---

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；B 验收后再开 C0。
