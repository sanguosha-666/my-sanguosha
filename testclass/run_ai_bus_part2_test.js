/**
 * AI 总线 Part2 测试 - 机器人主动发动"start*"技能(天义/强袭/乱武/乱击/奋迅)
 *
 * 只测这次新增的最小场景:证明"从不发动"变成"能发动",不追求覆盖多步流程的所有分支。
 * 复用 run_ai_bus_l3_test.js 的加载/沙箱/mkSeatG/card/spy 惯例。
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

// 【A2】断线重连测试需要"第二个沙箱=页面刷新"来验证模块级 let 状态回退,故把沙箱
// 构建/加载抽成可复用函数:buildSandbox() 每次产出全新 JS 作用域(模拟刷新后 JS 全量
// 重载),loadAll(sb) 按 index.html 顺序加载全部脚本。storage stub 每次新建(浏览器刷新
// 时 sessionStorage/localStorage 实际保留,但本测试锁定的契约是"游戏态不靠 storage
// 恢复",见 A2 验证块注释)。
function buildSandbox(){
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
  return vm.createContext(context, { name: 'sgs-ai-bus-l3-sandbox' });
}

const sandbox = buildSandbox();

console.log('Loading AI 总线 L3 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot-ai-bus.js 在 bot.js 之前(TDZ:const BOT_DECISIONS
// 必须先于注册项);ai-bot.js 最后、render.js 殿后。
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
function loadAll(sb){
  files.forEach(function(file){
    try {
      const code = fs.readFileSync(file, 'utf8');
      vm.runInContext(code, sb, { filename: file });
      console.log('  OK ' + file);
      if (file === 'game.js') {
        vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sb);
        vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sb);
        vm.runInContext('mySeat = 0;', sb);
      }
    } catch (e) {
      console.log('  FAIL ' + file + ': ' + e.message);
      if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
      process.exit(1);
    }
  });
}
loadAll(sandbox);

console.log('\n' + '='.repeat(60));
console.log('  AI 总线 Part2 测试(天义/强袭/乱武/乱击/奋迅 主动发动)');
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

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: opt.aliveOf ? opt.aliveOf[i] !== false : true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4, maxHp: 4,
        hand: i === 0 ? (opt.myHand || []) : (opt.hands ? (opt.hands[i] || []) : []),
        equips: emptyEquips(), delays: opt.delaysOf ? (opt.delaysOf[i] || []) : [],
        isBot: i === 0,
        role: null,
        general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    var g = { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true, discard: [], deck: [] };
    if(opt.caps0) players[0].caps = opt.caps0;
    return g;
  }
  function card(name, id, suit, rank){
    return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 };
  }

  aiApiKey = ''; aiProvider = null; // 全程无密钥模式:只证明本地兜底能主动发动
  // 沙箱顶层只有 window.setTimeout,裸 setTimeout 未定义;runBotActionWindow(负例场景
  // 落回的兜底路径)和 scheduleBotTurn 内部用的是裸 setTimeout,照抄 l3 测试同款接法。
  setTimeout = window.setTimeout; clearTimeout = window.clearTimeout;
  // tx() 在本沙箱里操作的是全局 _g(见 loadAll 里的 tx stub),不是调用参数——直接调用
  // 真实的 start*/pick* 函数(而不是只 spy 服务函数)前必须先把 _g 指向当前测试的 g。

  // ================= 太史慈【天义】 =================
  await check('天义:有技能+目标有手牌+手牌≥2 → startTianyi 被调,进入 tianyiPickCard', async function(){
    window.__startTianyiCalls = 0;
    var realStart = startTianyi;
    startTianyi = function(){ window.__startTianyiCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { tianyi: true }, myHand: [card('杀','t1','♠',5), card('闪','t2','♥',6)], hands: { 1: [card('桃','h1')] } });
    _g = g;
    await runBotDecision(g, 0);
    startTianyi = realStart;
    if(window.__startTianyiCalls !== 1) throw new Error('startTianyi 应被调1次,实际 ' + window.__startTianyiCalls);
    if(g.phase !== 'tianyiPickCard') throw new Error('应进入 tianyiPickCard,实际 ' + g.phase);
  });

  await check('天义:手牌不足2张 → 不发动', async function(){
    window.__startTianyiCalls = 0;
    var realStart = startTianyi;
    startTianyi = function(){ window.__startTianyiCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { tianyi: true }, myHand: [card('杀','t1')], hands: { 1: [card('桃','h1')] } });
    _g = g;
    await runBotDecision(g, 0);
    startTianyi = realStart;
    if(window.__startTianyiCalls !== 0) throw new Error('手牌不足2张不应发动,实际调用 ' + window.__startTianyiCalls + ' 次');
  });

  await check('天义:tianyiPickCard 选点数最大牌;tianyiPickTarget 选有手牌的目标', function(){
    var g = mkSeatG({ myHand: [card('杀','a','♠',3), card('闪','b','♥',9)] });
    _g = g;
    g.phase = 'tianyiPickCard';
    g.pending = { type: 'tianyiPickCard', seat: 0 };
    window.__pickTianyiCardCalls = [];
    var realPick = pickTianyiCard;
    pickTianyiCard = function(idx){ window.__pickTianyiCardCalls.push(idx); return realPick(idx); };
    return runBotDecision(g, 0).then(function(){
      pickTianyiCard = realPick;
      if(window.__pickTianyiCardCalls.length !== 1 || window.__pickTianyiCardCalls[0] !== 1)
        throw new Error('应选下标1(点数9更大),实际 ' + JSON.stringify(window.__pickTianyiCardCalls));
    });
  });

  await check('天义:tianyiPickTarget 只在有手牌的目标里选', function(){
    var g = mkSeatG({ hands: { 1: [], 2: [card('杀','c')] } });
    _g = g;
    g.phase = 'tianyiPickTarget';
    g.pending = { type: 'tianyiPickTarget', seat: 0, cardIdx: 0 };
    window.__pickTianyiTargetCalls = [];
    var realPick = pickTianyiTarget;
    pickTianyiTarget = function(cardIdx, seat){ window.__pickTianyiTargetCalls.push([cardIdx, seat]); };
    return runBotDecision(g, 0).then(function(){
      pickTianyiTarget = realPick;
      if(window.__pickTianyiTargetCalls.length !== 1) throw new Error('应被调1次,实际 ' + window.__pickTianyiTargetCalls.length);
      if(window.__pickTianyiTargetCalls[0][1] !== 2) throw new Error('座位1无手牌,应选座位2,实际 ' + JSON.stringify(window.__pickTianyiTargetCalls[0]));
    });
  });

  // ================= 典韦【强袭】 =================
  await check('强袭:攻击范围内有目标+可弃武器 → startQiangxi 被调', async function(){
    window.__startQiangxiCalls = 0;
    var realStart = startQiangxi;
    startQiangxi = function(){ window.__startQiangxiCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { qiangxi: true }, myHand: [{ id:'w1', name:'诸葛连弩' }] });
    _g = g;
    await runBotDecision(g, 0);
    startQiangxi = realStart;
    if(window.__startQiangxiCalls !== 1) throw new Error('startQiangxi 应被调1次,实际 ' + window.__startQiangxiCalls);
    if(g.phase !== 'qiangxiChooseCost') throw new Error('应进入 qiangxiChooseCost,实际 ' + g.phase);
  });

  await check('强袭:无武器可弃且体力不足(<=2) → 不发动', async function(){
    window.__startQiangxiCalls = 0;
    var realStart = startQiangxi;
    startQiangxi = function(){ window.__startQiangxiCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { qiangxi: true }, hpOf: { 0: 2 }, myHand: [card('杀','s1')] });
    _g = g;
    await runBotDecision(g, 0);
    startQiangxi = realStart;
    if(window.__startQiangxiCalls !== 0) throw new Error('无武器+体力不足不应发动,实际调用 ' + window.__startQiangxiCalls + ' 次');
  });

  // ================= 贾诩【乱武】 =================
  await check('乱武:有其他存活角色 → startLuanwu 被调,进入 luanwuChoose', async function(){
    window.__startLuanwuCalls = 0;
    var realStart = startLuanwu;
    startLuanwu = function(){ window.__startLuanwuCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { luanwu: true } });
    _g = g;
    await runBotDecision(g, 0);
    startLuanwu = realStart;
    if(window.__startLuanwuCalls !== 1) throw new Error('startLuanwu 应被调1次,实际 ' + window.__startLuanwuCalls);
    if(g.phase !== 'luanwuChoose') throw new Error('应进入 luanwuChoose,实际 ' + g.phase);
  });

  // ================= 袁绍【乱击】 =================
  await check('乱击:有同花色牌对+≥2其他存活角色 → startLuanji 被调,进入 luanjiChoose', async function(){
    window.__startLuanjiCalls = 0;
    var realStart = startLuanji;
    startLuanji = function(){ window.__startLuanjiCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { luanji: true }, myHand: [card('杀','p1','♠',3), card('闪','p2','♠',7)] });
    _g = g;
    await runBotDecision(g, 0);
    startLuanji = realStart;
    if(window.__startLuanjiCalls !== 1) throw new Error('startLuanji 应被调1次,实际 ' + window.__startLuanjiCalls);
    if(g.phase !== 'luanjiChoose') throw new Error('应进入 luanjiChoose,实际 ' + g.phase);
  });

  await check('乱击:只有1名其他存活角色 → 不发动(2张牌打1个人不划算)', async function(){
    window.__startLuanjiCalls = 0;
    var realStart = startLuanji;
    startLuanji = function(){ window.__startLuanjiCalls++; return realStart(); };
    var g = mkSeatG({ n: 2, caps0: { luanji: true }, myHand: [card('杀','p1','♠',3), card('闪','p2','♠',7)] });
    _g = g;
    await runBotDecision(g, 0);
    startLuanji = realStart;
    if(window.__startLuanjiCalls !== 0) throw new Error('只有1名其他存活角色不应发动,实际调用 ' + window.__startLuanjiCalls + ' 次');
  });

  // ================= 丁奉【奋迅】 =================
  await check('奋迅:有杀+存在够不着的目标(目标带+1马) → startFenxun 被调,进入 fenxunDiscard', async function(){
    window.__startFenxunCalls = 0;
    var realStart = startFenxun;
    startFenxun = function(){ window.__startFenxunCalls++; return realStart(); };
    // 3人局默认距离都是1(存活环上最近间隔,攻击范围默认1恰好够到),给座位1装上
    // +1马(的卢,dist:+1)把"我到座位1"的距离拉到2,超出默认攻击范围1,制造出
    // "确实够不着"的目标,这样发动奋迅才有真实用途(不是只看手牌够不够)。
    var g = mkSeatG({ caps0: { fenxun: true }, myHand: [card('杀','s1'), card('酒','s2')] });
    _g = g;
    g.players[1].equips.plus1 = { id:'e1', name:'的卢' };
    await runBotDecision(g, 0);
    startFenxun = realStart;
    if(window.__startFenxunCalls !== 1) throw new Error('startFenxun 应被调1次,实际 ' + window.__startFenxunCalls);
    if(g.phase !== 'fenxunDiscard') throw new Error('应进入 fenxunDiscard,实际 ' + g.phase);
  });

  await check('奋迅:所有目标都在攻击范围内(默认距离1) → 不发动', async function(){
    window.__startFenxunCalls = 0;
    var realStart = startFenxun;
    startFenxun = function(){ window.__startFenxunCalls++; return realStart(); };
    var g = mkSeatG({ caps0: { fenxun: true }, myHand: [card('杀','s1'), card('酒','s2')] });
    _g = g;
    await runBotDecision(g, 0);
    startFenxun = realStart;
    if(window.__startFenxunCalls !== 0) throw new Error('人人都够得着不应发动,实际调用 ' + window.__startFenxunCalls + ' 次');
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
