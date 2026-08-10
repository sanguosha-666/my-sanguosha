# AI 调用降频（置信度门控 + 强C 同窗降频）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** 减少 AI 调用次数（Groq TPD 限额痛点）：本地启发式高置信度时直接拍板不调 AI（①门控），强C 出牌窗每步先试门控、只有本地拿不准才调 AI（②同窗降频）。

**Architecture:** 新增 `localConfidentPick(candidates)`（消费既有 `localHeuristicScore`：非结束候选 top1-top2 分差 ≥ 阈值 → 返回 top1 index，否则 null）。接入 `runBotActionWindow` 循环：`aiReady && length>1` 时先试门控，命中则不调 AI 直接本地拍板；未命中走既有 `callAiChooseIndex`。无密钥路径零变化（门控只在 aiReady 分支介入）。

**Tech Stack:** 纯浏览器 JS（全局作用域），vm 沙箱测试（node），mock AI 队列（既有 c_window 套件惯例）。

## Global Constraints

- 分支纪律：commit/push 只在 `main`，随后快进同步 `wenwen_dev`（两分支一致）。
- **无密钥回归红线**：`runBotActionWindow` 无密钥路径（不调 AI、走 `localFallbackPlayWindow`）行为逐字零变化——门控只在 `aiReady && candidates.length>1` 分支内新增。
- 门控只消费已有 `localHeuristicScore`（botCardPriority 静态牌权 + botTargetScore 目标修正，C1 回归红线），**不新增/不改本地打分逻辑**。
- 结束项（`isEndPlay`/`localHeuristicScore===null`）不参与门控比较；少于 2 个非结束候选直接 null。
- 版本号：改 `bot.js` 后 `index.html` 所有 `?v=N` 同步 +1（当前 361 → 362）。
- 测试：vm 沙箱 + mock AI 队列（`window.__mockAiResults`，c_window 既有惯例）。

---

### Task 1: 门控函数 `localConfidentPick` + 单测

**Files:**
- Modify: `bot.js`（`localFallbackPlayWindow` 附近，约 4747 行）
- Modify: `run_ai_bus_c_window_test.js`（追加门控单测到 T9 区域之后）

**Interfaces:**
- Produces: `localConfidentPick(candidates)` → `number|null`；`BOT_CONFIDENCE_GAP`（阈值常量，保守起步 20）。

- [ ] **Step 1: 写失败测试**（追加到 run_ai_bus_c_window_test.js 的 check 序列 T9 之后）

```js
  await check('门控: 分差≥阈值返回top1 index', function(){
    var r = localConfidentPick([ {label:'a',localHeuristicScore:60}, {label:'b',localHeuristicScore:30}, {label:'结束',localHeuristicScore:null,isEndPlay:true} ]);
    if(r!==0) throw new Error('应返回0,实际 '+r);
  });
  await check('门控: 分差<阈值返回null(调AI)', function(){
    var r = localConfidentPick([ {label:'a',localHeuristicScore:55}, {label:'b',localHeuristicScore:50} ]);
    if(r!==null) throw new Error('应null,实际 '+r);
  });
  await check('门控: 分差恰好=阈值视为命中', function(){
    var r = localConfidentPick([ {label:'a',localHeuristicScore:60}, {label:'b',localHeuristicScore:40} ]);
    if(r!==0) throw new Error('=阈值应命中,实际 '+r);
  });
  await check('门控: 结束项不参与比较', function(){
    var r = localConfidentPick([ {label:'a',localHeuristicScore:50}, {label:'结束',localHeuristicScore:null,isEndPlay:true}, {label:'b',localHeuristicScore:10} ]);
    if(r!==0) throw new Error('应只比非结束项返回0,实际 '+r);
  });
  await check('门控: 无分数候选返回null', function(){
    var r = localConfidentPick([ {label:'x'}, {label:'y'} ]);
    if(r!==null) throw new Error('无分应null,实际 '+r);
  });
  await check('门控: 仅一个非结束候选返回null', function(){
    var r = localConfidentPick([ {label:'a',localHeuristicScore:66}, {label:'结束',localHeuristicScore:null,isEndPlay:true} ]);
    if(r!==null) throw new Error('单候选应null,实际 '+r);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node run_ai_bus_c_window_test.js 2>&1 | rg "通过|失败"` → Expected: 新 6 条 FAIL（`localConfidentPick is not defined`）

- [ ] **Step 3: 实现**（bot.js，`localFallbackPlayWindow` 之前）

```js
// ===== 置信度门控(2026-08):本地启发式高置信度时直接拍板不调AI,省调用次数 =====
// 消费既有 localHeuristicScore(C1 红线打分:botCardPriority+botTargetScore,不新增不改)。
// 规则:非结束候选按分排序,top1 与 top2 分差 >= BOT_CONFIDENCE_GAP 才算"明显最优"返回 top1
// index;否则返回 null 交给 AI。结束项(isEndPlay/分null)不参与;少于2个非结束候选直接 null。
const BOT_CONFIDENCE_GAP = 20; // 保守起步:静态牌权档位差(66杀/74顺拆/82装备/92无中/100桃),跨2档才拍
function localConfidentPick(candidates){
  if(!Array.isArray(candidates) || candidates.length<2) return null;
  let best = null, second = null, bestIdx = -1;
  for(let i=0;i<candidates.length;i++){
    const c = candidates[i];
    const v = (c && typeof c==='object' && c.isEndPlay) ? null
      : (c && typeof c.localHeuristicScore==='number' ? c.localHeuristicScore : null);
    if(v===null) continue;
    if(best===null || v>best){ second = best; best = v; bestIdx = i; }
    else if(second===null || v>second){ second = v; }
  }
  if(best===null || second===null) return null;
  return (best - second >= BOT_CONFIDENCE_GAP) ? bestIdx : null;
}
```

- [ ] **Step 4: 跑测试确认通过** → 新 6 条 PASS，既有全绿

- [ ] **Step 5: 提交**

```bash
git add bot.js run_ai_bus_c_window_test.js
git commit -m "feat(ai-opt): 置信度门控localConfidentPick——本地分差≥20直接拍板不调AI(单测6条)"
```

---

### Task 2: 接入强C 循环 + 回归

**Files:**
- Modify: `bot.js` `runBotActionWindow`（约 4786 行 `if(aiReady && candidates.length>1)` 分支）
- Modify: `index.html`（`?v=361` → `?v=362` ×15）
- Test: `run_ai_bus_c_window_test.js`（追加集成用例）

**Interfaces:**
- Consumes: `localConfidentPick(candidates)`（Task 1）。
- Produces: 强C 循环 `aiReady && length>1` 时先试门控，命中本地拍板不调 AI；未命中走既有 `callAiChooseIndex`。

- [ ] **Step 1: 写失败测试**（集成用例——门控命中时不消费 AI mock）

```js
  await check('强C门控: 分差大时不调AI(本地拍板)', async function(){
    window.__mockAiResults = [ { ok: true, text: '{"choice":99}' } ]; // 若误调AI会消费并越界
    // 构造:唯一杀候选 vs 酒,分差大;门控命中应直接走杀,不调AI
    var g = mkWindowG();
    // (mkWindowG 为 T9 既有构造;若其手牌含多张高分牌导致分差不稳,调整其手牌为"杀+酒"组合)
    g.players[0].hand = [ {name:'杀',suit:'♠',rank:7}, {name:'酒',suit:'♠',rank:9} ];
    await runBotActionWindow(g, 0);
    if(window.__mockAiResults.length !== 1) throw new Error('门控命中不应消费AI mock,剩余 '+window.__mockAiResults.length);
  });
```

- [ ] **Step 2: 实现**（runBotActionWindow 内 `if(aiReady && candidates.length>1){` 之前插入）

```js
    let idx = null;
    if(aiReady && candidates.length>1){
      // 【置信度门控】本地启发式明显最优(分差≥阈值)时直接拍板,不调AI省调用次数
      const localPick = localConfidentPick(candidates);
      if(localPick !== null){
        idx = localPick;
      } else {
        // ... 既有 callAiChooseIndex 逻辑
      }
    } else if(candidates.length===1){
      idx = 0;
    }
```

- [ ] **Step 3: 跑测试 + 回归**

Run:
```bash
node run_ai_bus_c_window_test.js 2>&1 | rg "通过|失败"
node run_ai_bus_l3_test.js 2>&1 | rg "通过|失败"
node run_ai_test_button_test.js 2>&1 | rg "通过|失败"
node run_team_mode_test.js 2>&1 | rg "通过|失败"
```
Expected: 全部 0 失败（注意 c_window 既有用例若 mock 队列消费数被断言，需核对门控是否改变了计数——若某用例构造的候选分差恰好跨过 20，需调整该用例或门控在该测试场景的命中；以"门控只省调用不改行为正确性"为准核对）。

- [ ] **Step 4: ?v= + 提交 + 同步**

```bash
sed -i 's/?v=361/?v=362/g' index.html
git add bot.js index.html run_ai_bus_c_window_test.js
git commit -m "feat(ai-opt): 强C循环接入置信度门控——高置信度步不调AI,同窗调用降频+?v=362"
git push origin main
git branch -f wenwen_dev main && git push origin wenwen_dev
```
（progress-log-9 追加改动记录：功能/阈值/回归/版本号）
