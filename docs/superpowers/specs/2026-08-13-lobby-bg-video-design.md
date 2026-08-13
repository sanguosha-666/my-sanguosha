# 大厅背景视频 + 游戏内 Canvas 动态背景设计

日期：2026-08-13
模块：UI
状态：功能需求（如按项目 Bug 管理规范建 GitHub Issue 时再分配 CORE 编号）

## 目标

- 初始页面（大厅，`#lobby` 所在页面）：播放背景视频营造氛围。进入房间后暂停，回大厅恢复。
- 游戏中（`#game` 视图）：Canvas 生成"飘落的牌"动态背景，稀疏淡雅，不干扰对局。
- 游戏中角色死亡时：Canvas 背景叠加一次性血腥特效——**自己死亡**=血液滴落晕染后恢复；**其他角色死亡**=全屏血雾弥漫后退去。
- 纯前端视觉增强，不涉及任何游戏规则与状态同步。

## 背景约束（已核实）

- 纯静态架构：index.html（2171 行，内联 CSS）+ 20 个传统 `<script>` 顺序加载共享全局作用域，无构建流程，GitHub Pages 托管。
- body 背景为深色 radial-gradient（`:root` 深棕主题），加载时兜底。
- 大厅/游戏视图切换由 `room-lifecycle.js` 控制：
  - 进房：`room-lifecycle.js:66-68`（`#lobby` 加 hidden、`#game` 去 hidden）
  - 回大厅：`room-lifecycle.js:569-570`（`#game` 加 hidden、`#lobby` 去 hidden）
- 视频层是纯前端显示，不经过 `tx()`/`STAGE_TABLE`/Firebase 任何机制。

## 决策记录

- 素材来源：用户自备 **2~3 个视频文件**，放入 `assets/video/`，命名 `bg-1.mp4`/`bg-2.mp4`/`bg-3.mp4`（H.264/AAC，兼容性最好）。每个 **≤5MB**（GitHub Pages 静态托管无转码、单文件硬上限 100MB；>50MB 警告，≤5MB 保证首屏与移动端流量）。短片段（10~20 秒循环素材即可，loop 播放）。
- 播放方式：进入大厅时从视频清单**随机选一个**播放（每次进大厅可换）。
- 播放范围：大厅=背景视频；游戏中=Canvas 飘牌（两者独立，互不替代）。
- 死亡特效：游戏中触发，分两种——自己死亡=血滴滴落晕染；其他角色死亡=全屏血雾弥漫。由 render.js 检测 alive 变化触发，game-bg.js 绘制。
- 不做"关闭背景视频"开关（用户明确不要）。
- 挂载方式：body 级 fixed 视频层（方案 A），与现有布局零耦合。

## 架构设计

### 1. DOM 结构（index.html `<body>` 最前）

```html
<!-- 大厅背景视频：装饰性纯视觉层，muted+playsinline 满足自动播放策略；
     src 由 game-bg.js 的 pickRandomBgVideo() 随机设置，无 src 时透明、body 渐变兜底；
     视频透明/加载失败时 body 渐变背景兜底 -->
<video id="bgVideo" class="bg-video" autoplay muted loop playsinline aria-hidden="true" tabindex="-1"></video>
<div id="bgVeil" class="bg-veil" aria-hidden="true"></div>
```

### 1b. 随机播放（game-bg.js）

```js
const BG_VIDEOS = ['assets/video/bg-1.mp4','assets/video/bg-2.mp4','assets/video/bg-3.mp4'];
function pickRandomBgVideo(){
  const v=document.getElementById('bgVideo');
  if(!v) return;
  v.src = BG_VIDEOS[Math.floor(Math.random()*BG_VIDEOS.length)];
  if(v.load) v.load();          // 重新加载新 src（autoplay 生效）
  if(v.play){ const p=v.play(); if(p&&typeof p.catch==='function') p.catch(function(){}); }
}
```

- 挂载：`resumeBgVideo()`（回大厅）内部调用 `pickRandomBgVideo()`——每次回大厅随机换一个。
- 失败兜底：视频加载失败时 `<video>` 保持透明，body 渐变背景可见，无需额外重试逻辑。
- 新文件 `game-bg.js`（见 §4.3）统一承载大厅视频与游戏内 Canvas 的视觉逻辑。

层级（z-index）：
- `video.bg-video`：`z-index:0`，全屏铺满
- `div.bg-veil`：`z-index:1`，半透明深色渐变遮罩，保证标题/表单可读
- `.wrap`（现有内容容器）：`position:relative; z-index:2;`（现有样式无定位，追加）

### 2. CSS（index.html `<style>` 内新增）

```css
.bg-video{
  position:fixed; inset:0; width:100%; height:100%;
  object-fit:cover; z-index:0; pointer-events:none; background:transparent;
}
.bg-veil{
  position:fixed; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(180deg, rgba(26,23,20,.40) 0%, rgba(26,23,20,.62) 100%);
}
.wrap{ position:relative; z-index:2; }
```

- `pointer-events:none`：视频与遮罩不拦截任何点击/交互。
- 遮罩透明度为起始值，可按素材明暗微调，但必须保证 h1/表单/页脚可读。

### 3. 播放控制（room-lifecycle.js）

新增防御式工具函数（放 room-lifecycle.js 内，与现有 DOM 操作同文件）：

```js
function pauseBgVideo(){
  const v=document.getElementById('bgVideo');
  if(v && typeof v.pause==='function') v.pause();
}
function resumeBgVideo(){
  const v=document.getElementById('bgVideo');
  if(v && typeof v.play==='function'){ const p=v.play(); if(p&&typeof p.catch==='function') p.catch(function(){}); }
}
```

挂载点：
- `room-lifecycle.js:66` 进房分支（`#game` 去 hidden 处）追加 `pauseBgVideo()`
- `room-lifecycle.js:569` 回大厅分支（`#game` 加 hidden 处）追加 `resumeBgVideo()`

### 4. 游戏内 Canvas 动态背景（飘落的牌）

#### 4.1 结构

`<canvas id="gameBgCanvas">` 放 `#game` 内第一个子元素。`#game` 为 `position:relative`（index.html:102），内部元素 z-index 从 2 起（:492/:559/:616 等），Canvas 用 `z-index:0` 垫底：

```css
#gameBgCanvas{position:fixed; inset:0; width:100%; height:100%; z-index:0; pointer-events:none;}
```

- `pointer-events:none`：不拦截座位/手牌/按钮任何交互。
- `.table-strip`、`.panel.table` 等不透明区域自然盖住 Canvas；座位区空档处 Canvas 透出。
- Canvas 自身透明不填底色（body 渐变背景透出），只绘制飘落的牌。

#### 4.2 视觉与运动参数（初始值，实现时可调）

- 同屏牌数：**12～18 张**（稀疏淡雅，用户已确认）。
- 新牌生成：每 1.5～4 秒随机一张，从顶部随机水平位置进入。
- 牌尺寸：26～44px；下落速度：12～30 px/s；水平漂移 ±6 px/s。
- 旋转：±0.5 rad/s；透明度：0.22～0.45。
- 牌面绘制（Canvas 原生绘制，**不引用任何游戏状态/真实牌数据**）：
  - 圆角矩形牌背（深棕底 + 金/朱红描边）或牌面（浅底 + 花色符号）；
  - 中央随机花色符号 ♠♥♣♦ + 上下小角标，牌面随机二选一。
- 牌随时间缓慢旋转下落，落到屏幕底部外后移除。

#### 4.3 动画生命周期

- 新文件 `game-bg.js`（与 #91 按域拆分方向一致，视觉层独立文件）：
  - `pickRandomBgVideo()`：随机设置大厅视频 src（§1b）。
  - `startGameBg()`：进房启动 `requestAnimationFrame` 循环。
  - `stopGameBg()`：回大厅停止 rAF、清空 Canvas。
  - `document.visibilitychange`：页面隐藏时暂停 rAF，恢复可见时继续（省流量/CPU）。
  - `resize` 事件：适配 devicePixelRatio 与画布尺寸。
  - 不用真实牌数据、不读 `g` 游戏状态，纯装饰。

#### 4.4 挂载点（room-lifecycle.js）

与视频同一挂载点，进房/回大厅各加一行：

```js
if(typeof startGameBg==='function') startGameBg();   // room-lifecycle.js:66 进房分支
if(typeof stopGameBg==='function')  stopGameBg();    // room-lifecycle.js:569 回大厅分支
```

**必须 `typeof` 防御**：vm 测试沙箱加载 room-lifecycle.js 但不加载 game-bg.js，直接调用会 ReferenceError。

#### 4.5 加载顺序

index.html 在 skills.js 之后追加 `<script src="game-bg.js?v=XXX"></script>`（传统 script 共享作用域，依赖 `document`/`requestAnimationFrame`，运行时调用无需依赖游戏模块）。

### 5. 角色死亡背景特效

#### 5.1 触发检测（render.js）

- render.js 维护**上一帧各座位 alive 快照**（`lastAliveSnapshot`，进房时初始化为当前状态，回大厅重置）。
- 每次 `render(g)` 时对比快照：某座位 alive 由 `true→false`，按座位判定触发类型：
  - 死亡座位 === `mySeat`（自己）→ `triggerDeathFx('self')`
  - 否则 → `triggerDeathFx('other')`
- 对比后更新快照。状态同步（Firebase）后所有客户端一致触发，天然只触发一次。
- 沙箱兼容：快照对比为纯数组操作；调用 `triggerDeathFx` 前 `typeof` 防御（沙箱无 game-bg.js），对比逻辑本身不抛错。

#### 5.2 特效绘制（game-bg.js）

绘制顺序（同一 Canvas）：**飘牌 → 死亡特效**。特效为短时粒子/渐变，生命周期结束后完全清除，恢复平时飘牌背景。

**自己死亡——血滴滴落晕染**（总时长约 2.5~3s）：
- 5~8 滴血滴粒子：从屏幕上部随机水平位置、随机初始速度滴落，带重力加速度与轻微水平漂移。
- 血滴到达底部（或随机落地高度）后停止，晕染为径向渐变血渍（半径渐大、边缘羽化模糊、alpha 渐低）。
- 血渍叠加后整体 alpha 逐步降到 0（"模糊掉后恢复"），清空特效状态。

**其他角色死亡——全屏血雾弥漫**（总时长约 1~1.5s）：
- 屏幕四周边缘发起多个红色 radial-gradient 血雾斑块，向中心弥漫并轻微脉动。
- 峰值覆盖约 35% 不透明度（`alpha≈0.35`），随后整体渐隐退去。

**通用**：
- 血红色取主题深红系（`--cinnabar` 相邻色，如 `rgba(177,54,30,*)`），不刺眼。
- 特效期间飘牌背景继续运行不受影响。
- 视觉纯装饰：不读取任何游戏状态/牌面数据。

### 6. 测试兼容（关键设计点）

视频部分：`run_*.js` 的 vm 沙箱会加载 `room-lifecycle.js`（如 `run_ai_summary_room_lifecycle_test.js`），其 `document` stub 的 `getElementById` 返回对象**没有 `pause`/`play` 方法**。因此：

- 调用点必须是防御式（`typeof v.pause==='function'` 检查），否则沙箱内会抛 TypeError 导致测试红。
- 上述函数写法已内置该防御，沙箱中自动 no-op。

Canvas 部分：`game-bg.js` 不进任何 `run_*.js` 的加载清单，沙箱中不存在该函数；调用点 `typeof startGameBg==='function'` 防御保证 room-lifecycle.js 在沙箱中正常。死亡特效触发同样走 `typeof triggerDeathFx==='function'` 防御，render.js 的快照对比逻辑本身是纯数组操作、沙箱安全。

### 7. 版本号约定（check_cache_bust.js）

改动 `index.html`（CSS/结构）与 `room-lifecycle.js` 均会触发 cache-bust 校验：`room-lifecycle.js` 在 index.html 的 `?v=` 需递增（当前 399）。新增 `game-bg.js` 需在 index.html 引用并带 `?v=`。视频文件为静态资源、不进 `?v=` 体系，无需处理。

## 验收标准

1. 打开页面（未进房）：大厅背景播放**随机选中的**视频之一，循环、静音、全屏铺满、不遮挡任何按钮与表单交互。
2. 标题「极简三国杀」、房间表单、页脚说明在视频上清晰可读（遮罩生效）。
3. 进入房间：视频暂停（不继续后台耗流量/CPU）；游戏画面中开始飘落稀疏的牌。
4. 回大厅（房间关闭/退出）：视频恢复播放且**随机更换一个**；Canvas 停止并清空。
5. 飘落的牌为纯装饰：不显示真实手牌/牌堆内容，不遮挡座位、手牌、按钮交互。
6. 页面切后台：Canvas 动画暂停；切回继续，不累积卡顿。
7. 角色死亡：自己死亡时背景血滴滴落→晕染→模糊→恢复；其他角色死亡时全屏血雾弥漫→退去；多客户端一致触发且只触发一次。
8. 死亡特效结束后背景恢复正常飘牌，无残留。
9. 窄屏/横屏/安全区（env()）：视频与 Canvas 均正常铺满，不破坏现有响应式布局。
10. iOS Safari：视频不强制全屏、不黑屏（playsinline + object-fit:cover）；Canvas 正常。
11. `node run_all_tests.js` 全量通过（72/72），沙箱内视频/Canvas/死亡特效调用 no-op 不报错。

## 不做（YAGNI）

- 不做关闭开关（视频/飘牌/死亡特效均不做）。
- 不做选将阶段单独背景（选将属游戏中，Canvas 生效）。
- 不做视频加载失败重试/降级逻辑（body 渐变兜底已足够）。
- 不引入第三方播放库/粒子库（Canvas 原生绘制）。
- 飘牌/死亡特效不读取游戏状态，不与真实牌面/牌堆内容挂钩。
- 死亡特效不做持续残留/常驻血渍（一次性，自动恢复）。
