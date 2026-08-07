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

## 大批次总收尾（D2/D3/A1/A2/B2/D4）

- **交付**：D2 `bot-ai-bus.js` 拆分（总线核心独立，加载顺序 bot-ai-bus 在 bot 前）；D3 `AI_DEFAULT_MODEL` 单源（`PROVIDER_ADAPTERS[x].defaultModel`）；A1 响应超时托管（30s + 画面倒数 + 20 阶段保守动作表 + 幂等提交 + `RESPONSE_TIMEOUT_MS=30000`）；A2 断线重连验证（客户端态天然重置，零业务改动）；B2 四主公技（激将/护驾/制霸/妄尊，仅 `role==='zhu'` 守卫，新 pending 均登记 BOT_PHASE_ACTOR + BOT_DECISIONS + 超时保守表 + EXCLUDE）；D4 响应阶段 UI 回归扫描（无盲区，零代码改动）。
- **测试**：AI-bus 10 套件 322 项全绿（timeout 8/lordskill 45/summary 13/core 7/info 16/l1 21/l2 23/c_window 34/l3 138/model_picker 17）；仓库 identity 35/lidian 3/qinggangjian 7/xuanfeng 6 全过，fazheng 8/3（既有眩惑基线）、cixiong 17/3（既有基线）；14 文件 `node --check` 全过。
- **待办**：D1 真机验证（用户实操多浏览器联机，验证清单已交付）。

## P1 提示词增强(G1 通用策略 + G3 score 语义，提示词增强批次)

- **目标**：默认 system/user prompt 从"极简模板"增强为带决策启发式与 score 语义说明，提高 AI 选 index 的局面对话质量。spec：`docs/superpowers/specs/2026-08-03-prompt-enhance-design.md` §2.1/§2.3。**纯提示词文本改动，零逻辑变化**。
- **G1 通用策略（`buildBotDefaultSystemPrompt`，bot-ai-bus.js）**：在原有"根据局面与武将技能说明，从候选列表选一个index/只能选列表内选项/只输出 {"choice":数字}"后追加一段：`决策参考(是判断优先级的参考,不是必须遵守的硬规则):1点体力大致相当于2张手牌的价值;关键防御牌(无懈/闪/桃)要留到关键时刻,别为试探而消耗;手牌耗尽裸拼往往替别人火中取栗;多数决策宁可保守不出,也不要打空自己。`——显式声明"参考非硬规则"，防模型把启发式当约束拒绝合法选项。
- **G3 score 语义（`buildBotDefaultUserPrompt`）**：候选白名单序列化字段与改动前**逐字一致**（index/label/action/card/seat/handIndex/cardIdx/target/targets/pickKey/discardIndices，`localHeuristicScore` 本身仍不进 JSON、不泄露内部计算），其后追加条件段：`hasScore = (candidates||[]).some(c => typeof c.localHeuristicScore === 'number')`，仅候选含数字 score 时拼接 `\n\n说明:localHeuristicScore是本地算法的参考分,只是排序参考,不代表最优解;请结合局面与你的判断选择,不一定要选分数最高的。`——防止模型机械选最高分；无 score 时不加说明（省 token、无噪声）。`buildBotDefaultUserPrompt(state, candidates)` 形参列表不变，`callAiChooseIndex`/`botDecide`/`bot.js` 调用点零改动。
- **测试（`run_ai_bus_core_test.js` 追加 3 项，core 7→10）**：①`buildBotDefaultSystemPrompt()` 含"1点体力"；②`buildBotDefaultUserPrompt({phase:'play'}, [{localHeuristicScore:50}])` 含"参考分"；③无 score 候选（`[{action:'出',label:'x'}]`）**不含**"参考分"（条件拼接守卫）。**TDD**：RED=8/2（新断言 8/9 失败、10 因现状"无 score 无说明"天然通过——该断言是防"条件拼接漏判/无条件全加"的回归守卫，无法先红属预期，符合 brief 指定的断言形态）→ 实现 → 10/10 GREEN。
- **过程坑**：edit 工具误匹配吞掉既有测试 7 的 `async` 关键字（`await check(... async function(){...})` 变 `function(){...}` → `SyntaxError: await is only valid in async functions`），跑测试立刻暴露，补回 `async` 后恢复——RED 步骤顺带把预存测试环境也验证了一遍。
- **回归**：core 10/0、l3 138/0、l1 21/0；`node --check bot-ai-bus.js` 通过；`?v=304→305` 替换前/后各 14 处（脚本校验）。
- **改动范围**：`bot-ai-bus.js`、`run_ai_bus_core_test.js`、`index.html`（`?v=304→305` ×14）、`TASKS.md`。commit `feat(ai): 提示词G1通用策略+G3score语义` → HTTPS push `wenwen_dev`（ac3212e..5620ea5）。

## 提示词增强批次（P1-P3，G4 已取消）

- **P1 G1 通用策略 + G3 score 语义**：默认 system prompt 追加价值框架（1血≈2牌、留关键防御牌、别裸拼）；userPrompt 候选含 localHeuristicScore 时追加"参考分,非最优"说明（条件拼接，响应类无 score 不带）。
- **P2 G5 决策思考链**：dying/duel/aoeResp/discardSubset/pickSlot/L1 controlsChoice 六处 prompt 追加 1-2 句思考引导（敌我判断/胜负预期/血量宽裕/保留优先/目标价值/值不值得）。
- **P3 G2 响应类身份引导**：新增 `botPromptWithIdentity(base,g,seat)` helper（拼接 `botIdentityGuidance`）；dying/duel/aoeResp/jiedaoResponse/xiaoguo/enyuanGiveCard/guhuo/ganglie/controlsChoice 九处 buildSystemPrompt 改有参 (g,seat) 包 identity。仅身份局生效（ffa 空串）。无参 buildSystemPrompt 改有参后 `botDecide` 传参兼容，既有测试回归绿。
- **G4 记牌感知已取消**（用户确认不做，维持删除弃牌堆统计）。
- **测试**：core 10（+3）、l3 149（+6 P2 +5 P3）；AI-bus 10 套件 336 项全绿；14 文件 `node --check` 全过；`?v=304→307`。

## token 优化二轮：desc 按需截断 + 候选去冗余

- **实测基准**（7 人身份局出牌）：单次决策 userPrompt ≈6900 字符 ≈1800-2000 tokens（局面投影 ~57% + 候选 ~43%）。
- **改动**：①`buildBotVisibleState` generalDesc **自己全量、他人截断 60 字**（他人技能名+短描述足够判断威胁，省 ~480 字/次）；②候选 label 去掉冗余"本地分N"（`localHeuristicScore` 字段已有、hasScore 说明已解释"参考分"，label 不重复）。
- **测试**：info +1（7 人局 desc 截断断言）、l2 +1（label 无"本地分"断言）；info 17/l2 24/core 10/l3 149/c_window 34 全绿。
- **改动范围**：`bot.js`、`run_ai_bus_info_test.js`、`run_ai_bus_l2_test.js`、`index.html`（`?v=307→308` ×14）。

## 合并前审计与清理（chengcheng_dev 分支收尾）

- **背景**：`chengcheng_dev`（源自 `wenwen_dev`）合并进 `main` 前做的一次全量审计，四条并行审查线（AI prompt 隐藏信息边界/篇幅、核心逻辑正确性、测试质量、文档一致性）分别核实，发现的问题里唯一需要用真实数据重新核实的是"prompt 篇幅是否超过 600 tokens 上限"——此前的篇幅验证一律用"字符数/4"估算中文文本的 token 数，这是英文经验值，不适用于中文场景。
- **token 上限重新核实（用真实 tokenizer，不再用字符数估算）**：装了两个离线 tokenizer 库（`js-tiktoken` 对应 cl100k_base/GPT-OpenRouter 系，`@anthropic-ai/tokenizer` 对应 Claude），在 vm 沙箱里加载真实源码直接调用 `buildBotPlaySystemPrompt`/`buildBotTargetSystemPrompt`/`buildBotGuhuoSystemPrompt`/`buildBotGanglieSystemPrompt`/`buildBotGuicaiSystemPrompt` 拿到完整 system prompt 字符串喂给 tokenizer。**结果**：中文场景真实字符/token 比率约 1.0~1.2（不是估算用的 4），此前"342/276/318/426 tokens"这批数字系统性低估了约 3~4 倍；重新核实后最长的版本是 `BOT_PLAY_SYSTEM_PROMPT` 身份局-忠臣（zhong）版本，约 727 Claude tokens / 812 cl100k tokens。**结论**：600 这个硬上限确实定得偏保守，但没有到需要精简内容的程度——超支的清一色是"通用策略+身份局四阵营指导"叠加后的版本，其中内奸三阶段模型/忠臣阵营那两段本来就是刻意压缩过的引导性叙述，继续精简的空间有限、且会损害判断力；换算成 Claude Haiku 定价，多出的 ~200 token 增量成本仍是可忽略的量级，和当初定 600 上限时"成本可忽略"的判断依据完全一致，只是当时对篇幅本身的估算是错的，对成本结论没有影响。**处理**：把设计预算正式从 600 上调到 **850 tokens**（略高于当前最长版本 812，留一点余量），不改动任何 prompt 内容本身。**这个数字目前只存在于文档/注释里，从未落成过代码常量或测试断言的硬编码阈值**（全项目 grep 未找到任何 `600` 作为 token 判断依据出现在 `.js` 文件里），所以本次调整没有代码改动，只是把 `docs/progress-log-7.md` 里记录的旧估算值理解为"过时的、用错误方法算出的数字"，以本条为准——以后任何地方再提到 prompt 篇幅上限，应该引用 850 这个数字和这条记录，不要再引用 progress-log-7 里那批基于字符数估算的旧数字。
- **`docs/methodology.md` 补充一条通用教训**：验证 AI prompt 篇幅必须用真实 tokenizer（`js-tiktoken`/`@anthropic-ai/tokenizer` 这类离线库），不能用"字符数/N"估算——这两个库都能离线跑、几行代码就能拿到准确数字，没理由继续用估算糊弄。
- **`g.aiRebelSuspicion` 补 normalize 防御**（`game.js` `normalize()`，紧跟 `aiSuspicionEvents` 校验之后）：这是 `bot.js` 按座位累计嫌疑分的缓存对象，此前只在写入点用 `g.aiRebelSuspicion=g.aiRebelSuspicion||{}` 懒加载、读取点用 `(g.aiRebelSuspicion||{})[seat]||0` 兜底，从未在 `normalize` 里统一防御——不是活跃 bug（Firebase 吞空对象读回 `undefined`，两处 `||{}` 已经够用），但违反"新增持久化字段必须在 normalize 补默认值"的既有约定。补上：容器非对象/是数组时回退 `{}`；键值非 `number`/非 `isFinite` 时删除该键（双重保险，写入端本身已有 `Math.max(-100,Math.min(100,...))` 约束）。
- **`completeLordAsk` 缺两处联动触发——记录为已知 latent gap，本次不修**：`game.js` 的 `completeLordAsk`（激将/护驾求助响应完成时的收尾函数）是手写镜像 `duelResponse`/`aoeRespond` 的出杀/出闪分支，但没有照抄两处细节——替代出杀的牌若是龙胆/武圣转化而来的（牌名与"杀"不同）不会触发 `markSkillSound`；替代出闪的牌若自身是"闪"，不会触发张角【雷击】。核实过这**不是新引入的回归**——于吉【蛊惑】的 `resolveGuhuoResponseSha`/`resolveGuhuoResponseShan`（`completeLordAsk` 注释里明确说是照这套模式写的）本来就有同样的两处省略，是项目里已经存在、被沿用的简化，不是这次分支引入的新缺陷。影响面：只有当代替主公响应的那个人恰好也是龙胆/武圣/张角持有者时才会少触发一次联动，属于边界场景。留待以后统一排查"手写镜像响应函数"这类模式时一并处理，不在本次修复范围。
- **文档清理**：①`docs/README.md` 补充说明 `docs/superpowers/` 目录（16 个文件约 5000 行，是这次大批次开发的过程性规划/设计文档，最终结果已完整收进对应 progress-log 条目，不是需要长期维护的现状文档，此后不会同步更新）；②删除 `docs/ai-bus-change-summary.md`——这是某个中间时间点的快照（文末仍写"响应超时/托管：未做"、"分支 wenwen_dev 尚未并入 main"，均已过期），内容和 progress-log-7/8 高度重复，且未被 `docs/README.md` 索引，删除比保留一份误导性快照更安全，最新状态以 progress-log 为准。
- **回归**：AI-bus 10 套件（core/info/l1/l2/l3/c_window/lordskill/model_picker/summary/timeout）共 338 项全绿；仓库既有 `identity`35/0、`lidian`ALL PASSED、`qinggangjian`6/0、`xuanfeng`5/0、`fazheng`8/3（既有眩惑损坏基线，未变）、`cixiong`17/3（既有基线，未变）；13 个核心文件 `node --check` 全过。
- **改动范围**：`game.js`（normalize 补 `aiRebelSuspicion` 防御）、`docs/README.md`、`docs/methodology.md`、`docs/ai-bus-change-summary.md`（删除）、`index.html`（`?v=308→309` ×14）。
- **合并判断（如实给出）**：以本次四线审计+这批清理的结果看，**这个分支目前不存在会阻塞合并的问题**——审计发现的问题里，最严重的两项（token 篇幅估算偏差、`aiRebelSuspicion` 缺 normalize 防御）都已经在这次处理；剩下的 `completeLordAsk` 两处联动缺口是已知且影响面很小的 latent gap，按既有惯例记录在案即可，不需要在合并前解决；文档一致性问题（superpowers 未索引、change-summary 过期重复）也已清理。回归套件零变化、`node --check` 全过。**没有遗留需要用户拍板才能继续的技术问题**——是否合并、以什么方式合并（直接 merge 到 main、还是走 PR），这一步本身按项目既定原则（改动原则第10条）需要用户确认后再执行，我不会自行 push/merge 到 main。

## 机器人调度盲区收尾（悲歌/乱武/旋风，存量待办最后三项）

- **背景**：上一条审计任务里用真实浏览器(Playwright)+真实Firebase 做的自然对局dump发现——`beigeChoose`（蔡文姬【悲歌】）、`luanwuChoose`（贾诩【乱武】）、`xuanfengPick`（凌统【旋风】）三个 phase 从 main 分支起就一直没有登记进 `BOT_PHASE_ACTOR`，`scheduleBotTurn`→`botSeatForState` 对这三个 phase 恒返回 `-1`，调度请求直接走 `runBotFallbackProbe`→`botSafePrompt` 兜底，**永远碰不到 `runBotDecision` 函数体，更碰不到 L1 的 AI 判断入口**——真实dump用mock `callAI` 验证过，即便配置了AI密钥，`callAI` 也从未被调用。这不是这次一系列分支改动引入的回归（`git show main:bot.js` 核对过 `BOT_PHASE_ACTOR` 表同样缺这三项），是该分支已经补齐的30多个同类盲区里唯二剩下的存量待办，本次任务专门收尾。
- **`beigeChoose`（是否发动悲歌）**：注册 `BOT_DECISIONS.beigeChoose`（候选=不发动/发动，发动项只在真有牌可弃时才提供，镜像 `triggerBeige` 自己的 `canDiscard` 判断）；无密钥回退=不发动（与改动前逐字一致，本次任务明确认可的默认）；`extraState` 投影受伤角色/伤害来源是否是自己（公开信息）；`buildSystemPrompt` 说明四种判定结果+让AI判断是否值得牺牲一张牌。
- **`beigeDiscard`/`beigeJudge`（悲歌决定发动后的两个后续步骤）**：这两步是"已经决定发动，只是选具体弃哪张牌/纯确认点击进行判定"，没有真正的策略含量（同断粮/奇袭"牌维度不交AI"的既有惯例），走确定性 `runBotDecision` 分支而不接AI——有手牌先弃手牌，没手牌弃第一个非空装备槽；`beigeJudge` 直接调 `doBeigeJudge()`。**这两步是本次任务主动补的**：只登记 `beigeChoose` 而不管后续步骤,一旦AI(有密钥场景)选了"发动",链条会卡在 `beigeDiscard`(同样是未登记的盲区),等于把盲区从第一步挪到第二步——不是真正修复。
- **`luanwuChoose`（乱武使用杀/失去体力，强制二选一）**：注册 `BOT_DECISIONS.luanwuChoice`；无密钥回退=镜像 `render-controls.js` 的 `shaAvailable` 判断（`hasShaCard`+`canReachSha`+目标存活），能出杀就出杀否则失去体力。**这个 phase 此前的兜底比悲歌更差**：两个自定义按钮文案（"对X使用【杀】"/"失去1点体力"）都不命中 `botSafePrompt` 的安全/必选正则，两个按钮同时存在时（可以出杀）连"唯一按钮"兜底都用不上，真实dump确认这种情况下是**真正点不到任何按钮的卡死**（不是"保守decline"）；只有不能出杀只剩一个按钮时才侥幸走通。
- **`xuanfengPick`（旋风选目标+选牌，多阶段）**：`BOT_SEAT_PICKS.xuanfeng`（'selecting'阶段的 match/buildSeatCandidates/fallbackSeat/execute 四件套）**其实早就写好了**，且已经在 `runBotDecision` 里接了线——但因为 `xuanfengPick` 不在 `BOT_PHASE_ACTOR` 里，这条接线全程是死代码。本次只需登记 `BOT_PHASE_ACTOR.xuanfengPick='from'`，这套已写好的AI接入立刻生效，不需要重新实现。额外补的是 'chooseCard' 阶段（选具体从哪个已选目标身上弃哪张牌）——这一步之前完全没有任何机器人处理，同样走确定性分支（牌维度不交AI，优先装备/判定区，没有则随机手牌），选完/exhausted 则退回 'selecting' 阶段（镜像人类UI的"返回选择目标"按钮）。
- **接线时发现并修的一个真实边界（`BOT_SEAT_PICKS.xuanfeng.buildSeatCandidates`）**：原实现只按"存活+非自己"筛候选，不看这个目标是否已经没有牌可弃——一旦把 dispatch 接通，AI（或本地兜底）反复选中一个已经被弃完的目标会被 `pickXuanfengTarget` 自己的 `available<=0` 守卫静默拒绝（不改变任何状态），造成"选目标→选牌阶段发现没牌可选→退回选目标→又选中同一个已耗尽目标"的死循环——**真实dump用固定返回同一 index 的 mock AI 复现过**（3人局，机器人反复选中已经被弃完的座位2，AI调用次数持续增加、状态卡在 `selecting`/`chooseCard` 之间不前进）。修法：`buildSeatCandidates` 补上"扣除本轮已经从该目标身上选走的牌数后，是否还有余量"的过滤（`render-controls.js` 的人类UI选目标按钮本来就有类似的 `available>0` 判断，只是没有扣除本轮已选——这次顺带对齐得更完整）。**既有测试同步更新**：`run_ai_bus_l3_test.js` 里"旋风目标候选=存活非自己"这条 TDD 锚定的旧契约测试补上目标手牌（否则候选会变空），新增一条"候选排除确实没有牌可弃的存活目标"验证新过滤本身；这不是弱化断言迎合实现，是这次任务主动发现的真实边界，契约变得更严格（更贴近真实UI），旧测试的手工数据需要跟进补全，不是回归。
- **一个容易踩的坑，真实踩过（`CONTROLS_CHOICE_EXCLUDE`）**：一开始只注册了 `BOT_DECISIONS.beigeChoose`/`luanwuChoice` + 专用 `runBotDecision` 分支，忘了把这几个 phase 加进 `CONTROLS_CHOICE_EXCLUDE`——`beigeChoose`/`luanwuChoose` 的 controls 渲染的是**真实DOM按钮**（`createElement('button')`），L1（`controlsChoice`）的通用按钮扫描机制会抢先接管；而 L1 自己扫描到的按钮顺序（DOM渲染顺序：发动=index0/不发动=index1）**和** `BOT_DECISIONS.beigeChoose` 自己的候选顺序（不发动=index0/发动=index1）刚好相反——真实dump复现过"mock AI 明明选了 choice:1（语义上是'发动'），执行出来却是'不发动'"，根因是 L1 抢先接管、AI的 index 按 L1 自己的按钮顺序执行了。加进 `CONTROLS_CHOICE_EXCLUDE` 后 L1 让位给专用分支，问题消失——这正是 jijiangAsk/hujiaAsk/zhibaAsk/yijiAssign/lirangAsk 那批注释里反复强调"必须收录"的同一个坑，这次真的踩了一遍，值得再次强调。
- **测试**：真实浏览器（Playwright headless Chromium）+ 真实Firebase 房间，覆盖：①`beigeChoose` 无密钥回归（"不发动"，逐字一致）；②`beigeChoose` 有mock密钥选"发动"，验证AI真的被调用（此前callAI从未被调用）且完整走完 discard→judge 全链条（弃牌+判定牌+判定结果全部正常）；③`luanwuChoose` 有杀/无杀两种情况分别验证选 sha/hp；④`xuanfengPick` 2人局+3人局两种规模，3人局验证AI真的被调用（2人局候选数=1时走 `botDecide` 自身的"唯一候选跳过AI"短路，AI调用次数=0是预期而非bug）；⑤`xuanfengPick` 无密钥回归（"不发动"，逐字一致）；⑥用固定mock复现过 buildSeatCandidates 死循环bug后确认修复生效（8次轮询确认最终正常推进到下一玩家回合，不再卡在 selecting/chooseCard 之间）。仓库既有测试：AI-bus 10套件（core10/info17/l1 21/l2 24/**l3 150**(+1)/c_window34/lordskill45/model_picker17/summary13/timeout8）全绿；既有6套件（identity35/0、lidian ALL PASSED、qinggangjian6/0、xuanfeng5/0、fazheng8/3既有基线未变、cixiong17/3既有基线未变）与改动前完全一致；13个核心文件 `node --check` 全过。
- **范围声明（按用户要求，只报告不顺手改）**：本次排查过程中没有发现第四个/第五个同类调度盲区——`BOT_PHASE_ACTOR` 现在已覆盖 `botFallbackSeats`(未知阶段兜底)之外的所有已知交互阶段。如果未来新增技能又踩到同一类坑，参照本条+ jijiangAsk 那批的排查方法：先查 `BOT_PHASE_ACTOR` 有没有登记、有专用注册的话有没有进 `CONTROLS_CHOICE_EXCLUDE`。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 三项+`CONTROLS_CHOICE_EXCLUDE` 四项+`BOT_DECISIONS.beigeChoose`/`luanwuChoice` 两个新注册+`runBotDecision` 五个新分支+`BOT_SEAT_PICKS.xuanfeng.buildSeatCandidates` 过滤修复）、`run_ai_bus_l3_test.js`（更新3条既有测试+新增1条）、`index.html`（`?v=309→310` ×14）。

## 机器人调度盲区系统性扫描 + 紧急项修复（烈刃/强袭）

- **背景**：修完悲歌/乱武/旋风/巧变这4个盲区后，用户要求不要再逐个被动排查，一次性系统性扫描全部武将/装备技能。方法：脚本提取 `game.js`/`skills.js`/`weapons.js`/`room-lifecycle.js` 里全部 `g.phase='xxx'` 赋值（112个），减去 `BOT_PHASE_ACTOR` 已注册的49个+`botSeatForState` 特殊处理的9个（wugu/pickingLordGeneral/pickingGeneral/draw/play/discard/lobby/over/end），得到56个候选，逐个在 `bot.js` 全文搜索引用——**50个（不含`qiaobianTurnStart`）在 `bot.js` 里零引用**，比预想的"零星几个"严重得多。
- **候选真空扫描（②类问题，武圣同类）**：抽查了全部4个 `canUseAs` 转化能力——**龙胆（赵云,闪→杀主动使用方向）确认零覆盖**（`bot.js` 对 `longdan`/`qingguo` 零引用，连 `BOT_SEAT_PICKS` 注册都没有，比武圣的"部分真空"更彻底，是全新发现）；双雄（颜良文丑）确认无真空（`canShuangxiongDuelCard` 纯按颜色比对，不依赖 `resolveActionId`，不会踩武圣那个坑）；倾国（甄姬，黑牌→闪）不适用（闪只能被动响应，不经过有问题的主动出牌枚举路径）。
- **50个盲区按自动化抽样(按钮文案是否命中`botSafePrompt`正则)初步分级**，标记出好施(鲁肃)/烈刃拼点响应(祝融)/乱击选牌(袁绍)/强袭选目标(典韦)/挑衅(姜维)/天义(太史慈,结构特殊)这6项抽样没找到安全按钮、风险等级更高，随即真实dump逐一确认：
  - **好施**：不卡死，"交给 X"命中必选正则，只是判断不智能（永远交给第一个候选）。
  - **烈刃拼点响应（lieRenRespond）**：**确认真卡死**——按钮文案是纯牌面拼接（"【闪】♠5"），不命中任何正则、无取消选项，候选(手牌)≥2时彻底点不到任何按钮，6轮驱动状态完全不变。
  - **乱击选牌（luanjiChoose）**：**确认真卡死，但根因和机器人调度完全无关**——深挖发现这是一个**渲染层bug**：`startLuanji()`把`g.phase`设成`'luanjiChoose'`，但`render-controls.js`渲染这个选牌面板的分支被写死嵌套在`else if(g.phase==='play')`大分支内部（3328行起），两者永远对不上，这个选牌面板**对任何人（真人也一样）永远渲染不出来**，不是"机器人技能盲区"，是这个技能上线以来就没法正常使用。已确认不属于本次机器人调度修复范围，需要单独立项修`render-controls.js`（要么挪出渲染分支、要么让`startLuanji`保持`g.phase='play'`），本次不处理。
  - **强袭选目标（qiangxiPickTarget）**：**确认真卡死**——按钮文案是目标的纯姓名（代码注释明确"消耗支付后不可取消,因此不提供取消按钮"，属于有意设计），候选≥2时同样不命中任何正则。
  - **挑衅（tiaoxinChoice/tiaoxinDiscard）**：机器人真正会碰到的那一步（`tiaoxinChoice`，被挑衅的目标是机器人）不卡死——"被弃置一张牌"命中必选正则，真实dump3秒内正确推进到下一阶段。`tiaoxinDiscard`（发起者选弃哪张牌）目前不会轮到机器人（机器人从不主动发动挑衅，没有入口，同乱击/强袭/天义的发动方一样），非当务之急。
  - **天义（tianyiPickCard/tianyiPickTarget）**：**不是机器人专属问题，是死代码**——`startTianyi()`（会产生这两个server phase）在整个代码库里从未被任何UI按钮调用过（`grep`确认零调用点），真实的天义交互全部走`render-controls.js`里的客户端本地`tianyiMode`累积模式，最后一次性调`pickTianyiTarget`直接提交，全程不经过这两个server phase。真实dump手工构造出`tianyiPickCard`状态后确认真卡死，但这条路径本来就没人（人类或机器人）会走到，不需要为其设计特例机制。机器人真正需要覆盖的响应方(`tianyiRespond`)早就注册过了，发动方入口缺失和乱击/强袭同属"自主发起类技能机器人不会主动用"这一档，不紧急。
- **本次紧急修复：`lieRenRespond`+`qiangxiPickTarget`**——两个确认真卡死的盲区。`BOT_PHASE_ACTOR` 补登记（`lieRenRespond:'targetSeat'`、`qiangxiPickTarget:'seat'`）+`CONTROLS_CHOICE_EXCLUDE` 补收录（虽然没有注册`BOT_DECISIONS`、不存在候选顺序错位风险，但收录后保持"无密钥固定选第一项"这套确定性兜底不受AI密钥状态影响，和其它专用分支收录同一原则）+`runBotDecision`补两个确定性分支：烈刃固定选手牌第一张(`respondLieRen(0)`)、强袭固定选候选第一个目标(`pickQiangxiTarget(candidates[0])`)——都不追求判断哪个更好，目标只是消除卡死，和悲歌选牌/旋风chooseCard阶段"牌维度不交AI"同一惯例。
- **测试**：真实浏览器+真实Firebase构造候选≥2的真实场景，验证修复前后对比——烈刃修复前6轮驱动状态不变，修复后3秒内推进（"真人 出♣9,机器人1出♠5,拼点真人赢"→回到play阶段）；强袭修复前6轮驱动状态不变，修复后3秒内推进并正常走完整个回合（play→discard→下一玩家）。`run_ai_bus_l3_test.js` 新增3项断言（`respondLieRen`/`pickQiangxiTarget` 分别被正确调用为固定候选、`BOT_PHASE_ACTOR` 登记核对），l3从150增至153，AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），13个核心文件`node --check`全过。
- **本次系统性扫描的完整分类结论（供后续任务查阅，不需要重新扫描）**：
  1. **本次已修复（紧急，真卡死）**：`lieRenRespond`、`qiangxiPickTarget`。
  2. **单独立项，不属于机器人调度范畴**：`luanjiChoose` 的渲染层bug（`render-controls.js` 3328行附近，`g.phase` 与渲染条件不匹配，人类也用不了）。
  3. **不紧急，留作第二批批量处理（有兜底但判断不智能，或者是"发动方入口缺失但不卡死"这类低优先级）**：好施(haoshiPick)、挑衅的`tiaoxinDiscard`步骤、以及本轮扫描出的其余约48个 `bot.js` 零引用phase（闭月/不屈/称象/仁心/雌雄双股剑/贯石斧/寒冰剑/青龙偃月刀/化身第二批/裸衣/节命/新生/酒诗②/雷击/连营/乱击确认步骤/明策/巧变第一步 `qiaobianTurnStart`(已在上一批修复中处理)/趫猛/忘隙/耀武/神速/双雄判定/制蛮 等，详细名单见本文件同一批次"机器人调度盲区系统性扫描"记录）——**举荐(徐庶)/据守(曹仁)因为每回合结束都可能触发,优先级最高,已作为"第二批-第1组"率先修复,见下一条记录**。
  4. **确认无需处理**：眩惑(法正,huanhuo系列)技能本体已知损坏，天义(taishici)的`tianyiPickCard`/`tianyiPickTarget`是死代码，龟壳(guanshi等)/龙胆(longdan)主动使用方向确认零覆盖但暂未收到用户明确的修复优先级指示。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 两项+`CONTROLS_CHOICE_EXCLUDE` 一项+`runBotDecision` 两个新确定性分支）、`run_ai_bus_l3_test.js`（新增3项断言）、`index.html`（`?v=310→311` ×14）。

## 第二批-第1组：徐庶【举荐】+曹仁【据守】（每回合结束都可能触发，优先级最高）

- **背景**：上条记录的分类第3项里点名"举荐/据守优先级最高"，本次专门处理这两个。区别于烈刃/强袭那批"真卡死"，这两个**此前就已经有"取消"按钮能命中`botSafePrompt`安全正则，不卡死，只是缺乏真正判断**（举荐永远走安全正则误打误撞点到的第一个匹配按钮、据守走`botFallbackSeats`兜底但没有专属逻辑）——本次要修的是判断力，不是消除卡死。
- **举荐三段**：`jujianPickCard`/`jujianPickTarget` 的行动者是 `pending.sourceSeat`（徐庶本人）；`jujianChooseEffect` 的行动者是 `pending.targetSeat`（被举荐的目标，可能是另一个人，不是徐庶自己）——三段行动者字段不同，`BOT_PHASE_ACTOR` 分别登记。决策设计（确定性，不接AI）：
  - `jujianPickCard`：固定"不发动"（`cancelJujian()`）——举荐是纯利他技能，发动要付出一张非基本牌的代价，保守默认不发动，符合项目里"没有明确收益就不主动消耗资源"的既定基调（同断粮/奇袭/国色/武圣等 L3 转化技能的默认）。
  - `jujianPickTarget`：防御性兜底（固定选`candidates[0]`），理论上 `jujianPickCard` 固定不发动后永远不会推进到这一步，只是为了万一以后接了AI或有别的入口能推进到这里时不留死代码陷阱。
  - `jujianChooseEffect`：这一步的行动者是被举荐的目标（可能是另一个玩家的机器人，牌已经弃出去了、按代码`cancelJujian`对这个类型直接拒绝、不可取消），三个选项对目标都是纯收益——体力未满选`recover`（回复更划算），体力已满选`draw`（避免选`recover`触发"体力已满,举荐回复无效果"这种空转）。
- **据守**：单一二选一（`confirmJushou`摸3张牌+翻面 vs `cancelJushou`不发动），行动者是 `pending.seat`。决策设计：手牌`≤3`张时发动（用一次翻面换3张牌，手牌薄的时候值这个代价），手牌`>3`时不发动（已经不缺牌，没必要承担翻面的代价）——简单条件判断，不追求比这更细。
- **`CONTROLS_CHOICE_EXCLUDE`**：四个phase（`jujianPickCard`/`jujianPickTarget`/`jujianChooseEffect`/`jushouChoose`）都补收录，和之前几批同一原则——保持"无密钥固定策略"这套确定性兜底不受AI密钥状态影响。
- **测试**：真实浏览器+真实Firebase构造4个真实场景：①举荐`jujianPickCard`（机器人是徐庶）→"机器人1 取消【举荐】"→正确推进；②举荐`jujianChooseEffect`（机器人是目标，体力2/4）→"机器人1 因【举荐】回复1点体力"→正确推进；③据守（曹仁手牌1张）→"机器人1 发动【据守】,摸了三张牌并翻面"→正确决策；④据守（曹仁手牌5张）→"机器人1 取消发动【据守】"→正确决策。`run_ai_bus_l3_test.js` 新增7项断言（固定不发动/防御性选target[0]/体力未满选recover/体力已满选draw各一条+据守两种手牌量各一条+`BOT_PHASE_ACTOR`登记核对），l3从153增至160，AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），13个核心文件`node --check`全过。
- **第二批剩余清单（供下一组继续处理时直接查阅，不用重新扫描）**：好施(haoshiPick)/挑衅`tiaoxinDiscard`步骤/闭月(貂蝉)/不屈(周泰)/称象+仁心(曹冲)/雌雄双股剑+贯石斧+寒冰剑+青龙偃月刀(装备武器特效)/化身第二批(左慈,huashenChangePickEnd/Start)/裸衣(许褚)/节命+新生(荀彧/左慈)/酒诗②(曹植)/雷击(张角)/连营(陆逊)/乱击确认步骤(袁绍,选牌步骤是渲染bug已单独立项,确认步骤本身未测)/明策(陈宫)/趫猛(公孙瓒)/忘隙(李典)/耀武(华雄)/神速(夏侯渊)/双雄判定(颜良文丑)/制蛮(马谡)——无特定优先级顺序，可按下一组任务需要挑选。`luanjiChoose`渲染层bug仍未修，独立于此列表。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 四项+`CONTROLS_CHOICE_EXCLUDE` 四项+`runBotDecision` 四个新确定性分支）、`run_ai_bus_l3_test.js`（新增7项断言）、`index.html`（`?v=311→312` ×14）。

## 第二批-第2组：雌雄双股剑+贯石斧+寒冰剑+青龙偃月刀（装备类4个，同一套结构）

- **背景**：四件武器特效都是"杀命中/被闪抵消时可选触发"的同一类结构，此前均未接入调度（`bot.js` 零引用），均属"有安全兜底、不会卡死"档，本次批量补基础判断力。
- **雌雄双股剑**：`cixiongAsk`（行动者=`pending.from`，装备者/攻击者本人）+`cixiongChoice`（行动者=`pending.to`，被指定的异性目标）——和举荐一样前后两段行动者字段不同，分别登记。决策：`cixiongAsk` 固定发动（对攻击者没有任何下行风险，要么令目标弃牌要么自己白摸一张）；`cixiongChoice` 固定选"弃一张手牌"（两个选项对目标都是纯损失，不追求判断哪个更优，代码保证走到这一步时目标手牌非空）。
- **贯石斧**：`guanshi`（行动者=`pending.from`）。固定发动（花2张牌让已被闪抵消的杀依然命中，和这批其余三个装备特效同一进攻性基调）；选牌不追求判断哪张更值，手牌优先、装备槽垫底，固定取前2个可弃项（`canStartGuanshifu` 已保证选项数≥2）。
- **寒冰剑**：`hanbingAsk`（行动者=`pending.from`；发动后进入的弃牌子阶段 `hanbing` 此前已经登记过，本次只补"是否发动"这第一问）。固定发动（防止本次杀的伤害，改为让目标弃两张牌，通常比单纯1点伤害更有价值）。
- **青龙偃月刀**：`qinglong`（行动者=`pending.from`）。**这个不能无脑固定发动**——踩了CLAUDE.md规则26同一个坑：曹彰【将驰】本回合禁杀（`jiangchiNoSlash`）或手里没有能当杀的牌时，`respondQinglong` 会原地拒绝，盲目发动会让机器人卡在原地。修法是先用 `findUsableAs(hand,me,'杀')` + `!me.jiangchiNoSlash` 探测能不能真的发动，能则发动（再来一次杀），不能则不发动——"先探测再决策"而不是"先假设能发动"。
- **`CONTROLS_CHOICE_EXCLUDE`**：五个phase（`cixiongAsk`/`cixiongChoice`/`guanshi`/`hanbingAsk`/`qinglong`）都补收录，同一原则。
- **测试**：真实浏览器+真实Firebase构造6个真实场景（雌雄双股剑发动+选弃牌各一、贯石斧发动命中、寒冰剑发动、青龙偃月刀有杀发动+无杀不发动各一）——全部日志确认按预期决策并正确推进（部分场景因为目标是人类座位，决策完成后停在"等待真人响应"是正常现象，不是卡死，日志已清楚显示机器人侧的决策本身已经正确完成）。`run_ai_bus_l3_test.js` 新增7项断言（含青龙偃月刀"先探测再决策"的两个反例：无可用杀/将驰禁杀分别验证不发动），l3从160增至167，AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），13个核心文件`node --check`全过。
- **第二批剩余清单（更新，供下一组继续处理时直接查阅）**：好施(haoshiPick)/挑衅`tiaoxinDiscard`步骤/闭月(貂蝉)/不屈(周泰)/称象+仁心(曹冲)/化身第二批(左慈,huashenChangePickEnd/Start)/裸衣(许褚)/节命+新生(荀彧/左慈)/酒诗②(曹植)/雷击(张角)/连营(陆逊)/乱击确认步骤(袁绍)/明策(陈宫)/趫猛(公孙瓒)/忘隙(李典)/耀武(华雄)/神速(夏侯渊)/双雄判定(颜良文丑)/制蛮(马谡)——无特定优先级顺序。`luanjiChoose`渲染层bug仍未修，独立于此列表。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 五项+`CONTROLS_CHOICE_EXCLUDE` 五项+`runBotDecision` 五个新分支，其中青龙偃月刀含"先探测再决策"的可用性检查）、`run_ai_bus_l3_test.js`（新增7项断言）、`index.html`（`?v=312→313` ×14）。

## 第二批-第3组：颜良文丑【双雄】+张角【雷击】

- **背景**：延续第二批批量处理节奏，本组挑了"摸牌阶段开始/闪响应后可选发动"的判定类结构，两者代价/收益方向恰好相反，是一次很好的"不要无脑套用同一个默认"的对照案例。
- **双雄（shuangxiongAsk，行动者=`pending.seat`）**：固定不发动。发动的代价是放弃本回合正常摸牌（损失2张牌），换来的只是给后续决斗设一个可用花色（`shuangxiongColor`），代价明确、收益不确定——和举荐同一基调，没有明确收益不主动付代价。
- **雷击（leijiChoose 是否发动+选目标 / leijiJudge 进行判定的确认点击，行动者都是`pending.sourceSeat`）**：**固定发动**——和双雄恰好相反，雷击对发动者没有任何下行风险（不弃牌不摸牌，纯粹是"判定一张牌，黑桃就白得2点伤害"的免费加成），固定发动+固定选候选目标第一个，和落英/洛神同一基调（没有下行风险就默认总是尝试）。`leijiJudge`是纯确认点击，没有选择，和悲歌的`beigeJudge`同一模式。**特别记录**：`doLeijiJudge(g)`函数签名带`g`参数但函数体内部`tx(g=>{...})`的箭头函数参数把外层`g`完全遮蔽，外层参数实际从未被引用——`botInvoke(seat,doLeijiJudge)`不传参照样能工作，这是既有代码的一个无害遗留写法（非本次引入，未改动，仅记录避免以后误以为需要传参修复）。
- **测试**：真实浏览器+真实Firebase构造3个场景：①双雄→"机器人1：不发动【双雄】"→正常摸牌出杀；②雷击选目标(2候选)→"对真人发动【雷击】,进行判定"→"判定为♥5,雷击无效"→正确推进；③雷击直接进行判定→"判定为♠5,受到2点雷电伤害"→正确推进。`run_ai_bus_l3_test.js`新增4项断言，l3从167增至171，AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），13个核心文件`node --check`全过。
- **第二批剩余清单（更新）**：好施(haoshiPick)/挑衅`tiaoxinDiscard`步骤/闭月(貂蝉)/不屈(周泰)/称象+仁心(曹冲)/化身第二批(左慈)/裸衣(许褚)/节命+新生(荀彧/左慈)/酒诗②(曹植)/连营(陆逊)/乱击确认步骤(袁绍)/明策(陈宫)/趫猛(公孙瓒)/忘隙(李典)/耀武(华雄)/神速(夏侯渊)/制蛮(马谡)——无特定优先级顺序。`luanjiChoose`渲染层bug仍未修，独立于此列表。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 三项+`CONTROLS_CHOICE_EXCLUDE` 三项+`runBotDecision` 三个新分支）、`run_ai_bus_l3_test.js`（新增4项断言）、`index.html`（`?v=313→314` ×14）。

## 第二批-剩余清单一次性批量处理（好施/挑衅discard/闭月/不屈/称象+仁心/裸衣/节命+新生/酒诗②/连营/明策/趫猛/忘隙/耀武/神速/制蛮/化身第二步）

- **背景**：按用户要求把第二批剩余清单一次性批量处理完（乱击确认步骤除外，见下方说明），共涉及约14个技能、25个phase注册。决策原则延续前几组已验证的判断方式：优先看"是否有下行风险/代价是否明确划算"——没有明显收益/代价不明确默认不发动，零风险有收益默认发动，需要选具体牌/目标的步骤走"选候选第一项"确定性兜底。
- **固定发动（零下行风险/纯收益）**：闭月(biyue,摸1张牌无代价)、不屈(buquAsk,不会比不发动更差)、称象是否发动(chengxiangAsk,最差选0张不倒贴)、新生(xinshengAsk,左慈纯资源增益)、酒诗②翻正面(jiushiFlipAsk,零代价)、连营(lianyingAsk,摸1张无代价)、趫猛是否发动(qiaomengChoose,黑色杀命中后拿/弃装备零代价)、忘隙(wangxiAsk,自己净收益)。
- **固定不发动（有明确代价/利他方向不确定）**：仁心(renxinChoose,弃装备+翻面的代价换保护别人,同举荐基调)、裸衣(luoyiAsk,-1张牌换不确定的伤害加成)、节命(jiemingAsk,资助别人不确定是敌是友)、制蛮是否发动(zhimengAsk,放弃已命中的伤害换1张不确定的牌,伤害通常更值)。
- **需要真实条件判断的（同举荐jujianChooseEffect/耀武这两个先例的既定方式）**：称象选组合(chengxiangChoose,固定选sum最大)、耀武(yaowu_choose,体力未满选recover否则选draw)、明策接收方选效果(mingceChoice,有第二目标选sha否则选draw,对选择者是免费进攻机会)。
- **防御性收录（机器人目前没有入口主动发动这些技能，属于"只有配了AI密钥且AI选择激活时才会走到"的潜在盲区，参照上一批悲歌/化身第二步同一类先例）**：明策三段(mingcePickCard/mingcePickTarget/mingcePickTarget2,陈宫本人自主发动)、神速(shensuSha,夏侯渊本人自主发动)、制蛮zhimengPick(选牌步骤)、挑衅tiaoxinDiscard(姜维本人选弃哪张)、左慈更改化身第二步(huashenChangePickStart/PickEnd,第一步早已注册且默认"不更改")。
- **过程中发现并修正的一个真实bug（曹冲【称象】）**：`confirmChengxiangAsk`把`pending.type`从`'chengxiangAsk'`切到`'chengxiangChoose'`时，从来没有同步修改`g.phase`——`g.phase`全程停留在`'chengxiangAsk'`不变（渲染层`renderCaochong`本来就只按`pending.type`分派，不看`g.phase`，所以这个不一致对人类玩家完全无感）。第一版实现用`g.phase==='chengxiangChoose'`做守卫，真实dump验证时发现这个分支永远不会触发（死代码）——修正为`g.phase==='chengxiangAsk'&&d.type==='chengxiangChoose'`，同时把`BOT_PHASE_ACTOR`/`CONTROLS_CHOICE_EXCLUDE`里多余的`chengxiangChoose`键也去掉（这个键在`botSeatForState`里永远查不到`g.phase`匹配，登记了也是死代码）。这是本次系统性排查过程里第二次发现"pending.type切换了但g.phase没同步"这类问题（第一次是巧变的`jushouChoose`没有这个问题，但明策的`mingcePickTarget2`/`mingceChoice`两处确认切换时正确同步了`g.phase`，属于陈宫这个技能自己写对了的部分）。
- **顺带发现的一个真实数据缺口（陆逊【连营】，不修复，只记录）**：`lianyingAsk`这套机制在`game.js`里完整实现（`hasCap(p,'lianying')`判断+队列+响应函数），但`data.js`的`GENERALS`表里**没有任何一个武将声明`caps:{lianying:true}`**——这意味着"连营"目前是一个服务端逻辑完整、但没有任何武将能触发的孤立机制，不只是机器人用不上，人类玩家在当前武将名单下也永远不会遇到这个技能。这不是bot调度的问题，是武将数据缺失（可能是陆逊这个武将本身还没有正式加入`GENERALS`表），本次不处理，只做防御性注册（`lianyingAsk:'seat'`+固定发动分支），等以后如果给某个武将补上这个cap，机器人侧不需要再补代码。
- **乱击确认步骤(luanjiConfirm,袁绍)不在本批处理范围**：核实过它的渲染分支和`luanjiChoose`（选牌步骤，已确认的渲染层bug）在`render-controls.js`里**同样被嵌套在`}else if(g.phase==='play'){`这个大分支内部**，而`luanjiChoose`自己设置的`g.phase`是`'luanjiChoose'`（不是`'play'`），导致确认步骤和选牌步骤一样"从渲染层就到不了"——由于选牌步骤本身已经不可达（渲染不出任何按钮），确认步骤在实践中永远不会被进入，两者是同一个渲染bug的连带后果，不需要（也没办法独立于选牌步骤）单独修复，留给`luanjiChoose`那条渲染bug统一修。
- **测试**：真实浏览器+真实Firebase构造15个场景（好施/闭月/不屈/仁心/称象/裸衣/节命/新生/酒诗②/明策mingceChoice/趫猛/忘隙/耀武/制蛮全部验证通过；连营因武将数据缺失无法通过真实dump验证，改用vm沙箱直接spy验证分支逻辑本身正确）；`run_ai_bus_l3_test.js`新增21项断言（含称象g.phase守卫的专项回归、明策三段防御性兜底、制蛮两段、化身第二步两段等），l3从171增至192，AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），13个核心文件`node --check`全过。
- **第二批剩余清单（清空，本轮全部处理完）**：仅剩`luanjiChoose`/`luanjiConfirm`渲染层bug（同一个根因，独立于机器人调度批次，需要单独修`render-controls.js`）。
- **改动范围**：`bot.js`（`BOT_PHASE_ACTOR` 新增25个phase+`CONTROLS_CHOICE_EXCLUDE`同步收录+`runBotDecision`新增约22个分支）、`run_ai_bus_l3_test.js`（新增21项断言）、`index.html`（`?v=314→315` ×14）。

## 袁绍【乱击】luanjiChoose/luanjiConfirm 渲染层bug修复——本次系统性排查发现的最后一个遗留问题

- **背景**：这是唯一遗留的、和机器人调度盲区批次不同类的问题——它不是"机器人不会用某个技能"，是"这个技能的选牌/确认面板对任何人（真人和机器人）都渲染不出来"，本质是`render-controls.js`的一个渲染层bug，人类玩家同样受影响。
- **真实dump重新核实的确切位置**：`render-controls.js`第3336~3432行（4个luanji相关分支：选牌面板+确认面板+两个"其他玩家发动时"的旁观banner），全部嵌套在第3328行`}else if(g.phase==='play'){`这个大分支内部。而`skills.js`的`startLuanji()`(第3389/3393行)把`g.phase`切到`'luanjiChoose'`、`pickLuanjiPair()`(第3427行)切到`'luanjiConfirm'`——一旦切换，外层`else if(g.phase==='play')`的门槛就再也满足不了，这4个分支永远进不去。
- **修复方向的确认（两个候选方案的权衡）**：
  1. **方案A（采用）**：把这4个分支挪出`play`大分支，改成独立的顶层`if(g.phase==='luanjiChoose'&&...)`/`if(g.phase==='luanjiConfirm'&&...)`判断，不改`startLuanji()`/`pickLuanjiPair()`本身的phase切换。
  2. **方案B（放弃）**：反过来让`startLuanji()`保持`g.phase='play'`不切换。
  3. **判断依据**：`game.js`/`skills.js`里`normalize()`和`pickLuanjiPair`/`confirmLuanji`/`cancelLuanji`的守卫全部只检查`pending.type`，从不检查`g.phase`——这部分对两个方案都安全。但`bot.js`的`botSeatForState`函数有一条Category A短路：`if(g.phase==='draw'||g.phase==='play'||g.phase==='discard'){ return isBotSeat(g.turn)?g.turn:-1; }`，这条判断**排在**Category B的`BOT_PHASE_ACTOR`查表**之前**。如果采用方案B（保持`g.phase='play'`），机器人调度会被这条短路提前拦截，把`luanjiChoose`/`luanjiConfirm`错误当成"正常出牌阶段决策"处理，完全绕开这两个phase在`BOT_PHASE_ACTOR`里的专用注册（本次顺带一起补上的）——方案A没有这个风险。故采用方案A。
- **luanjiConfirm是否是同一个问题**：确认是完全同一个模式，同一段`play`大分支里紧跟着`luanjiChoose`之后的第二组分支，同一次挪动一起处理，没有需要单独说明的差异。
- **修复实现**：把4个分支原样挪到文件靠前位置（`mingceChoice`观察者banner之后、`enyuanChoose`之前——和`qiaomengChoose`/`mingceChoice`等其它独立单角色技能的顶层判断放在同一片区域，风格一致），每个条件补上`g.phase==='luanjiChoose'`/`g.phase==='luanjiConfirm'`前缀（原来隐式依赖外层`play`门槛，现在显式判断自己的phase）。顺带给`BOT_PHASE_ACTOR`补上`luanjiChoose:'sourceSeat'`/`luanjiConfirm:'sourceSeat'`两项注册+`runBotDecision`两个确定性分支（固定选第一个可用牌对+固定确认，防御性收录——机器人目前没有入口主动发动乱击，和明策/神速等其它"自主发动类"技能同一类；不补的话，渲染bug修好之后机器人反而会暴露出一个新的"卡在这两步"的风险，趁手一并解决，不留新盲区）。
- **过程中确认的一个额外发现（本次不修，只记录）**：定位这段代码时，用同样的brace-depth追踪方法核实了紧邻在前面的`qiangxiChooseCost`/`qiangxiChooseWeaponFromHand`/`qiangxiPickTarget`（典韦【强袭】）三个分支——它们同样被嵌套在错误的phase判断里（这次是`if(g.phase==='draw'){...}`大分支，从第3152行到3296行，横跨整个"摸牌阶段"渲染逻辑，三个强袭分支的条件永远不可能和外层的`'draw'`同时成立），是和luanji完全同一类的渲染bug，**人类玩家打典韦【强袭】同样会遇到面板渲染不出来的问题**。上一批"紧急排查"任务里已经给`qiangxiPickTarget`补过机器人决策分支（`bot.js`里直接调用`pickQiangxiTarget`，完全不依赖渲染层），所以机器人侧当时验证通过、但那次验证完全没有触及这个渲染bug——机器人的修复路径和人类玩家的渲染路径是两条独立通道，机器人能用不代表人类能看到按钮。这次任务范围只要求修luanji，典韦【强袭】的这个渲染bug本次不处理，留给下一次任务单独修（三个分支的位置和luanji这次的修法应该完全一致，可以直接参考这次的改动）。
- **测试**：①真实浏览器人类玩家视角构造`luanjiChoose`/`luanjiConfirm`两个场景，确认修复前**渲染不出任何按钮**（已在排查阶段用`collectControlsCandidates`直接验证过0个按钮）、修复后能正确渲染出"【杀】+【闪】"牌对按钮+取消（luanjiChoose）、"确认"+"取消"（luanjiConfirm）；②真实浏览器机器人视角构造`luanjiChoose`（sourceSeat=机器人），确认机器人能完整走完选牌→确认→视为使用万箭齐发→AOE结算的全流程（日志：`机器人1 将【闪】和【杀】当【万箭齐发】使用`→`机器人1 使用【万箭齐发】`→`结算对 真人 的【万箭齐发】…`→`要求 真人 打出【闪】`）；③`run_ai_bus_l1_test.js`新增2项断言直接验证`collectControlsCandidates`能收集到渲染层的真实按钮（21→23）；`run_ai_bus_l3_test.js`新增3项断言验证机器人决策分支+`BOT_PHASE_ACTOR`登记（192→195）；AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变），特别核对过其它同样嵌套在`play`大分支/`draw`大分支里的渲染逻辑（如强袭三段、guhuoTarget等紧邻在原luanji代码前后的分支）没有被这次挪动影响，13个核心文件`node --check`全过。
- **本次系统性排查的完整结论（收尾）**：从"机器人不会发动某个技能"这条最初的排查线，一路发展成50+个调度盲区批量修复、又额外发现2个真实bug（曹冲称象的g.phase不同步、典韦强袭+袁绍乱击共享的渲染层bug）、1个孤立机制（陆逊连营无武将可用）。机器人调度盲区批次（第一批4项紧急+第二批全部）已经**全部处理完毕**；渲染层bug目前**乱击已修，强袭同类问题待修**（下一次任务可直接参考本次修法）。
- **改动范围**：`render-controls.js`（4个luanji渲染分支挪位置+补phase前缀）、`bot.js`（`BOT_PHASE_ACTOR`两项+`CONTROLS_CHOICE_EXCLUDE`两项+`runBotDecision`两个新分支）、`run_ai_bus_l1_test.js`（新增2项断言）、`run_ai_bus_l3_test.js`（新增3项断言）、`index.html`（`?v=315→316` ×14）。

## 典韦【强袭】三段渲染层bug修复——和乱击同一批发现，本次系统性排查彻底收尾

- **背景**：修乱击时顺带发现的姊妹问题，同一类根因，参照乱击那次的修法流程处理。
- **真实dump重新核实的确切位置**：`render-controls.js`里`qiangxiChooseCost`/`qiangxiChooseWeaponFromHand`/`qiangxiPickTarget`三段（当时约在3303~3405行，因乱击那次改动文件行号已变化，本次重新核实过），全部嵌套在`if(g.phase==='draw'){`这个大分支内部（第3261行开始，覆盖张辽突袭/恂恂/再起等摸牌阶段技能入口的整段逻辑）。`skills.js`的`startQiangxi()`把`g.phase`切到`'qiangxiChooseCost'`、`chooseQiangxiCost()`视消耗类型切到`'qiangxiChooseWeaponFromHand'`或直接进`'qiangxiPickTarget'`——一旦切换，外层`if(g.phase==='draw')`的门槛永远满足不了，这三段面板对任何人都渲染不出来。
- **修法方向的核实——和乱击情况相同，采用同一个方案**：核对过`normalize()`和`chooseQiangxiCost`/`chooseQiangxiWeaponFromHand`/`pickQiangxiTarget`/`cancelQiangxi`的守卫，全部只检查`pending.type`/`pending.seat`，从不检查`g.phase`，说明改渲染层位置不会破坏这些函数的正确性。`startQiangxi()`要求`g.phase==='play'`才能发动（自主发动技能，机器人从无入口调用，同乱击的`startLuanji()`）。是否要反过来让强袭保持`g.phase='draw'`不切换？依然不行——理由和乱击完全一致：`bot.js`的`botSeatForState`的Category A短路（`g.phase==='draw'||'play'||'discard'`时直接按`g.turn`返回，排在`BOT_PHASE_ACTOR`查表之前）会拦截，绕开这三段在`BOT_PHASE_ACTOR`里的专用注册。故同样采用"挪渲染代码出大分支，不改phase切换"的方案。
- **修复实现**：把三段渲染代码（含"自己"面板+"其他人正在选择"的旁观banner，共6个if块）挪到`guhuoQuestion`处理之后、`if(!myTurn)`判断之前（顶层位置，和`qiaomengChoose`/`mingceChoice`同一片区域），条件本身已经带着`g.phase==='qiangxiXxx'`前缀（这三段和乱击不同——乱击原来的判断只写了`pending.type`，需要额外补phase前缀；强袭这三段本来就写了`g.phase==='qiangxiXxx'`，是外层`if(g.phase==='draw')`让这个内层判断变得多余/矛盾，所以这次是纯粹的位置搬移，不需要改写判断条件本身）。`BOT_PHASE_ACTOR`补齐`qiangxiChooseCost:'seat'`/`qiangxiChooseWeaponFromHand:'seat'`两项注册（`qiangxiPickTarget`早在系统性扫描"紧急排查"那批就注册过）+两个确定性`runBotDecision`分支（消耗方式优先弃武器保留体力、无武器可弃才选失去体力；选武器牌固定选第一个下标），防御性收录（机器人目前没有入口主动发动强袭）。
- **系统性扫描紧急排查那批给`qiangxiPickTarget`补的机器人决策分支是否受渲染bug影响**：核实过完全不受影响——那次的机器人分支直接调用`pickQiangxiTarget(target)`函数，完全绕开渲染层，所以此前机器人侧"能推进"和"人类能不能看到按钮"是两条独立通道，机器人早就能用、这次只是把人类那条通道也修好了；渲染层修复后不会对已经生效的机器人分支产生任何影响（真实dump场景4/5验证过：机器人从`qiangxiChooseCost`开始，完整走完选消耗方式→选武器（如果选武器）→选目标→造成伤害的全流程，逐字匹配预期日志）。
- **测试**：①真实浏览器人类玩家视角构造三个场景，确认修复前后对比（`qiangxiChooseCost`渲染出"失去1点体力"/"弃置一张武器牌"/"取消"；`qiangxiChooseWeaponFromHand`渲染出武器牌按钮+取消；`qiangxiPickTarget`渲染出目标姓名按钮，无取消——和代码注释"消耗支付后不可取消"一致）；②真实浏览器机器人视角构造两个完整流程场景（手持武器→选weapon→选手牌武器→选目标→命中；无武器→选hp→选目标→命中），全部日志逐字匹配预期；③`run_ai_bus_l1_test.js`新增3项断言直接验证`collectControlsCandidates`能收集到渲染层真实按钮（26项，23→26）；`run_ai_bus_l3_test.js`新增4项断言验证机器人决策分支（含"有武器优先弃武器"/"无武器选体力"两个对照）+`BOT_PHASE_ACTOR`登记核对（199项，195→199）；AI-bus全部10套件+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3既有基线未变，特别确认`run_ai_lordskill_test.js`——同样触及`draw`阶段渲染区域的张辽突袭/恂恂/再起入口——未受挪动影响），13个核心文件`node --check`全过。
- **本次系统性排查最终彻底收尾**：从最初"机器人不会发动某个技能"的排查线，最终产出——机器人调度盲区批次（第一批4项紧急+第二批全部约50+项）**全部处理完毕**；发现并修复2个真实渲染层bug（曹冲称象g.phase不同步、袁绍乱击+典韦强袭共享的"phase切换后外层大分支门槛失效"渲染bug，**两者均已修复**）；记录1个孤立机制（陆逊连营目前无武将可用，data.js缺失对应caps声明，留待以后补武将时一并解决）。截至本条记录，**排查中发现的所有已知问题均已处理或明确记录去向，没有遗留的调度盲区或渲染层bug**。
- **改动范围**：`render-controls.js`（3个qiangxi渲染分支挪位置，条件本身无需改写）、`bot.js`（`BOT_PHASE_ACTOR`两项+`CONTROLS_CHOICE_EXCLUDE`两项+`runBotDecision`两个新分支）、`run_ai_bus_l1_test.js`（新增3项断言）、`run_ai_bus_l3_test.js`（新增4项断言）、`index.html`（`?v=316→317` ×14）。

## 转化技能候选真空系统性排查 + 龙胆(赵云闪→杀)修复

- **背景**：上一条记录声称"排查中发现的所有已知问题均已处理，没有遗留的调度盲区或渲染层bug"，但这句话只覆盖了当时已经找到的具体问题实例，不构成"这类bug已经穷尽"的证明。用户随后专门commission了一次**只排查不修复**的系统性扫描：全面找出还有多少个和武圣（关羽，红牌→杀）/龙胆（赵云，闪→杀方向）同类的"候选真空"问题——即"常规出牌枚举用的是不认转化的`botActionId`，某个转化技能自己的候选生成逻辑又假设常规枚举已经覆盖了这张牌，两边都不管，导致这张牌在任何候选列表里都不出现"这个具体bug形状。
- **排查方法（不是抽样，是结构证明）**：读完`resolveActionId(g,me,card)`（render.js:608-614）的完整实现，发现它**只调用一次`canUseAs(me,card,'杀')`，从不检查'闪'/'决斗'等其它role**。而`canUseAs`里能让`role==='杀'`成立的cap只有两个：`longdan`（赵云，闪→杀方向）和`wusheng`（关羽，红牌→杀）。这意味着"两套判断互相假设对方覆盖"这个具体bug形状，**结构上只可能发生在这两个技能上**，双雄(决斗-target)/倾国(闪-target)/国色/断粮/奇袭全部走独立谓词（`isGuoseCard`/`isDuanliangCard`/`isQixiCard`/`canShuangxiongDuelCard`），根本不经过`resolveActionId`，天然免疫。逐一核实后确认：武圣此前已修复（`isWushengShaCard`+`BOT_SEAT_PICKS.wusheng`），龙胆此前完全零覆盖（`bot.js`对`longdan`零引用）——是唯一真正需要修的候选真空。另外发现两个**不同类**的次要缺口（连环/庞统 机器人零入口自主发动技能，急救/华佗 已在代码注释里承认的候选省略），如实报告为"不是这次要找的bug形状"，未和武圣/龙胆混为一谈。
- **龙胆修复的关键设计决策——不能照抄武圣的排除条件**：`isWushengShaCard`要求`resolveActionId(g,me,c)!=='杀'`，是为了排除"这张牌自己已经有独立效果、常规枚举已经收录"的情况（否则会重复注册）。但闪**没有`CARD_PLAYS['闪']`这个入口**（纯被动响应牌，从未有主动使用路径）——`resolveActionId`对闪的`ownSpec`检查永远失败，于是它对任意一张闪恒定解析成`'杀'`（`resolveActionId(g,me,闪)`===`'杀'`，真实dump验证过）。如果照抄武圣那条排除条件（要求`!=='杀'`），会把所有闪都滤掉、新注册表恰好还是零覆盖，等于白修。所以`isLongdanShaCard(g,me,c)`刻意写成更简单的形式：`c.name==='闪' && canUseAs(me,c,'杀') && CARD_PLAYS['杀'].canPlay(g,me,c)`，不检查`resolveActionId`。
- **实现**：`bot.js`新增`isLongdanShaCard`谓词（紧跟在`isWushengShaCard`之后，注释说明为什么不能复用同一条排除逻辑）+`BOT_SEAT_PICKS.longdan`四件套注册（`match`/`buildSeatCandidates`（复用`CARD_PLAYS['杀'].canTarget`做目标校验，和武圣/双雄同一套写法）/`fallbackSeat`返回null（改动前机器人从不用）/`execute`调用`playCard(idx,'杀',targetSeat)`）。`seatPick`总线（`seatPickMatch`/`seatPickBuildCandidates`等）本身按`Object.keys(BOT_SEAT_PICKS)`遍历，新增注册不需要额外接线。
- **真实dump验证（Playwright headless Chromium + 真实浏览器环境执行，非vm沙箱抽样）**：①构造赵云手持一张闪（无真杀）的出牌阶段场景，`resolveActionId(g,me,闪)`===`'杀'`（验证了上面的关键假设）、`isLongdanShaCard`===true、`seatPickMatch`===true、候选正确生成`{label:'龙胆→机器人1', skillKey:'longdan', seat:1}`；②`BOT_SEAT_PICKS.longdan.execute`真实调用后，闪牌进入弃牌堆、手牌清空、`g.phase`推进到`'respond'`（等待对方出闪）——确认闪被真正当杀打出，不是空转；③赵云同时持有真杀+闪的回归场景：常规枚举（`enumerateAllLegalOneStepActions`）仍正确收录真杀（按2个目标展开2条候选），`longdan`额外收录闪（互不覆盖、互不干扰）；④反方向（杀当闪，被动响应用`findUsableAs`，未改动）确认不受影响，`findUsableAs(hand,me,'闪')`仍直接命中杀这张牌。
- **测试**：`run_ai_bus_l3_test.js`新增4项断言（`BOT_SEAT_PICKS`注册数从12改为13、match各分支含"本回合已出杀不应命中"/"手里只有真杀不应命中"两个对照、有密钥/无密钥execute行为、真杀+闪共存回归、反方向`findUsableAs`回归），全部通过；既有"恰含12个技能"的计数断言相应改成13并补上`longdan`到预期列表（这条断言的性质决定了新增任何`BOT_SEAT_PICKS`项都必须同步改这里，不是本次改动引入的脆弱性）。AI-bus全部10套件（`c_window`34/`core`10/`info`17/`l1`26/`l2`24/`l3`203/`lordskill`45/`model_picker`17/`summary`13/`timeout`8，全部0失败）+仓库既有6套件与基线完全一致（`fazheng`8/3、`cixiong`17/3两个既有不相关基线未变，`identity_mode`35/0、`lidian`全过、`qinggangjian_renwang`6/0、`xuanfeng`5/0），14个核心文件`node --check`全过。
- **改动范围**：`bot.js`（新增`isLongdanShaCard`谓词+`BOT_SEAT_PICKS.longdan`注册）、`run_ai_bus_l3_test.js`（新增4项断言+既有计数断言改为13）、`index.html`（`?v=317→318` ×14）。
- **本次系统性排查最终结论（如实报告，未夸大）**：候选真空这一具体bug形状，扫描后确认**武圣+龙胆是完整集合，没有第三个**——不是抽样得出的印象，是从`resolveActionId`只检查'杀'这一个role这一行代码结构直接证明的。武圣此前已修，龙胆本次修完，这条bug线**彻底闭环**。顺带发现的连环（庞统，机器人零入口）、急救（华佗，候选省略，代码已有注释承认）是不同类型的缺口，已如实记录、留给用户决定是否处理，不在本次改动范围内。
