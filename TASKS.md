# TASKS.md — 三国杀项目进度

## 2026-08-28 — 按名称自动勾选 20B+ 模型

- [x] Phase 1/1：`modelSizeB` 从 id 抓 Nb；拉列表时并入 ≥20B；hydrate 保留 DEFAULT 或 ≥20B。compound 仍靠硬编码。cache-bust ai-bot 429。
- 验证：model_rotation 20/20。
- CI：picker 测「点 20B」变成取消勾选。改点 8B；确定后仍断言 20B 已自动勾。

## 2026-08-28 — 出杀预填朱雀/雌雄（一次 AI 调用）

- [x] Phase 1/3：spike 清单。可压朱雀/雌雄；青龙/贯石/寒冰等结算后不能压。
- [x] Phase 2/3：TDD RED — `run_sha_predeclare_test.js` 先红。
- [x] Phase 3/3：playCard 第5参 extra → shaInfo；预填跳过 Ask；流离透传 shaInfo；枚举拆候选；execute 传 extra。人类无 extra 仍问。cache-bust game 467 / sha 426 / weapons 418 / bot 452。
- 验证：sha predeclare 12/12；new equips 9/9；cixiong 20/20；core162 PASS；ai_bus_c 34/34。
- 未接：借刀/丈八/神速/青龙追加杀仍走旧 Ask。

## 2026-08-28 — CI 三红（推送后）

- [x] Phase 1/1：core135 牌堆 140 重打表；core142 雌雄卡图缩到 480×720；core77 刷新 game.js 快照。bot.js cache-bust 453。
- 验证：core135 23/23；core142 9/9；core77 12/12。

## 2026-08-28 — 藤甲/白银狮子/朱雀羽扇

- [x] Phase 1/2：TDD RED — `run_new_equips_test.js` 9 条先红。
- [x] Phase 2/2：EQUIPS + 牌堆；藤甲免疫普通杀/南蛮/万箭、火伤+1、青釭可破杀；白银狮子伤害>1改1、失去装备回1血；朱雀羽扇询问改火杀，机器人固定改。cache-bust data 454 / game 466 / sha 425 / weapons 417 / bot 451 / render 466 / controls 442 / stage 422 / registry 21。
- 验证：new equips 9/9；qinggangjian 6/6；skill-registry 20/20；pending renderer 190；cache-bust PASS。

## 2026-08-28 — 替换雌雄双股剑卡图

- [x] Phase 1/1：`assets/cards/cixiongshuanggujian.jpg` 换成用户提供的双剑图（JPEG 1280×1920）。路径/文件名不变。

## 2026-08-28 — #239+#240 第二次无懈 + 濒死只问能救的人

- [x] Phase 1/2：#239 CORE-180 — `normalize` 无懈缺 `asking` 不再写成 `-1`，重算 `nextWuxieAskee` 或进公共窗并打新 `askedAt`。
- [x] Phase 2/2：#240 CORE-181 — 连环濒死也走 `canRescueSeat`；无人可救时 `finishDying` 继续队列，不进 `dyingPublicWait`。cache-bust game.js 465。
- 验证：core180 3/3；core181 5/5；core155 5/5；cixiong 20/20；luoyi chain 6/6；cache-bust PASS。未提交。

## 2026-08-28 — 火攻禁自己 + 闪电免选目标

- [x] Phase 1/2：TDD RED — 火攻 `allowSelf`/`canTarget(自己)`/`playCard(自己)` 拒绝；闪电点击 `playCard(..., mySeat)`，对别人拒绝。
- [x] Phase 2/2：`CARD_PLAYS['火攻']` 去掉 allowSelf，canTarget 拒自己。`render-hand` onlySelf 延时锦囊点牌即对自己出；关羽闪电当杀仍走弹窗。cache-bust game 464 / render 465 / render-hand 413。
- 验证：huogong self-target 12/12；shandian skip target PASS；ai_bus_c 34/34；ai_bus_l2 24/24；cache-bust PASS。

## 2026-08-28 — CORE-179 特效视频改回全视口背景 + contain 黑边

- [x] Phase 1/2：`.fx-video` 去掉 auto/max-* 小窗，改 `width/height:100%` + `object-fit:contain` + `background:#000`。大厅 `#bgVideo` 不动。
- [x] Phase 2/2：测试口径改成全视口 contain 黑边，禁 max-width/max-height。跑 `run_core179_fx_video_fit_test.js`。
- 只改 `index.html` 一条 CSS + 测试文件。不改 `game-bg.js`、三条 video class。

## 2026-08-27 — #239 CORE-180 第二次无懈询问跳过

- [x] Phase 1/2：源码核 + 隔离复现。`asked[]` 在 `startTrick`/`aoeAdvance`/桃园/五谷都会重建；同回合两张无中生有、南蛮第二目标、第二次濒死，直接调入口都会再问。
- [x] Phase 2/2：起票 #239 CORE-180 [GAME][P1]。桃无同类 `asked[]` 跨窗，不另开票。可疑点：陈旧 `askedAt` 立刻超时、`asking=-1` 把本人按钮打掉。未改游戏代码。
- 下一步：真机/dump 钉现场后再修。

## 2026-08-27 — #240 CORE-181 别人濒死只有酒仍被问

- [x] Phase 1/1：用户确认「别人死的时候」。无连环时 `canRescueSeat` 对只有酒的旁人是 false，会跳过。连环 `chainDamageQueue` 非空时 `nextDyingAskee` 绕过过滤，救不了的人也会被问。起票 #240 CORE-181 [GAME][P2]。未改游戏代码。

## 2026-08-27 — #233+#238 动画哨兵重置 + 特效自适应

- [x] Phase 1/2：#233 CORE-174 — `resetRenderSentinels` / `resetTableSentinels` / `resetDiscardReveal`；`newGame`/`backToLobby` typeof 守卫调用。台面 seq 置 null（防吞首张飞牌），清 `#flyingCard`/`#targetLines`/`.damage-hit`/`#discardReveal`。不碰 recentPlaysHistory。
- [x] Phase 2/2：#238 CORE-179 — 三条特效 video 改 `.fx-video`（contain + max 90vw/80vh，z-index 1500）；大厅 `#bgVideo` 仍 `.bg-video` cover。cache-bust：room-lifecycle 427 / render 463 / table 414 / discard 413。
- 验证：core174 8/8；core179 4/4；movie fx 38/38；lightning 12/12；fx audio 3/3；discard reveal 17/17；cache-bust PASS。未关票（需你点头才关）。

## 2026-08-25 — 全库扫缺陷并起票

- [x] Phase 1/2：对照全部 GitHub Issues（开放仅 #196/#182 重构候选；CORE 已到 161）
- [x] Phase 2/2：源码核死后新建 5 票（未改游戏代码）
  - #221 CORE-162 [GAME][P1] 流离转移后酒杀 +1 丢失
  - #222 CORE-163 [AI][P1] 仁德身份局未做 helpful 硬过滤
  - #223 CORE-164 [AI][P2] 借刀/离间身份局阵营策略为空操作
  - #224 CORE-165 [AI][P2] 蛊惑固定发动未校验阵营可打性
  - #225 CORE-166 [UI][P2] 断粮/奇袭/铁索选目标未复用 canTarget
- [x] Phase 3/3：弱票/死路径也补齐新建 8 票（P3 按现优级不拔高）
  - #226 CORE-167 [GAME][P2] 强袭无目标可重试
  - #227 CORE-168 [GAME][P2] pendingHookQueue 覆盖
  - #228 CORE-169 [GAME][P3] 五谷 wugu 空数组误判
  - #229 CORE-170 [AI][P3] 神速硬编码
  - #230 CORE-171 [AI][P3] 明策硬编码
  - #231 CORE-172 [UI][P3] 弃牌二次点击
  - #232 CORE-173 [UI][P3] recentPlaysHistory 跨局残留
  - #233 CORE-174 [UI][P3] 动画哨兵跨局未重置
- [x] Phase 4/4：二轮深扫新建 3 票（高可信 P1）
  - #234 CORE-175 [GAME][P1] 强袭候选绕过空城/同疾/智迟
  - #235 CORE-176 [GAME][P1] 庞统连环绕过帷幕/智迟
  - #236 CORE-177 [UI][P1] 选将阶段日志泄露武将名 — 2026-08-25 复核：`respondPickGeneral:585` 已脱敏仅记“已选定武将”，不广播名；主公 `finishLordGeneralPick:517` 按设计立刻可见；仅 `debugPickGeneral:607` 特殊/调试通道会广播，已关票（not planned）
- [x] Phase 5/5：用户报障补 1 票
  - #237 CORE-178 [GAME][P1] 南蛮进行中夏侯惇刚烈扣血后未续回 aoe 队列
- [x] Phase 6/6：动画丢播修复
  - 队列化 `g.movieFxQueue`（`game.js:148-158/789-796` normalize + `markMovieFx` push 并同步 `g.lastMovieFx` 兼容既有断言；`checkWin` gameOver 追加入队不覆盖 `game.js:3985`）
  - 渲染 `render.js:741/817-855` `lastPlayedMovieFxLen` 游标逐条 `movieVideoKeyForMe→triggerMovieFx`，首条跳历史不整批吞；`index.html:2870-2878` `?v 459/461` cache-bust
  - 验证 `testclass/run_movie_fx_detect_test.js 34/34`，队列专项多死入队/gameOver追加/normalize首次跳历史均 PASS；`run_all_tests 148/151` 3 失败为基线既有（cixiong/core77），stash 回退同失败非回归
- [x] Phase 7/7：组队/乱斗结算补齐
  - 组队 `game.js:3936-3988` 新增 `winTeam/g.winSide='team:'+winTeam` + `res.teamWin/zuociLose/girlWin-girlLose(首个)` 并 `markMovieFx` 入队；乱斗 `game.js:4006-4042` 新增 `winnerSeat/res.girlWin` 入队；`render.js:793-817` gameOver 分派新增 `team/ffa` 本人 `kaixin/beitong` 与旁观后缀
  - 验证 `testclass/run_movie_fx_detect_test.js 38/38`（组队/乱斗各2条），`check_cache_bust.js` PASS
- [x] Phase 8/8：连环传导濒死修复
  - 根因 `game.js:4213` `nextDyingAskee/firstDyingAskee` 按 `canRescueSeat` 直接进 `dyingPublicWait` 吞掉 `g.chainDamageQueue`
  - 修复当 `g.chainDamageQueue` 非空绕过过滤 `return nextAskee / return dyingSeat`，保留逐个濒死询问
  - 验证 `run_cixiong 20/20` `run_movie_fx 38/38`
  - 归档 2026-08-26：`af923c6` 已合入（game.js +7 行），工作区干净无新增改动，`run_cixiong 20/20` 复核通过
- [x] Phase 9/9：CI `run_core77_replay_infra_test.js` 红
  - 根因：`af923c6` 改连环濒死步数（71→68 / 217→207），零行为比对快照过期；刷新快照后两边都写 `g.seed`，测试只删 `gNew.seed`
  - 修法：刷新 `core77_pre_change_*.snapshot`；比对两边都删 `seed`；展示层字段 `discardReveal*`/`lastDamageEffect`/`lastCardSound`/`lastSkillSound` 防御性剔除
  - 验证：`run_core77_replay_infra_test.js` 12/12

## 2026-08-25 — 关票规则补一条

- [x] Phase 1/1：`AGENTS.md` / `README.md` 追加：关票必须写理由与怎么修（或为何不改代码）

## 2026-08-25 — #214/#215 濒死跳过 + 日志脱敏 + 公共窗

- [x] Phase 1/3：无懈已有 `wuxiePublicWait` 1s；濒死仍问所有人；放弃日志带名字
- [x] Phase 2/3：TDD RED — 5 条先红（无人可救窗、跳过无桃、放弃脱敏、无懈 3s）
- [x] Phase 3/3：`canRescueSeat` + `dyingPublicWait` 4s；无懈窗 3s；放弃/询问日志脱敏。完杀测试补桃以免误进公共窗。`finishDying` 不把公共窗当成死后钩子
- [x] 验证：CORE-155 5/5；wuxie public；wansha 5/5；identity 35/35；core148；skill-registry；damage queue

## 2026-08-25 — #219 CORE-160 非身份局击杀摸两张

- [x] Phase 1/3：根因 — `applyIdentityKillReward` 首行 `gameMode!=='identity' return`，ffa/team 击杀无奖励
- [x] Phase 2/3：TDD RED — ffa/team 摸 2 两条先红；自杀/闪电/身份局对照已绿
- [x] Phase 3/3：ffa/team 杀手存活则 `drawN(2)` + 日志「击杀 X，摸两张牌」。旧「ffa 不奖惩」改成摸两张。cache-bust game.js 456→457。CORE-77 快照随规则变更刷新
- [x] 验证：`run_ffa_kill_reward_test.js` 7/7；identity 35/35；discard reveal 17/17；core77 12/12。全量曾 148/150：observability 看门狗 flaky（单跑 11/11）；core77 因击杀摸牌改步数，刷新基线后绿

## 2026-08-25 — #218 CORE-159 AI 天义发动-取消循环

- [x] Phase 1/4：根因 — 发动只看「其他存活有手牌」；`tianyiPickTarget` 经 `pickBestCandidateSeat` 被阵营滤空后 `cancelTianyi`；取消不置 `tianyiUsed` → 回到 play 再发动
- [x] Phase 2/4：对照 CORE-96 强袭/奋迅 — 发动前叠加 `botTargetPolicyAllows`
- [x] Phase 3/4：TDD RED — 忠臣对唯一主公仍发动；取消不标 used（4 红）
- [x] Phase 4/4：发动前叠 `botTargetPolicyAllows('harmful')`；`cancelTianyi` 置 `tianyiUsed=true`。cache-bust bot.js 446→447 / skills.js 426→427
- [x] 验证：CORE-159 8/8；part2/core90/core96 全绿；`node run_all_tests.js` 149/149（118.6s，含 soak）

## 2026-08-25 — #220 CORE-161 乱武误判零风险固定发动

- [x] Phase 1/4：根因 — `botTryStartExtraSkills` 把乱武当「对发动者零代价零风险」固定发动；`findNearestTargets` 含发动者本人，友方也会被逼出杀/掉血
- [x] Phase 2/4：对照乱击 `botAoeSelfRiskAllows`（CORE-97）——限定技要择机，不能只看可发动
- [x] Phase 3/4：TDD RED — `run_core161_luanwu_start_test.js` 先红（6 保留断言 + 缺评估函数）
- [x] Phase 4/4：`botShouldStartLuanwu` + `botLuanwuIsKnownAlly`（友方口径对齐乱击）；硬否决=友方致命/自己≤2血被瞄；正收益=非友方收割或 ≥2 人压到 ≤2 血。part2 旧「有人就发动」改成 1 血收割场面。cache-bust bot.js 445→446
- [x] 验证：CORE-161 13/13；part2 11/11；乱武最近目标/链条 12/12；`node run_all_tests.js` 148/148（119.3s，含 soak driver）

## 2026-08-25 — 批量修复 5 个 open issues（#214 #215 #216 #218 #219，已落地）

- [x] #214 CORE-155 濒死轮询跳过无桃玩家 + 1s 公共等待防时序泄露 — game.js 新增 `canRescueSeat`（桃/红牌急救/蛊惑/酒/酒诗）+ `nextDyingAskee` 叠加可救援过滤与完杀过滤；`startDying` 首问过滤＋无人可救进 `dyingPublicWait`（1s，仅“等待…”不写放弃）；`respondDying` 放弃日志仅当放弃者本身可救援时才写，全自动跳过完全静默；bot-ai-bus.js / stages/stage-table.js 接入 dyingPublicWait 超时；testclass/run_damage_effect_queue_test.js 放宽断言适配公共等待
- [x] #215 CORE-156 濒死/无懈「不出」日志泄露 — `respondDying`/`respondWuxie` 响应侧日志改为 `有人放弃响应`/`等待其他玩家响应…`（询问侧同脱敏，不暴露被问者身份）；AI prompt 不再泄露手牌持有信息；与 #205/214 联动
- [x] #216 CORE-157 顺手/拆桥玩家自选 — `resolveTrick` `optCount===0` 无效果、`optCount===1` 直接结算（免弹窗）、`optCount>1` 恢复 `pick` 待决由使用者自选：手牌为单一“随机手牌”选项（`pickResolve('hand')` 内随机，不指定具体哪一张）、装备/判定区逐件/逐张指定；bot.js `pickSlot` 保留供 AI 用；render-controls.js 恢复 pick UI（随机手牌 vs 指定装备/判定）；cache-bust game.js v457 / bot.js v446 / render-controls.js v440 等
- [x] #218 CORE-159 AI 太史慈天义循环 — bot.js `botTryStartExtraSkills` 天义分支前置 `botTargetPolicyAllows(...,'harmful')` 过滤；skills.js `cancelTianyi` 置 `g.tianyiUsed=true` 防无限发动-取消循环
- [x] #219 CORE-160 非身份局击杀摸两张 — `applyIdentityKillReward` 身份局分支外新增 ffa/team 分支：killer 存活、非自杀、来源合法 → `drawN(2)` + 日志「击杀 X，摸两张牌」
- [x] 验证：`node run_all_tests.js` 147/147（113s）；`run_damage_effect_queue_test.js` 29/29；动改文件 12 个（game/bot/skills/render/stages/index + 4 测试）

## 2026-08-24 — 拆桥/顺手取消选牌步骤（用户要求，已建 issue）

- [x] 建 issue：#216 CORE-157 [AI][P2] 多选项时不再开 pick 选牌阶段，直接自动结算，省一次 AI 决策调用（botDecide('pickSlot')）。未修代码，仅登记

## 2026-08-24 — 濒死/无懈两处手牌泄露 + 无桃轮询（用户报告，已建 issue）

- [x] 建 issue：#214 CORE-155 [GAME][P2] 濒死求桃轮询不跳过无桃玩家；#215 CORE-156 [GAME][P2] 「不出」日志向所有玩家及 AI 泄露手牌。两 issue 互 Related，并与 #205（CORE-148）关联。未修代码，仅登记

## 2026-08-24 — 非身份局击杀奖励：杀人摸两张牌（用户功能请求，非 issue）

- [x] Phase 1/1：`applyIdentityKillReward`（game.js）非身份局（ffa/team）且杀手存活时 `drawN(killerSeat,2)` + 日志「击杀 X，摸两张牌」；身份局原奖惩（杀反贼摸三、主杀忠弃牌）不动
- [x] 边界：无来源击杀（闪电，killerSeat 非数字）不摸；自杀/同归于尽（杀手已死）不摸
- [x] 测试：新增 `testclass/run_ffa_kill_reward_test.js` 7/7；`run_identity_mode_test.js` 旧「ffa 不奖惩」用例改为新规则 35/35；`run_movie_fx_detect_test.js` 23/23、`run_discard_reveal_test.js` 17/17 零回归

## 2026-08-21 — mp4 要声音 + 结算动画从未出现

- [x] Phase 1/3：根因 — `checkWin` 写 `lastMovieFx.seat=null`，Firebase RTDB 丢 null 键，`normalize` 把 `seat===undefined` 当非法整条清掉。死亡/闪电有整数 seat，所以能播。
- [x] Phase 2/3：TDD 修 normalize（缺 seat 当 null，保留 gameOver）。`run_movie_fx_detect_test.js` 23/23
- [x] Phase 3/3：`unmuteBgVideo` 解锁大厅+死亡+闪电+过场；`applyFxAudio` 播放时保持有声。`run_fx_video_audio_test.js` 3/3。cache-bust game.js v435 / game-bg.js v8
- [x] 结算片看不见：三条特效 video 移出 `#game`（不再当 grid item 被座位卡盖住），`z-index:1500`
- [x] 按用户：结算和闪电同一背景层（撤回 overlay，video 放回 `#game` 内、`.bg-video` z-index:0）

## 2026-08-21 — 盘点库内动画触发（用户问答，无代码改动）

- [x] 核对 CSS `@keyframes` + 全屏视频 + 飞牌/连线：全部有活触发点，无死 CSS
- [x] 记录过滤条件：seq 首次不补播、死亡视频仅自己、过场按座位/身份分派、内奸无结算片、弃牌展示只走 `markDiscardReveal`
- [x] 无声原因：房内垫底是 Canvas 飘牌无音轨；死亡/闪电/过场 `<video muted>` 且无 unmute（大厅 `#bgVideo` 才在首次手势取消静音）
- [x] 结算分派：仅身份局 `checkWin` 写 `gameOver`；主/忠赢不播；内奸永不播；左慈所在阵营输优先 `zuoci1`

## 2026-08-20 — AI 自定义 BaseURL（用户功能请求，非 issue）

- [x] 新增 `AI_BASEURL_STORAGE_KEY='sgsAiBaseUrl'` + `aiBaseUrl` 变量，`hydrate/persist` 同生命周期 sessionStorage，trim、空串移除
- [x] 弹窗 `showAiKeyModal` 在密钥输入框后新增“自定义 BaseURL（可选）”输入框 `aiBaseUrlInput`，placeholder `https://api.openai.com/v1/chat/completions`，留空走默认，`input/blur` 实时 trim 持久化，不强制随密钥清空
- [x] 网络层 `resolveAiEndpoint` / `resolveAiModelsUrl` 纯函数：非空且 `http(s)://` 才覆盖，已含 `/chat/completions`/`/v1/messages`/`/v1/models` 直接返回，否则按 provider 拼后缀（Claude→`/v1/messages`，其余→`/v1/chat/completions`；models 对称）；`callAI` 中 `buildRequest` 后若有 customEndpoint 则 `req.url` 覆盖（tri 分发后子 provider 同样受覆盖）；`fetchProviderModels` 用派生 `fetchUrl`，自定义时跳过缓存且不写入缓存，失败回退静态表 `AI_MODEL_OPTIONS`
- [x] 常驻按钮 `renderAiStatusButton` 追加 `(自定义地址)` 提示；不改 `detectAiProvider` 任何逻辑（无填走现有前缀匹配）
- [x] 验证：`node -c ai-bot.js` / `bot-ai-bus.js` 通过；diff 1 文件 94 行新增；`aiBaseUrl` 持久化/弹窗/覆盖链路 grep 全命中

## 2026-08-17 — 闪电判定全屏动画（用户功能请求，非 issue）

- [x] 定位：触发点 = `DELAY_TRICKS['闪电'].effect`（data.js），判定中/不中分别写 `g.lastLightningFx` 事件字段（`hit:true/false`，seq 去重，模仿 `g.lastDamageEffect` 模式）
- [x] 播放：game-bg.js 新增 `triggerLightningFx(hit)`——未劈中播 `assets/video/flash0.mp4`、劈中播 `assets/video/flash1.mp4`（素材用户已放入），全屏播放完毕隐藏；`hideDeathFxVideo/bindDeathFxVideo` 泛化为通用 `hideFxVideo/bindFxVideo`
- [x] 检测：render.js 哨兵 `lastLightningFxSeq` + `maybePlayLightningFx(g)`（首次不补放历史），index.html 新增 `#lightningFxVideo` 元素
- [x] 防御：game.js normalize 补 `g.lastLightningFx`（undefined→null / 格式非法→null）
- [x] 测试：testclass/run_lightning_fx_detect_test.js 12 项全绿；run_core77_replay_infra_test.js 比对新字段白名单（同 `g.seed` 先例）；全量 102/102 通过；cache-bust：data.js v401 / game.js v430 / render.js v409 / game-bg.js v5

## 2026-08-17 — 过场动画（于吉/左慈/内奸胜，用户功能请求，非 issue）

- [x] 事件字段 `g.lastMovieFx={seq,kind,seat}`（game.js `markMovieFx` helper，seq 去重只留最新）
- [x] 写入端：`finishDying` 死亡分支——于吉死→`yujiDeath`(死者座位)、左慈死→`zuociDeath`(杀手座位)、杀手是于吉→`yujiKill`(于吉座位)；`checkWin` 身份局结束——左慈玩家 role 不在赢方集合→`zuociLose`(左慈座位，winSide='none' 全员输)、`winSide==='nei'`→`neiWin`（后写优先生效）
- [x] 前端过滤（render.js `maybePlayMovieFx` 哨兵）：yujiDeath 非于吉玩家播 `yuji1.mp4`；yujiKill 非于吉且存活播 `yuji0.mp4`；zuociDeath 仅杀手播 `zuoci0.mp4`；zuociLose 仅左慈玩家播 `zuoci1.mp4`；neiWin 主公/忠臣播 `han.mp4`（素材用户已放入 assets/video/）
- [x] 防御：game.js normalize 补 `g.lastMovieFx`；core77 白名单补字段；测试 testclass/run_movie_fx_detect_test.js 19 项全绿；全量 103/103 通过；cache-bust：game.js v431 / render.js v410 / game-bg.js v6
- [x] 已提交并推送：`0d86b83 feat(ui): 全屏特效动画——闪电判定与武将过场(于吉/左慈/内奸胜)`（15 文件含 7 个素材 + 2 个测试）

## 2026-08-17 — 结算阵营动画（用户功能请求，非 issue）

- [x] 结算事件升级为 `gameOver` 结果表 `{fan,lord,zhong,zuociLose}`（checkWin 身份局结束写），前端按身份分派：反贼输播 `fanze-lost.mp4` / 反贼胜播 `fanzei-win.mp4` / 主公输播 `zhuzhong-lost.mp4` / 忠臣输播 `han.mp4`；左慈所在阵营输播 `zuoci1.mp4`（最优先）
- [x] 优先级：左慈 > 于吉 > 阵营统一动画（用户指定）——finishDying 死亡事件按序覆盖（zuociDeath 最后写）；gameOver 前端分派左慈优先
- [x] 替换旧规则：`neiWin`（内奸胜→主公忠臣都播 han）移除，由 gameOver 表覆盖（内奸胜时主公播 zhuzhong-lost、忠臣播 han）；`zuociLose` 并入结果表
- [x] markMovieFx 支持 result 参数；normalize 校验 result；MOVIE_VIDEOS 加 fanLose/fanWin/lordLose/zhongLose（删 neiWin）；测试 run_movie_fx_detect_test.js 22 项全绿；全量 103/103 通过；cache-bust：game.js v432 / render.js v411 / game-bg.js v7

## 2026-08-16 本地同步记录

- 本地 main 快进至 origin/main（4381d5e，与远程 SHA 一致）——CORE-72~78 均已在远程实现并同步到本地：CORE-72 决策流水移出 debugLogs（#117）、CORE-73/74 AI 决策面板+统一采集（#118/#119）、CORE-75 下载导出（#120）、CORE-76 token/提交结果（#121）、CORE-77 确定性重放一期（#122）、CORE-78 技能注册表一期（#123）、CORE-115 身份标记（#115）
- 已确认的进行中缺陷：#130 [AI][P1] 游戏结束后 `syncAiTestGamePhase` 清空 aiDecisionRecords → 🧠 面板/导出空（根因已锁定，待修复）

## 阶段总览（批量计划：docs/superpowers/plans/2026-08-03-big-batch.md）

- [x] 批1：D2 bot-ai-bus.js 拆分 + D3 AI_DEFAULT_MODEL 单源
- [x] 批2：A1 响应超时托管 + A2 断线重连验证
- [-] 批3：B2 主公技（四主公技拆两步：B2a 激将/护驾 ✅；制霸/妄尊 待做）
- [ ] 批4：D4 响应阶段 UI 回归 + D1 真机验证

## Phase 3/4 — B2 主公技

- [x] B2a：刘备【激将】+ 曹操【护驾】——身份局主公需出杀/闪时求助其他角色替出，无人替回原 pending。caps 声明 + role 守卫，机器人 BOT_PHASE_ACTOR/BOT_DECISIONS/EXCLUDE/超时保守表全接入，28 项测试全绿，`?v=303`，已 push（wenwen_dev）
- [x] B2b：孙策【制霸】（出牌阶段限一次拼点）+ 袁术【妄尊】（主公准备阶段摸牌/主公手牌上限-1）——hasCap+role 守卫、`handCapLimit` 统一弃牌上限、机器人 BOT_PHASE_ACTOR/BOT_DECISIONS/EXCLUDE/BOT_SEAT_PICKS/超时保守表全接入，45 项测试全绿，`?v=304`，已 push（wenwen_dev）

## Phase 4/4 — 提示词增强 P1（G1 通用策略 + G3 score 语义）

- [x] P1：`buildBotDefaultSystemPrompt` 追加通用策略（体力/手牌价值、防御牌留关键、不裸拼）、`buildBotDefaultUserPrompt` 条件拼接 score 语义说明——core 测试 +3 项（10 全绿），`?v=305`，已 push（wenwen_dev）

## 下一步（待定）

- [ ] 批4：D4 响应阶段 UI 回归 + D1 真机多浏览器联机验证（含主公技）

## 当前 — Issue 批量修复（8 个 open issues，2026-08-13）

- [x] #97 [GAME][P1] 顺手牵羊/过河拆桥 缺目标有牌校验（CORE-62）——game.js 新增统一 helper `hasTargetCard`（手牌+装备区+判定区），顺手牵羊/过河拆桥 canTarget 与 skills.js 奇袭复用同一口径；空目标被拒、仅手牌/仅装备/仅判定区合法。新增 run_shunshou_guohai_target_test.js 16 项全绿。连带对齐：run_ai_bus_l3_test.js 蛊惑声明过河拆桥用例、run_ai_bus_c_window_test.js T2 截断用例补目标手牌
- [x] #99 [GAME][P1] 火攻 缺 allowSelf 自选目标支持（CORE-64）——game.js CARD_PLAYS['火攻'] 补 allowSelf:true；canTarget 自用分支排除正在使用的实体火攻本体再数手牌，只剩这一张火攻时不可对己使用。新增 run_huogong_selftarget_test.js 12 项全绿
- [x] #98 [GAME][P1] 借刀杀人 第二目标绕过杀目标合法性（CORE-63）——skills.js jieDaoShaRen 与 guhuoChooseJiedaoTarget 统一复用 CARD_PLAYS['杀'].canTarget（ignoreShaDistance，距离另行按 A 攻击范围校验），B 受空城/智迟/同疾/多名同疾限制，不读使用者 mySeat 或天义/将驰临时状态。新增 run_jiedao_target_matrix_test.js 20 项全绿
- [x] #103 [GAME][P1] 连营 只接入少数手牌移除路径（CORE-67）——game.js 新增统一 helper `removeHandCards(g, seat, indices)` 内部触发 maybeStartLianying；maybeStartLianying 条件放宽为"失去后手牌为0"（支持一次失去多张到0只触发一次）；game.js/skills.js/sha/sha-resolution.js/weapons.js 全部 hand 移除调用点收敛到 helper。新增 run_lianying_all_paths_test.js 22 项全绿
- [x] #100 [GAME][P1] 左慈化身 好施 被拆两个条目（CORE-65）——HUASHEN_SKILL_TABLE.lusu 好施合并为单条目捆绑 caps:['haoshi','extraDrawPhase']（仿凌统旋风），删除"好施(额外摸牌)"；新增 run_huashen_haoshi_test.js 8 项全绿，luxun/identity/ai_timeout/xuanfeng/damage_effect_queue 回归全过
- [x] #102 [UI][P2] 谦逊目标在选目标界面仍可点击（CORE-66）——render.js 普通单目标牌 targetable 追加业务层 selSpec.canTarget 约束（新增 singleTargetCanTarget helper，传参语义对齐蛊惑/双雄/武圣），顺手牵羊/乐不思蜀/国色转化乐不思蜀均不可点谦逊角色；国色选目标块同样复用 CARD_PLAYS['乐不思蜀'].canTarget。新增 run_qianxun_target_ui_test.js 11 项全绿，render.js ?v=400→401
- [x] #101 [UI][P3] 调试武将下拉框未排序（CORE-66）——render-controls.js 调试选将下拉框先按 gen.name 字符串升序 .slice().sort() 再生成 option，只影响该调试入口，GENERAL_IDS 本体及其它调用点不动。新增 run_debug_general_sort_test.js 6 项全绿，render-controls.js ?v=414→415
- [x] #96 [UI][P3] 测试文件移入 testclass/（CORE-61）——79 个 run_*.js 全部迁入 testclass/（git mv 保留跟踪）；run_all_tests.js 聚合目录改为 testclass/，cwd 保持根目录使裸文件名加载继续生效；8 个 __dirname 拼接类测试改 ROOT=path.join(__dirname,'..')，run_guidu_nested_tx_fix_test.js 的 require 改 '../test-tx-stub'；workflow 无需改。全量 79 passed 0 failed 与迁移前一致
- [x] #105 [GAME][P1] 无懈窗口从不问有蛊惑无真牌的于吉（CORE-xx）——game.js `nextWuxieAskee` 的 `canWuxie` 扩展为"真实持有【无懈可击】或拥有蛊惑且本回合未用（hasCap(p,'guhuo') && !g.guhuoUsed，hasCap 已覆盖左慈化身/新生借用；手牌非空才可扣置，避免空手空问）"；守卫与 canStartGuhuoResponse 对齐（wuxie 角色无 faceup 要求，phase/pending/asking 条件由调用点天然满足）；不破坏 #67 快速跳过（无人值得问仍进 wuxiePublicWait 公共窗口）。响应端 skills.js startGuhuoResponse→resolveGuhuoResponseWuxie 链路已就绪，无需改动。新增 run_guhuo_wuxie_ask_test.js 9 断言全绿（含端到端：蛊惑无懈抵消无中生有）；wuxie 相关 + 全量 80 个既有测试全绿；game.js ?v=422→423
- [x] #104 [GAME][P2] 开局座位号完全由加入顺序决定（CORE-xx）——①joinRoom 首个加入者打 `owner:true` 标记（稳定标识，重排后仍识别房主）；②startGame 事务内 `shuffleSeats` 随机重排 g.players（降序 Fisher-Yates，只动顺序不动对象引用，cid/owner/team/role 原样保留，各客户端靠 render 按 cid 重定位 mySeat 自动同步）；③isRoomOwner 改为按 owner 标记判定，不再硬编码座位 0（含 isBot 防御）；ai-bot.js/render-controls.js 的 `mySeat===0` 判定全部收敛到 isRoomOwner。新增 run_seat_shuffle_test.js 16 断言全绿。**部署兼容补充**：新增 `ensureOwner` 迁移——修复前创建的房间 players 无 owner 标记、isRoomOwner 全员 false 导致存量房间僵死，任一事务发现无人持有 owner 时把第一个非 bot 玩家补记为 owner（老房间从未重排，数组首位即原房主），随事务写回持久化；5 个调用点（joinRoom 刷新/重进、startGame、addBot、removeBot、newGame 各守卫之前）；run_seat_shuffle_test.js 补 Task E 单测 5 断言 + Task F 老房间集成 1 断言（22 全绿）；run_new_game_player_reset_test.js 补 ensureOwner stub（该测试切片不含新函数）；room-lifecycle.js ?v=401→402、game.js ?v=423→424、ai-bot.js ?v=395→396、render-controls.js ?v=416→417

### 验证

- Oracle 代码审查：70 处 removeHandCards 收敛语义等价核对全部通过；借刀 me 传 A + ignoreShaDistance 传参正确；火攻实体引用排除正确；render 追加约束只收窄不放宽
- 审查后补齐 4 处真实漏收敛（司马懿反馈、英魂、烈刃拼点×2、烈刃获得）→ run_lianying_all_paths_test.js 36 断言全绿
- 全量 `node run_all_tests.js`：79/79 通过（约 83s）
- 已知限制（Oracle 建议后置，另行 issue）：制衡失去后连营询问时机在摸牌后（可接受）；#100 旧 huashenSkillName 无迁移；顺手/拆桥距离用全局 mySeat（当前调用点均相等）；render inRange 天义/将驰豁免缺口（既有问题）

## 当前 — 调试日志 / AI 决策可观测性（2026-08-16 新建 4 个 open issues）

- [ ] #117 [AI][P2] 调试日志混入 AI 正常决策流水（bot_decision_trace）——#109 引入的决策流水在配置 AI 密钥时每次成功决策都写 debugLogs，违背"只在异常时写"的设计原则；真实案例 2026-08-15 23:49:11 正常决策"断粮→机器人5"被记录。方向：source=llm 正常流水不进 debugLogs，保留 ai_response_unusable/ai_call_failed/ai_lock_stuck 等异常类
- [ ] #118 [UI][P2] 托管按钮（#aiTestBtn，top:64 left:64）正上方新增 AI 决策查看按钮——面板逐条显示每台 AI 决策理由/武将名/模型名；采集需从"仅托管命中"扩展到所有 AI 决策（callAiChooseIndex 唯一收敛点），补记武将名/模型名
- [ ] #119 [UI][P3] AI 托管信息窗每条记录追加显示本次实际使用的 AI 模型名（现 recordDetailHtml 无模型字段，模型轮换池 aiApiModels 场景无法分辨）
- [ ] #120 [UI][P2] #118 决策面板追加下载按钮——导出本局全部 pushLog + AI 决策（理由/武将名/模型名/prompt/rawResponse/choice/reason）+ 对局元信息，JSON 下载，供测试/调查/复现；不写 debugLogs
- 配套关系：#117 把正常决策流水从 debugLogs 移出 ↔ #118/#120 用决策面板+导出承接流水数据；#119 为 #118 的模型名采集打基础

## 当前 — 外部项目借鉴方向（2026-08-16 新建 3 个 open issues，CORE-76~78）

调研了两个外部三国杀项目后整理的三个可借鉴方向（issue 内容已脱敏，不含外部项目名）。用户已明确排除"AI 解析失败重问（修正请求）"机制，不在任何 issue 内。

- [ ] #121 [AI][P2] AI 决策全链路日志（CORE-76）——决策记录补齐 token 消耗（usage）+ 提交结果环节（成功/被拒/超时）；复用 #118 面板/#120 导出的采集链路；提交结果优先复用 botInvoke 状态对比套路与 onCommitted 真实回调。Related: #117 #119 #120
- [ ] #122 [GAME][P2] 对局确定性重放（CORE-77）——随机数种子化（可播种 PRNG 收敛单入口，开局记 seed）+ 命令日志（tx() 提交处记命令不记快照）+ 沙箱重放器；分期落地，一期只记录不动行为；直接落地 issue #108 的痛点。Related: #108
- [ ] #123 [GAME][P2] 技能数据驱动化（CORE-78）——技能注册表（触发时机/条件/效果引用/机器人决策接入点），hasCap 体系演进为查表；中文单文件；长线重构，分期：注册表骨架 → normalize 105 处校验收敛 → 机器人接入点收敛；每期全量测试全绿

## 当前 — 既有 open issues 回顾

- #115 [UI][P2] 身份标记功能（忠/反/内猜测标记）；#116 [AI][P1] 刘备仁德给牌后永久卡死（新出现，未处理）；#111/#110 待办（死亡特效动画缺失、XSS 审计）
- #126 [UI][P2] 玩家名颜色 NAME_COLORS 内部接近色对（CORE-79）——8 色方案中 #B8A22F（暗金黄）vs #C4C44F（黄绿）色相差极小（截图实证「撒撒」/「机器人5」同显黄色系），#2FBF71（绿）vs #4FA8A8（青）、#C4519B（玫红）vs #D9713C（橙）亦偏近；修复方向：色相环均匀分布 8 色、同色系只留一色、避开势力色新撞色（progress-log-4 结论），seatColor 接口不变；2026-08-16 已建
- #127 [UI][P2] 游戏结束时不揭示所有玩家身份（CORE-80）——dump 实证（房间666 反贼胜）：结束仅"胜方：反贼"，撒撒/Q/机器人1/机器人5 身份全程未显示；players 无 role 字段展示
- #128 [GAME][P2] game.over=false 与 phase="over" 不一致（CORE-81）——dump 实证：winner 已定、log 已结束，但 over 字段仍 false，依赖 over 的边界逻辑（结算/清房/重开）会误判
- #129 [AI][P2] 机器人4 连弩+酒不出杀（CORE-82）——dump 实证：seq 341-342 装连弩+用酒后直接过回合；aiDecisions 为空无法定位根因，待 #118/#121 决策日志落地后复盘；先登记现象
- 附件说明：3 个 issue 的分析已写入正文，对局 dump（sgs-dump-666-2026-08-16T03-33-47-042Z.json）需网页端手动拖拽上传（GitHub 无公开附件上传 API）
- #130 [AI][P1] AI 决策面板/导出在游戏结束后无记录（CORE-83）——根因：`syncAiTestGamePhase`（ai-bot.js:1616）在 phase='over' 时 `clearAiTestRecords()` 清空 aiDecisionRecords；CORE-73/75 把该数组升级为本局决策存档+导出数据源后未同步调整清空时机。用户实测：🧠 面板空 + dump `aiDecisions: []`（sgs-dump-666）。修复方向：清空改到新局开始，结束仅停托管。Related: #118 #120
- #131 [UI][P2] 身份标记重开后仅房主被清空（CORE-84）——根因：标记存 localStorage（identityMark:&lt;roomId&gt;:&lt;seat&gt;），"再来一局"按钮仅房主可见（render-controls.js:1717 isRoomOwner 守卫），`newGame()` 的 `clearAllIdentityMarks()`（room-lifecycle.js:600）只清房主自己浏览器，其他玩家旧标记残留新局重现。修复方向 A：key 加局标识（推荐）/ B：渲染按局过滤 / C：非房主检测房间重置也清。Related: #115
- #132 [UI][P2] 聊天框说话者跨局后错乱（CORE-85）——根因：`chatSenderLabel`（render-log.js:338）优先取当前局 `g.players[msg.seat]` 的名字/武将，消息自带快照 `msg.playerName`/`msg.general`（pushChatMessage :354 已存）仅兜底；聊天消息跨局保留 + #104 洗座使座位-玩家映射改变 → 旧消息错标。修复方向：快照优先。Related: #104
- #133 [UI][P2] 完成平板端界面适配（CORE-86）——现状：平板（768~1366px 触屏）落在手机紧凑档（≤640/520px）与桌面档（≥1200px+精确指针）之间的空白区；①平板竖屏被 `#landscapeGate`（isPortrait 无条件）强制横屏遮罩挡死 ②平板横屏套基础横屏规则未针对大触屏优化（iPad Pro 1366px 座位卡过大/触控目标未适配）。方向：竖屏加设备条件或拍板维持提示横屏；补 `(min-width:768px) and (pointer:coarse)` 平板触屏档；真机验证
- #134 [AI][P2] 确定正收益技能改为固定发动（CORE-87）——目标省 token：`callAiChooseIndex` 多候选才调 LLM（1500-2000 tokens/次）、单候选零 token；项目已有固定发动先例（闭月/不屈/称象/连营/忘隙/装备特效/雷击，见 bot-skill-coverage-audit）。方向：审计全部技能决策点，零下行风险纯收益 → 收敛固定发动；守青龙偃月刀教训（先探测再固定，禁无脑套）；改动前后 token 量化对比
- #135 [GAME][P2] 酒杀被闪抵消后发动贯石斧只造成1点伤害（CORE-88）——根因：`finishGuanshiDamage`（weapons.js:332）`damageAmount(g, from, 1, 'sha')` 未传 options 致 `options.jiuBonus` 分支（game.js:874）永不触发；`maybeStartGuanshifu` 也不保存 jiuBonus（对比 `maybeStartCixiong` weapons.js:349 正确透传）。修复：maybeStartGuanshifu 存 jiuBonus + finishGuanshiDamage 传 `{jiuBonus:!!g.pending.jiuBonus}`；正常杀路径（sha-resolution.js:541）对照无误
