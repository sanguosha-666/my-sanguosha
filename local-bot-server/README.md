# local-bot-server —— 阶段1骨架

独立的 Node 进程,订阅 Firebase RTDB 上某个房间的完整状态并**只打印**,不写入任何数据、
不含任何机器人决策逻辑。目的是先验证「Node 进程能不能连上、能不能读到真实状态」,把
「环境能不能跑起来」和「决策正确性」彻底解耦。详见仓库根目录
`docs/local-bot-server-feasibility.md`。

**这一步之后的机器人决策逻辑(阶段2)、`botServerActive` 并发控制开关都还没有实现**——
这个目录目前只是一个只读订阅脚本。

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
