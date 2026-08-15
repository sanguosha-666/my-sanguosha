/**
 * CORE-109:AI 机器人行为事后不可查 —— 最小验证。
 *
 * 覆盖 issue 修复要求里代码层面能做的四块:
 *  1. AI 决策流水(bot_decision_trace):callAiChooseIndex 唯一入口——AI 真实决定一次记
 *     source=llm;AI 返回但解析失败/越界记 source=ai_response_unusable。只在配置了 AI
 *     密钥时才记(无密钥直接走本地启发式是预期默认状态,不产生诊断噪音)。
 *  2. callAI 失败统一记录(ai_call_failed):网络/超时/解析/HTTP错误/全池冷却统一写入,
 *     含 provider/model/失败类别。
 *  3. 提交被拒统一信号(bot_decision_failed 的通用兜底):botInvoke 是机器人几乎全部动作
 *     (respond/duel/dying/各类选牌/出牌)共用的唯一入口,事后诸葛亮式检测——提交后
 *     BOT_INVOKE_STATE_CHECK_MS 内 botStateKey 关键字段(phase/turn/pending/日志条数等)
 *     一个都没变,大概率是被服务端守卫拒绝。
 *  4. 调度健康看门狗(ai_lock_stuck):botDecisionInFlight 卡住超过
 *     BOT_DECISION_WATCHDOG_MS 未释放,强制清零并记录,不再让全部机器人永久冻结。
 *
 * 【已知范围限制,如实标注,不在这次测试里假装覆盖到】
 *  - 决策流水目前只在 callAiChooseIndex(唯一实际发起 AI 请求的收敛点)记录"AI是否真的
 *    决定了";不区分"本地兜底具体选了哪个候选"和"botSafePrompt(L1对话框兜底)"——这两条
 *    需要在更上层(botDecide/tryAiBotPlay等30+调用点各自)分别接入才能做到,改动面很大,
 *    这次任务不做,留给以后需要更细粒度诊断时再接。
 *  - botInvoke 通用检测是启发式(状态在窗口内没变≈大概率被拒绝),不是精确判定,可能有
 *    极少数假阴性(漏报),测试只验证"确实没变时会报""确实变了时不会报"这两个方向。
 *  - "非控制器玩家端对'长时间无动作且无倒计时'可观测"这条验收项本次未实现(需要每个
 *    非控制端客户端自己监控行动者停滞,是独立于本次四项之外的新机制,范围超出这次改动),
 *    如实标注为未完成,不在这里写一条会通过的假测试。
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
// db 存在即视为"Firebase 已配置"——writeDebugLog 顶部第一条守卫就是 typeof db==='undefined'||!db。
context.db = { ref: function(){ return { set: function(){ return Promise.resolve(); } }; } };

const sandbox = vm.createContext(context, { name: 'sgs-bot-observability-sandbox' });

console.log('Loading CORE-109 机器人可观测性测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-109 机器人行为可观测性测试');
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

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i), alive: true,
        hp: 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function captureWriteDebugLog(){
    var logged = [];
    var saved = writeDebugLog;
    writeDebugLog = function(roomIdArg, kind, payload){ logged.push({ kind: kind, payload: payload }); };
    return { logged: logged, restore: function(){ writeDebugLog = saved; } };
  }

  // ================= 1. bot_decision_trace(决策流水) =================
  await check('DEBUG_LOG_KINDS 已登记 bot_decision_trace/ai_call_failed/ai_lock_stuck', function(){
    ['bot_decision_trace','ai_call_failed','ai_lock_stuck'].forEach(function(k){
      if(DEBUG_LOG_KINDS.indexOf(k) < 0) throw new Error('DEBUG_LOG_KINDS 缺少 ' + k);
    });
  });

  await check('callAiChooseIndex: AI真实决定一次时记录bot_decision_trace(source=llm)', async function(){
    var cap = captureWriteDebugLog();
    var savedCallAI = callAI;
    aiApiKey = 'fake-key'; aiProvider = 'groq'; aiApiModel = 'llama-3.3-70b-versatile'; aiApiModels = [];
    callAI = function(){ return Promise.resolve({ ok:true, text: '{"choice":1}' }); };
    var g = mkSeatG({}); g.phase='play';
    var idx = await callAiChooseIndex({ g: g, seat: 0, systemPrompt: 'sys', userPrompt: 'user', candidates: [{label:'A'},{label:'B'}] });
    cap.restore(); callAI = savedCallAI; aiApiKey=''; aiProvider=null;
    if(idx !== 1) throw new Error('应解析出choice=1,实际='+idx);
    var trace = cap.logged.filter(function(l){ return l.kind==='bot_decision_trace'; });
    if(trace.length !== 1) throw new Error('应记录1条bot_decision_trace,实际='+trace.length);
    if(trace[0].payload.message.indexOf('[llm]') !== 0) throw new Error('message应以[llm]开头,实际='+trace[0].payload.message);
  });

  await check('callAiChooseIndex: AI返回但解析失败/越界时记录bot_decision_trace(source=ai_response_unusable)', async function(){
    var cap = captureWriteDebugLog();
    var savedCallAI = callAI;
    aiApiKey = 'fake-key'; aiProvider = 'groq'; aiApiModel = 'llama-3.3-70b-versatile'; aiApiModels = [];
    callAI = function(){ return Promise.resolve({ ok:true, text: '不是合法JSON' }); };
    var g = mkSeatG({}); g.phase='play';
    var idx = await callAiChooseIndex({ g: g, seat: 0, systemPrompt: 'sys', userPrompt: 'user', candidates: [{label:'A'},{label:'B'}] });
    cap.restore(); callAI = savedCallAI; aiApiKey=''; aiProvider=null;
    if(idx !== null) throw new Error('解析失败应回退null,实际='+idx);
    var trace = cap.logged.filter(function(l){ return l.kind==='bot_decision_trace'; });
    if(trace.length !== 1) throw new Error('应记录1条bot_decision_trace,实际='+trace.length);
    if(trace[0].payload.message.indexOf('[ai_response_unusable]') !== 0) throw new Error('message应以[ai_response_unusable]开头,实际='+trace[0].payload.message);
  });

  await check('callAiChooseIndex: 无密钥/单候选短路场景不产生任何诊断日志(不制造噪音)', async function(){
    var cap = captureWriteDebugLog();
    aiApiKey=''; aiProvider=null;
    var g = mkSeatG({}); g.phase='play';
    var idx1 = await callAiChooseIndex({ g: g, seat: 0, candidates: [{label:'A'},{label:'B'}] });
    aiApiKey = 'fake-key'; aiProvider = 'groq'; aiApiModel = 'x'; aiApiModels=[];
    var idx2 = await callAiChooseIndex({ g: g, seat: 0, candidates: [{label:'唯一候选'}] });
    aiApiKey=''; aiProvider=null;
    cap.restore();
    if(idx1 !== null) throw new Error('无密钥应返回null,实际='+idx1);
    if(idx2 !== 0) throw new Error('单候选应短路返回0,实际='+idx2);
    if(cap.logged.length !== 0) throw new Error('这两种场景不应产生任何诊断日志,实际='+JSON.stringify(cap.logged.map(function(l){return l.kind;})));
  });

  // ================= 2. ai_call_failed(callAI失败统一记录) =================
  await check('callAiChooseIndex: callAI失败(网络错误)时记录ai_call_failed', async function(){
    var cap = captureWriteDebugLog();
    var savedCallAI = callAI;
    aiApiKey = 'fake-key'; aiProvider = 'groq'; aiApiModel = 'llama-3.3-70b-versatile'; aiApiModels = [];
    callAI = function(){ return Promise.resolve({ ok:false, reason:'network', detail:'网络请求失败: fetch failed' }); };
    var g = mkSeatG({}); g.phase='play';
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: [{label:'A'},{label:'B'}] });
    cap.restore(); callAI = savedCallAI; aiApiKey=''; aiProvider=null;
    if(idx !== null) throw new Error('callAI失败应回退null,实际='+idx);
    var failLog = cap.logged.filter(function(l){ return l.kind==='ai_call_failed'; });
    if(failLog.length !== 1) throw new Error('应记录1条ai_call_failed,实际='+failLog.length);
    if(failLog[0].payload.message.indexOf('network') < 0) throw new Error('message应含失败类别network,实际='+failLog[0].payload.message);
    if(failLog[0].payload.message.indexOf('llama-3.3-70b-versatile') < 0) throw new Error('message应含model,实际='+failLog[0].payload.message);
    // bot_decision_trace不应额外记一条(失败路径只走ai_call_failed,不重复)
    var trace = cap.logged.filter(function(l){ return l.kind==='bot_decision_trace'; });
    if(trace.length !== 0) throw new Error('callAI失败路径不应额外记bot_decision_trace,实际='+trace.length);
  });

  await check('callAiChooseIndex: 轮换池全部冷却(哨兵空串)时记录ai_call_failed且message说明原因', async function(){
    var cap = captureWriteDebugLog();
    var savedResolveAiModel = resolveAiModel;
    aiApiKey = 'fake-key'; aiProvider = 'groq'; aiApiModel = ''; aiApiModels = ['a','b'];
    resolveAiModel = function(){ return ''; }; // 全池冷却哨兵
    var g = mkSeatG({}); g.phase='play';
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: [{label:'A'},{label:'B'}] });
    cap.restore(); resolveAiModel = savedResolveAiModel; aiApiKey=''; aiProvider=null; aiApiModels=[];
    if(idx !== null) throw new Error('全池冷却应回退null,实际='+idx);
    var failLog = cap.logged.filter(function(l){ return l.kind==='ai_call_failed'; });
    if(failLog.length !== 1) throw new Error('应记录1条ai_call_failed,实际='+failLog.length);
    if(failLog[0].payload.message.indexOf('冷却') < 0) throw new Error('message应说明全池冷却,实际='+failLog[0].payload.message);
  });

  // ================= 3. bot_decision_failed 通用兜底(botInvoke) =================
  await check('botInvoke: 提交后状态在窗口内完全未变化时记录bot_decision_failed(启发式检测)', async function(){
    var cap = captureWriteDebugLog();
    var savedCheckMs = BOT_INVOKE_STATE_CHECK_MS;
    BOT_INVOKE_STATE_CHECK_MS = 20;
    var g = mkSeatG({}); g.phase = 'duel'; g.pending = { type:'duel', active:0, to:1 };
    currentG = g;
    botInvoke(0, function(){ /* 模拟一次什么都没做的、被服务端守卫拒绝的提交 */ });
    await new Promise(function(r){ setTimeout(r, 80); });
    BOT_INVOKE_STATE_CHECK_MS = savedCheckMs;
    cap.restore();
    var failLog = cap.logged.filter(function(l){ return l.kind==='bot_decision_failed'; });
    if(failLog.length !== 1) throw new Error('状态完全未变时应记录1条bot_decision_failed,实际='+failLog.length);
    if(failLog[0].payload.pendingType !== 'duel') throw new Error('pendingType应为duel,实际='+failLog[0].payload.pendingType);
  });

  await check('botInvoke: 提交后状态确实变化(如log增长)时不产生bot_decision_failed', async function(){
    var cap = captureWriteDebugLog();
    var savedCheckMs = BOT_INVOKE_STATE_CHECK_MS;
    BOT_INVOKE_STATE_CHECK_MS = 20;
    var g = mkSeatG({}); g.phase = 'duel'; g.pending = { type:'duel', active:0, to:1 };
    currentG = g;
    botInvoke(0, function(){ g.log = pushLog(g.log, '机器人0 打出了【杀】'); });
    await new Promise(function(r){ setTimeout(r, 80); });
    BOT_INVOKE_STATE_CHECK_MS = savedCheckMs;
    cap.restore();
    var failLog = cap.logged.filter(function(l){ return l.kind==='bot_decision_failed'; });
    if(failLog.length !== 0) throw new Error('状态确实变化时不应记录bot_decision_failed,实际='+failLog.length);
  });

  // ================= 4. ai_lock_stuck(botDecisionInFlight看门狗) =================
  await check('botDecisionInFlight超时未释放:看门狗强制清零并记录ai_lock_stuck', async function(){
    var cap = captureWriteDebugLog();
    var savedIsBotController = isBotController;
    var savedRunBotDecision = runBotDecision;
    var savedWatchdogMs = BOT_DECISION_WATCHDOG_MS;
    isBotController = function(){ return true; };
    runBotDecision = function(){ return new Promise(function(){}); }; // 永不resolve,模拟挂死
    BOT_DECISION_WATCHDOG_MS = 30;
    botTimer = null; botScheduledKey = null; botDecisionInFlight = false;
    var g = mkSeatG({}); g.phase='play'; g.turn=0; currentG = g;
    scheduleBotTurn(g);
    // 等 debounce(650~1150ms) + 看门狗(30ms) 都触发完
    await new Promise(function(r){ setTimeout(r, 1800); });
    isBotController = savedIsBotController;
    runBotDecision = savedRunBotDecision;
    BOT_DECISION_WATCHDOG_MS = savedWatchdogMs;
    cap.restore();
    if(botDecisionInFlight !== false) throw new Error('看门狗应强制清零botDecisionInFlight,实际='+botDecisionInFlight);
    var stuckLog = cap.logged.filter(function(l){ return l.kind==='ai_lock_stuck'; });
    if(stuckLog.length < 1) throw new Error('应至少记录1条ai_lock_stuck(看门狗触发后会自我重查,窗口内可能不止一次,只要求>=1),实际='+stuckLog.length+',全部kinds='+JSON.stringify(cap.logged.map(function(l){return l.kind;})));
  });

  await check('botDecisionInFlight正常完成时不触发看门狗(不误报ai_lock_stuck)', async function(){
    var cap = captureWriteDebugLog();
    var savedIsBotController = isBotController;
    var savedRunBotDecision = runBotDecision;
    var savedWatchdogMs = BOT_DECISION_WATCHDOG_MS;
    isBotController = function(){ return true; };
    runBotDecision = function(){ return Promise.resolve(); }; // 立即完成
    BOT_DECISION_WATCHDOG_MS = 30;
    botTimer = null; botScheduledKey = null; botDecisionInFlight = false;
    var g = mkSeatG({}); g.phase='play'; g.turn=0; currentG = g;
    scheduleBotTurn(g);
    await new Promise(function(r){ setTimeout(r, 1800); });
    isBotController = savedIsBotController;
    runBotDecision = savedRunBotDecision;
    BOT_DECISION_WATCHDOG_MS = savedWatchdogMs;
    cap.restore();
    var stuckLog = cap.logged.filter(function(l){ return l.kind==='ai_lock_stuck'; });
    if(stuckLog.length !== 0) throw new Error('正常完成的决策不应触发ai_lock_stuck,实际='+stuckLog.length);
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
