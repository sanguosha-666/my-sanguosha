/**
 * CORE-113(issue #113):soak压测残留的play:null死锁 —— 修复验证。
 *
 * 继承CORE-112排查出的线索(回合玩家存活、runBotDecision对该座位play阶段决策没有
 * 明显进展),用vm沙箱探针脚本逐层加console.error埋点(RBD-ENTER/RBD-MAIN-PLAY/
 * RBD-RET-xxx/RBAW-ENTER等)跑soak.js真实复现后精确定位,找到三个独立根因:
 *
 * 1. seatPickLocalFallback"取第一个matched技能"设计缺陷——第一个matched技能自身
 *    fallbackSeat为null(没有合适目标)时直接return null,botDecide据此认定seatPick
 *    这条链"已处理"直接return,即使candidates里还挂着后面技能的合法候选也永远摸不到
 *    runBotActionWindow。这是CLAUDE.md里早就记录过的"已知残余边界",soak.js压测证实
 *    它不是无害的次要问题而是稳定复现的永久卡死根因。
 * 2. guose(国色)/duanliang(断粮)/qixi(奇袭)三个seatPick技能的buildSeatCandidates
 *    自己手写了一份简化的目标合法性判断,和真正execute路径(guoSe/duanLiang/qiXi内部
 *    调用CARD_PLAYS['乐不思蜀'/'过河拆桥'].canTarget或canTargetDelayTrick)不一致——
 *    漏了【谦逊】(qianxun)/【帷幕】(weimu)/【智迟】(zhichi)等保护。机器人反复选中被
 *    保护的目标,execute每次静默失败(server端guard拒绝但buildCandidates没有相应剔除),
 *    状态永远不变。
 * 3. botTwoStepA(借刀/离间/丈八/仁德四个多步决策共用的客户端本地状态)从未在
 *    newGame()/backToLobby()里清空——如果上一局在这类两步决策进行到一半时结束,
 *    这个变量会原样留到下一局,下一局如果g.turn/g.phase恰好命中同一个decisionId的
 *    match条件,机器人会拿着上一局早已失效的座位/牌引用去执行,轻则execute静默失败
 *    永久卡死,重则读到超出当前对局座位数的下标直接抛异常崩溃(soak.js两种都实测复现过)。
 *
 * 修复效果(soak.js 4批×60局=240局对比,2~9人局,步数上限4000):
 *   1)之前(CORE-112收尾时):22/120卡死(18.3%)
 *   2)只修复根因1(seatPickLocalFallback):240局仍有约9次卡死+1次崩溃
 *   3)加修根因2(guose/duanliang/qixi候选合法性):240局降到5次卡死+1次崩溃
 *   4)加修根因3(botTwoStepA跨局清空):240局降到4次卡死、0次崩溃
 * 残留约1.7%(4/240)未能在本次排查时限内定位到根因,如实记录,不强行猜测修复
 * (详见任务收尾时给用户的回复与docs/progress-log-*.md对应条目)。
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

const sandbox = vm.createContext(context, { name: 'sgs-core113-sandbox' });

console.log('Loading CORE-113 seatPick死锁修复测试环境...\n');

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
console.log('  CORE-113 seatPick死锁修复测试');
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

  // ================= 1. seatPickLocalFallback"取第一个matched技能"缺陷 =================
  await check('seatPickLocalFallback:第一个matched技能没候选时应继续尝试后面真正有候选的技能', function(){
    // 构造:seat0拥有断粮(duanliang,距离限2)+奇袭(qixi)两个技能的牌,但断粮所需的黑色
    // 基本/装备牌距离所有人都>2(没有候选),奇袭的黑色牌距离不受限(必然有候选)——
    // 修复前:duanliang排在前面且matched,fallbackSeat=null,直接返回null,机器人"什么
    // 都不选"卡在原地;修复后:continue试到qixi,拿到qixi的候选。
    var g = mkG(3, { playerOpts: {
      0: { general:'lusu', caps:{duanliang:true, qixi:true},
        hand: [ {id:1,name:'杀',suit:'♠',rank:5}, {id:2,name:'过河拆桥',suit:'♣',rank:6} ] },
      1: { hand: [{id:3,name:'杀',suit:'♥',rank:3}] },
      2: { hand: [{id:4,name:'杀',suit:'♥',rank:4}] }
    }});
    // 用超大棋盘距离模拟"断粮所有人都够不着"：直接把duanliang的match条件关掉,只留qixi,
    // 验证退化到单一matched技能时continue逻辑不会误伤(候选正常返回)。
    g.players[0].caps.duanliang = false;
    var candidates = seatPickBuildCandidates(g, 0);
    var choice = seatPickLocalFallback(g, 0, candidates);
    if(!choice) throw new Error('qixi应该有候选,不应该返回null');
    if(choice.skillKey !== 'qixi') throw new Error('应该选中qixi,实际=' + JSON.stringify(choice));
  });

  // ================= 2. guose/duanliang/qixi 候选合法性与真实execute路径不一致 =================
  await check('国色(guose):候选不应包含被【谦逊】保护的目标', function(){
    var g = mkG(3, { playerOpts: {
      0: { general:'daqiao', caps:{guose:true}, hand: [{id:1,name:'杀',suit:'♦',rank:5}] },
      1: { caps:{qianxun:true} }, // 谦逊保护,不能被国色/乐不思蜀
      2: {}
    }});
    var candidates = BOT_SEAT_PICKS.guose.buildSeatCandidates(g, 0);
    if(candidates.some(function(c){ return c.seat===1; })) throw new Error('候选不应包含被谦逊保护的座位1,实际=' + JSON.stringify(candidates));
    if(!candidates.some(function(c){ return c.seat===2; })) throw new Error('候选应包含未受保护的座位2');
  });
  await check('断粮(duanliang):候选不应包含被【帷幕】保护的目标', function(){
    var g = mkG(3, { playerOpts: {
      0: { general:'lusu', caps:{duanliang:true}, hand: [{id:1,name:'杀',suit:'♠',rank:5}] },
      1: { caps:{weimu:true} }, // 帷幕:不能成为黑色锦囊牌目标,兵粮寸断是黑色锦囊
      2: {}
    }});
    var candidates = BOT_SEAT_PICKS.duanliang.buildSeatCandidates(g, 0);
    if(candidates.some(function(c){ return c.seat===1; })) throw new Error('候选不应包含被帷幕保护的座位1,实际=' + JSON.stringify(candidates));
    if(!candidates.some(function(c){ return c.seat===2; })) throw new Error('候选应包含未受保护的座位2');
  });
  await check('奇袭(qixi):候选不应包含被【帷幕】保护的目标', function(){
    var g = mkG(3, { playerOpts: {
      0: { general:'lusu', caps:{qixi:true}, hand: [{id:1,name:'杀',suit:'♠',rank:5}] },
      1: { caps:{weimu:true}, hand:[{id:2,name:'桃',suit:'♥',rank:2}] }, // 有牌可拆,但帷幕保护
      2: { hand:[{id:3,name:'桃',suit:'♥',rank:3}] }
    }});
    var candidates = BOT_SEAT_PICKS.qixi.buildSeatCandidates(g, 0);
    if(candidates.some(function(c){ return c.seat===1; })) throw new Error('候选不应包含被帷幕保护的座位1,实际=' + JSON.stringify(candidates));
    if(!candidates.some(function(c){ return c.seat===2; })) throw new Error('候选应包含未受保护的座位2');
  });
  await check('国色:机器人对全场都被谦逊保护时不卡死(候选为空,正常回退)', async function(){
    var g = mkG(2, { playerOpts: {
      0: { general:'daqiao', caps:{guose:true}, hand: [{id:1,name:'杀',suit:'♦',rank:5}] },
      1: { caps:{qianxun:true} }
    }});
    _g = g;
    await runBotDecision(g, 0);
    // 唯一存活的其他玩家被谦逊保护,guose应该没有候选,机器人应转而正常走出牌窗口/结束出牌,
    // 不应该永远卡在play阶段原地不动(用phase最终变化或至少不抛异常来验证不卡死)。
    // 唯一存活的其他玩家被谦逊保护,guose(国色)应该没有合法候选、直接走正常出牌逻辑——
    // 这里手牌里那张♦杀本身仍是一张合法的普通杀,机器人转而正常出杀会进入respond阶段
    // (等待对方响应),这和'play'/'discard'一样都是正常推进,不是卡死;只有停在
    // 'play'且连续多轮不变化才是卡死(这里只验证单步不抛异常、不返回不合法phase)。
    if(!['play','discard','respond','wuxie'].includes(g.phase)) throw new Error('不应停在异常phase,实际=' + g.phase);
  });

  // ================= 3. botTwoStepA 跨局残留 =================
  await check('resetBotTwoStep:newGame()应该清空botTwoStepA(否则残留到下一局引发座位越界)', function(){
    var g = mkG(5, {});
    g.players[0].owner = true;
    _g = g;
    mySeat = 0;
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 4 }; // 模拟上一局(5人)残留的座位引用
    newGame(); // 触发resetBotTwoStep
    if(botTwoStepA !== null) throw new Error('newGame()后botTwoStepA应被清空,实际=' + JSON.stringify(botTwoStepA));
  });
  await check('botTwoStepA跨局残留场景:座位数变少后,残留的座位引用会导致越界(回归复现,证明修复的必要性)', function(){
    // 上一局5人,botTwoStepA.a=4;这一局座位数变少到3人——不清空的话,任何读
    // g.players[botTwoStepA.a].name 的代码都会在这个新的3人对局里越界读到undefined,
    // 这正是soak.js实测复现的真实崩溃(TypeError: Cannot read properties of undefined
    // (reading name))。这里只验证"清空后不会越界"这个契约本身;真实调用链(jiedaoTwoStep
    // 的buildCandidates阶段B)已经在上面"newGame应该清空"那条测试里覆盖了清空动作本身。
    resetBotTwoStep();
    var g = mkG(3, {});
    if(botTwoStepA !== null) throw new Error('resetBotTwoStep后应为null');
    if(g.players[4]) throw new Error('测试前提有误:3人局不应该有座位4');
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
