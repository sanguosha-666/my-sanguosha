# 网页版联机三国杀

一个给朋友局使用的网页版三国杀。项目采用原生 HTML、CSS 和 JavaScript，通过 Firebase Realtime Database 同步房间状态，无打包或编译流程。

在线版本：[https://sanguosha-666.github.io/my-sanguosha/](https://sanguosha-666.github.io/my-sanguosha/)

## 本地运行

1. 在 Firebase 控制台创建 Web 应用和 Realtime Database。
2. 将 `config.js` 中的 `firebaseConfig` 替换为自己的配置。
3. 使用任意静态文件服务器托管项目根目录，例如：

   ```powershell
   python -m http.server 8000
   ```

4. 浏览器打开 `http://localhost:8000/`。参与者输入相同房间号即可进入同一房间。

项目通过传统 `<script>` 标签按顺序加载，各文件共享全局作用域；新增脚本时必须同步更新 `index.html` 和相关测试的加载清单。

## 部署

上线（GitHub Pages）、自建静态托管、Firebase 配置、cache-bust 与「push 了但线上没变」的排查，见 [docs/deploy.md](docs/deploy.md)。

## 测试

安装 Node.js 后，在项目根目录运行：

```powershell
node run_all_tests.js
```

## 产品定位与边界

本项目定位为熟人之间的娱乐朋友局，不是竞技平台，也不承诺对抗恶意玩家时的竞技公平性。

- **手牌不是真隐藏**：所有玩家共享同一份 Firebase 房间状态。界面会按规则隐藏他人手牌，但具备数据库或开发者工具访问能力的人理论上可以读取状态；当前不提供服务端权威隐藏或牌面加密。
- **不防恶意改库**：当前 Realtime Database 按朋友局方式配置，不以防御用户直接修改数据库为目标。
- **不实现竞技级反作弊**：客户端校验用于保证正常对局规则和减少误操作，不构成可信服务器或反作弊系统。

因此，仅要求“真隐藏手牌、收紧数据库权限、阻止恶意改库、竞技级反作弊”的 Issue，默认视为超出当前产品定位。若未来决定升级为服务端权威架构，应另行立项，并重新设计数据模型、鉴权与部署方式。

正常玩家在界面中不应看到的提示、牌面或操作仍属于 UI/规则 Bug，不因上述边界而忽略。

## Bug 管理

Bug 统一使用 GitHub Issues 管理。每个 `CORE-xx` 对应一张 Issue；修复前阅读目标 Issue，修复提交使用 `Fixes #<issue-number>`。

