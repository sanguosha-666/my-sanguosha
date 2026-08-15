/**
 * CORE-114(issue #114):soak压测残留的jiedaoTwoStep(借刀杀人)死锁 —— 修复验证。
 *
 * 继承CORE-113排查出的线索(探针显示botDecide('jiedaoTwoStep',g,seat)反复返回true
 * 但游戏状态完全不变),延续同一套"候选合法性与真实execute路径不一致"的排查方向
 * (issue #114列的三个可能方向里的方向①,先验证再动手):对照jieDaoShaRen(skills.js)
 * 真实的服务端执行校验逻辑,发现BOT_DECISIONS.jiedaoTwoStep的两个阶段都各自漏了一条
 * jieDaoShaRen真正会查的canTarget检查:
 *
 * 1. 阶段A(选执行者A的buildCandidates)——只检查了"有武器"+"存在合法B",没有调用
 *    CARD_PLAYS['借刀杀人'].canTarget(g,me,card,i),漏了这条里的【智迟】免疫和
 *    【帷幕】(借刀杀人是黑色锦囊牌)保护。
 * 2. 阶段B(选目标B的buildCandidates)——只检查了距离+空城+同队,没有调用
 *    jieDaoShaRen真正会查的CARD_PLAYS['杀'].canTarget(g,A,{...ignoreShaDistance:true},i)
 *    (传ignoreShaDistance是因为距离另有独立的canReachSha判断,不重复查),漏了这条里
 *    对B的【智迟】/【同疾】等保护。
 *
 * 两处都是"候选生成手写了一份简化判断,和真实execute路径不一致"——和CORE-113修复的
 * guose/duanliang/qixi是完全同一大类问题,只是这次出现在jiedaoTwoStep而不是seatPick。
 * 机器人反复选中被保护的A或B,jieDaoShaRen内部对应的canTarget拒绝执行,execute
 * 静默失败,状态永远不变,构成永久卡死。
 *
 * 修复效果:8批×60局=480局soak压测(2~9人,步数上限4000)对比——CORE-113收尾时
 * 240局约4次卡死(约1.7%);这次480局(比CORE-113验证规模翻倍)0次卡死、0次崩溃。
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
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp, Promise: Promise
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-core114-sandbox' });

console.log('Loading CORE-114 jiedaoTwoStep死锁修复测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
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
vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "test-room"; aiApiKey=""; aiProvider=null;', sandbox);

console.log('\n' + '='.repeat(60));
console.log('  CORE-114 jiedaoTwoStep死锁修复测试');
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

  function mkPlayer(i, opt){
    opt = opt || {};
    return {
      name: 'p'+i, cid: 'c'+i, owner: i===0, isBot: true, alive: opt.alive!==false,
      hp: 4, maxHp: 4, hand: opt.hand || [], equips: opt.equips || emptyEquips(), delays: [],
      role: null, general: opt.general || 'caocao', generalChoices: null, team: null,
      caps: opt.caps || {}
    };
  }
  function mkG(n, opt){
    opt = opt || {};
    var players = [];
    for(var i=0;i<n;i++) players.push(mkPlayer(i, opt.playerOpts && opt.playerOpts[i]));
    return Object.assign({
      players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0,
      log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [], over: false, winner: null
    }, opt.g || {});
  }
  function weaponEquip(){ var e = emptyEquips(); e.weapon = {id:99, name:'雌雄双股剑'}; return e; }

  // ================= 阶段A:候选不应包含被【帷幕】保护的A =================
  await check('借刀杀人阶段A:候选不应包含被【帷幕】保护的有武器角色', function(){
    var g = mkG(4, { playerOpts: {
      0: { hand: [{id:1,name:'借刀杀人',suit:'♠',rank:7}] },
      1: { equips: weaponEquip(), caps:{weimu:true} }, // 有武器但被帷幕保护,不能被借刀杀人指定
      2: { equips: weaponEquip() }, // 有武器,未受保护
      3: {}
    }});
    var candidates = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(g, 0);
    if(candidates.some(function(c){ return c.step==='A' && c.a===1; })) throw new Error('候选不应包含被帷幕保护的座位1,实际=' + JSON.stringify(candidates));
    if(!candidates.some(function(c){ return c.step==='A' && c.a===2; })) throw new Error('候选应包含未受保护的座位2');
  });

  // ================= 阶段B:候选不应包含被【智迟】免疫保护的B =================
  await check('借刀杀人阶段B:候选不应包含被【智迟】免疫保护的目标', function(){
    var g = mkG(4, { playerOpts: {
      0: { hand: [{id:1,name:'借刀杀人',suit:'♠',rank:7}] },
      1: { equips: weaponEquip() },
      2: {}, // 将被智迟免疫保护
      3: {}
    }});
    g.zhichiImmunity = { seat: 2, turn: g.turn }; // 座位2本回合对杀/普通锦囊免疫
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var candidates = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(g, 0);
    if(candidates.some(function(c){ return c.step==='B' && c.seatB===2; })) throw new Error('候选不应包含被智迟免疫的座位2,实际=' + JSON.stringify(candidates));
    if(!candidates.some(function(c){ return c.step==='B' && c.seatB===3; })) throw new Error('候选应包含未受保护的座位3');
    resetBotTwoStep();
  });

  // ================= 端到端:机器人完整走完借刀杀人两步决策,不卡死 =================
  await check('借刀杀人:机器人两步决策完整走完(阶段A→阶段B→jieDaoShaRen成功提交)', async function(){
    var g = mkG(3, { playerOpts: {
      0: { hand: [{id:1,name:'借刀杀人',suit:'♠',rank:7}] },
      1: { equips: weaponEquip() },
      2: {}
    }});
    _g = g;
    await runBotDecision(g, 0); // 阶段A:选中座位1为A
    if(!botTwoStepA || botTwoStepA.decisionId!=='jiedaoTwoStep') throw new Error('阶段A后botTwoStepA应已设置,实际=' + JSON.stringify(botTwoStepA));
    await runBotDecision(g, 0); // 阶段B:选B并提交jieDaoShaRen
    if(botTwoStepA !== null) throw new Error('阶段B完成后botTwoStepA应清空,实际=' + JSON.stringify(botTwoStepA));
    if((g.players[0].hand||[]).some(function(c){ return c.name==='借刀杀人'; })) throw new Error('借刀杀人应已从手牌打出,实际手牌=' + JSON.stringify(g.players[0].hand));
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
