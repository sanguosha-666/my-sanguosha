# 组队模式（team）设计文档

日期：2026-08-10
状态：已确认（用户逐节确认过数据模型/大厅流程/游戏流程/影响面/测试五节）
分支：wenwen_dev

## 一、需求背景

用户想增加一个组队对战模式。经过 brainstorming 澄清，最终需求：

- **规则基础**：简化团队战——队友身份公开可辨，胜负按队伍；其余规则与现有 `ffa` 一致（可打队友、距离不变、无额外技能、无击杀奖惩）。
- **队伍配置**：队伍数完全自由（2/3/4…队都行，最多 9 队=一人一队），每队人数不固定（3v4、4v4+机器人 等 9 人容量内的任意分布都合法）。
- **选队**：大厅阶段玩家自由选队（先到先得、可随时换队），房主追加机器人时指定机器人进哪队。
- **容量**：`SEATS` 8→9（现有 `desktop-layout-8p` 布局基础上 +1 座位）。
- **开局条件**：队伍数 ≥2 且每队 ≥1 人。
- **主公局改名身份局**：用户可见文案"主公局"统一改"身份局"（render-controls.js 模式按钮/alert/banner + 各处注释）。
- **AI 提示词适配组队**：AI/机器人需要知道队伍信息（谁是队友/敌方）并据此决策——可见状态加队伍号、决策参考加团队战指引（优先打敌方、不浪费资源在队友身上、队友濒死优先救援）。

## 二、数据模型

| 字段 | 类型 | 说明 |
|---|---|---|
| `g.gameMode` | string | 新增 `'team'`；normalize 防御扩为 `'ffa' \| 'identity' \| 'team'`（game.js normalize 现有 `if(g.gameMode!=='ffa' && g.gameMode!=='identity') g.gameMode=null;` 改为三种合法值） |
| `p.team` | number/null | 队伍号 `0..n-1`，大厅未选为 null；normalize 补默认：非整数 → null |
| `g.teamCount` | number | 实际队伍数（动态 = 已使用的最大队伍号 +1，玩家新建队伍时增长）；normalize 补默认（非正整数 → 0） |
| `SEATS` | const | `8` → `9`（data.js） |
| `TEAM_COLORS` | 数组 | 队伍色表（≥9 色，索引即队伍号；渲染座位卡队伍色块用，类似身份色块的既有模式） |

队伍用"数字号"而非实体对象：玩家选 `p.team=0/1/2...` 即入队，`TEAM_COLORS[p.team]` 取色。**不写进 Firebase 的派生物只有颜色表（客户端常量）**，持久化到房间状态只有 `p.team` 和 `g.teamCount` 两个标量。

## 三、大厅流程

1. **模式选择**：现有模式入口（ffa/identity）加"组队模式"（team）。
2. **选队面板**（仅 team 模式显示）：显示各队「色块 + 队伍号 + 人数」，玩家点击"加入队伍 X"即入队（tx 写自己 `p.team`）；点别的队即换队（覆盖写入）。每队人数不设上限，总容量受 SEATS=9 限制。
3. **队伍数自由**：初始 2 队（0/1），面板带"+新建队伍"按钮（队号 = 当前最大队号 +1，`g.teamCount++`；最多 9 队=一人一队，超限禁用）。
4. **房主加机器人**：team 模式"添加机器人"变为两步——点加机器人后选择目标队伍（机器人 `p.team` 写入，计入该队人数）。复用现有 addBot 机制，只加队伍指定。
5. **开始条件**：team 模式要求队伍数 ≥2 且每队 ≥1 人；总人数 ≥ MIN_PLAYERS（=2）且 ≤ SEATS。人数不足时可先加机器人再开始。

## 四、游戏流程

### startGame（room-lifecycle.js）

- `startGame(mode, gameMode)` 接收 team；`gm` 合法值扩为 `'ffa'|'identity'|'team'`。
- team 分支校验：队伍数 ≥2、每队 ≥1 人，否则拒绝开始并提示。
- 不涉及主公/身份分配（那是 identity 专属）；`p.team` 大厅已定，直接沿用。发武将照旧（65 武将池足够 9×3=27 候选互不重叠）。

### checkWin（game.js）

新增 team 分支（复用 identity 分支的"存活统计 → 置 over/winner → 清 pending/aoe → 记日志"骨架）：

```
if(g.gameMode==='team'){
  存活队伍集合 = 对每个 p.team 非 null 且 alive 的玩家收集队伍号
  存活队伍数 = 集合大小
  = 1 → 该队胜（winner = "队伍X"）
  = 0 → 无胜者平局（最后两队同时团灭）
  ≥ 2 → 未结束
}
```

结束路径统一置 `g.phase='over'`、`g.pending=null`、`g.aoe=null`、记日志。胜负判定后座位卡队伍色块保持展示（队伍不是隐藏信息，无需 reveal 机制——与身份模式不同，`roleRevealed` 那套不适用于 team）。

### 渲染

- **座位卡**：显示队伍色块 + 队伍号（`TEAM_COLORS[p.team]` 背景），复用身份色块 `.seat-identity` 的定位模式，新增 `.seat-team` 类（独立配色，不碰身份逻辑）。
- **大厅选队面板**：新 UI 元素（team 模式 lobby 显示）。
- **9 人布局**：在现有 `desktop-layout-8p`（`#oppTopRow`/`#oppRow` 双排）基础上扩展到 9 人——`oppTopRow` 4 人 + `oppRow` 4 人 + `meSeat` 1 人，或 9 人分配按现有 assignSeatZones 逻辑扩展。

## 五、影响面清单（改动对照）

| 文件 | 改动 |
|---|---|
| `data.js` | `SEATS` 8→9；`TEAM_COLORS` 常量；`EQUIP_SLOTS` 等不受影响 |
| `game.js` | normalize：gameMode 防御加 `'team'`、`p.team` 补默认（非整数→null）、`g.teamCount` 补默认；`checkWin` 加 team 分支 |
| `room-lifecycle.js` | `startGame` 接收/校验 team（队数≥2、每队≥1）；大厅选队写入（tx 改 `p.team`）；新建队伍（`g.teamCount++`）；机器人进队（addBot 加队伍参数） |
| `render.js` + `index.html` | 9 人布局扩展；选队面板 UI（HTML+CSS+JS）；座位卡 `.seat-team` 色块 |
| `render-controls.js` | 模式选择按钮："主公局"→"身份局"文案 + 新增"组队"按钮（`mkModeBtn('组队','team')`）；人数门槛提示适配 team |
| `bot.js` / `bot-ai-bus.js` | 加机器人指定队伍（房主两步操作）；**AI 提示词适配组队**：`buildBotVisibleState` 加 `myTeam`/`players[].team`（队伍公开）、决策参考加团队战指引（优先打敌方/不浪费资源在队友/队友濒死优先救）；**bot 本地决策（无密钥 fallback）保持现状**（回归红线） |
| `debug-log.js` | 无 |
| 身份模式 | 零影响（所有分支都有 `gameMode==='identity'` 守卫） |
| ffa | 零影响（`checkWin` ffa 分支不动，`p.team` 仅 team 模式有意义） |

## 六、边界与已知决策

- **可打队友**：简化团队战允许（与 ffa 一致），不做任何"同队不可互伤"限制。
- **距离不变**：无队伍距离修正。
- **无击杀奖惩**：不引入身份模式的摸牌/弃牌奖惩。
- **最后两队同时团灭** → 无胜者平局（`winner='无'`），不偏袒任一队。
- **机器人决策（有密钥路径）**：AI 提示词适配组队——可见状态带 `myTeam`/`players[].team`，决策参考加"组队模式:优先攻击/拆解敌方队伍,不要把伤害/锦囊浪费在队友身上;队友濒死时优先救援"。**无密钥本地 fallback 保持现状零变化**（回归红线，与 L1 泛化同一纪律）。
- **9 人 UI**：手机小屏 9 人局是否放得下——沿用现有 8 人响应式策略（窄屏滚动/缩小卡片），9 人=8 人+1 的增量验证，需真机抽查最大规模。

## 七、测试计划

- 新建 `run_team_mode_test.js`（vm 沙箱加载真实源码，同既有套件惯例）：
  1. normalize：`p.team` 缺失/非法 → null；`g.teamCount` 缺失 → 0；`gameMode='team'` 不被清
  2. 大厅选队：tx 写入 `p.team`、换队覆盖、新建队伍 `teamCount++`
  3. 开始校验：队数 <2 拒绝、某队 0 人拒绝、满足条件放行
  4. 胜负：2 队一方团灭→对方胜；3 队淘汰到 1 队→该队胜；最后两队同时团灭→无胜者
  5. 机器人进队：房主指定后 `p.team` 正确写入
  6. AI 提示词适配：`buildBotVisibleState` team 模式含 `myTeam`/`players[].team`；决策参考含团队指引（有密钥断言）；未托管/无密钥路径零变化
  7. 主公局→身份局：render-controls 用户文案断言（不含"主公局"、含"身份局"）
- 回归：全部既有套件（SEATS 8→9 对既有 3 人局测试无影响；gameMode 防御放宽不破坏 ffa/identity 测试）。

## 八、实施顺序建议

1. 数据层：SEATS/TEAM_COLORS/normalize 防御
2. 大厅：模式选择 + 选队面板 + 机器人进队 + 开始校验
3. 游戏：startGame 校验 + checkWin team 分支
4. 渲染：座位卡队伍色块 + 9 人布局
5. 测试 + 回归 + 上线（等用户批准合并 main）
