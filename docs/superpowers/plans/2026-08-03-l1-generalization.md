# L1 泛化 + seatPick 接线修复 + 分配类技能覆盖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①修复 seatPick 未接线 bug（11 个座位技能恢复 AI 可达）；②L1 controlsChoice 泛化（响应类 70+ 阶段有密钥自动 AI 化）；③分配类技能覆盖（纯按钮类走 L1 自动、选牌类专用注册）。

**Architecture:** 三块都在现有总线上叠加：①runBotDecision 补 `botDecide('seatPick')` 接线（play 分支 + 三个 pending 阶段）；②`controlsChoiceMatch` 从 allowlist 放宽为 `(aiReady || allowlist) && !EXCLUDE`，有/无密钥路径解耦（无密钥走旧分支）；③分配类纯按钮阶段（liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice）由 L1 自动覆盖（零注册），选牌类（yijiAssign/lirangAsk/xiaoguo）专用注册（复用 botTwoStepA 跨调度累积机制）。

**Tech Stack:** 纯静态多文件 JS（无构建）；vm 沙箱测试（`run_ai_bus_l1_test.js`/`run_ai_bus_l3_test.js`）；`?v=` cache-bust。

**Spec:** `docs/superpowers/specs/2026-08-03-l1-generalization-design.md`（含 §6.5 补充）

## Global Constraints

- **分支**：只在 `wenwen_dev` 提交/推送，不进 `main`
- **有密钥**：L1 泛化接管所有渲染按钮的响应阶段（除 EXCLUDE）；无密钥：L1 match 返回 false → 走旧分支（行为逐字，红线守住）
- **allowlist 三阶段**（wuxie/luoyingAsk/luoshen）：无密钥也接管（fallback 点按钮=旧行为，B3 已论证）
- **EXCLUDE 集合**：已有专用注册/专用逻辑的阶段（wugu/pick/guicai/ganglieChoice/guhuoQuestion/qiaobianMove/enyuan*/jiedaoChoice/duanbingChoose/huogong*/fanjianSuit/quhuRespond/tianyiRespond/xiaoguo*/zhijiChoice/huashenChange*/tieqi/liegong/qilin/hanbing/mengjin/shaOffsetChoice）——实现时按 runBotDecision 现有接线逐一核对，宁加勿漏；注释写明维护纪律
- **seatPick 接线修复**：play 分支在四个多步之后、runBotActionWindow 之前；guhuoTarget/xuanfengPick/quhuDamageChoice 三个 pending 阶段各加一处
- **分配类纯按钮阶段**（liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice）：不写注册，靠 L1 自动覆盖（测试断言）
- **分配类选牌阶段**（yijiAssign/lirangAsk/xiaoguo）：专用注册；跨调度累积复用 `botTwoStepA`（不入 Firebase）
- **禁止**新增按武将 id 分支、禁止新 AI 响应协议
- **`?v=`**：改动 bot.js 时全部 13 处同步 +1（当前基线 282）
- **测试**：vm 加载真实源码；`let` 变量用 `vm.runInContext('x=...')`；函数声明可替换 spy
- **收尾**：progress-log-8.md 追加（最新分段）
- **执行顺序**：G1→G2→G3→G4→G5→G6，各自独立 commit

---

## File map

| File | Responsibility |
|------|----------------|
| `bot.js` | `CONTROLS_CHOICE_EXCLUDE`、`controlsChoiceMatch` 放宽、runBotDecision seatPick 接线、分配类专用注册（yijiAssign/lirangAsk/xiaoguo） |
| `run_ai_bus_l1_test.js` | L1 泛化测试（代表阶段双向、EXCLUDE 不被抢、allowlist 回归） |
| `run_ai_bus_l3_test.js` | seatPick 接线全链路测试 + 分配类专用注册测试 |
| `index.html` | `?v=` 同步（282→283→284…） |
| `docs/progress-log-8.md` | G6 追加交付记录 |

---

### Task G1: seatPick 接线修复（bug）

**Files:**
- Modify: `bot.js` — runBotDecision
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: `BOT_DECISIONS.seatPick`（已有，含 11 技能注册）
- Produces: runBotDecision 中 4 处 `botDecide('seatPick')` 接线

- [ ] **Step 1: 写失败测试（runBotDecision 全链路）**

在 `run_ai_bus_l3_test.js` 追加（构造 g：play 阶段、手牌有可发动技能条件，如断粮=黑色基本牌 + 距离≤2 存活目标）：
1. 有密钥：`runBotDecision(g, 0)` → seatPick 技能候选出现（spy botDecide 或 spy 服务端函数收到选择）——**当前会失败：seatPick 从未被调用**
2. 有密钥 mock 选断粮→目标 → `duanLiang(idx, target)` spy 收到
3. 无密钥：play 阶段断粮在候选但 fallback null（不动作）→ runBotActionWindow 正常推进（endPlay 或出牌），不崩
4. 三个 pending 阶段接线：guhuoTarget（pending.type==='guhuoTarget' && sourceSeat===seat）→ `guhuoChooseTarget` spy；xuanfengPick（from===seat && stage==='selecting'）→ `pickXuanfengTarget` spy；quhuDamageChoice（seat===seat）→ `respondQuhuDamage` spy

- [ ] **Step 2: 跑测试确认失败**（seatPick 未接线，断言"未被调用"）

```bash
source ~/.nvm/nvm.sh 2>/dev/null; node run_ai_bus_l3_test.js
```

Expected: 新断言 FAIL（服务端函数从未被调）

- [ ] **Step 3: 实现接线**

runBotDecision play 分支（现 2610-2615 区域）改为：

```js
if(g.phase==='play'&&g.turn===seat){
  if(await botDecide('jiedaoTwoStep', g, seat)) return;
  if(await botDecide('lijianTwoStep', g, seat)) return;
  if(await botDecide('zhangbaTwoStep', g, seat)) return;
  if(await botDecide('rendeTwoStep', g, seat)) return;
  // 【L1泛化批次】seatPick 接线修复:11 个座位技能(断粮/奇袭/国色/武圣/双雄/挑衅/
  // 反间/青囊等)此前只注册未接线,机器人从不主动使用。命中的技能候选(技能→目标)
  // 合并成一张表 AI 选;未命中返回 false 走 runBotActionWindow(手牌枚举),两者不冲突
  // (seatPick 技能无 CARD_PLAYS 入口;武圣/双雄的 CARD_PLAYS 路径与 seatPick 的
  // "技能按钮"路径候选 label 不同,双路径都合法,不排除——测试锁定)。
  if(await botDecide('seatPick', g, seat)) return;
  await runBotActionWindow(g, seat); return;
}
```

三个 pending 阶段接线（插入 runBotDecision 合适位置，与既有分支相邻）：

```js
if(g.phase==='guhuoTarget' && d && d.type==='guhuoTarget' && d.sourceSeat===seat){
  if(await botDecide('seatPick', g, seat)) return;
}
if(g.phase==='xuanfengPick' && d && d.type==='xuanfengPick' && d.from===seat && d.stage==='selecting'){
  if(await botDecide('seatPick', g, seat)) return;
}
if(g.phase==='quhuDamageChoice' && d && d.type==='quhuDamageChoice' && d.seat===seat){
  if(await botDecide('seatPick', g, seat)) return;
}
```

- [ ] **Step 4: 跑测试确认通过**（新断言 GREEN + 既有 93 项回归）

- [ ] **Step 5: 全量回归 + `?v=282→283` + Commit**

```bash
node run_ai_bus_l3_test.js && node run_ai_bus_core_test.js && node run_ai_bus_c_window_test.js && node --check bot.js
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "fix(bot): seatPick接线修复(11座位技能恢复AI可达)"
git push origin wenwen_dev
```

---

### Task G2: L1 泛化（controlsChoiceMatch 放宽 + EXCLUDE）

**Files:**
- Modify: `bot.js` — `CONTROLS_CHOICE_ALLOWLIST` 区域、`controlsChoiceMatch`
- Modify: `run_ai_bus_l1_test.js`

**Interfaces:**
- Consumes: `BOT_DECISIONS.controlsChoice`（既有，候选收集/fallback/execute 零改动）
- Produces: `CONTROLS_CHOICE_EXCLUDE`（Set）、放宽后的 `controlsChoiceMatch`

- [ ] **Step 1: 写失败测试**

在 `run_ai_bus_l1_test.js` 追加：
1. **代表阶段有密钥接管**：qilin（pending 有可弃坐骑）→ `botDecide('controlsChoice')` 返回 true、候选=按钮、mock 选 → `qilinResolve` spy；hanbing 同理；liuli（构造 pending.type==='liuli' && to===seat）→ 候选=「弃X→目标」组合按钮、mock 选 → `respondLiuli` spy
2. **同阶段无密钥走旧分支**：qilin 无密钥 → `botDecide('controlsChoice')` 返回 false；runBotDecision 走旧分支（`qilinResolve` spy 按旧逻辑）
3. **allowlist 三阶段无密钥不变**（既有断言回归）
4. **EXCLUDE 阶段不被抢**：wugu/pick/guicai/ganglieChoice/guhuoQuestion/qiaobianMove 构造 pending + 有密钥 → `botDecide('controlsChoice')` 返回 false

- [ ] **Step 2: 跑测试确认失败**（当前 match 只放行 3 阶段，qilin/liuli 返回 false）

- [ ] **Step 3: 实现**

```js
// 【L1 泛化】已有专用注册/专用逻辑的阶段,L1 不接管(防止双重接管/绕过专用候选的
// 隐藏信息处理)。维护纪律:新增专用注册时,把该 phase 同步加进这个集合。
const CONTROLS_CHOICE_EXCLUDE = new Set([
  'wugu','pick','guicai','ganglieChoice','guhuoQuestion','qiaobianMove',
  'enyuanChooseOption','enyuanChoose','enyuanGiveCard','jiedaoChoice',
  'duanbingChoose','huogong','huogongReveal','fanjianSuit','quhuRespond',
  'tianyiRespond','xiaoguo','xiaoguoChoice','zhijiChoice',
  'huashenChangeAskStart','huashenChangeAskEnd','tieqi','liegong',
  'qilin','hanbing','mengjin','shaOffsetChoice',
]);

function controlsChoiceMatch(g, seat){
  if(!g || !g.pending) return false;
  // 【L1 泛化】allowlist 三阶段无密钥也接管(旧分支已删/等价性已论证);其余所有阶段
  // 仅 aiReady 时接管——无密钥返回 false,runBotDecision 继续走该阶段既有旧分支,
  // 行为逐字不变(有/无密钥路径解耦,不再需要逐阶段等价性论证)。
  const aiReady = typeof aiApiKey!=='undefined' && aiApiKey && aiProvider;
  if(!(aiReady || CONTROLS_CHOICE_ALLOWLIST.has(g.phase))) return false;
  if(CONTROLS_CHOICE_EXCLUDE.has(g.phase)) return false;
  return botSeatForState(g)===seat;
}
```

**接线位置核对**：controlsChoice 的 `botDecide('controlsChoice')` 调用现位于 runBotDecision ~2651（dying/duel/aoeResp 之后）。**实现时确认**：被 L1 泛化覆盖的阶段（liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice 等）在 runBotDecision 中**没有**位于 2651 之前的专用分支（若有则旧分支先命中、L1 到不了——实现时 rg 核对，若某阶段旧分支在前则把 L1 接线提前到该分支之前，并测试锁定）。

- [ ] **Step 4: 跑测试确认通过** + 全量回归（l1 8+新、l3 93+新、core/l2/c_window/info/model_picker）

- [ ] **Step 5: `?v=283→284` + Commit**

```bash
git add bot.js run_ai_bus_l1_test.js index.html
git commit -m "feat(bot): L1泛化 响应类有密钥自动AI化(EXCLUDE防双重接管)"
git push origin wenwen_dev
```

---

### Task G3: 分配类纯按钮阶段覆盖验证（liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice）

**Files:**
- Modify: `run_ai_bus_l1_test.js`（只加测试，无业务代码——L1 泛化后自动覆盖）

**Interfaces:**
- Consumes: L1 泛化（G2）
- Produces: 5 个纯按钮阶段自动覆盖的测试证据

- [ ] **Step 1: 写测试（验证 L1 自动覆盖，无注册）**

对每个阶段构造 pending + 有密钥：
- `liuli`（pending.type==='liuli' && to===seat，me 有可弃牌、pending.targets 有目标）→ `botDecide('controlsChoice')` true，候选=「弃X→目标」按钮、mock 选 → `respondLiuli(opt, t)` spy
- `tianxiang`（seat===seat，me 有红桃、targets 有目标）→ `respondTianxiang` spy
- `lirangRecover`（from===seat）→ 候选=[获得弃牌,不获得]、mock → `respondLiRangRecover` spy
- `zhengyi`（asking===seat）→ `respondZhengyi` spy
- `xiaoguoChoice`（to===seat，目标有装备）→ `respondXiaoguoChoice` spy

无密钥对照：各阶段 `botDecide('controlsChoice')` 返回 false（走旧分支/兜底，不崩）。

- [ ] **Step 2: 跑测试确认通过**（若某阶段失败=该阶段旧分支在 L1 接线之前命中，按 G2 Step 3 的核对规则处理）

- [ ] **Step 3: 回归 + Commit**

```bash
node run_ai_bus_l1_test.js && node run_ai_bus_l3_test.js && node --check bot.js
git add run_ai_bus_l1_test.js
git commit -m "test(bot): 分配类纯按钮阶段L1自动覆盖验证"
git push origin wenwen_dev
```

---

### Task G4: yijiAssign 专用注册（遗计分配，跨调度累积）

**Files:**
- Modify: `bot.js` — 新 `BOT_DECISIONS.yijiAssign`
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: `botTwoStepA` 机制（T4 已建）、`respondYijiAssign(assignments)`（skills.js:1380）
- Produces: `BOT_DECISIONS.yijiAssign`（match/buildCandidates/localFallback/execute）

- [ ] **Step 1: 写失败测试**

1. match：phase==='yijiAssign' && pending.type==='yijiAssign' && pending.seat===seat
2. buildCandidates：`pending.cards` 当前第 `yijiPicks.length` 张 × 存活角色 → 候选「给 牌X → 角色Y」；无累积时从第 0 张开始
3. 有密钥 mock 选「给 牌0 → 角色1」→ 非最后一张：`botTwoStepA={decisionId:'yijiAssign', picks:[1]}` 设置、不提交；第二次调度 mock 选最后一张 → `respondYijiAssign([1, 2])` spy 提交
4. 无密钥：fallback 逐字（旧行为？实现时 rg `yijiAssign` 旧分支/兜底——若无旧分支则 fallback=每人给第一张或「给 自己」保守默认，测试锁定）
5. 跨调度不残留：提交后 `resetBotTwoStep()`

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

```js
// ============ 分配类:yijiAssign(郭嘉遗计分配,跨调度累积) ============
// 【本决策点是什么】遗计判定后摸 2 张牌,依次为每张牌选择接收者(人类是"每张牌点一个
// 角色,最后一张点击即提交")。机器人侧复用 botTwoStepA 跨调度累积:非最后一张的选择
// 存进 {decisionId:'yijiAssign', picks},下一调度继续选下一张;最后一张选完一次性提交
// respondYijiAssign(picks)。无密钥 fallback 与"改动前"一致(改动前无覆盖,走
// botSafePrompt 兜底=通常不动作;取保守默认"给 自己"并测试锁定)。
BOT_DECISIONS.yijiAssign = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='yijiAssign' && d && d.type==='yijiAssign' && d.seat===seat;
  },
  buildCandidates: function(g, seat){
    const d = g.pending;
    const cards = d.cards || [];
    const picks = (botTwoStepA && botTwoStepA.decisionId==='yijiAssign') ? botTwoStepA.picks : [];
    const idx = picks.length; // 当前正在为第几张选接收者
    const card = cards[idx];
    if(!card || idx >= cards.length) return [];
    const out = [];
    g.players.forEach(function(p, i){
      if(!p || !p.alive) return;
      out.push({ idx: idx, targetSeat: i, label: '给 '+(i===seat?'自己':p.name)+' 【'+card.name+'】' });
    });
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 保守默认:当前这张牌给 自己(改动前无覆盖;有密钥 AI 失败时也用它)
    return candidates.find(function(c){ return c.targetSeat===seat; }) || candidates[0] || null;
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    const picks = (botTwoStepA && botTwoStepA.decisionId==='yijiAssign') ? botTwoStepA.picks.slice() : [];
    picks.push(choice.targetSeat);
    const cards = (g.pending && g.pending.cards) || [];
    if(picks.length >= cards.length){
      // 最后一张:提交并清状态
      resetBotTwoStep();
      botInvoke(seat, function(){ respondYijiAssign(picks); });
    } else {
      // 非最后一张:累积,等下一调度继续
      botTwoStepA = { decisionId: 'yijiAssign', picks: picks };
    }
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。当前是【遗计】分配阶段:候选列表里的每一项'
      +'是"把当前这张牌交给某名角色"。请结合局面选择每张牌最合适的接收者(自己/队友/'
      +'敌人按需判断)。只能选列表内选项。只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 80,
};
```

**runBotDecision 接线**：在 huashenSkill 附近（有 pending 的专用阶段区）加：
```js
if(g.phase==='yijiAssign' && d && d.type==='yijiAssign' && d.seat===seat){
  if(await botDecide('yijiAssign', g, seat)) return;
}
```
（`botTwoStepA` 挂起守卫：`yijiAssign` 的 match 不看 botTwoStepA，但 runBotDecision 顶部若已有"botTwoStepA 挂起时先处理挂起决策"的分支——T5 建的 4 决策 if 链只处理四个多步，**实现时核对** yijiAssign 挂起时下一调度能否到达本分支；若被 play 分支的挂起守卫挡住（play 分支要求 g.phase==='play'，yijiAssign 阶段 phase 不是 play，不会挡）——确认无冲突。）

- [ ] **Step 5: 回归 + `?v=284→285` + Commit**

```bash
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): yijiAssign遗计分配专用注册(跨调度累积)"
git push origin wenwen_dev
```

---

### Task G5: lirangAsk 专用注册 + xiaoguo 处理

**Files:**
- Modify: `bot.js`
- Modify: `run_ai_bus_l3_test.js`

**Interfaces:**
- Consumes: `respondLiRang(activate, cardIdxs)`（game.js:2334）、`respondXiaoguo(activate, cardIdx)`（skills.js:1660）、`botTwoStepA`
- Produces: `BOT_DECISIONS.lirangAsk`（两阶段：组合→提交）；`xiaoguo` 决定（专用注册 or EXCLUDE）

- [ ] **Step 1: 写失败测试**

**lirangAsk**：
1. match：phase==='lirangAsk' && pending.type==='lirangAsk' && pending.from===seat
2. 阶段A：候选=「2 张手牌组合」（仿 discardSubset 组合生成，组合≤8，label 含牌名）；目标=pending.to（服务端已定，不选）
3. 有密钥 mock 选组合 → 直接 `respondLiRang(true, picks)` spy（单阶段：目标服务端已定，组合选完即提交）
4. 无密钥：fallback=不发动（`respondLiRang(false, [])`，与旧兜底一致）
5. 手牌<2：无候选（不发动单候选或 match false）

**xiaoguo**（实现时按成本决定，两条路二选一，报告说明）：
- 路径 A（专用注册）：候选=手牌每张基本牌（杀/闪/桃）→ `respondXiaoguo(true, cardIdx)`；无密钥 fallback=不发动
- 路径 B（EXCLUDE 暂缓）：加入 `CONTROLS_CHOICE_EXCLUDE`，保持 botSafePrompt 兜底（AI 不发动）
- **推荐路径 B**（骁果价值低、xiaoguoMode 多步状态机复杂、`respondXiaoguo(activate, cardIdx)` 需核实是否单步可提交——若 `respondXiaoguo(true, idx)` 单步可提交则路径 A 便宜，否则 B）

- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**

**lirangAsk 实现**（单阶段：目标=服务端已定的 pending.to，只需选组合）：

```js
// ============ 分配类:lirangAsk(孔融礼让发动,单阶段选组合) ============
// 【本决策点是什么】礼让:摸牌阶段开始时交给目标两张手牌。目标(pending.to)由服务端
// 算好(render-controls 显示"交给 '目标'"),AI 只需选"哪两张手牌"——候选=2 张手牌
// 组合(仿 discardSubset 组合生成,默认组合恒在=第一张+第二张),选完即提交
// respondLiRang(true, picks)。无密钥 fallback=不发动(与改动前兜底一致)。
BOT_DECISIONS.lirangAsk = {
  match: function(g, seat){
    const d = g.pending;
    return g.phase==='lirangAsk' && d && d.type==='lirangAsk' && d.from===seat;
  },
  buildCandidates: function(g, seat){
    const me = g.players[seat];
    const hand = me.hand || [];
    if(hand.length < 2) return [];
    const out = [];
    const seen = new Set();
    for(let a=0; a<hand.length && out.length<8; a++){
      for(let b=a+1; b<hand.length && out.length<8; b++){
        const key = a+','+b;
        if(seen.has(key)) continue;
        seen.add(key);
        out.push({ cardIdxs: [a, b], isDefault: out.length===0, label: '交【'+hand[a].name+'】与【'+hand[b].name+'】' });
      }
    }
    return out;
  },
  localFallback: function(g, seat, candidates){
    // 不发动(与改动前一致;改动前 lirangAsk 无覆盖走 botSafePrompt 兜底,通常不动作)
    return null; // null=无动作 → botDecide 返回 true,不执行
  },
  execute: function(g, seat, choice){
    if(!choice) return;
    botInvoke(seat, function(){ respondLiRang(true, choice.cardIdxs); });
  },
  buildSystemPrompt: function(){
    return '你在扮演网页版三国杀的AI机器人。当前是【礼让】发动阶段:候选列表每一项是'
      +'"交给目标的两张手牌"组合。请结合手牌价值选择是否发动、交哪两张(通常交价值低的)。'
      +'只输出 {"choice":数字},不要解释。';
  },
  maxTokens: 80,
};
```

**runBotDecision 接线**：`if(g.phase==='lirangAsk' && d && d.type==='lirangAsk' && d.from===seat){ if(await botDecide('lirangAsk', g, seat)) return; }`

**xiaoguo**：按推荐路径 B——把 `'xiaoguo'` 加入 `CONTROLS_CHOICE_EXCLUDE`（G2 已含），保持兜底；若实现时确认 `respondXiaoguo(true, cardIdx)` 单步可提交且便宜，改走路径 A（专用注册），报告说明选择与理由。

- [ ] **Step 5: 回归 + `?v=285→286` + Commit**

```bash
git add bot.js run_ai_bus_l3_test.js index.html
git commit -m "feat(bot): lirangAsk礼让发动专用注册(+xiaoguo处理)"
git push origin wenwen_dev
```

---

### Task G6: 验收门 + progress-log-8 追加

**Files:**
- Modify: `docs/progress-log-8.md`（追加）
- 无代码改动预期（除非回归）

- [ ] **Step 1: 全量回归**

```bash
source ~/.nvm/nvm.sh 2>/dev/null
node run_ai_bus_core_test.js && node run_ai_bus_info_test.js && node run_ai_bus_l1_test.js
node run_ai_bus_l2_test.js && node run_ai_bus_c_window_test.js && node run_ai_bus_l3_test.js
node run_ai_bus_model_picker_test.js && node --check bot.js
```

- [ ] **Step 2: 验收门核对**

- [ ] seatPick 接线：play 阶段 + 3 pending 阶段全链路测试绿（G1）
- [ ] L1 泛化：代表阶段（qilin/hanbing/liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice）有密钥接管、无密钥走旧分支（G2/G3）
- [ ] EXCLUDE 阶段 L1 永不接管（G2 断言）
- [ ] allowlist 三阶段无密钥不变（回归）
- [ ] yijiAssign/lirangAsk 专用注册：跨调度累积、无密钥 fallback 逐字（G4/G5）
- [ ] `?v=286` 已 push；progress-log-8 已追加
- [ ] 0 处按武将 id 分支：`rg -n "if\([^)]*general===" bot.js` → 0

- [ ] **Step 3: progress-log-8 追加**

内容：seatPick 接线修复（bug 背景+修复）、L1 泛化（有/无密钥解耦、EXCLUDE 集合、维护纪律）、分配类覆盖（纯按钮 5 阶段 L1 自动 + yijiAssign/lirangAsk 专用注册 + xiaoguo 处理决定）、测试计数、`?v=286`。

```bash
git add docs/progress-log-8.md
git commit -m "docs: L1泛化批次交付记录"
git push origin wenwen_dev
```

---

## Spec 覆盖自检

| Spec 项 | Task |
|---------|------|
| §2.1 match 放宽 | G2 |
| §2.2 EXCLUDE 集合 | G2 |
| §6.5.1 seatPick 接线修复 | G1 |
| §6.5.2 分配类纯按钮（L1 自动） | G3 |
| §6.5.2 分配类选牌（yijiAssign/lirangAsk/xiaoguo） | G4/G5 |
| §3 风险（多步状态机抽查、接线位置） | G2/G3/G5 实现时核对 |
| §4 测试矩阵 | G1-G5 |
| §6 验收 + progress-log | G6 |

## Placeholder 扫描

- G5 xiaoguo 路径 A/B 二选一：给定了明确决策规则（`respondXiaoguo(true, cardIdx)` 单步可提交则 A 否则 B），实现时按 rg 结论写死并报告
- G3 接线位置核对：给定了规则（旧分支在前则提前 L1），实现时 rg 确认
- 所有代码块为完整实现，无开放式 TODO

## 建议提交节奏

每 Task 一次 commit + push `wenwen_dev`；G6 验收门最后执行。
