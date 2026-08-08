/**
 * AI 测试托管按钮 —— Task 2 测试骨架:parseBotPlayAiChoiceWithReason 解析函数 +
 * callAiChooseIndex 托管检测/理由采集。
 *
 * 加载真实完整链路(config/data/debug-log/room-lifecycle/game/weapons/skills/bot-ai-bus/
 * bot/ai-bot/render)进共享 vm 沙箱(与 run_ai_bus_l3_test.js 同一套 firebase/document/window
 * stub 与异步 check 断言惯例)。
 *
 * 覆盖(Task 2 brief Step 1 + Step 6):
 *  - parseBotPlayAiChoiceWithReason: 带reason解析 / 无reason回退老解析 / 代码块包裹 /
 *    垃圾输入回退null(4 项)
 *  - callAiChooseIndex: 托管命中时返回 idx 且 aiTestLastReason 被设置 / 未托管时 reason
 *    保持 null 零变化(2 项)
 *
 * 已知的 vm 坑(沿用 l3 结论):aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let 绑定,
 * 必须用 runInContext 里裸标识符赋值;callAI 是函数声明绑定,可直接在 runInContext 里
 * 整体替换成 mock。
 *
 * 【aiTestLastReason 的模块级声明】计划的 Step 5 修改点 A 原文是在 callAiChooseIndex
 * 函数体内部写 `if(typeof aiTestLastReason==='undefined') var aiTestLastReason = null;`——
 * var 提升会让它成为该函数的局部变量,测试(本文件 Step 6 断言)和 Task 5 的
 * aiTestDecisionHook 都在函数外读它,必然读到 undefined/抛 ReferenceError,测试恒红。
 * 计划的 Interfaces 明确要求"写入模块级 aiTestLastReason(供 record 采集)",所以实现时
 * 把声明放在 bot-ai-bus.js 顶层(let aiTestLastReason = null;),函数内直接读写,测试在此
 * 按"模块级"语义断言。
 */
const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: {
    transaction: function(fn) {
      return fn(context.g || {});
    }
  },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; }, remove: function() {} }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: [],
    // render.js 顶层注册横屏引导/音频解锁监听需要 document 级 addEventListener
    addEventListener: function() {}, removeEventListener: function() {}
  },
  window: {
    firebase: null,
    location: { search: '', href: 'http://localhost', reload: function() {} },
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    setInterval: function(f, t) { return setInterval(f, t); }, clearInterval: function(t) { return clearInterval(t); },
    alert: function() {}, confirm: function() { return true; }, prompt: function() { return null; },
    open: function() { return null; }, close: function() {},
    history: { pushState: function() {}, replaceState: function() {} },
    navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', onLine: true }
  },
  joinRoom: function() {},
  mySeat: 0,
  pushLog: function(log, text) { log.push({seq: log.length, text: text}); return log; },
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-ai-test-button-sandbox' });

console.log('Loading AI 测试托管按钮 Task2 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot-ai-bus.js 在 bot.js 之前(TDZ:const BOT_DECISIONS
// 必须先于注册项);ai-bot.js 最后、render.js 殿后。
const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sandbox);
      vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  AI 测试托管按钮 Task2(理由解析+托管检测)');
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

  // ---- mock callAI(函数声明绑定,整体替换;记录 opts 供 prompt 断言) ----
  window.__mockAiCalls = 0;
  window.__mockAiArgs = null;
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return { ok: true, text: '{"choice":1,"reason":"测试理由"}' };
  };

  // callAiChooseIndex 直接用 opts.g 传给 showAiThinkingIndicator(g,seat),只读
  // g.players[seat].name,一个最小对象即可。
  var g = { players: [ { name: '机器人0' }, { name: '玩家1' }, { name: '玩家2' } ] };

  // ================= Task2 Step1:parseBotPlayAiChoiceWithReason(4 项) =================
  await check('parseBotPlayAiChoiceWithReason: 带reason解析', function(){
    var r = parseBotPlayAiChoiceWithReason('{"choice":2,"reason":"因为对面血量低"}');
    if(r.idx!==2 || r.reason!=='因为对面血量低') throw new Error('应 {idx:2,reason:...},实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 无reason回退老解析', function(){
    var r = parseBotPlayAiChoiceWithReason('{"choice":1}');
    if(r.idx!==1 || r.reason!==null) throw new Error('应 {idx:1,reason:null},实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 代码块包裹', function(){
    var r = parseBotPlayAiChoiceWithReason('\`\`\`json\n{"choice":0,"reason":"r"}\n\`\`\`');
    if(r.idx!==0 || r.reason!=='r') throw new Error('应剥代码块,实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 垃圾输入回退null', function(){
    var r = parseBotPlayAiChoiceWithReason('你好');
    if(r.idx!==null) throw new Error('应 null,实际 '+JSON.stringify(r));
  });

  // ================= Task2 Step6:callAiChooseIndex 托管检测(2 项) =================
  aiApiKey = 'test-key';
  aiProvider = 'claude';
  // 沙箱全局创建 aiTestAutopilot(Task 4 才正式定义,这里模拟其形状)
  aiTestAutopilot = { active: false, seat: null, records: [] };

  await check('callAiChooseIndex: 托管命中时返回idx且aiTestLastReason被设置', async function(){
    aiTestAutopilot = {active:true, seat:0};
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!=='测试理由') throw new Error('应采集理由,实际 '+aiTestLastReason);
    // 附加:托管命中时 systemPrompt 应含"本次为AI测试托管"指令
    if(!window.__mockAiArgs || window.__mockAiArgs.opts.systemPrompt.indexOf('AI测试托管') < 0)
      throw new Error('托管命中时 systemPrompt 应含托管指令,实际 '+JSON.stringify(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt));
  });
  await check('callAiChooseIndex: 未托管时reason保持null(零变化)', async function(){
    aiTestAutopilot = {active:false, seat:0};
    aiTestLastReason = '旧值';
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!==null) throw new Error('未托管不应采集理由,实际 '+aiTestLastReason);
    // 附加:未托管时 systemPrompt 不应含托管指令(零变化)
    if(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt.indexOf('AI测试托管') >= 0)
      throw new Error('未托管时 systemPrompt 不应含托管指令,实际 '+JSON.stringify(window.__mockAiArgs.opts.systemPrompt));
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

context.__testDone = false;
context.__testFail = false;
vm.runInContext(testCode, sandbox, { filename: 'test-inline.js' });

function waitDone(){
  if (context.__testDone) {
    process.exit(context.__testFail ? 1 : 0);
  } else {
    setTimeout(waitDone, 20);
  }
}
waitDone();
