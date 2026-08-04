# A 类补角批次 Implementation Plan（A1-A8，三批）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 A 类剩余缺口：批1 四项决策覆盖（骁果路径A/铁索双目标/借刀响应/恩怨选牌）、批2 信息层（嫌疑事件流/方天画戟探索）、批3 机制（多张仁德/机器人兜底完整性）。

**Architecture:** 全部沿用既有总线模式：A1/A5/A4 专用注册（`BOT_DECISIONS` + `BOT_PHASE_ACTOR` 登记 + EXCLUDE 调整）、A2 候选扩展（单目标+双目标组合）、A6 复用 `botTwoStepA` 跨调度、A7 新持久化数组（normalize 防御）、A8 盲区扫描修补。A9 ReAct 与 A8(b) 整局超时明确不做。

**Tech Stack:** 纯静态多文件 JS（无构建）；vm 沙箱测试（`run_ai_bus_l3_test.js`/`run_ai_bus_l1_test.js`/`run_ai_bus_info_test.js`）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-a-class-completion-design.md`

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送（push 走 https 覆盖：`git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev`——SSH 443 不可达）
- **无密钥回归红线**：每个注册项 `localFallback` = 改动前本地逻辑**逐字**（测试锁定）
- **EXCLUDE 纪律**：新增专用注册时，按需调整 `CONTROLS_CHOICE_EXCLUDE`（A1 移除 xiaoguo、A5 保留 jiedaoChoice）；调整必须测试锁定
- **BOT_PHASE_ACTOR 纪律**：新增阶段分支/注册项必须登记（不登记则行动者解析恒 -1）
- **normalize 纪律**：A7 新数组字段必须防御（CLAUDE.md 规则 6）
- **隐藏信息**：A7 事件只含公开字段；不泄露手牌
- **`?v=`**：改动 bot.js/game.js 时全部 13 处同步 +1（当前基线 290）
- **测试**：vm 加载真实源码；`let` 变量用 `vm.runInContext('x=...')`；函数声明可替换 spy
- **收尾**：progress-log-8 追加（最新分段，当前 ~19KB <150KB）
- **执行顺序**：批1（A1→A2→A5→A4）→ 批2（A7→A3探索）→ 批3（A6→A8），各自独立 commit

---

## File map

| File | Responsibility |
|------|----------------|
| `bot.js` | A1/A5/A4 专用注册 + A2 候选扩展 + A6 botTwoStepA 扩展 + A7 投影 + A8 兜底修补 |
| `game.js` | A7 `g.aiSuspicionEvents` normalize + A1/A5 服务函数核实（不改逻辑，只核实签名） |
| `run_ai_bus_l3_test.js` | 批1 测试（骁果/铁索/借刀/恩怨） |
| `run_ai_bus_info_test.js` | 批2 测试（嫌疑事件流） |
| `run_ai_bus_l1_test.js` | 批3 测试（A8 盲区） |
| `index.html` | `?v=` 同步（290→291→292→293…） |
| `docs/progress-log-8.md` | 各批收尾追加 |

---

# A-批1：决策覆盖

### Task A1: 骁果路径 A（专用注册）

**Files:**
- Modify: `bot.js` — `BOT_DECISIONS.xiaoguo` 注册、EXCLUDE 移除 `'xiaoguo'`、`BOT_PHASE_ACTOR` 登记 `xiaoguo:'asking'`、runBotDecision 接线
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.xiaoguo`（match/buildCandidates/localFallback/execute）
- Consumes: `respondXiaoguo(activate, cardIdx)`（skills.js:1660，单步可提交）、`BASIC_CARDS`（全局）、`advanceXiaoguo`（服务端内部）

- [ ] **Step 1: 写失败测试**

1. match：phase==='xiaoguo' && pending.type==='xiaoguo' && pending.asking===seat
2. buildCandidates：手牌 [杀,闪,桃,无中生有] → 候选 = 3 项基本牌（杀/闪/桃，label 含牌名）+ 恒有「不发动」项
3. 有密钥 mock 选「弃【杀】发动」→ `respondXiaoguo(true, 杀的下标)` spy
4. 无密钥 → fallback 不发动 → `respondXiaoguo(false)` spy（→ advanceXiaoguo 推进，与 EXCLUDE 时行为逐字）
5. EXCLUDE 调整：`CONTROLS_CHOICE_EXCLUDE.has('xiaoguo')===false`（已移除）；`'xiaoguoChoice'` 保留与否按核实（若 renderControls 按钮可被 L1 收集则移除让它走 L1，否则保留）
6. BOT_PHASE_ACTOR：`xiaoguo:'asking'` 已登记
7. runBotDecision 接线：全链 g → botDecide('xiaoguo') 执行

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// ============ A类补角:xiaoguo(乐进骁果,路径A) ============
BOT_DECISIONS.xiaoguo = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='xiaoguo' && d && d.type==='xiaoguo' && d.asking===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    (me.hand||[]).forEach(function(c, i){
      if(BASIC_CARDS.includes(c.name)) out.push({ cardIdx: i, activate: true, label: '弃【'+c.name+'】发动' });
    });
    out.push({ cardIdx: null, activate: false, label: '不发动' });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 不发动(与 EXCLUDE 时行为一致:机器人不发动,advanceXiaoguo 推进)
    return candidates.find(function(c){ return !c.activate; }) || candidates[candidates.length-1];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondXiaoguo(!!choice.activate, choice.cardIdx); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。当前是【骁果】发动询问:候选列表每一项是'
      +'"弃一张基本牌发动"或"不发动"。请结合局面决定是否发动。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};
```

EXCLUDE 调整：`CONTROLS_CHOICE_EXCLUDE.delete('xiaoguo')`（移除；`'xiaoguoChoice'` 按核实决定）。
`BOT_PHASE_ACTOR`：加 `xiaoguo:'asking'`。
runBotDecision 接线：在响应注册区加 `if(g.phase==='xiaoguo' && d && d.type==='xiaoguo' && d.asking===seat){ if(await botDecide('xiaoguo', g, seat)) return; }`（**注意位置**：需在 L1 controlsChoice 之前或保留 EXCLUDE——因已从 EXCLUDE 移除 xiaoguo，接线必须**先于** controlsChoice，否则有密钥时 L1 抢先。核实 controlsChoice 在 runBotDecision 的位置 ~2740，把 xiaoguo 分支放其前）。

- [ ] **Step 5: 回归 + `?v=290→291` + Commit**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_l1_test.js && node run_ai_bus_c_window_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js run_ai_bus_l1_test.js index.html
git commit -m "feat(bot): A1骁果路径A专用注册(EXCLUDE移除+PHASE_ACTOR登记)"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task A2: 铁索连环双目标候选

**Files:**
- Modify: `bot.js` — `enumerateAllLegalOneStepActions` 铁索分支
- Modify: `run_ai_bus_c_window_test.js`

**Interfaces:**
- Produces: 铁索候选 = 单目标 + 双目标组合（≤10 组合防膨胀）
- Consumes: `CARD_PLAYS['铁索连环']`（target:true, allowSelf:true，effect 接受数组）、`playCard(idx,'铁索连环',[t1,t2])`（game.js:2814 接受数组）

- [ ] **Step 1: 写失败测试**

1. 铁索在手 + 3 个合法目标（含自己？allowSelf）→ 候选含单目标 3 项 + 双目标组合 3 项（C(3,2)）+ 结束项
2. 有密钥 mock 选双目标组合 → `playCard(idx, '铁索连环', [t1,t2])` spy 收到数组
3. 无密钥 fallback 零变化：单目标最高分项选择与改动前一致（构造明确最高分单目标，断言 fallback 选它——**注意**：双目标组合分数=两目标分数之和可能更高，无密钥 fallback 可能选双目标项 → playCard 传数组即可，行为合法；测试锁定"fallback 选中后 playCard 收到对应 target（单目标=数字/双目标=数组）"）
4. 组合数上限：6 个合法目标 → 双目标组合 C(6,2)=15 → 截断到 ≤10（按目标分数降序）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

在 `enumerateAllLegalOneStepActions` 的 target 展开处，对 `action==='铁索连环'` 特判（**不算按武将特判，是按牌名——允许**；或更通用：`spec.allowMultiTarget` 未来扩展）：

```js
// 铁索连环:单目标 + 双目标组合(真人可点1-2目标,组合≤10防膨胀)
if(action==='铁索连环'){
  const targets = [];
  g.players.forEach(function(p, i){
    if(!p || !p.alive || i===seat) return;
    if(spec.canTarget && !spec.canTarget(g, me, card, i)) return;
    targets.push(i);
  });
  if(spec.allowSelf && spec.canTarget && spec.canTarget(g, me, card, seat)) targets.push(seat);
  // 单目标项(分数=botTargetScore)
  targets.forEach(function(t){
    out.push({ label: '出【铁索连环】→'+g.players[t].name, action, card: botCardBrief(card), handIndex: idx, target: t, localHeuristicScore: botCardPriority(action) + botTargetScore(g, seat, t, action) });
  });
  // 双目标组合(分数=两目标之和;按分数降序截断到10)
  const pairs = [];
  for(let a=0; a<targets.length; a++){
    for(let b=a+1; b<targets.length; b++){
      const score = botTargetScore(g, seat, targets[a], action) + botTargetScore(g, seat, targets[b], action);
      pairs.push({ t1: targets[a], t2: targets[b], score: score });
    }
  }
  pairs.sort(function(x,y){ return y.score - x.score; });
  pairs.slice(0, 10).forEach(function(pair){
    out.push({ label: '出【铁索连环】→'+g.players[pair.t1].name+'+'+g.players[pair.t2].name, action, card: botCardBrief(card), handIndex: idx, target: [pair.t1, pair.t2], localHeuristicScore: botCardPriority(action) + pair.score });
  });
} else if(spec.target){ ... 既有展开不变 ... }
```

**注意**：现有代码结构是 `if(spec.target){ ...展开... }`——铁索分支需在通用展开**之前**特判（或内嵌条件）。execute 路径 `executePlayWindowChoiceAwait` 已把 `choice.target` 原样传给 `playCard(handIndex, action, target)`——数组会被 `playCard` 的 `Array.isArray(targetSeat)` 分支处理（game.js:2814 已核实），**零改动**。

- [ ] **Step 5: 回归 + `?v=291→292` + Commit**

```bash
node run_ai_bus_c_window_test.js && node run_ai_bus_l2_test.js && node run_ai_bus_l3_test.js && node --check bot.js
git add bot.js run_ai_bus_c_window_test.js index.html
git commit -m "feat(bot): A2铁索连环双目标候选(单目标+组合≤10)"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task A5: 借刀响应侧（jiedaoChoice 专用注册）

**Files:**
- Modify: `bot.js` — `BOT_DECISIONS.jiedaoResponse`、runBotDecision 接线
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.jiedaoResponse`
- Consumes: `respondJiedao(useSha, cardIdx)`（game.js:2949——**实现时先核实第 2 参语义**：旧分支只传 1 参，cardIdx 可能可选）

- [ ] **Step 1: 写失败测试**

1. match：phase==='jiedaoChoice' && pending.type==='jiedaoChoice' && pending.seatA===seat
2. buildCandidates：有可转化杀 → [出杀, 弃武器]；无杀/将驰禁杀 → [弃武器]
3. 有密钥 mock 选弃武器 → `respondJiedao(false)` spy
4. 无密钥 → fallback 旧逻辑逐字（`canBotPlaySha(p) && findUsableAs(手牌,'杀')>=0`）→ `respondJiedao(bool)` spy
5. BOT_PHASE_ACTOR 已登记 `jiedaoChoice:'seatA'`（核实存在）
6. EXCLUDE 保留 `'jiedaoChoice'`（专用注册分支若在 L1 之前则无需动；核实位置，若 L1 更早则保留 EXCLUDE 防抢——**实现时确认**）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// ============ A类补角:jiedaoResponse(借刀响应侧) ============
BOT_DECISIONS.jiedaoResponse = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='jiedaoChoice' && d && d.type==='jiedaoChoice' && d.seatA===seat;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const canSha = canBotPlaySha(p) && findUsableAs(p.hand, p, '杀') >= 0;
    const out = [];
    if(canSha) out.push({ play: true, cardIdx: findUsableAs(p.hand, p, '杀'), label: '打出【杀】' });
    out.push({ play: false, cardIdx: null, label: '弃置武器' });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:canBotPlaySha(p) && findUsableAs(手牌,'杀')>=0
    const p = g.players[seat];
    const play = canBotPlaySha(p) && findUsableAs(p.hand, p, '杀') >= 0;
    return candidates.find(function(c){ return c.play === play; }) || candidates[candidates.length-1];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondJiedao(!!choice.play, choice.cardIdx); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。你被【借刀杀人】要求对目标使用【杀】:候选为'
      +'"打出【杀】"或"弃置武器"。请结合局面决定。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};
```

runBotDecision 接线：替换旧分支 `if(g.phase==='jiedaoChoice'&&d.seatA===seat){ botInvoke(seat,()=>respondJiedao(...)); return; }` 为 `if(await botDecide('jiedaoResponse', g, seat)) return;`（保留 phase 守卫）。

- [ ] **Step 5: 回归 + `?v=292→293` + Commit**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_l1_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): A5借刀响应侧专用注册"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task A4: 恩怨选牌维度（enyuanGiveCard 注册）

**Files:**
- Modify: `bot.js` — `BOT_DECISIONS.enyuanGiveCard`、runBotDecision 接线
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.enyuanGiveCard`
- Consumes: `giveEnyuanCard(cardIndex)`（game.js:6795）；`chooseEnyuanOption('giveCard')` 后服务端进入 enyuanGiveCard 阶段（实现时核实 game.js:6756-6810 流程）

- [ ] **Step 1: 写失败测试**

1. match：phase==='enyuanGiveCard' && pending.damagerSeat===seat（**实现时核实 pending 字段名**——可能 `pending.seat` 或 `pending.damagerSeat`，照服务端守卫）
2. buildCandidates：手牌红桃每张一项（label 含牌名）
3. 有密钥 mock 选第 2 张红桃 → `giveEnyuanCard(idx)` spy
4. 无密钥 → fallback 第一张红桃（旧逻辑 `findIndex(c=>c.suit==='♥')`）
5. 无红桃 → 候选空（服务端不会进入该阶段？核实守卫）
6. BOT_PHASE_ACTOR 已登记（核实 `enyuanGiveCard` 表项）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
BOT_DECISIONS.enyuanGiveCard = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='enyuanGiveCard' && d && d.type==='enyuanGiveCard' && d.damagerSeat===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const out = [];
    (me.hand||[]).forEach(function(c, i){
      if(c && c.suit==='♥') out.push({ cardIdx: i, label: '给【'+c.name+'】' });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 旧逻辑:第一张红桃
    return candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ giveEnyuanCard(choice.cardIdx); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。你选择给法正一张红桃手牌:候选为每张红桃。'
      +'请结合手牌价值选择。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 60,
};
```

runBotDecision 接线：替换旧分支 `if(g.phase==='enyuanGiveCard'&&d.damagerSeat===seat){ const heart=(p.hand||[]).findIndex(c=>c.suit==='♥'); botInvoke(seat,()=>giveEnyuanCard(heart)); return; }` 为 `if(await botDecide('enyuanGiveCard', g, seat)) return;`（保留 phase 守卫；**注意旧分支 heart=-1 时也调用**——专用注册候选空时 botDecide false → 走后续分支/兜底，需确认等价：服务端守卫应保证有红桃才进入该阶段，核实）。

- [ ] **Step 5: 回归 + `?v=293→294` + Commit**

```bash
node run_ai_bus_l3_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): A4恩怨选牌维度(enyuanGiveCard专用注册)"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

# A-批2：信息层

### Task A7: 嫌疑事件流（g.aiSuspicionEvents）

**Files:**
- Modify: `game.js` — normalize 防御 + 写入点（`recordBotDamageEvidence`/`recordBotRescueEvidence` 在 bot.js——实际写入在 bot.js）
- Modify: `bot.js` — `recordBotDamageEvidence`/`recordBotRescueEvidence` 内 push + `buildBotVisibleState` 投影
- Modify: `run_ai_bus_info_test.js`

**Interfaces:**
- Produces: `g.aiSuspicionEvents`（数组，最近 20 条，`{round, source, target, amount, kind:'damage'|'rescue'}`）、`buildBotVisibleState.recentSuspicionEvents`（最近 10 条）
- Consumes: `recordBotDamageEvidence(g,sourceSeat,targetSeat,amount,srcType)`（bot.js:237）、`recordBotRescueEvidence(g,rescuerSeat,dyingSeat)`（bot.js:248）

- [ ] **Step 1: 写失败测试**

1. `recordBotDamageEvidence(g, 1, 0, 2, 'sha')`（身份局）→ `g.aiSuspicionEvents` 尾部 = `{round, source:1, target:0, amount:2, kind:'damage'}`
2. `recordBotRescueEvidence(g, 2, 0)` → 尾部 `{kind:'rescue', rescuer:2, dying:0}`（**字段名定稿**：rescue 用 `source:rescuer, target:dying` 统一）
3. 超过 20 条 → 最早的被覆盖（长度恒 ≤20）
4. normalize：脏数据（非数组/字段非法）→ 防御清洗后正常
5. `buildBotVisibleState` 投影 `recentSuspicionEvents` 长度 ≤10 且末项对齐
6. ffa 局不写入（沿用 `gameMode!=='identity'` 守卫）
7. 隐藏信息：事件 JSON 不含手牌字段

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// game.js normalize 内(现有数组防御区):
if(g.aiSuspicionEvents !== undefined && !Array.isArray(g.aiSuspicionEvents)) g.aiSuspicionEvents = [];
if(Array.isArray(g.aiSuspicionEvents)){
  g.aiSuspicionEvents = g.aiSuspicionEvents.filter(function(e){
    return e && typeof e==='object' && Number.isInteger(e.round) && Number.isInteger(e.source)
      && Number.isInteger(e.target) && Number.isInteger(e.amount) && (e.kind==='damage'||e.kind==='rescue');
  }).slice(-20);
}
```

```js
// bot.js recordBotDamageEvidence 内(delta 计算后):
g.aiSuspicionEvents = g.aiSuspicionEvents || [];
g.aiSuspicionEvents.push({ round: g.roundNum, source: sourceSeat, target: targetSeat, amount: amount, kind: 'damage' });
if(g.aiSuspicionEvents.length > 20) g.aiSuspicionEvents = g.aiSuspicionEvents.slice(-20);
// recordBotRescueEvidence 内同理:
g.aiSuspicionEvents = g.aiSuspicionEvents || [];
g.aiSuspicionEvents.push({ round: g.roundNum, source: rescuerSeat, target: dyingSeat, amount: 1, kind: 'rescue' });
if(g.aiSuspicionEvents.length > 20) g.aiSuspicionEvents = g.aiSuspicionEvents.slice(-20);
```

```js
// buildBotVisibleState 顶层加:
recentSuspicionEvents: (g.aiSuspicionEvents||[]).slice(-10),
```

- [ ] **Step 5: 回归 + `?v=294→295` + Commit**

```bash
node run_ai_bus_info_test.js && node run_ai_bus_l3_test.js && node run_ai_bus_core_test.js && node --check bot.js && node --check game.js
git add bot.js game.js run_ai_bus_info_test.js index.html
git commit -m "feat: A7嫌疑事件流(g.aiSuspicionEvents+normalize防御+AI投影)"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task A3: 方天画戟多目标（探索）

**Files:**
- Modify: 探索结论决定（可能 bot.js 候选扩展或仅记录边界）
- Modify: `run_ai_bus_l3_test.js`（若有实现）

**Interfaces:**
- 无固定产出（探索驱动）

- [ ] **Step 1: 探索（先不改代码）**

`rg "fangtianMode|fangtianPicks" render.js render-controls.js skills.js game.js`——确认：
1. 触发链：方天画戟多目标的入口是什么（出杀时选额外目标？杀命中后？）
2. 服务端阶段/函数（提交函数签名）
3. 现有 runBotDecision/BOT_DECISIONS 是否已覆盖该阶段

- [ ] **Step 2: 按探索结论分支**

- **若服务端有独立阶段且单步可提交** → 补专用注册（照 A1/A5 模式）+ 测试 + commit
- **若涉及杀结算中途（复杂）** → 记录为已知边界（spec §2.6 已允许"不能做则记录"），仅写 progress-log + 无代码改动 commit 或并入 A8 收尾

- [ ] **Step 3: Commit（按结论）**

```bash
git commit -m "feat(bot): A3方天画戟多目标(按探索结论)"   # 或
git commit -m "docs: A3方天画戟探索结论(记录为已知边界)"
```

---

# A-批3：机制

### Task A6: 多张仁德（继续给/停止）

**Files:**
- Modify: `bot.js` — `BOT_DECISIONS.rendeTwoStep` 扩展
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: rendeTwoStep 阶段B 增加「继续给牌」流程（botTwoStepA 扩展 `{decisionId:'rendeTwoStep', target, continue:true}`）
- Consumes: `renDe(cardIdx, targetSeat)`（skills.js，逐张提交）、`g.renDeCount`（计数）

- [ ] **Step 1: 写失败测试**

1. 阶段B 提交一张牌后（renDeCount<2 且手牌剩牌）→ botTwoStepA={decisionId:'rendeTwoStep', target, continue:true}
2. 下一调度阶段B：候选=剩余手牌每张 + 「停止给牌」
3. mock 选继续 → 再 `renDe(idx, target)`；mock 选停止 → resetBotTwoStep，不再给
4. 无密钥：给 1 张即停（fallback 逐字旧逻辑——改动前只给 1 张）
5. renDeCount>=2 或手牌空 → 不再出现「继续」（候选只剩停止）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// rendeTwoStep.execute 阶段B 提交后:
const me = g.players[seat];
const target = botTwoStepA && botTwoStepA.target;
botInvoke(seat, function(){ renDe(choice.cardIdx, target); });
if(g.renDeCount < 2 && (me.hand||[]).length > 0){
  botTwoStepA = { decisionId: 'rendeTwoStep', target: target, continue: true };
} else {
  resetBotTwoStep();
}
```

阶段B buildCandidates：当 `botTwoStepA && botTwoStepA.continue` 时，候选=剩余手牌每张 + `{stop:true, label:'停止给牌'}`；否则（首轮）候选=手牌每张（现行为）。
localFallback：无密钥时给第一张即停（`continue` 不设——**注意**：改动前只给 1 张，fallback 走完阶段B 提交后不应设 continue；实现时 localFallback 路径与 AI 路径分开处理，或统一"提交后按 renDeCount 判断"——**无密钥时 renDeCount 从 0→1 <2 且手牌剩牌会误设 continue**！需防：fallback 路径显式不设 continue（加标志 `fromAI` 或在 execute 里区分来源——**最简**：localFallback 返回的 choice 带 `stopAfter:true`，execute 对 stopAfter 不设 continue）。

- [ ] **Step 5: 回归 + `?v=295→296` + Commit**

```bash
node run_ai_bus_l3_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): A6多张仁德(继续给/停止,无密钥1张即停)"
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

### Task A8: 机器人侧兜底完整性

**Files:**
- Modify: `bot.js` — 盲区修补
- Modify: `run_ai_bus_l1_test.js`

**Interfaces:**
- Produces: 盲区清单 + 修复
- Consumes: `botSafePrompt`（bot.js，safe/mandatory 正则）

- [ ] **Step 1: 扫描盲区（先不改代码）**

1. 列出 `BOT_PHASE_ACTOR` 全部 phase，对照：有专用注册 / L1 可覆盖 / botSafePrompt 能点安全按钮
2. 对每个"botSafePrompt 兜底"阶段，用正则实测按钮文案是否命中（safe `/不发动|不使用|不出|取消|跳过|放弃|结束/`、mandatory `/选择|交给|弃置|摸牌|回复|打出/`）
3. 已知盲区：lirangRecover（「获得弃牌/不获得」——G3 发现都不命中）——补正则或专用 fallback
4. 输出盲区清单（报告记录）

- [ ] **Step 2: 按清单修补**

修补方式（每处小补丁，模式化）：
- **方式 1**：`botSafePrompt` 的 safe 正则追加缺失词（如 `不获得`）——**小心**：会影响所有阶段的选择顺序，需回归验证无密钥行为（有旧分支的阶段不受影响——botSafePrompt 只在无分支阶段跑）
- **方式 2**：对特定阶段补 `BOT_DECISIONS` 专用注册（照 A1 模式）
- **方式 3**：确认该阶段有密钥时 L1 覆盖（无密钥兜底盲区可接受？——**不可接受**，A8 目标就是无密钥也不卡）

- [ ] **Step 3: 测试**

对每个修补阶段：无密钥 runBotDecision → 不再 warn 卡死（有动作或安全跳过）；有密钥 → L1/专用注册接管。回归全绿。

- [ ] **Step 4: 回归 + `?v=296→297` + Commit + progress-log-8 追加（本批全部）**

```bash
node run_ai_bus_l1_test.js && node run_ai_bus_l3_test.js && node run_ai_bus_c_window_test.js && node --check bot.js
git add bot.js run_ai_bus_l1_test.js index.html
git commit -m "feat(bot): A8机器人侧兜底盲区修补"
# + progress-log-8 追加 A1-A8 全部记录(单独 commit)
git -c url."https://github.com/".insteadOf= push https://github.com/zjc-taikutu/my-sanguosha.git wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| §2.1 A1 骁果路径A | A1 |
| §2.2 A2 铁索双目标 | A2 |
| §2.3 A5 借刀响应 | A5 |
| §2.4 A4 恩怨选牌 | A4 |
| §2.5 A7 嫌疑事件流 | A7 |
| §2.6 A3 方天画戟探索 | A3 |
| §2.7 A6 多张仁德 | A6 |
| §2.8 A8(a) 兜底完整性 | A8 |
| §3 批次划分（批1/批2/批3） | 计划结构强制 |
| §5 不做（A9/A8(b)） | 各 Task 明确不做 |

## Placeholder 扫描

- A5 respondJiedao 第 2 参、A4 pending 字段名、A3 触发链、A8 盲区清单：均为"实现时核实"的确定性核对项（给了 rg 指令与决策规则），不是开放式 TODO
- 所有注册代码块为完整实现骨架，实现者照抄+按核对项补签名

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；A8 收尾时 progress-log-8 追加 A1-A8 全部记录。
