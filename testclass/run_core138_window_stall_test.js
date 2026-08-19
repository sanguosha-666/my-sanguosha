/**
 * CORE-138: 强C出牌窗口的「状态无变化」检测
 *
 * 缺陷:runBotActionWindow 用 `newG===lastG` 引用比较判断动作是否生效。真实 Firebase
 * 的 tx 每次交付 snapshot.val() 的全新对象,所以它只能抓「提交回调根本没来」(!newG),
 * 抓不到「提交来了但被服务端守卫拒绝成 no-op」——那种情况下循环会用一模一样的局面
 * 重新枚举、选中同一个动作、再次被拒绝,直到 8 步上限兜底(白白浪费 8 次 AI 调用)。
 * 修复:补一层 botStateKey 内容比较。
 *
 * 覆盖:
 *  1. 正面:提交回执了但 botStateKey 不变 → 第 1 步就 break,不跑满 8 步
 *  2. 反面:真实有效动作(botStateKey 变化)不被误判,正常跑满 8 步
 *  3. 只有 log 变化(手牌不变)也算有效推进,不误杀
 *  4. 两道检查职责分离:!newG(超时) 与 stall(no-op) 各自独立生效
 *  5. 三道既有保护逐字不动:isBotActionWindow / BOT_COMMIT_TIMEOUT_MS / 看门狗
 *  6. 无密钥路径零变化(执行一步即 return,根本走不到第 2 步)
 *  7. 破坏性验证:去掉 stall 检测,用例1 确实会跑满 8 步
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: console, Math: Math, JSON: JSON,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  mySeat: 0, myClientId: 'test-client',
  sessionStorage: { _d:{}, getItem:function(){return null;}, setItem:function(){}, removeItem:function(){} },
  localStorage: { getItem:function(){return null;}, setItem:function(){}, removeItem:function(){}, clear:function(){} },
  firebase: {
    initializeApp: function(){ return { database: function(){ return { ref: function(){ return {
      on:function(){}, once:function(){}, push:function(){ return { set:function(){}, key:'k' }; },
      transaction:function(fn){ var cb=fn(function(){}); if(cb) cb(); return {}; },
      set:function(){}, update:function(){}, child:function(){ return {}; }, remove:function(){},
      get:function(){ return { val:function(){ return null; } }; } }; } }; } }; },
    database: function(){ return { ref: function(){ return {
      on:function(){}, once:function(){}, push:function(){ return { set:function(){}, key:'k' }; },
      transaction:function(){ return {}; }, set:function(){}, child:function(){ return {}; },
      remove:function(){}, get:function(){ return { val:function(){ return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(){ return { onclick:null, innerHTML:'', textContent:'', style:{}, className:'',
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      appendChild:function(){return {};}, remove:function(){}, setAttribute:function(){},
      getAttribute:function(){return null;}, addEventListener:function(){}, removeEventListener:function(){},
      insertAdjacentHTML:function(){}, querySelector:function(){return null;}, querySelectorAll:function(){return [];} }; },
    createElement: function(){ return { style:{}, textContent:'', className:'',
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      appendChild:function(){return {};}, setAttribute:function(){}, getAttribute:function(){return null;},
      addEventListener:function(){} }; },
    body:{ appendChild:function(){return {};} },
    querySelector:function(){return null;}, querySelectorAll:function(){return [];},
    addEventListener:function(){}, removeEventListener:function(){}
  },
  window: { aiConversations:{}, addEventListener:function(){}, removeEventListener:function(){},
    location:{search:'',href:'http://localhost',reload:function(){}},
    setTimeout:function(f,t){return setTimeout(f,t);}, clearTimeout:function(t){return clearTimeout(t);} }
};
context.window.sessionStorage = context.sessionStorage;
context.window.localStorage = context.localStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core138-sandbox' });

console.log('Loading CORE-138 测试环境...\n');
const files = ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js',
  'sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js',
  'bot-ai-bus.js','bot.js','ai-bot.js','render.js'];
files.forEach(function(file){
  try{
    vm.runInContext(fs.readFileSync(file,'utf8'), sandbox, { filename: file });
    console.log('  OK ' + file);
    if(file==='game.js'){
      vm.runInContext('gameRef = { __txSnapshot: null, transaction: function(fn){ var result = fn(typeof _g !== "undefined" ? _g : {}); var snap = gameRef.__txSnapshot !== null ? gameRef.__txSnapshot : result; return Promise.resolve({ snapshot: { val: function(){ return snap; } } }); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
    }
  }catch(e){
    console.log('  FAIL ' + file + ': ' + e.message);
    if(e.stack) console.log('     ' + e.stack.split('\n').slice(1,3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-138:强C出牌窗口的状态无变化检测');
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

  function card(name, id){ return { id: id||(name+''), name: name, suit:'♥', rank:5 }; }
  function mkG(hand){
    var players = [];
    for(var i=0;i<3;i++){
      players.push({ name:'玩家'+i, alive:true, hp:4, maxHp:4,
        hand: i===0?hand:[], equips: emptyEquips(), delays:[], isBot:i===0, role:'zhu' });
    }
    return { players: players, gameMode:'ffa', roundNum:1, phase:'play', turn:0,
      log:[], pending:null, aoe:null, started:true, discard:[], deck:[],
      exchangeCards:[], over:false, winner:null, shaUsed:false };
  }
  function manySha(n){ var a=[]; for(var i=0;i<n;i++) a.push(card('杀','sha'+i)); return a; }
  function aiAlwaysFirst(n){
    window.__mockAiResults = [];
    for(var i=0;i<n;i++) window.__mockAiResults.push({ ok:true, text:'{"choice":0}' });
  }

  var origPlayCard = playCard, origEndPlay = endPlay;
  function restore(){ playCard = origPlayCard; endPlay = origEndPlay; }

  // AI mock:与 run_ai_bus_c_window_test.js 同款(消费 __mockAiResults 队列并计数)。
  // 本用例集全部依赖"AI 每步都选 candidates[0]"来驱动多步循环——mkG 全员 role='zhu'
  // 且无嫌疑值,botTargetScore 对杀的目标恒 -Infinity,本地兜底会直接选"结束出牌阶段",
  // 跑不出多步;必须靠 AI mock 把每一步推下去,这才能测到步数相关的行为。
  window.__mockAiCalls = 0;
  window.__mockAiResults = [];
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    return window.__mockAiResults.length ? window.__mockAiResults.shift()
      : { ok:false, reason:'other', detail:'队列已空' };
  };

  // ---------- 1. 正面:提交回执但状态没变 → 第1步就停 ----------
  await check('【正面】提交回执了但 botStateKey 不变 → 第1步即 break(不跑满8步)', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkG(manySha(8));
    // 模拟"服务端守卫把动作原地拒绝成 no-op":tx 照常提交,交付一个**全新对象**,
    // 但内容和上一步完全相同(手牌没少、日志没长)。这正是引用比较抓不到的情况。
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      if(onCommitted) onCommitted(JSON.parse(JSON.stringify(g))); // 新对象、内容不变
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== 1)
        throw new Error('应在第1步检测到状态无变化并停止,实际执行了 ' + window.__playCalls.length + ' 步');
    } finally { restore(); }
  });

  await check('【正面】交付的确实是新对象(引用不同),证明旧的引用比较抓不到它', async function(){
    var g = mkG(manySha(2));
    var clone = JSON.parse(JSON.stringify(g));
    if(clone === g) throw new Error('构造有误:克隆应是新对象');
    if(botStateKey(clone, 0) !== botStateKey(g, 0))
      throw new Error('构造有误:内容相同的克隆,botStateKey 应相同');
  });

  // ---------- 2. 反面:真实有效动作不被误判 ----------
  await check('【反面】真实有效动作(手牌减少→botStateKey变化) → 正常跑满8步,不被误杀', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkG(manySha(10));
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      var sim = window.__simG;
      sim.players[0].hand.splice(cardIdx, 1);      // 真实推进:手牌减少
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== BOT_WINDOW_MAX_STEPS)
        throw new Error('有效动作应跑满 ' + BOT_WINDOW_MAX_STEPS + ' 步,实际 ' + window.__playCalls.length + ' 步(疑似误杀)');
    } finally { restore(); }
  });

  await check('【反面】只有日志增长(手牌不变)也算有效推进,不误杀', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkG(manySha(8));
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      var sim = window.__simG;
      sim.log.push({ seq: sim.log.length, text: '发生了一些事' });  // 只动日志
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== BOT_WINDOW_MAX_STEPS)
        throw new Error('日志增长应被视为有效推进,应跑满 ' + BOT_WINDOW_MAX_STEPS + ' 步,实际 ' + window.__playCalls.length);
    } finally { restore(); }
  });

  await check('【反面】第3步才卡住 → 前2步正常执行,第3步停(检测是逐步的,不是一刀切)', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkG(manySha(8));
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      var sim = window.__simG;
      if(window.__playCalls.length < 3) sim.players[0].hand.splice(cardIdx, 1); // 前2步真实推进
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== 3)
        throw new Error('应在第3步(第一次无变化)停止,实际 ' + window.__playCalls.length + ' 步');
    } finally { restore(); }
  });

  // ---------- 3. 两道检查职责分离 ----------
  await check('【职责分离】!newG(提交回调根本没来)仍然独立生效,逐字未改', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var savedTimeout = BOT_COMMIT_TIMEOUT_MS;
    BOT_COMMIT_TIMEOUT_MS = 30;   // 缩短以加速超时路径(既有测试同款做法)
    var g = mkG(manySha(8));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      // 故意不调 onCommitted → executePlayWindowChoiceAwait 超时 resolve null
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== 1)
        throw new Error('提交回调不来时应第1步即停,实际 ' + window.__playCalls.length);
    } finally { restore(); BOT_COMMIT_TIMEOUT_MS = savedTimeout; }
  });

  // ---------- 4. 三道既有保护逐字不动 ----------
  await check('【既有保护】isBotActionWindow 判定逻辑逐字未改', function(){
    var src = String(isBotActionWindow);
    if(/botStateKey|stallDetected|stepStartKey/.test(src))
      throw new Error('isBotActionWindow 不应引入任何本次新增的标识符');
    // 行为抽查:非 play 阶段/死亡/非本人回合应为 false
    var g = mkG([card('杀')]);
    if(isBotActionWindow(g, 0) !== true) throw new Error('正常出牌窗口应为 true');
    var g2 = mkG([card('杀')]); g2.phase = 'discard';
    if(isBotActionWindow(g2, 0) !== false) throw new Error('非 play 阶段应为 false');
    var g3 = mkG([card('杀')]); g3.players[0].alive = false;
    if(isBotActionWindow(g3, 0) !== false) throw new Error('已阵亡应为 false');
  });

  await check('【既有保护】BOT_COMMIT_TIMEOUT_MS 与 BOT_DECISION_WATCHDOG_MS 取值未被改动', function(){
    if(BOT_COMMIT_TIMEOUT_MS !== 5000) throw new Error('提交超时应仍是 5000,实际 ' + BOT_COMMIT_TIMEOUT_MS);
    if(BOT_DECISION_WATCHDOG_MS !== 120000) throw new Error('看门狗应仍是 120000,实际 ' + BOT_DECISION_WATCHDOG_MS);
    if(BOT_WINDOW_MAX_STEPS !== 8) throw new Error('步数上限本次刻意不动,应仍是 8,实际 ' + BOT_WINDOW_MAX_STEPS);
  });

  await check('【既有保护】executePlayWindowChoiceAwait 的超时兜底逻辑逐字未改', function(){
    var src = String(executePlayWindowChoiceAwait);
    if(/botStateKey|stallDetected/.test(src))
      throw new Error('executePlayWindowChoiceAwait 不应引入本次新增的标识符');
    if(src.indexOf('BOT_COMMIT_TIMEOUT_MS') < 0)
      throw new Error('超时兜底应仍在');
  });

  // ---------- 5. 无密钥零变化 ----------
  // 构造要点:必须让本地启发式**真的会出牌**才测得到步数——mkG 全员 role='zhu' 无嫌疑值
  // 时杀的目标恒 -Infinity,本地兜底会直接选"结束出牌阶段"(走 endPlay 不走 playCard)。
  // 用两张【桃】+ myHp<maxHp:桃无目标、botCardPriority=100 > 阈值25,必被打出。
  // 且这里让 playCard 交付**真实变化**的快照(手牌减少)——这样 stall 检测**不会**触发,
  // 于是"只执行了1步"只可能是无密钥那条 if(!aiReady) return; 起的作用,
  // 而不是被本次新增的检测拦下的。两个原因被这个构造彻底分开了。
  await check('【无密钥零变化】无密钥执行一步即 return(且与 stall 检测无关,构造上已分离)', async function(){
    window.__playCalls = []; window.__endPlayCalls = 0; window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkG([card('桃','t1'), card('桃','t2')]);
    g.players[0].hp = 2;
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      var sim = window.__simG;
      sim.players[0].hand.splice(cardIdx, 1);   // 真实推进 → botStateKey 会变 → stall 不触发
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    endPlay = function(onCommitted){ window.__endPlayCalls++; if(onCommitted) onCommitted(window.__simG); };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length !== 1)
        throw new Error('无密钥应恰执行1步,实际 ' + window.__playCalls.length);
      if(window.__playCalls[0].action !== '桃')
        throw new Error('应出桃,实际 ' + window.__playCalls[0].action);
      if(window.__mockAiCalls !== 0) throw new Error('无密钥不应询问AI,实际 ' + window.__mockAiCalls);
    } finally { restore(); aiApiKey=''; aiProvider=null; }
  });

  await check('【无密钥零变化·对照】同一局面配上密钥则会继续多步,证明上一条测的确实是无密钥分支', async function(){
    window.__playCalls = []; window.__endPlayCalls = 0; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkG([card('桃','t1'), card('桃','t2')]);
    g.players[0].hp = 2;
    window.__simG = JSON.parse(JSON.stringify(g));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      var sim = window.__simG;
      sim.players[0].hand.splice(cardIdx, 1);
      var next = JSON.parse(JSON.stringify(sim));
      window.__simG = next;
      if(onCommitted) onCommitted(next);
    };
    endPlay = function(onCommitted){ window.__endPlayCalls++; if(onCommitted) onCommitted(window.__simG); };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length < 2)
        throw new Error('有密钥应继续多步(手牌2张),实际 ' + window.__playCalls.length + ' 步 —— 若为1步说明上一条其实没测到无密钥分支');
    } finally { restore(); aiApiKey=''; aiProvider=null; }
  });

  // ---------- 6. 破坏性验证 ----------
  await check('破坏性验证:让 botStateKey 每次返回不同值(等价于关掉检测),用例1确实跑满8步', async function(){
    window.__playCalls = []; window.__mockAiCalls = 0;
    aiAlwaysFirst(20);
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var saved = botStateKey, n = 0;
    botStateKey = function(){ return 'unique-' + (n++); };  // 永不相同 = 检测失效
    var g = mkG(manySha(8));
    playCard = function(cardIdx, action, target, onCommitted){
      window.__playCalls.push({ cardIdx: cardIdx, action: action });
      if(onCommitted) onCommitted(JSON.parse(JSON.stringify(g)));  // 同用例1:内容不变的新对象
    };
    try{
      await runBotActionWindow(g, 0);
      if(window.__playCalls.length === 1)
        throw new Error('检测被关掉后仍只跑1步,说明用例1的断言没有鉴别力');
      if(window.__playCalls.length !== BOT_WINDOW_MAX_STEPS)
        throw new Error('检测失效后应一路跑到步数上限 ' + BOT_WINDOW_MAX_STEPS + ',实际 ' + window.__playCalls.length);
      console.log('       ↳ 关掉检测后确实跑满 ' + window.__playCalls.length + ' 步(= 修复前的行为,断言有鉴别力)');
    } finally { botStateKey = saved; restore(); }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0) throw new Error('CORE-138 测试有 ' + fail + ' 条失败');
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'core138-test.js' })
  .catch(function(e){ console.error('\n' + (e && e.message || e)); process.exit(1); });
