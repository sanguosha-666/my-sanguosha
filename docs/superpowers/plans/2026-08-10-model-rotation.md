# 多模型轮换（Model Rotation）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Groq 密钥输入后默认勾选多模型、每次调用 round-robin 轮换使用，撞 429 时按响应"try again in Xm Ys"冷却跳过该模型，绕过单模型 TPM/TPD 墙。

**Architecture:** `ai-bot.js` 新增 `aiApiModels`（数组，sessionStorage 持久化）+ `resolveAiModel(provider)`（round-robin 指针 + 冷却表 `_modelCooldowns`，非 groq/单选/无配置零变化）+ `callAI` 429 分支解析错误体写冷却。`bot-ai-bus.js` 等调用点 `model: aiApiModel||undefined` → `model: resolveAiModel(provider)`。UI 单选下拉改复选列表。

**Tech Stack:** 纯浏览器 JS（全局作用域），vm 沙箱测试（node），mock fetch。

**Spec:** `docs/superpowers/specs/2026-08-10-model-rotation-design.md`

## Global Constraints

- 分支纪律：commit/push 只在 `main`，随后快进同步 `wenwen_dev`。
- **回归红线**：非 groq / `aiApiModels` 空 / `aiApiModel` 手动单选非空 → `resolveAiModel` 返回 `aiApiModel || undefined`（原行为逐字零变化）。
- 冷却状态**不持久化**（会话内 `_modelCooldowns` 对象，刷新重置）；`aiApiModels` 持久化到 sessionStorage。
- 默认勾选（groq）：`groq/compound`、`llama-3.3-70b-versatile`、`openai/gpt-oss-120b`、`qwen/qwen3.6-27b`。
- 轮换只换 model 字段，不改变 prompt/参数。
- 429 解析正则 `/try again in (\d+)m([\d.]+)?s/`，失败默认 60s 冷却。
- 版本号：改 `ai-bot.js`/`bot-ai-bus.js` 后 `index.html` `?v=N` 同步 +1（当前 361 → 362）。
- 测试：vm 沙箱 + mock fetch；顶层 await 用 async IIFE 包裹。

---

### Task 1: 数据层——aiApiModels + resolveAiModel + 冷却表 + 429 解析

**Files:**
- Modify: `ai-bot.js`（`aiApiModel` 声明附近 + `callAI` 的 `!res.ok` 分支）
- Test: `run_model_rotation_test.js`（新建）

**Interfaces:**
- Produces: `aiApiModels`（数组）、`AI_MODELS_STORAGE_KEY`、`resolveAiModel(provider)` → `string|undefined`、`_modelCooldowns`、`parseGroqRetrySeconds(text)` → `number|null`。`aiApiModel`/`aiApiKey`/`aiProvider` 既有语义不变。

- [ ] **Step 1: 写失败测试**（新建 `run_model_rotation_test.js`，仿 run_ai_model_picker_test.js 沙箱惯例）

```js
// run_model_rotation_test.js —— 多模型轮换回归套件
// 用法: node run_model_rotation_test.js
const vm = require('vm');
const fs = require('fs');
let fetchCalls = [];
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } } }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage: { getItem: function(k){ return context.__ls && k in context.__ls ? context.__ls[k] : null; }, setItem: function(k,v){ if(!context.__ls) context.__ls={}; context.__ls[k]=String(v); }, removeItem: function(k){ if(context.__ls) delete context.__ls[k]; } }, sessionStorage: { getItem: function(k){ return context.__ss && k in context.__ss ? context.__ss[k] : null; }, setItem: function(k,v){ if(!context.__ss) context.__ss={}; context.__ss[k]=String(v); }, removeItem: function(k){ if(context.__ss) delete context.__ss[k]; } }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' }, fetch: function(url, opts){ fetchCalls.push({url:url, opts:opts}); return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ choices:[{ message:{ content:'{"choice":0}' } }] }); }, text:function(){ return Promise.resolve(''); } }); } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
const files = ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','bot-ai-bus.js','bot.js','ai-bot.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  // 0. 默认勾选列表(用户确认的4模型)
  await check('默认勾选: groq 4模型', function(){
    const d = vm.runInContext('DEFAULT_GROQ_MODELS', sandbox);
    if(!d || d.length!==4) throw new Error('应4个,实际 '+(d&&d.length));
    ['groq/compound','llama-3.3-70b-versatile','openai/gpt-oss-120b','qwen/qwen3.6-27b'].forEach(function(m){
      if(d.indexOf(m)<0) throw new Error('缺 '+m);
    });
  });
  // 1. resolveAiModel: 非 groq 返回 undefined(零变化)
  await check('resolveAiModel: 非groq返回undefined', function(){
    vm.runInContext('aiProvider="claude"; aiApiModel=""; aiApiModels=[];', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('claude');
    if(r!==undefined) throw new Error('应undefined,实际 '+r);
  });
  // 2. resolveAiModel: 手动单选优先(aiApiModel 非空不轮换)
  await check('resolveAiModel: 手动单选优先', function(){
    vm.runInContext('aiProvider="groq"; aiApiModel="llama-3.3-70b-versatile"; aiApiModels=["groq/compound","openai/gpt-oss-120b"];', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='llama-3.3-70b-versatile') throw new Error('应手动单选,实际 '+r);
  });
  // 3. resolveAiModel: 多选轮换顺序 round-robin
  await check('resolveAiModel: 多选轮换顺序', function(){
    vm.runInContext('aiProvider="groq"; aiApiModel=""; aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
    const r1 = vm.runInContext('resolveAiModel', sandbox)('groq');
    const r2 = vm.runInContext('resolveAiModel', sandbox)('groq');
    const r3 = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r1!=='groq/compound' || r2!=='openai/gpt-oss-120b' || r3!=='groq/compound')
      throw new Error('轮换顺序错: '+r1+'/'+r2+'/'+r3);
  });
  // 4. 429 冷却: 命中冷却的模型被跳过
  await check('resolveAiModel: 冷却中的模型跳过', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()+99999999}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='openai/gpt-oss-120b') throw new Error('应跳过冷却中的compound,实际 '+r);
  });
  // 5. 全部冷却 → 返回第一个(注定429走本地兜底)
  await check('resolveAiModel: 全部冷却返回第一个', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()+9999,"openai/gpt-oss-120b": Date.now()+9999}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='groq/compound') throw new Error('全冷却应返回第一个,实际 '+r);
  });
  // 6. 429 解析: 正常格式
  await check('parseGroqRetrySeconds: 15m21s → 921', function(){
    const s = vm.runInContext('parseGroqRetrySeconds', sandbox)('Rate limit reached... Please try again in 15m21.023999999s. Need more tokens?');
    if(s!==921) throw new Error('应921,实际 '+s);
  });
  // 7. 429 解析: 失败默认 60
  await check('parseGroqRetrySeconds: 无时间字段→null(调用方默认60)', function(){
    const s = vm.runInContext('parseGroqRetrySeconds', sandbox)('Rate limit reached for model x');
    if(s!==null) throw new Error('应null,实际 '+s);
  });
  // 8. 冷却到点恢复
  await check('resolveAiModel: 冷却到点恢复', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()-1000}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='groq/compound') throw new Error('冷却已过应恢复,实际 '+r);
  });
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node run_model_rotation_test.js` → Expected: 8 条 FAIL（`DEFAULT_GROQ_MODELS is not defined` 等）

- [ ] **Step 3: 实现**（ai-bot.js）

`aiApiModel` 声明附近（约 65 行）追加：
```js
// ===== 多模型轮换(2026-08):groq 免费层各模型限额独立池(org×model),输入密钥后默认勾选
// 多模型、每次调用 round-robin 轮换,撞 429 时按响应冷却跳过该模型,绕过单模型 TPM/TPD 墙。
// 优先级:手动单选(aiApiModel 非空) > 多选轮换(aiApiModels 非空且 aiApiModel 空) > 默认档位。
const AI_MODELS_STORAGE_KEY = 'sgsAiModels';
// 默认勾选(groq 免费层独立池模型,用户确认)
const DEFAULT_GROQ_MODELS = ['groq/compound','llama-3.3-70b-versatile','openai/gpt-oss-120b','qwen/qwen3.6-27b'];
let aiApiModels = [];
let _modelRotateIdx = 0;          // round-robin 指针
let _modelCooldowns = {};         // modelId → retryAt(时间戳);会话内有效,不持久化

// parseGroqRetrySeconds:从 429 错误体解析 "try again in Xm Ys",失败返回 null(调用方给默认)。
function parseGroqRetrySeconds(text){
  if(typeof text!=='string') return null;
  const m = text.match(/try again in (\d+)m([\d.]+)?s/);
  if(!m) return null;
  const sec = parseInt(m[1],10) + (m[2] ? Math.round(parseFloat(m[2])) : 0);
  return (Number.isFinite(sec) && sec>0) ? sec : null;
}
// resolveAiModel:轮换选模型。非groq/无多选/手动单选 → aiApiModel||undefined(零变化)。
function resolveAiModel(provider){
  if(provider!=='groq') return (typeof aiApiModel==='string' && aiApiModel) ? aiApiModel : undefined;
  if(typeof aiApiModel==='string' && aiApiModel) return aiApiModel;   // 手动单选优先
  const list = (Array.isArray(aiApiModels) && aiApiModels.length) ? aiApiModels : null;
  if(!list) return undefined;
  const now = Date.now();
  // 找下一个未冷却的
  for(let i=0;i<list.length;i++){
    const idx = (_modelRotateIdx + i) % list.length;
    const model = list[idx];
    if(_modelCooldowns[model] && _modelCooldowns[model] > now) continue; // 冷却中跳过
    _modelRotateIdx = (idx + 1) % list.length; // 指针前进
    return model;
  }
  return list[0]; // 全部冷却中 → 返回第一个(本次注定429,走本地兜底)
}
```

`hydrateAiStateFromSession` 的 try 块内（`aiApiModel = sessionStorage.getItem(...)` 之后）追加：
```js
    try{
      const rawModels = sessionStorage.getItem(AI_MODELS_STORAGE_KEY);
      aiApiModels = rawModels ? JSON.parse(rawModels) : [];
      if(!Array.isArray(aiApiModels)) aiApiModels = [];
    }catch(e){ aiApiModels = []; }
```
catch 块（重置分支）追加 `aiApiModels = [];`

`persistAiState` 追加：
```js
    if(Array.isArray(aiApiModels) && aiApiModels.length) sessionStorage.setItem(AI_MODELS_STORAGE_KEY, JSON.stringify(aiApiModels));
    else sessionStorage.removeItem(AI_MODELS_STORAGE_KEY);
```

`callAI` 的 `!res.ok` 分支（约 272 行）追加 429 冷却识别（注意：callAI 不知道"当前用的是哪个模型"，从 opts.model 取，拿不到就跳过）：
```js
    if(!res.ok){
      return res.text().then(t=>{
        if(res.status===429 && provider==='groq' && opts && typeof opts.model==='string'){
          const sec = parseGroqRetrySeconds(t);
          const retryAt = Date.now() + ((sec!==null ? sec : 60) * 1000);
          _modelCooldowns[opts.model] = retryAt;
          console.warn('[AI] 模型 '+opts.model+' 触发限流,冷却 '+(sec!==null?sec:60)+'s(到 '+new Date(retryAt).toTimeString().slice(0,8)+')');
        }
        return { ok:false, reason:'other', detail:'HTTP '+res.status+': '+t.slice(0,200) };
      });
    }
```

- [ ] **Step 4: 跑测试确认通过** → 8 条全 PASS

- [ ] **Step 5: 提交**

```bash
git add ai-bot.js run_model_rotation_test.js
git commit -m "feat(model-rotation): aiApiModels多选+resolveAiModel轮换+429冷却解析(单测8条)"
```

---

### Task 2: 调用点接入 + UI 复选 + 回归

**Files:**
- Modify: `bot-ai-bus.js`（callAiChooseIndex/updateAiSummary 的 callAI 调用点 `model: aiApiModel||undefined` → `model: resolveAiModel(provider)`）
- Modify: `ai-bot.js`（模型选择 UI：单选 → 复选；renderModelPicker/onPick）
- Modify: `index.html`（`?v=361` → `?v=362` ×15）
- Test: `run_model_rotation_test.js`（追加 UI 断言可选）

**Interfaces:**
- Consumes: `resolveAiModel(provider)`（Task 1）。

- [ ] **Step 1: 调用点接入**（bot-ai-bus.js）

grep 所有 `model: aiApiModel` 调用点（callAiChooseIndex 约 227 行、updateAiSummary 约 131 行等），统一改为：
```js
        model: (typeof resolveAiModel==='function' ? resolveAiModel(provider) : undefined),
```
（`typeof` 防御跨文件加载顺序——ai-bot.js 最后加载。注意保持 opts.model 传给 callAI 的语义：callAI 内部 429 分支需要 opts.model 知道当前模型，所以必须传实际选中的模型，不能传 undefined。）

- [ ] **Step 2: UI 单选 → 复选**（ai-bot.js 模型选择器）

读 renderModelPicker（约 372-410 行）现状——把单选的"点击列表项 → onPick(id) 写 aiApiModel"改为：groq 用 checkbox 多选写 `aiApiModels`，claude/openrouter 保持单选。具体改动以读到的实际结构为准，遵循"手动单选 > 多选 > 默认"优先级语义。若 renderModelPicker 结构复杂难以快速改造成复选，可先做数据层（Task 1）验证轮换逻辑，UI 复选作为本 task 的次要交付（保证 groq 默认勾选 DEFAULT_GROQ_MODELS 生效即可——可通过初始化逻辑：groq 密钥识别后若 aiApiModels 为空则自动设为 DEFAULT_GROQ_MODELS）。

- [ ] **Step 3: 跑测试 + 回归**

Run:
```bash
node run_model_rotation_test.js 2>&1 | rg "通过|失败"
node run_ai_model_picker_test.js 2>&1 | rg "通过|失败"
node run_ai_test_button_test.js 2>&1 | rg "通过|失败"
node run_ai_bus_core_test.js 2>&1 | rg "通过|失败"
```
Expected: 全绿 0 失败

- [ ] **Step 4: ?v= + 提交 + 同步**

```bash
sed -i 's/?v=361/?v=362/g' index.html
git add bot-ai-bus.js ai-bot.js index.html run_model_rotation_test.js
git commit -m "feat(model-rotation): 调用点接入resolveAiModel+groq默认勾选4模型+?v=362"
git push origin main
git branch -f wenwen_dev main && git push origin wenwen_dev
```
（progress-log-9 追加改动记录：功能/默认勾选/429冷却/回归/版本号）

---

### Self-Review（计划作者自查）

- **Spec 覆盖**：数据（Task 1 aiApiModels/DEFAULT_GROQ_MODELS）✓；轮换机制（Task 1 resolveAiModel/429 解析）✓；UI 复选（Task 2）✓；边界（全部冷却返回第一个/解析失败默认60s/单选优先/不持久化/非groq零变化）✓；测试（Task 1 8条 + Task 2 回归）✓。
- **类型一致**：`resolveAiModel(provider)`/`parseGroqRetrySeconds(text)`/`DEFAULT_GROQ_MODELS`/`aiApiModels`/`_modelCooldowns`/`_modelRotateIdx` 前后一致。
- **调用点 model 语义**：Task 2 要求 model 必须传实际模型（不能 undefined）——因为 callAI 429 分支靠 opts.model 知道当前模型写冷却。这是关键约束，已写明。
