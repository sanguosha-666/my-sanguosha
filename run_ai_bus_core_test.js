/**
 * AI 总线核心测试 - parseBotPlayAiChoice / callAiChooseIndex / botDecide 骨架
 *
 * 加载真实 ai-bot.js + bot.js 进共享 vm 沙箱(与 run_lidian_test.js 同一套
 * fs.readFileSync + vm.Script + vm.createContext 惯例),在沙箱内运行断言。
 * 覆盖:parseBotPlayAiChoice 的解析/容错、callAiChooseIndex 的候选索引规范
 * (happy/越界/timeout/无密钥短路)、botDecide 未注册决策返回 false。
 *
 * 已知的 vm 坑(见任务说明):aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let
 * 绑定,sandbox.aiApiKey='...' 无效,必须用 runInContext 里裸标识符赋值;
 * callAI 是函数声明绑定,可直接在 runInContext 里整体替换成 mock。
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

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-sandbox' });

console.log('Loading AI 总线测试环境...\n');

// 只加载两个真实源文件:ai-bot.js(密钥/提供商 let 绑定 + callAI)与 bot.js
// (parseBotPlayAiChoice + 本次新增的 AI 总线骨架)。bot.js 顶层无立即执行的
// 函数调用,CARD_PLAYS/EQUIP_SLOTS 等只在函数体内引用,不加载也无碍。
const files = ['ai-bot.js', 'bot.js'];
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
console.log('  AI 总线核心测试');
console.log('='.repeat(60) + '\n');

// 断言脚本整体在沙箱内执行(和 run_lidian_test.js 的 test_lidian.js 同一惯例),
// 这样 aiApiKey = '' 这类裸标识符赋值才能命中 ai-bot.js 的 let 绑定。
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

  // 1. parseBotPlayAiChoice:合法 JSON → 返回索引
  await check('parseBotPlayAiChoice("{"choice":2}") === 2', function(){
    var r = parseBotPlayAiChoice('{"choice":2}');
    if(r !== 2) throw new Error('期望 2,实际 ' + r);
  });

  // 2. parseBotPlayAiChoice:非法文本 → null
  await check('parseBotPlayAiChoice("not json") === null', function(){
    var r = parseBotPlayAiChoice('not json');
    if(r !== null) throw new Error('期望 null,实际 ' + r);
  });

  // 准备:填密钥/提供商,mock callAI(函数声明绑定可直接整体替换)
  aiApiKey = 'test-key';
  aiProvider = 'claude';
  window.__mockAiCalls = 0;
  window.__mockAiResult = null;
  window.__mockAiArgs = null;
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockAiResult;
  };

  var g = { players: [{ name: '机器人1' }], phase: 'play', turn: 0 };
  var candidates3 = [{ action: 'a' }, { action: 'b' }, { action: 'c' }];

  // 3. callAiChooseIndex:AI 返回 {"choice":1} 且候选 3 个 → 1,且 callAI 确被调用
  await check('callAiChooseIndex ok+"{"choice":1}" 返回 1', async function(){
    window.__mockAiResult = { ok: true, text: '{"choice":1}' };
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates3 });
    if(idx !== 1) throw new Error('期望 1,实际 ' + idx);
    if(window.__mockAiCalls !== 1) throw new Error('callAI 应被调用 1 次,实际 ' + window.__mockAiCalls);
    if(window.__mockAiArgs.provider !== 'claude') throw new Error('provider 应透传 claude,实际 ' + window.__mockAiArgs.provider);
    if(!window.__mockAiArgs.opts || !window.__mockAiArgs.opts.systemPrompt) throw new Error('systemPrompt 应为非空默认提示');
  });

  // 4. callAiChooseIndex:AI 返回 {"choice":99} 越界 → null
  await check('callAiChooseIndex "{"choice":99}" 越界返回 null', async function(){
    window.__mockAiResult = { ok: true, text: '{"choice":99}' };
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates3 });
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
  });

  // 5. callAiChooseIndex:AI 返回 {ok:false,reason:"timeout"} → null
  await check('callAiChooseIndex {ok:false,reason:"timeout"} 返回 null', async function(){
    window.__mockAiResult = { ok: false, reason: 'timeout', detail: '请求超时' };
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates3 });
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
  });

  // 6. callAiChooseIndex:aiApiKey 为空 → 不调用 callAI,直接 null(守卫短路)
  await check('aiApiKey 为空时不调用 callAI 返回 null', async function(){
    aiApiKey = '';
    var before = window.__mockAiCalls;
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates3 });
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
    if(window.__mockAiCalls !== before) throw new Error('callAI 不应被调用');
    aiApiKey = 'test-key';
  });

  // 7. botDecide:未注册的 decisionId → false
  await check('botDecide("nope", g, 0) === false', async function(){
    var r = await botDecide('nope', { players: [] }, 0);
    if(r !== false) throw new Error('期望 false,实际 ' + r);
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
