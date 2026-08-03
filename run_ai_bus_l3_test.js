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
 *  - 出牌转化技能 5 个(断粮/奇袭/国色/武圣/双雄):无技能/无合法牌 match false;
 *    有技能+合法牌 → 候选=目标合法性镜像 render.js;有密钥 mock → 对应服务端函数
 *    (duanLiang/qiXi/guoSe/playCard)收到(牌idx, 目标);无密钥 fallback=null → true
 *    不调服务端;userPrompt 不含他人手牌名;候选排除:断粮距离>2、奇袭无可拆牌、
 *    国色已有乐、武圣空城、双雄帷幕
 *  - 剩余简单单选 4 个(挑衅/反间/青囊/驱虎伤害):match=出牌阶段门槛镜像
 *    render-controls(hasCap/限一次/手牌非空);候选=挑衅排除无手牌、青囊含自己且
 *    排除满血、驱虎伤害只取 pending.targets;有密钥 mock → respondTiaoxin/fanJian/
 *    qingNang(idx,seat)/respondQuhuDamage;无密钥 fallback=null → true 不调服务端
 *  - 多步两阶段框架(借刀杀人 jiedaoTwoStep):botTwoStepA 仅客户端本地不入 Firebase;
 *    阶段A候选=有武器且有合法B的存活其他角色(hasSomeB 镜像 render.js)、阶段B候选=
 *    A攻击范围内非A非空城者;两调度序列 阶段A挂起→阶段B提交 jieDaoShaRen(借刀idx,
 *    seatA,seatB) 并重置;有密钥 mock 选 seatB;候选空→botDecide false 不崩;
 *    runBotDecision 接线:阶段A/B命中即 return、未命中才走 runBotActionWindow
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

  // 构造 N 人局(N 默认 3):座位0是机器人自己,手牌/存活/武将/延迟区/额外能力自定
  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i),
        alive: opt.aliveOf ? opt.aliveOf[i] !== false : true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4, maxHp: 4,
        hand: i === 0 ? (opt.myHand || []) : (opt.hands ? (opt.hands[i] || []) : []),
        equips: emptyEquips(), delays: opt.delaysOf ? (opt.delaysOf[i] || []) : [],
        isBot: i === 0,
        role: 'zhu',
        general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    var g = { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, started: true };
    if(opt.caps0) players[0].caps = opt.caps0;
    if(opt.shuangxiongColor) players[0].shuangxiongColor = opt.shuangxiongColor;
    if(opt.shaUsed) g.shaUsed = true;
    if(opt.duanliangUsed) g.duanliangUsed = true;
    if(opt.tiaoxinUsed) g.tiaoxinUsed = true;
    if(opt.fanJianUsed) g.fanJianUsed = true;
    if(opt.qingNangUsed) g.qingNangUsed = true;
    return g;
  }
  function card(name, id, suit, rank){
    return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 };
  }

  // ---- spy:5 个服务端/出牌函数(函数声明绑定,整体替换;调用参数全量记录) ----
  function spyService(tag){
    window['__' + tag + 'Calls'] = [];
    return function(){
      window['__' + tag + 'Calls'].push(Array.prototype.slice.call(arguments));
    };
  }
  duanLiang = spyService('duanliang');
  qiXi = spyService('qixi');
  guoSe = spyService('guose');
  playCard = spyService('playCard');
  respondTiaoxin = spyService('tiaoxin');
  fanJian = spyService('fanjian');
  qingNang = spyService('qingnang');
  respondQuhuDamage = spyService('quhuDamage');
  jieDaoShaRen = spyService('jiedao');

  // ---- T1:注册表行为——BOT_SEAT_PICKS 存在且恰含本项目注册的 7 个技能(蛊惑/旋风 +
  // 断粮/奇袭/国色/武圣/双雄);无技能命中的状态下 botDecide('seatPick') 返回 false。 ----
  await check('BOT_SEAT_PICKS 存在且恰含 11 个技能;无命中时 botDecide 返回 false', async function(){
    if(typeof BOT_SEAT_PICKS === 'undefined') throw new Error('BOT_SEAT_PICKS 未定义');
    var keys = Object.keys(BOT_SEAT_PICKS).sort().join(',');
    if(keys !== 'duanliang,fanjian,guhuoTarget,guose,qingnang,qixi,quhuDamage,shuangxiong,tiaoxin,wusheng,xuanfeng')
      throw new Error('注册表应恰为 11 项,实际 ' + keys);
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

  // ================= T2:出牌阶段转化技能 5 个(断粮/奇袭/国色/武圣/双雄) =================
  // 合法性镜像 render.js 座位卡分支(断粮距离≤2/奇袭有牌可拆/国色无乐/武圣·双雄走真
  // canTarget)+ render-controls.js 入口门槛(hasCap/断粮限一次)。执行语义:AI 只选目标
  // 座位,牌由 execute 内 findIndex 取第一张合法牌(与真人"点牌"一致)。
  function pickSeats(spec, g){
    return spec.buildSeatCandidates(g, 0).map(function(c){ return c.seat; }).sort(function(a,b){ return a-b; }).join(',');
  }

  // ---- 断粮 duanliang ----
  await check('断粮:无技能/无黑牌/已用过 match false;黑基本牌/黑装备 match true 且候选=距离≤2', function(){
    var s = BOT_SEAT_PICKS.duanliang;
    if(!s) throw new Error('BOT_SEAT_PICKS.duanliang 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','s0','♠')] });
    if(s.match(g1, 0)) throw new Error('无断粮技能不应命中');
    var g2 = mkSeatG({ caps0: { duanliang: true }, myHand: [card('桃','s1','♥')] });
    if(s.match(g2, 0)) throw new Error('无黑色牌不应命中');
    var g3 = mkSeatG({ caps0: { duanliang: true }, myHand: [card('桃','s2','♥'), card('酒','s3','♣')] });
    if(!s.match(g3, 0)) throw new Error('黑色基本牌(酒)应命中');
    var g4 = mkSeatG({ caps0: { duanliang: true }, myHand: [card('诸葛连弩','s4','♠')] });
    if(!s.match(g4, 0)) throw new Error('黑色装备牌应命中');
    var g5 = mkSeatG({ caps0: { duanliang: true }, myHand: [card('杀','s5','♠')], duanliangUsed: true });
    if(s.match(g5, 0)) throw new Error('本回合已用断粮不应命中');
    var cands = s.buildSeatCandidates(g3, 0);
    if(pickSeats(s, g3) !== '1,2') throw new Error('3人局候选应为1,2,实际 ' + pickSeats(s, g3));
    if(cands[0].label.indexOf('断粮') < 0) throw new Error('label 应含断粮前缀,实际 ' + cands[0].label);
  });

  await check('断粮:距离>2 的目标被排除(6人局座位3距离3)', function(){
    var s = BOT_SEAT_PICKS.duanliang;
    var g = mkSeatG({ n: 6, caps0: { duanliang: true }, myHand: [card('杀','s6','♠')] });
    var seats = pickSeats(s, g);
    if(seats !== '1,2,4,5') throw new Error('距离≤2 应为 1,2,4,5,实际 ' + seats);
  });

  await check('断粮有密钥:mock 选目标 → duanLiang(第一张黑牌idx, 目标);userPrompt 不含他人手牌', async function(){
    window.__duanliangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { duanliang: true }, myHand: [card('桃','s7','♥'), card('酒','s8','♣')],
      hands: { 1: [card('桃园结义','sec')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__duanliangCalls.length !== 1) throw new Error('duanLiang 应被调1次,实际 ' + window.__duanliangCalls.length);
    if(window.__duanliangCalls[0][0] !== 1 || window.__duanliangCalls[0][1] !== 2)
      throw new Error('应 duanLiang(1, 座位2),实际 ' + JSON.stringify(window.__duanliangCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
  });

  await check('断粮无密钥:fallback=null → botDecide true 且不调 duanLiang', async function(){
    window.__duanliangCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ caps0: { duanliang: true }, myHand: [card('酒','s9','♣')] });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('无密钥应返回 true,实际 ' + r);
    if(window.__duanliangCalls.length !== 0) throw new Error('不应调用 duanLiang,实际 ' + window.__duanliangCalls.length);
  });

  // ---- 奇袭 qixi ----
  await check('奇袭:无技能/无黑牌 match false;有黑牌 match true 且候选=有牌可拆的目标', function(){
    var s = BOT_SEAT_PICKS.qixi;
    if(!s) throw new Error('BOT_SEAT_PICKS.qixi 未注册');
    var g1 = mkSeatG({ myHand: [card('过河拆桥','q0','♠')] });
    if(s.match(g1, 0)) throw new Error('无奇袭技能不应命中');
    var g2 = mkSeatG({ caps0: { qixi: true }, myHand: [card('桃','q1','♥')] });
    if(s.match(g2, 0)) throw new Error('无黑色手牌不应命中');
    var g3 = mkSeatG({ caps0: { qixi: true }, myHand: [card('桃','q2','♥'), card('过河拆桥','q3','♠')],
      hands: { 1: [card('杀','q4')], 2: [] } });
    if(!s.match(g3, 0)) throw new Error('黑色手牌应命中');
    if(pickSeats(s, g3) !== '1') throw new Error('仅座位1有牌可拆,实际 ' + pickSeats(s, g3));
    var g4 = mkSeatG({ caps0: { qixi: true }, myHand: [card('杀','q5','♠')], hands: { 1: [], 2: [] } });
    if(s.buildSeatCandidates(g4, 0).length !== 0) throw new Error('无人有牌可拆时应无候选');
  });

  await check('奇袭有密钥:mock 选目标 → qiXi(第一张黑牌idx, 目标);无密钥 null 不调', async function(){
    window.__qixiCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { qixi: true }, myHand: [card('桃','q6','♥'), card('过河拆桥','q7','♠')],
      hands: { 1: [card('桃园结义','sec')], 2: [card('杀','q8')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__qixiCalls.length !== 1 || window.__qixiCalls[0][0] !== 1 || window.__qixiCalls[0][1] !== 1)
      throw new Error('应 qiXi(1, 座位1),实际 ' + JSON.stringify(window.__qixiCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__qixiCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { qixi: true }, myHand: [card('过河拆桥','q9','♠')], hands: { 1: [card('杀','qa')], 2: [card('桃','qb')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__qixiCalls.length !== 0) throw new Error('无密钥不应调用 qiXi,实际 ' + window.__qixiCalls.length);
  });

  // ---- 国色 guose ----
  await check('国色:无技能/无方块 match false;有方块 match true 且候选=无乐不思蜀的目标', function(){
    var s = BOT_SEAT_PICKS.guose;
    if(!s) throw new Error('BOT_SEAT_PICKS.guose 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','g0','♦')] });
    if(s.match(g1, 0)) throw new Error('无国色技能不应命中');
    var g2 = mkSeatG({ caps0: { guose: true }, myHand: [card('杀','g1','♠')] });
    if(s.match(g2, 0)) throw new Error('无方块牌不应命中');
    var g3 = mkSeatG({ caps0: { guose: true }, myHand: [card('杀','g2','♠'), card('闪','g3','♦')],
      delaysOf: { 1: [{ id: 'le1', name: '乐不思蜀' }] } });
    if(!s.match(g3, 0)) throw new Error('方块手牌应命中');
    if(pickSeats(s, g3) !== '2') throw new Error('座位1已有乐应排除,实际 ' + pickSeats(s, g3));
  });

  await check('国色有密钥:mock 选目标 → guoSe(第一张方块牌idx, 目标);无密钥 null 不调', async function(){
    window.__guoseCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { guose: true }, myHand: [card('杀','g4','♠'), card('闪','g5','♦')],
      hands: { 1: [card('桃园结义','sec')], 2: [] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__guoseCalls.length !== 1 || window.__guoseCalls[0][0] !== 1 || window.__guoseCalls[0][1] !== 2)
      throw new Error('应 guoSe(1, 座位2),实际 ' + JSON.stringify(window.__guoseCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__guoseCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { guose: true }, myHand: [card('闪','g6','♦')], hands: { 1: [card('杀','g7')], 2: [card('桃','g8')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__guoseCalls.length !== 0) throw new Error('无密钥不应调用 guoSe,实际 ' + window.__guoseCalls.length);
  });

  // ---- 武圣 wusheng ----
  await check('武圣:无转化能力/红杀本身/非红牌 match false;红牌可当杀 match true 且候选走真 canTarget', function(){
    var s = BOT_SEAT_PICKS.wusheng;
    if(!s) throw new Error('BOT_SEAT_PICKS.wusheng 未注册');
    var g1 = mkSeatG({ myHand: [card('过河拆桥','w0','♥')] });
    if(s.match(g1, 0)) throw new Error('无武圣转化能力不应命中');
    var g2 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('杀','w1','♥')] });
    if(s.match(g2, 0)) throw new Error('红杀本身(resolveActionId=杀)不应命中武圣');
    var g3 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('杀','w2','♠')] });
    if(s.match(g3, 0)) throw new Error('非红牌不应命中');
    var g4 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('闪','w3','♠'), card('过河拆桥','w4','♥')] });
    if(!s.match(g4, 0)) throw new Error('红色可当杀牌应命中');
    if(pickSeats(s, g4) !== '1,2') throw new Error('两目标均可达应入候选,实际 ' + pickSeats(s, g4));
    var g5 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('过河拆桥','w5','♥')], generalOf: { 1: 'zhuge' } });
    if(pickSeats(s, g5) !== '2') throw new Error('诸葛亮空城目标应被 canTarget 排除,实际 ' + pickSeats(s, g5));
    var g6 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('过河拆桥','w6','♥')], shaUsed: true });
    if(s.match(g6, 0)) throw new Error('本回合已出杀时 canPlay 拒绝,不应命中');
  });

  await check('武圣有密钥:mock 选目标 → playCard(第一张合法红牌idx, 杀, 目标);无密钥 null 不调', async function(){
    window.__playCardCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { wusheng: true }, myHand: [card('闪','w7','♠'), card('过河拆桥','w8','♥')],
      hands: { 1: [card('桃园结义','sec')], 2: [] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__playCardCalls.length !== 1) throw new Error('playCard 应被调1次,实际 ' + window.__playCardCalls.length);
    var c0 = window.__playCardCalls[0];
    if(c0[0] !== 1 || c0[1] !== '杀' || c0[2] !== 2)
      throw new Error('应 playCard(1, 杀, 座位2),实际 ' + JSON.stringify(c0));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__playCardCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { wusheng: true }, myHand: [card('过河拆桥','w9','♥')], hands: { 1: [card('杀','wa')], 2: [card('桃','wb')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__playCardCalls.length !== 0) throw new Error('无密钥不应调用 playCard,实际 ' + window.__playCardCalls.length);
  });

  // ---- 双雄 shuangxiong ----
  await check('双雄:无色/全同色 match false;异色牌 match true 且候选走真 canTarget', function(){
    var s = BOT_SEAT_PICKS.shuangxiong;
    if(!s) throw new Error('BOT_SEAT_PICKS.shuangxiong 未注册');
    var g1 = mkSeatG({ caps0: { shuangxiong: true }, myHand: [card('杀','x0','♠')] });
    if(s.match(g1, 0)) throw new Error('无 shuangxiongColor 不应命中');
    var g2 = mkSeatG({ caps0: { shuangxiong: true }, shuangxiongColor: 'red', myHand: [card('桃','x1','♥'), card('过河拆桥','x2','♦')] });
    if(s.match(g2, 0)) throw new Error('全部同色(红)不应命中');
    var g3 = mkSeatG({ caps0: { shuangxiong: true }, shuangxiongColor: 'red', myHand: [card('桃','x3','♥'), card('过河拆桥','x4','♠')] });
    if(!s.match(g3, 0)) throw new Error('异色(黑)牌应命中');
    if(pickSeats(s, g3) !== '1,2') throw new Error('无帷幕目标两座均应入候选,实际 ' + pickSeats(s, g3));
    var g4 = mkSeatG({ caps0: { shuangxiong: true }, shuangxiongColor: 'red', myHand: [card('过河拆桥','x5','♠')], generalOf: { 1: 'jiaxu' } });
    if(pickSeats(s, g4) !== '2') throw new Error('贾诩帷幕(黑锦囊)应被 canTarget 排除,实际 ' + pickSeats(s, g4));
  });

  await check('双雄有密钥:mock 选目标 → playCard(第一张异色牌idx, 决斗, 目标);无密钥 null 不调', async function(){
    window.__playCardCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { shuangxiong: true }, shuangxiongColor: 'red',
      myHand: [card('桃','x6','♥'), card('过河拆桥','x7','♠')],
      hands: { 1: [card('桃园结义','sec')], 2: [] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__playCardCalls.length !== 1) throw new Error('playCard 应被调1次,实际 ' + window.__playCardCalls.length);
    var c0 = window.__playCardCalls[0];
    if(c0[0] !== 1 || c0[1] !== '决斗' || c0[2] !== 2)
      throw new Error('应 playCard(1, 决斗, 座位2),实际 ' + JSON.stringify(c0));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__playCardCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { shuangxiong: true }, shuangxiongColor: 'red', myHand: [card('过河拆桥','x8','♠')], hands: { 1: [card('杀','xa')], 2: [card('桃','xb')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__playCardCalls.length !== 0) throw new Error('无密钥不应调用 playCard,实际 ' + window.__playCardCalls.length);
  });

  // ================= T3:剩余简单单选 4 个(挑衅/反间/青囊/驱虎伤害) =================
  // 合法性镜像 render.js 座位卡分支 + render-controls.js 入口按钮门槛(hasCap/限一次/手牌非空):
  // 挑衅=出牌阶段+hasCap+未用,目标=存活有手牌非自己(render-controls.js:3730);
  // 反间=出牌阶段+hasCap+未用+自己手牌非空(render-controls.js:3750 门槛,比 brief 多限一次判断);
  // 青囊=出牌阶段+hasCap+未用+自己手牌非空(render-controls.js:3762 门槛),目标=存活且 hp<maxHp(可自己);
  // 驱虎伤害=quhuDamageChoice 阶段+pending.seat===本人(render-controls.js:2220),目标=pending.targets 成员(服务端权威)。

  // ---- 挑衅 tiaoxin ----
  await check('挑衅:无技能/已用过 match false;有技能 match true 且候选=存活有手牌非自己', function(){
    var s = BOT_SEAT_PICKS.tiaoxin;
    if(!s) throw new Error('BOT_SEAT_PICKS.tiaoxin 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','t0')] });
    if(s.match(g1, 0)) throw new Error('无挑衅技能不应命中');
    var g2 = mkSeatG({ caps0: { tiaoxin: true }, tiaoxinUsed: true, hands: { 1: [card('杀','t1')] } });
    if(s.match(g2, 0)) throw new Error('本回合已用挑衅不应命中');
    var g3 = mkSeatG({ caps0: { tiaoxin: true }, hands: { 1: [card('杀','t2')], 2: [] } });
    if(!s.match(g3, 0)) throw new Error('有技能+存在有手牌目标应命中');
    if(pickSeats(s, g3) !== '1') throw new Error('无手牌目标(座位2)应排除,实际 ' + pickSeats(s, g3));
    var cands = s.buildSeatCandidates(g3, 0);
    if(cands[0].label.indexOf('挑衅') < 0) throw new Error('label 应含挑衅前缀,实际 ' + cands[0].label);
  });

  await check('挑衅有密钥:mock 选目标 → respondTiaoxin(座位);userPrompt 不含他人手牌', async function(){
    window.__tiaoxinCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { tiaoxin: true }, hands: { 1: [card('桃园结义','sec')], 2: [card('杀','t3')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__tiaoxinCalls.length !== 1 || window.__tiaoxinCalls[0][0] !== 2)
      throw new Error('应 respondTiaoxin(座位2),实际 ' + JSON.stringify(window.__tiaoxinCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
  });

  await check('挑衅无密钥:fallback=null → botDecide true 且不调 respondTiaoxin', async function(){
    window.__tiaoxinCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ caps0: { tiaoxin: true }, hands: { 1: [card('杀','t4')], 2: [card('桃','t5')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true) throw new Error('无密钥应返回 true,实际 ' + r);
    if(window.__tiaoxinCalls.length !== 0) throw new Error('不应调用 respondTiaoxin,实际 ' + window.__tiaoxinCalls.length);
  });

  // ---- 反间 fanjian ----
  await check('反间:无技能/无手牌/已用过 match false;有技能+有手牌 match true 且候选=存活非自己', function(){
    var s = BOT_SEAT_PICKS.fanjian;
    if(!s) throw new Error('BOT_SEAT_PICKS.fanjian 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','f0')] });
    if(s.match(g1, 0)) throw new Error('无反间技能不应命中');
    var g2 = mkSeatG({ caps0: { fanjian: true }, myHand: [] });
    if(s.match(g2, 0)) throw new Error('无手牌不应命中');
    var g3 = mkSeatG({ caps0: { fanjian: true }, myHand: [card('杀','f1')], fanJianUsed: true });
    if(s.match(g3, 0)) throw new Error('本回合已用反间不应命中');
    var g4 = mkSeatG({ caps0: { fanjian: true }, myHand: [card('杀','f2')], hands: { 1: [], 2: [] } });
    if(!s.match(g4, 0)) throw new Error('有技能+有手牌应命中');
    if(pickSeats(s, g4) !== '1,2') throw new Error('存活非自己均应为候选,实际 ' + pickSeats(s, g4));
    var g5 = mkSeatG({ caps0: { fanjian: true }, myHand: [card('杀','f3')], aliveOf: { 2: false } });
    if(pickSeats(s, g5) !== '1') throw new Error('死者(座位2)应排除,实际 ' + pickSeats(s, g5));
    var cands = s.buildSeatCandidates(g4, 0);
    if(cands[0].label.indexOf('反间') < 0) throw new Error('label 应含反间前缀,实际 ' + cands[0].label);
  });

  await check('反间有密钥:mock 选目标 → fanJian(座位);无密钥 null 不调', async function(){
    window.__fanjianCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { fanjian: true }, myHand: [card('杀','f4')],
      hands: { 1: [card('桃园结义','sec')], 2: [card('桃','f5')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__fanjianCalls.length !== 1 || window.__fanjianCalls[0][0] !== 2)
      throw new Error('应 fanJian(座位2),实际 ' + JSON.stringify(window.__fanjianCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__fanjianCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { fanjian: true }, myHand: [card('杀','f6')], hands: { 1: [card('桃','f7')], 2: [card('闪','f8')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__fanjianCalls.length !== 0) throw new Error('无密钥不应调用 fanJian,实际 ' + window.__fanjianCalls.length);
  });

  // ---- 青囊 qingnang ----
  await check('青囊:无技能/无手牌/已用过 match false;有技能 match true 且候选=存活且 hp<maxHp(含自己)', function(){
    var s = BOT_SEAT_PICKS.qingnang;
    if(!s) throw new Error('BOT_SEAT_PICKS.qingnang 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','c0')] });
    if(s.match(g1, 0)) throw new Error('无青囊技能不应命中');
    var g2 = mkSeatG({ caps0: { qingnang: true }, myHand: [] });
    if(s.match(g2, 0)) throw new Error('无手牌不应命中');
    var g3 = mkSeatG({ caps0: { qingnang: true }, myHand: [card('杀','c1')], qingNangUsed: true });
    if(s.match(g3, 0)) throw new Error('本回合已用青囊不应命中');
    var g4 = mkSeatG({ caps0: { qingnang: true }, myHand: [card('杀','c2')], hpOf: { 0: 3, 2: 2 } });
    if(!s.match(g4, 0)) throw new Error('有技能+有手牌应命中');
    if(pickSeats(s, g4) !== '0,2') throw new Error('满血座位1排除、自己(受伤)应入候选,实际 ' + pickSeats(s, g4));
    var cands = s.buildSeatCandidates(g4, 0);
    if(cands[0].label.indexOf('青囊') < 0) throw new Error('label 应含青囊前缀,实际 ' + cands[0].label);
  });

  await check('青囊有密钥:mock 选目标 → qingNang(第一张手牌idx, 目标);无密钥 null 不调', async function(){
    window.__qingnangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { qingnang: true }, myHand: [card('杀','c3','♥'), card('桃','c4','♦')], hpOf: { 0: 3, 2: 2 } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__qingnangCalls.length !== 1 || window.__qingnangCalls[0][0] !== 0 || window.__qingnangCalls[0][1] !== 2)
      throw new Error('应 qingNang(0, 座位2),实际 ' + JSON.stringify(window.__qingnangCalls));

    window.__qingnangCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { qingnang: true }, myHand: [card('杀','c5')], hpOf: { 0: 3, 1: 3 } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__qingnangCalls.length !== 0) throw new Error('无密钥不应调用 qingNang,实际 ' + window.__qingnangCalls.length);
  });

  // ---- 驱虎伤害 quhuDamage(只做选伤害目标;quhuRespond 拼点阶段不在本任务) ----
  function mkQuhuDamageG(opt){
    var g = mkSeatG(opt);
    g.phase = 'quhuDamageChoice';
    g.pending = opt.pending || { type: 'quhuDamageChoice', seat: 0, targetSeat: 1, targets: [1, 2] };
    return g;
  }

  await check('驱虎伤害:无 pending/他人选择/拼点阶段 match false;有 pending match true 且候选=pending.targets', function(){
    var s = BOT_SEAT_PICKS.quhuDamage;
    if(!s) throw new Error('BOT_SEAT_PICKS.quhuDamage 未注册');
    var g1 = mkSeatG({});
    if(s.match(g1, 0)) throw new Error('无 quhuDamageChoice pending 不应命中');
    var g2 = mkQuhuDamageG({});
    g2.pending.seat = 1;
    if(s.match(g2, 0)) throw new Error('pending.seat 非本人不应命中');
    if(!s.match(g2, 1)) throw new Error('pending.seat 本人(座位1)应命中');
    var g3 = mkQuhuDamageG({ pending: { type: 'quhuRespond', seat: 0, targetSeat: 1 } });
    if(s.match(g3, 0)) throw new Error('quhuRespond 拼点阶段不应命中驱虎伤害');
    var g4 = mkQuhuDamageG({});
    if(!s.match(g4, 0)) throw new Error('本人选伤害目标应命中');
    if(pickSeats(s, g4) !== '1,2') throw new Error('候选应恰为 pending.targets 成员 1,2,实际 ' + pickSeats(s, g4));
    var g5 = mkQuhuDamageG({ pending: { type: 'quhuDamageChoice', seat: 0, targetSeat: 1, targets: [1] } });
    if(pickSeats(s, g5) !== '1') throw new Error('候选应只含 targets 里的座位,实际 ' + pickSeats(s, g5));
    var cands = s.buildSeatCandidates(g4, 0);
    if(cands[0].label.indexOf('驱虎伤害') < 0) throw new Error('label 应含驱虎伤害前缀,实际 ' + cands[0].label);
  });

  await check('驱虎伤害有密钥:botDecide 全链 → respondQuhuDamage(目标);无密钥 null 不调', async function(){
    window.__quhuDamageCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkQuhuDamageG({ hands: { 1: [card('桃园结义','sec')] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__quhuDamageCalls.length !== 1 || window.__quhuDamageCalls[0][0] !== 2)
      throw new Error('应 respondQuhuDamage(座位2),实际 ' + JSON.stringify(window.__quhuDamageCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);

    window.__quhuDamageCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkQuhuDamageG({});
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__quhuDamageCalls.length !== 0) throw new Error('无密钥不应调用 respondQuhuDamage,实际 ' + window.__quhuDamageCalls.length);
  });

  // ================= T3:多步两阶段框架(借刀杀人 jiedaoTwoStep) =================
  // botTwoStepA 仅客户端本地(仿 render.js jiedaoSeatA),不入 Firebase、无新 pending 类型。
  // 阶段A候选=有武器且有合法B(hasSomeB)的存活其他角色(镜像 render.js 1467-1468);
  // 阶段B候选=A 攻击范围内、非A、非空城的存活者(镜像 render.js 1473);
  // execute:阶段A只挂起 botTwoStepA 等下一调度;阶段B提交 jieDaoShaRen(cardIdx,seatA,seatB)。

  await check('借刀:jiedaoTwoStep 已注册;match=出牌阶段+自己回合+手牌有借刀;阶段A候选=有武器且有合法B的存活其他角色', function(){
    var s = BOT_DECISIONS.jiedaoTwoStep;
    if(!s) throw new Error('BOT_DECISIONS.jiedaoTwoStep 未注册');
    if(typeof resetBotTwoStep !== 'function') throw new Error('resetBotTwoStep 未定义');
    var g1 = mkSeatG({ myHand: [card('杀','j1')] });
    if(s.match(g1, 0)) throw new Error('无借刀不应命中');
    var g2 = mkSeatG({ myHand: [card('借刀杀人','j2')] });
    if(!s.match(g2, 0)) throw new Error('手牌有借刀应命中');
    g2.turn = 1;
    if(s.match(g2, 0)) throw new Error('非自己回合不应命中');
    g2.turn = 0; g2.phase = 'discard';
    if(s.match(g2, 0)) throw new Error('非出牌阶段不应命中');
    // 无人持武器 → 阶段A候选空
    var g3 = mkSeatG({ myHand: [card('借刀杀人','j3')] });
    if(s.buildCandidates(g3, 0).length !== 0) throw new Error('无人持武器时阶段A候选应为空');
    // 座位1持青龙偃月刀(range3)且存在合法B → 候选=[1]
    var g4 = mkSeatG({ myHand: [card('借刀杀人','j4')] });
    g4.players[1].equips.weapon = { name: '青龙偃月刀' };
    var c4 = s.buildCandidates(g4, 0);
    if(c4.length !== 1 || c4[0].a !== 1 || c4[0].step !== 'A') throw new Error('阶段A候选应=[座位1],实际 ' + JSON.stringify(c4));
    if(c4[0].label.indexOf('借刀') < 0) throw new Error('label 应含借刀前缀,实际 ' + c4[0].label);
    // 座位1有武器但所有B候选都是空城 → hasSomeB=false → 排除(镜像 render.js hasSomeB)
    var g5 = mkSeatG({ myHand: [], caps0: { kongcheng: true } });
    g5.players[1].equips.weapon = { name: '青龙偃月刀' };
    g5.players[1].hand = [card('杀','j5')];
    g5.players[2].caps = { kongcheng: true };
    g5.players[2].hand = [];
    if(s.buildCandidates(g5, 0).length !== 0) throw new Error('无合法B时武器持有者应被排除(hasSomeB)');
    // 自己持武器不算A
    var g6 = mkSeatG({ myHand: [card('借刀杀人','j6')] });
    g6.players[0].equips.weapon = { name: '青龙偃月刀' };
    if(s.buildCandidates(g6, 0).length !== 0) throw new Error('自己持武器不能作为A');
    // resetBotTwoStep 清空挂起状态
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    resetBotTwoStep();
    if(botTwoStepA !== null) throw new Error('resetBotTwoStep 应清空 botTwoStepA');
  });

  await check('借刀阶段B:候选=在A攻击范围内、非A、非空城的存活者(镜像 render.js 1473)', function(){
    var s = BOT_DECISIONS.jiedaoTwoStep;
    // A=1(青龙偃月刀 range3):3人局可达 0(自己)和 2
    var g1 = mkSeatG({ myHand: [card('借刀杀人','j7')] });
    g1.players[1].equips.weapon = { name: '青龙偃月刀' };
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var c1 = s.buildCandidates(g1, 0);
    var seats = c1.map(function(c){ return c.seatB; }).sort(function(a,b){ return a-b; }).join(',');
    if(seats !== '0,2') throw new Error('阶段B候选应为0,2,实际 ' + seats);
    if(c1[0].step !== 'B' || c1[0].seatA !== 1) throw new Error('阶段B候选应带 step:B 和 seatA,实际 ' + JSON.stringify(c1[0]));
    if(c1[0].label.indexOf('杀 ') < 0) throw new Error('label 应含"令A杀B",实际 ' + c1[0].label);
    // 空城者排除
    var g2 = mkSeatG({ myHand: [card('借刀杀人','j8')] });
    g2.players[1].equips.weapon = { name: '青龙偃月刀' };
    g2.players[2].caps = { kongcheng: true };
    g2.players[2].hand = [];
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var c2 = s.buildCandidates(g2, 0);
    if(c2.length !== 1 || c2[0].seatB !== 0) throw new Error('空城者应排除,只剩座位0,实际 ' + JSON.stringify(c2));
    // A 自己不能当B
    var g3 = mkSeatG({ myHand: [card('借刀杀人','j9')] });
    g3.players[1].equips.weapon = { name: '青龙偃月刀' };
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var c3 = s.buildCandidates(g3, 0);
    if(c3.some(function(c){ return c.seatB === 1; })) throw new Error('A 自己不能出现在阶段B候选');
    botTwoStepA = null;
  });

  await check('借刀两阶段无密钥:调度1 阶段A选中候选[0]并挂起 botTwoStepA;调度2 阶段B提交 jieDaoShaRen(借刀idx,seatA,seatB) 并重置', async function(){
    window.__jiedaoCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ myHand: [card('借刀杀人','j10')] });
    g.players[1].equips.weapon = { name: '青龙偃月刀' };
    var r1 = await botDecide('jiedaoTwoStep', g, 0);
    if(r1 !== true) throw new Error('阶段A应返回 true,实际 ' + r1);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'jiedaoTwoStep' || botTwoStepA.a !== 1)
      throw new Error('阶段A后 botTwoStepA 应={decisionId,a:1},实际 ' + JSON.stringify(botTwoStepA));
    if(window.__jiedaoCalls.length !== 0) throw new Error('阶段A不应提交 jieDaoShaRen');
    var r2 = await botDecide('jiedaoTwoStep', g, 0);
    if(r2 !== true) throw new Error('阶段B应返回 true,实际 ' + r2);
    if(botTwoStepA !== null) throw new Error('阶段B提交后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__jiedaoCalls.length !== 1) throw new Error('jieDaoShaRen 应被调1次,实际 ' + window.__jiedaoCalls.length);
    var call0 = window.__jiedaoCalls[0];
    if(call0[0] !== 0 || call0[1] !== 1 || call0[2] !== 0) throw new Error('应 jieDaoShaRen(0,1,0),实际 ' + JSON.stringify(call0));
  });

  await check('借刀阶段B有密钥:mock 选 seatB → jieDaoShaRen(借刀idx,seatA,seatB);userPrompt 不含他人手牌', async function(){
    window.__jiedaoCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ myHand: [card('借刀杀人','j11')], hands: { 1: [card('桃园结义','sec')] } });
    g.players[1].equips.weapon = { name: '青龙偃月刀' };
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var r = await botDecide('jiedaoTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__jiedaoCalls.length !== 1 || window.__jiedaoCalls[0][1] !== 1 || window.__jiedaoCalls[0][2] !== 2)
      throw new Error('应 jieDaoShaRen(idx,1,2),实际 ' + JSON.stringify(window.__jiedaoCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    botTwoStepA = null;
  });

  await check('借刀:无武器持有者时 match true 但候选空 → botDecide 返回 false(走 runBotActionWindow,不崩)', async function(){
    var s = BOT_DECISIONS.jiedaoTwoStep;
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ myHand: [card('借刀杀人','j12')] });
    if(!s.match(g, 0)) throw new Error('手牌有借刀应命中 match');
    if(s.buildCandidates(g, 0).length !== 0) throw new Error('无武器持有者时候选应为空');
    var r = await botDecide('jiedaoTwoStep', g, 0);
    if(r !== false) throw new Error('候选空应返回 false(runBotActionWindow 继续),实际 ' + r);
  });

  await check('借刀接线:runBotDecision play 分支先尝试 jiedaoTwoStep;阶段B命中→提交且不再走 runBotActionWindow;未命中→走 runBotActionWindow', async function(){
    var realBotDecide = botDecide;
    var realWindow = runBotActionWindow;
    var wired = [];
    botDecide = async function(decisionId, gg, seat){ wired.push(decisionId); return realBotDecide(decisionId, gg, seat); };
    runBotActionWindow = async function(){ window.__windowCalls++; };

    // 场景1:botTwoStepA 已挂起(阶段B态) → 一次调度内直接提交,不走窗口
    window.__windowCalls = 0;
    window.__jiedaoCalls = [];
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var g1 = mkSeatG({ myHand: [card('借刀杀人','j13')] });
    g1.players[1].equips.weapon = { name: '青龙偃月刀' };
    await runBotDecision(g1, 0);
    if(window.__windowCalls !== 0) throw new Error('阶段B命中后不应再走 runBotActionWindow');
    if(wired.filter(function(x){ return x === 'jiedaoTwoStep'; }).length !== 1) throw new Error('阶段B应恰尝试1次 jiedaoTwoStep,实际 ' + JSON.stringify(wired));
    if(window.__jiedaoCalls.length !== 1) throw new Error('runBotDecision 链应提交 jieDaoShaRen');

    // 场景2:无 botTwoStepA(阶段A态) → 选中即挂起,不走窗口
    wired = [];
    window.__windowCalls = 0;
    window.__jiedaoCalls = [];
    botTwoStepA = null;
    var g2 = mkSeatG({ myHand: [card('借刀杀人','j14')] });
    g2.players[1].equips.weapon = { name: '青龙偃月刀' };
    await runBotDecision(g2, 0);
    if(window.__windowCalls !== 0) throw new Error('阶段A命中后不应走 runBotActionWindow(等下一调度)');
    if(!botTwoStepA || botTwoStepA.a !== 1) throw new Error('阶段A应挂起 botTwoStepA,实际 ' + JSON.stringify(botTwoStepA));

    // 场景3:手牌无借刀 → 未命中 → 走 runBotActionWindow(第一处尝试被 botTwoStepA 守卫挡住,只试1次)
    wired = [];
    window.__windowCalls = 0;
    botTwoStepA = null;
    var g3 = mkSeatG({ myHand: [card('杀','j15')] });
    await runBotDecision(g3, 0);
    if(window.__windowCalls !== 1) throw new Error('jiedaoTwoStep 未命中时应走 runBotActionWindow,实际 ' + window.__windowCalls);
    if(wired.join(',') !== 'jiedaoTwoStep') throw new Error('无挂起态时应恰尝试1次(第二处接线),实际 ' + wired.join(','));

    // 场景4:botTwoStepA 挂起但阶段B无候选(A无射程内目标:无武器range1+自己装+1马+第三人阵亡) → 两处尝试均 false → 走窗口不崩
    wired = [];
    window.__windowCalls = 0;
    window.__jiedaoCalls = [];
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var g4 = mkSeatG({ myHand: [card('借刀杀人','j16')], aliveOf: { 2: false } });
    g4.players[0].equips.plus1 = { name: '的卢' };
    await runBotDecision(g4, 0);
    if(window.__windowCalls !== 1) throw new Error('阶段B无候选时应走 runBotActionWindow,实际 ' + window.__windowCalls);
    if(wired.join(',') !== 'jiedaoTwoStep,jiedaoTwoStep') throw new Error('阶段B无候选应尝试2次后放行,实际 ' + wired.join(','));
    if(window.__jiedaoCalls.length !== 0) throw new Error('阶段B无候选不应提交 jieDaoShaRen');

    botDecide = realBotDecide;
    runBotActionWindow = realWindow;
    botTwoStepA = null;
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
