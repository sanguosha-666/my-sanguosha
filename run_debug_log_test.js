/**
 * 调试日志系统(debugLogs)测试 - writeDebugLog / logPendingOrphan / timeout_stuck /
 * bot_decision_failed 四个触发点的最小场景验证。
 *
 * 加载真实完整链路进共享 vm 沙箱(与其它 run_ai_bus_*_test.js 同一套 stub/惯例),不真的
 * 连 Firebase 网络——把 db.ref 换成记录调用的 spy(路径 + 写入的 entry),验证:
 *  - writeDebugLog:key 是反向时间戳+随机后缀,同一批调用严格递减(越晚写入的记录字典序
 *    越靠前);两次调用 key 不冲突;schema 字段齐全。
 *  - normalize() 里的 logPendingOrphan:构造一个已知不合法的 pending,调用 normalize()
 *    后应写一条 pending_orphan_detected,pendingSnapshot 是清空前的原始内容(不是null)。
 *  - bot-ai-bus.js 的 maybeAutoRespondTimeout:autoRespondAction 返回 null 时应写一条
 *    timeout_stuck。
 *  - bot.js 的 runBotActionWindow:等不到提交确认(transaction 被拒绝)时应写一条
 *    bot_decision_failed。
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: {
    transaction: function(fn) { return fn(context.g || {}); }
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
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-debug-log-sandbox' });

console.log('Loading 调试日志测试环境...\n');

// 加载顺序遵循 index.html:debug-log.js 在 data.js 之后、room-lifecycle.js 之前
// (writeDebugLog/logPendingOrphan 定义要早于依赖它们的 game.js/bot-ai-bus.js/bot.js,
// 但这几个都是运行期才调用,顺序其实不敏感——这里仍照抄 index.html 真实顺序)。
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      // 强C:gameRef.transaction 升级为 Promise 模式,tx 的 onCommitted 才会触发(和
      // run_ai_bus_c_window_test.js T20 同一套写法,供 bot_decision_failed 场景复用)。
      vm.runInContext('gameRef = { __txSnapshot: null, transaction: function(fn){ var result = fn(typeof _g !== "undefined" ? _g : {}); var snap = gameRef.__txSnapshot !== null ? gameRef.__txSnapshot : result; return Promise.resolve({ snapshot: { val: function(){ return snap; } } }); } };', sandbox);
      vm.runInContext('mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  调试日志系统测试(writeDebugLog/logPendingOrphan/timeout_stuck/bot_decision_failed)');
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

  // ---- db.ref spy:记录每次 set() 的路径与写入内容,不真的连网络 ----
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
        equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    var g = { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true, discard: [], deck: [] };
    return g;
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }

  // ================= writeDebugLog 本身 =================
  await check('writeDebugLog:key=反向时间戳(13位补零)+随机后缀,schema字段齐全', function(){
    window.__dbSetCalls = [];
    writeDebugLog('room1', 'js_error', { message: '测试消息', seat: 2 });
    if(window.__dbSetCalls.length !== 1) throw new Error('应写1次,实际 ' + window.__dbSetCalls.length);
    var call = window.__dbSetCalls[0];
    if(call.path.indexOf('debugLogs/room1/') !== 0) throw new Error('路径应以 debugLogs/room1/ 开头,实际 ' + call.path);
    var key = call.path.slice('debugLogs/room1/'.length);
    var parts = key.split('_');
    if(parts.length !== 2) throw new Error('key 应为 反向时间戳_随机后缀,实际 ' + key);
    if(parts[0].length !== 13) throw new Error('反向时间戳应补零到13位,实际长度 ' + parts[0].length + ' (' + parts[0] + ')');
    if(!/^[0-9]+$/.test(parts[0])) throw new Error('反向时间戳应全为数字,实际 ' + parts[0]);
    var entry = call.entry;
    ['ts','isoTime','kind','phase','pendingType','turn','roundNum','seat','message','pendingSnapshot','playersSummary','stack'].forEach(function(k){
      if(!(k in entry)) throw new Error('schema 缺字段 ' + k);
    });
    if(entry.kind !== 'js_error') throw new Error('kind 应为 js_error,实际 ' + entry.kind);
    if(entry.message !== '测试消息') throw new Error('message 未透传,实际 ' + entry.message);
    if(entry.seat !== 2) throw new Error('seat 未透传,实际 ' + entry.seat);
    if(typeof entry.ts !== 'number') throw new Error('ts 应为数字');
    if(typeof entry.isoTime !== 'string' || entry.isoTime.indexOf('-') < 0) throw new Error('isoTime 格式不对,实际 ' + entry.isoTime);
  });

  await check('writeDebugLog:反向时间戳排序——越晚写入的记录 key 字典序越靠前(数值越小)', async function(){
    window.__dbSetCalls = [];
    writeDebugLog('room1', 'js_error', { message: '第1条' });
    await new Promise(function(r){ setTimeout(r, 5); });
    writeDebugLog('room1', 'js_error', { message: '第2条(更晚)' });
    var key1 = window.__dbSetCalls[0].path.split('/').pop().split('_')[0];
    var key2 = window.__dbSetCalls[1].path.split('/').pop().split('_')[0];
    if(!(key2 <= key1)) throw new Error('第2条(更晚写入)的反向时间戳字符串应 <= 第1条,实际 key1=' + key1 + ' key2=' + key2);
  });

  await check('writeDebugLog:同一毫秒内两次调用 key 不冲突(随机后缀不同)', function(){
    window.__dbSetCalls = [];
    writeDebugLog('room1', 'js_error', {});
    writeDebugLog('room1', 'js_error', {});
    var k1 = window.__dbSetCalls[0].path;
    var k2 = window.__dbSetCalls[1].path;
    if(k1 === k2) throw new Error('两次调用不应产生相同的完整 key,实际都是 ' + k1);
  });

  await check('writeDebugLog:未知 kind 不写入(枚举收敛,不允许自由文本)', function(){
    window.__dbSetCalls = [];
    writeDebugLog('room1', 'some_random_kind', {});
    if(window.__dbSetCalls.length !== 0) throw new Error('未知kind不应写入,实际写了 ' + window.__dbSetCalls.length + ' 次');
  });

  await check('debugLogPlayersSummary:只含公开字段,不含手牌', function(){
    var g = mkSeatG({ myHand: [card('杀')] });
    var summary = debugLogPlayersSummary(g);
    var json = JSON.stringify(summary);
    if(json.indexOf('hand') >= 0) throw new Error('playersSummary 泄露了 hand 字段,实际 ' + json);
    if(summary[0].seat !== 0 || summary[0].name !== '机器人0' || summary[0].isBot !== true)
      throw new Error('公开字段不对,实际 ' + json);
  });

  // ================= logPendingOrphan(normalize 触发) =================
  await check('normalize:发现不合法的 qiangxiChooseCost pending → 写 pending_orphan_detected,snapshot=清空前原始内容', function(){
    window.__dbSetCalls = [];
    var g = mkSeatG({});
    // seat 指向一个不存在/未存活的座位,是明确的"结构上不可能是真的"脏数据(不是中间态)
    var badPending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1], costType: 'hp' };
    g.pending = badPending;
    normalize(g);
    if(g.pending !== null) throw new Error('normalize 应清空这个不合法 pending,实际 ' + JSON.stringify(g.pending));
    var orphanCalls = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'pending_orphan_detected'; });
    if(orphanCalls.length !== 1) throw new Error('应恰写1条 pending_orphan_detected,实际 ' + orphanCalls.length);
    var entry = orphanCalls[0].entry;
    if(entry.pendingType !== 'qiangxiChooseCost') throw new Error('pendingType 应为 qiangxiChooseCost,实际 ' + entry.pendingType);
    if(!entry.pendingSnapshot || entry.pendingSnapshot.seat !== 99)
      throw new Error('pendingSnapshot 应是清空前的原始内容(seat=99),实际 ' + JSON.stringify(entry.pendingSnapshot));
  });

  await check('normalize:合法的 pending 不触发 pending_orphan_detected', function(){
    window.__dbSetCalls = [];
    var g = mkSeatG({});
    g.pending = { type: 'qiangxiChooseCost', seat: 0, candidates: [1], costType: 'hp' };
    normalize(g);
    var orphanCalls = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'pending_orphan_detected'; });
    if(orphanCalls.length !== 0) throw new Error('合法pending不应触发orphan日志,实际 ' + orphanCalls.length);
  });

  // ================= timeout_stuck(maybeAutoRespondTimeout 触发) =================
  await check('maybeAutoRespondTimeout:autoRespondAction 返回 null → 写 timeout_stuck', function(){
    window.__dbSetCalls = [];
    var g = mkSeatG({});
    g.phase = '__unknown_phase_no_coverage__';
    g.pending = { type: '__unknown_type__', askedAt: Date.now() - RESPONSE_TIMEOUT_MS - 1000 };
    var r = maybeAutoRespondTimeout(g);
    if(r !== false) throw new Error('无保守动作可提交应返回 false,实际 ' + r);
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'timeout_stuck'; });
    if(calls.length !== 1) throw new Error('应恰写1条 timeout_stuck,实际 ' + calls.length);
    if(calls[0].entry.phase !== '__unknown_phase_no_coverage__') throw new Error('phase 未正确记录,实际 ' + calls[0].entry.phase);
  });

  await check('maybeAutoRespondTimeout:未超时 → 不写日志', function(){
    window.__dbSetCalls = [];
    var g = mkSeatG({});
    g.phase = 'respond';
    g.pending = { type: 'respond', askedAt: Date.now() };
    maybeAutoRespondTimeout(g);
    if(window.__dbSetCalls.length !== 0) throw new Error('未超时不应写任何日志,实际 ' + window.__dbSetCalls.length);
  });

  // ================= bot_decision_failed(runBotActionWindow 触发) =================
  // 照抄 run_ai_bus_c_window_test.js T20 的"提交失败"场景:真实 playCard + gameRef.transaction
  // 拒绝 → tx 的 onCommitted(null) → executePlayWindowChoiceAwait resolve(null) → newG=null。
  await check('runBotActionWindow:transaction 拒绝(提交失败) → 写 bot_decision_failed', async function(){
    window.__dbSetCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    callAI = async function(){ window.__mockAiCalls++; return window.__mockAiResults.shift() || { ok:false, reason:'other' }; };
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    BOT_COMMIT_TIMEOUT_MS = 50;
    var g = mkSeatG({ myHand: [card('桃')], hpOf: { 0: 2 } });
    _g = g;
    var realTx = gameRef.transaction;
    gameRef = { transaction: function(fn){ fn(_g); return Promise.reject(new Error('模拟提交失败')); } };
    await runBotActionWindow(g, 0);
    gameRef = { __txSnapshot: null, transaction: realTx };
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.kind === 'bot_decision_failed'; });
    if(calls.length !== 1) throw new Error('应恰写1条 bot_decision_failed,实际 ' + calls.length + ' ' + JSON.stringify(window.__dbSetCalls));
    if(calls[0].entry.seat !== 0) throw new Error('seat 应为0,实际 ' + calls[0].entry.seat);
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
