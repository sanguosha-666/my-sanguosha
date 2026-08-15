#!/usr/bin/env node
/**
 * soak.js —— 整局级随机压测驱动器(CORE-108 / issue #108 方案第1项:soak驱动循环)。
 *
 * 用法: node soak.js [局数=20] [最大人数=6] [单局步数上限=4000]
 *
 * 【做什么】从 startGame 一路驱动到 checkWin(g.over),全程由机器人决策/超时保守
 * 动作自动推进,不需要真人操作、不需要 DOM——用于压测"随机对局会不会卡死/触发
 * normalize孤儿pending/机器人决策异常"这类只有靠大量随机对局才容易撞见的问题。
 *
 * 【为什么不加载 render.js/render-controls.js】L1 controlsChoice(wuxie/luoyingAsk/
 * luoshen 等阶段的AI决策镜像)依赖真实DOM渲染按钮——本项目没有 jsdom 依赖,搭一套
 * 足以撑起 renderControls() 的最小DOM是不小的工程量,且不是必需的:这些阶段全部
 * 已经在 STAGE_TABLE 里登记了 timeoutAction(CORE-52"响应阶段超时覆盖"留下的
 * 遗产——CLAUDE.md称为"全部阶段都有保守动作"),autoRespondAction(g) 本身完全不
 * 依赖DOM。所以这里选择"不追新building一套DOM",而是复用这份已有的、每种pending
 * 类型都登记过的保守动作表作为驱动器的统一"逃生舱"——runBotDecision 没能推进的
 * 阶段(没有专属分支/依赖L1的阶段),下一步直接调 autoRespondAction 的保守动作,
 * 不必等待真实的30秒超时(测试环境里没必要真等,直接把 askedAt 往前拨到超时线
 * 之外再调用即可,和"30秒后真的会发生什么"完全等价,只是不用真的等30秒)。
 *
 * 【范围声明,如实对齐 issue 的三件事+ROI排序】这份脚本只做 issue 里排第一、ROI
 * 最高的"soak驱动循环"本身;第2项(操作日志+崩溃复现包,~2-3人日)和第3项(种子化
 * mulberry32+lint守卫,~2-3人日)本次不做——它们各自独立可交付,建议作为后续任务
 * 分别处理,不在这次改动里勉强拼一个不完整的版本。
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname));

const GAMES = parseInt(process.argv[2], 10) || 20;
const MAX_PLAYERS = Math.max(2, Math.min(9, parseInt(process.argv[3], 10) || 6));
// 第4个可选参数:单局步数上限,超过视为疑似卡死(而不是无限跑)。默认4000够跑完绝大多数
// 随机对局;测试场景/快速冒烟用小步数(比如300)可以在几秒内验证驱动器本身没坏,不需要
// 陪它跑到真的分出胜负(一局2人对局靠随机启发式AI拖到有人死亡,真实观察到过要跑上千步)。
const MAX_STEPS_PER_GAME = parseInt(process.argv[4], 10) || 4000;
const STUCK_ESCAPE_AFTER = 2; // 同一决策点连续N次"状态完全未变"才启用逃生舱(给botDecide一次重试机会)

const context = {
  gameRef: null, // 加载完 game.js 后用 SNAPSHOT_TX_STUB_SOURCE 覆盖
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    // 'controls' 专门返回 null——collectControlsCandidates/botSafePrompt 靠这个优雅短路,
    // 不需要真DOM(见文件顶部说明);其余id(joinBtn等顶层onclick绑定目标)返回通用stub,
    // 否则 game.js/room-lifecycle.js 加载时的顶层 .onclick= 赋值会直接抛错。
    getElementById: function(id) {
      if(id === 'controls') return null;
      return { onclick: null, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} };
    },
    createElement: function() { return { style: {}, classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {} }; },
    body: { appendChild: function() { return {}; } },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    addEventListener: function() {}, removeEventListener: function() {}
  },
  window: {
    firebase: null,
    location: { search: '', href: 'http://localhost', reload: function() {} },
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    aiConversations: {},
    navigator: { userAgent: 'soak', platform: 'soak', language: 'zh-CN', onLine: true }
  },
  mySeat: 0,
  myClientId: 'soak-controller',
  setTimeout: function(f, t) { return setTimeout(f, t); },
  clearTimeout: function(t) { return clearTimeout(t); },
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp, Promise: Promise
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

// db 接到 console:writeDebugLog 平时是 fire-and-forget 静默写 Firebase,soak 场景下这些
// kind 正是"值得报警的信号"(js_error/timeout_stuck/pending_orphan_detected/
// bot_decision_failed)——接到 console 而不是彻底忽略,压测跑出真实问题时才不会被吞掉。
const diagnostics = [];
context.db = {
  ref: function(path){
    return { set: function(entry){
      diagnostics.push(Object.assign({ _path: path }, entry));
      return Promise.resolve();
    } };
  }
};
context.__diagnosticsLength = function(){ return diagnostics.length; }; // 桥接:vm沙箱内代码读不到Node侧闭包变量,靠函数调用取当前长度

const sandbox = vm.createContext(context, { name: 'sgs-soak-sandbox' });

// render.js 也要加载(哪怕不驱动真实渲染)——bot.js 有极少数决策分支(如双雄会选牌
// canShuangxiongDuelCard)直接复用 render.js 里定义的、原本给UI用的纯判断函数,不是
// DOM相关代码,是真实的运行时依赖,不能只靠document stub绕过。'controls' 短路(见上方
// document.getElementById 说明)保证 renderControls 本身不会被这里意外触发。
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js', 'render-table.js', 'render-hand.js', 'render-controls.js', 'render-log.js'];
files.forEach(function(file){
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
});

// 快照隔离版 tx() stub,基于 test-tx-stub.js 的思路(见其顶部说明:比"共享引用"stub 更贴近
// 真实 Firebase transaction 语义,能测出嵌套 tx() 竞争这类问题)——但这里不能直接复用
// test-tx-stub.js 本身,必须补一处它没有的行为:gameRef.transaction() 必须返回一个真正的
// Promise。
// 【真实踩过的坑】test-tx-stub.js 的 gameRef.transaction 同步返回一个普通值(不是
// thenable)——绝大多数测试用不到 tx(fn,onCommitted) 的第二参数,这个差异从来不会被
// 注意到。但 game.js 的强C循环(runBotActionWindow→executePlayWindowChoiceAwait)专门
// 靠这第二参数拿"提交后的新快照"继续同窗多步决策,内部逻辑是
// `if(p && typeof p.then==='function'){ p.then(...) }`——用同步stub时这个判断恒为false,
// onCommitted 永远不会被调用,executePlayWindowChoiceAwait 只能眼睁睁等到
// BOT_COMMIT_TIMEOUT_MS(5000ms)超时兜底。实测过:play阶段每一步决策白白多等5秒,
// 20步的对局跑出40+秒,数千步的完整对局会被这个纯测试环境artifact拖到几十分钟——
// 不是游戏逻辑慢,是stub没有正确模拟"transaction()返回Promise"这个真实Firebase行为。
vm.runInContext(`
  var __soakServerState = null;
  gameRef = {
    transaction: function(fn){
      var snapshot = __soakServerState ? JSON.parse(JSON.stringify(__soakServerState)) : {};
      var result = fn(snapshot) || snapshot;
      __soakServerState = result;
      return Promise.resolve({ snapshot: { val: function(){ return result; } } });
    }
  };
  function commitGameState(g){ __soakServerState = JSON.parse(JSON.stringify(g)); }
  function currentGameState(){ return __soakServerState; }
`, sandbox);
vm.runInContext('mySeat = 0; roomId = "soak-room"; aiApiKey = ""; aiProvider = null;', sandbox);

const driverCode = String.raw`
async function soakOneGame(seed, n){
  var diagnosticsForThisGame_start = __diagnosticsLength();
  var players = [];
  for(var i = 0; i < n; i++){
    players.push({
      name: 'bot' + i, cid: 'cid' + i, owner: i === 0, isBot: i !== 0, alive: true,
      hp: 4, maxHp: 4, hand: [], equips: emptyEquips(), delays: [],
      role: null, general: null, generalChoices: null, team: null
    });
  }
  var g0 = {
    players: players, gameMode: null, roundNum: 0, phase: 'lobby', turn: 0,
    log: [], pending: null, aoe: null, started: false, discard: [], deck: [],
    exchangeCards: [], over: false, winner: null
  };
  commitGameState(g0);
  mySeat = 0;
  startGame('random', 'ffa'); // player0 暂时是owner+非bot才能通过isRoomOwner守卫
  // 开局后收回:全员机器人驱动。【真实踩过的坑】不能按固定下标0收回——startGame内部会调
  // shuffleSeats()打乱players数组顺序(#104),原来在下标0、owner:true的那个玩家对象开局后
  // 可能挪到任意下标;这里必须按owner标记去找,不能假设它还在下标0,否则"真正的owner"
  // 那个座位会一直isBot:false卡在场上,g.turn轮到它时botSeatForState解析不出行动者
  // (这正是最初调试时"no-actor-no-pending@draw/@play"这批诊断的根因)。
  tx(function(g){ var owner = g.players.find(function(p){ return p && p.owner; }); if(owner) owner.isBot = true; return g; });

  // stateFingerprint:不依赖某个具体seat的botStateKey(那个函数是给"某座位的动作有没有
  // 生效"设计的,seat<0时无意义)——这里要判断的是"这一步整体有没有推动了局面",用一份不
  // 依赖seat的全局指纹:phase/turn/roundNum/pending类型/pending.askedAt/log长度/存活人数。
  function stateFingerprint(g){
    var d = g.pending || {};
    var aliveCount = (g.players||[]).filter(function(p){ return p && p.alive; }).length;
    return [g.phase, g.turn, g.roundNum, d.type, (g.log||[]).length, aliveCount].join(':'); // 刻意不含askedAt:逃生舱本身会篡改askedAt,含进指纹会把"没有真实推进"误判成"已推进"
  }
  // tryEscapeHatch:不依赖botSeatForState能否解析行动者——只要有pending就尝试。
  // 覆盖两类情况:①botSeatForState解析不出行动者(seat<0,依赖L1的阶段或未覆盖阶段)、
  // ②botSeatForState解析出了seat但runBotDecision没有对应分支可用(如wuxie/luoyingAsk/
  // luoshen在没有L1的情况下,见文件顶部说明)。两者的信号相同:执行完一轮"该做的事"后
  // 状态指纹完全没变。
  function tryEscapeHatch(g){
    if(!g.pending) return false;
    // 往前拨的字段不止 askedAt——wuxiePublicWait 是唯一一个额外自带独立时间闸门的类型
    // (finishWuxiePublicWait 内部另外检查 publicUntil,不看 askedAt),一并往回拨,否则
    // 公共无懈窗口永远"还没到时间"、逃生舱对它必然空转(这次开发soak.js调试时真实撞见过,
    // 见 testclass/run_soak_driver_test.js 的回归锁定断言)。全项目搜过 Date.now()<...
    // 这个模式,只有这一处特例。
    tx(function(gg){
      if(gg.pending){
        gg.pending.askedAt = Date.now() - 999999;
        if(typeof gg.pending.publicUntil==='number') gg.pending.publicUntil = Date.now() - 1;
      }
      return gg;
    });
    var g2 = currentGameState();
    if(!g2.pending) return true; // 期间已经被别的路径推进掉了
    var act = (typeof autoRespondAction === 'function') ? autoRespondAction(g2) : null;
    if(!act) return false;
    if(g2.pending.type === 'wuxiePublicWait'){ act(); return true; }
    var actor = pendingResponderSeat(g2, g2.pending);
    if(!Number.isInteger(actor)) return false;
    botInvoke(actor, act);
    return true;
  }

  var steps = 0, stuckStreak = 0;
  var outcome = 'unknown';
  while(steps < ${MAX_STEPS_PER_GAME}){
    var g = currentGameState();
    if(!g){ outcome = 'no-state'; break; }
    if(g.phase === 'over'){ outcome = 'finished'; break; }
    var fpBefore = stateFingerprint(g);
    var seat = botSeatForState(g);
    if(seat >= 0){
      await runBotDecision(g, seat);
    } else if(!g.pending){
      // 无pending也解析不出行动座位:理论上不该发生(全员机器人),记为异常终止
      outcome = 'no-actor-no-pending@' + g.phase;
      break;
    }
    var fpAfter = stateFingerprint(currentGameState());
    if(fpAfter === fpBefore){
      // 这一步(不管是runBotDecision认领了但没推动,还是压根没人认领)没有让局面前进——
      // 立刻尝试逃生舱,不需要真的连续卡好几步才反应(soak场景没必要保留调度层面的
      // debounce/防抖那套顾虑,直接每次没推动就兜底一次)。
      var escaped = tryEscapeHatch(g);
      var fpAfterEscape = stateFingerprint(currentGameState());
      if(!escaped || fpAfterEscape === fpBefore){
        stuckStreak++;
        if(stuckStreak > ${STUCK_ESCAPE_AFTER}){
          var gStuck = currentGameState();
          outcome = 'stuck@' + gStuck.phase + ':' + (gStuck.pending ? gStuck.pending.type : 'null');
          break;
        }
      } else {
        stuckStreak = 0;
      }
    } else {
      stuckStreak = 0;
    }
    steps++;
  }
  if(steps >= ${MAX_STEPS_PER_GAME} && outcome === 'unknown') outcome = 'step-cap-exceeded';
  var finalG = currentGameState();
  return {
    seed: seed, n: n, steps: steps, outcome: outcome,
    over: !!(finalG && finalG.phase === 'over'), winner: finalG ? finalG.winner : null,
    diagnosticsCount: __diagnosticsLength() - diagnosticsForThisGame_start
  };
}
`;
vm.runInContext(driverCode, sandbox);

(async function(){
  const results = [];
  for(let i=0;i<GAMES;i++){
    const n = 2 + Math.floor(Math.random()*(MAX_PLAYERS-1)); // 2..MAX_PLAYERS
    let r;
    try{
      r = await sandbox.soakOneGame(i, n);
    }catch(e){
      r = { seed:i, n, steps:-1, outcome:'EXCEPTION: '+(e && e.stack || e), over:false, winner:null, diagnosticsCount:0 };
    }
    results.push(r);
    console.log('[' + (i+1) + '/' + GAMES + '] n=' + r.n + ' steps=' + r.steps + ' outcome=' + r.outcome + (r.diagnosticsCount?(' diagnostics='+r.diagnosticsCount):''));
  }
  const finished = results.filter(r=>r.outcome==='finished').length;
  const stuck = results.filter(r=>/^stuck@|^no-escape-action|^no-actor-no-pending/.test(r.outcome)).length;
  const crashed = results.filter(r=>/^EXCEPTION/.test(r.outcome)).length;
  const capped = results.filter(r=>r.outcome==='step-cap-exceeded').length;
  console.log('\n' + '='.repeat(60));
  console.log('soak 结果: ' + GAMES + ' 局 —— 正常结束 ' + finished + ' / 卡死 ' + stuck + ' / 步数超限 ' + capped + ' / 异常崩溃 ' + crashed);
  console.log('='.repeat(60));
  if(diagnostics.length){
    console.log('\n压测期间捕获的诊断日志(js_error/timeout_stuck/pending_orphan_detected/bot_decision_failed 等,共 ' + diagnostics.length + ' 条,只列前20条):');
    diagnostics.slice(0,20).forEach(function(d,i){
      console.log('  [' + (i+1) + '] kind=' + d.kind + ' phase=' + d.phase + ' pendingType=' + d.pendingType + ' message=' + d.message);
    });
  }
  const bad = stuck + crashed;
  process.exit(bad>0 ? 1 : 0);
})();
