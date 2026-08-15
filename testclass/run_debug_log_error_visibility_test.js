/**
 * CORE-71:debugLogs 读写失败不再被静默吞掉 + 调试日志弹窗摘要/详情改版 —— 最小验证。
 *
 * 覆盖范围(对应本次改动的三块):
 *  - writeDebugLog:set() 被拒绝 / db.ref 同步抛错,都应该 console.warn(带原始 err),
 *    不抛异常影响主流程。
 *  - showDebugLog:读取失败(PERMISSION_DENIED / 无 code 两种)应该 console.warn 带原始
 *    err,且弹窗显示简短错误 code(+已知 code 的排查提示);读取成功时顶部有四类统计条。
 *  - debugLogEntryHtml/extractProjectSourceLocation/debugLogActorLabel/debugLogStatsHtml:
 *    四个新增/改动过的纯函数分别验证。
 *
 * 复用 run_debug_log_test.js 同一套 vm 沙箱手法(不真连 Firebase),这次额外需要一个
 * 能配合 showInfo()/#infoModal 走一遍的最小 DOM 桩(该文件没有覆盖 showDebugLog,这次
 * 补上)。
 */

const vm = require('vm');
const fs = require('fs');

// ---- 最小 #infoModal 桩:只支持 showInfo()/showDebugLog() 实际用到的那几个方法 ----
function makeInfoModalStub(){
  const bodyEl = { innerHTML: '', querySelectorAll: function(){ return []; } };
  function genericEl(){
    return { onclick: null, style: {}, classList: { add: function(){}, remove: function(){}, contains: function(){ return false; } } };
  }
  const modalEl = {
    _hidden: false,
    innerHTML: '',
    onclick: null,
    classList: {
      contains: function(cls){ return cls === 'hidden' ? modalEl._hidden : false; },
      add: function(cls){ if(cls === 'hidden') modalEl._hidden = true; },
      remove: function(cls){ if(cls === 'hidden') modalEl._hidden = false; }
    },
    querySelector: function(sel){ return sel === '.info-body' ? bodyEl : genericEl(); }
  };
  return { modalEl, bodyEl };
}

const context = {
  gameRef: {
    transaction: function(fn) { return fn(context.g || {}); }
  },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) {
      if(id === 'infoModal') return context.__infoModal.modalEl;
      return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} };
    },
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
context.__infoModal = makeInfoModalStub();
context.window.__infoModal = context.__infoModal;

const sandbox = vm.createContext(context, { name: 'sgs-debug-log-error-visibility-sandbox' });

console.log('Loading 调试日志(错误可见性+摘要改版)测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
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
console.log('  调试日志错误可见性 + 摘要/详情改版测试(CORE-71)');
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

  // ---- console.warn spy:记录调用参数,不真的打印 ----
  function installConsoleWarnSpy(){
    window.__warnCalls = [];
    var orig = console.warn;
    console.warn = function(){
      window.__warnCalls.push(Array.prototype.slice.call(arguments));
    };
    return function restore(){ console.warn = orig; };
  }

  // ================= 1. writeDebugLog:写入失败要 console.warn(带原始err) =================
  await check('writeDebugLog:set()被拒绝时 console.warn 带原始err,不抛异常', async function(){
    var restore = installConsoleWarnSpy();
    try{
      db = { ref: function(path){ return { set: function(){ return Promise.reject(new Error('PERMISSION_DENIED: xxx')); } }; } };
      writeDebugLog('room1', 'js_error', { message: 'x' });
      // set() 的 rejection 是微任务,让出一轮
      await new Promise(function(r){ setTimeout(r, 0); });
      if(window.__warnCalls.length !== 1) throw new Error('应有1次warn,实际 ' + window.__warnCalls.length);
      var args = window.__warnCalls[0];
      if(args[0].indexOf('写入调试日志失败') < 0) throw new Error('warn文案应含"写入调试日志失败",实际: ' + args[0]);
      if(!(args[1] instanceof Error) || args[1].message.indexOf('PERMISSION_DENIED') < 0) throw new Error('warn第二参应是原始err');
    } finally { restore(); }
  });

  await check('writeDebugLog:db.ref本身同步抛错时 console.warn,不抛异常影响主流程', function(){
    var restore = installConsoleWarnSpy();
    try{
      db = { ref: function(){ throw new Error('ref抛错'); } };
      writeDebugLog('room1', 'js_error', { message: 'x' }); // 不应该抛出
      if(window.__warnCalls.length !== 1) throw new Error('应有1次warn,实际 ' + window.__warnCalls.length);
      if(window.__warnCalls[0][0].indexOf('writeDebugLog 出错') < 0) throw new Error('warn文案不对: ' + window.__warnCalls[0][0]);
    } finally { restore(); }
  });

  // ================= 2. extractProjectSourceLocation =================
  await check('extractProjectSourceLocation:普通项目文件stack提取"文件名:行号"', function(){
    var stack = 'TypeError: isSeatClickable is not defined\n'
      + '    at onclick (https://x.github.io/my-sanguosha/render-controls.js?v=421:1842:15)\n'
      + '    at HTMLButtonElement.dispatchEvent (native)';
    var loc = extractProjectSourceLocation(stack);
    if(loc !== 'render-controls.js:1842') throw new Error('实际: ' + loc);
  });

  await check('extractProjectSourceLocation:子目录文件(sha/sha-resolution.js)也能提取', function(){
    var stack = 'Error\n    at resolveSha (https://x.github.io/my-sanguosha/sha/sha-resolution.js?v=1:88:3)';
    var loc = extractProjectSourceLocation(stack);
    if(loc !== 'sha/sha-resolution.js:88') throw new Error('实际: ' + loc);
  });

  await check('extractProjectSourceLocation:跳过 firebase SDK 帧,取第一条项目源码帧', function(){
    var stack = 'Error\n'
      + '    at Object.push (https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js:100:5)\n'
      + '    at doDraw (https://x.github.io/my-sanguosha/game.js?v=421:900:1)';
    var loc = extractProjectSourceLocation(stack);
    if(loc !== 'game.js:900') throw new Error('实际: ' + loc);
  });

  await check('extractProjectSourceLocation:没有可提取位置(或空stack)返回null', function(){
    if(extractProjectSourceLocation('') !== null) throw new Error('空串应返回null');
    if(extractProjectSourceLocation(null) !== null) throw new Error('null应返回null');
    if(extractProjectSourceLocation('Error\n    at <anonymous>') !== null) throw new Error('无.js:行号应返回null');
  });

  // ================= 3. debugLogActorLabel =================
  await check('debugLogActorLabel:seat+playersSummary齐全时返回玩家名', function(){
    var label = debugLogActorLabel({ seat: 1, playersSummary: [{seat:0,name:'甲'},{seat:1,name:'乙'}] });
    if(label !== '乙') throw new Error('实际: ' + label);
  });
  await check('debugLogActorLabel:缺seat或playersSummary时返回空串', function(){
    if(debugLogActorLabel({ playersSummary: [{seat:0,name:'甲'}] }) !== '') throw new Error('缺seat应为空串');
    if(debugLogActorLabel({ seat: 0 }) !== '') throw new Error('缺playersSummary应为空串');
  });

  // ================= 4. debugLogEntryHtml =================
  await check('debugLogEntryHtml:js_error且有stack时,摘要行含"文件名:行号"', function(){
    var html = debugLogEntryHtml({
      kind: 'js_error', isoTime: '2026-08-15 10:00:00', phase: 'play', seat: 0,
      message: 'isSeatClickable is not defined',
      stack: 'TypeError\n    at onclick (https://x.github.io/my-sanguosha/render-controls.js?v=421:1842:15)',
      playersSummary: [{seat:0,name:'张三'}]
    }, 0);
    if(html.indexOf('render-controls.js:1842') < 0) throw new Error('摘要行应含源码位置,实际: ' + html);
    if(html.indexOf('张三') < 0) throw new Error('摘要行应含当前行动玩家,实际: ' + html);
  });
  await check('debugLogEntryHtml:展开详情含对应kind的"可能原因"提示', function(){
    var html = debugLogEntryHtml({ kind: 'timeout_stuck', isoTime: '2026-08-15 10:00:00', message: 'x' }, 0);
    if(html.indexOf('可能原因') < 0) throw new Error('详情应含可能原因提示,实际: ' + html);
    if(html.indexOf('超时保守动作') < 0) throw new Error('提示文案不对: ' + html);
  });
  await check('debugLogEntryHtml:未知kind不报错,原样显示kind字符串', function(){
    var html = debugLogEntryHtml({ kind: 'some_weird_kind', isoTime: 't', message: 'm' }, 0);
    if(html.indexOf('some_weird_kind') < 0) throw new Error('未知kind应原样显示');
  });

  // ================= 5. debugLogStatsHtml =================
  await check('debugLogStatsHtml:四类计数正确', function(){
    var html = debugLogStatsHtml([
      {kind:'js_error'}, {kind:'js_error'}, {kind:'timeout_stuck'},
      {kind:'bot_decision_failed'}, {kind:'pending_orphan_detected'}, {kind:'pending_orphan_detected'}
    ]);
    if(html.indexOf('最近6条') < 0) throw new Error('总数不对: ' + html);
    if(html.indexOf('JS异常 2') < 0) throw new Error('js_error计数不对: ' + html);
    if(html.indexOf('超时卡死 1') < 0) throw new Error('timeout_stuck计数不对: ' + html);
    if(html.indexOf('pending异常 2') < 0) throw new Error('pending_orphan_detected计数不对: ' + html);
    if(html.indexOf('机器人失败 1') < 0) throw new Error('bot_decision_failed计数不对: ' + html);
  });

  // ================= 6. showDebugLog:读取失败(PERMISSION_DENIED) =================
  await check('showDebugLog:读取失败(PERMISSION_DENIED)时console.warn+弹窗显示code与提示', async function(){
    var restore = installConsoleWarnSpy();
    try{
      var err = new Error('Permission denied');
      err.code = 'PERMISSION_DENIED';
      db = { ref: function(){ return { orderByKey: function(){ return this; }, limitToFirst: function(){ return this; }, get: function(){ return Promise.reject(err); } }; } };
      window.__infoModal.modalEl._hidden = false; // 模拟弹窗已打开(showInfo已调用过)
      showDebugLog();
      await new Promise(function(r){ setTimeout(r, 0); });
      var body = window.__infoModal.bodyEl;
      if(body.innerHTML.indexOf('PERMISSION_DENIED') < 0) throw new Error('弹窗应显示错误code,实际: ' + body.innerHTML);
      if(body.innerHTML.indexOf('Firebase Rules') < 0) throw new Error('弹窗应显示排查提示,实际: ' + body.innerHTML);
      var warned = window.__warnCalls.some(function(a){ return String(a[0]).indexOf('读取调试日志失败') >= 0 && a[1] === err; });
      if(!warned) throw new Error('应有一次console.warn带原始err');
    } finally { restore(); }
  });

  await check('showDebugLog:读取失败且无code时显示"未知错误"', async function(){
    var restore = installConsoleWarnSpy();
    try{
      db = { ref: function(){ return { orderByKey: function(){ return this; }, limitToFirst: function(){ return this; }, get: function(){ return Promise.reject(new Error('network fail')); } }; } };
      window.__infoModal.modalEl._hidden = false;
      showDebugLog();
      await new Promise(function(r){ setTimeout(r, 0); });
      var body = window.__infoModal.bodyEl;
      if(body.innerHTML.indexOf('未知错误') < 0) throw new Error('无code应显示未知错误,实际: ' + body.innerHTML);
    } finally { restore(); }
  });

  // ================= 7. showDebugLog:读取成功,含统计条 =================
  await check('showDebugLog:读取成功时顶部有统计条,列表含全部条目', async function(){
    var entries = [
      { kind: 'js_error', isoTime: 't1', message: 'm1' },
      { kind: 'timeout_stuck', isoTime: 't2', message: 'm2' }
    ];
    db = {
      ref: function(){
        return {
          orderByKey: function(){ return this; },
          limitToFirst: function(){ return this; },
          get: function(){
            return Promise.resolve({
              exists: function(){ return true; },
              forEach: function(cb){ entries.forEach(function(e){ cb({ val: function(){ return e; } }); }); }
            });
          }
        };
      }
    };
    window.__infoModal.modalEl._hidden = false;
    showDebugLog();
    await new Promise(function(r){ setTimeout(r, 0); });
    var body = window.__infoModal.bodyEl;
    if(body.innerHTML.indexOf('dbglog-stats') < 0) throw new Error('应含统计条: ' + body.innerHTML);
    if(body.innerHTML.indexOf('最近2条') < 0) throw new Error('统计条数量不对: ' + body.innerHTML);
    if(body.innerHTML.indexOf('m1') < 0 || body.innerHTML.indexOf('m2') < 0) throw new Error('应含全部条目: ' + body.innerHTML);
  });

  await check('showDebugLog:弹窗已被用户关闭时,异步结果不应回填(避免覆盖后打开的无关浮层)', async function(){
    db = {
      ref: function(){
        return {
          orderByKey: function(){ return this; },
          limitToFirst: function(){ return this; },
          get: function(){ return Promise.resolve({ exists: function(){ return true; }, forEach: function(){} }); }
        };
      }
    };
    window.__infoModal.modalEl._hidden = false;
    window.__infoModal.bodyEl.innerHTML = '__marker__'; // showInfo()不会碰到这个桩里的.info-body,
    // 只有then/catch回调会显式写它——用这个标记值确认"弹窗关闭后回调直接return,没有写入"。
    showDebugLog();
    window.__infoModal.modalEl._hidden = true; // 异步返回前用户关闭了弹窗
    await new Promise(function(r){ setTimeout(r, 0); });
    if(window.__infoModal.bodyEl.innerHTML !== '__marker__') {
      throw new Error('弹窗已关闭时不应回填任何内容,实际: ' + window.__infoModal.bodyEl.innerHTML);
    }
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

vm.runInContext(testCode, sandbox, { filename: 'test-debug-log-error-visibility.js' });

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})();
