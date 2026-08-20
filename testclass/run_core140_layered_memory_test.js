/**
 * CORE-140: aiSummary 分层记忆(tactical / doctrine + 确定性合并)
 *
 * 【本文件的职责边界】既有的 run_ai_summary_test.js(16条)的 mock 全部返回**纯文本**,
 * 因此它们走的是**解析失败回退路径**——它们零改动通过只能证明"回退路径与改动前一致",
 * **不能**算作新的两层逻辑被验证过。新逻辑必须由本文件独立覆盖。
 *
 * 覆盖:
 *  1. 纯函数 mergeAiDoctrine:新信息前置 / 尾部裁剪 / 空更新短路
 *  2. 改进①相邻去重(外部项目 doctrine 层没做这个)
 *  3. 改进②「无更新」同义集合(不依赖单一魔法串"不变")
 *  4. parseAiSummaryLayers:合法JSON / 代码块包裹 / 混合文本 / 无关JSON / 非法 → null
 *  5. composeAiSummary:doctrine 为空时不加标签(与改动前逐字相同)
 *  6. 端到端两层:updateAiSummary 收到两层 JSON → 两层各自正确更新
 *  7. 【不变量】解析失败 → 逐字走改动前的回退路径(含 500 字截断),实测验证不假设
 *  8. 上限:tactical≤80 / doctrine≤120,合计与改动前 200 字持平
 *  9. 分仓:两层随 cid 切换,互不污染
 * 10. aiSummaryReset 清空两层
 * 11. 破坏性验证:断言有鉴别力
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: console, Math: Math, JSON: JSON,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  mySeat: 0, myClientId: 'test-client',
  distance: function(){ return 1; }, attackRange: function(){ return 1; },
  nextAlive: function(g, from){ return ((from||0)+1) % ((g.players||[]).length||1); },
  sessionStorage: { _d:{}, getItem:function(){return null;}, setItem:function(){}, removeItem:function(){} },
  document: {
    getElementById: function(){ return { textContent:'', className:'', style:{}, innerHTML:'',
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      addEventListener:function(){}, appendChild:function(){return {};}, remove:function(){},
      insertAdjacentHTML:function(){}, querySelector:function(){return null;} }; },
    createElement: function(){ return { style:{}, textContent:'', className:'',
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      appendChild:function(){return {};}, setAttribute:function(){}, addEventListener:function(){} }; },
    addEventListener: function(){}, body:{ appendChild:function(){return {};} },
    querySelector:function(){return null;}, querySelectorAll:function(){return [];}
  },
  window: { aiConversations:{}, addEventListener:function(){},
    location:{search:'',href:'http://localhost',reload:function(){}} }
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core140-sandbox' });

console.log('Loading CORE-140 测试环境...\n');
['data.js','stages/stage-table.js','ai-bot.js','bot-ai-bus.js','bot.js'].forEach(function(file){
  try{ vm.runInContext(fs.readFileSync(file,'utf8'), sandbox, { filename:file }); console.log('  OK '+file); }
  catch(e){ console.log('  FAIL '+file+': '+e.message);
    if(e.stack) console.log('     '+e.stack.split('\n').slice(1,3).join('\n     ')); process.exit(1); }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-140:分层记忆(tactical / doctrine)');
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

  // ---------- 1. mergeAiDoctrine 基本行为 ----------
  await check('merge:旧为空 → 直接取新', function(){
    if(mergeAiDoctrine('', '座位2打过主公') !== '座位2打过主公') throw new Error('实际 ' + mergeAiDoctrine('','座位2打过主公'));
  });

  await check('merge:新信息前置,旧信息在后(最新结论永不被裁剪)', function(){
    var r = mergeAiDoctrine('旧认知A', '新认知B');
    if(r !== '新认知B；旧认知A') throw new Error('实际 ' + r);
    if(r.indexOf('新认知B') !== 0) throw new Error('新信息必须在最前');
  });

  await check('merge:超上限时从尾部裁剪(旧认知先被挤掉,新的完整保留)', function(){
    var old = '旧'.repeat(AI_DOCTRINE_MAX);
    var r = mergeAiDoctrine(old, '关键新结论');
    if(r.length !== AI_DOCTRINE_MAX) throw new Error('应截断到 ' + AI_DOCTRINE_MAX + ',实际 ' + r.length);
    if(r.indexOf('关键新结论') !== 0) throw new Error('新结论必须完整保留在最前,实际开头: ' + r.slice(0,10));
  });

  await check('merge:旧认知本身超长时也会被截断到上限', function(){
    var r = mergeAiDoctrine('旧'.repeat(300), '');
    if(r.length !== AI_DOCTRINE_MAX) throw new Error('实际 ' + r.length);
  });

  // ---------- 2. 改进①:相邻去重 ----------
  await check('改进①去重:与旧认知首个片段完全相同 → 不重复累积', function(){
    var base = '座位2很可疑；更早的结论';
    var r = mergeAiDoctrine(base, '座位2很可疑');
    if(r !== base) throw new Error('完全相同应原样返回,实际 ' + r);
  });

  await check('改进①去重:去标点后相同也算重复', function(){
    var base = '座位2很可疑；更早的结论';
    var r = mergeAiDoctrine(base, '座位2很可疑。');
    if(r !== base) throw new Error('去标点后相同应视为重复,实际 ' + r);
  });

  await check('改进①去重:一方是另一方子串(≥6字)也算重复', function(){
    var base = '座位2第3轮对主公出杀,很可疑；更早的结论';
    var r = mergeAiDoctrine(base, '座位2第3轮对主公出杀');
    if(r !== base) throw new Error('子串应视为重复,实际 ' + r);
  });

  await check('改进①去重:短文本(<6字)不做子串判定,避免误吃掉新认知', function(){
    var base = '座位2可疑；旧的';
    var r = mergeAiDoctrine(base, '座位2');   // 是子串但太短
    if(r === base) throw new Error('短文本不应被子串规则吃掉(宁可漏判不可误判)');
    if(r.indexOf('座位2；') !== 0) throw new Error('应正常前置合并,实际 ' + r);
  });

  await check('改进①去重:只和**首个**片段比,不和更早的片段比', function(){
    var base = '最新的；座位2很可疑';   // "座位2很可疑" 不是首个片段
    var r = mergeAiDoctrine(base, '座位2很可疑');
    if(r === base) throw new Error('只与首个片段去重;和更早片段重复时应正常合并');
  });

  await check('改进①去重:真正的新认知不会被误吃掉', function(){
    var base = '座位2很可疑；旧的';
    var r = mergeAiDoctrine(base, '座位5是内奸');
    if(r.indexOf('座位5是内奸；') !== 0) throw new Error('新认知应被正常前置,实际 ' + r);
  });

  // ---------- 3. 改进②:「无更新」同义集合 ----------
  await check('改进②:空串短路', function(){
    if(mergeAiDoctrine('旧认知', '') !== '旧认知') throw new Error('空串应短路');
    if(mergeAiDoctrine('旧认知', '   ') !== '旧认知') throw new Error('纯空白应短路');
    if(mergeAiDoctrine('旧认知', null) !== '旧认知') throw new Error('null 应短路');
    if(mergeAiDoctrine('旧认知', undefined) !== '旧认知') throw new Error('undefined 应短路');
  });

  await check('改进②:多种「无更新」表述都能被短路(不依赖单一魔法串"不变")', function(){
    ['不变','不变。','无','无更新','无变化','没有变化','没有','暂无','N/A','none','（无）','无。']
      .forEach(function(w){
        var r = mergeAiDoctrine('旧认知', w);
        if(r !== '旧认知') throw new Error('「' + w + '」应被视为无更新,实际合并成了 ' + r);
      });
  });

  await check('改进②:看起来像但实际是真内容的不该被误短路', function(){
    var r = mergeAiDoctrine('旧认知', '无人可信,全场都在装');
    if(r === '旧认知') throw new Error('「无人可信,全场都在装」是真内容,不该被短路');
  });

  await check('改进②破坏性验证:去掉同义集合只留空串判断,"没有变化"会被错误塞进 doctrine', function(){
    var saved = AI_DOCTRINE_NOOP;
    // 模拟外部项目那种"只认一个魔法串"的写法
    var only = new Set(['不变']);
    AI_DOCTRINE_NOOP.forEach(function(v){ if(v!=='不变') only.add('__none__'+v); });
    var backup = [];
    AI_DOCTRINE_NOOP.forEach(function(v){ backup.push(v); });
    backup.forEach(function(v){ if(v!=='不变') AI_DOCTRINE_NOOP.delete(v); });
    try{
      var r = mergeAiDoctrine('旧认知', '没有变化');
      if(r === '旧认知') throw new Error('只留"不变"时,"没有变化"应该会被错误合并(说明断言有鉴别力)');
    } finally { backup.forEach(function(v){ AI_DOCTRINE_NOOP.add(v); }); }
  });

  // ---------- 4. parseAiSummaryLayers ----------
  await check('parse:标准两层 JSON', function(){
    var r = parseAiSummaryLayers('{"tactical":"先打座位2","doctrineUpdate":"座位5像内奸"}');
    if(!r || r.tactical !== '先打座位2' || r.doctrineUpdate !== '座位5像内奸') throw new Error(JSON.stringify(r));
  });

  await check('parse:代码块包裹也能解析', function(){
    var BT = String.fromCharCode(96,96,96);   // 反引号不能直接写在 String.raw 模板里
    var r = parseAiSummaryLayers(BT + 'json\n{"tactical":"甲","doctrineUpdate":"乙"}\n' + BT);
    if(!r || r.tactical !== '甲') throw new Error(JSON.stringify(r));
  });

  await check('parse:思考链+末尾JSON的混合文本也能解析', function(){
    var r = parseAiSummaryLayers('让我想想…局势是这样的。{"tactical":"留桃","doctrineUpdate":""}');
    if(!r || r.tactical !== '留桃' || r.doctrineUpdate !== '') throw new Error(JSON.stringify(r));
  });

  await check('parse:只有其中一个字段也算有效', function(){
    var r = parseAiSummaryLayers('{"tactical":"只有战术"}');
    if(!r || r.tactical !== '只有战术' || r.doctrineUpdate !== '') throw new Error(JSON.stringify(r));
  });

  await check('parse:无关 JSON(如决策用的 {"choice":N})→ null,不当成摘要', function(){
    if(parseAiSummaryLayers('{"choice":2,"reason":"打他"}') !== null) throw new Error('决策JSON不该被当成摘要');
    if(parseAiSummaryLayers('{"foo":1}') !== null) throw new Error('无关JSON应返回 null');
    if(parseAiSummaryLayers('[1,2,3]') !== null) throw new Error('数组应返回 null');
  });

  await check('parse:纯文本/空/非法 → null(走回退路径)', function(){
    if(parseAiSummaryLayers('反贼倾向明显,我留着桃') !== null) throw new Error('纯文本应返回 null');
    if(parseAiSummaryLayers('') !== null) throw new Error('空应返回 null');
    if(parseAiSummaryLayers(null) !== null) throw new Error('null 应返回 null');
    if(parseAiSummaryLayers('{坏掉的json') !== null) throw new Error('非法JSON应返回 null');
  });

  // ---------- 5. composeAiSummary ----------
  await check('compose:doctrine 为空时**不加任何标签**,注入文本 = tactical 本身(与改动前逐字相同)', function(){
    if(composeAiSummary('我留着桃', '') !== '我留着桃') throw new Error('实际 ' + composeAiSummary('我留着桃',''));
    if(composeAiSummary('我留着桃', null) !== '我留着桃') throw new Error('null doctrine 同理');
  });

  await check('compose:两层都有 → 认知在前、战术在后,各带标签', function(){
    var r = composeAiSummary('先打座位2', '座位5像内奸');
    if(r.indexOf('【局势认知】座位5像内奸') !== 0) throw new Error('认知应在最前,实际 ' + r);
    if(r.indexOf('【当前战术】先打座位2') < 0) throw new Error('应含战术段,实际 ' + r);
  });

  await check('compose:只有 doctrine 没有 tactical 也能正确组装', function(){
    var r = composeAiSummary('', '座位5像内奸');
    if(r !== '【局势认知】座位5像内奸') throw new Error('实际 ' + r);
  });

  // ---------- 端到端准备 ----------
  aiApiKey = 'test-key'; aiProvider = 'claude';
  window.__lastOpts = null;
  function mockOk(text){
    callAI = async function(provider, apiKey, opts){ window.__lastOpts = opts; return { ok:true, text:text }; };
  }
  function mkG(cid){
    return { players:[{ name:'bot', cid: cid||'cidA', alive:true, hp:4, maxHp:4, hand:[],
        equips:{weapon:null,armor:null,plus1:null,minus1:null}, delays:[], role:null, general:null }],
      gameMode:'ffa', phase:'play', turn:0, roundNum:1, pending:null, deck:[],
      aiSuspicionEvents:[], log:[] };
  }

  // ---------- 6. 端到端两层 ----------
  await check('端到端:两层 JSON → tactical 覆写、doctrine 合并、aiSummary 为组装结果', async function(){
    aiSummaryReset();
    var g = mkG('cid1');
    mockOk('{"tactical":"先打座位2","doctrineUpdate":"座位5救过座位2"}');
    await updateAiSummary(g, 0);
    if(aiTactical !== '先打座位2') throw new Error('tactical 实际 ' + aiTactical);
    if(aiDoctrine !== '座位5救过座位2') throw new Error('doctrine 实际 ' + aiDoctrine);
    if(aiSummary !== composeAiSummary('先打座位2','座位5救过座位2')) throw new Error('aiSummary 应是组装结果,实际 ' + aiSummary);
  });

  await check('端到端:第二轮 tactical 被覆写、doctrine 增量累积(这正是改动要解决的问题)', async function(){
    var g = mkG('cid1');
    mockOk('{"tactical":"改为留闪防反扑","doctrineUpdate":"座位2手里应该还有桃"}');
    await updateAiSummary(g, 0);
    if(aiTactical !== '改为留闪防反扑') throw new Error('tactical 应被覆写,实际 ' + aiTactical);
    if(aiDoctrine.indexOf('座位2手里应该还有桃') !== 0) throw new Error('新认知应前置,实际 ' + aiDoctrine);
    if(aiDoctrine.indexOf('座位5救过座位2') < 0)
      throw new Error('**旧认知必须仍然存活**(改动前它会被整体覆写冲掉),实际 ' + aiDoctrine);
  });

  await check('端到端:doctrineUpdate 为空时 doctrine 原样保留,只刷新 tactical', async function(){
    var before = aiDoctrine;
    var g = mkG('cid1');
    mockOk('{"tactical":"这回合只摸牌","doctrineUpdate":""}');
    await updateAiSummary(g, 0);
    if(aiTactical !== '这回合只摸牌') throw new Error('tactical 应刷新');
    if(aiDoctrine !== before) throw new Error('doctrine 应原样保留,实际 ' + aiDoctrine);
  });

  // ---------- 7. 【不变量】解析失败 = 改动前的行为 ----------
  await check('【不变量】纯文本返回 → 逐字走改动前回退路径(aiSummary 就是原文,不加任何标签)', async function(){
    aiSummaryReset();
    var g = mkG('cidFB');
    mockOk('反贼倾向明显,我留着桃');
    await updateAiSummary(g, 0);
    if(aiSummary !== '反贼倾向明显,我留着桃')
      throw new Error('回退路径下 aiSummary 必须与改动前逐字相同,实际 "' + aiSummary + '"');
  });

  await check('【不变量】回退路径的 500 字截断与改动前一致', async function(){
    aiSummaryReset();
    var g = mkG('cidFB2');
    var long = '啊'.repeat(600);
    mockOk(long);
    await updateAiSummary(g, 0);
    if(aiSummary.length !== 500) throw new Error('应截断到 500,实际 ' + aiSummary.length);
    if(aiSummary !== long.slice(0,500)) throw new Error('应取前 500 字');
    if(AI_SUMMARY_FALLBACK_MAX !== 500) throw new Error('回退截断常量应为 500');
  });

  await check('【不变量】无关 JSON(决策格式)也走回退,不会被当成两层', async function(){
    aiSummaryReset();
    var g = mkG('cidFB3');
    mockOk('{"choice":2,"reason":"打他"}');
    await updateAiSummary(g, 0);
    if(aiSummary !== '{"choice":2,"reason":"打他"}')
      throw new Error('无关JSON应原样走回退,实际 ' + aiSummary);
    if(aiDoctrine !== '') throw new Error('不该产生 doctrine');
  });

  await check('【不变量】回退后两层状态自洽(tactical 承接整体文本,doctrine 不变)', async function(){
    aiSummaryReset();
    var g = mkG('cidFB4');
    mockOk('{"tactical":"甲","doctrineUpdate":"认知X"}');
    await updateAiSummary(g, 0);
    var doctrineBefore = aiDoctrine;
    mockOk('这次模型返回了纯文本');
    await updateAiSummary(g, 0);
    if(aiTactical !== '这次模型返回了纯文本') throw new Error('tactical 应承接回退文本,实际 ' + aiTactical);
    if(aiDoctrine !== doctrineBefore) throw new Error('回退时 doctrine 应保持原样,实际 ' + aiDoctrine);
    if(aiSummary !== '这次模型返回了纯文本') throw new Error('回退时 aiSummary 就是原文(不加标签),实际 ' + aiSummary);
  });

  // ---------- 8. 上限 ----------
  await check('上限:tactical ≤80 / doctrine ≤120,合计 200 与改动前持平', async function(){
    if(AI_TACTICAL_MAX !== 80) throw new Error('tactical 上限应为 80,实际 ' + AI_TACTICAL_MAX);
    if(AI_DOCTRINE_MAX !== 120) throw new Error('doctrine 上限应为 120,实际 ' + AI_DOCTRINE_MAX);
    if(AI_TACTICAL_MAX + AI_DOCTRINE_MAX !== 200) throw new Error('合计应为 200(与改动前的 ≤200 字持平)');
    aiSummaryReset();
    var g = mkG('cidCap');
    mockOk(JSON.stringify({ tactical:'战'.repeat(200), doctrineUpdate:'认'.repeat(200) }));
    await updateAiSummary(g, 0);
    if(aiTactical.length !== 80) throw new Error('tactical 应截到 80,实际 ' + aiTactical.length);
    if(aiDoctrine.length !== 120) throw new Error('doctrine 应截到 120,实际 ' + aiDoctrine.length);
  });

  // ---------- 9. 分仓 ----------
  await check('分仓:两层随 cid 切换,不同机器人互不污染', async function(){
    aiSummaryReset();
    var gA = mkG('cidX'), gB = mkG('cidY');
    mockOk('{"tactical":"A的战术","doctrineUpdate":"A的认知"}');
    await updateAiSummary(gA, 0);
    mockOk('{"tactical":"B的战术","doctrineUpdate":"B的认知"}');
    await updateAiSummary(gB, 0);
    selectAiSummary(gA, 0);
    if(aiTactical !== 'A的战术' || aiDoctrine !== 'A的认知')
      throw new Error('切回 A 应恢复 A 的两层,实际 t=' + aiTactical + ' d=' + aiDoctrine);
    selectAiSummary(gB, 0);
    if(aiTactical !== 'B的战术' || aiDoctrine !== 'B的认知')
      throw new Error('切到 B 应是 B 的两层,实际 t=' + aiTactical + ' d=' + aiDoctrine);
  });

  // ---------- 10. reset ----------
  await check('aiSummaryReset 清空两层', async function(){
    var g = mkG('cidR');
    mockOk('{"tactical":"甲","doctrineUpdate":"乙"}');
    await updateAiSummary(g, 0);
    if(!aiTactical || !aiDoctrine) throw new Error('前置条件:两层应非空');
    aiSummaryReset();
    if(aiTactical !== '' || aiDoctrine !== '' || aiSummary !== '')
      throw new Error('reset 后三者都应为空,实际 t=' + aiTactical + ' d=' + aiDoctrine + ' s=' + aiSummary);
  });

  // ---------- 11. 破坏性验证 ----------
  await check('破坏性验证:让 parseAiSummaryLayers 恒返回 null(=关掉两层),端到端断言确实会红', async function(){
    var saved = parseAiSummaryLayers;
    parseAiSummaryLayers = function(){ return null; };
    try{
      aiSummaryReset();
      var g = mkG('cidBreak');
      mockOk('{"tactical":"先打座位2","doctrineUpdate":"座位5救过座位2"}');
      await updateAiSummary(g, 0);
      if(aiDoctrine !== '') throw new Error('关掉两层后不该有 doctrine,说明破坏没生效');
      if(aiTactical !== '{"tactical":"先打座位2","doctrineUpdate":"座位5救过座位2"}')
        throw new Error('关掉两层后应整体走回退,实际 ' + aiTactical);
      console.log('       ↳ 关掉解析后确实退化成整体覆写(= 改动前行为),两层断言有鉴别力');
    } finally { parseAiSummaryLayers = saved; }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0) throw new Error('CORE-140 测试有 ' + fail + ' 条失败');
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'core140-test.js' })
  .catch(function(e){ console.error('\n' + (e && e.message || e)); process.exit(1); });
