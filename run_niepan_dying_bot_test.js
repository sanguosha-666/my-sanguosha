/**
 * 修复:庞统【涅槃】在机器人自身濒死时无法被主动发动。
 *
 * 根因:bot.js 的 dyingBuildCandidates 只枚举了"打出【桃】救援"和"不出",完全没有把
 * "发动【涅槃】"纳入候选——即使当事人是庞统、拥有niepan能力、且这局还没用过涅槃、且
 * 当前正是自己被问(g.pending.seat===g.pending.asking===mySeat,涅槃唯一合法的发动
 * 时机,对齐 useNiepan 的服务端守卫)。
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

const sandbox = vm.createContext(context, { name: 'sgs-niepan-dying-sandbox' });

console.log('Loading 涅槃/dying 修复测试环境...\n');

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
console.log('  庞统【涅槃】濒死自救 机器人主动发动接线测试');
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

  aiApiKey = ''; aiProvider = null; // 全程无密钥模式(这次修复的目标场景)

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0(庞统)' : ('玩家' + i), alive: true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 1, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: (opt.equipsOf && opt.equipsOf[i]) || emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: (opt.generalOf && opt.generalOf[i]) || (i===0?'pangtong':'yuJi'),
        caps: (opt.capsOf && opt.capsOf[i]) || undefined,
        nirvanaUsed: (opt.nirvanaUsedOf && opt.nirvanaUsedOf[i]) || false
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'dying', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }

  // ================= 场景1:机器人庞统自身濒死,拥有涅槃且未使用过 =================
  await check('候选列表:自己濒死+庞统+niepan能力+未用过 应含发动【涅槃】选项', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    if(!d.some(function(c){ return c.niepan; })) throw new Error('候选列表缺少涅槃选项,实际 ' + JSON.stringify(d));
  });

  await check('dyingLocalFallback:没有桃时应优先选涅槃(不等死)', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, hands: { 0: [] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    var choice = dyingLocalFallback(g, 0, d);
    if(!choice || !choice.niepan) throw new Error('没有桃时应选涅槃,实际 ' + JSON.stringify(choice));
  });

  await check('dyingLocalFallback:有桃但手牌+装备很少(<=2)时也应选涅槃换满血摸3张', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, hands: { 0: [card('桃','p1','♥',6)] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    var choice = dyingLocalFallback(g, 0, d);
    if(!choice || !choice.niepan) throw new Error('手牌只有1张桃(<=2)时应选涅槃,实际 ' + JSON.stringify(choice));
  });

  await check('dyingLocalFallback:有桃且手牌+装备较多(>2)时应打桃而不是涅槃', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, hands: { 0: [card('桃','p1','♥',6), card('杀','p2','♠',7), card('闪','p3','♣',3)] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    var choice = dyingLocalFallback(g, 0, d);
    if(!choice || choice.niepan || !choice.save) throw new Error('手牌较多(>2)时应打桃救援,实际 ' + JSON.stringify(choice));
  });

  await check('dyingExecute选中涅槃:应调用useNiepan(),游戏状态正确推进', async function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, hands: { 0: [] }, equipsOf: { 0: Object.assign(emptyEquips(), { weapon: card('青龙偃月刀','w1') }) } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', resume: { type: 'sha' }, askedAt: Date.now() };
    _g = g;
    mySeat = 0;
    var d = dyingBuildCandidates(g, 0);
    var choice = dyingLocalFallback(g, 0, d);
    if(!choice || !choice.niepan) throw new Error('本场景应选中涅槃,实际 ' + JSON.stringify(choice));
    dyingExecute(g, 0, choice);
    var me = g.players[0];
    // 注意:测试场景牌堆deck为空,弃掉的装备会被ensureDeck洗回牌堆、又被drawN摸回手牌里
    // (真实规则本就如此,不是bug)——这里只断言"装备槽已清空"(装备离开了装备区),
    // 不断言手牌数量或内容(那受牌堆/弃牌堆构成影响,和这次要验证的涅槃效果无关)。
    if(me.equips.weapon !== null) throw new Error('装备应清空,实际 ' + JSON.stringify(me.equips));
    if(me.hp !== Math.min(me.maxHp, 3)) throw new Error('体力应回复至min(maxHp,3),实际 ' + me.hp);
    // 摸3张的目标数量受牌堆实际余量限制(这里牌堆/弃牌堆总量本就不足3张,不强求摸满),
    // 只断言 drawN 确实被调用过(手牌不再是发动前的空手牌)
    if(me.hand.length === 0) throw new Error('应摸到牌(drawN),实际手牌仍为空');
    if(me.nirvanaUsed !== true) throw new Error('nirvanaUsed应置真,实际 ' + me.nirvanaUsed);
    if(g.phase === 'dying') throw new Error('濒死流程应已结束,实际仍是 ' + g.phase);
  });

  // ================= 场景2:庞统已经用过涅槃 =================
  await check('候选列表:庞统已用过涅槃(nirvanaUsed=true)时不应再出现涅槃选项', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, nirvanaUsedOf: { 0: true }, hands: { 0: [] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    if(d.some(function(c){ return c.niepan; })) throw new Error('已用过涅槃不应再出现该选项,实际 ' + JSON.stringify(d));
  });

  // ================= 场景3:非庞统角色濒死 =================
  await check('候选列表:非庞统角色(无niepan能力)濒死时不应出现涅槃选项', function(){
    var g = mkSeatG({ n: 3, generalOf: { 0: 'yuJi' }, hands: { 0: [card('桃','p1')] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    if(d.some(function(c){ return c.niepan; })) throw new Error('非庞统不应出现涅槃选项,实际 ' + JSON.stringify(d));
    if(d.length !== 2) throw new Error('非庞统应只有桃/不出两个候选,实际 ' + JSON.stringify(d));
  });

  await check('候选列表:庞统救别人(d.seat!==seat)时不应出现涅槃选项(涅槃只能自救)', function(){
    var g = mkSeatG({ n: 3, capsOf: { 0: { niepan: true } }, hands: { 0: [card('桃','p1')] } });
    g.pending = { type: 'dying', seat: 1, asking: 0, cause: 'sha', askedAt: Date.now() };
    var d = dyingBuildCandidates(g, 0);
    if(d.some(function(c){ return c.niepan; })) throw new Error('救别人时不应出现涅槃选项,实际 ' + JSON.stringify(d));
  });

  // ================= 场景4:既有 dying 桃/不出逻辑不受影响(回归) =================
  await check('回归:BOT_DECISIONS.dying 对非庞统场景仍走原有桃/不出判断', async function(){
    window.__respondDyingCalls = [];
    var realFn = respondDying;
    respondDying = function(v){ window.__respondDyingCalls.push(v); return realFn(v); };
    var g = mkSeatG({ n: 3, generalOf: { 0: 'yuJi' }, hands: { 0: [card('桃','p1')] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', resume: { type: 'sha' }, askedAt: Date.now() };
    _g = g;
    mySeat = 0;
    await runBotDecision(g, 0);
    respondDying = realFn;
    if(window.__respondDyingCalls.length !== 1 || window.__respondDyingCalls[0] !== true)
      throw new Error('非庞统自救有桃应respondDying(true),实际 ' + JSON.stringify(window.__respondDyingCalls));
  });

  await check('回归:BOT_DECISIONS.dying 对无桃且无涅槃的场景仍走原有"不出"判断', async function(){
    window.__respondDyingCalls = [];
    var realFn = respondDying;
    respondDying = function(v){ window.__respondDyingCalls.push(v); return realFn(v); };
    var g = mkSeatG({ n: 3, generalOf: { 0: 'yuJi' }, hands: { 0: [] } });
    g.pending = { type: 'dying', seat: 0, asking: 0, cause: 'sha', resume: { type: 'sha' }, askedAt: Date.now() };
    _g = g;
    mySeat = 0;
    await runBotDecision(g, 0);
    respondDying = realFn;
    if(window.__respondDyingCalls.length !== 1 || window.__respondDyingCalls[0] !== false)
      throw new Error('无桃无涅槃应respondDying(false),实际 ' + JSON.stringify(window.__respondDyingCalls));
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
