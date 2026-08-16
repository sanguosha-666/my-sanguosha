# CLAUDE.md — 项目说明与协作守则

> 这个文件是给 Claude Code以及所有其他agent 读的。每次启动请先读它，了解项目现状、架构约定和改动原则，再动手。

> **⚠️ 重要：本文件的历史改动记录已拆分，任何新增记录一律不允许写进本文件本体**
>
> - **历史改动的完整记录在 `docs/progress-log-*.md`**（按时间顺序分段，当前共 10 段，
>   `docs/progress-log-1.md` 最早、`docs/progress-log-10.md` 最新）。如果需要了解某个
>   具体功能当初是怎么实现/为什么这么设计的，去这些文件里 grep 关键词（武将名/函数名/
>   文件名）查，不需要通读。
> - **`docs/methodology.md` 收录了从历次排查中提炼出的通用经验**（不依赖具体任务上下文
>   的可复用教训）。新任务遇到相似症状（比如"点击没反应"、"pending 卡住不消失"、"机器人
>   卡死"）时，先去这里看看有没有现成的教训可以参照，再动手排查。
>
> **任何一次任务完成后的改动总结/实现细节记录，一律追加进 `docs/progress-log-N.md` 的
> 当前最新分段文件——不允许直接写进 `CLAUDE.md` 本体。具体操作**：
> 1. 打开 `docs/` 目录下编号最大的 `progress-log-N.md`（目前是 `progress-log-10.md`）。
> 2. 检查它的字节大小（`wc -c docs/progress-log-N.md`）。**若已经 ≥150KB，新建
>    `docs/progress-log-(N+1).md`**，把这次的记录写进新文件（不要在一条改动记录的中间
>    切换文件——同一条记录必须完整写在同一个文件里）；否则直接追加进当前这个文件末尾。
> 3. 每条记录的格式和既有记录保持一致（`- **标题**：详细内容……`），不要求精简——完整
>    记录的价值就在于以后能查到当初为什么这么做，删细节等于白记。
> 4. `CLAUDE.md` 本体（一~五节）只在**架构约定本身发生变化**时才编辑（比如新增一类可
>    复用的 pending 模式、新的整体拆分原则、新的项目级约定）——单纯"这次任务做了什么"
>    永远不属于这类变化，一律去 `progress-log`。
> 5. 如果这次任务提炼出了一条**不依赖具体任务上下文、值得以后新任务参照**的通用教训，
>    额外补一条进 `docs/methodology.md`（不是每次任务都要补，只有真正通用的才补）。
>
> **这条规则本身如果被违反**（发现 CLAUDE.md 本体又开始堆积任务记录），下一次任务应该
> 主动把误加的内容搬回 `docs/progress-log` 最新分段，而不是将错就错继续往下加。

## 一、项目是什么

一个**网页版联机三国杀**，给我和朋友玩。

### 产品定位与边界

- 本项目是熟人之间的娱乐朋友局，**不是竞技平台**，不承诺对抗恶意玩家时的竞技公平性。
- **手牌不是真隐藏**：所有客户端共享同一份 Firebase 房间状态。UI 会隐藏他人手牌，但数据库或开发者工具层面理论上仍可读取；当前不提供服务端权威隐藏或牌面加密。
- **不防恶意改库**：Realtime Database 按朋友局方式配置，不以防御用户直接修改数据库为目标；客户端规则校验也不等同于可信服务器或反作弊系统。
- 仅要求真隐藏手牌、收紧数据库权限、防直接改库或竞技级反作弊的诉求，默认标注为“超出当前产品定位”，不投入当前实现。若未来定位升级，必须另行立项并重做数据模型、鉴权和服务端权威结算。
- 正常玩家通过当前 UI 意外看到本应隐藏的提示、牌面或操作，仍按普通 UI/规则 Bug 处理，不能用上述边界规避修复。

> **当前文件结构补充（#91）**：项目已经超过早期“11 个 JS 文件”的规模。统一阶段配置位于 `stages/stage-table.js`，杀的目标/响应/武器后续结算位于 `sha/sha-resolution.js`，后期武将技能包位于 `skills/late-generals.js`；实际加载顺序始终以 `index.html` 为准。下面保留的早期长段落用于解释各核心文件的职责，不再把其中的文件数量当作现状断言。

- **多文件、无构建流程，共11个JS文件**：`index.html`（结构+样式，无内联 JS）+ `config.js`（Firebase 配置）+ `data.js`（常量/武将/装备数据）+ `room-lifecycle.js`（房间/对局生命周期：`joinRoom`/`enterGame`/`startGame`/`finishGeneralAssign`/`respondPickGeneral`/`debugPickGeneral`/`newGame`/`cleanupRoom`/`backToLobby`）+ `game.js`（游戏逻辑核心，含 `respondShan`/`resolveShaUse`(`NoLiuli`)/`continueShaAfterTieqi` 等所有武将技能/装备共用的编排函数、以及经排查确认属于基础规则而非技能专属的 `playCard`/`distance`/`ensureDeck`/`endTurn`/`aoeEffect`/`aoeRespond` 等）+ `weapons.js`（从 game.js 拆出的武器/防具专属特效：麒麟弓/寒冰剑/青龙偃月刀/贯石斧各自独立的 `maybeStart*`/`respond*`/`resolve*` 函数；**古锭刀没有独立代码**，效果内联在 `game.js` 的 `respondShan` 一行表达式`gudingBonus`里，不在这个文件）+ `skills.js`（从 game.js 拆出的各武将/特定锦囊专属技能孤岛，56个函数，彼此之间零互调、只依赖 game.js 的 hub 函数）+ `render.js`（渲染核心，只剩主渲染循环 `render(g)` 本体及三方以上共用的函数：通用确认弹窗 `showConfirm`/`confirmAndPlay`（同时被 `render()`/`render-controls.js`/`render-hand.js` 三者调用）、`resolveActionId`/`canShuangxiongDuelCard`/`playConfirmMsg`（同样三方共用）、`seatColor`/`NAME_COLORS`/`escapeHtml`/`getPlayerDisplayLabel`/`cardImageSrc`/`cardImgError`/`setBanner`（跨多个渲染子域共用）、`renderSeatCard`（座位卡片视觉生成，只被 `render()` 自己内部的 `buildSeatDOM` 调用，和响应UI无关；骨架级重建阶段1从原来同一位置的匿名渲染代码块提炼而来，取代了旧版按象限分配座位槽的 `seatSlot`——`seatSlot` 已删除，对手改用简单的回合顺序线性排列 `oppOrder`）、`isPortrait`/`checkLandscapeGate`（骨架级重建阶段3新增的强制横屏软引导，页面加载时立即注册 `resize`/`orientationchange` 监听，和响应UI无关）——旧版环绕布局的 `.seats`/`.opp1`/`.opp2` grid 体系与 `#seats` 容器已在骨架级重建里整体废弃，改为 `.opp-row`（对手横排）+`#tableStrip`/`#tableCard`（中央出牌区独立横条）+`#meSeat`（自己座位卡）+`.hand`（手牌）四个独立的 `#game` 子元素，飞牌/连线动画的坐标计算基准也相应从 `#seats` 改为 `#game`）+ `render-table.js`（从 render.js 拆出的中央出牌区展示层：`tableCardFaceHtml`/`renderTableCard`，含文字展示/座位高亮/飞牌动画/目标连线/交换展示全部逻辑）+ `render-hand.js`（从 render.js 拆出的手牌渲染层：`attachLongPressPreview`/`renderHand`/`fitFontSize`/`cardMetricsForViewport`）+ `render-controls.js`（从 render.js 拆出的响应/目标选择 UI 层：`renderControls` 本体+其两个专属子渲染 `renderGuanxing`/`renderPickGeneral`+专属 helper（`waitAskBanner`/`fangtianSuffix`/`qiaobianSources`/`qiaobianTargets`/`jijiuChoices`/`guanshifuOptions`/`EQUIP_SLOT_LABEL`）+全部约30个客户端选牌/选目标状态机变量（`selectedCardIdx`/`zhangbaMode`/`duanliangMode`/`jiedaoSeatA`/`qiaobianMode`等 `*Mode`/`*Picks`/`*CardIdx`）及其 `reset*` 函数——这批状态变量是 `renderControls` 的私有状态，但 `render.js` 的 `render()` 清理块和 `confirmAndPlay` 的 cleanup 闭包会跨文件调用这里的 `reset*`，见 `docs/progress-log-*.md` 文件拆分第五步）+ `render-log.js`（从 render.js 拆出的日志/toast 展示层，纯展示格式化，不含游戏逻辑），`index.html` 用 `<script src>` 依次引入，不经过任何打包/编译步骤。所有 `<script>` 共享同一个全局作用域（无 ES module），文件拆分只是把函数/常量的物理位置挪到不同文件，互相调用不需要 import/export。**加载顺序有一个例外**：`room-lifecycle.js` 必须排在 `game.js`（以及 `render.js`）**之前**，因为 `game.js`/`render.js` 顶层各有一行加载时立即执行的 `onclick` 绑定（分别绑定 `joinRoom`/`cleanupRoom`）依赖 `room-lifecycle.js` 里的函数已经存在——其余新拆出的文件都遵循"排在被拆分的源文件之后"的默认顺序，只有这一个是反的，实际顺序见 `docs/progress-log-*.md` 文件拆分记录。
- **联机**：2~3 人，各自在浏览器打开同一网址、填同一房间号即可对战。
- **同步**：用 **Firebase 实时数据库（Realtime Database）** 做状态同步，compat 版 SDK 通过 `<script>` 加载。所有玩家订阅同一份房间状态，谁操作就改它，其他人实时更新。
- **部署**：**GitHub Pages 自动部署**——push 到 `main` 分支就会自动触发构建发布，地址 `https://zjc-taikutu.github.io/my-sanguosha/`，不需要手动拖到 Netlify Drop/Firebase Hosting（这两个是更早期用过的方式，文档曾经长期没跟着更新，是排查一次"头像素材看起来损坏"的问题时才用 `gh api repos/.../pages` 查出来现在实际用的是 GitHub Pages，顺手把这条改正）。**已知的坑**：① push 到真正线上生效之间有几十秒的构建延迟，构建期间线上仍是"上一个成功版本"；② 这个仓库的 Pages 构建历史上出现过多次"莫名其妙构建失败"（`gh api repos/zjc-taikutu/my-sanguosha/pages/builds` 能查到具体是哪次提交失败、报错只有笼统的 `"Page build failed."`），构建失败期间线上会**继续停留在上一次成功构建的版本**，直到下一次 push 触发的构建成功为止（查到过失败后隔了1小时零6分钟才被后续 push 覆盖过去的真实案例）——**根因是这个仓库默认没有 `.nojekyll` 文件**，GitHub Pages 的 `legacy` build_type 默认会用 Jekyll 引擎处理，一个纯静态文件项目（没有任何真正需要 Jekyll 处理的内容）跑 Jekyll 容易在一些边缘情况下（文件名/目录结构撞上 Jekyll 的保留规则等）莫名构建失败，这是 GitHub 官方文档里点名的常见坑，标准做法就是加一个空的 `.nojekyll` 文件跳过 Jekyll 处理、直接原样发布静态文件——已经加上（见 `docs/progress-log-*.md`）。**以后如果再遇到"明明 push 了但线上看起来没变/内容不对"，第一反应应该是先怀疑这里**（构建延迟、或构建失败还没被覆盖），去 `gh api repos/zjc-taikutu/my-sanguosha/pages` 和 `.../pages/builds` 查一下最近几次构建的状态和对应 commit，而不是直接怀疑代码本身写错了。
- **现状**：基础流程 + 完整锦囊 + 多名武将 + 可变人数（2/3 人）都已完成，仍在持续扩展。

## 二、整体架构与关键约定（改动必须遵守）

### 状态与事务
- 房间状态存在 Firebase 的 `rooms/{房间号}/game` 下，代码里用 `gameRef` 指向它。
- **所有状态变更必须走 `tx(fn)`**（封装了 Firebase transaction，保证多人并发下串行化）。不要在 `tx` 外直接改共享状态。
- `tx` 内部会先调 `normalize(g)` 再执行你的逻辑。

### Firebase 的关键坑（最容易出 bug 的地方）
- **Firebase 不保存空数组/空对象**：存进去的空数组，读回来会变成 `undefined`。
- 因此**任何新增的数组字段，都必须在 `normalize(g)` 里补默认值**，否则读到 `undefined.length` 会崩。
- 标量字段（数字、字符串、布尔）不受此影响，但数字 0、布尔 false 要确认不会被误判。

### 伤害与胜负（统一入口，不要绕过）
- **所有掉血走 `dealDamage(g, seat, amount, sourceSeat, reason, srcType, sourceCard?)`**：只负责扣血 + 死亡判定挂起 + 日志。**返回值语义**：`true` = 已挂起进入濒死流程（调用方应立即 `return`，不做后续收尾——收尾延后到濒死解决时统一处理，见下条「濒死求桃」）；`false` = 本次伤害未致命，正常继续。**不代表"是否真死"**——挂起后可能被桃救回。不推进阶段、不判胜负。`srcType` 只是伤害来源类型标签（如 `'sha'`/`'duel'`/`'aoe'`/`'delay'`/`'kurou'`），不能代表实体牌；`sourceCard` 才是本次伤害对应的真实牌对象（丈八蛇矛两张当杀时传数组）。只有牌造成的伤害传 `sourceCard`，纯技能伤害（苦肉/骁果等）保持空值，避免凭牌名或类型误拿牌。
- **濒死求桃**：`hp<=0` 时不立刻死亡，`dealDamage` 转调 `startDying(g, seat, srcType)` 挂起，按座位顺序（从濒死者本人开始，复用 `nextAskee`）逐个询问是否打出【桃】救援，`respondDying(useTao)` 结算。问完一圈无人救 / 无人有桃 → `finishDying(g, true)` 才真正阵亡（原「阵亡弃牌」逻辑就在这里）；中途回血 >0 → `finishDying(g, false)` 救回。`finishDying` 还负责接回被打断的那条流程的尾巴——用 `pending.resume.type`（值就是调用方传的 `srcType`：`'sha'`/`'duel'`/`'aoe'`）决定 `checkWin` 之后该怎么继续（攻击者继续出牌 / 回合切换 / `aoeAdvance` 到下个目标），这段尾巴和原来 `respondShan`/`duelResponse`/`aoeRespond` 各自的收尾代码完全一致，只是延后执行。三个调用点因此**不需要各自实现濒死逻辑**，只需在 `dealDamage` 返回 `true` 时 `return g` 跳过自己的尾巴。
- **胜负走 `checkWin(g)`**：存活 ≤1 则置 `over`/`winner`、清 `pending`/`aoe`、记日志，返回 true。
- 标准用法（无濒死时不变）：`dealDamage(...)` → 若返回 `true` 则 `return g`（濒死流程接管）→ 否则 `if(checkWin(g)) return g;` → 否则继续各自的阶段推进。

### 武将技能系统（核心，扩展时照这套来）
- 武将集中定义在 **`GENERALS` 表**（id → {name, maxHp, skill, desc, caps?, hooks?}）。
- **唯一查询入口是 `getGeneral(id)`** —— 业务代码永远通过它查武将，**绝不硬编码武将名**（不要写 `if 玩家是张飞`）。
- 技能有三种表达方式：
  - **`caps`（被动能力）**：声明在武将上，业务点用 `generalHasCap(player, cap)`（布尔）或 `generalCapValue(player, cap, fallback)`（数值）查询。
    - 例：张飞咆哮 `caps:{unlimitedSha:true}`（布尔）；数值型 cap 如 `extraDrawPhase`（摸牌阶段多摸 N 张，`doDraw` 摸牌处 `generalCapValue(me,'extraDrawPhase',0)` 已接入），周瑜【英姿】即复用这条 seam。
    - **能力统一走 `hasCap(player, cap)`**：当前来源包括武将声明、运行时 `player.caps`、装备能力和左慈化身借用能力，业务层只问「有没有这个能力」，不关心来源、也不硬编码武将名/装备名。装备侧在 `EQUIPS` 里用 `cap:'xxx'` 声明（见「装备区」），如诸葛连弩 `cap:'unlimitedSha'`。**新增布尔能力判定时一律调 `hasCap`，不要只调 `generalHasCap`**，否则会漏掉装备、化身等动态来源。实时查询无缓存，来源移除后立即失效。
  - **`hooks`（触发型）**：在某时机执行一段效果，用 `triggerHook(g, seat, hookName, ctx)` 分发。
    - 例：郭嘉遗计、司马懿反馈都挂在 `hooks.onDamaged` 上（在 `dealDamage` 里触发，ctx 含 `{amount, sourceSeat, srcType}`，牌伤害还会带 `sourceCard`）。孙尚香枭姬挂在 `hooks.onLoseEquip` 上（失去装备时触发，ctx 含 `{count}`，见「失去装备钩子」）。
  - **牌的转化**：`canUseAs(player, card, role)` 判断"这张牌能否当某用途用"，`findUsableAs(hand, player, role)` 找可用牌（优先本名牌）。
    - 例：赵云龙胆 `caps:{longdan:true}`，杀↔闪双向转化。所有"需要杀/闪"的场景都走 `canUseAs`/`findUsableAs`，不要在各处硬判断 `card.name==='杀'`。
- `caps`/`hooks`（函数/能力声明）只存在于客户端 `GENERALS` 表里，**从不写进 Firebase**，所以不需要在 normalize 里防御它们。持久化到房间状态的只有 `player.general`（id）以及从武将派生并展开存下的 `player.maxHp`（标量）——后者会在 `normalize` 里补默认值（回退 `MAX_HP`）。

### 武将技能系统的进阶模式（扩展新技能前先看这里有没有现成的可复用）
下面这几个模式是陆续加武将时沉淀出来的，具体实现细节写在 `docs/progress-log-*.md` 对应武将条目里，这里只做索引，方便定位该复用哪一套：
- **回合内"限一次/计数"标志位**：`g.shaUsed`/`g.duanliangUsed`/`g.qiaobianUsed` 都是同一个写法——`startTurn` 里重置为 `false`，`normalize` 里 `typeof!=='boolean'` 时防御回退。刘备【仁德】的 `g.renDeCount` 是同类出牌阶段计数字段，`startTurn` 重置为 `0`，`normalize` 里用 `Number.isInteger` 防御。新增"每回合限一次"或"本阶段计数"的技能照抄这套写法，不要另起炉灶。
- **虚拟牌**（`card.virtual=true` + `discardOrVanish(g,card)`）：技能"视为使用/打出某张牌"但不需要真的持有实体牌时用。凡是会让一张牌"离场"（进弃牌堆）的地方，都要用 `discardOrVanish` 而不是直接 `g.discard.push`，否则虚拟牌会被 `ensureDeck` 当真牌洗回牌堆、污染牌堆构成。**目前项目里暂时没有活跃的虚拟牌用例**（徐晃【断粮】原本是这套机制的例子，但那其实是当初对官方规则的误解——断粮官方效果是"将一张黑色基本牌/黑色装备牌当兵粮寸断使用"，需要的是一张真实的黑色牌，不是凭空"视为"，已改正为传真实牌，见 `docs/progress-log-*.md` 断粮条目）；`discardOrVanish`/`card.virtual` 这套 seam 仍保留，留给以后真正需要"无需持有实体牌就能视为使用"的技能用。
- **改变响应数量要求**（`g.pending.shanCount`/`shaCount` 计数器）：技能要求"连续出 N 张牌才算完成一次响应"时用（吕布【无双】）。不需要新阶段/新 UI，只在现有 `pending` 上加一个计数字段，`needed` 在响应函数里临时算，不够就把计数写回 `pending` 、留在原阶段再问一次。
- **场上牌移动**（`qiaobianSources`/`qiaobianTargets` 动态清单 + 服务端独立重新校验）：技能要移动装备/判定区的牌到另一个角色身上时参考张郃【巧变】——如果全程只有技能拥有者一人做选择（不需要其他玩家响应），走"客户端逐步累积选择、最后一次性原子提交"，不需要引入新的服务端阶段。
- **`resolveShaUse` 的 `card` 参数**：`resolveShaUse(g,me,targetSeat,usedAs,card)` 的 `card` 是转化后**实际打出**的物理牌（不是"杀"这个抽象概念），技能需要按颜色/花色判断这张杀本身时用（于禁【毅重】判断黑色）。丈八蛇矛两张当杀没有单一花色，调用方不传 `card`（`undefined`）。
- **`noShan`**（`g.pending.noShan`，"此杀不可被闪抵消"）：铁骑判红、烈弓数值条件满足都复用同一个标志——为真时 `continueShaAfterTieqi` 直接跳过 `tryBagua`（连判定机会都不给），`respondShan` 服务端拒绝出闪，UI 不渲染"出闪"按钮。
- **公共牌区+轮流挑选**（五谷丰登）：批量亮出的牌暂存在 `pending.pool`（不进弃牌堆，用新写的 `revealPool` 而不是 `judge`——后者是"翻一张+立刻进弃牌堆+判定日志"，语义不同），挑选顺序 `pending.order` 在真正开始挑选那一刻（无懈通过后）按存活玩家环形算好存进去，`pending.idx` 是指针；每人操作前校验 `order[idx]===mySeat`，挑完 `idx++`，问完一圈收尾。被无懈整体抵消时 `pool` 里的牌是真实牌，直接整体弃入 `discard` 即可。人数/池子在无懈询问期间因阵亡等原因错位时，不追求重新分配，挑完一圈后把 `pool` 剩余牌兜底弃入弃牌堆防卡死即可。
- **两个不同角色的目标选择**（借刀杀人的 A/B）：目标不是同类型可变数量（那是张辽突袭的场景），而是两个角色分别有不同的合法性要求时用。走客户端两步状态机（如 `jiedaoSeatA`，仿 `zhangbaMode`/`qiaobianSrc` 不入库）：第一步点击过滤"满足 A 条件"的座位存下来，第二步点击过滤"满足 B 条件（通常依赖已选的 A）"的座位后一次性提交给专属函数（不是标准 `playCard`，`CARD_PLAYS` 里对应项的 `effect` 留空防御、只借用其 `canPlay`/`target:true` 做"选中即高亮"）；效果需要"第二个人（A）做选择而非使用者"时，接一个新的响应阶段（`jiedaoChoice`），只有 A 能操作。

### 出牌系统（已统一，加新牌照这套来）
- **所有出牌走 `CARD_PLAYS` 表 + `playCard(cardIdx, actionId, targetSeat)`**。
- `CARD_PLAYS` 每项是 `{ canPlay(g,me,card), target(布尔，是否需要指定目标), effect(g,me,card,targetSeat) }`。
- **加一张新牌 = 往 `CARD_PLAYS` 表里加一项 + 在 `buildDeck` 里加牌**，不要再写独立的 `playXxx` 函数。
- `playCard` 统一负责：阶段/回合校验 → 取牌校验在手 → `canPlay` → 目标校验（仅 target 牌：非自己、存活）→ 出牌入弃牌堆 → `effect`。
- 注意 `actionId`：除"杀"外都等于 `card.name`；**杀固定为 `'杀'`**（因为赵云的闪物理 name 是'闪'但要走杀的逻辑）。

### 装备区（数据结构 + 装备进出 + 距离/射程 已完成；武器/防具特效待做）
- 每个玩家有一个装备区 `player.equips`，**四槽**：`{ weapon, armor, plus1, minus1 }`（武器 / 防具 / +1马防御 / -1马进攻）。每槽存**一张装备牌对象或 `null`（空）**。
- **装备牌对象就是普通牌对象 `{id, name}`**，和手牌同构；装备 = 把牌对象从手牌搬进槽，卸下 = 搬进弃牌堆。**牌对象上不挂任何派生属性**。
- **派生属性（所属槽位 `slot`、武器射程 `range`、马的距离修正 `dist`，日后加防具特效）声明在客户端常量表 `EQUIPS`（name → {...}），经 `getEquip(name)` 查询，从不写进 Firebase**——和武将 `caps`/`hooks` 同一套 seam：业务层永远查表，不硬编码装备牌名。
- **`equips` 是持久化的对象字段，必须在 `normalize` 里防御**：Firebase 吞 `null` 值/空对象，读回来容器会缺失或缺键，用 `p.equips = Object.assign(emptyEquips(), p.equips||{})` 补容器 + 补齐四槽（缺的回退 `null`）。四槽结构统一走 `emptyEquips()` / `EQUIP_SLOTS`，别各处手写。
- 初始化：`startGame`/`newGame` 给每人 `p.equips = emptyEquips()`；加入/重连路径不手写，靠 `normalize` 兜底（单一补全入口）。
- 显示：装备区是**公开信息**（和武将一样人人可见），在座位卡片 HP 下渲染；空槽显示暗色占位 `—`。
- **装备打出（进出装备区）**：所有装备共用一个 `CARD_PLAYS` 项 `equipPlay`（`target:false` + **`noDiscard:true`**），由 `Object.keys(EQUIPS).forEach(...)` 自动挂进 `CARD_PLAYS`——**加新装备只改 `EQUIPS` 一处**。`noDiscard` 让 `playCard` 跳过「进弃牌堆」，改由 `equipCard` 把牌放进对应槽（同槽旧装备进弃牌堆）。**装备牌不进弃牌堆是靠 `noDiscard` 标志，别在 effect 里从 discard 挪回来。**
- **装备提供能力**：`EQUIPS` 项加 `cap:'xxx'` 即表示「装备它的人获得该布尔能力」，由 `equipHasCap`/`hasCap` 实时查询（见「武将技能系统」的 `hasCap` seam）。例：诸葛连弩 `cap:'unlimitedSha'`（无限杀）。后续「给能力」的武器/防具照此声明，判定统一走 `hasCap`，不硬编码装备名。

### 距离系统（已完成；只有【杀】受攻击距离限制）
- **口径**：基础距离 = 两座位在**存活玩家**环上的最近间隔（阵亡者不占位，计算时跳过）；目标的 `+1马` 使别人到他 `+1`（更难够到），我的 `-1马` 使我到别人 `-1`（更易够到）；**距离最小为 1**。攻击距离 = 我的武器 `range`（无武器默认 1）。**能对某人出杀 = 距离 ≤ 攻击距离**。
- **函数**：`distance(g, from, to)`（环形最近间隔 + 目标 plus1 + from minus1，`Math.max(1,…)`）、`attackRange(g, seat)`（读武器 `range`，无则 1）、`canReachSha(g, from, to)`（= 距离 ≤ 攻击距离；**UI 与校验共用同一入口，口径不分叉**）。马/武器数值一律从 `EQUIPS` 的 `dist`/`range` 读，不硬编码。
- **接入出杀走 `canTarget` seam**：`CARD_PLAYS` 项可选 `canTarget(g,me,card,targetSeat)`，`playCard` 在「非自己/存活」校验后调用它。**只有【杀】挂了 `canTarget`（查 `canReachSha`）**；决斗/顺手/过河拆桥/南蛮/万箭无 `canTarget`，不受攻击距离限制（维持各自目标规则）。距离是**额外叠加**的一层，不动 `canPlay` 里的赵云【龙胆】/张飞【咆哮】逻辑。
- **UI**：选中作为杀的牌时，超距的存活对手不可点（暗色点线 + 「够不着」角标 + 悬浮「距离 X ＞ 射程 Y」）；范围内保持朱红虚线可点。`canTarget` 是服务端级兜底，UI 漏判也拦得住。
- **边界**：2 人无装备距离都是 1、可互杀；2 人一方装的卢 → 距离 2，对手无长武器则「够不着」（**刻意不为 2 人加特例**，符合真实规则，可用过河拆桥/顺手拆马或丈八蛇矛 range3 反制）。

### 顺手/拆桥 作用于「手牌 + 装备」的 `pick` 选牌子阶段
- 顺手牵羊/过河拆桥可拿/拆目标的**手牌、装备或判定区（延时锦囊）**。无懈通过后 `resolveTrick` 统计可拿/拆对象：**手牌整体算 1 个「随机手牌」选项**（隐藏信息，不列具体牌），**每件已装备、判定区每张延时锦囊各算 1 个具名选项**（均为公开信息）。
- **唯一项免弹窗、≥2 项才开 pick**：0 项→无效果回 play；1 项→直接结算（纯手牌走老路径、行为不变）；≥2 项→开 `pending={type:'pick',trick,from,to}`、`phase='pick'`，**只有使用者 `from` 能选**。选牌由 `pickResolve(choice)` 结算（`choice='hand'`、装备槽名、或 `'delay:'+下标`），失效项（手牌空/槽空/判定区那张已不在/目标死）安全回 play 防软锁。
- 结算逻辑抽成共用 helper：`applyTrickOnHand`（随机拿/弃手牌，**日志不写牌名**）、`applyTrickOnEquip`（拿/拆指定槽装备，**日志写牌名**；顺手获得的装备进使用者手牌）、`applyTrickOnDelay`（拿/拆判定区指定下标的延时锦囊，**日志写牌名**；顺手获得的延时锦囊进使用者手牌，此后就是一张普通牌）。「唯一项直接结算」和「pick 后结算」都调这三个 helper，逻辑不分叉。
- `pending.type:'pick'` 全是标量，`normalize` 无需改。拿走装备后 `distance`/`hasCap` 实时生效（拆的卢/连弩即失效）。
- **失去装备钩子 `onLoseEquip` 已实现**：装备离开装备区时经 `triggerHook(g, seat, 'onLoseEquip', {count})` 分发。触发点：`applyTrickOnEquip`（被顺手/被拆，失主 `info.to`）、`equipCard`（同槽换装换下旧装备，装备者）——均 `count:1`。**阵亡弃装备刻意不触发**（`dealDamage` 死亡分支提前 return，人已死不发动常规技能）。孙尚香真实枭姬即挂此钩（失去一张装备摸两张，`2*count`，自动触发不询问）。日后加「主动卸载装备」入口须一并接入此钩（`dealDamage` 死亡分支有注释提醒）。
- **顺手牵羊的距离限制已实现**（原"暂缓"项，见 `docs/progress-log-*.md` 改动记录）：`CARD_PLAYS['顺手牵羊'].canTarget` 限制距离≤1，和杀的 `canTarget` seam 同一套接入方式；过河拆桥官方无距离限制，刻意不加。

### 人数
- `SEATS=3` 是**容量上限**（满 3 不再加入）；`MIN_PLAYERS=2` 是**开始门槛**（≥2 即可开始）。
- "找下一个玩家"的环形遍历（`nextAlive`、`nextAskee`）必须**按实际玩家数 `g.players.length` 取模**，不要写死 3。

### 玩家身份（联机识别）
- 每个浏览器用一个本地标识 `cid` 区分"自己刷新重连"和"别人重名"。
- **测试多人时必须用不同浏览器**（Chrome/Edge/Firefox 各一个），不能用同一浏览器的多个标签或同一无痕会话的多窗口——它们共享存储、`cid` 相同，会被识别成同一个人挤进一个座位。

### AI 机器人决策总线（机器人决策的统一架构，2026-08 起）
机器人（`bot.js` 调度 + `ai-bot.js` 密钥/网络）的所有决策收敛为**统一总线**。详细实现与各批次记录在 `docs/progress-log-8.md`，这里只写架构约定与维护纪律。

- **统一入口**：`botDecide(decisionId, g, seat)`——注册表 `BOT_DECISIONS`（match/buildCandidates/localFallback/execute 五段式）+ `callAiChooseIndex`（密钥守卫/思考中UI/超时/解析/越界全部收敛一处）。**AI 只能从候选列表选 index（`{"choice":N}`），不能发明动作**；解析失败/越界/超时一律返回 null → `localFallback`，**不重试、不阻塞**。
- **无密钥回归红线**：每个注册项的 `localFallback` = 改动前本地逻辑**逐字**（测试锁定）。L1 泛化后尤其注意：**有/无密钥路径解耦**——无密钥时 `controlsChoiceMatch` 返回 false，runBotDecision 走该阶段既有旧分支，行为零变化。
- **L1 controlsChoice（响应类按钮镜像）**：DOM 隔离渲染 `renderControls(g)` 收集全部 `button:not(:disabled)`，AI 从按钮里选（点击走人类同款 onclick）。**EXCLUDE 集合**（`CONTROLS_CHOICE_EXCLUDE`）防 L1 抢占已有专用注册/专用逻辑的阶段——**新增专用注册时，必须把该 phase 同步加进 EXCLUDE**。allowlist 三阶段（wuxie/luoyingAsk/luoshen）无密钥也由 L1 接管（旧分支已删/等价性已论证）。
- **L2/L3 结构化候选**：`BOT_SEAT_PICKS`（座位技能注册表：断粮/奇袭/国色/武圣/双雄/挑衅/反间/青囊/蛊惑目标/旋风/驱虎伤害，`seatPick` 动态合并）；多步两阶段（借刀/离间/丈八/仁德 + yijiAssign/lirangAsk，用 `botTwoStepA` 客户端累积、不入 Firebase）；分配类纯按钮阶段（liuli/tianxiang/lirangRecover/zhengyi）由 L1 自动覆盖。
- **调度前提**：`botSeatForState(g)` 查 `BOT_PHASE_ACTOR` 表解析"该谁行动"——**新增任何阶段分支/注册项，必须同时在这张表登记**（不登记则行动者解析恒 -1，分支永远不会被调用）。
- **强C（出牌同窗多步）**：`runBotActionWindow` 循环——`tx(fn, onCommitted?)`（game.js，可选第二参数，Firebase transaction resolve 后把新快照交给回调）+ `playCard`/`endPlay` 可选回调透传。有密钥时循环（execute→等提交快照→重枚举→再选，直到结束/8步上限/窗口失效）；**无密钥执行一步即返回（弱C 行为逐字）**。响应类维持单步，不扩展回调。
- **AI 自维护摘要（跨回合记忆）**：`aiSummary`——回合变化时 `updateAiSummary` 异步总结（旧摘要+recentLog→新摘要，≤200字），`callAiChooseIndex` 注入 systemPrompt。座位绑定（`aiSummarySeat`，切换机器人座位清空）、`phase==='over'` 清空、弹窗「清除AI记忆」按钮主动清空。**真人回合（seat=-1）不清记忆**（守卫 `seat>=0`）。失败沿用旧摘要，不阻塞决策。
- **隐藏信息红线**：`buildBotVisibleState` 从头只投影该座位合法可见字段（他人手牌只张数、未翻身份 null、蛊惑无 actualCard——结构上不可能引用）；摘要/历史只存该座位自己视角的内容。
- **token 纪律**：出牌候选按 `localHeuristicScore` 降序截断 Top-25（`AI_PLAY_CANDIDATE_LIMIT`，结束项恒在末尾，无密钥零变化）；recentLog 15 条；desc 全量但按需投影。
- **测试**：决策接入 = `run_ai_bus_*.js` 套件（vm 沙箱加载真实源码）；`?v=` 同步；改动记录进 progress-log。

## 三、改动原则（请严格遵守）

1. **一次只改一件事**。不要顺手重构无关代码、不要一次塞多个功能。
2. **改完要能回归测试**。说明改了哪些函数、要不要重新部署、要不要清空 `rooms` 数据。
3. **涉及结构/状态机的较大改动，先给设计方案，等我确认后再写代码**（尤其是会触及多处的改动，先列"改动清单/对照表"，确保没有遗漏）。
4. **纯重构必须行为零变化**，并逐项说明和改动前一致。
5. **不要硬编码武将名/牌名做特例判断**——能力声明在数据表、判定走 seam（getGeneral / canUseAs / CARD_PLAYS）。
6. **新增数组字段记得在 `normalize` 里防御**（Firebase 吞空数组）。
7. 改动较大或新增阶段时，**清空 `rooms`** 再测（旧房间状态可能不兼容）。
8. **隐藏信息**：手牌、是否持有某张牌（如无懈可击）等是隐藏信息，UI 和日志都不要泄露谁有什么牌。
9. **改动测试通过后，直接执行 `git add`/`commit`/`push`，不用等待用户确认**——commit message 写清楚这次改了什么。若改动较大或有把握不足，可以先说明测试结果，但仍应完成 push，不要把"是否 push"当成需要用户额外确认的步骤。**例外**：如果改动本身还没经过测试确认（刚写完代码、还没验证过），不要着急 push，应先让用户确认测试没问题，再 push——push 的前提仍是"确认改动是对的"，只是不再需要用户额外说"去 push"这个动作本身。
10. **分支管理**：**开发提交在 `wenwen_dev` 上自由进行（不需要批准），需要上线时把 `wenwen_dev` 同步（快进/合并）到 `main`**。**GitHub Pages source 已配置为 `main`**（2026-08-10 用户确认）——**push `main` 即触发线上构建，不再需要同步 `chengcheng`，`chengcheng` 永久搁置不再碰**（此前的"chengcheng 是 Pages 源、须快进它才能上线"机制已作废）。**每次开始新任务前，先用 `git branch` 确认当前分支**，默认在 `wenwen_dev`。
11. **完成任何一次功能实现（新武将、新机制、新 bug 修复、新装备等）后，写改动记录是任务收尾的标准步骤，和 `commit`/`push` 同等优先级——不是软性建议、不是"提醒了才做"，代码写完、测试通过、push 了，任务还不算完成，直到改动记录也补上了才算。**（**⚠️ 记录写进 `docs/progress-log-N.md` 的当前最新分段文件，不是本文件——具体操作见本文件最开头的防复发规则块，这里只说该写什么内容**）具体要做：
    - 在当前最新的 `docs/progress-log-N.md` 末尾加一条准确描述这次改动的记录（新武将写清楚 `caps`/`hooks`/关键实现点；新机制说明它复用了哪套已有模式还是引入了新模式）；
    - 如果涉及新的架构约定/新机制类型（新的 `pending` 类型、新的挂起-恢复模式、新的数据结构、新的可复用 seam），在 `CLAUDE.md` 本体"二、整体架构与关键约定"对应章节（或"武将技能系统的进阶模式"索引小节）补充说明——这一步**是**写进 `CLAUDE.md` 本体的例外情况，因为它属于"架构约定本身发生变化"；
    - 如果这次修复了"四、已知的待优化点"里记录的问题，把那一条从 `CLAUDE.md` 本体的清单里移除；
    - 如果这次提炼出了不依赖具体任务上下文的通用教训，额外补一条进 `docs/methodology.md`。
    一次任务如果中途有过几轮方案调整、讨论分支，改动记录只需要在最终收尾时做一次完整总结，不用每个中间讨论都记。**另外，每累计约 5~6 次新增功能后，主动做一次核对性回顾**——对照代码实际状态（`GENERALS`/`EQUIPS`/`CARD_PLAYS` 等表的真实内容）和 `docs/progress-log-*.md` 记录逐一比对，检查有没有遗漏或过时的地方，不要假设"应该每次都记全了"（参考此前那次系统性核对，曾经就发现过遗漏和过时描述）。
12. **写 vm 沙箱测试脚本时，涉及"逐个询问"机制（濒死求桃、无懈可击反制、鬼才改判、乐进骁果这类靠 `nextAskee`/`nextGuicaiAsker`/`nextXiaoguoAsker` 等函数按座位顺序遍历候选人的场景）时，不要预设"这次问的是哪个座位"——座位顺序由存活玩家的环形位置和候选人资格（是否存活/有没有对应牌/是否在攻击范围内等）动态决定，不是"下一个座位号"这么简单，靠猜容易错（已经在多次调试里踩过好几次这个坑：把响应发给了错误的座位号，导致测试断言看起来像是代码 bug，其实只是测试脚本的预设座位不对）。正确写法是每次循环读取 `g.pending.asking`（或对应字段）动态获取当前实际被问的座位，再对那个座位发响应，例如：`while(g.phase==='dying'){ setSeat(g.pending.asking); call('respondDying', ...); }`。
13. **`element.className = 'xxx'` 是整体覆盖，不是追加**：如果这个元素本身还需要保留其它 class（尤其是 HTML 里写死的基础 class，比如某个容器原本 `class="seats"`，JS 又要动态加一个状态 class），直接赋值会把原有 class 冲掉，导致依赖"同时命中多个 class"的组合选择器（如 `.seats.opp2`）永远匹配不上——现象通常是"CSS 看起来完全没生效"，容易被误判成选择器写错/文件没部署对/浏览器缓存，实际是 DOM 上的 class 就没那个值。排查这类"CSS 明明写对了但没生效"的问题时，先去 Elements 面板确认元素实际的 `class` 属性，而不是只检查 CSS 源码。修的时候优先用 `classList.add()`/`classList.remove()` 按需增删（不影响其它已有 class）；如果确实要用整体赋值，必须显式拼接所有需要保留的 class（例如 `el.className = 'seats opp'+n`），不能想当然只写新加的那部分。
14. **DOM 事件回调里不要在"点击时才读"会被后续逻辑清空的可变状态（如 `selectedCardIdx`/`zhangbaPicks`/`duanliangCardIdx`/`jiedaoSeatA` 这类客户端选牌/选目标状态）**：这些状态是在某次 `render()` 里挂载 `onclick` 的那一刻才有效，如果 `onclick` 函数体内才去读这个可变变量（`d.onclick=()=>{ const idx=selectedCardIdx; ... }`），那么只要"挂载 onclick 的旧 DOM 节点在下一次真正重绘之前还留在页面上可点"（典型场景：`confirmAndPlay` 点确定后清空了 `selectedCardIdx` 但没有立即 `render()`，网络 `tx` 往返完成前旧节点仍可点），一次误触/二次点击就会读到已被清空的值（`null`），表现为"确认框显示【undefined】"+"点确定静默无效果"（`playCard` 拿到 `cardIdx=null` 会被 `if(!card) return g;` 安静拒绝，不报错，容易被误判成别的 bug）。正确写法：这类状态要在渲染/挂载 `onclick` 的那一刻就读出来存成局部 `const`（在 `if` 块里、`d.onclick=` 赋值语句之前），`onclick` 函数体只引用这个冻结值，不再引用外层可变变量；同时确认类操作（如 `confirmAndPlay`）点"确定"后也应该像"取消"一样立即 `render()`，别让旧的可交互节点在网络往返期间继续留在页面上。手机网络延迟下这类 bug 尤其容易触发，桌面测试很难复现。
15. **`resolveActionId(g, me, card)`（`render.js`）：点一张手牌到底按"它自己的效果"结算，还是按"当杀/当闪"转化结算，优先它自己的 `CARD_PLAYS` 入口**：只要 `CARD_PLAYS[card.name]` 存在且此刻 `canPlay`，就按这张牌自己的名字/效果走；只有这张牌本身没有独立可出的入口（目前只有【闪】——它从不是主动可出的 `CARD_PLAYS` 项，只能被动响应）才走 `canUseAs` 的转化路径。**这是从一个真实 bug 修出来的**：关羽【武圣】/甄姬【倾国】的转化判定（`canUseAs` 里 `role==='杀'&&hasCap(...,'wusheng')&&isRed(card)` 这类）只看颜色、完全不看 `card.name`，如果客户端哪里直接拿 `canUseAs(me,card,'杀')` 的结果决定"这次点击按哪个 `CARD_PLAYS` 项处理"，就会把关羽/甄姬手里任意一张红/黑色的无中生有、南蛮入侵、过河拆桥等"本身就有效果"的牌，全部误判成杀——点击只会静默"选中"（走目标选择流程）而不弹确认框，或者错误套用杀的攻击距离限制。`resolveActionId` 把"这张牌该按什么结算"收敛成唯一入口，主动点击手牌/选目标的地方统一调它；决斗出杀/濒死出桃/打闪/万箭出闪这类**被动响应**场景（找"任意能顶替用的牌"）不受影响，依然直接用 `canUseAs`/`findUsableAs`，因为那些场景本来就该找任意合适的牌，不存在"点哪张牌就该是哪张牌自己效果"这个歧义。
16. **Firebase 的 `transaction` 规则：返回对象里任何字段显式为 `undefined` 就整体拒绝写入（不是软失败，是直接不提交，抛 `"Data returned contains undefined in property ..."`）**——和"二、整体架构"里"Firebase 不保存空数组/空对象"是**同一类序列化限制**（Firebase 都不允许，只是表现不同：空数组是"存进去读回来变 `undefined`"，这条是"提交阶段直接拒绝、连写都写不进去"），排查/设计时应该放在一起考虑。这是一次真实的系统性 bug 的根因——`startTrick` 的 `g.pending={type:'wuxie', ..., card:info.card, seatB:info.seatB, pool:info.pool, ...}` 无条件把这三个"透传字段"塞进对象，而绝大多数锦囊根本不传这几个字段（只有对应的延时锦囊/借刀杀人/五谷丰登才会），于是这三个 key 在别的锦囊那里就是显式的 `undefined` 值——导致**几乎所有经过 `startTrick` 的锦囊**（过河拆桥/无中生有/决斗/顺手牵羊/桃园结义/延时锦囊放置/借刀杀人/五谷丰登）第一次使用就被 Firebase 拒绝，界面表现为"点确定没反应"，且**只有真连 Firebase 才会触发**——本地/自测的 stub 环境（包括这个项目里所有 vm/jsdom 测试用的手写 `gameRef.transaction` stub）如果不专门模拟这条校验规则，永远测不出来，非常隐蔽（唯独没经过 `startTrick` 的南蛮入侵/万箭齐发——走 `aoeAdvance` 单独构造 `pending`——因为不受影响而"看起来正常"，一度误导排查方向）。**修复方式**：①具体修法——"透传字段"只在真的有值时才用 `if(info.card!==undefined) g.pending.card=info.card;` 这种写法加进对象，不要无条件 `card:info.card`；②系统性兜底——`tx(fn)` 出口统一套一层 `stripUndefined(obj)`（深度剔除所有 `undefined` 属性)，即使以后又有类似疏漏也不会真正写坏/被拒绝。**以后新增"某几种场景才有值、其它场景不传"的透传字段时**：优先用条件展开/`if` 判断只在有值时才加入对象（好习惯，让代码本身说明"这个字段何时存在"），`tx()` 里的 `stripUndefined` 只是最后一道安全网，不是可以随手写 `x: 可能是undefined的变量` 的理由。**调试线索**：如果真连 Firebase 环境里出现"点确定没反应/静默失败"，而本地 stub 测试测不出来，第一时间应该怀疑这条规则，去浏览器 Console 找 `"Data returned contains undefined"` 这个报错，而不是继续在业务逻辑里找茬——这类 bug 只有连真实 Firebase 才会触发，纯代码走查/普通本地测试永远发现不了。
17. **静态资源 cache-busting：`config.js`/`data.js`/`game.js`/`render.js` 的 `<script src>` 都带 `?v=N` 查询参数**：手机浏览器对同源静态资源的缓存比电脑顽固得多——同一个网址在电脑上访问是最新效果、手机上依然是修复前的旧样式/旧逻辑，用户那侧硬刷新/关闭重开 App 都未必能清掉，这是真实踩过的坑（排查过程：先怀疑代码没生效→用 headless 真实浏览器验证代码本身完全正确→电脑访问线上地址正确、手机访问同一地址错误→精确定位到是手机端的资源缓存，不是代码/部署问题）。**`?v=N` 让浏览器认为这是一条新 URL，必须重新请求，不依赖客户端缓存策略是否规矩**。**这个版本号是手动维护的，不是自动生成**——这个项目是纯静态多文件/无构建流程，没有 commit hash 注入的机制（要注入当前这次 commit 的 hash 到文件里，只能塞上一次 commit 的 hash，因为这次 commit 的 hash 在提交前不知道，属于典型的先有鸡还是先有蛋问题，意义不大）；改用 hash 需要额外接一段构建脚本或 git hook，和"保持单文件、无构建工具"的项目取向冲突。**约定：往后凡是改动 `config.js`/`data.js`/`game.js`/`render.js` 内容、或 `index.html` 里的 `<style>`/内联脚本，都要把这四个 `?v=` 的数字同步加一**（四个保持同一个数字，简单不易出错），作为改动收尾的标准步骤之一，和更新 CLAUDE.md、commit/push 同等优先级，不要等用户反馈"手机上没生效"才想起来加。

18. **视觉验证必须主动挑最刁钻的样本，不能挑顺手的——这个项目已经连续两轮栽在同一个模式上。** 不是代码写错，而是**验证样本选得太温和，让缺陷隐形上线**：
    - 第一次：座位卡"文字叠立绘"方案，只用深色立绘看了看就通过 → 血量胶囊的**半透明**底衬在最亮的立绘（大乔）上对比度只有 **2.30**（远低于 WCAG AA 的 4.5），而在最暗的司马懿上有 4.60。缺陷的可见性完全取决于选了哪张图。
    - 第二次：同一套座位卡，验证截图恰好全用 **2 字武将名**（马超/大乔）→ 武将名竖排和血量胶囊在矮卡片上**本来就会重叠**，3~4 字名（司马懿/颜良文丑）必然撞车，但 PR#20 就这么上线了。**而"最长武将名是颜良文丑 4 字"这个数据 CLAUDE.md 里早就写着，只是从没被拿去做视觉验证。**

    **规则：任何视觉/布局验证，先问一句"什么样的输入最容易让它坏"，然后专门构造那个输入**，而不是拿手边现成的、看起来正常的数据跑一遍。这个项目里已知的刁钻样本（做视觉验证时优先取用，数据都在代码/本文件里，不用猜）：
    - **最长武将名**：`颜良文丑`（4 字；3 字的有司马懿/诸葛亮/黄月英/孙尚香/夏侯惇）——测竖排文字/名字栏溢出、和相邻元素重叠。
    - **最长装备名**：`青龙偃月刀`（5 字）——测装备条/标签换行截断。
    - **最亮 / 最暗的立绘**：最亮 `machao`（文字区亮度 157）、`daqiao`（血量区 107）；最暗 `simayi`（31）——测任何"文字叠在图片上"的对比度，**必须两端都测**，只测一端等于没测。
    - **最小的卡片**：7 人局 iPhone SE 横屏，对手卡仅 **96.5×128.66px**——测溢出/重叠/可读性下限。
    - **最多的装备**：4 槽全满（"我"的卡固定显示 4 行）——测装备条高度把别的元素顶出去。

    并且**验证要用程序化断言（量矩形、量对比度），不能只靠肉眼看截图**——肉眼在个位数像素和中间调对比度上极不可靠，前两次的缺陷肉眼看截图都"没觉得有问题"。

19. **本文件的 CSS 靠源码顺序决胜负——新增/修改任何 CSS 规则前，先确认它在文件里的位置相对于同名/同特异性的其它规则在哪。** 同特异性下**后写的赢**，这个坑在本项目已经反复出现过至少四次（`.info-badge` 基础规则写在 `@media` 断点之后导致断点全部失效；`#logToast`/`.corner` 的响应式规则同类问题；`.seat .seat-info-badge` 必须提高到 (0,2,0) 才压得住写在其后的通用 `.info-badge{width:22px}`；`@container` **本身不增加特异性**，整块写在 `.seat-*` 基础规则之前时分档完全不生效、font-size 被基础规则盖回去）。**具体要求**：
    - 基础规则一律写在**前**，`@media`/`@container` 覆盖一律写在**后**（本文件的既定顺序，不要打破）。
    - 给某个通用类（如 `.info-badge`）做局部覆盖时，**不要指望同特异性能赢**，加一层祖先选择器把特异性提上去（如 `.seat .seat-info-badge`）。
    - **症状识别**：出现"CSS 明明写了却完全不生效 / 改了数值没反应"时，**先去 Elements 面板看该元素的 computed 值和哪条规则真正命中**，不要在数值上反复试错——这类问题十有八九是特异性或源码顺序，不是数值不对。

20. **一条断言的价值，全部来自它"能变色"的能力——永远绿和永远红的断言一样没有价值。** 本项目已经各踩过一次，两者是同一类问题的镜像：
    - **永远红**：`inside()` 拿 DOMRect 的 `.w`/`.h` 做比较，而 DOMRect 只有 `.width`/`.height` → 结果恒为 `NaN` → 比较恒 false → **这条断言在任何情况下都必然失败**（输出里的 `NaN` 就是信号）。
    - **永远绿**：第3次布局写的 `check('装备条背景是完全不透明的(不是半透明rgba)')`，用正则 `/rgba\(...,\s*0?\.\d+\)/` 排除半透明。第5次微调移除白底后，装备条背景变成**完全透明**（computed `rgba(0,0,0,0)`），而该正则要求 alpha 是**小数**（如 `.42`），**整数的 `0` 匹配不上** → 断言**了一个已经为假的命题，却继续静静返回"通过"**。

    **两条要求**：
    - **写完断言，先确认它真的会红**：修复前必须先看到它红、修复后再看到它绿（或临时把实现改坏一下，确认它会红）。一条从没红过的断言，等于没被验证过。
    - **设计变更后，必须回头检查旧断言的语义是否还成立。** 断言**不会**因为实现改了就自动失效或报错——它只会继续静静返回"通过"，而它验证的那个命题可能早就不存在了。**"全绿"本身不构成证据**，要问的是"这条断言现在还在验证什么、那个命题还成立吗"。

21. **代理指标不是目标，真正在乎的那个量才是目标——两者冲突时，该修的是代理指标，而不是去迎合它。** 真实案例：第5次微调时，CSS 注释里按**估算**写了一条几何指标（"4行装备约占卡底37%，渐变的高强度区正好罩住"），实测发现是错的——装备条顶实际到 **43.7%**，最上面那一行落在渐变的过渡带里、不在最强区。**本能反应是"把渐变加深，让数字对上"**，但真正在乎的量（实测对比度）在那一行本来就有 **7.11**，远高于 WCAG AA 的 4.5；加深渐变只会把立绘下半部压得更黑、损害观感，去解决一个**并不存在的问题**。**正确做法是修那条估算错的注释、并把测试里那条代理断言换成真实的不变量**，而不是改本来正确的实现。**写下任何中间指标/阈值时，都要清楚它只是通往目标的代理；当实测数据和代理指标打架，先怀疑代理指标。**

22. **"验证样本要挑最刁钻的"这条规则不只适用于挑选具体的样本值，也适用于挑选被忽略的整个维度——漏掉一整个维度比漏掉一个刁钻样本更隐蔽，因为所有样本在那个维度上都"恰好"没暴露问题，看起来像是全面验证过了。** 真实案例：手机横屏骨架级重建那几轮，座位卡/中央出牌区/信息条的响应式验证做了很多轮、覆盖了 2~7 人局 × 多档视口**宽度**，但全部验证（包括桌面的 1024×768、之前"骨架级重建"引用的 iPhone SE 横屏 667×375）用的都是桌面浏览器默认视口或只压窄宽度、从没压过高度——**全项目搜索确认没有任何一条 `@media (max-height:...)` 规则，所有断点清一色只按视口宽度分档**。直到用户拿真机(iPhone 16 横屏)实测反馈"一屏完全装不下"，用 Playwright 在真实的"宽而矮"横屏视口（如 844×390，高度只有 390px）里测才发现：全页面纵向内容总量约 1163px，是视口高度的近 3 倍；即使把最大的单项开销（座位卡 aspect-ratio 由宽度反推高度）算进去，**剔除座位卡后剩余的固定开销（标题栏/中央出牌区/信息条/手牌标签/手牌卡片/页脚提示）仍有 700~750px，本身就已经是视口高度的近 2 倍**——这不是"某个刁钻样本没测到"，是"高度"这整个维度从一开始就没有被当作约束条件对待,所有验证样本在高度这一维度上统一都是"宽视口、高度天然富裕",桌面 1024×768 和手机横屏 667×375 在高度这件事上给出的是同一个"从不吃紧"的假象。**以后新增响应式验证时，除了在已知维度里挑刁钻值，还要反问一句"这次验证覆盖的是不是只有一个维度、另一个维度有没有被无意识地固定在宽松值上"**——尤其是横屏/竖屏切换、可折叠设备这类"宽高比会剧烈变化"的场景，宽度和高度必须分别拉到各自的下限单独测，不能假设"宽度测过了、高度大概率也没事"。

23. **"轮流问下去、问完收工"的循环型响应函数，必须在每一个"问完了、不再继续问"的结束分支里显式把 `g.pending` 置为 `null`，不能依赖下游代码"进来时pending应该已经是null"这个假设——这条假设不会自动成立，忘了置空就会留下一个过期的孤儿对象，一路带进后续完全不相关的回合/阶段。** 这是一次真实的、影响面不小的 bug：`advanceXiaoguo`（乐进【骁果】,问完一圈没人发动）和 `respondLuoshen`/`finishLuoshenJudge`（甄姬【洛神】,不发动/判红结束）这两处，问完之后直接调用 `finishTurn`/`enterDrawPhase` 交出控制权，却没有先把 `g.pending` 置空——下游代码（`finishTurn`/`startTurn`/`enterDrawPhase` 这类"即将进入正常阶段"的函数）默认"进来时pending已经是null"，一旦这个假设被违反，这个已经问完、毫无意义的 pending 对象会原样漏进下一个玩家的整个回合，直到某个完全不相关的动作自己的收尾逻辑碰巧把它置空为止。**这不是"信号设计得不够精细"**——`pruneExchangeCards` 的 `!g.pending && !g.aoe` 判断本身完全够用、反应也很及时（已用真实场景验证：骁果询问**刚被创建**的那次 tx 里，prune 用"询问出现之前"的快照就正确清空过中央出牌区的旧牌），问题纯粹是这个字段没有被正确置空——不要为这类问题引入 chainId/chainSeq 这种"区分是不是同一条链"的机制，那是在解决一个不存在的问题（当前代码库里从未出现过"两个 pending 同时存在、分不清谁是谁"的真实场景，通读过的20多个 `respond*`/`finish*` 函数里，除了这两处，其余全部正确遵守"链结束前显式置空"这条约定）。**修复要收敛到"这条链唯一的、真正决定结束的那个共用出口"**，不要在每个调用点分别打补丁——`advanceXiaoguo` 自己的 `asker===null` 分支补一行 `g.pending=null;` 就能同时覆盖 `endTurn()`/`respondXiaoguo(false)`/`respondXiaoguoChoice` 三条进入路径；洛神的三个结束分支（`respondLuoshen` 的"不发动"/"牌堆无牌可判"、`finishLuoshenJudge` 的判红）全部收敛到它们共同调用的 `enterDrawPhase(g)` 入口处补一行，不在三处分别处理。**这条约定不是新发明的机制，是把"链结束必须显式置空pending"这个项目里本来就在遵守（`resolveTrick`/`aoeAdvance`/`openWuxieRound`/`wuguPick`/`advanceTieSuoQueue`/`advanceFangtianQueue`/`respondGuicai`/`respondLiRangRecover` 等全部正确遵守）的既有纪律，重新钉成一条显式规则**——以后新增任何"轮流问下一个候选人，问完就该收工"的技能（下一个可能是骁果/洛神的同类模式），在写"问完了，不再继续问"这个分支时，第一反应就该是"这里需不需要显式 `g.pending=null`"，不要等到又一次"中央出牌区卡住不消失"才想起来查。
24. **全项目没有全局 `g`——任何函数体里出现裸 `g.` 或 `window.g` 都是必崩的 bug，不是"防御性写法"。渲染期需要读当前对局状态，一律用 `currentG`（`render.js` 每次 `render()` 更新的那份快照）；能从调用点拿到 `g` 的，优先把 `g` 作为参数传进来。** 只有两种地方可以出现裸 `g`：①函数签名里就有 `g` 参数；②`tx(g=>{...})` 回调内部（`g` 是回调参数）。**这条已经出现过三次，每次都是同一个误解**：以为 `if(g && g.xxx)` 是安全短路——**不是**。`g` 未声明时，求值 `g` 本身就先抛 `ReferenceError`，根本走不到 `&&`；`typeof g!=='undefined'` 才是安全写法。三次分别是：曹冲称象 `toggleChengxiangCard`/`confirmChengxiangSelection`（修成 `currentG`）、法正眩惑 `startHuanhuo` 一族（读 `window.g`/`window.mySeat`，全项目从未赋过值，修成 `tx(g=>{...})`+顶层 `mySeat`）、陈宫明策 `checkMingceCard`（修成 `currentG`）。**排查提示**：这类 bug 的症状是"某个武将一上场，界面就缺一半控件/点了没反应"，而**普通本地测试未必测得出来**——它只在那个武将真的在场、且代码路径真的走到那一行时才触发，所以要按武将逐个覆盖，不能只测常用武将。修陈宫那次已用脚本全项目扫过一遍（顶层函数、无 `g` 参数、未绑定 `g` 闭包，且排除注释/字符串），确认**当前没有第四处**；以后新写渲染层函数时按这条自查，不要等第四次。
25. **`normalize` 里给某个 pending 写校验时，先问一句"这个字段在这条链的**每一个**阶段都必然有值吗"——"还没选/还没填"是合法的中间态，不是脏数据。把中间态判成脏数据，等于让这条链永远走不过那一步。** 这条已经踩过两次，且第二次比第一次严重得多：①贾诩【乱武】把 `remainingSeats.length===0`（= 队列已排到最后一人）当脏数据，导致链条推进到最后一人就被清空；②陈宫【明策】更彻底——`mingcePickCard` 要求 `cardToGive` 非空（可那个阶段的语义就是"**还没选牌**"）、`mingcePickTarget` 要求 `targetSeat` 是 number（可那个阶段就是"**还没选目标**"，恒为 `null`），于是**每次 tx 开头的 `normalize` 都把刚建立的 pending 清掉，技能从上线起 100% 不可用**，而且限一次的标志位已经被消耗、连"取消"都因为守卫查不到 pending 而失效。**判据**：`normalize` 只该拦"结构上不可能是真的"（座位号不是数字、指向不存在/已阵亡的玩家、该是数组的不是数组），**不该拦"这一步还没发生的事"**。**症状识别**：技能点了没反应、或走到某一步就退回 `play`，而服务端函数本身逻辑看着没问题——先去 `normalize` 里看这个 pending 类型的校验，用"单独跑一次 `normalize`，看 pending 还在不在"这一招就能立刻定位（比读代码推理快得多）。**多阶段链条的每个阶段字段集合往往不同，用同一套严格校验套所有阶段必然出错**——要按阶段分别写。
26. **机器人的决策分支必须"先探测服务端到底允不允许，再决定答什么"，不能只看"牌够不够"就盲答——机器人是无状态重算的，被服务端原地拒绝一次就会永久死循环。** 真实案例：`jiedaoChoice`/`duel`/`aoeResp` 三处答"要不要出杀"时只查 `findUsableAs(手牌,'杀')>=0`，不知道曹彰【将驰】的 `jiangchiNoSlash`；服务端一上来就 `if(jiangchiNoSlash) return g` 原地拒绝、状态一字不变，机器人下次醒来重算又得出同样结论 → **卡死**（真人遇到同样情况还能改点别的选项逃出来，机器人不会改主意，所以同一个缺陷对真人只是"卡一下"、对机器人是"永久卡死"）。**正确范式看 `bot.js` 的 `pick` 分支**：它先看目标实际有没有手牌、再退而求其次找装备槽/判定区，**先探测实际可选项、再决定答什么**。**新增任何"要不要打出/使用某张牌"的决策分支时，都要把对应服务端响应函数从头读一遍，把它所有会 `return g` 的前置条件列出来**（不只是"牌够不够"，还有各种技能标志、次数限制、距离/目标限制），逐条在机器人这边也判一次；判断收敛成一个共用小函数（如 `canBotPlaySha`）比在三处各写一遍更不容易漏。**排查提示**：机器人卡住且 `botSeatForState` 返回的座位是对的、`runBotDecision` 也有分支时，就该怀疑这一类——连续驱动机器人 2~3 次，若 `phase`/`pending`/日志长度完全不变，基本可以确定是"机器人答了一个服务端不接受的选项"。
27. **新增"本回合限定"的标志位时，务必核对清除时机——清早了技能当场失效，清晚了影响面会被悄悄放大好几倍，而且后者很难在自测里发现。** 真实案例：曹彰【将驰】的 `jiangchiNoSlash` 原来只在 `startTurn` 里对 `currentPlayer` 清除，等于要等**这名角色自己的下一个回合开始**才失效，实测跨越了中间所有人的回合——把官方"本回合不能使用或打出杀"放大成了"接下来一整圈"。**判据**：`startTurn` 里有两类重置，写错地方后果完全不同——①`g.xxx` 全局标志和 `g.players.forEach(...)` 的**全员**重置，语义是"上一个回合结束了"，本回合限定的**玩家标志应该放这里**（下一个人的 `startTurn` 一跑就清掉，正好等价于"本回合结束时失效"，而该角色自己的结束阶段仍在其回合内、标志还在，也是对的）；②`currentPlayer.xxx` 专属块，语义是"**这名角色**新回合开始时重置他自己的东西"，只适合 `fenxunUsed`/`jujianUsed` 这种"每逢我的回合重置一次"的限次标志。**放错类别不会报错、不会崩，只会让标志多活好几个回合**，所以要专门写一条"轮到下一个人后即失效"的断言去钉住，不能只测"本回合内有效"。
28. **复杂武将开发方法论（左慈【化身/新生】开发过程沉淀）**：左慈是项目里第一个"技能内容运行时动态借用"的武将，开发过程里几次真实的返工/纠偏都指向同一类问题——不是代码写错，是**设计假设没有先核实就动手**。沉淀成三条通用要求：
    - **涉及具体规则数值/触发方式的设计假设，必须先用官方卡面/资料核实，不能凭记忆转述**。本次真实案例：最初以为"按点数循环触发N次独立询问"这条规则该抄郭嘉【遗计】，先 grep 了 `GENERALS.guojia.hooks.onDamaged` 的完整实现才发现遗计根本不循环（`ctx.amount` 不管多大只问一次）——真正做这件事的是荀彧【节命】的 `remaining` 计数循环。如果没有先 grep、直接凭"记忆里遗计好像是这样"去写，新生的循环逻辑一开始就会抄错先例。
    - **"看起来能复用"的判断，必须先 grep 完整实现再下结论，不能只凭函数名/表面相似就假设**。本次真实案例：设计"更改化身"时最初设想能直接复用 `respondHuashenPick`，但读完它的完整实现才发现——守卫写死了 `g.phase==='huashenPick'`，收尾会调 `checkHuashenBeforeAssign`→可能级联 `finishGeneralAssign`（整局重新初始化），这两点都和"回合中途重新声明"这个场景不兼容，必须写独立的新函数。这类"表面像、细节不像"的复用陷阱，只有读完整个函数体（不是读函数签名/名字）才能发现。
    - **涉及多个 pending/hook 可能共存的场景，动手写代码前先做纸面推演，找状态覆盖风险**。本次真实案例：设计"更改化身"时先在纸上推演了"左慈借用了貂蝉【闭月】，回合结束时会发生什么"——如果 `finishTurn` 还是原来的 `if(hasCap(p,'biyue')){...}else{startTurn(nextAlive)}`，更改化身和闭月这两个独立的回合结束可选技能会互相覆盖（只能问到其中一个），这个推演直接决定了"`finishTurn` 必须从 if/else 重构成链条"这个架构决定，是在写代码之前想清楚的，不是写完之后测出来再回头改的。同一类推演也用在验证"新生会不会被 v1 那套 borrowed-hook-优先 排队机制污染"上——特意写了"借用武圣（没有 onDamaged hook 的纯被动技能）"这个对照测试，用真实断言证明新生不受影响，而不是口头说"这次没有那个问题"就了事。

## 四、已知的待优化点（不是 bug，心里有数）

- **响应阶段超时覆盖持续由自动测试对账**：询问型 pending 统一使用 30 秒超时托管；新增 pending 时必须同步登记响应者和合法保守动作，避免覆盖回退。
- **手牌非真隐藏**：手牌存在共享状态、数据库读权限全开，会看控制台的人能看到所有人的牌。当前是朋友局，接受此边界。
- **数据库写权限全开**：任何知道房间号的人能改/删数据。朋友局接受。
- **代码已是多文件结构，但 `game.js`/`render.js` 各自仍是很大的单文件**（`game.js` 约 3700+ 行，`render.js` 约 3000 行，`data.js` 约 450 行）：再加大型系统（如身份场）时，可考虑按域进一步拆分（比如把武将技能/装备特效从 `game.js` 里拆出来）。
- **铁索连环队列推进时中央出牌区不显示牌面**：`advanceTieSuoQueue` 拿不到牌对象（原始那张梅花实体牌在更早的 `lianHuan`/`recastLianHuan` 里已经处理完，跨函数没有传递），`markCardSound(g,'铁索连环',q.from,null,to)` 第4个参数只能传 `null`。要修需要把牌对象存进 `g.tiesuoQueue` 状态跨函数传递（还要确认所有调用 `startTieSuoTargets` 的入口是否都要改传牌），是设计层面的改动，暂缓——不要当成新 bug 重新排查一遍，已知且刻意不修。
- **`run_startgame_wiring_test.js` 场景4存在一个低概率随机性导致的 flaky 失败**：`startGame('pick')` 按 `shuffled` 随机切片把候选武将分给各玩家（每人3个、互不重叠），但这条切片规则只保证"正常走 `respondPickGeneral` 选择"时不会重复；场景4改用 `debugPickGeneral('zuoci')` **绕开候选池限制**强制座位0变成左慈，如果这次随机切片恰好把 `'zuoci'` 分进了另一个座位的候选池、且那个座位又调 `debugPickGeneral(generalChoices[0])` 选到了它，就会出现"两个座位都是左慈、都要走 huashenPick"的边界——测试断言"declare完就该 `g.started===true`"这时会失败，因为还有另一个左慈没声明完。开发左慈【新生】那次任务里连续跑 8 次复现过一次、随后 8/8 通过，确认是已存在的、和左慈开发本身无关的测试脚本随机性问题（`room-lifecycle.js` 的候选切片逻辑本身没有改过），不是本次改动引入的回归。要根治得让测试构造时显式排除这个碰撞（比如 debug 强制指定的武将也要从候选池里摘掉），暂不处理，遇到时重跑一次即可。
- **受伤后多个技能的连续调度已统一处理**：恩怨、武将 hooks、新生、酒诗、称象、悲歌等效果通过 `afterDamageEffects` 队列按序续接；历史上的“新生阻塞后续技能”与“恩怨阻挡新生”记录均已失效。修改受伤后技能时应继续复用该队列，并运行相应连续调度测试。
- **【历史记录，已被整体替换】马谡【散谣】`respondSanyao`/`respondSanyaoTarget` 曾经补过身份守卫，这两个函数连同它们所在的两阶段服务端 pending 架构（`sanyao`/`sanyaoChooseTarget`）已在"服务端核心逻辑"那次任务里整体作废删除**，改成新的原子函数 `sanyao(costKey, targetSeat)`（见 `docs/progress-log-*.md`）。**这不代表当初补身份守卫那次修复是白做的**：那次的目标本来就是"死代码也要有正确的卫生习惯，不该在一段代码还活着的任何时刻缺少调用者身份校验"，不是承诺"这段具体代码会被长期保留"——事后设计重构决定放弃两阶段 pending 架构（改用巧变已经确立的"单人无需响应、客户端本地累积选择、一次性原子提交"模式），是架构层面的独立判断，和当初那次身份守卫修复的正确性无关。


## 五、可能的下一步（待定）

- ~~响应超时/托管~~（**已实现**：询问型 pending 30s 超时自动保守提交+画面倒数，见 progress-log-8）
- ~~主公技（激将/护驾/制霸/妄尊）~~（**已实现**：仅 `role==='zhu'` 可发动，见 progress-log-8）
- 装备系统后续，可解锁更多武将和锦囊。
- 身份 DB 真隐藏（Firebase 读权限）；当前与手牌同为朋友局界面隐藏、库可读。
- 更多武将。

---
*维护规则：完成任务后新增改动记录，一律写进 `docs/progress-log-N.md`（见文件开头的防复发规则），不允许写进本文件本体——这和「三、改动原则」第 11 条规定的任务收尾硬性步骤同等优先级，和 git commit 一个存档点同等重要，只是记录的落脚点不再是本文件。
