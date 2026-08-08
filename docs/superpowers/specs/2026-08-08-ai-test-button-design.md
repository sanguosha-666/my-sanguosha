# AI 测试托管按钮 + 决策信息窗 设计文档

> 日期：2026-08-08
> 状态：已获用户批准（方案 A）
> 关联分支：wenwen_dev

## 一、需求

在"查看调试日志"按钮（🐛，`index.html` `#debugLogBtn`）下方追加一个 **AI 测试按钮**。点击后：

1. 让 AI **持续托管当前玩家的游戏**（直到再点一次按钮关闭）
2. 自动弹出一个窗口，显示 **AI 获取的信息**、**AI 返回的信息**、**AI 这么做的理由**

## 二、已确认的需求决策（brainstorming 结论）

| 问题 | 决策 |
|---|---|
| 托管范围 | **持续托管直到手动关闭**（再点按钮关掉） |
| 弹窗信息粒度 | **折叠式**：摘要行常显，点开展开完整 prompt/响应 |
| 理由来源 | **仅开启本模式时**、针对被托管玩家，prompt 追加返回理由的指令；正常机器人决策不变 |
| 弹窗更新 | **自动追加全部历史**（本次托管期间全部决策记录，折叠列表） |
| 无密钥行为 | **无密钥不开启托管**（提示先配置 AI 密钥） |
| 托管覆盖 | **全部决策点全覆盖**（复用现有 `runBotDecision` + `runBotActionWindow` 全部 ~33 个 `BOT_DECISIONS` 分支） |
| 按钮交互 | **单按钮开关 + 自动弹窗**（点开=托管+弹窗，再点=关闭托管） |
| 生效时机 | **任意时刻可开启，轮到该玩家才实际接管**（大厅/对局中均可） |
| 弹窗交互 | **可拖动 + 可调整大小**（信息窗不遮挡游戏界面，可自由摆放/缩放） |

## 三、方案选择

**方案 A（采纳）：复用 bot 决策链 + autopilot 覆盖标志**

不新建调度系统。托管 = 在机器人决策链的 isBot 守卫处加一个模块级 autopilot 覆盖标志，把真人座位视同 bot；决策调度复用现有链；理由采集通过 `callAiChooseIndex` 的可选 `withReason` 参数实现，只影响托管模式。

**否决的方案 B**：独立 autopilot 模块 + 独立调度循环——重复实现调度/执行/超时，与 bot.js 现有链双份维护，改动量大，无收益。

## 四、组件设计

### 4.1 按钮（index.html）

- `#debugLogBtn`（1976 行）下方追加 `#aiTestBtn`，同款 44×44 圆钮样式（图标暂定 🤖）
- 初始文案：`🤖`（title: AI测试：AI托管当前玩家）
- 点击调 `toggleAiTestAutopilot()`
- 状态切换：未开启 → 开启（按钮加 `active` 样式类，title 变"关闭AI托管"）；已开启 → 关闭

### 4.2 托管状态（模块级，不入 Firebase）

```
aiTestAutopilot = { active: false, seat: null, records: [] }
```

- 存放位置：建议 `ai-bot.js`（已有 AI 相关模块状态）或 `bot-ai-bus.js`；实现时确定一处，避免跨文件裸引用
- 开启：`active=true, seat=mySeat`；`render(g)` 里 mySeat 重定位时（render.js:1025-1026）同步刷新 `seat`
- 关闭条件：用户再点按钮 / 对局结束（`g.phase==='over'`）/ 被托管玩家阵亡（`!g.players[seat].alive`）/ 离开房间
- 关闭时**不清空 `records`**（弹窗历史保留，直到弹窗手动关闭）

### 4.3 决策接入（bot.js）

**接入点 1：`runBotDecision` 首行守卫**（bot.js:3631）

```js
// 原：if(!p.isBot) return;
// 改：if(!p.isBot && !(aiTestAutopilot && aiTestAutopilot.active && seat===aiTestAutopilot.seat)) return;
```

**接入点 2：调度触发**

`scheduleBotTurn(g)`（bot.js:381-459）是唯一调度入口，由 `render(g)` finally 块触发（render.js:1635）。当前它只处理 `botSeatForState(g) >= 0` 的机器人座位。

托管真人座位的方式：在 `scheduleBotTurn` 内、`runBotDecision` 调用点附近，若 `aiTestAutopilot.active` 且 `g.players[aiTestAutopilot.seat]` 是当前应行动的座位（`g.turn===seat` 或 `BOT_PHASE_ACTOR[g.phase]` 解析出该座位），则对其调用 `runBotDecision(g, aiTestAutopilot.seat)`。

具体实现细节实现时按现有 `botSeatForState` 三段解析对照：托管座位满足"该阶段该行动"的条件时，走和机器人相同的 `runBotDecision` 分支即可——分支内部只查 `d.X===seat` 和 pending 归属，不依赖 isBot（调研已确认）。

**关键约束**：`scheduleBotTurn` 只在控制端浏览器跑（bot.js:382 `isBotController`）。托管的是**当前浏览器里的玩家自己**（`mySeat`），所以托管发生在自己的浏览器内，天然满足调度前提——无需跨浏览器同步托管状态。

### 4.4 理由采集（bot-ai-bus.js + ai-bot.js）

**`callAiChooseIndex`**（bot-ai-bus.js:131）增加可选参数 `opts.withReason`：

- `withReason` 为 true 时：
  - systemPrompt 追加一句："在你返回 choice 的同时，用一句中文解释你的选择理由。返回格式：{\"choice\":数字,\"reason\":\"理由文本\"}"
  - 使用新解析函数 `parseBotPlayAiChoiceWithReason(text)`：优先 `JSON.parse` 取 `{choice, reason}`，失败剥代码块重试；仍失败回退 `parseBotPlayAiChoice`（老逻辑，reason 置 null）
  - 返回 `{idx, reason}`（或保持返回 idx、把 reason 通过额外途径带出——实现时定，倾向返回对象避免改动现有调用方太多）
- `withReason` 未传/false → 行为与现在逐字一致（回归红线）

**透传链**：`botDecide` → `callAiChooseIndex` 的调用点要能感知托管模式。倾向：`runBotDecision` 在托管该座位时设一个模块级临时标记（如 `aiTestDecisionActive`），`callAiChooseIndex` 内部读它决定是否启用 withReason——避免改 `botDecide` 全部 ~33 个注册项的调用签名。实现时二选一，倾向后者（改动收敛）。

### 4.5 信息窗（#aiTestModal）

**DOM**：`index.html` 加 `<div id="aiTestModal" class="hidden">`，结构仿 `#infoModal`（index.html:1979 + CSS 1135-1136 的 fixed 遮罩 + flex 居中模式）。

**可拖动 + 可调整大小**（本次需求追加）：
- 默认弹出位置：屏幕右上角（不遮挡中央出牌区/自己座位）
- **拖动**：`#aiTestModal` 头部 `.aitest-header` 作为拖拽手柄（`mousedown` + `mousemove`/`touchmove` 更新 `left/top`），仿项目内既有拖动实现（若有）或标准 pointer 事件写法；拖动时禁用文本选中（`user-select:none`）
- **调整大小**：右下角加 resize 手柄（`.aitest-resize-handle`，CSS `cursor:nwse-resize`），拖拽更新 `width/height`（带 `min-width/min-height` 下限，防止缩到不可用）
- 位置/尺寸为**会话内内存状态**（不持久化到 localStorage——测试工具，刷新即恢复默认；如需持久化实现时随手加，不做承诺）
- 关闭弹窗后再打开：恢复默认位置/尺寸

**结构**：
```
<div id="aiTestModal">
  <div class="aitest-panel">
    <div class="aitest-header">AI 测试 · 托管中（座位 X）/ 已关闭</div>
    <div class="aitest-body">
      <!-- 每条决策记录 -->
      <div class="aitest-record">
        <div class="aitest-record-summary" onclick="toggle">时间 · 阶段 · 决策摘要 · ▸</div>
        <div class="aitest-record-detail hidden">
          <div>① AI 获取的信息（局面摘要 + 候选列表；可再点开看完整 JSON）</div>
          <div>② AI 返回的信息（原始响应文本 + 解析 choice）</div>
          <div>③ 理由</div>
        </div>
      </div>
    </div>
    <div class="aitest-footer">
      <button onclick="clearAiTestRecords()">清空</button>
      <button onclick="closeAiTestModal()">关闭</button>
    </div>
  </div>
</div>
```

**渲染函数**（建议放 `ai-bot.js` 或新 `render-ai-test.js`——项目文件拆分惯例是渲染层拆 `render-*.js`，倾向后者，见 CLAUDE.md 文件结构）：
- `openAiTestModal()` / `closeAiTestModal()` / `toggleAiTestRecord(idx)` / `clearAiTestRecords()`
- `appendAiTestRecord(rec)`：`rec = {time, phaseLabel, summary, stateInfo, candidates, prompt, rawResponse, choice, reason}`

**record 数据来源**：
- `time`：`debugLogIsoTime(Date.now())` 同款格式
- `phaseLabel`：复用 render.js:1592 的 `phaseName` 映射
- `summary`：choice 对应候选的 label（如"选择【杀】攻击座位2"）或"不发动"
- `stateInfo`：`buildBotVisibleState(g, seat)` 输出 + 候选列表
- `prompt`：本次实际发出的 systemPrompt + userPrompt（withReason 版本）
- `rawResponse`：AI 原始文本
- `choice` / `reason`：解析结果

### 4.6 决策执行

托管座位的每次决策**走完整的 `botDecide` → `spec.execute`**，即 `execute` 内部通过 `botInvoke(seat, fn)` 调 `tx()` 写 Firebase——与机器人行为完全一致。真人玩家自己的浏览器执行，所有客户端实时看到。

## 五、数据流

```
点击 #aiTestBtn
  → toggleAiTestAutopilot()
    → 未开启:校验 aiApiKey（ai-bot.js:55）
        → 无密钥:提示 + showAiKeyModal，不开启
        → 有密钥:aiTestAutopilot={active:true, seat:mySeat, records:[]}
                 按钮激活态 + openAiTestModal()
    → 已开启:aiTestAutopilot.active=false，按钮复原（弹窗保留）

render(g) → finally → scheduleBotTurn(g)
  → 检测 aiTestAutopilot.active && 轮到托管座位行动
  → runBotDecision(g, seat)（isBot 守卫被覆盖）
    → botDecide(decisionId, g, seat)
      → buildCandidates → callAiChooseIndex({withReason:true})
        → systemPrompt 含理由指令 → callAI → 解析 {choice, reason}
        → 失败 → localFallback（reason 标注"本地启发式兜底"）
      → execute → botInvoke(seat, fn) → tx 落子
    → appendAiTestRecord({...}) → 弹窗追加一条
```

## 六、错误处理

| 场景 | 行为 |
|---|---|
| 无 AI 密钥点按钮 | 不开启托管，提示配置密钥（弹 `showAiKeyModal`） |
| AI 调用失败（网络/超时/解析） | `callAiChooseIndex` 返回 null → `localFallback`；record 里 reason 标注"AI 调用失败，本地启发式兜底" |
| AI 返回无 reason | reason 显示空/占位 |
| 被托管玩家阵亡 / 对局结束 | `scheduleBotTurn` 检测到后自动关 `active`（records 保留） |
| 托管期间退出房间 / 刷新 | 模块级状态随页面丢失（可接受，测试功能不持久化） |

## 七、测试（vm 沙箱，沿用 run_ai_bus_*.js 模式）

1. **托管真人座位进入决策链**：`aiTestAutopilot={active:true, seat:0}` 时 `runBotDecision(g, 0)` 对 `isBot:false` 的座位 0 正常走分支（如 `play` 阶段）
2. **未托管时真人座位恒跳过**：`aiTestAutopilot.active=false` 时 `runBotDecision` 首行 return（回归）
3. **withReason prompt/解析**：mock callAI 返回 `{"choice":2,"reason":"理由"}` → 解析出 `{idx:2, reason:"理由"}`；返回纯 `{"choice":2}` → reason null；返回垃圾 → 回退 null + localFallback
4. **正常机器人路径零变化**：不设 autopilot 时 `callAiChooseIndex` 行为与现在逐字一致（无 reason 指令）
5. **无密钥不开启**：mock aiApiKey 为空 → toggle 不开启托管
6. **既有回归套件全绿**：run_ai_bus_l1/l2/l3/core/info/lordskill 等
7. **折叠弹窗渲染**：jsdom 或轻量 DOM stub 下 appendAiTestRecord 后 summary 可见、detail 默认 hidden
8. **拖动/调整大小**：拖动 header 后 `left/top` 变化且拖动期间 `user-select:none`；拖动 resize 手柄后 `width/height` 变化且不低于 min 下限；关闭再打开恢复默认位置/尺寸

## 八、改动清单

| 文件 | 改动 |
|---|---|
| `index.html` | `#aiTestBtn` 按钮（1976 行 debugLogBtn 下）、`#aiTestModal` DOM、相关 CSS（含 active 态样式）、`?v=337→338` |
| `bot.js` | `runBotDecision` 首行 isBot 守卫加 autopilot 覆盖；`scheduleBotTurn` 托管调度触发 |
| `bot-ai-bus.js` | `callAiChooseIndex` 加 `opts.withReason`；新解析 `parseBotPlayAiChoiceWithReason` |
| `ai-bot.js`（或新 `render-ai-test.js`） | `aiTestAutopilot` 状态、`toggleAiTestAutopilot`、弹窗渲染/追加/折叠/清空 |
| 新测试文件 | `run_ai_test_button_test.js`（上述 7 项） |
| `docs/progress-log-8.md` | 任务记录（收尾时） |

## 九、范围外（YAGNI）

- 不做托管状态跨浏览器同步（纯本地测试工具）
- 不做"托管其他真人玩家"（只托管当前浏览器里的自己）
- 不做决策记录持久化（刷新即丢）
- 不改正常机器人 prompt 行为（回归红线）
