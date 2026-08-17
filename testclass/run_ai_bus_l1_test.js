/**
 * AI 总线 B3 层测试 - L1 controlsChoice(镜像真实 controls 按钮)
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot/ai-bot/
 * render-controls)进共享 vm 沙箱。与 run_ai_bus_l2_test.js 同一套 firebase/gameRef
 * stub 与异步 check 断言;额外提供一组"可用的最小 DOM"(支持 appendChild/remove/
 * querySelectorAll('button:not(:disabled)')/id 换名后 getElementById 按树查找)——L1
 * 走的是 botSafePrompt 同款 DOM 隔离模式,必须真的能渲染出按钮才能收集候选。
 *
 * 【render-controls.js 加载路径:真实文件,不用 stub】它顶层只有 let/function 声明、
 * 无立即执行的 DOM 操作,在沙箱里能干净加载;renderControls 运行期需要的外部函数
 * setBanner/escapeHtml(真实定义在 render.js,本测试不加载 render.js)在这里给最小 stub。
 *
 * 已知的 vm 坑(沿用 L2):aiApiKey/aiProvider 是脚本作用域 let 绑定,必须用 runInContext
 * 裸标识符赋值;respondWuxie/respondLuoying/respondLuoshen 都是函数声明绑定,可直接
 * 整体替换成 spy。
 */

const vm = require('vm');
const fs = require('fs');

// ---- 可用的最小 DOM:元素支持树形 appendChild/remove,按钮支持 click/textContent/disabled ----
function mkEl(tag){
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, _text: '', _html: '',
    id: '', className: '', disabled: false, onclick: null, parentEl: null,
    classList: { add: function() {}, remove: function() {}, contains: function() { return false; } },
    appendChild: function(ch){ ch.parentEl = this; this.children.push(ch); return ch; },
    removeChild: function(ch){ const i = this.children.indexOf(ch); if(i>=0){ this.children.splice(i,1); ch.parentEl = null; } return ch; },
    remove: function(){ if(this.parentEl) this.parentEl.removeChild(this); },
    set textContent(v){ this._text = String(v==null?'':v); },
    get textContent(){ return this._text; },
    set innerHTML(v){ this._html = String(v==null?'':v); this.children = []; },
    get innerHTML(){ return this._html; },
    click: function(){ if(typeof this.onclick === 'function') this.onclick(); },
    // 只支持 'button:not(:disabled)' 这一个选择器(collect 唯一的用法),递归收集
    querySelectorAll: function(sel){
      const out = [];
      const self = this;
      (function walk(n){
        if(n !== self && n.tagName === 'BUTTON' && !n.disabled) out.push(n);
        (n.children || []).forEach(walk);
      })(self);
      return out;
    }
  };
  return el;
}
const realControls = mkEl('div'); realControls.id = 'controls';
const bodyEl = mkEl('body'); bodyEl.appendChild(realControls);
const documentStub = {
  body: bodyEl,
  // 按树查找 id:真实 DOM 语义——collect 把真实控件改名后,getElementById('controls')
  // 必须落到新挂上的隐藏 box 上
  getElementById: function(id){
    let found = null;
    (function walk(n){
      if(found) return;
      if(n.id === id){ found = n; return; }
      (n.children || []).forEach(walk);
    })(bodyEl);
    // 找不到时返回一个可丢弃的元素(模拟 L2 的宽松 stub):game.js 顶层会绑定
    // joinBtn/closeRoomBtn 等非 controls 元素的 onclick,不能在这里崩
    return found || mkEl('div');
  },
  createElement: function(tag){ return mkEl(tag); },
  createTextNode: function(t){ return { nodeValue: t, textContent: t }; },
};

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
  document: documentStub,
  // renderControls 运行期依赖的外部函数(真实定义在 render.js,不在加载范围)
  setBanner: function() {},
  escapeHtml: function(s){ return String(s==null?'':s); },
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
  RegExp: RegExp,
  __realControls: realControls
};

context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;
context.__bodyEl = bodyEl;

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-l1-sandbox' });

console.log('Loading AI 总线 L1 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前;render-controls 最后(真实文件)
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render-controls.js'];
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
console.log('  AI 总线 L1 测试(controlsChoice 镜像全部可点按钮)');
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

  // ---- spy:respondWuxie/respondLuoying 是函数声明绑定,整体替换即可 ----
  // 【自动发动改造】甄姬【洛神】不再有 respondLuoshen/luoshen 这个交互阶段——洛神判定
  // 现在由 autoLuoshenRound 直接自动循环判定,不再询问是否发动;这里不再需要 spy 它。
  window.__wuxieCalls = [];
  window.__luoyingCalls = [];
  respondWuxie = function(use){ window.__wuxieCalls.push(use); };
  respondLuoying = function(use){ window.__luoyingCalls.push(use); };
  respondLiuli = function(choice, newTargetSeat){ window.__liuliCalls.push([choice, newTargetSeat]); };
  respondTianxiang = function(choice, targetSeat){ window.__tianxiangCalls.push([choice, targetSeat]); };
  respondLiRangRecover = function(activate){ window.__lirangCalls.push(activate); };
  respondZhengyi = function(activate){ window.__zhengyiCalls.push(activate); };
  respondXiaoguoChoice = function(choice){ window.__xiaoguoChoiceCalls.push(choice); };
  // ---- mock callAI ----
  window.__mockAiCalls = 0;
  window.__mockAiArgs = null;
  window.__mockAiResults = [];
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockAiResults.length ? window.__mockAiResults.shift() : { ok: false, reason: 'other', detail: '队列已空' };
  };

  // 3 人局,座位0是机器人(无武将,不触发蛊惑按钮),turn=1(真人1的回合)
  function mkG(phase, pending, hand, opt){
    opt = opt || {};
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: true, hp: 3, maxHp: 3,
        hand: i === 0 ? (hand || []) : [],
        equips: emptyEquips(), delays: [],
        isBot: i === 0,
        role: 'zhu'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: phase, turn: 1, log: [], pending: pending, started: true };
  }
  function card(name, id){
    return { id: id || (name + ''), name: name, suit: '♥', rank: 5 };
  }
  function wuxiePending(){
    return { type: 'wuxie', trick: '决斗', from: 1, to: 0, exclude: 1, depth: 0, asking: 0 };
  }

  // ---- T1:collect 只收集 enabled 按钮;无懈不在手 → 只剩「不出」 ----
  await check('collect:wuxie无懈不在手只收集「不出」', function(){
    var g = mkG('wuxie', wuxiePending(), [card('杀')]);
    var res = collectControlsCandidates(g, 0);
    try{
      if(!res || !Array.isArray(res.candidates)) throw new Error('应返回 {candidates, dispose}');
      if(res.candidates.length !== 1) throw new Error('应恰1个可点按钮,实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label !== '不出') throw new Error('应为「不出」,实际 ' + res.candidates[0].label);
      if(typeof res.dispose !== 'function') throw new Error('应带 dispose');
    } finally {
      res.dispose();
    }
  });

  // ---- T2:有懈在手 → 两个按钮,顺序为 打出【无懈可击】、不出 ----
  await check('collect:wuxie有懈在手收集两个按钮且顺序正确', function(){
    var g = mkG('wuxie', wuxiePending(), [card('无懈可击')]);
    var res = collectControlsCandidates(g, 0);
    try{
      if(res.candidates.length !== 2) throw new Error('应恰2个可点按钮,实际 ' + res.candidates.length);
      if(res.candidates[0].label !== '打出【无懈可击】') throw new Error('按钮0应为打出,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '不出') throw new Error('按钮1应为不出,实际 ' + res.candidates[1].label);
    } finally {
      res.dispose();
    }
  });

  // ---- T3:无密钥,wuxie 本地回退 = 旧硬编码 respondWuxie(false),且 dispose 归还 DOM ----
  await check('无密钥:botDecide(controlsChoice) 回退点「不出」=respondWuxie(false)', async function(){
    window.__wuxieCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkG('wuxie', wuxiePending(), [card('杀')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true(已接管),实际 ' + r);
    if(window.__wuxieCalls.length !== 1) throw new Error('respondWuxie 应被调1次,实际 ' + window.__wuxieCalls.length);
    if(window.__wuxieCalls[0] !== false) throw new Error('应 respondWuxie(false),实际 ' + window.__wuxieCalls[0]);
    // dispose 生效:真实控件 id 恢复、临时 box 已移除
    var c = document.getElementById('controls');
    if(c !== __realControls) throw new Error('controls 应恢复为真实元素');
    if(c.id !== 'controls') throw new Error('真实控件 id 应恢复为 controls,实际 ' + c.id);
    if(document.body.children.length !== 1) throw new Error('body 应只剩真实控件,临时 box 未移除');
  });

  // ---- T4:有密钥,只有「不出」一个候选 → 不调AI、直接点它 ----
  await check('有密钥:单候选短路不调AI,点「不出」', async function(){
    window.__wuxieCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('wuxie', wuxiePending(), [card('杀')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true');
    if(window.__mockAiCalls !== 0) throw new Error('单候选不应调 callAI,实际 ' + window.__mockAiCalls);
    if(window.__wuxieCalls[0] !== false) throw new Error('应 respondWuxie(false)');
  });

  // ---- T5:有密钥,mock 选「打出【无懈可击】」→ respondWuxie(true),prompt 描述按钮 ----
  await check('有密钥:mock 选打出无懈 → respondWuxie(true)', async function(){
    window.__wuxieCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('wuxie', wuxiePending(), [card('无懈可击')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true');
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__wuxieCalls.length !== 1 || window.__wuxieCalls[0] !== true) throw new Error('应 respondWuxie(true),实际 ' + JSON.stringify(window.__wuxieCalls));
    var sp = window.__mockAiArgs.opts.systemPrompt || '';
    if(sp.indexOf('按钮') < 0) throw new Error('systemPrompt 应说明这些是UI按钮,实际 ' + sp);
    if((window.__mockAiArgs.opts.userPrompt || '').indexOf('打出【无懈可击】') < 0) throw new Error('userPrompt 应含按钮文案');
  });

  // ---- T6:非 allowlist 阶段(duel)无密钥 → botDecide 返回 false,旧分支继续 ----
  // 【L1 泛化后语义】无密钥时只有 allowlist 三阶段被接管;非 allowlist 阶段(即使上一条
  // 测试刚设过密钥)必须显式无密钥才返回 false——有密钥时 duel 这类已登记阶段也归 L1。
  await check('非allowlist阶段(duel)无密钥:botDecide 返回 false', async function(){
    aiApiKey = '';
    aiProvider = null;
    var g = mkG('duel', { type: 'duel', active: 0, from: 0, to: 1 }, [card('杀')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== false) throw new Error('duel 无密钥不应由 controlsChoice 接管,实际 ' + r);
    // 且没有产生 DOM 残留(未触发 collect)
    if(document.body.children.length !== 1) throw new Error('不应产生临时 box');
  });

  // ---- T7:luoyingAsk 无密钥回退 = 旧硬编码 respondLuoying(true)(candidates[0]=获得) ----
  await check('无密钥:luoyingAsk 回退点「获得」=respondLuoying(true)', async function(){
    window.__luoyingCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkG('luoyingAsk', { type: 'luoyingAsk', seat: 0, cardIds: [1, 2], cardsPreview: [{ name: '闪', suit: '♣' }] }, []);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true');
    if(window.__luoyingCalls.length !== 1 || window.__luoyingCalls[0] !== true) throw new Error('应 respondLuoying(true),实际 ' + JSON.stringify(window.__luoyingCalls));
  });

  // 【T8 已移除】原"luoshen 无密钥回退"测试——甄姬【洛神】随"确定正收益技能自动发动"
  // 改造后不再有 g.phase==='luoshen' 这个交互阶段(autoLuoshenRound 直接自动循环判定),
  // CONTROLS_CHOICE_ALLOWLIST 里的 'luoshen' 字面量变成永远不会命中的死配置,不需要
  // 再测这条路径。

  // ================= L1 泛化(Task G2):非 allowlist 阶段有密钥时由 L1 接管 =================
  // 代表阶段选 liuli/tianxiang/lirangRecover/zhengyi:render-controls.js 里这四个阶段
  // 的按钮纯由 g/pending 渲染(不需要客户端 mode 状态),且 runBotDecision 没有它们的
  // 专用分支(落到 2651 之后的 controlsChoice 接线点)。

  // ---- T9:liuli 有密钥 → botDecide 接管,候选=「弃X→目标」组合按钮 ----
  await check('有密钥:liuli 接管,mock 选「弃手牌→目标」→ respondLiuli({kind:hand,idx:0},2)', async function(){
    window.__liuliCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('liuli', { type: 'liuli', from: 1, to: 0, usedAs: '杀', shaColor: 'red', targets: [2] }, [card('杀')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true(已接管),实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__liuliCalls.length !== 1) throw new Error('respondLiuli 应被调1次,实际 ' + window.__liuliCalls.length);
    var c0 = window.__liuliCalls[0];
    if(!c0[0] || c0[0].kind !== 'hand' || c0[0].idx !== 0) throw new Error('应弃手牌idx0,实际 ' + JSON.stringify(c0[0]));
    if(c0[1] !== 2) throw new Error('目标应为2,实际 ' + c0[1]);
    if(document.body.children.length !== 1) throw new Error('临时 box 应已销毁');
  });

  // ---- T10:tianxiang 有密钥接管(弃红桃手牌转移伤害)----
  await check('有密钥:tianxiang 接管,mock 选「弃红桃→目标」→ respondTianxiang({idx:0},2)', async function(){
    window.__tianxiangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('tianxiang', { type: 'tianxiang', seat: 0, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha', targets: [2], resume: { type: 'sha' } }, [card('桃')]);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__tianxiangCalls.length !== 1) throw new Error('respondTianxiang 应被调1次,实际 ' + window.__tianxiangCalls.length);
    var c0 = window.__tianxiangCalls[0];
    if(!c0[0] || c0[0].idx !== 0) throw new Error('应弃idx0,实际 ' + JSON.stringify(c0[0]));
    if(c0[1] !== 2) throw new Error('目标应为2,实际 ' + c0[1]);
  });

  // ---- T11:lirangRecover 有密钥接管(获得弃牌)----
  await check('有密钥:lirangRecover 接管,mock 选「获得弃牌」→ respondLiRangRecover(true)', async function(){
    window.__lirangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('lirangRecover', { type: 'lirangRecover', from: 0, to: 1, cards: [card('闪')] }, []);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0] !== true) throw new Error('应 respondLiRangRecover(true),实际 ' + JSON.stringify(window.__lirangCalls));
  });

  // ---- T12:zhengyi 有密钥接管(发动争义)----
  await check('有密钥:zhengyi 接管,mock 选「发动【争义】」→ respondZhengyi(true)', async function(){
    window.__zhengyiCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('zhengyi', { type: 'zhengyi', asking: 0, seat: 1, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha' }, []);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__zhengyiCalls.length !== 1 || window.__zhengyiCalls[0] !== true) throw new Error('应 respondZhengyi(true),实际 ' + JSON.stringify(window.__zhengyiCalls));
  });

  // ---- T13:同阶段无密钥不再落 botSafePrompt——A类修复(机器人技能覆盖审计)后
  // liuli 补了专属决策分支,无密钥也应该主动发动(而不是像改动前那样靠botSafePrompt命中
  // "不发动"安全正则)。这条断言的语义已经随设计变更更新,不是留着旧行为不管
  // (CLAUDE.md关于"设计变更后要回头检查旧断言"的既定原则)。mkG默认给3个座位都填了
  // role:'zhu'(这个字段在ffa模式下本来就不该有意义,只是这个文件早期的历史写法),会让
  // botTargetScore误判成身份局身份未知、suspicion不够而返回-Infinity——这里显式清成
  // null,还原"乱斗模式没有身份"的真实语义,不能保留误导性的role字段。
  await check('无密钥:liuli 补了专属分支后应主动发动(respondLiuli非null,不再依赖botSafePrompt)', async function(){
    window.__liuliCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkG('liuli', { type: 'liuli', from: 1, to: 0, usedAs: '杀', shaColor: 'red', targets: [2] }, [card('杀')]);
    g.players.forEach(function(p){ p.role = null; });
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== false) throw new Error('无密钥 liuli 不应被 L1 接管,实际 ' + r);
    if(window.__liuliCalls.length !== 0) throw new Error('botDecide 阶段不应点任何按钮');
    await runBotDecision(g, 0);
    if(window.__liuliCalls.length !== 1) throw new Error('runBotDecision 应经专属分支点1次,实际 ' + window.__liuliCalls.length);
    var c0 = window.__liuliCalls[0];
    if(!c0[0] || c0[1] !== 2) throw new Error('应主动发动并转移给座位2,实际 ' + JSON.stringify(c0));
    if(document.body.children.length !== 1) throw new Error('临时 box 应已销毁');
  });

  // ---- T14:EXCLUDE 阶段不被抢(有密钥也返回 false,不触发 collect)----
  await check('EXCLUDE:有密钥 wugu/pick/guicai/ganglieChoice/guhuoQuestion/qiaobianMove/qilin 不被接管', async function(){
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var cases = [
      { phase: 'wugu', pending: { type: 'wugu', order: [0,1,2], idx: 0, pool: [card('桃')] } },
      { phase: 'pick', pending: { type: 'pick', trick: '顺手牵羊', from: 1, to: 0 } },
      { phase: 'guicai', pending: { type: 'guicai', asking: 0, judge: { suit: '♠', rank: 7 } } },
      { phase: 'ganglieChoice', pending: { type: 'ganglieChoice', sourceSeat: 0, damageSeat: 0 } },
      { phase: 'guhuoQuestion', pending: { type: 'guhuoQuestion', asking: 0, actualCard: card('杀'), claimedCard: card('杀') } },
      { phase: 'qiaobianMove', pending: { type: 'qiaobianMove', seat: 0 } },
      { phase: 'qilin', pending: { type: 'qilin', from: 0, to: 1 } },
    ];
    for(var i = 0; i < cases.length; i++){
      var g = mkG(cases[i].phase, cases[i].pending, []);
      var r = await botDecide('controlsChoice', g, 0);
      if(r !== false) throw new Error(cases[i].phase + ' 不应被 L1 接管,实际 ' + r);
    }
    if(document.body.children.length !== 1) throw new Error('EXCLUDE 阶段不应产生临时 box');
  });

  // ---- T15:接线端到端:runBotDecision 在 liuli 阶段经 controlsChoice 接管,无双重处理 ----
  await check('接线:runBotDecision liuli 有密钥 → controlsChoice 接管,respondLiuli 只调1次', async function(){
    window.__liuliCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('liuli', { type: 'liuli', from: 1, to: 0, usedAs: '杀', shaColor: 'red', targets: [2] }, [card('杀')]);
    await runBotDecision(g, 0);
    if(window.__liuliCalls.length !== 1) throw new Error('respondLiuli 应只被调1次(无双重处理),实际 ' + window.__liuliCalls.length);
    var c0 = window.__liuliCalls[0];
    if(!c0[0] || c0[0].kind !== 'hand' || c0[0].idx !== 0) throw new Error('应弃手牌idx0,实际 ' + JSON.stringify(c0[0]));
    if(c0[1] !== 2) throw new Error('目标应为2,实际 ' + c0[1]);
  });

  // ================= Task G3:分配类纯按钮阶段 L1 覆盖补全验证 =================
  // G2 已断言 liuli/tianxiang/lirangRecover/zhengyi 有密钥接管(choice 0 侧)与 liuli
  // 无密钥回退。这里补齐:候选文案镜像、choice 1 侧、其余三阶段无密钥对照、以及
  // xiaoguo/xiaoguoChoice 的 EXCLUDE 证明(L1 自动覆盖集只有 4 个阶段,骁果不在其中,
  // 见 bot.js CONTROLS_CHOICE_EXCLUDE 与 BOT_PHASE_ACTOR)。

  // ---- T16:四个被覆盖阶段候选文案 = 真实渲染按钮镜像(collect 直取)----
  await check('collect:liuli/tianxiang/lirangRecover/zhengyi 候选文案镜像真实按钮', function(){
    var cases = [
      // CORE-101(issue #148):候选文案不再用玩家自定义昵称,改用AI专用稳定标识"座位N"
      // (座位号从1开始;mkG构造的测试局座位2没有分配general,不带武将名后缀)。
      { name: 'liuli', g: mkG('liuli', { type: 'liuli', from: 1, to: 0, usedAs: '杀', shaColor: 'red', targets: [2] }, [card('杀')]),
        expect: ['弃手牌【杀】 → 座位3', '不发动'] },
      { name: 'tianxiang', g: mkG('tianxiang', { type: 'tianxiang', seat: 0, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha', targets: [2], resume: { type: 'sha' } }, [card('桃')]),
        expect: ['弃【桃】 → 座位3', '不发动'] },
      { name: 'lirangRecover', g: mkG('lirangRecover', { type: 'lirangRecover', from: 0, to: 1, cards: [card('闪')] }, []),
        expect: ['获得弃牌', '不获得'] },
      { name: 'zhengyi', g: mkG('zhengyi', { type: 'zhengyi', asking: 0, seat: 1, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha' }, []),
        expect: ['发动【争义】', '不发动'] },
    ];
    for(var i = 0; i < cases.length; i++){
      var res = collectControlsCandidates(cases[i].g, 0);
      try{
        var labels = res.candidates.map(function(c){ return c.label; });
        if(labels.length !== cases[i].expect.length) throw new Error(cases[i].name + ' 候选数应=' + cases[i].expect.length + ' 实际 ' + JSON.stringify(labels));
        for(var j = 0; j < cases[i].expect.length; j++){
          if(labels[j] !== cases[i].expect[j]) throw new Error(cases[i].name + ' 候选' + j + ' 应「' + cases[i].expect[j] + '」实际「' + labels[j] + '」');
        }
      } finally {
        res.dispose();
      }
    }
  });

  // ---- T17:lirangRecover/zhengyi 有密钥 mock 选第2项(choice 1),补全候选对 ----
  await check('有密钥:lirangRecover mock 选「不获得」→ respondLiRangRecover(false)', async function(){
    window.__lirangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('lirangRecover', { type: 'lirangRecover', from: 0, to: 1, cards: [card('闪')] }, []);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0] !== false) throw new Error('应 respondLiRangRecover(false),实际 ' + JSON.stringify(window.__lirangCalls));
    var up = window.__mockAiArgs.opts.userPrompt || '';
    if(up.indexOf('获得弃牌') < 0 || up.indexOf('不获得') < 0) throw new Error('userPrompt 应含「获得弃牌」「不获得」,实际 ' + up);
  });

  await check('有密钥:zhengyi mock 选「不发动」→ respondZhengyi(false)', async function(){
    window.__zhengyiCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('zhengyi', { type: 'zhengyi', asking: 0, seat: 1, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha' }, []);
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__zhengyiCalls.length !== 1 || window.__zhengyiCalls[0] !== false) throw new Error('应 respondZhengyi(false),实际 ' + JSON.stringify(window.__zhengyiCalls));
    var up = window.__mockAiArgs.opts.userPrompt || '';
    if(up.indexOf('发动【争义】') < 0 || up.indexOf('不发动') < 0) throw new Error('userPrompt 应含「发动【争义】」「不发动」,实际 ' + up);
  });

  // ---- T18:无密钥对照(tianxiang/lirangRecover/zhengyi,补齐 liuli 之外的三个)----
  // 【A类修复(机器人技能覆盖审计)后语义更新】三个此前都靠botSafePrompt兜底,现在都补了
  // 专属分支:tianxiang对自己没有明显下行风险(1张红桃换免疫伤害),固定主动转移;
  // lirangRecover零代价纯收益,固定主动回收;zhengyi是纯粹自我牺牲换不到直接回报,
  // 保守默认不发动(和改动前的"不发动"结果一样,但现在是专属分支决定的,不是
  // botSafePrompt兜底侥幸)。tianxiang同liuli一样依赖botTargetScore判断目标,清掉
  // mkG历史遗留的role:'zhu'(ffa模式本不该有身份)避免被误判成身份局。
  await check('无密钥:tianxiang/lirangRecover主动发动,zhengyi保守默认不发动(均走专属分支,不再是botSafePrompt兜底)', async function(){
    aiApiKey = '';
    aiProvider = null;
    window.__tianxiangCalls = [];
    window.__lirangCalls = [];
    window.__zhengyiCalls = [];

    var g1 = mkG('tianxiang', { type: 'tianxiang', seat: 0, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha', targets: [2], resume: { type: 'sha' } }, [card('桃')]);
    g1.players.forEach(function(p){ p.role = null; });
    var r1 = await botDecide('controlsChoice', g1, 0);
    if(r1 !== false) throw new Error('tianxiang 无密钥不应被 L1 接管,实际 ' + r1);
    await runBotDecision(g1, 0);
    if(window.__tianxiangCalls.length !== 1) throw new Error('tianxiang 应经专属分支点1次,实际 ' + window.__tianxiangCalls.length);
    var t0 = window.__tianxiangCalls[0];
    if(!t0[0] || t0[1] !== 2) throw new Error('tianxiang 应主动发动并转移给座位2,实际 ' + JSON.stringify(t0));

    var g2 = mkG('lirangRecover', { type: 'lirangRecover', from: 0, to: 1, cards: [card('闪')] }, []);
    var r2 = await botDecide('controlsChoice', g2, 0);
    if(r2 !== false) throw new Error('lirangRecover 无密钥不应被 L1 接管,实际 ' + r2);
    await runBotDecision(g2, 0);
    // A类修复:lirangRecover零代价纯收益(respondLiRangRecover(true)只是白得弃牌,
    // 没有任何代价),专属分支固定选择"获得"——不再是安全正则侥幸命中"不获得"。
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0] !== true)
      throw new Error('lirangRecover 应主动回收=respondLiRangRecover(true),实际 ' + JSON.stringify(window.__lirangCalls));

    var g3 = mkG('zhengyi', { type: 'zhengyi', asking: 0, seat: 1, amount: 1, sourceSeat: 1, reason: 'sha', srcType: 'sha' }, []);
    var r3 = await botDecide('controlsChoice', g3, 0);
    if(r3 !== false) throw new Error('zhengyi 无密钥不应被 L1 接管,实际 ' + r3);
    await runBotDecision(g3, 0);
    if(window.__zhengyiCalls.length !== 1 || window.__zhengyiCalls[0] !== false) throw new Error('zhengyi 应经专属分支点「不发动」=respondZhengyi(false),实际 ' + JSON.stringify(window.__zhengyiCalls));

    if(document.body.children.length !== 1) throw new Error('临时 box 应已销毁');
  });

  // ---- T19:A1 后 EXCLUDE 调整锁定:xiaoguo 已移除(专用注册+接线先于 L1 保护,
  // 见 l3 接线测试);xiaoguoChoice 已移除(L1 可镜像其纯 pending 渲染按钮,见 T20) ----
  await check('EXCLUDE调整:xiaoguo/xiaoguoChoice 已从 CONTROLS_CHOICE_EXCLUDE 移除', async function(){
    if(CONTROLS_CHOICE_EXCLUDE.has('xiaoguo'))
      throw new Error('xiaoguo 有专用注册+接线(先于 controlsChoice),不应留在 EXCLUDE');
    if(CONTROLS_CHOICE_EXCLUDE.has('xiaoguoChoice'))
      throw new Error('xiaoguoChoice 按钮纯由 pending 渲染(弃置X【装备】/受到1点伤害),应由 L1 接管,不应留在 EXCLUDE');
  });

  // ---- T20:xiaoguoChoice 有密钥由 L1 接管(镜像「弃置X【装备】/受到1点伤害」按钮) ----
  await check('有密钥:xiaoguoChoice 由 L1 接管,mock 选「弃置武器」→ respondXiaoguoChoice(weapon)', async function(){
    window.__xiaoguoChoiceCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkG('xiaoguoChoice', { type: 'xiaoguoChoice', from: 1, to: 0, endingSeat: 1 }, []);
    g.players[0].equips.weapon = card('青釭剑');
    var r = await botDecide('controlsChoice', g, 0);
    if(r !== true) throw new Error('应返回 true(已接管),实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__xiaoguoChoiceCalls.length !== 1 || window.__xiaoguoChoiceCalls[0] !== 'weapon')
      throw new Error('应 respondXiaoguoChoice(weapon),实际 ' + JSON.stringify(window.__xiaoguoChoiceCalls));
    if(document.body.children.length !== 1) throw new Error('临时 box 应已销毁');
  });

  // ---- 渲染层bug回归:袁绍【乱击】luanjiChoose/luanjiConfirm 此前被写死嵌套在
  // g.phase==='play' 的大分支里,而 startLuanji()/pickLuanjiPair() 把 g.phase 切到
  // 'luanjiChoose'/'luanjiConfirm' 后,渲染条件永远对不上,面板对任何人都渲染不出来。
  // 这两条断言直接验证渲染层修复本身(真的能收集到按钮),不是机器人决策分支。 ----
  await check('渲染层修复:luanjiChoose 能收集到牌对按钮+取消按钮(此前渲染不出任何按钮)', function(){
    var g = mkG('luanjiChoose',
      { type: 'luanjiChoose', sourceSeat: 0, availablePairs: [[0, 1]] },
      [card('杀'), card('闪')]);
    var res = collectControlsCandidates(g, 0);
    try{
      if(res.candidates.length !== 2) throw new Error('应恰2个按钮(牌对+取消),实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label.indexOf('杀') < 0 || res.candidates[0].label.indexOf('闪') < 0)
        throw new Error('按钮0应是牌对组合,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '取消') throw new Error('按钮1应为取消,实际 ' + res.candidates[1].label);
    } finally {
      res.dispose();
    }
  });

  await check('渲染层修复:luanjiConfirm 能收集到确认+取消按钮(此前渲染不出任何按钮)', function(){
    var g = mkG('luanjiConfirm',
      { type: 'luanjiConfirm', sourceSeat: 0, cardIndices: [0, 1] },
      [card('杀'), card('闪')]);
    var res = collectControlsCandidates(g, 0);
    try{
      if(res.candidates.length !== 2) throw new Error('应恰2个按钮(确认+取消),实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label !== '确认') throw new Error('按钮0应为确认,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '取消') throw new Error('按钮1应为取消,实际 ' + res.candidates[1].label);
    } finally {
      res.dispose();
    }
  });

  // ---- 渲染层bug回归(典韦【强袭】,和乱击同一批发现的同一类问题):此前 qiangxiChooseCost/
  // qiangxiChooseWeaponFromHand/qiangxiPickTarget 三段被写死嵌套在 g.phase==='draw' 大分支
  // 内部,面板对任何人都渲染不出来。 ----
  await check('渲染层修复:强袭qiangxiChooseCost 能收集到支付方式按钮(手持武器,此前渲染不出任何按钮)', function(){
    var g = mkG('qiangxiChooseCost', { type: 'qiangxiChooseCost', seat: 0 }, [card('青龙偃月刀')]);
    var res = collectControlsCandidates(g, 0);
    try{
      // 手牌里有真实武器名(EQUIPS表可识别)+hp>1,两个支付方式都应出现,加取消共3个
      if(res.candidates.length !== 3) throw new Error('应恰3个按钮(失去体力+弃武器+取消),实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label !== '失去1点体力') throw new Error('按钮0应为失去1点体力,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '弃置一张武器牌') throw new Error('按钮1应为弃置一张武器牌,实际 ' + res.candidates[1].label);
      if(res.candidates[2].label !== '取消') throw new Error('按钮2应为取消,实际 ' + res.candidates[2].label);
    } finally {
      res.dispose();
    }
  });

  await check('渲染层修复:强袭qiangxiChooseWeaponFromHand 能收集到武器牌按钮(此前渲染不出任何按钮)', function(){
    var g = mkG('qiangxiChooseWeaponFromHand',
      { type: 'qiangxiChooseWeaponFromHand', seat: 0, weaponIndices: [0] },
      [card('青龙偃月刀')]);
    var res = collectControlsCandidates(g, 0);
    try{
      if(res.candidates.length !== 2) throw new Error('应恰2个按钮(武器牌+取消),实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label.indexOf('青龙偃月刀') < 0) throw new Error('按钮0应含武器名,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '取消') throw new Error('按钮1应为取消,实际 ' + res.candidates[1].label);
    } finally {
      res.dispose();
    }
  });

  await check('渲染层修复:强袭qiangxiPickTarget 能收集到目标按钮(此前渲染不出任何按钮)', function(){
    var g = mkG('qiangxiPickTarget', { type: 'qiangxiPickTarget', seat: 0, costType: 'hp', candidates: [1, 2] }, []);
    var res = collectControlsCandidates(g, 0);
    try{
      // 强袭消耗支付后不可取消,只有目标按钮,没有取消按钮
      // CORE-101(issue #148):按钮文案不再用玩家自定义昵称,改用"座位N"标识。
      if(res.candidates.length !== 2) throw new Error('应恰2个目标按钮,实际 ' + res.candidates.length + ' labels=' + JSON.stringify(res.candidates.map(function(c){return c.label;})));
      if(res.candidates[0].label !== '座位2') throw new Error('按钮0应为座位2,实际 ' + res.candidates[0].label);
      if(res.candidates[1].label !== '座位3') throw new Error('按钮1应为座位3,实际 ' + res.candidates[1].label);
    } finally {
      res.dispose();
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

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
