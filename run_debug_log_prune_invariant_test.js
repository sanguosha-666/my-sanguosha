/**
 * 排查"中央出牌区不再淡出、历史卡牌堆积"这个疑似回归(用户报告，怀疑是 commit 56ab1ac
 * 引入的),锁定"debugLog频率控制不能耦合游戏状态清理"这条不变量。
 *
 * 排查结论(写在这里,不是猜测——过程见commit message):
 *  - 逐条核对 game.js 里全部105处 logPendingOrphan 调用点(程序化扫描+对最复杂的嵌套分支
 *    jujianPickCard/jujianChooseEffect 手工复核):g.pending=null(以及g.aoe=null,仅
 *    aoeResp那一处涉及)永远是 logPendingOrphan(...) 调用之后的、同一层级的下一条语句,
 *    不是嵌套在 logPendingOrphan 内部、也不受它的返回值影响——频控只影响
 *    logPendingOrphan内部"要不要真的写这条debugLog",从未、也不可能影响调用方自己
 *    随后执行的 g.pending=null 这一行(两者是同层顺序语句,不是嵌套关系)。
 *  - git show 56ab1ac -- game.js 逐条核对,105处的diff全部是单行字符串替换(reason参数
 *    从'normalize校验未通过...'改成'A:.../ B:...(类型名)'),没有任何一处触碰到条件判断
 *    本身、大括号结构或 g.pending=null 这一行的位置。
 *  - 真实链路模拟(playCard('桃园结义')→下一次tx调doDraw()):exchangeCards正确从
 *    1→0,pending全程为null,pruneExchangeCards按预期工作。
 *  - #debugLogBtn/showDebugLog/#infoModal 是和 #tableCard(render-table.js的淡出目标)
 *    完全独立的DOM子树,未发现任何id/全局标识符冲突。
 * 本次没有在game.js/debug-log.js里找到需要修的代码(这次审计的假设机制不成立),但按
 * 要求补上这条锁定测试,防止以后真的引入这类耦合。
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

const sandbox = vm.createContext(context, { name: 'sgs-prune-invariant-sandbox' });

console.log('Loading pruneExchangeCards不变量测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      // 只 stub gameRef.transaction,让真实的 tx()(game.js 定义,内部会调用
      // normalize(g)+pruneExchangeCards(g)再执行fn)照常跑——这条测试的核心就是要验证
      // 真实tx()链路里pruneExchangeCards确实被调用到,如果直接整个覆盖掉tx本身,
      // 就测不出这条链路本身是否完好了。
      vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  不变量:debugLog频率控制不能耦合游戏状态清理(pending/exchangeCards)');
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

  db = { ref: function(){ return { set: function(){ return Promise.resolve(); } }; } };

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i), alive: true, hp: 4, maxHp: 4,
        hand: [], equips: emptyEquips(), delays: [], isBot: i === 0, role: null, general: 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }

  // ================= 核心不变量:B类频控跳过日志,不影响g.pending清空/exchangeCards淡出 =================
  await check('不变量:B类pending连续两次命中(60秒内第2次被频控跳过日志),g.pending两次都被正确清空、exchangeCards两次都能正常淡出', function(){
    __pendingOrphanLastLogged = {};
    var g = mkSeatG({});
    g.exchangeCards = [{ seq: 1, name: '杀', card: { name: '杀' }, seat: 1 }];
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] }; // B类:结构上"座位99不存在"的孤儿pending
    normalize(g);
    pruneExchangeCards(g);
    if(g.pending !== null) throw new Error('第1次:g.pending应被清空,实际 ' + JSON.stringify(g.pending));
    if(g.exchangeCards.length !== 0) throw new Error('第1次:exchangeCards应被淡出清空,实际长度 ' + g.exchangeCards.length);

    // 第2次:60秒内重复命中同一个B类型,debugLog应该被频控跳过(不写),但这不该影响
    // g.pending的清空——这正是这次要锁定的不变量。
    g.exchangeCards = [{ seq: 2, name: '闪', card: { name: '闪' }, seat: 2 }];
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    pruneExchangeCards(g);
    if(g.pending !== null) throw new Error('第2次(应被频控跳过日志):g.pending仍应被清空,实际 ' + JSON.stringify(g.pending));
    if(g.exchangeCards.length !== 0) throw new Error('第2次(应被频控跳过日志):exchangeCards仍应被淡出清空,实际长度 ' + g.exchangeCards.length);
  });

  await check('不变量:确认第2次确实被频控跳过了日志(否则上一条断言无法证明频控和清空互不影响)', function(){
    __pendingOrphanLastLogged = {};
    window.__dbSetCalls = [];
    var realSet = db.ref('x').set;
    db = { ref: function(){ return { set: function(entry){ window.__dbSetCalls.push(entry); return Promise.resolve(); } }; } };
    var g = mkSeatG({});
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    if(window.__dbSetCalls.length !== 1) throw new Error('应恰写1条日志(第2次被频控跳过),实际 ' + window.__dbSetCalls.length);
  });

  await check('不变量:aoeResp(涉及g.aoe)孤儿pending同样正确清空pending+aoe,exchangeCards正常淡出', function(){
    __pendingOrphanLastLogged = {};
    var g = mkSeatG({});
    g.exchangeCards = [{ seq: 1, name: '南蛮入侵', card: { name: '南蛮入侵' }, seat: 0 }];
    g.pending = { type: 'aoeResp', from: 0, to: 99 }; // to=99 不存在,结构非法
    g.aoe = { type: '南蛮入侵', from: 0, remaining: [1, 2] };
    normalize(g);
    pruneExchangeCards(g);
    if(g.pending !== null) throw new Error('g.pending应被清空,实际 ' + JSON.stringify(g.pending));
    if(g.aoe !== null) throw new Error('g.aoe应同步被清空,实际 ' + JSON.stringify(g.aoe));
    if(g.exchangeCards.length !== 0) throw new Error('exchangeCards应被淡出清空,实际长度 ' + g.exchangeCards.length);
  });

  // ================= 真实链路模拟:playCard(桃园结义)→下一次tx(doDraw)→exchangeCards清空 =================
  await check('真实链路:playCard(桃园结义)后exchangeCards非空、pending为null;下一次tx(doDraw)后exchangeCards被清空', function(){
    var g = mkSeatG({ n: 3 });
    g.players[0].hand = [{ id: 'a', name: '桃园结义', suit: '♠', rank: 1 }];
    _g = g;
    playCard(0, '桃园结义', null);
    if(g.exchangeCards.length === 0) throw new Error('打出桃园结义后exchangeCards应非空,实际为空');
    var publicGuard=0;
    while(g.pending && g.pending.type==='wuxiePublicWait' && publicGuard++<10){
      g.pending.publicUntil=0;
      finishWuxiePublicWait();
    }
    if(g.pending !== null) throw new Error('桃园结义无需响应,pending应为null,实际 ' + JSON.stringify(g.pending));
    doDraw();
    if(g.exchangeCards.length !== 0) throw new Error('下一次tx(doDraw)后exchangeCards应被清空,实际长度 ' + g.exchangeCards.length);
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
