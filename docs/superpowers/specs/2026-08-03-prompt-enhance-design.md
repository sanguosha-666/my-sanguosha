# 提示词增强设计（补全 5 项引导）

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户确认"都补上先"；待审阅

**前置**：AI 决策系统全部交付。本批补全提示词**引导层**——信息层已充足（局面/技能/记忆/候选全给），但默认 system 极简、通用策略与身份引导只在出牌/选目标生效、无记牌感知。5 项全补。

---

## 1. 目标与非目标

### 1.1 目标

| ID | 目标 |
|----|------|
| G1 | **恢复通用策略到默认 system**：1血≈2牌、留无懈/防身、别裸拼 |
| G2 | **响应类接身份引导**：dying/wuxie 等按敌我判断（身份局） |
| G3 | **localHeuristicScore 语义解释**：明确"本地参考分，非最优" |
| G4 | **记牌感知**：弃牌堆关键牌统计恢复 |
| G5 | **决策点思考链 prompt**：出牌先想目标威胁/留牌再选 |

### 1.2 非目标

- 不做逐牌逐技能的深度战术（靠技能 desc + 底模）。
- 不引入第二种 AI 响应协议。
- 不改变无密钥路径（提示词只影响有密钥 AI 决策）。

---

## 2. 各项设计

### 2.1 通用策略注入默认 system（G1）

**现状**：`BOT_STRATEGY_GUIDANCE_PLAY`（bot.js:527）只在 `buildBotPlaySystemPrompt` 拼入；默认 `buildBotDefaultSystemPrompt`（bot-ai-bus.js）极简。

**设计**：默认 system 追加通用价值框架（引导性，非硬规则）：

```js
function buildBotDefaultSystemPrompt(/* g, seat, ctx */){
  return '你在扮演网页版三国杀的AI机器人。根据局面与武将技能说明，从候选列表选一个index。'
    +'只能选列表内选项。只输出 {"choice":数字}，不要解释。'
    +'决策参考(是判断优先级的参考,不是必须遵守的硬规则):1点体力大致相当于2张手牌的价值;'
    +'关键防御牌(无懈/闪/桃)要留到关键时刻,别为试探而消耗;手牌耗尽裸拼往往替别人火中取栗;'
    +'多数决策宁可保守不出,也不要打空自己。';
}
```

**注意**：默认 system 是**所有**决策点兜底（含响应类），通用策略对所有决策点生效——比只在出牌生效覆盖面更广。token 增加 ~60 字 ≈ 15-30 tokens/次，可接受。

### 2.2 响应类接身份引导（G2）

**现状**：`botIdentityGuidance(g, seat)`（bot.js:576）只在出牌/选目标 system 拼入；dying/wuxie/duel/aoeResp 等响应类注册项用自己的短 prompt，不带身份引导。

**设计**：给关键响应类注册项的 `buildSystemPrompt` 追加身份引导（`botIdentityGuidance(g, seat)` 返回的"你当前是 X 身份:..."段）。涉及：

- `dying`（救不救：忠臣救主公/反贼救不救敌方）
- `wuxie`（无懈留不留：护主/断敌）
- `duel`/`aoeResp`（出不出：保命 vs 留牌）
- `jiedaoResponse`、`xiaoguo`、`enyuanOption`、`ganglieChoice`、`guhuoQuestion`

**实现**：各响应类 `buildSystemPrompt(g, seat)` 追加 `botIdentityGuidance(g, seat)`（若身份局返回非空；ffa 返回空串不影响）。可做一个 helper `botPromptWithIdentity(base, g, seat)` 统一拼接，避免逐处复制。

**注意**：身份引导只身份局生效（`botIdentityGuidance` 已守卫 gameMode），token 增量仅在身份局响应时出现。

### 2.3 localHeuristicScore 语义解释（G3）

**现状**：`buildBotDefaultUserPrompt` 直接 `JSON.stringify(candidates)`，localHeuristicScore 裸数字无解释。

**设计**：userPrompt 顶部加一句说明：

```js
function buildBotDefaultUserPrompt(state, candidates){
  return '当前局面:\n'+JSON.stringify(state)
    +'\n\n合法候选(index从0开始):\n'+JSON.stringify(...)
    +'\n\n说明:localHeuristicScore是本地算法的参考分,只是排序参考,不代表最优解;'
    +'请结合局面与你的判断选择,不一定要选分数最高的。只返回 {"choice":数字}';
}
```

**注意**：这句话在**所有**决策的 userPrompt 出现——对出牌（有 score）有意义；对响应类（无 score）是多余。**实现时**：仅当候选含 `localHeuristicScore` 字段时追加此句（条件拼接），避免响应类也带无用说明。

### 2.4 记牌感知（G4）

**现状**：`discardPile` 在 token 优化时被删（用户确认"弃牌堆统计不要了"）；`deckLeft` 保留（只给数字）。

**设计**：**不恢复完整 discardPile**（用户已确认删除），改为轻量"关键牌已出统计"：

```js
// buildBotVisibleState 顶层增加(仅身份局?不——所有模式都有用):
playedKeyCards: (function(){
  const count = {};
  (g.discard||[]).forEach(c=>{
    if(!c || !c.name) return;
    if(['杀','闪','桃','无懈可击','诸葛连弩','仁王盾'].includes(c.name))
      count[c.name] = (count[c.name]||0)+1;
  });
  return count;
})(),
```

**注意**：只统计 6 种关键牌（杀/闪/桃/无懈/连弩/仁王盾），不恢复全量 byName（token 可控，~6 项）。这是"记牌"能力的轻量版——AI 知道关键牌已出几张。

**取舍**：用户此前确认删 discardPile 是"弃牌堆统计不要了"——本项是**关键牌子集**（非全量），token 增加 ~60 字，与"记牌感知"目标一致。若用户仍不想要可去掉。

### 2.5 决策点思考链 prompt（G5）

**现状**：出牌 `buildBotPlaySystemPrompt` 已含策略+身份；其它决策点短 prompt 无思考引导。

**设计**：给**高价值决策点**的 `buildSystemPrompt` 增加一步思考引导（每处 1-2 句，引导性）：

- `playCard` 出牌：先看目标威胁与距离，再想留牌，最后选
- `dying` 求桃：先判断濒死者敌我、值不值得救，再选
- `wuxie`：先判断这张锦囊被无懈后的影响，值不值得留无懈，再选
- `discardSubset` 弃牌：先想保留什么（关键牌），再弃低价值
- `pickSlot` 拆顺：先看目标装备/判定价值，再选拆哪个

**实现**：各注册项 `buildSystemPrompt` 追加 1-2 句；不改逻辑。

---

## 3. 测试

- 默认 system 含通用策略句（断言字符串包含"1点体力"等）
- 身份局响应类 prompt 含身份引导（dying 身份局含"你当前是"；ffa 不含）
- userPrompt 在候选含 localHeuristicScore 时含"参考分"说明；不含时无
- playedKeyCards 统计 6 种关键牌计数正确；空弃牌堆返回空对象
- 决策点 prompt 含思考引导句
- 无密钥零变化（提示词不影响本地路径）
- 回归全绿 + `node --check`

## 4. 批次

| Task | 项 |
|------|----|
| P1 | G1 通用策略 + G3 score 语义（bot-ai-bus.js 默认 prompt） |
| P2 | G4 记牌感知 + G5 思考链（bot.js 投影 + 注册项 prompt） |
| P3 | G2 响应类身份引导（bot.js 响应注册项） |
| P4 | 验收 + progress-log |

## 5. 明确不做

- 不引入第二种响应协议。
- 不改无密钥路径。
- 不做逐牌逐技能深度战术。

## 6. 审阅检查清单

- [x] 通用策略默认 system 生效
- [x] 响应类身份引导
- [x] score 语义条件说明
- [x] 关键牌记牌感知（非全量弃牌堆）
- [x] 高价值决策思考链
- [x] 无密钥零变化、token 增量可控
- [x] 用户确认"都补上先"
