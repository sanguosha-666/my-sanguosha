# 部署手册（给执行代理）

把这份文档整份交给执行代理（如 OpenClaw）。代理必须**按章节顺序做完**，每步用「完成标准」自检，未通过不得跳步。人类只需：登录 Google/GitHub、在浏览器里点 Firebase/GitHub 页面（代理没有账号时）。

## 0. 你是谁、要交付什么

**目标**：让任意人用浏览器打开一个 https 网址，填同一房间号，能联机进同一房间；本机也能 `http://localhost:8000` 进房。

**完成标准（全部满足才算搞定）**：

1. 浏览器打开站点**没有**红色「还没填 Firebase 配置」横幅。
2. 填房间号（仅字母数字 `-` `_`，例如 `chibi`）和名字，点「进入房间」，进入对局大厅（能看到自己座位，不是报错「请先在文件里填入 Firebase 配置」）。
3. 第二个浏览器（无痕窗口）打开**同一网址**、同一房间号、另一个名字，也能进同一房间，双方能看到对方加入日志。
4. （若走 GitHub Pages）公开 URL 能打开，且与本地行为一致。

**禁止**：

- 不要 `npm install`、不要 `npm run build`、不要找后端、不要 Docker、不要改游戏规则代码。
- 不要删除 `.nojekyll`。
- 不要把 AI 密钥写进仓库或 Firebase。
- 不要改 `firebaseConfig` 以外的业务 JS（除非 bump `?v=`）。
- 仓库没有 `package.json` 构建脚本。没有 `firebase.json`。部署 = **原样托管仓库根目录**。

**项目形态**：原生 HTML/CSS/JS，`<script>` 顺序加载，全局变量。联机状态在 Firebase Realtime Database：`rooms/{房间号}/game`、`rooms/{房间号}/chat`。

---

## 1. 环境

在仓库根目录执行（以下命令均在根目录）：

```bash
git rev-parse --show-toplevel
test -f index.html && test -f config.js && test -f .nojekyll && echo OK_FILES
node -v
python3 --version || python --version
```

需要：

- `git`
- `node`（建议 20+，用于跑测试）
- 能起静态服务器：`python3 -m http.server` 或 `python -m http.server`
- 人类账号：Google（Firebase）、GitHub（若要公开 Pages）

`node run_all_tests.js` 应能跑（不改代码时也应全绿）。测试失败不要用「跳过测试」蒙混上线。

---

## 2. Firebase（必须）

没有可用的 `firebaseConfig`，联机一定失败。`config.js` 里若 `apiKey === "YOUR_API_KEY"`，页面会显示配置警告。

仓库里可能已经有一套可用配置。**先判断要不要新建**：

- 若人类说「用仓库现成配置、只托管网页」：跳到第 3 节，不要改 `config.js`。
- 若人类说「用我自己的 Firebase」或现成配置进房报 `连接出错`：按下面新建。

### 2.1 控制台操作（人类点页面，代理口述逐步指令）

1. 打开 https://console.firebase.google.com/ 登录。
2. 添加项目，名称任意（例如 `my-sanguosha`）。Google Analytics 可关。
3. 项目创建完 → 齿轮 → **项目设置** → **您的应用** → `</>` **添加应用** → 平台选 Web → 登记昵称 → 得到一段 `const firebaseConfig = { ... }`。
4. 左侧 **Build** → **Realtime Database** → **创建数据库**：
   - 位置选靠近用户的（例如 `asia-southeast1` 或控制台默认）。
   - 安全规则选 **测试模式**（开始时允许读写）。
5. 创建完成后，数据库 URL 形如 `https://<project-id>-default-rtdb.firebaseio.com` 或带区域的 `https://<project-id>-default-rtdb.<region>.firebasedatabase.app`。以控制台 **Realtime Database** 页顶上的 URL 为准。
6. **规则**标签贴上下面（朋友局；本项目不以防改库为目标）。点发布：

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

若规则仍是带 `now < ...` 的限时测试规则，过期后进房会失败。改成上面永久测试规则，或人类接受过期后自己再开。

### 2.2 写入 `config.js`

只改 `config.js` 里 `firebaseConfig` 对象的字段，**不要改文件其余逻辑**。字段必须齐全：

```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "<project-id>.firebaseapp.com",
  databaseURL: "https://<project-id>-default-rtdb.firebaseio.com",
  projectId: "<project-id>",
  storageBucket: "<project-id>.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

`databaseURL` 必须与控制台 Realtime Database 显示的 URL **完全一致**（含不含区域后缀以控制台为准）。漏填 `databaseURL` 会导致进房失败。

`measurementId` 可有可无。

保存后检查：

```bash
grep -n "YOUR_API_KEY" config.js && echo STILL_PLACEHOLDER && exit 1 || echo CONFIG_FILLED
```

`YOUR_API_KEY` 不得再出现在 `apiKey` 的值里。

### 2.3 改了 `config.js` 必须 bump 版本

打开 `index.html` 文件末尾，找到：

```html
<script src="config.js?v=数字"></script>
```

把该数字 **加 1**（只改 `config.js` 这一行，不要动其它脚本的 `?v=`）。

然后：

```bash
node check_cache_bust.js
```

必须打印 `cache-bust check passed`。

---

## 3. 本机验收（上线前必做）

```bash
# 仓库根目录
node run_all_tests.js
python3 -m http.server 8000
```

若 `python3` 没有：`python -m http.server 8000`。

**不要用 `file://` 打开 `index.html`。**

浏览器 A：`http://localhost:8000/`

- 不应出现红色配置警告。
- 房间号 `chibi`（默认即可），名字例如 `玄德`，点「进入房间」。
- 成功：大厅消失，进入对局界面（有座位卡、阶段「等待开始」一类文案）。
- 失败文案对照：

| 页面提示 | 处理 |
|----------|------|
| 还没填 Firebase 配置 / 请先在文件里填入 Firebase 配置 | 第 2 节没做完或 `apiKey` 仍是占位 |
| 请填房间号 / 请填名字 | 输入框空 |
| 房间号只能用字母、数字、- 和 _ | 房间号含 `.` `#` `$` `[` `]` `/` 或中文 |
| 连接出错: ... | `databaseURL` 错、规则拒绝、网络、项目未开 Realtime Database |
| 这个名字已被占用 | 换名字 |
| 房间已满 | 换房间号 |
| 这局已经开始了 | 换房间号 |

浏览器 B（无痕）：同一 `http://localhost:8000/`，房间号相同，名字换成 `云长`，应能进同一房，A 侧日志出现「云长 加入了房间」。

本机两项通过后再做第 4 节。

停服务器：终端 Ctrl+C。

---

## 4. GitHub Pages 公开上线

仓库：`https://github.com/sanguosha-666/my-sanguosha`  
预期公开地址：`https://sanguosha-666.github.io/my-sanguosha/`

### 4.1 确认 Pages 源

GitHub 仓库 → **Settings** → **Pages**：

- **Deploy from a branch**：Branch 选 **`main`**，folder **`/ (root)`**，Save。
- 或 **GitHub Actions**（若已有 Pages workflow）。本仓默认没有专门的 Pages workflow，优先用 **branch + `main` + root**。

**不要**把 Source 设成别的旧分支。曾经出现过 Source 不是 `main`，push `main` 后线上永远不更新。

根目录必须有 `.nojekyll`（空文件）。没有就建一个空文件并提交。

### 4.2 提交与推送

若改过 `config.js` / `index.html`：

```bash
git add config.js index.html
git status
git commit -m "chore: 填入 Firebase 配置并 bump config.js cache-bust"
git push origin main
```

未改文件、只是把已有 `main` 接到 Pages：只需在 Settings 里把 Source 指到 `main`，然后等构建。

推送后：

- Actions 里 **Tests** 工作流应成功（`node run_all_tests.js`）。
- Pages 构建成功（Settings → Pages 或 Actions 里 pages 构建）。失败时线上仍是上一成功版本。

等待 1～3 分钟，无痕窗口打开公开地址，重复第 3 节的双浏览器进房测试。

手机验收：改过 JS 却像没更新 → 先确认该文件 `?v=` 已加一且 Pages 构建成功，再无痕/清站点数据。

### 4.3 自定义域名（可选）

Settings → Pages → Custom domain。DNS 按 GitHub 说明加 CNAME。本项目无特殊路径要求，站点根就是游戏。不要把网站根指到子目录（所有脚本是相对路径 `config.js?v=`）。

---

## 5. 其它静态托管（Nginx / Cloudflare / 对象存储）

把**仓库根目录全部文件**（含 `index.html`、`config.js`、全部 js、`assets/`、`.nojekyll` 可忽略）上传为站点根。

Nginx 示例：`root` 指向仓库根；`index index.html`；不要 try_files 成 SPA 把所有路径 rewrite 到 `index.html`（本项目没有前端路由，但乱 rewrite 可能影响资源）。

必须 https 或本机 http。目录列表随意。MIME：`.js` → `application/javascript`，`.mp4` → `video/mp4`。

---

## 6. 改代码后再发布（代理改仓库时）

1. 只改任务需要的文件。
2. 若改了 `index.html` 会加载的某个 `foo.js`：把 `<script src="foo.js?v=N">` 的 N **加 1**。各文件版本号独立。
3. 新增脚本：必须 `src="新文件.js?v=1"` 这种带数字版本；并让加载该文件的测试沙箱也 `readFileSync` 到它。
4. `node run_all_tests.js` 全绿。
5. commit + push 到 Pages 所用分支。
6. 等构建成功再验收。

`check_cache_bust.js`：工作区有改动时比 HEAD；干净时比 `HEAD^..HEAD`。CI 用 `CACHE_BUST_BASE`。

---

## 7. 数据与排障

Firebase 控制台 → Realtime Database 可见 `rooms/<房间号>/game`。删该节点 = 清房。

`debugLogs/<房间号>` 也可能被写入。测试规则全开即可。

AI 密钥在玩家浏览器 `sessionStorage`（`sgsAiKey` 等），关标签即没。部署者不必配密钥。自定义 BaseURL 需目标 API 允许浏览器 CORS。

---

## 8. 卡住时对人类说什么

代理不能代替人类：登录 Google/GitHub、点「创建数据库」、点 Pages Save、付费/开通 Spark 以外的配额。

向人类只要这几样：

1. Firebase 项目设置页里的整段 `firebaseConfig`（或截图）。
2. Realtime Database 的 URL 和规则已发布的确认。
3. GitHub 仓库 Settings → Pages 的 Source 截图（分支名必须能看清）。
4. 进房失败时的**完整**红色/lobby 报错原文。

不要让人类「随便刷新」作为唯一手段；按第 3 节表格对号入座。
