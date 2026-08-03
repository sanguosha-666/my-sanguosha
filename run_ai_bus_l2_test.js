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
  // SC2:runBotActionWindow 强C循环的 executePlayWindowChoiceAwait 用裸 setTimeout/clearTimeout,
  // vm 沙箱默认没有(只有 window.setTimeout)→ 必须补,否则走到出牌窗的测试 ReferenceError。
  setTimeout: function(f, t) { return setTimeout(f, t); },
  clearTimeout: function(t) { return clearTimeout(t); },
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
  // ---- spy:discardCards/pickResolve/endTurn(L2 弃牌/拆顺,同为函数声明绑定) ----
  window.__discardCalls = [];
  window.__pickCalls = [];
  window.__endTurnCalls = 0;
  discardCards = function(cardIdxList){ window.__discardCalls.push(cardIdxList.slice()); };
  pickResolve = function(choice){ window.__pickCalls.push(choice); };
  endTurn = function(){ window.__endTurnCalls++; };
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
        isBot: i === 0,
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

  // ---- T7~T12:L2 弃牌组合/拆顺选牌(座位0机器人,经 runBotDecision 全链路) ----
  // 弃牌:4张手牌 hp=2 → need=2;默认组合=末尾[2,3](桃/杀),价值升序变体=[0,1](闪/酒)
  function mkDiscardG(hand, hp){
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: true, hp: i === 0 ? hp : 4, maxHp: 4,
        hand: i === 0 ? hand : [],
        equips: emptyEquips(), delays: [],
        isBot: i === 0,
        role: 'zhu'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'discard', turn: 0, log: [], pending: null, started: true };
  }
  // 拆顺:座位1是目标(可选手牌/装备/判定区),pending 标准结构 {type:'pick',from:0,to:1}
  function mkPickG(targetHand, targetEquips, targetDelays){
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: true, hp: 4, maxHp: 4,
        hand: i === 1 ? (targetHand || []) : [],
        equips: i === 1 ? (targetEquips || emptyEquips()) : emptyEquips(),
        delays: i === 1 ? (targetDelays || []) : [],
        isBot: i === 0,
        role: 'zhu'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'pick', turn: 1, log: [], pending: { type: 'pick', trick: '顺手牵羊', from: 0, to: 1 }, started: true };
  }

  await check('弃牌无密钥:默认弃末尾 need 张(与旧算法一致)→ discardCards([2,3])', async function(){
    window.__discardCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkDiscardG([card('闪'), card('酒'), card('桃'), card('杀')], 2);
    await runBotDecision(g, 0);
    if(window.__discardCalls.length !== 1) throw new Error('discardCards 应被调1次,实际 ' + window.__discardCalls.length);
    if(window.__discardCalls[0].join(',') !== '2,3') throw new Error('应弃默认末尾[2,3](桃/杀),实际 ' + JSON.stringify(window.__discardCalls[0]));
  });

  await check('弃牌有密钥:默认组合必在场+去重+每组合恰need张+下标升序;mock选变体→参数匹配', async function(){
    window.__discardCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkDiscardG([card('闪'), card('酒'), card('桃'), card('杀')], 2);
    var cands = BOT_DECISIONS.discardSubset.buildCandidates(g, 0);
    if(!cands[0] || cands[0].isDefault !== true) throw new Error('候选0应为默认组合,实际 ' + JSON.stringify(cands[0]));
    if(cands[0].discardIndices.join(',') !== '2,3') throw new Error('默认组合应为[2,3],实际 ' + cands[0].discardIndices.join(','));
    if(cands.length < 2 || cands.length > 20) throw new Error('候选数应在2~20,实际 ' + cands.length);
    var keys = cands.map(function(c){ return c.discardIndices.join(','); });
    if(new Set(keys).size !== keys.length) throw new Error('候选组合应去重,实际 ' + JSON.stringify(keys));
    cands.forEach(function(c){
      if(c.discardIndices.length !== 2) throw new Error('每组都应恰好 need 张,实际 ' + JSON.stringify(c.discardIndices));
      var sorted = c.discardIndices.slice().sort(function(a,b){ return a - b; });
      if(c.discardIndices.join(',') !== sorted.join(',')) throw new Error('下标应升序,实际 ' + c.discardIndices.join(','));
      if(typeof c.label !== 'string' || c.label.length === 0) throw new Error('应带中文 label,实际 ' + JSON.stringify(c));
    });
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__discardCalls.length !== 1) throw new Error('discardCards 应被调1次,实际 ' + window.__discardCalls.length);
    if(window.__discardCalls[0].join(',') !== '0,1') throw new Error('AI应选价值升序变体[0,1](闪/酒),实际 ' + JSON.stringify(window.__discardCalls[0]));
  });

  await check('弃牌无需求:手牌<=hp → endTurn,不走 discardCards', async function(){
    window.__endTurnCalls = 0;
    window.__discardCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkDiscardG([card('杀'), card('闪')], 4);
    await runBotDecision(g, 0);
    if(window.__endTurnCalls !== 1) throw new Error('endTurn 应被调1次,实际 ' + window.__endTurnCalls);
    if(window.__discardCalls.length !== 0) throw new Error('不应 discardCards');
  });

  await check('拆顺无密钥:目标有手牌+装备+判定区 → 本地回退选 hand', async function(){
    window.__pickCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var e = emptyEquips(); e.weapon = card('青龙偃月刀');
    var g = mkPickG([card('杀')], e, [card('乐不思蜀')]);
    await runBotDecision(g, 0);
    if(window.__pickCalls.length !== 1) throw new Error('pickResolve 应被调1次,实际 ' + window.__pickCalls.length);
    if(window.__pickCalls[0] !== 'hand') throw new Error('应选 hand,实际 ' + window.__pickCalls[0]);
  });

  await check('拆顺无密钥:目标无手牌有+1马 → 本地回退选装备槽 plus1', async function(){
    window.__pickCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var e = emptyEquips(); e.plus1 = card('的卢');
    var g = mkPickG([], e, []);
    await runBotDecision(g, 0);
    if(window.__pickCalls.length !== 1) throw new Error('pickResolve 应被调1次,实际 ' + window.__pickCalls.length);
    if(window.__pickCalls[0] !== 'plus1') throw new Error('应选 plus1,实际 ' + window.__pickCalls[0]);
  });

  await check('拆顺有密钥:mock 选判定区 → pickResolve("delay:0")', async function(){
    window.__pickCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":2}' }]; // [0]=hand [1]=武器 [2]=判定区
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var e = emptyEquips(); e.weapon = card('青龙偃月刀');
    var g = mkPickG([card('杀')], e, [card('乐不思蜀')]);
    var cands = BOT_DECISIONS.pickSlot.buildCandidates(g, 0);
    if(cands.length !== 3) throw new Error('应有3个候选(手牌/武器/判定区),实际 ' + cands.length + ' ' + JSON.stringify(cands.map(function(c){return c.pickKey;})));
    if(cands[2].pickKey !== 'delay:0') throw new Error('候选2应为判定区,实际 ' + cands[2].pickKey);
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__pickCalls.length !== 1) throw new Error('pickResolve 应被调1次,实际 ' + window.__pickCalls.length);
    if(window.__pickCalls[0] !== 'delay:0') throw new Error('AI应选 delay:0,实际 ' + window.__pickCalls[0]);
  });

  // ---- T13~T18:响应类三兄弟(guicai/ganglie/guhuo)收敛进 BOT_DECISIONS ----
  // 统一构造"机器人座位0正被询问"的对局:phase/pending 按各阶段服务端真实结构
  // (guicai: {type:'guicai',asking,seat,judgeCard,resume};ganglieChoice:
  // {type:'ganglieChoice',sourceSeat,seat,resume};guhuoQuestion:
  // {type:'guhuoQuestion',asking,sourceSeat,claimedCard,actualCard})
  function mkRespG(base){
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: true, hp: 4, maxHp: 4,
        hand: i === 0 ? (base.myHand || []) : [],
        equips: emptyEquips(), delays: [],
        isBot: i === 0,
        role: 'zhu'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, turn: 1, log: [], started: true, phase: base.phase, pending: base.pending };
  }
  // spy:respondGuicai/respondGanglieChoice/respondGuhuoQuestion(函数声明绑定,整体替换)
  window.__guicaiCalls = [];
  window.__ganglieCalls = [];
  window.__guhuoCalls = [];
  respondGuicai = function(useReplace, cardIdx){ window.__guicaiCalls.push({ useReplace: useReplace, cardIdx: cardIdx }); };
  respondGanglieChoice = function(action, picks){ window.__ganglieCalls.push({ action: action, picks: picks }); };
  respondGuhuoQuestion = function(question){ window.__guhuoCalls.push({ question: question }); };

  await check('鬼才无密钥:回退不发动 → respondGuicai(false,null)', async function(){
    window.__guicaiCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkRespG({ phase: 'guicai', myHand: [card('桃'), card('杀')],
      pending: { type: 'guicai', asking: 0, seat: 1, judgeCard: card('判定牌', 'jdg'), resume: { kind: 'bagua', type: 'sha' } } });
    await runBotDecision(g, 0);
    if(window.__guicaiCalls.length !== 1) throw new Error('respondGuicai 应被调1次,实际 ' + window.__guicaiCalls.length);
    if(window.__guicaiCalls[0].useReplace !== false) throw new Error('应不发动,实际 ' + JSON.stringify(window.__guicaiCalls[0]));
    if(window.__guicaiCalls[0].cardIdx !== null) throw new Error('应 handIndex=null,实际 ' + JSON.stringify(window.__guicaiCalls[0]));
  });

  await check('鬼才有密钥:候选=不发动+每张手牌;mock 选第1张(choice1) → respondGuicai(true,0)', async function(){
    window.__guicaiCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkRespG({ phase: 'guicai', myHand: [card('桃'), card('杀')],
      pending: { type: 'guicai', asking: 0, seat: 1, judgeCard: card('判定牌', 'jdg'), resume: { kind: 'bagua', type: 'sha' } } });
    var spec = BOT_DECISIONS.guicaiHandPick; // 旧代码无此注册项,undefined → RED
    if(!spec) throw new Error('BOT_DECISIONS.guicaiHandPick 未注册');
    if(!spec.match(g, 0)) throw new Error('被问座位 match 应命中');
    if(spec.match(g, 1)) throw new Error('非被问座位 match 不应命中');
    var cands = spec.buildCandidates(g, 0);
    if(cands.length !== 3) throw new Error('候选应为 不发动+2手牌 共3项,实际 ' + cands.length);
    if(cands[0].replace !== false || cands[0].handIndex !== null) throw new Error('候选0应 replace=false,实际 ' + JSON.stringify(cands[0]));
    if(cands[1].replace !== true || cands[1].handIndex !== 0) throw new Error('候选1应 replace=true/handIndex=0,实际 ' + JSON.stringify(cands[1]));
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__guicaiCalls.length !== 1) throw new Error('respondGuicai 应被调1次,实际 ' + window.__guicaiCalls.length);
    if(window.__guicaiCalls[0].useReplace !== true || window.__guicaiCalls[0].cardIdx !== 0)
      throw new Error('应发动且用第0张手牌,实际 ' + JSON.stringify(window.__guicaiCalls[0]));
  });

  await check('刚烈无密钥:手牌>=2 → respondGanglieChoice("discard",[0,1])', async function(){
    window.__ganglieCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkRespG({ phase: 'ganglieChoice', myHand: [card('杀'), card('闪'), card('桃')],
      pending: { type: 'ganglieChoice', sourceSeat: 0, seat: 1, resume: { kind: 'ganglieJudge' } } });
    await runBotDecision(g, 0);
    if(window.__ganglieCalls.length !== 1) throw new Error('respondGanglieChoice 应被调1次,实际 ' + window.__ganglieCalls.length);
    var c = window.__ganglieCalls[0];
    if(c.action !== 'discard' || c.picks.join(',') !== '0,1') throw new Error('应弃[0,1],实际 ' + JSON.stringify(c));
  });

  await check('刚烈无密钥:手牌<2 → respondGanglieChoice("damage",[])', async function(){
    window.__ganglieCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkRespG({ phase: 'ganglieChoice', myHand: [card('杀')],
      pending: { type: 'ganglieChoice', sourceSeat: 0, seat: 1, resume: { kind: 'ganglieJudge' } } });
    await runBotDecision(g, 0);
    if(window.__ganglieCalls.length !== 1) throw new Error('respondGanglieChoice 应被调1次,实际 ' + window.__ganglieCalls.length);
    var c = window.__ganglieCalls[0];
    if(c.action !== 'damage' || c.picks.length !== 0) throw new Error('应受伤,实际 ' + JSON.stringify(c));
  });

  await check('刚烈有密钥:mock 选弃置(choice1) → respondGanglieChoice("discard",[0,1])', async function(){
    window.__ganglieCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkRespG({ phase: 'ganglieChoice', myHand: [card('杀'), card('闪'), card('桃')],
      pending: { type: 'ganglieChoice', sourceSeat: 0, seat: 1, resume: { kind: 'ganglieJudge' } } });
    var cands = BOT_DECISIONS.ganglieChoice.buildCandidates(g, 0);
    if(cands.length !== 2) throw new Error('手牌>=2 应2个候选,实际 ' + cands.length + ' ' + JSON.stringify(cands));
    if(cands[0].discard !== false || cands[1].discard !== true) throw new Error('候选顺序应为[受伤,弃置],实际 ' + JSON.stringify(cands));
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__ganglieCalls.length !== 1) throw new Error('respondGanglieChoice 应被调1次,实际 ' + window.__ganglieCalls.length);
    var c = window.__ganglieCalls[0];
    if(c.action !== 'discard' || c.picks.join(',') !== '0,1') throw new Error('AI应选弃置[0,1],实际 ' + JSON.stringify(c));
  });

  await check('刚烈有密钥:手牌<2 仅1候选 → 无AI调用直接受伤', async function(){
    window.__ganglieCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkRespG({ phase: 'ganglieChoice', myHand: [card('杀')],
      pending: { type: 'ganglieChoice', sourceSeat: 0, seat: 1, resume: { kind: 'ganglieJudge' } } });
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 0) throw new Error('单候选不应AI调用,实际 ' + window.__mockAiCalls);
    if(window.__ganglieCalls.length !== 1) throw new Error('respondGanglieChoice 应被调1次,实际 ' + window.__ganglieCalls.length);
    if(window.__ganglieCalls[0].action !== 'damage') throw new Error('应受伤,实际 ' + JSON.stringify(window.__ganglieCalls[0]));
  });

  await check('蛊惑无密钥:respondGuhuoQuestion 被调1次且参数为布尔(固定30%随机)', async function(){
    window.__guhuoCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkRespG({ phase: 'guhuoQuestion', myHand: [card('闪')],
      pending: { type: 'guhuoQuestion', asking: 0, sourceSeat: 1, claimedCard: card('杀'), actualCard: { id: 'hid', name: '无中生有', suit: '♠', rank: 9 } } });
    await runBotDecision(g, 0);
    if(window.__guhuoCalls.length !== 1) throw new Error('respondGuhuoQuestion 应被调1次,实际 ' + window.__guhuoCalls.length);
    if(typeof window.__guhuoCalls[0].question !== 'boolean') throw new Error('参数应为布尔,实际 ' + JSON.stringify(window.__guhuoCalls[0]));
  });

  await check('蛊惑有密钥:mock 质疑(choice1) → respondGuhuoQuestion(true);userPrompt 含声明名不含真实牌', async function(){
    window.__guhuoCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkRespG({ phase: 'guhuoQuestion', myHand: [card('闪')],
      pending: { type: 'guhuoQuestion', asking: 0, sourceSeat: 1, claimedCard: card('杀'), actualCard: { id: 'hid', name: '无中生有', suit: '♠', rank: 9 } } });
    var cands = BOT_DECISIONS.guhuoQuestion.buildCandidates(g, 0);
    if(cands.length !== 2) throw new Error('应2个候选,实际 ' + cands.length);
    if(cands[0].question !== false || cands[1].question !== true) throw new Error('候选顺序应为[不质疑,质疑],实际 ' + JSON.stringify(cands));
    await runBotDecision(g, 0);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__guhuoCalls.length !== 1) throw new Error('respondGuhuoQuestion 应被调1次,实际 ' + window.__guhuoCalls.length);
    if(window.__guhuoCalls[0].question !== true) throw new Error('应质疑,实际 ' + JSON.stringify(window.__guhuoCalls[0]));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('杀') < 0) throw new Error('userPrompt 应含声明牌名(杀),实际 ' + up);
    if(up.indexOf('无中生有') >= 0) throw new Error('userPrompt 泄露真实牌(无中生有)!实际 ' + up);
  });

  // ---- T19~T21:L3 最小集(闪电/铁索纳入候选,借刀保持排除) ----
  // 闪电:onlySelf 延时锦囊(合法目标只有自己)。botBestTarget 跳过自己(i===seat)返回 -1,
  // 靠 botPlay 枚举的 allowSelf 自目标兜底把 target 定为自己的座位。用有密钥路径验证:
  // mock 选闪电(choice0);选目标阶段 buildBotTargetCandidates 不含自己(候选为空,不再
  // 发起第二次AI询问),chosen.target 保持枚举阶段算好的 0 → playCard(idx,'闪电',0)。
  // 无密钥路径刻意不测:本地兜底要求 options[0].value>25,闪电基础分20 不会触发(手牌
  // 只有闪电时无密钥机器人直接结束出牌阶段——既有行为,不是本次改动范围)。
  await check('闪电:可打出时出现在候选且目标为自己 → playCard("闪电",0)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }]; // [0=闪电, 1=结束]
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('闪电')]);
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('playCard 应被调1次(闪电),实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    if(window.__playCalls[0].action !== '闪电') throw new Error('应出闪电,实际 ' + window.__playCalls[0].action);
    if(window.__playCalls[0].target !== 0) throw new Error('闪电目标应为自己(0),实际 target=' + window.__playCalls[0].target);
    if(window.__mockAiCalls !== 1) throw new Error('选目标候选为空应不再询问,实际 ' + window.__mockAiCalls + '次');
    if(window.__endPlayCalls !== 0) throw new Error('不应 endPlay');
  });

  await check('铁索连环:可打出时出现在候选且目标为他人 → playCard("铁索连环",1)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }]; // 合并候选 [0=铁索→座位1, 1=铁索→座位2, 2=结束]
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('铁索连环')]);
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('playCard 应被调1次(铁索),实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    if(window.__playCalls[0].action !== '铁索连环') throw new Error('应出铁索连环,实际 ' + window.__playCalls[0].action);
    if(window.__playCalls[0].target !== 1) throw new Error('铁索目标应为座位1,实际 target=' + window.__playCalls[0].target);
    // C1 弱C起 runBotDecision 的 play 分支改走 runBotActionWindow(牌×目标合并成完整候选),
    // 旧 botPlay 的"先问牌、再问目标"两次询问被消灭为一次——这条断言的语义随 C1 更新。
    if(window.__mockAiCalls !== 1) throw new Error('合并候选应只问1次,实际 ' + window.__mockAiCalls + '次');
  });

  await check('借刀杀人:两步流程接管(不走 playCard 候选,阶段A挂起等下一调度)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('借刀杀人')]);
    // 座位1 持武器(青龙偃月刀 range3),可够到座位2 → canPlay 若不被排除必为真
    var e1 = emptyEquips(); e1.weapon = card('青龙偃月刀');
    g.players[1].equips = e1;
    botTwoStepA = null;
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 0) throw new Error('借刀杀人不应出现在候选,实际 ' + JSON.stringify(window.__playCalls));
    // L3 起借刀由 jiedaoTwoStep 两步流程接管:阶段A选中合法A后本地挂起,等下一调度走阶段B,
    // 不结束出牌、不经 playCard —— 取代旧的"排除后直接 endPlay"(行为变化,见 T4 报告)。
    if(window.__endPlayCalls !== 0) throw new Error('阶段A挂起期间不应 endPlay,实际 endPlay=' + window.__endPlayCalls);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'jiedaoTwoStep' || botTwoStepA.a !== 1)
      throw new Error('应挂起 botTwoStepA={jiedaoTwoStep,a:1},实际 ' + JSON.stringify(botTwoStepA));
    botTwoStepA = null;
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
