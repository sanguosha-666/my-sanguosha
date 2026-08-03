/**
 * AI 总线 L3 层测试 - seatPick 通用座位协议(蛊惑目标/旋风目标)
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot/ai-bot/render)
 * 进共享 vm 沙箱(与 run_ai_bus_l2_test.js 同一套 firebase/document/window stub 与
 * 异步 check 断言惯例)。注意:本次三个服务端目标函数(guhuoActionId/guhuoChooseTarget
 * 在 skills.js、pickXuanfengTarget 在 game.js)全部位于 bot.js 之前的加载序里,不需要
 * 任何额外 stub;render.js 按 brief 要求加载(真实文件,顶层事件绑定由既有 stub 满足:
 * document.addEventListener/getElementById/classList/window.addEventListener 均有)。
 *
 * 覆盖:
 *  - seatPick 空表 → botDecide('seatPick') 返回 false(旧分支)
 *  - 蛊惑目标:候选=canTarget 合法目标;无密钥 fallback=null → true 且不调
 *    guhuoChooseTarget;有密钥 mock 选目标 → guhuoChooseTarget(座位);userPrompt 含
 *    声明牌名、不含他人手牌名
 *  - 旋风目标:候选=存活非自己;有密钥 mock → pickXuanfengTarget;无密钥 null 不崩
 *
 * 已知的 vm 坑:aiApiKey/aiProvider 是 ai-bot.js 脚本作用域的 let 绑定,必须用
 * runInContext 里裸标识符赋值;guhuoChooseTarget/pickXuanfengTarget/callAI 都是函数
 * 声明绑定,可直接在 runInContext 里整体替换成 spy。
 */

const vm = require('vm');
const fs = require('fs');

// run_lidian_test.js 的 firebase/document/window stub(该 harness 已成功加载 game.js)
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
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; } }; },
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

const sandbox = vm.createContext(context, { name: 'sgs-ai-bus-l3-sandbox' });

console.log('Loading AI 总线 L3 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot.js 在 game.js 之后、ai-bot.js 最后、render.js 殿后。
const files = ['config.js', 'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot.js', 'ai-bot.js', 'render.js'];
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
console.log('  AI 总线 L3 测试(seatPick 通用座位协议)');
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

  // ---- spy:guhuoChooseTarget/pickXuanfengTarget/callAI(函数声明绑定,整体替换) ----
  window.__guhuoTargetCalls = [];
  window.__xuanfengCalls = [];
  window.__mockAiCalls = 0;
  window.__mockAiArgs = null;
  window.__mockAiResults = [];
  guhuoChooseTarget = function(targetSeat){ window.__guhuoTargetCalls.push(targetSeat); };
  pickXuanfengTarget = function(seat){ window.__xuanfengCalls.push(seat); };
  callAI = async function(provider, apiKey, opts){
    window.__mockAiCalls++;
    window.__mockAiArgs = { provider: provider, apiKey: apiKey, opts: opts };
    return window.__mockAiResults.length ? window.__mockAiResults.shift() : { ok: false, reason: 'other', detail: '队列已空' };
  };

  // 构造 3 人局:座位0是机器人自己,手牌/存活自定
  function mkSeatG(opt){
    opt = opt || {};
    var players = [];
    for(var i = 0; i < 3; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: opt.aliveOf ? opt.aliveOf[i] !== false : true,
        hp: 4, maxHp: 4,
        hand: i === 0 ? (opt.myHand || []) : (opt.hands ? (opt.hands[i] || []) : []),
        equips: emptyEquips(), delays: [],
        isBot: i === 0,
        role: 'zhu',
        general: 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true };
  }
  function card(name, id){
    return { id: id || (name + ''), name: name, suit: '♥', rank: 5 };
  }

  // ---- T1:注册表行为(Step 1 的最终形态)——BOT_SEAT_PICKS 存在且只含本项目注册的
  // 2 个技能;无技能命中的状态下 botDecide('seatPick') 返回 false(走旧分支)。 ----
  await check('BOT_SEAT_PICKS 存在且只含 guhuoTarget/xuanfeng;无命中时 botDecide 返回 false', async function(){
    if(typeof BOT_SEAT_PICKS === 'undefined') throw new Error('BOT_SEAT_PICKS 未定义');
    var keys = Object.keys(BOT_SEAT_PICKS).sort().join(',');
    if(keys !== 'guhuoTarget,xuanfeng') throw new Error('注册表应恰为 guhuoTarget,xuanfeng,实际 ' + keys);
    var g = mkSeatG({});
    var r = await botDecide('seatPick', g, 0);
    if(r !== false) throw new Error('无技能命中应返回 false(走旧分支),实际 ' + r);
  });

  // ---- T2:harness 自检——全链路加载(含 render.js)+ spy 函数声明绑定 ----
  await check('harness 自检:render.js 已加载,guhuoChooseTarget/pickXuanfengTarget 可替换', function(){
    if(typeof render !== 'function') throw new Error('render 未加载(render.js 加载失败)');
    if(typeof guhuoActionId !== 'function') throw new Error('guhuoActionId 未加载(skills.js)');
    if(typeof guhuoChooseTarget !== 'function') throw new Error('guhuoChooseTarget 未加载');
    if(typeof pickXuanfengTarget !== 'function') throw new Error('pickXuanfengTarget 未加载(game.js)');
    window.__guhuoTargetCalls = [];
    guhuoChooseTarget(7);
    if(window.__guhuoTargetCalls.length !== 1 || window.__guhuoTargetCalls[0] !== 7)
      throw new Error('spy 替换失败,实际 ' + JSON.stringify(window.__guhuoTargetCalls));
  });

  // ---- T3:seatPick match 语义——普通 play 阶段无技能命中 → false ----
  await check('seatPick:普通出牌阶段(无匹配 pending)match 为 false', async function(){
    var g = mkSeatG({});
    var r = await botDecide('seatPick', g, 0);
    if(r !== false) throw new Error('普通 play 无技能命中应返回 false,实际 ' + r);
  });

  // ================= 蛊惑目标(guhuoTarget) =================
  // pending 服务端真实结构(skills.js startGuhuo 链):{type:'guhuoTarget',sourceSeat,
  // actualCard,claimedCard};合法性与 render.js 座位卡分支同源(canTarget)。
  function mkGuhuoG(opt){
    var g = mkSeatG(opt);
    g.phase = 'guhuoTarget';
    g.pending = {
      type: 'guhuoTarget',
      sourceSeat: 0,
      actualCard: { id: 'hid', name: '无中生有', suit: '♠', rank: 9 },
      claimedCard: card('杀', 'claimed')
    };
    return g;
  }

  await check('蛊惑目标:候选=canTarget 合法目标(座位1/2),不含自己', function(){
    var g = mkGuhuoG({});
    var spec = BOT_SEAT_PICKS.guhuoTarget;
    if(!spec) throw new Error('BOT_SEAT_PICKS.guhuoTarget 未注册');
    if(!spec.match(g, 0)) throw new Error('sourceSeat 本人 match 应命中');
    if(spec.match(g, 1)) throw new Error('非 sourceSeat 不应命中');
    var cands = spec.buildSeatCandidates(g, 0);
    if(cands.length !== 2) throw new Error('应为2个候选(座位1/2),实际 ' + cands.length + ' ' + JSON.stringify(cands));
    var seats = cands.map(function(c){ return c.seat; }).sort().join(',');
    if(seats !== '1,2') throw new Error('候选座位应为1,2,实际 ' + seats);
    if(cands[0].label.indexOf('蛊惑') < 0) throw new Error('label 应含 蛊惑 前缀,实际 ' + cands[0].label);
  });

  await check('蛊惑目标无密钥:fallback=null → botDecide 返回 true 且不调 guhuoChooseTarget', async function(){
    window.__guhuoTargetCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkGuhuoG({});
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('fallback=null 应视为"无动作已处理"返回 true,实际 ' + r);
    if(window.__guhuoTargetCalls.length !== 0) throw new Error('不应调用 guhuoChooseTarget,实际 ' + window.__guhuoTargetCalls.length);
  });

  await check('蛊惑目标有密钥:mock 选座位2 → guhuoChooseTarget(2);userPrompt 含声明牌名不含他人手牌', async function(){
    window.__guhuoTargetCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkGuhuoG({ hands: { 1: [card('桃园结义', 'sec')] } }); // 玩家1手牌=隐藏信息
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__guhuoTargetCalls.length !== 1) throw new Error('guhuoChooseTarget 应被调1次,实际 ' + window.__guhuoTargetCalls.length);
    if(window.__guhuoTargetCalls[0] !== 2) throw new Error('AI应选座位2(choice1),实际 ' + window.__guhuoTargetCalls[0]);
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('杀') < 0) throw new Error('userPrompt 应含声明牌名(杀),实际 ' + up);
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    if(up.indexOf('无中生有') >= 0) throw new Error('userPrompt 泄露真实扣置牌(无中生有)!实际 ' + up);
  });

  // ================= 旋风目标(xuanfeng) =================
  function mkXuanfengG(opt){
    var g = mkSeatG(opt);
    g.pending = { type: 'xuanfengPick', from: 0, stage: 'selecting' };
    return g;
  }

  await check('旋风目标:候选=存活非自己(死者排除)', function(){
    var g = mkXuanfengG({ aliveOf: { 2: false } });
    var spec = BOT_SEAT_PICKS.xuanfeng;
    if(!spec) throw new Error('BOT_SEAT_PICKS.xuanfeng 未注册');
    if(!spec.match(g, 0)) throw new Error('from 本人 match 应命中');
    if(spec.match(g, 1)) throw new Error('非 from 不应命中');
    var cands = spec.buildSeatCandidates(g, 0);
    if(cands.length !== 1) throw new Error('座位2已死,应只剩1个候选,实际 ' + cands.length + ' ' + JSON.stringify(cands));
    if(cands[0].seat !== 1) throw new Error('应只剩座位1,实际 ' + cands[0].seat);
    if(cands[0].label.indexOf('旋风') < 0) throw new Error('label 应含 旋风 前缀,实际 ' + cands[0].label);
  });

  await check('旋风目标无密钥:fallback=null → botDecide 返回 true 且不调 pickXuanfengTarget', async function(){
    window.__xuanfengCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkXuanfengG({});
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('fallback=null 应返回 true,实际 ' + r);
    if(window.__xuanfengCalls.length !== 0) throw new Error('不应调用 pickXuanfengTarget,实际 ' + window.__xuanfengCalls.length);
  });

  await check('旋风目标有密钥:mock 选座位1 → pickXuanfengTarget(1)', async function(){
    window.__xuanfengCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkXuanfengG({});
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__xuanfengCalls.length !== 1) throw new Error('pickXuanfengTarget 应被调1次,实际 ' + window.__xuanfengCalls.length);
    if(window.__xuanfengCalls[0] !== 1) throw new Error('AI应选座位1,实际 ' + window.__xuanfengCalls[0]);
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
