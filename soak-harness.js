/**
 * soak-harness.js —— soak 压测的公共骨架(CORE-92 / issue #139 从 soak.js 抽出)。
 *
 * 【为什么抽出来】issue #139 要求把 AI 长局压测扩成分层矩阵(FFA / 身份局 / 组队 /
 * AI托管 / 确定性LLM),同时明确"保留现有 soak.js,不要改成巨型万能脚本"。这两条一起
 * 意味着:vm 沙箱、快照隔离 tx stub、逃生舱、驱动循环这套骨架必须只有一份,各层只写
 * 自己那点差异。于是把骨架整体搬到这里,soak.js 退化成一个薄入口(行为逐字不变,由
 * testclass/run_soak_driver_test.js 锁定),新增的各层各自也是薄入口。
 *
 * 【骨架本身的设计说明全部沿用 soak.js 原文,不重复抄写】包括:为什么不加载真实 DOM、
 * 为什么用"每种 pending 都登记过的保守动作表"当逃生舱、为什么 tx stub 必须返回真 Promise
 * (强C循环靠第二参数拿提交后快照,同步 stub 会让每步白等 5 秒超时)——这些注释保留在
 * 下面对应代码处。
 *
 * 【对外 API】
 *   createSandbox()                  -> { sandbox, diagnostics }
 *   installDriver(sandbox, options)  -> 在沙箱里定义 soakOneGame(seed, n, cfg)
 *   runMatrix(...)                   -> 跑一批局并打印统计(各层入口共用的收尾逻辑)
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function createSandbox(){
  const diagnostics = [];
  const context = {
    gameRef: null, // 加载完 game.js 后用下面的快照 tx stub 覆盖
    firebase: {
      initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
      database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
    },
    document: {
      // 'controls' 专门返回 null——collectControlsCandidates/botSafePrompt 靠这个优雅短路,
      // 不需要真DOM;其余id(joinBtn等顶层onclick绑定目标)返回通用stub,否则
      // game.js/room-lifecycle.js 加载时的顶层 .onclick= 赋值会直接抛错。
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

  // db 接到数组:writeDebugLog 平时是 fire-and-forget 静默写 Firebase,soak 场景下这些
  // kind 正是"值得报警的信号"(js_error/timeout_stuck/pending_orphan_detected/
  // bot_decision_failed)——收集起来而不是彻底忽略,压测跑出真实问题时才不会被吞掉。
  context.db = {
    ref: function(path){
      return { set: function(entry){
        diagnostics.push(Object.assign({ _path: path }, entry));
        return Promise.resolve();
      } };
    }
  };
  context.__diagnosticsLength = function(){ return diagnostics.length; };

  const sandbox = vm.createContext(context, { name: 'sgs-soak-sandbox' });

  // render.js 也要加载(哪怕不驱动真实渲染)——bot.js 有极少数决策分支(如双雄会选牌
  // canShuangxiongDuelCard)直接复用 render.js 里定义的、原本给UI用的纯判断函数,不是
  // DOM相关代码,是真实的运行时依赖,不能只靠document stub绕过。
  const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js', 'render-table.js', 'render-hand.js', 'render-controls.js', 'render-log.js'];
  files.forEach(function(file){
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });

  // 快照隔离版 tx() stub。
  // 【真实踩过的坑,不能退回同步 stub】gameRef.transaction() 必须返回真正的 Promise:
  // game.js 的强C循环(runBotActionWindow→executePlayWindowChoiceAwait)靠 tx 的第二参数
  // 拿"提交后的新快照"继续同窗多步决策,内部判断是 `if(p && typeof p.then==='function')`
  // ——同步 stub 让它恒为 false,onCommitted 永远不触发,每步白等 BOT_COMMIT_TIMEOUT_MS
  // (5000ms),几千步的完整对局会被这个纯测试环境 artifact 拖到几十分钟。
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

  return { sandbox, diagnostics };
}

/**
 * installDriver:在沙箱里定义 soakOneGame(seed, n, cfg)。
 * cfg 字段(全部可选,缺省即现有 FFA 行为):
 *   gameMode   'ffa'|'identity'|'team'   开局模式(默认 ffa)
 *   startMode  'random'|'pick'           startGame 的第一个参数(identity 必须 pick)
 *   assignTeams  bool                    组队模式:开局前给每人分配 team(交替 0/1)
 *   autopilotSeat  number|null           指定一个座位保持 p.isBot=false + 开启 aiTestAutopilot
 *   driveVia   'direct'|'scheduler'      直接调 runBotDecision,还是走真实 scheduleBotTurn
 *   aiStubMode 'best'|'worst'|'random'|null  确定性 LLM stub 模式(见 installAiStub)
 *   detectViolations bool                是否开启阵营违规检测
 */
function installDriver(sandbox, options){
  options = options || {};
  const maxSteps = options.maxSteps || 4000;
  const stuckEscapeAfter = options.stuckEscapeAfter !== undefined ? options.stuckEscapeAfter : 2;

  vm.runInContext(driverSource(maxSteps, stuckEscapeAfter), sandbox);
}

function driverSource(MAX_STEPS_PER_GAME, STUCK_ESCAPE_AFTER){
  return String.raw`
// ============ 阵营违规检测器(CORE-92) ============
// 【为什么不复用 botTargetPolicyAllows】那是被测对象本身。用它来判断"有没有违规"等于
// 拿实现验证实现(同义反复):策略函数写错了,检测器会跟着一起错、永远测不出问题。这里
// **独立**用最原始的口径重新判定——直接比对双方 role,且只认"真正已经公开的身份"
// (role==='zhu' 恒公开,或 roleRevealed 为真),不查任何 bot 侧的判断函数。
// 【必须区分主动决策与被迫结算】issue 明确要求。做法是只在两个"主动发起"的收窄入口挂钩:
//   playCard(...)      —— 出牌阶段主动使用一张牌并指定目标
//   seatPickExecute(...) —— 主动发动一个座位技能并指定目标
// 被迫响应(respondShan/duelResponse/aoeRespond)、AOE 群体结算、铁索连环传导、刚烈/反间
// 这类反弹伤害,全都不经过这两个入口,天然不会被误报——这不是靠事后过滤,是靠挂钩点本身
// 就只覆盖"自己选的动作"。
var __violations = [];
function __knownRoleRaw(g, targetSeat){
  var t = g.players && g.players[targetSeat];
  if(!t || !t.role) return null;
  if(t.role === 'zhu') return 'zhu';      // 主公身份恒公开
  if(t.roleRevealed) return t.role;        // 已阵亡/已揭晓
  return null;                             // 其余一律视为未知,不判违规(避免误报)
}
// 有害动作打到自己人 / 帮助动作送给明确敌人,都算违规。
function __factionViolation(g, actorSeat, targetSeat, kind){
  if(actorSeat === targetSeat) return null;
  if(g.gameMode === 'team'){
    var a = g.players[actorSeat], b = g.players[targetSeat];
    if(!a || !b || !Number.isInteger(a.team) || !Number.isInteger(b.team)) return null;
    var same = a.team === b.team;
    if(kind === 'harmful' && same) return 'team:harmful-to-teammate';
    if(kind === 'helpful' && !same) return 'team:helpful-to-enemy';
    return null;
  }
  if(g.gameMode !== 'identity') return null;
  var me = g.players[actorSeat];
  if(!me || !me.role) return null;
  var known = __knownRoleRaw(g, targetSeat);
  if(!known) return null;                  // 目标身份未公开:不判违规
  if(me.role === 'nei') return null;       // 内奸按设计走动态策略,不设固定敌我,不检测
  var allySets = { zhu:['zhu','zhong'], zhong:['zhu','zhong'], fan:['fan'] };
  var allies = allySets[me.role] || [];
  var isAlly = allies.indexOf(known) >= 0;
  if(kind === 'harmful' && isAlly) return 'identity:' + me.role + '-harms-' + known;
  if(kind === 'helpful' && !isAlly) return 'identity:' + me.role + '-helps-' + known;
  return null;
}
// 主动出牌里哪些牌是"有害的、需要检查目标"的。只列指定单一目标的牌:群体牌(南蛮/万箭/
// 桃园/五谷)对所有人生效、使用者无法选目标,不属于"选错了自己人"这类违规。
var __HARMFUL_CARDS = { '杀':1, '决斗':1, '火攻':1, '顺手牵羊':1, '过河拆桥':1, '乐不思蜀':1, '兵粮寸断':1, '闪电':1 };
var __HELPFUL_CARDS = { '桃':1, '无中生有':1 };
function __recordViolation(ctx){ __violations.push(ctx); }
function __resetViolations(){ __violations = []; }
function __getViolations(){ return __violations; }

// ============ 确定性 LLM stub(CORE-92 E层) ============
// 【为什么包在 callAiChooseIndex 外面、而不是直接替换它】直接替换会跳过真实的解析/越界
// 校验/超时兜底逻辑,那恰恰是最值得被压测覆盖的一段。这里的做法是:先算出"这个模式该选
// 第几项",再把 callAI(provider层)stub 成返回对应的 {"choice":N},然后调用**真实的**
// callAiChooseIndex——真实的解析、边界校验、候选越界保护全都照常跑,只是模型的回答变成
// 确定性的。绝不发真实 API 请求(callAI 被整体替换掉了)。
var __realCallAiChooseIndex = null;
var __realCallAI = null;
var __aiStubMode = null;
var __aiStubCalls = 0;
function __installAiStub(mode){
  __aiStubMode = mode;
  if(!mode) return;
  if(!__realCallAiChooseIndex) __realCallAiChooseIndex = callAiChooseIndex;
  if(!__realCallAI) __realCallAI = (typeof callAI==='function') ? callAI : null;
  // 让 callAiChooseIndex 的"没配密钥就直接 return null"守卫放行
  aiApiKey = 'soak-deterministic-stub';
  aiProvider = 'claude';
  callAiChooseIndex = async function(opts){
    var cands = (opts && opts.candidates) || [];
    if(cands.length <= 1) return cands.length === 1 ? 0 : null;
    var pick;
    if(__aiStubMode === 'best' || __aiStubMode === 'worst'){
      // 按 localHeuristicScore 排;没有该字段的决策点(多数响应类)退化成取首/末项——
      // 语义仍然是"最优先/最不优先",足以覆盖"模型选了最差项会怎样"这个被测目标。
      var idx = 0, cur = null;
      for(var i=0;i<cands.length;i++){
        var s = (typeof cands[i].localHeuristicScore === 'number') ? cands[i].localHeuristicScore : (__aiStubMode==='best' ? -i : i);
        if(cur === null || (__aiStubMode==='best' ? s > cur : s < cur)){ cur = s; idx = i; }
      }
      pick = idx;
    } else { // 'random'
      pick = Math.floor(Math.random() * cands.length);
    }
    __aiStubCalls++;
    callAI = async function(){ return { ok: true, text: '{"choice":' + pick + ',"reason":"soak-stub"}', usage: { input:0, output:0, total:0 } }; };
    try { return await __realCallAiChooseIndex(opts); }
    finally { callAI = __realCallAI || callAI; }
  };
}
function __uninstallAiStub(){
  if(__realCallAiChooseIndex) callAiChooseIndex = __realCallAiChooseIndex;
  if(__realCallAI) callAI = __realCallAI;
  __aiStubMode = null; aiApiKey = ''; aiProvider = null;
}
function __aiStubCallCount(){ return __aiStubCalls; }

// ============ 主动决策挂钩(供违规检测) ============
// CORE-95(issue #142):丈八蛇矛/方天画戟走独立的执行入口(playZhangbaSha/
// playShaFangtian),不经过 playCard,原来完全没有被这套违规检测覆盖到——issue的
// bug本身就是"这两条路径没有过阵营策略过滤",如果soak也不检测这两条路径,压测再多局
// 也测不出这类问题。挂钩方式和 playCard/seatPickExecute 同一套(记录真实调用参数、
// 判违规、再转发给真实实现),harmful kind(两者都是主动出杀,恒有害)。
var __realPlayCard = null, __realSeatPickExecute = null, __realPlayZhangbaSha = null, __realPlayShaFangtian = null, __hooksOn = false;
function __installViolationHooks(){
  if(__hooksOn) return; __hooksOn = true;
  __realPlayCard = playCard;
  playCard = function(cardIdx, actionId, targetSeat, onCommitted){
    var g = currentGameState();
    if(g && Number.isInteger(targetSeat)){
      var actor = mySeat; // botInvoke 期间 mySeat 就是正在行动的那个 AI 座位
      var kind = __HARMFUL_CARDS[actionId] ? 'harmful' : (__HELPFUL_CARDS[actionId] ? 'helpful' : null);
      if(kind){
        var v = __factionViolation(g, actor, targetSeat, kind);
        if(v) __recordViolation({ via:'playCard', action:actionId, actor:actor, target:targetSeat, rule:v,
          phase:g.phase, turn:g.turn, roundNum:g.roundNum });
      }
    }
    return __realPlayCard.apply(null, arguments);
  };
  __realSeatPickExecute = seatPickExecute;
  seatPickExecute = function(g, seat, choice){
    if(g && choice && Number.isInteger(choice.seat) && choice.skillKey){
      var spec = BOT_SEAT_PICKS[choice.skillKey];
      var kind = (spec && spec.effectKind) || 'harmful';
      if(kind !== 'neutral'){
        var v = __factionViolation(g, seat, choice.seat, kind);
        if(v) __recordViolation({ via:'seatPick', action:choice.skillKey, actor:seat, target:choice.seat, rule:v,
          phase:g.phase, turn:g.turn, roundNum:g.roundNum });
      }
    }
    return __realSeatPickExecute.apply(null, arguments);
  };
  __realPlayZhangbaSha = playZhangbaSha;
  playZhangbaSha = function(idxA, idxB, targetSeat){
    var g = currentGameState();
    if(g && Number.isInteger(targetSeat)){
      var actor = mySeat;
      var v = __factionViolation(g, actor, targetSeat, 'harmful');
      if(v) __recordViolation({ via:'playZhangbaSha', action:'丈八蛇矛', actor:actor, target:targetSeat, rule:v,
        phase:g.phase, turn:g.turn, roundNum:g.roundNum });
    }
    return __realPlayZhangbaSha.apply(null, arguments);
  };
  __realPlayShaFangtian = playShaFangtian;
  playShaFangtian = function(cardIdx, targets){
    var g = currentGameState();
    if(g && Array.isArray(targets)){
      var actor = mySeat;
      targets.forEach(function(t){
        if(!Number.isInteger(t)) return;
        var v = __factionViolation(g, actor, t, 'harmful');
        if(v) __recordViolation({ via:'playShaFangtian', action:'方天画戟', actor:actor, target:t, rule:v,
          phase:g.phase, turn:g.turn, roundNum:g.roundNum });
      });
    }
    return __realPlayShaFangtian.apply(null, arguments);
  };
}

// ============ 主驱动 ============
async function soakOneGame(seed, n, cfg){
  cfg = cfg || {};
  var gameMode = cfg.gameMode || 'ffa';
  var startMode = cfg.startMode || (gameMode === 'identity' ? 'pick' : 'random');
  var diagStart = __diagnosticsLength();
  __resetViolations();
  if(cfg.detectViolations) __installViolationHooks();
  __installAiStub(cfg.aiStubMode || null);

  var players = [];
  for(var i = 0; i < n; i++){
    players.push({
      name: 'bot' + i, cid: 'cid' + i, owner: i === 0,
      // autopilotSeat 那个座位刻意保持 isBot:false —— issue 明确要求"使用 p.isBot=false 的
      // 真人座位真实模拟托管",不能用全员 isBot=true 代替(那样根本走不到托管相关分支)。
      isBot: i !== 0, alive: true,
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
  // CORE-113:真实游戏每局之间靠 newGame()/backToLobby() 调用 resetBotTwoStep() 清空
  // 客户端本地的多步决策状态(botTwoStepA)——soak 连续跑多局共用同一个vm沙箱,不经过
  // 这两个入口,不手动补一次会把上一局残留带进下一局。
  if(typeof resetBotTwoStep==='function') resetBotTwoStep();
  // 组队模式:必须走真实的大厅选队入口 joinTeam(),不能直接给 p.team 赋值——
  // 【真实踩过的坑】normalize() 有一条 "gameMode!=='team' 就把 p.team 清成 null" 的规则,而大厅
  // 阶段 g.gameMode 恒为 null(全项目只有 startGame/joinTeam 会写它),所以预先塞进 players
  // 的 team 会在 startGame 内部第一次 normalize 时被整体清空,startGame 的"所有人都必须有
  // team"校验随即拒绝开局,表现为一直停在 lobby(第一版就是这么写的,4/4 局全部
  // no-actor-no-pending@lobby)。joinTeam() 自己会先把 gameMode 锁成 'team' 再写 team,
  // 顺序正确;它按 mySeat 写自己那一格,所以要逐个座位切 mySeat 调用。
  if(cfg.assignTeams){
    var savedSeat = mySeat;
    for(var ti = 0; ti < n; ti++){ mySeat = ti; joinTeam(ti % 2); }
    mySeat = savedSeat;
  }
  startGame(startMode, gameMode); // player0 暂时是owner+非bot才能通过isRoomOwner守卫
  // 开局后收回:除托管座位外全员机器人驱动。【真实踩过的坑】不能按固定下标0收回——
  // startGame内部会调 shuffleSeats() 打乱players数组顺序(#104),必须按 owner 标记去找。
  var autopilotSeat = null;
  tx(function(g){
    var owner = g.players.find(function(p){ return p && p.owner; });
    if(owner) owner.isBot = true;
    return g;
  });
  if(Number.isInteger(cfg.autopilotSeat)){
    // 洗座后重新定位:把"洗完之后的某个下标"当作托管的真人座位。用取模保证落在合法范围内。
    autopilotSeat = cfg.autopilotSeat % n;
    // 【模拟的是哪种真实配置】"第一个真人(也就是 bot 控制器)给自己开了托管"——这是托管
    // 最常见、也是唯一能在单进程里完整跑通的配置。理由:botControllerSeat() 取的是第一个
    // isBot=false 且有 cid 的座位,isBotController() 还要求那个座位的 cid 等于本机
    // myClientId;托管座位是全场唯一的 isBot=false 座位,所以它天然就是控制器座位,只要把
    // cid 对上,本进程就同时扮演"控制器浏览器"(驱动其余机器人)和"托管着自己座位的那个
    // 真人"(驱动自己)。
    // 【第一版没对 cid 的后果,如实记录】cid 不匹配 → isBotController 恒 false → 除托管
    // 座位外没有任何座位会被 scheduleBotTurn 放行,选将阶段就卡死(实测 3/3 局
    // stuck@pickingLordGeneral/pickingGeneral)。这不是调度链路的 bug,是压测配置没有对应
    // 到任何一种真实可运行的客户端组合。
    // 关键:isBot 保持 false —— issue 明确要求"使用 p.isBot=false 的真人座位真实模拟托管,
    // 不能用全员 isBot=true 代替"。
    tx(function(g){
      if(g.players[autopilotSeat]){
        g.players[autopilotSeat].isBot = false;
        g.players[autopilotSeat].cid = myClientId;
      }
      return g;
    });
    mySeat = autopilotSeat;
    aiTestAutopilot = { active: true, seat: autopilotSeat, records: [] };
  }

  function stateFingerprint(g){
    var d = g.pending || {};
    var aliveCount = (g.players||[]).filter(function(p){ return p && p.alive; }).length;
    return [g.phase, g.turn, g.roundNum, d.type, (g.log||[]).length, aliveCount].join(':');
  }
  function tryEscapeHatch(g){
    if(!g.pending) return false;
    // 往前拨的字段不止 askedAt——wuxiePublicWait 额外自带独立时间闸门(publicUntil),
    // 一并往回拨,否则公共无懈窗口永远"还没到时间"、逃生舱对它必然空转。
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
    if(g2.pending.type === 'wuxiePublicWait'){ act(); return true; }
    var actor = pendingResponderSeat(g2, g2.pending);
    if(!Number.isInteger(actor)) return false;
    botInvoke(actor, act);
    return true;
  }

  var steps = 0, stuckStreak = 0;
  var outcome = 'unknown';
  var schedulerDriven = 0;
  while(steps < ${MAX_STEPS_PER_GAME}){
    var g = currentGameState();
    if(!g){ outcome = 'no-state'; break; }
    if(g.phase === 'over'){ outcome = 'finished'; break; }
    var fpBefore = stateFingerprint(g);
    var seat = botSeatForState(g);
    if(cfg.driveVia === 'scheduler'){
      // D层:走真实 scheduleBotTurn(经 botSeatForState/botFallbackSeats/两道托管门/debounce
      // 定时器),而不是直接调 runBotDecision。setTimeout 在沙箱里被换成"立即同步执行",
      // 只是免去真实等待,调度链路本身逐字照跑。
      schedulerDriven++;
      await __runSchedulerStep(g);
    } else if(seat >= 0){
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
        if(stuckStreak > ${STUCK_ESCAPE_AFTER}){
          var gStuck = currentGameState();
          outcome = 'stuck@' + gStuck.phase + ':' + (gStuck.pending ? gStuck.pending.type : 'null');
          break;
        }
      } else { stuckStreak = 0; }
    } else { stuckStreak = 0; }
    steps++;
  }
  if(steps >= ${MAX_STEPS_PER_GAME} && outcome === 'unknown') outcome = 'step-cap-exceeded';
  var finalG = currentGameState();
  var violations = __getViolations().slice();
  __uninstallAiStub();
  if(Number.isInteger(cfg.autopilotSeat)){ aiTestAutopilot = { active:false, seat:null, records:[] }; mySeat = 0; }
  return {
    seed: seed, n: n, steps: steps, outcome: outcome,
    over: !!(finalG && finalG.phase === 'over'), winner: finalG ? finalG.winner : null,
    diagnosticsCount: __diagnosticsLength() - diagStart,
    violations: violations,
    aiStubCalls: __aiStubCallCount(),
    schedulerDriven: schedulerDriven,
    // 卡死诊断包(issue 验收标准):seed/phase/turn/pendingType/seat/最近AI决策/commandLog
    crashInfo: (outcome === 'finished') ? null : {
      seed: seed, n: n, gameMode: gameMode, phase: finalG && finalG.phase,
      turn: finalG && finalG.turn, roundNum: finalG && finalG.roundNum,
      pendingType: finalG && finalG.pending ? finalG.pending.type : null,
      resolvedSeat: finalG ? botSeatForState(finalG) : null,
      fallbackSeats: finalG ? botFallbackSeats(finalG) : [],
      gameSeed: finalG ? finalG.seed : null,
      recentAiDecisions: (typeof aiDecisionRecords!=='undefined' ? aiDecisionRecords : []).slice(-5)
        .map(function(r){ return { seat:r.seat, phase:r.phaseLabel, choice:r.choice, reason:r.reason }; }),
      recentCommands: (typeof commandLog!=='undefined' ? commandLog : []).slice(-10)
        .map(function(c){ return { seq:c.seq, seat:c.actingSeat, cmd:c.commandName, phase:c.phaseAtStart, pending:c.pendingTypeAtStart }; }),
      recentLog: (finalG && finalG.log || []).slice(-8).map(function(l){ return l && l.text; })
    }
  };
}

// __runSchedulerStep:让 scheduleBotTurn 的 debounce 定时器立即执行,并等它跑完。
// 不改 scheduleBotTurn 本身——只是把它依赖的 setTimeout 临时换成"立刻同步调用",
// 这样两道托管门/botSeatForState/botFallbackSeats/runBotDecision 全部按真实路径跑,
// 只是免去 650~1150ms 的真实等待。
async function __runSchedulerStep(g){
  // 【为什么 stub 必须在回调执行期间也保持生效】第一版只在调用 scheduleBotTurn 那一瞬
  // 换掉 setTimeout、拿到 debounce 回调后就立刻还原,再去 await 那个回调——结果回调内部
  // 注册的**看门狗定时器**(BOT_DECISION_WATCHDOG_MS=120000)用的是**真实** setTimeout,
  // 每步都往事件循环里插一个 120 秒的活跃定时器,进程结束不了(实测:调试脚本直接跑到
  // 2 分钟超时被杀)。而且回调的 finally 里还可能再次调用 scheduleBotTurn
  // (botMissedSchedule / botTwoStepA 自我触发两条补查路径),那次调用注册的定时器同样
  // 会漏到真实事件循环里。所以正确做法是:整个"调度 + 执行回调 + 回调触发的后续调度"
  // 全程都用 stub,并把队列排干(带上限防自我触发无限循环)。
  var realSetTimeout = setTimeout, realClearTimeout = clearTimeout;
  var queue = [];
  setTimeout = function(fn){ queue.push(fn); return 0; };
  clearTimeout = function(){ /* stub 下的定时器就是队列里的函数,不需要真的取消 */ };
  try {
    currentG = g;
    scheduleBotTurn(g);
    var guard = 0;
    while(queue.length && guard++ < 8){
      var fn = queue.shift();
      try { await fn(); } catch(e){ /* 调度回调自身异常由诊断日志记录,不中断压测 */ }
      // 回调的 finally 可能又排了新的调度(补查/两步自我触发),继续排干
    }
  } finally {
    setTimeout = realSetTimeout;
    clearTimeout = realClearTimeout;
  }
}
`;
}

/**
 * runMatrix:各层入口共用的"跑 N 局 + 打印统计 + 决定退出码"逻辑。
 * cfgFor(i, n) 返回该局的 cfg(见 installDriver 说明)。
 */
async function runMatrix(opts){
  const { sandbox, diagnostics, games, maxPlayers, minPlayers, cfgFor, title } = opts;
  const results = [];
  for(let i=0;i<games;i++){
    const lo = minPlayers || 2;
    const n = lo + Math.floor(Math.random()*(maxPlayers - lo + 1));
    let r;
    try{
      r = await sandbox.soakOneGame(i, n, cfgFor(i, n));
    }catch(e){
      r = { seed:i, n, steps:-1, outcome:'EXCEPTION: '+(e && e.stack || e), over:false, winner:null,
            diagnosticsCount:0, violations:[], crashInfo:{ seed:i, n, exception:String(e && e.message || e) } };
    }
    results.push(r);
    const vio = (r.violations && r.violations.length) ? (' 违规=' + r.violations.length) : '';
    const stub = r.aiStubCalls ? (' aiStub=' + r.aiStubCalls) : '';
    console.log('[' + (i+1) + '/' + games + '] n=' + r.n + ' steps=' + r.steps + ' outcome=' + r.outcome
      + (r.diagnosticsCount?(' diagnostics='+r.diagnosticsCount):'') + vio + stub);
  }
  const finished = results.filter(r=>r.outcome==='finished').length;
  const stuck = results.filter(r=>/^stuck@|^no-escape-action|^no-actor-no-pending/.test(r.outcome)).length;
  const crashed = results.filter(r=>/^EXCEPTION/.test(r.outcome)).length;
  const capped = results.filter(r=>r.outcome==='step-cap-exceeded').length;
  const allViolations = results.reduce((a,r)=>a.concat(r.violations||[]), []);
  console.log('\n' + '='.repeat(64));
  console.log((title||'soak') + ' 结果: ' + games + ' 局 —— 正常结束 ' + finished + ' / 卡死 ' + stuck
    + ' / 步数超限 ' + capped + ' / 异常崩溃 ' + crashed + ' / 阵营违规 ' + allViolations.length);
  console.log('='.repeat(64));
  if(allViolations.length){
    console.log('\n阵营违规明细(主动决策造成,已排除被迫响应/AOE/连环/反弹,只列前20条):');
    allViolations.slice(0,20).forEach(function(v,i){
      console.log('  [' + (i+1) + '] ' + v.rule + ' | ' + v.via + ' ' + v.action
        + ' 座位' + v.actor + '→座位' + v.target + ' @' + v.phase + ' 回合' + v.roundNum);
    });
  }
  const failing = results.filter(r=>r.crashInfo && r.outcome!=='finished');
  if(failing.length){
    console.log('\n卡死/异常诊断包(前3局):');
    failing.slice(0,3).forEach(function(r){
      console.log('  --- seed=' + r.seed + ' outcome=' + r.outcome + ' ---');
      console.log('  ' + JSON.stringify(r.crashInfo, null, 1).split('\n').join('\n  '));
    });
  }
  if(diagnostics.length){
    console.log('\n压测期间捕获的诊断日志(共 ' + diagnostics.length + ' 条,只列前20条):');
    diagnostics.slice(0,20).forEach(function(d,i){
      console.log('  [' + (i+1) + '] kind=' + d.kind + ' phase=' + d.phase + ' pendingType=' + d.pendingType + ' message=' + d.message);
    });
  }
  return { results, finished, stuck, crashed, capped, violations: allViolations };
}

module.exports = { createSandbox, installDriver, runMatrix };
