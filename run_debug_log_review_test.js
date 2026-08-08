/**
 * debugLogs 复核补充测试(对应 commit 907e06d 的复核任务)
 *
 * 覆盖两部分:
 *  一、normalize() 105处 pending_orphan_detected 埋点的 A/B 分类 + B类频率控制:
 *      - A类('A:'前缀,如qiangxiPickTarget):短时间内重复触发,每次都应该写日志。
 *      - B类('B:'前缀,如qiangxiChooseCost):60秒内重复触发同一类型,只应该写第一条;
 *        超过60秒窗口后应该恢复正常写入。
 *      - 105处call site的分类统计(A/B各多少条)与game.js里实际标注一致。
 *  二、"查看调试日志"按钮/弹窗(showDebugLog):
 *      - debugLogEntryHtml:kind中文映射完整覆盖4种、message正确转义、详情默认折叠。
 *      - showDebugLog:空数据/有数据/拉取失败三种状态下 #infoModal .info-body 的内容;
 *        点击摘要行展开/收起详情。
 *      - 不真的连 Firebase 网络,db.ref 换成记录调用的 spy;DOM 用针对
 *        #infoModal/.info-body 这两个实际会被调用到的节点手写的轻量 fake(regex 解析
 *        showDebugLog 真实生成的 HTML 字符串,不是访问既定的固定返回值),不用 jsdom。
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

const sandbox = vm.createContext(context, { name: 'sgs-debug-log-review-sandbox' });

console.log('Loading 调试日志复核测试环境...\n');

const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
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
console.log('  debugLogs 复核补充测试(A/B分类+频率控制、查看调试日志按钮/弹窗)');
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
        var self = {
          set: function(entry){ window.__dbSetCalls.push({ path: path, entry: entry }); return Promise.resolve(); },
          get: function(){ return (window.__dbGetImpl ? window.__dbGetImpl(path) : Promise.resolve({ exists: function(){ return false; } })); },
          update: function(){ return Promise.resolve(); },
          orderByKey: function(){ return self; },
          limitToFirst: function(){ return self; }
        };
        return self;
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
        hand: [], equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true, discard: [], deck: [] };
  }

  // ================= 一、A/B 分类 + 频率控制 =================

  await check('分类统计:105处call site恰好56条A类+49条B类(和game.js源码里的标注一致)', function(){
    if(window.__gameJsACount !== 56) throw new Error('A类应为56条,实际 ' + window.__gameJsACount);
    if(window.__gameJsBCount !== 49) throw new Error('B类应为49条,实际 ' + window.__gameJsBCount);
    if(window.__gameJsACount + window.__gameJsBCount !== 105) throw new Error('总数应为105,实际 ' + (window.__gameJsACount + window.__gameJsBCount));
  });

  await check('A类(qiangxiPickTarget):短时间内连续两次触发,都应该写日志(不限流)', function(){
    window.__dbSetCalls = [];
    var g = mkSeatG({});
    g.pending = { type: 'qiangxiPickTarget', seat: 99, candidates: [1], costType: 'hp' };
    normalize(g);
    g.pending = { type: 'qiangxiPickTarget', seat: 99, candidates: [1], costType: 'hp' };
    normalize(g);
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.pendingType === 'qiangxiPickTarget'; });
    if(calls.length !== 2) throw new Error('A类应每次都记,连续2次触发应写2条,实际 ' + calls.length);
  });

  await check('B类(qiangxiChooseCost):60秒内连续两次触发,只应写第一条(限流生效)', function(){
    window.__dbSetCalls = [];
    __pendingOrphanLastLogged = {}; // 重置频率控制表,避免跨用例残留状态互相干扰
    var g = mkSeatG({});
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.pendingType === 'qiangxiChooseCost'; });
    if(calls.length !== 1) throw new Error('B类60秒内应只记1条,实际 ' + calls.length);
  });

  await check('B类:超过60秒窗口后,应该恢复正常写入(不是永久只记一次)', function(){
    window.__dbSetCalls = [];
    __pendingOrphanLastLogged = {};
    var g = mkSeatG({});
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    // 直接操纳内部时间戳表,模拟"60秒已经过去"(不真的等60秒)
    var key = 'qiangxiChooseCost|B:normalize校验未通过,pending结构不合法(qiangxiChooseCost)';
    __pendingOrphanLastLogged[key] = Date.now() - PENDING_ORPHAN_RATE_LIMIT_MS - 1000;
    g.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g);
    var calls = window.__dbSetCalls.filter(function(c){ return c.entry.pendingType === 'qiangxiChooseCost'; });
    if(calls.length !== 2) throw new Error('窗口过期后应恢复写入,应共2条,实际 ' + calls.length);
  });

  await check('B类:不同类型互不影响频率控制(qiangxiChooseCost 被限流不影响 mingcePickCard)', function(){
    window.__dbSetCalls = [];
    __pendingOrphanLastLogged = {};
    var g1 = mkSeatG({});
    g1.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g1);
    g1.pending = { type: 'qiangxiChooseCost', seat: 99, candidates: [1] };
    normalize(g1); // 第2次应被限流跳过
    var g2 = mkSeatG({});
    g2.pending = { type: 'mingcePickCard', sourceSeat: 99 };
    normalize(g2);
    var calls = window.__dbSetCalls;
    var costCalls = calls.filter(function(c){ return c.entry.pendingType === 'qiangxiChooseCost'; });
    var mingceCalls = calls.filter(function(c){ return c.entry.pendingType === 'mingcePickCard'; });
    if(costCalls.length !== 1) throw new Error('qiangxiChooseCost应恰1条,实际 ' + costCalls.length);
    if(mingceCalls.length !== 1) throw new Error('mingcePickCard不应受影响,应恰1条,实际 ' + mingceCalls.length);
  });

  // ================= 二、"查看调试日志"按钮/弹窗 =================

  await check('debugLogEntryHtml:4种kind中文映射完整,message正确转义,详情默认折叠(hidden)', function(){
    ['js_error','timeout_stuck','bot_decision_failed','pending_orphan_detected'].forEach(function(kind){
      var html = debugLogEntryHtml({ kind: kind, isoTime: '2026-08-08 10:00:00', message: '测试<script>', phase: 'play' }, 0);
      if(html.indexOf(DEBUG_LOG_KIND_LABELS[kind]) < 0) throw new Error(kind + ' 的中文映射未出现在HTML里,实际 ' + html);
      if(html.indexOf('<script>') >= 0) throw new Error('message 未转义,存在XSS风险,实际 ' + html);
      if(html.indexOf('dbglog-detail hidden') < 0) throw new Error('详情默认应该是 hidden,实际 ' + html);
    });
  });

  await check('debugLogEntryHtml:未知kind不报错,原样显示kind字符串', function(){
    var html = debugLogEntryHtml({ kind: 'some_future_kind', isoTime: 't', message: 'm' }, 0);
    if(html.indexOf('some_future_kind') < 0) throw new Error('未知kind应原样显示,实际 ' + html);
  });

  // ---- 针对 #infoModal/.info-body 手写的轻量 fake(regex 解析真实生成的 HTML,不是jsdom) ----
  function installFakeInfoModal(){
    var modalHidden = false;
    var bodyHtml = '';
    var titleHtml = '';
    function parseRowsAndDetails(){
      var rows = [];
      var re = /class="dbglog-row" data-idx="(\d+)"/g, m;
      while((m = re.exec(bodyHtml))){ rows.push(m[1]); }
      return rows;
    }
    function detailHidden(idx){
      var re = new RegExp('class="dbglog-detail( hidden)?" data-idx="' + idx + '"');
      var m = re.exec(bodyHtml);
      return m ? !!m[1] : null;
    }
    function setDetailHidden(idx, hidden){
      bodyHtml = bodyHtml.replace(
        new RegExp('class="dbglog-detail( hidden)?" data-idx="' + idx + '"'),
        'class="dbglog-detail' + (hidden ? ' hidden' : '') + '" data-idx="' + idx + '"'
      );
    }
    var rowHandlers = {}; // idx -> onclick handler,持久存储(showDebugLog绑定的和测试读取的是同一份)
    var lastRowEls = [];
    function makeRow(idx){
      var el = { getAttribute: function(n){ return n === 'data-idx' ? idx : null; } };
      Object.defineProperty(el, 'onclick', {
        get: function(){ return rowHandlers[idx] || null; },
        set: function(fn){ rowHandlers[idx] = fn; }
      });
      return el;
    }
    var bodyEl = {
      get innerHTML(){ return bodyHtml; },
      set innerHTML(v){ bodyHtml = v; },
      querySelectorAll: function(sel){
        if(sel !== '.dbglog-row') return [];
        lastRowEls = parseRowsAndDetails().map(makeRow);
        return lastRowEls;
      },
      querySelector: function(sel){
        var mm = /\.dbglog-detail\[data-idx="(\d+)"\]/.exec(sel);
        if(!mm) return null;
        var idx = mm[1];
        var h = detailHidden(idx);
        if(h === null) return null;
        return { classList: { toggle: function(){ setDetailHidden(idx, !detailHidden(idx)); } } };
      }
    };
    var modalEl = {
      classList: { contains: function(c){ return c === 'hidden' ? modalHidden : false; }, add: function(c){ if(c==='hidden') modalHidden=true; }, remove: function(c){ if(c==='hidden') modalHidden=false; }, toggle: function(){} },
      set innerHTML(v){
        // showInfo 生成的整块HTML,里面嵌了 .info-body;这里只需要抓出 info-body 那一段,
        // 简化处理:showInfo 首次调用时 body 内容就是它自己传的 bodyHtml 参数(loading占位),
        // 之后 showDebugLog 直接改 body.innerHTML,不会再整体替换 modalEl.innerHTML。
        var mm = /<div class="info-body">([\s\S]*)<\/div><\/div>$/.exec(v);
        bodyHtml = mm ? mm[1] : v;
        titleHtml = v;
      },
      get innerHTML(){ return titleHtml; },
      querySelector: function(sel){ return sel === '.info-body' ? bodyEl : { onclick: null }; },
      onclick: null
    };
    var realGetById = document.getElementById;
    document.getElementById = function(id){
      if(id === 'infoModal') return modalEl;
      return realGetById(id);
    };
    return { modalEl: modalEl, bodyEl: bodyEl };
  }

  await check('showDebugLog:无房间号 → 提示"当前不在房间中"', function(){
    var fake = installFakeInfoModal();
    var savedRoomId = roomId;
    roomId = null;
    showDebugLog();
    roomId = savedRoomId;
    if(fake.bodyEl.innerHTML.indexOf('当前不在房间中') < 0) throw new Error('应提示未在房间中,实际 ' + fake.bodyEl.innerHTML);
  });

  await check('showDebugLog:空数据 → 提示"暂无调试日志记录"', async function(){
    var fake = installFakeInfoModal();
    window.__dbGetImpl = function(){ return Promise.resolve({ exists: function(){ return false; } }); };
    showDebugLog();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    if(fake.bodyEl.innerHTML.indexOf('暂无调试日志记录') < 0) throw new Error('应提示暂无记录,实际 ' + fake.bodyEl.innerHTML);
  });

  await check('showDebugLog:拉取失败 → 提示"拉取调试日志失败"', async function(){
    var fake = installFakeInfoModal();
    window.__dbGetImpl = function(){ return Promise.reject(new Error('网络错误')); };
    showDebugLog();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    if(fake.bodyEl.innerHTML.indexOf('拉取调试日志失败') < 0) throw new Error('应提示拉取失败,实际 ' + fake.bodyEl.innerHTML);
  });

  await check('showDebugLog:有数据 → 渲染N条记录,点击摘要行展开/收起详情', async function(){
    var fake = installFakeInfoModal();
    var mockEntries = [
      { kind: 'js_error', isoTime: '2026-08-08 10:00:00', message: '第1条', phase: 'play' },
      { kind: 'timeout_stuck', isoTime: '2026-08-08 09:59:00', message: '第2条', phase: 'respond' }
    ];
    window.__dbGetImpl = function(){
      return Promise.resolve({
        exists: function(){ return true; },
        forEach: function(cb){ mockEntries.forEach(function(e, i){ cb({ key: 'k' + i, val: function(){ return e; } }); }); }
      });
    };
    showDebugLog();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    var rows = fake.bodyEl.querySelectorAll('.dbglog-row');
    if(rows.length !== 2) throw new Error('应渲染2条记录,实际 ' + rows.length);
    if(fake.bodyEl.innerHTML.indexOf('第1条') < 0 || fake.bodyEl.innerHTML.indexOf('第2条') < 0)
      throw new Error('两条message都应出现,实际 ' + fake.bodyEl.innerHTML);
    // 展开前:详情应是hidden
    var detail0Before = fake.bodyEl.querySelector('.dbglog-detail[data-idx="0"]');
    if(!detail0Before) throw new Error('第0条详情节点应存在');
    // 触发点击(showDebugLog 已经把 onclick 绑定到每个 row 上)
    rows[0].onclick.call(rows[0]);
    var reHidden = /class="dbglog-detail( hidden)?" data-idx="0"/.exec(fake.bodyEl.innerHTML);
    if(!reHidden || reHidden[1]) throw new Error('点击后第0条详情应展开(不再有hidden),实际 ' + fake.bodyEl.innerHTML.slice(0,300));
    // 再点一次应收起
    rows[0].onclick.call(rows[0]);
    var reHidden2 = /class="dbglog-detail( hidden)?" data-idx="0"/.exec(fake.bodyEl.innerHTML);
    if(!reHidden2 || !reHidden2[1]) throw new Error('再次点击后应收起(恢复hidden),实际 ' + fake.bodyEl.innerHTML.slice(0,300));
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

const gameJsSrc = fs.readFileSync('game.js', 'utf8');
const gameJsACount = (gameJsSrc.match(/logPendingOrphan\(g, 'A:/g) || []).length;
const gameJsBCount = (gameJsSrc.match(/logPendingOrphan\(g, 'B:/g) || []).length;
vm.runInContext('window.__gameJsACount = ' + gameJsACount + '; window.__gameJsBCount = ' + gameJsBCount + ';', sandbox);

vm.runInContext(testCode, sandbox);

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})();
