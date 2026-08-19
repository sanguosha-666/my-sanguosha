/**
 * CORE-132: LLM 返回 200 但 JSON 解析失败/索引越界时的一次 repair 重试
 *
 * 加载真实 ai-bot.js + bot-ai-bus.js + bot.js 进共享 vm 沙箱(与
 * run_ai_bus_core_test.js 同一套惯例),在沙箱内运行断言。
 *
 * 覆盖:
 *  1. repair 成功 → 返回合法索引,callAI 共 2 次
 *  2. repair 仍失败 → 返回 null(落到调用方 localFallback),callAI 共 2 次
 *  3. 预算不足 → 不发起 repair,callAI 仍是 1 次
 *  4. !result.ok(网络/超时失败)零变化 → 不触发 repair
 *  5. 首次即解析成功 → 不触发 repair
 *  6. repair 调用确实带了短超时 timeoutMs,且总预算 < RESPONSE_TIMEOUT_MS(30s)
 *  7. repair 沿用首次那个模型,不换模型
 *  8. 无密钥零变化(顶部守卫,根本不调 callAI)
 *  9. 破坏性验证:把 repair 分支还原成"直接 return null",断言确实会红
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  mySeat: 0,
  myClientId: 'test-client',
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  document: {
    getElementById: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, remove: function(){}
    }; },
    createElement: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, setAttribute: function(){}
    }; },
    addEventListener: function(){},
    body: { appendChild: function(){ return {}; } },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; }
  },
  window: {
    aiConversations: {},
    addEventListener: function(){},
    location: { search: '', href: 'http://localhost', reload: function(){} }
  }
};
context.window.sessionStorage = context.sessionStorage;

const sandbox = vm.createContext(context, { name: 'sgs-core132-sandbox' });

console.log('Loading CORE-132 测试环境...\n');

const files = ['data.js', 'stages/stage-table.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'];
files.forEach(function(file){
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    console.log('  OK ' + file);
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-132:JSON 解析失败的一次 repair 重试');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(async function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    return Promise.resolve().then(fn).then(function(){
      console.log('  PASS ' + name); pass++;
    }, function(e){
      console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++;
    });
  }

  aiApiKey = 'test-key';
  aiProvider = 'claude';
  aiApiModel = '';
  aiApiModels = [];

  var g = { players: [{ name: '机器人1' }], phase: 'play', turn: 0 };
  var candidates3 = [{ action: 'a' }, { action: 'b' }, { action: 'c' }];

  // installCallAI:把 callAI 换成按序返回预设结果的 spy,记录每次的 opts。
  var calls = [];
  function installCallAI(results){
    calls = [];
    callAI = async function(provider, apiKey, opts){
      calls.push({ provider: provider, opts: opts });
      var r = results[calls.length - 1];
      return r === undefined ? { ok:false, reason:'other', detail:'超出预设' } : r;
    };
  }

  // 每条用例前把预算恢复成产品默认值(用例 3 会临时改小)
  var DEFAULT_BUDGET = AI_DECISION_BUDGET_MS;
  var DEFAULT_REPAIR_TIMEOUT = AI_REPAIR_TIMEOUT_MS;
  function resetBudget(){
    AI_DECISION_BUDGET_MS = DEFAULT_BUDGET;
    AI_REPAIR_TIMEOUT_MS = DEFAULT_REPAIR_TIMEOUT;
  }

  // ---- 1. repair 成功 ----
  await check('repair 成功:首次不可解析 → repair 返回合法索引,callAI 共2次', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'我觉得应该选第二个吧,让我想想……' },   // 无法解析
      { ok:true, text:'{"choice":1,"reason":"修复后的回答"}' }  // repair 成功
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== 1) throw new Error('期望 repair 后返回 1,实际 ' + idx);
    if(calls.length !== 2) throw new Error('callAI 应被调用 2 次,实际 ' + calls.length);
  });

  // ---- 1b. repair 的 userPrompt 保留原局面 + 追加修复指令 ----
  await check('repair 的 userPrompt 保留原局面全文并追加修复指令', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'胡言乱语' },
      { ok:true, text:'{"choice":0}' }
    ]);
    await callAiChooseIndex({ g:g, seat:0, candidates:candidates3, userPrompt:'原始局面描述XYZ' });
    var firstUser = calls[0].opts.userPrompt;
    var repairUser = calls[1].opts.userPrompt;
    if(repairUser.indexOf('原始局面描述XYZ') < 0) throw new Error('repair 应保留原 userPrompt 全文');
    if(repairUser.indexOf('无法被程序解析') < 0) throw new Error('repair 应追加修复指令');
    if(repairUser.length <= firstUser.length) throw new Error('repair prompt 应比首次更长(追加了指令)');
    if(calls[1].opts.systemPrompt !== calls[0].opts.systemPrompt) throw new Error('systemPrompt 应与首次一致(同一局面)');
  });

  // ---- 1c. 索引越界也走 repair ----
  await check('索引越界(choice=99)同样触发 repair 并可被修复', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'{"choice":99}' },
      { ok:true, text:'{"choice":2}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== 2) throw new Error('期望 2,实际 ' + idx);
    if(calls.length !== 2) throw new Error('callAI 应被调用 2 次,实际 ' + calls.length);
  });

  // ---- 2. repair 仍失败 → null(落 localFallback) ----
  await check('repair 仍失败 → 返回 null(交给 localFallback),callAI 共2次', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'第一次胡言乱语' },
      { ok:true, text:'第二次还是胡言乱语' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== null) throw new Error('repair 仍失败应返回 null,实际 ' + idx);
    if(calls.length !== 2) throw new Error('callAI 应被调用 2 次,实际 ' + calls.length);
  });

  // ---- 2b. repair 调用本身失败(网络) → null,不再继续重试 ----
  await check('repair 调用本身网络失败 → 返回 null,不无限重试(共2次)', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:false, reason:'network', detail:'连不上' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
    if(calls.length !== 2) throw new Error('callAI 应被调用 2 次,实际 ' + calls.length);
  });

  // ---- 2c. repair 又返回一个越界索引 → null ----
  await check('repair 返回越界索引 → 仍返回 null', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":42}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
  });

  // ---- 3. 预算不足 → 不发起 repair ----
  await check('预算不足(总预算<repair超时) → 不发起 repair,callAI 仍是 1 次', async function(){
    resetBudget();
    AI_DECISION_BUDGET_MS = 1; // 已耗时必然 >= 0,budgetLeft 必 < 6000
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":1}' } // 若错误地发起 repair,这条会让它成功 → 断言变红
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(calls.length !== 1) throw new Error('预算不足时不应发起 repair,callAI 应为 1 次,实际 ' + calls.length);
    if(idx !== null) throw new Error('预算不足应返回 null 走本地兜底,实际 ' + idx);
    resetBudget();
  });

  // ---- 4. !result.ok 零变化 ----
  await check('!ok(timeout)路径零变化:不触发 repair,非轮换模式只调 1 次', async function(){
    resetBudget();
    aiProvider = 'claude'; aiApiModel = ''; aiApiModels = [];
    installCallAI([
      { ok:false, reason:'timeout', detail:'请求超时' },
      { ok:true, text:'{"choice":1}' } // 若错误地触发 repair,会成功 → 断言变红
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(calls.length !== 1) throw new Error('!ok 不应触发 repair,callAI 应为 1 次,实际 ' + calls.length);
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
  });

  // ---- 4b. 轮换模式换模型重试仍是既有路径,不叠加 repair ----
  await check('轮换模式:!ok 换模型重试(既有路径),不额外叠加 repair', async function(){
    resetBudget();
    aiProvider = 'groq'; aiApiModel = ''; aiApiModels = ['m1','m2'];
    _modelRotateIdx = 0; _modelCooldowns = {};
    installCallAI([
      { ok:false, reason:'other', detail:'HTTP 500' },
      { ok:false, reason:'other', detail:'HTTP 500' },
      { ok:true, text:'{"choice":1}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(calls.length !== 2) throw new Error('应只试完 2 个模型(既有行为),实际 ' + calls.length);
    if(idx !== null) throw new Error('全池失败应返回 null,实际 ' + idx);
    aiProvider = 'claude'; aiApiModels = [];
  });

  // ---- 5. 首次即成功 → 不触发 repair ----
  await check('首次即解析成功 → 不触发 repair(callAI 1 次)', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'{"choice":1}' },
      { ok:true, text:'{"choice":2}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== 1) throw new Error('期望 1,实际 ' + idx);
    if(calls.length !== 1) throw new Error('callAI 应为 1 次,实际 ' + calls.length);
  });

  // ---- 6. 超时预算 ----
  await check('repair 调用带短超时 timeoutMs,且明显小于首次的 AI_CALL_TIMEOUT_MS', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":0}' }
    ]);
    await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    var t = calls[1].opts.timeoutMs;
    if(typeof t !== 'number' || t <= 0) throw new Error('repair 应显式传 timeoutMs,实际 ' + t);
    if(t !== AI_REPAIR_TIMEOUT_MS) throw new Error('repair 超时应为 AI_REPAIR_TIMEOUT_MS,实际 ' + t);
    if(t >= AI_CALL_TIMEOUT_MS) throw new Error('repair 超时应明显短于首次调用超时 ' + AI_CALL_TIMEOUT_MS + ',实际 ' + t);
    if(calls[0].opts.timeoutMs !== undefined) throw new Error('首次调用不应带 timeoutMs(零变化),实际 ' + calls[0].opts.timeoutMs);
  });

  await check('总预算 + repair 超时 留在 RESPONSE_TIMEOUT_MS(30s)以内且有余量', function(){
    // RESPONSE_TIMEOUT_MS 定义在 game.js(本沙箱未加载),这里用产品值 30000 做对账基准。
    var RESPONSE_TIMEOUT = 30000;
    if(AI_DECISION_BUDGET_MS >= RESPONSE_TIMEOUT) throw new Error('总预算必须小于 30s 响应超时');
    if(RESPONSE_TIMEOUT - AI_DECISION_BUDGET_MS < 5000) throw new Error('总预算应给 tx/渲染留 >=5s 余量,实际余量 ' + (RESPONSE_TIMEOUT - AI_DECISION_BUDGET_MS));
    // 首次调用跑满 15s 后仍应放得下一次 repair(否则这个功能在最常见的慢响应场景下形同虚设)
    if(AI_DECISION_BUDGET_MS - AI_CALL_TIMEOUT_MS < AI_REPAIR_TIMEOUT_MS) throw new Error('首次跑满15s后应仍有预算做一次 repair');
  });

  // ---- 6c. CORE-133 合并收尾:repair 与首次调用的 maxTokens 下限同口径 ----
  await check('repair 的 maxTokens 下限与首次调用一致(deep 档下同为 280,不退回 160)', async function(){
    resetBudget();
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":0}' }
    ]);
    await callAiChooseIndex({ g:g, seat:0, candidates:candidates3, reasoningLevel:'deep' });
    if(calls[0].opts.maxTokens !== 280) throw new Error('首次 deep 档应为 280,实际 ' + calls[0].opts.maxTokens);
    if(calls[1].opts.maxTokens !== calls[0].opts.maxTokens)
      throw new Error('repair 面对同一局面同一候选,maxTokens 必须与首次同口径;'
        + '首次 ' + calls[0].opts.maxTokens + ' vs repair ' + calls[1].opts.maxTokens
        + '(留 160 会让 deep 档"首次给够了、重试反而被截断")');
  });

  // ---- 7. repair 沿用首次的模型 ----
  await check('repair 沿用首次实际发出请求的模型,不换模型', async function(){
    resetBudget();
    aiProvider = 'groq'; aiApiModel = ''; aiApiModels = ['mA','mB'];
    _modelRotateIdx = 0; _modelCooldowns = {};
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":1}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    if(idx !== 1) throw new Error('期望 1,实际 ' + idx);
    if(calls[1].opts.model !== calls[0].opts.model)
      throw new Error('repair 应沿用首次模型 ' + calls[0].opts.model + ',实际 ' + calls[1].opts.model);
    aiProvider = 'claude'; aiApiModels = [];
  });

  // ---- 8. 无密钥零变化 ----
  await check('无密钥:顶部守卫直接 return null,完全不调 callAI', async function(){
    resetBudget();
    var savedKey = aiApiKey;
    aiApiKey = '';
    installCallAI([{ ok:true, text:'{"choice":1}' }]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    aiApiKey = savedKey;
    if(idx !== null) throw new Error('无密钥应返回 null,实际 ' + idx);
    if(calls.length !== 0) throw new Error('无密钥不应产生任何 callAI,实际 ' + calls.length);
  });

  // ---- 9. 破坏性验证:断言确实有鉴别力 ----
  await check('破坏性验证:把 repair 的预算判断改成永假,用例1的断言确实会红', async function(){
    resetBudget();
    var saved = AI_REPAIR_TIMEOUT_MS;
    AI_REPAIR_TIMEOUT_MS = Number.POSITIVE_INFINITY; // budgetLeft >= Infinity 恒假 → 永不 repair
    installCallAI([
      { ok:true, text:'不可解析' },
      { ok:true, text:'{"choice":1}' }
    ]);
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:candidates3 });
    AI_REPAIR_TIMEOUT_MS = saved;
    if(idx === 1 || calls.length === 2)
      throw new Error('破坏后仍然 repair 成功,说明用例1的断言没有鉴别力');
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0){ throw new Error('CORE-132 测试有 ' + fail + ' 条失败'); }
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'core132-test.js' })
  .catch(function(e){ console.error('\n' + (e && e.message || e)); process.exit(1); });
