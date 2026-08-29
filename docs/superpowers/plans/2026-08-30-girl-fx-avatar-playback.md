# 三姐妹表情动画头像化播放 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让大乔/小乔/貂蝉的表情动画在桌面播在女孩头像上、手机从头像 FLIP 放大到自适应全屏播放后缩回、平板维持现状全屏。

**Architecture:** 独立新增 `#girlFxVideo` 视觉层（不复用全屏 `#movieFxVideo`，避免波及于吉/左慈/阵营等 legacy 全屏动画）。`render.js` 的 `movieVideoKeyForMe` 对三姐妹分派返回 `{path, seat}`（其余 kind 仍返回字符串键，向后兼容），`maybePlayMovieFx` 按 `seat` 是否存在决定调 `triggerGirlFx` 还是 `triggerMovieFx`。`game-bg.js` 新增按设备三分支的 `triggerGirlFx` 与可单测的纯函数（`girlFxDecide`/`girlFxTargetBox`/`girlFxAnchorRect`）。

**Tech Stack:** 原生 HTML/CSS/JS（无构建、无依赖）；测试用 node `vm` 沙箱（`testclass/run_*.js`），全量入口 `node run_all_tests.js`；cache-bust 由 `check_cache_bust.js` 强制（改动 JS 文件必须同步递增 index.html 里对应 `?v=`）。

**Spec:** `docs/superpowers/specs/2026-08-30-girl-fx-avatar-playback-design.md`

## Global Constraints

- 保留 vanilla HTML/JS 结构与代码风格；只改本任务范围，不重构无关游戏代码。
- `game-bg.js` 用 `var`/函数式风格（与本文件既有代码一致）；`render.js` 允许 const/let。
- 任何改动本地脚本的提交，必须同提交内把 `index.html` 中该脚本的 `?v=N` 递增（`game-bg.js` 当前 `?v=30`，`render.js` 当前 `?v=466`——以提交时工作树实际值为准 +1；同一文件被多个任务改动则每个任务各自 +1）。
- legacy 全屏动画（于吉/左慈/阵营/死亡/闪电）在**所有设备**逐字维持现状：走 `triggerMovieFx` + `#movieFxVideo`，本计划不触碰其选片/触发逻辑。
- 三姐妹"每视角分派不同视频"的选片规则（杀手/被杀/旁观 × 无后缀/后缀池、`girlKillDeath` 随机二选一）不变；本次只加**锚点座位**与**呈现层**。
- 锚点语义 = 方案 A：视频画面锚定到"视频内容所属女孩"在棋盘上的座位头像（`.seat[data-seat] .seat-art`）；各客户端仍播各自视角内容。
- 找不到座位 / 头像可见面积 <50% / 无 `#girlFxVideo` / 平板 → 回退现有全屏 `triggerMovieFx(path)`，绝不静默丢动画。
- 设备判定复用现成口径：手机 `isPhoneLayout()`（`game-bg.js`）；桌面 `(hover:hover) and (pointer:fine)`；其余平板。动画期间 `pointer-events:none` 维持，游戏不被动画阻塞。
- 提交只 `git add` 明确改动的文件，禁止 `git add .`；不 push。

---

### Task 1: game-bg.js 纯判定/几何函数 + 单测

**Files:**
- Modify: `game-bg.js`（新增 3 个纯函数 + 设备模式判定）
- Modify: `index.html:2886`（`game-bg.js?v=30` → `?v=31`）
- Test: `testclass/run_girl_fx_layer_test.js`（Create）

**Interfaces:**
- Produces:
  - `girlFxComputeMode() -> 'phone'|'desktop'|'fullscreen'`
  - `girlFxDecide(anchorSeat, selfSeat) -> 'phone'|'desktop-self'|'desktop-other'|'fullscreen'`
  - `girlFxTargetBox(mode, anchor, vw, vh, aspect) -> {left,top,width,height}|null`（anchor={left,top,width,height}，aspect=videoWidth/videoHeight，兜底 0.75）
  - `girlFxAnchorRect(seat) -> {left,top,width,height}|null`（依赖 `document.querySelector`/`getBoundingClientRect`，不可见或 <2px 或相交 <50% 返回 null）

- [ ] **Step 1: 写失败测试** — 创建 `testclass/run_girl_fx_layer_test.js`

```js
/**
 * 三姐妹表情动画头像化层：纯判定 + 几何函数单测（game-bg.js）。
 * 用 vm 沙箱加载 game-bg.js，注入可控 window.matchMedia / innerWidth/Height，
 * 直接调 girlFxComputeMode / girlFxDecide / girlFxTargetBox（几何是纯函数，无需真 DOM）。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
let passed=0, failed=0;
function check(name, fn){
  try{ fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e&&e.message)||e); failed++; }
}
function loadGameBg(mode){
  const context={
    Math,console,Number,String,Array,Object,Set,document:{getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},removeEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};},body:{}},
    setTimeout(){return 0;}, clearTimeout(){},
    requestAnimationFrame(){return 0;}, cancelAnimationFrame(){},
  };
  context.window={
    innerWidth: mode==='phone'?844:1400,
    innerHeight: mode==='phone'?390:900,
    devicePixelRatio:1, matchMedia:undefined, addEventListener(){}, removeEventListener(){},
  };
  if(mode==='phone') context.window.matchMedia=q=>({matches: q==='(max-width:640px)'?false:(q==='(max-height:460px) and (orientation:landscape)'?true:false)});
  else if(mode==='desktop') context.window.matchMedia=q=>({matches: /hover:\s*hover/.test(q)&&/pointer:\s*fine/.test(q)});
  else context.window.matchMedia=q=>({matches:false}); // tablet: 无手机断点、无 hover/fine
  context.window.document=context.document;
  context.global=context;
  const sb=vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'),sb,{filename:'game-bg.js'});
  return expr=>vm.runInContext(expr,sb);
}
const R_phone=loadGameBg('phone'), R_desktop=loadGameBg('desktop'), R_tablet=loadGameBg('tablet');

check('girlFxComputeMode: 手机横屏(844x390 落平板宽度但命中手机断点)判为 phone', ()=>{
  assert.strictEqual(R_phone('girlFxComputeMode()'), 'phone');
});
check('girlFxComputeMode: 桌面 hover+fine 判为 desktop', ()=>{
  assert.strictEqual(R_desktop('girlFxComputeMode()'), 'desktop');
});
check('girlFxComputeMode: 平板既非手机也非桌面 → fullscreen', ()=>{
  assert.strictEqual(R_tablet('girlFxComputeMode()'), 'fullscreen');
});
check('girlFxDecide: desktop 自己座位→desktop-self, 他人→desktop-other', ()=>{
  assert.strictEqual(R_desktop('girlFxDecide(2,2)'), 'desktop-self');
  assert.strictEqual(R_desktop('girlFxDecide(1,2)'), 'desktop-other');
});
check('girlFxDecide: phone 一律 phone(不分自我); tablet→fullscreen', ()=>{
  assert.strictEqual(R_phone('girlFxDecide(0,0)'), 'phone');
  assert.strictEqual(R_phone('girlFxDecide(1,0)'), 'phone');
  assert.strictEqual(R_tablet('girlFxDecide(0,0)'), 'fullscreen');
});
check('girlFxTargetBox: desktop-self 精确贴合头像矩形', ()=>{
  const a={left:100,top:50,width:220,height:293};
  assert.deepStrictEqual(R_desktop(`girlFxTargetBox('desktop-self', ${JSON.stringify(a)}, 1400,900, 0.75)`), a);
});
check('girlFxTargetBox: desktop-other 1.8x 放大且中心≈头像中心、不越视口', ()=>{
  const a={left:100,top:50,width:100,height:133};
  const b=R_desktop(`girlFxTargetBox('desktop-other', ${JSON.stringify(a)}, 1400,900, 0.75)`);
  assert.ok(Math.abs(b.width-180)<1, '宽应约1.8x=180, 实际'+b.width);
  assert.ok(Math.abs((b.left+b.width/2)-(a.left+a.width/2))<1, '水平居中于头像');
  assert.ok(b.left>=0 && b.left+b.width<=1400 && b.top>=0 && b.top+b.height<=900, '不越视口');
});
check('girlFxTargetBox: phone 按视频比例撑满可用边、居中', ()=>{
  // 手机横屏 844x390, 3:4 竖版视频 → 高为约束: h=390, w=292.5, 居中
  const b=R_phone('girlFxTargetBox("phone", {left:10,top:10,width:50,height:66}, 844,390, 0.75)');
  assert.ok(Math.abs(b.height-390)<1, '高应撑满390, 实际'+b.height);
  assert.ok(Math.abs(b.width-292.5)<1, '宽应=390*0.75, 实际'+b.width);
  assert.ok(Math.abs(b.left-(844-292.5)/2)<1, '水平居中');
  assert.ok(Math.abs(b.top-0)<1, '垂直居中(高撑满→top0)');
});
check('girlFxTargetBox: phone 比例已知变化(2:3)也生效', ()=>{
  const b=R_phone('girlFxTargetBox("phone", {left:0,top:0,width:50,height:66}, 844,390, 0.667)');
  assert.ok(Math.abs(b.height-390)<1);
  assert.ok(Math.abs(b.width-390*0.667)<1, '宽=高*aspect');
});
check('girlFxTargetBox: fullscreen/无锚点 返回 null', ()=>{
  assert.strictEqual(R_tablet('girlFxTargetBox("fullscreen", {left:0,top:0,width:10,height:10}, 800,600, 0.75)'), null);
  assert.strictEqual(R_phone('girlFxTargetBox("phone", null, 844,390, 0.75)'), null);
});

console.log('\ngirl_fx_layer: '+passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node testclass/run_girl_fx_layer_test.js`
Expected: FAIL（`girlFxComputeMode is not defined` 之类）

- [ ] **Step 3: 实现纯函数** — 在 `game-bg.js` 的 `triggerMovieFx` 定义之后（约 line 472 后）追加：

```js
// ============ 三姐妹表情动画:头像化播放层(纯判定/几何) ============
// 触发由 render.js maybePlayMovieFx 在算好"要播的具体视频路径 + 锚点女孩座位"后调用
// triggerGirlFx({path, seat, selfSeat})。设备三分支(口径复用既有断点,见 isPhoneLayout 注释):
//   手机  → 头像矩形 FLIP 放大到"按视频真实比例的最大居中盒"(自适应全屏), 播完缩回原位;
//   桌面  → 锚定女孩座位头像: 自己座位=原尺寸贴合(头像活起来), 他人座位=1.8x 放大悬浮;
//   平板/回退 → 转调 triggerMovieFx 走既有全屏 #movieFxVideo, 零改动。
// 座位不可见(找不到/可见面积<50%/<2px)一律回退全屏, 不静默丢动画。
function girlFxComputeMode(){
  if(typeof window==='undefined') return 'fullscreen';
  if(typeof isPhoneLayout==='function' && isPhoneLayout()) return 'phone';
  if(typeof window.matchMedia==='function' &&
     window.matchMedia('(hover:hover) and (pointer:fine)').matches) return 'desktop';
  return 'fullscreen'; // 平板, 或无 matchMedia 的旧环境: 安全回退现状全屏
}
function girlFxDecide(anchorSeat, selfSeat){
  const mode=girlFxComputeMode();
  if(mode!=='desktop') return mode==='phone' ? 'phone' : 'fullscreen';
  return anchorSeat===selfSeat ? 'desktop-self' : 'desktop-other';
}
// anchor: 头像 getBoundingClientRect(视口坐标); vw/vh: 视口; aspect: videoWidth/videoHeight(兜底 3:4=0.75)
function girlFxTargetBox(mode, anchor, vw, vh, aspect){
  if(mode==='fullscreen' || !anchor) return null;
  const a = (typeof aspect==='number' && aspect>0) ? aspect : 0.75;
  if(mode==='desktop-self') return {left:anchor.left, top:anchor.top, width:anchor.width, height:anchor.height};
  if(mode==='desktop-other'){
    let w=anchor.width*1.8, h=anchor.height*1.8;
    if(w>vw){ h*=vw/w; w=vw; }
    if(h>vh){ w*=vh/h; h=vh; }
    const cx=anchor.left+anchor.width/2, cy=anchor.top+anchor.height/2;
    return {left:Math.max(0,Math.min(cx-w/2, vw-w)), top:Math.max(0,Math.min(cy-h/2, vh-h)), width:w, height:h};
  }
  // phone: 保持视频比例的最大居中盒(横屏下通常高撑满、左右黑边)
  let h=vh, w=h*a;
  if(w>vw){ w=vw; h=w/a; }
  return {left:(vw-w)/2, top:(vh-h)/2, width:w, height:h};
}
// 解析锚点头像矩形 + 可见性阈值; 不可见返回 null(调用方回退全屏)
function girlFxAnchorRect(seat){
  if(typeof document==='undefined') return null;
  var art=document.querySelector('.seat[data-seat="'+seat+'"] .seat-art');
  if(!art || typeof art.getBoundingClientRect!=='function') return null;
  var r=art.getBoundingClientRect();
  if(!r || r.width<2 || r.height<2) return null;
  var vw=(typeof window!=='undefined'&&window.innerWidth)||0;
  var vh=(typeof window!=='undefined'&&window.innerHeight)||0;
  var ix=Math.max(0, Math.min(r.right,vw)-Math.max(r.left,0));
  var iy=Math.max(0, Math.min(r.bottom,vh)-Math.max(r.top,0));
  if(vw&&vh && ix*iy < r.width*r.height*0.5) return null; // 可见面积<50%
  return {left:r.left, top:r.top, width:r.width, height:r.height};
}
```

- [ ] **Step 4: 递增 cache-bust** — `index.html:2886` `game-bg.js?v=30` → `?v=31`

- [ ] **Step 5: 跑测试确认通过**

Run: `node testclass/run_girl_fx_layer_test.js`
Expected: 全部 PASS

- [ ] **Step 6: cache-bust 检查 + 提交**

```bash
node check_cache_bust.js
git add game-bg.js index.html testclass/run_girl_fx_layer_test.js
git commit -m "feat(girlfx): 三姐妹头像化播放层纯判定/几何函数 + 单测"
```

---

### Task 2: triggerGirlFx DOM 装配 + 元素/CSS

**Files:**
- Modify: `game-bg.js`（`triggerGirlFx` + `girlFxPlace`/`girlFxEnd`/`bindGirlFx`/`girlFxReflow`；`stopGameBg` 清理列表 + `girlFxVideo`）
- Modify: `index.html`（新增 `#girlFxVideo`、`.girl-fx-video` 及两个状态类；`game-bg.js?v=31`→`32`）
- Test: `testclass/run_girl_fx_layer_test.js`（追加回退/装配断言）

**Interfaces:**
- Consumes: Task 1 的 `girlFxDecide` / `girlFxTargetBox` / `girlFxAnchorRect` / `triggerMovieFx` / `applyFxAudio` / `hideFxVideo`
- Produces: `triggerGirlFx({path, seat, selfSeat}) -> void`（无锚点/平板/缺元素时内部转调 `triggerMovieFx(path)`）

- [ ] **Step 1: 追加失败测试**（在 `run_girl_fx_layer_test.js` 的汇总行之前插入）

```js
check('triggerGirlFx: 平板 → 转调 triggerMovieFx, #girlFxVideo 不动', ()=>{
  let movieCalls=[], girlShown=false;
  const run=R_tablet;
  run(`window.triggerMovieFx=function(k){ global.__m=(global.__m||[]).concat(k); };`);
  run(`triggerMovieFx=window.triggerMovieFx;`);
  run(`__girlVideoShown=false;`);
  run(`document.getElementById=function(id){ return id==='girlFxVideo' ? {style:{},classList:{add(){},remove(){}}, load(){},play(){return{catch(){}}},pause(){},removeAttribute(){}} : null; };`);
  run(`triggerGirlFx({path:'assets/video/daqiao-xiuse.mp4', seat:0, selfSeat:1});`);
  assert.ok(run(`(global.__m||[]).indexOf('assets/video/daqiao-xiuse.mp4')>=0`), '应回退到 triggerMovieFx');
});
check('triggerGirlFx: 桌面但座位不可见(girlFxAnchorRect 返回 null)→ 回退全屏', ()=>{
  const run=R_desktop;
  run(`window.triggerMovieFx=function(k){ global.__m=(global.__m||[]).concat(k); }; triggerMovieFx=window.triggerMovieFx;`);
  run(`girlFxAnchorRect=function(){ return null; };`);
  run(`document.getElementById=function(){ return {style:{},classList:{add(){},remove(){}}, load(){},play(){return{catch(){}}},pause(){},removeAttribute(){},addEventListener(){}}; };`);
  run(`triggerGirlFx({path:'assets/video/xiaoqiao-mamu.mp4', seat:3, selfSeat:0});`);
  assert.ok(run(`(global.__m||[]).indexOf('assets/video/xiaoqiao-mamu.mp4')>=0`));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node testclass/run_girl_fx_layer_test.js`
Expected: FAIL（`triggerGirlFx is not defined`）

- [ ] **Step 3: 新增 index.html 元素与样式**

在 `index.html:2801`（`#movieFxVideo`）之后新增一行：

```html
    <video id="girlFxVideo" class="girl-fx-video" muted playsinline preload="auto" aria-hidden="true" tabindex="-1"></video>
```

在 CSS `.fx-video{...}`（line 2691）之后新增：

```css
  /* 三姐妹表情头像化层:默认隐藏;FLIP 靠改 left/top/width/height 触发 transition。
     cover 裁切贴合头像观感,圆角与 .seat-art 一致(见 death-shatter-fx .seat-art)。 */
  .girl-fx-video{position:fixed;inset:auto;width:0;height:0;visibility:hidden;
    object-fit:cover;background:#15120f;border-radius:10px;z-index:1501;pointer-events:none;
    transition:left .45s ease,top .45s ease,width .45s ease,height .45s ease,box-shadow .3s ease,object-fit .01s;}
  .girl-fx-video.girl-fx-full{object-fit:contain;background:#000;border-radius:0;} /* 手机自适应全屏:保比例含黑边 */
  .girl-fx-video.girl-fx-float{box-shadow:0 8px 40px rgba(0,0,0,.6);} /* 桌面他人悬浮抬升 */
```

- [ ] **Step 4: 实现 triggerGirlFx 及辅助** — 在 Task 1 追加的纯函数之后：

```js
function girlFxPlace(v, box){
  v.style.left=box.left+'px'; v.style.top=box.top+'px';
  v.style.width=box.width+'px'; v.style.height=box.height+'px';
}
function triggerGirlFx(opts){
  if(typeof document==='undefined' || !opts || !opts.path) return;
  var v=document.getElementById('girlFxVideo');
  var mode=girlFxDecide(opts.seat, opts.selfSeat);
  var anchor=(mode==='fullscreen') ? null : girlFxAnchorRect(opts.seat);
  if(mode==='fullscreen' || !anchor || !v || typeof v.style==='undefined'){
    triggerMovieFx(opts.path); return; // 平板/座位不可见/缺元素 → 现状全屏
  }
  applyFxAudio(v);
  v.classList.remove('girl-fx-full');
  v.classList.remove('girl-fx-float');
  girlFxPlace(v, anchor);              // 起点=头像矩形
  v.style.visibility='visible';
  v.src=opts.path;
  if(typeof v.load==='function') v.load();
  v._girlAnchor=anchor; v._girlMode=mode;
  var vw=(typeof window!=='undefined'&&window.innerWidth)||document.documentElement.clientWidth;
  var vh=(typeof window!=='undefined'&&window.innerHeight)||document.documentElement.clientHeight;
  // 下一帧再设目标盒, 让起始 rect 先提交, transition 才会播放(FLIP 关键两帧)
  function goTarget(){
    var aspect=(v.videoWidth&&v.videoHeight)?(v.videoWidth/v.videoHeight):0.75;
    var box=girlFxTargetBox(mode, anchor, vw, vh, aspect);
    if(mode==='phone') v.classList.add('girl-fx-full');
    if(mode==='desktop-other') v.classList.add('girl-fx-float');
    girlFxPlace(v, box);
  }
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(function(){ requestAnimationFrame(goTarget); });
  else goTarget();
  bindGirlFx(v);
  var p=v.play();
  if(p&&typeof p.catch==='function') p.catch(function(){ girlFxEnd(v, true); }); // 起播失败静默降级隐藏(同现有 fx 惯例)
}
function bindGirlFx(v){
  if(v.__girlBound) return;
  v.__girlBound=true;
  v.addEventListener('ended', function(){ girlFxEnd(v, false); });
  v.addEventListener('error', function(){ girlFxEnd(v, true); });
}
function girlFxEnd(v, silent){
  if(typeof v.pause==='function') v.pause();
  v.classList.remove('girl-fx-full');
  v.classList.remove('girl-fx-float');
  if(silent){ hideFxVideo(v); return; }
  var a=v._girlAnchor;
  if(a) girlFxPlace(v, a); // 缩回头像原位(desktop-self 本就在位, 等价淡出前置)
  setTimeout(function(){ hideFxVideo(v); }, 480); // 略大于 450ms transition, 等缩回动画走完再释放
}
// 播放中尺寸/方向变化: 重算目标盒(desktop-self 贴新头像位; phone/other 重居中)
function girlFxReflow(){
  if(typeof document==='undefined') return;
  var v=document.getElementById('girlFxVideo');
  if(!v || v.style.visibility!=='visible' || !v._girlMode) return;
  var a=girlFxAnchorRect(0); // 占位, 下面按座位重取
  var anchor=v._girlAnchor;
  if(!anchor) return;
  var vw=(typeof window!=='undefined'&&window.innerWidth)||0;
  var vh=(typeof window!=='undefined'&&window.innerHeight)||0;
  var aspect=(v.videoWidth&&v.videoHeight)?(v.videoWidth/v.videoHeight):0.75;
  girlFxPlace(v, girlFxTargetBox(v._girlMode, anchor, vw, vh, aspect));
}
if(typeof window!=='undefined'){
  window.addEventListener('resize', girlFxReflow);
  window.addEventListener('orientationchange', girlFxReflow);
}
```

> `girlFxReflow` 里 `girlFxAnchorRect(0)` 是无用占位（重排用缓存 anchor 即可，座位在放大期间不动）；实现时删掉该行，直接用 `v._girlAnchor`。保留此注释以防误读。

- [ ] **Step 5: stopGameBg 兜底清理** — 修改 `game-bg.js:310` 的数组，把 `girlFxVideo` 加入：

```js
    ['deathFxVideo','lightningFxVideo','movieFxVideo','girlFxVideo'].forEach(function(id){
```

- [ ] **Step 6: cache-bust** — `index.html:2886` `game-bg.js?v=31` → `?v=32`

- [ ] **Step 7: 跑测试确认通过**

Run: `node testclass/run_girl_fx_layer_test.js` && `node check_cache_bust.js`
Expected: 全 PASS；cache-bust passed

- [ ] **Step 8: 提交**

```bash
git add game-bg.js index.html testclass/run_girl_fx_layer_test.js
git commit -m "feat(girlfx): triggerGirlFx 头像化装配 + #girlFxVideo 元素/CSS"
```

---

### Task 3: render.js 锚点座位分派 + 既有测试更新

**Files:**
- Modify: `render.js:743-831`（`movieVideoKeyForMe` 三姐妹分支返回 `{path, seat}`；其余分支不变）
- Modify: `render.js:832-870`（`maybePlayMovieFx` 按对象/字符串分派）
- Modify: `index.html:2880`（`render.js?v=466` → 递增；若 Task 前已变则以实际值 +1）
- Test: `testclass/run_movie_fx_detect_test.js:457-511`（三姐妹断言改对象形态 + 锚点座位）

**Interfaces:**
- Consumes: `triggerGirlFx`（Task 2）、`GIRL_EMO_GENERALS`/`girlMainPath`/`girlSfxPath`（既有）
- Produces: `movieVideoKeyForMe` 三姐妹 kind 返回 `{path:string, seat:number}`，其余返回 `string` 或 `null`（不变）

- [ ] **Step 1: 改既有测试为失败态** — `run_movie_fx_detect_test.js` 三姐妹段。先扩展沙箱 stub 捕获 `triggerGirlFx`：把 line 379-381 改为

```js
fsandbox.__mvFired=[];
FR('window.triggerMovieFx=function(key){ global.__mvFired.push(key); };');
FR('triggerMovieFx=window.triggerMovieFx;');
FR('window.triggerGirlFx=function(o){ global.__mvFired.push(o); };');
FR('triggerGirlFx=window.triggerGirlFx;');
```

再把三姐妹断言改为对象形态（示例，逐条照改 line 459-511）：

```js
check('girlKill：杀手/被杀/他人各播自己视角, 全部锚定杀手女孩座位', function(){
  const players=[{alive:true},{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},0,players)), S([{path:'assets/video/daqiao-xiuse.mp4',seat:0}]), '杀手本人');
  assert.strictEqual(S(fire({seq:2,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},1,players)), S([{path:'assets/video/daqiao-wumei.mp4',seat:0}]), '被杀者(锚点仍是杀手女孩座位)');
  const other=fire({seq:3,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},2,players);
  const pool=['assets/video/daqiao-xiuse01.mp4','assets/video/daqiao-xiuse02.mp4','assets/video/daqiao-xiuse03.mp4'].map(p=>({path:p,seat:0}));
  assert.ok(JSON.stringify(pool).indexOf(JSON.stringify(other[0]))>=0, '他人应播后缀且锚点=女孩座位0, 实际 '+S(other));
});
check('girlDeath：各视角锚定死者女孩座位(evt.seat)', function(){
  const players=[{alive:true},{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'girlDeath',seat:0,result:{gen:'xiaoqiao',killerSeat:1}},0,players)), S([{path:'assets/video/xiaoqiao-mamu.mp4',seat:0}]));
  assert.strictEqual(S(fire({seq:2,kind:'girlDeath',seat:0,result:{gen:'xiaoqiao',killerSeat:1}},1,players)), S([{path:'assets/video/xiaoqiao-weiju.mp4',seat:0}]));
});
```

`girlKillDeath` 断言改为：记录 `{path,seat}`，校验 seat 与 path 所属女孩一致——例如看到 `daqiao-*` 则 seat 必为 `killerSeat(1)`，看到 `diaochan-*` 则 seat 必为 `victimSeat(0)`：

```js
  for(let i=0;i<40;i++){ const o=fire({seq:10+i,kind:'girlKillDeath',seat:0,result:{killerGen:'daqiao',victimGen:'diaochan',killerSeat:1,victimSeat:0}},1,players)[0]; if(o){ killerSeen.add(o.path+'@'+o.seat); if(o.path.indexOf('daqiao')>=0) assert.strictEqual(o.seat,1,'daqiao视频应锚杀手座位1'); if(o.path.indexOf('diaochan')>=0) assert.strictEqual(o.seat,0,'diaochan视频应锚被杀座位0'); } }
  assert.ok(killerSeen.has('assets/video/daqiao-xiuse.mp4@1'));
  assert.ok(killerSeen.has('assets/video/diaochan-weiju.mp4@0'));
```

`gameOver` 三姐妹断言改对象形态，本人 seat=`mySeat`：

```js
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:win},0,[{alive:true,role:'fan',general:'diaochan'}])), S([{path:'assets/video/diaochan-kaixin.mp4',seat:0}]), '女孩胜利锚自己座位');
```

旁观者后缀断言锚点取 `girlWin.seat`/`girlLose.seat`（`{path:..., seat:0}`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node testclass/run_movie_fx_detect_test.js`
Expected: FAIL（当前实现返回字符串路径，断言期望对象）

- [ ] **Step 3: 改 movieVideoKeyForMe 三姐妹分支** — `render.js`：

`girlKill`（756-762）与 `girlDeath`（763-769）：三处 `return girlMainPath(...)`/`return girlSfxPath(...)` 包成 `{path:<原值>, seat:evt.seat}`（girlKill/girlDeath 的锚点恒为事件里的 `evt.seat`=女孩本人座位；`seat` 为 null 时保留原逻辑返回但 `seat:null`，`maybePlayMovieFx` 会走字符串/回退）。girl 无后缀主路径一定存在，直接：

```js
    case 'girlKill': {
      const r=evt.result||{}; if(!girlOf(r.gen)) return null; const seat=evt.seat;
      if(mySeat===evt.seat) return {path:girlMainPath(r.gen,'xiuse'), seat};
      if(typeof r.victimSeat==='number'&&mySeat===r.victimSeat) return {path:girlMainPath(r.gen,'wumei'), seat};
      const sp=girlSfxPath(r.gen,['xiuse','wumei']); return sp?{path:sp,seat}:null;
    }
    case 'girlDeath': {
      const r=evt.result||{}; if(!girlOf(r.gen)) return null; const seat=evt.seat;
      if(mySeat===evt.seat) return {path:girlMainPath(r.gen,'mamu'), seat};
      if(typeof r.killerSeat==='number'&&mySeat===r.killerSeat) return {path:girlMainPath(r.gen,'weiju'), seat};
      const sp=girlSfxPath(r.gen,['mamu','weiju']); return sp?{path:sp,seat}:null;
    }
```

`girlKillDeath`（770-792）重写为"先随机选 path 再按 path 所属女孩定 seat"（同一随机选择里配对，杜绝 path/seat 错位）：

```js
    case 'girlKillDeath': {
      const r=evt.result||{};
      if(!girlOf(r.killerGen)||!girlOf(r.victimGen)) return null;
      function pick2(aPath,bPath,aSeat,bSeat){
        const arr=[]; if(aPath)arr.push({path:aPath,seat:aSeat}); if(bPath)arr.push({path:bPath,seat:bSeat});
        return arr.length?arr[Math.floor(Math.random()*arr.length)]:null;
      }
      if(typeof r.killerSeat==='number'&&mySeat===r.killerSeat)
        return pick2(girlMainPath(r.killerGen,'xiuse'), girlMainPath(r.victimGen,'weiju'), r.killerSeat, r.victimSeat);
      if(typeof r.victimSeat==='number'&&mySeat===r.victimSeat)
        return pick2(girlMainPath(r.killerGen,'wumei'), girlMainPath(r.victimGen,'mamu'), r.killerSeat, r.victimSeat);
      return pick2(girlSfxPath(r.killerGen,['xiuse','wumei']), girlSfxPath(r.victimGen,['mamu','weiju']), r.killerSeat, r.victimSeat);
    }
```

`gameOver`（793-828）：女孩本人各分支返回 `{path:girlMainPath(me.general,'kaixin'|'beitong'), seat:mySeat}`；旁观者后缀 `sfx` 返回 `{path:sfx, seat:(r.girlWin?r.girlWin.seat:r.girlLose.seat)}`；其余（`zuociLose`/`fanWin`/阵营/`null`）保持返回字符串键不变。

- [ ] **Step 4: 改 maybePlayMovieFx 分派** — `render.js:845-869`。两处 `const key=movieVideoKeyForMe(...); if(key && typeof triggerMovieFx==='function') triggerMovieFx(key);` 改为按类型分派：

```js
  function dispatchMovie(out){
    if(!out) return;
    if(typeof out==='string'){ if(typeof triggerMovieFx==='function') triggerMovieFx(out); return; }
    // 三姐妹 {path, seat}
    if(out.path && Number.isInteger(out.seat) && typeof triggerGirlFx==='function'){
      triggerGirlFx({path:out.path, seat:out.seat, selfSeat:mySeat});
    } else if(out.path && typeof triggerMovieFx==='function'){
      triggerMovieFx(out.path); // 无有效座位/无头像层 → 回退全屏
    }
  }
```

队列 while 内改为 `dispatchMovie(movieVideoKeyForMe(g, evt));`；单槽兼容分支内 `const key=movieVideoKeyForMe(g, single); ...` 同样改为 `dispatchMovie(movieVideoKeyForMe(g, single));`（保留原 seq 去重判断不动）。

- [ ] **Step 5: cache-bust** — `index.html` `render.js?v=466` → 递增。

- [ ] **Step 6: 跑测试确认通过**

Run: `node testclass/run_movie_fx_detect_test.js` && `node testclass/run_girl_fx_layer_test.js` && `node check_cache_bust.js`
Expected: 全 PASS

- [ ] **Step 7: 提交**

```bash
git add render.js index.html testclass/run_movie_fx_detect_test.js
git commit -m "feat(girlfx): render 层三姐妹按视角返回{path,seat}, 分派 triggerGirlFx"
```

---

### Task 4: 全量回归 + 手工三设备核验

**Files:**
- Modify: `TASKS.md`（记录关键成果）

- [ ] **Step 1: 全量测试**

Run: `node run_all_tests.js`
Expected: `Test summary: N passed, 0 failed`

- [ ] **Step 2: 手工核验清单**（本地 `python3 -m http.server` 打开 index.html，DevTools 切设备）
  - 桌面（hover+fine、宽屏）：触发 girlKill（大乔杀人）→ 视频贴在大乔头像框，本人原尺寸、他人 1.8x 悬浮、播完缩回；他人头像与自己的都验证。
  - 手机（844×390 横屏）：从头像 FLIP 放大到含黑边居中、播完缩回原位；把女孩座位滚出视口再触发 → 回退全屏。
  - 平板（1024×768，无 hover/fine、不命中手机断点）：维持全屏，行为与改动前一致。
  - 于吉/左慈/阵营/死亡/闪电全屏动画在各设备均不变。

- [ ] **Step 3: 更新 TASKS.md 并提交**

```bash
git add TASKS.md
git commit -m "docs: 三姐妹头像化播放实现完成"
```

## Self-Review 结论

- Spec 覆盖：目标/设备三分支/锚点方案 A/退场/回退/测试 → Task 1-4 全覆盖。
- 占位符：`girlFxReflow` 里一处占位行已在正文注释标明"实现时删掉"，无遗留 TBD。
- 类型一致：`{path, seat}` 在 render.js（Task 3 产出）与 `triggerGirlFx(opts.path/opts.seat/opts.selfSeat)`（Task 2 消费）签名一致；legacy 字符串路径两侧都保持。
