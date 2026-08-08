/**
 * 修复审计清单(docs/bot-skill-coverage-audit.md)里剩余A类9条+C类"于吉蛊惑发动入口"1条:
 *  - 大乔【流离】(liuli)、小乔【天香】(tianxiang)、孔融【礼让】回收(lirangRecover)、
 *    孔融【争义】(zhengyi)、祝融【烈刃】发动+选牌(lieRenChoose/lieRenPickCard)、
 *    夏侯渊【神速1】/【神速2】(shensuChoose1/shensuChoose2)、张郃【巧变】回合开始
 *    (qiaobianTurnStart)——此前全部靠botSafePrompt兜底命中"不发动"类按钮,机器人从未
 *    主动发动过。
 *  - 于吉【蛊惑】(startGuhuo)——响应侧(guhuoQuestion/guhuoTarget)早就接线,这次只补
 *    发动入口:声明手牌为【杀】。
 *
 * 陈宫【明策】、法正【眩惑】的发动入口刻意不动(此前"机器人主动技能解锁"任务已经评估
 * 过的保守决策),这次测试不涉及它们。
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: { transaction: function(fn) { return fn(context.g || {}); } },
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
  setTimeout: function(f, t) { return setTimeout(f, t); },
  clearTimeout: function(t) { return clearTimeout(t); },
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-aclass-fix-sandbox' });

console.log('Loading A类/C类修复测试环境...\n');

const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  A类9条+C类蛊惑发动入口 机器人主动发动接线测试');
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

  aiApiKey = ''; aiProvider = null; // 全程无密钥模式(这批修复的目标场景)

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i), alive: true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }

  // ================= 大乔【流离】(liuli) =================
  await check('BOT_PHASE_ACTOR 已登记 liuli:to(此前已有,验证不受影响)', function(){
    if(BOT_PHASE_ACTOR.liuli !== 'to') throw new Error('应为to,实际 ' + BOT_PHASE_ACTOR.liuli);
  });
  await check('liuli:无密钥模式下机器人应主动发动流离(respondLiuli非null,转移目标)', async function(){
    window.__liuliCalls = [];
    var realFn = respondLiuli;
    respondLiuli = function(choice, t){ window.__liuliCalls.push([choice, t]); return realFn(choice, t); };
    var g = mkSeatG({ n: 3, hands: { 0: [card('闪')] } });
    g.phase = 'liuli';
    g.pending = { type: 'liuli', from: 1, to: 0, usedAs: '杀', shaColor: 'red', targets: [2], askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    respondLiuli = realFn;
    if(window.__liuliCalls.length !== 1 || !window.__liuliCalls[0][0] || window.__liuliCalls[0][1] !== 2)
      throw new Error('应发动流离转移给座位2,实际 ' + JSON.stringify(window.__liuliCalls));
  });
  await check('liuli askedAt:maybeStartLiuli创建时已正确设置(此前已有,验证不受影响)', function(){
    var g = mkSeatG({ n: 3 });
    g.players[0].caps = { liuli: true };
    g.players[0].hand = [card('闪')];
    _g = g;
    maybeStartLiuli(g, 1, 0, '杀', 'red', card('杀','sc1'));
    if(!g.pending || typeof g.pending.askedAt !== 'number') throw new Error('应带askedAt,实际 ' + JSON.stringify(g.pending));
  });

  // ================= 小乔【天香】(tianxiang) =================
  await check('tianxiang:无密钥模式下机器人应主动发动天香(respondTianxiang非null)', async function(){
    window.__tianxiangCalls = [];
    var realFn = respondTianxiang;
    respondTianxiang = function(choice, t){ window.__tianxiangCalls.push([choice, t]); return realFn(choice, t); };
    var g = mkSeatG({ n: 3, hands: { 0: [card('桃','p1','♥',6)] } });
    g.phase = 'tianxiang';
    g.pending = { type: 'tianxiang', seat: 0, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha', targets: [2], resume: { type: 'sha' }, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    respondTianxiang = realFn;
    if(window.__tianxiangCalls.length !== 1 || !window.__tianxiangCalls[0][0] || window.__tianxiangCalls[0][1] !== 2)
      throw new Error('应发动天香转移给座位2,实际 ' + JSON.stringify(window.__tianxiangCalls));
  });

  // ================= 孔融【礼让】回收(lirangRecover) =================
  await check('lirangRecover:无密钥模式下机器人应主动回收(respondLiRangRecover(true))', async function(){
    window.__lirangRecoverCalls = [];
    var realFn = respondLiRangRecover;
    respondLiRangRecover = function(v){ window.__lirangRecoverCalls.push(v); return realFn(v); };
    var g = mkSeatG({});
    g.phase = 'lirangRecover';
    g.pending = { type: 'lirangRecover', from: 0, to: 1, cards: [card('杀')], askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    respondLiRangRecover = realFn;
    if(window.__lirangRecoverCalls.length !== 1 || window.__lirangRecoverCalls[0] !== true)
      throw new Error('应respondLiRangRecover(true),实际 ' + JSON.stringify(window.__lirangRecoverCalls));
  });

  // ================= 孔融【争义】(zhengyi) =================
  await check('zhengyi:无密钥模式下机器人保守默认不发动(respondZhengyi(false))', async function(){
    window.__zhengyiCalls = [];
    var realFn = respondZhengyi;
    respondZhengyi = function(v){ window.__zhengyiCalls.push(v); return realFn(v); };
    var g = mkSeatG({});
    g.phase = 'zhengyi';
    g.pending = { type: 'zhengyi', seat: 1, asking: 0, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha', resume: { type: 'sha' }, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    respondZhengyi = realFn;
    if(window.__zhengyiCalls.length !== 1 || window.__zhengyiCalls[0] !== false)
      throw new Error('应respondZhengyi(false),实际 ' + JSON.stringify(window.__zhengyiCalls));
  });

  // ================= 祝融【烈刃】发动+选牌(lieRenChoose/lieRenPickCard) =================
  await check('BOT_PHASE_ACTOR 已登记 lieRenChoose:sourceSeat / lieRenPickCard:sourceSeat', function(){
    if(BOT_PHASE_ACTOR.lieRenChoose !== 'sourceSeat') throw new Error('lieRenChoose应为sourceSeat,实际 ' + BOT_PHASE_ACTOR.lieRenChoose);
    if(BOT_PHASE_ACTOR.lieRenPickCard !== 'sourceSeat') throw new Error('lieRenPickCard应为sourceSeat,实际 ' + BOT_PHASE_ACTOR.lieRenPickCard);
  });
  await check('lieRenChoose:无密钥模式下机器人应主动发动烈刃(triggerLieRen),推进到lieRenPickCard', async function(){
    var g = mkSeatG({ n: 3 });
    g.phase = 'lieRenChoose';
    g.pending = { type: 'lieRenChoose', sourceSeat: 0, targetSeat: 1, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    if(g.phase !== 'lieRenPickCard') throw new Error('应推进到lieRenPickCard,实际 ' + g.phase);
  });
  await check('lieRenPickCard askedAt:此前已修复,验证正确设置', function(){
    var g = mkSeatG({ n: 3 });
    g.phase = 'lieRenChoose';
    g.pending = { type: 'lieRenChoose', sourceSeat: 0, targetSeat: 1, askedAt: Date.now() - 100000 };
    _g = g;
    triggerLieRen();
    if(!g.pending || g.pending.type !== 'lieRenPickCard' || typeof g.pending.askedAt !== 'number')
      throw new Error('应带askedAt,实际 ' + JSON.stringify(g.pending));
  });
  await check('lieRenPickCard:无密钥模式下机器人应选点数最大的手牌', async function(){
    window.__pickLieRenCardCalls = [];
    var realFn = pickLieRenCard;
    pickLieRenCard = function(idx){ window.__pickLieRenCardCalls.push(idx); return realFn(idx); };
    var g = mkSeatG({ n: 3, hands: { 0: [card('杀','a','♠',3), card('闪','b','♥',9)] } });
    g.phase = 'lieRenPickCard';
    g.pending = { type: 'lieRenPickCard', sourceSeat: 0, targetSeat: 1, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    pickLieRenCard = realFn;
    if(window.__pickLieRenCardCalls.length !== 1 || window.__pickLieRenCardCalls[0] !== 1)
      throw new Error('应选下标1(点数9更大),实际 ' + JSON.stringify(window.__pickLieRenCardCalls));
  });

  // ================= 夏侯渊【神速1】/【神速2】(shensuChoose1/shensuChoose2) =================
  await check('BOT_PHASE_ACTOR 已登记 shensuChoose1:seat / shensuChoose2:seat(两个独立决策点)', function(){
    if(BOT_PHASE_ACTOR.shensuChoose1 !== 'seat') throw new Error('shensuChoose1应为seat,实际 ' + BOT_PHASE_ACTOR.shensuChoose1);
    if(BOT_PHASE_ACTOR.shensuChoose2 !== 'seat') throw new Error('shensuChoose2应为seat,实际 ' + BOT_PHASE_ACTOR.shensuChoose2);
  });
  await check('shensuChoose1:无密钥模式下机器人保守默认不发动(skipShensu1)', async function(){
    window.__skipShensu1Calls = 0;
    var realFn = skipShensu1;
    skipShensu1 = function(){ window.__skipShensu1Calls++; return realFn(); };
    var g = mkSeatG({});
    g.phase = 'shensuChoose1';
    g.pending = { type: 'shensuChoose1', seat: 0, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    skipShensu1 = realFn;
    if(window.__skipShensu1Calls !== 1) throw new Error('应调skipShensu1恰1次,实际 ' + window.__skipShensu1Calls);
  });
  await check('shensuChoose2:无密钥模式下机器人保守默认不发动(skipShensu2)', async function(){
    window.__skipShensu2Calls = 0;
    var realFn = skipShensu2;
    skipShensu2 = function(){ window.__skipShensu2Calls++; return realFn(); };
    var g = mkSeatG({});
    g.phase = 'shensuChoose2';
    g.pending = { type: 'shensuChoose2', seat: 0, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    skipShensu2 = realFn;
    if(window.__skipShensu2Calls !== 1) throw new Error('应调skipShensu2恰1次,实际 ' + window.__skipShensu2Calls);
  });

  // ================= 张郃【巧变】回合开始(qiaobianTurnStart) =================
  await check('BOT_PHASE_ACTOR 已登记 qiaobianTurnStart:seat', function(){
    if(BOT_PHASE_ACTOR.qiaobianTurnStart !== 'seat') throw new Error('应为seat,实际 ' + BOT_PHASE_ACTOR.qiaobianTurnStart);
  });
  await check('qiaobianTurnStart:无密钥模式下机器人保守默认不发动(qiaobianDecline)', async function(){
    window.__qiaobianDeclineCalls = 0;
    var realFn = qiaobianDecline;
    qiaobianDecline = function(){ window.__qiaobianDeclineCalls++; return realFn(); };
    var g = mkSeatG({ hands: { 0: [card('杀')] } });
    g.phase = 'qiaobianTurnStart';
    g.pending = { type: 'qiaobianTurnStart', seat: 0, askedAt: Date.now() };
    _g = g;
    await runBotDecision(g, 0);
    qiaobianDecline = realFn;
    if(window.__qiaobianDeclineCalls !== 1) throw new Error('应调qiaobianDecline恰1次,实际 ' + window.__qiaobianDeclineCalls);
  });

  // ================= 于吉【蛊惑】发动入口(startGuhuo,C类) =================
  await check('startGuhuo:无密钥模式下机器人应主动声明手牌为【杀】(有合法目标时)', async function(){
    window.__startGuhuoCalls = [];
    var realFn = startGuhuo;
    startGuhuo = function(idx, name){ window.__startGuhuoCalls.push([idx, name]); return realFn(idx, name); };
    var g = mkSeatG({ n: 3, hands: { 0: [card('酒','w1','♠',5)] } });
    g.players[0].caps = { guhuo: true };
    _g = g;
    await runBotDecision(g, 0);
    startGuhuo = realFn;
    if(window.__startGuhuoCalls.length !== 1 || window.__startGuhuoCalls[0][0] !== 0 || window.__startGuhuoCalls[0][1] !== '杀')
      throw new Error('应调startGuhuo(0,杀),实际 ' + JSON.stringify(window.__startGuhuoCalls));
    if(g.phase !== 'guhuoQuestion' && g.phase !== 'play') throw new Error('应推进离开play阶段的初始状态,实际 ' + g.phase + ' pending=' + JSON.stringify(g.pending));
  });
  await check('startGuhuo:没有合法目标时(所有人距离都够不着)不应发动', async function(){
    window.__startGuhuoCalls = [];
    var realFn = startGuhuo;
    startGuhuo = function(idx, name){ window.__startGuhuoCalls.push([idx, name]); return realFn(idx, name); };
    var g = mkSeatG({ n: 2, hands: { 0: [card('酒','w2','♠',5)] } });
    g.players[0].caps = { guhuo: true };
    g.players[1].equips.plus1 = { name: '的卢' }; // 距离拉到2,默认攻击范围1够不着
    _g = g;
    await runBotDecision(g, 0);
    startGuhuo = realFn;
    if(window.__startGuhuoCalls.length !== 0) throw new Error('没有合法目标不应发动,实际调用 ' + window.__startGuhuoCalls.length + ' 次');
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
})();
