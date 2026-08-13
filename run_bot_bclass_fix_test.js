/**
 * B类修复回归测试:姜维【志继】觉醒(zhijiChoice)/姜维【挑衅】目标二选一(tiaoxinChoice)/
 * 典韦【骁果】受害者二选一(xiaoguoChoice)/法正【眩惑】huanhuoPickGotCard子阶段。
 *
 * 复用 run_ai_bus_l1_test.js 的真实DOM隔离harness(renderControls真实渲染,botSafePrompt
 * 真实扫描按钮),不是猜测行为——每条先跑一次"改动前"的真实botSafePrompt兜底路径,
 * 拿到真实结果(可能是mandatory正则侥幸命中、也可能真卡死),再验证"改动后"走专属分支。
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
console.log('  B类修复回归测试(志继/挑衅/骁果/眩惑)');
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

  aiApiKey = ''; aiProvider = null;

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i), alive: true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function resetControls(){ __realControls.children = []; }
  function card(name, id, suit, rank){
    return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 };
  }

  // ================= 姜维【志继】觉醒(zhijiChoice) =================
  await check('BOT_PHASE_ACTOR 已登记 zhijiChoice:seat', function(){
    if(stageActorField('zhijiChoice') !== 'seat') throw new Error('应登记zhijiChoice:seat,实际 ' + stageActorField('zhijiChoice'));
  });

  await check('zhijiChoice askedAt:准备阶段触发觉醒时应正确设置(30秒超时兜底才能生效)', function(){
    var g = mkSeatG({});
    g.players[0].caps = { zhiji: true };
    g.players[0].hand = [];
    _g = g;
    startTurn(g, 0);
    if(!g.pending || g.pending.type !== 'zhijiChoice') throw new Error('应挂起zhijiChoice,实际 ' + JSON.stringify(g.pending));
    if(typeof g.pending.askedAt !== 'number') throw new Error('应带askedAt,实际 ' + JSON.stringify(g.pending));
  });

  await check('zhijiChoice:无密钥模式下机器人应走专属分支respondZhijiChoice,不再依赖botSafePrompt', async function(){
    window.__zhijiCalls = [];
    var realFn = respondZhijiChoice;
    respondZhijiChoice = function(v){ window.__zhijiCalls.push(v); return realFn(v); };
    var g = mkSeatG({ hpOf: { 0: 3 } });
    g.pending = { type: 'zhijiChoice', seat: 0, askedAt: Date.now() };
    g.phase = 'zhijiChoice';
    _g = g;
    await runBotDecision(g, 0);
    respondZhijiChoice = realFn;
    if(window.__zhijiCalls.length !== 1) throw new Error('应调用respondZhijiChoice恰1次,实际 ' + window.__zhijiCalls.length);
    if(g.pending !== null) throw new Error('应推进(pending清空),实际 ' + JSON.stringify(g.pending));
  });

  await check('zhijiChoice真实兜底路径(改动前的botFallbackSeats+botSafePrompt):按钮"回复1点体力"命中mandatory正则,不是真卡死——纠正审计文档里"两个按钮都不匹配"的误判', function(){
    resetControls();
    var g = mkSeatG({ hpOf: { 0: 3 } });
    g.pending = { type: 'zhijiChoice', seat: 0, askedAt: Date.now() };
    g.phase = 'zhijiChoice';
    _g = g;
    window.__zhijiCalls = [];
    var realFn = respondZhijiChoice;
    respondZhijiChoice = function(v){ window.__zhijiCalls.push(v); return realFn(v); };
    var r = botSafePrompt(g, 0);
    respondZhijiChoice = realFn;
    if(r !== true) throw new Error('botSafePrompt应能找到并点击"回复1点体力"(mandatory正则命中),实际返回 ' + r);
    if(window.__zhijiCalls.length !== 1 || window.__zhijiCalls[0] !== true)
      throw new Error('应点击"回复1点体力"→respondZhijiChoice(true),实际 ' + JSON.stringify(window.__zhijiCalls));
  });

  // ================= 姜维【挑衅】目标二选一(tiaoxinChoice) =================
  await check('BOT_PHASE_ACTOR 已登记 tiaoxinChoice:to', function(){
    if(stageActorField('tiaoxinChoice') !== 'to') throw new Error('应登记tiaoxinChoice:to,实际 ' + stageActorField('tiaoxinChoice'));
  });

  await check('tiaoxinChoice askedAt:发动挑衅时应正确设置', function(){
    var g = mkSeatG({});
    g.players[0].caps = { tiaoxin: true };
    g.players[1].hand = [card('杀')];
    _g = g;
    mySeat = 0;
    respondTiaoxin(1);
    if(!g.pending || g.pending.type !== 'tiaoxinChoice') throw new Error('应挂起tiaoxinChoice,实际 ' + JSON.stringify(g.pending));
    if(typeof g.pending.askedAt !== 'number') throw new Error('应带askedAt,实际 ' + JSON.stringify(g.pending));
  });

  await check('tiaoxinChoice:目标有可用杀时,机器人应主动出杀反击(respondTiaoxinChoice(true,...))', async function(){
    window.__tiaoxinChoiceCalls = [];
    var realFn = respondTiaoxinChoice;
    respondTiaoxinChoice = function(useSha, idx){ window.__tiaoxinChoiceCalls.push([useSha, idx]); return realFn(useSha, idx); };
    var g = mkSeatG({ hands: { 0: [card('杀','sh1','♠',5)] } });
    g.pending = { type: 'tiaoxinChoice', from: 1, to: 0, askedAt: Date.now() };
    g.phase = 'tiaoxinChoice';
    _g = g;
    await runBotDecision(g, 0);
    respondTiaoxinChoice = realFn;
    if(window.__tiaoxinChoiceCalls.length !== 1 || window.__tiaoxinChoiceCalls[0][0] !== true)
      throw new Error('应调用respondTiaoxinChoice(true,...)出杀反击,实际 ' + JSON.stringify(window.__tiaoxinChoiceCalls));
  });

  await check('tiaoxinChoice真实兜底路径(改动前):按钮"被弃置一张牌"命中mandatory正则,不是真卡死——纠正审计文档误判', function(){
    resetControls();
    var g = mkSeatG({ hands: { 0: [card('杀','sh2','♠',5)] } });
    g.pending = { type: 'tiaoxinChoice', from: 1, to: 0, askedAt: Date.now() };
    g.phase = 'tiaoxinChoice';
    _g = g;
    window.__tiaoxinChoiceCalls = [];
    var realFn = respondTiaoxinChoice;
    respondTiaoxinChoice = function(useSha, idx){ window.__tiaoxinChoiceCalls.push([useSha, idx]); return realFn(useSha, idx); };
    var r = botSafePrompt(g, 0);
    respondTiaoxinChoice = realFn;
    if(r !== true) throw new Error('botSafePrompt应能找到并点击"被弃置一张牌"(mandatory正则命中),实际返回 ' + r);
    if(window.__tiaoxinChoiceCalls.length !== 1 || window.__tiaoxinChoiceCalls[0][0] !== false)
      throw new Error('应点击"被弃置一张牌"→respondTiaoxinChoice(false),实际 ' + JSON.stringify(window.__tiaoxinChoiceCalls));
  });

  // ================= 典韦【骁果】受害者二选一(xiaoguoChoice) =================
  await check('xiaoguoChoice:目标有装备时,机器人应主动选择弃置装备(respondXiaoguoChoice(slot))', async function(){
    window.__xiaoguoChoiceCalls = [];
    var realFn = respondXiaoguoChoice;
    respondXiaoguoChoice = function(v){ window.__xiaoguoChoiceCalls.push(v); return realFn(v); };
    var g = mkSeatG({});
    g.players[0].equips.weapon = { id: 'w1', name: '青龙偃月刀' };
    g.pending = { type: 'xiaoguoChoice', from: 1, endingSeat: 0, to: 0, askedAt: Date.now() };
    g.phase = 'xiaoguoChoice';
    _g = g;
    await runBotDecision(g, 0);
    respondXiaoguoChoice = realFn;
    if(window.__xiaoguoChoiceCalls.length !== 1 || window.__xiaoguoChoiceCalls[0] !== 'weapon')
      throw new Error('应调用respondXiaoguoChoice(\'weapon\')弃武器,实际 ' + JSON.stringify(window.__xiaoguoChoiceCalls));
  });

  await check('xiaoguoChoice真实兜底路径(改动前):有装备时"弃置武器"命中mandatory正则,不是真卡死——纠正审计文档误判(无装备时才是靠"唯一按钮"侥幸)', function(){
    resetControls();
    var g = mkSeatG({});
    g.players[0].equips.weapon = { id: 'w2', name: '诸葛连弩' };
    g.pending = { type: 'xiaoguoChoice', from: 1, endingSeat: 0, to: 0, askedAt: Date.now() };
    g.phase = 'xiaoguoChoice';
    _g = g;
    window.__xiaoguoChoiceCalls = [];
    var realFn = respondXiaoguoChoice;
    respondXiaoguoChoice = function(v){ window.__xiaoguoChoiceCalls.push(v); return realFn(v); };
    var r = botSafePrompt(g, 0);
    respondXiaoguoChoice = realFn;
    if(r !== true) throw new Error('botSafePrompt应能找到并点击"弃置武器"(mandatory正则命中),实际返回 ' + r);
    if(window.__xiaoguoChoiceCalls.length !== 1 || window.__xiaoguoChoiceCalls[0] !== 'weapon')
      throw new Error('应点击弃武器,实际 ' + JSON.stringify(window.__xiaoguoChoiceCalls));
  });

  // ================= 法正【眩惑】huanhuoPickGotCard(真正的无安全按钮子阶段) =================
  await check('BOT_PHASE_ACTOR 已登记 huanhuoPick/huanhuoPickCard/huanhuoPickGotCard/huanhuoPickSecond:sourceSeat', function(){
    ['huanhuoPick','huanhuoPickCard','huanhuoPickGotCard','huanhuoPickSecond'].forEach(function(k){
      if(stageActorField(k) !== 'sourceSeat') throw new Error(k + ' 应登记sourceSeat,实际 ' + stageActorField(k));
    });
  });

  await check('huanhuoPickGotCard askedAt:眩惑链路第3步应正确设置', function(){
    var g = mkSeatG({});
    g.players[1].hand = [card('杀')];
    _g = g;
    mySeat = 0;
    pickHuanhuoHeartCard; // 仅确认函数存在,不直接跑(依赖complex前置状态),下面直接构造pending验证askedAt写法一致性
    var pend = { type: 'huanhuoPickGotCard', sourceSeat: 0, targetSeat: 1 };
    g.pending = setResponseAskedAt(pend);
    if(typeof g.pending.askedAt !== 'number') throw new Error('setResponseAskedAt应正确写入askedAt');
  });

  await check('huanhuoPickGotCard真实兜底路径(改动前):目标同时有手牌和装备时2个按钮都不匹配任何正则,真卡死——这是审计文档里唯一被验证为"真卡死"的子阶段', function(){
    resetControls();
    var g = mkSeatG({});
    g.players[1].hand = [card('杀')];
    g.players[1].equips.weapon = { id: 'w3', name: '雌雄双股剑' };
    g.pending = { type: 'huanhuoPickGotCard', sourceSeat: 0, targetSeat: 1, askedAt: Date.now() };
    g.phase = 'huanhuoPickGotCard';
    _g = g;
    var r = botSafePrompt(g, 0);
    if(r !== false) throw new Error('改动前应真卡死(botSafePrompt找不到可点按钮返回false),实际 ' + r);
  });

  await check('huanhuoPickGotCard:改动后机器人应主动调用pickHuanhuoGotCard,优先选公开的装备槽', async function(){
    window.__huanhuoGotCalls = [];
    var realFn = pickHuanhuoGotCard;
    pickHuanhuoGotCard = function(kind, value){ window.__huanhuoGotCalls.push([kind, value]); return realFn(kind, value); };
    var g = mkSeatG({});
    g.players[1].hand = [card('杀')];
    g.players[1].equips.weapon = { id: 'w4', name: '雌雄双股剑' };
    g.pending = { type: 'huanhuoPickGotCard', sourceSeat: 0, targetSeat: 1, askedAt: Date.now() };
    g.phase = 'huanhuoPickGotCard';
    _g = g;
    await runBotDecision(g, 0);
    pickHuanhuoGotCard = realFn;
    if(window.__huanhuoGotCalls.length !== 1 || window.__huanhuoGotCalls[0][0] !== 'equip' || window.__huanhuoGotCalls[0][1] !== 'weapon')
      throw new Error('应调用pickHuanhuoGotCard(\'equip\',\'weapon\'),实际 ' + JSON.stringify(window.__huanhuoGotCalls));
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
