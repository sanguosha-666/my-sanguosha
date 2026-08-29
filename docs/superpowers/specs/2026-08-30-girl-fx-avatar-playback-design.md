# 三姐妹表情动画头像化播放设计（2026-08-30）

## 目标

大乔/小乔/貂蝉的表情动画（`girlKill`/`girlDeath`/`girlKillDeath`/`gameOver` 三姐妹分派）
不再在所有设备上全屏黑底播放，改为按设备分层呈现：

- **桌面（电脑）**：动画播在女孩座位的头像上。
  - 女孩是他人：以头像框为锚点，放大 ~1.8 倍悬浮播放（盖在相邻元素上方），播完缩回。
  - 女孩是自己：精确贴合自己头像框原尺寸播放（头像"活起来"），淡入淡出。
- **手机**：头像框从座位位置 FLIP 放大到自适应全屏（按视频真实宽高比的最大居中盒），
  然后播放；播完沿原路缩回头像原位。
- **平板**：完全不变（维持现有全屏 `#movieFxVideo` 播放）。

其余全屏动画（于吉/左慈/阵营结算/死亡/闪电）在所有设备上维持现状。

## 现状

- 触发链：`game.js` 写 `g.movieFxQueue`/`g.lastMovieFx` →
  `render.js maybePlayMovieFx(g)` 按 seq 游标去重 → `movieVideoKeyForMe(g, evt)` 按
  kind+本客户端座位算出"我要播的内容"（legacy 键或三人表情的具体视频路径）→
  `game-bg.js triggerMovieFx(kind)` 设 `#movieFxVideo.src` 全屏播放。
- `#movieFxVideo` CSS：`.fx-video{position:fixed;inset:0;width:100%;height:100%;
  object-fit:contain;background:#000;z-index:1500;pointer-events:none;}` —— 全设备同款。
- 设备判定现成口径：
  - 手机：`game-bg.js isPhoneLayout()`（`(max-width:640px)` ∪ `(max-height:460px) and
    (orientation:landscape)`，与 index.html CSS 断点对账）。
  - 桌面：`render.js isDesktopLayout()`（`(hover:hover) and (pointer:fine)`）。
  - 平板 = 非手机且非桌面。
- 座位头像结构：`.seat[data-seat="N"] > .seat-art > .avatar`；
  `game-bg.js triggerDeathPortraitFx(seat)` 已有"按 `getBoundingClientRect` 把覆盖层
  定位到座位"的可复用先例。
- 表情视频素材为竖版 3:4 为主（480×640；个别 448×672=2:3），与头像框比例吻合。
- 三姐妹表情"每客户端按视角分派不同视频"的选片规则（杀手/被杀/旁观 × 无后缀/后缀池）
  本次**不改**。

## 需求约定（已与用户确认）

1. 桌面锚定语义 = 方案 A：视频锚定到**视频内容所属女孩**在棋盘上的座位头像，
   各客户端仍播各自视角的内容（同一框、不同内容）。
2. 桌面尺寸形态：他人放大悬浮，自己按头像框原尺寸。
3. 手机退场：播完缩回头像原位；找不到座位/头像不可见时回退现有全屏直接播放。
4. 平板不变。

## 改动

### 1. index.html

- 在三条现有 fx video 之后新增独立元素（不与 `#movieFxVideo` 复用，避免波及 legacy 路径）：

  ```html
  <video id="girlFxVideo" class="girl-fx-video" muted playsinline preload="auto"
         aria-hidden="true" tabindex="-1"></video>
  ```

- 新增 CSS `.girl-fx-video`：
  `position:fixed; visibility:hidden; z-index:1500; pointer-events:none;
  object-fit:cover; border-radius:10px; background:transparent;
  transition:left/top/width/height .45s ease, opacity .3s ease;`
  （圆角与 `.seat-art`/死亡碎裂层一致；FLIP 放大与缩回都走同一 transition。）
  - 手机全屏态附加类 `.girl-fx-full`：`object-fit:contain; background:#000;
    border-radius:0;`。
  - 桌面他人悬浮态附加类 `.girl-fx-float`：`box-shadow` 抬升 + `object-fit:cover`。
- `.fx-video` 现有样式逐字不动。
- 引用 `game-bg.js`/`render.js` 的 `?v=` cache-bust 版本号递增。

### 2. game-bg.js

新增 `triggerGirlFx({ path, seat, selfSeat })`（纯视觉层，不读游戏状态，与本文件定位一致）：

- 设备分派：
  - `isPhoneLayout()` → 手机模式；
  - 否则 `(hover:hover) and (pointer:fine)` → 桌面模式（判定写法与 `isDesktopLayout()`
    同口径，但本文件不 require render.js——两文件加载顺序无关，各自 matchMedia）；
  - 否则 → 平板：内部直接转调 `triggerMovieFx(path)`（现状行为）。
- 锚点解析：`document.querySelector('.seat[data-seat="'+seat+'"] .seat-art')` →
  `getBoundingClientRect()`；rect 缺失、宽高 <2px、或与视口相交面积 <50% 视为不可见 →
  回退 `triggerMovieFx(path)`。
- 手机模式（FLIP）：
  1. 元素先定位到头像 rect（cover 裁切），`visibility:visible` 开始 transition；
  2. 下一帧切到目标盒：按视频真实宽高比的最大居中盒（`loadedmetadata` 拿
     `videoWidth/videoHeight`；拿不到按 3:4 兜底），高/宽不超视口，加 `.girl-fx-full`；
  3. `src` 设定 + `applyFxAudio` + `play()`（放大与起播并行，不必等 transitionend，
     避免低端机 transition 事件不靠）；
  4. `ended`/`error`：回到头像 rect（重取一次 getBoundingClientRect，布局可能已变），
     动画结束后 `hideFxVideo` 语义隐藏并释放 src。
  - 播放中 `resize`/`orientationchange`：重算目标盒（沿用本文件既有监听惯例）。
- 桌面模式：
  - `seat === selfSeat`：定位到头像 rect 原尺寸，`.girl-fx-video` 不加 scale 类，
    opacity 0→1 淡入，`ended`/`error` 淡出；object-fit:cover 与静态头像观感一致。
  - `seat !== selfSeat`：以头像矩形中心放大 ~1.8 倍悬浮盒（clamp 进视口、保持 3:4），
    加 `.girl-fx-float`；播完缩回头像 rect 再隐藏。
  - 桌面同样响应 `resize`/`orientationchange` 重定位（复用与手机同款的单次监听重算逻辑）。
- 并发语义与现状一致：后到触发覆盖先到（直接换元素状态重新走入场），不排队。
- 回大厅兜底：`stopGameBg()` 的隐藏列表追加 `girlFxVideo`。
- 失败降级：视频加载 error / play() reject → 立即按退场路径隐藏（同现有 fx 惯例），
  不弹错、不重试。

### 3. render.js

- `movieVideoKeyForMe(g, evt)` 返回值从"键/路径字符串"改为 `{ key, seat } | null`：
  - legacy 三姐妹之外的 kind：`{ key, seat: null }`（调用方走 `triggerMovieFx`，现状不变）；
  - `girlKill`：seat = `evt.seat`（女孩=杀手）；
  - `girlDeath`：seat = `evt.seat`（女孩=死者）；
  - `girlKillDeath`：seat 跟随**选中那段视频所属的女孩**——选 killerGen 的视频 →
    `r.killerSeat`；选 victimGen 的视频 → `r.victimSeat`（在现有随机分派处同步定 seat，
    不二次随机）；
  - `gameOver`：本人三姐妹 → `mySeat`；旁观后缀 → `r.girlWin.seat` / `r.girlLose.seat`。
- `maybePlayMovieFx`：`seat != null` 且能取到本客户端 `mySeat` → `triggerGirlFx({path:key,
  seat, selfSeat:mySeat})`；否则 `triggerMovieFx(key)`。哨兵/队列去重逻辑逐字不动。
- `resetRenderSentinels` 无需新增游标（girl 层状态由 game-bg 自管），但确认回大厅路径
  覆盖 `girlFxVideo`（见 stopGameBg）。

### 4. 测试

- `testclass/run_movie_fx_detect_test.js`：`fire()` 断言改为对象形态——路径断言逐条保留，
  新增各 kind × 各视角的 `seat` 锚点断言（重点：girlKillDeath 随机分派后 seat 与
  视频所属女孩一致；gameOver 旁观 girlWin/girlLose 的 seat 取自 result）。
- 新增 `testclass/run_girl_fx_layer_test.js`（node 沙箱，mock document/matchMedia）：
  - 平板 matchMedia → 转调 `triggerMovieFx`，`girlFxVideo` 不动；
  - 桌面 + seat===selfSeat → 目标 rect = 头像 rect（无放大）；
  - 桌面 + 他人 → 悬浮盒中心 ≈ 头像中心、尺寸 ≈ 1.8x、clamp 不越视口；
  - 手机 → 入场从头像 rect 到最大比例居中盒；`ended` 后回缩到头像 rect；
  - 座位缺失/rect 过小/相交 <50% → 回退全屏；
  - error/play reject → 隐藏降级。
- 回归：`node run_all_tests.js` 全绿；手工三设备（DevTools 模拟）过一遍
  girlKill/girlDeath/girlKillDeath/gameOver 四条路径。

## 边界与不变项

- 每视角选片规则、后缀池随机、`applyFxAudio` 解锁、seq 去重、`movieFxQueue` 写入端
  （game.js）全部不动。
- 游戏不因动画阻塞：`pointer-events:none` 维持，动画期间对局照常进行（与现状一致）。
- 死亡女孩仍在棋盘上有阵亡座位（`.seat` 不删除），girlDeath/gameOver 锚点可解析；
  若 UI 后续删除座位，本设计以"回退全屏"兜底。
- 桌面窗口跨断点（resize 宽窄变化）：按当次触发时判定模式，不做播放中切模式。
