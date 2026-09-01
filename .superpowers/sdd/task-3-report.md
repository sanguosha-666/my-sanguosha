# Task 3 报告：render 切档 + 终局 hold + 特效暂停 + 聊天静音联动

**状态**: DONE
**commit**: `cce0f14` 基线 → `feat(bgm): render 切档 + 终局hold + 特效暂停 + 聊天静音联动` (待生成)
**分支**: main

## 改了什么

### render.js
- 新增 `maybeUpdateBgm(g)` 与 brief 逐字一致（`bgmHold` guard、`#game.hidden` 判 inGame、`aliveCount` 回退、`duel`/`game` 分档）
- `render()` 中 `maybePlayMovieFx(g)` 旁调用 `maybeUpdateBgm(g)` (typeof guard)
- `maybePlayMovieFx`：while 队列与单槽兼容分支，`evt.kind==='gameOver'` 时 `beginBgmHold()` (typeof guard，dispatch 之后，不依赖是否真播)

### game-bg.js
- `hideFxVideo` 末尾 `resumeBgmAfterFx()` (typeof guard)
- `triggerDeathFx` / `triggerLightningFx` / `triggerMovieFx` / `triggerGirlFx` 起播处 `pauseBgmForFx()` (typeof guard，Girl 在入口即 pause，fallback 的 Movie 再次 pause 幂等)

### render-log.js
- `toggleChatVoice` 末尾 `setBgmMuted(!chatVoiceEnabled)` (typeof guard)
- `chatVoiceEnabled` IIFE 后 `if(!chatVoiceEnabled) setBgmMuted(true)` (typeof guard)

### testclass/run_fx_video_audio_test.js
- `loadBg` 增加 `bgmPlayer` mock
- 断言改为：`unmuteBgVideo` 后 `bgVideo.muted===true`（保持 muted），`bgmPlayer.muted===false`，其余三视频仍 false

### testclass/run_bgm_test.js
- 新增 4 条：18 源码含 `maybeUpdateBgm`、19 `toggleChatVoice` 含 `setBgmMuted`、20 hold 期间 `maybeUpdateBgm` 不切档、21 hold 期间 `ended` 切回 `room`

### index.html
- `render.js?v=468→469` `render-log.js?v=415→416` `game-bg.js?v=36→37→38` (fix 递增)

## TDD 证据

```
node testclass/run_bgm_test.js → 21/21 passed (含 18-21 新增)
node testclass/run_fx_video_audio_test.js → 3/3 passed (bgVideo stays true)
node testclass/run_chat_tts_test.js → 22 passed
node testclass/run_girl_fx_layer_test.js → 17 passed
node check_cache_bust.js → passed (HEAD..working tree 22 scripts)
```

## 自检
- `maybeUpdateBgm` hold 短路优先级正确；lobby/room/game/duel 四档与 brief 一致
- `hideFxVideo` resume 与各 `trigger*` pause 均 typeof 守卫，不影响 vm 测试环境
- 终局 hold：`beginBgmHold` 仅 gameOver 事件触发；`bgmOnEnded` hold 分支切 room 已验证

## 疑虑
- `render-log.js` 初始 `setBgmMuted(true)` 在 `game-bg.js` 之后加载时 typeof 守卫会跳过（脚本顺序）；符合 brief 的 guard 写法，实际静音仍可在首次 toggle 或后续 load 时生效。

---

## Fix (review 2026-09-01) — M1 / I1

### M1 初始静音改到 game-bg 加载后
- `render-log.js:260` 保留为 harmless 额外 guard
- `game-bg.js` `setBgmMuted` 定义后新增 `if(typeof chatVoiceEnabled!=='undefined' && !chatVoiceEnabled) setBgmMuted(true);` 带 typeof 守卫，沙箱单加载 game-bg 仍安全；`chatVoiceEnabled=false` 时加载即 `bgmMuted=true` 且 pause
- `index.html` `game-bg.js?v=37→38`

### I1 hold 测试用真 maybeUpdateBgm
- `run_bgm_test.js` 20 改为从 `render.js` 切片抽取真实 `maybeUpdateBgm` (`indexOf('function maybeUpdateBgm')`→`function resetRenderSentinels`) 并 `runInContext`，注入 `game` 可见桩，漂移即失败
- 新增 22：`chatVoiceEnabled=false` 沙箱加载 `game-bg.js` 后断言 `bgmMuted===true` 且 `_pauses>=1`

### 验证
```
$ node testclass/run_bgm_test.js
BGM tests: 22/22 passed (18-22 含真实现 + 初始静音)
$ node testclass/run_fx_video_audio_test.js
fx video audio tests: 3/3 passed
$ node testclass/run_chat_tts_test.js
结果: 22 通过, 0 失败
$ node check_cache_bust.js
cache-bust check passed: HEAD..working tree (22 scripts)
```
