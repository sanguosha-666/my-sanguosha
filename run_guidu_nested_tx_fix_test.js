/**
 * 修复:张角【鬼道】判定牌无法替换的bug。
 *
 * 根因:game.js的askNextGuidu(g, currentReplaceCard)自己又包了一层tx(g=>{...}),
 * 但它的调用方triggerGuidu/cancelGuidu本身已经身处另一个tx()事务回调内部,直接
 * 同步调用它——在一个尚未提交的Firebase事务内部再同步发起一个全新的、独立的异步
 * 事务,两个事务互相竞争、状态互相踩踏。且askNextGuidu函数体没有return语句(永远
 * 返回undefined),外层tx()的`const result = fn(g) || g`兜底逻辑会吞掉这个返回值,
 * 导致pending/phase的推进全部发生在抢跑的嵌套事务里,外层实际提交的只有手牌/弃牌堆
 * 的就地修改——判定牌换不掉、界面卡住。
 *
 * 修复:去掉askNextGuidu自己的tx()包裹,改成直接操作传入的g并return g的普通同步
 * 辅助函数(参照finishGuicai/continueBiyueCheck同款写法)。
 *
 * 【测试方法论说明】这个文件用的是 test-tx-stub.js 里"快照隔离"版本的
 * gameRef.transaction stub,不是项目里其它测试文件常见的"共享引用"stub——这类嵌套
 * tx() 导致状态覆盖的bug,只有快照隔离的stub才能真实测出来,共享引用stub下内外层
 * 操作的是同一个对象引用,任何一层的原地修改都立刻互相可见,测不出"谁的返回值最终
 * 覆盖了谁"这个真实的竞争后果。详见 test-tx-stub.js 顶部注释。
 */

const vm = require('vm');
const fs = require('fs');
const { SNAPSHOT_TX_STUB_SOURCE } = require('./test-tx-stub');

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

const sandbox = vm.createContext(context, { name: 'sgs-guidu-nested-tx-sandbox' });

console.log('Loading 鬼道嵌套tx修复测试环境...\n');

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

// 用快照隔离stub替换game.js加载钩子装上的共享引用stub——见文件顶部说明和
// test-tx-stub.js 的完整背景注释。
vm.runInContext(SNAPSHOT_TX_STUB_SOURCE, sandbox, { filename: 'test-tx-stub-inline.js' });

console.log('\n' + '='.repeat(60));
console.log('  张角【鬼道】嵌套tx修复测试');
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

  // gameRef.transaction 已经在文件外层被替换成 test-tx-stub.js 的"快照隔离"版本
  // (commitGameState/currentGameState 由那个模块的源码注入到这个sandbox里,不在这里
  // 重复定义)。用法:每个场景先 commitGameState(初始g),调用被测函数后用
  // currentGameState() 读取"已提交"的最终结果做断言,不要用原始的g对象(调用之后它
  // 不再代表最终提交结果,尤其是涉及嵌套tx()的场景——这正是这个文件要验证的东西)。

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: (opt.nameOf && opt.nameOf[i]) || ('玩家' + i), alive: true,
        hp: 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'guiduAsk', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }
  function judgePending(g, sourceSeat, judgedSeat){
    return {
      type: 'guiduAsk', sourceSeat: sourceSeat, judgedSeat: judgedSeat,
      judgeCard: card('杀','orig','♥',7),
      resume: { kind: 'leijiJudge', sourceSeat: judgedSeat, targetSeat: (judgedSeat + 1) % g.players.length },
      askedSeats: [], askedAt: Date.now()
    };
  }

  // ================= 场景1:张角发动鬼道成功替换判定牌 =================
  await check('triggerGuidu发动成功:判定牌被替换,pending正确清空,没有出现嵌套事务错位(用clone+commit的真实感知stub)', function(){
    var g0 = mkSeatG({ n: 3, generalOf: { 0: 'zhangjiao' }, hands: { 0: [card('杀','rep1','♠',9)] } });
    g0.pending = judgePending(g0, 0, 1);
    commitGameState(g0); mySeat = 0;
    triggerGuidu(0);
    var g = currentGameState();
    // 应该走到 finishGuidu 的 leijiJudge 分支,推进到 finishLeijiChain(无leijiResume时清空pending/phase=play)。
    // 若askNextGuidu的嵌套tx bug仍在,外层tx最后commit时会用"没吸收内层pending推进"的旧快照
    // 覆盖掉服务端刚提交的正确状态,这里应能测出pending卡在guiduAsk不消失。
    if(g.pending !== null) throw new Error('pending应已清空(finishGuidu走完leijiJudge分支),实际 ' + JSON.stringify(g.pending));
    if(g.phase !== 'play') throw new Error('phase应推进到play,实际 ' + g.phase);
    // 替换牌(黑桃9)应该已经从张角手牌打出、进入弃牌堆,原判定牌(红桃7)不应出现在弃牌堆里被当成最终判定
    if(g.players[0].hand.length !== 0) throw new Error('张角手牌应已打出替换牌,实际 ' + JSON.stringify(g.players[0].hand));
    if(!g.discard.some(function(c){ return c.id === 'rep1'; })) throw new Error('替换牌应进入弃牌堆,实际 ' + JSON.stringify(g.discard));
    // 雷击判定按黑桃结算=造成伤害,验证目标确实掉血(证明是用替换牌(黑桃)而不是原判定牌(红桃)结算的)
    var target = g.players[2];
    if(target.hp !== target.maxHp - 2) throw new Error('目标应因黑桃判定受到2点雷电伤害,实际hp=' + target.hp);
  });

  // ================= 场景2:张角选择不发动鬼道 =================
  await check('cancelGuidu:正确使用原判定牌接回流程,没有出现嵌套事务错位(用clone+commit的真实感知stub)', function(){
    var g0 = mkSeatG({ n: 3, generalOf: { 0: 'zhangjiao' }, hands: { 0: [card('杀','rep2','♠',9)] } });
    g0.pending = judgePending(g0, 0, 1);
    commitGameState(g0); mySeat = 0;
    cancelGuidu();
    var g = currentGameState();
    if(g.pending !== null) throw new Error('pending应已清空,实际 ' + JSON.stringify(g.pending));
    if(g.phase !== 'play') throw new Error('phase应推进到play,实际 ' + g.phase);
    // 没有发动:手牌不应被打出
    if(g.players[0].hand.length !== 1) throw new Error('取消发动不应打出手牌,实际 ' + JSON.stringify(g.players[0].hand));
    // 原判定牌是红桃7(非黑色),雷击判定应无效(不造成伤害)
    var target = g.players[2];
    if(target.hp !== target.maxHp) throw new Error('原判定牌为红色,雷击应无效,目标不应掉血,实际hp=' + target.hp);
  });

  // ================= 场景3:多个张角依次被问及,第一个不发动、第二个发动 =================
  await check('多张角依次询问:askedSeats推进正确,最终判定牌是第二个张角替换的那张(用clone+commit的真实感知stub)', function(){
    var g0 = mkSeatG({ n: 3, generalOf: { 0: 'zhangjiao', 2: 'zhangjiao' }, hands: { 0: [card('杀','repA','♠',9)], 2: [card('闪','repB','♠',4)] } });
    // 张角0取消(先手,askedSeats里加入0),鬼道应轮到下一个有黑色牌的候选人——这里手动模拟askNextGuidu
    // 在cancelGuidu内部真实调用的场景:g.turn设为0,逆时针寻找下一个候选(0→2→1),0已问过应轮到2
    g0.turn = 0;
    g0.pending = judgePending(g0, 0, 1);
    commitGameState(g0); mySeat = 0;
    cancelGuidu();
    var g1 = currentGameState();
    if(!g1.pending || g1.pending.type !== 'guiduAsk') throw new Error('应继续询问下一个张角,实际 phase=' + g1.phase + ' pending=' + JSON.stringify(g1.pending));
    if(g1.pending.sourceSeat !== 2) throw new Error('下一个被问的应是座位2(另一个张角),实际 ' + g1.pending.sourceSeat);
    if(!g1.pending.askedSeats.includes(0)) throw new Error('askedSeats应记录座位0已问过,实际 ' + JSON.stringify(g1.pending.askedSeats));

    // 第二个张角(座位2)发动鬼道
    mySeat = 2;
    triggerGuidu(0);
    var g = currentGameState();
    if(g.pending !== null) throw new Error('全部询问完毕后pending应清空,实际 ' + JSON.stringify(g.pending));
    if(g.phase !== 'play') throw new Error('phase应推进到play,实际 ' + g.phase);
    if(!g.discard.some(function(c){ return c.id === 'repB'; })) throw new Error('最终判定牌应是座位2打出的repB,实际弃牌堆 ' + JSON.stringify(g.discard));
    if(g.discard.some(function(c){ return c.id === 'repA'; })) throw new Error('座位0没有真正发动,repA不应进入弃牌堆,实际 ' + JSON.stringify(g.discard));
    // repB是黑桃(黑色),雷击应有效
    var target = g.players[2];
    if(target.hp !== target.maxHp - 2) throw new Error('最终替换牌为黑色,雷击应有效,目标应掉2点血,实际hp=' + target.hp);
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
