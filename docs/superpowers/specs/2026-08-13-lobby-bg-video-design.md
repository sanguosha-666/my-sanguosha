# 大厅背景视频 + 游戏内 Canvas 动态背景设计

日期：2026-08-13
模块：UI
状态：功能需求（如按项目 Bug 管理规范建 GitHub Issue 时再分配 CORE 编号）

## 目标

- 初始页面（大厅，`#lobby` 所在页面）：播放背景视频营造氛围。进入房间后暂停，回大厅恢复。
- 游戏中（`#game` 视图）：Canvas 生成"飘落的牌"动态背景，稀疏淡雅，不干扰对局。
- 纯前端视觉增强，不涉及任何游戏规则与状态同步。

## 背景约束（已核实）

- 纯静态架构：index.html（2171 行，内联 CSS）+ 20 个传统 `<script>` 顺序加载共享全局作用域，无构建流程，GitHub Pages 托管。
- body 背景为深色 radial-gradient（`:root` 深棕主题），加载时兜底。
- 大厅/游戏视图切换由 `room-lifecycle.js` 控制：
  - 进房：`room-lifecycle.js:66-68`（`#lobby` 加 hidden、`#game` 去 hidden）
  - 回大厅：`room-lifecycle.js:569-570`（`#game` 加 hidden、`#lobby` 去 hidden）
- 视频层是纯前端显示，不经过 `tx()`/`STAGE_TABLE`/Firebase 任何机制。

## 决策记录

- 素材来源：用户自备视频文件，放入 `assets/video/bg.mp4`（H.264/AAC，兼容性最好）。
- 播放范围：大厅=背景视频；游戏中=Canvas 飘牌（两者独立，互不替代）。
- 不做"关闭背景视频"开关（用户明确不要）。
- 挂载方式：body 级 fixed 视频层（方案 A），与现有布局零耦合。

## 架构设计

### 1. DOM 结构（index.html `<body>` 最前）

```html
<!-- 大厅背景视频：装饰性纯视觉层，muted+playsinline 满足自动播放策略；
     视频透明/加载失败时 body 渐变背景兜底 -->
<video id="bgVideo" class="bg-video" autoplay muted loop playsinline aria-hidden="true" tabindex="-1">
  <source src="assets/video/bg.mp4" type="video/mp4">
</video>
<div id="bgVeil" class="bg-veil" aria-hidden="true"></div>
```

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

### 5. 测试兼容（关键设计点）

视频部分：`run_*.js` 的 vm 沙箱会加载 `room-lifecycle.js`（如 `run_ai_summary_room_lifecycle_test.js`），其 `document` stub 的 `getElementById` 返回对象**没有 `pause`/`play` 方法**。因此：

- 调用点必须是防御式（`typeof v.pause==='function'` 检查），否则沙箱内会抛 TypeError 导致测试红。
- 上述函数写法已内置该防御，沙箱中自动 no-op。

Canvas 部分：`game-bg.js` 不进任何 `run_*.js` 的加载清单，沙箱中不存在该函数；调用点 `typeof startGameBg==='function'` 防御保证 room-lifecycle.js 在沙箱中正常。

### 6. 版本号约定（check_cache_bust.js）

改动 `index.html`（CSS/结构）与 `room-lifecycle.js` 均会触发 cache-bust 校验：`room-lifecycle.js` 在 index.html 的 `?v=` 需递增（当前 399）。新增 `game-bg.js` 需在 index.html 引用并带 `?v=`。视频文件为静态资源、不进 `?v=` 体系，无需处理。

## 验收标准

1. 打开页面（未进房）：大厅背景播放视频，循环、静音、全屏铺满、不遮挡任何按钮与表单交互。
2. 标题「极简三国杀」、房间表单、页脚说明在视频上清晰可读（遮罩生效）。
3. 进入房间：视频暂停（不继续后台耗流量/CPU）；游戏画面中开始飘落稀疏的牌。
4. 回大厅（房间关闭/退出）：视频自动恢复播放；Canvas 停止并清空。
5. 飘落的牌为纯装饰：不显示真实手牌/牌堆内容，不遮挡座位、手牌、按钮交互。
6. 页面切后台：Canvas 动画暂停；切回继续，不累积卡顿。
7. 窄屏/横屏/安全区（env()）：视频与 Canvas 均正常铺满，不破坏现有响应式布局。
8. iOS Safari：视频不强制全屏、不黑屏（playsinline + object-fit:cover）；Canvas 正常。
9. `node run_all_tests.js` 全量通过（72/72），沙箱内视频/Canvas 调用 no-op 不报错。

## 不做（YAGNI）

- 不做关闭开关（视频/飘牌均不做）。
- 不做选将阶段单独背景（选将属游戏中，Canvas 生效）。
- 不做视频加载失败重试/降级逻辑（body 渐变兜底已足够）。
- 不引入第三方播放库/粒子库（Canvas 原生绘制）。
- 飘牌不读取游戏状态，不与真实牌面/牌堆内容挂钩。
