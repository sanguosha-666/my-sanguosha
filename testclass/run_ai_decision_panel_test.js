/**
 * CORE-73 / CORE-74:AI 决策记录统一采集 + 决策面板 测试套件。
 *
 * 【锁定什么】
 *  改动前:AI 决策的来源数据(理由/prompt/原始返回)只在托管命中(autopilotHit)时才采集,
 *  且只存进 aiTestAutopilot.records 这个托管作用域的数组——正常对局里各机器人座位的 AI
 *  决策完全没有可视化入口。改动后:采集下沉到 callAiChooseIndex(全部 AI 决策路径的唯一
 *  收敛点),统一存进 aiDecisionRecords,记录带 seat/general/model/isAutopilot,由两个窗口
 *  按各自语义渲染(托管信息窗只看 isAutopilot,决策面板看全部)。
 *
 * 【这些断言在改动前必红(逐条确认过)】
 *  - "非托管机器人决策产生记录":改动前 aiDecisionRecords 这个标识符根本不存在
 *    (ReferenceError),采集也只在 isAutopilot 分支 → 必红。
 *  - "记录含 general/model":改动前记录 schema 里就没有这两个字段(见 CORE-73/74 正文
 *    列出的字段清单)→ 必红。
 *  - "非托管 systemPrompt 也要求附理由":改动前非托管走默认模板(含"不要解释")→ 必红。
 *  - "AI 调用失败的记录也回填失败原因":改动前失败路径直接 return null,不碰记录 → 必红。
 *  - "托管信息窗视图过滤掉非托管记录":改动前没有过滤这回事(两类记录不共存)→ 必红。
 *
 * 沙箱惯例与 run_ai_test_button_test.js 完全一致(同一套 firebase/document/window stub)。
 */
const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: {
    transaction: function(fn) { return fn(context.g || {}); }
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
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-ai-decision-panel-sandbox' });

console.log('Loading CORE-73/74 AI决策面板测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
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
console.log('  OK 全部源文件加载完成');

console.log('\n' + '='.repeat(60));
console.log('  CORE-73/74:AI决策统一采集 + 决策面板');
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

  window.__mockAiArgs = null;
  window.__mockAiOk = true;
  callAI = async function(provider, apiKey, opts){
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    if(!window.__mockAiOk) return { ok:false, reason:'timeout', detail:'mock超时' };
    return { ok: true, text: '{"choice":1,"reason":"血量最低,优先集火"}' };
  };

  // 座位0 = 刘备(有武将,验证 general 采集);非机器人托管场景下 aiTestAutopilot 关闭。
  function mkG(){
    return { phase:'play', turn:0, roundNum:1, players: [
      { name:'机器人0', general:'liubei', isBot:true, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[] },
      { name:'玩家1', general:'caocao', isBot:false, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[] },
      { name:'玩家2', general:'zhangfei', isBot:true, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[] }
    ], log:[], pending:null, discard:[], deck:[] };
  }
  var CANDS = [{index:0,label:'候选甲'},{index:1,label:'候选乙'}];

  // provider 用非轮换的 claude + 手动单选模型,resolveAiModel 会原样返回它——
  // 这样"记录里的模型名"有一个确定的期望值可断言,不是自我印证的重言式。
  aiProvider = 'claude';
  aiApiModel = 'claude-test-model-x';
  aiApiKey = 'test-key';

  // ============ 1. 非托管(普通机器人)决策:统一存储里应有完整记录 ============
  await check('非托管机器人AI决策产生记录(改动前只有托管才采集)', async function(){
    aiTestAutopilot = { active:false, seat:null };
    aiDecisionRecords = [];
    var g = mkG();
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:CANDS });
    if(idx!==1) throw new Error('AI选择应为1,实际 '+idx);
    if(aiDecisionRecords.length!==1) throw new Error('应产生1条记录,实际 '+aiDecisionRecords.length);
    var rec = aiDecisionRecords[0];
    if(rec.isAutopilot!==false) throw new Error('非托管记录 isAutopilot 应为 false,实际 '+rec.isAutopilot);
    if(rec.seat!==0) throw new Error('seat 应为0,实际 '+rec.seat);
  });

  await check('记录采集到理由(非托管路径也解析reason)', function(){
    var rec = aiDecisionRecords[0];
    if(rec.reason!=='血量最低,优先集火') throw new Error('reason应为AI返回的理由,实际 '+JSON.stringify(rec.reason));
  });

  await check('记录采集到武将名(CORE-73:general字段)', function(){
    var rec = aiDecisionRecords[0];
    if(rec.general!=='刘备') throw new Error('general应为武将中文名"刘备",实际 '+JSON.stringify(rec.general));
  });

  await check('记录采集到本次实际使用的模型名(CORE-74:model字段)', function(){
    var rec = aiDecisionRecords[0];
    if(rec.model!=='claude-test-model-x')
      throw new Error('model应为本次实发模型,实际 '+JSON.stringify(rec.model));
    if(!window.__mockAiArgs || window.__mockAiArgs.opts.model!=='claude-test-model-x')
      throw new Error('实发模型与记录不一致:实发 '+JSON.stringify(window.__mockAiArgs && window.__mockAiArgs.opts.model));
  });

  await check('记录采集到choice与AI原始返回', function(){
    var rec = aiDecisionRecords[0];
    if(rec.choice!==1) throw new Error('choice应为1,实际 '+rec.choice);
    if(String(rec.rawResponse).indexOf('血量最低')<0) throw new Error('rawResponse应为AI原文,实际 '+rec.rawResponse);
    if(!rec.prompt) throw new Error('prompt应被记录');
  });

  // ============ 2. 非托管 prompt 也要求附理由 ============
  await check('非托管 systemPrompt 要求附理由且不含托管标记', function(){
    var sp = window.__mockAiArgs.opts.systemPrompt;
    if(sp.indexOf('不要解释')>=0) throw new Error('不应残留"不要解释"(与附理由冲突)');
    if(sp.indexOf('reason')<0) throw new Error('应含附理由格式指令');
    if(sp.indexOf('本次为AI托管')>=0) throw new Error('非托管不应含托管标记');
  });

  await check('理由指令下 maxTokens 抬到160下限(防JSON被截断)', function(){
    if(window.__mockAiArgs.opts.maxTokens < 160)
      throw new Error('maxTokens应≥160,实际 '+window.__mockAiArgs.opts.maxTokens);
  });

  // ============ 3. 托管决策与非托管决策共存于统一存储,两窗各自过滤 ============
  await check('托管决策记录 isAutopilot=true,与机器人记录同存一个数组', async function(){
    aiTestAutopilot = { active:true, seat:0 };
    var g = mkG();
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:CANDS });
    if(idx!==1) throw new Error('应返回1');
    if(aiDecisionRecords.length!==2) throw new Error('应累计2条,实际 '+aiDecisionRecords.length);
    if(aiDecisionRecords[1].isAutopilot!==true) throw new Error('托管记录 isAutopilot 应为 true');
    if(window.__mockAiArgs.opts.systemPrompt.indexOf('本次为AI托管')<0)
      throw new Error('托管路径 systemPrompt 仍应含托管标记');
  });

  await check('托管信息窗视图只显示托管记录,决策面板视图显示全部', function(){
    var testView = AI_RECORD_VIEWS[0], panelView = AI_RECORD_VIEWS[1];
    if(testView.autopilotOnly!==true || panelView.autopilotOnly!==false)
      throw new Error('两个视图的过滤口径配置反了');
    var inTest = aiRecordViewList(testView), inPanel = aiRecordViewList(panelView);
    if(inTest.length!==1) throw new Error('托管信息窗应只见1条(托管那条),实际 '+inTest.length);
    if(inTest[0][1]!==1) throw new Error('过滤后仍应带统一下标1(不是过滤后的位置0),实际 '+inTest[0][1]);
    if(inPanel.length!==2) throw new Error('决策面板应见全部2条,实际 '+inPanel.length);
  });

  // ============ 4. 面板 HTML 真的把理由/武将/模型渲染出来 ============
  await check('recordHtml/recordDetailHtml 渲染出理由、武将名、模型名', function(){
    var html = recordHtml(aiDecisionRecords[0], 0);
    if(html.indexOf('血量最低')<0) throw new Error('详情应含理由');
    if(html.indexOf('刘备')<0) throw new Error('应含武将名');
    if(html.indexOf('claude-test-model-x')<0) throw new Error('应含模型名');
    if(html.indexOf('data-idx="0"')<0) throw new Error('应带统一下标 data-idx');
  });

  // ============ 5. AI 调用失败:记录仍要回填失败原因,不留空壳 ============
  await check('AI调用失败的记录回填失败说明(不是空壳)', async function(){
    aiTestAutopilot = { active:false, seat:null };
    aiDecisionRecords = [];
    window.__mockAiOk = false;
    var g = mkG();
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:CANDS });
    window.__mockAiOk = true;
    if(idx!==null) throw new Error('调用失败应返回null(回退本地兜底),实际 '+idx);
    if(aiDecisionRecords.length!==1) throw new Error('失败也应留一条记录,实际 '+aiDecisionRecords.length);
    var rec = aiDecisionRecords[0];
    if(String(rec.rawResponse).indexOf('AI调用失败')<0)
      throw new Error('失败记录应写明失败原因,实际 '+JSON.stringify(rec.rawResponse));
    if(rec.model!=='claude-test-model-x') throw new Error('失败记录也应记下尝试过的模型,实际 '+rec.model);
  });

  // ============ 6. 未配置密钥:不产生任何记录 ============
  await check('未配置AI密钥时不产生记录(验收标准)', async function(){
    aiDecisionRecords = [];
    var savedKey = aiApiKey;
    aiApiKey = '';
    var g = mkG();
    var idx = await callAiChooseIndex({ g:g, seat:0, candidates:CANDS });
    aiApiKey = savedKey;
    if(idx!==null) throw new Error('无密钥应直接返回null,实际 '+idx);
    if(aiDecisionRecords.length!==0) throw new Error('无密钥不应产生记录,实际 '+aiDecisionRecords.length);
  });

  // ============ 7. 清空/游戏结束清空统一存储 ============
  await check('clearAiTestRecords 清空统一存储', function(){
    aiDecisionRecords = [{summary:'x',isAutopilot:false}];
    clearAiTestRecords();
    if(aiDecisionRecords.length!==0) throw new Error('应清空,实际 '+aiDecisionRecords.length);
  });

  // ============ 8. 面板开关函数存在且不抛错 ============
  await check('openAiPanelModal/closeAiPanelModal 存在且不抛错', function(){
    if(typeof openAiPanelModal!=='function') throw new Error('openAiPanelModal 应存在');
    if(typeof closeAiPanelModal!=='function') throw new Error('closeAiPanelModal 应存在');
    openAiPanelModal();
    closeAiPanelModal();
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

vm.runInContext('var __testDone=false, __testFail=false;', sandbox);
vm.runInContext(testCode, sandbox, { filename: 'ai-decision-panel-test' });

(function waitDone(){
  if (vm.runInContext('__testDone', sandbox)) {
    process.exit(vm.runInContext('__testFail', sandbox) ? 1 : 0);
  }
  setTimeout(waitDone, 20);
})();
