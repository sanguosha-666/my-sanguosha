# "异常日志"功能体检报告

> 审计时间：2026-08（分支 `chengcheng`）。范围：`debug-log.js`（写入入口/normalize 挂钩/前端弹窗）+
> `bot-ai-bus.js`/`bot.js` 里的两个调用点 + `index.html` 里 `#debugLogBtn` 及相关 CSS +
> Firebase 权限现状。**这次只审计，不修复**（附带的验证脚本 `run_debug_log_audit_probe.js`
> 是这次审计新增的，不是回归测试套件的一部分，不需要长期维护，但保留下来供以后复核）。
>
> 每条发现都标注了"验证方式"——是用测试脚本实测出来的（`run_debug_log_audit_probe.js` 里对
> 应的场景名），还是纯代码走读+具体行号推导出来的。前者的可信度更高，后者请自行判断是否需要
> 进一步实测确认。

## 严重程度分类总览

| 类别 | 数量 | 说明 |
|---|---|---|
| 🔴 可能导致隐藏信息泄露 | 3 条 | `pendingSnapshot` 原样转存部分技能的秘密字段，任何打开调试面板的玩家都能看到 |
| 🟠 可能导致写入量失控/数据不可靠 | 4 条 | 多客户端重复上报、频控 key 设计缺陷（双向都有问题）、无自动清理、Firebase 权限完全开放 |
| 🟡 纯体验瑕疵 | 3 条 | 房间号陈旧导致弹窗显示旧数据、连续点击无去重、机器人失败信息里可能带出牌名 |
| ✅ 审计后确认没有问题的类别 | 4 条 | 见文末专门列出 |

---

## 🔴 一、隐藏信息泄露风险

### 1.1 `guhuoQuestion`/`guhuoTarget`（于吉【蛊惑】）的 `actualCard` 字段会原样进入 debugLogs

**代码位置**：`skills.js:544`（`guhuoQuestion` 创建）、`skills.js:497`（`guhuoTarget` 创建）——两处都把
`actualCard`（诡称牌的**真实身份**，蛊惑这个技能唯一的博弈价值就建立在"别人不知道这张牌真实是什么"上）
直接塞进 `g.pending`。`game.js:595-615` 的 `normalize` 校验一旦发现 `sourceSeat`/`asking` 不再存活
（并发死亡完全可能发生——CLAUDE.md"濒死求桃"那段明确写了阵亡随时可能打断进行中的流程），就会调
`logPendingOrphan(g,'A:...')`（`game.js:603`/`612`），而 `debug-log.js:127-138` 的 `logPendingOrphan`
把 `g.pending` **原样** `JSON.parse(JSON.stringify(...))` 存进 `pendingSnapshot`，不做任何字段过滤。

**后果**：只要这个 A: 分支被触发一次（不需要密钥、不需要特殊条件，只需要于吉的对局里 `sourceSeat`
或 `asking` 恰好在这个 pending 存续期间死亡），`actualCard` 的真实牌名/花色/点数就会被写进
`debugLogs/{房间号}`，而这个节点没有任何按玩家过滤的机制——**任何一名玩家点开 `#debugLogBtn`，
都能在展开详情里直接看到本该保密的诡称真实牌面**，即使他自己完全不该知道这个信息。

**验证方式**：实测，`run_debug_log_audit_probe.js` 场景「【隐私】guhuoQuestion(于吉蛊惑)pending
被normalize清空时,pendingSnapshot里的actualCard...原样写进了debugLogs」——构造一个
`sourceSeat` 死亡的 `guhuoQuestion` pending，调用真实的 `normalize(g)`，断言写入的记录里确实带着
`actualCard.name`。**已实测通过（复现成功）**，不是理论推测。

### 1.2 `enyuanChooseOption`（法正【恩怨】）的 `heartCards` 会原样进入 debugLogs

**代码位置**：`game.js:7168` —— `heartCards: heartCards`（`damager.hand` 里的红色手牌，供伤害来源
自己选择"交出一张红牌"用）被直接存入 `g.pending`。对应的 `normalize` 校验在 `game.js:1216-1223`
（`enyuanChooseOption`），要求 `sourceSeat`/`damagerSeat` 都存活，否则同样走 `logPendingOrphan`。

**后果**：和 1.1 同一类问题——`damagerSeat` 这名玩家手里**具体有哪几张红色手牌**，本该只有他自己
知道（其它玩家最多能看到他手牌的张数），一旦这个 pending 被 orphan 清空，这份手牌列表就会原样写
进 debugLogs，对其它玩家可见。

**验证方式**：代码走读（未单独写测试脚本复现，但触发路径和 1.1 完全同构——同一个 `logPendingOrphan`
函数、同一种"原样转存 pending"的写法，1.1 已经用实测确认了这条写入路径本身是真实可达的）。

### 1.3 `huanhuoPickSecond`（法正【眩惑】）的 `transferCard` 会原样进入 debugLogs

**代码位置**：`game.js:7355`（`transferCard: gotCard`）——从第一个目标手牌里取出的具体那张牌，在
交给第二个目标之前，暂存在 `g.pending.transferCard` 里。对应 `normalize` 校验在
`game.js:1276-1288`（`huanhuoPickSecond`）。

**后果**：同上——这张牌在真正落到第二个目标手里之前，具体是哪张牌本不该被除发动者之外的人看到，
一旦 orphan 清空，会连带把这张牌的真实身份写进 debugLogs。

**验证方式**：代码走读，触发路径同构于 1.1。

**这三条的共同修复方向（仅供参考，这次不修）**：`logPendingOrphan` 不应该无差别 `JSON.stringify`
整个 `g.pending`，而应该维护一份"每种 `pending.type` 允许保留哪些字段"的白名单（或者反过来，一份
"这些字段名一律脱敏"的黑名单，如 `actualCard`/`heartCards`/`transferCard`/`hand` 等），在写入前过滤
一遍。这是一个系统性问题（不止这三个技能，任何以后新增的、pending 里会带真实手牌/秘密牌面的技能都
会有同样的风险），值得作为一条通用规则钉进 CLAUDE.md，而不是逐个技能打补丁。

---

## 🟠 二、写入量失控 / 数据不可靠风险

### 2.1 同一个"卡住的坏 pending"会被每个连接的客户端各自独立重复上报

**代码位置**：`game.js:2503`（`tx()` 写路径调用 `normalize(g)`）和 `render.js:1031`（**读路径**也调用
`normalize(g)`，且这行注释自己就写明"render() 几乎在每一次 tx() 提交后都会被 Firebase 的 value 监听器
立刻触发一次"）。`render()` 是**每个连接到这个房间的客户端各自独立执行**的（每个浏览器标签页订阅
同一个 `.on('value',...)`），而 `render()` 里对 `g.pending=null` 的赋值只是**本地内存**的修改，不会
写回 Firebase——真正的清空只发生在下一次有人执行了写路径的 `tx()` 之后。

**后果**：如果一个坏 pending 因为某种 bug 持续存在（在被下一次真实的 `tx()` 清理之前），**房间里的
N 个客户端会各自独立检测到同一个异常、各自写一条几乎相同的 `pending_orphan_detected` 记录**——不是
"这个异常发生了一次、记一条"，而是"这个异常被 N 台设备看到了 N 次、写了 N 条"。3~4 人局意味着单次
异常可能连带产生 3~4 条几乎重复（只有 `isoTime`/随机后缀不同）的记录。

**验证方式**：实测，`run_debug_log_audit_probe.js` 场景「【写入量】render路径的normalize()不会把
"清空"写回Firebase...」——模拟 3 个独立客户端（各自拥有独立的 `__pendingOrphanLastLogged` 内存，
对应真实的"不同浏览器标签页互不共享内存"）各自对同一份坏 pending 快照调用 `normalize(g)`，断言写入
了 3 条几乎重复的记录。**已实测通过**。

### 2.2 B 类 60 秒频控的 key 没有房间号，会导致"跨房间互相误判频控"（双向都有问题）

**代码位置**：`debug-log.js:131-139` —— `__pendingOrphanLastLogged` 的 key 是 `type + '|' + reason`，
**不包含房间号**。这个变量是浏览器里的模块级内存单例，如果一个人先后进出/参与过多个房间（同一个
浏览器标签页，没有整页刷新），不同房间触发的同一种 B 类异常会共享同一把 60 秒频控锁：

- **过度压制**：房间 A 刚触发过一次 `zhijiChoice` 类型的 B: 异常，60 秒内房间 B（完全不相干的另一
  局游戏）如果也触发了同类型异常，会被房间 A 建立的频控窗口连带压住，**该记的没记到**——这和"写太
  多"正好是同一个设计缺陷的反面后果。
- （2.1 已经说明了另一个方向：不同**客户端**之间反而完全不共享这把锁，各自独立触发、各自都会写，
  完全没有起到"控制总写入量"的效果——频控只在"同一个浏览器标签页、短时间内反复出现同一种异常"这
  个最窄的场景里才生效，覆盖不到这次审计真正关心的"会不会被写爆"的主要来源（2.1 的多客户端场景）。）

**验证方式**：实测，`run_debug_log_audit_probe.js` 场景「【写入量】B类频控key(type+reason)不含房间
号...」——依次给 `roomId` 赋值为 `'room-A'`/`'room-B'`，验证房间 B 的异常触发没有被记录（被房间 A
的频控窗口连带压住）。**已实测通过**。

### 2.3 debugLogs 没有任何自动化的写入量上限/清理机制

**代码位置**：`writeDebugLog`（`debug-log.js:36-60`）本身没有对"这个房间已经有多少条记录"做任何检查
就无条件写入；清理只有 `cleanupOldDebugLogs()`（`debug-log.js:199-227`），需要**手动**在浏览器
console 里调用，没有定时器/自动触发。结合 2.1（一次异常可能连带写出 N 条）——如果某个 A 类（无频控）
异常在一局持续时间较长的对局里被反复触发（比如这次审计之前修复的张角【鬼道】嵌套 tx bug、李典
【忘隙】normalize bug，在它们被修复之前，理论上就是能反复命中同一个 A: 分支的真实案例），单个房间
短时间内可能积累starts数十到上百条记录，没有任何自动兜底。

**验证方式**：代码走读（`writeDebugLog`/`cleanupOldDebugLogs` 全文读完确认没有自动清理路径）。

### 2.4 Firebase 数据库读写权限完全开放，`debugLogs` 节点没有任何针对性的访问控制

**代码位置**：`config.js:1-4` 注释明确写"并在 Realtime Database 里把读写规则先设为测试模式"；仓库
里**没有找到任何 `.rules.json`/`database.rules.json`/`firebase.json` 之类的规则文件**（`find`/`grep`
均未命中）。这意味着：

- 不止 `debugLogs`，`rooms/` 下的房间数据本身也是完全开放读写（这是 CLAUDE.md"四、已知的待优化点"
  里本来就记录过的现状，这次审计确认 `debugLogs` 这个独立顶层节点**同样**没有任何专门的访问限制，
  是同一个"整库测试模式"的一部分，不是这次新引入的问题）。
- 任何知道 Firebase 项目 URL/API Key 的人（这两者就写在公开的 `config.js` 里，任何打开这个网站的
  人的浏览器 devtools 都能直接看到）可以直接用 Firebase SDK/REST API 读取或篡改**任意房间**的
  `debugLogs`，不需要真的打开这个房间的游戏页面、不需要用这个项目自带的 `#debugLogBtn` 入口——这个
  按钮只是"官方"的查看方式，不是唯一的访问路径。

**这一条不是这次任务新发现的漏洞，是重新核实"这个已知的项目级现状，对 debugLogs 这个新功能同样适用、
没有被专门收紧"**。这次审计明确指出，供你判断是否需要单独收紧（比如给 `debugLogs` 单独配一条比
`rooms/` 更严格的规则）。

**验证方式**：代码走读 + 全仓库文件搜索确认规则文件不存在。

---

## 🟡 三、纯体验瑕疵

### 3.1 离开房间后 `roomId` 不会被清空，`#debugLogBtn` 在大厅页面会显示上一个房间的旧数据

**代码位置**：`room-lifecycle.js:480-487`（`backToLobby()`）——重置了 `mySeat`/`chatQuery`/`chatRef`/
`chatMessages`，**没有重置 `roomId`**。`#debugLogBtn`（`index.html:1976`）是挂在 `<body>` 顶层、
`position:fixed` 的常驻按钮，和 `#helpBtn`/`#closeRoomBtn` 一样"任何阶段都能点到"（`#closeRoomBtn`
自己的注释就是这么写的），不会随着 `#game`/`#lobby` 的显隐而被隐藏。

**后果**：玩家关闭/离开一个房间回到大厅之后（没有刷新整个页面），如果点击 `#debugLogBtn`，
`showDebugLog()`（`debug-log.js:246`）里 `if(!rid){ showInfo(...'当前不在房间中'...) }` 的判断会
**判断失败**（因为 `roomId` 仍然指向刚离开的那个旧房间号，不是 `null`/`undefined`），弹窗会显示
**上一个房间**的调试日志，而不是预期的"当前不在房间中"提示。用户能看到的信息本身没有越权问题（他
刚才确实是那个房间的参与者），但这是一个真实的"提示文案和实际行为不一致"的边界场景，符合这次审计
要求核实的"边界提示文案是否还准确"这一项。

**验证方式**：代码走读（`backToLobby` 全文确认没有 `roomId = null`，`#debugLogBtn` 的 HTML 位置确认
不在任何会被隐藏的容器内）。

### 3.2 连续快速点击 `#debugLogBtn` 不会去重，会并发发起多次 Firebase 读请求

**代码位置**：`showDebugLog()`（`debug-log.js:242-270`）没有任何"正在加载中，忽略重复点击"的标志位，
每次点击都会重新执行整个函数，包括新的 `db.ref(...).get()`。因为最终都写向同一个 `#infoModal`，
**不会出现"叠加多个弹窗实例"**（这一点用户担心的问题不存在），但连续点几次会并发打出好几个一样的
读请求，纯粹是浪费（对朋友局体量的数据量几乎没有实际影响）。

**验证方式**：代码走读（`showDebugLog` 函数体内没有找到任何去重/禁用按钮的逻辑）。

### 3.3 `bot_decision_failed` 的 `message` 字段可能间接带出机器人当时打算打出的牌名

**代码位置**：`bot.js:4688-4691` —— `message: '机器人在出牌窗口选择了动作('+(choice&&choice.action)+
')但等不到提交确认...'`。如果 `choice.action` 恰好是具体的牌名（比如"使用【杀】"这类 `CARD_PLAYS`
的 action 标识），且这次尝试**没有成功提交**（本来就是这条日志要记录的失败场景），那么"机器人手里
有这张牌、打算打出来"这个信息就会通过 `message` 文本间接暴露，即使这张牌本身从未真正打出去。这个
风险等级明显低于第一部分的三条（那三条是明确的秘密字段被结构化转存，这条只是失败提示文案里可能带
出一个牌名，且只在机器人本身出牌失败这个本就少见的场景下触发），归类到体验瑕疵而不是隐私类，但值得
知道。

**验证方式**：代码走读，未单独构造失败场景验证 `choice.action` 的具体取值格式（不确定实际格式是否
真的包含牌名，这里只是指出这个可能性，供你判断是否需要进一步确认）。

---

## ✅ 四、审计后确认没有问题的类别

1. **`kind` 中文映射完整性**：`DEBUG_LOG_KIND_LABELS`（`debug-log.js:181-186`）和 `DEBUG_LOG_KINDS`
   （`debug-log.js:15`）**双向完全一致**，没有遗漏、没有多余的 key。全项目 grep 确认目前只有 4 个
   真实调用点（`debug-log.js` 里的 `js_error`×2、`bot-ai-bus.js` 的 `timeout_stuck`、`bot.js` 的
   `bot_decision_failed`，以及 `logPendingOrphan` 统一走的 `pending_orphan_detected`），没有任何
   调用点传入过枚举之外的字符串。**已用测试脚本程序化断言确认（不是眼看代码），见
   `run_debug_log_audit_probe.js` 第一个场景**。也确认了最近几次修复任务（张角【鬼道】嵌套 tx、
   李典【忘隙】normalize、庞统【涅槃】）都**没有新增任何 `writeDebugLog` 调用点**，不存在"新增调用点
   忘了遵守隐藏信息规则"的情况——因为这几次任务压根没碰这部分代码。

2. **`playersSummary` 本身的字段范围**：`debugLogPlayersSummary`（`debug-log.js:27-35`）只取
   `seat`/`name`/`hp`/`alive`/`isBot` 五个字段，读完确认这五个都是公开信息（座位、名字、血量、是否
   存活、是否机器人，人人可见），**没有夹带手牌/装备/判定区内容**。这条本身是干净的，问题都出在
   `pendingSnapshot` 那一侧（见第一部分）。

3. **详情区域的布局/性能**：`.dbglog-detail`（`index.html` CSS）本身就带 `max-height:40vh;
   overflow:auto`，长 `stack` 字符串或者较大的 `pendingSnapshot` JSON 会在这个固定高度的容器内部
   滚动，不会撑爆弹窗整体布局。列表拉取侧 `showDebugLog()` 用 `orderByKey().limitToFirst(50)`
   （`debug-log.js:249`）天然限制了单次渲染最多 50 条，不存在"一次性把几百条全部拉下来渲染卡死浏览
   器"的风险——这条用户担心的问题在设计上已经被规避了，**只是「写入侧没有对应的上限」（见 2.3）**，
   读取/渲染侧本身是安全的，这是两件独立的事，不要混为一谈。

4. **`showDebugLog` 的失败提示路径本身可达且逻辑正确**：`.catch(...)` 分支（`debug-log.js:266-270`）
   会正确显示"拉取调试日志失败"；异步返回前检测弹窗是否已被关闭（`if(!m || m.classList.contains
   ('hidden')) return;`）避免"用户已经关闭弹窗、结果异步回来后又把无关的浮层内容覆盖掉"这个曾经在
   其它弹窗上出现过的坑。**但这条在当前"读写权限完全开放"的现状下（见 2.4）基本是死代码**——真实的
   权限拒绝场景在当前部署方式下几乎不会发生，这不是代码写错了，只是提醒：如果以后真的收紧了 Firebase
   规则，这条错误处理路径能不能被真正触发、文案是否还准确，需要重新验证一遍，不能假设"当年测过一次
   就一直有效"。

---

## 验证脚本

`run_debug_log_audit_probe.js`（新增）——复用 `run_debug_log_test.js` 的 vm 沙箱 + `db.ref` spy 惯例，
实测了本报告里标注"验证方式：实测"的 4 个场景（kind 映射完整性、guhuo 隐私泄露、多客户端重复上报、
跨房间频控误判），4/4 全部按预期复现（说明代码现状确实如报告描述，不是审计判断错误）。这不是回归
测试套件的一部分，不需要纳入常规 CI/回归跑批，但如果以后要修复这几条问题，可以直接复用这个脚本的
断言作为修复验证的起点。
