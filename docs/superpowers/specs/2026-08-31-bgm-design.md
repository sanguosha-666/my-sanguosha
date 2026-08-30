# 对局/大厅 BGM 设计（2026-08-31）

## 目标

三档背景音乐：大厅、对局通用、1v1。与大厅视频画面分离（视频永远 mute）。曲池随机；大厅每次进入只播两首后停。

## 现状

- 大厅 `#bgVideo` 播 `bg-1/2/3.mp4` 自身音轨：muted 自动播，首次手势 `unmuteBgVideo` 解锁。手机 CORE-144 不播大厅视频。
- 无 BGM 层。`assets/audio/` 全是技能/伤害音效。
- 全屏特效（死亡/闪电/过场/女孩）走独立 video 音轨。
- 聊天 `#chatVoiceBtn`（🔊/🔇）只控制 TTS，`localStorage sgs_chat_voice`。
- `aliveCount(g)` 已有（`game.js:831`）。`game-bg.js` 约定：纯视觉/音频层，不读对局状态。

## 需求约定（已与用户确认）

1. 覆盖：大厅 + 对局通用 + 1v1。方案 A：单 `<audio id="bgmPlayer">` 切 src。
2. 手机大厅也播 BGM（视频仍不播）。
3. 每档多曲随机；同档 `ended` 再抽（池>1 避开上一首）。
4. 大厅每次进入播 **2 首** 后停；回大厅/刷新重新计。对局 game/duel 不限首数。
5. 终局：当前曲继续，直到 `ended` 或满 40 秒（先到为准），然后切大厅曲池。40 秒墙钟；回大厅按钮可提前切。不在终局再抽 game/duel 下一首。
6. 全屏特效期间暂停 BGM，结束后从暂停点续（不换曲）。
7. 复用聊天 🔊：`toggleChatVoice` 同时管 TTS+BGM。技能/特效音轨不管。大厅看不见该按钮；🔇 持久化后大厅也不播。
8. `#bgVideo` 永远 mute。音量约 0.35，切曲约 300ms fade。首次手势复用 `unmuteBgVideo`。
9. 缺文件静默，不抛。素材稍后补；代码硬编码数组（同 `BG_VIDEOS`）。

## 架构

`game-bg.js` 只认模式字符串，不读 `g`：

```
setBgmMode('lobby'|'game'|'duel'|'off')
setBgmMuted(boolean)   // 聊天 🔊 调用
pauseBgmForFx() / resumeBgmAfterFx()  // hideFxVideo / trigger*Fx 调用
```

`render.js` 每帧（或哨兵）根据 `g.started` + `aliveCount(g)` 调 `setBgmMode`。进房/回大厅在现有 `pauseBgVideo` / `pickRandomBgVideo` 旁各调一次。终局由 `maybePlayMovieFx` 看到 `gameOver` 或 `g.winner`/`checkWin` 后调 `setBgmMode` 的终局分支（保持当前曲 + 40s 上限，不立刻 lobby）。

同模式且非终局 hold：不重载当前曲。

## 曲池与文件

硬编码（缺项跳过）：

```
BGM_TRACKS = {
  lobby: ['assets/audio/bgm-lobby.mp3', 'assets/audio/bgm-lobby01.mp3', ...],
  game:  ['assets/audio/bgm-game.mp3',  'assets/audio/bgm-game01.mp3',  ...],
  duel:  ['assets/audio/bgm-duel.mp3',  'assets/audio/bgm-duel01.mp3',  ...]
}
```

新曲：丢进 `assets/audio/` 并往对应数组追加。命名见文末「素材格式」。

大厅计数：`lobbyPlays` 进 lobby 置 0；每成功起播 +1；`ended` 时若 `lobbyPlays>=2` → `off`，否则再抽。

## 切档

| 时机 | 模式 |
|---|---|
| 大厅（含手机，含 🔇 为关时不播） | lobby |
| 对局已开始且存活 ≥3 | game |
| 存活恰好 2（含 2 人房开局） | duel |
| 终局 | hold 当前曲，ended 或 40s → lobby |
| 回大厅 | lobby（重置 2 首计数） |
| 🔊 关闭 | off（pause+muted） |

2 人房开局直接 duel。

## 特效

`triggerDeathFx` / `triggerLightningFx` / `triggerMovieFx` / `triggerGirlFx` 起播时 `pauseBgmForFx()`。`hideFxVideo` / `girlFxEnd` 完成时 `resumeBgmAfterFx()`。终局 40s 计时不因暂停而冻结（墙钟）。

## 静音按钮

不新增 DOM。`render-log.js toggleChatVoice()` 翻转后调用 `setBgmMuted(!chatVoiceEnabled)`。按钮文案仍 🔊/🔇。localStorage 键不变。

## 改动面

- `index.html`：`<audio id="bgmPlayer" preload="none">`；cache-bust `game-bg.js` / `render.js` / `render-log.js`
- `game-bg.js`：曲池、`setBgmMode`、ended 抽下一首、大厅 2 首、终局 40s、fade、特效暂停
- `render.js`：`maybeUpdateBgm(g)`
- `render-log.js`：`toggleChatVoice` 联动
- 进房/回大厅现有函数旁各一调
- `testclass/run_bgm_test.js`：切档、同模式不重载、ended 抽下一首且避开上一首、大厅 2 首后停、终局 ended/40s、特效暂停、🔊 联动、缺文件静默
- `run_fx_video_audio_test.js`：`unmuteBgVideo` 也 unmute `#bgmPlayer`（若存在）

## 不做

新静音按钮、Web Audio、三路预加载、按角色/阵营切曲、手机禁 BGM。

## 素材格式（给供稿）

- **容器/编码：** MP3（MPEG-1/2 Layer III）。与现有 `assets/audio/*.mp3` 一致，浏览器 `<audio>` 无需转码。
- **采样率：** 44.1 kHz（或 48 kHz）。
- **声道：** 立体声或单声道均可。
- **码率：** 128–192 kbps CBR 即可；不要无损/WAV（体积大，大厅循环不值得）。
- **时长：** 建议每首 1–3 分钟。大厅两首后停，过长等于只听半首。
- **响度：** 大致 -16 LUFS 左右，避免比技能音效还响（BGM 播放音量约 0.35）。
- **命名（必须）：**
  - 大厅：`bgm-lobby.mp3`、`bgm-lobby01.mp3`、`bgm-lobby02.mp3`…
  - 对局：`bgm-game.mp3`、`bgm-game01.mp3`…
  - 1v1：`bgm-duel.mp3`、`bgm-duel01.mp3`…
- **路径：** `assets/audio/`
- **数量：** 大厅至少 2 首才有「播两首后停」的差异；game/duel 各至少 1 首。多了往数组追加即可。
- **版权：** 只放你有权使用的曲子。
