# 死亡特效改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除他人死亡特效；自己死亡时在网页背景全屏播放随机一段 `death-*.mp4` 动画，播完自动恢复原背景。

**Architecture:** 视觉层 `game-bg.js` 独占特效职责。新增独立 `<video id="deathFxVideo">` 元素（与大厅视频同层 z-index:0、DOM 顺序在飘牌 canvas 之后），`triggerDeathFx('self')` 随机选 `DEATH_VIDEOS` 中一个播放一遍，`ended`/`error` 时隐藏恢复；`triggerDeathFx('other')` 直接返回。`render.js checkDeaths` 分类调用保持不变。

**Tech Stack:** 原生 HTML/JS（无框架），vm 沙箱测试（testclass/），cache-bust 手动版本号。

## Global Constraints

- 保持原生 HTML/JavaScript 结构与既有编码风格；不重构无关代码。
- 死亡动画文件约定：`assets/video/death-N.mp4`，新增文件需同步加入 `DEATH_VIDEOS` 数组（注释写明）。
- 任何 JS 引用改动后递增 index.html 中对应 `?v=N` 版本号；提交前必须过 `node check_cache_bust.js`。
- 代码注释、commit message 用简体中文。
- 项目根目录为工作目录；git 分支 main，先 pull 最新。

---

### Task 1: index.html 新增死亡动画视频元素 + cache-bust 递增

**Files:**
- Modify: `index.html`（在 `#gameBgCanvas` 之后加元素；`game-bg.js?v=2` → `?v=3`）

**Interfaces:**
- Produces: DOM 元素 `#deathFxVideo`（`class="bg-video"`、无 `loop`），供 Task 2 的 `triggerDeathFx` 使用。

- [ ] **Step 1: 阅读 index.html 相关区域确认上下文**

Run: `git pull`（确保最新），然后读取 `index.html` 第 2110~2120 行（`#gameBgCanvas` 附近）与第 2180~2185 行（script 引用区）。

- [ ] **Step 2: 新增 `#deathFxVideo` 元素**

在 `#gameBgCanvas` 元素（index.html 约 2118 行）之后、`</body>` 之前插入：

```html
<!-- 死亡动画视频：自己死亡时全屏播放随机一段(见 game-bg.js DEATH_VIDEOS)，
     不设 loop 属性,播放完毕由 game-bg.js 隐藏并恢复原背景 -->
<video id="deathFxVideo" class="bg-video" muted playsinline preload="auto" aria-hidden="true" tabindex="-1"></video>
```

- [ ] **Step 3: 递增 game-bg.js 版本号**

`index.html` 中 `<script src="game-bg.js?v=2"></script>` 改为 `<script src="game-bg.js?v=3"></script>`。

- [ ] **Step 4: 验证**

Run: `node check_cache_bust.js`
Expected: `cache-bust check passed: ...`（无报错）

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "feat: index.html 新增死亡动画视频元素,递增 game-bg.js cache-bust 版本号"
```

---

### Task 2: game-bg.js 重写死亡特效（删他人特效 / 自己播动画）

**Files:**
- Modify: `game-bg.js`（`triggerDeathFx` 重写；删 `bgFx`、`drawBgFx`、`bgNow` 及 self drops / other 血雾；`bgTick` 去掉 `drawBgFx` 调用；`stopGameBg` 追加隐藏动画）

**Interfaces:**
- Consumes: Task 1 的 DOM 元素 `#deathFxVideo`。
- Produces: `triggerDeathFx(kind)`——`kind==='other'` 无效果；`kind==='self'` 播放随机死亡动画。内部函数 `hideDeathFxVideo(v)`（供 ended/error 恢复背景）。

- [ ] **Step 1: 阅读 game-bg.js 全文确认基线**

读取 `game-bg.js`（293 行），确认删除目标的行号与内容。

- [ ] **Step 2: 删除 `bgFx` 变量**

`var bgFx = null; // 当前死亡特效状态`（约 64 行）整行删除。

- [ ] **Step 3: 删除 `bgTick` 中的特效绘制调用**

`drawBgFx(ts, dt); // dt 同源传参,血滴运动不依赖固定帧步长`（约 160 行）整行删除。

- [ ] **Step 4: `stopGameBg` 追加隐藏死亡动画 + 删 `bgFx = null`**

将：

```js
function stopGameBg(){
  bgRunning = false;
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
  fallingCards = [];
  bgFx = null;
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
}
```

改为：

```js
function stopGameBg(){
  bgRunning = false;
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
  fallingCards = [];
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  // 回大厅兜底:若死亡动画仍在播放/显示,立即停止并隐藏,恢复默认背景
  if(typeof document !== 'undefined'){
    var dv = document.getElementById('deathFxVideo');
    if(dv) hideDeathFxVideo(dv);
  }
}
```

- [ ] **Step 5: 用新特效逻辑整体替换"角色死亡特效"区块**

将 `bgNow()`、`triggerDeathFx()`、`drawBgFx()` 三个函数整体（约 211~289 行）替换为：

```js
// ============ 角色死亡特效 ============
// 他人死亡不再播放任何特效(原全屏血雾已删除);
// 自己死亡时在网页背景全屏播放随机一段死亡动画视频,播放完毕自动恢复原背景。
// 新增动画文件:命名 death-N.mp4 放入 assets/video/,并在本数组追加文件名。
var DEATH_VIDEOS = [
  'assets/video/death-1.mp4',
  'assets/video/death-2.mp4'
];

function triggerDeathFx(kind){
  if(kind !== 'self') return; // 他人死亡:无特效
  if(typeof document === 'undefined') return;
  var v = document.getElementById('deathFxVideo');
  if(!v || !DEATH_VIDEOS.length) return;
  v.src = DEATH_VIDEOS[Math.floor(Math.random() * DEATH_VIDEOS.length)];
  v.style.visibility = 'visible';
  if(typeof v.load === 'function') v.load();
  var p = v.play();
  if(p && typeof p.catch === 'function') p.catch(function(){ hideDeathFxVideo(v); });
  bindDeathFxVideo(v); // 绑定 ended/error,播放完/失败即隐藏恢复
}

// 播放结束或失败:隐藏视频,原背景(飘牌 canvas)自然恢复
function hideDeathFxVideo(v){
  if(!v) return;
  if(typeof v.pause === 'function') v.pause();
  v.style.visibility = 'hidden';
  v.removeAttribute('src');
  if(typeof v.load === 'function') v.load(); // 释放视频资源
}

function bindDeathFxVideo(v){
  if(v.__fxBound) return;
  v.__fxBound = true;
  v.addEventListener('ended', function(){ hideDeathFxVideo(v); });
  v.addEventListener('error', function(){ hideDeathFxVideo(v); });
}
```

- [ ] **Step 6: 语法检查**

Run: `node --check game-bg.js`
Expected: 无输出（退出码 0）。

- [ ] **Step 7: 运行既有死亡检测测试确认 checkDeaths 逻辑未破坏**

Run: `node testclass/run_death_fx_detect_test.js`
Expected: `death fx detect tests: 5/5 passed`（`other`/`self` 分类调用不变，测试不改）。

- [ ] **Step 8: 提交**

```bash
git add game-bg.js
git commit -m "feat: 死亡特效改造——他人死亡无特效,自己死亡播放随机动画视频并自动恢复背景"
```

---

### Task 3: 全量验证

**Files:** 无改动，仅验证。

- [ ] **Step 1: 全部验证命令**

Run（依次）:

```bash
node testclass/run_death_fx_detect_test.js
node check_cache_bust.js
node --check game-bg.js
node --check render.js
```

Expected: 测试 `5/5 passed`；cache-bust check passed；两个语法检查退出码 0。

- [ ] **Step 2: 人工核对改动**

Run: `git diff HEAD^ --stat` 与 `git diff HEAD^ -- index.html game-bg.js`，确认：
- index.html 只新增 `#deathFxVideo` 元素 + 版本号 `?v=3`。
- game-bg.js 中 `triggerDeathFx('other')` 无任何效果分支；旧血滴/血雾代码（`drawBgFx`、`bgNow`、`bgFx`）已删净（`grep -n "drawBgFx\|bgNow\|bgFx" game-bg.js` 无命中）。

- [ ] **Step 3: 确认最终状态**

Run: `git status` 与 `git log --oneline -4`，工作区干净、三个提交（Task1/Task2 的 commit + 本次无改动）就绪。
