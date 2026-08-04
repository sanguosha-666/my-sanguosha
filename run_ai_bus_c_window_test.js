/**
 * AI 总线 C0/C1 层测试 - isBotActionWindow / enumerateAllLegalOneStepActions /
 * runBotActionWindow(弱C出牌窗)
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot/ai-bot)
 * 进共享 vm 沙箱(与 run_ai_bus_l2_test.js 同一套 firebase/document/window stub
 * 与异步 check 断言惯例),在沙箱内直接调用新函数。
 * C0 覆盖:窗口谓词四态(play/turn/无pending 为真;有 pending、非 play、阵亡为假);
 * 杀按目标展开成多条候选;闪电 allowSelf 自目标;满血桃排除;结束项恒为最后。
 * C1 覆盖:候选带 localHeuristicScore(非结束数字、结束 null);localFallbackPlayWindow
 * 的"最高分>25 打、否则结束"旧规则复刻;弱C两步序列(调度1拆马→模拟回声→调度2杀,
 * 牌×目标合并、每调度恰1步);无密钥兜底(闪电20→endPlay、缺体力桃100→playCard)。
 *
 * 已知的 vm 坑:mySeat 是 game.js 顶层 let 绑定,加载后需 runInContext 里赋值;
 * CARD_PLAYS 的 canPlay/canTarget(杀的距离、闪电的 onlySelf)读取全局 mySeat,
 * 枚举函数内部会像 botPlay 一样临时借用 mySeat 再归还。aiApiKey/aiProvider 是
 * ai-bot.js 顶层 let,测试直接赋值切换有密钥/无密钥两档。
 */

const vm = require('vm');
const fs = require('fs');

// run_ai_bus_l2_test.js 的 firebase/document/window stub(同一套 harness)
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
  // SC2:vm 沙箱默认没有裸 setTimeout/clearTimeout(只有 window.setTimeout),而
  // executePlayWindowChoiceAwait 用裸标识符 → 必须在这里补,否则强C循环运行时 ReferenceError。
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

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-c0-sandbox' });

console.log('Loading AI 总线 C0 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前;bot.js 在 game.js 之后、
// ai-bot.js 之后殿后加载 render.js(G1 起 runBotDecision play 分支会走 seatPick,
// 其武圣/双雄 match 引用 render.js 的 resolveActionId/canShuangxiongDuelCard)。
const files = ['config.js', 'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      // 强C:gameRef.transaction 升级为 Promise 模式(真实 SDK 行为),tx 的 onCommitted 才会触发。
      // 逻辑仍同步执行(与旧 stub 一致);__txSnapshot 供测试覆盖"提交后快照",null=默认用
      // fn 的返回值(Firebase 提交成功后 snapshot.val()=提交后状态的语义)。tx 保持真实实现。
      vm.runInContext('gameRef = { __txSnapshot: null, transaction: function(fn){ var result = fn(typeof _g !== "undefined" ? _g : {}); var snap = gameRef.__txSnapshot !== null ? gameRef.__txSnapshot : result; return Promise.resolve({ snapshot: { val: function(){ return snap; } } }); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  AI 总线 C0/C1 测试(窗口谓词/一步枚举/弱C出牌窗)');
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

  // 构造 3 人局:座位0是机器人自己,手牌自定;座位1/2 均存活
  function mkG(hand, opt){
    opt = opt || {};
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: '玩家' + i,
        alive: i === 0 ? !(opt.deadSelf === true) : true,
        hp: i === 0 ? (opt.myHp !== undefined ? opt.myHp : 4) : 4,
        maxHp: 4,
        hand: i === 0 ? hand : [],
        equips: emptyEquips(),
        delays: i === 0 ? (opt.myDelays || []) : [],
        isBot: i === 0,
        role: opt.roleOf ? opt.roleOf[i] : 'zhu'
      });
    }
    var g = {
      players: players,
      gameMode: opt.gameMode || 'ffa',
      roundNum: 1,
      phase: opt.phase !== undefined ? opt.phase : 'play',
      turn: opt.turn !== undefined ? opt.turn : 0,
      pending: opt.pending !== undefined ? opt.pending : null,
      log: []
    };
    return g;
  }
  function card(name, id){
    return { id: id || (name + ''), name: name, suit: '♥', rank: 5 };
  }
  // T2 截断专用:6 人局(自己+5 个存活目标),机器人座位0,全员 role 'zhu' 无嫌疑值
  // (botTargetScore 对杀/拆桥目标恒 -Infinity,便于构造"唯一最高分=桃"的场景)
  function mkG6(hand, opt){
    opt = opt || {};
    var players = [];
    for(var i = 0; i < 6; i++){
      players.push({
        name: '玩家' + i,
        alive: i === 0 ? !(opt.deadSelf === true) : true,
        hp: i === 0 ? (opt.myHp !== undefined ? opt.myHp : 4) : 4,
        maxHp: 4,
        hand: i === 0 ? hand : [],
        equips: emptyEquips(),
        delays: [],
        isBot: i === 0,
        role: opt.roleOf ? opt.roleOf[i] : 'zhu'
      });
    }
    var g = {
      players: players,
      gameMode: opt.gameMode || 'ffa',
      roundNum: 1,
      phase: opt.phase !== undefined ? opt.phase : 'play',
      turn: opt.turn !== undefined ? opt.turn : 0,
      pending: opt.pending !== undefined ? opt.pending : null,
      log: []
    };
    return g;
  }

  // ---- T1~T4:窗口谓词四态 ----
  await check('play 窗:phase=play/turn=0/无pending → true', function(){
    var g = mkG([]);
    if(!isBotActionWindow(g, 0)) throw new Error('应返回 true,实际 false');
  });

  await check('play 窗:有 pending → false', function(){
    var g = mkG([], { pending: { type: 'wuxie', asking: 0 } });
    if(isBotActionWindow(g, 0)) throw new Error('有 pending 应返回 false');
  });

  await check('play 窗:phase!=play(如 discard) → false', function(){
    var g = mkG([], { phase: 'discard' });
    if(isBotActionWindow(g, 0)) throw new Error('非 play 阶段应返回 false');
  });

  await check('play 窗:自己已阵亡 → false', function(){
    var g = mkG([], { deadSelf: true });
    if(isBotActionWindow(g, 0)) throw new Error('阵亡应返回 false');
  });

  // ---- T5:杀按目标展开 ----
  // 手牌 [杀,无中生有]:杀可分别打座位1/2(无马/武器,距离1≤射程1),展开成2条;
  // 无中生有是无目标牌 1 条;加结束项共 4 条。
  await check('枚举:杀展开为每目标一条候选(带 target/handIndex),无目标牌单条,结束项最后', function(){
    var g = mkG([card('杀'), card('无中生有')]);
    var list = enumerateAllLegalOneStepActions(g, 0);
    var sha = list.filter(function(c){ return c.action === '杀'; });
    if(sha.length !== 2) throw new Error('杀应展开为2条候选(目标1/2),实际 ' + sha.length + ' ' + JSON.stringify(list));
    var targets = sha.map(function(c){ return c.target; }).sort();
    if(targets.join(',') !== '1,2') throw new Error('杀候选目标应为座位1和2,实际 ' + targets.join(','));
    sha.forEach(function(c){
      if(c.handIndex !== 0) throw new Error('杀候选 handIndex 应为0,实际 ' + c.handIndex);
      if(c.card === null || c.card.name !== '杀') throw new Error('杀候选应带牌面,实际 ' + JSON.stringify(c.card));
      if(typeof c.label !== 'string' || c.label.indexOf('杀') < 0) throw new Error('杀候选应带中文 label,实际 ' + c.label);
    });
    var wzs = list.filter(function(c){ return c.action === '无中生有'; });
    if(wzs.length !== 1 || wzs[0].target !== null || wzs[0].handIndex !== 1)
      throw new Error('无中生有应为单条无目标候选 handIndex=1,实际 ' + JSON.stringify(wzs));
    if(list.length !== 4) throw new Error('共应4条(2杀+无中生有+结束),实际 ' + list.length);
    var end = list[list.length - 1];
    if(!end.isEndPlay || end.action !== '结束出牌阶段') throw new Error('最后一项应为结束出牌阶段,实际 ' + JSON.stringify(end));
  });

  // ---- T6:闪电 allowSelf 自目标(onlySelf 延时锦囊,判定区无同名) ----
  await check('枚举:闪电在手中且自己判定区无闪电 → 候选目标为自己(0)', function(){
    var g = mkG([card('闪电')]);
    var list = enumerateAllLegalOneStepActions(g, 0);
    var sd = list.filter(function(c){ return c.action === '闪电'; });
    if(sd.length !== 1) throw new Error('闪电应有且仅有1条候选,实际 ' + sd.length + ' ' + JSON.stringify(list));
    if(sd[0].target !== 0 || sd[0].seat !== 0) throw new Error('闪电目标应为自己(0),实际 ' + JSON.stringify(sd[0]));
    if(sd[0].handIndex !== 0) throw new Error('闪电 handIndex 应为0,实际 ' + sd[0].handIndex);
  });

  // ---- T7:桃 满血排除、缺体力纳入 ----
  await check('枚举:满血时桃不在候选;缺体力时桃在候选', function(){
    var gFull = mkG([card('桃')], { myHp: 4 });
    var listFull = enumerateAllLegalOneStepActions(gFull, 0);
    if(listFull.some(function(c){ return c.action === '桃'; })) throw new Error('满血不应出现桃,实际 ' + JSON.stringify(listFull));
    var gWound = mkG([card('桃')], { myHp: 2 });
    var listWound = enumerateAllLegalOneStepActions(gWound, 0);
    var tao = listWound.filter(function(c){ return c.action === '桃'; });
    if(tao.length !== 1 || tao[0].target !== null) throw new Error('缺体力应出现桃候选,实际 ' + JSON.stringify(listWound));
  });

  // ---- T8:结束项恒为最后且 isEndPlay:true ----
  await check('枚举:空手牌时只有结束项,isEndPlay=true 且 handIndex/card/target 为 null', function(){
    var g = mkG([]);
    var list = enumerateAllLegalOneStepActions(g, 0);
    if(list.length !== 1) throw new Error('空手牌应只有1条(结束),实际 ' + list.length + ' ' + JSON.stringify(list));
    var end = list[0];
    if(end.isEndPlay !== true || end.action !== '结束出牌阶段') throw new Error('结束项字段不对,实际 ' + JSON.stringify(end));
    if(end.handIndex !== null || end.card !== null || end.target !== null) throw new Error('结束项应无牌无目标,实际 ' + JSON.stringify(end));
  });

  // ================= SC1:tx/playCard/endPlay 可选提交回调(强C前置) =================
  // 此段必须放在 C1 的 playCard/endPlay spy 替换之前,调用的是 game.js 真实实现;
  // tx 保持真实实现(加载时不再被 spy 替换),gameRef.transaction 是 Promise 模式 stub。
  // ---- T13:tx(fn,onCommitted) → 回调收到提交后快照(含变更) ----
  await check('SC1:tx 带 onCommitted → 回调收到提交快照(含 x=1)', async function(){
    _g = {};
    window.__committed = null;
    var p = tx(function(g){ g.x = 1; return g; }, function(newG){ window.__committed = newG; });
    if(!p || typeof p.then !== 'function') throw new Error('tx 应返回 Promise,实际 ' + p);
    await Promise.resolve(); await Promise.resolve(); // 等微任务链(onCommitted 经 p.then 触发)
    if(!window.__committed) throw new Error('onCommitted 从未被调用');
    if(window.__committed.x !== 1) throw new Error('快照应含 x=1,实际 ' + JSON.stringify(window.__committed));
  });

  // ---- T14:不传 onCommitted → 无回调、无异常(既有调用回归) ----
  await check('SC1:tx 不带 onCommitted → 无回调、无异常', async function(){
    _g = {};
    window.__committed = null;
    var threw = false;
    try { tx(function(g){ g.y = 2; return g; }); } catch(e){ threw = true; }
    if(threw) throw new Error('不传 onCommitted 不应抛异常');
    await Promise.resolve(); await Promise.resolve();
    if(window.__committed !== null) throw new Error('不传 onCommitted 不应有回调');
  });

  // ---- T15:playCard(0,'桃',null,onCommitted) → 回调收到提交后快照(手牌已变) ----
  await check('SC1:playCard 带 onCommitted → 快照手牌已出桃、体力+1', async function(){
    _g = mkG([card('桃')], { myHp: 2 });
    window.__committed = null;
    playCard(0, '桃', null, function(newG){ window.__committed = newG; });
    await Promise.resolve(); await Promise.resolve();
    if(!window.__committed) throw new Error('onCommitted 从未被调用');
    if(!window.__committed.players || window.__committed.players[0].hand.length !== 0)
      throw new Error('快照手牌应为空(桃已打出),实际 ' + JSON.stringify(window.__committed.players && window.__committed.players[0].hand));
    if(window.__committed.players[0].hp !== 3) throw new Error('快照体力应 2→3,实际 ' + window.__committed.players[0].hp);
  });

  // ---- T16:endPlay(onCommitted) → 回调被调用(phase 已推进) ----
  await check('SC1:endPlay 带 onCommitted → 回调收到快照(phase 已推进到 discard)', async function(){
    _g = mkG([]);
    window.__committed = null;
    endPlay(function(newG){ window.__committed = newG; });
    await Promise.resolve(); await Promise.resolve();
    if(!window.__committed) throw new Error('onCommitted 从未被调用');
    if(window.__committed.phase !== 'discard') throw new Error('快照 phase 应为 discard,实际 ' + window.__committed.phase);
  });

  // ================= C1:弱C出牌窗 =================
  // ---- spy:playCard/endPlay(函数声明绑定,整体替换即可,与 l2 同一套) ----
  // SC2:替换前先保存真实引用(提交失败测试需要真实 playCard 走 tx 的 reject→onCommitted(null))
  window.__realPlayCard = playCard;
  window.__realEndPlay = endPlay;
  window.__playCalls = [];
  window.__endPlayCalls = 0;
  playCard = function(cardIdx, action, target){ window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target }); };
  endPlay = function(){ window.__endPlayCalls++; };
  // ---- mock callAI:结果从队列里取 ----
  window.__mockAiCalls = 0;
  window.__mockAiResults = [];
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    return window.__mockAiResults.length ? window.__mockAiResults.shift() : { ok: false, reason: 'other', detail: '队列已空' };
  };

  // ---- T9:localHeuristicScore 合并候选打分(非结束数字、结束 null) ----
  // mkG 全员 role='zhu' 且无嫌疑值 → botTargetScore 对杀的目标恒 -Infinity(忠臣式保守),
  // typeof 检查仍应通过;桃无目标分=botCardPriority(桃)=100。
  await check('枚举:非结束候选 localHeuristicScore 为数字,结束项为 null', function(){
    var g = mkG([card('桃'), card('杀')], { myHp: 2 });
    var list = enumerateAllLegalOneStepActions(g, 0);
    var end = list[list.length - 1];
    if(end.localHeuristicScore !== null) throw new Error('结束项 localHeuristicScore 应为 null,实际 ' + end.localHeuristicScore);
    list.filter(function(c){ return !c.isEndPlay; }).forEach(function(c){
      if(typeof c.localHeuristicScore !== 'number') throw new Error('非结束候选应有数字分,实际 ' + JSON.stringify(c));
    });
    var tao = list.filter(function(c){ return c.action === '桃'; });
    if(tao.length !== 1 || tao[0].localHeuristicScore !== 100) throw new Error('桃价值应为100,实际 ' + JSON.stringify(tao));
    var shaSelf = list.filter(function(c){ return c.action === '杀' && c.target === 2; });
    if(shaSelf.length === 1 && typeof shaSelf[0].localHeuristicScore !== 'number') throw new Error('杀候选也应有数字分');
  });

  // ---- T10:localFallbackPlayWindow 旧规则复刻(最高分>25 打、否则结束) ----
  await check('兜底:最高分>25 → 选该候选', function(){
    var c1 = { label: 'a', localHeuristicScore: 30 };
    var c2 = { label: 'b', localHeuristicScore: 10 };
    var end = { label: '结束出牌阶段', localHeuristicScore: null, isEndPlay: true };
    var pick = localFallbackPlayWindow({}, 0, [c1, c2, end]);
    if(pick !== c1) throw new Error('应选30分候选,实际 ' + JSON.stringify(pick));
  });

  await check('兜底:最高分<=25 → 结束项', function(){
    var c1 = { label: 'a', localHeuristicScore: 20 };
    var end = { label: '结束出牌阶段', localHeuristicScore: null, isEndPlay: true };
    var pick = localFallbackPlayWindow({}, 0, [c1, end]);
    if(!pick.isEndPlay) throw new Error('应选结束项,实际 ' + JSON.stringify(pick));
  });

  await check('兜底:全部 -Infinity(身份保守无合法目标)→ 结束项', function(){
    var c1 = { label: 'a', localHeuristicScore: -Infinity };
    var end = { label: '结束出牌阶段', localHeuristicScore: null, isEndPlay: true };
    var pick = localFallbackPlayWindow({}, 0, [c1, end]);
    if(!pick.isEndPlay) throw new Error('应选结束项,实际 ' + JSON.stringify(pick));
  });

  // ---- T11:弱C两步序列(有密钥)——调度1拆马 → 模拟回声 → 调度2杀 ----
  // 座位1装 +1马(的卢):初始 杀→座位1 距离2>射程1 非法;过河拆桥无距离限制合法。
  // 第1步候选:[0]拆桥→1,[1]拆桥→2,[2]杀→2,[3]结束。mock 选 0 → playCard(拆桥,1)。
  // 手动模拟 Firebase 回声:拆桥从手牌摘掉、+1马被拆清空、turn 不变;第2步候选:
  // [0]杀→1,[1]杀→2,[2]结束。mock 选 0 → playCard(杀,1)。证明弱C跨调度多步、牌×目标合并。
  await check('弱C两步序列:调度1拆桥→调度2杀(跨调度多步,合并候选)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiResults = [
      { ok: true, text: '{"choice":0}' },
      { ok: true, text: '{"choice":0}' }
    ];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('过河拆桥'), card('杀')]);
    g.players[1].equips.plus1 = card('的卢');
    // 调度1
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('第1步应恰1次 playCard,实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    var first = window.__playCalls[0];
    if(first.action !== '过河拆桥') throw new Error('第1步应出过河拆桥,实际 ' + first.action);
    if(first.target !== 1) throw new Error('第1步目标应为座位1,实际 ' + first.target);
    if(window.__mockAiCalls !== 1) throw new Error('第1步应恰1次AI调用(合并候选只问一次),实际 ' + window.__mockAiCalls);
    // 模拟 Firebase 回声(弱C:同 tick 内 currentG 不会更新,见 runBotActionWindow 注释)
    g.players[0].hand.splice(0, 1);
    g.players[1].equips.plus1 = null;
    // 调度2
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 2) throw new Error('两步共应2次 playCard,实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    var second = window.__playCalls[1];
    if(second.action !== '杀') throw new Error('第2步应出杀,实际 ' + second.action);
    if(second.target !== 1) throw new Error('第2步目标应为座位1,实际 ' + second.target);
    if(window.__mockAiCalls !== 2) throw new Error('两步共应2次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__endPlayCalls !== 0) throw new Error('两步均不应 endPlay,实际 ' + window.__endPlayCalls);
  });

  // ---- T12:无密钥兜底(旧 botPlay 的 value>25 规则逐字复刻) ----
  await check('无密钥:手牌[闪电](价值20) → endPlay', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkG([card('闪电')]);
    await runBotDecision(g, 0);
    if(window.__endPlayCalls !== 1) throw new Error('endPlay 应恰1次,实际 ' + window.__endPlayCalls);
    if(window.__playCalls.length !== 0) throw new Error('不应 playCard,实际 ' + JSON.stringify(window.__playCalls));
  });

  await check('无密钥:手牌[桃]缺体力(价值100) → playCard 桃', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkG([card('桃')], { myHp: 2 });
    await runBotDecision(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('playCard 应恰1次,实际 ' + window.__playCalls.length);
    if(window.__playCalls[0].action !== '桃') throw new Error('应出桃,实际 ' + window.__playCalls[0].action);
    if(window.__playCalls[0].target !== null) throw new Error('桃无目标,实际 target=' + window.__playCalls[0].target);
    if(window.__endPlayCalls !== 0) throw new Error('不应 endPlay');
  });

  // ================= SC2:强C同窗多步循环(有密钥)+提交回调等待 =================
  // bot.js 顶层 let(BOT_COMMIT_TIMEOUT_MS)与 aiApiKey 同款 vm 坑:裸标识符赋值才命中;
  // 缩小到 50ms 让"spy 不调 onCommitted → 超时兜底"路径快速结束,不用等真实 5s。
  BOT_COMMIT_TIMEOUT_MS = 50;
  // 默认恢复 dumb spy(记录但不调 onCommitted → 走超时兜底路径);强C两步测试单独换
  // smart spy(onCommitted 用测试驱动的演化快照)。callAI mock 升级为记录 userPrompt。
  playCard = function(cardIdx, action, target){ window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target }); };
  endPlay = function(){ window.__endPlayCalls++; };
  window.__mockAiPrompts = [];
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiPrompts.push(opts && opts.userPrompt || '');
    return window.__mockAiResults.length ? window.__mockAiResults.shift() : { ok: false, reason: 'other', detail: '队列已空' };
  };

  // ---- T17:强C两步(一次调度内 拆桥→杀,提交回调驱动循环) ----
  // g1 手牌 [过河拆桥,杀],座位1装 +1马(的卢):初始 杀→1 距离2>射程1 非法;
  // mock AI 序列 step1 选拆桥、step2 选杀。测试用 __simG 闭包维护演化态:
  // smart spy 每次提交后"拆桥已结算(摘牌+拆马)/杀已打出(摘牌)"再深拷贝出新引用快照,
  // 交给 onCommitted——不依赖真实锦囊效果/无懈/pick 机制(确定性)。
  // 注意:快照必须每次是"新引用"(JSON 深拷贝),否则 newG===lastG 会被循环判成
  // "提交没产生新状态"而 break,两步永远走不完——stripUndefined 原地返回同一对象,
  // 默认快照(=fn 返回值)在这里恰好是陷阱。
  await check('强C两步:一次 runBotActionWindow 内 拆桥→杀 连续两步(windowStep 0/1)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiPrompts = [];
    window.__mockAiResults = [
      { ok: true, text: '{"choice":0}' },
      { ok: true, text: '{"choice":0}' }
    ];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g1 = mkG([card('过河拆桥'), card('杀')]);
    g1.players[1].equips.plus1 = card('的卢');
    window.__simG = JSON.parse(JSON.stringify(g1));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target });
      var sim = window.__simG;
      if(action === '过河拆桥'){ sim.players[0].hand.splice(cardIdx, 1); sim.players[1].equips.plus1 = null; }
      else { sim.players[0].hand.splice(cardIdx, 1); }
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    await runBotActionWindow(g1, 0);
    if(window.__playCalls.length !== 2) throw new Error('应恰2次 playCard(拆桥→杀),实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    if(window.__playCalls[0].action !== '过河拆桥' || window.__playCalls[0].target !== 1) throw new Error('第1步应拆桥→座位1,实际 ' + JSON.stringify(window.__playCalls[0]));
    if(window.__playCalls[1].action !== '杀' || window.__playCalls[1].target !== 1) throw new Error('第2步应杀→座位1(马已拆,距离1合法),实际 ' + JSON.stringify(window.__playCalls[1]));
    if(window.__mockAiCalls !== 2) throw new Error('应恰2次AI询问,实际 ' + window.__mockAiCalls);
    if(window.__mockAiPrompts[0].indexOf('"windowStep":0') < 0) throw new Error('第1次AI应 windowStep=0,实际 ' + window.__mockAiPrompts[0].slice(0, 150));
    if(window.__mockAiPrompts[1].indexOf('"windowStep":1') < 0) throw new Error('第2次AI应 windowStep=1,实际 ' + window.__mockAiPrompts[1].slice(0, 150));
    if(window.__endPlayCalls !== 1) throw new Error('手牌打空后应自然走到结束出牌(恰1次endPlay),实际 ' + window.__endPlayCalls);
  });

  // ---- T18:endPlay 终止(choice.isEndPlay → 循环 break,不再枚举/询问) ----
  await check('endPlay 终止:mock 选结束 → endPlay 执行后循环 break,不再枚举/询问', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiPrompts = [];
    window.__mockAiResults = [ { ok: true, text: '{"choice":3}' } ]; // 杀→1,杀→2,桃,结束 → 结束=3
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('杀'), card('桃')], { myHp: 2 });
    await runBotActionWindow(g, 0);
    if(window.__endPlayCalls !== 1) throw new Error('endPlay 应恰1次,实际 ' + window.__endPlayCalls);
    if(window.__playCalls.length !== 0) throw new Error('不应 playCard,实际 ' + JSON.stringify(window.__playCalls));
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI询问(选完结束即停),实际 ' + window.__mockAiCalls);
  });

  // ---- T19:快照失效 break(提交回调快照 turn 已变 → isBotActionWindow false → break) ----
  await check('快照失效 break:提交回调快照 turn 已变 → 循环 break,不执行下一步', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiPrompts = [];
    window.__mockAiResults = [ { ok: true, text: '{"choice":0}' } ];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG([card('杀'), card('桃')], { myHp: 2 });
    var next = JSON.parse(JSON.stringify(g));
    next.turn = 1; // 模拟别人操作插入:窗口失效
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target });
      if(onCommitted) onCommitted(next);
    };
    await runBotActionWindow(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('应恰1次 playCard(第2步窗口失效不再执行),实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI询问,实际 ' + window.__mockAiCalls);
  });

  // ---- T20:提交失败 break(真实 playCard + gameRef.transaction 拒绝 → onCommitted(null)) ----
  // 走真实 tx 链路:stub transaction 返回 Promise.reject → tx 的 rejection 分支 onCommitted(null)
  // → executePlayWindowChoiceAwait resolve(null) → newG null → break,不挂死。
  await check('提交失败 break:transaction 拒绝 → onCommitted(null) → 循环 break 不挂死', async function(){
    window.__mockAiCalls = 0;
    window.__mockAiPrompts = [];
    window.__mockAiResults = [ { ok: true, text: '{"choice":0}' } ];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    playCard = window.__realPlayCard; // 真实 playCard:onCommitted 经 tx 的 reject 收到 null
    var g = mkG([card('桃'), card('杀')], { myHp: 2 });
    _g = JSON.parse(JSON.stringify(g));
    gameRef = { transaction: function(fn){ fn(_g); return Promise.reject(new Error('模拟提交失败')); } };
    await runBotActionWindow(g, 0);
    if(_g.players[0].hand.length !== 1) throw new Error('真实 playCard 应已打出桃(手牌2→1),实际 ' + _g.players[0].hand.length);
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI询问(提交失败后 break,不再问第2次),实际 ' + window.__mockAiCalls);
    // 恢复 Promise stub(卫生)
    gameRef = { __txSnapshot: null, transaction: function(fn){ var result = fn(typeof _g !== "undefined" ? _g : {}); var snap = gameRef.__txSnapshot !== null ? gameRef.__txSnapshot : result; return Promise.resolve({ snapshot: { val: function(){ return snap; } } }); } };
  });

  // ---- T21:无密钥只执行一步(弱C逐字:fallback 一步,不等待提交、不循环) ----
  await check('无密钥:只执行一步(fallback),不等待提交、不循环(弱C逐字一致)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    playCard = function(cardIdx, action, target){ window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target }); };
    endPlay = function(){ window.__endPlayCalls++; };
    aiApiKey = '';
    aiProvider = null;
    var g = mkG([card('桃')], { myHp: 2 });
    await runBotActionWindow(g, 0);
    if(window.__playCalls.length !== 1) throw new Error('应恰1次 playCard(桃,价值100),实际 ' + window.__playCalls.length + ' ' + JSON.stringify(window.__playCalls));
    if(window.__playCalls[0].action !== '桃') throw new Error('应出桃,实际 ' + window.__playCalls[0].action);
    if(window.__endPlayCalls !== 0) throw new Error('不应 endPlay,实际 ' + window.__endPlayCalls);
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应询问AI,实际 ' + window.__mockAiCalls);
  });

  // ---- T22:maxSteps(AI 永不选结束、快照持续有效 → 恰 8 步后停) ----
  await check('maxSteps:AI 永不选结束、快照持续有效 → 恰 8 步后停(BOT_WINDOW_MAX_STEPS)', async function(){
    window.__playCalls = [];
    window.__endPlayCalls = 0;
    window.__mockAiCalls = 0;
    window.__mockAiPrompts = [];
    var manySha = [];
    for(var s = 0; s < 8; s++){ manySha.push(card('杀', 'sha' + s)); }
    window.__mockAiResults = [];
    for(var r = 0; r < 8; r++){ window.__mockAiResults.push({ ok: true, text: '{"choice":0}' }); }
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG(manySha);
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action, target: target });
      var sim = window.__simG;
      sim.players[0].hand.splice(cardIdx, 1);
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    await runBotActionWindow(g, 0);
    if(window.__playCalls.length !== 8) throw new Error('应恰8次 playCard(maxSteps 截断),实际 ' + window.__playCalls.length);
    if(window.__mockAiCalls !== 8) throw new Error('应恰8次AI询问,实际 ' + window.__mockAiCalls);
    if(window.__endPlayCalls !== 0) throw new Error('AI 未选结束,不应 endPlay,实际 ' + window.__endPlayCalls);
  });

  // ================= T2:候选 Top-K=25 截断(token 优化) =================
  // ---- T23:30+ 原始候选 → 截断到 25+结束=26,结束项恒在末尾 ----
  // 构造:5 杀(连弩无限杀,6人局里杀只能打相邻的座位1/5 → 每张2条=10条)
  //       + 5 过河拆桥(无距离限制,5个目标 → 每张5条=25条) = 35 条原始候选。
  await check('T2截断:35条原始候选 → 返回恰26条(25+结束),最后一条 isEndPlay', function(){
    var hand = [];
    for(var s = 0; s < 5; s++){ hand.push(card('杀', 'sha' + s)); }
    for(var d = 0; d < 5; d++){ hand.push(card('过河拆桥', 'chai' + d)); }
    var g = mkG6(hand);
    g.players[0].equips.weapon = card('诸葛连弩'); // unlimitedSha:5张杀都可出
    var list = enumerateAllLegalOneStepActions(g, 0);
    if(list.length !== 26) throw new Error('35条原始候选应截断为25+结束=26条,实际 ' + list.length + ' ' + JSON.stringify(list.map(function(c){ return c.action; })));
    list.forEach(function(c, i){
      if(c.isEndPlay && i !== list.length - 1) throw new Error('结束项应只在末尾,实际出现在第' + i + '位');
    });
    var end = list[list.length - 1];
    if(!end.isEndPlay || end.action !== '结束出牌阶段' || end.localHeuristicScore !== null)
      throw new Error('最后一条应为结束出牌阶段且分值为 null,实际 ' + JSON.stringify(end));
  });

  // ---- T24:Top-1 恒在(唯一最高分候选=桃,截断后仍在) ----
  // 同 T23 场景加一张桃(缺体力,价值100);杀/拆桥目标分恒 -Infinity → 桃是唯一最高分,
  // 截断后必须保留(否则"按分截断"就是错的)。
  await check('T2截断:Top-1(桃100分)在截断结果里,且是非结束候选中最高分', function(){
    var hand = [];
    for(var s = 0; s < 5; s++){ hand.push(card('杀', 'sha' + s)); }
    for(var d = 0; d < 5; d++){ hand.push(card('过河拆桥', 'chai' + d)); }
    hand.push(card('桃'));
    var g = mkG6(hand, { myHp: 2 });
    g.players[0].equips.weapon = card('诸葛连弩');
    var list = enumerateAllLegalOneStepActions(g, 0);
    var tao = null;
    list.forEach(function(c){ if(c.action === '桃' && c.target === null) tao = c; });
    if(!tao) throw new Error('Top-1 桃候选应仍在截断结果里,实际 ' + JSON.stringify(list.map(function(c){ return c.action; })));
    var maxScore = -Infinity;
    list.forEach(function(c){ if(!c.isEndPlay) maxScore = Math.max(maxScore, c.localHeuristicScore); });
    if(maxScore !== tao.localHeuristicScore) throw new Error('桃应为截断后最高分,实际 max=' + maxScore + ' 桃=' + tao.localHeuristicScore);
  });

  // ---- T25:无密钥兜底零变化——fallback 在截断列表上选 Top-1,与未截断一致 ----
  // 桃是唯一最高分(>25):未截断的36条里 fallback 选桃,截断后的26条里同样选桃。
  await check('T2截断:localFallbackPlayWindow 在截断列表上选 Top-1(桃),与未截断一致', function(){
    var hand = [];
    for(var s = 0; s < 5; s++){ hand.push(card('杀', 'sha' + s)); }
    for(var d = 0; d < 5; d++){ hand.push(card('过河拆桥', 'chai' + d)); }
    hand.push(card('桃'));
    var g = mkG6(hand, { myHp: 2 });
    g.players[0].equips.weapon = card('诸葛连弩');
    var list = enumerateAllLegalOneStepActions(g, 0);
    var pick = localFallbackPlayWindow(g, 0, list);
    if(!pick || pick.action !== '桃' || pick.target !== null)
      throw new Error('fallback 应选桃(100分>25,截断前后同选),实际 ' + JSON.stringify(pick));
  });

  // ---- T26:少候选(<26)不截断——全部保留 + 结束项 ----
  await check('T2截断:10条原始候选(5拆桥×2目标)不截断 → 11条(10+结束)', function(){
    var hand = [];
    for(var d = 0; d < 5; d++){ hand.push(card('过河拆桥', 'chai' + d)); }
    var g = mkG(hand); // 3人局:拆桥可打座位1/2 → 每张2条 = 10条
    var list = enumerateAllLegalOneStepActions(g, 0);
    if(list.length !== 11) throw new Error('10条原始候选应全部保留+结束=11条,实际 ' + list.length);
    var chai = list.filter(function(c){ return c.action === '过河拆桥'; });
    if(chai.length !== 10) throw new Error('应有10条拆桥候选,实际 ' + chai.length);
    var end = list[list.length - 1];
    if(!end.isEndPlay || end.action !== '结束出牌阶段') throw new Error('最后一条应为结束出牌阶段,实际 ' + JSON.stringify(end));
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
