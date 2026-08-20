# 部署说明

本项目是**纯静态网页**：无打包、无 Node 服务、无服务端权威结算。浏览器加载 `index.html` 与若干 `<script>`，对局状态写在 **Firebase Realtime Database**。部署 = 把仓库根目录原样放到任意静态托管，并配好 Firebase。

当前公开地址见根目录 [README.md](../README.md)。

## 架构一览

| 部分 | 作用 |
|------|------|
| 静态文件 | `index.html`、`config.js`、各 `*.js`、`assets/`（头像、牌面、视频） |
| Firebase Realtime Database | `rooms/{房间号}/game` 房间状态；多人用 `tx()` 事务同步 |
| GitHub Pages | 把仓库静态文件发布成网址 |
| GitHub Actions `Tests` | 每次 push / PR 跑 `node run_all_tests.js`（含 cache-bust 检查） |

没有 `firebase.json`、没有构建脚本。不要用 `npm run build`。

## 上线（GitHub Pages）

1. 仓库 Settings → Pages：
   - Source 选 **GitHub Actions** 或 **Deploy from a branch**。
   - 若选分支发布，**确认分支是实际要上线的分支**（当前开发约定推 `main`）。历史上出现过 Source 配成别的分支，导致 `git push origin main` 成功但线上不变。
2. 仓库根目录已有空文件 `.nojekyll`，跳过 Jekyll，避免纯静态仓被 Jekyll 误处理而构建失败。
3. 把改动推到 Pages 使用的分支：

   ```bash
   git push origin main
   ```

4. 等待 Pages 构建结束（通常几十秒到几分钟）。构建期间线上仍是上一成功版本。
5. 硬刷新或换无痕窗口打开公开地址。手机缓存更顽固，见下文 cache-bust。

### 线上没变时先查这些

1. **构建延迟或失败**：GitHub 仓库 → Actions / Pages 构建记录。失败时线上会停在上一次成功提交，直到下一次构建成功。
2. **Pages Source 分支不对**：push 的分支不是 Settings → Pages 里配置的分支。
3. **浏览器缓存**：改了 JS 但没把 `index.html` 里对应 `<script src="....js?v=N">` 的 `N` 加一。CI 里的 `check_cache_bust.js` 会拦「改了脚本却没 bump 版本」；没改 `index.html` 的纯资源（如新 mp4）不走这套检查，仍可能被 CDN/浏览器缓存。
4. 不要先怀疑业务代码，除非上面三项都排除了。

## 自己托管（本机 / Nginx / 任意静态站）

任意能托管静态目录的方式都可以，例如：

```bash
python -m http.server 8000
```

浏览器打开 `http://localhost:8000/`。参与者打开**同一网址**、填**同一房间号**即可进同一房间。

注意：

- 必须用 http(s) 服务打开，不要直接 `file://` 打开 `index.html`（模块加载、Firebase、部分浏览器策略会出问题）。
- 自定义 AI BaseURL 是浏览器直连，目标接口必须允许浏览器 CORS。
- 视频/图片体积较大，托管方需允许相应带宽。

## Firebase

1. [Firebase 控制台](https://console.firebase.google.com/) 建项目，添加 Web 应用。
2. 创建 **Realtime Database**。朋友局可先用测试模式规则（公开读写）。本项目**不以防恶意改库为目标**，规则收紧需自行评估。
3. 把控制台里的 SDK 配置填进 `config.js` 的 `firebaseConfig`（`apiKey`、`authDomain`、`databaseURL`、`projectId` 等）。
4. `apiKey` 仍是 `YOUR_API_KEY` 时，页面会显示配置警告，联机不可用。
5. 改 `config.js` 后必须把 `index.html` 里 `config.js?v=N` 加一，否则手机端可能仍用旧配置。

房间数据在 `rooms/{房间号}`。清空测试房间可在控制台删对应节点；改数据结构后若 `normalize()` 未覆盖旧字段，可能需要清房间再开。

## 改代码后的发布清单

1. 只改当前任务相关文件，保持原有 HTML/JS 风格。
2. 改了某个会被 `index.html` 加载的 `.js`：把该文件的 `?v=N` **单独加一**（各文件版本号独立，不必四文件同号）。
3. 根目录执行：

   ```bash
   node run_all_tests.js
   ```

   其中会先跑 `check_cache_bust.js`。失败则测试不会开始。
4. 提交并推送到 Pages 所用分支。
5. 等构建成功后再验收线上。

新增 `<script src="....js">` 时：必须带 `?v=数字`，并同步所有会加载该脚本的测试沙箱清单。

## AI 机器人与密钥

AI 密钥、自定义 BaseURL 只存在**本机标签页** `sessionStorage`，不写入 Firebase，其他玩家看不到。部署方不必在服务器配置模型密钥。

浏览器直连 Groq / Cohere / Cerebras / 自定义 OpenAI 兼容地址。目标站必须允许 CORS；官方 `api.openai.com` 通常不能从浏览器直连。

## 相关文档

- [README.md](../README.md) — 产品说明、本地运行、测试入口
- [CLAUDE.md](../CLAUDE.md) — 架构约定、cache-bust、协作原则
- [docs/README.md](README.md) — 文档目录
