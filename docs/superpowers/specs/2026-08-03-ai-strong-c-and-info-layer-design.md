# AI 智能增强：强 C（同窗多步）+ 信息层增强 设计

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：待用户审阅

**前置**：AI 可操作面决策总线（B+C 弱C）+ 第一批扩展（L3 座位卡/高价值响应，T1-T10 已交付，93 测试全绿）。本设计是第二批（强 C）与第三批（信息层）的合并规格——**强 C 先实现**（Part A），信息层随后（Part B）。

---

# Part A：强 C —— 同窗口多步连续决策

## A1. 背景与目标

**现状（弱C，C1 交付）**：`tx` 是 fire-and-forget，`playCard` 提交后本地 `currentG` 不同 tick 更新，因此 `runBotActionWindow` 每次调度只执行一步，多步组合（拆马→杀）靠 `scheduleBotTurn` 跨调度推进。缺点：步间延迟（debounce 0.65-1.15s + Firebase 往返）、每步是独立决策。

**目标（强C）**：`runBotActionWindow` 恢复循环——execute 后**拿到提交后的新快照**，重枚举合法动作，同一次调度内连续 AI 决策，直到 `endPlay`/`maxSteps`/窗口失效。让模型看到自己上一步造成的新局面再选下一步，真正"连打一套"。

**用户已确认**：强C 需要动 `game.js` 核心事务层（tx 加回调），已获许可（"都做"）。

## A2. 核心机制：tx 提交回调

### A2.1 `tx(fn, onCommitted?)`（game.js，可选第二参数，向后兼容）

```js
function tx(fn, onCommitted){
  const actingSeat = mySeat;
  const p = gameRef.transaction(g => {
    if(!g) return g;
    const visibleSeat = mySeat;
    mySeat = actingSeat;
    try{
      normalize(g);
      pruneExchangeCards(g);
      const result = fn(g) || g;
      tryFlushLianying(result);
      return stripUndefined(result);
    } finally {
      mySeat = visibleSeat;
    }
  });
  // 【强C新增】可选提交回调:Firebase transaction 返回 Promise(真实 SDK 行为),
  // resolve 后把提交成功的快照 g 交给 onCommitted(供机器人拿新状态继续同窗循环)。
  // 不传 onCommitted 时行为与改动前逐字一致(fire-and-forget,返回值被忽略)。
  if(typeof onCommitted === 'function' && p && typeof p.then === 'function'){
    p.then(function(res){
      const snap = res && res.snapshot && typeof res.snapshot.val === 'function' ? res.snapshot.val() : null;
      onCommitted(snap);
    }, function(){ onCommitted(null); });
  }
  return p;
}
```

**兼容性**：所有现有调用点不传第二参 → 行为零变化（测试锁定）。`gameRef.transaction` 的 vm stub 当前返回 `{}`（无 then）→ 回调分支不触发 → 既有测试不受影响；强C 测试的 stub 升级为返回 `Promise.resolve({snapshot:{val:()=>resultG}})`（见 A6）。

### A2.2 动作函数透传（最小改动面）

只给强C 需要的两个入口加可选回调透传，**其余动作函数不动**：

- `playCard(cardIdx, actionId, targetSeat, onCommitted?)`：内部 `tx(g=>{...}, onCommitted)`
- `endPlay(onCommitted?)`：内部 `tx(g=>{...}, onCommitted)`

现有调用点（真人 UI/旧 bot 路径）不传第四参 → 行为零变化。

**不做**：不给 30+ 个 `respond*`/技能函数加回调（响应类一步决策不需要强C 循环；第一批已交付的决策点保持现有弱C/单步行为）。强C 循环只覆盖出牌阶段（`runBotActionWindow` 的既有窗口）。

## A3. `runBotActionWindow` 升级（bot.js）

```js
const BOT_WINDOW_MAX_STEPS = 8; // 既有常量,强C下真正生效

async function runBotActionWindow(g, seat){
  let steps = 0;
  let lastG = (typeof currentG !== 'undefined' && currentG) ? currentG : g;
  while(steps < BOT_WINDOW_MAX_STEPS){
    if(!isBotActionWindow(lastG, seat)) break;
    const candidates = enumerateAllLegalOneStepActions(lastG, seat);
    if(!candidates.length) break;
    candidates.forEach((c, i) => { c.index = i; });
    let idx = null;
    const aiReady = typeof aiApiKey !== 'undefined' && aiApiKey && aiProvider;
    if(aiReady && candidates.length > 1){
      const state = buildBotVisibleState(lastG, seat);
      state.windowStep = steps;
      idx = await callAiChooseIndex({ g: lastG, seat,
        systemPrompt: buildBotDefaultSystemPrompt()
          + '你处于同一出牌窗口的连续决策,每步只选一个完整合法动作(牌+目标已合并)。'
          + '你上一步执行后局面已经变化,请根据最新局面继续选择,直到选择结束出牌。',
        userPrompt: buildBotDefaultUserPrompt(state, candidates),
        candidates, maxTokens: 100 });
    } else if(candidates.length === 1){
      idx = 0;
    }
    let choice;
    if(idx === null) choice = localFallbackPlayWindow(lastG, seat, candidates);
    else choice = candidates[idx];
    // 执行并等待提交回调(强C关键:拿到新快照才继续)
    const newG = await executePlayWindowChoiceAwait(lastG, seat, choice);
    steps++;
    if(choice && (choice.isEndPlay || choice.action === '结束出牌阶段')) break;
    // 提交成功拿到新快照 → 继续循环;失败(null)或快照未变 → break 交回调度
    if(!newG || newG === lastG) break;
    lastG = newG;
  }
}
```

**`executePlayWindowChoiceAwait(g, seat, choice)`**：包一层 Promise，`botInvoke` 内调 `playCard(..., onCommitted)` / `endPlay(onCommitted)`，resolve 提交回调给的快照；无回调参数/回调未触发时 5s 超时 resolve null（防 stub/异常环境挂死）。

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
    // endPlay/playCard 内部 tx 不传回调的场景(stub 无 then):5s 超时兜底
  });
}
```

## A4. 并发与安全（沿用既有机制，不新造）

| 关注点 | 处理 |
|--------|------|
| 循环期间并发调度 | `botDecisionInFlight` 在 `scheduleBotTurn` 定时器回调里包住整个 `await runBotDecision`（含强C循环）→ 期间其他调度被丢弃；`botMissedSchedule` 机制在循环结束、标志位清零后自动补查——既有机制天然覆盖，零新增代码 |
| 别人操作插入 | 每次 `onCommitted` 拿到的快照是 Firebase 最新状态 → 若别人动了导致 `isBotActionWindow` 失效（turn 变/pending 出现/结束）→ break；若仍有效（别人出牌阶段之前的操作不影响自己窗口）→ 正常继续。以快照为准，无竞态 |
| 服务端拒绝（我提交非法动作） | Firebase transaction 回调返回相同值 → 快照可能无变化或状态微变；`newG === lastG` 引用相同 → break（降级为弱C 跨调度） |
| `mySeat` | `executePlayWindowChoiceAwait` 内 `botInvoke` 借用窗口同步、await 在 Promise 层（不跨 mySeat 借用）；循环其他部分只读 `lastG`/`seat` 参数，不碰 mySeat |
| 无密钥 | 每步 `localFallback`（同现状）；仍走 `executePlayWindowChoiceAwait` 等待提交（无密钥时本地 stub 无 then → 超时 5s？**太慢**——见 A6 优化：无密钥路径判断 `!aiReady` 时不等待提交，执行后直接 break（= 弱C 行为），只有有密钥才启用强C 循环。**这是已确认的设计决定**） |

**关键设计决定（无密钥）**：强C 循环只在 `aiReady` 时启用。无密钥时 `runBotActionWindow` 执行一步后直接 return（与现弱C 行为逐字一致），不等待提交、不循环——无密钥行为零变化，回归红线守住。

## A5. 测试（扩展 run_ai_bus_c_window_test.js + 新 stub）

**stub 升级**：`run_ai_bus_c_window_test.js` 的 `gameRef.transaction` 从"同步 fn({})"改为可配置的 Promise 模式：

```js
gameRef: {
  __txSnapshot: null, // 测试设置:提交后 onCommitted 收到的快照
  transaction: function(fn){
    var result = fn(context.g || {}); // 同步执行 tx 逻辑
    var snap = gameRef.__txSnapshot || result; // 默认把 fn 的返回值当快照
    return Promise.resolve({ snapshot: { val: function(){ return snap; } } });
  },
}
```

断言（新增）：
1. **强C 循环**：mock 两步——step1 拆桥（`playCard` spy 带 onCommitted，stub 快照=拆后状态）→ 循环内 step2 杀（`playCard` spy 第二次）→ 结束出牌。断言：**一次 `runBotActionWindow` 调用内**连续两次 playCard、两次 AI 询问（`windowStep` 0 和 1）、`BOT_WINDOW_MAX_STEPS` 未超。
2. **endPlay 终止**：mock 选结束 → `endPlay` spy 带 onCommitted → break，循环不再继续。
3. **快照失效 break**：stub 快照返回 turn 已变/pending 出现的状态 → 循环 break，不执行下一步。
4. **提交失败 break**：stub 返回 null → 循环 break，不挂死。
5. **无密钥**：`aiApiKey=''` → 只执行一步（fallback），不等待提交、不循环（`playCard` spy 恰 1 次）；`executePlayWindowChoiceAwait` 在无密钥路径不被调用或立即返回。
6. **maxSteps 上限**：构造每步后快照仍有效但 AI 永不选结束的 mock 序列 → 恰 8 步后停。
7. **超时兜底**：stub transaction 返回永 unresolved 的 Promise → 5s 超时 resolve null → break（测试中把 5s 常量改为可注入的小值，或接受真实 5s 等待并标注）。
8. **回归**：既有 c_window 15 项（弱C 语义在无密钥路径保留）+ 全部 AI-bus 套件 + `node --check`。

## A6. 明确不做

- 不给 30+ 个 `respond*`/技能函数加提交回调（响应类保持单步）。
- 不改 `tx` 的既有 fire-and-forget 语义（可选参数兼容）。
- 强C 循环不覆盖响应阶段（`isBotActionWindow` 仍是 play 窗口谓词）。
- 不引入轮询/事件订阅（快照来自 Firebase transaction Promise，确定性强）。

---

# Part B：信息层增强（第二批交付后执行）

## B1. 现状与目标

第一批已交付：技能常开（desc 截 120）、recentLog（10 条）、myFlags、牌面、suspicionHint。本批补 5 项（用户确认全做），全部只改 `buildBotVisibleState` 投影层 + 相应测试，**不改 game.js/skills.js 业务逻辑、不进 Firebase**。

## B2. 五项增强

| # | 项 | 实现 | 隐藏信息边界 |
|---|----|------|-------------|
| B2.1 | **弃牌堆投影** | `discardPile: { count: g.discard.length, byName: {牌名:数量} }`（遍历 g.discard 统计；公开信息） | 弃牌堆是公开信息（牌名全可见），无隐藏 |
| B2.2 | **牌堆剩余** | `deckLeft: (g.deck || []).length`（公开信息） | 公开 |
| B2.3 | **攻击距离解释** | 顶层加 `myAttackRange: attackRange(g, seat)`；`players[].distance` 已有——AI 可直接算"距离≤射程"。可选加 `reachableTargets` 列表（能杀到谁），复用 `canReachSha` | 公开 |
| B2.4 | **desc 去截断** | `generalDesc` 截断 120 → **全量**（`String(GENERALS[p.general].desc||'')`）；token 预算评估：全量 desc 通常 30-80 字/将，7 人局 ~7×80=560 字 ≈ 150 tokens，可接受 | 公开 |
| B2.5 | **跨回合记忆（roundSummary）** | `roundSummary: 最近 3 回合的关键事件摘要`——从 `g.log` 按 roundNum 聚类：每回合取最近 3 条（伤害/救/锦囊类，用既有文案即可，不新造事件流）；格式 `{round: N, events: [text, ...]}` 数组，最多 3 回合 × 3 条 = 9 条 | 日志是公开信息；不新增隐藏 |

**B2.5 实现细节**：`g.log` 条目是 `{seq, text}`，**没有 roundNum 字段**。方案：不重新聚 round——改为 `recentLog` 从 10 条扩到 **20 条**（token 增加有限，~20×15 字 ≈ 300 字 ≈ 80 tokens），并在每条前不加 round 标记（保持文本原样）。**这是对 spec 早期草案"按 round 聚类"的简化修正**：log 无 round 元数据，强行聚类要么改 log 结构（进 Firebase，需 normalize 防御，收益低）要么按 seq 猜（不可靠）。**决定：recentLog 10→20 条**，实现简单、覆盖约 1-2 回合、零结构改动。

## B3. 测试

- discardPile：弃 3 张不同名牌 → `{count:3, byName:{杀:1,闪:1,桃:1}}`；空弃牌堆 → `{count:0, byName:{}}`
- deckLeft：deck 5 张 → 5
- myAttackRange：装武器 range3 → 3；无武器 → 1
- desc 全量：构造长 desc（>120 字）→ JSON 里出现完整 desc 尾部（截断则断言失败）
- recentLog 20 条：30 条 log → `recentLog.length===20` 且末项对齐
- 隐藏信息回归：guhuo 无 actualCard 断言继续绿
- 既有 info 测试 5 项更新（desc 截断断言 → 全量断言，规则 20）

---

## 验收标准（A+B）

1. **强C**：有密钥时 mock 序列证明"同一次调度内 拆→杀→结束"三步连续（AI 调用 2 次、windowStep 0/1）；无密钥只执行一步（弱C 行为逐字）。
2. **信息层**：5 项字段全部出现在 `buildBotVisibleState` 输出；token 增量 ≤200（实测打印 userPrompt 长度对比）。
3. 无密钥回归红线、隐藏信息红线、`?v=` 同步、progress-log 记录（**progress-log-7 已 157KB，本次须新建 progress-log-8.md**）。
4. 无新增按武将 id 的 AI 分支。

## 实现顺序

强C（A 部分）先：改动 game.js（tx/playCard/endPlay 回调）+ bot.js（runBotActionWindow 循环）+ 测试 stub 升级 → 验收。信息层（B 部分）后：只改 buildBotVisibleState + 测试 → 验收。两批各自独立 commit。

---

## 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 强C 回调向后兼容（可选参数，既有调用零变化）
- [x] 无密钥路径明确不启用强C 循环（回归红线）
- [x] 信息层 5 项均为公开信息投影，隐藏红线不破
- [x] recentLog 10→20 的简化修正已记录理由（log 无 round 元数据）
- [x] progress-log-8.md 新建要求已明确
- [x] 用户已确认：都做（强C 先）
