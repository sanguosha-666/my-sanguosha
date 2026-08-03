/**
 * AI 总线 C0 层测试 - isBotActionWindow / enumerateAllLegalOneStepActions
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot/ai-bot)
 * 进共享 vm 沙箱(与 run_ai_bus_l2_test.js 同一套 firebase/document/window stub
 * 与异步 check 断言惯例),在沙箱内直接调用两个新函数。
 * 覆盖:窗口谓词四态(play/turn/无pending 为真;有 pending、非 play、阵亡为假);
 * 杀按目标展开成多条候选;闪电 allowSelf 自目标;满血桃排除;结束项恒为最后。
 *
 * 已知的 vm 坑:mySeat 是 game.js 顶层 let 绑定,加载后需 runInContext 里赋值;
 * CARD_PLAYS 的 canPlay/canTarget(杀的距离、闪电的 onlySelf)读取全局 mySeat,
 * 枚举函数内部会像 botPlay 一样临时借用 mySeat 再归还。
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

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-c0-sandbox' });

console.log('Loading AI 总线 C0 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前;bot.js 在 game.js 之后、ai-bot.js 最后
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
console.log('  AI 总线 C0 测试(窗口谓词/一步动作枚举)');
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
