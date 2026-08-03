# AI 决策覆盖扩展（第一批：L3 座位卡 + 高价值响应）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 24 处机器人决策接入 AI 总线：15 处"点座位卡"类 L3 技能（11 简单单选走通用 `seatPick` 协议 + 4 多步两阶段）+ 5 类高价值响应（dying/duel/aoeResp/wugu/选将）+ 观星（有限排列候选）+ 4 处剩余响应（化身选技能/化身更改/巧变移动/恩怨选项）。

**Architecture:** 完全复用既有总线（`BOT_DECISIONS`/`botDecide`/`callAiChooseIndex`/`botInvoke`/`buildBotVisibleState`，见 `docs/superpowers/specs/2026-08-03-ai-operable-surface-bus-design.md` 已完成部分），不新建机制。新增：`BOT_SEAT_PICKS` 技能注册表 + `BOT_DECISIONS.seatPick` 通用座位协议；4 个多步两阶段注册项（客户端累积选择、最后一次性提交，仿巧变先例）；dying/duel/aoeResp/wugu/pickGeneral/guanxing/huashenSkill/huashenChange/qiaobianMove/enyuanOption 各专用注册项。所有 `localFallback` 逐字复刻 `runBotDecision` 现有分支逻辑（无密钥回归红线）。观星用有限排列候选（方案 A，用户已确认），不引入第二种 AI 响应协议。

**Tech Stack:** 纯静态多文件 JS（无构建）；既有 vm 沙箱测试 harness（`run_ai_bus_*.js` 系列）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-ai-decision-coverage-l3-responsive-design.md`

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送，不进 `main`
- **有密钥**：覆盖的决策走 AI 选 index；**无密钥 / AI 失败**：立刻 `localFallback`，**不重试**
- **无密钥行为** = `runBotDecision` 现有分支逐字（回归红线；实现时直接对照现有分支代码，不允许"重新实现一遍语义"）
- **禁止** AI 策略路径新增按武将 id 分支（`if(general===...)`）；技能差来自 `GENERALS`/`BOT_SEAT_PICKS` 注册表 + 人类可点项
- **禁止** 自由动作 DSL / 第二种 AI 响应协议；一切保持 `{"choice":N}`（观星用有限排列候选）
- **隐藏信息**：座位候选只含公开合法性（存活/距离/装备区/判定区/公开 pending 字段）；不投影他人手牌；蛊惑类不出现 `actualCard`
- **`mySeat` 纪律**：枚举/收集期间同步借用、`finally` 归还；不得跨越 await 占用
- **并发**：保持 `botDecisionInFlight`/`botMissedSchedule`；多步两阶段的中间状态只存客户端本地变量（仿 `jiedaoSeatA`），**不入 Firebase**、不新增 pending 类型
- **render.js / render-controls.js 的真人交互路径零改动**：候选生成是新代码，与真人点击同源但独立实现（合法性判断照抄 render.js 分支，见各 Task 的"合法性来源"）
- **`?v=`**：改动 `bot.js` 等带 `?v=` 的脚本内容时，index.html 全部 13 处同步 +1（当前基线 269）
- **测试**：vm 加载真实源码；`let` 变量用 `vm.runInContext('x=...', sandbox)` 裸赋值；函数声明可直接替换成 spy
- **收尾**：全部 Task 完成后 progress-log 记录 + B/C 式验收门
- **执行顺序**：T1→T10 顺序执行；T10（验收）最后

---

## File map

| File | Responsibility |
|------|----------------|
| `bot.js` | `BOT_SEAT_PICKS` 注册表、`BOT_DECISIONS.seatPick`、多步两阶段注册项（`jiedaoTwoStep`/`lijianTwoStep`/`zhangbaTwoStep`/`rendeTwoStep`）、dying/duel/aoeResp/wugu/pickGeneral/guanxing/huashenSkill/huashenChange/qiaobianMove/enyuanOption 注册项、`runBotDecision` 接线 |
| `run_ai_bus_l3_test.js` | 新建：L3 座位卡 + 高价值响应 + 观星 + 剩余响应测试（T1 建 harness，后续 Task 追加） |
| `index.html` | `?v=` 同步（269→270 起，每改 bot.js 一次 +1） |
| `docs/progress-log-*.md` | T10 追加交付记录 |

**不修改**：`render.js`/`render-controls.js`（真人交互路径）、`game.js`/`skills.js` 规则函数体（只调用）、`normalize`。

---

## 目标接口（全计划统一命名）

```js
// seatPick 协议
const BOT_SEAT_PICKS = {
  skillKey: {                       // 如 'guose'/'duanliang'
    match(g, seat),                 // 该技能当前可发动（读 g/玩家状态，不读客户端 mode 变量）
    buildSeatCandidates(g, seat),   // -> [{seat, label}] 合法座位（照抄 render.js 分支合法性）
    fallbackSeat(g, seat),          // 旧行为目标座位或 null（=不发动）
    execute(g, seat, targetSeat),   // botInvoke 内调服务端函数
  },
};
BOT_DECISIONS.seatPick = { match, buildCandidates, localFallback, execute };

// 多步两阶段：客户端本地状态（不入 Firebase）
let botTwoStepA = null;             // { decisionId, step:'A', a } 或 null
// 每个多步技能注册 BOT_DECISIONS 独立项，阶段 2 的 buildCandidates 读 botTwoStepA
```

---

### Task 1: seatPick 协议骨架 + 2 个最标准技能（蛊惑目标/旋风目标）

**Files:**
- Modify: `bot.js`（在 `BOT_DECISIONS.guhuoQuestion` 注册项之后插入）
- Create: `run_ai_bus_l3_test.js`（harness 复制 run_ai_bus_l2_test.js 的完整链路 stub）

**Interfaces:**
- Produces: `BOT_SEAT_PICKS`（空表）、`BOT_DECISIONS.seatPick`（match/buildCandidates/localFallback/execute 全实现，从 `BOT_SEAT_PICKS` 动态收集）、`registerSeatPick` 简化注册辅助（可选）
- Produces: `run_ai_bus_l3_test.js` harness（加载 config/data/room-lifecycle/game/weapons/skills/bot/ai-bot/render 链，spy 目标服务端函数，异步 check 断言，与 run_ai_bus_l2_test.js 同构）

- [ ] **Step 1: 写失败测试（harness + seatPick 空表行为）**

`run_ai_bus_l3_test.js` 含：
1. `BOT_SEAT_PICKS` 存在且为空表时 `botDecide('seatPick', g, 0)` 返回 false
2. harness 自检：能加载全链路 + spy 一个函数

- [ ] **Step 2: 跑测试确认失败**（`BOT_SEAT_PICKS`/`BOT_DECISIONS.seatPick` 未定义）

```bash
source ~/.nvm/nvm.sh 2>/dev/null; node run_ai_bus_l3_test.js
```

Expected: FAIL（undefined）

- [ ] **Step 3: 实现 seatPick 骨架**

```js
// ============ L3: seatPick 通用座位协议（第一批扩展,Task L3-T1） ============
// 【本协议是什么】把"从合法座位里选一个"这一大类交互收敛成通用协议:BOT_SEAT_PICKS
// 按技能注册 {match, buildSeatCandidates, fallbackSeat, execute},seatPick 动态收集
// 全部命中技能的候选合并成一张表(AI 一次选"哪个技能打向哪个座位",label 带技能名前缀),
// 不命中任何技能时返回 false 走旧分支。与 render.js 真人交互的关系:候选合法性与
// render.js 座位卡分支同源但独立实现(不读客户端 mode 变量,只读 g/玩家状态),
// 真人 onclick 路径零改动。
const BOT_SEAT_PICKS = Object.create(null);

function seatPickMatch(g, seat){
  if(!g || g.phase!=='play' && !(g.pending && (g.pending.type==='guhuoTarget'||g.pending.type==='xuanfengPick'))) return false;
  return Object.keys(BOT_SEAT_PICKS).some(function(key){
    const s = BOT_SEAT_PICKS[key];
    return typeof s.match==='function' && s.match(g, seat);
  });
}
function seatPickBuildCandidates(g, seat){
  const out = [];
  Object.keys(BOT_SEAT_PICKS).forEach(function(key){
    const s = BOT_SEAT_PICKS[key];
    if(typeof s.match!=='function' || !s.match(g, seat)) return;
    const list = s.buildSeatCandidates(g, seat) || [];
    list.forEach(function(c){
      out.push({
        index: 0, // botDecide 会重新规范化
        label: c.label,
        skillKey: key,
        seat: c.seat,
        source: 'seatPick',
      });
    });
  });
  return out;
}
function seatPickLocalFallback(g, seat, candidates){
  // 遍历注册表,对第一个 match 的技能取 fallbackSeat(旧行为);匹配到目标则返回对应候选
  const keys = Object.keys(BOT_SEAT_PICKS);
  for(let i=0;i<keys.length;i++){
    const key = keys[i], s = BOT_SEAT_PICKS[key];
    if(typeof s.match!=='function' || !s.match(g, seat)) continue;
    const fs = s.fallbackSeat(g, seat);
    if(fs===null || fs===undefined) return null; // 旧行为=不发动 → botDecide 拿 null 会崩,须返回候选或由 execute 处理
    const hit = candidates.find(function(c){ return c.skillKey===key && c.seat===fs; });
    return hit || null;
  }
  return null;
}
function seatPickExecute(g, seat, choice){
  if(!choice || !choice.skillKey) return;
  const s = BOT_SEAT_PICKS[choice.skillKey];
  if(!s || typeof s.execute!=='function') return;
  s.execute(g, seat, choice.seat);
}
BOT_DECISIONS.seatPick = {
  match: seatPickMatch,
  buildCandidates: seatPickBuildCandidates,
  localFallback: seatPickLocalFallback,
  execute: seatPickExecute,
  buildSystemPrompt: function(g, seat, ctx){
    return '你在扮演网页版三国杀的AI机器人。当前你的出牌阶段/技能阶段,候选列表里的每一项'
      +'是"发动某个技能并指定某个目标"的完整动作(技能名前缀区分)。请结合局面与目标公开'
      +'状态选择最合适的动作。只能选列表内选项,不能发明。只输出 {"choice":数字},不要解释。';
  },
};
```

**注意**：`seatPickLocalFallback` 返回 `null` 表示"旧行为=不发动"。但 `botDecide` 的契约是 `idx===null → localFallback(...)`，且 `spec.execute(g, seat, choice)` 用 fallback 返回值当 choice——**botDecide 骨架需要兼容"fallback 返回 null = 不执行"**。检查 `botDecide`（bot.js ~660）：`if(idx===null){ choice=spec.localFallback(...); }` 然后无条件 `spec.execute(g, seat, choice)`。**因此本 Task 必须同时给 `botDecide` 加一行**：`if(choice===null || choice===undefined){ return true; }`（null = 该决策点"无动作"，视为已处理）。**回归**：既有 6 个注册项的 fallback 永不返回 null，行为不受影响（跑既有测试确认）。

- [ ] **Step 4: 跑测试确认通过**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_core_test.js && node run_ai_bus_l2_test.js
```

Expected: l3 绿 + core/l2 回归绿（botDecide 加 null 兼容行不影响既有路径）

- [ ] **Step 5: 在 `BOT_SEAT_PICKS` 注册前 2 个最标准技能（pending 阶段驱动，不涉及 mode）**

**蛊惑目标**（render.js ~1221-1233 合法性来源）：
```js
BOT_SEAT_PICKS.guhuoTarget = {
  match: function(g, seat){
    const d = g.pending;
    return !!(d && d.type==='guhuoTarget' && d.sourceSeat===seat);
  },
  buildSeatCandidates: function(g, seat){
    const d = g.pending;
    const claimed = d && d.claimedCard;
    const spec = claimed ? CARD_PLAYS[guhuoActionId(claimed.name)] : null;
    const meP = g.players[seat];
    const out = [];
    if(!claimed || !spec || !spec.target) return out;
    g.players.forEach(function(p, i){
      if(!p || !p.alive) return;
      const selfAllowed = i!==seat || !!(spec && spec.allowSelf);
      if(!selfAllowed) return;
      if(spec.canTarget && !spec.canTarget(g, meP, claimed, i)) return;
      out.push({ seat: i, label: '蛊惑→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 改动前:机器人从不主动发起蛊惑,该阶段对机器人无处理(死路径)。保守:null(不动作)
    return null;
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ guhuoChooseTarget(targetSeat); });
  },
};
```
（`guhuoActionId` 与 `guhuoChooseTarget` 均在 render.js 定义、全局可用；`bot.js` 运行时调用无加载顺序问题。）

**旋风目标**（render.js ~1505-1510 合法性来源）：
```js
BOT_SEAT_PICKS.xuanfeng = {
  match: function(g, seat){
    const d = g.pending;
    return !!(d && d.type==='xuanfengPick' && d.from===seat && d.stage==='selecting');
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      out.push({ seat: i, label: '旋风→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(g, seat){
    // 旧分支:runBotDecision 未覆盖 xuanfengPick(70+ 未覆盖之一),机器人此前走 botSafePrompt。
    // 无密钥回退对齐"botSafePrompt 语义":若无明显安全按钮则不动 → null
    return null;
  },
  execute: function(g, seat, targetSeat){
    botInvoke(seat, function(){ pickXuanfengTarget(targetSeat); });
  },
};
```

- [ ] **Step 6: 追加测试**（两个技能各：候选合法性、无密钥 fallback=null 不崩、有密钥 mock 选目标→execute 收到 targetSeat、userPrompt 无他人手牌名）
- [ ] **Step 7: 回归全跑 + `?v=269→270` + Commit**

```bash
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): L3 seatPick通用座位协议+蛊惑目标/旋风目标"
git push origin wenwen_dev
```

---

### Task 2: 出牌阶段转化技能 5 个（断粮/奇袭/国色/武圣/双雄）

**Files:**
- Modify: `bot.js`（BOT_SEAT_PICKS 注册 5 项）
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: `BOT_SEAT_PICKS`/`BOT_DECISIONS.seatPick`（T1）
- Produces: 5 个注册项；依赖服务端函数 `duanLiang(idx,i)`/`qiXi(idx,i)`/`guoSe(idx,i)`/`playCard(idx,'杀',i)`/`playCard(idx,'决斗',i)` 及渲染层 helper `resolveActionId`/`isShuangxiongDuelSel`/`canReachSha`

- [ ] **Step 1: 写失败测试**

每个技能：
- 无该技能（无 cap）→ match false
- 有技能+合法目标 → 候选含目标座位
- 有密钥 mock 选目标 → 对应服务端函数收到（spy）
- 无密钥 → fallback 行为与"改动前"一致（改动前机器人从不主动用这些技能 → fallback=null 不动作）
- 隐藏信息：userPrompt 无他人手牌名

- [ ] **Step 2: 跑测试确认失败 → Step 3: 实现 → Step 4: 跑通**

实现要点（合法性照抄 render.js 分支）：

```js
// 断粮(render.js ~1286-1302):黑色基本/装备牌当兵粮,目标=距离≤2 存活其他角色
BOT_SEAT_PICKS.duanliang = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players[seat];
    return (me.hand||[]).some(function(c){
      return (c.suit==='♠'||c.suit==='♣') && (isShaName(c.name) || c.name==='闪' || c.name==='桃' || EQUIPS[c.name]);
    });
  },
  buildSeatCandidates: function(g, seat){
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(distance(g, seat, i) > 2) return;
      out.push({ seat: i, label: '断粮→'+p.name });
    });
    return out;
  },
  fallbackSeat: function(){ return null; }, // 改动前机器人不用断粮
  execute: function(g, seat, targetSeat){
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){
      return (c.suit==='♠'||c.suit==='♣') && (isShaName(c.name) || c.name==='闪' || c.name==='桃' || EQUIPS[c.name]);
    });
    if(idx>=0) botInvoke(seat, function(){ duanLiang(idx, targetSeat); });
  },
};
// 奇袭(render.js ~1304-1319):黑色手牌当拆,目标=有手牌/装备/判定区的存活其他角色
// 国色(render.js ~1321-1337):方块手牌当乐,目标=判定区无【乐不思蜀】的存活其他角色
// 武圣(render.js ~1442-1456):isWushengShaSel(红色可当杀),目标=CARD_PLAYS['杀'].canTarget
// 双雄(render.js ~1416-1429):isShuangxiongDuelSel,目标=CARD_PLAYS['决斗'].canTarget
```

**武圣**的 `match` 判定（照抄 render.js 1442 附近 `isWushengShaSel` 的定义）：
```js
match: function(g, seat){
  if(g.phase!=='play' || g.turn!==seat) return false;
  const me = g.players[seat];
  return (me.hand||[]).some(function(c){
    const red = c.suit==='♥'||c.suit==='♦';
    return red && isShaName('杀') && canUseAs(me, c, '杀') && resolveActionId(g, me, c)!=='杀';
  });
},
```
**双雄**的 `match` 照抄 `canShuangxiongDuelCard`（render.js ~653）：
```js
match: function(g, seat){
  if(g.phase!=='play' || g.turn!==seat) return false;
  const me = g.players[seat];
  if(!me || !hasCap(me,'shuangxiong') || !me.shuangxiongColor) return false;
  return (me.hand||[]).some(function(c){
    return cardColorForPlayer(me, c)!==me.shuangxiongColor;
  });
},
```
（`cardColorForPlayer` 在 render.js 全局；实现时先 rg 确认其定义与参数。）

**execute 的"选哪张牌"**：每个技能可能有多张可用牌。第一批**不把牌维度交给 AI**（AI 只选目标座位，牌由 execute 里 `findIndex` 取第一张可用）——记录于 spec §9（选牌维度后续批次）。execute 内部 `findIndex` 规则与 render.js 真人交互的"点牌选中"一致（取第一张合法牌）。

- [ ] **Step 5: 回归全跑 + `?v=270→271` + Commit**

```bash
git commit -m "feat(bot): L3 seatPick 出牌转化技能(断粮/奇袭/国色/武圣/双雄)"
```

---

### Task 3: 剩余简单单选 4 个（挑衅/反间/青囊/驱虎伤害）

**Files:**
- Modify: `bot.js`（BOT_SEAT_PICKS 注册 4 项）
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: seatPick 协议
- Produces: 4 个注册项；服务端函数 `respondTiaoxin(i)`/`fanJian(i)`/`qingNang(idx,i)`/`respondQuhuDamage(i)`

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

实现要点（合法性照抄 render.js）：

```js
// 挑衅(render.js ~1251-1258):出牌阶段、姜维、目标=存活+有手牌+非自己
// 反间(render.js ~1377-1386):出牌阶段、周瑜反间技能、目标=存活非自己
// 青囊(render.js ~1389-1400):出牌阶段、华佗、已选一张手牌、目标=存活且 hp<maxHp(可自己)
// 驱虎伤害(render.js ~1348-1356):pending.type==='quhuDamageChoice' && pending.seat===seat,
//   目标= pending.targets 数组里的座位(服务端已算好合法集)
```

**挑衅的触发链**：render.js 里 `tiaoxinMode` 由 render-controls.js 的某个按钮进入（rg `tiaoxinMode` 确认触发源）。实现时确认：若挑衅需要先"发动"再"选目标"两步 UI，则机器人侧 match 只覆盖"已可选的出牌阶段"（即服务端 `respondTiaoxin(i)` 可直呼的窗口）。**若 render-controls 里挑衅是"点按钮→进入模式→选座位"两步**，则把挑衅归入多步（Task 4 框架），本 Task 只做反间/青囊/驱虎伤害 3 个；实现时以 rg 结论为准，在报告说明。

**青囊 execute 的牌选择**：`findIndex` 第一张手牌（与 render.js 真人"点一张手牌"一致）。
**驱虎伤害**：目标集来自 `g.pending.targets`（服务端权威），fallback=旧分支 `respondQuhu(0)` 对应的行为——**注意**：`quhuRespond`（拼点响应）与 `quhuDamageChoice`（选伤害目标）是两个阶段。旧 `runBotDecision` 对 `quhuRespond` 是 `respondQuhu(0)`；对 `quhuDamageChoice` **没有覆盖**（走 botSafePrompt）。本 Task 只做 `quhuDamageChoice`（选伤害目标），`quhuRespond` 不动。

```bash
git commit -m "feat(bot): L3 seatPick 挑衅/反间/青囊/驱虎伤害"
```

---

### Task 4: 多步两阶段框架 + 借刀杀人

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `botTwoStepA` 本地状态（`{decisionId, a}`）、`BOT_DECISIONS.jiedaoTwoStep`（match 覆盖阶段 A 与阶段 B，内部看 `botTwoStepA`）、`resetBotTwoStep()`；服务端函数走借刀专属流程（render.js 1463-1483：`jiedaoSeatA=i` 客户端流程 → 最终由 render.js 1478 分支调用的函数提交——实现时读 render.js 确认借刀的最终提交函数名，大概率是 `jieDaoShaRen(cardIdx, seatA, seatB)` 之类，rg 确认）
- Consumes: seatPick 协议无关；`botDecide` 每次被调度时对同一 decisionId 调用两次（阶段 A/B）

- [ ] **Step 1: 写失败测试**

借刀：
- 阶段 A：手牌有借刀 + 存在武器持有者 → 候选=武器持有者列表
- 阶段 B（botTwoStepA 已设 A）：候选=在 A 攻击范围内的非 A 存活者
- 两阶段全选完 → 提交函数被调用（spy 收 seatA/seatB）
- 无密钥：阶段 A fallback=第一个武器持有者，阶段 B fallback=第一个合法者（与"改动前机器人从不用借刀"对齐——**确认旧行为**：旧 `botPlay` 排除借刀，机器人从不主动使用 → fallback 取最保守合法默认，测试锁定为"不动作 or 最小合法组合"，实现时二选一并在报告说明理由，推荐"不动作"更贴合改动前）
- 阶段 A 选了但阶段 B 无候选（A 无射程内目标）→ 重置状态

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
// 两阶段状态:仅客户端本地,不入 Firebase(仿 jiedaoSeatA)
let botTwoStepA = null;
function resetBotTwoStep(){ botTwoStepA = null; }
// 在 botDecide 每次 execute 后由注册项自己管理:阶段A选中后 botTwoStepA={decisionId,a},
// 阶段B提交后 resetBotTwoStep();runBotDecision 每轮调度入口先检查
// botTwoStepA 是否属于当前决策(防跨决策残留)。

BOT_DECISIONS.jiedaoTwoStep = {
  match: function(g, seat){
    if(g.phase!=='play' || g.turn!==seat) return false;
    const me = g.players[seat];
    const hasJiedao = (me.hand||[]).some(function(c){ return c.name==='借刀杀人'; });
    return hasJiedao;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const jiedaoIdx = (me.hand||[]).findIndex(function(c){ return c.name==='借刀杀人'; });
    const out = [];
    if(botTwoStepA && botTwoStepA.decisionId==='jiedaoTwoStep'){
      // 阶段 B:在 A 攻击范围内的非 A 存活者
      const A = botTwoStepA.a;
      g.players.forEach(function(p, i){
        if(!p || !p.alive || i===A) return;
        if(!canReachSha(g, A, i)) return;
        out.push({ index: 0, label: '借刀:令 '+g.players[A].name+' 杀 '+p.name, step:'B', seatA: A, seatB: i, jiedaoIdx: jiedaoIdx });
      });
      return out;
    }
    // 阶段 A:持有武器的存活其他角色
    g.players.forEach(function(p, i){
      if(!p || !p.alive || i===seat) return;
      if(!p.equips || !p.equips.weapon) return;
      out.push({ index: 0, label: '借刀:选 '+p.name, step:'A', a: i, jiedaoIdx: jiedaoIdx });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    if(!candidates.length) return null;
    return candidates[0];
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    if(choice.step==='A'){
      botTwoStepA = { decisionId: 'jiedaoTwoStep', a: choice.a };
      return; // 等下一调度走阶段 B
    }
    // 阶段 B:提交借刀专属流程
    resetBotTwoStep();
    const me = g.players[seat];
    const idx = (me.hand||[]).findIndex(function(c){ return c.name==='借刀杀人'; });
    if(idx<0) return;
    botInvoke(seat, function(){ /* 调用借刀提交函数(render.js 1478 分支确认) */ });
  },
};
```

**实现时必做**：`rg "jieDaoShaRen|借刀" render.js skills.js game.js` 确认借刀的最终提交函数签名，用它替换上面注释占位。若借刀提交需要"从手牌下标+seatA+seatB"，照 render.js 1478 分支原样传。

**runBotDecision 接线**：在 play 分支（弱C `runBotActionWindow` 之前或之后）插入：
```js
if(botTwoStepA && botTwoStepA.decisionId==='jiedaoTwoStep' && g.phase==='play' && g.turn===seat){
  if(await botDecide('jiedaoTwoStep', g, seat)) return;
}
if(g.phase==='play'&&g.turn===seat){
  if(await botDecide('jiedaoTwoStep', g, seat)) return;
  await runBotActionWindow(g, seat); return;
}
```
（两处都尝试：第一阶段无 botTwoStepA 时走"选A"，第二阶段有 botTwoStepA 时走"选B"。**注意避免与 runBotActionWindow 重复决策**：借刀在手时 jiedaoTwoStep 先接管，`runBotActionWindow` 的枚举里借刀已被排除（既有），不冲突。）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bot): L3 多步两阶段框架+借刀杀人"
```

---

### Task 5: 离间/丈八/仁德（多步两阶段/三阶段）

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: `botTwoStepA` 机制（T4）
- Produces: `BOT_DECISIONS.lijianTwoStep`/`zhangbaTwoStep`/`rendeTwoStep`；服务端函数 `liJian(idx,from,to)`/`playZhangbaSha(a,b,i)`/`renDe(idx,targetSeat)`

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
// 离间(render.js ~1358-1375):阶段A=选男性角色 from(有手牌可弃的男性?照抄分支);阶段B=≠from 的男性 to。
//   提交 liJian(idx, from, to);idx=离间牌下标(render 里 lijianCardIdx,选牌维度照旧取第一张方块?——实现时读 render.js 确认离间牌条件)
// 丈八(render.js ~1235-1250 + render-hand 选牌):三阶段——牌A、牌B(≠A)、目标(存活+canReachSha+非空城)。
//   botTwoStepA 扩展为 {decisionId, a, b?};阶段3提交 playZhangbaSha(a,b,i)
// 仁德(render.js ~1402-1410):阶段A=目标(存活非自己);阶段B=手牌每张一项。提交 renDe(idx,targetSeat)
```

**丈八第三阶段**：`botTwoStepA` 结构需扩展支持 `{decisionId:'zhangbaTwoStep', a, b}`（Task 4 只用了 `a`；本 Task 加 `b` 字段，向后兼容）。实现时确保 Task 4 的借刀代码不受影响（借刀只用 `a`）。

**离间牌选择**：render.js 里 `lijianCardIdx` 来自手牌中满足条件的牌（实现时 rg `lijianMode`/`lijianCardIdx` 确认条件，通常是一张可弃的牌）。execute 里 `findIndex` 取第一张合法牌（选牌维度留后续批次，同 Task 2 约定）。

```bash
git commit -m "feat(bot): L3 多步 离间/丈八/仁德"
```

---

### Task 6: 高价值响应 dying/duel/aoeResp

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: 总线骨架
- Produces: `BOT_DECISIONS.dying`/`duel`/`aoeResp`；服务端函数 `respondDying(bool)`/`duelResponse(bool)`/`aoeRespond(bool)`；复用 `botCanSave`/`canBotUseTaoForDying`/`canBotPlaySha`/`findUsableAs`

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
BOT_DECISIONS.dying = {
  match: function(g, seat){ return g.phase==='dying' && g.pending && g.pending.type==='dying' && g.pending.asking===seat; },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const hasTao = findUsableAs(p.hand, p, '桃') >= 0;
    const out = [];
    if(hasTao) out.push({ action: '打出【桃】救援', save: true });
    out.push({ action: '不出', save: false });
    return out;
  },
  extraState: function(g, seat){
    const d = g.pending;
    const dyingP = g.players[d.seat];
    return { dying: {
      dyingSeat: d.seat,
      dyingName: dyingP ? dyingP.name : '?',
      dyingHp: dyingP ? dyingP.hp : null,
      isSelf: d.seat===seat,
    } };
  },
  localFallback: function(g, seat, candidates){
    const d = g.pending;
    const p = g.players[seat];
    const save = botCanSave(g, seat, d.seat) && canBotUseTaoForDying(g, seat, d.seat) && findUsableAs(p.hand, p, '桃') >= 0;
    return candidates.find(function(c){ return c.save === save; }) || candidates[candidates.length-1];
  },
  execute: function(g, seat, choice){
    botInvoke(seat, function(){ respondDying(!!(choice && choice.save)); });
  },
};
// duel: match=g.phase==='duel' && pending.active===seat;
//   候选=canBotPlaySha(p)&&findUsableAs(手牌,'杀')>=0 ? [出杀,不出] : [不出]
//   fallback=旧分支逐字:canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0
//   execute=duelResponse(choice.play)
// aoeResp: match=g.phase==='aoeResp' && pending.to===seat;
//   候选=need 为杀/闪;可响应时 [出牌,不出] 否则 [不出]
//   fallback=旧分支逐字:(d.need==='杀'?canBotPlaySha(p):true) && findUsableAs(p.hand,p,d.need)>=0
//   execute=aoeRespond(choice.play)
```

**runBotDecision 接线**：三个旧分支（`dying`~1552/`duel`~1545/`aoeResp`~1538，行号以现状为准）替换为 `if(await botDecide('dying',g,seat)) return;` 等（保留 phase 守卫冗余）。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bot): 高价值响应 dying/duel/aoeResp 进总线"
```

---

### Task 7: wugu + pickGeneral（含主公选将）

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.wuguPick`/`pickGeneral`；服务端函数 `wuguPick(poolIdx,expectedIdx,expectedCardId)`/`respondPickGeneral(id)`/`respondPickLordGeneral(id)`

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
BOT_DECISIONS.wuguPick = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='wugu' && d && d.type==='wugu' && Array.isArray(d.order) && d.order[d.idx||0]===seat && Array.isArray(d.pool) && d.pool.length>0;
  },
  buildCandidates: function(g, seat){
    const d = g.pending;
    return (d.pool||[]).map(function(c, i){
      return { poolIdx: i, cardId: c && c.id, label: '拿【'+(c&&c.name||'?')+'】' };
    });
  },
  extraState: function(g, seat){
    const d = g.pending;
    return { wugu: { orderIdx: d.idx || 0, poolCount: (d.pool||[]).length } };
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:wuguPick(0, d.idx||0, d.pool[0]&&d.pool[0].id)
    return candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const d = g.pending;
    botInvoke(seat, function(){ wuguPick(choice.poolIdx, d.idx || 0, choice.cardId); });
  },
};

BOT_DECISIONS.pickGeneral = {
  match: function(g, seat){
    if(g.phase==='pickingGeneral'){ const p=g.players[seat]; return !!p && p.isBot && !p.general; }
    if(g.phase==='pickingLordGeneral'){ return getLordSeat(g)===seat; }
    return false;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    const lordPick = g.phase==='pickingLordGeneral';
    const ids = lordPick ? (p.lordChoices||p.generalChoices||[]) : (p.generalChoices||[]);
    return ids.filter(function(id){ return GENERALS[id]; }).map(function(id){
      const gen = GENERALS[id];
      return { generalId: id, label: gen.name + (gen.skill ? '('+gen.skill+')' : ''), generalName: gen.name };
    });
  },
  localFallback: function(g, seat, candidates){
    // 旧 botPickGeneral 打分逐字(直接复用现有函数):选打分最高者
    const p = g.players[seat], lordPick = g.phase==='pickingLordGeneral';
    const choices = (p.generalChoices||[]).filter(function(id){ return GENERALS[id]; });
    if(!choices.length) return candidates[0] || null;
    const score = function(id){
      const gen = GENERALS[id], text = (gen.skill||'') + (gen.desc||'');
      return generalMaxHp(id)*12 +
        (/回复|摸.*牌|防止|免疫|闪/.test(text)?16:0) +
        (/伤害|杀|弃置/.test(text)?10:0) + (lordPick && /主公|回复|防止/.test(text)?20:0);
    };
    choices.sort(function(a,b){ return score(b)-score(a); });
    const best = choices[0];
    return candidates.find(function(c){ return c.generalId===best; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){
      if(g.phase==='pickingLordGeneral') respondPickLordGeneral(choice.generalId);
      else respondPickGeneral(choice.generalId);
    });
  },
};
```

**runBotDecision 接线**：替换旧 `wugu` 分支（~1568）与 `pickingGeneral`/`pickingLordGeneral` 分支（~1194-1195 区域，`botPickGeneral` 调用点）。**注意 `pickingGeneral` 的旧分支在 runBotDecision 顶部**（`if(g.phase==='pickingLordGeneral'){ botPickGeneral(g,seat,true); return; }` 等），替换为 `botDecide('pickGeneral')`。`botPickGeneral` 函数保留（fallback 复用其打分逻辑，或直接调用它取结果）。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bot): wugu挑牌与选将进总线"
```

---

### Task 8: 观星（有限排列候选）

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.guanxing`；服务端函数 `respondGuanxing(topOrder, bottomOrder)`（skills.js ~747）

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
// 方案A:有限排列候选。默认方案=旧行为(全置顶原序)恒在;+价值排序置顶方案;+最多6个相邻置换变体。
function buildGuanxingCandidates(g, seat){
  const d = g.pending;
  const n = (d.cards||[]).length;
  const all = (d.cards||[]).map(function(_, i){ return i; });
  const seen = new Set();
  const out = [];
  function add(top, isDefault){
    const key = JSON.stringify(top) + '|' + JSON.stringify(all.filter(function(i){ return top.indexOf(i)<0; }));
    if(seen.has(key) || out.length >= 8) return;
    seen.add(key);
    const bottom = all.filter(function(i){ return top.indexOf(i)<0; });
    const topNames = top.map(function(i){ return d.cards[i].name; }).join(',');
    const bottomNames = bottom.map(function(i){ return d.cards[i].name; }).join(',');
    out.push({ topOrder: top.slice(), bottomOrder: bottom, isDefault: isDefault,
      label: (isDefault?'默认方案':'方案'+out.length)+':顶['+topNames+'] 底['+(bottomNames||'无')+']' });
  }
  add(all, true); // 默认:全部置顶原序(旧行为)
  // 价值排序:按 botCardPriority 降序置顶
  const byValue = all.slice().sort(function(a, b){ return botCardPriority(d.cards[b].name) - botCardPriority(d.cards[a].name); });
  add(byValue, false);
  // 变体:相邻置换
  for(let i=0;i<n-1 && out.length<8;i++){
    const v = all.slice(); const t = v[i]; v[i]=v[i+1]; v[i+1]=t;
    add(v, false);
  }
  return out;
}
BOT_DECISIONS.guanxing = {
  match: function(g, seat){ return g.phase==='guanxingReview' && g.pending && g.pending.type==='guanxingReview' && g.pending.seat===seat; },
  buildCandidates: function(g, seat){ return buildGuanxingCandidates(g, seat); },
  localFallback: function(g, seat, candidates){ return candidates.find(function(c){ return c.isDefault; }) || candidates[0] || null; },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondGuanxing(choice.topOrder, choice.bottomOrder); });
  },
};
```

**runBotDecision 接线**：替换旧 `guanxingReview` 分支（~1204 区域：`respondGuanxing(order,[])`）。旧行为是"全部置顶原序"——与默认方案一致（测试锁定）。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bot): 观星有限排列候选进总线"
```

---

### Task 9: 化身/巧变移动/恩怨选项

**Files:**
- Modify: `bot.js`
- Extend: `run_ai_bus_l3_test.js`

**Interfaces:**
- Produces: `BOT_DECISIONS.huashenSkill`/`huashenChangeStart`/`huashenChangeEnd`/`qiaobianMove`/`enyuanOption`；服务端函数 `respondHuashenPick(id,name)`/`respondHuashenChangeAskStart(bool)`/`respondHuashenChangeAskEnd(bool)`/`respondQiaobianMove(null)`/`chooseEnyuanOption('giveCard'|'loseHp')`

- [ ] **Step 1: 写失败测试 → Step 2: RED → Step 3: 实现 → Step 4: GREEN → Step 5: Commit**

```js
BOT_DECISIONS.huashenSkill = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='huashenPick' && d && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    const p = g.players[seat];
    return (p.huashenPool||[]).filter(function(id){ return HUASHEN_SKILL_TABLE[id] && (HUASHEN_SKILL_TABLE[id]||[]).length; }).map(function(id){
      const entry = HUASHEN_SKILL_TABLE[id][0];
      return { generalId: id, skillName: entry && entry.name, label: (entry&&entry.name?entry.name+'('+id+')':id) };
    });
  },
  localFallback: function(g, seat, candidates){
    // 旧分支逐字:取池里第一个可用技能将
    const p = g.players[seat];
    const generalId = (p.huashenPool||[]).find(function(id){ return (HUASHEN_SKILL_TABLE[id]||[]).length; });
    if(generalId===undefined || generalId===null) return candidates[0] || null;
    return candidates.find(function(c){ return c.generalId===generalId; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const entry = (HUASHEN_SKILL_TABLE[choice.generalId]||[])[0];
    botInvoke(seat, function(){ respondHuashenPick(choice.generalId, entry && entry.name); });
  },
};
// huashenChangeStart: match=g.phase==='huashenChangeAskStart' && d.seat===seat;候选=[更改,不更改];fallback=不更改;execute=respondHuashenChangeAskStart(choice.change)
// huashenChangeEnd: 同构,respondHuashenChangeAskEnd
// qiaobianMove: match=g.phase==='qiaobianMove' && d.seat===seat;候选=[不移动] + 常见移动组合(源槽→目标角色,≤8);fallback=不移动;execute=respondQiaobianMove(choice.arg)
// enyuanOption: match=g.phase==='enyuanChooseOption' && d.damagerSeat===seat;候选=有红桃?[给红桃,掉血]:[掉血];fallback=旧分支逐字(有红桃给牌否则掉血);execute=chooseEnyuanOption(choice.option)
```

**qiaobianMove 简化**：候选 = 「不移动」+ 至多 8 个「移动源槽→目标角色」组合（源槽：自己/他人装备区非空槽 + 他人判定区非空；目标：任意存活角色≠来源持有者；`respondQiaobianMove` 的参数照 skills.js 定义——实现时 rg 确认签名，可能是 `(sourceSeat, slot, targetSeat)` 或组合对象，照抄）。fallback=不移动（旧分支逐字）。

**runBotDecision 接线**：替换旧 `huashenPick`（~1196）、`huashenChangeAskStart/End`（~1709-1717）、`qiaobianMove`（~1723）、`enyuanChooseOption`（~1685）分支。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bot): 化身/巧变移动/恩怨选项进总线"
```

---

### Task 10: 全量回归 + 验收门 + progress-log

**Files:**
- Modify: `docs/progress-log-*.md`（最新分段，≥150KB 则新建）
- 无代码改动预期（若有回归则修复）

- [ ] **Step 1: 跑全部测试**

```bash
source ~/.nvm/nvm.sh 2>/dev/null
node run_ai_bus_core_test.js    # 7
node run_ai_bus_info_test.js    # 5
node run_ai_bus_l1_test.js      # 8
node run_ai_bus_l2_test.js      # 23
node run_ai_bus_c_window_test.js# 15
node run_ai_bus_l3_test.js      # 新增
node run_ai_model_picker_test.js# 13
node run_lidian_test.js / run_qinggangjian_renwang_test.js / run_fazheng_test.js / run_xuanfeng_test.js / run_cixiong_test.js
node --check bot.js
```

- [ ] **Step 2: 验收门核对（证据=命令+输出）**

- [ ] 24 处决策有密钥可被 AI 选择（各测试 mock 选非默认 → 服务端函数收到 AI 选择）
- [ ] 无密钥行为与改动前逐字一致（各决策无密钥断言全绿）
- [ ] 隐藏信息：userPrompt 无他人手牌名（l3 断言）
- [ ] 无新增按武将 id 的 AI 分支：`rg -n "if\([^)]*general===" bot.js` → 0
- [ ] `?v=` 已同步并 push；progress-log 已记
- [ ] 多步两阶段状态跨调度不残留（resetBotTwoStep 断言）

- [ ] **Step 3: progress-log 追加**（第一批交付：seatPick 协议/多步两阶段/dying/duel/aoeResp/wugu/选将/观星/化身/巧变/恩怨；无密钥逐字保证；`?v=`；测试清单）

```bash
git add docs/ && git commit -m "docs: AI决策覆盖第一批交付记录"
git push origin wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| §3.1 seatPick 协议（11 简单单选） | T1（2 个）+ T2（5 个）+ T3（4 个） |
| §3.2 多步 L3（借刀/离间/丈八/仁德） | T4（框架+借刀）+ T5（3 个） |
| §4 dying/duel/aoeResp/wugu/选将 | T6 + T7 |
| §5 观星（方案 A） | T8 |
| §6 化身/巧变/恩怨 | T9 |
| §7 无密钥回归/隐藏信息 | 各 Task 测试 + T10 验收 |
| §8 测试矩阵 | T1 harness + 各 Task 追加 |
| §9 边界（不强C/不新协议/不迁借刀响应/恩怨选牌留旧） | 各 Task 明确不做；T10 记录 |
| §10 验收标准 | T10 |

## Placeholder 扫描

- T4 借刀提交函数名、T5 离间牌条件、T9 qiaobianMove 参数签名、T2 挑衅是否多步：均为"实现时 rg 确认"的**确定性核对项**（给了明确的 rg 指令与决策规则），不是开放式 TODO——实现者按指令核对后写死并报告。
- 所有候选/fallback/execute 代码块为完整实现骨架，实现者照抄+按核对项补签名。

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；T10 验收门最后执行。
