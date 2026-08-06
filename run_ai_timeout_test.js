/**
 * A1 响应超时托管测试 - maybeAutoRespondTimeout / normalize 补戳 / renderResponseCountdown
 *
 * 加载真实 data.js + game.js + skills.js + bot-ai-bus.js + bot.js 进共享 vm 沙箱
 * (与 run_lidian_test.js 同一套 fs.readFileSync + vm.Script + vm.createContext 惯例),
 * 在沙箱内运行断言。覆盖:
 * 1. 超时 pending(askedAt=now-31s) -> maybeAutoRespondTimeout -> 保守动作被调(spy)
 * 2. 未超时 -> 不提交(spy 不被调)
 * 3. 阶段已变(服务端 pending 已清) -> 提交被拒无副作用(真实响应函数走 tx,守卫拦截)
 * 4. normalize 对无 askedAt 的响应型 pending 补戳
 * 5. renderResponseCountdown 输出 "⏱ Ns 后自动…"
 * 6. 无密钥路径不受影响(超时托管不触发任何 AI 调用)
 *
 * 已知 vm 坑:game.js 的 let mySeat/gameRef 是脚本作用域绑定,沙箱属性赋值无效,必须用
 * runInContext 里裸标识符赋值;响应函数是函数声明绑定,可直接整体替换成 spy。
 */

const vm = require('vm');
const fs = require('fs');

// 共享上下文:document/window/firebase 给最小 stub(游戏文件顶层有 getElementById /
// addEventListener / firebase.initializeApp 等立即执行代码)。
const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  mySeat: 0,
  joinRoom: function(){},
  myClientId: 'timeout-test-client',
  localStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  firebase: {
    initializeApp: function(){ return { database: function(){ return { ref: function(){ return {}; } }; } }; },
    database: function(){ return { ref: function(){ return {}; } }; }
  },
  document: {
    getElementById: function(){ return {
      textContent: '', className: '', style: {}, innerHTML: '',
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, remove: function(){}
    }; },
    createElement: function(){ return {
      textContent: '', className: '', style: {}, innerHTML: '',
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, setAttribute: function(){}
    }; },
    addEventListener: function(){},
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; },
    body: { appendChild: function(){ return {}; } }
  },
  window: {
    aiConversations: {},
    addEventListener: function(){},
    location: { search: '', href: 'http://localhost', reload: function(){} },
    localStorage: function(){ return null; }
  }
};
context.window.sessionStorage = context.sessionStorage;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-timeout-sandbox' });

console.log('Loading A1 超时托管测试环境...\n');

// 只加载真实源文件:data.js(常量表)、game.js(服务端逻辑+打戳+normalize)、skills.js
// (技能响应函数)、bot-ai-bus.js(检测器/保守动作表/倒计时)、bot.js(botInvoke/BOT_PHASE_ACTOR)。
// ai-bot.js 不加载:检测器不碰 AI,加载它只会引入 sessionStorage/callAI 依赖。
const files = ['data.js', 'room-lifecycle.js', 'game.js', 'skills.js', 'bot-ai-bus.js', 'bot.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

// game.js 的 tx() 走 gameRef.transaction:stub 成"直接跑回调,传入 window.__g 作为当前状态",
// 保留 tx 内部 normalize/pruneExchangeCards/stripUndefined 的真实行为(和 run_lidian 不同,
// 那条测试直接替换了 tx 本身、把 normalize 也替换掉了;这里必须保留 normalize 才能测补戳)。
vm.runInContext('gameRef = { transaction: function(fn){ return fn(window.__g); } };', sandbox);
vm.runInContext('mySeat = 0;', sandbox);
console.log('\n' + '='.repeat(60));
console.log('  A1 响应超时托管测试');
console.log('='.repeat(60) + '\n');

// 断言脚本整体在沙箱内执行(裸标识符赋值才能命中脚本作用域绑定)。
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

  // 造一个最小的存活玩家集合(wuxie 响应者 / 濒死者都在里面)
  function mkG(extra){
    var g = {
      started: true,
      roundNum: 1,
      phase: 'play',
      turn: 0,
      deck: [], discard: [],
      log: [],
      players: [
        { name: '甲', alive: true, hp: 1, maxHp: 1, hand: [], equips: {}, delays: [] },
        { name: '乙', alive: true, hp: 1, maxHp: 1, hand: [], equips: {}, delays: [] }
      ]
    };
    for (var k in (extra || {})) g[k] = extra[k];
    return g;
  }

  // 1. 超时 pending(askedAt = now - 31s)-> maybeAutoRespondTimeout -> 保守动作 spy 被调
  var spyCalls = 0;
  respondWuxie = function(useWuxie){ spyCalls++; return null; }; // 覆盖函数声明绑定为 spy
  window.__g = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: Date.now() - 31000 }
  });
  maybeAutoRespondTimeout(window.__g);
  await check('超时 pending -> maybeAutoRespondTimeout 调保守动作 spy', function(){
    if(spyCalls !== 1) throw new Error('respondWuxie 应被调 1 次,实际 ' + spyCalls);
  });

  // 2. 未超时(askedAt = now)-> 不提交(spy 计数不变)
  spyCalls = 0;
  window.__g = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: Date.now() }
  });
  maybeAutoRespondTimeout(window.__g);
  await check('未超时 -> 不提交(spy 不被调)', function(){
    if(spyCalls !== 0) throw new Error('respondWuxie 不应被调,实际 ' + spyCalls);
  });

  // 3. 阶段已变(检测器拿到 stale 快照,服务端 pending 已清)-> 提交被拒无副作用
  //    staleG 是超时 pending 的副本;服务端 window.__g 已是新状态(phase=play, pending=null)。
  //    maybeAutoRespondTimeout(staleG) 提交保守动作 -> botInvoke -> respondWuxie 真实函数
  //    -> tx -> 服务端守卫(!g.pending)拦截 -> 状态零变化。
  window.__g = mkG({ phase: 'play' }); // 服务端:阶段已变,pending 已清
  var staleG = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: Date.now() - 31000 }
  });
  var logBefore = (window.__g.log || []).length;
  maybeAutoRespondTimeout(staleG);
  await check('阶段已变 -> 提交被拒无副作用', function(){
    if(window.__g.phase !== 'play') throw new Error('phase 不应变化,实际 ' + window.__g.phase);
    if(window.__g.pending !== null && window.__g.pending !== undefined) throw new Error('pending 不应出现');
    if((window.__g.log || []).length !== logBefore) throw new Error('日志不应新增');
  });

  // 4. normalize 对无 askedAt 的响应型 pending 补戳
  var g4 = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1 }
  });
  normalize(g4);
  await check('normalize 对无 askedAt 的响应型 pending 补戳', function(){
    if(typeof g4.pending.askedAt !== 'number') throw new Error('askedAt 应为 number,实际 ' + g4.pending.askedAt);
  });

  // 4b. normalize 不重复打已有 askedAt(创建处已打的戳保持原值)
  var g4b = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: 12345 }
  });
  normalize(g4b);
  await check('normalize 不覆盖已存在的 askedAt', function(){
    if(g4b.pending.askedAt !== 12345) throw new Error('askedAt 应保持 12345,实际 ' + g4b.pending.askedAt);
  });

  // 5. 倒计时文案:renderResponseCountdown 输出 "⏱ Ns 后自动…"
  var g5 = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: Date.now() - 5000 }
  });
  var cd = renderResponseCountdown(g5);
  await check('renderResponseCountdown 输出 "⏱ Ns 后自动…"', function(){
    if(typeof cd !== 'string') throw new Error('应返回字符串,实际 ' + cd);
    if(!/⏱ \d+s 后自动…/.test(cd)) throw new Error('文案格式不符: ' + cd);
    var n = parseInt(cd.match(/⏱ (\d+)s/)[1], 10);
    if(n < 24 || n > 26) throw new Error('剩余秒数应约 25(askedAt=now-5s),实际 ' + n);
  });

  // 5b. 无 askedAt(非响应型 pending) -> null
  var g5b = mkG({ phase: 'play', pending: null });
  var cdNull = renderResponseCountdown(g5b);
  await check('renderResponseCountdown 非响应型 -> null', function(){
    if(cdNull !== null) throw new Error('应返回 null,实际 ' + cdNull);
  });

  // 6. 无密钥路径不受影响:超时托管不触发任何 AI 调用(也不依赖 aiApiKey)
  window.__aiCalls = 0;
  callAI = async function(){ window.__aiCalls++; return { ok: true, text: '{"choice":0}' }; };
  var g6 = mkG({
    phase: 'wuxie',
    pending: { type: 'wuxie', from: 0, to: 0, exclude: 0, depth: 0, asking: 1, askedAt: Date.now() - 31000 }
  });
  respondWuxie = function(useWuxie){ return null; }; // 还原为无害 spy,避免真实服务端逻辑干扰计数
  window.__g = g6;
  maybeAutoRespondTimeout(g6);
  await check('无密钥路径:超时托管不触发 callAI', function(){
    if(window.__aiCalls !== 0) throw new Error('callAI 不应被调用,实际 ' + window.__aiCalls);
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

// 等沙箱内异步断言跑完,按结果退出(全绿 0,任一失败 1)
(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
