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
