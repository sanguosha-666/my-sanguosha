# 死亡特效改造设计（2026-08-16）

## 目标

1. 删除他人死亡特效（原 `other` 全屏血雾）。
2. 自己死亡特效改为：在网页背景全屏播放随机一段死亡动画视频（`assets/video/death-*.mp4`），播放完毕自动恢复原背景（飘牌 canvas）。

## 现状

- `render.js checkDeaths()`：逐帧对比 alive 快照，检测 alive true→false，调用
  `triggerDeathFx(i === mySeat ? 'self' : 'other')`。
- `game-bg.js`：
  - `triggerDeathFx(kind)`：`self` 生成 5~8 滴血滴；`other` 生成全屏血雾。
  - `drawBgFx(now, dt)`：在飘牌 canvas 上绘制当前特效；`bgFx` 保存特效状态；
    `bgNow()` 提供与 rAF timestamp 同源的时间基准。
- 背景层级（index.html CSS）：`.bg-video`（z-index:0）、`#gameBgCanvas`（z-index:0）、
  `#bgVeil`（z-index:1，游戏内隐藏）、`.wrap` 游戏 UI（z-index:2）。
- 视频资源：仅 `assets/video/bg-1/2/3.mp4` 三个大厅背景视频，无死亡动画素材。

## 需求约定（已与用户确认）

- 死亡动画素材由用户提供，命名约定 `death-` 前缀（如 `death-1.mp4`、`death-2.mp4`），
  放在 `assets/video/` 下。
- 代码通过硬编码 `DEATH_VIDEOS` 数组引用（风格同 `BG_VIDEOS`），新增文件需同步加数组项，
  注释中写明该约定。

## 改动

### 1. index.html

- 在 `#gameBgCanvas` 之后、`#game` 内新增死亡动画视频元素（与大厅视频同层 z-index:0、DOM 顺序靠后，
  可盖住飘牌 canvas）：

  ```html
  <video id="deathFxVideo" class="bg-video" muted playsinline preload="auto"
         aria-hidden="true" tabindex="-1"></video>
  ```

  不写 `loop` 属性：死亡动画只播一遍，`ended` 后隐藏恢复背景。
  初始 `visibility` 隐藏由 JS 首次使用时控制（复用 `.bg-video` 类样式）。

- `game-bg.js` 引用版本号递增：`?v=2` → `?v=3`（cache-bust 规则）。

### 2. game-bg.js

- 新增 `DEATH_VIDEOS` 数组，注释标明命名约定。
- `triggerDeathFx(kind)` 重写：
  - `kind !== 'self'` 直接返回 —— 他人死亡不再触发任何特效（原血雾删除）。
  - `kind === 'self'`：随机选一个 `DEATH_VIDEOS`，设置 `#deathFxVideo.src` 并显示，
    `load()` + `play()`（不循环）。
  - `ended` 事件：隐藏视频并恢复原背景（飘牌 canvas 自然可见）。
  - `error` 事件与 `play()` Promise reject：立即隐藏恢复，优雅降级
    （与大厅视频加载失败 body 渐变兜底同理）。
  - 播放中再次触发：直接换 src 重新播（幂等；实际自己死后不会再死，属防御）。
- 删除原血滴/血雾整套代码：`bgFx` 变量、`drawBgFx()`、`bgNow()`、
  `triggerDeathFx` 内的 self drops / other 分支。
- `stopGameBg()` 追加：隐藏并停止 `#deathFxVideo`（回大厅兜底，避免残留播放）。

### 3. render.js

- 不改。`checkDeaths` 的 self/other 分类调用保持不变，视觉层自行忽略 `other`，
  职责分离最干净。

### 4. 测试

- `testclass/run_death_fx_detect_test.js` 不改：它测的是 `checkDeaths` 分类逻辑，
  行为不变；改动后跑一遍确认仍通过。

## 用户后续动作

提供 `death-*.mp4` 动画文件放进 `assets/video/`，并把文件名同步进 `DEATH_VIDEOS` 数组。

## 验证

- `node testclass/run_death_fx_detect_test.js`
- `node check_cache_bust.js`
- `node --check game-bg.js` 与 `node --check render.js`（语法）
