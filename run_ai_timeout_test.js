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

  // ---- 左慈【化身/新生】超时兜底修复(真实bug:huashenChangeAskStart/AskEnd/
  // PickStart/PickEnd 此前既没登记进 autoRespondAction 白名单,创建时也没打 askedAt
  // 时间戳——两处都要修,只改一处等于没修。这四项都用真实respond函数(不是spy)全链路
  // 验证:超时后pending真的被清、流程真的往下走,不是只验证"函数被调了一次") ----

  // 7. huashenChangeAskStart 超时 -> 真实提交respondHuashenChangeAskStart(false) ->
  //    "不更改"分支生效,pending推进离开huashenChangeAskStart(不卡在原地)。
  var g7 = mkG({
    phase: 'huashenChangeAskStart',
    pending: setResponseAskedAt({ type: 'huashenChangeAskStart', seat: 0 })
  });
  g7.players[0].huashenGeneral = 'xiahouyuan';
  g7.players[0].huashenPool = ['xiahouyuan'];
  g7.pending.askedAt = Date.now() - 31000; // 补造成"31秒前问的"
  window.__g = g7;
  maybeAutoRespondTimeout(g7);
  await check('huashenChangeAskStart 超时 -> 真实提交respondHuashenChangeAskStart(false),不再卡在原地', function(){
    if(g7.phase === 'huashenChangeAskStart') throw new Error('phase 不应仍停在 huashenChangeAskStart,实际 ' + g7.phase);
    if(g7.pending && g7.pending.type === 'huashenChangeAskStart') throw new Error('pending 不应仍是 huashenChangeAskStart');
    if(!g7.log.some(function(e){ return /不更改/.test(e.text||e); })) throw new Error('应记录"不更改"日志');
  });

  // 8. huashenChangeAskEnd 超时 -> 真实提交respondHuashenChangeAskEnd(false)
  var g8 = mkG({
    phase: 'huashenChangeAskEnd',
    pending: setResponseAskedAt({ type: 'huashenChangeAskEnd', seat: 0 })
  });
  g8.players[0].huashenGeneral = 'xiahouyuan';
  g8.players[0].huashenPool = ['xiahouyuan'];
  g8.pending.askedAt = Date.now() - 31000;
  window.__g = g8;
  maybeAutoRespondTimeout(g8);
  await check('huashenChangeAskEnd 超时 -> 真实提交respondHuashenChangeAskEnd(false),不再卡在原地', function(){
    if(g8.phase === 'huashenChangeAskEnd') throw new Error('phase 不应仍停在 huashenChangeAskEnd,实际 ' + g8.phase);
    if(g8.pending && g8.pending.type === 'huashenChangeAskEnd') throw new Error('pending 不应仍是 huashenChangeAskEnd');
  });

  // 9. huashenChangePickStart 超时 -> 兜底选huashenPool里第一个技能表非空的武将+它的
  //    第一个技能条目,真实提交respondHuashenChangePickStart,validateHuashenPick必须
  //    通过(不是随便传一个字符串导致守卫拒绝、pending原地不动)。
  var g9 = mkG({
    phase: 'huashenChangePickStart',
    pending: setResponseAskedAt({ type: 'huashenChangePickStart', seat: 0 })
  });
  g9.players[0].huashenGeneral = 'xiahouyuan';
  g9.players[0].huashenPool = ['xiahouyuan'];
  g9.players[0].huashenSkillName = '神速';
  g9.pending.askedAt = Date.now() - 31000;
  window.__g = g9;
  maybeAutoRespondTimeout(g9);
  await check('huashenChangePickStart 超时 -> 兜底选择合法武将+技能,真实提交并推进(不被validateHuashenPick拒绝)', function(){
    if(g9.phase === 'huashenChangePickStart') throw new Error('phase 不应仍停在 huashenChangePickStart,实际 ' + g9.phase);
    if(g9.pending && g9.pending.type === 'huashenChangePickStart') throw new Error('pending 不应仍是 huashenChangePickStart(说明兜底选择被validateHuashenPick拒绝)');
    if(g9.players[0].huashenGeneral !== 'xiahouyuan') throw new Error('huashenGeneral 应保持/确认为 xiahouyuan,实际 ' + g9.players[0].huashenGeneral);
    if(g9.players[0].huashenSkillName !== '神速') throw new Error('huashenSkillName 应为 神速,实际 ' + g9.players[0].huashenSkillName);
  });

  // 10. huashenChangePickEnd 超时 -> 同上,respondHuashenChangePickEnd(room-lifecycle.js)
  var g10 = mkG({
    phase: 'huashenChangePickEnd',
    pending: setResponseAskedAt({ type: 'huashenChangePickEnd', seat: 0 })
  });
  g10.players[0].huashenGeneral = 'xiahouyuan';
  g10.players[0].huashenPool = ['xiahouyuan'];
  g10.players[0].huashenSkillName = '神速';
  g10.pending.askedAt = Date.now() - 31000;
  window.__g = g10;
  maybeAutoRespondTimeout(g10);
  await check('huashenChangePickEnd 超时 -> 兜底选择合法武将+技能,真实提交并推进(不被validateHuashenPick拒绝)', function(){
    if(g10.phase === 'huashenChangePickEnd') throw new Error('phase 不应仍停在 huashenChangePickEnd,实际 ' + g10.phase);
    if(g10.pending && g10.pending.type === 'huashenChangePickEnd') throw new Error('pending 不应仍是 huashenChangePickEnd(说明兜底选择被validateHuashenPick拒绝)');
    if(g10.players[0].huashenGeneral !== 'xiahouyuan') throw new Error('huashenGeneral 应保持/确认为 xiahouyuan,实际 ' + g10.players[0].huashenGeneral);
    if(g10.players[0].huashenSkillName !== '神速') throw new Error('huashenSkillName 应为 神速,实际 ' + g10.players[0].huashenSkillName);
  });

  // 11. 关键回归:直接调用真实的pending创建函数(不是本测试手动构造pending),验证
  //     这次编辑的四处调用点(skills.js/game.js/room-lifecycle.js)真的补上了
  //     setResponseAskedAt——如果只改了 autoRespondAction 白名单、忘了这四处创建点,
  //     上面7~10项测试就是在自己伪造的假前提(手动写了askedAt)上通过,测不出真实bug
  //     是否修复。这里让真实代码路径自己创建pending,检查它自带的askedAt是不是number。
  var g11 = mkG({ phase: 'play', turn: 0 });
  g11.players[0].general = 'zuoci';
  g11.players[0].huashenGeneral = 'xiahouyuan';
  g11.players[0].huashenPool = ['xiahouyuan'];
  continueHuashenChangeCheckAtTurnStart(g11, 0); // 真实回合开始入口,不是测试手搭的假pending
  await check('回归:continueHuashenChangeCheckAtTurnStart真实创建的pending自带askedAt(不是测试伪造的)', function(){
    if(!g11.pending || g11.pending.type !== 'huashenChangeAskStart') throw new Error('应真实进入 huashenChangeAskStart,实际 ' + JSON.stringify(g11.pending));
    if(typeof g11.pending.askedAt !== 'number') throw new Error('真实创建的pending应自带askedAt数字,实际 ' + g11.pending.askedAt);
  });

  var g11b = mkG({ phase: 'huashenChangeAskStart', pending: { type: 'huashenChangeAskStart', seat: 0 } });
  g11b.players[0].general = 'zuoci';
  g11b.players[0].huashenGeneral = 'xiahouyuan';
  g11b.players[0].huashenPool = ['xiahouyuan'];
  window.__g = g11b; // respondHuashenChangeAskStart 内部走 tx(),stub 读 window.__g
  mySeat = 0;
  respondHuashenChangeAskStart(true); // 真实"更改"分支,走到huashenChangePickStart
  await check('回归:respondHuashenChangeAskStart(true)真实创建的huashenChangePickStart pending自带askedAt', function(){
    var g = window.__g;
    if(!g.pending || g.pending.type !== 'huashenChangePickStart') throw new Error('应真实进入 huashenChangePickStart,实际 ' + JSON.stringify(g.pending));
    if(typeof g.pending.askedAt !== 'number') throw new Error('真实创建的pending应自带askedAt数字,实际 ' + g.pending.askedAt);
  });

  var g11c = mkG({ phase: 'play', turn: 0 });
  g11c.players[0].general = 'zuoci';
  g11c.players[0].huashenGeneral = 'xiahouyuan';
  g11c.players[0].huashenPool = ['xiahouyuan'];
  continueHuashenChangeCheckAtTurnEnd(g11c, 0); // 真实回合结束入口
  await check('回归:continueHuashenChangeCheckAtTurnEnd真实创建的pending自带askedAt', function(){
    if(!g11c.pending || g11c.pending.type !== 'huashenChangeAskEnd') throw new Error('应真实进入 huashenChangeAskEnd,实际 ' + JSON.stringify(g11c.pending));
    if(typeof g11c.pending.askedAt !== 'number') throw new Error('真实创建的pending应自带askedAt数字,实际 ' + g11c.pending.askedAt);
  });

  var g11d = mkG({ phase: 'huashenChangeAskEnd', pending: { type: 'huashenChangeAskEnd', seat: 0 } });
  g11d.players[0].general = 'zuoci';
  g11d.players[0].huashenGeneral = 'xiahouyuan';
  g11d.players[0].huashenPool = ['xiahouyuan'];
  window.__g = g11d;
  mySeat = 0;
  respondHuashenChangeAskEnd(true); // 真实"更改"分支,走到huashenChangePickEnd
  await check('回归:respondHuashenChangeAskEnd(true)真实创建的huashenChangePickEnd pending自带askedAt', function(){
    var g = window.__g;
    if(!g.pending || g.pending.type !== 'huashenChangePickEnd') throw new Error('应真实进入 huashenChangePickEnd,实际 ' + JSON.stringify(g.pending));
    if(typeof g.pending.askedAt !== 'number') throw new Error('真实创建的pending应自带askedAt数字,实际 ' + g.pending.askedAt);
  });

  // ---- 问题一:huashenChangePickStart/PickEnd 找不到合法候选武将时静默 return,
  // pending 永久悬空(本局内恒定,重试无法自愈)的真实bug ----

  // 12. runBotDecision 走到 huashenChangePickStart,huashenPool 里没有任何一个在
  //     HUASHEN_SKILL_TABLE 里有可用技能条目的武将(构造一个不存在的武将id)——
  //     修复前:generalId=find返回undefined,if(generalId)分支不执行,直接return,
  //     pending原地不动;修复后:落到else分支调用abandonHuashenChangePickStart,
  //     真实推进离开huashenChangePickStart。
  var g12 = mkG({ phase: 'huashenChangePickStart', turn: 0, pending: { type: 'huashenChangePickStart', seat: 0 } });
  g12.players[0].isBot = true;
  g12.players[0].general = 'zuoci';
  g12.players[0].huashenGeneral = 'xiahouyuan';
  g12.players[0].huashenPool = ['__no_such_general__']; // 池子里没有任何合法候选
  window.__g = g12;
  mySeat = 0;
  await runBotDecision(g12, 0);
  await check('问题一修复:huashenChangePickStart 找不到候选武将时不再静默卡死,真实推进离开原phase', function(){
    var g = window.__g;
    if(g.phase === 'huashenChangePickStart') throw new Error('phase 不应仍停在 huashenChangePickStart,实际 ' + g.phase);
    if(g.pending && g.pending.type === 'huashenChangePickStart') throw new Error('pending 不应仍是 huashenChangePickStart(静默卡死复现)');
  });

  // 13. 同上,回合结束一侧 huashenChangePickEnd
  var g13 = mkG({ phase: 'huashenChangePickEnd', turn: 0, pending: { type: 'huashenChangePickEnd', seat: 0 } });
  g13.players[0].isBot = true;
  g13.players[0].general = 'zuoci';
  g13.players[0].huashenGeneral = 'xiahouyuan';
  g13.players[0].huashenPool = ['__no_such_general__'];
  window.__g = g13;
  mySeat = 0;
  await runBotDecision(g13, 0);
  await check('问题一修复:huashenChangePickEnd 找不到候选武将时不再静默卡死,真实推进离开原phase', function(){
    var g = window.__g;
    if(g.phase === 'huashenChangePickEnd') throw new Error('phase 不应仍停在 huashenChangePickEnd,实际 ' + g.phase);
    if(g.pending && g.pending.type === 'huashenChangePickEnd') throw new Error('pending 不应仍是 huashenChangePickEnd(静默卡死复现)');
  });

  // 14. 安全网同款修复:maybeAutoRespondTimeout 对同一个"找不到候选"边界,超时后也不再
  //     静默无作为(问题二的白名单条目本身如果继续沿用旧的"找不到就return"写法,这条
  //     安全网对这个边界条件同样失效——两处必须用同一套兜底,不能只修其中一处)。
  var g14 = mkG({ phase: 'huashenChangePickStart', pending: setResponseAskedAt({ type: 'huashenChangePickStart', seat: 0 }) });
  g14.players[0].general = 'zuoci';
  g14.players[0].huashenGeneral = 'xiahouyuan';
  g14.players[0].huashenPool = ['__no_such_general__'];
  g14.pending.askedAt = Date.now() - 31000;
  window.__g = g14;
  mySeat = 0;
  maybeAutoRespondTimeout(g14);
  await check('安全网同款修复:huashenChangePickStart 超时且找不到候选武将时,同样不再静默无作为', function(){
    if(g14.phase === 'huashenChangePickStart') throw new Error('phase 不应仍停在 huashenChangePickStart,实际 ' + g14.phase);
    if(g14.pending && g14.pending.type === 'huashenChangePickStart') throw new Error('pending 不应仍是 huashenChangePickStart(安全网对这个边界依然无效)');
  });

  var g15 = mkG({ phase: 'huashenChangePickEnd', pending: setResponseAskedAt({ type: 'huashenChangePickEnd', seat: 0 }) });
  g15.players[0].general = 'zuoci';
  g15.players[0].huashenGeneral = 'xiahouyuan';
  g15.players[0].huashenPool = ['__no_such_general__'];
  g15.pending.askedAt = Date.now() - 31000;
  window.__g = g15;
  mySeat = 0;
  maybeAutoRespondTimeout(g15);
  await check('安全网同款修复:huashenChangePickEnd 超时且找不到候选武将时,同样不再静默无作为', function(){
    if(g15.phase === 'huashenChangePickEnd') throw new Error('phase 不应仍停在 huashenChangePickEnd,实际 ' + g15.phase);
    if(g15.pending && g15.pending.type === 'huashenChangePickEnd') throw new Error('pending 不应仍是 huashenChangePickEnd(安全网对这个边界依然无效)');
  });

  // CORE-03:源码确认的六个阻塞选择阶段必须同时具备 askedAt 和保守动作。
  var timeoutCases = [
    ['duanbingChoose','sourceSeat','cancelDuanbing'],
    ['mingcePickCard','sourceSeat','cancelMingce'],
    ['qiaomengChoose','sourceSeat','cancelQiaomeng'],
    ['lianyingAsk','seat','respondLianying'],
    ['tieqi','from','respondTieqi'],
    ['liegong','from','respondLiegong']
  ];
  var timeoutHits = {};
  cancelDuanbing=function(){timeoutHits.cancelDuanbing=(timeoutHits.cancelDuanbing||0)+1;};
  cancelMingce=function(){timeoutHits.cancelMingce=(timeoutHits.cancelMingce||0)+1;};
  cancelQiaomeng=function(){timeoutHits.cancelQiaomeng=(timeoutHits.cancelQiaomeng||0)+1;};
  respondLianying=function(v){if(v===false)timeoutHits.respondLianying=(timeoutHits.respondLianying||0)+1;};
  respondTieqi=function(v){if(v===false)timeoutHits.respondTieqi=(timeoutHits.respondTieqi||0)+1;};
  respondLiegong=function(v){if(v===false)timeoutHits.respondLiegong=(timeoutHits.respondLiegong||0)+1;};
  botInvoke=function(seat,fn){fn();};
  for(var tc=0;tc<timeoutCases.length;tc++){
    var row=timeoutCases[tc], pending={type:row[0]}; pending[row[1]]=0;
    if(!RESPONSE_PENDING_TYPES.has(row[0])) throw new Error(row[0]+' 未登记 RESPONSE_PENDING_TYPES');
    pending.askedAt=Date.now()-31000;
    var tg=mkG({phase:row[0],pending:pending});
    maybeAutoRespondTimeout(tg);
  }
  await check('CORE-03 六个阻塞阶段均有30秒保守动作',function(){
    timeoutCases.forEach(function(row){if(timeoutHits[row[2]]!==1)throw new Error(row[0]+' 未执行 '+row[2]);});
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
