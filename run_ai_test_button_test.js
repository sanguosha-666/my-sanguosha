/**
 * AI 测试托管按钮 —— 完整回归套件(Task 6)。
 * Task2(parseBotPlayAiChoiceWithReason + callAiChooseIndex 托管检测)
 * + Task3(botSeatForState/runBotDecision/scheduleBotTurn 托管接入 + 非控制器浏览器
 * 托管调度放行限定) + Task4(toggleAiTestAutopilot 开关 + appendAiTestRecord/toggleAiTestRecord
 * 信息窗渲染) + Task5(aiTestDecisionHook/aiTestLastCall 采集) + Task6(越界边界:托管座位
 * 阵亡时决策不触发)。
 *
 * 加载真实完整链路(config/data/debug-log/room-lifecycle/game/weapons/skills/bot-ai-bus/
 * bot/ai-bot/render)进共享 vm 沙箱(与 run_ai_bus_l3_test.js 同一套 firebase/document/window
 * stub 与异步 check 断言惯例)。
 *
 * 覆盖(对照 plan §七 测试清单 8 组):
 *  - parseBotPlayAiChoiceWithReason: 带reason解析 / 无reason回退老解析 / 代码块包裹 /
 *    垃圾输入回退null(4 项)
 *  - callAiChooseIndex: 托管命中时返回 idx 且 aiTestLastReason 被设置 / 未托管时 reason
 *    保持 null 零变化(2 项)+ aiTestLastCall 采集/不触碰(2 项)
 *  - botSeatForState: 托管开启时真人座位被解析为行动者 / 托管关闭时恒 -1(回归)
 *  - runBotDecision: 托管真人座位可进入(draw 分支被调用,守卫放行)
 *  - scheduleBotTurn: 非控制器浏览器(非 isBotController)托管自己时回调放行执行决策 /
 *    轮到别的 bot 座位时入口门 return 不调度
 *  - toggleAiTestAutopilot: 无密钥不开启弹配置 / 有密钥开启 / 再次点击关闭(3 项)
 *  - appendAiTestRecord 追加 + toggleAiTestRecord 折叠不抛错(2 项)
 *  - aiTestDecisionHook 直调追加 record + runBotDecision 托管决策后 records 增长(2 项)
 *  - 越界/边界:托管座位阵亡时 runBotDecision 首行 return,不决策不采集(1 项)
 *
 * 已知的 vm 坑(沿用 l3 结论):aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let 绑定,
 * 必须用 runInContext 里裸标识符赋值;callAI 是函数声明绑定,可直接在 runInContext 里
 * 整体替换成 mock。
 *
 * 【aiTestLastReason 的模块级声明】计划的 Step 5 修改点 A 原文是在 callAiChooseIndex
 * 函数体内部写 `if(typeof aiTestLastReason==='undefined') var aiTestLastReason = null;`——
 * var 提升会让它成为该函数的局部变量,测试(本文件 Step 6 断言)和 Task 5 的
 * aiTestDecisionHook 都在函数外读它,必然读到 undefined/抛 ReferenceError,测试恒红。
 * 计划的 Interfaces 明确要求"写入模块级 aiTestLastReason(供 record 采集)",所以实现时
 * 把声明放在 bot-ai-bus.js 顶层(let aiTestLastReason = null;),函数内直接读写,测试在此
 * 按"模块级"语义断言。
 */
const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: {
    transaction: function(fn) {
      return fn(context.g || {});
    }
  },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, querySelector: function() { return null; }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; }, remove: function() {} }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: [],
    // render.js 顶层注册横屏引导/音频解锁监听需要 document 级 addEventListener
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
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-ai-test-button-sandbox' });

console.log('Loading AI 测试托管按钮(Task2+Task3)测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot-ai-bus.js 在 bot.js 之前(TDZ:const BOT_DECISIONS
// 必须先于注册项);ai-bot.js 最后、render.js 殿后。
const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sandbox);
      vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  AI 测试托管按钮 Task2+Task3(理由解析+托管检测+调度接入)');
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

  // ---- mock callAI(函数声明绑定,整体替换;记录 opts 供 prompt 断言) ----
  window.__mockAiCalls = 0;
  window.__mockAiArgs = null;
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return { ok: true, text: '{"choice":1,"reason":"测试理由"}' };
  };

  // callAiChooseIndex 直接用 opts.g 传给 showAiThinkingIndicator(g,seat),只读
  // g.players[seat].name,一个最小对象即可。
  var g = { players: [ { name: '机器人0' }, { name: '玩家1' }, { name: '玩家2' } ] };

  // ================= Task2 Step1:parseBotPlayAiChoiceWithReason(4 项) =================
  await check('parseBotPlayAiChoiceWithReason: 带reason解析', function(){
    var r = parseBotPlayAiChoiceWithReason('{"choice":2,"reason":"因为对面血量低"}');
    if(r.idx!==2 || r.reason!=='因为对面血量低') throw new Error('应 {idx:2,reason:...},实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 无reason回退老解析', function(){
    var r = parseBotPlayAiChoiceWithReason('{"choice":1}');
    if(r.idx!==1 || r.reason!==null) throw new Error('应 {idx:1,reason:null},实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 代码块包裹', function(){
    var r = parseBotPlayAiChoiceWithReason('\`\`\`json\n{"choice":0,"reason":"r"}\n\`\`\`');
    if(r.idx!==0 || r.reason!=='r') throw new Error('应剥代码块,实际 '+JSON.stringify(r));
  });
  await check('parseBotPlayAiChoiceWithReason: 垃圾输入回退null', function(){
    var r = parseBotPlayAiChoiceWithReason('你好');
    if(r.idx!==null) throw new Error('应 null,实际 '+JSON.stringify(r));
  });

  // ================= Task2 Step6:callAiChooseIndex 托管检测(2 项) =================
  aiApiKey = 'test-key';
  aiProvider = 'claude';
  // 沙箱全局创建 aiTestAutopilot(Task 4 才正式定义,这里模拟其形状)
  aiTestAutopilot = { active: false, seat: null, records: [] };

  await check('callAiChooseIndex: 托管命中时返回idx且aiTestLastReason被设置', async function(){
    aiTestAutopilot = {active:true, seat:0};
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!=='测试理由') throw new Error('应采集理由,实际 '+aiTestLastReason);
    // 附加:托管命中时 systemPrompt 应含"本次为AI测试托管"指令
    if(!window.__mockAiArgs || window.__mockAiArgs.opts.systemPrompt.indexOf('AI测试托管') < 0)
      throw new Error('托管命中时 systemPrompt 应含托管指令,实际 '+JSON.stringify(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt));
  });
  await check('callAiChooseIndex: 未托管时reason保持null(零变化)', async function(){
    aiTestAutopilot = {active:false, seat:0};
    aiTestLastReason = '旧值';
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!==null) throw new Error('未托管不应采集理由,实际 '+aiTestLastReason);
    // 附加:未托管时 systemPrompt 不应含托管指令(零变化)
    if(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt.indexOf('AI测试托管') >= 0)
      throw new Error('未托管时 systemPrompt 不应含托管指令,实际 '+JSON.stringify(window.__mockAiArgs.opts.systemPrompt));
  });

  // ================= Task5:aiTestLastCall 采集(2 项) =================
  await check('callAiChooseIndex: 托管命中时aiTestLastCall被设置(含prompt与rawResponse)', async function(){
    aiTestAutopilot = {active:true, seat:0};
    aiTestLastCall = null;
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(!aiTestLastCall) throw new Error('托管命中应设置aiTestLastCall,实际 null');
    if(typeof aiTestLastCall.prompt!=='string' || aiTestLastCall.prompt.indexOf('AI测试托管')<0)
      throw new Error('prompt应含托管指令,实际 '+JSON.stringify(aiTestLastCall.prompt));
    if(aiTestLastCall.rawResponse!=='{"choice":1,"reason":"测试理由"}')
      throw new Error('rawResponse应取AI返回文本,实际 '+JSON.stringify(aiTestLastCall.rawResponse));
  });
  await check('callAiChooseIndex: 未托管时aiTestLastCall不被触碰(零变化)', async function(){
    aiTestAutopilot = {active:false, seat:0};
    aiTestLastCall = { prompt: 'stale', rawResponse: 'stale-r' };
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(!aiTestLastCall || aiTestLastCall.prompt!=='stale')
      throw new Error('未托管不应改写aiTestLastCall,实际 '+JSON.stringify(aiTestLastCall));
  });

  // ================= Task3:botSeatForState/runBotDecision 托管接入(3 项) =================
  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '座位0' : ('座位' + i), alive: true,
        hp: 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true };
  }

  await check('botSeatForState: 托管开启时真人座位在play阶段被解析为行动者', function(){
    var g = mkSeatG({n:3});
    g.phase='play'; g.turn=0;
    g.players[0].isBot=false; g.players[1].isBot=true;
    aiTestAutopilot = {active:true, seat:0};
    var s = botSeatForState(g);
    if(s!==0) throw new Error('应返回0(托管真人座位),实际 '+s);
  });
  await check('botSeatForState: 托管关闭时真人座位恒-1(回归)', function(){
    var g = mkSeatG({n:3});
    g.phase='play'; g.turn=0;
    g.players[0].isBot=false;
    aiTestAutopilot = {active:false, seat:0};
    var s = botSeatForState(g);
    if(s!==-1) throw new Error('应返回-1,实际 '+s);
  });
  await check('runBotDecision: 托管真人座位可进入(draw分支被调用,未被首行拦截)', async function(){
    var g = mkSeatG({n:3});
    g.phase='draw'; g.turn=0;
    g.players[0].isBot=false;
    aiTestAutopilot = {active:true, seat:0};
    // spy doDraw(函数声明,整体替换):守卫放行且命中 draw 分支才会调用它,被首行拦截则不调用
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    await runBotDecision(g, 0);
    if(window.__doDrawCalled !== 1) throw new Error('draw分支应被调用(守卫放行),实际调用 '+window.__doDrawCalled+' 次');
  });

  // ================= Task5:决策记录采集(2 项) =================
  await check('aiTestDecisionHook: 直接调用追加record(stateInfo/phaseLabel/reason回退)', function(){
    aiTestAutopilot = {active:true, seat:0, records:[]};
    aiTestLastReason = '直接调用理由';
    var g2 = mkSeatG({n:3});
    g2.phase='duel';
    aiTestDecisionHook(g2, 0, {summary:'决策(duel)', prompt:'p1', rawResponse:'r1', choice:1});
    if(aiTestAutopilot.records.length!==1) throw new Error('应追加1条,实际 '+aiTestAutopilot.records.length);
    var rec = aiTestAutopilot.records[0];
    if(rec.phaseLabel!=='duel') throw new Error('phaseLabel应为原始phase字符串,实际 '+rec.phaseLabel);
    if(typeof rec.stateInfo!=='string' || !rec.stateInfo) throw new Error('stateInfo应非空字符串');
    if(rec.summary!=='决策(duel)') throw new Error('summary应透传,实际 '+rec.summary);
    if(rec.prompt!=='p1' || rec.rawResponse!=='r1') throw new Error('prompt/rawResponse应透传');
    if(rec.choice!==1) throw new Error('choice应透传,实际 '+rec.choice);
    if(rec.reason!=='直接调用理由') throw new Error('reason应回退aiTestLastReason,实际 '+rec.reason);
  });
  await check('runBotDecision: 托管决策后采集hook被调用(records增长+透传,draw分支照常)', async function(){
    var g3 = mkSeatG({n:3});
    g3.phase='draw'; g3.turn=0;
    g3.players[0].isBot=false;
    aiTestAutopilot = {active:true, seat:0, records:[]};
    aiTestLastCall = { prompt: '本次prompt', rawResponse: '本次raw' };
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    await runBotDecision(g3, 0);
    if(aiTestAutopilot.records.length < 1) throw new Error('应至少追加1条record,实际 '+aiTestAutopilot.records.length);
    var rec = aiTestAutopilot.records[0];
    if(typeof rec.summary!=='string' || !rec.summary) throw new Error('summary应非空');
    if(typeof rec.stateInfo!=='string' || !rec.stateInfo) throw new Error('stateInfo应为非空字符串');
    if(rec.prompt!=='本次prompt') throw new Error('prompt应取aiTestLastCall,实际 '+rec.prompt);
    if(rec.rawResponse!=='本次raw') throw new Error('rawResponse应取aiTestLastCall,实际 '+rec.rawResponse);
    if(window.__doDrawCalled !== 1) throw new Error('draw分支应照常执行,实际 '+window.__doDrawCalled+' 次');
  });

  // ============ Task3b:非控制器浏览器托管调度放行(限托管座位自己)(2 项) ============
  // 场景:我(座位0)托管自己,但我的浏览器不是 isBotController(不是"第一个真人"浏览器)。
  // 用 cid 构造:players[0].cid 被"另一个真人"持有,myClientId 指向自己 → isBotController 恒 false,
  // 只有 aiTestSelf(托管自己座位)放行。这两条断言在修复前必须红:
  //  1) 回调第二道门 if(!latest || !isBotController(latest)) return 会拦住非控制器浏览器,
  //     托管自己的回合决策永不执行 —— 断言"回调放行并执行 draw 决策"修复前必红;
  //  2) 入口门在座位解析后没有"非控制器只限托管座位"这道限制,轮到别的 bot 座位时也会
  //     继续排程 —— 断言"轮到别的 bot 座位不调度"修复前必红(会调度出 1 个定时器)。
  // 沙箱里 scheduleBotTurn 用的是裸 setTimeout(和 bot.js 同一上下文),这里临时换成捕获版,
  // 手动触发回调验证"回调放行",测完恢复真实定时器,避免真实 debounce 定时器泄漏。
  function captureSetTimeout(){
    window.__scheduled = [];
    setTimeout = function(fn){ window.__scheduled.push(fn); return window.__scheduled.length; };
    clearTimeout = function(){};
  }
  function restoreSetTimeout(){
    setTimeout = window.setTimeout;
    clearTimeout = window.clearTimeout;
  }
  function mkNonControllerG(turnIdx, phase){
    var g = mkSeatG({n:3});
    g.phase = phase || 'play';
    g.turn = turnIdx;
    g.players[0].isBot = false; g.players[0].cid = 'first-human-cid';
    g.players[1].isBot = true;  g.players[1].cid = 'bot-cid-1';
    g.players[2].isBot = true;  g.players[2].cid = 'bot-cid-2';
    myClientId = 'my-cid-not-controller'; // 自己不是第一个真人浏览器
    mySeat = 0;
    return g;
  }

  await check('scheduleBotTurn回调: 非控制器浏览器托管自己时回调放行(执行draw决策)', async function(){
    var g = mkNonControllerG(0, 'draw'); // 轮到托管座位0(draw阶段)
    aiTestAutopilot = {active:true, seat:0};
    captureSetTimeout();
    scheduleBotTurn(g);
    if(window.__scheduled.length !== 1) throw new Error('非控制器托管自己时应先调度1次,实际 '+window.__scheduled.length);
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    currentG = g; // 回调读 currentG(render.js 快照),手动触发定时器回调
    await window.__scheduled[0]();
    restoreSetTimeout();
    if(window.__doDrawCalled !== 1)
      throw new Error('非控制器+托管自己时回调应放行并执行draw决策,实际调用 '+window.__doDrawCalled+' 次(第二道门拦截了)');
  });
  await check('scheduleBotTurn入口门: 非控制器浏览器轮到别的bot座位时不调度(return)', function(){
    var g = mkNonControllerG(1, 'play'); // 轮到别的 bot 座位1,托管座位是0
    aiTestAutopilot = {active:true, seat:0};
    captureSetTimeout();
    scheduleBotTurn(g);
    var scheduled = window.__scheduled.length;
    restoreSetTimeout();
    if(scheduled !== 0)
      throw new Error('非控制器浏览器轮到别的bot座位时不应调度,实际调度 '+scheduled+' 次(入口门未限定托管座位)');
  });

  // ============ Task4: toggleAiTestAutopilot 开关 + 信息窗渲染(5 项) ============
  // mock showAiKeyModal:和 callAI 一样是函数声明绑定,直接整体替换成"记录已弹窗"的桩。
  showAiKeyModal = function(){ globalThis.__aiKeyModalShown = true; };

  await check('toggleAiTestAutopilot: 无密钥不开启且弹配置框', function(){
    aiApiKey = ''; aiProvider = 'openrouter';
    aiTestAutopilot = {active:false, seat:null, records:[]};
    globalThis.__aiKeyModalShown = false;
    toggleAiTestAutopilot();
    if(aiTestAutopilot.active) throw new Error('无密钥不应开启托管');
    if(!globalThis.__aiKeyModalShown) throw new Error('应弹AI密钥配置');
  });
  await check('toggleAiTestAutopilot: 有密钥开启托管', function(){
    aiApiKey = 'sk-or-test'; aiProvider = 'openrouter';
    aiTestAutopilot = {active:false, seat:null, records:[]};
    toggleAiTestAutopilot();
    if(!aiTestAutopilot.active) throw new Error('有密钥应开启');
    if(aiTestAutopilot.seat!==0) throw new Error('seat应为mySeat(0),实际 '+aiTestAutopilot.seat);
  });
  await check('toggleAiTestAutopilot: 再次点击关闭托管', function(){
    aiTestAutopilot = {active:true, seat:0, records:[]};
    toggleAiTestAutopilot();
    if(aiTestAutopilot.active) throw new Error('再次点击应关闭');
  });
  await check('appendAiTestRecord: 追加后records增长且摘要含决策文本', function(){
    aiTestAutopilot = {active:true, seat:0, records:[]};
    appendAiTestRecord({time:'12:00:00', phaseLabel:'出牌阶段', summary:'选择【杀】攻击座位2',
      stateInfo:'{"seat":0}', prompt:'', rawResponse:'{"choice":0}', choice:0, reason:'测试'});
    if(aiTestAutopilot.records.length!==1) throw new Error('应追加1条,实际 '+aiTestAutopilot.records.length);
    if(aiTestAutopilot.records[0].summary.indexOf('选择【杀】')<0) throw new Error('摘要应含决策文本');
  });
  await check('toggleAiTestRecord: 折叠切换hidden类(无DOM不抛错)', function(){
    toggleAiTestRecord(0);
  });

  // ============ Task6: 越界/边界 —— 托管座位阵亡时决策不触发(1 项) ============
  // 托管座位阵亡后 runBotDecision 首行守卫(!p.alive && phase!=='pickingGeneral')
  // 直接 return:不执行任何决策分支(doDraw 不被调用)、不追加 record。若守卫缺失,
  // isAutopilot 放行后 draw 分支会调用 doDraw 并采集 record —— 该断言必红。
  await check('越界/边界: 托管座位阵亡时runBotDecision首行return(不决策/不采集)', async function(){
    var g = mkSeatG({n:3});
    g.phase='draw'; g.turn=0;
    g.players[0].isBot=false; g.players[0].alive=false; // 托管座位已阵亡
    aiTestAutopilot = {active:true, seat:0, records:[]};
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    await runBotDecision(g, 0);
    if(window.__doDrawCalled !== 0)
      throw new Error('阵亡托管座位不应执行draw分支,实际调用 '+window.__doDrawCalled+' 次(首行守卫缺失)');
    if(aiTestAutopilot.records.length !== 0)
      throw new Error('阵亡座位不应追加record,实际 '+aiTestAutopilot.records.length+' 条');
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

context.__testDone = false;
context.__testFail = false;
vm.runInContext(testCode, sandbox, { filename: 'test-inline.js' });

function waitDone(){
  if (context.__testDone) {
    process.exit(context.__testFail ? 1 : 0);
  } else {
    setTimeout(waitDone, 20);
  }
}
waitDone();
