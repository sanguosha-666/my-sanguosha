/**
 * 修复:debugLogs 隐藏信息泄露(docs/debug-log-audit.md,commit 68c6a94 里实测确认的
 * 第一类问题)。
 *
 * 根因:logPendingOrphan(以及 bot-ai-bus.js/bot.js 里另外两个 pendingSnapshot 构造点)
 * 原来直接 JSON.parse(JSON.stringify(g.pending)) 原样转存,没有任何字段过滤——guhuoQuestion/
 * guhuoTarget(于吉蛊惑)的 actualCard、enyuanChooseOption(法正恩怨)的 heartCards、
 * huanhuoPickSecond(法正眩惑)的 transferCard 三个真实存在的秘密字段因此被写进 debugLogs,
 * 任何打开 #debugLogBtn 的玩家都能看到。
 *
 * 修复:debug-log.js 新增 sanitizePendingForLog(白名单化,递归过滤),三个 pendingSnapshot
 * 构造点统一改用这个函数,不再各自 JSON.stringify 原样转存。
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

const sandbox = vm.createContext(context, { name: 'sgs-debug-log-privacy-fix-sandbox' });

console.log('Loading debugLogs隐私修复测试环境...\n');

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
console.log('  debugLogs 隐私修复测试(sanitizePendingForLog 白名单机制)');
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

  window.__dbSetCalls = [];
  function installDbSpy(){
    db = {
      ref: function(path){
        return {
          set: function(entry){ window.__dbSetCalls.push({ path: path, entry: entry }); return Promise.resolve(); },
          get: function(){ return Promise.resolve({ exists: function(){ return false; } }); },
          update: function(){ return Promise.resolve(); }
        };
      }
    };
  }
  installDbSpy();

  function mkSeatG(n){
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({ name: '玩家' + i, alive: true, hp: 4, maxHp: 4, hand: [], equips: emptyEquips(), delays: [], role: null, general: 'yuJi' });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true, discard: [], deck: [] };
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }
  function orphanSnapshot(g){
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'pending_orphan_detected'; });
    if(calls.length !== 1) throw new Error('应恰写1条pending_orphan_detected,实际 ' + calls.length);
    return calls[0].entry.pendingSnapshot;
  }

  // ================= 场景1:于吉【蛊惑】actualCard =================
  await check('guhuoQuestion:pendingSnapshot不再包含actualCard的真实牌面内容', function(){
    var g = mkSeatG(3);
    g.pending = {
      type: 'guhuoQuestion', sourceSeat: 0, asking: 1,
      actualCard: card('决斗', 'realCard', '♠', 3),
      claimedCard: card('杀', 'fakeCard', '♠', 3),
      questioners: [], answered: [], askedAt: Date.now()
    };
    g.players[0].alive = false; // 触发A:分支(sourceSeat阵亡)
    window.__dbSetCalls = [];
    normalize(g);
    var snap = orphanSnapshot(g);
    if(JSON.stringify(snap).indexOf('决斗') >= 0) throw new Error('不应出现真实牌名"决斗",实际 ' + JSON.stringify(snap));
    if(typeof snap.actualCard !== 'string') throw new Error('actualCard应被替换成脱敏占位符(字符串),实际 ' + JSON.stringify(snap.actualCard));
    // claimedCard是玩家诡称时公开声明的牌名,不是秘密,但这次修复统一按"字段名语义上可能带
    // 牌面内容就脱敏"处理,不逐个论证——claimedCard也应该被脱敏(不放水任何一个同名字段)。
    if(typeof snap.claimedCard !== 'string') throw new Error('claimedCard也应统一脱敏,实际 ' + JSON.stringify(snap.claimedCard));
    // 结构性字段应保留
    if(snap.sourceSeat !== 0 || snap.asking !== 1) throw new Error('结构性字段应保留,实际 ' + JSON.stringify(snap));
  });

  await check('guhuoTarget:pendingSnapshot不再包含actualCard的真实牌面内容', function(){
    var g = mkSeatG(3);
    g.pending = {
      type: 'guhuoTarget', sourceSeat: 0,
      actualCard: card('无中生有', 'realCard2', '♥', 9),
      claimedCard: card('杀', 'fakeCard2', '♥', 9)
    };
    g.players[0].alive = false; // 触发A:分支
    window.__dbSetCalls = [];
    normalize(g);
    var snap = orphanSnapshot(g);
    if(JSON.stringify(snap).indexOf('无中生有') >= 0) throw new Error('不应出现真实牌名"无中生有",实际 ' + JSON.stringify(snap));
    if(typeof snap.actualCard !== 'string') throw new Error('actualCard应被脱敏,实际 ' + JSON.stringify(snap.actualCard));
  });

  // ================= 场景2:法正【恩怨】heartCards =================
  await check('enyuanChooseOption:pendingSnapshot不再包含heartCards(伤害来源自己的红色手牌列表)的具体内容', function(){
    var g = mkSeatG(3);
    g.pending = {
      type: 'enyuanChooseOption', sourceSeat: 0, damagerSeat: 1,
      heartCards: [card('桃', 'h1', '♥', 6), card('杀', 'h2', '♥', 11)]
    };
    g.players[1].alive = false; // 触发A:分支(damagerSeat阵亡)
    window.__dbSetCalls = [];
    normalize(g);
    var snap = orphanSnapshot(g);
    if(JSON.stringify(snap).indexOf('桃') >= 0) throw new Error('不应出现具体牌名"桃",实际 ' + JSON.stringify(snap));
    if(typeof snap.heartCards !== 'string') throw new Error('heartCards应被替换成脱敏占位符(不是数组),实际 ' + JSON.stringify(snap.heartCards));
    if(snap.sourceSeat !== 0 || snap.damagerSeat !== 1) throw new Error('结构性字段应保留,实际 ' + JSON.stringify(snap));
  });

  // ================= 场景3:法正【眩惑】transferCard =================
  await check('huanhuoPickSecond:pendingSnapshot不再包含transferCard(转手途中的具体牌)的内容', function(){
    var g = mkSeatG(3);
    g.pending = {
      type: 'huanhuoPickSecond', sourceSeat: 0, firstTargetSeat: 1,
      transferCard: card('青龙偃月刀', 'tc1', '♥', 5),
      candidates: [2]
    };
    g.players[1].alive = false; // 触发A:分支(firstTargetSeat阵亡,不过这条本身校验是sourceSeat/candidates,用sourceSeat死更直接)
    g.players[0].alive = false;
    window.__dbSetCalls = [];
    normalize(g);
    var snap = orphanSnapshot(g);
    if(JSON.stringify(snap).indexOf('青龙偃月刀') >= 0) throw new Error('不应出现具体牌名"青龙偃月刀",实际 ' + JSON.stringify(snap));
    if(typeof snap.transferCard !== 'string') throw new Error('transferCard应被替换成脱敏占位符,实际 ' + JSON.stringify(snap.transferCard));
    if(!Array.isArray(snap.candidates) || snap.candidates.length !== 1) throw new Error('candidates(座位号数组,结构性)应保留,实际 ' + JSON.stringify(snap.candidates));
  });

  // ================= 场景4:白名单机制本身(通用,不逐个技能穷举) =================
  await check('sanitizePendingForLog:不在白名单/脱敏名单里的"假想敏感字段"一律被静默丢弃(不需要逐个技能维护排除清单)', function(){
    var fakeSensitive = sanitizePendingForLog({
      type: 'someImaginarySkill',
      seat: 0,
      // 假想以后新增一个技能,往pending里塞了一个从未被审计过、也不在任何名单里的新字段——
      // 白名单机制的价值就在于:即使完全没人想到要"排除"它,它也不会被默认放行。
      totallyUnvetteFieldFromFutureFeature: { name: '未来某张具体牌', suit: '♠', rank: 7 },
      anotherRandomField: '不应该出现',
      // 已知的脱敏字段仍应替换成占位符而不是被静默丢弃(字段名本身有诊断价值)
      actualCard: { name: '杀', suit: '♠', rank: 1 }
    });
    if('totallyUnvetteFieldFromFutureFeature' in fakeSensitive) throw new Error('不在任何名单里的字段应该被静默丢弃(连key都不该出现),实际 ' + JSON.stringify(fakeSensitive));
    if('anotherRandomField' in fakeSensitive) throw new Error('同上,实际 ' + JSON.stringify(fakeSensitive));
    if(fakeSensitive.type !== 'someImaginarySkill') throw new Error('白名单字段type应该保留,实际 ' + JSON.stringify(fakeSensitive));
    if(fakeSensitive.seat !== 0) throw new Error('白名单字段seat应该保留,实际 ' + JSON.stringify(fakeSensitive));
    if(typeof fakeSensitive.actualCard !== 'string') throw new Error('脱敏字段actualCard应保留key但替换成占位符,实际 ' + JSON.stringify(fakeSensitive.actualCard));
  });

  await check('sanitizePendingForLog:递归应用同一套名单到resume这类嵌套对象,不是只在最外层做一次浅过滤', function(){
    var out = sanitizePendingForLog({
      type: 'dying',
      seat: 0,
      resume: {
        type: 'sha',
        sourceSeat: 1,
        sourceCard: { name: '杀', suit: '♠', rank: 7 }, // resume内部同样可能挂着敏感字段
        unknownNestedField: '不应该出现'
      }
    });
    if(!out.resume) throw new Error('resume本身应保留(它在白名单里),实际 ' + JSON.stringify(out));
    if(out.resume.sourceSeat !== 1) throw new Error('resume内部的结构性字段应保留,实际 ' + JSON.stringify(out.resume));
    if('unknownNestedField' in out.resume) throw new Error('resume内部不在名单里的字段也应该被丢弃,实际 ' + JSON.stringify(out.resume));
    if(JSON.stringify(out).indexOf('"杀"') >= 0 && typeof out.resume.sourceCard === 'object')
      throw new Error('resume内部的sourceCard(同名脱敏字段)也应该被脱敏,不能因为嵌套一层就漏过,实际 ' + JSON.stringify(out.resume));
  });

  // ================= 场景5:历史脏数据清理工具本身 =================
  await check('sanitizeExistingDebugLogs:能扫描并重写历史记录里未脱敏的pendingSnapshot(用假的db模拟已有脏数据,不连真实Firebase)', function(){
    var fakeStore = {
      'debugLogs/room1/aaa': { kind: 'pending_orphan_detected', pendingSnapshot: { type: 'guhuoQuestion', sourceSeat: 0, actualCard: { name: '决斗', suit: '♠', rank: 3 } } },
      'debugLogs/room1/bbb': { kind: 'js_error', pendingSnapshot: null }, // 没有pendingSnapshot,应跳过不算脏
      'debugLogs/room1/ccc': { kind: 'pending_orphan_detected', pendingSnapshot: { type: 'zhijiChoice', seat: 1 } } // 已经是干净的结构性字段,不应被误判成"需要修复"
    };
    var updateCalls = [];
    db = {
      ref: function(path){
        return {
          get: function(){
            var out = {};
            Object.keys(fakeStore).forEach(function(k){
              if(k.indexOf(path + '/') === 0) out[k.slice(path.length + 1)] = fakeStore[k];
            });
            var keys = Object.keys(out);
            return Promise.resolve({
              exists: function(){ return keys.length > 0; },
              forEach: function(cb){ keys.forEach(function(k){ cb({ key: k, val: function(){ return out[k]; } }); }); }
            });
          },
          update: function(updates){ updateCalls.push(updates); Object.keys(updates).forEach(function(k){ fakeStore[k] = updates[k]; }); return Promise.resolve(); }
        };
      }
    };
    return new Promise(function(resolve, reject){
      sanitizeExistingDebugLogs('room1');
      setTimeout(function(){
        try{
          if(updateCalls.length !== 1) throw new Error('应恰调用1次db.ref().update(),实际 ' + updateCalls.length);
          var updates = updateCalls[0];
          var keys = Object.keys(updates);
          if(keys.length !== 1) throw new Error('只有aaa那条脏数据需要重写,实际重写了 ' + keys.length + ' 条: ' + JSON.stringify(keys));
          if(keys[0].indexOf('debugLogs/room1/aaa/pendingSnapshot') !== 0) throw new Error('重写的应该是aaa那条,实际 ' + keys[0]);
          var newSnap = updates[keys[0]];
          if(JSON.stringify(newSnap).indexOf('决斗') >= 0) throw new Error('重写后仍不应包含真实牌名"决斗",实际 ' + JSON.stringify(newSnap));
          resolve();
        }catch(e){ reject(e); }
      }, 50); // sanitizeExistingDebugLogs内部是Promise链,给一点时间让它跑完
    });
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
