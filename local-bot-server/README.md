# local-bot-server —— 本地机器人服务

独立的 Node 进程,直连 Firebase RTDB。目前有两个独立入口:

- **`watch.js`(阶段1,只读)**：订阅某个房间的完整状态并打印,**不写入任何数据**、不含
  任何机器人决策逻辑。用于验证"Node 进程能不能连上、能不能读到真实状态"。
- **`run.js`(阶段2,会写入)**：在阶段1的基础上,**真正接管无密钥模式下"结构化决策能
  完全覆盖"的机器人动作**,并写入 Firebase。这是这个目录第一次有真实写入行为。

两者可以独立运行,互不影响——`watch.js` 的"只读"边界没有被这次改动触碰。

详见仓库根目录 `docs/local-bot-server-feasibility.md`(可行性评估与架构设计的完整讨论)。

下面「一~五」讲的是两个脚本共用的密钥/环境/配置准备(阶段1、阶段2都要做这些);
**阶段2 专属的架构说明、手动验证步骤、竞态处理见文件末尾「七、阶段2:接管结构化决策」**。

---

## 一、密钥文件:放在哪、叫什么名字(需要你自己操作)

**这一步只能由你完成**——我没有你 Firebase 控制台的访问权限。

1. 打开 [Firebase 控制台](https://console.firebase.google.com/) → 选择这个项目
   （项目 ID 见 `config.js` 里的 `projectId`,目前是 `sgs666-733bf`）→
   齿轮图标「项目设置」→「服务账号」标签页 → 点击「生成新的私钥」,浏览器（大概率
   跑在 Windows 侧）会把 `xxxxx-firebase-adminsdk-xxxxx.json` 下载到 Windows 的
   下载目录。
2. 把这个文件**改名**为 `serviceAccountKey.json`,拷贝到
   **`local-bot-server/serviceAccountKey.json`**（就是本 README 所在的目录下,
   和 `watch.js`/`package.json` 同级——这是一条 WSL/Linux 风格路径,不是
   `C:\...`）。从 Windows 下载目录拷进 WSL,可以在 WSL 终端里用类似这样的命令
   （按你实际的 Windows 用户名替换 `<Windows用户名>`,WSL 下 Windows 盘符挂载在
   `/mnt/c/`)：

   ```bash
   cp "/mnt/c/Users/<Windows用户名>/Downloads/xxxxx-firebase-adminsdk-xxxxx.json" \
      local-bot-server/serviceAccountKey.json
   ```

   拷完之后密钥文件本体就完全在 WSL 文件系统内了,后续 `watch.js` 读取它不会跨
   文件系统,也符合上一节「项目代码放在 WSL 文件系统内」的要求。
3. 这个路径已经被 `.gitignore` 排除（根目录 `.gitignore` 新增的
   `local-bot-server/serviceAccountKey*.json` 规则,任何以 `serviceAccountKey`
   开头的 `.json` 文件都不会被 git 跟踪）,`git status` 不会显示它、`git add -A`
   也不会把它加进暂存区。可以放心把真实密钥放在这里。
4. 如果你想放在别的路径(比如不想和代码放一起),用环境变量
   `FIREBASE_SERVICE_ACCOUNT_PATH` 指定绝对路径即可,不强制用默认路径。

**⚠️ 这个文件拥有你整个 Firebase 项目的完全读写权限,绕过所有安全规则,不要用任何方式
分享给我、上传到任何地方、或提交进 git。**

---

## 二、环境准备

执行环境是 **Windows 上的 WSL2**（Linux 子系统),Node.js 通过 `nvm` 安装(建议
18 及以上;可以用 `node -v` 确认当前版本)。

**⚠️ 项目代码必须放在 WSL 自己的文件系统内**（比如 `/home/你的用户名/...`),
**不要**放在 `/mnt/c/...` 这类挂载的 Windows 盘符路径下——跨文件系统 I/O（尤其是
`node_modules` 里成百上千个小文件的读写)在 WSL2 里会明显变慢,`npm install`、
`node watch.js` 启动都会受影响。这个仓库当前的路径
（`/home/admin2/my-project/sanguosha`)已经在 WSL 文件系统内,符合要求,不需要挪动。

### 在 WSL 终端里

```bash
cd local-bot-server
npm install
```

会安装 `firebase-admin`（唯一的依赖）到本地 `node_modules`（同样被 `.gitignore` 排除,
不会被提交)。

---

## 三、配置:三个必需值

除了密钥文件本身,还需要三个配置项。**推荐用 `.env` 文件**（比每次在命令行敲环境变量方便）：

在 `local-bot-server/` 目录下新建一个文件,命名为 `.env`（同样已被 `.gitignore` 排除)，内容:

```
FIREBASE_DATABASE_URL=https://sgs666-733bf-default-rtdb.firebaseio.com
ROOM_ID=你要观察的房间号
```

- `FIREBASE_DATABASE_URL`：和浏览器端 `config.js` 里 `firebaseConfig.databaseURL` 的值
  **必须完全一致**（当前项目就是上面这个,可以直接抄，除非以后 Firebase 项目换了）。
- `ROOM_ID`：要订阅哪个房间号,和你在浏览器里加入房间时填的房间号完全一致（区分大小写)。
- `FIREBASE_SERVICE_ACCOUNT_PATH`（可选)：只有当密钥文件没放在默认路径
  `local-bot-server/serviceAccountKey.json` 时才需要设置,填密钥文件的绝对路径。

如果不想用 `.env` 文件,也可以直接在命令行里设置环境变量后再启动（bash 示例）：

```bash
FIREBASE_DATABASE_URL="https://sgs666-733bf-default-rtdb.firebaseio.com" \
ROOM_ID="你的房间号" \
node watch.js
```

两种方式二选一即可,`.env` 文件更省事、不容易漏敲。

---

## 四、运行

```bash
cd local-bot-server
npm start
```

（等价于 `node watch.js`。）

**启动成功**会先打印一段横幅,显示订阅的房间号/数据库地址/密钥文件路径,然后开始等待:

```
==============================================
 本地机器人服务 阶段1骨架 —— 只订阅只打印,不写入
 房间号     : abc123
 数据库地址 : https://sgs666-733bf-default-rtdb.firebaseio.com
 密钥文件   : .../local-bot-server/serviceAccountKey.json
==============================================

正在订阅 rooms/abc123/game ,等待状态变化...
```

**启动失败**（密钥文件找不到、环境变量缺失、密钥内容不完整等)会打印清晰的中文错误提示
和排查方向,不会是一堆看不懂的堆栈。

按 `Ctrl+C` 可以随时安全退出。

### 打印格式:精简摘要 / pending 展开 / VERBOSE 完整模式

默认打印是**精简过的**,目的是减少刷屏、让真正需要关注的信息（新出现的待响应状态)
醒目突出。具体分两种情形（判断依据只是 `phase`/`pendingType`/`turn`/`roundNum`/每个
玩家的 `hp`/`alive` 这几个关键字段有没有变化,和 Firebase 订阅本身的推送频率无关——
如果这几个关键字段和上一次打印时完全一样,这次回调**不会**打印任何东西,避免无关字段
变化刷屏)：

**普通 phase 流转 / 非 pending 字段变化**（没有 pending,或者 pending 类型和上一次打印
的还是同一种、没有新的待响应状态出现),打印精简单行摘要,phase 有变化时用 `→` 标出
「从什么变成什么」：

```
23:38:15 [chibi] play → discard turn2/round1 座位0(8984,hp2,存活) 座位1(机器人1,hp3,存活) 座位2(机器人2,hp4,存活)
```

**出现新的待响应状态**（`pending.type` 不为空,且和上一次打印过的 `pendingType` 不同——
说明这是一次新出现的、值得关注的询问),用 `⚠️` 分隔线展开打印,并附上脱敏后的完整
`pending` 内容（脱敏规则不变,牌面相关字段一律替换成占位符)：

```
⚠️ ============================================================
23:38:20 [chibi] ⚠️ 新的待响应状态: wuxie
⚠️ ============================================================
pending(白名单脱敏后): {
  "type": "wuxie",
  "seat": 1,
  "card": "[已隐藏:可能含具体牌面/手牌内容,不写入日志]"
}
```

**VERBOSE 详细模式**：设置环境变量 `VERBOSE=1`（或 `VERBOSE=true`)启动,会完全恢复成
改动前"每次订阅回调都打印完整 JSON、不做单行摘要压缩、不做去重"的方式,用于需要深入
排查时切回完整信息：

```bash
VERBOSE=1 node watch.js
```

或者写进 `.env` 文件里一行 `VERBOSE=1`。

---

## 五、手动验证步骤清单

请按这个顺序操作,确认骨架真的能连上、能收到真实数据：

1. **启动脚本**：按上面「四、运行」的步骤跑起来,确认看到启动横幅、没有报错,
   停在「正在订阅...等待状态变化...」这一行。

2. **开一局游戏观察初次快照**：用浏览器打开这个项目的网页,加入你在 `.env` 里配置的
   那个 `ROOM_ID` 房间号（新房间或已有房间都行)。回到终端,应该立刻看到一条精简单行
   摘要（见上面「打印格式」一节),里面的 phase 应该和浏览器里当前所在的阶段一致
   （比如还没开始游戏是 `lobby` 或 `null`，具体看当前房间状态)。

3. **验证状态变化能被实时推送到终端**：在浏览器里做一个会改变游戏状态的操作
   （比如点「开始游戏」、选武将、出一张牌、结束回合)。**每做一次操作,终端应该立刻打印
   一条新的单行摘要**（不需要刷新终端、不需要重启脚本——这是 Firebase 的实时订阅,
   状态一变就推送;如果这次操作没有改变 phase/pendingType/turn/roundNum/任何玩家的
   hp/alive,则不会有新打印,这是预期的去重行为,不是没收到推送)。检查打印出的
   `turnN/roundN` 和座位摘要是否和浏览器界面显示的一致。

4. **验证 pending 展开打印**：让游戏进行到某个需要人响应的阶段（比如有人被出杀、
   需要出闪;或者用南蛮入侵/万箭齐发这类需要多人响应的锦囊)。此时终端应该打印一段
   `⚠️` 分隔线展开的「新的待响应状态」块,附带 `pending(白名单脱敏后): {...}`，里面能
   看到 `type`（比如 `"wuxie"`）、`from`/`to` 这类座位号字段,但**不应该出现任何具体的
   牌名/花色/点数**（凡是牌面相关字段,应该显示成
   `"[已隐藏:可能含具体牌面/手牌内容,不写入日志]"` 这样的占位符，而不是真实牌面)。这一步
   是在验证隐私脱敏白名单确实生效。如果需要连续追踪同一个 pending 内部的进展细节
   （比如南蛮入侵依次问到了哪个座位),可以用 `VERBOSE=1` 启动,切回每次回调都打印完整
   JSON 的模式。

5. **验证只读、不影响游戏**：这个脚本运行期间,正常在浏览器里继续把这一局玩完
   （或玩几个回合)。游戏应该完全正常进行,不应该出现任何异常行为、卡顿、或状态被
   意外修改的迹象——因为这个脚本从头到尾没有调用任何写入 API,纯粹是"看客"。

6. **验证安全退出**：按 `Ctrl+C`，应该看到「收到退出信号,断开订阅并退出。」然后进程
   干净退出（不留后台残留进程)。

如果 1~6 全部符合预期,说明这套骨架已经具备阶段2（接入真实机器人决策逻辑)的基础环境。

---

## 六、故障排查

| 现象 | 大概率原因 |
|---|---|
| `找不到服务账号密钥文件` | 密钥文件没放对路径,或没有按上面步骤重命名成 `serviceAccountKey.json` |
| `缺少环境变量 FIREBASE_DATABASE_URL` / `ROOM_ID` | `.env` 文件没建对位置(必须在 `local-bot-server/` 目录下,和 `watch.js` 同级)、或环境变量没设置成功 |
| `用服务账号密钥初始化 Firebase 失败(密钥文件内容可能不完整/被截断)` | 密钥文件在下载/复制过程中损坏了,重新从 Firebase 控制台生成一份 |
| 启动横幅打印出来了,但游戏里操作后终端没反应 | 检查 `ROOM_ID` 是否和浏览器里实际加入的房间号完全一致(区分大小写);检查这个服务账号是否有权限访问该 Firebase 项目的 RTDB |
| `[订阅错误]` | 大概率是数据库地址填错,或服务账号权限问题;把报错信息发给我进一步排查（**不要把密钥文件本身发过来**） |

---

## 七、阶段2:接管结构化决策(`run.js`,**会真正写入 Firebase**)

**⚠️ 请先用测试房间验证,不要直接在正在进行的真实对局房间上跑这个脚本。**这一步和阶段1
最大的区别就是"真的会写数据"——一旦决策逻辑判断错了目标/时机,是会真的打出一张牌、真的
结束一个回合的,不是打印一行日志那么简单。

### 这次的边界(卡死,不要假设它比这里写的做得更多)

- **只处理无密钥模式**：沙箱里从头到尾不设置 `aiApiKey`/`aiProvider`,不会调用任何 AI
  API,所有决策走的是 `bot.js`/`bot-ai-bus.js` 里"无密钥本地兜底"那一路(`localFallback`/
  `BOT_SEAT_PICKS` 的 `fallbackSeat` 评分)。
- **不处理依赖 DOM 宿主的决策路径**：`wuxie`(无懈可击是否打出)、`luoyingAsk`(甄姬洛神
  副技能落英)、`luoshen`(甄姬洛神判定后是否重新判定)这三个 phase,在无密钥模式下要靠
  L1(真的渲染一份控件、镜像点击可用按钮)才能决策,这次任务明确不碰——遇到这三个 phase,
  `run.js` 会主动把 `botServerActive` 让给浏览器端,自己什么都不做。
- **阶段3才做**：AI API 调用、`botSafePrompt` 这条"未知技能兜底"的 DOM 链路。

### 实现方式

- **复用真实源码,不重写决策逻辑**：`bot-runtime.js` 用 `vm` 模块把 `data.js`/
  `room-lifecycle.js`/`game.js`/`weapons.js`/`skills.js`/`bot-ai-bus.js`/`bot.js`/
  `ai-bot.js`/`render.js` 这九个真实文件加载进一个沙箱(和仓库里 `run_ai_bus_*.js` 测试
  套件同一套手法),只在沙箱边界提供最小的 `document`/`window`/`firebase` stub(所有方法
  返回无害的空实现,不会崩溃,但也做不了真正的 DOM 操作)。**这意味着阶段2上线后,任何
  阶段1~n 里对 `bot.js`/`game.js` 决策逻辑的改动,`run.js` 会自动跟着用——不需要在
  `local-bot-server` 目录里维护第二份决策代码。**
- **两个入口函数**：沙箱加载完之后,`bot-runtime.js` 定义了 `__botRuntimeDecide(g)`
  （只读,判断"这个 phase 现在归不归 Node 管")和 `__botRuntimeRun(g,seat)`（真正调用
  `runBotDecision`,里面会走到 `playCard`/`respondXxx` 这些函数,它们各自调用 `tx()`→
  真实的 `gameRef.transaction()` 完成写入)。`run.js` 只调用这两个函数,不直接碰游戏状态。
- **`gameRef` 桥接**：`game.js` 里 `let gameRef=null` 是模块顶层声明,`run.js` 传入的是
  一个真实的 Firebase Admin SDK ref(`db.ref('rooms/'+ROOM_ID+'/game')`),`bot-runtime.js`
  用 `vm.runInContext('gameRef = __adminGameRef;', sandbox)` 完成绑定(不能用宿主侧
  `context.gameRef=xxx` 属性赋值,`let`/`const` 顶层声明不会挂到沙箱全局对象上,这是这套
  vm 手法里的已知坑,项目里 `run_ai_bus_*.js` 测试套件的注释也提到过)。Admin SDK 的
  `ref.transaction(fn)` 和浏览器端 compat SDK 的 `.transaction(fn)` 返回值形状一致
  （`Promise<{committed, snapshot}>`),`tx()` 不用改一行就能直接工作。

### `botServerActive` 开关设计

**字段**：`g.botServerActive`（布尔,持久化在房间状态里,`normalize()` 里防御默认 `false`,
见 `game.js` 里贾诩【完杀】标记上方那段注释)。**只由 `run.js` 写,浏览器端只读不写。**

**浏览器端(`bot.js` 的 `scheduleBotTurn`)**：入口和 setTimeout 回调两处各加一道
座位感知的门(和之前 AI 托管的 `aiTestSelf` 判断挨在一起,不是新引入的机制):

```js
if (g.botServerActive && !aiTestSelf) return;
```

**`!aiTestSelf` 这半句是关键**——`botServerActive` 只接管"机器人座位"（`isBot===true`
或没有真人托管的座位),**不接管任何真人正在托管自己座位的情况**（`aiTestAutopilot.active
&& aiTestAutopilot.seat===mySeat`）。这是复用可行性评估文档里特别强调过的教训:两者是
完全独立的两件事,不能用同一个开关一刀切关掉。

**Node 端的持有策略**：不是"启动时设一次 true、退出时才设 false"这种粗粒度的整局持有,
而是**逐个快照重新评估、按需持有/让路**：

```
每次收到新的房间状态快照 g:
  ├─ g.phase 是 wuxie/luoyingAsk/luoshen 之一(DOM-required)?
  │    是 → 如果当前 botServerActive===true,把它设回 false(让路给浏览器端),
  │         什么都不做,直接 return
  ├─ botSeatForState(g) < 0(真人回合,或这个 phase 没有结构化分支覆盖)?
  │    是 → 维持 botServerActive 现状不动,什么都不做,直接 return
  └─ 否则(有一个"结构化决策能覆盖"的机器人动作要做)
       → 如果当前 botServerActive!==true,先设成 true(接管)
       → 小幅随机延迟(400~800ms,和浏览器端 scheduleBotTurn 的防抖同一个用意)
       → 调用 __botRuntimeRun(g, seat) 真正执行决策
```

这样设计的好处:**`botServerActive` 的值永远精确反映"Node 这一刻到底能不能处理当前状态"**,
不会出现"Node 声称接管了、但其实这个 phase 它处理不了、浏览器端却因为看到 true 而完全不
行动"这种死锁——**这就是任务要求里"遇到需要DOM宿主的phase该怎么判断"的具体答案**:判断
依据是 `bot-runtime.js` 里的 `EXCLUDED_PHASES` 显式名单（目前是 `wuxie`/`luoyingAsk`/
`luoshen`,依据是可行性文档 C-1 调查的结论),不是猜/不是笼统地"复杂就交给浏览器"。

**崩溃/断线安全网**：`run.js` 启动后立刻绑定
`gameRef.child('botServerActive').onDisconnect().set(false)`——这是 Firebase 服务端维护
的一个"连接断开时自动执行"的操作,不依赖 Node 进程自己还活着去清理。**Node 进程被强杀、
断网、笔记本直接合盖,都会触发它**,浏览器端立刻能重新接管。`Ctrl+C` 走的是正常退出路径
（`run.js` 自己先显式 `set(false)`,3 秒超时保底强制退出),onDisconnect 是兜底,不是唯一
手段。

### 竞态冲突:怎么识别、怎么处理

**这是阶段2相对阶段1唯一新增的风险类别**（阶段1只读,不存在这个问题)。可能出现的场景:
Node 进程和浏览器端在极短的时间窗口内都认为"现在该我处理这个决策"(比如 `botServerActive`
刚被 Node 设成 `true`,但浏览器端还没收到这次更新的推送,仍停留在旧值 `false`)。

**第一层防护(概率性,降低发生窗口)**：`run.js` 在真正执行决策前有 400~800ms 的随机延迟,
给 `botServerActive` 的写入留出网络传播时间——现实中这个窗口通常只有几十到一两百毫秒
（Firebase 推送延迟),延迟设置得比这个宽裕。

**第二层防护(确定性,真正兜底的那一层)**：即使第一层没挡住、两边真的在同一时刻都发起了
"打这张牌"/"结束回合"这类动作,**最终不会真的执行两次**——`tx()` 包的每一个游戏动作函数
（`playCard`/`endPlay`/`respondXxx`……)开头都会校验 `g.phase`/`g.turn`/`g.pending` 之类
的字段是否还符合预期,而 Firebase 的 `transaction()` 本身是服务端原子操作:两个并发调用
必然有一个先落地、一个后落地,**后落地的那次拿到的是"已经被第一次改过"的最新状态**,校验
条件这时大概率已经不满足,函数会直接 `return g`(不产生任何效果)而不是真的又打一次牌。
这个安全网**在改动 `botServerActive` 之前就已经存在**(CLAUDE.md「二、整体架构」里反复强调
的"所有状态变更必须走 `tx(fn)`"约定),不是这次新加的,这次只是要利用好它。

**已经用一个模拟脚本验证过这条安全网确实生效**（沙箱内伪造并发,基于同一份旧快照连续两次
调用 `__botRuntimeRun`,两次都指向"座位0出杀"这同一个动作)：第一次调用真的执行、状态往
前推进;第二次调用因为读到的是"已经推进过"的最新状态,`phase` 校验不通过,安全地空转,
没有产生第二次效果、也没有抛异常。

**识别竞态的方法(手动验证/日常运行时都适用)**：
- 看 `run.js` 的日志——如果连续两次 `▶️ 执行决策` 之间,`store`/游戏状态实际只推进了一次
  该有的量(比如本该摸1张牌变成摸了2张,或者回合数没有按预期前进),说明真的发生了双重
  执行,这时候要重点检查 `botServerActive` 的写入时机是不是比预期慢(网络问题?)。
- 看浏览器端 Console:如果机器人座位在浏览器端和 Node 端"同时"各自打出了一张牌(用户在
  界面上会看到出牌动画/日志出现"错位"或"重复"的迹象),这是最直观的信号。
- **正常情况下(两层防护都在)不应该观察到任何用户可见的重复效果**——竞态如果真的发生,
  代价应该只是"多打了一次空转的 transaction"（Firebase 用量上的浪费,不影响正确性),
  不应该表现为游戏状态错误。如果观察到游戏状态真的错了(比如同一回合执行了两次摸牌阶段),
  说明这层防护本身有缺口,需要立刻停止 `run.js` 并反馈,不要继续跑。

### 手动验证步骤清单

**准备**：找一个测试房间(不是正在进行的真实对局),`.env` 里 `ROOM_ID` 指向它。三个座位
建议至少一个是机器人座位(`isBot`)或开着 AI 托管的座位,这样才有"该由谁处理"的场景可测。

1. **启动**：`cd local-bot-server && npm run bot`(等价于 `node run.js`)。应该看到启动
   横幅 + 沙箱加载九个文件的 `已加载 xxx.js` 日志,最后停在"沙箱加载完成,开始订阅并接管
   决策。"。

2. **验证 Node 正确接管**：在浏览器里把游戏开到机器人座位需要行动的阶段(比如轮到机器人
   出牌)。终端应该打印 `🔒 接管 botServerActive=true`,紧接着 `▶️ 执行决策 phase=play
   seat=N`,几百毫秒后 `✅ 决策执行完成`。**同时观察浏览器界面**：机器人座位应该像平时一样
   正常出牌/结束回合,不应该卡住、不应该出现两次动作。

3. **验证浏览器端不再重复驱动**：这一步是在确认"座位感知的门"生效——步骤2执行期间,打开
   浏览器 Console,不应该看到浏览器端自己也在跑 `runBotDecision`（如果项目里有相关调试
   日志)或触发第二次一样的动作。最直接的验证方式是看游戏日志里同一个动作只出现一次。

4. **验证浏览器端能看到 Node 提交的动作生效**：Node 执行的每一次决策,浏览器端应该像
   看到"另一个人在操作"一样实时更新(这就是 Firebase 实时同步的本职工作,没有任何特殊
   之处)——检查手牌数量、回合数、日志内容和 Node 终端打印的是否一致。

5. **验证 DOM-required phase 被正确让路**：想办法让游戏进行到 `wuxie`（有人用了决斗/南蛮
   之类,进入是否打无懈可击的询问阶段)。此时终端应该打印
   `⏭️ 跳过 phase=wuxie(依赖DOM宿主,已让浏览器端处理)`,同时如果 `botServerActive`
   之前是 `true`,应该先看到一条 `🔓 让路 botServerActive=false`。**浏览器端此时应该
   正常接管**（如果是机器人座位需要决策是否打无懈可击,浏览器端的旧机制应该照常工作,不
   应该卡住)。这一步验证的是"明确跳过、交还浏览器端"这条边界。

6. **验证断开后浏览器端自动接管回去**：`wuxie` 之类的阶段过去之后,确认 `botServerActive`
   变回了 `true`（回到步骤2的正常状态)。然后**直接强制杀掉 Node 进程**（`Ctrl+C`,或者
   更狠一点、模拟真实崩溃：`kill -9` 这个 `node run.js` 的进程,不走正常退出路径),观察
   Firebase 控制台或浏览器端行为——`botServerActive` 应该(通过 `onDisconnect()`)在几秒内
   自动变回 `false`,浏览器端的机器人座位应该恢复由浏览器自己驱动,游戏能继续正常进行,
   不应该永久卡死。

7. **验证正常退出同样干净**：重新 `npm run bot` 启动,这次用 `Ctrl+C` 正常退出,应该看到
   "收到退出信号,让路 botServerActive 并退出..."日志,进程干净退出,`botServerActive`
   变回 `false`。

如果 1~7 全部符合预期(尤其是第5、6步——这是这次任务里风险最高的两个点),说明阶段2这套
"结构化决策接管+让路"的机制是可靠的。**在你实际跑完这套验证之前,不要认为阶段2已经完成。**
