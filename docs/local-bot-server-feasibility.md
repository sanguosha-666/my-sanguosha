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
