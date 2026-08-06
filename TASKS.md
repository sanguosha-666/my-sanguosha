# TASKS.md — 三国杀项目进度

## 阶段总览（批量计划：docs/superpowers/plans/2026-08-03-big-batch.md）

- [x] 批1：D2 bot-ai-bus.js 拆分 + D3 AI_DEFAULT_MODEL 单源
- [x] 批2：A1 响应超时托管 + A2 断线重连验证
- [-] 批3：B2 主公技（四主公技拆两步：B2a 激将/护驾 ✅；制霸/妄尊 待做）
- [ ] 批4：D4 响应阶段 UI 回归 + D1 真机验证

## Phase 3/4 — B2 主公技

- [x] B2a：刘备【激将】+ 曹操【护驾】——身份局主公需出杀/闪时求助其他角色替出，无人替回原 pending。caps 声明 + role 守卫，机器人 BOT_PHASE_ACTOR/BOT_DECISIONS/EXCLUDE/超时保守表全接入，28 项测试全绿，`?v=303`，已 push（wenwen_dev）
- [x] B2b：孙策【制霸】（出牌阶段限一次拼点）+ 袁术【妄尊】（主公准备阶段摸牌/主公手牌上限-1）——hasCap+role 守卫、`handCapLimit` 统一弃牌上限、机器人 BOT_PHASE_ACTOR/BOT_DECISIONS/EXCLUDE/BOT_SEAT_PICKS/超时保守表全接入，45 项测试全绿，`?v=304`，已 push（wenwen_dev）

## Phase 4/4 — 提示词增强 P1（G1 通用策略 + G3 score 语义）

- [ ] P1：`buildBotDefaultSystemPrompt` 追加通用策略（体力/手牌价值、防御牌留关键、不裸拼）、`buildBotDefaultUserPrompt` 条件拼接 score 语义说明——core 测试 +3 项（10 全绿），`?v=305`

## 下一步（待定）

- [ ] 批4：D4 响应阶段 UI 回归 + D1 真机多浏览器联机验证（含主公技）
