/**
 * AI 总线信息层测试 - buildBotVisibleState 技能常开 / recentLog / myFlags
 *
 * 加载真实 data.js + ai-bot.js + bot.js 进共享 vm 沙箱(与 run_ai_bus_core_test.js
 * 同一套 fs.readFileSync + vm.Script + vm.createContext 惯例),在沙箱内运行断言。
 * 覆盖:generalSkill/generalDesc 不依赖 isFirstTurn 常开(desc 全量不截断)、recentLog
 * 取最近15条并对齐末项、无 discardPile 键(token 优化)、myFlags 自身标志投影、
 * buildBotGuhuoVisibleState 不泄露 actualCard 真实牌名(回归)。
 *
 * 已知的 vm 坑:aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let 绑定,必须用
 * runInContext 里裸标识符赋值;distance/attackRange 是 game.js 的函数声明,沙箱不
 * 加载 game.js(为两个 6 行函数拖进 config/room-lifecycle/game/weapons/skills 整条
 * 依赖链不值),在 context 里给最小 stub——attackRange 的 stub 逻辑与 game.js 2799
 * 行真实实现逐行一致(读武器槽+getEquip 查 range,无武器回退 1),只测 buildBotVisibleState
 * 的接线(正确调用 attackRange(g,seat) 并投影进 myAttackRange),不替真实实现背书。
 */

const vm = require('vm');
const fs = require('fs');

// 共享上下文:ai-bot.js 顶层 IIFE 读 sessionStorage,setupRefreshWarning 读
// window.aiConversations,showAiThinkingIndicator/hideAiThinkingIndicator 读
// document.getElementById(...).classList —— 全部在这里给最小 stub。
const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  mySeat: 0,
  myClientId: 'test-client',
  // game.js 的 distance 不在沙箱里,给最小 stub(buildBotVisibleState 用它算距离)
  distance: function(){ return 1; },
  // game.js 的 attackRange 不在沙箱里,给最小 stub(逻辑与 game.js:2799 逐行一致:
  // 武器槽的 getEquip().range,无武器/无 range 回退 1)——getEquip 来自已加载的 data.js,
  // 是沙箱 realm 的全局,Node realm 的 stub 闭包拿不到裸标识符,经 context.getEquip 引用
  // (data.js 加载后顶层 function 声明会挂到 context 上,和 distance stub 同款惯例)。
  attackRange: function(g, seat){
    var p = g && g.players && g.players[seat];
    var w = p && p.equips && p.equips.weapon;
    var info = w && context.getEquip(w.name);
    return (info && typeof info.range === 'number') ? info.range : 1;
  },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  document: {
    getElementById: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, remove: function(){}
    }; },
    createElement: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, setAttribute: function(){}
    }; },
    addEventListener: function(){},
    body: { appendChild: function(){ return {}; } },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; }
  },
  window: {
    aiConversations: {},
    addEventListener: function(){},
    location: { search: '', href: 'http://localhost', reload: function(){} }
  }
};
// 沙箱内裸 sessionStorage 与 window.sessionStorage 同源指向上面这个 stub
context.window.sessionStorage = context.sessionStorage;

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-info-sandbox' });

console.log('Loading AI 总线信息层测试环境...\n');

// 加载真实源文件:data.js(GENERALS 武将表)必须排在 bot.js 之前,
// bot.js 的 buildBotVisibleState 在运行时查 GENERALS。
const files = ['data.js', 'ai-bot.js', 'bot.js'];
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

console.log('\n' + '='.repeat(60));
console.log('  AI 总线信息层测试');
console.log('='.repeat(60) + '\n');

// 断言脚本整体在沙箱内执行(与 run_ai_bus_core_test.js 同一惯例)
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

  // 构造一份最小对局状态:座位0是郭嘉(在 GENERALS 里),座位1存活
  function mkG(){
    var players = [];
    for(var i = 0; i < 2; i++){
      players.push({
        name: '玩家' + i, alive: true, hp: 4, maxHp: 4,
        hand: [], equips: null, delays: [], role: 'zhu',
        faceup: true, general: i === 0 ? 'guojia' : 'simayi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0 };
  }

  // 1. generalSkill/generalDesc 常开:已知武将 id 下非空字符串,desc 为全量原文
  await check('generalSkill 为 guojia 技能非空字符串', function(){
    var g = mkG();
    var s = buildBotVisibleState(g, 0);
    var gs = s.players[0].generalSkill;
    if(typeof gs !== 'string' || gs.length === 0) throw new Error('期望非空字符串,实际 ' + JSON.stringify(gs));
    var gd = s.players[0].generalDesc;
    if(typeof gd !== 'string' || gd.length === 0) throw new Error('期望非空字符串,实际 ' + JSON.stringify(gd));
    if(gd !== String(GENERALS['guojia'].desc||'')) throw new Error('desc 应为全量原文,实际长度 ' + gd.length);
  });

  // 1b. desc 全量:构造 200 字长 desc(>120 截断阈值)→ JSON 里出现完整尾部,截断则断言失败
  await check('desc 超120字仍全量(尾部20字在JSON中)', function(){
    var g = mkG();
    var longDesc = '决断与谋略并重,行险而不失其正,料敌机先,善守善攻。'.repeat(6); // 20×6=120+ 超阈值
    var orig = GENERALS['guojia'].desc;
    try {
      GENERALS['guojia'].desc = longDesc;
      var s = buildBotVisibleState(g, 0);
      var gd = s.players[0].generalDesc;
      if(gd !== longDesc) throw new Error('期望全量 ' + longDesc.length + ' 字,实际 ' + (gd ? gd.length : String(gd)));
      var json = JSON.stringify(s);
      var tail = longDesc.slice(-20);
      if(json.indexOf(tail) === -1) throw new Error('JSON 中应出现 desc 尾部: ' + tail);
    } finally {
      GENERALS['guojia'].desc = orig;
    }
  });

  // 2. 不传第三参(或显式 false)也有 skill —— 证明不依赖 isFirstTurn
  await check('不传第三参 generalSkill 仍存在(isFirstTurn 无关)', function(){
    var g = mkG();
    var s = buildBotVisibleState(g, 0, false);
    if(typeof s.players[0].generalSkill !== 'string' || s.players[0].generalSkill.length === 0){
      throw new Error('显式 false 时 generalSkill 不应为空');
    }
  });

  // 3. recentLog:30 条日志 → 只留最近15条,且末项对齐第30条
  await check('recentLog 长度15且末项对齐', function(){
    var g = mkG();
    g.log = [];
    for(var i = 1; i <= 30; i++){ g.log.push({ seq: i, text: '日志' + i }); }
    var s = buildBotVisibleState(g, 0);
    if(!Array.isArray(s.recentLog) || s.recentLog.length !== 15){
      throw new Error('期望长度15,实际 ' + (s.recentLog && s.recentLog.length));
    }
    if(s.recentLog[14] !== '日志30') throw new Error('末项应为 日志30,实际 ' + s.recentLog[14]);
    if(s.recentLog[0] !== '日志16') throw new Error('首项应为 日志16,实际 ' + s.recentLog[0]);
  });

  // 4. myFlags:shaUsed / jiangchiNoSlash 布尔投影(自身座位)
  await check('myFlags 含 shaUsed/jiangchiNoSlash 布尔', function(){
    var g = mkG();
    g.shaUsed = true;
    g.players[0].jiangchiNoSlash = true;
    g.players[1].jiangchiNoSlash = true;
    var s = buildBotVisibleState(g, 0);
    if(!s.myFlags) throw new Error('myFlags 缺失');
    if(s.myFlags.shaUsed !== true) throw new Error('shaUsed 期望 true,实际 ' + s.myFlags.shaUsed);
    if(s.myFlags.jiangchiNoSlash !== true) throw new Error('jiangchiNoSlash 期望 true,实际 ' + s.myFlags.jiangchiNoSlash);
    // 未设置的字段应为 false(!!undefined),不出现 undefined
    var g2 = mkG();
    var s2 = buildBotVisibleState(g2, 0);
    if(s2.myFlags.shaUsed !== false) throw new Error('shaUsed 缺失时应为 false,实际 ' + s2.myFlags.shaUsed);
    if(s2.myFlags.jiangchiNoSlash !== false) throw new Error('jiangchiNoSlash 缺失时应为 false,实际 ' + s2.myFlags.jiangchiNoSlash);
  });

  // 5. 回归:蛊惑可见状态不泄露 pending.actualCard 真实牌名
  await check('guhuo 可见状态不含 actualCard 真实牌名', function(){
    var g = mkG();
    g.pending = {
      sourceSeat: 1,
      claimedCard: { name: '杀' },
      actualCard: { name: '无中生有' }
    };
    var json = JSON.stringify(buildBotGuhuoVisibleState(g, 0));
    if(json.indexOf('无中生有') !== -1) throw new Error('泄露了 actualCard 真实牌名');
    if(json.indexOf('杀') === -1) throw new Error('应包含声明牌名 杀');
  });

  // 6. token 优化:buildBotVisibleState 输出不含 discardPile 键(弃牌堆统计已从投影删除)
  await check('可见状态不含 discardPile 键', function(){
    var g = mkG();
    g.discard = [ {name:'杀'}, {name:'闪'}, {name:'桃'} ];
    var json = JSON.stringify(buildBotVisibleState(g, 0));
    if(json.indexOf('discardPile') !== -1) throw new Error('不应出现 discardPile 键');
  });

  // 8. deckLeft:牌堆剩余张数(公开信息)
  await check('deckLeft 等于牌堆剩余张数', function(){
    var g = mkG();
    g.deck = [ {name:'杀'}, {name:'闪'}, {name:'桃'}, {name:'杀'}, {name:'无中生有'} ];
    var s = buildBotVisibleState(g, 0);
    if(s.deckLeft !== 5) throw new Error('deckLeft 期望5,实际 ' + s.deckLeft);
  });

  // 9. myAttackRange:装 range3 武器 → 3;无武器 → 1
  await check('myAttackRange 武器range3/无武器1', function(){
    var g = mkG();
    g.players[0].equips = { weapon: { name: '青龙偃月刀' }, armor: null, plus1: null, minus1: null };
    var s = buildBotVisibleState(g, 0);
    if(s.myAttackRange !== 3) throw new Error('装青龙偃月刀时期望3,实际 ' + s.myAttackRange);
    var g2 = mkG();
    var s2 = buildBotVisibleState(g2, 0);
    if(s2.myAttackRange !== 1) throw new Error('无武器期望1,实际 ' + s2.myAttackRange);
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
