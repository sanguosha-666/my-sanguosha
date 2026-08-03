/**
 * AI 总线 B2 层测试 - botPlay/tryAiBotPlay/tryAiBotBestTarget 经 callAiChooseIndex
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot/ai-bot)
 * 进共享 vm 沙箱(与 run_lidian_test.js 同一套 firebase/document/window stub,
 * 与 run_ai_bus_core_test.js 同一套异步 check 断言惯例),在沙箱内直接调用
 * botPlay(g,seat) 并 spy playCard/endPlay。
 * 覆盖:候选带牌面(label/card/handIndex)、无密钥本地兜底出桃、有密钥选"结束"走
 * endPlay、userPrompt 含候选牌名、选目标 mock 选非默认座位并落到 playCard target。
 *
 * 已知的 vm 坑:aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let 绑定,必须用
 * runInContext 里裸标识符赋值;playCard/endPlay/callAI 都是函数声明绑定,可直接
 * 在 runInContext 里整体替换成 spy。
 */

const vm = require('vm');
const fs = require('fs');

// run_lidian_test.js 的 firebase/document/window stub(该 harness 已成功加载 game.js)
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
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; } }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: []
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

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-l2-sandbox' });

console.log('Loading AI 总线 B2 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot.js 在 game.js 之后、ai-bot.js 最后。
const files = ['config.js', 'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot.js', 'ai-bot.js'];
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
console.log('  AI 总线 B2 测试(botPlay 出牌/选目标)');
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

  // ---- spy:playCard/endPlay 是函数声明绑定,整体替换即可 ----
  window.__playCalls = [];
  window.__endPlayCalls = 0;
  playCard = function(cardIdx, action, target){ window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target }); };
  endPlay = function(){ window.__endPlayCalls++; };
  // ---- mock callAI:每次调用记录参数,结果从队列里取 ----
  window.__mockAiCalls = 0;
  window.__mockAiArgs = null;
  window.__mockAiResults = [];
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockAiResults.length ? window.__mockAiResults.shift() : { ok: false, reason: 'other', detail: '队列已空' };
  };

  // 构造 3 人身份局:座位0是机器人自己(出牌阶段),手牌自定
  function mkG(hand, opt){
    opt = opt || {};
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: '玩家' + i,
        alive: true,
        hp: i === 0 ? (opt.myHp !== undefined ? opt.myHp : 4) : 4,
        maxHp: 4,
        hand: i === 0 ? hand : [],
        equips: emptyEquips(),
        delays: [],
        role: opt.roleOf ? opt.roleOf[i] : 'zhu',
        roleRevealed: !!(opt.roleRevealed && opt.roleRevealed[i])
      });
    }
    var g = {
      players: players,
      gameMode: opt.gameMode || 'ffa',
      roundNum: 1,
      phase: 'play',
      turn: 0,
      log: []
    };
    return g;
  }
  function card(name, id){
    return { id: id || (name + ''), name: name, suit: '♥', rank: 5 };
  }

  // ---- T1:候选带牌面(label/card/handIndex),结束项 card/handIndex 为 null ----
  await check('候选每项含 label/card/handIndex,结束项为 null', function(){
    var g = mkG([card('桃'), card('无中生有')], { myHp: 2 });
    var list = buildBotPlayCandidates(g, [{ idx: 0, action: '桃', target: null, value: 100 }, { idx: 1, action: '无中生有', target: null, value: 92 }]);
    if(list.length !== 3) throw new Error('期望3项,实际 ' + list.length);
    var e0 = list[0];
    if(typeof e0.label !== 'string' || e0.label.length === 0) throw new Error('候选0缺 label,实际 ' + JSON.stringify(e0));
    if(!e0.card || e0.card.name !== '桃') throw new Error('候选0 card 应为桃,实际 ' + JSON.stringify(e0.card));
    if(e0.handIndex !== 0) throw new Error('候选0 handIndex 应为0,实际 ' + e0.handIndex);
    if(!list[1].card || list[1].card.name !== '无中生有') throw new Error('候选1 card 应为无中生有');
    var end = list[2];
    if(end.card !== null || end.handIndex !== null) throw new Error('结束项 card/handIndex 应为 null,实际 ' + JSON.stringify(end));
    if(end.label !== '结束出牌阶段') throw new Error('结束项 label 应为 结束出牌阶段,实际 ' + end.label);
  });

  // ---- T2:无密钥,手里有可用的桃(hp<maxHp)→ 本地兜底直接 playCard(桃) ----
  await check('无密钥:有桃且缺体力 → playCard 出桃', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkG([card('桃')], { myHp: 2 });
    await botPlay(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('playCard 应被调1次,实际 ' + window.__playCalls.length);
    if(window.__playCalls[0].action !== '桃') throw new Error('应出桃,实际 ' + window.__playCalls[0].action);
    if(window.__playCalls[0].target !== null) throw new Error('桃无目标,实际 target=' + window.__playCalls[0].target);
    if(window.__endPlayCalls !== 0) throw new Error('不应 endPlay');
  });

  // ---- T3:有密钥,mock 选"结束出牌阶段"→ endPlay(不 playCard) ----
  await check('有密钥:mock 选结束项 → endPlay', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }]; // 候选:[0=无中生有, 1=结束]
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('无中生有')]);
    await botPlay(g, 0);
    if(window.__endPlayCalls !== 1) throw new Error('endPlay 应被调1次,实际 ' + window.__endPlayCalls);
    if(window.__playCalls.length !== 0) throw new Error('不应 playCard');
    if(window.__mockAiCalls !== 1) throw new Error('callAI 应恰1次(无目标不二次询问),实际 ' + window.__mockAiCalls);
  });

  // ---- T4:userPrompt 里包含候选牌名(无中生有)+候选牌面字段 ----
  await check('userPrompt 含牌名 无中生有 与 card 字段', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('无中生有')]);
    await botPlay(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('callAI 应恰1次,实际 ' + window.__mockAiCalls);
    var up = window.__mockAiArgs.opts.userPrompt;
    if(typeof up !== 'string' || up.indexOf('无中生有') < 0) throw new Error('userPrompt 应含 无中生有,实际 ' + up);
    if(up.indexOf('"card"') < 0) throw new Error('userPrompt 应含候选 card 字段,实际 ' + up);
    if(up.indexOf('结束出牌阶段') < 0) throw new Error('userPrompt 应含结束项,实际 ' + up);
    if(window.__playCalls.length !== 1 || window.__playCalls[0].action !== '无中生有') throw new Error('应 playCard 无中生有');
  });

  // ---- T5:选目标:身份局 mock 选非默认座位 → playCard target 为该座位 ----
  // 座位1=主公(+240 默认最高),座位2=已翻开忠臣(+100)。mock 第一次选杀(choice 0),
  // 第二次选目标 candidates[1](=座位2),不是本地默认的座位1。
  await check('选目标:mock 选非默认座位 → playCard target 生效', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }, { ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('杀')], { gameMode: 'identity', roleOf: ['fan', 'zhu', 'zhong'], roleRevealed: [false, false, true] });
    await botPlay(g, 0);
    if(window.__mockAiCalls !== 2) throw new Error('应两次AI询问(选牌+选目标),实际 ' + window.__mockAiCalls);
    if(window.__playCalls.length !== 1) throw new Error('playCard 应被调1次,实际 ' + window.__playCalls.length);
    if(window.__playCalls[0].action !== '杀') throw new Error('应出杀,实际 ' + window.__playCalls[0].action);
    if(window.__playCalls[0].target !== 2) throw new Error('AI应选座位2,实际 target=' + window.__playCalls[0].target);
  });

  // ---- T6:回归——无密钥时 userPrompt 不产生任何 AI 调用(守卫短路) ----
  await check('无密钥:callAI 不被调用', async function(){
    var before = window.__mockAiCalls;
    aiApiKey = '';
    aiProvider = null;
    var g = mkG([card('杀')], { gameMode: 'identity', roleOf: ['fan', 'zhu', 'zhong'], roleRevealed: [false, false, true] });
    await botPlay(g, 0);
    if(window.__mockAiCalls !== before) throw new Error('无密钥不应调用 callAI');
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

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
