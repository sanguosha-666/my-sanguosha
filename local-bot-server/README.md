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
   齿轮图标「项目设置」→「服务账号」标签页 → 点击「生成新的私钥」,会下载一个
   `xxxxx-firebase-adminsdk-xxxxx.json` 文件。
2. 把这个文件**改名**为 `serviceAccountKey.json`,放到
   **`local-bot-server/serviceAccountKey.json`**（就是本 README 所在的目录下,
   和 `watch.js`/`package.json` 同级）。
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

需要 Node.js（建议 18 及以上;这台开发机是 v22,Windows 上装 [nodejs.org](https://nodejs.org/)
的 LTS 版本即可）。

### 在你的 Windows 笔记本上

```powershell
cd local-bot-server
npm install
```

会安装 `firebase-admin`（唯一的依赖）到本地 `node_modules`（同样被 `.gitignore` 排除,
不会被提交)。

---

## 三、配置:三个必需值

除了密钥文件本身,还需要三个配置项。**推荐用 `.env` 文件**（比每次在命令行敲环境变量方便,
尤其是 Windows）：

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

如果不想用 `.env` 文件,也可以直接在命令行里设置环境变量后再启动（Windows PowerShell 示例）：

```powershell
$env:FIREBASE_DATABASE_URL="https://sgs666-733bf-default-rtdb.firebaseio.com"
$env:ROOM_ID="你的房间号"
node watch.js
```

两种方式二选一即可,`.env` 文件更省事、不容易漏敲。

---

## 四、运行

```powershell
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
 密钥文件   : ...\local-bot-server\serviceAccountKey.json
==============================================

正在订阅 rooms/abc123/game ,等待状态变化...
```

**启动失败**（密钥文件找不到、环境变量缺失、密钥内容不完整等)会打印清晰的中文错误提示
和排查方向,不会是一堆看不懂的堆栈。

按 `Ctrl+C` 可以随时安全退出。

---

## 五、手动验证步骤清单

请按这个顺序操作,确认骨架真的能连上、能收到真实数据：

1. **启动脚本**：按上面「四、运行」的步骤跑起来,确认看到启动横幅、没有报错,
   停在「正在订阅...等待状态变化...」这一行。

2. **开一局游戏观察初次快照**：用浏览器打开这个项目的网页,加入你在 `.env` 里配置的
   那个 `ROOM_ID` 房间号（新房间或已有房间都行)。回到终端,应该立刻看到一条
   `--- 房间 xxx 状态更新 ---` 的打印,里面的 `phase` 字段应该和浏览器里当前所在的阶段
   一致（比如还没开始游戏是 `"lobby"` 或 `null`，具体看当前房间状态)。

3. **验证状态变化能被实时推送到终端**：在浏览器里做一个会改变游戏状态的操作
   （比如点「开始游戏」、选武将、出一张牌、结束回合)。**每做一次操作,终端应该立刻打印
   一条新的状态更新**（不需要刷新终端、不需要重启脚本——这是 Firebase 的实时订阅,
   状态一变就推送)。检查打印出的 `phase`/`turn`/`roundNum` 是否和浏览器界面显示的一致。

4. **验证 pending 阶段的打印**：让游戏进行到某个需要人响应的阶段（比如有人被出杀、
   需要出闪;或者用南蛮入侵/万箭齐发这类需要多人响应的锦囊)。此时终端除了状态更新,
   应该额外打印一段 `pending(白名单脱敏后): {...}`，里面能看到 `type`（比如 `"respond"`）、
   `from`/`to` 这类座位号字段,但**不应该出现任何具体的牌名/花色/点数**
   （凡是牌面相关字段,应该显示成 `"[已隐藏:可能含具体牌面/手牌内容,不写入日志]"`
   这样的占位符，而不是真实牌面)。这一步是在验证隐私脱敏白名单确实生效。

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
