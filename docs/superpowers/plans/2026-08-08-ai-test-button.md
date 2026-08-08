# AI 测试托管按钮 + 决策信息窗 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在调试日志按钮下新增 AI 测试按钮，点击开启 AI 持续托管当前真人玩家，并弹出可拖动/可调整大小的信息窗，折叠式记录 AI 获取的信息、返回的信息与理由。

**Architecture:** 复用现有 bot 决策链（`runBotDecision`/`scheduleBotTurn`/`BOT_DECISIONS` 全部 ~33 分支），在 isBot 守卫处加模块级 autopilot 覆盖标志把真人座位视同 bot；理由采集通过 `callAiChooseIndex` 内部检测托管状态追加 prompt 指令并解析 `{choice, reason}`；弹窗为独立 `#aiTestModal`（仿 `#infoModal` 模式）+ header 拖动 + 右下角 resize 手柄。

**Tech Stack:** 纯前端多文件无构建（共享全局作用域，无 ES module）。测试用 vm 沙箱加载真实源码 + mock `callAI`。

## Global Constraints

- 正常机器人路径零变化（回归红线）：未开启托管时 `runBotDecision`/`callAiChooseIndex` 行为与现在逐字一致
- 隐藏信息红线：record 里 stateInfo 只存 `buildBotVisibleState(g, seat)` 的输出（他人手牌只张数、身份按可见性），不存任何隐藏信息
- `?v=` 337→338（index.html 全部 15 处 `src="*.js?v=` 同步递增，保持同一数字）
- 托管状态为模块级纯客户端变量（`aiTestAutopilot`），**不写入 Firebase**
- 无 AI 密钥时点按钮不开启托管，弹 `showAiKeyModal` 提示配置
- 所有新增函数遵守项目约定：函数体内不出现裸 `g`/`window.g`；数组字段若可能为空经 Firebase 往返需在 normalize 补默认（本次无新持久化字段）
- 新增代码注释用简体中文

---

### Task 1: index.html —— 按钮 + 弹窗 DOM + CSS

**Files:**
- Modify: `index.html`（1976 行 `debugLogBtn` 下方加按钮；1979 行 `infoModal` 附近加 `#aiTestModal`；CSS 区加样式；`?v=337→338` 全部 15 处）

**Interfaces:**
- Consumes: 无
- Produces: `#aiTestBtn`（onclick=`toggleAiTestAutopilot()`）、`#aiTestModal`（含 `.aitest-panel/.aitest-header/.aitest-body/.aitest-record*/.aitest-footer`、`.aitest-resize-handle`）、CSS class `aitest-active`

- [ ] **Step 1: 加按钮 HTML**

在 `index.html` 1976 行 `<button id="debugLogBtn" ...>🐛</button>` 正下方加：

```html
<button id="aiTestBtn" class="icon-btn" title="AI测试:AI托管当前玩家并显示决策信息" onclick="toggleAiTestAutopilot()">🤖</button>
```

- [ ] **Step 2: 加弹窗 DOM**

在 `index.html` 1981 行 `<div id="aiKeyModal" class="hidden"></div>` 之后加：

```html
<div id="aiTestModal" class="hidden">
  <div class="aitest-panel">
    <div class="aitest-header">🤖 AI测试 <span id="aiTestStatus">未托管</span><button id="aiTestCloseBtn" class="aitest-close icon-btn" onclick="closeAiTestModal()">✕</button></div>
    <div class="aitest-body" id="aiTestBody"></div>
    <div class="aitest-footer">
      <button class="aitest-foot-btn" onclick="clearAiTestRecords()">清空</button>
      <span class="aitest-hint">点击记录行展开详情</span>
    </div>
    <div class="aitest-resize-handle" title="拖动调整大小"></div>
  </div>
</div>
```

- [ ] **Step 3: 加 CSS**

在 `index.html` 的 `<style>` 内、`#infoModal` 相关 CSS 附近（1135 行左右）追加：

```css
/* ===== AI测试信息窗(可拖动/可调整大小) ===== */
#aiTestModal{position:fixed;top:70px;right:12px;left:auto;bottom:auto;width:420px;max-width:80vw;height:480px;max-height:80vh;z-index:120;display:flex;align-items:stretch;justify-content:stretch;box-shadow:0 4px 20px rgba(0,0,0,.45)}
#aiTestModal.hidden{display:none}
.aitest-panel{position:relative;display:flex;flex-direction:column;width:100%;height:100%;background:var(--paper,#f5ecd9);border:1px solid var(--paper-dim,#a0926e);border-radius:8px;overflow:hidden;box-sizing:border-box}
.aitest-header{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--cinnabar,#a03a2a);color:#fff;font-size:14px;font-weight:600;cursor:move;user-select:none}
.aitest-close{margin-left:auto;background:transparent;color:#fff}
.aitest-body{flex:1 1 auto;overflow-y:auto;padding:8px;font-size:13px}
.aitest-record{border:1px solid var(--paper-dim,#a0926e);border-radius:6px;margin-bottom:6px;background:rgba(255,255,255,.5)}
.aitest-record-summary{padding:6px 8px;cursor:pointer;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.aitest-record-summary .aitest-arrow{color:var(--cinnabar,#a03a2a);font-size:11px}
.aitest-record-detail{padding:6px 8px;border-top:1px dashed var(--paper-dim,#a0926e);font-size:12px;line-height:1.5;word-break:break-all}
.aitest-record-detail .aitest-sec{font-weight:600;color:var(--cinnabar,#a03a2a);margin-top:4px}
.aitest-record-detail pre{white-space:pre-wrap;background:rgba(0,0,0,.06);border-radius:4px;padding:4px;font-size:11px;max-height:160px;overflow-y:auto}
.aitest-footer{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:4px 10px;border-top:1px solid var(--paper-dim,#a0926e)}
.aitest-hint{font-size:11px;color:var(--paper-dim,#a0926e);margin-left:auto}
.aitest-resize-handle{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--cinnabar,#a03a2a) 50%);border-bottom-right-radius:8px}
#aiTestBtn.aitest-active{background:var(--cinnabar,#a03a2a);color:#fff}
```

- [ ] **Step 4: `?v=` 递增**

`?v=337` → `?v=338`，全部 15 处（config/data/debug-log/room-lifecycle/game/weapons/skills/bot-ai-bus/bot/ai-bot/render/render-table/render-hand/render-controls/render-log）。

- [ ] **Step 5: 验证**

Run: `grep -c '?v=338' index.html` → 期望 15；`grep -c '?v=337' index.html` → 期望 0；`node --check` 不适用（HTML），人工确认按钮/弹窗 DOM 结构闭合。

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: AI测试按钮+信息窗DOM/CSS(?v=338)"
```

---

### Task 2: bot-ai-bus.js —— 理由解析 + callAiChooseIndex 托管检测

**Files:**
- Modify: `bot-ai-bus.js`（18-32 行 `parseBotPlayAiChoice` 后新增解析函数；131-162 行 `callAiChooseIndex` 内部加托管检测与 withReason）

**Interfaces:**
- Consumes: 现有 `parseBotPlayAiChoice(text)`（bot-ai-bus.js:18）、`aiTestAutopilot`（Task 4 定义，运行时读，`typeof` 防御）
- Produces: `parseBotPlayAiChoiceWithReason(text)` → `{idx:number|null, reason:string|null}`；`callAiChooseIndex(opts)` 在托管命中时返回的 idx 不变、同时把 reason 写入模块级 `aiTestLastReason`（供 record 采集）

- [ ] **Step 1: 写失败测试（解析函数）**

在测试文件 `run_ai_test_button_test.js` 中（Task 6 完整建，这里先建含解析断言的骨架）：

```js
await check('parseBotPlayAiChoiceWithReason: 带reason解析', function(){
  const r = parseBotPlayAiChoiceWithReason('{"choice":2,"reason":"因为对面血量低"}');
  if(r.idx!==2 || r.reason!=='因为对面血量低') throw new Error('应 {idx:2,reason:...},实际 '+JSON.stringify(r));
});
await check('parseBotPlayAiChoiceWithReason: 无reason回退老解析', function(){
  const r = parseBotPlayAiChoiceWithReason('{"choice":1}');
  if(r.idx!==1 || r.reason!==null) throw new Error('应 {idx:1,reason:null},实际 '+JSON.stringify(r));
});
await check('parseBotPlayAiChoiceWithReason: 代码块包裹', function(){
  const r = parseBotPlayAiChoiceWithReason('```json\n{"choice":0,"reason":"r"}\n```');
  if(r.idx!==0 || r.reason!=='r') throw new Error('应剥代码块,实际 '+JSON.stringify(r));
});
await check('parseBotPlayAiChoiceWithReason: 垃圾输入回退null', function(){
  const r = parseBotPlayAiChoiceWithReason('你好');
  if(r.idx!==null) throw new Error('应 null,实际 '+JSON.stringify(r));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node run_ai_test_button_test.js` → 期望 `parseBotPlayAiChoiceWithReason is not defined`

- [ ] **Step 3: 实现解析函数**

在 `bot-ai-bus.js` `parseBotPlayAiChoice` 函数（32 行 `}`）之后插入：

```js
// parseBotPlayAiChoiceWithReason:AI测试托管模式的解析——AI 在返回 choice 的同时附一句
// 中文理由({"choice":N,"reason":"..."})。复用老解析的宽容策略(JSON.parse失败剥代码块
// 重试一次);解析出 choice 时顺带提取 reason(无 reason 字段则为 null);整体失败回退
// 老解析函数(仍失败则 idx=null)。返回 {idx, reason}。
function parseBotPlayAiChoiceWithReason(text){
  if(typeof text!=='string') return {idx:null, reason:null};
  const tryParse=(s)=>{
    try{
      const obj=JSON.parse(s.trim());
      if(obj && typeof obj.choice==='number' && Number.isInteger(obj.choice)){
        return {idx:obj.choice, reason:(typeof obj.reason==='string' && obj.reason) ? obj.reason : null};
      }
    }catch(e){}
    return null;
  };
  let r=tryParse(text);
  if(r!==null) return r;
  const stripped=text.replace(/```(?:json)?/gi,'').trim();
  if(stripped!==text) r=tryParse(stripped);
  if(r!==null) return r;
  const old=parseBotPlayAiChoice(text);
  return {idx:old, reason:null};
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node run_ai_test_button_test.js` → 期望 4 项解析断言 PASS

- [ ] **Step 5: 修改 callAiChooseIndex（托管检测 + withReason prompt）**

在 `callAiChooseIndex`（bot-ai-bus.js:131）中做两处修改：

**修改点 A**——函数开头（`const candidates = opts.candidates || [];` 之后）加托管检测：

```js
const candidates = opts.candidates || [];
// 【AI测试托管】检测当前座位是否处于托管模式:命中则该次询问要求 AI 附理由,
// 并把解析出的理由存入模块级 aiTestLastReason(供信息窗 record 采集)。
const autopilotHit = (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
  && aiTestAutopilot.active && aiTestAutopilot.seat===opts.seat;
if(typeof aiTestLastReason==='undefined') var aiTestLastReason = null;
```

**修改点 B**——callAI 的 systemPrompt 拼接处（148 行 `systemPrompt: ...`）改为：

```js
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote
        + (autopilotHit ? '\n\n(本次为AI测试托管)在返回choice的同时,用一句中文解释你的选择理由。返回格式:{"choice":数字,"reason":"理由文本"}' : ''),
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
```

**修改点 C**——解析处（159 行 `const idx = parseBotPlayAiChoice(result.text);` 起）改为：

```js
  if(!result || !result.ok){
    aiTestLastReason = null;
    return null;
  }
  let idx, reason;
  if(autopilotHit){
    const pr = parseBotPlayAiChoiceWithReason(result.text);
    idx = pr.idx; reason = pr.reason;
  } else {
    idx = parseBotPlayAiChoice(result.text);
    reason = null;
  }
  aiTestLastReason = reason;
  if(idx===null || idx<0 || idx>=candidates.length){
    if(autopilotHit) aiTestLastReason = null;
    return null;
  }
  return idx;
```

- [ ] **Step 6: 测试：托管命中时 reason 被采集 / 未托管零变化**

在测试文件中 mock `callAI`（`context.callAI = async (p,k,o)=>({ok:true,text:'{"choice":1,"reason":"测试理由"}'})`），然后：

```js
await check('callAiChooseIndex: 托管命中时返回idx且aiTestLastReason被设置', async function(){
  aiTestAutopilot = {active:true, seat:0};
  const i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
  if(i!==1) throw new Error('应返回1,实际 '+i);
  if(aiTestLastReason!=='测试理由') throw new Error('应采集理由,实际 '+aiTestLastReason);
});
await check('callAiChooseIndex: 未托管时reason保持null(零变化)', async function(){
  aiTestAutopilot = {active:false, seat:0};
  aiTestLastReason = '旧值';
  const i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
  if(i!==1) throw new Error('应返回1,实际 '+i);
  if(aiTestLastReason!==null) throw new Error('未托管不应采集理由,实际 '+aiTestLastReason);
});
```

（`g` 用 `buildBotVisibleState` 能接受的任意 `{players:[...]}` 最小对象即可；`callAiChooseIndex` 内部还会调 `showAiThinkingIndicator(g, seat)`/`hideAiThinkingIndicator`——测试 context 里 `document.getElementById` stub 已能容忍，若报错补 DOM stub。）

- [ ] **Step 7: 运行确认通过**

Run: `node run_ai_test_button_test.js` → 期望含上述 6 项 PASS

- [ ] **Step 8: Commit**

```bash
git add bot-ai-bus.js run_ai_test_button_test.js
git commit -m "feat: callAiChooseIndex托管检测+理由解析(parseBotPlayAiChoiceWithReason)"
```

---

### Task 3: bot.js —— 托管调度接入（isBot 守卫覆盖 + scheduleBotTurn）

**Files:**
- Modify: `bot.js`（283-311 `botSeatForState` 的 `isBotSeat`；3631 `runBotDecision` 首行守卫；381-459 `scheduleBotTurn` 首行守卫）

**Interfaces:**
- Consumes: `aiTestAutopilot`（Task 4 定义，运行时读，`typeof` 防御）
- Produces: 托管真人座位可经 `botSeatForState` 返回、`runBotDecision` 放行、`scheduleBotTurn` 调度

- [ ] **Step 1: 写失败测试**

```js
await check('botSeatForState: 托管开启时真人座位在play阶段被解析为行动者', function(){
  const g = mkSeatG({n:3});
  g.phase='play'; g.turn=0;
  g.players[0].isBot=false; g.players[1].isBot=true;
  aiTestAutopilot = {active:true, seat:0};
  const s = botSeatForState(g);
  if(s!==0) throw new Error('应返回0(托管真人座位),实际 '+s);
});
await check('botSeatForState: 托管关闭时真人座位恒-1(回归)', function(){
  const g = mkSeatG({n:3});
  g.phase='play'; g.turn=0;
  g.players[0].isBot=false;
  aiTestAutopilot = {active:false, seat:0};
  const s = botSeatForState(g);
  if(s!==-1) throw new Error('应返回-1,实际 '+s);
});
await check('runBotDecision: 托管真人座位可进入(不return)', async function(){
  const g = mkSeatG({n:3});
  g.phase='draw'; g.turn=0;
  g.players[0].isBot=false;
  aiTestAutopilot = {active:true, seat:0};
  // draw阶段 runBotDecision 会走 botInvoke(0, ()=>respondDrawStart/抽牌分支)——无法
  // 断言"进了分支"时改为断言"没有在首行被拦"(用一个不可能命中的phase验证守卫是否放行):
  const before = globalThis.__runBotDecisionPassed;
  await runBotDecision(g, 0); // 期望不抛错且不被首行拦截(phase=draw 有真实分支)
});
```

（`mkSeatG` 复用 run_guidu_nested_tx_fix_test.js 同款构造；draw 分支调用需要 `respondDrawStart` 等存在——vm 已加载真实源码，OK。）

- [ ] **Step 2: 运行确认失败**

Run: `node run_ai_test_button_test.js` → 期望 `botSeatForState` 第一条 FAIL（返回 -1）

- [ ] **Step 3: 改 botSeatForState 的 isBotSeat**

`bot.js:285`：

```js
// 【AI测试托管】托管中的真人座位视同机器人:isBotSeat 覆盖为"托管座位即真"。
// 一处改动覆盖 A/B 全部段落(各段都用 isBotSeat 判),托管座位在 draw/play/discard、
// 响应类 pending(BOT_PHASE_ACTOR)等全部阶段都能被调度。
const isAutopilotSeat=s=>s>=0 && (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
  && aiTestAutopilot.active && aiTestAutopilot.seat===s;
const isBotSeat=s=>Number.isInteger(s)&&g.players[s]&&(g.players[s].isBot||isAutopilotSeat(s));
```

- [ ] **Step 4: 改 runBotDecision 首行守卫**

`bot.js:3631`：

```js
  const p=g.players[seat];
  if(!p||!p.alive&&g.phase!=='pickingGeneral') return;
  const isAutopilot=(typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
    && aiTestAutopilot.seat===seat;
  if(!p.isBot&&!isAutopilot) return;
```

（注意保留原 `!p.alive&&g.phase!=='pickingGeneral'` 的语义与括号；原式 `if(!p||!p.isBot||!p.alive&&g.phase!=='pickingGeneral') return;` 拆成两行等价。）

- [ ] **Step 5: 改 scheduleBotTurn 首行守卫**

`bot.js:382`：

```js
  if(!g) return;
  // 【AI测试托管】托管当前玩家时,即使自己不是 isBotController(不是第一个真人)也要跑
  // 调度;否则托管只对房主浏览器生效。非托管场景行为与原来一致(isBotController 判定)。
  const aiTestSelf = (typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
    && aiTestAutopilot.seat===mySeat;
  if(!isBotController(g)&&!aiTestSelf) return;
```

- [ ] **Step 6: 运行确认通过 + 回归**

Run: `node run_ai_test_button_test.js` → 期望 3 项 PASS
Run: `node run_ai_bus_l3_test.js` → 期望 223 通过 0 失败（托管关闭时零变化）
Run: `node run_ai_bus_core_test.js` → 期望 10 通过

- [ ] **Step 7: Commit**

```bash
git add bot.js run_ai_test_button_test.js
git commit -m "feat: 托管真人座位接入bot调度链(botSeatForState/runBotDecision/scheduleBotTurn)"
```

---

### Task 4: ai-bot.js —— 托管状态 + 开关 + 信息窗渲染/拖动/resize

**Files:**
- Modify: `ai-bot.js`（模块级状态区 55-92 附近；文件尾追加开关与渲染函数）

**Interfaces:**
- Consumes: `aiApiKey`（ai-bot.js:55）、`showAiKeyModal`（ai-bot.js:452）、`buildBotVisibleState`（bot.js:766）、`phaseName`（render.js:1592，`typeof` 防御）、`debugLogIsoTime`（debug-log.js:19）、`aiTestLastReason`（Task 2）、`escapeHtml`（render.js:1642）
- Produces: `aiTestAutopilot`（`{active, seat, records:[]}`）、`toggleAiTestAutopilot()`、`openAiTestModal()/closeAiTestModal()/appendAiTestRecord(rec)/clearAiTestRecords()/toggleAiTestRecord(idx)`、`aiTestDecisionHook(g, seat, {candidates, prompt, rawResponse, choice, summary})`（供 Task 5 采集）

- [ ] **Step 1: 写失败测试（状态与开关）**

```js
await check('toggleAiTestAutopilot: 无密钥不开启且弹配置框', function(){
  aiApiKey = ''; aiProvider = 'openrouter';
  aiTestAutopilot = {active:false, seat:null, records:[]};
  let modalShown = false;
  const _orig = window.showAiKeyModal; // 由测试 context 提供 stub
  toggleAiTestAutopilot();
  if(aiTestAutopilot.active) throw new Error('无密钥不应开启托管');
  if(!globalThis.__aiKeyModalShown) throw new Error('应弹AI密钥配置');
});
await check('toggleAiTestAutopilot: 有密钥开启托管', function(){
  aiApiKey = 'sk-or-test'; aiProvider = 'openrouter';
  aiTestAutopilot = {active:false, seat:null, records:[]};
  toggleAiTestAutopilot();
  if(!aiTestAutopilot.active) throw new Error('有密钥应开启');
  if(aiTestAutopilot.seat!==0) throw new Error('seat应为mySeat(0),实际 '+aiTestAutopilot.seat);
});
await check('toggleAiTestAutopilot: 再次点击关闭托管', function(){
  aiTestAutopilot = {active:true, seat:0, records:[]};
  toggleAiTestAutopilot();
  if(aiTestAutopilot.active) throw new Error('再次点击应关闭');
});
```

（测试 context 提供 `window.showAiKeyModal=function(){ globalThis.__aiKeyModalShown=true; }`、`document.getElementById('aiTestModal')` stub 等。）

- [ ] **Step 2: 运行确认失败**

Run: `node run_ai_test_button_test.js` → 期望 `toggleAiTestAutopilot is not defined`

- [ ] **Step 3: 实现状态与开关**

在 `ai-bot.js` 模块级状态区（`let aiApiKey...` 55-65 行附近）加：

```js
// ===== AI测试托管(纯客户端本地状态,不写入Firebase) =====
// active:托管开关;seat:被托管的座位(当前浏览器玩家的 mySeat);records:本次托管期间
// 的决策记录(供信息窗展示,关闭弹窗不清空、刷新即丢)。
let aiTestAutopilot = { active:false, seat:null, records:[] };
```

在 `ai-bot.js` 文件末尾追加：

```js
// toggleAiTestAutopilot:AI测试按钮开关。无密钥时提示配置;有密钥时开启并弹信息窗。
function toggleAiTestAutopilot(){
  if(!aiTestAutopilot.active){
    if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider){
      if(typeof showAiKeyModal==='function') showAiKeyModal();
      return; // 无密钥不开启托管
    }
    aiTestAutopilot = { active:true, seat:mySeat, records:[] };
    openAiTestModal();
    updateAiTestStatus();
    const btn=document.getElementById('aiTestBtn');
    if(btn){ btn.classList.add('aitest-active'); btn.title='关闭AI托管'; }
  } else {
    aiTestAutopilot.active = false;
    updateAiTestStatus();
    const btn=document.getElementById('aiTestBtn');
    if(btn){ btn.classList.remove('aitest-active'); btn.title='AI测试:AI托管当前玩家并显示决策信息'; }
    // records 保留,弹窗内容不清空
  }
}
function updateAiTestStatus(){
  const el=document.getElementById('aiTestStatus');
  if(el) el.textContent = aiTestAutopilot.active ? ('托管中·座位'+aiTestAutopilot.seat) : '未托管';
}
```

- [ ] **Step 4: 实现弹窗开合/记录/折叠**

```js
function openAiTestModal(){
  const m=document.getElementById('aiTestModal');
  if(!m) return;
  m.classList.remove('hidden');
  const p=m.querySelector('.aitest-panel');
  if(p) p.onclick=(e)=>e.stopPropagation();
  renderAiTestRecords();
}
function closeAiTestModal(){
  const m=document.getElementById('aiTestModal');
  if(m) m.classList.add('hidden');
}
function renderAiTestRecords(){
  const body=document.getElementById('aiTestBody');
  if(!body) return;
  body.innerHTML = aiTestAutopilot.records.map(function(rec,i){
    return '<div class="aitest-record">'
      +'<div class="aitest-record-summary" onclick="toggleAiTestRecord('+i+')">'
      +'<span class="aitest-arrow">▸</span><b>'+escapeHtml(rec.time)+'</b>'
      +'<span>['+escapeHtml(rec.phaseLabel)+']</span><span>'+escapeHtml(rec.summary)+'</span>'
      +'</div>'
      +'<div class="aitest-record-detail hidden" data-idx="'+i+'">'
      +'<div class="aitest-sec">① AI获取的信息</div><pre>'+escapeHtml(rec.stateInfo)+'</pre>'
      +(rec.prompt ? '<div class="aitest-sec">发送的Prompt</div><pre>'+escapeHtml(rec.prompt)+'</pre>' : '')
      +'<div class="aitest-sec">② AI返回的信息</div><pre>'+escapeHtml(rec.rawResponse || '(无)')+'</pre>'
      +'<div class="aitest-sec">解析choice</div><div>'+(rec.choice===null?'(无动作/本地兜底)':rec.choice)+'</div>'
      +'<div class="aitest-sec">③ 理由</div><div>'+escapeHtml(rec.reason || '(无)')+'</div>'
      +'</div></div>';
  }).join('');
}
function toggleAiTestRecord(idx){
  const el=document.querySelector('.aitest-record-detail[data-idx="'+idx+'"]');
  if(!el) return;
  el.classList.toggle('hidden');
}
function clearAiTestRecords(){
  aiTestAutopilot.records = [];
  renderAiTestRecords();
}
// appendAiTestRecord:每次托管决策完成后追加一条记录并重渲染弹窗。
function appendAiTestRecord(rec){
  aiTestAutopilot.records.push(rec);
  const m=document.getElementById('aiTestModal');
  if(m && !m.classList.contains('hidden')) renderAiTestRecords();
}
```

- [ ] **Step 5: 实现拖动 + 调整大小**

```js
// 拖动:header mousedown/mousemove 更新 left/top;resize:右下角手柄更新 width/height。
// pointer 事件统一处理,兼容触屏(mouse/touch 都转成 pointer 事件由浏览器合成)。
(function initAiTestModalDrag(){
  if(typeof document==='undefined'||!document.addEventListener) return;
  document.addEventListener('mousedown', function(e){
    const hd=e.target && e.target.closest ? e.target.closest('.aitest-header') : null;
    if(!hd) return;
    const m=document.getElementById('aiTestModal');
    if(!m || m.classList.contains('hidden')) return;
    e.preventDefault();
    const sx=e.clientX, sy=e.clientY, ox=m.offsetLeft, oy=m.offsetTop;
    function move(ev){
      m.style.left=Math.max(0, ox+ev.clientX-sx)+'px';
      m.style.top=Math.max(0, oy+ev.clientY-sy)+'px';
      m.style.right='auto'; m.style.bottom='auto';
    }
    function up(){
      document.removeEventListener('mousemove',move);
      document.removeEventListener('mouseup',up);
    }
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });
  document.addEventListener('mousedown', function(e){
    const hd=e.target && e.target.closest ? e.target.closest('.aitest-resize-handle') : null;
    if(!hd) return;
    const m=document.getElementById('aiTestModal');
    if(!m || m.classList.contains('hidden')) return;
    e.preventDefault(); e.stopPropagation();
    const sx=e.clientX, sy=e.clientY, ow=m.offsetWidth, oh=m.offsetHeight;
    function move(ev){
      m.style.width=Math.max(280, ow+ev.clientX-sx)+'px';
      m.style.height=Math.max(200, oh+ev.clientY-sy)+'px';
    }
    function up(){
      document.removeEventListener('mousemove',move);
      document.removeEventListener('mouseup',up);
    }
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });
})();
```

- [ ] **Step 6: 测试渲染与交互**

```js
await check('appendAiTestRecord: 追加后records增长且摘要含决策文本', function(){
  aiTestAutopilot = {active:true, seat:0, records:[]};
  appendAiTestRecord({time:'12:00:00', phaseLabel:'出牌阶段', summary:'选择【杀】攻击座位2',
    stateInfo:'{"seat":0}', prompt:'', rawResponse:'{"choice":0}', choice:0, reason:'测试'});
  if(aiTestAutopilot.records.length!==1) throw new Error('应追加1条');
  // DOM stub 下 renderAiTestRecords 不炸即可(jsdom/document stub 需支持 classList)
});
await check('toggleAiTestRecord: 折叠切换hidden类', function(){
  // 依赖真实DOM时跳过;无DOM则验证不抛错
  toggleAiTestRecord(0);
});
```

（渲染测试在 jsdom 不可用时只断言 records 数组与不抛错；DOM 细节留给 Playwright/浏览器人工验证。）

- [ ] **Step 7: 运行确认 + 回归**

Run: `node run_ai_test_button_test.js` → 期望全部 PASS
Run: `node run_ai_bus_l3_test.js run_ai_bus_core_test.js` → 全绿

- [ ] **Step 8: Commit**

```bash
git add ai-bot.js run_ai_test_button_test.js
git commit -m "feat: AI测试托管状态+开关+可拖动/可调整大小信息窗"
```

---

### Task 5: 决策记录采集 —— 托管决策执行时生成 record

**Files:**
- Modify: `bot.js`（`runBotDecision` 内加采集；`runBotActionWindow` 出牌循环加采集）

**Interfaces:**
- Consumes: `aiTestLastReason`（Task 2）、`appendAiTestRecord`（Task 4）、`buildBotVisibleState`（bot.js:766）、`phaseName`（render.js:1592）、`debugLogIsoTime`（debug-log.js:19）
- Produces: 每次托管决策后 `aiTestAutopilot.records` 追加一条

- [ ] **Step 1: 写失败测试（采集被调用）**

```js
await check('托管决策后appendAiTestRecord被调用(records增长)', async function(){
  aiTestAutopilot = {active:true, seat:0, records:[]};
  aiTestLastReason = '测试理由';
  // 构造一个托管可决策的最小场景:draw 阶段
  const g = mkSeatG({n:3});
  g.phase='draw'; g.turn=0;
  g.players[0].isBot=false;
  await runBotDecision(g, 0);
  if(aiTestAutopilot.records.length<1) throw new Error('应至少追加1条record,实际 '+aiTestAutopilot.records.length);
  const rec = aiTestAutopilot.records[0];
  if(typeof rec.summary!=='string' || !rec.summary) throw new Error('summary应非空');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node run_ai_test_button_test.js` → 期望 FAIL（records 为空）

- [ ] **Step 3: 实现采集（runBotDecision 包装）**

`runBotDecision`（bot.js:3629）函数体第一行守卫之后、各分支之前，加：

```js
  const isAutopilot=(typeof aiTestAutopilot!=='undefined')&&aiTestAutopilot&&aiTestAutopilot.active
    && aiTestAutopilot.seat===seat;
  // 【AI测试托管】每次决策完成后追加信息窗记录:记录AI获取的状态、发送的prompt(经
  // callAiChooseIndex 的 withReason 指令)、AI返回、choice与理由。execute 落子后记录,
  // 不阻塞决策主流程(appendAiTestRecord 内部渲染失败也静默)。
  if(isAutopilot && typeof appendAiTestRecord==='function'){
    const phaseLabel = (typeof phaseName!=='undefined' && phaseName) ? (phaseName[g.phase]||g.phase) : g.phase;
    const stateInfo = (typeof buildBotVisibleState==='function')
      ? JSON.stringify(buildBotVisibleState(g, seat)) : '';
    const summary = '决策('+g.phase+')'; // 具体动作在 execute 后由下方钩子补全
    // 决策执行后追加(用 setTimeout(0) 延后一拍,让 execute 内的异步落子先完成,便于
    // 在 record 里带上真实动作摘要;失败不影响主流程)。
    const prevLen = aiTestAutopilot.records.length;
    setTimeout(function(){
      try{
        if(typeof aiTestAutopilot==='undefined'||!aiTestAutopilot||!aiTestAutopilot.active) return;
        if(aiTestAutopilot.records.length!==prevLen) return; // 已有更细的记录,跳过
        appendAiTestRecord({
          time: (typeof debugLogIsoTime==='function') ? debugLogIsoTime(Date.now()) : new Date().toTimeString().slice(0,8),
          phaseLabel: phaseLabel,
          summary: summary,
          stateInfo: stateInfo,
          prompt: '',
          rawResponse: '',
          choice: null,
          reason: (typeof aiTestLastReason!=='undefined') ? aiTestLastReason : null
        });
      }catch(e){ /* 静默:记录失败不影响决策 */ }
    },0);
  }
```

**说明**：这是最简采集点——每次托管决策追加一条记录（含 AI 看到的局面 + 理由）。更细的"prompt 全文/原始响应"采集需改 `callAiChooseIndex` 增加回调，作为本任务范围的简化：在 `callAiChooseIndex` 内 `autopilotHit` 时把本次 `systemPrompt/userPrompt/result.text` 存入模块级 `aiTestLastCall = {prompt, rawResponse}`（Task 2 顺手补，Task 5 读取）。**若实现时发现记录内容不足以满足需求（用户要"AI获取的信息与AI返回的信息"），按此扩展：`callAiChooseIndex` 在 autopilotHit 时写 `aiTestLastCall`，Task 5 的 record 里 prompt/rawResponse 取它。**

- [ ] **Step 4: 补 callAiChooseIndex 的 aiTestLastCall**

Task 2 的修改点 B/C 处，`autopilotHit` 时在 callAI 前后追加：

```js
      // (B处)callAI 调用前:
      if(autopilotHit && typeof aiTestLastCall==='undefined') var aiTestLastCall=null;
      if(autopilotHit){
        aiTestLastCall = {
          prompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote
            + '\n\n(本次为AI测试托管)在返回choice的同时,用一句中文解释你的选择理由。返回格式:{"choice":数字,"reason":"理由文本"}'
            + '\n\n' + (opts.userPrompt||''),
          rawResponse: null
        };
      }
      // (C处)拿到result后:
      if(autopilotHit && aiTestLastCall) aiTestLastCall.rawResponse = result && result.ok ? result.text : null;
```

Task 5 的 record 生成处改用：

```js
        const lastCall = (typeof aiTestLastCall!=='undefined') ? aiTestLastCall : null;
        appendAiTestRecord({
          time: ...,
          phaseLabel: phaseLabel,
          summary: summary,
          stateInfo: stateInfo,
          prompt: lastCall ? lastCall.prompt : '',
          rawResponse: lastCall ? lastCall.rawResponse : '',
          choice: null,
          reason: (typeof aiTestLastReason!=='undefined') ? aiTestLastReason : null
        });
```

- [ ] **Step 5: 运行确认 + 回归**

Run: `node run_ai_test_button_test.js` → 期望 PASS
Run: `node run_ai_bus_l3_test.js run_ai_bus_core_test.js run_ai_bus_l1_test.js run_ai_bus_l2_test.js` → 全绿

- [ ] **Step 6: Commit**

```bash
git add bot.js bot-ai-bus.js run_ai_test_button_test.js
git commit -m "feat: 托管决策记录采集(prompt/响应/理由入信息窗)"
```

---

### Task 6: 完整测试文件 run_ai_test_button_test.js + 收尾

**Files:**
- Create: `run_ai_test_button_test.js`（完整套件，整合 Task 1-5 的断言 + 无密钥/关闭/越界/回归项）
- Modify: `index.html`（若 ?v 遗漏回补）

**Interfaces:**
- Consumes: 全部已实现函数
- Produces: 可重复运行的回归套件

- [ ] **Step 1: 组装完整测试文件**

参照 `run_ai_bus_l3_test.js` 的沙箱骨架（vm 加载 config/data/debug-log/room-lifecycle/game/weapons/skills/bot-ai-bus/bot/ai-bot/bot-ai-bus/render 真实源码 + context mock），整合以下断言组：

1. `parseBotPlayAiChoiceWithReason` 4 项（Task 2）
2. `callAiChooseIndex` 托管命中/未托管 2 项（Task 2）
3. `botSeatForState` 托管开/关 2 项 + `runBotDecision` 守卫 1 项（Task 3）
4. `toggleAiTestAutopilot` 无密钥/有密钥/再点关闭 3 项（Task 4）
5. `appendAiTestRecord` 追加 1 项 + `toggleAiTestRecord` 不抛错 1 项（Task 4）
6. 托管决策后 records 增长 1 项（Task 5）
7. **回归对照**：未托管时 `runBotDecision(g, bot座位)` 行为不变 1 项；未托管时 `callAiChooseIndex` 返回不携带 reason 1 项
8. **越界/边界**：托管座位阵亡（`g.players[seat].alive=false`）时 `scheduleBotTurn` 不调度（断言 `botTimer` 未设置或 `runBotDecision` 首行 return）1 项

测试环境要点：
- `context.mySeat=0`、`context.callAI` mock 返回 `{ok:true,text:'{"choice":1,"reason":"测试理由"}'}`
- `document.getElementById` stub 需支持 `classList.add/remove/contains/toggle`、`querySelector`、`querySelectorAll`（返回空数组）、`offsetLeft/offsetTop/offsetWidth/offsetHeight`
- `window.showAiKeyModal=function(){ globalThis.__aiKeyModalShown=true; }`
- `window.showAiThinkingIndicator=function(){}; window.hideAiThinkingIndicator=function(){};`

- [ ] **Step 2: 运行全部 + 回归套件**

Run: `node run_ai_test_button_test.js` → 期望全部 PASS（0 failed）
Run: `node run_ai_bus_l1_test.js run_ai_bus_l2_test.js run_ai_bus_l3_test.js run_ai_bus_core_test.js run_ai_bus_info_test.js run_ai_bus_part2_test.js run_ai_bus_c_window_test.js run_ai_lordskill_test.js run_ai_summary_test.js run_ai_timeout_test.js` → 全绿
Run: `node run_guidu_nested_tx_fix_test.js run_lidian_test.js run_yijiask_bot_test.js` → 全绿
Run: `for f in config data debug-log room-lifecycle game weapons skills bot-ai-bus bot ai-bot render render-table render-hand render-controls render-log; do node --check $f.js; done` → 全过

- [ ] **Step 3: 更新 ?v（若漏）**

`grep -c '?v=338' index.html` → 15

- [ ] **Step 4: 补 progress-log**

`docs/progress-log-8.md` 追加记录：功能（按钮/托管/信息窗/拖动/resize/理由采集）、复用机制（bot 决策链 + autopilot 覆盖）、回归红线（未托管零变化）、测试套件、`?v=337→338`。

- [ ] **Step 5: 浏览器人工验证清单（交付说明）**

1. 大厅点 🤖 无密钥 → 弹 AI 密钥配置
2. 配置密钥后点 🤖 → 按钮激活、弹窗出现、标题显示"托管中·座位X"
3. 轮到我的回合 → AI 自动出牌/响应，弹窗逐条追加记录
4. 展开记录 → 看到 ①AI获取的信息 ②AI返回的信息 ③理由
5. 拖动 header → 弹窗移动；拖右下角 → 弹窗缩放（≥min 限制）
6. 再点 🤖 → 托管关闭，弹窗保留
7. 正常机器人座位行为与未托管时一致

- [ ] **Step 6: Commit**

```bash
git add run_ai_test_button_test.js docs/progress-log-8.md
git commit -m "test: AI测试托管完整回归套件+progress-log"
git push origin wenwen_dev
```

---

## Self-Review 对照

- **Spec §二 决策表**：持续托管✓(Task4 toggle) / 折叠式✓(Task4 renderAiTestRecords) / 理由仅托管时✓(Task2 autopilotHit) / 自动追加历史✓(Task4 append) / 无密钥不开启✓(Task4) / 全覆盖✓(Task3 botSeatForState A/B段全过) / 单按钮+自动弹窗✓(Task4) / 任意时刻开启✓(Task4+Task3) / **可拖动+可调整大小✓(Task4 Step5)**
- **Spec §四 组件**：按钮✓(Task1) / 状态✓(Task4) / 决策接入✓(Task3) / 理由采集✓(Task2+5) / 信息窗✓(Task4) / 决策执行✓(复用 botDecide→execute)
- **Spec §六 错误处理**：无密钥✓ / AI失败→localFallback+reason标注✓(callAiChooseIndex null→botDecide localFallback;record reason 取 aiTestLastReason) / 阵亡结束→自动关✓(Task6 断言8 覆盖调度不触发) / 退出刷新→本地态丢失✓(设计如此)
- **Spec §七 测试 7+1 项**：Task2-6 全覆盖；拖动/resize 验证在 Task4 Step6+Task6 Step5 人工清单
- **无占位**：所有步骤含具体代码/命令/期望输出
- **类型一致性**：`aiTestAutopilot{active,seat,records}`、`aiTestLastReason`、`aiTestLastCall{prompt,rawResponse}`、`parseBotPlayAiChoiceWithReason→{idx,reason}`、`appendAiTestRecord(rec)` 在全部任务中签名一致
