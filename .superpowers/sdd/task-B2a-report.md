# B2a 主公技(激将/护驾)报告

## 结论

刘备【激将】+ 曹操【护驾】实现完成。TDD：先写 `run_ai_lordskill_test.js` 28 项 → RED（21 FAIL / 7 PASS，7 个 PASS 正好是零变化守卫基线）→ 实现 → 28/28 GREEN。

## 改动文件

| 文件 | 改动 |
|------|------|
| `data.js` | liubei 补 `caps:{rende:true, jijiang:true}`；caocao 补 `caps:{hujia:true}`（奸雄 hooks 保留） |
| `game.js` | `canTriggerLordAsk`/`startLordAsk`/`restoreLordAsk`/`completeLordAsk`/`respondLordAskCore`+`respondJijiangAsk`/`respondHujiaAsk`；respondShan/duelResponse/aoeRespond 三处"不出"分支触发点；normalize 两标志防御 + jijiangAsk/hujiaAsk pending 结构校验 + RESPONSE_PENDING_TYPES 补两项；startTurn 重置 |
| `render.js` | phaseName 补两项；selectedResponseCardIdx 兜底清理补两项 |
| `render-hand.js` | respondRole 多候选选牌补两项（七个响应场景共用一套状态） |
| `render-controls.js` | jijiangAsk/hujiaAsk 被求助者按钮 + 旁观者 banner 两个分支 |
| `bot.js` | BOT_PHASE_ACTOR 登记 `jijiangAsk:'asking'`/`hujiaAsk:'asking'`；BOT_DECISIONS.jijiangAsk/hujiaAsk 注册；runBotDecision L1 前接线；CONTROLS_CHOICE_EXCLUDE 收录两项 |
| `bot-ai-bus.js` | A1 超时保守表补 `jijiangAsk→respondJijiangAsk(false)`/`hujiaAsk→respondHujiaAsk(false)` |
| `run_ai_lordskill_test.js` | 新建，28 项测试 |
| `index.html` | `?v=302→303` ×14 |

## 关键设计决策

1. **触发点放在"不出/不闪/认输"分支而非响应阶段创建点**：激将/护驾是可选的（"可发动"），主公想自己出牌时不应被强制问一圈。放"不出"分支 = 主公选择不自己出时才求助；无人替出 → 恢复原 pending → 主公回到正常响应（可再自己出或不出，第二次不出因 used 已真直接受伤/认输）。铁骑判红(noShan)的杀不可被闪抵消，护驾触发前显式跳过。
2. **完成语义镜像于吉【蛊惑】的 resolve 系列**（`resolveGuhuoResponseShan/Sha/Aoe` 同款）：换牌者只是物理出牌人，响应方仍是主公。决斗换 active/南蛮万箭 aoeAdvance/单体杀走 maybeStartShaOffsetEffects+finishSingleShaTarget。
3. **守卫双条件**：`hasCap(p,cap)`（能力声明）+ `p.role==='zhu'`（身份）+ `gameMode==='identity'`，不硬编码武将名。
4. **将驰禁杀同样约束替出杀**（服务端 + 机器人两侧都判，规则 26）。

## 简化/边界（镜像蛊惑先例，刻意不做）

- 护驾替出的闪不触发张角【雷击】（蛊惑同款跳过）
- 护驾/激将不影响 `g.shaUsed` 出杀次数（响应=打出非使用）
- 每回合限一次（`g.jijiangUsed`/`g.hujiaUsed`，startTurn 重置）——按用户任务规格的简版，非官方新版"每次需出均可发动"

## 回归

- 新增：`run_ai_lordskill_test.js` 28/28
- 既有：core 7/0、l3 138/0、l1 21/0、l2 23/0、c_window 34/0、info 16/0、model_picker 17/0、summary 13/0、timeout 8/0、identity 35/0、qinggangjian 6/0、lidian ALL PASSED、xuanfeng 5/0
- 已知既有失败（git stash 对比确认非本次回归）：fazheng 8/11（眩惑损坏）、cixiong 17/20
- `node --check` data/game/render/render-hand/render-controls/bot/bot-ai-bus/skills 全过

## 收尾

- progress-log 记录追加进 `docs/progress-log-8.md`
- commit `feat: B2a主公技(激将/护驾)` → HTTPS push `wenwen_dev`
