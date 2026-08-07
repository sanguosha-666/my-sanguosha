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
 *  - 多步两阶段扩展(离间/丈八/仁德):lijianTwoStep 阶段A=存活男性(含自己)、阶段B=
 *    ≠from 男性;zhangbaTwoStep 三阶段 A/B=两张手牌、C=canReachSha+非空城目标;
 *    rendeTwoStep 阶段A=存活非自己、阶段B=每张手牌;botTwoStepA 扩展 {a,b?} 向后兼容;
 *    全链路序列提交 liJian(idx,from,to)/playZhangbaSha(a,b,target)/renDe(idx,target);
 *    接线优先级 借刀>离间>丈八>仁德,挂起期只处理挂起的那一个决策
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

// 【A2】断线重连测试需要"第二个沙箱=页面刷新"来验证模块级 let 状态回退,故把沙箱
// 构建/加载抽成可复用函数:buildSandbox() 每次产出全新 JS 作用域(模拟刷新后 JS 全量
// 重载),loadAll(sb) 按 index.html 顺序加载全部脚本。storage stub 每次新建(浏览器刷新
// 时 sessionStorage/localStorage 实际保留,但本测试锁定的契约是"游戏态不靠 storage
// 恢复",见 A2 验证块注释)。
function buildSandbox(){
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
  return vm.createContext(context, { name: 'sgs-ai-bus-l3-sandbox' });
}

const sandbox = buildSandbox();

console.log('Loading AI 总线 L3 测试环境...\n');

// 加载顺序遵循 index.html:room-lifecycle 必须在 game.js 之前(game.js 顶层
// onclick 绑定 joinRoom);bot-ai-bus.js 在 bot.js 之前(TDZ:const BOT_DECISIONS
// 必须先于注册项);ai-bot.js 最后、render.js 殿后。
const files = ['config.js', 'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
function loadAll(sb){
  files.forEach(function(file){
    try {
      const code = fs.readFileSync(file, 'utf8');
      vm.runInContext(code, sb, { filename: file });
      console.log('  OK ' + file);
      if (file === 'game.js') {
        vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sb);
        vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sb);
        vm.runInContext('mySeat = 0;', sb);
      }
    } catch (e) {
      console.log('  FAIL ' + file + ': ' + e.message);
      if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
      process.exit(1);
    }
  });
}
loadAll(sandbox);

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
    if(opt.liJianUsed) g.liJianUsed = true;
    if(opt.jiangchiNoSlash) players[0].jiangchiNoSlash = true;
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
  playShaFangtian = spyService('fangtian');
  respondTiaoxin = spyService('tiaoxin');
  fanJian = spyService('fanjian');
  qingNang = spyService('qingnang');
  respondQuhuDamage = spyService('quhuDamage');
  jieDaoShaRen = spyService('jiedao');
  liJian = spyService('lijian');
  renDe = spyService('rende');
  playZhangbaSha = spyService('zhangba');
  respondGuanxing = spyService('guanxing');
  respondYijiAssign = spyService('yijiAssign');
  respondLiRang = spyService('lirang');
  respondXiaoguo = spyService('xiaoguo');
  respondJiedao = spyService('jiedaoResponse');
  giveEnyuanCard = spyService('enyuanGiveCard');

  // ---- T1:注册表行为——BOT_SEAT_PICKS 存在且恰含本项目注册的 13 个技能(蛊惑/旋风 +
  // 断粮/奇袭/国色/武圣/龙胆/双雄/制霸);无技能命中的状态下 botDecide('seatPick') 返回 false。
  // 龙胆(赵云闪→杀)是候选真空扫描新补的注册,和武圣同级但谓词不同(见 isLongdanShaCard
  // 注释——闪没有 CARD_PLAYS 入口,resolveActionId 对闪恒定解析成'杀',不能复用武圣那条
  // "resolveActionId!=='杀'"的排除条件,否则会把所有闪都滤掉)。----
  await check('BOT_SEAT_PICKS 存在且恰含 13 个技能;无命中时 botDecide 返回 false', async function(){
    if(typeof BOT_SEAT_PICKS === 'undefined') throw new Error('BOT_SEAT_PICKS 未定义');
    var keys = Object.keys(BOT_SEAT_PICKS).sort().join(',');
    if(keys !== 'duanliang,fanjian,guhuoTarget,guose,longdan,qingnang,qixi,quhuDamage,shuangxiong,tiaoxin,wusheng,xuanfeng,zhiba')
      throw new Error('注册表应恰为 13 项,实际 ' + keys);
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

  // 【调度盲区收尾时更新】buildSeatCandidates 补了"目标确实还有牌可弃"这层过滤(镜像
  // render-controls.js 选目标按钮的 available>0 判断,并额外扣掉本轮已经从该目标身上选
  // 走的牌数,防止一个已经被弃完的目标反复留在候选里造成死循环)——所有候选目标现在必须
  // 带至少1张可弃的牌(手牌/装备/判定区任一),否则会被正确排除,不再是"存活非自己"这么
  // 简单。以下测试补上 hands 让存活的非自己目标确实有牌可弃,契约变严格是这次收尾任务
  // 主动发现并修的一个真实边界(死代码接线之前从未暴露),不是回归。
  await check('旋风目标:候选=存活非自己且确实有牌可弃(死者/无牌目标排除)', function(){
    var g = mkXuanfengG({ aliveOf: { 2: false }, hands: { 1: [card('杀')], 2: [card('闪')] } });
    var spec = BOT_SEAT_PICKS.xuanfeng;
    if(!spec) throw new Error('BOT_SEAT_PICKS.xuanfeng 未注册');
    if(!spec.match(g, 0)) throw new Error('from 本人 match 应命中');
    if(spec.match(g, 1)) throw new Error('非 from 不应命中');
    var cands = spec.buildSeatCandidates(g, 0);
    if(cands.length !== 1) throw new Error('座位2已死,应只剩1个候选,实际 ' + cands.length + ' ' + JSON.stringify(cands));
    if(cands[0].seat !== 1) throw new Error('应只剩座位1,实际 ' + cands[0].seat);
    if(cands[0].label.indexOf('旋风') < 0) throw new Error('label 应含 旋风 前缀,实际 ' + cands[0].label);
  });

  await check('旋风目标:候选排除"确实没有牌可弃"的存活目标', function(){
    var g = mkXuanfengG({ hands: { 1: [card('杀')] } }); // 座位2 无手牌/装备/判定区,应被排除
    var spec = BOT_SEAT_PICKS.xuanfeng;
    var cands = spec.buildSeatCandidates(g, 0);
    if(cands.length !== 1) throw new Error('座位2无牌可弃,应只剩1个候选,实际 ' + cands.length + ' ' + JSON.stringify(cands));
    if(cands[0].seat !== 1) throw new Error('应只剩座位1,实际 ' + cands[0].seat);
  });

  await check('旋风目标无密钥:fallback=null → botDecide 返回 true 且不调 pickXuanfengTarget', async function(){
    window.__xuanfengCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkXuanfengG({ hands: { 1: [card('杀')], 2: [card('闪')] } });
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
    var g = mkXuanfengG({ hands: { 1: [card('杀')], 2: [card('闪')] } });
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

  // ---- 龙胆 longdan(赵云闪→杀方向,候选真空扫描新补;反方向杀→闪走 findUsableAs,不在此覆盖) ----
  await check('龙胆:无转化能力/闪不在手 match false;闪在手可当杀 match true 且候选走真 canTarget', function(){
    var s = BOT_SEAT_PICKS.longdan;
    if(!s) throw new Error('BOT_SEAT_PICKS.longdan 未注册');
    var g1 = mkSeatG({ myHand: [card('闪','ld0','♠')] });
    if(s.match(g1, 0)) throw new Error('无龙胆转化能力不应命中');
    var g2 = mkSeatG({ caps0: { longdan: true }, myHand: [card('杀','ld1','♠')] });
    if(s.match(g2, 0)) throw new Error('手里只有真杀(不是闪)不应命中龙胆');
    var g3 = mkSeatG({ caps0: { longdan: true }, myHand: [card('闪','ld2','♠')] });
    if(!s.match(g3, 0)) throw new Error('闪在手且有龙胆应命中');
    if(pickSeats(s, g3) !== '1,2') throw new Error('两目标均可达应入候选,实际 ' + pickSeats(s, g3));
    var g4 = mkSeatG({ caps0: { longdan: true }, myHand: [card('闪','ld3','♠')], generalOf: { 1: 'zhuge' } });
    if(pickSeats(s, g4) !== '2') throw new Error('诸葛亮空城目标应被 canTarget 排除,实际 ' + pickSeats(s, g4));
    var g5 = mkSeatG({ caps0: { longdan: true }, myHand: [card('闪','ld4','♠')], shaUsed: true });
    if(s.match(g5, 0)) throw new Error('本回合已出杀时 canPlay 拒绝,不应命中');
  });

  await check('龙胆有密钥:mock 选目标 → playCard(第一张闪idx, 杀, 目标);无密钥 null 不调', async function(){
    window.__playCardCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { longdan: true }, myHand: [card('闪','ld5','♠')],
      hands: { 1: [card('桃园结义','sec2')], 2: [] } });
    var r = await botDecide('seatPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__playCardCalls.length !== 1) throw new Error('playCard 应被调1次,实际 ' + window.__playCardCalls.length);
    var c0 = window.__playCardCalls[0];
    if(c0[0] !== 0 || c0[1] !== '杀' || c0[2] !== 2)
      throw new Error('应 playCard(0, 杀, 座位2),实际 ' + JSON.stringify(c0));

    window.__playCardCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g2 = mkSeatG({ caps0: { longdan: true }, myHand: [card('闪','ld6','♠')], hands: { 1: [card('杀','ldb')], 2: [card('桃','ldc')] } });
    var r2 = await botDecide('seatPick', g2, 0);
    if(r2 !== true) throw new Error('无密钥应返回 true,实际 ' + r2);
    if(window.__playCardCalls.length !== 0) throw new Error('无密钥不应调用 playCard,实际 ' + window.__playCardCalls.length);
  });

  await check('龙胆:真杀和闪同时在手时互不干扰(常规枚举仍收录真杀,longdan 额外收录闪)', function(){
    var g = mkSeatG({ caps0: { longdan: true }, myHand: [card('杀','ld7','♠'), card('闪','ld8','♠')] });
    var normal = enumerateAllLegalOneStepActions(g, 0);
    var shaFromNormal = normal.filter(function(c){ return c.action==='杀'; });
    // target:true 牌按目标展开,3人局2个对手→2条候选(同一张真杀牌,不同目标各一条)
    if(shaFromNormal.length !== 2) throw new Error('常规枚举应按2个目标展开收录真杀,实际 ' + shaFromNormal.length);
    var s = BOT_SEAT_PICKS.longdan;
    if(!s.match(g, 0)) throw new Error('闪同时在手应仍命中 longdan(不受真杀存在影响)');
  });

  await check('龙胆反方向(杀当闪,被动响应)不受本次改动影响:findUsableAs 仍直接命中本名/转化牌', function(){
    var me = { hand: [{ name:'杀', id:'ldr1' }], caps:{ longdan:true } };
    var idx = findUsableAs(me.hand, me, '闪');
    if(idx !== 0) throw new Error('杀当闪应命中手里那张杀,实际 idx=' + idx);
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

    // 场景3:手牌无借刀(也无其它多步技能) → 4个决策依次未命中(无密钥时 seatPick 不接线)
    // → 走 runBotActionWindow
    wired = [];
    window.__windowCalls = 0;
    botTwoStepA = null;
    var g3 = mkSeatG({ myHand: [card('杀','j15')] });
    await runBotDecision(g3, 0);
    if(window.__windowCalls !== 1) throw new Error('jiedaoTwoStep 未命中时应走 runBotActionWindow,实际 ' + window.__windowCalls);
    if(wired.join(',') !== 'jiedaoTwoStep,lijianTwoStep,zhangbaTwoStep,rendeTwoStep,fangtian')
      throw new Error('无挂起态时应按序尝试4个多步+fangtian,实际 ' + wired.join(','));

    // 场景4:botTwoStepA 挂起但阶段B无候选(A无射程内目标:无武器range1+自己装+1马+第三人阵亡) → 两次jiedao尝试均 false,其余3决策不命中 → 走窗口不崩
    wired = [];
    window.__windowCalls = 0;
    window.__jiedaoCalls = [];
    botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };
    var g4 = mkSeatG({ myHand: [card('借刀杀人','j16')], aliveOf: { 2: false } });
    g4.players[0].equips.plus1 = { name: '的卢' };
    await runBotDecision(g4, 0);
    if(window.__windowCalls !== 1) throw new Error('阶段B无候选时应走 runBotActionWindow,实际 ' + window.__windowCalls);
    if(wired.join(',') !== 'jiedaoTwoStep,jiedaoTwoStep,lijianTwoStep,zhangbaTwoStep,rendeTwoStep,fangtian')
      throw new Error('阶段B无候选应尝试2次jiedao+3次未命中后放行,实际 ' + wired.join(','));
    if(window.__jiedaoCalls.length !== 0) throw new Error('阶段B无候选不应提交 jieDaoShaRen');

    botDecide = realBotDecide;
    runBotActionWindow = realWindow;
    botTwoStepA = null;
  });

  function mkJiedaoResponseG(opt){
    var g = mkSeatG(opt);
    g.phase = 'jiedaoChoice';
    g.pending = { type: 'jiedaoChoice', from: 1, to: 0, seatA: 0, seatB: 2 };
    return g;
  }

  await check('A5借刀响应:match 仅 phase/type/seatA 全正确时命中', function(){
    var s = BOT_DECISIONS.jiedaoResponse;
    if(!s) throw new Error('BOT_DECISIONS.jiedaoResponse 未注册');
    var g = mkJiedaoResponseG({});
    if(!s.match(g, 0)) throw new Error('完整 jiedaoChoice pending 应命中');
    if(s.match(g, 1)) throw new Error('seatA 非本人不应命中');
    var g2 = mkJiedaoResponseG({});
    g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('错 phase 不应命中');
    var g3 = mkJiedaoResponseG({});
    g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('错 pending.type 不应命中');
  });

  await check('A5借刀响应候选:有杀含出杀+弃武器;将驰禁杀/无杀仅弃武器', function(){
    var s = BOT_DECISIONS.jiedaoResponse;
    var g1 = mkJiedaoResponseG({ myHand: [card('桃', 'a50'), card('杀', 'a51')] });
    var c1 = s.buildCandidates(g1, 0);
    if(c1.length !== 2 || c1[0].play !== true || c1[0].cardIdx !== 1 || c1[1].play !== false)
      throw new Error('有杀候选应为出杀(idx1)+弃武器,实际 ' + JSON.stringify(c1));
    var g2 = mkJiedaoResponseG({ jiangchiNoSlash: true, myHand: [card('杀', 'a52')] });
    var c2 = s.buildCandidates(g2, 0);
    if(c2.length !== 1 || c2[0].play !== false)
      throw new Error('将驰禁杀应仅弃武器,实际 ' + JSON.stringify(c2));
    var g3 = mkJiedaoResponseG({ myHand: [card('桃', 'a53')] });
    var c3 = s.buildCandidates(g3, 0);
    if(c3.length !== 1 || c3[0].play !== false)
      throw new Error('无杀应仅弃武器,实际 ' + JSON.stringify(c3));
  });

  await check('A5借刀响应有密钥:mock 选出杀/弃武器分别提交精确参数', async function(){
    window.__jiedaoResponseCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = 'test-key'; aiProvider = 'claude';
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    var g = mkJiedaoResponseG({ myHand: [card('桃', 'a54'), card('杀', 'a55')] });
    var r1 = await botDecide('jiedaoResponse', g, 0);
    if(r1 !== true || window.__mockAiCalls !== 1) throw new Error('mock 出杀 AI 调用异常,实际 r=' + r1);
    if(window.__jiedaoResponseCalls.length !== 1 || window.__jiedaoResponseCalls[0][0] !== true || window.__jiedaoResponseCalls[0][1] !== 1)
      throw new Error('应 respondJiedao(true,1),实际 ' + JSON.stringify(window.__jiedaoResponseCalls));
    window.__jiedaoResponseCalls = [];
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    var r2 = await botDecide('jiedaoResponse', g, 0);
    if(r2 !== true || window.__mockAiCalls !== 2) throw new Error('mock 弃武器 AI 调用异常,实际 r=' + r2);
    if(window.__jiedaoResponseCalls.length !== 1 || window.__jiedaoResponseCalls[0][0] !== false || window.__jiedaoResponseCalls[0][1] !== null)
      throw new Error('应 respondJiedao(false,null),实际 ' + JSON.stringify(window.__jiedaoResponseCalls));
  });

  await check('A5借刀响应无密钥 fallback:普通有杀出杀;jiangchiNoSlash=true 即使有杀也弃武器', async function(){
    window.__jiedaoResponseCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g1 = mkJiedaoResponseG({ myHand: [card('杀', 'a56')] });
    var r1 = await botDecide('jiedaoResponse', g1, 0);
    if(r1 !== true || window.__jiedaoResponseCalls.length !== 1 || window.__jiedaoResponseCalls[0][0] !== true || window.__jiedaoResponseCalls[0][1] !== 0)
      throw new Error('普通有杀应 respondJiedao(true,0),实际 ' + JSON.stringify(window.__jiedaoResponseCalls));
    window.__jiedaoResponseCalls = [];
    var g2 = mkJiedaoResponseG({ jiangchiNoSlash: true, myHand: [card('杀', 'a57')] });
    var r2 = await botDecide('jiedaoResponse', g2, 0);
    if(r2 !== true || window.__jiedaoResponseCalls.length !== 1 || window.__jiedaoResponseCalls[0][0] !== false || window.__jiedaoResponseCalls[0][1] !== null)
      throw new Error('将驰禁杀应 respondJiedao(false,null),实际 ' + JSON.stringify(window.__jiedaoResponseCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应调用 AI,实际 ' + window.__mockAiCalls);
  });

  await check('A5借刀响应接线:runBotDecision 命中 jiedaoResponse 一次且服务函数调用一次', async function(){
    window.__jiedaoResponseCalls = [];
    aiApiKey = ''; aiProvider = null;
    var ids = [];
    var original = botDecide;
    botDecide = async function(id, gg, ss){ ids.push(id); return original(id, gg, ss); };
    try {
      await runBotDecision(mkJiedaoResponseG({ myHand: [card('杀', 'a58')] }), 0);
    } finally { botDecide = original; }
    if(ids.filter(function(id){ return id === 'jiedaoResponse'; }).length !== 1)
      throw new Error('jiedaoResponse 应恰调用一次,实际 ' + JSON.stringify(ids));
    if(window.__jiedaoResponseCalls.length !== 1 || window.__jiedaoResponseCalls[0][0] !== true || window.__jiedaoResponseCalls[0][1] !== 0)
      throw new Error('服务函数应调用一次 respondJiedao(true,0),实际 ' + JSON.stringify(window.__jiedaoResponseCalls));
  });

  await check('A5借刀响应调度登记:EXCLUDE 含 jiedaoChoice;BOT_PHASE_ACTOR.jiedaoChoice=seatA', function(){
    if(!CONTROLS_CHOICE_EXCLUDE.has('jiedaoChoice')) throw new Error('CONTROLS_CHOICE_EXCLUDE 缺少 jiedaoChoice');
    if(BOT_PHASE_ACTOR.jiedaoChoice !== 'seatA') throw new Error('BOT_PHASE_ACTOR.jiedaoChoice 应为 seatA,实际 ' + BOT_PHASE_ACTOR.jiedaoChoice);
  });

  // ================= T5:多步两阶段扩展(离间/丈八/仁德) =================
  // 离间:入口门槛镜像 render-controls.js:3746(hasCap+限一次+手牌≥1+存活男性≥2);
  //   阶段A=存活男性(render.js 1358 isMale(p) 无自己排除,含自己);阶段B=≠from 的存活男性。
  // 丈八:入口门槛镜像 render-controls.js:3712(twoAsSha+手牌≥2+canSha)+服务端
  //   playZhangbaSha 的将驰/次数守卫;三阶段:A/B=两张手牌(≠a)、C=目标(canReachSha+非空城)。
  // 仁德:render.js 1401-1410(无入口按钮,选中手牌后在目标座位出现"仁德:交给此人");
  //   服务端 renDe 无本回合次数限制(renDeCount 只用于第2张后的回复),match 不加次数守卫。

  await check('离间:match=出牌阶段+自己回合+hasCap+未用+手牌≥1+男性≥2;阶段A候选=存活男性(含自己)', function(){
    var s = BOT_DECISIONS.lijianTwoStep;
    if(!s) throw new Error('BOT_DECISIONS.lijianTwoStep 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','l0')] });
    if(s.match(g1, 0)) throw new Error('无离间技能不应命中');
    var g2 = mkSeatG({ caps0: { lijian: true }, myHand: [] });
    if(s.match(g2, 0)) throw new Error('无手牌不应命中');
    var g3 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l1')], aliveOf: { 1: false, 2: false } });
    if(s.match(g3, 0)) throw new Error('男性<2(只剩自己)不应命中');
    var g4 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l2')], liJianUsed: true });
    if(s.match(g4, 0)) throw new Error('本回合已用离间不应命中');
    var g5 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l3')] });
    if(!s.match(g5, 0)) throw new Error('男性≥2+有手牌应命中');
    g5.turn = 1;
    if(s.match(g5, 0)) throw new Error('非自己回合不应命中');
    g5.turn = 0; g5.phase = 'discard';
    if(s.match(g5, 0)) throw new Error('非出牌阶段不应命中');
    g5.phase = 'play';
    // 阶段A:默认3人全是男性(于吉)→ 候选含自己 0,1,2(镜像 render.js 1358 无自己排除)
    var c5 = s.buildCandidates(g5, 0);
    var seats = c5.map(function(c){ return c.a; }).sort().join(',');
    if(seats !== '0,1,2') throw new Error('阶段A候选应为 0,1,2(含自己),实际 ' + seats);
    if(c5[0].step !== 'A' || c5[0].label.indexOf('离间') < 0)
      throw new Error('候选应带 step:A+离间前缀,实际 ' + JSON.stringify(c5[0]));
    // 女将自己(大乔)不是候选
    var g6 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l4')], generalOf: { 0: 'daqiao' } });
    var c6 = s.buildCandidates(g6, 0);
    if(c6.map(function(c){ return c.a; }).join(',') !== '1,2')
      throw new Error('女将自己应排除,实际 ' + JSON.stringify(c6));
  });

  await check('离间阶段B:候选=≠from 的存活男性(镜像 render.js 1364)', function(){
    var s = BOT_DECISIONS.lijianTwoStep;
    var g1 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l5')] });
    botTwoStepA = { decisionId: 'lijianTwoStep', a: 1 };
    var c1 = s.buildCandidates(g1, 0);
    var seats = c1.map(function(c){ return c.toSeat; }).sort().join(',');
    if(seats !== '0,2') throw new Error('阶段B候选应为 0,2,实际 ' + seats);
    if(c1[0].step !== 'B' || c1[0].fromSeat !== 1)
      throw new Error('候选应带 step:B+fromSeat,实际 ' + JSON.stringify(c1[0]));
    // 死者排除
    var g2 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l6')], aliveOf: { 2: false } });
    botTwoStepA = { decisionId: 'lijianTwoStep', a: 1 };
    var c2 = s.buildCandidates(g2, 0);
    if(c2.length !== 1 || c2[0].toSeat !== 0) throw new Error('死者(座位2)应排除,实际 ' + JSON.stringify(c2));
    // from 自己不能当 to
    var g3 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l7')] });
    botTwoStepA = { decisionId: 'lijianTwoStep', a: 0 };
    var c3 = s.buildCandidates(g3, 0);
    if(c3.some(function(c){ return c.toSeat === 0; })) throw new Error('from 自己不能出现在阶段B');
    botTwoStepA = null;
  });

  await check('离间两阶段无密钥:调度1 阶段A挂起 botTwoStepA;调度2 阶段B提交 liJian(第一张手牌idx,from,to) 并重置;无AI调用', async function(){
    window.__lijianCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    // 女将自己+两名男对手:阶段A候选=1,2 → candidates[0]=1;阶段B=≠1 → 2
    var g = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l8')], generalOf: { 0: 'daqiao' } });
    var r1 = await botDecide('lijianTwoStep', g, 0);
    if(r1 !== true) throw new Error('阶段A应返回 true,实际 ' + r1);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'lijianTwoStep' || botTwoStepA.a !== 1)
      throw new Error('阶段A后 botTwoStepA 应={lijianTwoStep,a:1},实际 ' + JSON.stringify(botTwoStepA));
    if(window.__lijianCalls.length !== 0) throw new Error('阶段A不应提交 liJian');
    var r2 = await botDecide('lijianTwoStep', g, 0);
    if(r2 !== true) throw new Error('阶段B应返回 true,实际 ' + r2);
    if(botTwoStepA !== null) throw new Error('阶段B提交后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__lijianCalls.length !== 1) throw new Error('liJian 应被调1次,实际 ' + window.__lijianCalls.length);
    var call0 = window.__lijianCalls[0];
    if(call0[0] !== 0 || call0[1] !== 1 || call0[2] !== 2)
      throw new Error('应 liJian(0,1,2),实际 ' + JSON.stringify(call0));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('离间阶段B有密钥:mock 选 to → liJian(0,from,to);userPrompt 不含他人手牌', async function(){
    window.__lijianCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','l9')],
      hands: { 1: [card('桃园结义','sec')], 2: [card('桃','la')] } });
    botTwoStepA = { decisionId: 'lijianTwoStep', a: 1 };
    var r = await botDecide('lijianTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__lijianCalls.length !== 1 || window.__lijianCalls[0][1] !== 1 || window.__lijianCalls[0][2] !== 2)
      throw new Error('应 liJian(0,1,2),实际 ' + JSON.stringify(window.__lijianCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    botTwoStepA = null;
  });

  await check('丈八:match=出牌阶段+自己回合+装丈八(twoAsSha)+手牌≥2+还能出杀+存在可达目标;阶段A候选=每张手牌', function(){
    var s = BOT_DECISIONS.zhangbaTwoStep;
    if(!s) throw new Error('BOT_DECISIONS.zhangbaTwoStep 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','z0'), card('闪','z1')] });
    if(s.match(g1, 0)) throw new Error('未装丈八不应命中');
    var g2 = mkSeatG({ myHand: [card('杀','z2')] });
    g2.players[0].equips.weapon = { name: '丈八蛇矛' };
    if(s.match(g2, 0)) throw new Error('手牌<2不应命中');
    var g3 = mkSeatG({ myHand: [card('杀','z3'), card('闪','z4')], shaUsed: true });
    g3.players[0].equips.weapon = { name: '丈八蛇矛' };
    if(s.match(g3, 0)) throw new Error('本回合已出杀(无无限杀)不应命中');
    var g4 = mkSeatG({ caps0: { unlimitedSha: true }, myHand: [card('杀','z5'), card('闪','z6')], shaUsed: true });
    g4.players[0].equips.weapon = { name: '丈八蛇矛' };
    if(!s.match(g4, 0)) throw new Error('无限杀者已出杀仍应命中');
    var g5 = mkSeatG({ myHand: [card('杀','z7'), card('闪','z8')], aliveOf: { 1: false, 2: false } });
    g5.players[0].equips.weapon = { name: '丈八蛇矛' };
    if(s.match(g5, 0)) throw new Error('无存活目标不应命中');
    var g6 = mkSeatG({ myHand: [card('杀','z9'), card('闪','za')] });
    g6.players[0].equips.weapon = { name: '丈八蛇矛' };
    if(!s.match(g6, 0)) throw new Error('装丈八+手牌≥2+能出杀应命中');
    g6.players[0].jiangchiNoSlash = true;
    if(s.match(g6, 0)) throw new Error('将驰选项1(本回合不能出杀)不应命中');
    g6.players[0].jiangchiNoSlash = undefined;
    g6.turn = 1;
    if(s.match(g6, 0)) throw new Error('非自己回合不应命中');
    g6.turn = 0; g6.phase = 'discard';
    if(s.match(g6, 0)) throw new Error('非出牌阶段不应命中');
    g6.phase = 'play';
    var c6 = s.buildCandidates(g6, 0);
    if(c6.length !== 2 || c6[0].step !== 'A' || c6[0].a !== 0 || c6[1].a !== 1)
      throw new Error('阶段A候选应为两张手牌 0,1,实际 ' + JSON.stringify(c6));
    if(c6[0].label.indexOf('丈八') < 0) throw new Error('label 应含丈八前缀,实际 ' + c6[0].label);
  });

  await check('丈八阶段B/C:阶段B=≠a 的手牌;阶段C=存活非自己+canReachSha+非空城', function(){
    var s = BOT_DECISIONS.zhangbaTwoStep;
    var g1 = mkSeatG({ myHand: [card('杀','zb'), card('闪','zc'), card('桃','zd')] });
    g1.players[0].equips.weapon = { name: '丈八蛇矛' };
    botTwoStepA = { decisionId: 'zhangbaTwoStep', a: 0 };
    var c1 = s.buildCandidates(g1, 0);
    var idxs = c1.map(function(c){ return c.b; }).sort().join(',');
    if(idxs !== '1,2') throw new Error('阶段B候选应为手牌 1,2(≠a),实际 ' + idxs);
    if(c1[0].step !== 'B' || c1[0].a !== 0) throw new Error('候选应带 step:B+a,实际 ' + JSON.stringify(c1[0]));
    botTwoStepA = { decisionId: 'zhangbaTwoStep', a: 0, b: 1 };
    var c2 = s.buildCandidates(g1, 0);
    var seats = c2.map(function(c){ return c.targetSeat; }).sort().join(',');
    if(seats !== '1,2') throw new Error('阶段C候选应为 1,2,实际 ' + seats);
    if(c2[0].step !== 'C' || c2[0].a !== 0 || c2[0].b !== 1)
      throw new Error('候选应带 step:C+a+b,实际 ' + JSON.stringify(c2[0]));
    // 空城者排除(诸葛亮)
    var g2 = mkSeatG({ myHand: [card('杀','ze'), card('闪','zf')] });
    g2.players[0].equips.weapon = { name: '丈八蛇矛' };
    g2.players[1].general = 'zhuge';
    g2.players[1].hand = [];
    botTwoStepA = { decisionId: 'zhangbaTwoStep', a: 0, b: 1 };
    var c3 = s.buildCandidates(g2, 0);
    if(c3.length !== 1 || c3[0].targetSeat !== 2) throw new Error('空城诸葛亮(座位1)应排除,实际 ' + JSON.stringify(c3));
    botTwoStepA = null;
  });

  await check('丈八三阶段无密钥:调度1/2/3 依次挂起 A→B→提交 playZhangbaSha(a,b,target) 并重置;无AI调用', async function(){
    window.__zhangbaCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ myHand: [card('杀','zg'), card('闪','zh')] });
    g.players[0].equips.weapon = { name: '丈八蛇矛' };
    var r1 = await botDecide('zhangbaTwoStep', g, 0);
    if(r1 !== true || !botTwoStepA || botTwoStepA.decisionId !== 'zhangbaTwoStep' || botTwoStepA.a !== 0 || botTwoStepA.b !== undefined)
      throw new Error('调度1后应挂起 {zhangbaTwoStep,a:0},实际 ' + JSON.stringify(botTwoStepA));
    var r2 = await botDecide('zhangbaTwoStep', g, 0);
    if(r2 !== true || !botTwoStepA || botTwoStepA.b !== 1)
      throw new Error('调度2后应挂起 {zhangbaTwoStep,a:0,b:1},实际 ' + JSON.stringify(botTwoStepA));
    var r3 = await botDecide('zhangbaTwoStep', g, 0);
    if(r3 !== true) throw new Error('调度3应返回 true,实际 ' + r3);
    if(botTwoStepA !== null) throw new Error('调度3提交后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__zhangbaCalls.length !== 1 || window.__zhangbaCalls[0][0] !== 0 || window.__zhangbaCalls[0][1] !== 1 || window.__zhangbaCalls[0][2] !== 1)
      throw new Error('应 playZhangbaSha(0,1,1),实际 ' + JSON.stringify(window.__zhangbaCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('丈八阶段C有密钥:mock 选目标 → playZhangbaSha(a,b,target);userPrompt 不含他人手牌', async function(){
    window.__zhangbaCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ myHand: [card('杀','zi'), card('闪','zj')],
      hands: { 1: [card('桃园结义','sec')], 2: [card('桃','zk')] } });
    g.players[0].equips.weapon = { name: '丈八蛇矛' };
    botTwoStepA = { decisionId: 'zhangbaTwoStep', a: 0, b: 1 };
    var r = await botDecide('zhangbaTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__zhangbaCalls.length !== 1 || window.__zhangbaCalls[0][0] !== 0 || window.__zhangbaCalls[0][1] !== 1 || window.__zhangbaCalls[0][2] !== 2)
      throw new Error('应 playZhangbaSha(0,1,2),实际 ' + JSON.stringify(window.__zhangbaCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    botTwoStepA = null;
  });

  await check('仁德:match=出牌阶段+自己回合+hasCap+手牌非空(服务端无次数限制,不加次数守卫);阶段A=存活非自己;阶段B=每张手牌', function(){
    var s = BOT_DECISIONS.rendeTwoStep;
    if(!s) throw new Error('BOT_DECISIONS.rendeTwoStep 未注册');
    var g1 = mkSeatG({ myHand: [card('杀','r0')] });
    if(s.match(g1, 0)) throw new Error('无仁德技能不应命中');
    var g2 = mkSeatG({ caps0: { rende: true }, myHand: [] });
    if(s.match(g2, 0)) throw new Error('无手牌不应命中');
    var g3 = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r1')] });
    if(!s.match(g3, 0)) throw new Error('有技能+有手牌应命中');
    g3.turn = 1;
    if(s.match(g3, 0)) throw new Error('非自己回合不应命中');
    g3.turn = 0; g3.phase = 'discard';
    if(s.match(g3, 0)) throw new Error('非出牌阶段不应命中');
    g3.phase = 'play';
    var c3 = s.buildCandidates(g3, 0);
    if(c3.map(function(c){ return c.a; }).join(',') !== '1,2')
      throw new Error('阶段A候选应为 1,2(存活非自己),实际 ' + JSON.stringify(c3));
    if(c3[0].step !== 'A' || c3[0].label.indexOf('仁德') < 0)
      throw new Error('候选应带 step:A+仁德前缀,实际 ' + JSON.stringify(c3[0]));
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1 };
    var c4 = s.buildCandidates(g3, 0);
    if(c4.length !== 1 || c4[0].step !== 'B' || c4[0].cardIdx !== 0 || c4[0].targetSeat !== 1)
      throw new Error('阶段B候选应为每张手牌一项,实际 ' + JSON.stringify(c4));
    if(c4[0].label.indexOf('仁德') < 0) throw new Error('阶段B label 应含仁德前缀,实际 ' + c4[0].label);
    botTwoStepA = null;
  });

  await check('仁德两阶段无密钥:调度1 阶段A挂起;调度2 阶段B提交 renDe(cardIdx,targetSeat) 并重置;无AI调用', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r2'), card('桃','r3')] });
    var r1 = await botDecide('rendeTwoStep', g, 0);
    if(r1 !== true || !botTwoStepA || botTwoStepA.decisionId !== 'rendeTwoStep' || botTwoStepA.a !== 1)
      throw new Error('调度1后应挂起 {rendeTwoStep,a:1},实际 ' + JSON.stringify(botTwoStepA));
    var r2 = await botDecide('rendeTwoStep', g, 0);
    if(r2 !== true) throw new Error('调度2应返回 true,实际 ' + r2);
    if(botTwoStepA !== null) throw new Error('调度2提交后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__rendeCalls.length !== 1 || window.__rendeCalls[0][0] !== 0 || window.__rendeCalls[0][1] !== 1)
      throw new Error('应 renDe(0,1),实际 ' + JSON.stringify(window.__rendeCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('仁德阶段B有密钥:mock 选手牌 → renDe(cardIdx,targetSeat);userPrompt 不含他人手牌', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r4'), card('桃','r5')],
      hands: { 1: [card('桃园结义','sec')], 2: [card('闪','r6')] } });
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1 };
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__rendeCalls.length !== 1 || window.__rendeCalls[0][0] !== 1 || window.__rendeCalls[0][1] !== 1)
      throw new Error('应 renDe(1,1),实际 ' + JSON.stringify(window.__rendeCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    botTwoStepA = null;
  });

  // ================= A6:仁德 continue 逐张给牌链 =================
  // bot.js A6:阶段B提交一张后 renDeCount<2 且手牌剩牌 → botTwoStepA={...,continue:true},
  // 下一调度候选=剩余手牌+「停止给牌」;选停止/renDeCount>=2/手牌空 → reset 不再给。
  // 无密钥 localFallback 带 stopAfter → 只给一张即停(改动前行为),不设 continue。
  await check('仁德A6-1 阶段A有密钥:mock 选目标 → botTwoStepA={rendeTwoStep,a:目标};userPrompt 候选=存活非自己', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r10'), card('桃','r11')] });
    g.renDeCount = 0;
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'rendeTwoStep' || botTwoStepA.a !== 2)
      throw new Error('阶段A mock选2后应挂起 {rendeTwoStep,a:2},实际 ' + JSON.stringify(botTwoStepA));
    if(botTwoStepA.continue) throw new Error('阶段A不应带 continue,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__rendeCalls.length !== 0) throw new Error('阶段A不应提交 renDe,实际 ' + JSON.stringify(window.__rendeCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('玩家2') < 0) throw new Error('userPrompt 候选应含玩家2(存活非自己),实际 ' + up);
    var candPart = up.slice(up.indexOf('合法候选'));
    if(candPart.indexOf('机器人0') >= 0) throw new Error('候选列表不应含自己,实际 ' + candPart);
    botTwoStepA = null;
  });

  await check('仁德A6-2 阶段B非continue:候选=每张手牌一项,无停止项;非continue空手牌 match false', function(){
    var s = BOT_DECISIONS.rendeTwoStep;
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r20'), card('桃','r21'), card('闪','r22')] });
    g.renDeCount = 0;
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1 };
    var c = s.buildCandidates(g, 0);
    if(c.length !== 3) throw new Error('非continue阶段B候选应为手牌每张一项(3),实际 ' + c.length);
    if(c.some(function(x){ return x.stop; })) throw new Error('非continue阶段B不应有停止项,实际 ' + JSON.stringify(c));
    if(c.some(function(x){ return x.step !== 'B'; })) throw new Error('全部候选应为 step:B,实际 ' + JSON.stringify(c));
    if(c.map(function(x){ return x.cardIdx; }).join(',') !== '0,1,2')
      throw new Error('cardIdx 应为 0,1,2,实际 ' + c.map(function(x){ return x.cardIdx; }).join(','));
    var g2 = mkSeatG({ caps0: { rende: true }, myHand: [] });
    if(s.match(g2, 0)) throw new Error('非continue空手牌不应命中');
    botTwoStepA = null;
  });

  await check('仁德A6-3 阶段B提交一张后 renDeCount<2 且手牌剩牌 → botTwoStepA 设 continue:true', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r30'), card('桃','r31')] });
    g.renDeCount = 0;
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1 };
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true) throw new Error('调度应返回 true,实际 ' + r);
    if(window.__rendeCalls.length !== 1 || window.__rendeCalls[0][0] !== 0 || window.__rendeCalls[0][1] !== 1)
      throw new Error('应 renDe(0,1),实际 ' + JSON.stringify(window.__rendeCalls));
    if(!botTwoStepA || botTwoStepA.decisionId !== 'rendeTwoStep' || botTwoStepA.a !== 1 || !botTwoStepA.continue)
      throw new Error('提交后应挂起 {rendeTwoStep,a:1,continue:true},实际 ' + JSON.stringify(botTwoStepA));
    botTwoStepA = null;
  });

  await check('仁德A6-4 continue态候选=剩余手牌+停止给牌;mock 选停止 → reset 不再给', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":2}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r40'), card('桃','r41')] });
    g.renDeCount = 1;
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1, continue: true };
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('停止给牌') < 0) throw new Error('continue态 userPrompt 应含停止给牌,实际 ' + up);
    if(up.indexOf('杀') < 0 || up.indexOf('桃') < 0) throw new Error('continue态候选应含剩余手牌,实际 ' + up);
    // mock 选 choice:2 = 停止项(2手牌+1停止,停止在末尾)
    if(botTwoStepA !== null) throw new Error('选停止后应 reset,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__rendeCalls.length !== 0) throw new Error('选停止不应再给牌,实际 ' + JSON.stringify(window.__rendeCalls));
    botTwoStepA = null;
  });

  await check('仁德A6-5 无密钥 fallback:调度1挂起阶段A;调度2只给一张即停(stopAfter 生效),不设 continue,与改动前一致', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r50'), card('桃','r51')] });
    g.renDeCount = 0;
    var r1 = await botDecide('rendeTwoStep', g, 0);
    if(r1 !== true || !botTwoStepA || botTwoStepA.a !== 1)
      throw new Error('调度1应挂起 {rendeTwoStep,a:1},实际 ' + JSON.stringify(botTwoStepA));
    var r2 = await botDecide('rendeTwoStep', g, 0);
    if(r2 !== true) throw new Error('调度2应返回 true,实际 ' + r2);
    if(window.__rendeCalls.length !== 1 || window.__rendeCalls[0][0] !== 0 || window.__rendeCalls[0][1] !== 1)
      throw new Error('只应给一张 renDe(0,1),实际 ' + JSON.stringify(window.__rendeCalls));
    if(botTwoStepA !== null) throw new Error('一张即停后应 reset 且不设 continue,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
    var r3 = await botDecide('rendeTwoStep', g, 0);
    if(r3 !== true || !botTwoStepA || botTwoStepA.continue || botTwoStepA.a !== 1)
      throw new Error('调度3应重新从阶段A挂起(未设continue),实际 ' + JSON.stringify(botTwoStepA));
    botTwoStepA = null;
  });

  await check('仁德A6-6 renDeCount>=2 或手牌空 → 提交后 reset,不设 continue', async function(){
    // 分支1:renDeCount=2(本回合已给两张,第三张即收尾)
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','r60'), card('桃','r61')] });
    g.renDeCount = 2;
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1 };
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true || window.__rendeCalls.length !== 1)
      throw new Error('renDeCount=2 应提交一张,实际 ' + JSON.stringify(window.__rendeCalls));
    if(botTwoStepA !== null) throw new Error('renDeCount>=2 提交后应 reset,实际 ' + JSON.stringify(botTwoStepA));
    // 分支2:手牌空(最后一张已给完) → execute 提交后 reset
    var g2 = mkSeatG({ caps0: { rende: true }, myHand: [] });
    g2.renDeCount = 0;
    BOT_DECISIONS.rendeTwoStep.execute(g2, 0, { step: 'B', cardIdx: 0, targetSeat: 1 });
    if(botTwoStepA !== null) throw new Error('手牌空提交后应 reset 不设 continue,实际 ' + JSON.stringify(botTwoStepA));
    botTwoStepA = null;
  });

  await check('仁德A6-7 continue态手牌空:match 命中,候选只剩停止,无密钥选停止 → reset 清挂起', async function(){
    window.__rendeCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = '';
    aiProvider = null;
    var g = mkSeatG({ caps0: { rende: true }, myHand: [] });
    g.renDeCount = 0;
    botTwoStepA = { decisionId: 'rendeTwoStep', a: 1, continue: true };
    var s = BOT_DECISIONS.rendeTwoStep;
    if(!s.match(g, 0)) throw new Error('continue态空手牌应命中 match');
    var c = s.buildCandidates(g, 0);
    if(c.length !== 1 || !c[0].stop || c[0].step !== 'B')
      throw new Error('候选应只剩停止项,实际 ' + JSON.stringify(c));
    var r = await botDecide('rendeTwoStep', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(botTwoStepA !== null) throw new Error('选停止后应 reset 清挂起,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__rendeCalls.length !== 0) throw new Error('不应再给牌,实际 ' + JSON.stringify(window.__rendeCalls));
    if(window.__mockAiCalls !== 0) throw new Error('单候选不应有AI调用,实际 ' + window.__mockAiCalls);
    botTwoStepA = null;
    aiApiKey = 'test-key';
    aiProvider = 'claude';
  });

  await check('多步接线:优先级 借刀>离间>丈八>仁德;挂起期只处理挂起的那一个决策;阶段B提交后不再走 runBotActionWindow;未命中才走窗口', async function(){
    var realBotDecide = botDecide;
    var realWindow = runBotActionWindow;
    var wired = [];
    botDecide = async function(decisionId, gg, seat){ wired.push(decisionId); return realBotDecide(decisionId, gg, seat); };
    runBotActionWindow = async function(){ window.__windowCalls++; };

    // 场景1:借刀+离间同时可发动(手牌有借刀+有离间能力+男性≥2) → 借刀优先命中,挂起 jiedao
    wired = []; window.__windowCalls = 0;
    botTwoStepA = null;
    var g1 = mkSeatG({ caps0: { lijian: true }, myHand: [card('借刀杀人','m0')] });
    g1.players[1].equips.weapon = { name: '青龙偃月刀' };
    await runBotDecision(g1, 0);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'jiedaoTwoStep')
      throw new Error('借刀应优先于离间命中,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__windowCalls !== 0) throw new Error('阶段A命中后不应走窗口');

    // 场景2:无借刀,离间可发动 → lijianTwoStep 挂起(阶段A),不走窗口
    wired = []; window.__windowCalls = 0;
    botTwoStepA = null;
    var g2 = mkSeatG({ caps0: { lijian: true }, myHand: [card('杀','m1')], generalOf: { 0: 'daqiao' } });
    await runBotDecision(g2, 0);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'lijianTwoStep' || botTwoStepA.a !== 1)
      throw new Error('离间阶段A应挂起,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__windowCalls !== 0) throw new Error('阶段A命中后不应走窗口');

    // 场景3:挂起离间后手牌补一张借刀 → 下一调度只处理 lijianTwoStep(挂起守卫挡住借刀)
    wired = []; window.__windowCalls = 0;
    window.__lijianCalls = [];
    g2.players[0].hand.push(card('借刀杀人','m2'));
    await runBotDecision(g2, 0);
    if(window.__lijianCalls.length !== 1) throw new Error('挂起离间应走阶段B提交 liJian,实际 ' + JSON.stringify(window.__lijianCalls));
    if(wired.join(',') !== 'lijianTwoStep') throw new Error('挂起期只应尝试 lijianTwoStep,实际 ' + wired.join(','));
    if(window.__windowCalls !== 0) throw new Error('阶段B命中后不应走窗口');
    if(botTwoStepA !== null) throw new Error('提交后应重置,实际 ' + JSON.stringify(botTwoStepA));

    // 场景4:丈八三阶段挂起至阶段C → 一次调度提交 playZhangbaSha,不走窗口
    wired = []; window.__windowCalls = 0;
    window.__zhangbaCalls = [];
    botTwoStepA = { decisionId: 'zhangbaTwoStep', a: 0, b: 1 };
    var g4 = mkSeatG({ myHand: [card('杀','m3'), card('闪','m4')] });
    g4.players[0].equips.weapon = { name: '丈八蛇矛' };
    await runBotDecision(g4, 0);
    if(window.__zhangbaCalls.length !== 1 || window.__zhangbaCalls[0][2] !== 1)
      throw new Error('丈八阶段C应提交,实际 ' + JSON.stringify(window.__zhangbaCalls));
    if(botTwoStepA !== null) throw new Error('丈八提交后应重置');
    if(wired.join(',') !== 'zhangbaTwoStep') throw new Error('挂起期只应尝试 zhangbaTwoStep,实际 ' + wired.join(','));

    // 场景5:仁德可发动(无其它多步) → 挂起 rendeTwoStep 阶段A;下一调度阶段B提交 renDe
    wired = []; window.__windowCalls = 0;
    botTwoStepA = null;
    var g5 = mkSeatG({ caps0: { rende: true }, myHand: [card('杀','m5')] });
    await runBotDecision(g5, 0);
    if(!botTwoStepA || botTwoStepA.decisionId !== 'rendeTwoStep' || botTwoStepA.a !== 1)
      throw new Error('仁德阶段A应挂起,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__windowCalls !== 0) throw new Error('阶段A命中后不应走窗口');
    wired = []; window.__windowCalls = 0;
    window.__rendeCalls = [];
    await runBotDecision(g5, 0);
    if(window.__rendeCalls.length !== 1 || window.__rendeCalls[0][0] !== 0 || window.__rendeCalls[0][1] !== 1)
      throw new Error('仁德阶段B应提交 renDe(0,1),实际 ' + JSON.stringify(window.__rendeCalls));
    if(botTwoStepA !== null) throw new Error('仁德提交后应重置');
    if(wired.join(',') !== 'rendeTwoStep') throw new Error('挂起期只应尝试 rendeTwoStep,实际 ' + wired.join(','));

    // 场景6:全未命中(无技能无武器) → 只试4个决策各1次+seatPick后走窗口
    wired = []; window.__windowCalls = 0;
    botTwoStepA = null;
    var g6 = mkSeatG({ myHand: [card('杀','m6')] });
    await runBotDecision(g6, 0);
    if(window.__windowCalls !== 1) throw new Error('全未命中应走 runBotActionWindow,实际 ' + window.__windowCalls);
    if(wired.join(',') !== 'jiedaoTwoStep,lijianTwoStep,zhangbaTwoStep,rendeTwoStep,seatPick,fangtian')
      throw new Error('全未命中应按序尝试4个多步+seatPick+fangtian,实际 ' + wired.join(','));

    botDecide = realBotDecide;
    runBotActionWindow = realWindow;
    botTwoStepA = null;
  });

  // ================= T6:高价值响应三兄弟(dying/duel/aoeResp)进总线 =================
  // 服务端真实 pending 结构:dying={type:'dying',seat(濒死者),asking};duel={type:'duel',
  // from,to,active};aoeResp={type:'aoeResp',from,to,need}。本地回退与旧 runBotDecision
  // 硬编码分支逐字一致(见 bot.js 注册表上方注释),无密钥行为零变化。
  respondDying = spyService('dying');
  duelResponse = spyService('duel');
  aoeRespond = spyService('aoeResp');

  function mkDyingG(opt){
    opt = opt || {};
    var g = mkSeatG(opt);
    g.phase = 'dying';
    g.pending = { type: 'dying', seat: opt.dyingSeat !== undefined ? opt.dyingSeat : 1, asking: 0, resume: { type: 'sha' } };
    return g;
  }
  function mkDuelG(opt){
    var g = mkSeatG(opt);
    g.phase = 'duel';
    g.pending = { type: 'duel', from: 1, to: 0, active: 0 };
    return g;
  }
  function mkAoeG(opt){
    opt = opt || {};
    var g = mkSeatG(opt);
    g.phase = 'aoeResp';
    g.pending = { type: 'aoeResp', from: 1, to: 0, need: opt.need || '杀' };
    return g;
  }

  await check('dying:注册存在;match=phase+type+asking;错阶段/错asking false;候选=有桃2项/无桃1项', function(){
    var s = BOT_DECISIONS.dying;
    if(!s) throw new Error('BOT_DECISIONS.dying 未注册');
    var g1 = mkDyingG({ myHand: [card('桃','t0')] });
    if(!s.match(g1, 0)) throw new Error('asking=0 应命中');
    if(s.match(g1, 1)) throw new Error('非 asking 不应命中');
    var g1b = mkDyingG({ myHand: [card('桃','t0')] });
    g1b.phase = 'play';
    if(s.match(g1b, 0)) throw new Error('错阶段不应命中');
    var c1 = s.buildCandidates(g1, 0);
    if(c1.length !== 2 || !c1[0].save || c1[1].save !== false)
      throw new Error('有桃应2候选[打出桃,不出],实际 ' + JSON.stringify(c1));
    var g3 = mkDyingG({ myHand: [] });
    var c3 = s.buildCandidates(g3, 0);
    if(c3.length !== 1 || c3[0].save !== false)
      throw new Error('无桃应只1候选不出,实际 ' + JSON.stringify(c3));
  });

  await check('dying无密钥:忠臣救主公(有桃)→true;反贼救主公(有桃)→false;自救(有桃)→true', async function(){
    window.__dyingCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkDyingG({ myHand: [card('桃','t1')] });
    g1.players[0].role = 'zhong'; g1.players[1].role = 'zhu';
    await botDecide('dying', g1, 0);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== true)
      throw new Error('忠臣救主公应 respondDying(true),实际 ' + JSON.stringify(window.__dyingCalls));
    window.__dyingCalls = [];
    var g2 = mkDyingG({ myHand: [card('桃','t2')] });
    g2.players[0].role = 'fan'; g2.players[1].role = 'zhu';
    await botDecide('dying', g2, 0);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== false)
      throw new Error('反贼救主公应 respondDying(false),实际 ' + JSON.stringify(window.__dyingCalls));
    window.__dyingCalls = [];
    var g3 = mkDyingG({ dyingSeat: 0, myHand: [card('桃','t3')] });
    g3.players[0].role = 'fan'; g3.players[1].role = 'zhu';
    await botDecide('dying', g3, 0);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== true)
      throw new Error('自救应 respondDying(true),实际 ' + JSON.stringify(window.__dyingCalls));
  });

  await check('dying单候选(无桃)有密钥:无AI调用,直接执行不出 → respondDying(false)', async function(){
    window.__dyingCalls = []; window.__mockAiCalls = 0;
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkDyingG({ myHand: [] });
    var r = await botDecide('dying', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__mockAiCalls !== 0) throw new Error('单候选不应调AI,实际 ' + window.__mockAiCalls);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== false)
      throw new Error('应 respondDying(false),实际 ' + JSON.stringify(window.__dyingCalls));
  });

  await check('dying有密钥:mock 出桃(choice0,候选index=打出)→respondDying(true);mock 不出(choice1)→false;userPrompt 含濒死者公开名、不含他人手牌', async function(){
    window.__dyingCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkDyingG({ myHand: [card('桃','t4')], hands: { 1: [card('桃园结义','sec')] } });
    g.players[1].name = '濒死者甲';
    var r = await botDecide('dying', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== true)
      throw new Error('mock 出桃应 respondDying(true),实际 ' + JSON.stringify(window.__dyingCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('濒死者甲') < 0) throw new Error('userPrompt 应含濒死者公开名(濒死者甲),实际 ' + up);
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    window.__dyingCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    await botDecide('dying', g, 0);
    if(window.__mockAiCalls !== 1 || window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== false)
      throw new Error('mock 不出应 respondDying(false),实际 ' + JSON.stringify(window.__dyingCalls));
  });

  await check('duel:注册存在;match=phase+active;候选=有杀2项/无杀或将驰禁杀1项', function(){
    var s = BOT_DECISIONS.duel;
    if(!s) throw new Error('BOT_DECISIONS.duel 未注册');
    var g1 = mkDuelG({ myHand: [card('杀','s0')] });
    if(!s.match(g1, 0)) throw new Error('active=0 应命中');
    if(s.match(g1, 1)) throw new Error('非 active 不应命中');
    var g1b = mkDuelG({ myHand: [card('杀','s0')] });
    g1b.phase = 'play';
    if(s.match(g1b, 0)) throw new Error('错阶段不应命中');
    var c1 = s.buildCandidates(g1, 0);
    if(c1.length !== 2 || !c1[0].play || c1[1].play !== false)
      throw new Error('有杀应2候选[出杀,不出],实际 ' + JSON.stringify(c1));
    var g2 = mkDuelG({ myHand: [] });
    if(s.buildCandidates(g2, 0).length !== 1) throw new Error('无杀应1候选');
    var g3 = mkDuelG({ jiangchiNoSlash: true, myHand: [card('杀','s1')] });
    if(s.buildCandidates(g3, 0).length !== 1) throw new Error('将驰禁杀应1候选');
  });

  await check('duel无密钥:有杀→duelResponse(true);将驰禁杀+有杀→duelResponse(false)', async function(){
    window.__duelCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkDuelG({ myHand: [card('杀','s2')] });
    await botDecide('duel', g1, 0);
    if(window.__duelCalls.length !== 1 || window.__duelCalls[0][0] !== true)
      throw new Error('有杀应 duelResponse(true),实际 ' + JSON.stringify(window.__duelCalls));
    window.__duelCalls = [];
    var g2 = mkDuelG({ jiangchiNoSlash: true, myHand: [card('杀','s3')] });
    await botDecide('duel', g2, 0);
    if(window.__duelCalls.length !== 1 || window.__duelCalls[0][0] !== false)
      throw new Error('将驰禁杀应 duelResponse(false),实际 ' + JSON.stringify(window.__duelCalls));
  });

  await check('duel有密钥:mock 出杀(choice0)→duelResponse(true);mock 不出(choice1)→false;userPrompt 不含他人手牌', async function(){
    window.__duelCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkDuelG({ myHand: [card('杀','s4')], hands: { 1: [card('无中生有','sec')] } });
    await botDecide('duel', g, 0);
    if(window.__mockAiCalls !== 1 || window.__duelCalls.length !== 1 || window.__duelCalls[0][0] !== true)
      throw new Error('mock 出杀应 duelResponse(true),实际 ' + JSON.stringify(window.__duelCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('无中生有') >= 0) throw new Error('userPrompt 泄露他人手牌(无中生有)!实际 ' + up);
    window.__duelCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    await botDecide('duel', g, 0);
    if(window.__mockAiCalls !== 1 || window.__duelCalls.length !== 1 || window.__duelCalls[0][0] !== false)
      throw new Error('mock 不出应 duelResponse(false),实际 ' + JSON.stringify(window.__duelCalls));
  });

  await check('aoeResp:注册存在;match=phase+to;候选按 need 出牌/不出(将驰只影响南蛮杀)', function(){
    var s = BOT_DECISIONS.aoeResp;
    if(!s) throw new Error('BOT_DECISIONS.aoeResp 未注册');
    var g1 = mkAoeG({ need: '杀', myHand: [card('杀','a0')] });
    if(!s.match(g1, 0)) throw new Error('to=0 应命中');
    if(s.match(g1, 1)) throw new Error('非 to 不应命中');
    var g1b = mkAoeG({ need: '杀', myHand: [card('杀','a0')] });
    g1b.phase = 'play';
    if(s.match(g1b, 0)) throw new Error('错阶段不应命中');
    var c1 = s.buildCandidates(g1, 0);
    if(c1.length !== 2 || !c1[0].play || c1[1].play !== false)
      throw new Error('有杀应2候选,实际 ' + JSON.stringify(c1));
    var g2 = mkAoeG({ need: '杀', myHand: [] });
    if(s.buildCandidates(g2, 0).length !== 1) throw new Error('无杀应1候选');
    var g3 = mkAoeG({ need: '杀', jiangchiNoSlash: true, myHand: [card('杀','a1')] });
    if(s.buildCandidates(g3, 0).length !== 1) throw new Error('将驰禁杀应1候选');
    var g4 = mkAoeG({ need: '闪', jiangchiNoSlash: true, myHand: [card('闪','a2')] });
    if(s.buildCandidates(g4, 0).length !== 2) throw new Error('将驰不影响出闪,应2候选');
  });

  await check('aoeResp无密钥:南蛮有杀→aoeRespond(true);万箭有闪→true;万箭无闪→false', async function(){
    window.__aoeRespCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkAoeG({ need: '杀', myHand: [card('杀','a3')] });
    await botDecide('aoeResp', g1, 0);
    if(window.__aoeRespCalls.length !== 1 || window.__aoeRespCalls[0][0] !== true)
      throw new Error('南蛮有杀应 aoeRespond(true),实际 ' + JSON.stringify(window.__aoeRespCalls));
    window.__aoeRespCalls = [];
    var g2 = mkAoeG({ need: '闪', myHand: [card('闪','a4')] });
    await botDecide('aoeResp', g2, 0);
    if(window.__aoeRespCalls.length !== 1 || window.__aoeRespCalls[0][0] !== true)
      throw new Error('万箭有闪应 aoeRespond(true),实际 ' + JSON.stringify(window.__aoeRespCalls));
    window.__aoeRespCalls = [];
    var g3 = mkAoeG({ need: '闪', myHand: [] });
    await botDecide('aoeResp', g3, 0);
    if(window.__aoeRespCalls.length !== 1 || window.__aoeRespCalls[0][0] !== false)
      throw new Error('万箭无闪应 aoeRespond(false),实际 ' + JSON.stringify(window.__aoeRespCalls));
  });

  await check('aoeResp有密钥:mock 出牌(choice0)→aoeRespond(true);userPrompt 不含他人手牌', async function(){
    window.__aoeRespCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkAoeG({ need: '杀', myHand: [card('杀','a5')], hands: { 1: [card('桃园结义','sec')] } });
    await botDecide('aoeResp', g, 0);
    if(window.__mockAiCalls !== 1 || window.__aoeRespCalls.length !== 1 || window.__aoeRespCalls[0][0] !== true)
      throw new Error('mock 出牌应 aoeRespond(true),实际 ' + JSON.stringify(window.__aoeRespCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
  });

  await check('接线:runBotDecision dying/duel/aoeResp 各命中一次即调对应服务端,不误调其它响应', async function(){
    window.__dyingCalls = []; window.__duelCalls = []; window.__aoeRespCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkDyingG({ myHand: [card('桃','w0')] });
    g1.players[0].role = 'zhong'; g1.players[1].role = 'zhu';
    await runBotDecision(g1, 0);
    if(window.__dyingCalls.length !== 1 || window.__dyingCalls[0][0] !== true)
      throw new Error('dying 接线应 respondDying(true) 恰1次,实际 ' + JSON.stringify(window.__dyingCalls));
    if(window.__duelCalls.length !== 0 || window.__aoeRespCalls.length !== 0)
      throw new Error('dying 阶段不应误调其它响应');
    var g2 = mkDuelG({ myHand: [card('杀','w1')] });
    await runBotDecision(g2, 0);
    if(window.__duelCalls.length !== 1 || window.__duelCalls[0][0] !== true)
      throw new Error('duel 接线应 duelResponse(true) 恰1次,实际 ' + JSON.stringify(window.__duelCalls));
    var g3 = mkAoeG({ need: '闪', myHand: [card('闪','w2')] });
    await runBotDecision(g3, 0);
    if(window.__aoeRespCalls.length !== 1 || window.__aoeRespCalls[0][0] !== true)
      throw new Error('aoeResp 接线应 aoeRespond(true) 恰1次,实际 ' + JSON.stringify(window.__aoeRespCalls));
    if(window.__dyingCalls.length !== 1 || window.__duelCalls.length !== 1)
      throw new Error('aoeResp 阶段不应误调 dying/duel');
  });

  // ================= T7:wugu挑牌 + pickGeneral(含主公选将)进总线 =================
  // 服务端真实状态:wugu={type:'wugu',from,order,idx,pool}(skills.js wuguPick);
  // 选将:respondPickGeneral/respondPickLordGeneral(room-lifecycle.js)都校验
  // p.generalChoices——主公候选也存 generalChoices(room-lifecycle.js 把
  // g.lordGeneralPool 直接赋给主公的 generalChoices),lordChoices 字段不存在,
  // 注册表用 p.lordChoices||p.generalChoices 自然回退到真实字段。
  // 本地回退与旧 runBotDecision 分支逐字一致:wugu=池首张、选将=botPickGeneral 打分。
  respondPickGeneral = spyService('pickGeneral');
  respondPickLordGeneral = spyService('pickLordGeneral');
  wuguPick = spyService('wugu');

  function mkWuguG(opt){
    opt = opt || {};
    var g = mkSeatG(opt);
    g.phase = 'wugu';
    g.pending = { type: 'wugu', from: 1,
      order: opt.order || [0, 1, 2],
      idx: opt.idx !== undefined ? opt.idx : 0,
      pool: opt.pool || [card('杀','w0'), card('桃','w1'), card('闪','w2')] };
    return g;
  }

  await check('wugu:注册存在;match=phase+type+轮到+池非空;错阶段/未轮到/空池/错type false', function(){
    var s = BOT_DECISIONS.wuguPick;
    if(!s) throw new Error('BOT_DECISIONS.wuguPick 未注册');
    var g1 = mkWuguG();
    if(!s.match(g1, 0)) throw new Error('order[0]=0 轮到应命中');
    if(s.match(g1, 1)) throw new Error('未轮到(seat1)不应命中');
    var g2 = mkWuguG(); g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('错阶段不应命中');
    var g3 = mkWuguG({ order: [1, 0] });
    if(s.match(g3, 0)) throw new Error('order[0]=1 未轮到0不应命中');
    var g4 = mkWuguG({ pool: [] });
    if(s.match(g4, 0)) throw new Error('空池不应命中');
    var g5 = mkWuguG(); g5.pending.type = 'wuxie';
    if(s.match(g5, 0)) throw new Error('错type不应命中');
  });

  await check('wugu:候选=每张池牌一项且带牌名;extraState 含 orderIdx/poolCount', function(){
    var s = BOT_DECISIONS.wuguPick;
    var g = mkWuguG({ idx: 1 });
    var c = s.buildCandidates(g, 0);
    if(c.length !== 3) throw new Error('3张池牌应3候选,实际 ' + c.length);
    if(c[0].poolIdx !== 0 || c[1].poolIdx !== 1 || c[2].poolIdx !== 2) throw new Error('poolIdx 应0/1/2');
    if(c[0].cardId !== 'w0' || c[1].cardId !== 'w1' || c[2].cardId !== 'w2') throw new Error('cardId 应取自池牌');
    if(c[0].label !== '拿【杀】' || c[1].label !== '拿【桃】' || c[2].label !== '拿【闪】')
      throw new Error('label 应含池牌名,实际 ' + JSON.stringify(c));
    var st = s.extraState(g, 0);
    if(!st.wugu || st.wugu.orderIdx !== 1 || st.wugu.poolCount !== 3)
      throw new Error('extraState.wugu 应{orderIdx:1,poolCount:3},实际 ' + JSON.stringify(st));
  });

  await check('wugu无密钥:fallback=池首张 → wuguPick(0, idx, 首张id)', async function(){
    window.__wuguCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkWuguG({ idx: 2, order: [1, 2, 0] });
    var r = await botDecide('wuguPick', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__wuguCalls.length !== 1 || window.__wuguCalls[0][0] !== 0 || window.__wuguCalls[0][1] !== 2 || window.__wuguCalls[0][2] !== 'w0')
      throw new Error('应 wuguPick(0,2,w0),实际 ' + JSON.stringify(window.__wuguCalls));
  });

  await check('wugu有密钥:mock 选第3项 → wuguPick(2, idx, 第3张id);userPrompt 含池牌名、不含他人手牌', async function(){
    window.__wuguCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":2}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkWuguG({ idx: 1, order: [2, 0, 1], hands: { 1: [card('桃园结义','sec')] } });
    var r = await botDecide('wuguPick', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__wuguCalls.length !== 1 || window.__wuguCalls[0][0] !== 2 || window.__wuguCalls[0][1] !== 1 || window.__wuguCalls[0][2] !== 'w2')
      throw new Error('应 wuguPick(2,1,w2),实际 ' + JSON.stringify(window.__wuguCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('拿【杀】') < 0 || up.indexOf('拿【桃】') < 0 || up.indexOf('拿【闪】') < 0)
      throw new Error('userPrompt 应含池牌名,实际 ' + up);
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
  });

  function mkPickGeneralG(opt){
    opt = opt || {};
    var g = mkSeatG(opt);
    g.phase = opt.phase || 'pickingGeneral';
    var seat = opt.seat !== undefined ? opt.seat : 0;
    g.players[seat].general = undefined; // 未选将
    g.players[seat].generalChoices = opt.generalChoices || ['zhangfei','simayi'];
    if(opt.isBotOf !== undefined) g.players[seat].isBot = opt.isBotOf;
    if(opt.roles){ g.players.forEach(function(p,i){ p.role = opt.roles[i] || p.role; }); }
    return g;
  }

  await check('pickGeneral:注册存在;match=选将阶段+机器人+未选;错阶段/非bot/已选 false;主公阶段仅主公命中', function(){
    var s = BOT_DECISIONS.pickGeneral;
    if(!s) throw new Error('BOT_DECISIONS.pickGeneral 未注册');
    var g1 = mkPickGeneralG();
    if(!s.match(g1, 0)) throw new Error('选将阶段+bot+未选应命中');
    if(s.match(g1, 1)) throw new Error('非bot座位不应命中');
    var g2 = mkPickGeneralG(); g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('错阶段不应命中');
    var g3 = mkPickGeneralG(); g3.players[0].general = 'zhangfei';
    if(s.match(g3, 0)) throw new Error('已选将不应命中');
    var g4 = mkPickGeneralG({ phase: 'pickingLordGeneral', seat: 1, roles: ['zhong','zhu','fan'] });
    if(s.match(g4, 0)) throw new Error('非主公不应命中(主公阶段)');
    if(!s.match(g4, 1)) throw new Error('主公座位应命中(主公阶段)');
  });

  await check('pickGeneral:候选=generalChoices 每项,label 含武将名+技能名;主公候选同样来自 generalChoices(lordChoices 字段不存在)', function(){
    var s = BOT_DECISIONS.pickGeneral;
    var g = mkPickGeneralG({ generalChoices: ['zhangfei','simayi'] });
    var c = s.buildCandidates(g, 0);
    if(c.length !== 2) throw new Error('应2候选,实际 ' + c.length);
    if(c[0].generalId !== 'zhangfei' || c[1].generalId !== 'simayi') throw new Error('generalId 顺序应同候选池');
    if(c[0].label !== '张飞(咆哮)' || c[1].label !== '司马懿(反馈)')
      throw new Error('label 应含武将名+技能,实际 ' + JSON.stringify(c));
    var gl = mkPickGeneralG({ phase: 'pickingLordGeneral', seat: 1, roles: ['zhong','zhu','fan'], generalChoices: ['xuchu','sunshangxiang'] });
    var cl = s.buildCandidates(gl, 1);
    if(cl.length !== 2 || cl[0].generalId !== 'xuchu' || cl[1].generalId !== 'sunshangxiang')
      throw new Error('主公候选应来自 generalChoices,实际 ' + JSON.stringify(cl));
  });

  await check('pickGeneral无密钥:打分最高者(赵云:闪+杀+4血) → respondPickGeneral(对应id);与 botPickGeneral 行为一致', async function(){
    window.__pickGeneralCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkPickGeneralG({ generalChoices: ['zhangfei','simayi','zhaoyun'] });
    var r = await botDecide('pickGeneral', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__pickGeneralCalls.length !== 1 || window.__pickGeneralCalls[0][0] !== 'zhaoyun')
      throw new Error('打分最高应 zhaoyun(74>张飞58>司马懿46),实际 ' + JSON.stringify(window.__pickGeneralCalls));
    var g2 = mkPickGeneralG({ generalChoices: ['zhangfei','simayi','zhaoyun'] });
    botPickGeneral(g2, 0, false);
    if(window.__pickGeneralCalls.length !== 2 || window.__pickGeneralCalls[1][0] !== 'zhaoyun')
      throw new Error('botPickGeneral 对照应同样选 zhaoyun,实际 ' + JSON.stringify(window.__pickGeneralCalls));
  });

  await check('pickGeneral无密钥(主公):打分含主公加成(刘备84>许褚74) → respondPickLordGeneral(刘备)', async function(){
    window.__pickLordGeneralCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkPickGeneralG({ phase: 'pickingLordGeneral', seat: 1, roles: ['zhong','zhu','fan'], generalChoices: ['liubei','xuchu'] });
    var r = await botDecide('pickGeneral', g, 1);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__pickLordGeneralCalls.length !== 1 || window.__pickLordGeneralCalls[0][0] !== 'liubei')
      throw new Error('主公加成后应选 liubei(回复+主公+20),实际 ' + JSON.stringify(window.__pickLordGeneralCalls));
    var g2 = mkPickGeneralG({ phase: 'pickingLordGeneral', seat: 1, roles: ['zhong','zhu','fan'], generalChoices: ['liubei','xuchu'] });
    botPickGeneral(g2, 1, true);
    if(window.__pickLordGeneralCalls.length !== 2 || window.__pickLordGeneralCalls[1][0] !== 'liubei')
      throw new Error('botPickGeneral 主公对照应同样选 liubei,实际 ' + JSON.stringify(window.__pickLordGeneralCalls));
  });

  await check('pickGeneral有密钥:mock 选 index1 → respondPickGeneral(第2项id);主公 mock → respondPickLordGeneral', async function(){
    window.__pickGeneralCalls = []; window.__pickLordGeneralCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkPickGeneralG({ generalChoices: ['zhangfei','simayi','zhaoyun'] });
    var r = await botDecide('pickGeneral', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__pickGeneralCalls.length !== 1 || window.__pickGeneralCalls[0][0] !== 'simayi')
      throw new Error('mock 选第2项应 respondPickGeneral(simayi),实际 ' + JSON.stringify(window.__pickGeneralCalls));
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    var gl = mkPickGeneralG({ phase: 'pickingLordGeneral', seat: 1, roles: ['zhong','zhu','fan'], generalChoices: ['zhangfei','simayi'] });
    var rl = await botDecide('pickGeneral', gl, 1);
    if(rl !== true || window.__mockAiCalls !== 1) throw new Error('主公 AI 调用异常,实际 rl=' + rl);
    if(window.__pickLordGeneralCalls.length !== 1 || window.__pickLordGeneralCalls[0][0] !== 'simayi')
      throw new Error('主公 mock 选第2项应 respondPickLordGeneral(simayi),实际 ' + JSON.stringify(window.__pickLordGeneralCalls));
  });

  await check('接线:runBotDecision pickingGeneral/wugu 命中即走 botDecide 并调服务端,不崩', async function(){
    window.__pickGeneralCalls = []; window.__wuguCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkPickGeneralG({ generalChoices: ['zhangfei','simayi'] });
    await runBotDecision(g1, 0);
    if(window.__pickGeneralCalls.length !== 1 || window.__pickGeneralCalls[0][0] !== 'zhangfei')
      throw new Error('pickingGeneral 接线应 respondPickGeneral(zhangfei),实际 ' + JSON.stringify(window.__pickGeneralCalls));
    var g2 = mkWuguG({ order: [0], idx: 0, pool: [card('杀','x0'), card('桃','x1')] });
    await runBotDecision(g2, 0);
    if(window.__wuguCalls.length !== 1 || window.__wuguCalls[0][0] !== 0 || window.__wuguCalls[0][1] !== 0 || window.__wuguCalls[0][2] !== 'x0')
      throw new Error('wugu 接线应 wuguPick(0,0,x0),实际 ' + JSON.stringify(window.__wuguCalls));
  });

  // ================= 观星(guanxingReview)进总线(Task T8) =================
  // pending 服务端真实结构(skills.js continueGuanxingCheck):{type:'guanxingReview',
  // seat, cards}(cards 是牌堆顶切出的实际N张,牌对象带 name/suit/rank,下标越大越接近
  // 牌堆顶)。默认方案=全置顶原序,与旧 runBotDecision 硬编码分支逐字一致。
  function mkGuanxingG(opt){
    var g = mkSeatG(opt);
    g.phase = 'guanxingReview';
    g.pending = opt.pending || {
      type: 'guanxingReview', seat: 0,
      cards: [card('杀','gx0'), card('闪','gx1'), card('桃','gx2'), card('过河拆桥','gx3')]
    };
    return g;
  }

  await check('guanxing:注册存在;match=观星阶段+本人;错阶段/错座位/错pending类型/无pending false', function(){
    var s = BOT_DECISIONS.guanxing;
    if(!s) throw new Error('BOT_DECISIONS.guanxing 未注册');
    var g1 = mkGuanxingG({});
    if(!s.match(g1, 0)) throw new Error('观星阶段+本人应命中');
    if(s.match(g1, 1)) throw new Error('非本人座位不应命中');
    var g3 = mkGuanxingG({}); g3.phase = 'play';
    if(s.match(g3, 0)) throw new Error('错阶段不应命中');
    var g4 = mkGuanxingG({ pending: { type: 'xunxunPick', seat: 0, cards: [] } });
    if(s.match(g4, 0)) throw new Error('错 pending 类型不应命中');
    var g5 = mkGuanxingG({}); g5.pending = null;
    if(s.match(g5, 0)) throw new Error('无 pending 不应命中');
  });

  await check('guanxing:4张牌候选≤8;默认方案=全置顶原序(isDefault)恒在;每候选 top+bottom 恰覆盖全部下标无重复无遗漏;label 含牌名', function(){
    var s = BOT_DECISIONS.guanxing;
    var g = mkGuanxingG({});
    var c = s.buildCandidates(g, 0);
    if(!c.length || c.length > 8) throw new Error('候选应 1..8 个,实际 ' + c.length);
    if(!c[0].isDefault) throw new Error('首候选应为默认方案');
    if(JSON.stringify(c[0].topOrder) !== '[0,1,2,3]') throw new Error('默认方案应全置顶原序,实际 ' + JSON.stringify(c[0].topOrder));
    if(c[0].bottomOrder.length !== 0) throw new Error('默认方案底部应为空,实际 ' + JSON.stringify(c[0].bottomOrder));
    if(c[0].label.indexOf('默认方案') < 0) throw new Error('默认方案 label 应含"默认方案",实际 ' + c[0].label);
    if(c[0].label.indexOf('杀') < 0 || c[0].label.indexOf('过河拆桥') < 0)
      throw new Error('label 应含牌名,实际 ' + c[0].label);
    var hasNonDefault = false;
    c.forEach(function(cc){
      if(!cc.isDefault) hasNonDefault = true;
      var joined = cc.topOrder.concat(cc.bottomOrder);
      if(joined.length !== 4 || new Set(joined).size !== 4)
        throw new Error('top+bottom 应恰覆盖4个下标各一次,实际 ' + JSON.stringify(joined));
      joined.forEach(function(i){ if(i < 0 || i > 3) throw new Error('下标越界 ' + i); });
    });
    if(!hasNonDefault) throw new Error('除默认方案外应还有价值排序/置换变体');
  });

  await check('guanxing有密钥:mock 选非默认变体 → respondGuanxing(该变体 topOrder, bottomOrder)', async function(){
    window.__guanxingCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":2}' }];
    aiApiKey = 'test-key';
    aiProvider = 'claude';
    var g = mkGuanxingG({});
    var r = await botDecide('guanxing', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__guanxingCalls.length !== 1) throw new Error('respondGuanxing 应被调1次,实际 ' + window.__guanxingCalls.length);
    var expected = BOT_DECISIONS.guanxing.buildCandidates(g, 0)[2];
    if(expected.isDefault) throw new Error('choice2 应是非默认变体(测试前置)');
    var got = window.__guanxingCalls[0];
    if(JSON.stringify(got[0]) !== JSON.stringify(expected.topOrder) || JSON.stringify(got[1]) !== JSON.stringify(expected.bottomOrder))
      throw new Error('应提交变体(' + JSON.stringify(expected.topOrder) + ',' + JSON.stringify(expected.bottomOrder) + '),实际 ' + JSON.stringify(got));
  });

  await check('guanxing无密钥:fallback=默认方案 → respondGuanxing(全下标, []) 与旧行为一致', async function(){
    window.__guanxingCalls = [];
    aiApiKey = '';
    aiProvider = null;
    var g = mkGuanxingG({});
    var r = await botDecide('guanxing', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__guanxingCalls.length !== 1) throw new Error('respondGuanxing 应被调1次,实际 ' + window.__guanxingCalls.length);
    var got = window.__guanxingCalls[0];
    if(JSON.stringify(got[0]) !== '[0,1,2,3]' || JSON.stringify(got[1]) !== '[]')
      throw new Error('无密钥应提交旧行为(全置顶原序,空底部),实际 ' + JSON.stringify(got));
  });

  await check('接线:runBotDecision guanxingReview 命中走 botDecide 恰1次且 respondGuanxing 只调1次(旧分支已删)', async function(){
    window.__guanxingCalls = [];
    window.__botDecideCalls = [];
    var __origBotDecide = botDecide;
    botDecide = async function(id, gg, ss){ window.__botDecideCalls.push(id); return __origBotDecide(id, gg, ss); };
    aiApiKey = '';
    aiProvider = null;
    var g = mkGuanxingG({});
    await runBotDecision(g, 0);
    botDecide = __origBotDecide;
    if(window.__botDecideCalls.filter(function(id){ return id === 'guanxing'; }).length !== 1)
      throw new Error('应恰1次 botDecide(guanxing),实际 ' + JSON.stringify(window.__botDecideCalls));
    if(window.__guanxingCalls.length !== 1) throw new Error('respondGuanxing 应恰被调1次(旧分支不应再触发),实际 ' + window.__guanxingCalls.length);
  });

  // ================= T9: 化身/巧变移动/恩怨选项进总线 =================
  // pending 服务端真实结构:huashenPick={type:'huashenPick',seat}(room-lifecycle.js
  // checkHuashenBeforeAssign);huashenChangeAskStart/End={type:同名,seat};qiaobianMove=
  // {type:'qiaobianMove',seat}(skills.js respondQiaobianMove 守卫);enyuanChooseOption=
  // {type:'enyuanChooseOption',damagerSeat,...}(game.js chooseEnyuanOption 守卫)。
  respondHuashenPick = spyService('huashenPick');
  respondHuashenChangeAskStart = spyService('huashenChangeStart');
  respondHuashenChangeAskEnd = spyService('huashenChangeEnd');
  respondQiaobianMove = spyService('qiaobianMove');
  chooseEnyuanOption = spyService('enyuanOption');

  function mkHuashenSkillG(opt){
    var g = mkSeatG(opt);
    g.phase = 'huashenPick';
    g.pending = { type: 'huashenPick', seat: 0 };
    g.players[0].huashenPool = opt.pool || ['guojia'];
    return g;
  }

  await check('huashenSkill:注册存在;match=化身阶段+本人;错阶段/错座位/无pending false', function(){
    var s = BOT_DECISIONS.huashenSkill;
    if(!s) throw new Error('BOT_DECISIONS.huashenSkill 未注册');
    var g1 = mkHuashenSkillG({});
    if(!s.match(g1, 0)) throw new Error('化身阶段+本人应命中');
    if(s.match(g1, 1)) throw new Error('非本人座位不应命中');
    var g3 = mkHuashenSkillG({}); g3.phase = 'play';
    if(s.match(g3, 0)) throw new Error('错阶段不应命中');
    var g5 = mkHuashenSkillG({}); g5.pending = null;
    if(s.match(g5, 0)) throw new Error('无 pending 不应命中');
  });

  await check('huashenSkill:候选=池内每个有技能武将{generalId,skillName,label};无技能武将剔除', function(){
    var s = BOT_DECISIONS.huashenSkill;
    var g = mkHuashenSkillG({ pool: ['zuoci', 'guojia', 'zhaoyun'] }); // zuoci 不在化身技能表
    var c = s.buildCandidates(g, 0);
    if(c.length !== 2) throw new Error('应2个候选(guojia/zhaoyun),实际 ' + c.length + ' ' + JSON.stringify(c));
    if(c[0].generalId !== 'guojia' || c[0].skillName !== '天妒' || c[0].label !== '天妒(guojia)')
      throw new Error('候选0应为 guojia/天妒,实际 ' + JSON.stringify(c[0]));
    if(c[1].generalId !== 'zhaoyun' || c[1].skillName !== '龙胆' || c[1].label !== '龙胆(zhaoyun)')
      throw new Error('候选1应为 zhaoyun/龙胆,实际 ' + JSON.stringify(c[1]));
  });

  await check('huashenSkill无密钥:fallback=旧逻辑首个可用技能将 → respondHuashenPick(id, 首技能名)', async function(){
    window.__huashenPickCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkHuashenSkillG({ pool: ['zuoci', 'zhangfei'] });
    var r = await botDecide('huashenSkill', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__huashenPickCalls.length !== 1) throw new Error('respondHuashenPick 应被调1次,实际 ' + window.__huashenPickCalls.length);
    if(window.__huashenPickCalls[0][0] !== 'zhangfei' || window.__huashenPickCalls[0][1] !== '咆哮')
      throw new Error('应选池内首个有技能武将 zhangfei/咆哮(zuoci 无技能跳过),实际 ' + JSON.stringify(window.__huashenPickCalls));
  });

  await check('huashenSkill有密钥:mock 选第2项 → respondHuashenPick(该武将id,该技能名);userPrompt 不含他人手牌', async function(){
    window.__huashenPickCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkHuashenSkillG({ pool: ['guojia', 'zhaoyun'], hands: { 1: [card('桃园结义', 'sec')] } });
    var r = await botDecide('huashenSkill', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__huashenPickCalls.length !== 1) throw new Error('respondHuashenPick 应被调1次,实际 ' + window.__huashenPickCalls.length);
    if(window.__huashenPickCalls[0][0] !== 'zhaoyun' || window.__huashenPickCalls[0][1] !== '龙胆')
      throw new Error('mock 选第2项应 respondHuashenPick(zhaoyun,龙胆),实际 ' + JSON.stringify(window.__huashenPickCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt 泄露他人手牌(桃园结义)!实际 ' + up);
    if(up.indexOf('天妒(guojia)') < 0 || up.indexOf('龙胆(zhaoyun)') < 0)
      throw new Error('userPrompt 应含技能候选label,实际 ' + up);
  });

  function mkHuashenChangeG(phase, opt){
    var g = mkSeatG(opt);
    g.phase = phase;
    g.pending = { type: phase, seat: 0 };
    return g;
  }

  await check('huashenChangeStart:注册存在;match=询问阶段+本人+类型;错阶段/错座位/错类型 false', function(){
    var s = BOT_DECISIONS.huashenChangeStart;
    if(!s) throw new Error('BOT_DECISIONS.huashenChangeStart 未注册');
    var g1 = mkHuashenChangeG('huashenChangeAskStart', {});
    if(!s.match(g1, 0)) throw new Error('询问阶段+本人应命中');
    if(s.match(g1, 1)) throw new Error('非本人不应命中');
    var g2 = mkHuashenChangeG('huashenChangeAskEnd', {});
    if(s.match(g2, 0)) throw new Error('错阶段(AskEnd)不应命中');
    var g3 = mkHuashenChangeG('huashenChangeAskStart', {}); g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('错 pending 类型不应命中');
  });

  await check('huashenChangeStart:候选=[更改【化身】,不更改]', function(){
    var s = BOT_DECISIONS.huashenChangeStart;
    var c = s.buildCandidates(mkHuashenChangeG('huashenChangeAskStart', {}), 0);
    if(c.length !== 2) throw new Error('应2个候选,实际 ' + c.length + ' ' + JSON.stringify(c));
    if(c[0].change !== true || c[1].change !== false) throw new Error('候选应[更改,不更改],实际 ' + JSON.stringify(c));
  });

  await check('huashenChangeStart无密钥:fallback=不更改 → respondHuashenChangeAskStart(false)', async function(){
    window.__huashenChangeStartCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkHuashenChangeG('huashenChangeAskStart', {});
    var r = await botDecide('huashenChangeStart', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__huashenChangeStartCalls.length !== 1 || window.__huashenChangeStartCalls[0][0] !== false)
      throw new Error('应 respondHuashenChangeAskStart(false),实际 ' + JSON.stringify(window.__huashenChangeStartCalls));
  });

  await check('huashenChangeStart有密钥:mock 选更改 → respondHuashenChangeAskStart(true)', async function(){
    window.__huashenChangeStartCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkHuashenChangeG('huashenChangeAskStart', {});
    var r = await botDecide('huashenChangeStart', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__huashenChangeStartCalls.length !== 1 || window.__huashenChangeStartCalls[0][0] !== true)
      throw new Error('mock 选更改应 respondHuashenChangeAskStart(true),实际 ' + JSON.stringify(window.__huashenChangeStartCalls));
  });

  await check('huashenChangeEnd:注册存在;match=结束询问+本人+类型;候选[更改,不更改];无密钥 → respondHuashenChangeAskEnd(false)', async function(){
    var s = BOT_DECISIONS.huashenChangeEnd;
    if(!s) throw new Error('BOT_DECISIONS.huashenChangeEnd 未注册');
    var g1 = mkHuashenChangeG('huashenChangeAskEnd', {});
    if(!s.match(g1, 0)) throw new Error('结束询问+本人应命中');
    if(s.match(g1, 1)) throw new Error('非本人不应命中');
    var g2 = mkHuashenChangeG('huashenChangeAskStart', {});
    if(s.match(g2, 0)) throw new Error('错阶段(AskStart)不应命中');
    var c = s.buildCandidates(g1, 0);
    if(c.length !== 2 || c[0].change !== true || c[1].change !== false)
      throw new Error('候选应[更改,不更改],实际 ' + JSON.stringify(c));
    window.__huashenChangeEndCalls = [];
    aiApiKey = ''; aiProvider = null;
    var r = await botDecide('huashenChangeEnd', g1, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__huashenChangeEndCalls.length !== 1 || window.__huashenChangeEndCalls[0][0] !== false)
      throw new Error('应 respondHuashenChangeAskEnd(false),实际 ' + JSON.stringify(window.__huashenChangeEndCalls));
  });

  await check('huashenChangeEnd有密钥:mock 选更改 → respondHuashenChangeAskEnd(true)', async function(){
    window.__huashenChangeEndCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkHuashenChangeG('huashenChangeAskEnd', {});
    var r = await botDecide('huashenChangeEnd', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__huashenChangeEndCalls.length !== 1 || window.__huashenChangeEndCalls[0][0] !== true)
      throw new Error('mock 选更改应 respondHuashenChangeAskEnd(true),实际 ' + JSON.stringify(window.__huashenChangeEndCalls));
  });

  function mkQiaobianG(opt){
    var g = mkSeatG(opt);
    g.phase = 'qiaobianMove';
    g.pending = { type: 'qiaobianMove', seat: 0 };
    if(opt.srcEquips) g.players[0].equips = Object.assign(emptyEquips(), opt.srcEquips);
    if(opt.dstEquips) g.players[1].equips = Object.assign(emptyEquips(), opt.dstEquips);
    return g;
  }

  await check('qiaobianMove:注册存在;match=巧变移动+本人+类型;错阶段/错座位/错类型 false', function(){
    var s = BOT_DECISIONS.qiaobianMove;
    if(!s) throw new Error('BOT_DECISIONS.qiaobianMove 未注册');
    var g1 = mkQiaobianG({});
    if(!s.match(g1, 0)) throw new Error('巧变阶段+本人应命中');
    if(s.match(g1, 1)) throw new Error('非本人不应命中');
    var g2 = mkQiaobianG({}); g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('错阶段不应命中');
    var g3 = mkQiaobianG({}); g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('错 pending 类型不应命中');
  });

  await check('qiaobianMove:候选=不移动+合法移动组合(源槽非空→目标同槽空);label 含装备名;同源槽→同目标不重复;上限9', function(){
    var s = BOT_DECISIONS.qiaobianMove;
    var g = mkQiaobianG({
      srcEquips: { weapon: card('青龙偃月刀', 'w0'), armor: card('八卦阵', 'a0') }
    });
    var c = s.buildCandidates(g, 0);
    if(c.length < 2) throw new Error('应含不移动+至少1个移动组合,实际 ' + c.length + ' ' + JSON.stringify(c));
    if(c[0].move !== null) throw new Error('首候选应为不移动,实际 ' + JSON.stringify(c[0]));
    var moveCand = c.find(function(x){ return x.move && x.move.kind === 'equip' && x.move.srcSeat === 0 && x.move.dstSeat === 1 && x.move.slot === 'weapon'; });
    if(!moveCand) throw new Error('应有 weapon:0→1 的移动候选,实际 ' + JSON.stringify(c));
    if(moveCand.action.indexOf('青龙偃月刀') < 0) throw new Error('action 应含装备名,实际 ' + JSON.stringify(moveCand) + ' 全候选 ' + JSON.stringify(c));
    if(c.length > 9) throw new Error('候选上限应为9(不移动+8移动),实际 ' + c.length);
    var slots = c.filter(function(x){ return x.move && x.move.srcSeat === 0 && x.move.dstSeat === 1; }).map(function(x){ return x.move.slot; });
    if(new Set(slots).size !== slots.length) throw new Error('同一源槽→同一目标不应重复,实际 ' + JSON.stringify(slots));
  });

  await check('qiaobianMove无密钥:fallback=不移动 → respondQiaobianMove(null)', async function(){
    window.__qiaobianMoveCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g = mkQiaobianG({ srcEquips: { weapon: card('青龙偃月刀', 'w0') } });
    var r = await botDecide('qiaobianMove', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__qiaobianMoveCalls.length !== 1 || window.__qiaobianMoveCalls[0][0] !== null)
      throw new Error('应 respondQiaobianMove(null),实际 ' + JSON.stringify(window.__qiaobianMoveCalls));
  });

  await check('qiaobianMove有密钥:mock 选移动组合 → respondQiaobianMove(该move对象)', async function(){
    window.__qiaobianMoveCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkQiaobianG({ srcEquips: { weapon: card('青龙偃月刀', 'w0') } });
    var r = await botDecide('qiaobianMove', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__qiaobianMoveCalls.length !== 1) throw new Error('respondQiaobianMove 应被调1次,实际 ' + window.__qiaobianMoveCalls.length);
    var mv = window.__qiaobianMoveCalls[0][0];
    if(!mv || mv.srcSeat !== 0 || mv.dstSeat !== 1 || mv.kind !== 'equip' || mv.slot !== 'weapon')
      throw new Error('mock 应选 weapon 0→1 的move,实际 ' + JSON.stringify(mv));
  });

  function mkEnyuanG(opt){
    var g = mkSeatG(opt);
    g.phase = 'enyuanChooseOption';
    g.pending = { type: 'enyuanChooseOption', damagerSeat: 0, sourceSeat: 1 };
    return g;
  }

  function mkEnyuanGiveCardG(opt){
    var g = mkSeatG(opt);
    g.phase = 'enyuanGiveCard';
    g.pending = { type: 'enyuanGiveCard', damagerSeat: 0, sourceSeat: 1 };
    return g;
  }

  await check('enyuanOption:注册存在;match=恩怨选项+damager本人;错阶段/错座位 false', function(){
    var s = BOT_DECISIONS.enyuanOption;
    if(!s) throw new Error('BOT_DECISIONS.enyuanOption 未注册');
    var g1 = mkEnyuanG({});
    if(!s.match(g1, 0)) throw new Error('damagerSeat 本人应命中');
    if(s.match(g1, 1)) throw new Error('非 damager 不应命中');
    var g2 = mkEnyuanG({}); g2.phase = 'enyuanChoose';
    if(s.match(g2, 0)) throw new Error('错阶段不应命中');
  });

  await check('enyuanOption:候选=有红桃→[给红桃,掉血];无红桃→[掉血]', function(){
    var s = BOT_DECISIONS.enyuanOption;
    var c1 = s.buildCandidates(mkEnyuanG({ myHand: [card('桃', 'e0', '♥'), card('杀', 'e1', '♠')] }), 0);
    if(c1.length !== 2 || c1[0].option !== 'giveCard' || c1[1].option !== 'loseHp')
      throw new Error('有红桃应2候选[giveCard,loseHp],实际 ' + JSON.stringify(c1));
    var c2 = s.buildCandidates(mkEnyuanG({ myHand: [card('杀', 'e2', '♠')] }), 0);
    if(c2.length !== 1 || c2[0].option !== 'loseHp')
      throw new Error('无红桃应1候选[loseHp],实际 ' + JSON.stringify(c2));
  });

  await check('enyuanOption无密钥:fallback=旧逻辑(有红桃给牌/无红桃掉血)', async function(){
    window.__enyuanOptionCalls = [];
    aiApiKey = ''; aiProvider = null;
    var g1 = mkEnyuanG({ myHand: [card('桃', 'e3', '♥')] });
    var r1 = await botDecide('enyuanOption', g1, 0);
    if(r1 !== true || window.__enyuanOptionCalls.length !== 1 || window.__enyuanOptionCalls[0][0] !== 'giveCard')
      throw new Error('有红桃应 chooseEnyuanOption(giveCard),实际 ' + JSON.stringify(window.__enyuanOptionCalls));
    window.__enyuanOptionCalls = [];
    var g2 = mkEnyuanG({ myHand: [card('杀', 'e4', '♠')] });
    var r2 = await botDecide('enyuanOption', g2, 0);
    if(r2 !== true || window.__enyuanOptionCalls.length !== 1 || window.__enyuanOptionCalls[0][0] !== 'loseHp')
      throw new Error('无红桃应 chooseEnyuanOption(loseHp),实际 ' + JSON.stringify(window.__enyuanOptionCalls));
  });

  await check('enyuanOption有密钥:mock 选掉血 → chooseEnyuanOption(loseHp)', async function(){
    window.__enyuanOptionCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkEnyuanG({ myHand: [card('桃', 'e5', '♥')] });
    var r = await botDecide('enyuanOption', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI 调用异常,实际 r=' + r);
    if(window.__enyuanOptionCalls.length !== 1 || window.__enyuanOptionCalls[0][0] !== 'loseHp')
      throw new Error('mock 选第2项应 chooseEnyuanOption(loseHp),实际 ' + JSON.stringify(window.__enyuanOptionCalls));
  });

  await check('A4 enyuanGiveCard:match=阶段/类型/damagerSeat 全对才命中;错阶段/错座位 false', function(){
    var s = BOT_DECISIONS.enyuanGiveCard;
    if(!s) throw new Error('BOT_DECISIONS.enyuanGiveCard 未注册');
    var g = mkEnyuanGiveCardG({});
    if(!s.match(g, 0)) throw new Error('完整 enyuanGiveCard 应命中');
    var g1 = mkEnyuanGiveCardG({}); g1.phase = 'enyuanChooseOption';
    if(s.match(g1, 0)) throw new Error('错阶段不应命中');
    var g2 = mkEnyuanGiveCardG({}); g2.pending.type = 'other';
    if(s.match(g2, 0)) throw new Error('错 pending 类型不应命中');
    var g3 = mkEnyuanGiveCardG({}); g3.pending.damagerSeat = 1;
    if(s.match(g3, 0)) throw new Error('错 damagerSeat 不应命中');
    if(!s.match(g3, 1)) throw new Error('damagerSeat=1 应命中座位1');
  });

  await check('A4 enyuanGiveCard:只为每张红桃生成候选;下标与label含牌名', function(){
    var s = BOT_DECISIONS.enyuanGiveCard;
    var g = mkEnyuanGiveCardG({ myHand: [card('杀', 'a40', '♠'), card('桃', 'a41', '♥'), card('无中生有', 'a42', '♥'), card('闪', 'a43', '♦')] });
    var c = s.buildCandidates(g, 0);
    if(c.length !== 2) throw new Error('应只生成2张红桃候选,实际 ' + JSON.stringify(c));
    if(c[0].cardIdx !== 1 || c[1].cardIdx !== 2) throw new Error('候选下标应为1,2,实际 ' + JSON.stringify(c));
    if(c[0].label.indexOf('桃') < 0 || c[1].label.indexOf('无中生有') < 0)
      throw new Error('候选label应含牌名,实际 ' + JSON.stringify(c));
  });

  await check('A4 enyuanGiveCard有密钥:mock选第二张红桃 → giveEnyuanCard(正确物理下标);userPrompt不含他人手牌', async function(){
    window.__enyuanGiveCardCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkEnyuanGiveCardG({
      myHand: [card('杀', 'a44', '♠'), card('桃', 'a45', '♥'), card('无中生有', 'a46', '♥'), card('闪', 'a47', '♦')],
      hands: { 1: [card('桃园结义', 'hidden-a4', '♠')] }
    });
    var r = await botDecide('enyuanGiveCard', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI调用异常,实际 r=' + r + ',calls=' + window.__mockAiCalls);
    if(window.__enyuanGiveCardCalls.length !== 1 || window.__enyuanGiveCardCalls[0][0] !== 2)
      throw new Error('应提交第二张红桃物理下标2,实际 ' + JSON.stringify(window.__enyuanGiveCardCalls));
    var up = window.__mockAiArgs.opts.userPrompt;
    if(up.indexOf('桃园结义') >= 0) throw new Error('userPrompt泄露他人手牌,实际 ' + up);
  });

  await check('A4 enyuanGiveCard无密钥:回退第一张红桃;无红桃候选空且不调用服务端', async function(){
    window.__enyuanGiveCardCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkEnyuanGiveCardG({ myHand: [card('杀', 'a48', '♠'), card('桃', 'a49', '♥'), card('闪', 'a50', '♦'), card('无中生有', 'a51', '♥')] });
    var r = await botDecide('enyuanGiveCard', g, 0);
    if(r !== true) throw new Error('有红桃回退应返回true,实际 ' + r);
    if(window.__enyuanGiveCardCalls.length !== 1 || window.__enyuanGiveCardCalls[0][0] !== 1)
      throw new Error('回退应提交第一张红桃物理下标1,实际 ' + JSON.stringify(window.__enyuanGiveCardCalls));
    var empty = mkEnyuanGiveCardG({ myHand: [card('杀', 'a52', '♠'), card('闪', 'a53', '♦')] });
    var emptyResult = await botDecide('enyuanGiveCard', empty, 0);
    if(emptyResult !== false) throw new Error('无红桃应返回false,实际 ' + emptyResult);
    if(window.__enyuanGiveCardCalls.length !== 1) throw new Error('无红桃不应调用服务端,实际 ' + JSON.stringify(window.__enyuanGiveCardCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应调用AI,实际 ' + window.__mockAiCalls);
  });

  await check('A4 enyuanGiveCard接线:runBotDecision调用botDecide恰1次并提交一次', async function(){
    window.__enyuanGiveCardCalls = [];
    aiApiKey = ''; aiProvider = null;
    if(BOT_PHASE_ACTOR.enyuanGiveCard !== 'damagerSeat')
      throw new Error('BOT_PHASE_ACTOR应登记enyuanGiveCard:damagerSeat,实际 ' + BOT_PHASE_ACTOR.enyuanGiveCard);
    var restore = spyBotDecideLog();
    try {
      await runBotDecision(mkEnyuanGiveCardG({ myHand: [card('杀', 'a54', '♠'), card('桃', 'a55', '♥')] }), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.filter(function(id){ return id === 'enyuanGiveCard'; }).length !== 1)
      throw new Error('runBotDecision应恰调用一次botDecide(enyuanGiveCard),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__enyuanGiveCardCalls.length !== 1 || window.__enyuanGiveCardCalls[0][0] !== 1)
      throw new Error('服务端应只提交一次giveEnyuanCard(1),实际 ' + JSON.stringify(window.__enyuanGiveCardCalls));
  });

  await check('接线:runBotDecision 5 个阶段各命中 botDecide 恰1次且服务端只调1次(旧分支已删)', async function(){
    window.__huashenPickCalls = []; window.__huashenChangeStartCalls = [];
    window.__huashenChangeEndCalls = []; window.__qiaobianMoveCalls = []; window.__enyuanOptionCalls = [];
    window.__botDecideCalls = [];
    var __origBotDecide = botDecide;
    botDecide = async function(id, gg, ss){ window.__botDecideCalls.push(id); return __origBotDecide(id, gg, ss); };
    aiApiKey = ''; aiProvider = null;
    await runBotDecision(mkHuashenSkillG({ pool: ['guojia'] }), 0);
    await runBotDecision(mkHuashenChangeG('huashenChangeAskStart', {}), 0);
    await runBotDecision(mkHuashenChangeG('huashenChangeAskEnd', {}), 0);
    await runBotDecision(mkQiaobianG({ srcEquips: { weapon: card('青龙偃月刀', 'w0') } }), 0);
    await runBotDecision(mkEnyuanG({ myHand: [card('桃', 'e6', '♥')] }), 0);
    botDecide = __origBotDecide;
    ['huashenSkill', 'huashenChangeStart', 'huashenChangeEnd', 'qiaobianMove', 'enyuanOption'].forEach(function(id){
      if(window.__botDecideCalls.filter(function(x){ return x === id; }).length !== 1)
        throw new Error('应恰1次 botDecide(' + id + '),实际 ' + JSON.stringify(window.__botDecideCalls));
    });
    if(window.__huashenPickCalls.length !== 1) throw new Error('respondHuashenPick 应恰1次,实际 ' + window.__huashenPickCalls.length);
    if(window.__huashenChangeStartCalls.length !== 1 || window.__huashenChangeStartCalls[0][0] !== false)
      throw new Error('respondHuashenChangeAskStart 应恰1次(false),实际 ' + JSON.stringify(window.__huashenChangeStartCalls));
    if(window.__huashenChangeEndCalls.length !== 1 || window.__huashenChangeEndCalls[0][0] !== false)
      throw new Error('respondHuashenChangeAskEnd 应恰1次(false),实际 ' + JSON.stringify(window.__huashenChangeEndCalls));
    if(window.__qiaobianMoveCalls.length !== 1 || window.__qiaobianMoveCalls[0][0] !== null)
      throw new Error('respondQiaobianMove 应恰1次(null),实际 ' + JSON.stringify(window.__qiaobianMoveCalls));
    if(window.__enyuanOptionCalls.length !== 1 || window.__enyuanOptionCalls[0][0] !== 'giveCard')
      throw new Error('chooseEnyuanOption 应恰1次(giveCard),实际 ' + JSON.stringify(window.__enyuanOptionCalls));
  });

  // ================= G1:seatPick 接线修复(runBotDecision 全链路,Task G1) =================
  // 【背景】BOT_SEAT_PICKS 的 11 个座位技能此前只注册未接线——runBotDecision 从不调用
  // botDecide('seatPick'),机器人永远不会主动用这些技能(仅靠上面的 botDecide 直接单测,
  // 证明不了总线真的会走到)。以下测试全部走 runBotDecision(g, 0) 全链,证明 4 处接线
  // 存在:play 分支 1 处(在所有多步决策之后、runBotActionWindow 之前)+ guhuoTarget/
  // xuanfengPick/quhuDamageChoice 三个 pending 阶段分支各 1 处。断言两件套:①botDecide
  // 确实收到 seatPick(接线存在);②对应服务端函数确实收到选择(execute 真的执行)。
  // 【构造口径】play 阶段用断粮做唯一命中技能(caps0.duanliang+黑基本牌;其余10技能
  // 各自差一个匹配条件:奇袭/国色/武圣/双雄/挑衅/反间/青囊无 cap、无 pending 阶段),
  // 候选=距离≤2 的存活非自己;三个 pending 阶段沿用上方 mkGuhuoG/mkXuanfengG/
  // mkQuhuDamageG(mkXuanfengG 不设 phase,此处补 g.phase='xuanfengPick' 对齐服务端
  // game.js:5765 的真实阶段名)。
  function spyBotDecideLog(){
    window.__G1botDecideCalls = [];
    var __origBotDecide = botDecide;
    botDecide = async function(id, gg, ss){
      window.__G1botDecideCalls.push(id);
      return __origBotDecide(id, gg, ss);
    };
    return function(){ botDecide = __origBotDecide; };
  }

  await check('G1接线:play阶段有密钥 runBotDecision 全链 → seatPick 被调且断粮选中 → duanLiang(牌idx,目标)', async function(){
    window.__duanliangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var restore = spyBotDecideLog();
    try {
      var g = mkSeatG({ caps0: { duanliang: true }, myHand: [card('酒','g1','♣')] });
      await runBotDecision(g, 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('seatPick') < 0)
      throw new Error('runBotDecision play 分支应调用 botDecide(seatPick),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__duanliangCalls.length !== 1)
      throw new Error('断粮应经 seatPick 接线被调用,实际 ' + JSON.stringify(window.__duanliangCalls));
    if(window.__duanliangCalls[0][0] !== 0 || window.__duanliangCalls[0][1] !== 1)
      throw new Error('应 duanLiang(0, 座位1),实际 ' + JSON.stringify(window.__duanliangCalls));
    if(window.__mockAiCalls !== 1) throw new Error('应恰1次AI调用(seatPick选候选),实际 ' + window.__mockAiCalls);
  });

  await check('G1接线修复:play阶段无密钥 → seatPick 不接(aiReady守卫)、走 runBotActionWindow 不卡死', async function(){
    window.__duanliangCalls = [];
    window.__windowCalls = 0;
    var realWindow = runBotActionWindow;
    runBotActionWindow = async function(){ window.__windowCalls++; };
    aiApiKey = ''; aiProvider = null;
    var restore = spyBotDecideLog();
    try {
      var g = mkSeatG({ caps0: { duanliang: true }, myHand: [card('酒','g2','♣')] });
      await runBotDecision(g, 0);
    } finally { restore(); runBotActionWindow = realWindow; }
    if(window.__G1botDecideCalls.indexOf('seatPick') >= 0)
      throw new Error('无密钥时 seatPick 不应被调(aiReady 守卫),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__duanliangCalls.length !== 0)
      throw new Error('无密钥不应调用 duanLiang,实际 ' + JSON.stringify(window.__duanliangCalls));
    if(window.__windowCalls !== 1)
      throw new Error('无密钥必须走 runBotActionWindow(回归红线:改动前在此卡死),实际 windowCalls=' + window.__windowCalls);
  });

  await check('G1接线:guhuoTarget 阶段 → seatPick 被调且 → guhuoChooseTarget(目标)', async function(){
    window.__guhuoTargetCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var restore = spyBotDecideLog();
    try {
      await runBotDecision(mkGuhuoG({}), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('seatPick') < 0)
      throw new Error('guhuoTarget 阶段应调用 botDecide(seatPick),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__guhuoTargetCalls.length !== 1 || window.__guhuoTargetCalls[0] !== 1)
      throw new Error('应 guhuoChooseTarget(座位1),实际 ' + JSON.stringify(window.__guhuoTargetCalls));
  });

  await check('G1接线:xuanfengPick 阶段 → seatPick 被调且 → pickXuanfengTarget(目标)', async function(){
    window.__xuanfengCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var restore = spyBotDecideLog();
    try {
      var g = mkXuanfengG({ hands: { 1: [card('杀')], 2: [card('闪')] } });
      g.phase = 'xuanfengPick';
      await runBotDecision(g, 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('seatPick') < 0)
      throw new Error('xuanfengPick 阶段应调用 botDecide(seatPick),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__xuanfengCalls.length !== 1 || window.__xuanfengCalls[0] !== 2)
      throw new Error('应 pickXuanfengTarget(座位2),实际 ' + JSON.stringify(window.__xuanfengCalls));
  });

  await check('G1接线修复:xuanfengPick 阶段无密钥 → seatPick 不接(aiReady守卫)、落回 botSafePrompt 不崩', async function(){
    window.__xuanfengCalls = [];
    aiApiKey = ''; aiProvider = null;
    var restore = spyBotDecideLog();
    try {
      var g = mkXuanfengG({});
      g.phase = 'xuanfengPick';
      await runBotDecision(g, 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('seatPick') >= 0)
      throw new Error('无密钥时 xuanfengPick 不应调 seatPick,实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__xuanfengCalls.length !== 0)
      throw new Error('无密钥不应调用 pickXuanfengTarget,实际 ' + JSON.stringify(window.__xuanfengCalls));
  });

  await check('G1接线:quhuDamageChoice 阶段 → seatPick 被调且 → respondQuhuDamage(目标)', async function(){
    window.__quhuDamageCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var restore = spyBotDecideLog();
    try {
      await runBotDecision(mkQuhuDamageG({}), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('seatPick') < 0)
      throw new Error('quhuDamageChoice 阶段应调用 botDecide(seatPick),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__quhuDamageCalls.length !== 1 || window.__quhuDamageCalls[0][0] !== 2)
      throw new Error('应 respondQuhuDamage(座位2),实际 ' + JSON.stringify(window.__quhuDamageCalls));
  });

  // ================= G4:yijiAssign(郭嘉遗计分配,跨调度累积) =================
  // pending 服务端真实结构(skills.js respondYijiAsk):{type:'yijiAssign', seat, cards,
  // resume};人类交互是"每张牌点一个角色,最后一张点击即提交"(render-controls.js)。
  // 机器人侧复用 botTwoStepA 跨调度累积:非最后一张的选择存进 {decisionId:'yijiAssign',
  // picks},下一调度继续选下一张;最后一张选完一次性提交 respondYijiAssign(picks)。
  // 【改动前行为核对】runBotDecision 无 yijiAssign 分支、BOT_PHASE_ACTOR 无登记 →
  // botSeatForState 返回 -1 → 走 botFallbackSeats+botSafePrompt;yijiAssign 按钮文案
  // ("给 自己/给 玩家X"/"上一步(重选)")不命中 safe(/不发动|不出|取消|跳过|放弃|结束/)
  // 与 mandatory(/选择|交给|弃置|摸牌|回复|打出/)任一正则、按钮数>1 → chosen=null →
  // botSafePrompt 返回 false 只告警不动作,机器人遗计分配必然卡死(真人局才有真人操作)。
  // G4 fallback 保守默认"给 自己"让机器人至少能把牌分出去,是明确改进,测试锁定。
  function mkYijiAssignG(opt){
    var g = mkSeatG(opt);
    g.phase = 'yijiAssign';
    g.pending = {
      type: 'yijiAssign',
      seat: 0,
      cards: [card('桃','y0'), card('杀','y1')],
      resume: { type: 'play', from: 0 }
    };
    return g;
  }

  await check('遗计分配:match=phase/pending.type/pending.seat 三者全等才命中;缺一即 false', function(){
    var s = BOT_DECISIONS.yijiAssign;
    if(!s) throw new Error('BOT_DECISIONS.yijiAssign 未注册');
    var g = mkYijiAssignG({});
    if(!s.match(g, 0)) throw new Error('完整 yijiAssign pending 应命中');
    var g2 = mkYijiAssignG({});
    g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('phase 非 yijiAssign 不应命中');
    var g3 = mkYijiAssignG({});
    g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('pending.type 非 yijiAssign 不应命中');
    var g4 = mkYijiAssignG({});
    g4.pending.seat = 1;
    if(s.match(g4, 0)) throw new Error('pending.seat 非本人不应命中');
    if(!s.match(g4, 1)) throw new Error('pending.seat=1 时应命中座位1');
  });

  await check('遗计分配候选:无累积时第0张=card0×存活角色(含自己);botTwoStepA 累积后第1张=card1×存活角色;阵亡者不在候选', function(){
    var s = BOT_DECISIONS.yijiAssign;
    botTwoStepA = null;
    var g = mkYijiAssignG({ aliveOf: { 2: false } });
    var c1 = s.buildCandidates(g, 0);
    if(c1.length !== 2) throw new Error('存活2人候选应为2项,实际 ' + JSON.stringify(c1));
    if(c1[0].idx !== 0 || c1[0].targetSeat !== 0 || c1[0].label !== '给 自己 【桃】')
      throw new Error('候选0应为 自己+桃,实际 ' + JSON.stringify(c1[0]));
    if(c1[1].idx !== 0 || c1[1].targetSeat !== 1 || c1[1].label !== '给 玩家1 【桃】')
      throw new Error('候选1应为 玩家1+桃,实际 ' + JSON.stringify(c1[1]));
    botTwoStepA = { decisionId: 'yijiAssign', picks: [1] };
    var c2 = s.buildCandidates(g, 0);
    if(c2.length !== 2) throw new Error('第2张候选应为2项,实际 ' + JSON.stringify(c2));
    if(c2[0].idx !== 1 || c2[0].targetSeat !== 0 || c2[0].label !== '给 自己 【杀】')
      throw new Error('第2张候选0应为 自己+杀,实际 ' + JSON.stringify(c2[0]));
    if(c2[1].idx !== 1 || c2[1].targetSeat !== 1 || c2[1].label !== '给 玩家1 【杀】')
      throw new Error('第2张候选1应为 玩家1+杀,实际 ' + JSON.stringify(c2[1]));
    botTwoStepA = null;
  });

  await check('遗计分配有密钥:调度1 mock 选牌0→座位1 → 累积 botTwoStepA 不提交;调度2 mock 选牌1→座位2 → respondYijiAssign([1,2]) 提交并重置', async function(){
    window.__yijiAssignCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":1}' }, { ok: true, text: '{"choice":2}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkYijiAssignG({});
    var r1 = await botDecide('yijiAssign', g, 0);
    if(r1 !== true || !botTwoStepA || botTwoStepA.decisionId !== 'yijiAssign' || botTwoStepA.picks.join(',') !== '1')
      throw new Error('调度1后应累积 {yijiAssign,picks:[1]},实际 ' + JSON.stringify(botTwoStepA));
    if(window.__yijiAssignCalls.length !== 0) throw new Error('非最后一张不应提交,实际 ' + JSON.stringify(window.__yijiAssignCalls));
    var r2 = await botDecide('yijiAssign', g, 0);
    if(r2 !== true) throw new Error('调度2应返回 true,实际 ' + r2);
    if(botTwoStepA !== null) throw new Error('调度2提交后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__yijiAssignCalls.length !== 1 || window.__yijiAssignCalls[0][0].join(',') !== '1,2')
      throw new Error('应 respondYijiAssign([1,2]),实际 ' + JSON.stringify(window.__yijiAssignCalls));
    if(window.__mockAiCalls !== 2) throw new Error('两调度应各1次AI调用,实际 ' + window.__mockAiCalls);
    botTwoStepA = null;
  });

  await check('遗计分配无密钥:两调度 fallback 均给 自己 → respondYijiAssign([0,0]) 提交并重置;无AI调用', async function(){
    window.__yijiAssignCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkYijiAssignG({});
    var r1 = await botDecide('yijiAssign', g, 0);
    if(r1 !== true || !botTwoStepA || botTwoStepA.decisionId !== 'yijiAssign' || botTwoStepA.picks.join(',') !== '0')
      throw new Error('调度1 fallback 应给 自己(picks:[0]),实际 ' + JSON.stringify(botTwoStepA));
    var r2 = await botDecide('yijiAssign', g, 0);
    if(r2 !== true) throw new Error('调度2应返回 true,实际 ' + r2);
    if(botTwoStepA !== null) throw new Error('调度2后 botTwoStepA 应重置为 null,实际 ' + JSON.stringify(botTwoStepA));
    if(window.__yijiAssignCalls.length !== 1 || window.__yijiAssignCalls[0][0].join(',') !== '0,0')
      throw new Error('应 respondYijiAssign([0,0]),实际 ' + JSON.stringify(window.__yijiAssignCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
    botTwoStepA = null;
  });

  await check('遗计分配接线:runBotDecision 全链 → botDecide(yijiAssign) 被调且提交;BOT_PHASE_ACTOR 登记;L1 EXCLUDE 收录防双重接管', async function(){
    window.__yijiAssignCalls = [];
    aiApiKey = ''; aiProvider = null;
    if(BOT_PHASE_ACTOR.yijiAssign !== 'seat')
      throw new Error('BOT_PHASE_ACTOR 应登记 yijiAssign:seat,实际 ' + BOT_PHASE_ACTOR.yijiAssign);
    if(!CONTROLS_CHOICE_EXCLUDE.has('yijiAssign'))
      throw new Error('yijiAssign 渲染 #controls 按钮,必须进 CONTROLS_CHOICE_EXCLUDE 防 L1 双重接管');
    var restore = spyBotDecideLog();
    try {
      // 跨调度累积:调度1 只选第一张(挂起 botTwoStepA),调度2 才提交,两次都走专用分支
      await runBotDecision(mkYijiAssignG({}), 0);
      await runBotDecision(mkYijiAssignG({}), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('yijiAssign') < 0)
      throw new Error('runBotDecision 应调用 botDecide(yijiAssign),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__G1botDecideCalls.filter(function(id){ return id === 'yijiAssign'; }).length !== 2)
      throw new Error('两调度都应命中 yijiAssign 分支,实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__yijiAssignCalls.length !== 1 || window.__yijiAssignCalls[0][0].join(',') !== '0,0')
      throw new Error('应提交 respondYijiAssign([0,0]),实际 ' + JSON.stringify(window.__yijiAssignCalls));
    botTwoStepA = null;
  });

  // ================= G5:lirangAsk(孔融礼让发动,单阶段选组合) =================
  // pending 服务端真实结构(game.js respondLiRang 守卫):{type:'lirangAsk', from, to};
  // 目标(pending.to)由服务端算好,AI 只选"哪两张手牌"——候选=2 张手牌组合(仿
  // discardSubset,默认组合恒在=第一张+第二张),选完即提交 respondLiRang(true, picks)。
  // 【改动前行为核对】runBotDecision 无 lirangAsk 分支、BOT_PHASE_ACTOR 无登记 →
  // botSeatForState 返回 -1 → 走 botFallbackSeats+botSafePrompt;lirangAsk 渲染的
  // "发动【礼让】"按钮依赖客户端 lirangPicks 模式状态(机器人从不置位,不渲染)、
  // "不发动"按钮命中 safe 正则第一替代项 → botSafePrompt 点击"不发动" →
  // respondLiRang(false,[]) 收尾推进。即改动前机器人恒不发动、流程正常推进。
  // G5 fallback=不发动(decline 动作)忠实复刻此行为,测试锁定;刻意不用 null(那会让
  // pending 永不清空、机器人永久卡死,见 bot.js BOT_DECISIONS.lirangAsk 上方注释)。
  function mkLirangG(opt){
    var g = mkSeatG(opt);
    g.phase = 'lirangAsk';
    g.pending = { type: 'lirangAsk', from: 0, to: 1 };
    return g;
  }

  await check('礼让发动:match=phase/pending.type/pending.from 三者全等才命中;缺一即 false', function(){
    var s = BOT_DECISIONS.lirangAsk;
    if(!s) throw new Error('BOT_DECISIONS.lirangAsk 未注册');
    var g = mkLirangG({});
    if(!s.match(g, 0)) throw new Error('完整 lirangAsk pending 应命中');
    var g2 = mkLirangG({});
    g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('phase 非 lirangAsk 不应命中');
    var g3 = mkLirangG({});
    g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('pending.type 非 lirangAsk 不应命中');
    var g4 = mkLirangG({});
    g4.pending.from = 1;
    if(s.match(g4, 0)) throw new Error('pending.from 非本人不应命中');
    if(!s.match(g4, 1)) throw new Error('pending.from=1 时应命中座位1');
  });

  await check('礼让发动候选:4张手牌→6组合(≤8)首项 isDefault 且 label 含牌名;5张→封顶8;手牌<2→空', function(){
    var s = BOT_DECISIONS.lirangAsk;
    var g = mkLirangG({ myHand: [card('桃','l0'), card('杀','l1'), card('闪','l2'), card('无中生有','l3')] });
    var c1 = s.buildCandidates(g, 0);
    if(c1.length !== 6) throw new Error('4张手牌应为6个组合,实际 ' + c1.length + ' ' + JSON.stringify(c1));
    if(c1[0].cardIdxs.join(',') !== '0,1' || c1[0].isDefault !== true)
      throw new Error('默认组合应为第一张+第二张且 isDefault,实际 ' + JSON.stringify(c1[0]));
    if(c1[0].label !== '交【桃】与【杀】') throw new Error('label 应含牌名,实际 ' + c1[0].label);
    if(c1[5].cardIdxs.join(',') !== '2,3') throw new Error('第6组合应为2,3,实际 ' + JSON.stringify(c1[5]));
    var g5 = mkLirangG({ myHand: [card('桃','x0'), card('杀','x1'), card('闪','x2'), card('酒','x3'), card('无中生有','x4')] });
    var c2 = s.buildCandidates(g5, 0);
    if(c2.length !== 8) throw new Error('5张手牌 C(5,2)=10 应封顶8,实际 ' + c2.length);
    var g1 = mkLirangG({ myHand: [card('桃','y0')] });
    if(s.buildCandidates(g1, 0).length !== 0) throw new Error('1张手牌无组合应返回空');
  });

  await check('礼让发动有密钥:mock 选组合下标3 → respondLiRang(true,[1,2]) spy 收到精确下标', async function(){
    window.__lirangCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":3}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkLirangG({ myHand: [card('桃','l0'), card('杀','l1'), card('闪','l2'), card('无中生有','l3')] });
    var r = await botDecide('lirangAsk', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0][0] !== true || window.__lirangCalls[0][1].join(',') !== '1,2')
      throw new Error('应 respondLiRang(true,[1,2])(4张牌组合序 0:(0,1) 1:(0,2) 2:(0,3) 3:(1,2)),实际 ' + JSON.stringify(window.__lirangCalls));
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('礼让发动无密钥:fallback=不发动 → respondLiRang(false,[]) 提交推进;无AI调用不卡死', async function(){
    window.__lirangCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkLirangG({ myHand: [card('桃','l0'), card('杀','l1'), card('闪','l2')] });
    var r = await botDecide('lirangAsk', g, 0);
    if(r !== true) throw new Error('应返回 true(不发动视为已处理),实际 ' + r);
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0][0] !== false || window.__lirangCalls[0][1].length !== 0)
      throw new Error('应 respondLiRang(false,[]) 收尾推进(与改动前 botSafePrompt 点击"不发动"等价),实际 ' + JSON.stringify(window.__lirangCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('礼让发动接线:runBotDecision 全链 → botDecide(lirangAsk) 被调且提交不发动;BOT_PHASE_ACTOR 登记;L1 EXCLUDE 收录防双重接管', async function(){
    window.__lirangCalls = [];
    aiApiKey = ''; aiProvider = null;
    if(BOT_PHASE_ACTOR.lirangAsk !== 'from')
      throw new Error('BOT_PHASE_ACTOR 应登记 lirangAsk:from,实际 ' + BOT_PHASE_ACTOR.lirangAsk);
    if(!CONTROLS_CHOICE_EXCLUDE.has('lirangAsk'))
      throw new Error('lirangAsk 渲染 #controls 按钮,必须进 CONTROLS_CHOICE_EXCLUDE 防 L1 双重接管');
    var restore = spyBotDecideLog();
    try {
      await runBotDecision(mkLirangG({ myHand: [card('桃','l0'), card('杀','l1')] }), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('lirangAsk') < 0)
      throw new Error('runBotDecision 应调用 botDecide(lirangAsk),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__G1botDecideCalls.indexOf('controlsChoice') >= 0)
      throw new Error('lirangAsk 已被 EXCLUDE,L1 controlsChoice 不应被调,实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__lirangCalls.length !== 1 || window.__lirangCalls[0][0] !== false || window.__lirangCalls[0][1].length !== 0)
      throw new Error('无密钥全链应提交 respondLiRang(false,[]),实际 ' + JSON.stringify(window.__lirangCalls));
  });

  // ================= A1:xiaoguo(乐进骁果,路径A专用注册) =================
  // pending 服务端真实结构(skills.js respondXiaoguo 守卫):{type:'xiaoguo', asking,
  // endingSeat, from};行动者=pending.asking。候选=每张基本牌(弃之发动)+ 恒有「不发动」。
  // 【改动前行为核对】runBotDecision 无 xiaoguo 分支、BOT_PHASE_ACTOR 无登记、且
  // CONTROLS_CHOICE_EXCLUDE 收录 xiaoguo → botSeatForState -1 → botFallbackSeats+
  // botSafePrompt 兜底:xiaoguo 渲染"发动【骁果】(依赖客户端 xiaoguoMode 模式状态,机器人
  // 从不置位)/不发动"→ safe 正则第一命中"不发动" → respondXiaoguo(false) →
  // advanceXiaoguo 推进。即改动前机器人恒不发动、流程正常推进。A1 localFallback=不发动
  // 忠实复刻此行为(测试锁定);刻意不用 null(那会让 pending 永不清空、机器人永久卡死)。
  // A1 之后 xiaoguo 从 EXCLUDE 移除、改由专用注册+接线(在 controlsChoice 之前)保护,
  // 有密钥 AI 选基本牌发动、无密钥仍恒不发动。
  function mkXiaoguoG(opt){
    opt = opt || {};
    var g = mkSeatG(opt);
    g.phase = 'xiaoguo';
    g.pending = { type: 'xiaoguo', from: 1, to: 0, endingSeat: opt.endingSeat !== undefined ? opt.endingSeat : 1, asking: 0 };
    return g;
  }

  await check('骁果路径A:match=phase/pending.type/pending.asking 三者全等才命中;缺一即 false', function(){
    var s = BOT_DECISIONS.xiaoguo;
    if(!s) throw new Error('BOT_DECISIONS.xiaoguo 未注册');
    var g = mkXiaoguoG({ myHand: [card('杀','x0')] });
    if(!s.match(g, 0)) throw new Error('完整 xiaoguo pending 应命中');
    var g2 = mkXiaoguoG({});
    g2.phase = 'play';
    if(s.match(g2, 0)) throw new Error('phase 非 xiaoguo 不应命中');
    var g3 = mkXiaoguoG({});
    g3.pending.type = 'other';
    if(s.match(g3, 0)) throw new Error('pending.type 非 xiaoguo 不应命中');
    var g4 = mkXiaoguoG({});
    g4.pending.asking = 1;
    if(s.match(g4, 0)) throw new Error('pending.asking 非本人不应命中');
    if(!s.match(g4, 1)) throw new Error('pending.asking=1 时应命中座位1');
  });

  await check('骁果路径A候选:手牌[杀,闪,桃,无中生有]→3项基本牌(杀/闪/桃,label含牌名)+恒有不发动;无基本牌→仅不发动', function(){
    var s = BOT_DECISIONS.xiaoguo;
    var g = mkXiaoguoG({ myHand: [card('杀','x0'), card('闪','x1'), card('桃','x2'), card('无中生有','x3')] });
    var c1 = s.buildCandidates(g, 0);
    if(c1.length !== 4) throw new Error('应为4候选(3基本牌+不发动),实际 ' + c1.length + ' ' + JSON.stringify(c1));
    if(c1[0].label !== '弃【杀】发动' || c1[0].activate !== true || c1[0].cardIdx !== 0)
      throw new Error('候选0应为弃杀发动(cardIdx0),实际 ' + JSON.stringify(c1[0]));
    if(c1[1].label !== '弃【闪】发动' || c1[1].cardIdx !== 1) throw new Error('候选1应为弃闪发动,实际 ' + JSON.stringify(c1[1]));
    if(c1[2].label !== '弃【桃】发动' || c1[2].cardIdx !== 2) throw new Error('候选2应为弃桃发动,实际 ' + JSON.stringify(c1[2]));
    if(c1[3].label !== '不发动' || c1[3].activate !== false || c1[3].cardIdx !== null)
      throw new Error('末项应恒为不发动,实际 ' + JSON.stringify(c1[3]));
    var g2 = mkXiaoguoG({ myHand: [card('无中生有','x4'), card('丈八蛇矛','x5')] });
    var c2 = s.buildCandidates(g2, 0);
    if(c2.length !== 1 || c2[0].activate !== false)
      throw new Error('无基本牌应只1项不发动,实际 ' + JSON.stringify(c2));
  });

  await check('骁果路径A有密钥:mock 选弃杀(choice0)→ respondXiaoguo(true,杀下标0);mock 选不发动(choice3)→ respondXiaoguo(false,null)', async function(){
    window.__xiaoguoCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkXiaoguoG({ myHand: [card('杀','x0'), card('闪','x1'), card('桃','x2'), card('无中生有','x3')] });
    var r = await botDecide('xiaoguo', g, 0);
    if(r !== true) throw new Error('应返回 true,实际 ' + r);
    if(window.__mockAiCalls !== 1) throw new Error('应有1次AI调用,实际 ' + window.__mockAiCalls);
    if(window.__xiaoguoCalls.length !== 1 || window.__xiaoguoCalls[0][0] !== true || window.__xiaoguoCalls[0][1] !== 0)
      throw new Error('应 respondXiaoguo(true,0)(杀下标),实际 ' + JSON.stringify(window.__xiaoguoCalls));
    window.__xiaoguoCalls = []; window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":3}' }];
    await botDecide('xiaoguo', g, 0);
    if(window.__xiaoguoCalls.length !== 1 || window.__xiaoguoCalls[0][0] !== false || window.__xiaoguoCalls[0][1] !== null)
      throw new Error('mock 选不发动应 respondXiaoguo(false,null),实际 ' + JSON.stringify(window.__xiaoguoCalls));
  });

  await check('骁果路径A无密钥:fallback=不发动 → respondXiaoguo(false,null)(advanceXiaoguo 推进不卡死);无AI调用', async function(){
    window.__xiaoguoCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkXiaoguoG({ myHand: [card('杀','x0'), card('闪','x1'), card('桃','x2')] });
    var r = await botDecide('xiaoguo', g, 0);
    if(r !== true) throw new Error('应返回 true(不发动视为已处理),实际 ' + r);
    if(window.__xiaoguoCalls.length !== 1 || window.__xiaoguoCalls[0][0] !== false || window.__xiaoguoCalls[0][1] !== null)
      throw new Error('无密钥应 respondXiaoguo(false,null)(与改动前 botSafePrompt 点击"不发动"等价),实际 ' + JSON.stringify(window.__xiaoguoCalls));
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应有AI调用,实际 ' + window.__mockAiCalls);
  });

  await check('骁果路径A接线:runBotDecision 全链 → botDecide(xiaoguo) 被调且提交;controlsChoice 不被调(接线先于L1);BOT_PHASE_ACTOR 登记 xiaoguo:asking;EXCLUDE 已移除 xiaoguo', async function(){
    window.__xiaoguoCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":0}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    if(BOT_PHASE_ACTOR.xiaoguo !== 'asking')
      throw new Error('BOT_PHASE_ACTOR 应登记 xiaoguo:asking,实际 ' + BOT_PHASE_ACTOR.xiaoguo);
    if(CONTROLS_CHOICE_EXCLUDE.has('xiaoguo'))
      throw new Error('xiaoguo 已有专用注册+接线,必须从 CONTROLS_CHOICE_EXCLUDE 移除(否则 L1 永远够不到,专用注册白做)');
    var restore = spyBotDecideLog();
    try {
      await runBotDecision(mkXiaoguoG({ myHand: [card('杀','x0')] }), 0);
    } finally { restore(); }
    if(window.__G1botDecideCalls.indexOf('xiaoguo') < 0)
      throw new Error('runBotDecision 应调用 botDecide(xiaoguo),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__G1botDecideCalls.indexOf('controlsChoice') >= 0)
      throw new Error('xiaoguo 专用接线应在 controlsChoice 之前,controlsChoice 不应被调,实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__xiaoguoCalls.length !== 1 || window.__xiaoguoCalls[0][0] !== true || window.__xiaoguoCalls[0][1] !== 0)
      throw new Error('有密钥全链应提交 respondXiaoguo(true,0),实际 ' + JSON.stringify(window.__xiaoguoCalls));
  });

  function mkFangtianG(opt){
    var g = mkSeatG(opt);
    g.players[0].equips.weapon = { name: '方天画戟' };
    return g;
  }

  await check('方天match:未装备/非最后一张/无目标/将驰禁杀/杀次数已用均 false;最后一张且有合法目标 true', function(){
    var s = BOT_DECISIONS.fangtian;
    if(!s) throw new Error('BOT_DECISIONS.fangtian 未注册');
    var base = mkSeatG({ myHand: [card('杀', 'ft0')] });
    if(s.match(base, 0)) throw new Error('未装备方天不应命中');
    var g1 = mkFangtianG({ myHand: [card('杀', 'ft1'), card('闪', 'ft2')] });
    if(s.match(g1, 0)) throw new Error('手牌不为1张不应命中');
    var g2 = mkFangtianG({ myHand: [card('杀', 'ft3')], aliveOf: { 1: false, 2: false } });
    if(s.match(g2, 0)) throw new Error('无合法目标不应命中');
    var g3 = mkFangtianG({ myHand: [card('杀', 'ft4')], jiangchiNoSlash: true });
    if(s.match(g3, 0)) throw new Error('将驰禁杀不应命中');
    var g4 = mkFangtianG({ myHand: [card('杀', 'ft5')], shaUsed: true });
    if(s.match(g4, 0)) throw new Error('出杀次数已用不应命中');
    var g5 = mkFangtianG({ myHand: [card('杀', 'ft6')] });
    if(!s.match(g5, 0)) throw new Error('最后一张手牌+方天+合法目标应命中');
  });

  await check('方天buildCandidates:target/targets均为1-3项数组;组合去重;label含目标;候选≤10', function(){
    var s = BOT_DECISIONS.fangtian;
    var g = mkFangtianG({ myHand: [card('杀', 'ft7')] });
    var c = s.buildCandidates(g, 0);
    if(c.length !== 3 || c.length > 10) throw new Error('3人局方天应有3个候选,实际 ' + c.length);
    var seen = {};
    c.forEach(function(x){
      if(!Array.isArray(x.target) || !Array.isArray(x.targets)) throw new Error('target/targets 必须为数组');
      if(x.target.length < 1 || x.target.length > 3 || x.targets.length !== x.target.length)
        throw new Error('目标数组长度应为1-3,实际 ' + JSON.stringify(x));
      var key = x.targets.join(',');
      if(seen[key]) throw new Error('目标组合重复,实际 ' + key);
      seen[key] = true;
      x.targets.forEach(function(i){
        if(x.label.indexOf(g.players[i].name) < 0) throw new Error('label 缺少目标名,实际 ' + x.label);
      });
    });
  });

  await check('方天有密钥:mock选组合 → playShaFangtian(cardIdx, targets) 收到数组', async function(){
    window.__fangtianCalls = [];
    window.__mockAiCalls = 0;
    window.__mockAiResults = [{ ok: true, text: '{"choice":2}' }];
    aiApiKey = 'test-key'; aiProvider = 'claude';
    var g = mkFangtianG({ myHand: [card('杀', 'ft8')] });
    var r = await botDecide('fangtian', g, 0);
    if(r !== true || window.__mockAiCalls !== 1) throw new Error('AI调用异常,实际 r=' + r + ',calls=' + window.__mockAiCalls);
    if(window.__fangtianCalls.length !== 1) throw new Error('playShaFangtian 应调用1次,实际 ' + window.__fangtianCalls.length);
    var call = window.__fangtianCalls[0];
    if(call[0] !== 0 || !Array.isArray(call[1]) || call[1].join(',') !== '1,2')
      throw new Error('应 playShaFangtian(0,[1,2]),实际 ' + JSON.stringify(call));
  });

  await check('方天无密钥:fallback执行首个合法组合;无合法目标不调用', async function(){
    window.__fangtianCalls = [];
    window.__mockAiCalls = 0;
    aiApiKey = ''; aiProvider = null;
    var g = mkFangtianG({ myHand: [card('杀', 'ft9')] });
    var r = await botDecide('fangtian', g, 0);
    if(r !== true) throw new Error('首个合法组合应执行,实际 ' + r);
    if(window.__fangtianCalls.length !== 1 || window.__fangtianCalls[0][0] !== 0 || window.__fangtianCalls[0][1].join(',') !== '1')
      throw new Error('应 fallback 执行 playShaFangtian(0,[1]),实际 ' + JSON.stringify(window.__fangtianCalls));
    window.__fangtianCalls = [];
    var empty = mkFangtianG({ myHand: [card('杀', 'fta')], aliveOf: { 1: false, 2: false } });
    var emptyResult = await botDecide('fangtian', empty, 0);
    if(emptyResult !== false) throw new Error('无合法目标应返回false,实际 ' + emptyResult);
    if(window.__fangtianCalls.length !== 0) throw new Error('无合法目标不应调用 playShaFangtian');
    if(window.__mockAiCalls !== 0) throw new Error('无密钥不应调用AI,实际 ' + window.__mockAiCalls);
  });

  await check('方天目标过滤:空城/距离外目标排除', function(){
    var s = BOT_DECISIONS.fangtian;
    var kongcheng = mkFangtianG({ myHand: [card('杀', 'ftb')] });
    kongcheng.players[1].general = 'zhuge';
    kongcheng.players[1].hand = [];
    var c1 = s.buildCandidates(kongcheng, 0);
    if(c1.some(function(x){ return x.targets.indexOf(1) >= 0; })) throw new Error('空城目标不应出现,实际 ' + JSON.stringify(c1));
    var distant = mkFangtianG({ n: 10, myHand: [card('杀', 'ftc')] });
    var targets = botFangtianTargets(distant, 0);
    if(targets.indexOf(5) >= 0) throw new Error('距离外座位5不应出现,实际 ' + JSON.stringify(targets));
    if(targets.indexOf(4) < 0) throw new Error('距离内座位4应保留,实际 ' + JSON.stringify(targets));
  });

  await check('方天接线:runBotDecision play调用fangtian后不再走runBotActionWindow', async function(){
    window.__fangtianCalls = [];
    window.__windowCalls = 0;
    botTwoStepA = null;
    aiApiKey = ''; aiProvider = null;
    var realWindow = runBotActionWindow;
    var restore = spyBotDecideLog();
    runBotActionWindow = async function(){ window.__windowCalls++; };
    try {
      await runBotDecision(mkFangtianG({ myHand: [card('杀', 'ftd')] }), 0);
    } finally {
      restore();
      runBotActionWindow = realWindow;
    }
    if(window.__G1botDecideCalls.indexOf('fangtian') < 0)
      throw new Error('runBotDecision 应调用 botDecide(fangtian),实际 ' + JSON.stringify(window.__G1botDecideCalls));
    if(window.__fangtianCalls.length !== 1) throw new Error('fangtian 应调用1次,实际 ' + window.__fangtianCalls.length);
    if(window.__windowCalls !== 0) throw new Error('fangtian执行后不应再走 runBotActionWindow,实际 ' + window.__windowCalls);
  });

  // ================= P2: G5 决策思考链(buildSystemPrompt 思考引导) =================
  // 断言各注册项 buildSystemPrompt 已追加思考引导句(引导性,非硬规则;无密钥路径不涉及,
  // prompt 只影响 AI 决策)。断言用新句独有子串(不用"保留/价值"等既有文本也含的词),
  // 保证 TDD 红先行——旧文本里已出现的词测不出新句是否真的追加了。
  await check('P2 G5:discardSubset prompt 含思考引导"先想保留(关键防御牌优先)"', function(){
    var s = BOT_DECISIONS.discardSubset;
    if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('discardSubset.buildSystemPrompt 未注册');
    var t = s.buildSystemPrompt();
    if(t.indexOf('先想保留') < 0) throw new Error('prompt 应含"先想保留(关键防御牌优先)",实际 ' + t);
  });

  await check('P2 G5:pickSlot prompt 含思考引导"先看目标装备/判定区价值"', function(){
    var s = BOT_DECISIONS.pickSlot;
    if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('pickSlot.buildSystemPrompt 未注册');
    var t = s.buildSystemPrompt();
    if(t.indexOf('先看目标装备') < 0) throw new Error('prompt 应含"先看目标装备/判定区的价值",实际 ' + t);
  });

  await check('P2 G5:dying prompt 含思考引导"判断濒死者敌是友/值不值得救"', function(){
    var s = BOT_DECISIONS.dying;
    if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('dying.buildSystemPrompt 未注册');
    var t = s.buildSystemPrompt();
    if(t.indexOf('敌是友') < 0) throw new Error('prompt 应含"敌是友/值不值得救",实际 ' + t);
  });

  await check('P2 G5:duel prompt 含思考引导"胜负预期"', function(){
    var s = BOT_DECISIONS.duel;
    if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('duel.buildSystemPrompt 未注册');
    var t = s.buildSystemPrompt();
    if(t.indexOf('胜负') < 0) throw new Error('prompt 应含"胜负预期",实际 ' + t);
  });

  await check('P2 G5:aoeResp prompt 含思考引导"血量与手牌宽裕"', function(){
    var s = BOT_DECISIONS.aoeResp;
    if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('aoeResp.buildSystemPrompt 未注册');
    var t = s.buildSystemPrompt();
    if(t.indexOf('血量') < 0) throw new Error('prompt 应含"血量与手牌宽裕",实际 ' + t);
  });

  await check('P2 G5:controlsChoice prompt 含思考引导"多数情况先判断值不值得"', function(){
    var t = buildControlsChoiceSystemPrompt();
    if(t.indexOf('值不值得') < 0) throw new Error('prompt 应含"值不值得",实际 ' + t);
  });

  // ================= P3: G2 响应类身份引导(buildSystemPrompt 接 botIdentityGuidance) =================
  // 断言:统一 helper botPromptWithIdentity(base,g,seat) 与各响应类注册项 buildSystemPrompt
  // 在身份局(g.gameMode==='identity' 且角色已知)拼入"你当前的身份是X"引导;ffa 局
  // botIdentityGuidance 返回空串、原文不受影响。只影响 AI prompt,无密钥路径不涉及。
  // TDD 红先行:botPromptWithIdentity 尚未定义(ReferenceError)、buildSystemPrompt 尚未
  // 接身份引导("你当前的身份是"子串缺失)——这两类失败在实现前必须各自看到。
  await check('P3 G2:botPromptWithIdentity 身份局主公含"你当前的身份是主公"', function(){
    if(typeof botPromptWithIdentity !== 'function') throw new Error('botPromptWithIdentity 未定义');
    var g = { gameMode:'identity', players: [ { role:'zhu' }, { role:'zhong' } ] };
    var t = botPromptWithIdentity('base', g, 0);
    if(t.indexOf('base') !== 0) throw new Error('应保留原文前缀,实际 ' + t);
    if(t.indexOf('你当前的身份是主公') < 0) throw new Error('身份局应含身份引导,实际 ' + t);
  });

  await check('P3 G2:botPromptWithIdentity ffa 局不含身份引导、原文原样', function(){
    if(typeof botPromptWithIdentity !== 'function') throw new Error('botPromptWithIdentity 未定义');
    var g = { gameMode:'ffa', players: [ { role:'zhu' }, { role:'zhong' } ] };
    var t = botPromptWithIdentity('base', g, 0);
    if(t !== 'base') throw new Error('ffa 应原样返回 base,实际 ' + t);
    if(t.indexOf('你当前的身份是') >= 0) throw new Error('ffa 不应含身份引导,实际 ' + t);
  });

  await check('P3 G2:dying.buildSystemPrompt 身份局含身份引导', function(){
    var s = BOT_DECISIONS.dying;
    var g = { gameMode:'identity', players: [ { role:'fan' }, { role:'zhu' } ] };
    var t = s.buildSystemPrompt(g, 0);
    if(t.indexOf('你当前的身份是反贼') < 0) throw new Error('身份局应含身份引导,实际 ' + t);
  });

  await check('P3 G2:dying.buildSystemPrompt ffa 局不含身份引导', function(){
    var s = BOT_DECISIONS.dying;
    var g = { gameMode:'ffa', players: [ { role:'zhu' }, { role:'zhong' } ] };
    var t = s.buildSystemPrompt(g, 0);
    if(t.indexOf('你当前的身份是') >= 0) throw new Error('ffa 不应含身份引导,实际 ' + t);
  });

  await check('P3 G2:duel/aoeResp/controlsChoice 身份局含、ffa 不含身份引导', function(){
    var identityG = { gameMode:'identity', players: [ { role:'nei' }, { role:'zhu' } ] };
    var ffaG = { gameMode:'ffa', players: [ { role:'zhu' } ] };
    [BOT_DECISIONS.duel, BOT_DECISIONS.aoeResp, BOT_DECISIONS.controlsChoice].forEach(function(s){
      if(!s || typeof s.buildSystemPrompt !== 'function') throw new Error('注册项 buildSystemPrompt 缺失');
      var ti = s.buildSystemPrompt(identityG, 0);
      if(ti.indexOf('你当前的身份是内奸') < 0) throw new Error('身份局应含"你当前的身份是内奸",实际 ' + ti);
      var tf = s.buildSystemPrompt(ffaG, 0);
      if(tf.indexOf('你当前的身份是') >= 0) throw new Error('ffa 不应含身份引导,实际 ' + tf);
    });
  });

  // ================= 系统性扫描发现的紧急盲区收尾:祝融【烈刃】拼点响应 + 典韦【强袭】
  // 选目标(Task 遗留清理) =================
  // 【背景】真实dump确认这两步此前是真正永久卡死(不是"缺少智能判断"这类温和问题):
  // 烈刃拼点响应的按钮文案是"【牌名】♠5"这种纯牌面拼接,强袭选目标的按钮文案是目标的纯
  // 姓名,都不命中botSafePrompt任何正则、也没有取消选项,候选≥2个时机器人彻底点不到任何
  // 按钮。修法是确定性兜底(固定选候选第一项),不追求判断哪个更好——目标只是消除卡死。
  await check('系统性扫描收尾:烈刃拼点响应(lieRenRespond)固定选手牌第一张', async function(){
    window.__lieRenCalls = [];
    respondLieRen = function(idx){ window.__lieRenCalls.push(idx); };
    var g = mkSeatG({ myHand: [card('闪','a','♠',5), card('桃','b','♥',8)] });
    g.phase = 'lieRenRespond';
    g.pending = { type: 'lieRenRespond', sourceSeat: 1, targetSeat: 0, sourceCard: card('杀','p1','♣',9) };
    await runBotDecision(g, 0);
    if(window.__lieRenCalls.length !== 1 || window.__lieRenCalls[0] !== 0)
      throw new Error('应调用 respondLieRen(0),实际 ' + JSON.stringify(window.__lieRenCalls));
  });

  await check('系统性扫描收尾:强袭选目标(qiangxiPickTarget)固定选候选第一个', async function(){
    window.__qiangxiTargetCalls = [];
    pickQiangxiTarget = function(seat){ window.__qiangxiTargetCalls.push(seat); };
    var g = mkSeatG({});
    g.phase = 'qiangxiPickTarget';
    g.pending = { type: 'qiangxiPickTarget', seat: 0, costType: 'hp', candidates: [1, 2] };
    await runBotDecision(g, 0);
    if(window.__qiangxiTargetCalls.length !== 1 || window.__qiangxiTargetCalls[0] !== 1)
      throw new Error('应调用 pickQiangxiTarget(1),实际 ' + JSON.stringify(window.__qiangxiTargetCalls));
  });

  await check('系统性扫描收尾:BOT_PHASE_ACTOR 已登记 lieRenRespond/qiangxiPickTarget', function(){
    if(BOT_PHASE_ACTOR.lieRenRespond !== 'targetSeat')
      throw new Error('lieRenRespond 应登记为 targetSeat,实际 ' + BOT_PHASE_ACTOR.lieRenRespond);
    if(BOT_PHASE_ACTOR.qiangxiPickTarget !== 'seat')
      throw new Error('qiangxiPickTarget 应登记为 seat,实际 ' + BOT_PHASE_ACTOR.qiangxiPickTarget);
  });

  // ================= 第二批-第1组:徐庶【举荐】+曹仁【据守】(每回合结束都可能触发,
  // 优先级最高) =================
  // 【背景】两者都已经有"取消"按钮能命中botSafePrompt安全正则,真实dump确认过不卡死,
  // 只是缺乏真正判断——本批修的是"判断力",不是"消除卡死"。
  await check('第二批-1:举荐jujianPickCard 固定不发动(cancelJujian)', async function(){
    window.__jujianCancelCalls = 0;
    cancelJujian = function(){ window.__jujianCancelCalls++; };
    var g = mkSeatG({ myHand: [card('桃','a','♥',8), card('无中生有','b','♦',3)] });
    g.phase = 'jujianPickCard';
    g.pending = { type: 'jujianPickCard', sourceSeat: 0, endingSeat: 0 };
    await runBotDecision(g, 0);
    if(window.__jujianCancelCalls !== 1)
      throw new Error('应调用 cancelJujian 一次,实际 ' + window.__jujianCancelCalls);
  });

  await check('第二批-1:举荐jujianPickTarget 防御性兜底,固定选候选第一个', async function(){
    window.__jujianTargetCalls = [];
    respondJujianPickTarget = function(seat){ window.__jujianTargetCalls.push(seat); };
    var g = mkSeatG({});
    g.phase = 'jujianPickTarget';
    g.pending = { type: 'jujianPickTarget', sourceSeat: 0, endingSeat: 0, candidates: [1, 2] };
    await runBotDecision(g, 0);
    if(window.__jujianTargetCalls.length !== 1 || window.__jujianTargetCalls[0] !== 1)
      throw new Error('应调用 respondJujianPickTarget(1),实际 ' + JSON.stringify(window.__jujianTargetCalls));
  });

  await check('第二批-1:举荐jujianChooseEffect 体力未满选recover', async function(){
    window.__jujianEffectCalls = [];
    respondJujianEffect = function(opt){ window.__jujianEffectCalls.push(opt); };
    var g = mkSeatG({ hpOf: { 0: 2 } });
    g.phase = 'jujianChooseEffect';
    g.pending = { type: 'jujianChooseEffect', sourceSeat: 1, endingSeat: 1, targetSeat: 0, discardCard: card('桃') };
    await runBotDecision(g, 0);
    if(window.__jujianEffectCalls.length !== 1 || window.__jujianEffectCalls[0] !== 'recover')
      throw new Error('体力未满应选recover,实际 ' + JSON.stringify(window.__jujianEffectCalls));
  });

  await check('第二批-1:举荐jujianChooseEffect 体力已满选draw(避免选recover无效果)', async function(){
    window.__jujianEffectCalls = [];
    respondJujianEffect = function(opt){ window.__jujianEffectCalls.push(opt); };
    var g = mkSeatG({});
    g.phase = 'jujianChooseEffect';
    g.pending = { type: 'jujianChooseEffect', sourceSeat: 1, endingSeat: 1, targetSeat: 0, discardCard: card('桃') };
    await runBotDecision(g, 0);
    if(window.__jujianEffectCalls.length !== 1 || window.__jujianEffectCalls[0] !== 'draw')
      throw new Error('体力已满应选draw,实际 ' + JSON.stringify(window.__jujianEffectCalls));
  });

  await check('第二批-1:据守jushouChoose 手牌少(≤3)时发动(confirmJushou)', async function(){
    window.__jushouConfirmCalls = 0; window.__jushouCancelCalls = 0;
    confirmJushou = function(){ window.__jushouConfirmCalls++; };
    cancelJushou = function(){ window.__jushouCancelCalls++; };
    var g = mkSeatG({ myHand: [card('桃')] });
    g.phase = 'jushouChoose';
    g.pending = { type: 'jushouChoose', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__jushouConfirmCalls !== 1 || window.__jushouCancelCalls !== 0)
      throw new Error('手牌1张应发动,实际 confirm=' + window.__jushouConfirmCalls + ' cancel=' + window.__jushouCancelCalls);
  });

  await check('第二批-1:据守jushouChoose 手牌多(>3)时不发动(cancelJushou)', async function(){
    window.__jushouConfirmCalls = 0; window.__jushouCancelCalls = 0;
    confirmJushou = function(){ window.__jushouConfirmCalls++; };
    cancelJushou = function(){ window.__jushouCancelCalls++; };
    var g = mkSeatG({ myHand: [card('杀'), card('闪'), card('桃'), card('酒'), card('无中生有')] });
    g.phase = 'jushouChoose';
    g.pending = { type: 'jushouChoose', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__jushouCancelCalls !== 1 || window.__jushouConfirmCalls !== 0)
      throw new Error('手牌5张应不发动,实际 confirm=' + window.__jushouConfirmCalls + ' cancel=' + window.__jushouCancelCalls);
  });

  await check('第二批-1:BOT_PHASE_ACTOR 已登记 jujian三段/jushouChoose', function(){
    if(BOT_PHASE_ACTOR.jujianPickCard !== 'sourceSeat')
      throw new Error('jujianPickCard 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.jujianPickCard);
    if(BOT_PHASE_ACTOR.jujianPickTarget !== 'sourceSeat')
      throw new Error('jujianPickTarget 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.jujianPickTarget);
    if(BOT_PHASE_ACTOR.jujianChooseEffect !== 'targetSeat')
      throw new Error('jujianChooseEffect 应登记为 targetSeat,实际 ' + BOT_PHASE_ACTOR.jujianChooseEffect);
    if(BOT_PHASE_ACTOR.jushouChoose !== 'seat')
      throw new Error('jushouChoose 应登记为 seat,实际 ' + BOT_PHASE_ACTOR.jushouChoose);
  });

  // ================= 第二批-第2组:雌雄双股剑+贯石斧+寒冰剑+青龙偃月刀(装备类4个,
  // 同一套结构) =================
  await check('第二批-2:雌雄双股剑cixiongAsk 固定发动(respondCixiongAsk(true))', async function(){
    window.__cixiongAskCalls = [];
    respondCixiongAsk = function(activate){ window.__cixiongAskCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'cixiongAsk';
    g.pending = { type: 'cixiongAsk', from: 0, to: 1, noShan: false, shaColor: 'red' };
    await runBotDecision(g, 0);
    if(window.__cixiongAskCalls.length !== 1 || window.__cixiongAskCalls[0] !== true)
      throw new Error('应调用 respondCixiongAsk(true),实际 ' + JSON.stringify(window.__cixiongAskCalls));
  });

  await check('第二批-2:雌雄双股剑cixiongChoice 固定选弃手牌第一张', async function(){
    window.__cixiongChoiceCalls = [];
    respondCixiongChoice = function(choice, idx){ window.__cixiongChoiceCalls.push([choice, idx]); };
    var g = mkSeatG({ myHand: [card('杀'), card('闪')] });
    g.phase = 'cixiongChoice';
    g.pending = { type: 'cixiongChoice', from: 1, to: 0, noShan: false, shaColor: 'red' };
    await runBotDecision(g, 0);
    if(window.__cixiongChoiceCalls.length !== 1 ||
       window.__cixiongChoiceCalls[0][0] !== 'discard' || window.__cixiongChoiceCalls[0][1] !== 0)
      throw new Error('应调用 respondCixiongChoice("discard",0),实际 ' + JSON.stringify(window.__cixiongChoiceCalls));
  });

  await check('第二批-2:贯石斧guanshi 固定发动,选手牌前两张', async function(){
    window.__guanshiCalls = [];
    respondGuanshi = function(picks){ window.__guanshiCalls.push(picks); };
    var g = mkSeatG({ myHand: [card('杀'), card('酒')] });
    g.phase = 'guanshi';
    g.pending = { type: 'guanshi', from: 0, to: 1 };
    await runBotDecision(g, 0);
    if(window.__guanshiCalls.length !== 1 || JSON.stringify(window.__guanshiCalls[0]) !== JSON.stringify(['hand:0','hand:1']))
      throw new Error('应调用 respondGuanshi(["hand:0","hand:1"]),实际 ' + JSON.stringify(window.__guanshiCalls));
  });

  await check('第二批-2:寒冰剑hanbingAsk 固定发动(respondHanbingAsk(true))', async function(){
    window.__hanbingAskCalls = [];
    respondHanbingAsk = function(activate){ window.__hanbingAskCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'hanbingAsk';
    g.pending = { type: 'hanbingAsk', from: 0, to: 1, sourceCard: card('杀') };
    await runBotDecision(g, 0);
    if(window.__hanbingAskCalls.length !== 1 || window.__hanbingAskCalls[0] !== true)
      throw new Error('应调用 respondHanbingAsk(true),实际 ' + JSON.stringify(window.__hanbingAskCalls));
  });

  await check('第二批-2:青龙偃月刀qinglong 有可用杀时发动', async function(){
    window.__qinglongCalls = [];
    respondQinglong = function(activate, idx){ window.__qinglongCalls.push([activate, idx]); };
    var g = mkSeatG({ myHand: [card('杀')] });
    g.phase = 'qinglong';
    g.pending = { type: 'qinglong', from: 0, to: 1, sourceCard: card('杀') };
    await runBotDecision(g, 0);
    if(window.__qinglongCalls.length !== 1 ||
       window.__qinglongCalls[0][0] !== true || window.__qinglongCalls[0][1] !== 0)
      throw new Error('应调用 respondQinglong(true,0),实际 ' + JSON.stringify(window.__qinglongCalls));
  });

  await check('第二批-2:青龙偃月刀qinglong 无可用杀/将驰禁杀时不发动(先探测再决策)', async function(){
    window.__qinglongCalls = [];
    respondQinglong = function(activate, idx){ window.__qinglongCalls.push([activate, idx]); };
    var g = mkSeatG({ myHand: [card('桃')] });
    g.phase = 'qinglong';
    g.pending = { type: 'qinglong', from: 0, to: 1, sourceCard: card('杀') };
    await runBotDecision(g, 0);
    if(window.__qinglongCalls.length !== 1 || window.__qinglongCalls[0][0] !== false)
      throw new Error('无杀应调用 respondQinglong(false),实际 ' + JSON.stringify(window.__qinglongCalls));

    window.__qinglongCalls = [];
    var g2 = mkSeatG({ myHand: [card('杀')] });
    g2.players[0].jiangchiNoSlash = true;
    g2.phase = 'qinglong';
    g2.pending = { type: 'qinglong', from: 0, to: 1, sourceCard: card('杀') };
    await runBotDecision(g2, 0);
    if(window.__qinglongCalls.length !== 1 || window.__qinglongCalls[0][0] !== false)
      throw new Error('将驰禁杀应调用 respondQinglong(false),实际 ' + JSON.stringify(window.__qinglongCalls));
  });

  await check('第二批-2:BOT_PHASE_ACTOR 已登记 cixiongAsk/cixiongChoice/guanshi/hanbingAsk/qinglong', function(){
    if(BOT_PHASE_ACTOR.cixiongAsk !== 'from')
      throw new Error('cixiongAsk 应登记为 from,实际 ' + BOT_PHASE_ACTOR.cixiongAsk);
    if(BOT_PHASE_ACTOR.cixiongChoice !== 'to')
      throw new Error('cixiongChoice 应登记为 to,实际 ' + BOT_PHASE_ACTOR.cixiongChoice);
    if(BOT_PHASE_ACTOR.guanshi !== 'from')
      throw new Error('guanshi 应登记为 from,实际 ' + BOT_PHASE_ACTOR.guanshi);
    if(BOT_PHASE_ACTOR.hanbingAsk !== 'from')
      throw new Error('hanbingAsk 应登记为 from,实际 ' + BOT_PHASE_ACTOR.hanbingAsk);
    if(BOT_PHASE_ACTOR.qinglong !== 'from')
      throw new Error('qinglong 应登记为 from,实际 ' + BOT_PHASE_ACTOR.qinglong);
  });

  // ================= 第二批-第3组:颜良文丑【双雄】+张角【雷击】 =================
  await check('第二批-3:双雄shuangxiongAsk 固定不发动(respondShuangxiong(false))', async function(){
    window.__shuangxiongCalls = [];
    respondShuangxiong = function(activate){ window.__shuangxiongCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'shuangxiongAsk';
    g.pending = { type: 'shuangxiongAsk', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__shuangxiongCalls.length !== 1 || window.__shuangxiongCalls[0] !== false)
      throw new Error('应调用 respondShuangxiong(false),实际 ' + JSON.stringify(window.__shuangxiongCalls));
  });

  await check('第二批-3:雷击leijiChoose 固定发动,选候选第一个目标', async function(){
    window.__leijiTriggerCalls = [];
    triggerLeiji = function(seat){ window.__leijiTriggerCalls.push(seat); };
    var g = mkSeatG({});
    g.phase = 'leijiChoose';
    g.pending = { type: 'leijiChoose', sourceSeat: 0, availableTargets: [1, 2], shanCard: card('闪') };
    await runBotDecision(g, 0);
    if(window.__leijiTriggerCalls.length !== 1 || window.__leijiTriggerCalls[0] !== 1)
      throw new Error('应调用 triggerLeiji(1),实际 ' + JSON.stringify(window.__leijiTriggerCalls));
  });

  await check('第二批-3:雷击leijiJudge 纯确认点击(doLeijiJudge)', async function(){
    window.__doLeijiJudgeCalls = 0;
    doLeijiJudge = function(){ window.__doLeijiJudgeCalls++; };
    var g = mkSeatG({});
    g.phase = 'leijiJudge';
    g.pending = { type: 'leijiJudge', sourceSeat: 0, targetSeat: 1, resume: { kind: 'leijiJudge', sourceSeat: 0, targetSeat: 1 } };
    await runBotDecision(g, 0);
    if(window.__doLeijiJudgeCalls !== 1)
      throw new Error('应调用 doLeijiJudge 一次,实际 ' + window.__doLeijiJudgeCalls);
  });

  await check('第二批-3:BOT_PHASE_ACTOR 已登记 shuangxiongAsk/leijiChoose/leijiJudge', function(){
    if(BOT_PHASE_ACTOR.shuangxiongAsk !== 'seat')
      throw new Error('shuangxiongAsk 应登记为 seat,实际 ' + BOT_PHASE_ACTOR.shuangxiongAsk);
    if(BOT_PHASE_ACTOR.leijiChoose !== 'sourceSeat')
      throw new Error('leijiChoose 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.leijiChoose);
    if(BOT_PHASE_ACTOR.leijiJudge !== 'sourceSeat')
      throw new Error('leijiJudge 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.leijiJudge);
  });

  // ================= 第二批-剩余清单批量处理 =================
  await check('第二批-剩余:好施haoshiPick 固定选候选第一个', async function(){
    window.__haoshiCalls = [];
    respondHaoshi = function(seat){ window.__haoshiCalls.push(seat); };
    var g = mkSeatG({});
    g.phase = 'haoshiPick';
    g.pending = { type: 'haoshiPick', seat: 0, half: 3, candidates: [1, 2] };
    await runBotDecision(g, 0);
    if(window.__haoshiCalls.length !== 1 || window.__haoshiCalls[0] !== 1)
      throw new Error('应调用 respondHaoshi(1),实际 ' + JSON.stringify(window.__haoshiCalls));
  });

  await check('第二批-剩余:挑衅tiaoxinDiscard 防御性兜底,固定选目标手牌第一张', async function(){
    window.__tiaoxinDiscardCalls = [];
    pickTiaoxinDiscard = function(kind, value){ window.__tiaoxinDiscardCalls.push([kind, value]); };
    var g = mkSeatG({ hands: { 1: [card('杀')] } });
    g.phase = 'tiaoxinDiscard';
    g.pending = { type: 'tiaoxinDiscard', from: 0, to: 1 };
    await runBotDecision(g, 0);
    if(window.__tiaoxinDiscardCalls.length !== 1 ||
       window.__tiaoxinDiscardCalls[0][0] !== 'hand' || window.__tiaoxinDiscardCalls[0][1] !== 0)
      throw new Error('应调用 pickTiaoxinDiscard("hand",0),实际 ' + JSON.stringify(window.__tiaoxinDiscardCalls));
  });

  await check('第二批-剩余:闭月biyue 固定发动', async function(){
    window.__biyueCalls = [];
    respondBiyue = function(activate){ window.__biyueCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'biyue';
    g.pending = { type: 'biyue', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__biyueCalls.length !== 1 || window.__biyueCalls[0] !== true)
      throw new Error('应调用 respondBiyue(true),实际 ' + JSON.stringify(window.__biyueCalls));
  });

  await check('第二批-剩余:不屈buquAsk 固定发动', async function(){
    window.__buquCalls = [];
    respondBuqu = function(useBuqu){ window.__buquCalls.push(useBuqu); };
    var g = mkSeatG({});
    g.phase = 'buquAsk';
    g.pending = { type: 'buquAsk', seat: 0, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__buquCalls.length !== 1 || window.__buquCalls[0] !== true)
      throw new Error('应调用 respondBuqu(true),实际 ' + JSON.stringify(window.__buquCalls));
  });

  await check('第二批-剩余:仁心renxinChoose 固定不发动(利他+代价明确)', async function(){
    window.__renxinCancelCalls = 0;
    cancelRenxin = function(){ window.__renxinCancelCalls++; };
    var g = mkSeatG({});
    g.phase = 'renxinChoose';
    g.pending = { type: 'renxinChoose', seat: 0, target: 1, equipSlots: ['weapon'] };
    await runBotDecision(g, 0);
    if(window.__renxinCancelCalls !== 1)
      throw new Error('应调用 cancelRenxin 一次,实际 ' + window.__renxinCancelCalls);
  });

  await check('第二批-剩余:称象chengxiangAsk 固定发动', async function(){
    window.__chengxiangAskCalls = 0;
    confirmChengxiangAsk = function(){ window.__chengxiangAskCalls++; };
    var g = mkSeatG({});
    g.phase = 'chengxiangAsk';
    g.pending = { type: 'chengxiangAsk', seat: 0, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__chengxiangAskCalls !== 1)
      throw new Error('应调用 confirmChengxiangAsk 一次,实际 ' + window.__chengxiangAskCalls);
  });

  await check('第二批-剩余:称象chengxiangChoose 守卫用g.phase==="chengxiangAsk"(实测g.phase从不变成chengxiangChoose)', async function(){
    window.__chengxiangCalls = [];
    confirmChengxiang = function(sel){ window.__chengxiangCalls.push(sel); };
    var g = mkSeatG({});
    g.phase = 'chengxiangAsk'; // 关键:不是'chengxiangChoose'
    g.pending = { type: 'chengxiangChoose', seat: 0, selectable: [{indices:[0],sum:5},{indices:[0,1],sum:10},{indices:[],sum:0}] };
    await runBotDecision(g, 0);
    if(window.__chengxiangCalls.length !== 1 || window.__chengxiangCalls[0].sum !== 10)
      throw new Error('应选sum最大的组合(sum=10),实际 ' + JSON.stringify(window.__chengxiangCalls));
  });

  await check('第二批-剩余:裸衣luoyiAsk 固定不发动', async function(){
    window.__luoyiCalls = [];
    respondLuoyi = function(activate){ window.__luoyiCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'luoyiAsk';
    g.pending = { type: 'luoyiAsk', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__luoyiCalls.length !== 1 || window.__luoyiCalls[0] !== false)
      throw new Error('应调用 respondLuoyi(false),实际 ' + JSON.stringify(window.__luoyiCalls));
  });

  await check('第二批-剩余:节命jiemingAsk 固定不发动(targetSeat传null)', async function(){
    window.__jiemingCalls = [];
    respondJieming = function(targetSeat){ window.__jiemingCalls.push(targetSeat); };
    var g = mkSeatG({});
    g.phase = 'jiemingAsk';
    g.pending = { type: 'jiemingAsk', seat: 0, remaining: 1, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__jiemingCalls.length !== 1 || window.__jiemingCalls[0] !== null)
      throw new Error('应调用 respondJieming(null),实际 ' + JSON.stringify(window.__jiemingCalls));
  });

  await check('第二批-剩余:新生xinshengAsk 固定发动', async function(){
    window.__xinshengCalls = [];
    respondXinshengAsk = function(activate){ window.__xinshengCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'xinshengAsk';
    g.pending = { type: 'xinshengAsk', seat: 0, remaining: 1, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__xinshengCalls.length !== 1 || window.__xinshengCalls[0] !== true)
      throw new Error('应调用 respondXinshengAsk(true),实际 ' + JSON.stringify(window.__xinshengCalls));
  });

  await check('第二批-剩余:酒诗②jiushiFlipAsk 固定发动', async function(){
    window.__jiushiCalls = [];
    respondJiushiFlip = function(activate){ window.__jiushiCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'jiushiFlipAsk';
    g.pending = { type: 'jiushiFlipAsk', seat: 0, wasFacedown: true, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__jiushiCalls.length !== 1 || window.__jiushiCalls[0] !== true)
      throw new Error('应调用 respondJiushiFlip(true),实际 ' + JSON.stringify(window.__jiushiCalls));
  });

  await check('第二批-剩余:连营lianyingAsk 固定发动(注:当前无任何武将带lianying cap,防御性收录)', async function(){
    window.__lianyingCalls = [];
    respondLianying = function(activate){ window.__lianyingCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'lianyingAsk';
    g.pending = { type: 'lianyingAsk', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__lianyingCalls.length !== 1 || window.__lianyingCalls[0] !== true)
      throw new Error('应调用 respondLianying(true),实际 ' + JSON.stringify(window.__lianyingCalls));
  });

  await check('第二批-剩余:明策mingcePickCard/PickTarget/PickTarget2 防御性兜底(机器人无入口主动发动)', async function(){
    window.__mingceCardCalls = [];
    pickMingceCard = function(idx, isEquip){ window.__mingceCardCalls.push([idx, isEquip]); };
    var g1 = mkSeatG({ myHand: [card('杀')] });
    g1.phase = 'mingcePickCard';
    g1.pending = { type: 'mingcePickCard', sourceSeat: 0 };
    await runBotDecision(g1, 0);
    if(window.__mingceCardCalls.length !== 1 || window.__mingceCardCalls[0][0] !== 0 || window.__mingceCardCalls[0][1] !== false)
      throw new Error('应调用 pickMingceCard(0,false),实际 ' + JSON.stringify(window.__mingceCardCalls));

    window.__mingceTargetCalls = [];
    pickMingceTarget = function(seat){ window.__mingceTargetCalls.push(seat); };
    var g2 = mkSeatG({});
    g2.phase = 'mingcePickTarget';
    g2.pending = { type: 'mingcePickTarget', sourceSeat: 0 };
    await runBotDecision(g2, 0);
    if(window.__mingceTargetCalls.length !== 1 || window.__mingceTargetCalls[0] !== 1)
      throw new Error('应调用 pickMingceTarget(1),实际 ' + JSON.stringify(window.__mingceTargetCalls));

    window.__mingceTarget2Calls = [];
    pickMingceTarget2 = function(seat){ window.__mingceTarget2Calls.push(seat); };
    var g3 = mkSeatG({});
    g3.phase = 'mingcePickTarget2';
    g3.pending = { type: 'mingcePickTarget2', sourceSeat: 0, candidates: [2, 1] };
    await runBotDecision(g3, 0);
    if(window.__mingceTarget2Calls.length !== 1 || window.__mingceTarget2Calls[0] !== 2)
      throw new Error('应调用 pickMingceTarget2(2),实际 ' + JSON.stringify(window.__mingceTarget2Calls));
  });

  await check('第二批-剩余:明策mingceChoice 有第二目标选sha,无第二目标选draw', async function(){
    window.__mingceOptionCalls = [];
    chooseMingceOption = function(opt){ window.__mingceOptionCalls.push(opt); };
    var g1 = mkSeatG({});
    g1.phase = 'mingceChoice';
    g1.pending = { type: 'mingceChoice', sourceSeat: 1, targetSeat: 0, target2Seat: 2 };
    await runBotDecision(g1, 0);
    if(window.__mingceOptionCalls.length !== 1 || window.__mingceOptionCalls[0] !== 'sha')
      throw new Error('有第二目标应选sha,实际 ' + JSON.stringify(window.__mingceOptionCalls));

    window.__mingceOptionCalls = [];
    var g2 = mkSeatG({});
    g2.phase = 'mingceChoice';
    g2.pending = { type: 'mingceChoice', sourceSeat: 1, targetSeat: 0, target2Seat: null };
    await runBotDecision(g2, 0);
    if(window.__mingceOptionCalls.length !== 1 || window.__mingceOptionCalls[0] !== 'draw')
      throw new Error('无第二目标应选draw,实际 ' + JSON.stringify(window.__mingceOptionCalls));
  });

  await check('第二批-剩余:趫猛qiaomengChoose/PickEquip 固定发动+选第一个装备槽', async function(){
    window.__qiaomengTriggerCalls = 0;
    triggerQiaomeng = function(){ window.__qiaomengTriggerCalls++; };
    var g1 = mkSeatG({});
    g1.phase = 'qiaomengChoose';
    g1.pending = { type: 'qiaomengChoose', sourceSeat: 0, targetSeat: 1, shaColor: 'black' };
    await runBotDecision(g1, 0);
    if(window.__qiaomengTriggerCalls !== 1)
      throw new Error('应调用 triggerQiaomeng 一次,实际 ' + window.__qiaomengTriggerCalls);

    window.__qiaomengEquipCalls = [];
    pickQiaomengEquip = function(slot){ window.__qiaomengEquipCalls.push(slot); };
    var g2 = mkSeatG({});
    g2.phase = 'qiaomengPickEquip';
    g2.pending = { type: 'qiaomengPickEquip', sourceSeat: 0, targetSeat: 1, availableSlots: ['armor','weapon'] };
    await runBotDecision(g2, 0);
    if(window.__qiaomengEquipCalls.length !== 1 || window.__qiaomengEquipCalls[0] !== 'armor')
      throw new Error('应调用 pickQiaomengEquip("armor"),实际 ' + JSON.stringify(window.__qiaomengEquipCalls));
  });

  await check('第二批-剩余:忘隙wangxiAsk 固定发动', async function(){
    window.__wangxiCalls = [];
    respondWangxi = function(activate){ window.__wangxiCalls.push(activate); };
    var g = mkSeatG({});
    g.phase = 'wangxiAsk';
    g.pending = { type: 'wangxiAsk', seat: 0, otherSeat: 1, death: false, amount: 1, resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(window.__wangxiCalls.length !== 1 || window.__wangxiCalls[0] !== true)
      throw new Error('应调用 respondWangxi(true),实际 ' + JSON.stringify(window.__wangxiCalls));
  });

  await check('第二批-剩余:耀武yaowu_choose 体力未满选recover,体力已满选draw', async function(){
    window.__yaowuCalls = [];
    respondYaowu = function(opt){ window.__yaowuCalls.push(opt); };
    var g1 = mkSeatG({ hpOf: { 0: 2 } });
    g1.phase = 'yaowu_choose';
    g1.pending = { type: 'yaowu_choose', seat: 0, target: 1, resume: { type: 'sha' } };
    await runBotDecision(g1, 0);
    if(window.__yaowuCalls.length !== 1 || window.__yaowuCalls[0] !== 'recover')
      throw new Error('体力未满应选recover,实际 ' + JSON.stringify(window.__yaowuCalls));

    window.__yaowuCalls = [];
    var g2 = mkSeatG({});
    g2.phase = 'yaowu_choose';
    g2.pending = { type: 'yaowu_choose', seat: 0, target: 1, resume: { type: 'sha' } };
    await runBotDecision(g2, 0);
    if(window.__yaowuCalls.length !== 1 || window.__yaowuCalls[0] !== 'draw')
      throw new Error('体力已满应选draw,实际 ' + JSON.stringify(window.__yaowuCalls));
  });

  await check('第二批-剩余:神速shensuSha 防御性兜底,固定选第一个存活非自己目标', async function(){
    window.__shensuCalls = [];
    respondShensuSha = function(seat){ window.__shensuCalls.push(seat); };
    var g = mkSeatG({});
    g.phase = 'shensuSha';
    g.pending = { type: 'shensuSha', seat: 0, remaining: 1, noDistance: true };
    await runBotDecision(g, 0);
    if(window.__shensuCalls.length !== 1 || window.__shensuCalls[0] !== 1)
      throw new Error('应调用 respondShensuSha(1),实际 ' + JSON.stringify(window.__shensuCalls));
  });

  await check('第二批-剩余:制蛮zhimengAsk 固定不发动(保留伤害),zhimengPick防御性选第一个候选', async function(){
    window.__zhimengAskCalls = [];
    respondZhimeng = function(activate){ window.__zhimengAskCalls.push(activate); };
    var g1 = mkSeatG({});
    g1.phase = 'zhimengAsk';
    g1.pending = { type: 'zhimengAsk', from: 0, to: 1, options: [{type:'hand',label:'手牌'}] };
    await runBotDecision(g1, 0);
    if(window.__zhimengAskCalls.length !== 1 || window.__zhimengAskCalls[0] !== false)
      throw new Error('应调用 respondZhimeng(false),实际 ' + JSON.stringify(window.__zhimengAskCalls));

    window.__zhimengPickCalls = [];
    respondZhimengPick = function(type, index){ window.__zhimengPickCalls.push([type, index]); };
    var g2 = mkSeatG({});
    g2.phase = 'zhimengPick';
    g2.pending = { type: 'zhimengPick', from: 0, to: 1, options: [{type:'weapon',index:undefined},{type:'hand',index:undefined}] };
    await runBotDecision(g2, 0);
    if(window.__zhimengPickCalls.length !== 1 || window.__zhimengPickCalls[0][0] !== 'weapon')
      throw new Error('应调用 respondZhimengPick("weapon",undefined),实际 ' + JSON.stringify(window.__zhimengPickCalls));
  });

  await check('第二批-剩余:左慈更改化身第二步 防御性兜底,选化身池第一个有技能的武将', async function(){
    window.__huashenPickStartCalls = [];
    respondHuashenChangePickStart = function(id, skill){ window.__huashenPickStartCalls.push([id, skill]); };
    var g1 = mkSeatG({});
    g1.players[0].huashenPool = ['guanyu'];
    g1.phase = 'huashenChangePickStart';
    g1.pending = { type: 'huashenChangePickStart', seat: 0 };
    await runBotDecision(g1, 0);
    if(window.__huashenPickStartCalls.length !== 1 || window.__huashenPickStartCalls[0][0] !== 'guanyu')
      throw new Error('应调用 respondHuashenChangePickStart("guanyu",...),实际 ' + JSON.stringify(window.__huashenPickStartCalls));

    window.__huashenPickEndCalls = [];
    respondHuashenChangePickEnd = function(id, skill){ window.__huashenPickEndCalls.push([id, skill]); };
    var g2 = mkSeatG({});
    g2.players[0].huashenPool = ['zhangfei'];
    g2.phase = 'huashenChangePickEnd';
    g2.pending = { type: 'huashenChangePickEnd', seat: 0 };
    await runBotDecision(g2, 0);
    if(window.__huashenPickEndCalls.length !== 1 || window.__huashenPickEndCalls[0][0] !== 'zhangfei')
      throw new Error('应调用 respondHuashenChangePickEnd("zhangfei",...),实际 ' + JSON.stringify(window.__huashenPickEndCalls));
  });

  await check('第二批-剩余:BOT_PHASE_ACTOR 全部新增phase登记核对', function(){
    var expect = {
      haoshiPick:'seat', tiaoxinDiscard:'from', biyue:'seat', buquAsk:'seat', renxinChoose:'seat',
      chengxiangAsk:'seat', luoyiAsk:'seat', jiemingAsk:'seat', xinshengAsk:'seat',
      jiushiFlipAsk:'seat', lianyingAsk:'seat',
      mingcePickCard:'sourceSeat', mingcePickTarget:'sourceSeat', mingcePickTarget2:'sourceSeat', mingceChoice:'targetSeat',
      qiaomengChoose:'sourceSeat', qiaomengPickEquip:'sourceSeat', wangxiAsk:'seat', yaowu_choose:'seat', shensuSha:'seat',
      zhimengAsk:'from', zhimengPick:'from', huashenChangePickStart:'seat', huashenChangePickEnd:'seat',
    };
    Object.keys(expect).forEach(function(k){
      if(BOT_PHASE_ACTOR[k] !== expect[k])
        throw new Error(k + ' 应登记为 ' + expect[k] + ',实际 ' + BOT_PHASE_ACTOR[k]);
    });
    if(BOT_PHASE_ACTOR.chengxiangChoose !== undefined)
      throw new Error('chengxiangChoose 不应登记(g.phase从不等于该值,登记了也是死代码),实际 ' + BOT_PHASE_ACTOR.chengxiangChoose);
  });

  // ================= 渲染层bug修复(luanjiChoose/luanjiConfirm)顺带补上的机器人分支 =================
  await check('渲染层bug修复:luanjiChoose 防御性兜底,固定选第一个可用牌对', async function(){
    window.__luanjiPickCalls = [];
    pickLuanjiPair = function(idx){ window.__luanjiPickCalls.push(idx); };
    var g = mkSeatG({});
    g.phase = 'luanjiChoose';
    g.pending = { type: 'luanjiChoose', sourceSeat: 0, availablePairs: [[0, 1], [2, 3]] };
    await runBotDecision(g, 0);
    if(window.__luanjiPickCalls.length !== 1 || window.__luanjiPickCalls[0] !== 0)
      throw new Error('应调用 pickLuanjiPair(0),实际 ' + JSON.stringify(window.__luanjiPickCalls));
  });

  await check('渲染层bug修复:luanjiConfirm 固定确认', async function(){
    window.__luanjiConfirmCalls = 0;
    confirmLuanji = function(){ window.__luanjiConfirmCalls++; };
    var g = mkSeatG({});
    g.phase = 'luanjiConfirm';
    g.pending = { type: 'luanjiConfirm', sourceSeat: 0, cardIndices: [0, 1] };
    await runBotDecision(g, 0);
    if(window.__luanjiConfirmCalls !== 1)
      throw new Error('应调用 confirmLuanji 一次,实际 ' + window.__luanjiConfirmCalls);
  });

  await check('渲染层bug修复:BOT_PHASE_ACTOR 已登记 luanjiChoose/luanjiConfirm', function(){
    if(BOT_PHASE_ACTOR.luanjiChoose !== 'sourceSeat')
      throw new Error('luanjiChoose 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.luanjiChoose);
    if(BOT_PHASE_ACTOR.luanjiConfirm !== 'sourceSeat')
      throw new Error('luanjiConfirm 应登记为 sourceSeat,实际 ' + BOT_PHASE_ACTOR.luanjiConfirm);
  });

  // ================= 渲染层bug修复(典韦【强袭】,和乱击同一批)顺带补上的机器人分支 =================
  await check('渲染层bug修复:强袭qiangxiChooseCost 有武器可弃时优先选weapon(保留体力)', async function(){
    window.__qiangxiCostCalls = [];
    chooseQiangxiCost = function(opt){ window.__qiangxiCostCalls.push(opt); };
    hasWeaponToDiscard = function(){ return true; };
    var g = mkSeatG({});
    g.phase = 'qiangxiChooseCost';
    g.pending = { type: 'qiangxiChooseCost', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__qiangxiCostCalls.length !== 1 || window.__qiangxiCostCalls[0] !== 'weapon')
      throw new Error('应调用 chooseQiangxiCost("weapon"),实际 ' + JSON.stringify(window.__qiangxiCostCalls));
  });

  await check('渲染层bug修复:强袭qiangxiChooseCost 无武器可弃时选hp', async function(){
    window.__qiangxiCostCalls = [];
    chooseQiangxiCost = function(opt){ window.__qiangxiCostCalls.push(opt); };
    hasWeaponToDiscard = function(){ return false; };
    var g = mkSeatG({ hpOf: { 0: 3 } });
    g.phase = 'qiangxiChooseCost';
    g.pending = { type: 'qiangxiChooseCost', seat: 0 };
    await runBotDecision(g, 0);
    if(window.__qiangxiCostCalls.length !== 1 || window.__qiangxiCostCalls[0] !== 'hp')
      throw new Error('应调用 chooseQiangxiCost("hp"),实际 ' + JSON.stringify(window.__qiangxiCostCalls));
  });

  await check('渲染层bug修复:强袭qiangxiChooseWeaponFromHand 固定选第一个武器下标', async function(){
    window.__qiangxiWeaponCalls = [];
    chooseQiangxiWeaponFromHand = function(idx){ window.__qiangxiWeaponCalls.push(idx); };
    var g = mkSeatG({});
    g.phase = 'qiangxiChooseWeaponFromHand';
    g.pending = { type: 'qiangxiChooseWeaponFromHand', seat: 0, weaponIndices: [2, 3] };
    await runBotDecision(g, 0);
    if(window.__qiangxiWeaponCalls.length !== 1 || window.__qiangxiWeaponCalls[0] !== 2)
      throw new Error('应调用 chooseQiangxiWeaponFromHand(2),实际 ' + JSON.stringify(window.__qiangxiWeaponCalls));
  });

  await check('渲染层bug修复:BOT_PHASE_ACTOR 已登记 qiangxiChooseCost/qiangxiChooseWeaponFromHand', function(){
    if(BOT_PHASE_ACTOR.qiangxiChooseCost !== 'seat')
      throw new Error('qiangxiChooseCost 应登记为 seat,实际 ' + BOT_PHASE_ACTOR.qiangxiChooseCost);
    if(BOT_PHASE_ACTOR.qiangxiChooseWeaponFromHand !== 'seat')
      throw new Error('qiangxiChooseWeaponFromHand 应登记为 seat,实际 ' + BOT_PHASE_ACTOR.qiangxiChooseWeaponFromHand);
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
  // ============ 【A2】断线重连状态回退验证(宿主侧) ============
  // 契约:botTwoStepA(bot.js)/aiSummary/aiSummarySeat/aiSummaryRound/aiSummaryTurn
  // (bot-ai-bus.js)全是模块级 let,浏览器刷新 → JS 全量重载 → 天然回初始值。
  // 全项目 grep 已确认 sessionStorage/localStorage 从不恢复这些状态:ai-bot.js 只存
  // sgsAiKey/sgsAiProvider/sgsAiPromptDismissed/sgsAiModel 四个密钥配置键(刷新后应
  // 保留),game.js 只存 sgsClientId(重连身份),botTwoStepA/aiSummary 无任何 storage
  // 读写。这里用"第二个全新沙箱=刷新后的新 JS 作用域"把这条契约钉死,防将来有人
  // 手滑给这些状态加 storage 恢复。
  console.log('\n' + '='.repeat(60));
  console.log('  A2 断线重连状态回退验证');
  console.log('='.repeat(60));
  try {
    // 1. 制造重连前的残留客户端态:决策中途(botTwoStepA 挂起)+ AI 跨回合记忆(aiSummary)
    vm.runInContext(
      'botTwoStepA = { decisionId: "jiedaoTwoStep", a: 1 };'
      + ' aiSummary = "残留摘要"; aiSummarySeat = 1; aiSummaryRound = 3; aiSummaryTurn = 2;',
      sandbox);
    // 2. "刷新页面" = 全新 vm 沙箱重载全部脚本(JS 作用域全新,storage 语义上保留但无恢复)
    const fresh = buildSandbox();
    loadAll(fresh);
    // 3. 断言模块级状态回到初始值,不残留
    const v = JSON.parse(vm.runInContext(
      'JSON.stringify([botTwoStepA, aiSummary, aiSummarySeat, aiSummaryRound, aiSummaryTurn])',
      fresh));
    if(v[0] !== null) throw new Error('重连后 botTwoStepA 应回退 null,实际 ' + JSON.stringify(v[0]));
    if(v[1] !== '') throw new Error('重连后 aiSummary 应为空字符串,实际 ' + JSON.stringify(v[1]));
    if(v[2] !== null || v[3] !== 0 || v[4] !== -1)
      throw new Error('重连后 aiSummarySeat/Round/Turn 应回初始值(null/0/-1),实际 ' + JSON.stringify(v.slice(2)));
    // 4. 重连后遇残留 pending 不报错:服务端 pending(如 jiedaoChoice)刷新后仍在 Firebase,
    //    客户端记忆(botTwoStepA)已丢,调度入口须照常解析行动者并走完决策(不卡死)
    const r = await vm.runInContext(
      'respondJiedao = function(){ window.__rjCalls = (window.__rjCalls||0) + 1; };'
      + '(async function(){'
      + '  var ps=[]; for(var i=0;i<3;i++){ ps.push({ name:"p"+i, alive:true, hp:4, maxHp:4,'
      + '    hand: i===0 ? [{id:"jd0",name:"杀",suit:"♠",rank:5}] : [], equips: emptyEquips(),'
      + '    delays: [], isBot: i===0, role:"zhu", general:"yuJi" }); }'
      + '  var g = { players: ps, gameMode:"ffa", roundNum:1, phase:"jiedaoChoice", turn:1,'
      + '    log: [], pending:{ type:"jiedaoChoice", seatA:0 }, started:true };'
      + '  try { await runBotDecision(g, 0); return "ok:" + (window.__rjCalls||0); }'
      + '  catch(e){ return "err:" + e.message; }'
      + '})()', fresh);
    if(typeof r !== 'string' || r.indexOf('ok:1') !== 0)
      throw new Error('重连后残留 pending(jiedaoChoice)应正常决策并提交 respondJiedao,实际 ' + JSON.stringify(r));
    console.log('  PASS A2重连:botTwoStepA/aiSummary 刷新即回初始值,残留 pending 不报错');
  } catch (e) {
    sandbox.__testFail = true;
    console.log('  FAIL A2重连: ' + (e && e.message || e));
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});
