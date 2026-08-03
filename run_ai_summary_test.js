/**
 * AI 自维护回合摘要测试 - aiSummary 状态 / updateAiSummary / buildSummaryPrompt /
 * callAiChooseIndex 摘要注入
 *
 * 加载真实 data.js + ai-bot.js + bot.js 进共享 vm 沙箱(与 run_ai_bus_info_test.js
 * 同一套惯例),mock callAI 记录收到的 opts 并返回可控结果。覆盖 8 项:
 * 首回合无摘要且不注入 / updateAiSummary 写回 / 注入进 systemPrompt / 失败沿用 /
 * 迭代携带旧摘要 / 座位变化清空 / 500 字上限 / fire-and-forget 不阻塞。
 *
 * 已知的 vm 坑:aiApiKey/aiProvider/aiApiModel 是 ai-bot.js 脚本作用域的 let 绑定,
 * 必须用 runInContext 里裸标识符赋值;callAI 是函数声明绑定,可直接在 runInContext
 * 里整体替换成 mock;distance/attackRange 是 game.js 的函数声明,沙箱不加载
 * game.js,在 context 里给最小 stub(同 run_ai_bus_info_test.js 惯例)。
 */

const vm = require('vm');
const fs = require('fs');

// 共享上下文:ai-bot.js 顶层 IIFE 读 sessionStorage,setupRefreshWarning 读
// window.aiConversations,showAiThinkingIndicator/hideAiThinkingIndicator 读
// document.getElementById(...).classList —— 全部在这里给最小 stub。
const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  mySeat: 0,
  myClientId: 'test-client',
  // game.js 的 distance/attackRange 不在沙箱里,给最小 stub(buildBotVisibleState 用)
  distance: function(){ return 1; },
  attackRange: function(){ return 1; },
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
// 沙箱内裸 sessionStorage 与 window.sessionStorage 同源指向上面这个 stub
context.window.sessionStorage = context.sessionStorage;

const sandbox = vm.createContext(context, { name: 'sgs-ai-summary-sandbox' });

console.log('Loading AI 摘要测试环境...\n');

// 加载真实源文件:data.js(GENERALS/EQUIPS,buildBotVisibleState 运行时查表)必须排在
// bot.js 之前;ai-bot.js(密钥/提供商 let 绑定 + callAI)。bot.js 顶层无立即执行的
// 函数调用,不加载 game.js 也无碍。
const files = ['data.js', 'ai-bot.js', 'bot.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  AI 摘要测试(8 项)');
console.log('='.repeat(60) + '\n');

// 断言脚本整体在沙箱内执行(和 run_ai_bus_core_test.js 同一惯例),
// 这样 aiApiKey = 'test-key' 这类裸标识符赋值才能命中 ai-bot.js 的 let 绑定。
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

  // 准备:填密钥/提供商,mock callAI(函数声明绑定可直接整体替换)
  aiApiKey = 'test-key';
  aiProvider = 'claude';
  window.__mockSummaryCalls = 0;
  window.__mockSummaryResult = null;
  window.__mockSummaryArgs = null;
  callAI = async function(provider, apiKey, opts){
    window.__mockSummaryCalls++;
    window.__mockSummaryArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockSummaryResult;
  };
  function mockOk(text){ window.__mockSummaryResult = { ok: true, text: text }; }

  // 最小局面:3 人 ffa,结构满足 buildBotVisibleState 的读取
  var g = {
    roundNum: 3,
    turn: 0,
    phase: 'play',
    gameMode: 'ffa',
    shaUsed: false,
    players: [
      { name: '机器人1', role: 'fan', hp: 3, maxHp: 4, alive: true,
        hand: [{ name: '桃', suit: 'heart', rank: 3 }], equips: {}, delays: [], general: 'guanyu' },
      { name: '机器人2', role: 'zhong', hp: 3, maxHp: 3, alive: true,
        hand: [], equips: {}, delays: [], general: 'machao' },
      { name: '机器人3', role: 'zhu', hp: 4, maxHp: 4, alive: true,
        hand: [], equips: {}, delays: [], general: 'sunquan' },
    ],
    log: [{ seq: 1, text: '机器人1 对 机器人2 造成 1 点伤害' }],
    discard: [{ name: '杀' }, { name: '闪' }],
    deck: [],
  };
  var candidates2 = [{ action: 'a' }, { action: 'b' }];

  // 1. 首回合:aiSummary 空;callAiChooseIndex 的 systemPrompt 不含"本局记忆摘要"段
  await check('1 首回合 aiSummary 为空且 systemPrompt 无摘要段', async function(){
    if(aiSummary !== '') throw new Error('期望 aiSummary==="",实际 "' + aiSummary + '"');
    mockOk('{"choice":0}');
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 0) throw new Error('期望 0,实际 ' + idx);
    var sp = window.__mockSummaryArgs.opts.systemPrompt;
    if(sp.indexOf('本局记忆摘要') !== -1) throw new Error('无摘要时不应注入摘要段');
  });

  // 2. updateAiSummary 直接调用 → mock callAI 被调 1 次、收到总结 prompt;写回 aiSummary
  await check('2 updateAiSummary 调 callAI 一次并写回 aiSummary', async function(){
    window.__mockSummaryCalls = 0;
    mockOk('反贼倾向明显,我留着桃');
    await updateAiSummary(g, 0);
    if(window.__mockSummaryCalls !== 1) throw new Error('期望 callAI 1 次,实际 ' + window.__mockSummaryCalls);
    if(window.__mockSummaryArgs.opts.systemPrompt.indexOf('摘要') === -1) throw new Error('systemPrompt 应含"摘要"字样');
    if(aiSummary !== '反贼倾向明显,我留着桃') throw new Error('期望 aiSummary 写回,实际 "' + aiSummary + '"');
  });

  // 3. 摘要注入:非空摘要 → 下一次决策的 systemPrompt 含摘要文本
  await check('3 callAiChooseIndex 注入非空摘要进 systemPrompt', async function(){
    mockOk('{"choice":1}');
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 1) throw new Error('期望 1,实际 ' + idx);
    var sp = window.__mockSummaryArgs.opts.systemPrompt;
    if(sp.indexOf('本局记忆摘要') === -1) throw new Error('应含"本局记忆摘要"段');
    if(sp.indexOf('反贼倾向明显,我留着桃') === -1) throw new Error('摘要文本应注入 systemPrompt');
  });

  // 4. 失败沿用:mock 返回 {ok:false} → aiSummary 不变
  await check('4 callAI 失败时 aiSummary 沿用旧值', async function(){
    window.__mockSummaryResult = { ok: false, reason: 'timeout', detail: '请求超时' };
    await updateAiSummary(g, 0);
    if(aiSummary !== '反贼倾向明显,我留着桃') throw new Error('失败后 aiSummary 不应变,实际 "' + aiSummary + '"');
  });

  // 5. 迭代:第二次 updateAiSummary → mock 收到的 userPrompt 含"旧摘要"+第一次输出
  await check('5 第二次 updateAiSummary 的 userPrompt 含旧摘要', async function(){
    mockOk('二号目标更像反贼,我留闪');
    await updateAiSummary(g, 0);
    var up = window.__mockSummaryArgs.opts.userPrompt;
    if(up.indexOf('旧摘要') === -1) throw new Error('userPrompt 应含"旧摘要"');
    if(up.indexOf('反贼倾向明显,我留着桃') === -1) throw new Error('第一次输出应出现在 userPrompt');
    if(aiSummary !== '二号目标更像反贼,我留闪') throw new Error('迭代后 aiSummary 应为新摘要,实际 "' + aiSummary + '"');
  });

  // 6. 座位变化:seat 1 决策后改 seat 2 → 内部 reset(aiSummary 清空)
  await check('6 座位变化触发 aiSummaryReset', async function(){
    mockOk('{"choice":0}');
    await callAiChooseIndex({ g: g, seat: 1, candidates: candidates2 });
    if(aiSummary !== '') throw new Error('换座位后 aiSummary 应清空,实际 "' + aiSummary + '"');
    await callAiChooseIndex({ g: g, seat: 2, candidates: candidates2 });
    if(aiSummary !== '') throw new Error('再次换座位后 aiSummary 仍应为空');
  });

  // 7. 上限:mock 返回 600 字 → aiSummary 长度 ≤500
  await check('7 超长摘要截断到 500', async function(){
    var long = '';
    for(var i = 0; i < 36; i++) long += '这是用来撑长度的中文摘要文本片段。'; // 36*17=612 字
    if(long.length <= 500) throw new Error('测试构造错误:长文本长度 ' + long.length + ' 应 >500');
    mockOk(long);
    await updateAiSummary(g, 0);
    if(aiSummary.length > 500) throw new Error('期望 ≤500,实际 ' + aiSummary.length);
    if(aiSummary !== long.slice(0, 500)) throw new Error('截断应取前 500 字');
  });

  // 8. 不阻塞:updateAiSummary 返回 Promise、不抛错、未 await 时后续决策照常工作
  await check('8 updateAiSummary fire-and-forget 不阻塞', async function(){
    var before = window.__mockSummaryCalls;
    mockOk('{"choice":0}');
    var p = updateAiSummary(g, 0);
    if(!(p && typeof p.then === 'function')) throw new Error('async 函数应返回 Promise');
    // 未 await 直接做下一次决策:不能因为摘要未完成而卡住
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 0) throw new Error('期望 0,实际 ' + idx);
    await p;
    if(window.__mockSummaryCalls < before + 1) throw new Error('updateAiSummary 应已触发 callAI');
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  __testFail = fail > 0;
  __testDone = true;
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  __testFail = true;
  __testDone = true;
});
`;

vm.runInContext(testCode, sandbox);

// 等沙箱内异步断言跑完,按结果退出(全绿 0,任一失败 1)
(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
