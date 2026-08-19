/**
 * CORE-133: 局势自适应的 prompt 上下文预算分档
 *
 * 覆盖:
 *  1. botReasoningLevel 三档判据(濒死/内奸/自己残血 → deep;平稳 → fast;其余 → normal)
 *  2. normal 档与改动前逐字一致(recentLog 6 / 他人desc 60 / suspicion 10 / maxTokens下限 160)
 *  3. buildBotVisibleState 不传 level 时 = normal(既有调用点与测试零变化)
 *  4. fast/deep 档的实际预算数值确实生效
 *  5. callAiChooseIndex 的 maxTokens 下限随档位变化
 *  6. 无密钥路径零变化 / AI_PLAY_CANDIDATE_LIMIT 未被档位触碰
 *  7. 破坏性验证:断言有鉴别力
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: console,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  mySeat: 0, myClientId: 'test-client',
  // game.js 未加载进本沙箱(拉进来会牵出整条依赖链,不值)。buildBotVisibleState 会调用
  // 这两个函数,给最小 stub——与 run_ai_bus_info_test.js 同款惯例。本用例只验证分档对
  // recentLog/desc/suspicion 三个预算字段的影响,不对这两个函数的真实实现背书。
  distance: function(){ return 1; },
  attackRange: function(){ return 1; },
  nextAlive: function(g, from){ return ((from||0) + 1) % ((g.players||[]).length || 1); },
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
  window: { aiConversations: {}, addEventListener: function(){}, location: { search:'', href:'http://localhost', reload:function(){} } }
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core133-sandbox' });

console.log('Loading CORE-133 测试环境...\n');
['data.js', 'stages/stage-table.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'].forEach(function(file){
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
console.log('  CORE-133:局势自适应的 prompt 上下文预算分档');
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

  // mkGame:默认造一个"全员满血存活、无濒死"的平稳局面(= fast 档)。
  function mkGame(over){
    var g = {
      gameMode: 'ffa', phase: 'play', turn: 0, roundNum: 3,
      pending: null, deck: [], aiSuspicionEvents: [], log: [],
      players: [
        { name:'A', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:null, general:null },
        { name:'B', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:null, general:null },
        { name:'C', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:null, general:null }
      ]
    };
    if(over) for(var k in over) g[k] = over[k];
    return g;
  }

  // ---------- 1. 分档判据 ----------
  await check('平稳局面(全员满血存活、非濒死、非内奸) → fast', function(){
    if(botReasoningLevel(mkGame(), 0) !== 'fast') throw new Error('实际 ' + botReasoningLevel(mkGame(), 0));
  });

  await check('濒死链进行中(phase=dying) → deep', function(){
    var g = mkGame({ phase: 'dying' });
    if(botReasoningLevel(g, 0) !== 'deep') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('濒死链进行中(pending.type=dying) → deep', function(){
    var g = mkGame({ pending: { type: 'dying' } });
    if(botReasoningLevel(g, 0) !== 'deep') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('身份局内奸座位 → deep(即使局面平稳)', function(){
    var g = mkGame({ gameMode: 'identity' });
    g.players[0].role = 'nei';
    if(botReasoningLevel(g, 0) !== 'deep') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('身份局非内奸(忠臣)且局面平稳 → 仍是 fast', function(){
    var g = mkGame({ gameMode: 'identity' });
    g.players[0].role = 'zhong';
    if(botReasoningLevel(g, 0) !== 'fast') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('非身份局的 role=nei 不触发 deep(gameMode 必须是 identity)', function(){
    var g = mkGame({ gameMode: 'ffa' });
    g.players[0].role = 'nei';
    if(botReasoningLevel(g, 0) !== 'fast') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('自己 hp<=1 → deep', function(){
    var g = mkGame(); g.players[0].hp = 1;
    if(botReasoningLevel(g, 0) !== 'deep') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('别人残血(hp=1)而自己满血 → normal(不是 fast 也不是 deep)', function(){
    var g = mkGame(); g.players[1].hp = 1;
    if(botReasoningLevel(g, 0) !== 'normal') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('有人已阵亡 → normal(局面不再平稳,但不到 deep)', function(){
    var g = mkGame(); g.players[2].alive = false; g.players[2].hp = 0;
    if(botReasoningLevel(g, 0) !== 'normal') throw new Error('实际 ' + botReasoningLevel(g, 0));
  });

  await check('botReasoningLevel 无副作用:连调两次结果一致且不改 g', function(){
    var g = mkGame();
    var snap = JSON.stringify(g);
    var a = botReasoningLevel(g, 0), b = botReasoningLevel(g, 0);
    if(a !== b) throw new Error('两次结果不一致');
    if(JSON.stringify(g) !== snap) throw new Error('botReasoningLevel 不应修改 g');
  });

  await check('非法输入安全回退 normal', function(){
    if(botReasoningLevel(null, 0) !== 'normal') throw new Error('g=null 应回退 normal');
    if(botReasoningLevel({}, 0) !== 'normal') throw new Error('无 players 应回退 normal');
  });

  // ---------- 2. normal 档 = 改动前逐字一致 ----------
  await check('normal 档四个预算值与改动前逐字一致(6/60/10/160)', function(){
    var b = BOT_REASONING_BUDGET.normal;
    if(b.recentLog !== 6) throw new Error('recentLog 应为 6,实际 ' + b.recentLog);
    if(b.otherGeneralDesc !== 60) throw new Error('otherGeneralDesc 应为 60,实际 ' + b.otherGeneralDesc);
    if(b.suspicionEvents !== 10) throw new Error('suspicionEvents 应为 10,实际 ' + b.suspicionEvents);
    if(b.maxTokensFloor !== 160) throw new Error('maxTokensFloor 应为 160,实际 ' + b.maxTokensFloor);
  });

  await check('botReasoningBudget 未知档位回退 normal', function(){
    var b = botReasoningBudget('nonexistent');
    if(b !== BOT_REASONING_BUDGET.normal) throw new Error('未知档位应回退 normal');
  });

  // ---------- 3. buildBotVisibleState 不传 level = normal ----------
  function gameWithLogs(n){
    var g = mkGame();
    g.log = [];
    for(var i=1;i<=n;i++) g.log.push({ seq:i, text:'关键事件'+i });
    g.aiSuspicionEvents = [];
    for(var j=1;j<=20;j++) g.aiSuspicionEvents.push({ round:j, source:0, target:1, amount:1, kind:'damage' });
    return g;
  }

  await check('不传 level → 与显式传 normal 的输出完全一致(既有调用点零变化)', function(){
    var g = gameWithLogs(30);
    var a = JSON.stringify(buildBotVisibleState(g, 0));
    var b = JSON.stringify(buildBotVisibleState(g, 0, false, 'normal'));
    if(a !== b) throw new Error('缺省档位必须等价于 normal');
  });

  await check('normal 档:recentLog=6 条、suspicionEvents=10 条(改动前的值)', function(){
    var s = buildBotVisibleState(gameWithLogs(30), 0, false, 'normal');
    if(s.recentLog.length !== 6) throw new Error('recentLog 应 6 条,实际 ' + s.recentLog.length);
    if(s.recentSuspicionEvents.length !== 10) throw new Error('suspicion 应 10 条,实际 ' + s.recentSuspicionEvents.length);
    if(s.recentLog[5] !== '关键事件30') throw new Error('末项应对齐最新一条');
  });

  // ---------- 4. fast/deep 实际生效 ----------
  await check('fast 档:recentLog 收窄到 4 条、suspicionEvents 收窄到 6 条', function(){
    var s = buildBotVisibleState(gameWithLogs(30), 0, false, 'fast');
    if(s.recentLog.length !== 4) throw new Error('recentLog 应 4 条,实际 ' + s.recentLog.length);
    if(s.recentSuspicionEvents.length !== 6) throw new Error('suspicion 应 6 条,实际 ' + s.recentSuspicionEvents.length);
    if(s.recentLog[3] !== '关键事件30') throw new Error('收窄后仍应保留最新一条(取的是尾部)');
  });

  await check('deep 档:recentLog 放宽到 10 条', function(){
    var s = buildBotVisibleState(gameWithLogs(30), 0, false, 'deep');
    if(s.recentLog.length !== 10) throw new Error('recentLog 应 10 条,实际 ' + s.recentLog.length);
    if(s.recentLog[9] !== '关键事件30') throw new Error('末项应对齐最新一条');
  });

  await check('fast 档 prompt 体积确实小于 normal,deep 确实大于 normal', function(){
    var g = gameWithLogs(30);
    var f = JSON.stringify(buildBotVisibleState(g, 0, false, 'fast')).length;
    var n = JSON.stringify(buildBotVisibleState(g, 0, false, 'normal')).length;
    var d = JSON.stringify(buildBotVisibleState(g, 0, false, 'deep')).length;
    if(!(f < n)) throw new Error('fast(' + f + ') 应小于 normal(' + n + ')');
    if(!(d > n)) throw new Error('deep(' + d + ') 应大于 normal(' + n + ')');
  });

  await check('他人 generalDesc 按档位截断,自己恒全量', function(){
    var longDesc = '这是一段刻意写得很长的武将技能描述文字'.repeat(10);
    GENERALS.__t133 = { name:'测试将', maxHp:4, skill:'测试技', desc: longDesc };
    var g = mkGame();
    g.players[0].general = '__t133';
    g.players[1].general = '__t133';
    try{
      var sFast = buildBotVisibleState(g, 0, false, 'fast');
      var sNorm = buildBotVisibleState(g, 0, false, 'normal');
      if(sNorm.players[1].generalDesc.length !== 60) throw new Error('normal 他人 desc 应 60 字,实际 ' + sNorm.players[1].generalDesc.length);
      if(sFast.players[1].generalDesc.length !== 40) throw new Error('fast 他人 desc 应 40 字,实际 ' + sFast.players[1].generalDesc.length);
      if(sFast.players[0].generalDesc.length !== longDesc.length) throw new Error('自己的 desc 应恒全量,不受档位影响');
    } finally { delete GENERALS.__t133; }
  });

  // ---------- 5. callAiChooseIndex maxTokens 下限随档位 ----------
  var calls = [];
  function installCallAI(text){
    calls = [];
    callAI = async function(provider, apiKey, opts){ calls.push(opts); return { ok:true, text:text }; };
  }
  aiApiKey = 'test-key'; aiProvider = 'claude'; aiApiModel = ''; aiApiModels = [];
  var cand3 = [{action:'a'},{action:'b'},{action:'c'}];

  await check('callAiChooseIndex 不传 reasoningLevel → maxTokens 下限仍是 160(零变化)', async function(){
    installCallAI('{"choice":1}');
    await callAiChooseIndex({ g: mkGame(), seat:0, candidates:cand3 });
    if(calls[0].maxTokens !== 160) throw new Error('期望 160,实际 ' + calls[0].maxTokens);
  });

  await check('callAiChooseIndex reasoningLevel=deep → maxTokens 下限抬到 280', async function(){
    installCallAI('{"choice":1}');
    await callAiChooseIndex({ g: mkGame(), seat:0, candidates:cand3, reasoningLevel:'deep' });
    if(calls[0].maxTokens !== 280) throw new Error('期望 280,实际 ' + calls[0].maxTokens);
  });

  await check('callAiChooseIndex reasoningLevel=fast → maxTokens 下限仍是 160', async function(){
    installCallAI('{"choice":1}');
    await callAiChooseIndex({ g: mkGame(), seat:0, candidates:cand3, reasoningLevel:'fast' });
    if(calls[0].maxTokens !== 160) throw new Error('期望 160,实际 ' + calls[0].maxTokens);
  });

  await check('调用方声明的更大 maxTokens 仍然优先(下限只是下限)', async function(){
    installCallAI('{"choice":1}');
    await callAiChooseIndex({ g: mkGame(), seat:0, candidates:cand3, reasoningLevel:'fast', maxTokens: 500 });
    if(calls[0].maxTokens !== 500) throw new Error('期望 500,实际 ' + calls[0].maxTokens);
  });

  // ---------- 6. 无密钥 / 候选上限不被触碰 ----------
  await check('无密钥:分档完全不参与,callAiChooseIndex 直接 return null', async function(){
    var saved = aiApiKey; aiApiKey = '';
    installCallAI('{"choice":1}');
    var idx = await callAiChooseIndex({ g: mkGame(), seat:0, candidates:cand3, reasoningLevel:'deep' });
    aiApiKey = saved;
    if(idx !== null) throw new Error('期望 null,实际 ' + idx);
    if(calls.length !== 0) throw new Error('无密钥不应产生 callAI');
  });

  await check('AI_PLAY_CANDIDATE_LIMIT 未被分档触碰(无密钥兜底共用这份候选,必须保持 25)', function(){
    if(AI_PLAY_CANDIDATE_LIMIT !== 25) throw new Error('候选上限应保持 25,实际 ' + AI_PLAY_CANDIDATE_LIMIT);
    var src = String(enumerateAllLegalOneStepActions);
    if(/reasoningLevel|botReasoningLevel|botReasoningBudget/.test(src))
      throw new Error('enumerateAllLegalOneStepActions 不应引用任何分档逻辑(会污染无密钥兜底路径)');
  });

  await check('buildBotKeyEvents 不传 limit → 仍是 6 条(既有调用点零变化)', function(){
    var g = gameWithLogs(30);
    if(buildBotKeyEvents(g).length !== 6) throw new Error('实际 ' + buildBotKeyEvents(g).length);
    if(buildBotKeyEvents(g, 4).length !== 4) throw new Error('显式 4 应得 4 条');
  });

  // ---------- 7. 破坏性验证 ----------
  await check('破坏性验证:把 fast 档预算改成与 normal 相同,收窄断言确实会红', function(){
    var saved = BOT_REASONING_BUDGET.fast;
    BOT_REASONING_BUDGET.fast = { recentLog:6, otherGeneralDesc:60, suspicionEvents:10, maxTokensFloor:160 };
    try{
      var s = buildBotVisibleState(gameWithLogs(30), 0, false, 'fast');
      if(s.recentLog.length === 4) throw new Error('破坏后仍是 4 条,说明断言没有鉴别力');
      if(s.recentLog.length !== 6) throw new Error('破坏后应变成 6 条,实际 ' + s.recentLog.length);
    } finally { BOT_REASONING_BUDGET.fast = saved; }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0){ throw new Error('CORE-133 测试有 ' + fail + ' 条失败'); }
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'core133-test.js' })
  .catch(function(e){ console.error('\n' + (e && e.message || e)); process.exit(1); });
