/**
 * AI 自维护回合摘要测试 - aiSummary 状态 / updateAiSummary / buildSummaryPrompt /
 * callAiChooseIndex 摘要注入
 *
 * 加载真实 data.js + ai-bot.js + bot.js 进共享 vm 沙箱(与 run_ai_bus_info_test.js
 * 同一套惯例),mock callAI 记录收到的 opts 并返回可控结果。覆盖 14 项:
 * S1 八项(首回合无摘要且不注入 / updateAiSummary 写回 / 注入进 systemPrompt /
 * 失败沿用 / 迭代携带旧摘要 / 座位变化清空 / 500 字上限 / fire-and-forget 不阻塞)
 * + S2 六项(scheduleBotTurn 回合检测 / over 清空 / 弹窗含清除按钮 / 点击清除 /
 * 真人回合不清记忆 / setupRefreshWarning 移除)。
 *
 * S2 的弹窗用例需要驱动真实 showAiKeyModal,把 document stub 升级成
 * run_ai_model_picker_test.js 同款树形 stub(appendChild/remove/getElementById 按
 * 树搜索 + classList 真实增删 + onclick/oninput 属性事件 + replaceWith)。
 *
 * 已知的 vm 坑:aiApiKey/aiProvider/aiApiModel 是 ai-bot.js 脚本作用域的 let 绑定,
 * 必须用 runInContext 里裸标识符赋值;callAI 是函数声明绑定,可直接在 runInContext
 * 里整体替换成 mock;distance/attackRange 是 game.js 的函数声明,沙箱不加载
 * game.js,在 context 里给最小 stub(同 run_ai_bus_info_test.js 惯例)。
 */

const vm = require('vm');
const fs = require('fs');

// 共享上下文:ai-bot.js 顶层 IIFE 读 sessionStorage;showAiThinkingIndicator/
// hideAiThinkingIndicator 读 document.getElementById(守卫 null);S2 弹窗用例驱动
// showAiKeyModal,需要树形 document stub —— 全部在这里给最小 stub。
const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  mySeat: 0,
  myClientId: 'test-client',
  // game.js 的 distance/attackRange 不在沙箱里,给最小 stub(buildBotVisibleState 用)
  distance: function(){ return 1; },
  attackRange: function(){ return 1; },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  window: {
    aiConversations: {},
    addEventListener: function(){},
    location: { search: '', href: 'http://localhost', reload: function(){} },
    // detectAiProvider 会把未识别的密钥 fallback 到 cohere(2026-08-11 起),
    // test-key 触发 showAiKeyModal → renderModelPicker → fetchProviderModels('cohere')。
    // 沙箱没有真网络,返回明确的非成功响应(走静态表回退),保证弹窗异步链不炸。
    fetch: function(){ return Promise.resolve({ ok:false }); }
  },
  // fetchProviderModels 内部用裸 fetch(不是 window.fetch)——和 run_ai_model_picker_test.js
  // 同款处理:context 顶层也要有 fetch,否则裸标识符在沙箱里 ReferenceError。
  fetch: function(){ return Promise.resolve({ ok:false }); }
};
// 沙箱内裸 sessionStorage 与 window.sessionStorage 同源指向上面这个 stub
context.window.sessionStorage = context.sessionStorage;

// ---- 树形最小 DOM(run_ai_model_picker_test.js 同款):appendChild/remove 维护树、
//      按树 getElementById、classList 真实增删、onclick/oninput/onblur 属性事件、
//      replaceWith(清除按钮"就地替换成提示"需要)。----
function mkEl(tag){
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, _text: '', _html: '',
    id: '', className: '', disabled: false, parentEl: null,
    value: '', type: '', placeholder: '', autocomplete: '',
    onclick: null, oninput: null, onchange: null, onblur: null,
    _cls: {}, _ls: {},
    classList: {
      add: function(c){ el._cls[c] = 1; },
      remove: function(c){ delete el._cls[c]; },
      contains: function(c){ return !!el._cls[c]; },
    },
    appendChild: function(ch){ ch.parentEl = this; this.children.push(ch); return ch; },
    removeChild: function(ch){ const i = this.children.indexOf(ch); if(i>=0){ this.children.splice(i,1); ch.parentEl = null; } return ch; },
    remove: function(){ if(this.parentEl) this.parentEl.removeChild(this); },
    replaceWith: function(n){ if(this.parentEl){ const i = this.parentEl.children.indexOf(this); if(i>=0){ this.parentEl.children[i] = n; n.parentEl = this.parentEl; } this.parentEl = null; } },
    set textContent(v){ this._text = String(v==null?'':v); },
    get textContent(){ return this._text; },
    set innerHTML(v){ this._html = String(v==null?'':v); this.children = []; },
    get innerHTML(){ return this._html; },
    addEventListener: function(type, fn){ this._ls[type] = fn; },
    click: function(){ if(typeof this.onclick === 'function') this.onclick(); },
    querySelectorAll: function(sel){
      const out = [];
      const wantSelected = sel === 'button.selected';
      (function walk(n){
        if(n !== el && n.tagName === 'BUTTON' && (!wantSelected || n.classList.contains('selected'))) out.push(n);
        (n.children || []).forEach(walk);
      })(el);
      return out;
    }
  };
  return el;
}

const modalEl = mkEl('div'); modalEl.id = 'aiKeyModal';
const bodyEl = mkEl('body'); bodyEl.appendChild(modalEl);
context.document = {
  body: bodyEl,
  getElementById: function(id){
    let found = null;
    (function walk(n){
      if(found) return;
      if(n.id === id){ found = n; return; }
      (n.children || []).forEach(walk);
    })(bodyEl);
    return found;
  },
  createElement: function(tag){ return mkEl(tag); },
  createTextNode: function(t){ return { nodeValue: t, textContent: t }; },
  addEventListener: function(){},
  querySelector: function(){ return null; },
  querySelectorAll: function(){ return []; }
};

const sandbox = vm.createContext(context, { name: 'sgs-ai-summary-sandbox' });

console.log('Loading AI 摘要测试环境...\n');

// 加载真实源文件:data.js(GENERALS/EQUIPS,buildBotVisibleState 运行时查表)必须排在
// bot.js 之前;ai-bot.js(密钥/提供商 let 绑定 + callAI);bot-ai-bus.js 在 bot.js 前
// (TDZ:const BOT_DECISIONS 先于注册项)。bot.js 顶层无立即执行的
// 函数调用,不加载 game.js 也无碍。
const files = ['data.js', 'stages/stage-table.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'];
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

console.log('\n' + '='.repeat(60));
console.log('  AI 摘要测试(16 项)');
console.log('='.repeat(60) + '\n');

// 断言脚本整体在沙箱内执行(和 run_ai_bus_core_test.js 同一惯例),
// 这样 aiApiKey = 'test-key' 这类裸标识符赋值才能命中 ai-bot.js 的 let 绑定。
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

  // 准备:填密钥/提供商,mock callAI(函数声明绑定可直接整体替换)
  aiApiKey = 'test-key';
  aiProvider = 'claude';
  window.__mockSummaryCalls = 0;
  window.__mockSummaryResult = null;
  window.__mockSummaryArgs = null;
  callAI = async function(provider, apiKey, opts){
    window.__mockSummaryCalls++;
    window.__mockSummaryArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockSummaryResult;
  };
  function mockOk(text){ window.__mockSummaryResult = { ok: true, text: text }; }

  // 最小局面:3 人 ffa,结构满足 buildBotVisibleState 的读取
  var g = {
    roundNum: 3,
    turn: 0,
    phase: 'play',
    gameMode: 'ffa',
    shaUsed: false,
    players: [
      { name: '机器人1', cid: 'bot-stable-1', role: 'fan', hp: 3, maxHp: 4, alive: true,
        hand: [{ name: '桃', suit: 'heart', rank: 3 }], equips: {}, delays: [], general: 'guanyu' },
      { name: '机器人2', cid: 'bot-stable-2', role: 'zhong', hp: 3, maxHp: 3, alive: true,
        hand: [], equips: {}, delays: [], general: 'machao' },
      { name: '机器人3', cid: 'bot-stable-3', role: 'zhu', hp: 4, maxHp: 4, alive: true,
        hand: [], equips: {}, delays: [], general: 'sunquan' },
    ],
    log: [{ seq: 1, text: '机器人1 对 机器人2 造成 1 点伤害' }],
    discard: [{ name: '杀' }, { name: '闪' }],
    deck: [],
  };
  var candidates2 = [{ action: 'a' }, { action: 'b' }];

  // 1. 首回合:aiSummary 空;callAiChooseIndex 的 systemPrompt 不含"本局记忆摘要"段
  await check('1 首回合 aiSummary 为空且 systemPrompt 无摘要段', async function(){
    if(aiSummary !== '') throw new Error('期望 aiSummary==="",实际 "' + aiSummary + '"');
    mockOk('{"choice":0}');
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 0) throw new Error('期望 0,实际 ' + idx);
    var sp = window.__mockSummaryArgs.opts.systemPrompt;
    if(sp.indexOf('本局记忆摘要') !== -1) throw new Error('无摘要时不应注入摘要段');
  });

  // 2. updateAiSummary 直接调用 → mock callAI 被调 1 次、收到总结 prompt;写回 aiSummary
  await check('2 updateAiSummary 调 callAI 一次并写回 aiSummary', async function(){
    window.__mockSummaryCalls = 0;
    mockOk('反贼倾向明显,我留着桃');
    await updateAiSummary(g, 0);
    if(window.__mockSummaryCalls !== 1) throw new Error('期望 callAI 1 次,实际 ' + window.__mockSummaryCalls);
    // CORE-140:原断言是 indexOf('摘要') —— 它验的**意图**是"发出去的是摘要任务的
    // systemPrompt,而不是决策用的那个",'摘要'两个字只是一个代理标记。新的
    // buildSummaryPrompt 按设计改说"两层记忆/tactical/doctrineUpdate",不再出现那个词,
    // 所以这条代理标记语义过期了。**这不是放宽断言**:改锚到 JSON 契约的两个字段名,
    // 它们唯一标识摘要任务、且不可能和决策 prompt({"choice":N})混淆,比原来的
    // "含'摘要'二字"更强——原标记连一句随口提到"摘要"的决策 prompt 都会放行。
    var sysP = window.__mockSummaryArgs.opts.systemPrompt;
    if(sysP.indexOf('tactical') === -1 || sysP.indexOf('doctrineUpdate') === -1)
      throw new Error('systemPrompt 应是摘要任务的两层契约(含 tactical/doctrineUpdate)');
    if(aiSummary !== '反贼倾向明显,我留着桃') throw new Error('期望 aiSummary 写回,实际 "' + aiSummary + '"');
  });

  // 3. 摘要注入:非空摘要 → 下一次决策的 systemPrompt 含摘要文本
  await check('3 callAiChooseIndex 注入非空摘要进 systemPrompt', async function(){
    mockOk('{"choice":1}');
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 1) throw new Error('期望 1,实际 ' + idx);
    var sp = window.__mockSummaryArgs.opts.systemPrompt;
    if(sp.indexOf('本局记忆摘要') === -1) throw new Error('应含"本局记忆摘要"段');
    if(sp.indexOf('反贼倾向明显,我留着桃') === -1) throw new Error('摘要文本应注入 systemPrompt');
  });

  // 4. 失败沿用:mock 返回 {ok:false} → aiSummary 不变
  await check('4 callAI 失败时 aiSummary 沿用旧值', async function(){
    window.__mockSummaryResult = { ok: false, reason: 'timeout', detail: '请求超时' };
    await updateAiSummary(g, 0);
    if(aiSummary !== '反贼倾向明显,我留着桃') throw new Error('失败后 aiSummary 不应变,实际 "' + aiSummary + '"');
  });

  // 5. 迭代:第二次 updateAiSummary → mock 收到的 userPrompt 含"旧摘要"+第一次输出
  await check('5 第二次 updateAiSummary 的 userPrompt 含旧摘要', async function(){
    mockOk('二号目标更像反贼,我留闪');
    await updateAiSummary(g, 0);
    var up = window.__mockSummaryArgs.opts.userPrompt;
    if(up.indexOf('旧摘要') === -1) throw new Error('userPrompt 应含"旧摘要"');
    if(up.indexOf('反贼倾向明显,我留着桃') === -1) throw new Error('第一次输出应出现在 userPrompt');
    if(aiSummary !== '二号目标更像反贼,我留闪') throw new Error('迭代后 aiSummary 应为新摘要,实际 "' + aiSummary + '"');
  });

  // 6. 多机器人分仓:切到其它机器人时当前槽为空,切回后恢复原摘要
  await check('6 多机器人切换不会互相清空摘要', async function(){
    mockOk('{"choice":0}');
    await callAiChooseIndex({ g: g, seat: 1, candidates: candidates2 });
    if(aiSummary !== '') throw new Error('换座位后 aiSummary 应清空,实际 "' + aiSummary + '"');
    await callAiChooseIndex({ g: g, seat: 2, candidates: candidates2 });
    if(aiSummary !== '') throw new Error('再次换座位后 aiSummary 仍应为空');
    await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(aiSummary !== '二号目标更像反贼,我留闪') throw new Error('切回座位0应恢复其摘要,实际 "' + aiSummary + '"');
    var moved = g.players[0]; g.players[0] = g.players[1]; g.players[1] = moved;
    await callAiChooseIndex({ g: g, seat: 1, candidates: candidates2 });
    if(aiSummary !== '二号目标更像反贼,我留闪') throw new Error('同一 bot cid 换座后仍应恢复其摘要');
    moved = g.players[0]; g.players[0] = g.players[1]; g.players[1] = moved;
    await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
  });

  // 7. 上限:mock 返回 600 字 → aiSummary 长度 ≤500
  await check('7 超长摘要截断到 500', async function(){
    // 上一项已经切回座位0，继续验证同一机器人的摘要更新上限。
    var long = '';
    for(var i = 0; i < 36; i++) long += '这是用来撑长度的中文摘要文本片段。'; // 36*17=612 字
    if(long.length <= 500) throw new Error('测试构造错误:长文本长度 ' + long.length + ' 应 >500');
    mockOk(long);
    await updateAiSummary(g, 0);
    if(aiSummary.length > 500) throw new Error('期望 ≤500,实际 ' + aiSummary.length);
    if(aiSummary !== long.slice(0, 500)) throw new Error('截断应取前 500 字');
  });

  // 8. 不阻塞:updateAiSummary 返回 Promise、不抛错、未 await 时后续决策照常工作
  await check('8 updateAiSummary fire-and-forget 不阻塞', async function(){
    var before = window.__mockSummaryCalls;
    mockOk('{"choice":0}');
    var p = updateAiSummary(g, 0);
    if(!(p && typeof p.then === 'function')) throw new Error('async 函数应返回 Promise');
    // 未 await 直接做下一次决策:不能因为摘要未完成而卡住
    var idx = await callAiChooseIndex({ g: g, seat: 0, candidates: candidates2 });
    if(idx !== 0) throw new Error('期望 0,实际 ' + idx);
    await p;
    if(window.__mockSummaryCalls < before + 1) throw new Error('updateAiSummary 应已触发 callAI');
  });

  // ---- 跨座位异步竟态防护(真实bug复现:updateAiSummary是fire-and-forget,座位A的请求
  // 还在等待网络响应期间,座位B可能已经抢占了aiSummarySeat这个归属——A的响应姗姗来迟
  // resolve后,若不加区分直接写回,会用"出发时的旧seat"把刚刚正确建立的新归属强行覆盖
  // 回去,B刚攒的记忆被撕掉。这两项测试必须放在这里(test 8 之后、S2 之前)——S2 段的
  // test 9/13 会把 updateAiSummary 整体替换成 spy 且不恢复,后面的测试拿到的已经不是
  // 真实实现) ----
  await check('R1 跨座位竟态:座位A请求未resolve期间座位B已抢占归属,A的迟到响应应被丢弃不覆盖', async function(){
    var deferredResolve;
    var originalCallAI = callAI;
    callAI = function(provider, apiKey, opts){
      window.__mockSummaryCalls++;
      window.__mockSummaryArgs = { provider: provider, apiKey: apiKey, opts: opts };
      return new Promise(function(resolve){ deferredResolve = resolve; });
    };
    try{
      aiSummary = '座位0的旧摘要'; aiSummarySeat = 0;
      var p = updateAiSummary(g, 0); // 发起座位0的请求,不 await(和真实调用方一致的 fire-and-forget)
      // 座位0的请求还没 resolve,此时座位1抢占归属——和 scheduleBotTurn/callAiChooseIndex
      // 真实会做的事一致(归属易主时先清空再改成新座位)
      aiSummaryReset();
      aiSummarySeat = 1;
      aiSummary = '座位1的新摘要';
      // 座位0的迟到响应现在才 resolve
      deferredResolve({ ok: true, text: '座位0生成的过期摘要内容' });
      await p;
      if(aiSummarySeat !== 1) throw new Error('座位1的归属不应被座位0的迟到响应覆盖,实际 aiSummarySeat=' + aiSummarySeat);
      if(aiSummary !== '座位1的新摘要') throw new Error('座位1的摘要内容不应被座位0的迟到响应覆盖,实际 "' + aiSummary + '"');
    } finally {
      callAI = originalCallAI;
    }
  });

  await check('R2 回归:没有竟态时(归属未变)依然正常写入新摘要', async function(){
    aiSummary = '旧内容'; aiSummarySeat = 0;
    mockOk('座位0正常生成的新摘要');
    await updateAiSummary(g, 0);
    if(aiSummarySeat !== 0) throw new Error('无竟态场景归属应仍是0,实际 ' + aiSummarySeat);
    if(aiSummary !== '座位0正常生成的新摘要') throw new Error('无竟态场景应正常写入,实际 "' + aiSummary + '"');
  });

  // ---- S2:scheduleBotTurn 回合检测 / over 清空 / 清除按钮 ----

  // 9. scheduleBotTurn:回合号变化时 updateAiSummary 被调(spy);
  //    回合不变 → 不调;首回合摘要为空时也应生成第一份。stub setTimeout/clearTimeout
  //    避免真实 650~1150ms 防抖定时器跑起来。
  await check('9 scheduleBotTurn 回合变化触发 updateAiSummary(spy)', async function(){
    var _origSt = setTimeout, _origCt = clearTimeout;
    setTimeout = function(){ return 424242; };
    clearTimeout = function(){};
    try{
      var spyCalls = 0;
      updateAiSummary = async function(g2, s){ spyCalls++; };
      // isBotController 为真:players[0] 是带 cid 的真人(控制器),turn 指向机器人座位
      var g2 = {
        roundNum: 5, turn: 1, phase: 'play', gameMode: 'ffa', shaUsed: false,
        players: [
          { name: '人类', cid: 'test-client', hp: 4, maxHp: 4, alive: true, hand: [], equips: {}, delays: [], general: 'sunquan' },
          { name: '机器人1', isBot: true, cid: 'bot-1', hp: 3, maxHp: 3, alive: true, hand: [], equips: {}, delays: [], general: 'guanyu' },
          { name: '机器人2', isBot: true, cid: 'bot-2', hp: 3, maxHp: 3, alive: true, hand: [], equips: {}, delays: [], general: 'machao' },
        ],
        pending: null, log: [], discard: [], deck: [],
      };
      // a. 回合变化(roundNum 4→5)、座位匹配、已有摘要 → 触发
      aiSummary = '上一轮的摘要'; aiSummarySeat = 1; aiSummaryRound = 4; aiSummaryTurn = 1;
      scheduleBotTurn(g2);
      if(spyCalls !== 1) throw new Error('回合变化应触发 updateAiSummary 1 次,实际 ' + spyCalls);
      if(aiSummaryRound !== 5 || aiSummaryTurn !== 1) throw new Error('应记录本次回合号');
      // b. 同一状态再来一次(回合没变)→ 不触发
      scheduleBotTurn(g2);
      if(spyCalls !== 1) throw new Error('回合不变不应再触发,实际 ' + spyCalls);
      // c. 首回合:摘要空也应触发,否则第一份摘要永远没有入口生成
      aiSummaryReset();
      g2.roundNum = 6;
      scheduleBotTurn(g2);
      if(spyCalls !== 2) throw new Error('摘要为空时应触发首次生成,实际 ' + spyCalls);
      scheduleBotTurn(g2);
      if(spyCalls !== 2) throw new Error('同一回合重复调度不应重复请求,实际 ' + spyCalls);
    } finally {
      setTimeout = _origSt; clearTimeout = _origCt;
    }
  });

  // 10. phase==='over' → aiSummary 清空(aiSummarySeat 一并置 null)
  await check('10 scheduleBotTurn over 清空 aiSummary', async function(){
    aiSummary = '残存记忆'; aiSummarySeat = 1; aiSummaryRound = 3; aiSummaryTurn = 1;
    var gOver = { phase: 'over',
      players: [ { name: '人类', cid: 'test-client' }, { name: '机器人1', isBot: true }, { name: '机器人2', isBot: true } ],
      pending: null };
    scheduleBotTurn(gOver);
    if(aiSummary !== '') throw new Error('over 后 aiSummary 应为空,实际 "' + aiSummary + '"');
    if(aiSummarySeat !== null) throw new Error('over 后 aiSummarySeat 应为 null,实际 ' + aiSummarySeat);
  });

  // 11. showAiKeyModal 弹窗按钮区不再含 #aiMemoryClearBtn（已改为每局 newGame 自动清除）
  await check('11 弹窗不再含清除AI记忆按钮 #aiMemoryClearBtn', async function(){
    aiApiKey = 'co-test'; aiProvider = 'cohere'; aiApiModel = '';
    showAiKeyModal();
    var clearBtn = document.getElementById('aiMemoryClearBtn');
    if(clearBtn) throw new Error('btnRow 不应再含 #aiMemoryClearBtn（已移除，改为自动清除）');
  });

  // 12. 每局 newGame 自动清除摘要（替代旧的手动点击清除）
  await check('12 newGame 自动清除摘要', async function(){
    // provider 保持 cohere，避免“换 provider 清模型”干扰
    aiApiKey = 'co-test'; aiProvider = 'cohere'; aiApiModel = 'keep-model';
    aiSummary = '旧记忆'; aiSummarySeat = 1;
    // 模拟 newGame 的自动清除路径（room-lifecycle.js 已补 aiSummaryReset）
    if(typeof aiSummaryReset === 'function') aiSummaryReset();
    if(aiSummary !== '') throw new Error('newGame 后 aiSummary 应为空,实际 "' + aiSummary + '"');
    if(aiSummarySeat !== null) throw new Error('newGame 后 aiSummarySeat 应为 null,实际 ' + aiSummarySeat);
    if(aiApiKey !== 'co-test') throw new Error('密钥不应被清除,实际 "' + aiApiKey + '"');
    if(aiApiModel !== 'keep-model') throw new Error('模型选择不应被清除,实际 "' + aiApiModel + '"');
  });

  // 13. 真人回合(seat===-1)不清 AI 记忆:scheduleBotTurn 每次渲染都跑,若此时
  //      aiSummarySeat!==-1 就 reset,机器人跨回合记忆每过一个真人回合就被清空
  //      (2人局=1真人+1机器人时功能等于报废)。seat>=0 守卫后:不 reset、不更新。
  await check('13 真人回合(seat=-1)不清 aiSummary', async function(){
    var _origSt = setTimeout, _origCt = clearTimeout;
    setTimeout = function(){ return 424243; };
    clearTimeout = function(){};
    var spyCalls = 0;
    updateAiSummary = async function(g2, s){ spyCalls++; };
    try{
      // isBotController 为真(turn 指向真人座位 0 → botSeatForState 返回 -1)
      var g13 = {
        roundNum: 5, turn: 0, phase: 'play', gameMode: 'ffa', shaUsed: false,
        players: [
          { name: '人类', cid: 'test-client', hp: 4, maxHp: 4, alive: true, hand: [], equips: {}, delays: [], general: 'sunquan' },
          { name: '机器人1', isBot: true, cid: 'bot-1', hp: 3, maxHp: 3, alive: true, hand: [], equips: {}, delays: [], general: 'guanyu' },
        ],
        pending: null, log: [], discard: [], deck: [],
      };
      aiSummary = '旧记忆'; aiSummarySeat = 1; aiSummaryRound = 5; aiSummaryTurn = 0;
      scheduleBotTurn(g13);
      if(aiSummary !== '旧记忆') throw new Error('真人回合不应清空 aiSummary,实际 "' + aiSummary + '"');
      if(aiSummarySeat !== 1) throw new Error('真人回合不应动 aiSummarySeat,实际 ' + aiSummarySeat);
      if(spyCalls !== 0) throw new Error('真人回合不应触发 updateAiSummary,实际 ' + spyCalls);
    } finally {
      setTimeout = _origSt; clearTimeout = _origCt;
    }
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

// 等沙箱内异步断言跑完,按结果退出(全绿 0,任一失败 1)
(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  // 14(宿主机):setupRefreshWarning 函数+调用、window.aiConversations 引用已从
  // ai-bot.js 移除(等价于 `rg "setupRefreshWarning" ai-bot.js` 无输出)
  const aiBotSrc = fs.readFileSync('ai-bot.js', 'utf8');
  if(aiBotSrc.indexOf('setupRefreshWarning') !== -1){
    console.log('  FAIL 14 setupRefreshWarning 仍存在于 ai-bot.js');
    sandbox.__testFail = true;
  } else if(aiBotSrc.indexOf('aiConversations') !== -1){
    console.log('  FAIL 14 aiConversations 引用仍存在于 ai-bot.js');
    sandbox.__testFail = true;
  } else {
    console.log('  PASS 14 setupRefreshWarning 与 aiConversations 引用已移除');
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
