/**
 * CORE-134: 本地兜底决策的可读留痕
 *
 * 覆盖:
 *  1. botDecide 走 localFallback 时留痕,且 choice 与改动前逐字一致(纯新增)
 *  2. localFallbackPlayWindow 的 out 参数只收集依据,不影响返回值;不传 out 零变化
 *  3. 留痕内容包含决策点/走本地的原因/候选数/选中项/依据
 *  4. 环形缓冲有上限,不会无限增长
 *  5. 无密钥时不产生 aiDecisionRecords(零DOM);有密钥走本地时补一条(异常信号)
 *  6. 不写 debugLogs
 *  7. 留痕内部抛异常不影响决策主流程
 *  8. 破坏性验证:断言有鉴别力
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: { log: console.log, warn: function(){}, error: function(){}, debug: function(){} },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  mySeat: 0, myClientId: 'test-client',
  distance: function(){ return 1; },
  attackRange: function(){ return 1; },
  nextAlive: function(g, from){ return ((from||0) + 1) % ((g.players||[]).length || 1); },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  document: {
    getElementById: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return true; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, remove: function(){},
      insertAdjacentHTML: function(){}, querySelector: function(){ return null; }
    }; },
    createElement: function(){ return {
      textContent: '', className: '', style: {},
      classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
      addEventListener: function(){}, appendChild: function(){ return {}; }, setAttribute: function(){}
    }; },
    addEventListener: function(){},
    body: { appendChild: function(){ return {}; } },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; }
  },
  window: { aiConversations: {}, addEventListener: function(){}, location: { search:'', href:'http://localhost', reload:function(){} } }
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core134-sandbox' });

console.log('Loading CORE-134 测试环境...\n');
['data.js', 'stages/stage-table.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'].forEach(function(file){
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    console.log('  OK ' + file);
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-134:本地兜底决策的可读留痕');
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

  function mkGame(){
    return {
      gameMode:'ffa', phase:'play', turn:0, roundNum:2, pending:null,
      deck:[], aiSuspicionEvents:[], log:[],
      players:[
        { name:'A', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:null, general:null },
        { name:'B', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:null, general:null }
      ]
    };
  }

  // ---------- 1. botDecide 留痕 + 决策结果零变化 ----------
  await check('botDecide 走 localFallback 时产生一条留痕', async function(){
    clearBotLocalDecisionLog();
    aiApiKey = ''; aiProvider = '';   // 无密钥 → 必走 localFallback
    var executed = null;
    BOT_DECISIONS.__t134 = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'选项甲'},{label:'选项乙'}]; },
      localFallback: function(g, seat, cands){ return cands[1]; },
      execute: function(g, seat, choice){ executed = choice; }
    };
    try{
      var handled = await botDecide('__t134', mkGame(), 0);
      if(!handled) throw new Error('botDecide 应返回 true');
      if(!executed || executed.label !== '选项乙') throw new Error('选择结果必须与改动前一致(仍是 localFallback 返回的那一项)');
      if(botLocalDecisionLog.length !== 1) throw new Error('应留痕 1 条,实际 ' + botLocalDecisionLog.length);
    } finally { delete BOT_DECISIONS.__t134; }
  });

  await check('留痕内容含决策点/走本地原因/候选数/选中项', function(){
    var t = botLocalDecisionLog[0].insight;
    if(t.indexOf('__t134') < 0) throw new Error('应含决策点 id,实际: ' + t);
    if(t.indexOf('未配置AI密钥') < 0) throw new Error('无密钥时应说明原因,实际: ' + t);
    if(t.indexOf('候选2个') < 0) throw new Error('应含候选数,实际: ' + t);
    if(t.indexOf('选项乙') < 0) throw new Error('应含选中项标签,实际: ' + t);
    if(botLocalDecisionLog[0].reason !== 'no_api_key') throw new Error('结构化 reason 应为 no_api_key');
  });

  await check('有密钥但 AI 不可用时,留痕原因是 ai_unavailable', async function(){
    clearBotLocalDecisionLog();
    aiApiKey = 'test-key'; aiProvider = 'claude';
    callAI = async function(){ return { ok:false, reason:'timeout', detail:'超时' }; };
    BOT_DECISIONS.__t134b = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'甲'},{label:'乙'}]; },
      localFallback: function(g, seat, cands){ return cands[0]; },
      execute: function(){}
    };
    try{
      await botDecide('__t134b', mkGame(), 0);
      if(botLocalDecisionLog.length !== 1) throw new Error('应留痕 1 条,实际 ' + botLocalDecisionLog.length);
      if(botLocalDecisionLog[0].reason !== 'ai_unavailable')
        throw new Error('应为 ai_unavailable,实际 ' + botLocalDecisionLog[0].reason);
      if(botLocalDecisionLog[0].insight.indexOf('AI决策不可用') < 0)
        throw new Error('文案应说明 AI 不可用,实际: ' + botLocalDecisionLog[0].insight);
    } finally { delete BOT_DECISIONS.__t134b; aiApiKey=''; aiProvider=''; }
  });

  await check('localFallback 返回 null(不发动)时也留痕,且仍然不执行 execute', async function(){
    clearBotLocalDecisionLog();
    aiApiKey=''; aiProvider='';
    var executed = false;
    BOT_DECISIONS.__t134c = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'甲'},{label:'乙'}]; },
      localFallback: function(){ return null; },
      execute: function(){ executed = true; }
    };
    try{
      var handled = await botDecide('__t134c', mkGame(), 0);
      if(!handled) throw new Error('应返回 true');
      if(executed) throw new Error('localFallback 返回 null 时不应执行 execute(既有行为)');
      if(botLocalDecisionLog.length !== 1) throw new Error('仍应留痕');
      if(botLocalDecisionLog[0].insight.indexOf('不发动') < 0)
        throw new Error('null 应渲染成"(不发动/无动作)",实际: ' + botLocalDecisionLog[0].insight);
    } finally { delete BOT_DECISIONS.__t134c; }
  });

  await check('AI 正常给出选择时不留痕(留痕只针对本地兜底路径)', async function(){
    clearBotLocalDecisionLog();
    aiApiKey='test-key'; aiProvider='claude';
    callAI = async function(){ return { ok:true, text:'{"choice":0}' }; };
    BOT_DECISIONS.__t134d = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'甲'},{label:'乙'}]; },
      localFallback: function(g,s,c){ return c[1]; },
      execute: function(){}
    };
    try{
      await botDecide('__t134d', mkGame(), 0);
      if(botLocalDecisionLog.length !== 0) throw new Error('AI 成功时不应留本地兜底痕迹,实际 ' + botLocalDecisionLog.length);
    } finally { delete BOT_DECISIONS.__t134d; aiApiKey=''; aiProvider=''; }
  });

  // ---------- 2. localFallbackPlayWindow 零变化 + 依据 ----------
  await check('localFallbackPlayWindow 不传 out → 返回值与改动前逐字一致', function(){
    var hi = { label:'出【杀】→B', action:'杀', localHeuristicScore:70 };
    var lo = { label:'出【酒】', action:'酒', localHeuristicScore:20 };
    var end = { label:'结束出牌阶段', isEndPlay:true };
    if(localFallbackPlayWindow({}, 0, [lo, hi, end]) !== hi) throw new Error('应选最高分且>25 的候选');
    if(localFallbackPlayWindow({}, 0, [lo, end]) !== end) throw new Error('最高分未过阈值应结束出牌');
    if(localFallbackPlayWindow({}, 0, [end]) !== end) throw new Error('只有结束候选时应返回它');
  });

  await check('传 out 时返回值完全不变,只是额外填 out.detail', function(){
    var hi = { label:'出【杀】→B', action:'杀', localHeuristicScore:70 };
    var end = { label:'结束出牌阶段', isEndPlay:true };
    var out = {};
    var withOut = localFallbackPlayWindow({}, 0, [hi, end], out);
    var without = localFallbackPlayWindow({}, 0, [hi, end]);
    if(withOut !== without) throw new Error('传不传 out 的返回值必须相同');
    if(!out.detail || out.detail.indexOf('70') < 0 || out.detail.indexOf('25') < 0)
      throw new Error('out.detail 应说明分数与阈值,实际: ' + out.detail);
  });

  await check('未过阈值时 out.detail 说明"未过阈值,结束出牌"', function(){
    var lo = { label:'出【酒】', localHeuristicScore:20 };
    var end = { label:'结束出牌阶段', isEndPlay:true };
    var out = {};
    localFallbackPlayWindow({}, 0, [lo, end], out);
    if(out.detail.indexOf('未过出牌阈值') < 0) throw new Error('实际: ' + out.detail);
  });

  await check('没有任何非结束候选时 out.detail 也有说明', function(){
    var end = { label:'结束出牌阶段', isEndPlay:true };
    var out = {};
    localFallbackPlayWindow({}, 0, [end], out);
    if(out.detail.indexOf('没有任何非结束候选') < 0) throw new Error('实际: ' + out.detail);
  });

  // ---------- 3. 候选标签渲染的形状退化 ----------
  await check('botLocalChoiceLabel 对不同形状的候选都能给出可读标签', function(){
    var g = mkGame();
    if(botLocalChoiceLabel(g, null).indexOf('不发动') < 0) throw new Error('null 应可读');
    if(botLocalChoiceLabel(g, { label:'出闪' }).indexOf('出闪') < 0) throw new Error('label 形状');
    if(botLocalChoiceLabel(g, { action:'杀' }).indexOf('杀') < 0) throw new Error('action 形状');
    if(botLocalChoiceLabel(g, { seat:1 }).indexOf('座位1') < 0) throw new Error('seat 形状(seatPick 候选)');
    var withScore = botLocalChoiceLabel(g, { label:'出【杀】', localHeuristicScore:70 });
    if(withScore.indexOf('本地分70') < 0) throw new Error('有分数时应带上,实际: ' + withScore);
  });

  // ---------- 4. 环形缓冲上限 ----------
  await check('留痕缓冲有上限 BOT_LOCAL_INSIGHT_MAX,不会无限增长', function(){
    clearBotLocalDecisionLog();
    aiApiKey=''; aiProvider='';
    var g = mkGame();
    for(var i=0;i<BOT_LOCAL_INSIGHT_MAX + 25; i++){
      recordBotLocalDecision(g, 0, { decisionId:'压测'+i, reason:'no_api_key', candidates:[], choice:null });
    }
    if(botLocalDecisionLog.length !== BOT_LOCAL_INSIGHT_MAX)
      throw new Error('应被截断到 ' + BOT_LOCAL_INSIGHT_MAX + ',实际 ' + botLocalDecisionLog.length);
    var last = botLocalDecisionLog[botLocalDecisionLog.length-1];
    if(last.decisionId !== '压测' + (BOT_LOCAL_INSIGHT_MAX + 24))
      throw new Error('应保留最新的那些,实际末条 ' + last.decisionId);
  });

  // ---------- 5. 分流:无密钥不碰决策面板,有密钥补一条 ----------
  await check('无密钥:不产生 aiDecisionRecords(零DOM操作)', function(){
    clearBotLocalDecisionLog(); clearAiTestRecords();
    aiApiKey=''; aiProvider='';
    recordBotLocalDecision(mkGame(), 0, { decisionId:'x', reason:'no_api_key', candidates:[], choice:null });
    if(aiDecisionRecords.length !== 0) throw new Error('无密钥不应写决策面板,实际 ' + aiDecisionRecords.length);
    if(botLocalDecisionLog.length !== 1) throw new Error('环形缓冲仍应有 1 条');
  });

  await check('有密钥却走本地:补一条决策面板记录,model 标为"本地兜底"', function(){
    clearBotLocalDecisionLog(); clearAiTestRecords();
    aiApiKey='test-key'; aiProvider='claude';
    recordBotLocalDecision(mkGame(), 0, { decisionId:'y', reason:'ai_unavailable', candidates:[{label:'甲'}], choice:{label:'甲'} });
    if(aiDecisionRecords.length !== 1) throw new Error('应补 1 条决策面板记录,实际 ' + aiDecisionRecords.length);
    var rec = aiDecisionRecords[0];
    if(rec.model !== '本地兜底') throw new Error('model 应标为"本地兜底",实际 ' + rec.model);
    if(String(rec.summary).indexOf('本地兜底') < 0) throw new Error('summary 应可辨识,实际 ' + rec.summary);
    if(String(rec.reason).indexOf('AI决策不可用') < 0) throw new Error('reason 应带完整 insight,实际 ' + rec.reason);
    aiApiKey=''; aiProvider='';
  });

  // ---------- 6. 不写 debugLogs ----------
  await check('留痕不写 debugLogs(debugLogs 只记异常这条纪律不被破坏)', function(){
    clearBotLocalDecisionLog();
    var written = [];
    var origWrite = (typeof writeDebugLog==='function') ? writeDebugLog : null;
    writeDebugLog = function(room, kind, payload){ written.push(kind); };
    try{
      aiApiKey=''; aiProvider='';
      recordBotLocalDecision(mkGame(), 0, { decisionId:'z', reason:'no_api_key', candidates:[], choice:null });
      if(written.length !== 0) throw new Error('不应写 debugLogs,实际写了: ' + written.join(','));
    } finally { if(origWrite) writeDebugLog = origWrite; }
  });

  // ---------- 7. 留痕出错不影响主流程 ----------
  await check('留痕内部抛异常时被吞掉,不影响决策主流程', async function(){
    clearBotLocalDecisionLog();
    aiApiKey=''; aiProvider='';
    var executed = null;
    var origLabel = botLocalChoiceLabel;
    botLocalChoiceLabel = function(){ throw new Error('故意炸'); };
    BOT_DECISIONS.__t134e = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'甲'},{label:'乙'}]; },
      localFallback: function(g,s,c){ return c[0]; },
      execute: function(g,s,choice){ executed = choice; }
    };
    try{
      var handled = await botDecide('__t134e', mkGame(), 0);
      if(!handled) throw new Error('留痕炸了也应正常返回 true');
      if(!executed || executed.label !== '甲') throw new Error('留痕炸了也应正常执行决策');
    } finally { botLocalChoiceLabel = origLabel; delete BOT_DECISIONS.__t134e; }
  });

  // ---------- 8. 破坏性验证 ----------
  await check('破坏性验证:把 recordBotLocalDecision 换成空函数,留痕断言确实会红', async function(){
    clearBotLocalDecisionLog();
    aiApiKey=''; aiProvider='';
    var orig = recordBotLocalDecision;
    recordBotLocalDecision = function(){};
    BOT_DECISIONS.__t134f = {
      match: function(){ return true; },
      buildCandidates: function(){ return [{label:'甲'},{label:'乙'}]; },
      localFallback: function(g,s,c){ return c[0]; },
      execute: function(){}
    };
    try{
      await botDecide('__t134f', mkGame(), 0);
      if(botLocalDecisionLog.length !== 0)
        throw new Error('破坏后仍留痕,说明断言没有鉴别力');
    } finally { recordBotLocalDecision = orig; delete BOT_DECISIONS.__t134f; }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0){ throw new Error('CORE-134 测试有 ' + fail + ' 条失败'); }
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'core134-test.js' })
  .catch(function(e){ console.error('\n' + (e && e.message || e)); process.exit(1); });
