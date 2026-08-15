/**
 * CORE-112(issue #112):soak压测发现的多个"phase回到play但pending残留"死锁 —— 修复验证。
 *
 * 用 testclass/test-tx-stub.js 的快照隔离 tx() stub + 全部真实源码,构造真实触发路径,
 * 逐条验证修复前会复现、修复后能正确收尾。
 *
 * 覆盖三类独立根因(用 soak.js 30局×4批共120局实测数据定位,详见 docs/progress-log-*.md
 * CORE-112 条目):
 *
 * 1. 好施(haoshiPick)创建时缺 return——game.js finishDrawPhase() 在
 *    targetSeats.length>1 分支设置好 g.pending/g.phase='haoshiPick' 之后没有 return,
 *    继续跑到函数末尾的 advancePastPlay(g),把刚设的 phase 立刻覆盖回 'play'(pending
 *    仍留着),永久卡死。
 * 2. 杀链收尾遗漏清空 pending——finishSingleShaTarget(sha/sha-resolution.js)和
 *    advanceFangtianQueue(game.js)结束时只写 g.phase='play',没有清空 g.pending。
 *    最常见触发路径:tieqi/liegong 这类"是否发动"的中间态 pending 还没被清空时,目标在
 *    杀结算途中死亡(afterShaTargetSkills 的 !target.alive 分支直接调
 *    finishSingleShaTarget),phase 已经"回到play"但 pending.type 还是过期的
 *    tieqi/liegong,机器人/UI都对不上号。这也是 liuli(流离)/liegong(烈弓)/
 *    tieqi(铁骑)三类症状的共同根因(soak.js实测:修复前这四类症状合计出现22次/120局,
 *    修复后0次)。
 * 3. resumeAfterInterrupt 的默认('sha'及其它)分支缺当前回合玩家存活检查——duel/delay/
 *    kurou/quhu/fanjian/sanyao 等resume类型都有
 *    `if(!g.players[g.turn].alive){ startTurn(g,nextAlive(g,g.turn)); }` 这条既有写法,
 *    唯独最常见的默认'sha'分支漏了,导致回合玩家自己在杀的伤害链条中死亡时,回合永远
 *    卡在死人身上不会推进(stuck@play:null,g.turn 指向的座位 alive:false)。
 * 4. lieRenRespond(祝融【烈刃】)拼点目标手牌为空时无法响应——respondLieRen 原本要求
 *    cardIndex 必须是合法手牌下标,目标手牌为0张时任何cardIndex都不满足,而
 *    triggerLieRen/pickLieRenCard 创建这个pending时从未检查过目标手牌数,只要对一个
 *    手牌已空的角色发动烈刃就必然卡死(stuck@lieRenRespond)。
 */

const vm = require('vm');
const fs = require('fs');
const { SNAPSHOT_TX_STUB_SOURCE } = require('../test-tx-stub.js');

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

const sandbox = vm.createContext(context, { name: 'sgs-core112-sandbox' });

console.log('Loading CORE-112 死锁修复测试环境...\n');

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
vm.runInContext(SNAPSHOT_TX_STUB_SOURCE, sandbox);
vm.runInContext('mySeat = 0; roomId = "test-room"; aiApiKey=""; aiProvider=null;', sandbox);

console.log('\n' + '='.repeat(60));
console.log('  CORE-112 死锁修复测试');
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
      hp: opt.hp!==undefined?opt.hp:4, maxHp: 4,
      hand: opt.hand || [], equips: emptyEquips(), delays: [],
      role: null, general: opt.general || 'caocao', generalChoices: null, team: null
    };
  }
  function mkG(n, opt){
    opt = opt || {};
    var players = [];
    for(var i=0;i<n;i++) players.push(mkPlayer(i, opt.playerOpts && opt.playerOpts[i]));
    return Object.assign({
      players: players, gameMode: 'ffa', roundNum: 1, turn: 0,
      log: [], aoe: null, started: true, discard: [], deck: [], exchangeCards: [], over: false, winner: null
    }, opt.g || {});
  }

  // ================= 1. 好施(haoshiPick)创建缺return =================
  await check('好施:多个候选目标时,创建的pending不会被advancePastPlay立刻覆盖', function(){
    var g = mkG(3, { playerOpts: {
      0: { general:'lusu', hand:[{id:1,name:'杀',suit:'♠',rank:3},{id:2,name:'杀',suit:'♠',rank:4},{id:3,name:'杀',suit:'♠',rank:5},{id:4,name:'杀',suit:'♠',rank:6}] },
      1: { hand: [] }, 2: { hand: [] }
    }, g: { phase:'draw', deck:[{id:10,name:'桃',suit:'♥',rank:2},{id:11,name:'桃',suit:'♥',rank:3}] } });
    finishDrawPhase(g, 0, 2);
    if(g.phase !== 'haoshiPick') throw new Error('phase应为haoshiPick,实际=' + g.phase);
    if(!g.pending || g.pending.type !== 'haoshiPick') throw new Error('pending应为haoshiPick,实际=' + JSON.stringify(g.pending));
  });
  await check('好施:机器人能正确响应,phase/pending最终一致清空', async function(){
    var g = mkG(3, { playerOpts: {
      0: { general:'lusu', hand:[{id:1,name:'杀',suit:'♠',rank:3},{id:2,name:'杀',suit:'♠',rank:4},{id:3,name:'杀',suit:'♠',rank:5},{id:4,name:'杀',suit:'♠',rank:6}] },
      1: { hand: [] }, 2: { hand: [] }
    }, g: { phase:'draw', deck:[{id:10,name:'桃',suit:'♥',rank:2},{id:11,name:'桃',suit:'♥',rank:3}] } });
    finishDrawPhase(g, 0, 2);
    commitGameState(g); // respondHaoshi内部走tx()/gameRef,必须先把这份状态提交成"服务端当前状态"
    await runBotDecision(currentGameState(), 0);
    var after = currentGameState();
    if(after.phase !== 'play') throw new Error('响应完毕后phase应回到play,实际=' + after.phase);
    if(after.pending !== null) throw new Error('响应完毕后pending应清空,实际=' + JSON.stringify(after.pending));
  });

  // ================= 2. finishSingleShaTarget/advanceFangtianQueue 缺清空pending =================
  await check('铁骑:目标在响应前已死亡(afterShaTargetSkills的!target.alive分支)时应同步清空pending', function(){
    var g = mkG(3);
    g.phase = 'tieqi';
    g.pending = setResponseAskedAt({type:'tieqi', from:0, to:1, shaColor:'black'});
    g.players[1].alive = false; // 目标已死(soak.js真实复现场景:目标在杀链途中被其它伤害源打死)
    commitGameState(g);
    mySeat = 0;
    respondTieqi(true); // 走 finishTieqiJudge -> afterShaTargetSkills -> !target.alive -> finishSingleShaTarget
    var after = currentGameState();
    if(after.phase !== 'play') throw new Error('目标已死时应收尾回到play,实际phase=' + after.phase);
    if(after.pending !== null) throw new Error('目标已死时应清空pending,实际=' + JSON.stringify(after.pending));
  });
  await check('烈弓:目标在数值判定后死亡,afterShaTargetSkills收尾应同步清空pending(直接测finishSingleShaTarget)', function(){
    var g = mkG(3);
    g.phase = 'liegong';
    g.pending = setResponseAskedAt({type:'liegong', from:0, to:1, shaColor:'black'});
    // 直接验证 finishSingleShaTarget 本身的收尾契约:不管调用前 g.pending 是什么残留值,
    // 结束时必须清空——这是本次修复的核心断言,不依赖具体触发路径。
    finishSingleShaTarget(g);
    if(g.phase !== 'play') throw new Error('finishSingleShaTarget应把phase设为play,实际=' + g.phase);
    if(g.pending !== null) throw new Error('finishSingleShaTarget应清空pending,实际=' + JSON.stringify(g.pending));
  });
  await check('方天画戟队列问完最后一个目标时,advanceFangtianQueue收尾应同步清空pending', function(){
    var g = mkG(3);
    g.phase = 'tieqi';
    g.pending = setResponseAskedAt({type:'tieqi', from:0, to:1, shaColor:'black'});
    g.fangtianQueue = { from:0, targets:[1], idx:0, usedAs:'出【杀】', shaColor:'black', sourceCard:{id:1,name:'杀',suit:'♠',rank:7} };
    advanceFangtianQueue(g); // idx递增到1,超出targets.length,触发终止分支
    if(g.phase !== 'play') throw new Error('方天画戟队列问完应回到play,实际=' + g.phase);
    if(g.pending !== null) throw new Error('方天画戟队列问完应清空pending,实际=' + JSON.stringify(g.pending));
    if(g.fangtianQueue !== null) throw new Error('fangtianQueue应清空,实际=' + JSON.stringify(g.fangtianQueue));
  });

  // ================= 3. resumeAfterInterrupt 默认'sha'分支缺存活检查 =================
  await check('resumeAfterInterrupt(sha):回合玩家已死时应startTurn(nextAlive),不能无脑phase=play', function(){
    var g = mkG(3);
    g.turn = 1;
    g.players[1].alive = false; // 回合玩家自己死了
    g.phase = 'respond'; // 随便一个中间阶段,resumeAfterInterrupt会覆盖
    g.pending = { type:'respond', from:0, to:1 };
    resumeAfterInterrupt(g, {type:'sha'}, 1);
    if(g.turn === 1) throw new Error('回合玩家已死,g.turn不应还停在1,实际=' + g.turn);
    if(!g.players[g.turn].alive) throw new Error('推进后的回合玩家必须是存活的,实际turn=' + g.turn + ' alive=' + g.players[g.turn].alive);
    // startTurn(nextAlive)会把新回合玩家带进正常的回合流程,从判定/摸牌阶段开始(不是直接
    // 空降到play)——这里只断言"确实调用了startTurn把回合正确交接给了下一个存活玩家"这件事
    // 本身(turn变了+不再停留在死人身上+phase不是死循环前那个残留的'respond'),不断言
    // 具体停在哪个子阶段(judge/draw/play 由 startTurn 内部链路自然决定,不是这条修复的重点)。
    if(g.phase === 'respond') throw new Error('phase不应还停在修复前那个残留的respond阶段,实际=' + g.phase);
  });
  await check('resumeAfterInterrupt(sha):回合玩家仍存活时行为不变,直接回到play', function(){
    var g = mkG(3);
    g.turn = 1;
    g.phase = 'respond';
    g.pending = { type:'respond', from:0, to:1 };
    resumeAfterInterrupt(g, {type:'sha'}, 1);
    if(g.turn !== 1) throw new Error('回合玩家存活时turn不应改变,实际=' + g.turn);
    if(g.phase !== 'play') throw new Error('应回到play,实际=' + g.phase);
  });

  // ================= 4. lieRenRespond 目标手牌为空 =================
  await check('烈刃拼点:目标手牌为空时respondLieRen应自动判负而不是无响应卡死', function(){
    var g = mkG(3);
    g.phase = 'lieRenRespond';
    g.players[0].hand = [{id:1,name:'杀',suit:'♠',rank:9}];
    g.players[1].hand = []; // 目标手牌为空
    g.pending = setResponseAskedAt({type:'lieRenRespond', sourceSeat:0, targetSeat:1, sourceCard:g.players[0].hand[0]});
    commitGameState(g);
    mySeat = 1;
    respondLieRen(0);
    mySeat = 0;
    var after = currentGameState();
    if(after.phase !== 'play') throw new Error('应收尾回到play,实际=' + after.phase);
    if(after.pending !== null) throw new Error('应清空pending,实际=' + JSON.stringify(after.pending));
  });
  await check('烈刃拼点:机器人对手牌为空的目标发动烈刃,能完整走完不卡死', async function(){
    var g = mkG(3);
    g.phase = 'lieRenRespond';
    g.players[0].hand = [{id:1,name:'杀',suit:'♠',rank:9}];
    g.players[1].hand = [];
    g.pending = setResponseAskedAt({type:'lieRenRespond', sourceSeat:0, targetSeat:1, sourceCard:g.players[0].hand[0]});
    commitGameState(g);
    await runBotDecision(currentGameState(), 1);
    var after = currentGameState();
    if(after.phase !== 'play') throw new Error('机器人响应后应回到play,实际=' + after.phase);
    if(after.pending !== null) throw new Error('机器人响应后应清空pending,实际=' + JSON.stringify(after.pending));
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
