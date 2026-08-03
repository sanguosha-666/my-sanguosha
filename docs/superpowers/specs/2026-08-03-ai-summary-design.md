# AI 自维护回合摘要设计（AI 自己写记忆）

**日期**：2026-08-03
**分支**：`wenwen_dev`（不进 `main` 直至验收）
**状态**：用户已确认方案；待审阅

**前置**：AI 可操作面决策总线全部交付（B+C、L1 泛化批次待做）。本设计给 AI 机器人加**跨回合记忆**——让 AI **自己维护一份回合摘要**（迭代更新），每次决策注入，让模型"记得曾经发生过的事"。

**版本说明**：本文件取代 `2026-08-03-ai-session-history-design.md`（全量会话历史方案）——用户确认改为 AI 自维护摘要：token 成本低一个数量级、无"旧快照误导当前"风险、更接近人类记忆。

---

## 1. 背景与目标

### 现状

`callAI` 每次决策都是全新单条消息，AI 不记得上一轮决策。`recentLog`（最近 20 条公开日志）只能传达"场上发生了什么"，传达不了"AI 自己怎么想的、怎么做的"。

### 目标

> AI **自己维护**一份本局摘要（迭代式：旧摘要 + 本回合新事件 → 新摘要），每次决策把摘要注入请求。AI 因此记得：自己上回合的决策与理由、留牌意图、场上博弈经过——像人类玩家一样有"我记得"。

### 非目标

- 不做全量消息历史（已被本方案取代；若实测摘要不够，再叠加"最近 2-3 轮细粒度历史"窗口，不在本批）。
- 不做跨局记忆（over 清空，新局重新开始）。
- 不动 `aiConversations` 空壳。
- 不做多轮 ReAct（摘要是"记忆的载体"，不是"让模型多轮思考再行动"）。

---

## 2. 核心机制

### 2.1 数据结构（bot.js 模块级）

```js
// ============ AI 自维护回合摘要:AI 自己写记忆 ============
// 【本机制是什么】每回合变化时做一次"总结调用"(非决策,自由文本),迭代更新一份
// 摘要(旧摘要 + 本回合新事件 → 新摘要),每次决策注入——AI 记得自己之前的决策
// 与意图,像人类玩家的"我记得"。摘要只存该座位自己视角的内容。
// 【生命周期】绑定 aiSummarySeat:座位变化(重连/换机器人)清空;游戏结束(over)清空。
// 【失败处理】总结调用失败沿用旧摘要(不更新、不影响游戏);决策失败不涉及摘要。
let aiSummary = '';
let aiSummarySeat = null;
let aiSummaryRound = 0;   // 上次总结时的回合号,用于检测"新回合"避免重复总结
let aiSummaryTurn = -1;   // 上次总结时的座位号,同上

function aiSummaryReset(){ aiSummary = ''; aiSummarySeat = null; aiSummaryRound = 0; aiSummaryTurn = -1; }
```

### 2.2 触发时机（scheduleBotTurn 醒来时检测回合变化）

```js
// scheduleBotTurn 内、isBotController 校验后、phase==='over' 早退前:
if(g.phase==='over'){ aiSummaryReset(); return; }
// 【摘要更新】座位变化即清空;回合变化(roundNum 或 turn 不同)且座位匹配时,
// 先更新摘要再做本回合决策。首回合(无摘要)不触发——第一次决策前没内容可总结。
if(aiSummarySeat !== seat) aiSummaryReset();
aiSummarySeat = seat;
if(aiSummary && (aiSummaryRound !== g.roundNum || aiSummaryTurn !== g.turn)){
  aiSummaryRound = g.roundNum; aiSummaryTurn = g.turn;
  updateAiSummary(g, seat);   // 异步,不阻塞(见 2.4)
}
```

**注意**：`updateAiSummary` 是 fire-and-forget（异步发起，不 await）——机器人醒来先更新摘要，本轮决策正常走；摘要更新完成后的下一轮决策才带上新摘要。避免"等摘要 → 延迟决策"。

### 2.3 总结调用（ai-bot.js 新增 `callAiSummary` 或复用 callAI）

**总结调用不是决策**——不需要 `{"choice":N}` 协议，直接用 `callAI` 拿 `result.text`（它本来就返回纯文本；解析层是决策侧的事，总结侧不解析）。

```js
// ai-bot.js 或 bot.js 新增:
function buildSummaryPrompt(g, seat){
  return '你是网页版三国杀的AI机器人。请把"本局摘要"更新为最近状态的版本:'
    +'结合旧的摘要(如有)与最近发生的公开事件,重写一份不超过200字的摘要,'
    +'只记对后续决策有用的事实:谁对谁造成了伤害、谁救过谁、谁翻开了身份、'
    +'你自己的出牌意图与留牌计划、你观察到的嫌疑。只写发生过的事,不要写推测。'
    +'直接输出摘要文本,不要输出JSON、不要解释。';
}
async function updateAiSummary(g, seat){
  if(typeof aiApiKey==='undefined' || !aiApiKey || !aiProvider) return;
  const state = buildBotVisibleState(g, seat); // 含 recentLog/弃牌堆/嫌疑等公开信息
  const oldSummary = aiSummary ? ('旧摘要:\n'+aiSummary+'\n\n') : '';
  const userPrompt = oldSummary
    + '最近局面信息:\n' + JSON.stringify({ round: g.roundNum, recentLog: state.recentLog, discardPile: state.discardPile, players: state.players })
    + '\n\n请输出更新后的摘要(≤200字)。';
  showAiThinkingIndicator(g, seat);
  let result;
  try{
    result = await callAI(aiProvider, aiApiKey, {
      systemPrompt: buildSummaryPrompt(g, seat),
      userPrompt: userPrompt,
      maxTokens: 300,
      model: (typeof aiApiModel!=='undefined' && aiApiModel) || undefined,
    });
  }catch(e){
    result = { ok:false, reason:'other', detail:String(e) };
  }finally{
    hideAiThinkingIndicator();
  }
  if(!result || !result.ok) return; // 失败沿用旧摘要
  const text = (result.text || '').trim();
  if(text) aiSummary = text.slice(0, 500); // 防单次超长,硬上限500字
}
```

**不新增 adapter 结构**：`callAI` 的 `opts.userPrompt`/`opts.systemPrompt` 语义不变，总结调用只是另一种内容的 user prompt——**三家 adapter 零改动**（无需 history 参数，全量历史方案的那个改动不需要了）。

### 2.4 注入（callAiChooseIndex 唯一入口）

```js
async function callAiChooseIndex(opts){
  // ...既有守卫/候选检查不变
  // 【摘要注入】本局 AI 自维护摘要追加进 system prompt(决策时能看到"我记得")
  const summaryNote = aiSummary && aiSummarySeat===opts.seat
    ? '\n\n本局记忆摘要(你自己维护的,参考即可):\n'+aiSummary
    : '';
  result = await callAI(aiProvider, aiApiKey, {
    systemPrompt: (opts.systemPrompt || buildBotDefaultSystemPrompt()) + summaryNote,
    userPrompt: opts.userPrompt,
    // ...其余不变
  });
}
```

### 2.5 隐藏信息安全论证

- 摘要输入 = `buildBotVisibleState`（该座位视角，结构保证无他人隐藏信息）+ 旧摘要（同源）。
- 摘要由 AI 基于该座位视角生成，回放给**同一座位**（`aiSummarySeat` 校验）——无新增泄露。
- 座位变化/over 清空，不跨座位、不跨局。

---

## 3. 测试矩阵（新增 run_ai_summary_test.js）

| 用例 | 断言 |
|------|------|
| 首回合无摘要 | `aiSummary===''`；`callAiChooseIndex` 的 systemPrompt 不含"本局记忆摘要"段 |
| 回合变化触发总结 | `scheduleBotTurn`（或直接调 `updateAiSummary`）→ mock `callAI` 被调、收到总结 prompt；成功后 `aiSummary` 非空 |
| 总结注入 | 摘要非空后 `callAiChooseIndex` → mock 收到的 systemPrompt 含摘要文本 |
| 失败沿用旧摘要 | mock 返回 `{ok:false}` → `aiSummary` 不变 |
| 迭代更新 | 两次 `updateAiSummary`（不同回合）→ 第二次 prompt 含"旧摘要"（第一次的输出） |
| 座位变化清空 | seat 1 摘要后切 seat 2 → `aiSummary===''` |
| over 清空 | `scheduleBotTurn` 收到 `phase==='over'` → `aiSummary===''` |
| 不阻塞决策 | `updateAiSummary` 是异步 fire-and-forget（测试断言调用后立即返回、不 await 卡住） |
| 摘要上限 | mock 返回超长文本 → `aiSummary` 长度 ≤500 |
| 三家 adapter 零改动 | `git diff` 确认 ai-bot.js 的 PROVIDER_ADAPTERS 无 history 相关改动（结构断言） |
| 回归 | 全部既有 AI-bus 套件 + 仓库套件 + `node --check` |

---

## 4. 明确不做

- 全量消息历史（已被本方案取代；实测摘要不够再叠加小窗口历史）。
- 跨局记忆（over 清空）。
- 动 `aiConversations` 空壳。
- 多轮 ReAct。
- 摘要的 UI 展示（纯内部记忆，不进日志/不进 Firebase）。

---

## 4.5 补充：移除刷新警告 + 清除 AI 记忆按钮（用户新增需求）

### 背景

`setupRefreshWarning`（ai-bot.js:732-746）在刷新时弹"页面刷新后AI机器人的会话历史将丢失，确定要刷新吗？"的 beforeunload 警告——它检查的 `window.aiConversations` 是空壳（从未被写入），警告实际从不触发，属死代码。用户需求：**移除这个刷新警告**。

### 设计 A：移除 `setupRefreshWarning`

- 删除 `setupRefreshWarning()` 函数（ai-bot.js:732-745）及其调用（ai-bot.js:746 `setupRefreshWarning();`）。
- `window.aiConversations` 相关引用一并清除（全项目仅此处引用）。
- **效果**：刷新页面不再弹出任何 AI 记录丢失警告。

### 设计 B：清除 AI 记忆按钮（主动清除入口，替代被动警告）

**位置**：`showAiKeyModal` 弹窗按钮区（`btnRow`，ai-bot.js:484-493）——"跳过,使用本地机器人"旁新增一个 ghost 按钮：

```js
// btnRow 内,skipBtn 之前或之后:
const clearBtn = document.createElement('button');
clearBtn.className = 'ghost';
clearBtn.id = 'aiMemoryClearBtn';
clearBtn.textContent = '清除AI记忆';
clearBtn.onclick = function(){
  aiSummaryReset();          // 清空本局 AI 自维护摘要
  // 【未来扩展】若叠加了会话历史窗口(aiSessionHistory),同样在此清空
  const note = document.createElement('div');
  note.className = 'ai-key-warn';
  note.textContent = '已清除本局AI记忆。';
  clearBtn.replaceWith(note); // 就地替换成提示,不关闭弹窗
};
btnRow.appendChild(clearBtn);
```

**语义**：
- 只清**记忆**（`aiSummary` 摘要 + 未来可能的会话历史）——**密钥/模型选择/aiPromptDismissed 等配置不清**（配置与记忆是两回事）。
- 点击后弹窗不关闭（用户可能还要改密钥/模型），就地显示"已清除"提示。
- 清除后下一次 AI 决策无摘要（像失忆的人类）。
- **与移除刷新警告的关系**：被动警告删除后，主动清除按钮是唯一的管理入口——用户随时可清，不必等刷新。

**测试**：
1. `rg "setupRefreshWarning" ai-bot.js` → 无输出（函数与调用均已移除）。
2. 弹窗含 `aiMemoryClearBtn` 按钮（结构性断言）。
3. 点击 → `aiSummary===''` 且 `aiSummarySeat===null`；密钥/`aiApiModel` 不受影响。
4. 点击后弹窗不关闭（`#aiKeyModal` 仍可见）、就地提示出现。
5. 清除后 `callAiChooseIndex` 的 systemPrompt 不含摘要段。


---

## 5. 验收标准

1. 同座位跨回合：摘要随回合迭代更新（mock 断言第 2 次总结输入含第 1 次输出）。
2. 每次决策 systemPrompt 含摘要（有摘要时）。
3. 总结失败沿用旧摘要、不阻塞决策、不影响游戏。
4. 座位变化/over 自动清空。
5. `?v=` 同步 +1；progress-log-8.md 追加（最新分段）。

---

## 6. 审阅检查清单（作者自检）

- [x] 无 TBD 占位
- [x] 与"候选+index"铁律/隐藏信息红线一致（摘要=该座位视角）
- [x] 迭代式更新（旧摘要+新事件→新摘要），token 成本低
- [x] 生命周期（座位绑定 + over 清空 + 回合检测）明确
- [x] 三家 adapter 零改动（总结调用复用 callAI，无 history 参数）
- [x] 总结异步不阻塞决策
- [x] 用户已确认方案（"确认"）
