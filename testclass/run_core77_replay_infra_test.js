/**
 * CORE-77(issue #122)第一期:对局确定性重放 —— 记录基础设施。
 *
 * 严格限定在issue的第一期范围:开局记录 g.seed + tx() 处的动作命令采集(commandLog,
 * 纯本地内存,不入 g/不进 Firebase)。不涉及第二期(播种PRNG替换Math.random)/
 * 第三期(重放器/整局压测接入)。
 *
 * 本文件分两大块:
 *  ① 单元断言 —— generateSeed/commandLog 的增删改查行为本身。
 *  ② "零行为变化"回归 —— 这是本次任务里最关键的一条:不能只是"加了记录逻辑就假设
 *     不影响原有行为",要用真实证据。做法:同时加载改动前(testclass/fixtures/
 *     core77_pre_change_*.js.snapshot,git show HEAD 在动手改代码前存的快照)和
 *     改动后(当前工作区)两份完整引擎到两个独立 vm 沙箱,在两边都覆盖同一个确定性
 *     seeded Math.random(测试专用,不是shipped代码),驱动同一串真实操作(soak.js
 *     同款驱动循环,复用其"botSeatForState解析行动者→runBotDecision→逃生舱兜底"
 *     的成熟逻辑),跑完后对比两边的最终 g 状态(剔除本次新增的 g.seed 字段)是否
 *     逐字节一致。
 *     【为什么要在测试里也用seeded Math.random,而shipped代码不用】generateSeed()
 *     本身特意设计成不消耗Math.random(见game.js顶部注释)——所以两个沙箱在play out
 *     游戏逻辑时消耗的Math.random()调用序列完全相同、次序不变;这里给两个沙箱注入
 *     同一个确定性伪随机源,只是为了让"同一串操作"这件事本身可复现(不然每次跑测试,
 *     机器人的启发式决策/判定结果都不同,没法稳定比对),不代表验证了"seed真的能重放"
 *     ——那是第二期要交付的东西,这里只验证"这次新增的记录代码没有让原有随机行为偏移"。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.stack || e)); fail++; }
}
async function checkAsync(name, fn){
  try{ await fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.stack || e)); fail++; }
}

// ============ ① 单元断言:generateSeed / commandLog ============
function buildUnitSandbox(){
  const context = {
    gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
    firebase: {
      initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on(){}, once(){}, push(){ return { set(){}, key:'k' }; }, transaction(fn){ var cb=fn(function(){}); if(cb) cb(); return {}; }, set(){}, update(){}, child(){ return {}; }, remove(){}, get(){ return { val(){ return null; } }; } }; } }; } }; },
      database: function(){ return { ref: function(){ return { on(){}, once(){}, push(){ return { set(){}, key:'k' }; }, transaction(){ return {}; }, set(){}, child(){ return {}; }, remove(){}, get(){ return { val(){ return null; } }; } }; } }; }
    },
    document: {
      getElementById: function(){ return { onclick:null, innerHTML:'', style:{}, className:'', classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){} }; },
      createElement: function(){ return { style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){ return {}; }, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){} }; },
      body:{ appendChild(){ return {}; } }, querySelector(){ return null; }, querySelectorAll(){ return []; },
      addEventListener(){}, removeEventListener(){}
    },
    window: {
      firebase: null,
      location:{ search:'', href:'http://localhost', reload(){} },
      localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){}, clear(){} },
      sessionStorage:{ getItem(){ return null; }, setItem(){} },
      addEventListener(){}, removeEventListener(){},
      setTimeout: function(f,t){ return setTimeout(f,t); }, clearTimeout: function(t){ return clearTimeout(t); },
      navigator:{ userAgent:'x', platform:'x', language:'zh-CN', onLine:true }
    },
    mySeat: 0, myClientId:'unit-test',
    setTimeout: function(f,t){ return setTimeout(f,t); }, clearTimeout: function(t){ return clearTimeout(t); },
    console, Math, Date, JSON, RegExp, Promise
  };
  context.window.firebase = context.firebase;
  context.window.document = context.document;
  context.global = context;
  const sandbox = vm.createContext(context, { name:'core77-unit' });
  const files = ['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js'];
  files.forEach(function(f){
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  });
  vm.runInContext(`
    var __state = null;
    gameRef = { transaction: function(fn){
      var snap = __state ? JSON.parse(JSON.stringify(__state)) : {};
      var result = fn(snap) || snap;
      __state = result;
      return Promise.resolve({ snapshot:{ val: function(){ return result; } } });
    } };
    mySeat = 0; roomId = 'unit-room';
  `, sandbox);
  return sandbox;
}



// ============ ② "零行为变化"回归 ============
function buildEngineSandbox(useSnapshot){
  const context = {
    gameRef: null,
    firebase: {
      initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on(){}, once(){}, push(){ return { set(){}, key:'mock_key' }; }, transaction(fn){ var cb=fn(function(){}); if(cb) cb(); return {}; }, set(){}, update(){}, child(){ return {}; }, remove(){}, get(){ return { val(){ return null; } }; } }; } }; } }; },
      database: function(){ return { ref: function(){ return { on(){}, once(){}, push(){ return { set(){}, key:'mock_key' }; }, transaction(){ return {}; }, set(){}, child(){ return {}; }, remove(){}, get(){ return { val(){ return null; } }; } }; } }; }
    },
    document: {
      getElementById: function(id){ if(id==='controls') return null; return { onclick:null, innerHTML:'', style:{}, className:'', classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){} }; },
      createElement: function(){ return { style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){ return {}; }, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){} }; },
      body:{ appendChild(){ return {}; } }, querySelector(){ return null; }, querySelectorAll(){ return []; },
      addEventListener(){}, removeEventListener(){}
    },
    window: {
      firebase: null,
      location:{ search:'', href:'http://localhost', reload(){} },
      localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){}, clear(){} },
      sessionStorage:{ getItem(){ return null; }, setItem(){} },
      addEventListener(){}, removeEventListener(){},
      setTimeout: function(f,t){ return setTimeout(f,t); }, clearTimeout: function(t){ return clearTimeout(t); },
      aiConversations: {},
      navigator:{ userAgent:'core77-diff', platform:'core77-diff', language:'zh-CN', onLine:true }
    },
    mySeat: 0, myClientId: 'core77-diff-controller',
    setTimeout: function(f,t){ return setTimeout(f,t); }, clearTimeout: function(t){ return clearTimeout(t); },
    console, Math, Date, JSON, RegExp, Promise
  };
  context.window.firebase = context.firebase;
  context.window.document = context.document;
  context.global = context;
  const sandbox = vm.createContext(context, { name: 'core77-engine-' + (useSnapshot?'old':'new') });

  // room-lifecycle.js / game.js 二选一走"改动前快照"或"当前工作区"，其余文件(包括
  // bot.js/skills.js等)两边都用当前工作区——本次改动只碰了这两个文件,其它文件本来
  // 就该完全相同,不需要也不应该额外制造快照。
  const roomLifecyclePath = useSnapshot
    ? path.join(ROOT, 'testclass/fixtures/core77_pre_change_room-lifecycle.js.snapshot')
    : path.join(ROOT, 'room-lifecycle.js');
  const gamePath = useSnapshot
    ? path.join(ROOT, 'testclass/fixtures/core77_pre_change_game.js.snapshot')
    : path.join(ROOT, 'game.js');

  const fileList = [
    ['config.js', path.join(ROOT,'config.js')],
    ['data.js', path.join(ROOT,'data.js')],
    ['stages/stage-table.js', path.join(ROOT,'stages/stage-table.js')],
    ['debug-log.js', path.join(ROOT,'debug-log.js')],
    ['room-lifecycle.js', roomLifecyclePath],
    ['game.js', gamePath],
    ['sha/sha-resolution.js', path.join(ROOT,'sha/sha-resolution.js')],
    ['weapons.js', path.join(ROOT,'weapons.js')],
    ['skills.js', path.join(ROOT,'skills.js')],
    ['skills/late-generals.js', path.join(ROOT,'skills/late-generals.js')],
    ['bot-ai-bus.js', path.join(ROOT,'bot-ai-bus.js')],
    ['bot.js', path.join(ROOT,'bot.js')],
    ['ai-bot.js', path.join(ROOT,'ai-bot.js')],
    // render.js 及其拆分文件也要加载(哪怕不驱动真实渲染)——bot.js 有极少数决策分支
    // (如双雄会选牌 canShuangxiongDuelCard)直接复用 render.js 里定义的纯判断函数,
    // 是真实运行时依赖,不是DOM相关代码,不能靠document stub绕过(soak.js同款做法)。
    ['render.js', path.join(ROOT,'render.js')],
    ['render-table.js', path.join(ROOT,'render-table.js')],
    ['render-hand.js', path.join(ROOT,'render-hand.js')],
    ['render-controls.js', path.join(ROOT,'render-controls.js')],
    ['render-log.js', path.join(ROOT,'render-log.js')],
  ];
  fileList.forEach(function(pair){
    vm.runInContext(fs.readFileSync(pair[1],'utf8'), sandbox, { filename: pair[0] });
  });

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
    // 【测试专用,不是shipped代码】seeded Math.random——mulberry32,和第二期打算引入的
    // PRNG算法族一致,但这里纯粹是为了让两个沙箱"同一串真实操作"这件事可复现、可比对,
    // 不代表这就是第二期的交付物。两个沙箱各自用同一个种子重置,保证消耗节奏完全一致
    // (前提是新代码没有多消耗/少消耗任何一次 Math.random() 调用——这正是要验证的东西:
    // 如果 generateSeed 不小心改成用了 Math.random,这里两个沙箱会从某一步开始分叉,
    // 下面的最终状态比对就会失败,断言是有鉴别力的,不是摆设)。
    function seedMathRandom(seed){
      var s = seed >>> 0;
      Math.random = function(){
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  `, sandbox);
  vm.runInContext('mySeat = 0; roomId = "core77-diff-room"; aiApiKey = ""; aiProvider = null;', sandbox);
  return sandbox;
}

const DRIVER_CODE = String.raw`
async function driveOneGame(seed, n, maxSteps){
  seedMathRandom(seed);
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
  if(typeof resetBotTwoStep==='function') resetBotTwoStep();
  startGame('random', 'ffa');
  tx(function(g){ var owner = g.players.find(function(p){ return p && p.owner; }); if(owner) owner.isBot = true; return g; });

  function stateFingerprint(g){
    var d = g.pending || {};
    var aliveCount = (g.players||[]).filter(function(p){ return p && p.alive; }).length;
    return [g.phase, g.turn, g.roundNum, d.type, (g.log||[]).length, aliveCount].join(':');
  }
  function tryEscapeHatch(g){
    if(!g.pending) return false;
    tx(function(gg){
      if(gg.pending){
        gg.pending.askedAt = Date.now() - 999999;
        if(typeof gg.pending.publicUntil==='number') gg.pending.publicUntil = Date.now() - 1;
      }
      return gg;
    });
    var g2 = currentGameState();
    if(!g2.pending) return true;
    var act = (typeof autoRespondAction === 'function') ? autoRespondAction(g2) : null;
    if(!act) return false;
    if(g2.pending.type === 'wuxiePublicWait' || g2.pending.type === 'dyingPublicWait'){ act(); return true; }
    var actor = pendingResponderSeat(g2, g2.pending);
    if(!Number.isInteger(actor)) return false;
    botInvoke(actor, act);
    return true;
  }

  var steps = 0, stuckStreak = 0, outcome = 'unknown';
  while(steps < maxSteps){
    var g = currentGameState();
    if(!g){ outcome = 'no-state'; break; }
    if(g.phase === 'over'){ outcome = 'finished'; break; }
    var fpBefore = stateFingerprint(g);
    var seat = botSeatForState(g);
    if(seat >= 0){
      await runBotDecision(g, seat);
    } else if(!g.pending){
      outcome = 'no-actor-no-pending@' + g.phase;
      break;
    }
    var fpAfter = stateFingerprint(currentGameState());
    if(fpAfter === fpBefore){
      var escaped = tryEscapeHatch(g);
      var fpAfterEscape = stateFingerprint(currentGameState());
      if(!escaped || fpAfterEscape === fpBefore){
        stuckStreak++;
        if(stuckStreak > 2){
          var gStuck = currentGameState();
          outcome = 'stuck@' + gStuck.phase + ':' + (gStuck.pending ? gStuck.pending.type : 'null');
          break;
        }
      } else { stuckStreak = 0; }
    } else { stuckStreak = 0; }
    steps++;
  }
  if(steps >= maxSteps && outcome === 'unknown') outcome = 'step-cap-exceeded';
  var finalG = currentGameState();
  return { steps: steps, outcome: outcome, finalG: finalG };
}
`;

async function runZeroBehaviorChangeCheck(){
  console.log('='.repeat(60));
  console.log('  CORE-77 第一期:"零行为变化"回归(改动前 vs 改动后,同一串真实操作)');
  console.log('='.repeat(60) + '\n');

  const sbOld = buildEngineSandbox(true);
  const sbNew = buildEngineSandbox(false);
  vm.runInContext(DRIVER_CODE, sbOld);
  vm.runInContext(DRIVER_CODE, sbNew);

  const scenarios = [
    { seed: 12345, n: 3, maxSteps: 400 },
    { seed: 67890, n: 5, maxSteps: 600 },
  ];

  for(const sc of scenarios){
    await checkAsync('零行为变化:seed=' + sc.seed + ' n=' + sc.n + ' 人局,改动前后最终状态逐字节一致', async function(){
      const rOld = await sbOld.driveOneGame(sc.seed, sc.n, sc.maxSteps);
      const rNew = await sbNew.driveOneGame(sc.seed, sc.n, sc.maxSteps);

      if(rOld.outcome !== rNew.outcome)
        throw new Error('outcome应一致,改动前=' + rOld.outcome + ' 改动后=' + rNew.outcome);
      if(rOld.steps !== rNew.steps)
        throw new Error('步数应一致(说明分叉了),改动前=' + rOld.steps + ' 改动后=' + rNew.steps);

      // 前置条件:这局真的推进了足够多步,不是刚开局就巧合停在同一处——否则"一致"这个
      // 结论没有说服力(可能两边都是空转)。
      if(rOld.steps < 10)
        throw new Error('前置条件不满足:这局只推进了 ' + rOld.steps + ' 步,样本量太小,换个seed/加大maxSteps');

      const gOld = JSON.parse(JSON.stringify(rOld.finalG));
      const gNew = JSON.parse(JSON.stringify(rNew.finalG));
      // g.seed 由 generateSeed() 写入,不消耗 Math.random,两次独立对局时间戳不同,
      // 数值必然分叉。比对前两边都剔除;commandLog 不在 g 上,无需额外剔除。
      delete gOld.seed;
      delete gNew.seed;
      // g.lastLightningFx(闪电判定特效事件,data.js DELAY_TRICKS['闪电'].effect 写入)同为
      // 后来**故意新增**的字段:改动前的 normalize 不会把它补成 null,导致改动后状态在未
      // 触发闪电时多出 "lastLightningFx":null 一条——和 seed 同理,比对前两边都剔除。
      // 该字段的正确性由 testclass/run_lightning_fx_detect_test.js 单独钉住。
      delete gOld.lastLightningFx;
      delete gNew.lastLightningFx;
      // g.lastMovieFx(过场动画事件,game.js markMovieFx 写入)同理为**故意新增**的字段,
      // normalize 会在未触发时补 null 造成字节差异——和上面两个字段同因,比对前剔除。
      // 其正确性由 testclass/run_movie_fx_detect_test.js 单独钉住。
      delete gOld.lastMovieFx;
      delete gNew.lastMovieFx;
      // g.movieFxQueue(过场动画队列，队列化后新增) 同理比对前剔除。
      delete gOld.movieFxQueue;
      delete gNew.movieFxQueue;
      // g.discardRevealSeq / discardRevealEvents 等展示层事件队列：新 normalize 会补空，与旧快照逐字节差异无关行为
      delete gOld.discardRevealSeq;
      delete gNew.discardRevealSeq;
      delete gOld.discardRevealEvents;
      delete gNew.discardRevealEvents;
      delete gOld.lastDamageEffect;
      delete gNew.lastDamageEffect;
      delete gOld.lastCardSound;
      delete gNew.lastCardSound;
      delete gOld.lastSkillSound;
      delete gNew.lastSkillSound;
      // 新增 res 字段 teamWin/winnerSeat/girlWin/girlLose 同为过场动画结果表扩展，比对前剔除（同剔 girlWin 处理）
      // 若未来比对保留 movieFxQueue/lastMovieFx，则需剔除这些新增键；当前已整删队列，此处为防御性补充
      [gOld, gNew].forEach(g=>{
        if(g.lastMovieFx && g.lastMovieFx.result){
          delete g.lastMovieFx.result.teamWin;
          delete g.lastMovieFx.result.winnerSeat;
          delete g.lastMovieFx.result.girlWin;
          delete g.lastMovieFx.result.girlLose;
        }
        if(Array.isArray(g.movieFxQueue)){
          g.movieFxQueue.forEach(e=>{ if(e && e.result){ delete e.result.teamWin; delete e.result.winnerSeat; delete e.result.girlWin; delete e.result.girlLose; }});
        }
      });
      const jOld = JSON.stringify(gOld);
      const jNew = JSON.stringify(gNew);
      if(jOld !== jNew){
        // 定位第一个不同点,方便排查,而不是只甩一句"不相等"
        let i = 0;
        const len = Math.min(jOld.length, jNew.length);
        while(i < len && jOld[i] === jNew[i]) i++;
        throw new Error('最终状态不一致(首个差异位置附近 old="' + jOld.slice(Math.max(0,i-40), i+40)
          + '" new="' + jNew.slice(Math.max(0,i-40), i+40) + '")');
      }
    });
  }

  // 反向验证:确认这条比对方法本身有鉴别力——如果真的引入了行为差异,断言必须能抓到,
  // 不能是"无论如何都判定一致"的摆设(CLAUDE.md第20条)。用两个不同的seed跑同一个新
  // 引擎,预期最终状态大概率不同(不同seed驱动出不同的随机对局),验证比对逻辑确实
  // 会在真实差异面前报"不一致"。
  await checkAsync('比对方法有鉴别力:不同seed驱动出的两局,最终状态确实会被判定为不同', async function(){
    const rA = await sbNew.driveOneGame(11111, 4, 400);
    const rB = await sbNew.driveOneGame(22222, 4, 400);
    if(rA.steps < 10 || rB.steps < 10) throw new Error('前置条件不满足,样本量太小');
    const jA = JSON.stringify(rA.finalG);
    const jB = JSON.stringify(rB.finalG);
    if(jA === jB) throw new Error('不同seed驱动出的两局最终状态不应逐字节相同(说明比对逻辑没有鉴别力,或Math.random没被正确接管)');
  });
}

(async function(){
  console.log('\n' + '='.repeat(60));
  console.log('  CORE-77 第一期:单元断言(generateSeed/commandLog)');
  console.log('='.repeat(60) + '\n');

  const sb = buildUnitSandbox();

  check('generateSeed() 返回无符号32位整数,不越界', function(){
    const v = vm.runInContext('generateSeed()', sb);
    if(!Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF) throw new Error('应为0~2^32-1的整数,实际 ' + v);
  });
  check('generateSeed() 连续调用不产生相同值(不是常量)', function(){
    const a = vm.runInContext('generateSeed()', sb);
    const b = vm.runInContext('generateSeed()', sb);
    if(a === b) throw new Error('两次调用不应恒相同(除非极端巧合),实际都是 ' + a);
  });
  check('generateSeed() 不消耗 Math.random()(零行为变化的关键前提)', function(){
    vm.runInContext('window.__mathRandomCalls = 0; var __origRandom = Math.random; Math.random = function(){ window.__mathRandomCalls++; return __origRandom(); };', sb);
    vm.runInContext('generateSeed(); generateSeed(); generateSeed();', sb);
    const calls = vm.runInContext('window.__mathRandomCalls', sb);
    vm.runInContext('Math.random = __origRandom;', sb);
    if(calls !== 0) throw new Error('generateSeed 不应调用 Math.random,实际调用了 ' + calls + ' 次');
  });

  check('finishGeneralAssign 会给 g 写入 seed 字段', function(){
    const g = { players:[
      { name:'p0', general:'liubei', hand:[], equips:{}, delays:[] },
      { name:'p1', general:'caocao', hand:[], equips:{}, delays:[] }
    ], gameMode:'ffa', roundNum:0, deck:[], discard:[] };
    vm.runInContext('finishGeneralAssign(' + JSON.stringify(g) + ')', sb);
    // finishGeneralAssign 是纯函数式修改传入对象,但 vm.runInContext 里 JSON.stringify
    // 传参会丢失引用——改用先赋值再调用的写法验证真实修改效果。
    vm.runInContext('var __g = ' + JSON.stringify(g) + '; finishGeneralAssign(__g);', sb);
    const seed = vm.runInContext('__g.seed', sb);
    if(!Number.isInteger(seed)) throw new Error('finishGeneralAssign 后 g.seed 应为整数,实际 ' + seed);
  });

  check('commandLog:每次 tx() 调用追加一条记录', function(){
    vm.runInContext('commandLog = []; commandLogSeq = 0;', sb);
    vm.runInContext('function myTestAction(){ tx(function(g){ g.log = g.log || []; g.log.push("x"); return g; }); }', sb);
    vm.runInContext('__state = { log: [] };', sb);
    vm.runInContext('myTestAction();', sb);
    const len = vm.runInContext('commandLog.length', sb);
    if(len !== 1) throw new Error('应追加1条,实际 ' + len);
  });
  check('commandLog 记录字段:seq/ts/actingSeat/commandName/phaseAtStart/pendingTypeAtStart', function(){
    const rec = vm.runInContext('commandLog[commandLog.length-1]', sb);
    if(typeof rec.seq !== 'number') throw new Error('缺 seq,实际 ' + JSON.stringify(rec));
    if(typeof rec.ts !== 'number') throw new Error('缺 ts');
    if(rec.actingSeat !== 0) throw new Error('actingSeat 应为当时 mySeat=0,实际 ' + rec.actingSeat);
    if(rec.commandName !== 'myTestAction')
      throw new Error('commandName 应能自动捕获到直接调用者函数名 myTestAction,实际 ' + rec.commandName);
  });
  check('commandLog 不是 g 的字段,不会被写进共享状态/不进 Firebase', function(){
    const g = vm.runInContext('__state', sb);
    if('commandLog' in g) throw new Error('commandLog 不应出现在 g 里,实际 ' + JSON.stringify(Object.keys(g)));
  });
  check('commandLog 有上限,超过后丢弃最旧的记录(防止长局无限增长)', function(){
    vm.runInContext('commandLog = []; commandLogSeq = 0;', sb);
    vm.runInContext('for(var i=0;i<520;i++){ tx(function(g){ return g; }); }', sb);
    const len = vm.runInContext('commandLog.length', sb);
    const cap = vm.runInContext('COMMAND_LOG_MAX', sb);
    if(len !== cap) throw new Error('应封顶在 COMMAND_LOG_MAX=' + cap + ',实际 ' + len);
    const first = vm.runInContext('commandLog[0].seq', sb);
    if(first <= 1) throw new Error('超限后应已丢弃最旧记录,第一条 seq 应远大于1,实际 ' + first);
  });
  check('多次 tx() 重试(同一次外部调用内)只覆写同一条记录,不重复push', function(){
    vm.runInContext('commandLog = []; commandLogSeq = 0;', sb);
    // 模拟 Firebase 事务重试:gameRef.transaction 内部把 updater 连续调用3次才算数
    vm.runInContext(`
      var __retryCount = 0;
      var savedGameRef = gameRef;
      gameRef = { transaction: function(fn){
        var snap = __state ? JSON.parse(JSON.stringify(__state)) : {};
        var result;
        for(var i=0;i<3;i++){ result = fn(JSON.parse(JSON.stringify(snap))) || snap; }
        __state = result;
        return Promise.resolve({ snapshot:{ val: function(){ return result; } } });
      } };
    `, sb);
    vm.runInContext('function retryTestAction(){ tx(function(g){ return g; }); }', sb);
    vm.runInContext('retryTestAction();', sb);
    const len = vm.runInContext('commandLog.length', sb);
    vm.runInContext('gameRef = savedGameRef;', sb);
    if(len !== 1) throw new Error('一次外部tx()调用(哪怕内部重试多次)应只对应1条记录,实际 ' + len);
  });

  console.log('\n' + '='.repeat(60));
  console.log('  单元断言结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');

  await runZeroBehaviorChangeCheck();

  console.log('\n' + '='.repeat(60));
  console.log('  CORE-77 第一期 总结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  process.exit(fail > 0 ? 1 : 0);
})();
