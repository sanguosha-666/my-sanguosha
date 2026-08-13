/**
 * 回归锁定:袁绍【乱击】confirmLuanji() 曾经在执行"视为万箭齐发"效果之后,无条件把
 * g.pending=null/g.phase='play',把万箭齐发效果(aoeEffect→aoeAdvance)刚刚建立的
 * 响应pending(wuxie/aoeResp)原地冲掉。g.aoe本身不受影响、继续保持非null(aoeAdvance
 * 只有在问完所有目标后才清空g.aoe),于是没有人会再被问到万箭齐发的响应,g.aoe从此
 * 永久卡死非null。render-table.js/game.js的pruneExchangeCards共用的"链已结束"判断
 * (!g.pending && !g.aoe)此后永远无法满足,中央出牌区从这一刻起永久停止淡出/清空,
 * 后续所有回合的出牌记录都会不断堆积进同一个g.exchangeCards数组——这正是用户报告的
 * "中央出牌区不淡出、历史多轮出牌堆积"现象的根因。
 *
 * 这是confirmLuanji自身一直存在的既有bug(它一直是这么写的),不是debugLogs审计
 * (56ab1ac)或机器人主动技能解锁(5e41be4/1da3381)这两次任务本身引入的新逻辑错误——
 * 只是此前几乎没有真人会玩袁绍并用这个技能、机器人也从来不会主动发动乱击,这条代码
 * 路径长期从未被真正跑过,直到机器人技能解锁任务让机器人开始真正调用startLuanji/
 * confirmLuanji,才第一次被大量执行、把这个latent bug暴露出来。
 *
 * 加载真实完整链路进vm沙箱(不stub game.js自己的tx()/normalize()/pruneExchangeCards,
 * 只stub gameRef.transaction直接同步执行),用真实的
 * startLuanji→pickLuanjiPair→confirmLuanji→(wuxie/aoeResp响应)完整链路复现。
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

const sandbox = vm.createContext(context, { name: 'sgs-luanji-aoe-orphan-sandbox' });

console.log('Loading 乱击AOE孤儿回归测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
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
console.log('  回归锁定:confirmLuanji()不能冲掉万箭齐发效果自己建立的响应pending');
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

  function mkLuanjiG(){
    return { players: [
      { name: '袁绍', alive: true, hp: 4, maxHp: 4,
        hand: [{ id: 'x', name: '杀', suit: '♠', rank: 3 }, { id: 'y', name: '闪', suit: '♠', rank: 5 }],
        equips: emptyEquips(), delays: [], general: 'yuanshao', caps: { luanji: true } },
      { name: '玩家1', alive: true, hp: 4, maxHp: 4, hand: [], equips: emptyEquips(), delays: [], general: 'yuJi' },
      { name: '玩家2', alive: true, hp: 4, maxHp: 4, hand: [], equips: emptyEquips(), delays: [], general: 'yuJi' }
    ], gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null,
       discard: [], deck: [], exchangeCards: [], started: true };
  }

  function driveAoeToEnd(g){
    var guard = 0;
    while((g.phase === 'aoeResp' || g.phase === 'wuxie') && guard++ < 20){
      if(g.phase === 'wuxie'){
        if(g.pending.type==='wuxiePublicWait'){
          g.pending.publicUntil=0;
          finishWuxiePublicWait();
        }else{
          mySeat = (typeof g.pending.asking === 'number') ? g.pending.asking : g.pending.to;
          respondWuxie(false);
        }
      } else {
        mySeat = g.pending.to;
        aoeRespond(false);
      }
    }
    return guard;
  }

  // ================= 核心回归:confirmLuanji之后AOE响应链必须能正常走完 =================
  await check('confirmLuanji后:aoeEffect建立的响应pending(wuxie/aoeResp)不能被随后的清理代码冲掉', function(){
    var g = mkLuanjiG();
    _g = g;
    mySeat = 0;
    startLuanji();
    pickLuanjiPair(0);
    confirmLuanji();
    // 【这是这次回归的核心断言】confirmLuanji执行完毕的这一刻,万箭齐发的效果应该已经
    // 建立好了它自己的响应pending(问第一个目标要不要打闪,或者先问要不要无懈)——
    // 如果这里pending是null、phase是'play',说明confirmLuanji把效果刚建立的pending
    // 冲掉了,这正是修复前的真实bug现象。
    if(g.pending === null) throw new Error('confirmLuanji后g.pending不应为null(应该是万箭齐发建立的响应pending),这正是修复前的bug现象');
    if(g.phase !== 'aoeResp' && g.phase !== 'wuxie') throw new Error('confirmLuanji后phase应为aoeResp或wuxie,实际 ' + g.phase);
    if(!g.aoe) throw new Error('g.aoe应该已经建立,实际 ' + JSON.stringify(g.aoe));
  });

  await check('AOE响应链走完后:g.pending和g.aoe必须同时归null,不能只清一个', function(){
    var g = mkLuanjiG();
    _g = g;
    mySeat = 0;
    startLuanji();
    pickLuanjiPair(0);
    confirmLuanji();
    var steps = driveAoeToEnd(g);
    if(steps === 0) throw new Error('driveAoeToEnd应该至少走了1步(AOE响应链应该真的存在),实际0步——说明confirmLuanji之后根本没有进入任何响应阶段');
    if(g.pending !== null) throw new Error('AOE链走完后g.pending应为null,实际 ' + JSON.stringify(g.pending));
    if(g.aoe !== null) throw new Error('【这是修复前的真实bug症状】AOE链走完后g.aoe应为null,实际 ' + JSON.stringify(g.aoe) + ' —— g.aoe卡死非null会让pruneExchangeCards的"!pending&&!aoe"判断永远无法满足,中央出牌区从此永久不再淡出');
  });

  // ================= 端到端:锁定"中央出牌区不再堆积"这个用户可见的症状本身 =================
  await check('端到端:乱击→万箭齐发完整链结束后,下一次真实tx(playCard)必须能正常prune掉旧的exchangeCards,不会跨链堆积', function(){
    var g = mkLuanjiG();
    // 给玩家1一张真实的闪,让它真的打出来(触发markCardSound,往exchangeCards里留下
    // 一条"闪"的记录)——对应截图里"中央同时显示了杀/闪/骁骋"这类真实出现过的牌面,
    // 不是空链条。
    g.players[1].hand = [{ id: 'sh1', name: '闪', suit: '♠', rank: 7 }];
    _g = g;
    mySeat = 0;
    startLuanji();
    pickLuanjiPair(0);
    confirmLuanji();
    var guard = 0;
    while((g.phase === 'aoeResp' || g.phase === 'wuxie') && guard++ < 20){
      if(g.phase === 'wuxie'){
        if(g.pending.type==='wuxiePublicWait'){
          g.pending.publicUntil=0;
          finishWuxiePublicWait();
        }else{
          mySeat = (typeof g.pending.asking === 'number') ? g.pending.asking : g.pending.to;
          respondWuxie(false);
        }
      } else {
        mySeat = g.pending.to;
        if(g.pending.to === 1) aoeRespond(true); // 玩家1打出闪抵消
        else aoeRespond(false);
      }
    }
    var exchangeCardsAfterLuanji = g.exchangeCards.length;
    if(exchangeCardsAfterLuanji === 0) throw new Error('乱击→万箭齐发这条链本身应该至少留下玩家1打出闪的那1条exchangeCards记录,实际0条');
    if(g.exchangeCards.map(function(e){return e.name;}).indexOf('闪') < 0)
      throw new Error('应该有一条"闪"的记录,实际 ' + JSON.stringify(g.exchangeCards.map(function(e){return e.name;})));

    // 模拟"下一轮机器人继续正常出牌"(不是乱击/万箭齐发,是完全独立的一次新动作)
    mySeat = 0;
    g.players[0].hand = [{ id: 'z1', name: '桃园结义', suit: '♥', rank: 2 }];
    playCard(0, '桃园结义', null);
    var namesAfterNext = g.exchangeCards.map(function(e){ return e.name; });
    if(namesAfterNext.indexOf('乱击') >= 0 || namesAfterNext.indexOf('万箭齐发') >= 0)
      throw new Error('【这是用户报告的真实症状】下一次独立动作后,exchangeCards里还残留着上一条链(乱击/万箭齐发)的记录,说明没有被正确prune,实际 ' + JSON.stringify(namesAfterNext));
    if(namesAfterNext.length !== 1 || namesAfterNext[0] !== '桃园结义')
      throw new Error('下一次独立动作后,exchangeCards应该只有这次新打出的桃园结义1条,实际 ' + JSON.stringify(namesAfterNext));

    var publicGuard=0;
    while(g.pending && g.pending.type==='wuxiePublicWait' && publicGuard++<10){
      g.pending.publicUntil=0;
      finishWuxiePublicWait();
    }

    // 再叠加第3条完全独立的动作(杀→座位2,距离1默认可达),确认不是"侥幸只清了一次",
    // 而是这条链路持续正常工作
    mySeat = 0;
    g.players[0].hand = [{ id: 'z2', name: '杀', suit: '♠', rank: 6 }];
    playCard(0, '杀', 2);
    var namesAfterThird = g.exchangeCards.map(function(e){ return e.name; });
    if(namesAfterThird.length !== 1 || namesAfterThird[0] !== '杀')
      throw new Error('第3条独立动作后,exchangeCards应该只有这次的杀1条,不应该累积前面的记录,实际 ' + JSON.stringify(namesAfterThird));
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
