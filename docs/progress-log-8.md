# Progress Log 8（2026-08-03 起）

> 本文件按 CLAUDE.md 防复发规则块维护：CLAUDE.md 本体只记架构约定变化，任务改动记录一律写进
> `docs/progress-log-N.md` 当前最新分段。当前分段=本文件（progress-log-7 已达 157KB>150KB，新建 8）。

## 强C 出牌窗同窗多步循环（SC1+SC2，SDD 计划「2026-08-03-ai-strong-c-and-info-layer」Part A 两批）

- **SC1（补记，commit `8ddc4de`，此前漏记）——tx/playCard/endPlay 可选提交回调（game.js）**：
  `tx(fn, onCommitted?)` 新增可选第二参数——Firebase transaction 返回 Promise（真实 SDK 行为）时，
  resolve 后把提交成功的快照 g 交给 onCommitted（`res.snapshot.val()`；reject 分支 `onCommitted(null)`）。
  `playCard(cardIdx, actionId, targetSeat, onCommitted?)` / `endPlay(onCommitted?)` 把回调透传给内部 tx。
  不传 onCommitted 时行为与改动前逐字一致（fire-and-forget，返回值被忽略）；vm stub 若不返回 thenable
  则回调分支不触发、零影响。这条 seam 是 C1 弱C探测结论（tx fire-and-forget、currentG 不同 tick 更新、
  强C同窗多步不可行）的**推翻前提**——有了提交回调，execute 后能拿到新快照，循环体重枚举读到的就是
  最新状态，强C 才成立。测试：`run_ai_bus_c_window_test.js` 新增 T13~T16（tx 带回调收快照含变更/不带
  回调无异常/playCard 快照手牌已出桃体力+1/endPlay 快照 phase 推进到 discard）。`index.html` `?v=` 278→279。
- **SC2（本条）——runBotActionWindow 升级为强C循环 + executePlayWindowChoiceAwait（bot.js）**：
  - **`executePlayWindowChoiceAwait(g, seat, choice)`** → `Promise<newG|null>`：包一层 Promise，`botInvoke`
    内调 `playCard(..., onCommitted)` / `endPlay(onCommitted)`，resolve 提交回调给的快照；等不到回调时
    `BOT_COMMIT_TIMEOUT_MS`（**let 不是 const**，测试可裸标识符赋值覆盖缩小）超时 resolve null，防
    stub/异常环境挂死。settled 标志保证 onCommitted 与超时只结算一次。
  - **`runBotActionWindow` 循环升级**：`aiReady`（有密钥有 provider）一次算好；`lastG` 初始取
    `currentG || g`；`while(steps < BOT_WINDOW_MAX_STEPS)` 每轮：`isBotActionWindow(lastG,seat)` 失效
    break → `enumerateAllLegalOneStepActions` 重枚举（快照驱动，读到的就是上一步提交后的状态）→
    AI 询问（`state.windowStep = steps`，系统提示改为"同一出牌窗口的连续决策…局面已经变化,根据最新
    局面继续选择"）或单候选短路/本地兜底 → `await executePlayWindowChoiceAwait` → `steps++` →
    isEndPlay break → **无密钥 `return`（弱C逐字：执行一步即回，不等待提交、不循环）** → `newG===null
    || newG===lastG` break（提交失败/快照未变）→ `lastG = newG`。循环退出条件五类：结束出牌/步数上限
    8/窗口失效（turn 变、pending 出现、阵亡）/提交失败/无密钥一步。
  - **关键实现/测试洞察（写给后续任务）**：`stripUndefined` 是**原地修改返回同一引用**——stub 默认快照
    （=tx fn 返回值）=同一个可变对象，配合 `newG===lastG` break 会**永远在第二步前断掉**；测试必须让
    每次提交产出**新引用**快照（JSON 深拷贝演化态），否则强C两步测试根本走不完。测试用 smart spy
    （playCard spy 手动演化 `__simG` 闭包 + 深拷贝后调 onCommitted），刻意不依赖真实锦囊效果/无懈/pick
    机制——过河拆桥真实结算会开无懈 pending，窗口立即失效，两步必然断在第一步。
  - **vm 沙箱坑**：`vm.createContext` 的沙箱**默认没有裸 `setTimeout`/`clearTimeout`**（只有显式注入的
    `window.setTimeout`）——新代码用裸标识符，c_window/l2 两个测试的 context 都要补顶层
    `setTimeout/clearTimeout` wrapper（l2 的两个"闪电/铁索连环候选"测试真实走到 runBotActionWindow，
    不补直接 ReferenceError；l1/l3 因 spy/不触达没踩到）。
  - **测试**（`run_ai_bus_c_window_test.js` 15→25，TDD RED→GREEN）：①强C两步——g1 手牌
    [过河拆桥,杀]、座位1装 +1马（初始 杀→1 距离2>射程1 非法），smart spy 每次提交演化（拆桥=摘牌+拆马；
    杀=摘牌）→ 一次 `runBotActionWindow(g1,0)` 内 playCard 恰 2 次（拆桥→杀→1）、AI 询问 2 次且
    userPrompt 含 `"windowStep":0`/`"windowStep":1`、打空后自然走到结束出牌 1 次 endPlay；②endPlay
    终止——mock 选结束 → endPlay 恰 1 次、playCard 0 次、AI 只问 1 次（不再枚举）；③快照失效——提交
    回调快照 turn=1 → 第 2 步窗口失效 break，playCard 恰 1 次；④提交失败——真实 playCard + stub
    `transaction` 返回 `Promise.reject` → tx rejection 分支 `onCommitted(null)` → break 不挂死（RED 阶段
    旧 executePlayWindowChoice 不传回调，此处会 unhandled rejection 直接杀掉进程，GREEN 后消失——这本身
    证明回调 seam 是必需的）；⑤无密钥——`aiApiKey=''` 只执行一步（fallback 桃），playCard 恰 1 次、
    AI 0 次、循环不继续；⑥maxSteps——AI 永不选结束、快照持续有效 → 恰 8 次 playCard / 8 次 AI 后停。
  - **回归**：c_window 25/0、core 7/0、info 5/0、l1 8/0、l2 23/0（**修了 2 个沙箱缺 setTimeout 的失败**）、
    l3 93/0、model_picker 13/0；`node --check bot.js` 通过（node v20.14.0）。
  - **改动范围**：`bot.js`（`executePlayWindowChoice` → `executePlayWindowChoiceAwait`，
    `runBotActionWindow` 循环升级，`BOT_COMMIT_TIMEOUT_MS` 新增，弱C探测注释改写为强C语义）；
    `run_ai_bus_c_window_test.js`（+10 项、context 补裸 setTimeout、保存 `__realPlayCard` 供提交失败测试）；
    `run_ai_bus_l2_test.js`（context 补裸 setTimeout）；`index.html` `?v=` 279→280 共 13 处。`game.js`
    零改动（SC1 已带回调）。`normalize` 无需改（纯客户端模块级函数/常量，不进 `g`）。
- **commit**：`feat(bot): 强C同窗多步循环(有密钥)+提交回调等待`（wenwen_dev，1cec383）。
- **遗留（刻意不处理，记录在案）**：①无密钥路径仍会 `await executePlayWindowChoiceAwait`（等 onCommitted
  或 5s 超时）后才 return——语义与弱C一致（执行一步），只是多一次超时兜底等待；真实环境 playCard 的
  tx 回调总会触发，超时几乎不会真的走到，但 stub/异常环境最多拖 5s，可接受；②强C 只覆盖出牌窗
  （`runBotActionWindow`），响应类一步决策点维持单步，不扩展回调到 30+ 个 respond 函数（计划既定边界）。

## 信息层五项字段（I1+I2，SDD 计划「2026-08-03-ai-strong-c-and-info-layer」Part B 两批）

- **I1（commit `703ecc8`）——弃牌堆/牌堆剩余/攻击射程（bot.js `buildBotVisibleState`）**：
  ①`discardPile`：弃牌堆是公开信息（桌面展示），投影 `{count, byName}`——count 总张数、byName 按牌名
  计数（含同名多张），`(g.discard||[])` 防空；②`deckLeft`：牌堆剩余张数（牌堆背面可见，张数人人知道），
  `(g.deck||[]).length`；③`myAttackRange`：自己的攻击射程，读武器槽 `getEquip().range`、无武器/无 range
  回退 1——只投影自己，和 `distance` 已有投影配套。全部只读公开信息，不进 Firebase、不动 game.js。
- **I2（本条）——desc 全量 + recentLog 20 条（bot.js `buildBotVisibleState`）**：
  - **`generalDesc` 去截断**：`String(GENERALS[p.general].desc||'').slice(0,120)` → 全量
    `String(GENERALS[p.general].desc||'')`，顺带把守卫从 `GENERALS &&` 加强为
    `typeof GENERALS!=='undefined' &&`（和规则 24 的裸标识符纪律一致，防未加载 data.js 时 ReferenceError）。
    token 预算：全量 desc 通常 30-80 字/将，7 人局 ~7×80=560 字 ≈150 tokens，可接受（规格 B2.4 已评估）。
  - **`recentLog` 10→20 条**：`slice(-10)` → `slice(-20)`。这是对规格早期草案"按 round 聚类"的简化修正：
    `g.log` 条目是 `{seq, text}`、**没有 roundNum 字段**——强行聚类要么改 log 结构（进 Firebase，需
    normalize 防御，收益低）要么按 seq 猜（不可靠），故只扩条数（~20×15 字 ≈300 字 ≈80 tokens），覆盖
    约 1-2 回合、零结构改动。注释同步更新。
  - **测试（`run_ai_bus_info_test.js` 8→10，TDD RED→GREEN）**：①新增"desc 超120字仍全量"——沙箱内
    临时改 `GENERALS['guojia'].desc` 为 156 字长文（try/finally 恢复），断言
    `generalDesc === 长文全文` 且 JSON 里出现尾部 20 字；RED 阶段旧 slice(0,120) 输出 120 字即失败；
    ②`recentLog` 30 条日志 → 长度 20、首项 日志11/末项 日志30 对齐；RED 阶段输出 10 条失败；
    ③**规则 20 修正旧断言**：原"desc 应截断到120"（`gd.length>120` 抛错）命题已随实现变更失效
    （真实 guojia desc 仅 71 字，该断言在旧实现下永远绿、本就没测到东西），更新为
    `gd === String(GENERALS['guojia'].desc||'')` 全量相等命题。
  - **回归**：info 10/0、core 7/0、l2 23/0、l3 93/0、c_window 25/0，`node --check bot.js` 通过
    （node v22.23.1）。
  - **改动范围**：`bot.js`（`buildBotVisibleState` 两行）；`run_ai_bus_info_test.js`（+2 项、更新 2 项、
    文件头注释同步）；`index.html` `?v=` 281→282 共 13 处。`normalize` 无需改（纯客户端投影，不进 g）。
  - **commit**：`feat(bot): AI可见状态 desc全量与recentLog 20条`（wenwen_dev）。

## S1 AI自维护回合摘要(状态+总结调用+决策注入,commit 待写)

- **任务**:SDD 计划「2026-08-03-ai-summary-round-memory」Part S1——AI 机器人自维护的
  "本局记忆摘要":跨回合记住日志会滚掉的长程信息(谁对谁造成伤害/谁救过谁/自己的留牌计划),
  每次 AI 决策时注入 systemPrompt。
- **新增状态(bot.js 模块级)**:`aiSummary`(摘要文本)/`aiSummarySeat`(摘要属于哪个座位)/
  `aiSummaryRound`/`aiSummaryTurn`(摘要对应的回合节点,本任务只定义不消费,留给后续调度
  逻辑判断"每轮该不该更新")+ `aiSummaryReset()` 统一清空。
- **`updateAiSummary(g,seat)`(async,fire-and-forget)**:密钥守卫(无 `aiApiKey`/`aiProvider`
  直接 return)→ `buildBotVisibleState` 投影公开可见信息 → userPrompt = 旧摘要(如有,标
  "旧摘要:")+ 最近局面 JSON(`roundNum`/`recentLog`/`discardPile`/`players`)→ 调
  `callAI`(复用 ai-bot.js 基础设施,零改动,`maxTokens:300`)→ 失败静默沿用旧摘要;
  成功且文本非空才写 `aiSummary = text.slice(0,500)` **并 `aiSummarySeat = seat`**。
  最后一行是相对 spec 原文的刻意补充:若本座位第一次写摘要(aiSummarySeat 还是 null),
  不立刻归属的话紧接着的第一次 `callAiChooseIndex` 会把刚写好的摘要当成"座位变化"
  误清掉(测试 2→3 顺序锁死这个语义)。
- **`buildSummaryPrompt(g,seat)`**:纯文本任务的系统提示——"只记发生过的事,不要写推测",
  要求重写 ≤200 字、直接输出文本不输出 JSON。刻意和决策 prompt 的 `{"choice":数字}`
  约定分开。
- **`callAiChooseIndex` 注入段**(候选守卫之后、`showAiThinkingIndicator` 之前):
  `if(aiSummarySeat !== opts.seat) aiSummaryReset(); aiSummarySeat = opts.seat;` +
  `summaryNote = aiSummary && aiSummarySeat===opts.seat ? '\n\n本局记忆摘要...'+aiSummary : ''`,
  `systemPrompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote`。
  无摘要时 summaryNote 为空串,与旧 systemPrompt 字节级一致,零影响回归。4 个调用点
  (botDecide/tryAiBotPlay/tryAiBotBestTarget/强C同窗多步)全部传 `seat`,无需守卫。
  注入段不调 `buildBotVisibleState`(状态重建开销留给各调用方已有的一次调用)。
- **测试(`run_ai_summary_test.js` 8 项,TDD RED→GREEN)**:①首回合 aiSummary 空且
  systemPrompt 无摘要段;②updateAiSummary 调 callAI 一次、prompt 含"摘要"、写回;
  ③非空摘要注入 systemPrompt;④`{ok:false}` 沿用旧摘要;⑤第二次 userPrompt 含
  "旧摘要"+第一次输出;⑥座位 1→2 触发 reset;⑦600 字截断到 500(取前 500);
  ⑧fire-and-forget:返回 Promise、未 await 时后续决策照常工作。harness 复用
  run_ai_bus_info_test.js 惯例(data.js+ai-bot.js+bot.js,distance/attackRange stub)。
- **回归**:summary 8/0、core 7/0、l2 23/0、l3 93/0、c_window 25/0,`node --check bot.js`
  通过。`index.html` `?v=` 282→283 共 13 处。`normalize` 无需改(纯客户端状态,不进 g)。
- **S2(AI摘要回合检测 + 清除按钮 + 移除刷新警告)**:①`scheduleBotTurn` 重构(bot.js)——
  早退拆成 `if(!g||!isBotController(g)) return;` + `if(g.phase==='over'){ aiSummaryReset(); return; }`,
  `botSeatForState` 提前到摘要检测处计算(原 botDecisionInFlight 分支内的重复计算改为复用
  这个 seat,行为零变化):座位不匹配(aiSummarySeat!==seat)先 reset;seat>=0 且已有摘要、
  且 roundNum/turn 任一变化时,更新 aiSummaryRound/aiSummaryTurn 并 fire-and-forget 调
  `updateAiSummary(g,seat)`(不 await,不阻塞决策——更新完成后的下一轮决策才带上新摘要)。
  首回合(摘要空)不触发。既有过滤链(seat<0 且无兜底候选 return / botStateKey 防抖 /
  botScheduledKey)原样保留,c_window 25 项回归锁定。②`showAiKeyModal` btnRow 末尾新增
  `#aiMemoryClearBtn`(ghost 按钮"清除AI记忆",照 spec §4.5-B 逐字):点击 → `aiSummaryReset()`
  → 就地 `replaceWith` 成"已清除本局AI记忆。"提示,弹窗不关闭;密钥/模型/aiPromptDismissed
  等配置一律不清。③删除 `setupRefreshWarning` 函数+调用+`window.aiConversations` 引用
  (全项目仅此一处引用,死代码——aiConversations 从未被写入,警告实际从不触发)。
- **测试(`run_ai_summary_test.js` 8→13 项)**:新增 ⑤项——⑨scheduleBotTurn 回合变化触发
  updateAiSummary spy(回合变→调1次/回合不变→不调/摘要空→不调;stub setTimeout 防真定时器);
  ⑩over 清空 aiSummary+aiSummarySeat;⑪弹窗含 #aiMemoryClearBtn(树形 document stub 驱动
  真实 showAiKeyModal,harness 升级成 run_ai_model_picker_test.js 同款:appendChild 维护树+
  按树 getElementById+classList 真实增删+onclick 属性事件+replaceWith);⑫点击清除 → 摘要
  清空/密钥模型不受影响/弹窗不隐藏/就地提示出现;⑬宿主侧断言 ai-bot.js 无 setupRefreshWarning
  与 aiConversations。
- **回归**:summary 13/0、core 7/0、c_window 25/0、l2 23/0、l3 93/0、model_picker 13/0、
  l1 8/0、info 10/0,`node --check bot.js`/`ai-bot.js` 通过。`?v=` 283→284 共 13 处。
  `normalize` 无需改(纯客户端内存状态,不进 g)。

## token 优化 T1:删 discardPile + recentLog 15 条(SDD 计划「2026-08-03-ai-summary-token-optimization」)

- **动机**:规格 §4.6 评估弃牌堆统计对 AI 决策价值低(牌名构成对"下一手该打什么"几乎无信息量),
  却是 prompt 里最长的非必要开销(全量 byName 随对局增长);recentLog 20 条覆盖约 2 回合、15 条
  足够维持跨步连续性。token 优化第一步。
- **`buildBotVisibleState`(bot.js)**:①删除 `discardPile: (function(){...})()` 整块
  (count+byName 统计,含 `(g.discard||[])` 防御一并移除——g.discard 本身还在,只是不再投影);
  ②`recentLog` `slice(-20)` → `slice(-15)`,注释同步。
- **`updateAiSummary`(bot.js)**:userPrompt 的最近局面 JSON 从
  `{round, recentLog, discardPile, players}` 去掉 `discardPile: state.discardPile,`——
  字段删除后该项恒为 undefined,JSON.stringify 会静默丢弃(无害),但显式清理保持 prompt 形状
  真实反映可见状态,避免将来某天字段复活却忘记接线。
- **测试(`run_ai_bus_info_test.js` 10→9 项,TDD RED→GREEN)**:①删除 discardPile 两条断言
  (count/byName、空弃牌堆),改为一条「可见状态不含 discardPile 键」
  (`JSON.stringify(buildBotVisibleState(g,0)).indexOf('discardPile')===-1`,g.discard 置 3 张牌
  确保不是"恰好空堆"的假绿);②recentLog 断言 30 条→20 改 30 条→15(长度 15、首项 日志16、
  末项 日志30)。RED 阶段实测两处失败(长度 20、键仍存在)。规则 20:删除的旧断言命题随实现
  变更失效,新"不含键"断言已确认能变红。
- **回归**:info 9/0、summary 13/0、core 7/0、l2 23/0、l3 93/0、c_window 25/0,
  `node --check bot.js` 通过。全项目 `rg discardPile` 确认无其它测试/调用点引用该字段
  (仅 specs/plans 文档)。`index.html` `?v=` 284→285 共 13 处。`normalize` 无需改
  (纯客户端投影删除,不进 g)。

## token 优化 T2:出牌候选 Top-K=25 截断(SDD 计划「2026-08-03-ai-summary-token-optimization」)

- **背景**：7 人局出牌候选按"手牌×目标"全展开可达 40-50 条，label 每条 20-40 字，userPrompt 浪费 1-2k tokens；候选过多也分散模型注意力。
- **实现（bot.js `enumerateAllLegalOneStepActions`）**：新增模块级常量 `AI_PLAY_CANDIDATE_LIMIT = 25`；枚举展开后、push 结束项**之前**按 `localHeuristicScore` 降序 `sort`（V8 稳定排序，同分保持原枚举顺序），超 25 条则 `out.length = 25` 截断；「结束出牌阶段」在截断之后才 push，恒在末尾、不参与截断。
- **无密钥零变化论证**：`localFallbackPlayWindow` 只取最高分非结束候选——Top-1（最高分）恒在截断结果里，fallback 选择不变（c_window T25 锁定）。
- **排序/截断只影响 AI 看到候选的顺序与条数，不影响合法性**（截断前已全部过 canPlay/canTarget）。
- **测试（`run_ai_bus_c_window_test.js` 25→29 项）**：T23 构造 6 人局 + 5 杀(连弩无限杀×相邻2目标=10条) + 5 过河拆桥(×5目标=25条) = 35 条原始 → 断言恰返回 26 条(25+结束)、结束项只在末尾；T24 加桃(100 分) → 桃是唯一最高分、截断后仍在且为最高分；T25 `localFallbackPlayWindow` 在截断后列表上选桃(100>25)，与未截断一致；T26 3 人局 10 条原始(<26) → 不截断、11 条全部保留+结束项。
- **l2 测试 1 处适配**：铁索连环测试的 mock choice 0→1——T2 排序后候选顺序变化（最高分在前，铁索→自己 20 分排 0 位），测试意图(铁索目标为他人)不变，非回归。
- **改动范围**：`bot.js`（`AI_PLAY_CANDIDATE_LIMIT` + 排序截断）、`run_ai_bus_c_window_test.js`(+4 项)、`run_ai_bus_l2_test.js`(1 处 choice 适配)、`index.html`(`?v=` 285→286 ×13)。回归全绿：c_window 29、l2 23、l3 93、summary 13、core 7。

## L1 泛化批次（G1-G5，SDD 计划「2026-08-03-l1-generalization」）

- **G1 seatPick 接线修复（bug）**：`BOT_SEAT_PICKS` 注册了 11 个座位技能（蛊惑目标/旋风/断粮/奇袭/国色/武圣/双雄/挑衅/反间/青囊/驱虎伤害）但 runBotDecision 从未调用 `botDecide('seatPick')`——第一批 T1-T3 的测试全是直接调 botDecide 的单元测试，从未测过全链路，机器人从不主动使用这些技能。修复：play 分支（四个多步之后、runBotActionWindow 之前）+ guhuoTarget/xuanfengPick/quhuDamageChoice 三个 pending 阶段各加一处接线。**关键修复轮**：接线加 `aiReady` 守卫——否则无密钥时 seatPick fallback null → botDecide true → play 分支 return → runBotActionWindow 不执行 → 机器人整回合卡死（违反无密钥回归红线）。修复后无密钥一律走旧路径（runBotActionWindow/botSafePrompt），与改动前逐字一致。
- **G2 L1 泛化（响应类有密钥自动 AI 化）**：`controlsChoiceMatch` 从 allowlist-only（wuxie/luoyingAsk/luoshen）放宽为 `(aiReady || allowlist) && !EXCLUDE && botSeatForState===seat`——有/无密钥路径解耦取代逐阶段等价性论证（无密钥 match false 走旧分支，红线守住）。新增 `CONTROLS_CHOICE_EXCLUDE` 集合（27 条 brief 清单 + 补 guhuoTarget/xuanfengPick/quhuDamageChoice 共 30 条，防 L1 抢占 seatPick 专用接线）。**必要补充**：`BOT_PHASE_ACTOR` 补 liuli:'to'/tianxiang:'seat'/lirangRecover:'from'/zhengyi:'asking' 四条（否则 botSeatForState 恒 -1，泛化整体 no-op）。
- **G3 分配类纯按钮阶段验证（纯测试）**：L1 自动覆盖集确认为 4 个阶段（liuli/tianxiang/lirangRecover/zhengyi——xiaoguo/xiaoguoChoice 在 EXCLUDE 双重排除），补缺口测试（候选文案镜像/choice-1 侧/无密钥对照/EXCLUDE 断言），mutation 验证鉴别力。
- **G4 yijiAssign 遗计分配专用注册**：跨调度累积（复用 botTwoStepA，非最后一张累积 picks、最后一张 `respondYijiAssign(picks)` 一次性提交）；`BOT_PHASE_ACTOR` 登记 yijiAssign:'seat'（调度前提）；EXCLUDE 收录 yijiAssign（L1 冲突确认：renderControls 渲染"给 X"按钮）；无密钥 fallback=给 自己（改动前 botSafePrompt 点不到按钮卡死，是改进非回归）。
- **G5 lirangAsk 礼让发动专用注册**：单阶段选 2 张手牌组合（≤8，默认组合恒在），目标 pending.to 服务端已定；`BOT_PHASE_ACTOR` 登记 lirangAsk:'from'；EXCLUDE 收录（L1 冲突确认）。**关键偏差修正**：brief 的 null fallback 前提有误——「不发动」命中 botSafePrompt safe 正则，改动前是"拒绝并推进"非 no-action；用 null 会让机器人永久卡死（规则 26），改为 decline 动作 `respondLiRang(false, [])`，与 brief 自身测试规格一致，测试锁定。xiaoguo 走路径 B（已在 EXCLUDE，机器人不发动、advanceXiaoguo 推进，留后续独立任务）。
- **测试计数**：l3 93→109（G1 +5/G4 +5/G5 +5 及既有更新）、l1 8→20、c_window 29、l2 23、summary 13、core 7；`?v=` 287→290。全量回归绿。

## A2 铁索连环双目标候选

- **实现**：`enumerateAllLegalOneStepActions` 对铁索连环生成合法单目标与双目标组合候选；双目标按两目标分数之和降序，最多保留 10 组；数组目标原样交给既有 `playCard`/`startTieSuoTargets` 路径。全局 Top-K=25 与「结束出牌阶段」末项规则保持不变。
- **无密钥行为**：最高分候选恒在截断结果中；fallback 仍选最高分合法项。铁索双目标属于新增合法能力，测试锁定数字目标与数组目标两种执行形状。
- **测试**：`run_ai_bus_c_window_test.js` 新增 4 项：3 合法目标时验证 3 单目标+3 双目标；有密钥选择 `[1,2]`；无密钥单目标/组合 fallback；6 个合法目标时双目标组合由 15 组截到 10 组。最终 c_window 34/0、l2 23/0、l3 114/0，`node --check bot.js` 通过。
- **改动范围**：`bot.js`、`run_ai_bus_c_window_test.js`、`index.html`（`?v=291→292` ×13）。

## A5 借刀响应侧专用注册

- **实现**：新增 `BOT_DECISIONS.jiedaoResponse`，在 `jiedaoChoice` 阶段为借刀目标角色生成「打出【杀】」/「弃置武器」候选；有可用杀时携带具体 `cardIdx`，执行调用 `respondJiedao(useSha, cardIdx)`，服务端继续复核牌面与将驰禁杀。
- **无密钥回退**：完全复用旧分支 `canBotPlaySha(p) && findUsableAs(p.hand,p,'杀')>=0`；有杀出杀，将驰禁杀或无杀时弃武器。`jiedaoChoice` 保留 EXCLUDE，避免 L1 抢占专用响应。
- **测试**：`run_ai_bus_l3_test.js` 新增借刀响应候选、出杀/弃武器、将驰禁杀、无密钥回退、runBotDecision 接线与 `BOT_PHASE_ACTOR`/EXCLUDE 断言；l3 共 120 项通过，l1 21、l2 23、c_window 34、summary 13 全绿。
- **改动范围**：`bot.js`、`run_ai_bus_l3_test.js`、`index.html`（`?v=292→293` ×13）。

## A4 恩怨选牌维度

- **实现**：新增 `BOT_DECISIONS.enyuanGiveCard`，在 `enyuanGiveCard` 阶段把当前座位手里的每张红桃作为一个候选，AI 可选择具体哪张红桃交给法正；`giveEnyuanCard(cardIdx)` 继续由服务端校验红桃与下标。
- **无密钥回退**：候选首项=旧逻辑第一张红桃；无红桃时保持无动作防御。`BOT_PHASE_ACTOR` 已有 `enyuanGiveCard:'damagerSeat'`，专用分支替换旧硬编码调用，避免双执行。
- **测试**：l3 新增 match/红桃过滤/AI 选择非首张/无密钥首张/全链路与隐藏信息断言；l3 125/0、l1 21/0、l2 23/0、c_window 34/0、summary 13/0。
- **改动范围**：`bot.js`、`run_ai_bus_l3_test.js`、`index.html`（`?v=293→294` ×13）。

## A7 嫌疑事件流

- **实现**：身份局有效伤害/救援证据写入 `g.aiSuspicionEvents`，事件统一为 `{round,source,target,amount,kind}`，kind 为 `damage`/`rescue`，最多保留20条；`normalize` 清洗非法数组/字段，符合 Firebase 新数组字段防御纪律。
- **AI 投影**：`buildBotVisibleState` 提供最近10条 `recentSuspicionEvents`，只含公开行动字段，不含手牌/隐藏身份。
- **测试**：info 测试新增事件写入、救援写入、20条上限、normalize 清洗、最近10条投影、FFA不写入、隐藏字段检查；info 16/0，l3 125/0，l1 21/0，l2 23/0，c_window 34/0，bot/game 语法通过。
- **改动范围**：`bot.js`、`game.js`、`run_ai_bus_info_test.js`、`index.html`（`?v=294→295` ×13）。

## A3 方天画戟多目标

- **探索结论**：方天画戟入口要求出牌阶段最后一张手牌能当杀且存在合法目标；真人最终调用 `playShaFangtian(cardIdx, targets)`，服务端允许1-3个目标并复核距离/空城/出杀次数。
- **实现**：新增 `BOT_DECISIONS.fangtian`，生成1/2/3目标组合（最多10项），AI 选择完整目标数组；`runBotDecision` 在 seatPick 后、普通出牌窗口前接管；execute 复用 `playShaFangtian`，不改 game.js。
- **无密钥回退**：选择首个合法单目标组合，保证机器人不会因方天模式直接卡住；这是原机器人未覆盖能力的新增合法行为。
- **测试**：l3 新增 match 门槛、组合形状、AI/无密钥执行、空城/距离过滤、接线断言；l3 131/0、c_window 34/0，`node --check bot.js` 通过。旧接线断言同步加入 fangtian 优先级并清理测试状态。
- **改动范围**：`bot.js`、`run_ai_bus_l3_test.js`、`index.html`（`?v=295→296` ×13）。

## A6 多张仁德（继续给/停止）

- **实现**：`BOT_DECISIONS.rendeTwoStep` 阶段B 提交一张后，若 `renDeCount<2` 且手牌还有牌，设 `botTwoStepA={decisionId:'rendeTwoStep', a:目标, continue:true}` 继续给下一张；continue 态候选=剩余手牌+「停止给牌」项；选停止即 reset。目标字段沿用既有 `a`。
- **无密钥零变化**：`localFallback` 返回带 `stopAfter` 标记的候选，execute 提交一张后直接 reset、不设 continue——改动前只给1张的行为逐字保留。
- **边界**：continue 态手牌空时 match 放行一次（候选只剩「停止」可清挂起），避免挂起残留。
- **测试**：l3 新增仁德 continue 链 7 条（选目标/阶段B候选/提交后设 continue/停止/reset/无密钥一张即停/手牌空只剩停止）；l3 138/0、c_window 34/0，`node --check bot.js` 通过。
- **改动范围**：`bot.js`、`run_ai_bus_l3_test.js`、`index.html`（`?v=296→297` ×13）。

## A8 机器人兜底完整性（botSafePrompt 正则盲区修补）

- **背景**：`botSafePrompt` 的 safe 正则 `/不发动|不使用|不出|取消|跳过|放弃|结束/` 覆盖不了「不获得」等常见拒绝按钮。G3 已实测 `lirangRecover`（获得弃牌/不获得）无密钥时正则命中不了任何按钮 → 只 warn 不动作，机器人可能卡在礼让回收。这是 L1 泛化（有密钥）之外遗留的无密钥盲区。
- **修补**：`botSafePrompt` safe 正则追加 `不获得`（`/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/`）。纯拒绝词，实测不匹配「发动【礼让】」「获得弃牌」「确认发动」等发动/接受按钮；mandatory 正则、单按钮兜底、L1 候选正则、allowlist/EXCLUDE/BOT_PHASE_ACTOR 均未触碰。
- **测试同步**：l1 T18 原断言「lirangRecover 旧路径应不点任何按钮」锁定的是修补前的盲区行为；修补后无密钥旧路径点「不获得」→ `respondLiRangRecover(false)` 推进（预期行为变化），断言已同步为新预期。l1 21/0、l3 138/0、c_window 34/0，`node --check bot.js` 通过。
- **改动范围**：`bot.js`、`run_ai_bus_l1_test.js`、`index.html`（`?v=297→298` ×13）。

## A1 响应超时托管（30s+倒数+保守提交，大批次批2）

- **目标**：询问型 pending 30s 超时自动提交保守动作，画面显示"⏱ Ns 后自动…"倒数，避免挂机/关页面整局卡死（CLAUDE.md「四、已知的待优化点」首条）。spec：`docs/superpowers/specs/2026-08-03-big-batch-design.md` §2。
- **打戳**：`game.js` 新增 `RESPONSE_TIMEOUT_MS=30000` + `setResponseAskedAt(pending)`（pending.askedAt=Date.now()）+ `RESPONSE_PENDING_TYPES` 集合（保守动作表 20 type + pick）。21 处询问型 pending 创建点（respond 3006 系/guicai/dying/wuxie×4/duel/aoeResp×3/liuli/ganglieChoice/jiedaoChoice/pick/huogongReveal/lirangAsk/xiaoguo×2 + resume 接回 2 处）与 4 处 asking 切换点（guicai/dying/openWuxieRound/respondWuxie 的 nxt 赋值）打戳——**每次"轮到下一个被问者"重新计时**；`skills.js` 9 处创建点 + guhuoQuestion asking 切换（615）打戳。`normalize` 兜底：响应型 pending 无 askedAt 补 Date.now()，**绝不覆盖已有戳**（覆盖=倒计时永远重置，等不到超时）。
- **检测器**（bot-ai-bus.js）：`maybeAutoRespondTimeout(g)` 单步 tick——有 askedAt + 超时 + 保守动作表命中 → `botInvoke(actor, act)` 切 mySeat 到被问者提交；服务端响应函数自带守卫（asking/to/from===mySeat），阶段已变则守卫拦截原地 return，**幂等无副作用**。`startAutoRespondTimer()` 1s setInterval（全局标志位只启一个），render.js 的 `render()` 每次渲染确保启动；任意客户端都可检测（谁先到谁提交）。`refreshCountdownSpans()` 每秒刷新 `.resp-countdown` span 文本。
- **保守动作表**（`autoRespondAction`，spec §2.2 逐条 20 项）：respond→`respondShan(false)`、aoeResp→`aoeRespond(false)`、duel→`duelResponse(false)`、dying→`respondDying(false)`、wuxie→`respondWuxie(false)`、guicai→`respondGuicai(false)`、jiedaoChoice→`respondJiedao(false)`、ganglieChoice→`('damage',[])`、guhuoQuestion→`respondGuhuoQuestion(false)`、xiaoguo→`respondXiaoguo(false)`、xiaoguoChoice→`('damage')`、lirangAsk→`respondLiRang(false,[])`、lirangRecover→`respondLiRangRecover(false)`、zhengyi→`respondZhengyi(false)`、tianxiang→`respondTianxiang(null,null)`、liuli→`respondLiuli(null,null)`、quhuRespond→`respondQuhu(0)`、fanjianSuit→随机 `SUITS`、huogong→`respondHuogong(false)`、huogongReveal→`respondHuogongReveal(0)`。所有响应函数签名逐一核对过（`respondQuhu(cardIdx)`/`respondHuogongReveal(cardIdx)` 是"出第 0 张"语义——驱虎拼点/火攻亮牌阶段目标必有牌，spec 原表即如此）。
- **倒计时**（render.js）：`setBanner` 在 html 非空时拼 `renderResponseCountdown(currentG)`（`⏱ Ns 后自动…`，N=ceil((askedAt+30000-now)/1000)）；`renderResponseCountdown` 定义在 bot-ai-bus.js（避免测试加载 render.js 的 DOM 依赖）。
- **测试**：新增 `run_ai_timeout_test.js`（加载 data/room-lifecycle/game/skills/bot-ai-bus/bot 进 vm 沙箱，stub `gameRef.transaction` 保留 tx 内 normalize 真实行为——与 run_lidian 直接替换 tx 不同）8 条全绿：超时 spy 被调/未超时不调/阶段已变（stale 快照）提交被拒无副作用/normalize 补戳/不覆盖已有戳/倒计时文案+数值（askedAt=now-5s → 约 25s）/非响应型 null/无密钥不触发 callAI。
- **回归**：core 7/0、l3 138/0、l1 21/0、l2 23/0、c_window 34/0、info 16/0、model_picker 17/0、summary 全绿；`node --check` game/render/bot/bot-ai-bus/skills 全过。`run_cixiong_test.js` 的 3 个失败（EQUIP_SLOT_LABEL is not defined）是**改动前既有问题**（测试沙箱缺 render-controls.js），git stash 对比确认非本次回归。
- **边界**：保守动作表外的询问型（wugu 五谷挑选/huashenPick 化身/guanxing 观星/tiaoxinChoice 等）不打戳不倒计时不自动提交，维持现状——spec 保守动作表未列。
- **改动范围**：`game.js`、`skills.js`、`bot-ai-bus.js`、`render.js`、`run_ai_timeout_test.js`（新）、`index.html`（`?v=300→301` ×14）。commit `db415d7`。
- **A2 断线重连状态回退验证（验证型任务，零业务改动）**：目标——验证/确保刷新页面后客户端态安全回退、不残留导致卡死。**结论：天然安全**。`botTwoStepA`（bot.js 模块级 let）与 `aiSummary`/`aiSummarySeat`/`aiSummaryRound`/`aiSummaryTurn`（bot-ai-bus.js 模块级 let）在浏览器刷新时随 JS 全量重载天然回初始值；全项目 grep 确认 sessionStorage/localStorage 从不恢复这些状态（ai-bot.js 只存 `sgsAiKey`/`sgsAiProvider`/`sgsAiPromptDismissed`/`sgsAiModel` 四个密钥配置键、game.js 只存 `sgsClientId` 重连身份，均属刻意设计且与游戏态无关），无任何 storage 恢复路径 → 不需要补 `scheduleBotTurn` 重连清理。`scheduleBotTurn` 既有的座位变化守卫（`aiSummarySeat!==seat` → `aiSummaryReset()`）与两阶段 match 挂起守卫（`!botTwoStepA||botTwoStepA.decisionId===id`）已覆盖同会话内跨决策残留，刷新后 botTwoStepA=null 时所有两阶段决策（借刀/离间/丈八/仁德/遗计）自然从头重问，幂等安全。**改动**：仅 `run_ai_bus_l3_test.js`（沙箱构建抽成 `buildSandbox()`/`loadAll(sb)` 可复用，退出循环前新增 A2 验证块——主沙箱注入残留态→第二个全新沙箱=页面刷新→断言五态回初始值→构造陈旧 `jiedaoChoice` pending 跑 `runBotDecision` 断言不报错并正常提交）+ `index.html`（`?v=301→302` ×14，实际 14 处非 brief 写的 13 处）。**断言可红性**：临时探针证明读路径能捕获注入残留（干净= `[null,"",null,0,-1]`，注入后被读到非空），非永远绿。**回归**：core 7/0、l3 138/0+A2 PASS、l1 21/0、l2 23/0、c_window 34/0、summary 全绿、info 16/0、model_picker 17/0、timeout 8/0；`node --check` 全过。commit `504fe12`。

## B2a 主公技(刘备【激将】+ 曹操【护驾】，大批次批3 B2 拆出的前半)

- **目标**：四主公技(B2)拆成 B2a(激将/护驾)+后续制霸/妄尊。两个"需出牌时可求助其他角色替出"的主公技，仅身份局主公可发动。spec：`docs/superpowers/specs/2026-08-03-big-batch-design.md` §4。
- **data.js caps**：`liubei` 补 `caps:{rende:true, jijiang:true}`、`caocao` 补 `caps:{hujia:true}`（原 hooks.onDamaged 奸雄保留）。能力声明走 caps，业务点 `hasCap` 查——**不硬编码武将名**。
- **触发点设计（简版）**：响应函数的"不出/不闪/认输"分支最前面插入守卫——`canTriggerLordAsk(g, mySeat, cap)` = 身份局(`gameMode==='identity'`) + 本人 `role==='zhu'` + `hasCap(p,cap)` + 本回合未用(`!g.jijiangUsed`/`!g.hujiaUsed`) + `aliveCount>1`；命中则 `startLordAsk` 进入求助 pending。**为什么不提前到"响应阶段创建点"**：激将/护驾是可选的（"可发动"），主公想自己出牌时不应被强制问一圈；放在"不出"分支=主公选择不自己出时才求助，且"无人替出→回原 pending"后主公还能再自己出（第二次不出因 used 已真直接受伤），行为最贴合官方。铁骑判红(noShan)的杀不可被闪抵消，护驾触发前显式跳过。
- **求助链**：`startLordAsk` 保存 `resume={phase, pending}`(原 pending 对象引用,含 shanCount/shaCount 等计数器) + 置 used 标志 + 从主公下家 `nextAskee(g,lordSeat,lordSeat)` 起问。`respondJijiangAsk(useCard,cardIdx)`/`respondHujiaAsk(useCard,cardIdx)` 走共用 `respondLordAskCore`：出牌=校验 `canUseAs(me,card,need)`(服务端复核,与响应阶段同款,含 cardIdx 多候选)/将驰禁杀同样约束替出杀 → `completeLordAsk` 恢复原 pending 并按原场景完成"已出"语义(镜像于吉【蛊惑】的 resolveGuhuoResponseShan/Sha/Aoe 同一套写法——换牌者只是物理出牌人,响应方仍是主公:决斗换 active/南蛮万箭 aoeAdvance/单体杀走 maybeStartShaOffsetEffects+finishSingleShaTarget)；不出=nextAskee 问下一个人(asking 切换重新打 askedAt 戳)；问完一圈无人 → `restoreLordAsk` 恢复原 pending+phase 并重新打戳,主公回到正常响应。
- **完成语义边界**（镜像蛊惑先例，简化版刻意不做）：护驾替出的闪不触发张角【雷击】（蛊惑同款跳过）；护驾/激将不影响 g.shaUsed 出杀次数（响应=打出非使用）；决斗场景主公结构上恒非当前回合玩家，`shaPlayedInDuel` 行天然不生效仅保结构对等。
- **normalize**：`jijiangUsed`/`hujiaUsed` 非布尔回退 false（startTurn 重置，回合内限一次照 g.duanliangUsed 同款写法）；`jijiangAsk`/`hujiaAsk` pending 结构校验（lordSeat/asking 数字、need 字符串、resume 有 phase+pending——asking 创建/切换点恒有值,无"还没轮到"的合法中间态，按结构校验不误伤）；`RESPONSE_PENDING_TYPES` 补两项（超时托管打戳+保守提交）。
- **机器人侧**：`BOT_PHASE_ACTOR` 登记 `jijiangAsk:'asking'`/`hujiaAsk:'asking'`；`BOT_DECISIONS.jijiangAsk`/`hujiaAsk` 注册（match=phase+type+asking；候选=[替主公打出【X】,不出]；无密钥 fallback=有牌就替出/无牌不出——改动前该阶段机器人走 botSafePrompt 点"不出"（安全正则命中），无牌时行为一致，有牌时"替出"是新功能；将驰禁杀进候选/fallback 判据，规则26）；runBotDecision 在 L1 之前接线+`CONTROLS_CHOICE_EXCLUDE` 收录两项（双保险防 L1 镜像按钮抢先）；A1 超时保守表补 `jijiangAsk→respondJijiangAsk(false)`/`hujiaAsk→respondHujiaAsk(false)`。
- **UI**：render-controls.js 新增两分支（被求助者=`asking===mySeat` 渲染「替主公打出【X】」「不出」按钮，候选>1 复用 selectedResponseCardIdx 多候选点选；旁观者=等待 banner）；render-hand.js respondRole 计算补两项（七个响应场景共用同一套多候选状态）；render.js phaseName 补 `jijiangAsk:'激将求助'`/`hujiaAsk:'护驾求助'` + resetSelectedResponseCard 兜底清理补两项。
- **测试**（新 `run_ai_lordskill_test.js`，28 项，vm 沙箱加载 config/data/room-lifecycle/game/weapons/skills/bot-ai-bus/bot/ai-bot/render/render-controls）：A 激将触发/替出完成决斗响应/无人替回原/南蛮两分支；B 护驾触发/替出抵消杀/无人替回原/万箭两分支；C 守卫（role zhong/ffa/jijiangUsed/noShan/无其它存活）；D normalize 两标志+pending 校验+startTurn 重置；E 机器人（BOT_PHASE_ACTOR/BOT_DECISIONS 形状/无密钥回退/runBotDecision 接线/EXCLUDE/超时保守表）；F 无密钥零变化（ffa 与 role zhong 直接受伤）；G UI 按钮渲染+点击走服务端函数。**TDD**：先写 28 项 FAIL（21 失败 7 通过——7 个通过的正是零变化守卫基线）→ 实现 → 28/28 GREEN。测试构造踩的两个坑：①身份局角色配比必须有存活反贼否则 checkWin 提前结束（默认 zhu/fan/zhong）；②非主公守卫测试座位0 角色必须能被子 opt.roles 覆盖（mkG 一度硬编码座位0=zhu）。
- **回归**：core 7/0、l3 138/0、l1 21/0、l2 23/0、c_window 34/0、info 16/0、model_picker 17/0、summary 13/0、timeout 8/0、identity 35/0、qinggangjian 6/0、lidian ALL PASSED、xuanfeng 5/0、fazheng 8/11（3 失败为既有眩惑损坏,git stash 对比确认非本次回归）、cixiong 17/20（既有失败,stash 对比确认非本次回归）；`node --check` data/game/render/render-hand/render-controls/bot/bot-ai-bus/skills 全过。
- **改动范围**：`data.js`、`game.js`、`render.js`、`render-hand.js`、`render-controls.js`、`bot.js`、`bot-ai-bus.js`、`run_ai_lordskill_test.js`（新）、`index.html`（`?v=302→303` ×14）。commit `feat: B2a主公技(激将/护驾)`。

## B2b 主公技(孙策【制霸】+ 袁术【妄尊】，大批次批3 B2 拆出的后半)

- **目标**：四主公技(B2)最后两个。制霸=孙策出牌阶段限一次与一名其他角色拼点(仅身份局主公)；妄尊=主公准备阶段袁术(非主公)摸一张、主公本回合手牌上限-1。spec：`docs/superpowers/specs/2026-08-03-big-batch-design.md` §4。
- **data.js caps**：`sunce` 补 `caps:{jiang:true, zhiba:true}`（激昂保留）、`yuanshu` 补 `caps:{tongji:true, wangzun:true}`（同疾保留）。能力声明走 caps，业务点 `hasCap` 查——不硬编码武将名。
- **制霸（game.js，简化版）**：`canTriggerZhiba(g, seat)` = `phase==='play'`+`turn===seat`（仅自己的出牌阶段）+ 身份局 + `role==='zhu'` + `hasCap(p,'zhiba')` + `!g.zhibaUsed` + 自己有手牌 + 场上存在有手牌的其它存活角色。`startZhiba(targetSeat)`：play 阶段入口（孙策点选目标后提交）——孙策**自动出第一张手牌**（简化版不做孙策选牌阶段）、进弃牌堆、置 `g.zhibaUsed=true`、建 `zhibaAsk` pending（`{type:'zhibaAsk', lordSeat, targetSeat, selfCard, resume:{phase:'play',pending:null}}`）+ `setResponseAskedAt` 打戳（A1 超时托管）。`respondZhiba(cardIdx)`：目标出拼点牌（镜像天义 `respondTianyi` 同款：逐张手牌按钮、服务端下标复核）→ 双方各弃一张 → `pointText` 比点日志 → **输赢均无额外效果**（用户任务规格的简版，可后续加强）→ pending 置空回 play。**resume 字段与 B2a 的区别**：制霸从 play 阶段进入、不打断任何响应链，resume.pending 恒为 null——normalize 结构校验因此**不要求 resume.pending 有值**（与 jijiangAsk/hujiaAsk 的校验不同，后者 resume 里是原响应 pending 必须有值）。
- **妄尊（game.js startTurn 准备阶段）**：主公（`gameMode==='identity'` + 回合玩家 `role==='zhu'`）startTurn 时，若场上存在存活且 `hasCap(p,'wangzun')` 的非主公角色（袁术）→ `ensureDeck`+`drawN` 袁术摸一张 + `g.lordHandCap=1` + 日志/音效。**简版自动触发不询问**。`g.lordHandCap` 语义=主公本回合手牌上限修正值（hp-1）。**手牌上限接入**：新增共用 helper `handCapLimit(g, seat)`（基础=hp；`gameMode==='identity'`+`role==='zhu'`+`lordHandCap>0` 时减 1，`Math.max(cap,0)`）——替换弃牌阶段三处硬编码 `me.hp` 的判断：`discardCard`(5516系)/`discardCards`(need 计算)/`endTurn`(超上限拦截)。**UI 与机器人侧同样换用该 helper**：render-controls.js 弃牌阶段 banner `over` 计算、bot.js `runBotDecision` discard 分支 need + `discardSubsetBuildCandidates` need——保证主公弃牌数量提示、机器人弃牌决策与服务端同一口径不分叉。**gameMode 守卫进 helper**：防 ffa/脏数据下 role='zhu' 误扣上限（normalize 在真实流程会清 ffa 身份，这里双重保险，测试 L1 直接构造脏数据验证）。
- **normalize**：`g.zhibaUsed` 非布尔回退 false、`g.lordHandCap` 非整数回退 0（startTurn 重置两者，回合内限一次照 g.duanliangUsed 同款写法）；`zhibaAsk` pending 结构校验（lordSeat/targetSeat 数字、selfCard 存在、resume 有 phase）；`RESPONSE_PENDING_TYPES` 补 `zhibaAsk`（超时托管打戳+保守提交）。
- **机器人侧**：`BOT_PHASE_ACTOR` 登记 `zhibaAsk:'targetSeat'`（服务端 `respondZhiba` 守卫 `g.pending.targetSeat!==mySeat`）；`BOT_DECISIONS.zhibaAsk` 注册（match=phase+type+targetSeat；候选=每张手牌；无密钥 fallback=选**点数最大**的牌——输赢无惩罚任何牌都合法，最大点胜率最高）；runBotDecision 在 L1 之前接线 + `CONTROLS_CHOICE_EXCLUDE` 收录 `zhibaAsk`（双保险防 L1 镜像"拼点【X】"按钮抢先）；`BOT_SEAT_PICKS.zhiba` 注册（制霸"选目标"入口，有密钥时 seatPick 总线接管；无密钥 seatPick 不接线、机器人不主动发动制霸——制霸是本次新功能，零变化承诺只覆盖非身份局/非主公路径）；A1 超时保守表补 `zhibaAsk→respondZhiba(0)`。**弃牌上限对机器人同样生效**：bot.js 两处 need 计算换 `handCapLimit`。
- **UI（render-controls.js）**：play 阶段「发动【制霸】」按钮（身份局主公孙策 + 未用 + 有牌，镜像天义入口的 noLocalMode 一套）→ `zhibaMode` 本地模式（render-controls 按钮列表选目标，非座位卡点击——仿 tianyiMode 先例）→ `startZhiba(i)`；`zhibaAsk` 阶段目标渲染「拼点【X】♠5」按钮（镜像 `tianyiRespond` 同款）+ 旁观者等待 banner；弃牌 banner 换 `handCapLimit`。render.js：phaseName 补 `zhibaAsk:'制霸拼点'`；`resetSelectionState` 与每渲染清理各补 `resetZhiba()`（同款兜底：不在自己出牌阶段即退出制霸选目标模式）；结束出牌按钮 reset 列表补 `resetZhiba()`。
- **测试**（扩展 `run_ai_lordskill_test.js` 至 45 项）：H 制霸（触发建 pending+自动出第一张+used 置真/响应比点各弃一张/used 已真、role zhong、ffa、无手牌守卫/normalize+startTurn 重置）；I 妄尊（主公 startTurn 袁术摸一张+lordHandCap=1/弃牌阶段三处上限=hp-1 生效/ffa、非主公回合、袁术死亡不触发）；J 机器人（BOT_PHASE_ACTOR/BOT_DECISIONS 形状+无密钥选最大点/runBotDecision 接线/EXCLUDE/BOT_SEAT_PICKS.zhiba/超时保守表）；K UI（zhibaAsk 拼点按钮点击走 respondZhiba/play 阶段制霸按钮渲染、ffa 不渲染）；L 无密钥零变化（ffa 弃牌阶段不受脏 lordHandCap 影响）。**TDD**：先写 16 项 FAIL（startZhiba/respondZhiba 未定义、normalize 无字段等，29 PASS 为既有 28 项+零变化基线）→ 实现 → 45/45 GREEN。**测试踩坑**：①`mkG` 的 `turn: opt.turn || 1` 把 `turn:0` 当 falsy 变成 1——连带暴露 `canTriggerZhiba` 缺 phase/turn 服务端守卫（当时测试靠"无守卫"才通过），修复 = mkG 改 `typeof opt.turn==='number'` 判定 + `canTriggerZhiba` 补 `g.phase!=='play'||g.turn!==seat` 守卫（防出牌阶段外被直接调）；②startTurn 无条件重置 lordHandCap=0，妄尊守卫测试断言 undefined 是错的（应断言 0 + 袁术手牌数不变，后者的"袁术没摸牌"才是真正的零变化信号）。**既有测试更新**：`run_ai_bus_l3_test.js` T1 注册表计数断言 11→12（新增 zhiba，预期内的表驱动断言更新）。
- **回归**：lordskill 45/0、core 7/0、l3 138/0（更新后）、l1 21/0、l2 23/0、c_window 34/0、info 16/0、model_picker 17/0、summary 13/0、timeout 8/0、identity 35/0、qinggangjian 6/0、lidian ALL PASSED、xuanfeng 5/0、fazheng 8/11（3 失败为既有眩惑损坏，stash 对比确认非本次回归）、cixiong 17/20（既有失败，非本次回归）；`node --check` data/game/render/render-hand/render-controls/bot/bot-ai-bus/skills 全过。
- **改动范围**：`data.js`、`game.js`、`render.js`、`render-controls.js`、`bot.js`、`bot-ai-bus.js`、`run_ai_lordskill_test.js`、`run_ai_bus_l3_test.js`、`index.html`（`?v=303→304` ×14）。commit `feat: B2b主公技(制霸/妄尊)`。

## D4 响应阶段 UI 回归扫描（大批次）

- **扫描**：`BOT_PHASE_ACTOR` 44 个 phase 逐一对照 `BOT_DECISIONS` 注册（31 项）+ `CONTROLS_CHOICE_EXCLUDE`（33 项）+ L1 allowlist + 旧分支。
- **结论（零代码改动）**：12 个"已登记 actor 但未注册未 EXCLUDE"阶段均有明确覆盖路径——①allowlist 三阶段（wuxie/luoyingAsk/luoshen）由 L1 接管（无密钥也接管）；②liuli/tianxiang/lirangRecover/zhengyi/xiaoguoChoice 为 G2/A1 已确认的 L1 覆盖阶段（有密钥 AI 接管，无密钥走旧分支/botSafePrompt，A8 已修正则盲区）；③guanxing/huashenSkill 有专用注册（grep 名不同）；④xunxunPick/respond 走本地旧分支（逻辑正确）。无新增盲区。
- **改动范围**：仅 progress-log 记录，无业务代码改动。
