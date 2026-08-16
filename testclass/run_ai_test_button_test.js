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
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, querySelector: function() { return null; }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {}, insertAdjacentHTML: function() {} }; },
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
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
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
  aiTestAutopilot = { active: false, seat: null }; aiDecisionRecords = [];

  await check('callAiChooseIndex: 托管命中时返回idx且aiTestLastReason被设置', async function(){
    aiTestAutopilot = {active:true, seat:0};
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!=='测试理由') throw new Error('应采集理由,实际 '+aiTestLastReason);
    // 【choice 采集修复】托管命中时 aiTestLastChoice 应同步记录解析出的下标(供信息窗
    // "解析choice"字段展示真实AI选择,而非恒为"(无动作/本地兜底)"占位)。
    if(aiTestLastChoice!==1) throw new Error('应采集choice=1,实际 '+aiTestLastChoice);
    // 【prompt 分离】托管命中时 systemPrompt 应含托管标记(本次为AI托管),且不再有
    // "不要解释"——两条互相矛盾的指令("只输出{choice}不要解释" vs "附理由")是 AI
    // 只回 choice 不回 reason 的根因,托管专用模板必须消除它(buildAutopilotSystemPrompt)。
    if(!window.__mockAiArgs || window.__mockAiArgs.opts.systemPrompt.indexOf('本次为AI托管') < 0)
      throw new Error('托管命中时 systemPrompt 应含托管标记,实际 '+JSON.stringify(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt));
    if(window.__mockAiArgs.opts.systemPrompt.indexOf('不要解释') >= 0)
      throw new Error('托管命中时 systemPrompt 不应含"不要解释"(与附理由冲突),实际 '+JSON.stringify(window.__mockAiArgs.opts.systemPrompt));
  });
  await check('callAiChooseIndex: 未托管时reason保持null(零变化)', async function(){
    aiTestAutopilot = {active:false, seat:0};
    aiTestLastReason = '旧值';
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(aiTestLastReason!==null) throw new Error('未托管不应采集理由,实际 '+aiTestLastReason);
    // 未托管时 systemPrompt 应保持默认模板一字不变:含"不要解释"、不含托管标记(零变化)
    if(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt.indexOf('本次为AI托管') >= 0)
      throw new Error('未托管时 systemPrompt 不应含托管标记,实际 '+JSON.stringify(window.__mockAiArgs.opts.systemPrompt));
    // 【CORE-73 语义变更,原断言已作废】此处原本断言"未托管 systemPrompt 保持默认(含
    // 不要解释)"——那条命题在 CORE-73 之后不再成立:决策面板要展示每台 AI(含非托管
    // 机器人)的中文理由,而理由只有 prompt 明确要求时模型才会给,所以"附理由"的格式
    // 指令现在对全部决策生效,与之矛盾的"不要解释"必须同时从两条路径去掉。托管与否的
    // 区分改由"(本次为AI托管)"标记承担(上一条断言),不再靠"要不要理由"区分。
    if(!window.__mockAiArgs || window.__mockAiArgs.opts.systemPrompt.indexOf('不要解释') >= 0)
      throw new Error('未托管时 systemPrompt 不应残留"不要解释"(与附理由指令冲突),实际 '+JSON.stringify(window.__mockAiArgs && window.__mockAiArgs.opts.systemPrompt));
    if(window.__mockAiArgs.opts.systemPrompt.indexOf('reason') < 0)
      throw new Error('未托管时 systemPrompt 也应含附理由格式指令(CORE-73),实际 '+JSON.stringify(window.__mockAiArgs.opts.systemPrompt));
  });
  await check('callAiChooseIndex: 托管时user prompt末尾"只返回{choice}"替换为理由格式(分离)', async function(){
    aiTestAutopilot = {active:true, seat:0};
    var up0 = '当前局面:{}\n\n合法候选:[]\n\n只返回 {"choice":数字}';
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}], userPrompt:up0});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(!window.__mockAiArgs) throw new Error('应捕获实际发送参数');
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('只返回 {"choice":数字}') >= 0)
      throw new Error('托管时 user prompt 不应残留"只返回 {choice}"(与附理由冲突),实际 '+up);
    if(up.indexOf('请按格式返回 {"choice":数字,"reason":"理由文本"}') < 0)
      throw new Error('托管时 user prompt 末尾应为理由格式指令,实际 '+up);
  });

  // ================= Task5:aiTestLastCall 采集(2 项) =================
  await check('callAiChooseIndex: 托管命中时aiTestLastCall被设置(含prompt与rawResponse)', async function(){
    aiTestAutopilot = {active:true, seat:0};
    aiTestLastCall = null;
    var i = await callAiChooseIndex({g:g, seat:0, candidates:[{index:0,label:'a'},{index:1,label:'b'}]});
    if(i!==1) throw new Error('应返回1,实际 '+i);
    if(!aiTestLastCall) throw new Error('托管命中应设置aiTestLastCall,实际 null');
    if(typeof aiTestLastCall.prompt!=='string' || aiTestLastCall.prompt.indexOf('本次为AI托管')<0)
      throw new Error('prompt应含托管标记,实际 '+JSON.stringify(aiTestLastCall.prompt));
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

  // ================= Task5:决策记录采集(2 项,2026-08-09 适配"骨架+回填"设计) =================
  // 【设计变更】原实现:hook 在决策分支执行前读 aiTestLastCall/aiTestLastReason(上一条 AI
  // 调用的缓存),导致多条记录重复显示上一条内容(draw 等确定性决策不调 AI 也贴了 wuxie 的
  // prompt/AI返回)。改后:hook 只建骨架记录(prompt/rawResponse 空、choice/reason null),
  // 由 callAiChooseIndex 解析完成后经 aiTestFillPendingRecord 回填本次真实数据。
  await check('aiTestDecisionHook: 只建骨架记录(不读上一条缓存),aiTestFillPendingRecord回填真实数据', function(){
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [];
    aiTestLastReason = '旧理由'; // 模拟上一条决策残留缓存,骨架记录不应读到它
    var g2 = mkSeatG({n:3});
    g2.phase='duel';
    aiTestDecisionHook(g2, 0, {summary:'决策(duel)'});
    if(aiDecisionRecords.length!==1) throw new Error('应追加1条,实际 '+aiDecisionRecords.length);
    var rec = aiDecisionRecords[0];
    if(rec.phaseLabel!=='duel') throw new Error('phaseLabel应为原始phase字符串,实际 '+rec.phaseLabel);
    if(typeof rec.stateInfo!=='string' || !rec.stateInfo) throw new Error('stateInfo应非空字符串');
    if(rec.summary!=='决策(duel)') throw new Error('summary应透传,实际 '+rec.summary);
    // 骨架记录:prompt/rawResponse 应为空、choice 应为 null——绝不读上一条缓存
    if(rec.prompt!=='' || rec.rawResponse!=='') throw new Error('骨架记录prompt/rawResponse应为空(不读旧缓存)');
    if(rec.choice!==null) throw new Error('骨架记录choice应为null,实际 '+rec.choice);
    if(rec.reason!==null) throw new Error('骨架记录reason应为null(不回退旧aiTestLastReason),实际 '+rec.reason);
    // 回填:模拟 callAiChooseIndex 解析完成后调用,真实数据应写入同一条记录
    aiTestFillPendingRecord({prompt:'p1', rawResponse:'r1', choice:1, reason:'新理由'});
    if(aiDecisionRecords.length!==1) throw new Error('回填不应新增记录,实际 '+aiDecisionRecords.length);
    rec = aiDecisionRecords[0];
    if(rec.prompt!=='p1' || rec.rawResponse!=='r1') throw new Error('回填后prompt/rawResponse应为本次数据');
    if(rec.choice!==1) throw new Error('回填后choice应为1,实际 '+rec.choice);
    if(rec.reason!=='新理由') throw new Error('回填后reason应为本次理由,实际 '+rec.reason);
    if(aiTestPendingRecord!==null) throw new Error('回填后aiTestPendingRecord应置null防残留');
  });
  // 【CORE-73 语义变更】原断言是"托管决策后 records 必增长(哪怕是 draw 这种不调 AI 的
  // 确定性决策也建一条空骨架)"。采集下沉到 callAiChooseIndex 之后这条命题不再成立,也
  // 不该成立:不调 AI 的决策没有 prompt/理由/模型可记,改动前那种"字段全空的空壳记录"
  // 只是噪音。新命题:确定性决策不产生记录,但决策本身照常执行。
  await check('runBotDecision: 确定性决策(draw,不调AI)不产生记录,但决策照常执行', async function(){
    var g3 = mkSeatG({n:3});
    g3.phase='draw'; g3.turn=0;
    g3.players[0].isBot=false;
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [];
    aiTestLastCall = { prompt: '旧缓存prompt', rawResponse: '旧缓存raw' }; // 模拟上一条残留
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    await runBotDecision(g3, 0);
    if(aiDecisionRecords.length !== 0)
      throw new Error('不调AI的确定性决策不应产生记录,实际 '+aiDecisionRecords.length+' 条');
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

  // ============ Task4:弹窗入口 + 明确开始/结束按钮 + 记录生命周期 ============
  // mock showAiKeyModal:和 callAI 一样是函数声明绑定,直接整体替换成"记录已弹窗"的桩。
  showAiKeyModal = function(){ globalThis.__aiKeyModalShown = true; };

  await check('顶部AI按钮只打开弹窗,不改变托管状态或清空记录', function(){
    aiTestAutopilot = {active:false, seat:null}; aiDecisionRecords = [{summary:'保留',isAutopilot:true}];
    toggleAiTestAutopilot();
    if(aiTestAutopilot.active) throw new Error('打开弹窗不应开始托管');
    if(aiDecisionRecords.length!==1) throw new Error('打开弹窗不应清空记录');
  });
  await check('startAiTestAutopilot:无密钥不开启且弹配置框', function(){
    aiApiKey = ''; aiProvider = 'openrouter';
    aiTestAutopilot = {active:false, seat:null}; aiDecisionRecords = [];
    globalThis.__aiKeyModalShown = false;
    startAiTestAutopilot();
    if(aiTestAutopilot.active) throw new Error('无密钥不应开启托管');
    if(!globalThis.__aiKeyModalShown) throw new Error('应弹AI密钥配置');
  });
  await check('startAiTestAutopilot:有密钥开启且保留已有记录', function(){
    aiApiKey = 'sk-or-test'; aiProvider = 'openrouter';
    _g = {players:[{cid:myClientId, aiAutopilot:false}]};
    aiTestAutopilot = {active:false, seat:null}; aiDecisionRecords = [{summary:'保留',isAutopilot:true}];
    startAiTestAutopilot();
    if(!aiTestAutopilot.active) throw new Error('有密钥应开启');
    if(aiTestAutopilot.seat!==0) throw new Error('seat应为mySeat(0),实际 '+aiTestAutopilot.seat);
    if(aiDecisionRecords.length!==1) throw new Error('开始托管不应清空记录');
    if(!_g.players[0].aiAutopilot) throw new Error('开始托管应把公开标识同步到自己的玩家状态');
  });
  await check('stopAiTestAutopilot:结束托管但保留已有记录', function(){
    _g = {players:[{cid:myClientId, aiAutopilot:true}]};
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [{summary:'保留',isAutopilot:true}];
    stopAiTestAutopilot();
    if(aiTestAutopilot.active) throw new Error('结束按钮应关闭托管');
    if(aiDecisionRecords.length!==1) throw new Error('结束托管不应清空记录');
    if(_g.players[0].aiAutopilot) throw new Error('结束托管应清除房间公开标识');
  });
  await check('清空按钮清空记录', function(){
    aiTestAutopilot = {active:false, seat:0}; aiDecisionRecords = [{summary:'a',isAutopilot:true}];
    clearAiTestRecords();
    if(aiDecisionRecords.length!==0) throw new Error('清空按钮应清空记录');
  });
  await check('CORE-83(issue #130): 游戏结束(phase=over)不再清空记录——结束后复盘/导出正是面板核心用途', function(){
    // 这条断言此前写的是"游戏结束应清空记录"——那正是issue #130报告的bug本身
    // (托管信息窗时代的旧语义,CORE-73/75把决策记录升级成"结束后复盘/导出数据源"之后
    // 没同步调整,导致结束后面板空白、导出dump的aiDecisions:[])。这里按修复后的正确
    // 行为重写:phase变成over不应该清空任何记录。
    aiTestLastObservedSeed = null; aiTestLastObservedPhase = null;
    aiTestAutopilot = {active:false, seat:0};
    aiDecisionRecords=[{summary:'b',isAutopilot:true}];
    syncAiTestGamePhase('play', 111);
    syncAiTestGamePhase('over', 111); // 同一局(seed未变)结束
    if(aiDecisionRecords.length!==1) throw new Error('游戏结束不应清空记录,实际 '+aiDecisionRecords.length);
  });
  await check('CORE-83(issue #130): 游戏结束时仍应自动停止托管(和记录清空解耦,这部分行为不变)', function(){
    aiTestLastObservedSeed = null; aiTestLastObservedPhase = null;
    _g = {players:[{cid:myClientId, aiAutopilot:true}]};
    aiTestAutopilot = {active:true, seat:0};
    aiDecisionRecords=[{summary:'c',isAutopilot:true}];
    syncAiTestGamePhase('play', 222);
    syncAiTestGamePhase('over', 222);
    if(aiTestAutopilot.active) throw new Error('游戏结束应仍然自动停止托管,实际仍在托管');
    if(aiDecisionRecords.length!==1) throw new Error('停止托管这个动作本身不应清空记录,实际 '+aiDecisionRecords.length);
  });
  await check('CORE-83(issue #130): 只有确认进入下一局(g.seed变化)才清空上一局的记录', function(){
    aiTestLastObservedSeed = null; aiTestLastObservedPhase = null;
    aiTestAutopilot = {active:false, seat:0};
    aiDecisionRecords = [{summary:'第一局的决策',isAutopilot:true}];
    syncAiTestGamePhase('play', 1001); // 观察到第一局(seed=1001),不应清空(本来就是新观察到的)
    if(aiDecisionRecords.length!==1) throw new Error('首次观察到某个seed不应清空,实际 '+aiDecisionRecords.length);
    syncAiTestGamePhase('over', 1001); // 第一局结束(seed未变)
    if(aiDecisionRecords.length!==1) throw new Error('结束不应清空,实际 '+aiDecisionRecords.length);
    syncAiTestGamePhase('play', 1002); // 再来一局:seed变成1002,这才是真正的"新一局开始"
    if(aiDecisionRecords.length!==0) throw new Error('确认进入新一局(seed变化)后应清空上一局记录,实际 '+aiDecisionRecords.length);
  });
  await check('CORE-83(issue #130): seed缺失(理论上不该发生)时不误清空,不报错', function(){
    aiTestLastObservedSeed = null; aiTestLastObservedPhase = null;
    aiTestAutopilot = {active:false, seat:0};
    aiDecisionRecords = [{summary:'x',isAutopilot:true}];
    syncAiTestGamePhase('lobby', undefined); // 大厅阶段g.seed还没生成
    if(aiDecisionRecords.length!==1) throw new Error('seed缺失时不应清空,实际 '+aiDecisionRecords.length);
  });
  await check('appendAiTestRecord: 追加后records增长且摘要含决策文本', function(){
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [];
    appendAiTestRecord({time:'12:00:00', phaseLabel:'出牌阶段', summary:'选择【杀】攻击座位2',
      stateInfo:'{"seat":0}', prompt:'', rawResponse:'{"choice":0}', choice:0, reason:'测试'});
    if(aiDecisionRecords.length!==1) throw new Error('应追加1条,实际 '+aiDecisionRecords.length);
    if(aiDecisionRecords[0].summary.indexOf('选择【杀】')<0) throw new Error('摘要应含决策文本');
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
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [];
    window.__doDrawCalled = 0;
    doDraw = function(){ window.__doDrawCalled++; };
    await runBotDecision(g, 0);
    if(window.__doDrawCalled !== 0)
      throw new Error('阵亡托管座位不应执行draw分支,实际调用 '+window.__doDrawCalled+' 次(首行守卫缺失)');
    if(aiDecisionRecords.length !== 0)
      throw new Error('阵亡座位不应追加record,实际 '+aiDecisionRecords.length+' 条');
  });

  // ============ Task7: 回归探针 —— 确定性决策(不调AI)骨架记录确实空(无理由) ============
  // 用户报告"都不返回决策理由了"。已确认两条独立原因:①单候选确定性路径(candidates.length
  // ===1 时 idx=0)绕过 callAiChooseIndex,骨架永不回填 → reason 恒 null(本条锁定该行为,
  // 是"符合预期"不是 bug);②多候选托管路径的 prompt 自相矛盾(默认模板"只输出{choice}不
  // 要解释"/user 末尾"只返回{choice}"压过托管附加的"附理由"指令)→ 已在 callAiChooseIndex
  // 托管分支用 buildAutopilotSystemPrompt/buildAutopilotUserPrompt 替换消除,由上面的
  // "prompt 分离"断言锁定。此探针把"确定性决策无理由"钉成既有行为,防止未来误当 bug。
  await check('回归探针:确定性决策(不调AI)骨架记录确实空(无理由)', function(){
    aiTestAutopilot = {active:true, seat:0}; aiDecisionRecords = [];
    var g4 = mkSeatG({n:3});
    g4.phase='draw';
    aiTestDecisionHook(g4, 0, {summary:'决策(draw)'});
    if(aiDecisionRecords.length!==1) throw new Error('应1条');
    var rec = aiDecisionRecords[0];
    if(rec.reason!==null) throw new Error('确定性决策应无理由,实际 '+rec.reason);
    if(rec.prompt!=='') throw new Error('确定性决策应无prompt');
    if(typeof rec.stateInfo!=='string' || !rec.stateInfo) throw new Error('stateInfo应非空');
    console.log('  探针:确定性决策骨架记录 reason=null(符合预期,但用户看到的是空理由)');
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
