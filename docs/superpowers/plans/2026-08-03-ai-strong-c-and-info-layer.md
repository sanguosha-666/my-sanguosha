# 强 C（同窗多步）+ 信息层增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part A 强C：给 `tx`/`playCard`/`endPlay` 加可选提交回调，`runBotActionWindow` 恢复同窗多步循环（有密钥时）；Part B 信息层：`buildBotVisibleState` 增补弃牌堆/牌堆/射程/desc 全量/recentLog 20 条。

**Architecture:** Part A：`tx(fn, onCommitted?)` 可选第二参数（Firebase transaction Promise resolve 后把新快照交给回调），`playCard`/`endPlay` 加可选回调透传；`runBotActionWindow` 升级为循环（execute → await 新快照 → 重枚举 → 再决策，直到 endPlay/maxSteps=8/窗口失效/提交失败）。**无密钥时不启用循环**（执行一步直接 return，与现弱C 逐字一致）。Part B：只改 `buildBotVisibleState` 投影层，不进 Firebase。

**Tech Stack:** 纯静态多文件 JS（无构建）；vm 沙箱测试（`run_ai_bus_c_window_test.js` stub 升级为 Promise 模式）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-ai-strong-c-and-info-layer-design.md`

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送，不进 `main`
- **有密钥**：强C 循环启用（连续多步）；**无密钥 / AI 失败**：每步 localFallback，且**不启用循环**（执行一步直接 return，与现弱C 行为逐字一致）
- **`tx`/`playCard`/`endPlay` 回调是可选参数**：不传时行为与改动前逐字一致（fire-and-forget；回归测试锁定）
- **不给 30+ 个 `respond*`/技能函数加回调**（响应类保持单步）；强C 循环只覆盖 play 窗口（`isBotActionWindow` 谓词不变）
- **禁止**新增按武将 id 分支、禁止新 AI 响应协议（仍 `{"choice":N}`）
- **隐藏信息**：Part B 五项全部是公开信息投影；guhuo actualCard 红线不破
- **`?v=`**：改动 game.js/bot.js 时全部 13 处同步 +1（当前基线 278）
- **测试**：vm 加载真实源码；`let` 变量用 `vm.runInContext('x=...')` 裸赋值；函数声明可替换成 spy；`gameRef.transaction` stub 升级为 Promise 模式（见 SC1）
- **收尾**：progress-log **新建 progress-log-8.md**（progress-log-7 已 157KB ≥150KB）
- **执行顺序**：SC1→SC2→SC3（Part A）→ I1→I2→I3（Part B），各自独立 commit

---

## File map

| File | Responsibility |
|------|----------------|
| `game.js` | `tx(fn, onCommitted?)`、`playCard(..., onCommitted?)`、`endPlay(onCommitted?)`（Part A，最小改动） |
| `bot.js` | `runBotActionWindow` 循环升级、`executePlayWindowChoiceAwait`（Part A）；`buildBotVisibleState` 五项增强（Part B） |
| `run_ai_bus_c_window_test.js` | stub 升级（Promise transaction）+ 强C 断言（Part A） |
| `run_ai_bus_info_test.js` | 五项字段断言 + desc 全量断言更新（Part B） |
| `index.html` | `?v=` 同步（278→279→280） |
| `docs/progress-log-8.md` | 新建：两批交付记录（SC3/I3 收尾） |

---

# Part A：强 C

### Task SC1: tx/playCard/endPlay 提交回调 + stub 升级

**Files:**
- Modify: `game.js` — `tx`（~2295）、`playCard`（~2806）、`endPlay`（~5297）
- Modify: `run_ai_bus_c_window_test.js` — `gameRef.transaction` stub 升级

**Interfaces:**
- Produces: `tx(fn, onCommitted?)`（返回 transaction Promise；onCommitted 收快照 g 或 null）、`playCard(cardIdx, actionId, targetSeat, onCommitted?)`、`endPlay(onCommitted?)`
- Consumes: 无（既有调用点不传回调，行为不变）

- [ ] **Step 1: 写失败测试（stub 升级 + 回调触发断言）**

`run_ai_bus_c_window_test.js` 的 `gameRef.transaction` 从同步 stub 升级为：

```js
gameRef: {
  __txSnapshot: null, // 测试可设置:提交后 onCommitted 收到的快照;null=用 fn 返回值
  transaction: function(fn){
    var result = fn(context.g || {});
    var snap = gameRef.__txSnapshot !== null ? gameRef.__txSnapshot : result;
    return Promise.resolve({ snapshot: { val: function(){ return snap; } } });
  },
},
```

新增断言：
1. `tx(fn, onCommitted)`：真实调用 tx（沙箱内 `tx(g=>{g.x=1;return g;}, function(newG){ window.__committed = newG; })`）→ await 微任务后 `__committed` 收到快照（含 x=1）
2. 不传 onCommitted → 无回调、无异常（既有调用回归）
3. `playCard(0,'桃',null,onCommitted)` → onCommitted 收到提交后快照（含手牌变化）
4. `endPlay(onCommitted)` → onCommitted 被调用（phase 已推进）

- [ ] **Step 2: 跑测试确认失败**（onCommitted 不触发）

```bash
source ~/.nvm/nvm.sh 2>/dev/null; node run_ai_bus_c_window_test.js
```

Expected: 新断言 FAIL（onCommitted 从未被调）

- [ ] **Step 3: 实现 game.js 三处改动**

`tx`（照 spec A2.1 逐字）：

```js
function tx(fn, onCommitted){
  // 机器人控制端会暂时把 mySeat 切到机器人座位再调用现有动作函数。Firebase 事务可能
  // 因并发而重试，所以必须在创建事务时冻结行动座位。
  const actingSeat=mySeat;
  const p = gameRef.transaction(g => {
    if(!g) return g;
    const visibleSeat=mySeat;
    mySeat=actingSeat;
    try{
      normalize(g);
      pruneExchangeCards(g);
      const result = fn(g) || g;
      // 连营队列:本 tx 内 effect/杀结算可能覆盖 pending;收尾再尝试挂起询问
      tryFlushLianying(result);
      return stripUndefined(result);
    } finally {
      mySeat=visibleSeat;
    }
  });
  // 【强C新增】可选提交回调:Firebase transaction 返回 Promise(真实 SDK 行为),
  // resolve 后把提交成功的快照 g 交给 onCommitted(供机器人拿新状态继续同窗循环)。
  // 不传 onCommitted 时行为与改动前逐字一致(fire-and-forget,返回值被忽略);
  // vm stub 若不返回 thenable 则回调分支不触发,同样零影响。
  if(typeof onCommitted === 'function' && p && typeof p.then === 'function'){
    p.then(function(res){
      const snap = res && res.snapshot && typeof res.snapshot.val === 'function' ? res.snapshot.val() : null;
      onCommitted(snap);
    }, function(){ onCommitted(null); });
  }
  return p;
}
```

`playCard`（签名加第 4 参，末尾 tx 调用透传）：

```js
function playCard(cardIdx, actionId, targetSeat, onCommitted){
  tx(g=>{ ... 函数体不变 ... }, onCommitted);
}
```

`endPlay`（签名加第 1 参，tx 调用透传）：

```js
function endPlay(onCommitted){
  tx(g=>{ ... 函数体不变 ... }, onCommitted);
}
```

- [ ] **Step 4: 跑测试确认通过**（新断言 GREEN + 既有 c_window 15 项回归绿）

```bash
node run_ai_bus_c_window_test.js
```

Expected: 全绿（新 4 项 + 既有 15 项）

- [ ] **Step 5: 全量回归 + `?v=278→279` + Commit**

```bash
node run_ai_bus_core_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node --check game.js
git add game.js run_ai_bus_c_window_test.js index.html
git commit -m "feat(game): tx/playCard/endPlay可选提交回调(强C前置)"
git push origin wenwen_dev
```

---

### Task SC2: runBotActionWindow 循环升级 + executePlayWindowChoiceAwait

**Files:**
- Modify: `bot.js` — `runBotActionWindow`（~1820 区域）、`executePlayWindowChoice`（替换为 Await 版）

**Interfaces:**
- Consumes: `tx`/`playCard`/`endPlay` 回调（SC1）、`isBotActionWindow`/`enumerateAllLegalOneStepActions`/`localFallbackPlayWindow`（既有）
- Produces: `executePlayWindowChoiceAwait(g, seat, choice) -> Promise<newG|null>`、升级版 `runBotActionWindow`

- [ ] **Step 1: 写失败测试（强C 循环行为）**

在 `run_ai_bus_c_window_test.js` 追加（stub 已支持 Promise 快照）：
1. **强C 两步**：g1 手牌 [过河拆桥, 杀]，目标有 +1马（初始杀不可达）；mock AI 序列 step1 选拆桥、step2 选杀；`gameRef.__txSnapshot` 在每次 transaction 后设为"拆桥已结算、马已移除"的新状态（测试里用闭包变量维护一个可变 g，每次 fn 执行后更新快照）；断言**一次 `runBotActionWindow(g1,0)` 调用内** playCard spy 被调 2 次（拆桥→杀）、AI 询问 2 次、windowStep 0/1。
2. **endPlay 终止**：mock 选结束 → endPlay spy 带 onCommitted → 循环 break，不再枚举。
3. **快照失效 break**：stub 快照返回 turn 已变的状态 → 循环 break（不执行下一步）。
4. **提交失败 break**：stub 返回 `null` 快照 → 循环 break，不挂死。
5. **无密钥**：`aiApiKey=''` → 只执行一步（fallback），playCard spy 恰 1 次，循环不继续（行为与现弱C 逐字一致）。
6. **maxSteps**：每步快照仍有效但 AI 永不选结束 → 恰 8 步后停。

- [ ] **Step 2: 跑测试确认失败**（旧 runBotActionWindow 无循环）

- [ ] **Step 3: 实现 bot.js**

照 spec A3/A4 逐字（含无密钥短路、`newG===lastG` break、5s 超时兜底常量可注入）：

```js
function executePlayWindowChoiceAwait(g, seat, choice){
  return new Promise(function(resolve){
    let settled = false;
    const timer = setTimeout(function(){ if(!settled){ settled = true; resolve(null); } }, 5000);
    const onCommitted = function(newG){
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(newG);
    };
    if(choice && choice.isEndPlay){
      botInvoke(seat, function(){ endPlay(onCommitted); });
    } else {
      botInvoke(seat, function(){ playCard(choice.handIndex, choice.action, (choice.target != null ? choice.target : null), onCommitted); });
    }
  });
}
```

`runBotActionWindow` 升级（关键：无密钥不循环）：

```js
async function runBotActionWindow(g, seat){
  // 强C(Part A):有密钥时启用同窗多步循环——每次 execute 后等提交回调拿新快照,
  // 重枚举再决策,直到结束出牌/步数上限/窗口失效/提交失败。无密钥时保持弱C行为
  // (执行一步直接 return,不等待提交、不循环)——回归红线,测试锁定。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  let steps = 0;
  let lastG = (typeof currentG!=='undefined' && currentG) ? currentG : g;
  while(steps < BOT_WINDOW_MAX_STEPS){
    if(!isBotActionWindow(lastG, seat)) break;
    const candidates = enumerateAllLegalOneStepActions(lastG, seat);
    if(!candidates.length) break;
    candidates.forEach((c,i)=>{ c.index=i; });
    let idx = null;
    if(aiReady && candidates.length>1){
      const state = buildBotVisibleState(lastG, seat);
      state.windowStep = steps;
      idx = await callAiChooseIndex({
        g: lastG, seat,
        systemPrompt: buildBotDefaultSystemPrompt()
          + '你处于同一出牌窗口的连续决策,每步只选一个完整合法动作(牌+目标已合并)。'
          + '你上一步执行后局面已经变化,请根据最新局面继续选择,直到选择结束出牌。',
        userPrompt: buildBotDefaultUserPrompt(state, candidates),
        candidates, maxTokens: 100,
      });
    } else if(candidates.length===1){
      idx = 0;
    }
    let choice;
    if(idx===null){
      choice = localFallbackPlayWindow(lastG, seat, candidates);
    } else {
      choice = candidates[idx];
    }
    const newG = await executePlayWindowChoiceAwait(lastG, seat, choice);
    steps++;
    if(choice && (choice.isEndPlay || choice.action==='结束出牌阶段')) break;
    // 无密钥:执行一步即返回(与弱C逐字一致);有密钥:等提交回调,拿不到新快照就 break
    if(!aiReady) return;
    if(!newG || newG===lastG) break;
    lastG = newG;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**（6 项新断言 + 既有 19 项回归）

- [ ] **Step 5: 全量回归 + `?v=279→280` + Commit**

```bash
node run_ai_bus_c_window_test.js && node run_ai_bus_core_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node --check bot.js
git add bot.js run_ai_bus_c_window_test.js index.html
git commit -m "feat(bot): 强C同窗多步循环(有密钥)+提交回调等待"
git push origin wenwen_dev
```

---

### Task SC3: 强C 验收 + progress-log-8 新建

**Files:**
- Create: `docs/progress-log-8.md`（首批条目）
- Modify: 无代码（除非回归）

- [ ] **Step 1: 全量回归**（同 SC2 命令 + info/l1/model_picker + 仓库套件）

- [ ] **Step 2: 验收门核对**

- [ ] 强C：一次 `runBotActionWindow` 内 mock 两步（拆→杀）连续（测试断言）
- [ ] 无密钥：执行一步即返回（弱C 逐字，测试断言）
- [ ] 回调兼容：不传 onCommitted 的既有调用零变化（既有测试全绿）
- [ ] maxSteps=8 上限生效（测试断言）；5s 超时兜底存在
- [ ] `?v=280` 已 push

- [ ] **Step 3: 新建 `docs/progress-log-8.md`**（格式沿用既有：`- **标题**：内容`）

内容：强C 交付——tx/playCard/endPlay 可选提交回调（兼容性）、runBotActionWindow 循环（无密钥短路、newG===lastG break、5s 超时）、stub 升级为 Promise 模式、测试计数、`?v=280`。

```bash
git add docs/progress-log-8.md
git commit -m "docs: 强C交付记录(progress-log-8)"
git push origin wenwen_dev
```

---

# Part B：信息层

### Task I1: 弃牌堆/牌堆/射程投影

**Files:**
- Modify: `bot.js` — `buildBotVisibleState`（~390 区域）
- Modify: `run_ai_bus_info_test.js`

**Interfaces:**
- Produces: `buildBotVisibleState` 顶层新增 `discardPile: {count, byName}`、`deckLeft: number`、`myAttackRange: number`

- [ ] **Step 1: 写失败测试**

```js
// 1) g.discard = [杀,闪,桃] → discardPile = {count:3, byName:{杀:1,闪:1,桃:1}}
// 2) g.discard = [] → discardPile = {count:0, byName:{}}
// 3) g.deck 5 张 → deckLeft === 5
// 4) 装 range3 武器 → myAttackRange === 3;无武器 → 1
```

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// 在 buildBotVisibleState 返回对象顶层加:
discardPile: (function(){
  const byName = {};
  (g.discard||[]).forEach(function(c){ if(c && c.name) byName[c.name] = (byName[c.name]||0)+1; });
  return { count: (g.discard||[]).length, byName: byName };
})(),
deckLeft: (g.deck||[]).length,
myAttackRange: attackRange(g, seat),
```

- [ ] **Step 5: 回归 + `?v=280→281` + Commit**

```bash
node run_ai_bus_info_test.js && node run_ai_bus_core_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node run_ai_bus_c_window_test.js && node --check bot.js
git add bot.js run_ai_bus_info_test.js index.html
git commit -m "feat(bot): AI可见状态 弃牌堆/牌堆剩余/攻击射程"
git push origin wenwen_dev
```

---

### Task I2: desc 全量 + recentLog 20 条

**Files:**
- Modify: `bot.js` — `buildBotVisibleState`
- Modify: `run_ai_bus_info_test.js`

**Interfaces:**
- Produces: `generalDesc` 不再截断（全量）；`recentLog` 10→20 条

- [ ] **Step 1: 写失败测试（更新既有 desc 断言，规则 20）**

```js
// 1) 构造 >120 字 desc 的 general(测试内临时改 GENERALS 或用现成长 desc 武将)→
//    JSON 里出现完整 desc 尾部(截断则断言失败)
// 2) g.log 30 条 → recentLog.length === 20 且末项对齐
// 3) 既有"desc 截断 120"断言更新为"全量"(旧断言命题已变,按规则 20 修正)
```

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// generalDesc 行从 slice(0,120) 改为全量:
generalDesc: (p.general && typeof GENERALS!=='undefined' && GENERALS[p.general])
  ? String(GENERALS[p.general].desc||'') : undefined,
// recentLog 从 slice(-10) 改为 slice(-20):
recentLog: (g.log||[]).slice(-20).map(e => (e && typeof e==='object') ? e.text : String(e==null?'':e)),
```

- [ ] **Step 5: 回归 + `?v=281→282` + Commit**

```bash
node run_ai_bus_info_test.js && node run_ai_bus_core_test.js && node --check bot.js
git add bot.js run_ai_bus_info_test.js index.html
git commit -m "feat(bot): AI可见状态 desc全量与recentLog 20条"
git push origin wenwen_dev
```

---

### Task I3: 信息层验收 + progress-log-8 追加

**Files:**
- Modify: `docs/progress-log-8.md`（追加第二批条目）

- [ ] **Step 1: 全量回归**（全部 AI-bus 套件 + 仓库套件 + node --check）

- [ ] **Step 2: 验收门核对**

- [ ] 五项字段（discardPile/deckLeft/myAttackRange/desc 全量/recentLog 20）全部出现在 `buildBotVisibleState` 输出（测试断言）
- [ ] token 增量实测：打印 userPrompt 长度对比（改动前后）≤ 合理增量（记录数值）
- [ ] guhuo actualCard 隐藏信息回归绿；无密钥回归绿
- [ ] `?v=282` 已 push

- [ ] **Step 3: progress-log-8.md 追加信息层条目**（五项字段、recentLog 10→20 理由、token 实测、`?v=282`、测试计数）

```bash
git add docs/progress-log-8.md
git commit -m "docs: 信息层增强交付记录"
git push origin wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| A2.1 tx 回调 | SC1 |
| A2.2 playCard/endPlay 透传 | SC1 |
| A3 runBotActionWindow 循环 | SC2 |
| A4 无密钥不循环 / 并发沿用 / 5s 超时 | SC2（测试断言） |
| A5 测试（stub Promise + 6 断言） | SC1/SC2 |
| A6 不做（respond* 不加回调等） | 各 Task 明确不做 |
| B2.1-2.3 discardPile/deckLeft/myAttackRange | I1 |
| B2.4-2.5 desc 全量/recentLog 20 | I2 |
| B3 信息层测试 | I1/I2 |
| 验收 + progress-log-8 新建 | SC3/I3 |

## Placeholder 扫描

- SC2 的 5s 超时：常量在函数内（可注入测试用较小值——实现时若测试真实等待 5s 太慢，把 `5000` 提为模块级 `const BOT_COMMIT_TIMEOUT_MS = 5000` 供测试覆盖，报告说明）
- 所有代码块为完整实现，无开放式 TODO

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；SC3 与 I3 各自验收后执行。
