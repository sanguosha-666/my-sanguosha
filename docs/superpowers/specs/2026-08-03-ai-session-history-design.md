# AI 会话历史（同 Request 维持）设计

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认设计；待审阅

**前置**：AI 可操作面决策总线全部交付（B+C、L1 泛化批次待做）。本设计给 AI 机器人加**会话记忆**——每次决策请求带上本局此前的 user/assistant 历史消息，让模型"记得曾经发生过的事"（自己之前的决策、计划与意图）。

---

## 1. 背景与目标

### 现状

`callAI` 每次决策都是**全新单条消息**（claude: `messages:[{role:'user',content:userPrompt}]`；openrouter/groq: `system + user` 两条）。AI 不记得上一轮决策说过什么、为什么选。`recentLog`（公开事件日志 20 条）只能传达"场上发生了什么"，传达不了"AI 自己怎么想的、怎么做的"。

### 目标

> 每次 AI 决策请求 = **system（当前决策指令）+ 历史消息（本局此前该座位的所有 user/assistant 对话）+ 当前局面**。AI 因此记得：自己上回合的决策与理由、留牌意图、场上博弈经过——像人类玩家一样有"我记得"。

### 非目标

- 不做跨局记忆（`g.phase==='over'` 清空，新局重新开始，像人类新局一样）。
- 不做历史摘要压缩（滑动窗口裁剪即可；若实测 token 仍过大，后续再加摘要层，不在本批）。
- 不改 `aiConversations`（它从未被写入，不是决策依赖；本设计用独立的 `aiSessionHistory`，不动那个空壳）。
- 不做多轮 ReAct（历史是"上下文的记忆"，不是"让模型多轮思考再行动"）。

---

## 2. 核心机制

### 2.1 数据结构（bot.js 模块级）

```js
// ============ AI 会话历史:维持同一个 Request 让 AI 记得曾经发生过的事 ============
// 【本机制是什么】callAI 每次调用都带上本局此前的 user/assistant 历史消息,让模型
// 记得自己之前的决策与意图(像人类玩家的"我记得")。历史只存该座位自己视角的内容
// (buildBotVisibleState 输出),回放给同一座位安全,不涉及他人隐藏信息。
// 【滑动窗口】每局几十上百次调用,全量历史 token 会爆炸——只保留最近
// AI_HISTORY_MAX_ROUNDS 轮(user+assistant 一对算一轮),超了 shift 掉最早的。
// 【生命周期】绑定座位 aiHistorySeat:座位变化(重连/换机器人)自动清空;游戏结束
// (phase==='over')清空,新局重新开始。
// 【失败不污染】只 push 成功的 assistant 回复;超时/解析失败不写入历史。
let aiSessionHistory = [];
let aiHistorySeat = null;
const AI_HISTORY_MAX_ROUNDS = 12;

function aiHistoryPush(role, content){
  if(typeof content !== 'string' || !content) return;
  aiSessionHistory.push({ role: role, content: content });
  // 裁剪:超过窗口时移除最早的轮次(一次 shift 一条,循环到窗口内)
  while(aiSessionHistory.length > AI_HISTORY_MAX_ROUNDS * 2) aiSessionHistory.shift();
}
function aiHistoryReset(){ aiSessionHistory = []; aiHistorySeat = null; }
```

### 2.2 写入点（callAiChooseIndex 与 tryAiBotPlay/tryAiBotBestTarget）

**唯一入口 `callAiChooseIndex`**（bot.js）——所有 AI 决策都走它（出牌/选目标/响应/L1/多步），在此统一维护历史：

```js
async function callAiChooseIndex(opts){
  const candidates = opts.candidates || [];
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return null;
  if(candidates.length<=1) return candidates.length===1 ? 0 : null;
  const g = opts.g, seat = opts.seat;
  // 【会话历史】座位变化即清空(重连/换机器人);同座位累积
  if(aiHistorySeat !== seat) aiHistoryReset();
  aiHistorySeat = seat;
  const userPrompt = opts.userPrompt;
  aiHistoryPush('user', userPrompt);
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: opts.systemPrompt || buildBotDefaultSystemPrompt(),
      userPrompt: userPrompt,
      history: aiSessionHistory.slice(0, aiSessionHistory.length - 1), // 当前这条 user 已 push,历史=去掉最新一条
      maxTokens: opts.maxTokens || 80,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return null;
  // 成功:记下 assistant 回复(失败不写,不污染历史)
  aiHistoryPush('assistant', result.text);
  const idx = parseBotPlayAiChoice(result.text);
  if(idx===null || idx<0 || idx>=candidates.length) return null;
  return idx;
}
```

**注意**：历史传给 adapter 时**去掉最新一条 user**（它已经在 `userPrompt` 参数里单独传了，避免重复）。即 `history = aiSessionHistory.slice(0, -1)`。

**游戏结束清空**：`scheduleBotTurn`（bot.js ~149，已有 `g.phase==='over'` 早退）里加一行：

```js
if(!g || !isBotController(g)) return;
if(g.phase==='over'){ aiHistoryReset(); return; }
```

### 2.3 adapter 改造（ai-bot.js，三家）

**claude**：

```js
buildRequest(apiKey, opts){
  const messages = (opts.history || []).map(function(h){
    return { role: h.role, content: h.content };
  });
  messages.push({ role:'user', content: opts.userPrompt });
  const body = {
    model: opts.model || 'claude-haiku-4-5-20251001',
    max_tokens: opts.maxTokens || 512,
    messages: messages,
  };
  if(opts.systemPrompt) body.system = opts.systemPrompt;
  // ...headers 不变
}
```

**openrouter / groq**（结构相同，仅 endpoint/model 不同）：

```js
buildRequest(apiKey, opts){
  const messages = [];
  if(opts.systemPrompt) messages.push({ role:'system', content: opts.systemPrompt });
  (opts.history || []).forEach(function(h){
    messages.push({ role: h.role, content: h.content });
  });
  messages.push({ role:'user', content: opts.userPrompt });
  // ...body/headers 不变
}
```

**兼容性**：`opts.history` 缺省时 `(opts.history||[])` 为空 → 行为与改动前逐字一致（单条消息）。所有既有测试不受影响（不传 history）。

### 2.4 隐藏信息安全论证

- 历史内容 = 每次 `buildBotVisibleState` 的输出（该座位视角）+ AI 回复文本。
- `buildBotVisibleState` 从不包含他人隐藏身份/手牌内容（结构保证，已有测试）。
- 历史回放给**同一座位**（`aiHistorySeat` 校验）——是它自己曾经真实看到过的信息，无新增泄露。
- 座位变化即清空（重连/换机器人后旧历史不跟到新座位）。

---

## 3. 测试矩阵（新增 run_ai_session_history_test.js 或扩展 core）

| 用例 | 断言 |
|------|------|
| 第 1 次调用 | `callAI` mock 收到 `history: undefined`（或空数组）——首次无历史 |
| 第 2 次调用（同座位） | mock 收到的 `history` 包含第 1 次的 user 消息与 assistant 回复 |
| 成功才写入 | mock 返回 `{ok:false}` → 历史不增加 assistant 条目 |
| 滑动窗口 | 模拟 15 轮调用 → 历史长度 ≤ 24 条（12 轮×2），最早的被 shift 掉 |
| 座位变化 | seat 1 调用后切 seat 2 → 历史清空，第 2 座位首次调用无历史 |
| 游戏结束 | `scheduleBotTurn` 收到 `phase==='over'` → 历史清空 |
| 三家 adapter | buildRequest 各自把 history 展开进 messages（claude 在 system 之后；openrouter/groq 在 system 之后、user 之前）；不传 history 时与旧结构逐字一致 |
| userPrompt 不重复 | 传给 adapter 的 messages 中 user 消息恰好一条（历史去掉了最新一条） |
| 回归 | 全部既有 AI-bus 套件 + 仓库套件 + `node --check` |

---

## 4. 明确不做

- 跨局记忆（over 清空）。
- 历史摘要/压缩（滑动窗口已够；token 实测超限再议）。
- 动 `aiConversations` 空壳。
- 多轮 ReAct（历史≠让模型多轮思考）。

---

## 5. 验收标准

1. 同座位连续多次 AI 决策：第 N 次请求的 messages 包含前 N-1 次的 user/assistant（mock 断言）。
2. 失败/超时轮不写入历史（历史不被垃圾污染）。
3. 座位变化/游戏结束自动清空。
4. 三家 adapter 兼容（不传 history 行为不变；回归全绿）。
5. `?v=` 同步 +1；progress-log-8.md 追加（最新分段）。

---

## 6. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 与"候选+index"铁律/隐藏信息红线一致（历史=该座位视角）
- [x] 滑动窗口防 token 膨胀；失败不污染
- [x] 生命周期（座位绑定 + over 清空）明确
- [x] adapter 兼容性（history 可选参数，缺省零变化）
- [x] 用户已确认设计（"先把这个设计加上"）
