/**
 * "异常日志"功能体检——审计任务的验证脚本(不是回归测试,不需要长期维护)。
 * 用于实测(不是纯代码走读)几个审计过程中怀疑存在问题的具体机制,证据链见
 * docs/debug-log-audit.md。复用 run_debug_log_test.js 的 vm 沙箱 + db.ref spy 惯例。
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

const sandbox = vm.createContext(context, { name: 'sgs-debug-log-audit-sandbox' });

console.log('Loading 调试日志审计探测环境...\n');

const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "room-A";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  调试日志功能审计探测(实测,不是纯代码走读)');
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

  // ================= 发现1:kind中文映射完整性(程序化断言,不是眼看) =================
  await check('DEBUG_LOG_KIND_LABELS 覆盖 DEBUG_LOG_KINDS 里的每一个枚举值(双向核对,不遗漏也不多余)', function(){
    var kinds = DEBUG_LOG_KINDS.slice();
    var labelKeys = Object.keys(DEBUG_LOG_KIND_LABELS);
    kinds.forEach(function(k){ if(labelKeys.indexOf(k) < 0) throw new Error('kind「' + k + '」缺中文映射'); });
    labelKeys.forEach(function(k){ if(kinds.indexOf(k) < 0) throw new Error('映射表里多出一个不在枚举里的 key「' + k + '」'); });
  });

  // ================= 发现2(已修复,2026-08):pendingSnapshot 白名单化后,actualCard 不再原样写进debugLogs =================
  // 【断言语义已更新】这条最初的作用是"复现泄露"(审计阶段,commit 68c6a94)。这次隐私修复引入
  // sanitizePendingForLog 白名单机制之后,同一个触发路径不应该再泄露 actualCard 的真实内容——
  // 按 CLAUDE.md"设计变更后要回头检查旧断言语义是否还成立"的原则,更新为断言修复后的新行为,
  // 不留着一条会一直失败的"过时结论"。
  await check('【隐私修复验证】guhuoQuestion(于吉蛊惑)pending被normalize清空时,pendingSnapshot里的actualCard应被脱敏,不再暴露诡称的真实牌面', function(){
    var g = mkSeatG(3);
    g.pending = {
      type: 'guhuoQuestion', sourceSeat: 0, asking: 1,
      actualCard: card('小明弱牌', 'secretActual', '♠', 2), // 真实牌面(仍是秘密)
      claimedCard: card('杀', 'claimedFake', '♠', 2),        // 诡称成的牌面(玩家看到的是这个)
      questioners: [], answered: [], askedAt: Date.now()
    };
    g.players[0].alive = false; // 制造一次真实存在的并发场景:sourceSeat中途阵亡,触发A:分支清空
    window.__dbSetCalls = [];
    normalize(g);
    if(g.pending !== null) throw new Error('前置条件不满足:pending应该被清空(A:分支),实际未清空');
    if(window.__dbSetCalls.length !== 1) throw new Error('应写1条pending_orphan_detected,实际 ' + window.__dbSetCalls.length);
    var written = window.__dbSetCalls[0].entry;
    var snap = written.pendingSnapshot;
    if(!snap) throw new Error('pendingSnapshot不应为空(结构性字段仍应保留用于排查)');
    if(snap.actualCard === undefined) throw new Error('actualCard这个字段名应该保留(排查时"这里涉及一张牌"这个事实有用),不应该整体消失');
    if(typeof snap.actualCard === 'object' && snap.actualCard !== null)
      throw new Error('actualCard不应再是原始牌对象,应替换成脱敏占位符,实际 ' + JSON.stringify(snap.actualCard));
    if(JSON.stringify(snap).indexOf('小明弱牌') >= 0)
      throw new Error('整个pendingSnapshot里不应出现真实牌名"小明弱牌"');
    // sourceSeat/asking/questioners/answered/askedAt 这类结构性字段仍应该保留,不能矫枉过正
    // 把整条pending都清空成没有诊断价值的空对象。
    if(snap.sourceSeat !== 0 || snap.asking !== 1) throw new Error('结构性字段(sourceSeat/asking)应该保留,实际 ' + JSON.stringify(snap));
  });

  // ================= 发现3:同一个"卡住的坏pending"会被每个连上的客户端各自重复上报 =================
  await check('【写入量】render路径的normalize()不会把"清空"写回Firebase,同一个坏pending在多个客户端各自收到相同快照时会各自独立写一条debugLog(不是全局只写1次)', function(){
    var badPendingTemplate = { type: 'qiangxiChooseCost', seat: 99, askedAt: Date.now() }; // targetSeat指向不存在的座位,必然触发A:分支
    // 模拟"3个连着的客户端各自收到同一份来自Firebase的快照"——每个客户端各自独立调用一次
    // normalize(g)(render()内部的调用路径,对应真实代码 render.js:1031),而不是同一个g对象
    // 被同一份代码调用3次(那样只会检测出"函数本身没有幂等去重"这种平凡结论)。
    var clientSnapshots = [0,1,2].map(function(){
      var g = mkSeatG(3);
      g.pending = JSON.parse(JSON.stringify(badPendingTemplate));
      return g;
    });
    window.__dbSetCalls = [];
    clientSnapshots.forEach(function(g){
      // __pendingOrphanLastLogged 是 debug-log.js 里的模块级内存变量,真实场景下每个浏览器
      // 标签页各自拥有自己独立的一份(不同进程/不同内存空间)——这里每次模拟"下一个客户端"
      // 之前手动清空它,还原"这是另一个从未记过账的全新浏览器"这个前提,而不是让3次调用
      // 共享同一份还留着上次记账痕迹的内存(那样测的是"同一个客户端刷新3次",不是"3个不同
      // 客户端"这个真实要验证的场景)。
      __pendingOrphanLastLogged = {};
      normalize(g);
    });
    var orphanWrites = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'pending_orphan_detected'; });
    if(orphanWrites.length !== 3){
      throw new Error('3个"客户端"各自独立normalize同一份坏pending,期望各写1条(共3条),实际 ' + orphanWrites.length
        + '——如果小于3,说明存在某种跨客户端/进程共享的去重机制,和当前读代码的结论(内存变量__pendingOrphanLastLogged是单个JS运行时私有、不跨浏览器共享)不一致,应该更新审计文档');
    }
    // 3条几乎同时产生、内容几乎一致(只有isoTime/随机后缀不同)的记录,对应的是同一个"游戏里
    // 只发生过一次"的异常事件——如果连着N个客户端,就是N条几乎重复的记录,不是设计上期望的
    // "一次异常对应一条记录"。
  });

  // ================= 发现4:60秒频控的key没有房间号,不同房间会互相影响频控计时 =================
  await check('【写入量】B类频控key(type+reason)不含房间号,房间A刚触发过的频控窗口会连带压住房间B同类事件的记录(跨房间互相误判频控)', function(){
    var gA = mkSeatG(3);
    gA.pending = { type: 'zhijiChoice', seat: 99 }; // 座位越界,触发B:分支(存活性检查)
    roomId = 'room-A';
    window.__dbSetCalls = [];
    normalize(gA); // 房间A第一次触发,记一条(建立频控窗口)
    var afterA = window.__dbSetCalls.length;
    var gB = mkSeatG(3);
    gB.pending = { type: 'zhijiChoice', seat: 99 };
    roomId = 'room-B'; // 切换到完全不同的房间(同一浏览器tab在两个不同房间间跳转,或者
                        // 更现实的场景是同一份沙箱内__pendingOrphanLastLogged本来就是模块级
                        // 单例,不因roomId变化而重置)
    normalize(gB);
    var afterB = window.__dbSetCalls.length;
    if(afterB !== afterA){
      throw new Error('如果房间B的这次触发被正常记录(afterB>afterA),说明频控key其实有效区分了房间'
        + '(和读代码的结论不一致,应更新审计文档);实际 afterA=' + afterA + ' afterB=' + afterB);
    }
    // afterB===afterA 说明房间B这次本该被记录的事件,被房间A之前建立的60秒频控窗口连带
    // 压住了——两个房间毫不相干,却共享了同一把频控锁,房间B真实发生过的异常反而被吞掉,
    // 不是"写太多"而是反过来"该写的没写到",同一个设计缺陷的另一面后果。
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
