# 本地机器人决策服务 可行性评估

> 目标形态：把机器人决策逻辑从「运行在某个玩家的浏览器标签页里」迁移成「运行在一个独立的
> 本地 Node.js 常驻进程里，用 Firebase Admin SDK 直接读写 RTDB」。游戏状态仍留在 Firebase
> RTDB，前端 UI 不变，只是机器人的**执行环境**从浏览器换成 Node 进程。
>
> **本文只做盘点与方案设计，不含任何功能代码改动。**

---

## 摘要（先说结论）

**整体可行，且比预期便宜得多。** 最初担心的最大障碍——「L1 controlsChoice / botSafePrompt
依赖真实渲染 DOM 再读按钮」这套机制——**在 Node 里已经被证明能跑通了**：仓库里现成的
`run_ai_bus_l1_test.js` 就是在 Node + vm 沙箱里，用一段约 45 行的手写最小 DOM shim，真实
加载 `render-controls.js`、真实调用 `renderControls(g)`、真实收集 `button:not(:disabled)`
并 `click()`，26/26 全绿。这意味着 B 类不是「必须重新设计成不依赖 DOM 的实现」，而是
「把这段已经验证过的 DOM 宿主从测试脚手架提升为生产设施」——性质从**架构重构**降级为
**基础设施搬运**。

真正的高风险点不在 DOM，而在 **`mySeat` 这个模块级全局变量**：它被 game.js / skills.js /
render-controls.js 隐式读取近 800 处，是整套动作函数的事实上的「当前行动者」隐式参数。
单房间下它安全（`botInvoke` 同步换入换出）；**多房间并发下它是致命的**，因为 AI 调用有
最长 15s 的 await，两个房间的决策交错时会互相踩踏。

**建议路线：先做单房间（不碰 `mySeat`），验证稳定后再决定多房间要不要做**——多房间不是
「再加一点工作量」，它是这次迁移里唯一需要动核心状态模型的部分。

---

## 一、bot.js / bot-ai-bus.js 对浏览器环境的依赖程度

### 依赖总量（实测）

| 文件 | `document.` / `window.` 引用数 | 说明 |
|---|---|---|
| `bot.js` | **8** | 决策主体，依赖极少 |
| `bot-ai-bus.js` | **2** | 且已自带 `typeof document==='undefined'` 守卫 |
| `ai-bot.js` | 55 | **绝大多数在 UI 函数里**（弹窗/模型选择器/状态按钮/信息窗），Node 侧根本不调用 |
| `render-controls.js` | 480 | 被 B 类的 DOM 路径间接拉进来 |
| `render.js` | 46 | 只需要其中 8 个函数（见 B-3） |

**关键观察：机器人决策主体本身几乎是纯逻辑的。** bot.js 4838 行里只有 8 处 DOM 引用，
其中 6 处集中在两个函数（`collectControlsCandidates` / `botSafePrompt`）里，另外 2 处是
纯 UI 提示。真正的浏览器耦合不在决策逻辑，而在「决策逻辑为了枚举合法动作而借用了渲染层」
这一个设计选择上。

---

### A 类：可直接删除或替换成等价纯逻辑，不影响功能（8 处）

| # | 位置 | 内容 | 处理方式 |
|---|---|---|---|
| A-1 | `bot.js:738,745` | `showAiThinkingIndicator` / `hideAiThinkingIndicator` —— 读 `#aiThinkingIndicator` 显示「🤖 正在思考…」 | 纯 UI 反馈，Node 侧改成 no-op（或输出到进程日志）。零功能影响。 |
| A-2 | `bot-ai-bus.js:519-520` | `refreshCountdownSpans` 刷新 `.resp-countdown` 文本 | **已经自带 `typeof document==='undefined'` 守卫，Node 下天然 no-op，零改动。** |
| A-3 | `ai-bot.js:110-132` | `hydrateAiStateFromSession` 从 `sessionStorage` 读密钥 | **已被 try/catch 包裹**，Node 下静默回退到空值。只需在进程启动后从环境变量注入 `aiApiKey`/`aiProvider`/`aiApiModels`。 |
| A-4 | `ai-bot.js` 其余约 50 处 | `showAiKeyModal` / `renderModelPicker` / `renderAiStatusButton` / `aiTest*` 弹窗系列 | **Node 侧永不调用**。真正需要的只有 `callAI` / `resolveAiModel` / `parseGroqRetrySeconds` / `PROVIDER_ADAPTERS`，这几个只用 `fetch` + `AbortController` + `setTimeout`，**Node 18+ 原生支持**（当前环境 v22.16.0）。 |
| A-5 | `config.js:21-24` | `firebase.initializeApp()` + `document.getElementById('configWarn')` | 整体换成 admin 初始化（见第二节）。 |
| A-6 | `game.js:15-22` | `myClientId` 读 `localStorage` | 已 try/catch 兜底。Node 侧给进程一个固定标识（如 `'bot-server'`）即可——但注意它同时是「谁是机器人控制者」判定的依据（见第三节）。 |
| A-7 | `game.js:26` | 顶层 `document.getElementById('joinBtn').onclick = joinRoom` | 加载时立即执行的 DOM 绑定，Node 下会抛。用一行 `typeof document!=='undefined'` 守卫即可（CLAUDE.md 已记录过这个加载顺序坑）。 |
| A-8 | `bot.js:1166-1167`、`bot.js:3688` | `dispose()` / `finally` 里的 `renderControls(currentG)`「把界面恢复成真人视角」 | Node 侧没有真人视角要恢复，直接跳过。已有 `typeof currentG!=='undefined'` 守卫，行为上天然退化。 |

**A 类小计：8 处，其中 3 处（A-2/A-3/A-8）已经自带守卫、零改动；其余 5 处都是删掉或
一行守卫的量级。**

---

### B 类：功能必须保留，需要重新设计或提供替代宿主（3 处）

#### B-1 `collectControlsCandidates`（bot.js:1139-1168）—— L1 controlsChoice

现有机制：把真实 `#controls` 临时改名成 `#human-controls` → 新建一个隐藏 `div#controls`
挂进 `body` → 把全局 `mySeat` 临时切成机器人座位 → **真实调用 `renderControls(g)`** →
读取隐藏 box 里所有 `button:not(:disabled)` → 把按钮文案作为候选给 AI 选 → 选中后
`btn.click()` 走人类同款 onclick。

这是整个机器人系统里**覆盖面最广的单个决策入口**：它是 33 个结构化 `BOT_DECISIONS`
注册项之一，但作用是「镜像任意阶段的真实按钮」，等于给所有没有专用注册的阶段兜了底。

#### B-2 `botSafePrompt`（bot.js:3667-3690）—— 最终防卡兜底

同一套 DOM 隔离模式，区别是收集+点击在同一次同步调用里完成（不跨 AI await），且不问 AI，
直接用正则挑「安全按钮」（`/不发动|不使用|不出|取消|跳过|放弃|结束/`）→「必选按钮」
（`/选择|交给|弃置|摸牌|回复|打出/`）→ 唯一按钮。它是 `runBotDecision` 所有分支都没命中
时的最后一道防线（bot.js:4612），也是 `runBotFallbackProbe` 对未覆盖阶段逐座位试点的手段。

#### 🔑 决定性发现：这两项在 Node 里**已经跑通了**

`run_ai_bus_l1_test.js` 的做法（实测 26/26 通过）：

- 手写约 45 行的最小 DOM（`mkEl()`）：元素支持树形 `appendChild`/`removeChild`/`remove`、
  `textContent`/`innerHTML` getter-setter、`click()` 调 `onclick`；
- `document` stub 提供按树递归查找的 `getElementById`（真实语义：改名后
  `getElementById('controls')` 必须落到新挂的隐藏 box 上）、`createElement`、`createTextNode`；
- `querySelectorAll` **只实现了 `'button:not(:disabled)'` 这一个选择器**（这是 collect
  唯一的用法），递归收集非 disabled 的 BUTTON；
- `render-controls.js` **加载真实文件、不用 stub**（其顶层只有 `let`/`function` 声明，
  无立即执行的 DOM 操作，在沙箱里能干净加载）；
- 运行期只需补 2 个来自 render.js 的外部函数 stub：`setBanner`、`escapeHtml`。

**结论：B-1/B-2 不需要「重新设计成不依赖 DOM 的实现」。** 正确做法是把这段 DOM 宿主从
测试脚手架提升为生产设施，两个选项：

| 方案 | 优点 | 缺点 |
|---|---|---|
| **(a) 沿用手写最小 DOM shim** | 零依赖、启动快、行为已被 26 条测试锁定、可控 | 只支持已实现的 API 子集；遇到没实现的 DOM 调用会抛（属于 C-2 风险） |
| **(b) 引入 `jsdom`** | API 完整，几乎不会遇到「这个 DOM 方法没实现」 | 多一个较重的依赖；启动慢；真实 DOM 语义可能反而触发一些浏览器专属副作用 |

**建议先走 (a)**，把现有 shim 抽成一个共享模块（测试和生产共用同一份，天然保证一致性），
遇到缺口再逐个补；只有在缺口多到难以维护时才升级到 (b)。

#### B-3 `showConfirm` / `confirmAndPlay`（render.js:612-639）—— 必须改成 headless 自动确认

这是**唯一一个真正需要行为改造、而不只是换宿主**的点。

`renderControls` 里有 17 处按钮的 `onclick` 是 `confirmAndPlay(msg, fn)`（蛊惑/礼让/涅槃/
连环/仁德/制衡/散谣/苦肉/酒诗等）。`confirmAndPlay` → `showConfirm`，后者会：

```js
const m = document.getElementById('confirmModal');
m.innerHTML = '...<button id="confirmOk">确定</button>...';
m.querySelector('#confirmOk').onclick = () => { hide(); onOk(); };
```

**即：点击这类按钮只会「弹出一个确认框」，真正的动作 `fn()` 要等人再点一次「确定」才执行。**
在 headless Node 里没人点第二下，机器人会表现为「点了但什么都没发生」——而且因为
`scheduleBotTurn` 靠 Firebase `value` 事件驱动、状态又没变，它**不会重试，会永久卡死**
（这正是 CLAUDE.md 第 26 条记录的「机器人被服务端原地拒绝一次就永久死循环」的同型故障）。

处理方式：Node 侧提供一个 headless 版 `showConfirm`，直接同步执行 `onOk()`（机器人已经
「决定」要做这个动作了，确认框对它没有语义）。约 5 行，但**必须显式做，不能靠 DOM shim
兜过去**。

> ⚠️ 附带发现：这一条在浏览器端目前是否已经是潜在 bug（机器人点到这类按钮时白点一次），
> 取决于这些按钮所在的阶段是否都被 `CONTROLS_CHOICE_EXCLUDE`（88 项）或专用结构化分支
> 覆盖住了。游戏目前能正常玩，说明大概率覆盖住了，但**这个论证没有被任何测试锁定**，
> 列入 C 类专项核查（C-4）。

**B 类小计：3 处。其中 2 处（B-1/B-2）已有 Node 可行性实证，只需把宿主产品化；1 处
（B-3）需要真实的行为改造，但改动量很小（约 5 行）。**

---

### C 类：影响范围未定、需要专项调查（5 项）

| # | 事项 | 为什么不确定 | 建议的调查方式 |
|---|---|---|---|
| **C-1** | **DOM 路径的真实覆盖占比** | 机器人有 33 个结构化 `BOT_DECISIONS` 注册 + `runBotDecision` 里 41 处 `botDecide()` 调用；`BOT_PHASE_ACTOR` 登记了 114 个阶段，项目里共约 111 个 `g.phase` 取值。理论上绝大多数阶段走结构化路径，DOM 路径只兜底。但**没有数据证明实战中 DOM 路径的触发频率**。 | 在浏览器端给 `collectControlsCandidates` / `botSafePrompt` 各加一条计数日志，跑几局真实对局统计。如果占比极低，甚至可以考虑「第一版 Node 服务先不带 DOM 宿主，遇到就跳过并告警」这种更激进的分期。 |
| **C-2** | **`renderControls` 在 shim 下的完整性** | L1 测试只覆盖了它测到的那些阶段。111 个阶段各自的渲染分支可能用到 shim 没实现的 DOM API（`querySelector`、`insertBefore`、`dataset`、`addEventListener`、`getBoundingClientRect` 等）。 | 写一个遍历脚本：对每个 phase 构造最小合法 `g`，在 shim 下调一次 `renderControls`，捕获所有抛错，产出「缺口清单」。这是**可以在写任何生产代码之前就做完的低成本高价值调查**。 |
| **C-3** | **`controlsChoiceCtx` 跨 AI await 持有 DOM** | 代码注释明写「collect 与 execute 之间跨 AI await 传递的 DOM 上下文（box 必须在点击后才销毁）」。也就是说真实 `#controls` 会**在最长 15s 的 AI 调用期间一直顶着被改名的 id**。单房间无害；**多房间共享同一个 `document` 时，房间 B 的 collect 会撞上房间 A 未归还的改名状态**。 | 单房间阶段不用管。进入多房间前必须解决：要么每房间一个独立 document（shim 方案下很便宜），要么给 collect→execute 加互斥锁。 |
| **C-4** | **`confirmAndPlay` 按钮是否真的对机器人不可达** | 见 B-3。需要确认这 17 处按钮所在阶段是否 100% 被 EXCLUDE / 专用分支覆盖。 | 交叉比对：把 17 处 `confirmAndPlay` 所在的 `renderControls` 分支对应的 phase 列出来，逐个查是否在 `CONTROLS_CHOICE_EXCLUDE`（88 项）里或有专用 `botDecide` 分支。纯静态分析，无需运行。 |
| **C-5** | **`aiTestAutopilot`（真人座位 AI 托管）的去向** | 这套机制假设「托管的是本浏览器玩家自己的座位」，跟 `mySeat`、`isBotController` 的放行逻辑深度耦合（`scheduleBotTurn` 里有 4 处 `aiTestSelf` 分支）。Node 服务接管后，这套东西是保留在浏览器端、还是也搬过去、还是废弃？ | 产品决策，不是技术调查。建议**第一版明确不搬**：Node 服务只驱动 `p.isBot===true` 的座位，托管仍留在浏览器端（两者互不冲突，因为托管座位不是 bot 座位）。 |

---

## 二、Firebase 读写层的替换范围

### 2.1 直接调用浏览器版 SDK 的位置：**只有 3 处**（不含测试）

| 位置 | 内容 |
|---|---|
| `config.js:21-22` | `firebase.initializeApp(firebaseConfig)` + `db = firebase.database()` |
| `room-lifecycle.js:21-22` | `gameRef = db.ref('rooms/'+roomId+'/game')`、`chatRef = db.ref(...)` |
| `render-log.js:339-340` | `firebase.database.ServerValue.TIMESTAMP`（聊天消息时间戳） |

加上订阅入口 `room-lifecycle.js:68` 的 `gameRef.on('value', snap => render(snap.val()))`。

**预期改动量：非常小（约 20~30 行），是整个迁移里最轻的一部分。** 因为项目早就把所有
状态访问收敛到了 `gameRef` 这一个句柄 + `tx()` 这一个写入口，SDK 只在初始化处露头。

替换对照：

```js
// 浏览器                          →  Node (firebase-admin)
firebase.initializeApp(cfg)          admin.initializeApp({ credential, databaseURL })
firebase.database()                  admin.database()
db.ref(path)                         db.ref(path)            // 完全相同
ref.on('value', cb)                  ref.on('value', cb)     // 完全相同
ref.transaction(fn)                  ref.transaction(fn)     // 签名相同，见 2.2
firebase.database.ServerValue.TIMESTAMP   admin.database.ServerValue.TIMESTAMP
```

**权限模型差异（重要）**：Admin SDK **完全绕过 RTDB 安全规则**，拥有无条件读写权限，
靠服务账号私钥（JSON）认证。这带来两个后果：

- ✅ 顺带解锁了 CLAUDE.md「已知待优化点」里的「手牌非真隐藏 / 数据库写权限全开」——因为
  一旦机器人不再需要在浏览器里读全量状态，就有条件收紧客户端读权限了（**但这是独立的
  后续课题，不属于本次迁移范围**）。
- ⚠️ 服务账号私钥文件**绝不能进仓库**。必须 `.gitignore` + 从环境变量或本地文件读取。

### 2.2 `tx()` 在 Admin SDK 下的语义一致性

`tx()`（game.js:2574-2604）的结构：

```js
function tx(fn, onCommitted){
  const actingSeat = mySeat;                 // 冻结行动座位（防事务重试时 mySeat 已变）
  const p = gameRef.transaction(g => {
    if(!g) return g;
    const visibleSeat = mySeat; mySeat = actingSeat;
    try{
      normalize(g); pruneExchangeCards(g);
      const result = fn(g) || g;
      tryFlushLianying(result);
      return stripUndefined(result);
    } finally { mySeat = visibleSeat; }
  });
  if(typeof onCommitted === 'function' && p && typeof p.then === 'function'){
    p.then(res => onCommitted(res?.snapshot?.val?.() ?? null), () => onCommitted(null));
  }
  return p;
}
```

逐项核对：

| 语义点 | Web (compat) | Admin | 结论 |
|---|---|---|---|
| `ref.transaction(fn)` 签名 | 相同 | 相同 | ✅ 无需改 |
| 返回 `Promise<{committed, snapshot}>` | 是 | 是 | ✅ `onCommitted` 分支原样可用 |
| 首次可能以 `null` 调用 updateFn | 是 | 是 | ✅ `if(!g) return g;` 已处理 |
| 冲突时重试 updateFn | 是 | 是 | ✅ `actingSeat` 冻结机制已经为此设计 |
| 返回 `undefined` = 中止事务 | 是 | 是 | ✅ 语义一致 |
| 返回值里含 `undefined` 属性 → 整体拒绝 | 是 | **是** | ⚠️ CLAUDE.md 第 16 条那个坑**在 Admin 下同样存在**。`stripUndefined` 这道安全网必须保留。 |
| 空数组存进去读回来变 `undefined` | 是 | **是** | ⚠️ 同上，`normalize` 的全部数组默认值防御必须保留。刚修过两次的乱武 `remainingSeats`、激将 `resume.pending` 都是这个坑。 |
| `applyLocally`（本地乐观应用 + 立即触发本地 value 事件） | 默认 true | 默认 true，**可配置 `{applyLocally:false}`** | ⚠️ 见下 |

**关于「嵌套 `tx()` 导致状态覆盖」这类坑，搬到 Node 后是否还存在：**

**存在，而且性质完全不变。** 原因是这个坑的根源**不在 Firebase SDK，在 `tx()` 自身的
结构**：`tx()` 的 updateFn 是同步执行的，如果 `fn(g)` 内部又调了一次 `tx()`，内层会用
**外层尚未提交的旧快照**开一个独立事务，两者互相覆盖。这跟运行环境无关，换 Admin SDK
不会改善也不会恶化。实测 bot.js 里只有 1 处 `tx(` 调用，嵌套风险面很小，但**迁移过程中
不要因为「反正要改 Firebase 层」就顺手动 `tx()` 的结构**——它的 `actingSeat` 冻结、
`stripUndefined`、`tryFlushLianying` 收尾每一条都是修过真实 bug 换来的。

**唯一需要新注意的 Admin 特性**：`applyLocally: true`（默认）会在事务提交前先把乐观结果
应用到本地缓存并触发一次本地 `value` 事件。在浏览器端这被 render→scheduleBotTurn 链路
天然吸收了（`botStateKey` 去重）。在 Node 端，如果直接把 `value` 事件接到 `scheduleBotTurn`，
乐观事件会让机器人对着一个「可能会被回滚的状态」提前决策。建议**Node 侧显式传
`{applyLocally: false}`**，只在真正提交后才触发事件——这会让机器人的行为比浏览器端更
干净，且不影响任何既有语义。

---

## 三、「谁是机器人控制者」的并发控制机制

### 3.1 现状

```js
function botControllerSeat(g){
  return (g.players||[]).findIndex(p => p && !p.isBot && p.cid);   // 第一个有 cid 的真人
}
function isBotController(g){
  const seat = botControllerSeat(g);
  return seat >= 0 && g.players[seat].cid === myClientId;
}
```

`scheduleBotTurn`（bot.js:388）在入口和 `setTimeout` 回调里各查一次 `isBotController`
（共 4 处，含 2 处 `aiTestSelf` 例外分支），非控制者直接 `return`。触发源头**只有一处**：
`room-lifecycle.js:68` 的 `gameRef.on('value', snap => render(snap.val()))` → `render()`
末尾（render.js:1707）`scheduleBotTurn(g)`。

### 3.2 浏览器端需要多大改动来「关闭」机器人驱动

**非常小——一个开关就够，不需要细致改造。** 因为整条驱动链路只有一个入口，且已经有
`isBotController` 这个天然的闸门。

推荐做法（按侵入性从小到大）：

1. **最小改动（推荐）**：在 `scheduleBotTurn` 最前面加一行早退：
   ```js
   if (g && g.botServerActive) return;   // Node 服务在线，浏览器端不驱动机器人
   ```
   由 Node 进程用 RTDB 的 `onDisconnect()` 维护 `rooms/{id}/game/botServerActive`
   （上线写 `true`，进程崩溃/断网时 Firebase 服务端自动置 `false`）。

   这个方案的好处是**降级自动化**：Node 进程一断，`botServerActive` 自动变 false，
   浏览器端下一次 `value` 事件就自动接管，不需要任何人工干预。项目里已有同类先例
   （`aiTestAutopilotDisconnectRef`，ai-bot.js:108）。

2. 需要同步的配套：`botServerActive` 要在 `normalize` 里补默认值（`typeof !== 'boolean'`
   → `false`），遵守 CLAUDE.md 的既有约定。

### 3.3 降级方案：建议「自动回退浏览器端接管」，而不是「等它上线」

两个选项的权衡：

| 方案 | 优点 | 缺点 |
|---|---|---|
| **(A) Node 不在线 → 浏览器端自动接管** | 用户无感知；笔记本没开机/进程崩溃时游戏照常能玩；实现成本极低（就是 3.2 那一行 + `onDisconnect`） | 两套执行环境都得保持可用，等于**双份维护**：以后改机器人逻辑要保证两边都对 |
| **(B) Node 不在线 → 机器人不动，等它上线** | 只有一条代码路径，维护成本最低；能彻底删掉浏览器端的机器人代码 | 笔记本没开机就完全玩不了带机器人的局；对「朋友局、随开随玩」这个实际场景**体验倒退明显** |

**建议选 (A)，而且这不需要额外付出。** 理由：这次迁移是「换执行环境」不是「重写逻辑」——
bot.js / bot-ai-bus.js 的代码本身是共用的同一份（Node 端只是换了 DOM 宿主和 Firebase
初始化）。所以 (A) 的「双份维护」成本其实很低，本质上只是同一份逻辑在两个宿主里跑。
真正的双份成本只在 B 类的 DOM 宿主上，而那部分本来就要为 Node 单独做一次。

（(B) 只有在未来真的把机器人逻辑改写成「只可能在服务端跑」的形态，比如需要读取客户端
不可见的隐藏信息时，才变成必选项。那已经超出这次迁移的范围。）

---

## 四、多房间并发处理

### 4.1 现状确认：**是的，全部是隐含单房间假设的单例写法**

逐项清点模块级可变状态：

| 文件 | 变量 | 性质 |
|---|---|---|
| `game.js:10-13` | `roomId`, **`mySeat`**, `gameRef`, `chatRef`, `chatQuery`, `chatMessages` | **每房间一份** |
| `render.js:110` | `currentG` | **每房间一份** |
| `bot.js:4,5,361,387,1136,2642` | `botTimer`, `botScheduledKey`, `botDecisionInFlight`, `botMissedSchedule`, `controlsChoiceCtx`, `botTwoStepA` | **每房间一份** |
| `bot-ai-bus.js:76-79` | `aiSummary`, `aiSummarySeat`, `aiSummaryRound`, `aiSummaryTurn` | **每房间一份**（AI 跨回合记忆） |
| `render-controls.js` | 约 66 个 `let`（`selectedCardIdx` / 各种 `*Mode` / `*Picks`） | **每房间一份**（bot 借渲染时会被写到） |
| `ai-bot.js:55-74` | `aiApiKey`, `aiProvider`, `aiApiModels`, `_modelRotateIdx`, `_modelCooldowns` | ✅ **全局合法**，多房间共享正确（密钥和限流冷却本来就该是进程级的） |

**合计约 80+ 个需要「按房间号索引」的状态变量。**

### 4.2 `mySeat` 是这里唯一的真正难点

其余变量都好办：包进一个 `RoomContext` 对象，用 `Map<roomId, RoomContext>` 索引即可。
但 `mySeat` 不行——它被**隐式读取**的次数是：

| 文件 | `mySeat` 出现次数 |
|---|---|
| `game.js` | **315** |
| `skills.js` | **264** |
| `render-controls.js` | **214** |
| `bot.js` | 88 |
| `weapons.js` | 12 |
| **合计** | **约 893** |

它是所有 `respond*` / `start*` / `playCard` 等动作函数的**事实上的隐式「当前行动者」参数**。
`botInvoke(seat, fn)` 的做法是临时换入换出：

```js
function botInvoke(seat, fn){
  const humanSeat = mySeat;
  mySeat = seat;
  try{ fn(); } finally { mySeat = humanSeat; }
}
```

**这在单线程 + 同步执行下是安全的**（`fn()` 同步跑完就还回去），单房间也安全。

**但多房间并发下会踩踏**，具体路径：
- `runBotDecision` 是 `async`，`runBotActionWindow`（强 C 同窗多步）在步骤之间 `await`；
- `callAI` 有最长 **15 秒**超时（`AI_CALL_TIMEOUT_MS = 15000`）；
- `controlsChoiceCtx` 明确设计为**跨 AI await 持有**（见 C-3）；
- 期间房间 B 的 `value` 事件到达 → 房间 B 的 `botInvoke` 把全局 `mySeat` 改成房间 B 的
  座位号 → 房间 A 的 await 恢复后，**用房间 B 的 `mySeat` 提交房间 A 的动作**。

后果是服务端身份守卫（`g.pending.asking !== mySeat` 之类）拒绝，或者更糟——**恰好通过了
但代表了错误的人**。

### 4.3 多房间改造的三个选项

| 方案 | 做法 | 成本 | 评价 |
|---|---|---|---|
| **(1) 一房间一进程** | Node 主进程 fork 出 N 个子进程，每个只管一个房间；`mySeat` 等全局变量天然隔离 | **极低**（几乎零代码改动，只是加一层进程管理） | ✅ **强烈推荐**。内存代价可接受（朋友局同时开几桌，个位数进程）。彻底回避 893 处 `mySeat` 的问题。 |
| **(2) 显式传参重构** | 把 `mySeat` 改成所有动作函数的显式参数 | **极高**（893 处 + 全部测试） | ❌ 收益完全不匹配成本。这是把项目最核心的调用约定推倒重来。 |
| **(3) AsyncLocalStorage** | 用 Node 的 `AsyncLocalStorage` 让 `mySeat` 变成「异步上下文局部」的 | 中等，但需要把 `mySeat` 从裸变量改成 getter，仍要动 893 处的读取语义 | ⚠️ 技术上优雅，但对一个「无构建流程、共享全局作用域」的项目来说是引入了一层难以调试的隐式魔法 |

**建议：多房间用方案 (1)「一房间一进程」。** 它让「多房间」这件事的成本从「重构核心状态
模型」降到「写一个进程管理器」，也顺带解决了 C-3（每个进程有自己的 document）。

---

## 五、建议的分步实施顺序

### 阶段 0：只调查，不写生产代码（**建议先做，成本最低、消除最多不确定性**）
- 执行 **C-2**：写遍历脚本，对全部约 111 个 phase 在最小 DOM shim 下跑一遍
  `renderControls`，产出「shim API 缺口清单」。
- 执行 **C-4**：静态交叉比对 17 处 `confirmAndPlay` 所在阶段 vs `CONTROLS_CHOICE_EXCLUDE`
  + 专用分支，确认 B-3 的真实影响面。
- 执行 **C-1**：在浏览器端加计数日志，跑几局统计 DOM 路径触发频率。

**阶段 0 产出的三份数据会直接决定阶段 2 的规模。** 在没有这些数据之前给出的任何工期
估算都是猜的。

### 阶段 1：Node 骨架 + Firebase Admin 接入（单房间，机器人不做任何决策）
- 建一个 `bot-server/` 目录，用 vm 或直接 `require` 的方式加载现有 11 个 JS 文件。
- 替换 Firebase 层（第二节，约 20~30 行），`{applyLocally:false}`。
- 处理 A 类的 5 处需要动的依赖（A-1/A-5/A-6/A-7 + A-4 的裁剪）。
- 验收标准：进程能连上 RTDB、能订阅到房间状态、能打印出「现在轮到座位 N（是/不是机器人）」，
  **但不提交任何动作**。这一步把「环境搭起来」和「决策正确性」彻底解耦。

### 阶段 2：接上决策，先只跑结构化路径（单房间）
- 接通 `scheduleBotTurn` → `runBotDecision`。
- **暂时让 B-1/B-2 直接返回 false/空**（DOM 路径先不启用），观察机器人能走多远。
- 靠阶段 0 的 C-1 数据判断这样能覆盖多少场景。
- 浏览器端加 `botServerActive` 开关 + `onDisconnect`（第三节 3.2）。

### 阶段 3：补上 DOM 宿主（B 类）
- 把 `run_ai_bus_l1_test.js` 的 `mkEl()` shim 抽成共享模块，测试和生产共用同一份。
- 按阶段 0 的 C-2 缺口清单补齐 shim API。
- 实现 headless `showConfirm`（B-3）。
- 验收：全部现有机器人测试套件在「生产 shim」下重跑一遍仍全绿。

### 阶段 4：稳定性打磨（仍是单房间）
- 真实对局跑通若干局。
- 补进程崩溃恢复、日志、`botServerActive` 的降级切换验证。

### 阶段 5（可选，视需求决定）：多房间
- 方案 (1) 一房间一进程 + 进程管理器。
- **只有在确实经常同时开好几桌时才做**——单房间版本已经解决了主要痛点。

---

## 六、最高风险点

按风险从高到低：

### 🔴 风险 1：`mySeat` 全局变量 —— 多房间的硬约束（约 893 处隐式读取）
这是唯一一个「没有便宜解法」的架构约束。**缓解办法是不要正面解决它**：单房间不碰它，
多房间用一房间一进程绕开它。**如果有人在实施过程中提议「顺手把 mySeat 改成显式参数」，
应当明确拒绝**——那是一次触及 893 处调用点的核心重构，风险远超本次迁移本身的收益。

### 🔴 风险 2：`renderControls` 在 shim 下的静默行为差异
不是「抛错」——抛错反而是好事，能被发现。真正危险的是**渲染分支静默走了不同的路径**，
导致收集到的按钮集合和浏览器里不一致（比如某个按钮因为 shim 的 `classList.contains()`
恒返回 `false` 而被渲染成 disabled，机器人就永远看不到那个合法动作）。

注意现有测试 shim 里 `classList.contains` 就是 `function(){ return false; }`。这类
「shim 返回了一个语法上合法但语义上错误的值」的缺陷**不会报错、不会被断言抓到**，
完全符合 CLAUDE.md 第 20 条警告的「永远绿的断言」模式。

**缓解**：阶段 3 的验收不能只看「测试全绿」，要做**浏览器 vs Node 的按钮集合逐阶段
对拍**——同一个 `g`，两边各跑一次 collect，比对 label 列表完全一致。这是唯一能真正
证明等价性的办法。

### 🟠 风险 3：`confirmAndPlay` 静默吞掉动作（B-3）
如果漏掉这一条，症状是「机器人在某些技能上什么都不做」，而且因为
`scheduleBotTurn` 靠状态变化驱动、状态又没变，**会永久卡死而不是重试**——正是 CLAUDE.md
第 26 条描述的那类「对真人只是卡一下、对机器人是永久卡死」的故障。
**缓解**：阶段 0 的 C-4 先把影响面查清楚，阶段 3 显式实现 headless 版本。

### 🟠 风险 4：Firebase 的两个序列化坑在 Admin 下**依然存在**
「空数组读回来变 `undefined`」和「返回值含 `undefined` 属性 → 整体拒绝写入」这两条
**不会因为换 SDK 而消失**。这个项目刚刚连续修过两次同型 bug（乱武 `remainingSeats`、
激将 `resume.pending`）。迁移时**不要动 `normalize` 的任何数组默认值防御，也不要动
`stripUndefined`**。
额外注意：Node 端如果新增任何写入路径（比如 `botServerActive`），同样要在 `normalize`
里补默认值。

### 🟡 风险 5：服务账号私钥泄露
Admin SDK 绕过全部安全规则。私钥文件必须 `.gitignore`，绝不能进仓库。这个项目是公开
GitHub 仓库 + GitHub Pages 部署，一旦误提交等于把数据库完全交出去。
**缓解**：阶段 1 第一件事就是先写 `.gitignore` 条目，再去下载密钥。

---

## 七、一句话总结

**技术上完全可行，且比预想便宜**——机器人决策主体本身几乎是纯逻辑的（bot.js 4838 行只有
8 处 DOM 引用），Firebase 层收敛得很干净（只有 3 处 SDK 调用），而最让人担心的 DOM 依赖
在仓库现有测试里**已经有 Node 可行性实证**。真正的约束只有一个：`mySeat` 全局变量把
「多房间」变成了一个独立的架构问题——**建议用「一房间一进程」绕开，而不是正面重构**。

建议从**阶段 0（纯调查，不写生产代码）**开始，那三份数据会让后续每一步的规模都变得可估。

---
---

# 阶段0 调查补全（第二轮）

> 上一节列出的 C-1~C-5 里，有几项只给了「建议的调查方式」而没有实际数据。本节把它们跑完，
> 补上真实测量结果。**同样只做调查，不含任何生产功能代码改动。**
>
> 调查脚本放在会话临时目录（不进仓库）；其中三个可复现的行为场景已固化成
> `run_bot_domhost_probe_test.js`（6/6 通过），作为阶段2/3 的验收基线。

## 0. 先澄清一处编号错位

上一节的编号和这次任务里引用的编号对不上，先对齐，避免以后翻记录时混淆：

| 上一节原编号 | 内容 | 本次任务里的叫法 |
|---|---|---|
| C-1 | DOM 路径的真实覆盖占比 | C-1（一致） |
| **C-2** | **`renderControls` 在 shim 下的完整性** | **被称作 C-4** |
| C-3 | `controlsChoiceCtx` 跨 AI await | 「另外两个问题」第 1 项 |
| **C-4** | **`confirmAndPlay` 是否对机器人可达** | 「另外两个问题」第 2 项 |
| C-5 | `aiTestAutopilot` 去向 | 「另外两个问题」第 3 项 |

也就是说，本次任务里的「C-2」在上一节并不存在对应条目（那个位置被 renderControls 完整性
占着，而它这次改叫 C-4 了）。**本节把「C-2」重新定义为一项确实还没做、且和 C-4 互补的
调查：DOM API 表面缺口清单**——C-4 比对的是「输出（按钮集合）是否一致」，C-2 查的是
「render 路径到底碰了哪些 DOM API、其中哪些被 shim 用退化实现糊弄过去了」。两者一个查
结果、一个查成因，成因侧不受「合成 g 是否走到那条分支」的影响，可靠性更高（见 C-4 里
关于假阴性的说明）。

## 调查方法与可信度声明

- **执行环境**：真实加载全部 11 个 JS 文件进 vm 沙箱（`config/data/debug-log/room-lifecycle/
  game/weapons/skills/bot-ai-bus/bot/ai-bot/render-controls`），**11 个文件在最小 shim 下
  全部零报错加载通过**——这本身就是上一节「B 类可行性」的又一条实证。
- **参照实现**：C-4 的比对基准用 **jsdom**（规范级 DOM 实现），装在会话临时目录里，
  **没有写进仓库、没有新增 `package.json`**，项目的零依赖取向不受影响。jsdom 是真实浏览器
  的代理参照，不等于 Chrome 本身——但对「innerHTML 会不会被解析成子节点」「textContent
  和 innerHTML 是不是同一份数据」这类**规范明确规定**的语义，jsdom 与浏览器一致，足以定案。
- **样本**：从 `game.js/skills.js/weapons.js/render-controls.js/room-lifecycle.js` 里
  提取出全部 **124** 个 `g.phase` 取值，剔除 4 个非决策态（`lobby`/`over`/`end`/
  `qiangxiXxx`），得到 **120 个决策态 phase** 作为统一样本集。
- **不靠代码走读**：C-1 用计数包装器把 `collectControlsCandidates`/`botSafePrompt`/
  `botDecide`/`botInvoke` 全部换成「先计数、再委托回真实实现」，记录的是**真的被调用过**。

---

## C-1：DOM 路径的真实触发占比

### 关键结构性发现：L1 的位置决定了一切

`runBotDecision` 全长 919 行，里面有 **121 个 phase 的专用分支**。而
`botDecide('controlsChoice')`（L1，DOM 路径）的调用点位于**函数的约 20% 处**：

```
runBotDecision 开头
  ├─ 22 个 phase 的专用分支      ← 在 L1 之前，DOM 永远碰不到
  ├─ botDecide('controlsChoice') ← L1，DOM 路径入口
  ├─ 99 个 phase 的专用分支      ← 在 L1 之后
  └─ botSafePrompt(g,seat)       ← 最终兜底，DOM 路径
```

L1 排在 99 个专用分支**前面**，意味着只要一个 phase 不在 `CONTROLS_CHOICE_EXCLUDE` 里，
L1 就会抢在它自己的专用分支之前接管。**这正是 `CONTROLS_CHOICE_EXCLUDE` 需要多达 88 项的
原因**——那 88 项不是「例外」，是在保护后面 99 个专用分支不被 L1 截胡。

L1 之前的 22 个 phase：`pickingLordGeneral, pickingGeneral, huashenPick, guanxingReview,
xunxunPick, yijiAssign, lirangAsk, xiaoguo, jijiangAsk, hujiaAsk, zhibaAsk, zhibaGain,
yinghunTarget, yinghunChoice, yinghunDiscard, draw, play, discard, respond, aoeResp,
duel, dying`（注意 `play`/`respond`/`duel`/`dying`/`aoeResp` 这几个最高频的都在里面）。

### 实测数据（动态探针，120 个 phase 全跑）

| | 有 AI 密钥 | 无 AI 密钥 |
|---|---|---|
| 实际触达 DOM 路径 | **21 / 120 = 17.5%** | **9 / 120 = 7.5%** |
| ├ 经 `collectControlsCandidates`（L1） | 16 | 3 |
| └ 经 `botSafePrompt`（兜底） | 6 | 6 |
| 纯结构化（全程未碰 DOM） | **99 / 120 = 82.5%** | **111 / 120 = 92.5%** |

### 但这 21 个里要再拆一层：真依赖 vs 合成数据不足

动态探针用的是**通用合成 pending**（按 `BOT_PHASE_ACTOR` 填座位字段 + 一批常见字段），
有些专用分支的守卫需要更真实的数据才能过。逐个核对这 21 个之后：

**（a）真·永久依赖 DOM ——「注册漏登记」导致专用分支是死代码：2 个**

| phase | 现象 |
|---|---|
| `guhuoTarget` | `BOT_PHASE_ACTOR` **未登记** → `botSeatForState` 恒返回 -1 → 专用分支（bot.js:4590）**永远不会被调用**，只能走 `runBotFallbackProbe` → `botSafePrompt` 逐座位试点 |
| `quhuDamageChoice` | 同上，专用分支在 bot.js:4596，同样是死代码 |

探针实测这两个 phase：`resolvedSeat = -1`、`botDecide` 调用记录为空（`decide:[]`）、
`safePrompt` 被调用 3 次（3 个存活机器人各试一次）。**`botDecide` 一次都没被调用**，
这是「分支存在但不可达」的直接证据，不是推断。

> 🐛 **这是一个本次调查顺带发现的既有 bug，和迁移无关。** 它正是 CLAUDE.md
> 「AI 机器人决策总线 → 调度前提」那条约定点名的失败模式：*「新增任何阶段分支/注册项，
> 必须同时在这张表登记（不登记则行动者解析恒 -1，分支永远不会被调用）」*。
> 后果不是崩溃——`botSafePrompt` 的正则兜底还能点掉按钮——而是**那两条专门写的决策逻辑
> 从上线起就没跑过一次**。修法是各补一行 `BOT_PHASE_ACTOR` 登记，属于独立的小修复，
> 建议单独开一次任务处理，不要混进迁移里。

**（b）合成数据不足导致的假象：4 个**

`huashenPick`、`wugu`、`xuanfengPick`、`yijiAssign` —— 探针记录显示它们的 `botDecide`
**确实被调用了**（如 `yijiAssign` 的 `decide:["yijiAssign","controlsChoice"]`），只是因为
合成 g 里缺少对应技能的真实数据（化身池 / 五谷牌堆 / 旋风可拆目标），决策返回 false 才
落到 `botSafePrompt`。真实对局里这些走专用分支，不算 DOM 依赖。

**（c）L1 正常接管的 phase：有密钥 15 个 / 无密钥 3 个**

- 无密钥（仅 ALLOWLIST）：`wuxie`、`luoyingAsk`、`luoshen`
- 有密钥额外增加：`lieRenChoose, lieRenPickCard, lirangRecover, liuli, qiaobianTurnStart,
  shensuChoose1, shensuChoose2, tianxiang, tianyiPickCard, tianyiPickTarget, xiaoguoChoice,
  zhengyi` 等 12 个

### C-1 结论

**DOM 路径不是核心路径，是边缘路径。** 扣掉合成数据造成的假象后，真实占比是：

- **无 AI 密钥：5 / 120 ≈ 4.2%**（3 个 ALLOWLIST + 2 个漏登记）
- **有 AI 密钥：17 / 120 ≈ 14.2%**（15 个 L1 + 2 个漏登记）

而且这 17 个里**没有一个是高频阶段**——`play`/`respond`/`duel`/`dying`/`aoeResp`/`draw`/
`discard` 这些一局里反复出现几十次的阶段，全部在 L1 之前被结构化分支接管，永远不碰 DOM。
走 DOM 的都是特定武将技能的低频询问。

**对实施计划的影响：支持上一节「阶段2 先禁用 DOM 路径」这个分期是可行的**——无密钥模式下
只有 5 个 phase 会受影响，其中 3 个（`wuxie`/`luoyingAsk`/`luoshen`）可以优先补结构化注册
（它们本来就有 allowlist 的特殊待遇，说明逻辑简单），剩下 2 个本来就是 bug。

---

## C-2（重新定义）：DOM API 表面缺口清单

**范围定义**：在最小 shim 下真实执行全部 120 个 phase 的 `collectControlsCandidates`
（含 3 组不同花色的手牌变体以提高分支覆盖），用带埋点的 shim 记录：
① 哪些 DOM 写法必然与规范 DOM 语义分叉；② 哪些 shim 用退化常量实现的 API 被真的调用了；
③ 有没有访问到 shim 根本没实现的属性（用 Proxy 捕获）。

### 结果

**【P1】容器 `innerHTML` 里塞按钮 HTML 字符串 → shim 不解析 HTML，按钮完全不可见（6 个 phase）**

```js
// 最小 shim 的实现：只存字符串、把 children 清空，从不解析
set innerHTML(v){ el._html = String(v==null?'':v); el.children = []; }
```
`render-controls.js` 有 6 处 `c.innerHTML = <某个返回HTML字符串的函数>`（beige 系列 / 曹冲
称象 / 制蛮），这些按钮在 shim 下**一个都收集不到**，机器人看到 0 个候选。

命中 phase：`beigeChoose`、`beigeDiscard`、`beigeJudge`、`chengxiangAsk`、`zhimengAsk`、
`zhimengPick`

**【P2】按钮 label 用 `innerHTML` 设置 → shim 的 `textContent` 恒空，label 退化成「按钮N」（2 个 phase）**

```js
b.innerHTML = '展示 '+cardFace(card)+'【'+escapeHtml(card.name)+'】';   // render-controls.js:3022
b.innerHTML = '弃置 '+cardFace(o.card)+'【'+escapeHtml(o.card.name)+'】'; // render-controls.js:3039
```
按钮本身能被收集到（是 `createElement` 造的），但 `collectControlsCandidates` 读的是
`btn.textContent`，而 shim 里 `_html` 和 `_text` 是两个独立字段——于是 label 落到
`(btn.textContent||'').trim() || ('按钮'+i)` 的兜底分支，变成 `按钮0/按钮1/…`。

命中 phase：`huogong`、`huogongReveal`

**这一类比 P1 更危险**：不抛错、不缺按钮，机器人照常「工作」，只是 AI 拿到的候选列表是
`["按钮0","按钮1","按钮2","按钮3"]` —— **完全没有信息可供判断**，而且
`controlsChoiceLocalFallback` 的安全/必选正则也一个都匹配不上，只能退化成永远选
`candidates[0]`。这正是上一节风险 2 预言的「语法合法但语义错误的静默差异」，现在有实例了。

**【P3~P5】三条重要的负面结果（都是好消息）**

| 检查项 | 结果 |
|---|---|
| `classList.contains()` 恒返回 `false` 是否影响按钮集合 | **渲染期间一次都没被调用** → 上一节风险 2 里专门点名担心的这个退化实现，**对按钮收集路径完全无影响**，风险解除 |
| `querySelector()` 恒返回 `null` | **渲染期间一次都没被调用** |
| 访问了 shim 未实现的元素属性（Proxy 捕获） | **零次** |

### C-2 结论

**缺口极小且高度集中：只有 `innerHTML` 这一个 API 的两种用法，共 8 个 phase。**
最小 shim 剩余的所有退化实现（`classList`/`querySelector`/`style`/`setAttribute` 等）在
按钮收集路径上根本没被触发，不构成风险。

修法也很局部，二选一：
- **(a) 给 shim 的 `innerHTML` setter 加一个极简 HTML 解析**（只需处理 `<button>` 标签和
  文本内容），并让 setter 同步更新 `_text`；
- **(b) 改 `render-controls.js` 这 8 处写法**，容器改用 `createElement`+`appendChild`、
  按钮 label 改用 `textContent`。**这个方案顺带把浏览器端也改干净了**（现在这 8 处混用
  两种风格本来就不一致），但属于动生产代码，不在阶段0 范围。

建议 **(a)**：改 shim 不碰生产代码，风险最低。

---

## C-4（= 上一节 C-2）：renderControls 在 shim 下的完整性

**方法**：同一份 `g`，分别在【最小 shim】和【jsdom】两个独立沙箱里真实调用
`collectControlsCandidates(g, 0)`，比对收集到的按钮 label 数组，逐 phase 判定。

> 过程中修正了一个会让比对失真的问题：jsdom 首轮加载 `game.js` 时抛
> `Cannot set properties of null (setting 'onclick')` —— 因为 `game.js:26` 顶层就执行
> `document.getElementById('joinBtn').onclick = joinRoom`，规范 DOM 找不到就返回 `null`，
> 而最小 shim 的 `getElementById` 找不到时返回一个可丢弃的假元素、不会抛。
> **这实测确认了上一节 A-7 的判断**（顶层 DOM 绑定在 Node 下必须加守卫），
> 也说明最小 shim 在这一点上比规范 DOM「宽容」，反而掩盖了问题。
> 给 jsdom 文档补齐这些元素后重跑，两边均零报错加载。

### 最终清单（120 个决策态 phase）

| 分类 | 数量 | 占比 |
|---|---|---|
| ✅ **已验证一致**（两边都渲染出按钮且完全相同） | **91** | 75.8% |
| 🔴 **确认存在差异** | **8** | 6.7% |
| ⚪ **未验证**（合成 g 下两边都没渲染出按钮，分支未被走到） | **21** | 17.5% |

> ⚠️ **这张表是第一轮的中间结果，已被下面「C-4 补齐（第三轮）」一节取代。**
> 最终结论是 **107 一致 / 9 差异 / 4 设计上无按钮 / 0 未验证**。

**🔴 确认存在差异的 8 个**（即 C-2 的 P1+P2 全集，两种方法结论一致）：
`beigeChoose`、`beigeDiscard`、`beigeJudge`、`chengxiangAsk`、`huogong`、`huogongReveal`、
`zhimengAsk`、`zhimengPick`

差异实例：
```
[beigeDiscard]  shim: []
                jsdom: ["弃置【杀】(♠7)","弃置【闪】(♦2)","弃置【桃】(♥9)","弃置【无懈可击】(♣3)","取消"]
[huogongReveal] shim: ["按钮0","按钮1","按钮2","按钮3"]
                jsdom: ["展示 ♠7【杀】","展示 ♦2【闪】","展示 ♥9【桃】","展示 ♣3【无懈可击】"]
```

**⚪ 未验证的 21 个**：`discard, guhuoTarget, haoshiPick, huanhuoPickSecond,
huashenChangePickEnd, huashenChangePickStart, huashenPick, jiedaoChoice, luanjiConfirm,
mengjin, pickingGeneral, pickingLordGeneral, qiangxiPickTarget, qilin, quhuDamageChoice,
renxinChoose, shaOffsetChoice, tianyiPickCard, tianyiPickTarget, wugu, xuanfengPick`
—— 这些需要更真实的 `g`（特定武将在场、特定牌型、特定装备）才能渲染出按钮。

### ⚠️ 关于这份清单的可信度：我自己的第一版比对出过一次假阴性

第一轮纯输出比对给出的是「7 个差异」，`huogong` 被判成「一致」。原因是合成 `g` 的手牌花色
和 `pending.suit` 不匹配，那条带缺陷的 `innerHTML` 分支根本没被走到，两边都只渲染出一个
「不弃牌」按钮 → 判定一致。**定向复测（把 `pending.suit` 改成手牌里有的花色）后立刻暴露**：

```
[huogong suit=♠]  shim: ["按钮0","不弃牌"]
                  jsdom: ["弃置 ♠7【杀】","不弃牌"]
```

这正是 CLAUDE.md 第 20 条说的「一条从没红过的断言等于没被验证过」在本次调查里的现场版本。
**所以最终清单不采用纯输出比对，改用 C-2 的成因探测（埋点记录 `innerHTML` 写法是否真的
被执行）作为「确认差异」的判据**——成因探测不依赖「按钮有没有渲染出来」，不受合成 g 覆盖
度影响，这才把 `huogong` 抓了回来（7 → 8）。

**结论：「91 已验证一致」是可信的**（那 91 个两边都真的渲染出了按钮并逐字相同）；
**「21 未验证」是真的未知，不是隐含通过**。阶段3 验收时必须把这 21 个用真实对局数据补测，
不能因为这轮「没报差异」就当它们没问题。

---

## 三项具体问题的结论

### 1️⃣ `controlsChoiceCtx` 跨 AI await 持有 DOM —— 单房间「无害」需要打个折扣

上一节的初步判断是「单房间无害，多房间会撞车」。实测验证（`run_bot_domhost_probe_test.js`
场景2、3）：

**✅ 对正确性确实无害**：
- `collect` 期间真实控件被改名成 `#human-controls`，`dispose` 后正确归还成 `#controls`；
- await 期间即使人类客户端又渲染了一次，之前冻结的按钮对象**仍可安全 `invoke()`**
  （按钮是 collect 时那次渲染产生的独立 DOM 节点，onclick 闭包捕获的是当时的 `g`，
  不受后续渲染影响）；
- `dispose` 的 id 归还在重渲染之后依然正确。

**⚠️ 但对人类的界面有害（这是上一节漏掉的）**：改名窗口期间，
`document.getElementById('controls')` 返回的是**隐藏 box 而不是真实控件**（实测确认）。
`renderControls` 第一件事就是 `const c = document.getElementById('controls')` ——
所以**AI 思考的那最多 15 秒里，人类玩家自己的操作区渲染全部写进了隐藏 box，屏幕上的控件
不更新**。这是一个既有的、纯浏览器端的 UX 缺陷，和迁移无关。

**对迁移的意义（正面）**：这个缺陷在 Node 服务里**自动消失**——Node 进程里没有人类共享
同一个 document，改名窗口期间没有任何「人类渲染」需要被正确路由。**这反而是迁移的一个
额外收益，不是新增风险。**

**多房间的判断维持不变**：多房间共享一个 document 时，房间 B 的 collect 会撞上房间 A 未
归还的改名状态。但如果按上一节建议走「一房间一进程」，每个进程有自己的 document，
这个问题一并消失，不需要额外加锁。

---

### 2️⃣ `confirmAndPlay` 是否对机器人可达 —— **可达，风险 3 不是理论风险**

先修正上一节的一处计数：全项目 `confirmAndPlay` 调用点是 **15 处**（不是 17；grep 到的
16 处里有 1 处在注释里）。

**逐处回溯所在 phase 的结果**：

| 所在 phase | 调用点 | L1 会不会碰 | 判定 |
|---|---|---|---|
| `play` | 3694, 3701, 3737, 3761, 3805, 3838, 3847, 3865, 3881, 3890, 3910, 3924（12 处） | ❌ `play` 在 L1 **之前**由 `botPlay` 结构化接管 | ✅ 不可达 |
| `dying` | 3150（涅槃） | ❌ `dying` 在 L1 之前 | ✅ 不可达 |
| `lirangAsk` | 2306（礼让） | ❌ `lirangAsk` 在 L1 之前 | ✅ 不可达 |
| **`wuxie` 等 5 个响应阶段** | **361（于吉【蛊惑】，在 helper `addGuhuoResponseButtons` 里）** | **⚠️ 见下** | **🔴 可达** |

第 361 处不在任何单一 phase 里，它在共用 helper `addGuhuoResponseButtons(container, g, me, role)`
内部，被 5 个响应阶段调用：`respond`(2949)、`duel`(3000)、**`wuxie`(3059)**、`dying`(3146)、
`aoeResp`(3231)。其中四个都在 L1 之前被结构化接管——**唯独 `wuxie` 在
`CONTROLS_CHOICE_ALLOWLIST` 里，而且不在 `CONTROLS_CHOICE_EXCLUDE` 里**，
也就是说**连没有 AI 密钥时 L1 都会接管它**。

**实测复现**（`run_bot_domhost_probe_test.js` 场景1，无密钥模式）：

```
controlsChoiceMatch(g, 0) === true
收集到的候选: ["蛊惑:手牌【杀】当【无懈可击】","蛊惑:手牌【闪】当【无懈可击】"]
点击其中一个 → showConfirm 被调用 1 次，startGuhuoResponse 被调用 0 次
```

**触发条件**：机器人座位的武将是于吉（或任何有 `guhuo` cap 的武将）+ 处于 `wuxie` 无懈询问
阶段 + `g.guhuoUsed` 为 false + 手牌非空。

**当前（浏览器端）的实际后果**：不是死锁，但是个真实 bug —— 机器人「点」了按钮之后，
**担任机器人控制者的那名真人玩家的屏幕上会突然弹出一个确认框**（「扣置这张手牌发动【蛊惑】，
声明为【无懈可击】？」），而这个框是替机器人弹的。真人点「确定」它才生效、点「取消」就
没了。相当于机器人的决策被静默转交给了人类。

**迁移到 Node 后的后果**：headless 环境没人点确定 → 动作永不执行 → 状态不变 →
`scheduleBotTurn` 靠状态变化驱动、不会重试 → **永久卡死**（CLAUDE.md 第 26 条的模式）。

**结论：风险 3 的等级要上调。** 它不再是「迁移时不要引入原本不存在的可达路径」，而是
**「已经存在一条可达路径，且迁移会把它从『界面困惑』升级成『永久卡死』」**。
B-3（headless `showConfirm` 自动确认）必须**在阶段2 接上决策的同时就做**，不能拖到阶段3。

> 附带：这条路径在浏览器端也值得单独修一次（机器人不该让人类替它确认）。属于既有 bug，
> 建议和 C-1 发现的两处漏登记一起，单独开任务处理。

---

### 3️⃣ `aiTestAutopilot`（真人座位 AI 托管）的去向 —— **建议：保留在浏览器端，第一版不搬**

**现状盘点**：共 45 处引用，分布是 `ai-bot.js` 32 / `bot.js` 11 / `render.js` 2 /
`bot-ai-bus.js` 2。其中 `ai-bot.js` 那 32 处绝大多数是 UI（托管开关、状态徽标、决策记录
信息窗、弹窗）。它还会把托管状态发布到 RTDB：`publishAiTestAutopilot` 写
`players/{seat}/aiAutopilot`，并挂 `onDisconnect().set(false)` 做断线自动撤销。

**建议不搬，理由三条**：

1. **归属语义对不上。** `publishAiTestAutopilot` 的守卫是 `if(p.cid !== myClientId) return g;`
   —— 托管的前提是「这个座位属于**我这个浏览器**」。Node 进程不拥有任何座位，要搬过去
   就得先发明一套「谁授权 Node 代打我的座位」的授权模型，这是纯新增复杂度，和迁移目标
   （把机器人搬出浏览器）无关。
2. **两者天然不冲突。** Node 服务只驱动 `p.isBot === true` 的座位；托管驱动的是真人座位
   （`p.cid` 有值、`isBot` 为 false）。**两个集合不相交**，可以共存，不需要任何协调机制。
3. **它本来就是个调试/演示工具**，不是对局必需功能；32/45 的引用是 UI，搬到无界面的 Node
   进程里，「决策记录信息窗」这个它最主要的价值直接归零。

**⚠️ 但有一个必须注意的实施细节**（这条修正了上一节 3.2 的建议）：

上一节建议在 `scheduleBotTurn` 开头加 `if (g && g.botServerActive) return;`。
**这样写会把托管一起关掉** —— 因为托管正是靠 `scheduleBotTurn` 里的 `aiTestSelf` 分支
放行的（非控制者浏览器也能驱动自己的托管座位）。正确写法必须是座位感知的：

```js
const aiTestSelf = (typeof aiTestAutopilot!=='undefined') && aiTestAutopilot
  && aiTestAutopilot.active && aiTestAutopilot.seat === mySeat;
if (g && g.botServerActive && !aiTestSelf) return;   // Node 接管机器人座位，但不影响真人托管
```

即：**Node 服务在线时，浏览器端只让出「机器人座位」的驱动权，保留「自己托管自己座位」的
能力。**

---

## 基于新数据：对上一节实施计划与风险评级的调整

### 需要调整的

| 项 | 原判断 | 新判断 | 依据 |
|---|---|---|---|
| **风险 3（`confirmAndPlay`）** | 🟠 中等；「大概率已被覆盖住，属理论风险」 | **🔴 上调为高危，且提前到阶段2** | 实测确认 `wuxie` + 于吉【蛊惑】是一条**真实可达**路径，无密钥也会命中；迁移后由「界面困惑」变成「永久卡死」 |
| **B-3（headless `showConfirm`）** | 阶段3 做 | **提前到阶段2，与「接上决策」同批** | 同上。否则阶段2 一跑到那个场景就卡死，会污染阶段2 的稳定性判断 |
| **风险 2 中的 `classList.contains`** | 点名担心的退化实现 | **风险解除** | 实测渲染期间**一次都没被调用**，对按钮收集路径无影响 |
| **风险 2 的具体形态** | 泛泛地担心「静默差异」 | **收敛为一个具体 API 的两种用法**（`innerHTML`），共 8 个 phase，且已定位到行号 | C-2 成因探测 |
| **C-3 单房间「无害」** | 无害 | **对正确性无害，但对人类界面有害**（AI 思考期间人类控件区不更新）；且该缺陷**在 Node 里自动消失** | 实测 `getElementById('controls')` 在窗口期指向隐藏 box |

### 不需要调整的

- **阶段划分（0→1→2→3→4→5）整体成立**，且 C-1 数据**支持**「阶段2 先禁用 DOM 路径」这个
  分期：无密钥下只有 5 个 phase 受影响。
- **风险 1（`mySeat`，约 893 处）仍是最高风险**，本轮没有任何新数据改变这个判断。
- **多房间用「一房间一进程」**的建议不变，且 C-3 的实测让它多了一条支持理由（顺带解决
  document 共享冲突）。

### 阶段2 的清单需要补两条

1. 实现 headless `showConfirm`（B-3），**在接上决策之前**；
2. 补 `wuxie`/`luoyingAsk`/`luoshen` 三个 ALLOWLIST phase 的结构化决策分支——它们是无密钥
   模式下仅有的 3 个 L1 依赖，补掉之后**无密钥模式可以做到完全不需要 DOM 宿主**（只剩
   `guhuoTarget`/`quhuDamageChoice` 两个 bug，各补一行注册即可）。这会让阶段2 的验收
   标准变得非常干净：**无密钥 + 零 DOM 宿主，机器人应能完整打完一局**。

### 顺带发现、建议单独立项的既有 bug（都与迁移无关）

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | `guhuoTarget` 未登记 `BOT_PHASE_ACTOR` | 专用分支（bot.js:4590）是死代码，从未执行过 | ✅ **已修复** |
| 2 | `quhuDamageChoice` 未登记 `BOT_PHASE_ACTOR` | 专用分支（bot.js:4596）是死代码，从未执行过 | ✅ **已修复** |
| 3 | `wuxie` 阶段机器人会点出 `confirmAndPlay` 按钮 | 替机器人给真人弹确认框，决策被静默转交给人类 | ✅ **已修复** |
| 4 | `zhimengPick` 的按钮 label 渲染成字面量 `"undefined"` | ~~render-controls 自身的渲染缺陷~~ | ❌ **假阳性，已撤回** |

### 这 4 条的最终处理（修复批次）

**Bug1/Bug2 —— 确认属实，按 `xuanfengPick` 的既有先例修复。** 两条各补一行
`BOT_PHASE_ACTOR` 登记（`guhuoTarget:'sourceSeat'`、`quhuDamageChoice:'seat'`，字段名与
服务端身份守卫逐一核对过）。修复过程中把严重程度查得更细了，比原报告写的「死代码」更糟：

- `guhuoTarget` 在 `renderControls` 里**只渲染 banner + 座位卡高亮，不产生任何 `#controls`
  按钮**，所以 `botSafePrompt` 一个按钮都点不到 → `runBotFallbackProbe` 只打一条
  `console.warn` 就返回 → 状态一字不变、机器人不会改主意 → **真正的永久卡死**。
- `quhuDamageChoice` 会渲染按钮，但文案「令 X 对 Y 造成1点伤害」既不命中 `botSafePrompt`
  的安全正则也不命中必选正则，**只有「目标恰好只剩1个」时才靠「唯一按钮」兜底侥幸走通，
  目标 ≥2 个时同样永久卡死**（和 `luanwuChoose` 当初的情况完全一样）。

**Bug3 —— 确认属实，修法是给点击加来源标记。** 新增 `bot.js` 的模块级
`botClickInProgress`，只在 `controlsChoiceExecute`（L1）和 `botSafePrompt`（兜底）**同步
的 click 那一瞬**置位、`finally` 无条件复位；`render.js` 的 `confirmAndPlay` 读到该标志
就跳过 `showConfirm` 直接执行 `actionFn`。刻意**不改** `renderControls` 里那 15 处
`confirmAndPlay` 的按钮定义（真人的二次确认行为必须原样保留），也**不调**
`resetSelectionState()`/`render()`（那是清理真人选牌状态、重绘真人界面的，机器人这次点击
不该碰）。这不是 Node 迁移那套完整 headless confirm 机制，是给当前浏览器端生产环境的正式
修复；迁移阶段2 仍需按原计划做 headless `showConfirm`。

**Bug4 —— 复核为假阳性，撤回。** 原报告依据的是 jsdom 比对输出 `["undefined","undefined"]`，
但那是**我自己的合成测试数据造成的**：C-4 harness 里把 `pending.options` 写成了裸字符串
`['A','B']`，于是 `opt.label` 自然是 `undefined`。真实的 `getZhimengOptions()` 对三类候选
（手牌／装备／判定区）**恒设置 `label`**，用真实服务端函数产出的 options 渲染，按钮文案是
`["一张手牌","装备【青龙偃月刀】","判定区【乐不思蜀】"]`，不含 `undefined`。
`run_bot_scheduling_gap_fix_test.js` 用两条对照断言把这个结论钉住了（真实数据不含
`undefined` ／ 只有裸字符串 options 才会复现），防止以后再被误报成 bug。

> 这条是本轮调查里第二个「我自己的测试数据制造的假象」——第一个是 C-4 首轮把 `huogong`
> 误判成「一致」的假阴性。两次都指向同一条纪律：**合成 `g` 既会漏报也会误报，凡是靠合成
> 数据得出的结论，下结论前必须再用真实代码路径产出的数据复核一遍。**

---

## 本轮产出的可复现资产

`run_bot_domhost_probe_test.js`（**6/6 通过**）—— 把三个关键场景固化成可重跑的行为基线：

1. `confirmAndPlay` 可达性：`wuxie` + 于吉【蛊惑】，L1 确实收集到 `confirmAndPlay` 按钮；
2. `confirmAndPlay` 后果：点击只弹确认框（1 次），真实动作执行 0 次；
3. `controlsChoiceCtx`：改名窗口确实存在，`dispose` 后正确归还；
4. `controlsChoiceCtx` 单房间安全性：await 期间重渲染后，冻结的按钮仍可安全 `invoke`；
5. shim 缺口 P2：`huogongReveal` 的 label 退化成 `["按钮0","按钮1"]`；
6. shim 缺口 P1：`zhimengAsk` 在 shim 下候选数为 0。

**注意这 6 条断言目前锁定的是「缺陷存在」这个现状**。阶段3 修好 shim / 实现 headless
`showConfirm` 之后，第 2、5、6 条的预期会**反转**——届时必须主动把断言改成新的正确预期，
而不是让它们继续「静静地通过」（CLAUDE.md 第 20 条：设计变更后必须回头检查旧断言的语义
是否还成立）。测试文件头部已写明这一点。

---
---

# C-4 补齐（第三轮）：21 个「未验证」清零

> 目标：把上一轮剩下的 21 个 `⚪未验证` phase 逐一验证到底，用**成因探测**（不用容易漏判的
> 纯输出比对）。同样只做调查，不含生产功能代码改动。
>
> 产出：`run_bot_shim_gap_protection_test.js`（11/11）。

## 方法修正：先修好探针自己

这一轮开始时探针给出了「13 个 phase 在 shim 下渲染出 0 个按钮、jsdom 却全都正常」这种
夸张结果。**这不是被测对象的问题，是探针自己的缺陷**：

- 我为了做「未实现 DOM 属性」探测，给 shim 元素套了一层 `Proxy`。去掉 `Proxy` 后，同样的
  11 个 phase 立刻恢复成和 jsdom 完全一致 —— 证明是 `Proxy` 破坏了 shim 的渲染。
- 顺带回头复核了**上一轮的 C-2 成因探测也用了同一个 `Proxy`**。重跑无 `Proxy` 版本，
  结果**逐字相同**（同样 6 个 P1、2 个 P2、P3/P4 均未被调用）——上一轮的 C-2 结论不受影响，
  确认无误。
- 去掉 `Proxy` 后失去了「未实现属性」探测能力，改用更可靠的信号：
  **把 `collectControlsCandidates` 用 `try/catch` 吞掉的渲染异常 surface 出来**（缺任何 API
  都必然抛异常）。这一招立刻抓到一个此前被静默吞掉的问题：`generalAvatarSrc is not defined`
  —— 那是 render.js 的函数、我的沙箱没提供，导致 huashen 系列三个 phase 只渲染了一半。
  补上 stub 后才拿到完整结果。

**教训**：探针本身也要先证伪。这已经是本次调查里第三次「我自己的测试数据/测试代码制造的
假象」（前两次：`huogong` 假阴性、`zhimengPick` 假阳性）。

## 新发现的第三种分叉成因：P6

除了已知的 P1（容器 `innerHTML` 塞 button 字符串）、P2（按钮 label 用 `innerHTML`），
这一轮新识别出：

**P6 —— 把 `container.innerHTML` 当作「是否为空」的判断依据。**
`render-controls.js:4174` 有 `if(yuanshuSeatTongji !== null && c.innerHTML==='')`。
shim 的 `innerHTML` 是独立字段，`appendChild` 之后仍是 `''`；规范 DOM 会反映子节点。
两者对这个判断得出**相反结论**。

**实测确认它会被触发**（`discard` 分支是 `else-if` 链、不 `return`，会一路落到函数末尾那段
袁术【同疾】判断；场上有袁术时即命中），**但结论是无害**：该代码块只调 `setBanner(...)`，
**从不创建按钮**。机器人读的是按钮不是 banner，所以 P6 不影响按钮集合。
记录在案，阶段3 若要让 shim 支持 banner 相关断言时需要重新评估。

## 21 个 phase 的逐一结论

| 结论 | 数量 | phase |
|---|---|---|
| ✅ **已验证一致** | **16** | `discard`、`haoshiPick`、`huanhuoPickSecond`、`huashenPick`、`huashenChangePickStart`、`huashenChangePickEnd`、`jiedaoChoice`、`luanjiConfirm`、`mengjin`、`pickingGeneral`、`pickingLordGeneral`、`qiangxiPickTarget`、`qilin`、`quhuDamageChoice`、`shaOffsetChoice`、`xuanfengPick` |
| 🔴 **确认存在差异**（P1） | **1** | `renxinChoose` |
| ⬜ **设计上就不产生 `#controls` 按钮**（两边一致，均为 0） | **4** | `guhuoTarget`、`tianyiPickCard`、`tianyiPickTarget`、`wugu` |

关于那 4 个「设计上无按钮」的：它们不是渲染缺陷，是交互方式不同 —— `guhuoTarget`/
`tianyiPickCard`/`tianyiPickTarget` 靠**点座位卡**、`wugu` 靠**点中央牌池**，`renderControls`
只负责写 banner。shim 和 jsdom 都渲染 0 个按钮，属于**真一致**，不是「没验证到」。
（这也解释了 `guhuoTarget` 漏登记为什么是硬卡死：连兜底能点的按钮都没有。）

另外补一个边界记录：`discard` 在**手牌超上限**时两个按钮都是 `disabled`（`确认弃牌` 要选够
数量才启用、`结束回合` 要弃完才启用），所以 `button:not(:disabled)` 收集到 0 个 —— 两边一致，
是正确行为。手牌未超上限时正常渲染出可点的 `结束回合`。

## 全量最终清单（120 个决策态 phase）

| 分类 | 数量 | 占比 |
|---|---|---|
| ✅ **已验证一致** | **107** | 89.2% |
| 🔴 **确认存在差异** | **9** | 7.5% |
| ⬜ **设计上无 `#controls` 按钮**（两边一致） | **4** | 3.3% |
| ⚪ 未验证 | **0** | **0%** |

**🔴 9 个差异 phase 及其成因（成因只有 `innerHTML` 一个 API 的两种用法）**：

- **P1（7 个）** 容器 `innerHTML` 塞 `<button>` 字符串 → shim 不解析 HTML → **0 个按钮**：
  `beigeChoose`、`beigeDiscard`、`beigeJudge`、`chengxiangAsk`、`zhimengAsk`、`zhimengPick`、
  **`renxinChoose`**（本轮新增）
- **P2（2 个）** 按钮 label 用 `innerHTML` 设置 → shim 的 `textContent` 恒空 → label 退化成
  `按钮N`：`huogong`、`huogongReveal`

## 这 9 个差异对生产是否有害：全部无害，且已上锁

对 9 个逐一验证「三重保护」是否齐全（不只看 EXCLUDE，要求专用分支**真的提交动作**）：

| 保护条件 | 9 个的结果 |
|---|---|
| ① 在 `CONTROLS_CHOICE_EXCLUDE` 里（L1 不会镜像它的按钮） | ✅ 9/9 |
| ② 在 `BOT_PHASE_ACTOR` 里登记（`botSeatForState` 能解析行动者） | ✅ 9/9 |
| ③ `runBotDecision` 专用分支**真的提交了动作**（实测 tx 发生） | ✅ 9/9 |

**结论：本轮没有发现新的真实 bug。** 这 9 个 phase 的机器人决策完全不经过读按钮的路径，
shim 缺口够不着它们。

> 验证过程中也踩了一次自己的坑：第一版保护检查 9 个全报「没提交动作」，看着像 9 个新 bug。
> 实际是我把计数用的 `gameRef` 挂在了 sandbox 属性上，而 `game.js` 的 `let gameRef` 是脚本
> 作用域绑定、会遮蔽它 —— 必须用 `vm.runInContext` 赋裸标识符。改对之后 9/9 全部正常提交。
> **「结果整齐划一地异常」几乎总是探针的问题，不是被测对象的问题。**

`run_bot_shim_gap_protection_test.js` 把这个不变量钉住了（11/11）：9 个 phase 各一条三重
保护断言 + 一条「缺口清单本身没变」的结构断言（P2 写法全项目恰好 2 处，新增就会红）+
一条对照断言（这 9 个在 shim 下确实失真，证明保护不是多余的）。已用「把 `renxinChoose`
从 EXCLUDE 移除」验证过该断言真的会红。

## 最终结论

### C-4 是否 100% 验证完毕？—— **是**

120 个决策态 phase 全部有明确结论，`未验证` 归零。缺口边界清晰且极小：
**只有 `innerHTML` 一个 API 的两种用法，共 9 个 phase，且全部被三重保护挡住、当前对生产无害。**

阶段3 要做的事因此变得非常具体，不再是开放式的「补齐 shim」：
1. 给 shim 的 `innerHTML` setter 加一个只需处理 `<button>` 的极简解析，并让它同步更新 `_text`
   —— 一处改动同时消灭 P1 和 P2 全部 9 个 phase；
2. P6 记录在案但无需处理（banner-only）；
3. 上线前按第一轮列的「浏览器 vs Node 按钮集合逐阶段对拍」再跑一次，这次有了 107 个
   已知一致的基线可以直接对照。

### 是否建议现在进入阶段1 的实际搭建？—— **建议：是**

支持的理由：

1. **阶段0 的三项调查全部完成**，没有悬而未决的未知项。原计划里「阶段0 产出的数据会决定
   阶段2 的规模」这个前提已经满足：DOM 路径真实占比 **无密钥 4.2% / 有密钥 14.2%**，
   且高频阶段（`play`/`respond`/`duel`/`dying`/`aoeResp`/`draw`/`discard`）**全部**在 L1
   之前被结构化接管、永不碰 DOM。
2. **11 个源文件在 Node + 最小 shim 下零报错加载**，`renderControls` 在 107/120 个 phase 上
   与规范 DOM 输出一致 —— 「B 类可行性」已经不是推断而是实测。
3. **调查期间发现的 3 个既有 bug 已全部修复并上锁**（两个漏登记 + confirmAndPlay 可达），
   而且顺带补齐了两个 phase 的超时兜底。**阶段1 不会带着已知缺陷起步。**
4. 阶段1 的内容（Node 骨架 + Firebase Admin 接入 + 只订阅只打印、不提交任何动作）
   **本身不依赖任何尚未澄清的东西**，且它把「环境搭起来」和「决策正确性」彻底解耦，
   是风险最低的一步。

需要在阶段1 就一并处理的（来自本轮及上一轮的结论）：

- 第一件事写 `.gitignore` 再去下服务账号私钥（风险 5）；
- Firebase Admin 显式传 `{applyLocally:false}`；
- `botServerActive` 开关必须**座位感知**（`&& !aiTestSelf`），否则会连真人托管一起关掉。

**唯一不变的最高风险仍是 `mySeat`（约 893 处隐式读取）**，但阶段1~4 全程单房间不碰它，
只有进入阶段5 多房间时才需要面对 —— 而那时的建议依然是「一房间一进程」绕开，不要正面重构。
