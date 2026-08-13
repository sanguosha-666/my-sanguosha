# 大厅背景视频 + 游戏内 Canvas 飘牌与死亡特效 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大厅播放随机背景视频（进房暂停/回房恢复并换一个）；游戏中 Canvas 飘落装饰牌；角色死亡时触发血滴晕染（自己）或全屏血雾（其他角色）特效。

**Architecture:** 纯前端视觉层三块——(1) `game-bg.js` 新文件承载视频控制、飘牌 Canvas 循环、死亡特效绘制（vm 测试沙箱不加载）；(2) `room-lifecycle.js` 的 `enterGame()`/`backToLobby()` 两个挂载点做防御式调用切换；(3) `render.js` 用 alive 快照检测死亡并触发特效。所有跨文件调用必须 `typeof` 防御（vm 沙箱无 game-bg.js）。

**Tech Stack:** 原生 HTML/CSS/JS、Canvas 2D、requestAnimationFrame、传统 `<script>` 共享作用域。无构建流程。

## Global Constraints

- 项目根目录：`/home/upqybp/vibecoding/zhuoyou/sanguosha`（远程已迁移至 `sanguosha-666/my-sanguosha`）。
- 保持 vanilla JS 风格（var 声明、传统函数、无 ES module/import）。
- **工作区有未提交的用户改动**（data.js/game.js/index.html/render.js/render-controls.js/sha/skills/weapons/bot 相关 + 8 个新 run_* 测试）。不得丢弃、不得改动他人未提交内容；编辑 index.html/render.js 时基于当前工作区内容精确编辑。
- vm 测试沙箱的 `document` stub：`getElementById` 返回无 `pause/play/getContext` 方法的对象、无 `requestAnimationFrame`。所有 DOM 调用必须防御。
- `check_cache_bust.js`：改动的本地 JS 在 index.html 的 `?v=` 必须递增；新增 JS 必须带数字 `?v=`。工作区他人改动若触发该校验红，与本次无关，需与用户确认。
- 对话与代码注释使用简体中文。
- 每任务结束提交一次（`git commit` 不含未提交的用户文件；仅 add 本任务文件）。

---

### Task 0: 基线确认（前置诊断，无代码产出）

**Files:** 无
**Interfaces:** 无

- [ ] **Step 1: 记录工作区状态**

Run: `git status --porcelain`
Expected: 列出用户未提交改动（10 文件 M + 8 个新 run_* 测试 + assets/video/ 已提交）。确认 `assets/video/bg-{1,2,3}.mp4` 与 spec/plan 已在 HEAD。

- [ ] **Step 2: 全量测试基线**

Run: `node run_all_tests.js 2>&1 | tail -5`
Expected: `Test summary: N passed, 0 failed`。记录 N（含用户新增测试，预计 78~80）。若基线红：停下，报告失败项是否与用户未提交改动相关，与用户确认后再继续。

- [ ] **Step 3: cache-bust 基线**

Run: `node check_cache_bust.js`
Expected: `cache-bust check passed`。若报错（用户改动文件未 bump v），记录并继续——本计划 Task 2 的 bump 以"本任务触及的文件"为准。

- [ ] **Step 4: 提交基线说明**

```bash
git add docs/superpowers/plans/2026-08-13-lobby-bg-effects.md
git commit -m "docs: 大厅背景视频+飘牌+死亡特效实施计划"
```

---

### Task 1: 新建 game-bg.js（视频随机播放 + 飘牌 + 死亡特效）

**Files:**
- Create: `game-bg.js`

**Interfaces:**
- Produces（供 Task 2/3/4 调用，全部 `typeof` 防御调用）：
  - `function pickRandomBgVideo()` — 回大厅随机设视频 src 并播放
  - `function pauseBgVideo()` — 进房暂停视频
  - `function resumeBgVideo()` — 回大厅恢复（内部调 pickRandomBgVideo）
  - `function startGameBg()` — 进房启动飘牌 Canvas
  - `function stopGameBg()` — 回大厅停止并清空 Canvas
  - `function triggerDeathFx(kind)` — kind=`'self'`|`'other'`，启动死亡特效
- 依赖：`document`、`window`（rAF/resize/visibilitychange）、`BG_VIDEOS` 数组；不读任何游戏状态。

- [ ] **Step 1: 写文件**

创建 `game-bg.js`，完整内容：

```js
// 大厅背景视频 + 游戏内 Canvas 动态背景（飘牌 + 死亡特效）。
// 纯视觉层：不读游戏状态。死亡触发由 render.js 检测 alive 变化后调用 triggerDeathFx。
// 加载顺序：index.html 最后（render-log.js 之后），共享全局作用域。
// vm 测试沙箱不加载本文件；跨文件调用方一律 typeof 防御。

// ============ 大厅背景视频（随机播放） ============
var BG_VIDEOS = [
  'assets/video/bg-1.mp4',
  'assets/video/bg-2.mp4',
  'assets/video/bg-3.mp4'
];

// 回大厅时随机选一个视频并尝试播放（muted+playsinline 保证自动播放策略通过）
function pickRandomBgVideo(){
  var v = document.getElementById('bgVideo');
  if(!v) return;
  v.src = BG_VIDEOS[Math.floor(Math.random() * BG_VIDEOS.length)];
  if(typeof v.load === 'function') v.load();
  if(typeof v.play === 'function'){
    var p = v.play();
    if(p && typeof p.catch === 'function') p.catch(function(){});
  }
}

// 进房暂停大厅视频（避免后台耗流量/CPU）
function pauseBgVideo(){
  var v = document.getElementById('bgVideo');
  if(v && typeof v.pause === 'function') v.pause();
}

// 回大厅恢复：随机换一个继续播
function resumeBgVideo(){
  pickRandomBgVideo();
}

// ============ 游戏内飘牌 Canvas ============
var bgCanvas = null, bgCtx = null, bgRafId = 0, bgRunning = false, bgLastTs = 0;
var fallingCards = [];
var bgFx = null; // 当前死亡特效状态

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// 画一张装饰牌（圆角矩形 + 花色符号），不读游戏状态
function drawDecoCard(ctx, c){
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rot);
  ctx.globalAlpha = c.alpha;
  var w = c.size, h = c.size * 1.4;
  var red = (c.suit === '♥' || c.suit === '♦');
  if(c.back){
    // 牌背：深棕底 + 金/朱红描边
    ctx.fillStyle = '#241f1b';
    roundRectPath(ctx, -w/2, -h/2, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = red ? 'rgba(216,73,44,.8)' : 'rgba(176,141,79,.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(233,225,210,.22)';
    ctx.font = Math.round(w*0.5) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.suit, 0, 0);
  }else{
    // 牌面：浅底 + 花色符号
    ctx.fillStyle = 'rgba(233,225,210,.92)';
    roundRectPath(ctx, -w/2, -h/2, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,23,20,.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = red ? '#b1361e' : '#2c2722';
    ctx.font = Math.round(w*0.55) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.suit, 0, 0);
  }
  ctx.restore();
}

// 生成一张新的飘牌粒子
function newDecoCard(){
  var suits = ['♠','♥','♣','♦'];
  // 注意：sizeBgCanvas 已 setTransform(dpr)，画布坐标系为 CSS 像素；
  // spawn/移除判定必须用 clientWidth/clientHeight（CSS 像素），不能用物理像素 width/height。
  var w = bgCanvas ? (bgCanvas.clientWidth || bgCanvas.width) : 800;
  return {
    x: Math.random() * w,
    y: -60 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 12,
    vy: 12 + Math.random() * 18,
    vrot: (Math.random() - 0.5) * 1.0,
    rot: (Math.random() - 0.5) * 0.6,
    size: 26 + Math.random() * 18,
    alpha: 0.22 + Math.random() * 0.23,
    suit: suits[Math.floor(Math.random() * 4)],
    back: Math.random() < 0.6
  };
}

// 每帧：更新并绘制飘牌 + 死亡特效
function bgTick(ts){
  bgRafId = requestAnimationFrame(bgTick);
  if(!bgCtx || !bgCanvas) return;
  var dt = bgLastTs ? Math.min((ts - bgLastTs) / 1000, 0.1) : 0.016;
  bgLastTs = ts;
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  // 飘牌：期望约 1.5~4s 一张、同屏 12~18 张
  if(Math.random() < dt * 0.55 && fallingCards.length < 18){
    fallingCards.push(newDecoCard());
  }
  for(var i = fallingCards.length - 1; i >= 0; i--){
    var c = fallingCards[i];
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vrot * dt;
    if(c.y - c.size > (bgCanvas.clientHeight || bgCanvas.height)){
      fallingCards.splice(i, 1);
      continue;
    }
    drawDecoCard(bgCtx, c);
  }

  drawBgFx(ts, dt); // dt 同源传参,血滴运动不依赖固定帧步长
}

// 启动飘牌（进房时调用）
function startGameBg(){
  bgCanvas = document.getElementById('gameBgCanvas');
  if(!bgCanvas || typeof bgCanvas.getContext !== 'function') return;
  bgCtx = bgCanvas.getContext('2d');
  if(!bgCtx) return;
  sizeBgCanvas();
  bgRunning = true;
  bgLastTs = 0;
  if(bgRafId) cancelAnimationFrame(bgRafId);
  bgRafId = requestAnimationFrame(bgTick);
}

// 停止并清空（回大厅时调用）
function stopGameBg(){
  bgRunning = false;
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
  fallingCards = [];
  bgFx = null;
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
}

// 适配 DPR 与画布尺寸
function sizeBgCanvas(){
  if(!bgCanvas || !bgCtx) return;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  var cw = bgCanvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
  var ch = bgCanvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
  bgCanvas.width = Math.round(cw * dpr);
  bgCanvas.height = Math.round(ch * dpr);
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 页面隐藏暂停、恢复继续；窗口尺寸变化重适配
if(typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){
      if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
    }else if(bgRunning && !bgRafId){
      bgLastTs = 0;
      bgRafId = requestAnimationFrame(bgTick);
    }
  });
}
if(typeof window !== 'undefined'){
  window.addEventListener('resize', sizeBgCanvas);
}

// ============ 角色死亡特效 ============
// kind='self'：血滴滴落→落地晕染→渐隐恢复；kind='other'：全屏血雾弥漫→退去
// 时间基准：rAF 回调的 timestamp 与 performance.now() 同源；Date.now() 差页面加载时长
// （~1e12ms），与 drawBgFx 的 now 混用会导致 prog 恒负（特效不可见/不清理）。必须同源。
function bgNow(){
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}
function triggerDeathFx(kind){
  if(!bgCtx || !bgCanvas || !bgRunning) return;
  if(kind === 'self'){
    var n = 5 + Math.floor(Math.random() * 4); // 5~8 滴
    var drops = [];
    var cw = bgCanvas.clientWidth || bgCanvas.width;
    var ch = bgCanvas.clientHeight || bgCanvas.height;
    for(var i = 0; i < n; i++){
      drops.push({
        x: Math.random() * cw,      // CSS 像素坐标（setTransform(dpr) 后）
        y: -20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 40,
        vy: 60 + Math.random() * 90,
        r: 3 + Math.random() * 3,
        landY: ch * (0.55 + Math.random() * 0.4),
        landed: false, landAt: 0
      });
    }
    bgFx = { kind: 'self', t0: bgNow(), dur: 2800, drops: drops };
  }else if(kind === 'other'){
    bgFx = { kind: 'other', t0: bgNow(), dur: 1300 };
  }
}

// 绘制当前死亡特效（在飘牌之上）；now 为 rAF timestamp，dt 为当前帧真实步长（秒）
function drawBgFx(now, dt){
  if(!bgFx) return;
  var el = now - bgFx.t0;
  if(el > bgFx.dur){ bgFx = null; return; }
  var prog = el / bgFx.dur;
  if(bgFx.kind === 'self'){
    var drops = bgFx.drops;
    for(var i = 0; i < drops.length; i++){
      var d = drops[i];
      if(!d.landed){
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        if(d.y >= d.landY){ d.landed = true; d.landAt = el; }
      }else{
        var age = el - d.landAt;
        var radius = d.r * 6 * Math.min(age / 400, 1);
        var g = bgCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, radius);
        g.addColorStop(0, 'rgba(150,30,20,' + (0.55 * (1 - prog)) + ')');
        g.addColorStop(1, 'rgba(150,30,20,0)');
        bgCtx.fillStyle = g;
        bgCtx.beginPath();
        bgCtx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        bgCtx.fill();
      }
    }
    // 未落地的血滴画实心圆
    for(var j = 0; j < drops.length; j++){
      var d2 = drops[j];
      if(d2.landed) continue;
      bgCtx.fillStyle = 'rgba(150,30,20,' + Math.min(0.8, 0.3 + (d2.y / d2.landY) * 0.5) + ')';
      bgCtx.beginPath();
      bgCtx.arc(d2.x, d2.y, d2.r, 0, Math.PI * 2);
      bgCtx.fill();
    }
  }else{
    // 全屏血雾：0→0.35→0 alpha，从边缘向中心
    var fade = prog < 0.5 ? prog / 0.5 : (1 - prog) / 0.5;
    var a = Math.min(0.35 * fade, 0.35);
    var w = bgCanvas.width, h = bgCanvas.height;
    var grd = bgCtx.createRadialGradient(w/2, h/2, Math.min(w, h) * 0.25, w/2, h/2, Math.max(w, h) * 0.75);
    grd.addColorStop(0, 'rgba(140,28,18,0)');
    grd.addColorStop(1, 'rgba(140,28,18,' + a + ')');
    bgCtx.fillStyle = grd;
    bgCtx.fillRect(0, 0, w, h);
  }
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check game-bg.js`
Expected: 无输出、exit 0。

- [ ] **Step 3: 提交**

```bash
git add game-bg.js
git commit -m "feat: 大厅视频随机播放+游戏内飘牌与死亡特效 game-bg.js"
```

---

### Task 2: index.html（CSS + video/canvas 元素 + script 引用 + 版本号）

**Files:**
- Modify: `index.html`（CSS 区 `<style>` 内 + `<body>` 起始 + script 列表尾部）

**Interfaces:**
- Consumes: Task 1 的 `pickRandomBgVideo/pauseBgVideo/resumeBgVideo/startGameBg/stopGameBg`
- Produces: `#bgVideo`、`#bgVeil`、`#gameBgCanvas` 元素；`game-bg.js` 的 `?v=` 引用

- [ ] **Step 1: 在 `<style>` 内追加背景层 CSS**

在 `index.html` 的 `.hidden{display:none!important;}`（约 :2037）之前追加：

```css
/* ===== 背景视觉层（大厅视频 + 游戏内飘牌 Canvas） ===== */
.bg-video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;background:transparent;}
.bg-veil{position:fixed;inset:0;z-index:1;pointer-events:none;background:linear-gradient(180deg, rgba(26,23,20,.40) 0%, rgba(26,23,20,.62) 100%);}
.wrap{position:relative;z-index:2;}
#gameBgCanvas{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;}
```

- [ ] **Step 2: 在 `<body>` 最前插入视频与遮罩**

在 `<body>`（约 :2040）之后、`<!-- 说明浮层… -->` 之前插入：

```html
<!-- 大厅背景视频：装饰性纯视觉层，muted+playsinline 满足自动播放策略；
     src 由 game-bg.js 的 pickRandomBgVideo() 随机设置；透明/加载失败时 body 渐变兜底 -->
<video id="bgVideo" class="bg-video" autoplay muted loop playsinline aria-hidden="true" tabindex="-1"></video>
<div id="bgVeil" class="bg-veil" aria-hidden="true"></div>
```

- [ ] **Step 3: 在 `<div id="game" class="hidden">` 内第一个子元素前插入 Canvas**

在 `<!-- ============ GAME ============ -->` 注释块后、`<div id="oppTopRow"></div>` 之前插入：

```html
    <!-- 游戏内飘牌 Canvas：z-index:0 垫底，pointer-events:none 不拦截交互 -->
    <canvas id="gameBgCanvas" aria-hidden="true"></canvas>
```

- [ ] **Step 4: 追加 game-bg.js script 引用并 bump 版本号**

在 script 列表尾部（`render-log.js?v=395` 之后、`</body>` 之前）追加：

```html
<script src="game-bg.js?v=1"></script>
```

并将 `room-lifecycle.js?v=399` 改为 `?v=400`、`render.js?v=401` 改为 `?v=402`。

- [ ] **Step 5: 校验**

Run: `node check_cache_bust.js`
Expected: `cache-bust check passed`（若因用户未提交改动导致报错，确认报错文件不含本任务触及的三个文件，记录即可）。

Run: `node --check game-bg.js`（再次确认无回归）

- [ ] **Step 6: 提交**

```bash
git add index.html
git commit -m "feat: index.html 接入大厅视频背景与游戏内飘牌 Canvas"
```

---

### Task 3: room-lifecycle.js 挂载点（进房/回大厅切换）

**Files:**
- Modify: `room-lifecycle.js`（`enterGame()` 约 :64-68、`backToLobby()` 约 :565-570）

**Interfaces:**
- Consumes: Task 1 的 `pauseBgVideo/resumeBgVideo/startGameBg/stopGameBg`（`typeof` 防御）
- Produces: 无

- [ ] **Step 1: enterGame 挂载（进房）**

在 `enterGame()` 中 `document.getElementById('game').classList.remove('hidden');`（约 :68）之后追加：

```js
  if(typeof pauseBgVideo==='function') pauseBgVideo();          // 大厅视频暂停,避免后台耗流量
  if(typeof startGameBg==='function') startGameBg();            // 启动游戏内飘牌 Canvas
```

- [ ] **Step 2: backToLobby 挂载（回大厅）**

在 `backToLobby()` 中 `document.getElementById('lobby').classList.remove('hidden');`（约 :570）之后追加：

```js
  if(typeof stopGameBg==='function') stopGameBg();              // 停止并清空飘牌
  if(typeof resumeBgVideo==='function') resumeBgVideo();        // 恢复大厅视频(随机换一个)
```

- [ ] **Step 3: 回归验证（沙箱兼容）**

Run: `node run_ai_summary_room_lifecycle_test.js 2>&1 | tail -3`
Expected: 通过（沙箱中 `typeof pauseBgVideo==='function'` 为 false，自动跳过）。

Run: `node --check room-lifecycle.js`
Expected: exit 0。

- [ ] **Step 4: 提交**

```bash
git add room-lifecycle.js
git commit -m "feat: 进房/回大厅挂载背景视频与飘牌切换"
```

---

### Task 4: render.js 死亡检测 + 专项测试（TDD）

**Files:**
- Modify: `render.js`（模块级快照变量 + `checkDeaths` 函数 + `render()` 内调用）
- Test: Create `run_death_fx_detect_test.js`

**Interfaces:**
- Consumes: Task 1 的 `triggerDeathFx`（`typeof` 防御）；全局 `mySeat`
- Produces: `function checkDeaths(g)` — render() 每次快照对比，alive true→false 时触发 `triggerDeathFx(i===mySeat?'self':'other')`

- [ ] **Step 1: 写失败测试**

创建 `run_death_fx_detect_test.js`：

```js
const vm=require('vm');
const fs=require('fs');
const assert=require('assert');

const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document;
context.window.firebase=context.firebase;
context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','render.js'].forEach(file=>{
  vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
});
function R(code){return vm.runInContext(code,sandbox);}

let passed=0, failed=0;
function check(name,fn){
  try{ fn(); passed++; console.log('PASS '+name); }
  catch(e){ failed++; console.log('FAIL '+name+' -- '+e.message); }
}

const mkPlayers=()=>[{name:'a',alive:true},{name:'b',alive:true},{name:'c',alive:true}];

// 触发记录
sandbox.__fired=[];
R('mySeat=0;');
R('window.triggerDeathFx=function(kind){ global.__fired.push(kind); };');

check('首次调用(无基线)不触发', function(){
  sandbox.__fired=[];
  const g={started:true,players:mkPlayers()};
  sandbox.__g=g;
  R('checkDeaths(__g)'); // 预期 Step 2 时因 checkDeaths 未定义而 FAIL
  assert.strictEqual(sandbox.__fired.length,0,'首次不应触发');
});

console.log('death fx detect tests: '+passed+'/'+(passed+failed)+' passed');
process.exit(failed?1:0);
```

- [ ] **Step 2: 运行确认测试结构可用**

Run: `node run_death_fx_detect_test.js`
Expected: 失败（`checkDeaths` 未定义）。**若此步骤因代码问题报错，调整测试脚手架再继续。**

- [ ] **Step 3: 实现 checkDeaths**

在 `render.js` 模块级（如 `render()` 定义之前）加入：

```js
// 死亡特效触发基线：记录上一帧各座位 alive 状态。纯前端视觉,不读游戏逻辑。
var lastAliveSnapshot = null;
// 检测角色死亡(alive true→false),触发 game-bg.js 的血滴/血雾特效。
// 仅 g.started 时对比;大厅/未开局(机器人增删)重置基线,不误触发。
function checkDeaths(g){
  if(!g || !g.started || !Array.isArray(g.players)){
    lastAliveSnapshot = null;
    return;
  }
  const alive = g.players.map(p => p ? !!p.alive : false);
  const prev = lastAliveSnapshot;
  lastAliveSnapshot = alive;
  if(!prev || prev.length !== alive.length) return; // 首次/人数变化不触发
  for(let i=0;i<alive.length;i++){
    if(prev[i] === true && alive[i] === false){
      if(typeof triggerDeathFx==='function'){
        triggerDeathFx(i === mySeat ? 'self' : 'other');
      }
    }
  }
}
```

在 `render(g)` 函数内、`if(!g){...return;}` 处理之后（约 :1100 之后）加入：

```js
  checkDeaths(g);
```

- [ ] **Step 4: 补全并运行测试**

将 `run_death_fx_detect_test.js` 的 check 主体改为完整断言（替换 Step 1 中的占位 check）：

```js
const playersOf=(aliveArr)=>aliveArr.map((al,i)=>({name:'p'+i,alive:al}));

check('首次调用(无基线)不触发', function(){
  sandbox.__fired=[];
  const g={started:true,players:playersOf([true,true,true])};
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths(__g)');
  assert.strictEqual(sandbox.__fired.length,0,'首次不应触发');
});

check('alive true→false 且非本人触发 other', function(){
  sandbox.__fired=[];
  const g1={started:true,players:playersOf([true,true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,false,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.deepStrictEqual(sandbox.__fired,['other'],'座位1死亡应触发 other');
});

check('本人死亡触发 self', function(){
  sandbox.__fired=[];
  R('lastAliveSnapshot=null; __fired=[]; mySeat=0;');
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([false,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.deepStrictEqual(sandbox.__fired,['self'],'座位0死亡应触发 self');
});

check('无变化不重复触发', function(){
  sandbox.__fired=[];
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'无变化不应触发');
});

check('未开局(started=false)重置基线不触发', function(){
  sandbox.__fired=[];
  R('lastAliveSnapshot=null; __fired=[];');
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:false,players:playersOf([true,false])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:false,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'未开局应重置且不触发');
});

check('人数变化(机器人增删)不触发', function(){
  sandbox.__fired=[];
  const g1={started:true,players:playersOf([true,true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'人数变化不应触发');
});
```

Run: `node run_death_fx_detect_test.js`
Expected: `6/6 passed`、exit 0。

- [ ] **Step 5: 提交**

```bash
git add render.js run_death_fx_detect_test.js
git commit -m "feat: render.js 死亡检测触发血滴/血雾特效+专项测试"
```

---

### Task 5: 全量回归与验收

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `node run_all_tests.js 2>&1 | tail -5`
Expected: `Test summary: N passed, 0 failed`，N ≥ Task 0 基线 + 1（新增死亡检测测试）。

- [ ] **Step 2: cache-bust 校验**

Run: `node check_cache_bust.js`
Expected: `cache-bust check passed`。

- [ ] **Step 3: 手动浏览器验收清单**（需要用户/浏览器环境）

1. 打开 `index.html`（未进房）：大厅随机播放 bg-1/2/3 之一，静音循环全屏，标题/表单可读（遮罩生效），无按钮被遮挡。
2. 进入房间：视频暂停；游戏画面开始稀疏飘牌（12~18 张，深色装饰牌，不挡交互）。
3. 关闭/退出房间回大厅：飘牌停止清空；视频恢复且**随机更换**一个。
4. 角色死亡（可借机器人对局触发）：自己死亡见血滴滴落→晕染→约 2.8s 渐隐；他人死亡见全屏血雾 1.3s 退去；特效结束恢复飘牌，无残留。
5. 切后台标签页：飘牌暂停；切回继续。
6. 手机横屏/刘海安全区：视频与 Canvas 正常铺满。

- [ ] **Step 4: 提交（如有收尾改动）**

```bash
git status --porcelain   # 确认只剩用户未提交改动
```

---

## Self-Review 记录

- **Spec 覆盖**：大厅视频（Task 1/2/3）、随机播放（Task 1 `pickRandomBgVideo`）、遮罩（Task 2 CSS）、进房暂停/回房恢复（Task 3）、飘牌（Task 1/2）、死亡检测（Task 4）、血滴/血雾（Task 1 `triggerDeathFx`/`drawBgFx`）、visibilitychange/resize（Task 1）、版本号（Task 2 Step 4）、沙箱防御（各 Task）、验收（Task 5）。✓
- **占位扫描**：无 TBD/TODO；Task 4 Step 1 的占位 check 在 Step 4 被完整替换，已在步骤内闭环。✓
- **类型一致性**：`triggerDeathFx(kind)` 签名在 Task 1/4 一致；`checkDeaths(g)` 在 Task 4 定义与测试一致；`pauseBgVideo/resumeBgVideo/startGameBg/stopGameBg` 签名在 Task 1/3 一致。✓
