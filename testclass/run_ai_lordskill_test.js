/**
 * B2a/B2b 主公技测试 — 服务端流程 + 守卫 + normalize + 机器人登记 + 超时保守表 + UI。
 * B2a:刘备【激将】/曹操【护驾】;B2b:孙策【制霸】/袁术【妄尊】。
 *
 * 加载真实完整链路(config/data/room-lifecycle/game/weapons/skills/bot-ai-bus/bot/
 * ai-bot/render/render-controls)进共享 vm 沙箱(与 run_identity_mode_test.js 同一套
 * firebase/document/window stub + _g 共享状态 + __setG/__setSeat 助手;tx 不跑 normalize,
 * 状态字段由测试构造时补全,normalize 防御单独直接调函数验证)。
 *
 * 覆盖:
 *  - 激将:主公刘备需出杀(决斗/南蛮 aoeResp)→ 求助流程;替出=视为完成响应;无人替=回原 pending
 *  - 护驾:主公曹操需出闪(杀响应/万箭 aoeResp)→ 同理
 *  - 守卫:非主公(role zhong)/非身份局/已用(jijiangUsed)/无其它存活/铁骑判红(noShan)均不触发
 *  - normalize:jijiangUsed/hujiaUsed 缺省/非布尔回退 false;startTurn 重置
 *  - 机器人:BOT_PHASE_ACTOR 登记 asking、BOT_DECISIONS 注册、无密钥回退、runBotDecision 接线、
 *    CONTROLS_CHOICE_EXCLUDE 收录、A1 超时保守动作表
 *  - UI:renderControls 渲染「替主公打出【X】」「不出」按钮,点击走对应服务端函数
 *
 * 无密钥零变化:ffa/非主公路径行为与改动前一致(直接受伤/认输,不进入求助)。
 */

const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  return Promise.resolve().then(fn).then(function(){
    console.log('  PASS ' + name); passed++;
  }, function(e){
    console.log('  FAIL ' + name + ' - ' + ((e && e.message) || e)); failed++;
  });
}

function makeEl(){
  return {
    src:'', href:'', rel:'', type:'', textContent:'', innerHTML:'',
    onclick:null, onerror:null, onload:null, className:'', id:'', disabled:false,
    style:{}, dataset:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){},
    appendChild(el){ if(!this.children) this.children = []; this.children.push(el); return el; },
    remove(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }
  };
}
// 供 UI 测试:把 #controls 元素换成本地可追踪对象,renderControls 追加的按钮全部落在 children
let __controlsEl = null;
let __handEl = null;

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(fn){ const r = fn(function(){}); if(typeof r === 'function') r(); return {}; },
      set(){}, update(){}, child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; }
    }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(id){
      if(id === 'controls' && __controlsEl) return __controlsEl;
      if(id === 'hand' && __handEl) return __handEl;
      return makeEl();
    },
    createElement(tag){
      const el=makeEl();
      if(tag==='canvas') el.getContext=()=>({ font:'', measureText(text){ return {width:String(text||'').length*16}; } });
      return el;
    },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){ return {}; } }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} },
    addEventListener(){}, removeEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    addEventListener(){}, removeEventListener(){},
    setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;

const sandbox = vm.createContext(context);
const files = ['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js', 'skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js','render-hand.js','render-controls.js'];
console.log('Loading B2a 主公技测试环境...\n');
files.forEach(f=>{
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
    if(f === 'game.js'){
      // 真实 tx:对共享 _g 做 transaction(与 run_identity_mode_test.js 同款)
      vm.runInContext(`
        var _g = null;
        tx = function(fn){
          if(!_g) return;
          const r = fn(_g);
          return r === undefined ? _g : r;
        };
        gameRef = { transaction: function(fn){ return tx(fn); } };
        mySeat = 0;
      `, sandbox);
    }
    console.log('  OK ' + f);
  } catch(e){
    console.log('  FAIL ' + f + ': ' + e.message);
    if(e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

// 暴露测试用 setter
vm.runInContext(`
  function __setG(g){ _g = g; }
  function __getG(){ return _g; }
  function __setSeat(s){ mySeat = s; }
`, sandbox);

function R(code){ return vm.runInContext(code, sandbox); }
function setG(g){ R('__setG(' + JSON.stringify(g) + ')'); return g; }
function getG(){ return R('__getG()'); }
function seat(s){ R('__setSeat(' + s + ')'); }

// 构造 3 人身份局:座位0=主公(武将自定),座位1/2=其他角色。默认主公 role='zhu',
// 其余 zhong;gameMode 默认 identity。字段补全到服务端路径不依赖 normalize。
function mkG(opt){
  opt = opt || {};
  // 默认身份配比 zhu(座位0) + fan(座位1) + zhong(座位2):保证身份局 checkWin 在
  // 非致命伤害后不提前结束(反贼存活)。覆盖用 opt.roles 逐座指定。
  const players = [0,1,2].map(function(i){
    return {
      name: i === 0 ? '主公' : ('角色' + i),
      alive: (opt.aliveOf ? opt.aliveOf[i] !== false : true),
      hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4,
      maxHp: 4,
      hand: (opt.hands ? (opt.hands[i] || []) : []),
      equips: { weapon:null, armor:null, plus1:null, minus1:null },
      delays: [],
      isBot: (opt.botOf ? opt.botOf[i] : false),
      role: (opt.roles ? opt.roles[i] : (i === 0 ? 'zhu' : (i === 1 ? 'fan' : 'zhong'))),
      general: (opt.generals && opt.generals[i]) || (i>0 && opt.helperFaction==='shu' ? 'zhaoyun' : (i>0 && opt.helperFaction==='wei' ? 'xiahoudun' : 'yuji'))
    };
  });
  const g = {
    players: players, gameMode: opt.mode || 'identity',
    roundNum: 1, phase: opt.phase || 'duel', turn: (typeof opt.turn==='number' ? opt.turn : 1),
    log: [], deck: [], discard: [], exchangeCards: [],
    pending: opt.pending || null, started: true
  };
  if(opt.jijiangUsed) g.jijiangUsed = true;
  if(opt.hujiaUsed) g.hujiaUsed = true;
  if(opt.zhibaUsed) g.zhibaUsed = true;
  if(opt.lordHandCap) g.lordHandCap = opt.lordHandCap;
  if(opt.aoe) g.aoe = opt.aoe;
  return g;
}
const S = { id:'s1', name:'杀', suit:'♠', rank:5 };
const SH = { id:'f1', name:'闪', suit:'♥', rank:5 };
const DUEL = { type:'duel', from:1, to:0, active:0 };
const AOESHA = { type:'aoeResp', from:1, to:0, need:'杀' };
const AOESHAN = { type:'aoeResp', from:1, to:0, need:'闪' };
const NANMAN = { from:1, need:'杀', trick:'南蛮入侵' };
const WANJIAN = { from:1, need:'闪', trick:'万箭齐发' };

(async function(){
  console.log('\n' + '='.repeat(60));
  console.log('  B2a 主公技(激将/护驾)');
  console.log('='.repeat(60) + '\n');

  // ===== A. 激将 =====

  await check('A1 激将触发:主公刘备决斗不出杀 → jijiangAsk,used置真,从下家问起', function(){
    const g = mkG({ phase:'duel', pending: DUEL, generals:{0:'liubei'}, helperFaction:'shu' });
    setG(g); seat(0);
    R('duelResponse(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'jijiangAsk');
    assert.strictEqual(gg.pending.type, 'jijiangAsk');
    assert.strictEqual(gg.pending.lordSeat, 0);
    assert.strictEqual(gg.pending.asking, 1);
    assert.strictEqual(gg.pending.need, '杀');
    assert.strictEqual(gg.jijiangUsed, true);
    assert.strictEqual(gg.pending.resume.phase, 'duel');
    assert.ok(gg.log.some(function(e){ return e.text.indexOf('激将') >= 0; }));
  });

  await check('A2 激将响应:被求助者替出杀 → 视为完成杀响应(决斗义务换给对手)', function(){
    const g = mkG({ phase:'duel', pending: DUEL, generals:{0:'liubei'}, helperFaction:'shu', hands:{1:[S]} });
    setG(g); seat(0);
    R('duelResponse(false)');
    seat(1);
    R('respondJijiangAsk(true)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'duel');
    assert.strictEqual(gg.pending.type, 'duel');
    assert.strictEqual(gg.pending.active, 1); // 杀由主公"打出",义务换给对手
    assert.strictEqual(gg.players[1].hand.length, 0); // 杀已打出
    assert.ok(gg.discard.some(function(c){ return c.id === 's1'; }));
    assert.ok(gg.log.some(function(e){ return e.text.indexOf('激将') >= 0; }));
  });

  await check('A3 激将无人替:不出→问下家;问完一圈→回原 pending 继续主公正常响应', function(){
    const g = mkG({ phase:'duel', pending: DUEL, generals:{0:'liubei'}, helperFaction:'shu' });
    setG(g); seat(0);
    R('duelResponse(false)');
    seat(1); R('respondJijiangAsk(false)');
    let gg = getG();
    assert.strictEqual(gg.pending.asking, 2);
    seat(2); R('respondJijiangAsk(false)');
    gg = getG();
    assert.strictEqual(gg.phase, 'duel');
    assert.strictEqual(gg.pending.type, 'duel');
    assert.strictEqual(gg.pending.active, 0); // 主公回到正常响应
    assert.strictEqual(gg.jijiangUsed, true); // 已用过,不能再触发
    // 主公再点不出 → used 已真 → 直接认输受伤
    seat(0); R('duelResponse(false)');
    gg = getG();
    assert.strictEqual(gg.players[0].hp, 3);
    assert.strictEqual(gg.phase, 'play');
  });

  await check('A4 激将南蛮:aoeResp 不出杀 → 求助;替出 → AOE 结算推进(主公末位→结束)', function(){
    const g = mkG({ phase:'aoeResp', pending: AOESHA, aoe: NANMAN, generals:{0:'liubei'}, helperFaction:'shu', hands:{1:[S]} });
    setG(g); seat(0);
    R('aoeRespond(false)');
    let gg = getG();
    assert.strictEqual(gg.phase, 'jijiangAsk');
    seat(1); R('respondJijiangAsk(true)');
    gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.pending, null);
    assert.strictEqual(gg.aoe, null);
    assert.strictEqual(gg.players[0].hp, 4); // 没受伤
  });

  await check('A5 激将南蛮无人替 → 回原 aoeResp pending', function(){
    const g = mkG({ phase:'aoeResp', pending: AOESHA, aoe: NANMAN, generals:{0:'liubei'}, helperFaction:'shu' });
    setG(g); seat(0);
    R('aoeRespond(false)');
    seat(1); R('respondJijiangAsk(false)');
    seat(2); R('respondJijiangAsk(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'aoeResp');
    assert.strictEqual(gg.pending.to, 0);
    assert.strictEqual(gg.pending.need, '杀');
  });

  // ===== B. 护驾 =====

  await check('B1 护驾触发:主公曹操被杀不出闪 → hujiaAsk', function(){
    const g = mkG({ phase:'respond', pending:{from:1, to:0}, generals:{0:'caocao'}, helperFaction:'wei' });
    setG(g); seat(0);
    R('respondShan(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'hujiaAsk');
    assert.strictEqual(gg.pending.type, 'hujiaAsk');
    assert.strictEqual(gg.pending.asking, 1);
    assert.strictEqual(gg.pending.need, '闪');
    assert.strictEqual(gg.hujiaUsed, true);
  });

  await check('B2 护驾响应:替出闪 → 杀被抵消,主公不受伤,回 play', function(){
    const g = mkG({ phase:'respond', pending:{from:1, to:0}, generals:{0:'caocao'}, helperFaction:'wei', hands:{1:[SH]} });
    setG(g); seat(0);
    R('respondShan(false)');
    seat(1); R('respondHujiaAsk(true)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.pending, null);
    assert.strictEqual(gg.players[0].hp, 4);
    assert.strictEqual(gg.players[1].hand.length, 0);
  });

  await check('B3 护驾无人替 → 回原 respond pending', function(){
    const g = mkG({ phase:'respond', pending:{from:1, to:0}, generals:{0:'caocao'}, helperFaction:'wei' });
    setG(g); seat(0);
    R('respondShan(false)');
    seat(1); R('respondHujiaAsk(false)');
    seat(2); R('respondHujiaAsk(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'respond');
    assert.strictEqual(gg.pending.from, 1);
    assert.strictEqual(gg.pending.to, 0);
  });

  await check('B4 护驾万箭:替出闪 → AOE 结算推进(主公末位→结束)', function(){
    const g = mkG({ phase:'aoeResp', pending: AOESHAN, aoe: WANJIAN, generals:{0:'caocao'}, helperFaction:'wei', hands:{1:[SH]} });
    setG(g); seat(0);
    R('aoeRespond(false)');
    let gg = getG();
    assert.strictEqual(gg.phase, 'hujiaAsk');
    seat(1); R('respondHujiaAsk(true)');
    gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.pending, null);
    assert.strictEqual(gg.aoe, null);
  });

  // ===== C. 守卫 =====

  await check('C1 守卫:非主公(role zhong)拥有激将不可发动,直接认输受伤', function(){
    // 刘备坐 0 号但身份是忠臣;真正的主公在 1 号,反贼在 2 号(保证 checkWin 不提前结束)
    const g = mkG({ phase:'duel', pending:{type:'duel', from:2, to:0, active:0},
      generals:{0:'liubei', 1:'caocao'}, roles:{0:'zhong', 1:'zhu', 2:'fan'} });
    setG(g); seat(0);
    R('duelResponse(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
    assert.ok(!gg.pending || gg.pending.type !== 'jijiangAsk');
  });

  await check('C2 守卫:非身份局(ffa)即使 role=zhu 也不触发', function(){
    const g = mkG({ mode:'ffa', phase:'duel', pending: DUEL, generals:{0:'liubei'} });
    setG(g); seat(0);
    R('duelResponse(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
  });

  await check('C3 守卫:jijiangUsed 已真不再触发', function(){
    const g = mkG({ phase:'duel', pending: DUEL, generals:{0:'liubei'}, jijiangUsed:true });
    setG(g); seat(0);
    R('duelResponse(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
  });

  await check('C4 守卫:铁骑判红(noShan)不触发护驾,直接受伤', function(){
    const g = mkG({ phase:'respond', pending:{from:1, to:0, noShan:true}, generals:{0:'caocao'} });
    setG(g); seat(0);
    R('respondShan(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
    assert.ok(!gg.pending);
  });

  await check('C5 守卫:场上无其它存活角色不触发(唯一存活 → 直接结算胜负)', function(){
    const g = mkG({ phase:'duel', pending: DUEL, generals:{0:'liubei'}, aliveOf:{1:false, 2:false} });
    setG(g); seat(0);
    R('duelResponse(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'over'); // 仅剩主公 → 身份局胜负结算
    assert.strictEqual(gg.players[0].hp, 3);
    assert.ok(!gg.pending || gg.pending.type !== 'jijiangAsk');
  });

  // ===== D. normalize / startTurn =====

  await check('D1 normalize:jijiangUsed/hujiaUsed 缺省/非布尔回退 false,true 保留', function(){
    const g1 = R('normalize({players:[], log:[], deck:[], discard:[]})');
    assert.strictEqual(g1.jijiangUsed, false);
    assert.strictEqual(g1.hujiaUsed, false);
    const g2 = R('normalize({players:[], log:[], deck:[], discard:[], jijiangUsed:"yes", hujiaUsed:1})');
    assert.strictEqual(g2.jijiangUsed, false);
    assert.strictEqual(g2.hujiaUsed, false);
    const g3 = R('normalize({players:[], log:[], deck:[], discard:[], jijiangUsed:true, hujiaUsed:true})');
    assert.strictEqual(g3.jijiangUsed, true);
    assert.strictEqual(g3.hujiaUsed, true);
  });

  await check('D2 normalize:jijiangAsk/hujiaAsk pending 结构非法 → 整体判无效', function(){
    const bad = R('normalize({players:[{name:"a",alive:true},{name:"b",alive:true},{name:"c",alive:true}], log:[], deck:[], discard:[], phase:"jijiangAsk", pending:{type:"jijiangAsk", lordSeat:"x"}})');
    assert.strictEqual(bad.pending, null);
    assert.strictEqual(bad.phase, 'play');
    const good = R('normalize({players:[{name:"a",alive:true},{name:"b",alive:true},{name:"c",alive:true}], log:[], deck:[], discard:[], phase:"jijiangAsk", pending:{type:"jijiangAsk", lordSeat:0, asking:1, need:"杀", resume:{phase:"duel", pending:{type:"duel"}}}})');
    assert.ok(good.pending && good.pending.type === 'jijiangAsk');
    const active = R('normalize({players:[{name:"a",alive:true},{name:"b",alive:true},{name:"c",alive:true}], log:[], deck:[], discard:[], phase:"jijiangAsk", pending:{type:"jijiangAsk", lordSeat:0, asking:1, need:"杀", resume:{phase:"play", pending:null}}})');
    assert.ok(active.pending && active.pending.type === 'jijiangAsk','主动激将的 resume.pending=null 必须保留');
  });

  await check('D3 startTurn 重置 jijiangUsed/hujiaUsed', function(){
    const g = mkG({ phase:'play', generals:{0:'liubei'} });
    g.jijiangUsed = true; g.hujiaUsed = true;
    setG(g);
    R('startTurn(_g, 0)');
    const gg = getG();
    assert.strictEqual(gg.jijiangUsed, false);
    assert.strictEqual(gg.hujiaUsed, false);
  });

  // ===== E. 机器人 =====

  await check('E1 BOT_PHASE_ACTOR 登记 jijiangAsk/hujiaAsk=asking', function(){
    assert.strictEqual(R('stageActorField("jijiangAsk")'), 'asking');
    assert.strictEqual(R('stageActorField("hujiaAsk")'), 'asking');
  });

  await check('E2 BOT_DECISIONS.jijiangAsk/hujiaAsk 注册形状完整', function(){
    const s = R('BOT_DECISIONS.jijiangAsk');
    assert.ok(s && typeof s.match === 'function' && typeof s.buildCandidates === 'function'
      && typeof s.localFallback === 'function' && typeof s.execute === 'function');
    const h = R('BOT_DECISIONS.hujiaAsk');
    assert.ok(h && typeof h.match === 'function' && typeof h.buildCandidates === 'function'
      && typeof h.localFallback === 'function' && typeof h.execute === 'function');
  });

  await check('E3 botDecide jijiangAsk 无密钥:有杀→替出;无杀→不出', async function(){
    R('aiApiKey = ""; aiProvider = null;');
    R('window.__jjCalls = []; respondJijiangAsk = function(useCard, cardIdx){ window.__jjCalls.push([useCard, cardIdx]); };');
    const g1 = mkG({ phase:'jijiangAsk', pending:{type:'jijiangAsk', lordSeat:0, need:'杀', asking:1, resume:{phase:'duel', pending:{}}}, generals:{0:'liubei'}, hands:{1:[S]} });
    setG(g1);
    const r1 = await R('(async function(){ return await botDecide("jijiangAsk", _g, 1); })()');
    assert.strictEqual(r1, true);
    assert.strictEqual(R('window.__jjCalls').length, 1);
    assert.strictEqual(R('window.__jjCalls')[0][0], true);
    R('window.__jjCalls = [];');
    const g2 = mkG({ phase:'jijiangAsk', pending:{type:'jijiangAsk', lordSeat:0, need:'杀', asking:1, resume:{phase:'duel', pending:{}}}, generals:{0:'liubei'} });
    setG(g2);
    await R('(async function(){ return await botDecide("jijiangAsk", _g, 1); })()');
    assert.strictEqual(R('window.__jjCalls').length, 1);
    assert.strictEqual(R('window.__jjCalls')[0][0], false);
  });

  await check('E4 botDecide hujiaAsk 无密钥:有闪→替出;无闪→不出', async function(){
    R('aiApiKey = ""; aiProvider = null;');
    R('window.__hjCalls = []; respondHujiaAsk = function(useCard, cardIdx){ window.__hjCalls.push([useCard, cardIdx]); };');
    const g1 = mkG({ phase:'hujiaAsk', pending:{type:'hujiaAsk', lordSeat:0, need:'闪', asking:1, resume:{phase:'respond', pending:{}}}, generals:{0:'caocao'}, hands:{1:[SH]} });
    setG(g1);
    await R('(async function(){ return await botDecide("hujiaAsk", _g, 1); })()');
    assert.strictEqual(R('window.__hjCalls')[0][0], true);
    R('window.__hjCalls = [];');
    const g2 = mkG({ phase:'hujiaAsk', pending:{type:'hujiaAsk', lordSeat:0, need:'闪', asking:1, resume:{phase:'respond', pending:{}}}, generals:{0:'caocao'} });
    setG(g2);
    await R('(async function(){ return await botDecide("hujiaAsk", _g, 1); })()');
    assert.strictEqual(R('window.__hjCalls')[0][0], false);
  });

  await check('E5 runBotDecision 接线:jijiangAsk 阶段命中即走专用决策提交替出', async function(){
    R('aiApiKey = ""; aiProvider = null;');
    R('window.__jjCalls = []; respondJijiangAsk = function(useCard, cardIdx){ window.__jjCalls.push([useCard, cardIdx]); };');
    const g = mkG({ phase:'jijiangAsk', pending:{type:'jijiangAsk', lordSeat:0, need:'杀', asking:0, resume:{phase:'duel', pending:{}}}, generals:{0:'liubei'}, botOf:{0:true}, hands:{0:[S]} });
    setG(g);
    await R('(async function(){ await runBotDecision(_g, 0); return true; })()');
    const calls = R('window.__jjCalls');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], true);
  });

  await check('E6 CONTROLS_CHOICE_EXCLUDE 收录 jijiangAsk/hujiaAsk(防 L1 双重接管)', function(){
    assert.strictEqual(R('CONTROLS_CHOICE_EXCLUDE.has("jijiangAsk")'), true);
    assert.strictEqual(R('CONTROLS_CHOICE_EXCLUDE.has("hujiaAsk")'), true);
  });

  await check('E7 A1 超时保守动作表:jijiangAsk/hujiaAsk → 对应响应函数(不出)', function(){
    R('window.__jjCalls = []; respondJijiangAsk = function(useCard, cardIdx){ window.__jjCalls.push([useCard, cardIdx]); };');
    R('window.__hjCalls = []; respondHujiaAsk = function(useCard, cardIdx){ window.__hjCalls.push([useCard, cardIdx]); };');
    const a1 = R('autoRespondAction({phase:"jijiangAsk", pending:{type:"jijiangAsk", askedAt:1}})');
    assert.ok(a1, 'jijiangAsk 应有保守动作');
    a1();
    const a2 = R('autoRespondAction({phase:"hujiaAsk", pending:{type:"hujiaAsk", askedAt:1}})');
    assert.ok(a2, 'hujiaAsk 应有保守动作');
    a2();
    assert.strictEqual(R('window.__jjCalls').length, 1);
    assert.strictEqual(R('window.__jjCalls')[0][0], false);
    assert.strictEqual(R('window.__hjCalls').length, 1);
    assert.strictEqual(R('window.__hjCalls')[0][0], false);
  });

  // ===== F. 无密钥零变化 =====

  await check('F1 无密钥零变化:ffa 主公曹操被杀不出闪 → 直接受伤(无 hujiaAsk)', function(){
    const g = mkG({ mode:'ffa', phase:'respond', pending:{from:1, to:0}, generals:{0:'caocao'} });
    setG(g); seat(0);
    R('respondShan(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
    assert.ok(!gg.pending);
  });

  await check('F2 无密钥零变化:非主公刘备(role zhong)被杀不出闪 → 直接受伤', function(){
    const g = mkG({ phase:'respond', pending:{from:2, to:0},
      generals:{0:'liubei', 1:'caocao'}, roles:{0:'zhong', 1:'zhu', 2:'fan'} });
    setG(g); seat(0);
    R('respondShan(false)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.players[0].hp, 3);
  });

  // ===== G. UI =====

  await check('G1 UI:jijiangAsk 渲染「替主公打出【杀】」「不出」按钮,点击走 respondJijiangAsk', function(){
    R('window.__jjCalls = []; respondJijiangAsk = function(useCard, cardIdx){ window.__jjCalls.push([useCard, cardIdx]); };');
    const g = mkG({ phase:'jijiangAsk', pending:{type:'jijiangAsk', lordSeat:0, need:'杀', asking:1, resume:{phase:'duel', pending:{}}}, generals:{0:'liubei'}, hands:{1:[S]} });
    setG(g); seat(1);
    __controlsEl = makeEl();
    context.window.__controlsEl = __controlsEl;
    R('renderControls(_g)');
    const labels = R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.indexOf('替主公打出【杀】') >= 0, '应有替出按钮,实际 ' + JSON.stringify(labels));
    assert.ok(labels.indexOf('不出') >= 0, '应有不出按钮,实际 ' + JSON.stringify(labels));
    R('(function(){ var kids = window.__controlsEl.children; for(var i=0;i<kids.length;i++){ if(kids[i].textContent === "不出"){ kids[i].onclick(); return; } } })()');
    const calls = R('window.__jjCalls');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], false);
  });

  await check('G2 UI:hujiaAsk 渲染「替主公打出【闪】」按钮,点击走 respondHujiaAsk(true)', function(){
    R('window.__hjCalls = []; respondHujiaAsk = function(useCard, cardIdx){ window.__hjCalls.push([useCard, cardIdx]); };');
    const g = mkG({ phase:'hujiaAsk', pending:{type:'hujiaAsk', lordSeat:0, need:'闪', asking:1, resume:{phase:'respond', pending:{}}}, generals:{0:'caocao'}, hands:{1:[SH]} });
    setG(g); seat(1);
    __controlsEl = makeEl();
    context.window.__controlsEl = __controlsEl;
    R('renderControls(_g)');
    const labels = R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.indexOf('替主公打出【闪】') >= 0, '应有替出按钮,实际 ' + JSON.stringify(labels));
    R('(function(){ var kids = window.__controlsEl.children; for(var i=0;i<kids.length;i++){ if(kids[i].textContent.indexOf("替主公") >= 0){ kids[i].onclick(); return; } } })()');
    const calls = R('window.__hjCalls');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], true);
  });

  // ===== H. 制霸(其他吴势力角色向主公孙策发起拼点) =====

  await check('H1 制霸触发:吴势力角色play出牌 → 请求主公孙策拼点', function(){
    const g = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'},
      hands:{0:[S], 1:[{id:'f2',name:'闪',suit:'♥',rank:9}]} });
    setG(g); seat(1);
    R('startZhiba(0)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'zhibaAsk');
    assert.strictEqual(gg.pending.type, 'zhibaAsk');
    assert.strictEqual(gg.pending.lordSeat, 0);
    assert.strictEqual(gg.pending.challengerSeat, 1);
    assert.strictEqual(gg.pending.challengerCard.id, 'f2');
    assert.strictEqual(gg.zhibaUsed, true);
    assert.strictEqual(gg.players[1].hand.length, 0);
    assert.ok(gg.log.some(function(e){ return e.text.indexOf('制霸') >= 0; }));
  });

  await check('H2 制霸响应:吴将没赢 → 主公获得双方拼点牌', function(){
    const challenger={id:'f2',name:'闪',suit:'♥',rank:3};
    const g = mkG({ phase:'zhibaAsk', turn:1, generals:{0:'sunce',1:'lvmeng'},
      pending:{type:'zhibaAsk', lordSeat:0, challengerSeat:1, challengerCard:challenger, resume:{phase:'play', pending:null}},
      hands:{0:[S]} });
    setG(g); seat(0);
    R('respondZhiba(0)');
    assert.strictEqual(getG().phase,'zhibaGain');
    R('respondZhibaGain(true)');
    const gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.strictEqual(gg.pending, null);
    assert.strictEqual(gg.players[0].hand.length, 2);
    assert.ok(gg.players[0].hand.some(function(c){ return c.id === 'f2'; }));
    assert.ok(gg.log.some(function(e){ return e.text.indexOf('拼点') >= 0; }));
  });

  await check('H3 守卫:已使用/非吴势力/ffa 不触发', function(){
    const g1 = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{0:[S],1:[SH]}, zhibaUsed:true });
    setG(g1); seat(1); R('startZhiba(0)');
    let gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.ok(!gg.pending);
    const g2 = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'caocao'}, hands:{0:[S],1:[SH]} });
    setG(g2); seat(1); R('startZhiba(0)');
    gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.ok(!gg.pending);
    const g3 = mkG({ mode:'ffa', phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{0:[S],1:[SH]} });
    setG(g3); seat(1); R('startZhiba(0)');
    gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.ok(!gg.pending);
  });

  await check('H4 守卫:主公无手牌 / 吴将无手牌不可发动', function(){
    const g1 = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{1:[SH]} });
    setG(g1); seat(1); R('startZhiba(0)');
    let gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.ok(!gg.pending);
    const g2 = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{0:[S]} });
    setG(g2); seat(1); R('startZhiba(0)');
    gg = getG();
    assert.strictEqual(gg.phase, 'play');
    assert.ok(!gg.pending);
  });

  await check('H5 normalize:zhibaUsed/lordHandCap 防御 + zhibaAsk 结构校验;startTurn 重置', function(){
    const g1 = R('normalize({players:[], log:[], deck:[], discard:[]})');
    assert.strictEqual(g1.zhibaUsed, false);
    assert.strictEqual(g1.lordHandCap, 0);
    const g1b = R('normalize({players:[], log:[], deck:[], discard:[], zhibaUsed:"x", lordHandCap:"y"})');
    assert.strictEqual(g1b.zhibaUsed, false);
    assert.strictEqual(g1b.lordHandCap, 0);
    const bad = R('normalize({players:[{name:"a",alive:true},{name:"b",alive:true},{name:"c",alive:true}], log:[], deck:[], discard:[], phase:"zhibaAsk", pending:{type:"zhibaAsk", lordSeat:"x", challengerSeat:1}})');
    assert.strictEqual(bad.pending, null);
    assert.strictEqual(bad.phase, 'play');
    const good = R('normalize({gameMode:"identity",players:[{name:"a",general:"sunce",role:"zhu",caps:{zhiba:true},alive:true},{name:"b",general:"zhouyu",alive:true},{name:"c",alive:true}], log:[], deck:[], discard:[], phase:"zhibaAsk", pending:{type:"zhibaAsk", lordSeat:0, challengerSeat:1, challengerCard:{id:"s1"}, resume:{phase:"play", pending:null}}})');
    assert.ok(good.pending && good.pending.type === 'zhibaAsk');
    const g2 = mkG({ phase:'play', turn:0, generals:{0:'sunce'} });
    g2.zhibaUsed = true; g2.lordHandCap = 1;
    setG(g2);
    R('startTurn(_g, 0)');
    const gg = getG();
    assert.strictEqual(gg.zhibaUsed, false);
    assert.strictEqual(gg.lordHandCap, 0);
  });

  // ===== I. 妄尊(袁术,主公准备阶段) =====

  await check('I1 妄尊:主公(role zhu)startTurn 且有存活袁术 → 袁术摸一张、lordHandCap=1', function(){
    const g = mkG({ phase:'play', turn:0, generals:{0:'caocao',1:'yuanshu'}, hands:{1:[S]} });
    g.deck = [{id:'d1',name:'无中生有',suit:'♥',rank:7}];
    setG(g);
    R('startTurn(_g, 0)');
    const gg = getG();
    assert.strictEqual(gg.lordHandCap, 1);
    assert.strictEqual(gg.players[1].hand.length, 2);
    assert.strictEqual(gg.players[1].hand[1].id, 'd1');
    assert.ok(gg.log.some(function(e){ return e.text.indexOf('妄尊') >= 0; }));
  });

  await check('I2 妄尊:主公弃牌阶段手牌上限 = hp-1(discardCard/discardCards/endTurn 三处生效)', function(){
    // 主公 hp=4,手牌5,上限3 → 需弃2张
    const g = mkG({ phase:'discard', turn:0, generals:{0:'caocao',1:'yuanshu'},
      hands:{0:[S,SH,{id:'t1',name:'桃',suit:'♥',rank:3},{id:'w1',name:'无中生有',suit:'♥',rank:7},{id:'e1',name:'决斗',suit:'♠',rank:2}]} });
    g.lordHandCap = 1;
    setG(g); seat(0);
    R('endTurn()'); // 手牌5 > 上限3 → 拒绝结束
    let gg = getG();
    assert.strictEqual(gg.phase, 'discard');
    R('discardCard(0)'); // 弃1张 → 4 仍 > 3
    gg = getG();
    assert.strictEqual(gg.phase, 'discard');
    assert.strictEqual(gg.players[0].hand.length, 4);
    R('discardCards([0,1])'); // 弃2张 → 2 <= 3
    gg = getG();
    assert.strictEqual(gg.players[0].hand.length, 2);
    R('endTurn()'); // 不再超上限 → 正常结束
    gg = getG();
    assert.notStrictEqual(gg.phase, 'discard');
  });

  await check('I3 守卫:ffa / 当前回合玩家非主公 / 袁术死亡 → 妄尊不触发', function(){
    const g1 = mkG({ mode:'ffa', phase:'play', turn:0, generals:{0:'caocao',1:'yuanshu'}, hands:{1:[S]} });
    g1.deck = [{id:'d1',name:'无中生有',suit:'♥',rank:7}];
    setG(g1);
    R('startTurn(_g, 0)');
    let gg = getG();
    assert.strictEqual(gg.lordHandCap, 0); // startTurn 重置为 0,妄尊未触发
    assert.strictEqual(gg.players[1].hand.length, 1);
    // 非主公的回合(袁术自己是回合玩家,不能对自己触发妄尊)
    const g2 = mkG({ phase:'play', turn:1, generals:{0:'caocao',1:'yuanshu'}, hands:{1:[S]} });
    g2.deck = [{id:'d1',name:'无中生有',suit:'♥',rank:7}];
    setG(g2);
    R('startTurn(_g, 1)');
    gg = getG();
    assert.strictEqual(gg.lordHandCap, 0);
    assert.strictEqual(gg.players[1].hand.length, 1);
    // 袁术死亡
    const g3 = mkG({ phase:'play', turn:0, generals:{0:'caocao',1:'yuanshu'}, hands:{1:[S]}, aliveOf:{1:false} });
    g3.deck = [{id:'d1',name:'无中生有',suit:'♥',rank:7}];
    setG(g3);
    R('startTurn(_g, 0)');
    gg = getG();
    assert.strictEqual(gg.lordHandCap, 0);
  });

  // ===== J. 机器人 =====

  await check('J1 BOT_PHASE_ACTOR 登记 zhibaAsk=lordSeat', function(){
    assert.strictEqual(R('stageActorField("zhibaAsk")'), 'lordSeat');
  });

  await check('J2 BOT_DECISIONS.zhibaAsk 注册形状完整;botDecide 无密钥选点数最大的手牌', async function(){
    const s = R('BOT_DECISIONS.zhibaAsk');
    assert.ok(s && typeof s.match === 'function' && typeof s.buildCandidates === 'function'
      && typeof s.localFallback === 'function' && typeof s.execute === 'function');
    R('aiApiKey = ""; aiProvider = null;');
    R('window.__zbCalls = []; respondZhiba = function(cardIdx){ window.__zbCalls.push(cardIdx); };');
    const g = mkG({ phase:'zhibaAsk', turn:1, generals:{0:'sunce',1:'lvmeng'},
      pending:{type:'zhibaAsk', lordSeat:0, challengerSeat:1, challengerCard:S, resume:{phase:'play', pending:null}},
      hands:{0:[{id:'f2',name:'闪',suit:'♥',rank:3},{id:'f3',name:'闪',suit:'♦',rank:11}]} });
    setG(g);
    const r = await R('(async function(){ return await botDecide("zhibaAsk", _g, 0); })()');
    assert.strictEqual(r, true);
    assert.strictEqual(R('window.__zbCalls').length, 1);
    assert.strictEqual(R('window.__zbCalls')[0], 1); // 点数大的下标
  });

  await check('J3 runBotDecision 接线:zhibaAsk 阶段命中专用决策', async function(){
    R('aiApiKey = ""; aiProvider = null;');
    R('window.__zbCalls = []; respondZhiba = function(cardIdx){ window.__zbCalls.push(cardIdx); };');
    const g = mkG({ phase:'zhibaAsk', turn:1, generals:{0:'sunce',1:'lvmeng'},
      pending:{type:'zhibaAsk', lordSeat:0, challengerSeat:1, challengerCard:S, resume:{phase:'play', pending:null}},
      botOf:{0:true}, hands:{0:[{id:'f2',name:'闪',suit:'♥',rank:9}]} });
    setG(g);
    await R('(async function(){ await runBotDecision(_g, 0); return true; })()');
    assert.strictEqual(R('window.__zbCalls').length, 1);
  });

  await check('J4 CONTROLS_CHOICE_EXCLUDE 收录 zhibaAsk(防 L1 双重接管)', function(){
    assert.strictEqual(R('CONTROLS_CHOICE_EXCLUDE.has("zhibaAsk")'), true);
  });

  await check('J5 制霸主动入口:吴势力角色可用,非吴势力不可用', function(){
    const g = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{0:[S],1:[SH]} });
    setG(g); assert.strictEqual(R('canTriggerZhiba(_g,1)'),true);
    const g2 = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'caocao'}, hands:{0:[S],1:[SH]} });
    setG(g2); assert.strictEqual(R('canTriggerZhiba(_g,1)'),false);
  });

  await check('J6 A1 超时保守动作表:zhibaAsk → respondZhiba(0)', function(){
    R('window.__zbCalls = []; respondZhiba = function(cardIdx){ window.__zbCalls.push(cardIdx); };');
    const a = R('autoRespondAction({phase:"zhibaAsk", pending:{type:"zhibaAsk", askedAt:1}})');
    assert.ok(a, 'zhibaAsk 应有保守动作');
    a();
    assert.strictEqual(R('window.__zbCalls').length, 1);
    assert.strictEqual(R('window.__zbCalls')[0], 0);
  });

  // ===== K. UI =====

  await check('K1 UI:zhibaAsk 主公渲染拼点按钮,点击走 respondZhiba', function(){
    R('window.__zbCalls = []; respondZhiba = function(cardIdx){ window.__zbCalls.push(cardIdx); };');
    const g = mkG({ phase:'zhibaAsk', turn:1, generals:{0:'sunce',1:'lvmeng'},
      pending:{type:'zhibaAsk', lordSeat:0, challengerSeat:1, challengerCard:S, resume:{phase:'play', pending:null}},
      hands:{0:[{id:'f2',name:'闪',suit:'♥',rank:9}]} });
    setG(g); seat(0);
    __controlsEl = makeEl();
    context.window.__controlsEl = __controlsEl;
    R('renderControls(_g)');
    const labels = R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.some(function(l){ return l.indexOf('拼点') >= 0; }), '应有拼点按钮,实际 ' + JSON.stringify(labels));
    R('(function(){ var kids = window.__controlsEl.children; for(var i=0;i<kids.length;i++){ if(kids[i].textContent.indexOf("拼点") >= 0){ kids[i].onclick(); return; } } })()');
    assert.strictEqual(R('window.__zbCalls').length, 1);
    assert.strictEqual(R('window.__zbCalls')[0], 0);
  });

  await check('K2 UI:吴势力角色play阶段渲染「发动【制霸】」按钮;ffa/非吴不渲染', function(){
    const g = mkG({ phase:'play', turn:1, generals:{0:'sunce',1:'lvmeng'}, hands:{0:[S],1:[SH]} });
    setG(g); seat(1);
    __controlsEl = makeEl();
    context.window.__controlsEl = __controlsEl;
    R('renderControls(_g)');
    let labels = R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.indexOf('发动【制霸】') >= 0, '应有制霸按钮,实际 ' + JSON.stringify(labels));
    const g2 = mkG({ mode:'ffa', phase:'play', turn:0, generals:{0:'sunce'}, hands:{0:[S],1:[SH]} });
    setG(g2); seat(0);
    __controlsEl = makeEl();
    context.window.__controlsEl = __controlsEl;
    R('renderControls(_g)');
    labels = R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.indexOf('发动【制霸】') < 0, 'ffa 不应有制霸按钮');
  });

  // ===== L. 新增主公技与魂姿解锁 =====

  await check('L1 救援:吴势力角色对主公孙权使用桃时回复值+1;非吴/非主公不加成', function(){
    const g=mkG({generals:{0:'sunquan',1:'lvmeng',2:'caocao'}});
    setG(g);
    assert.strictEqual(R('peachRecoveryAmount(_g,1,0)'),2);
    assert.strictEqual(R('peachRecoveryAmount(_g,2,0)'),1);
    assert.strictEqual(R('peachRecoveryAmount(_g,1,1)'),1);
  });

  await check('L2 黄天:群势力角色每个出牌阶段限一次交给主公闪/闪电', function(){
    const lightning={id:'lt',name:'闪电',suit:'♠',rank:1};
    const g=mkG({phase:'play',turn:1,generals:{0:'zhangjiao',1:'yuanshao'},hands:{1:[lightning,SH]}});
    setG(g); seat(1);
    assert.strictEqual(R('canUseHuangtian(_g,1)'),true);
    R('useHuangtian(0)');
    let gg=getG();
    assert.strictEqual(gg.players[0].hand[0].id,'lt');
    assert.strictEqual(gg.players[1].huangtianUsed,true);
    R('useHuangtian(0)');
    gg=getG(); assert.strictEqual(gg.players[0].hand.length,1);
  });

  await check('L3 血裔:袁绍主公手牌上限按其他存活群势力角色每名+2', function(){
    const g=mkG({generals:{0:'yuanshao',1:'zhangjiao',2:'lvmeng'}});
    setG(g); assert.strictEqual(R('handCapLimit(_g,0)'),6);
    getG().players[2].general='yuanshu';
    assert.strictEqual(R('handCapLimit(_g,0)'),8);
    getG().players[1].alive=false;
    assert.strictEqual(R('handCapLimit(_g,0)'),6);
  });

  await check('L4 魂姿:1体力准备阶段觉醒,减上限并获得英姿/英魂;不重复觉醒', function(){
    const g=mkG({phase:'play',turn:0,generals:{0:'sunce'},hpOf:{0:1}});
    setG(g); R('startTurn(_g,0)');
    let gg=getG();
    assert.strictEqual(gg.players[0].hunziAwakened,true);
    assert.strictEqual(gg.players[0].maxHp,3);
    assert.strictEqual(R('generalCapValue(_g.players[0],"extraDrawPhase",0)'),1);
    assert.strictEqual(R('hasCap(_g.players[0],"yinghun")'),true);
    R('startTurn(_g,0)'); gg=getG(); assert.strictEqual(gg.players[0].maxHp,3);
  });

  await check('L5 英魂:觉醒后准备阶段选择目标并结算摸X弃1', function(){
    const g=mkG({phase:'play',turn:0,generals:{0:'sunce'},hpOf:{0:1},hands:{1:[SH]}});
    g.players[0].maxHp=3; g.players[0].hunziAwakened=true; g.players[0].caps={extraDrawPhase:1,yinghun:true};
    g.deck=[{id:'d1',name:'杀',suit:'♠',rank:2},{id:'d2',name:'闪',suit:'♥',rank:2}];
    setG(g); R('startTurn(_g,0)');
    assert.strictEqual(getG().phase,'yinghunTarget');
    seat(0); R('chooseYinghunTarget(1)'); R('respondYinghunChoice("drawX")');
    assert.strictEqual(getG().phase,'yinghunDiscard');
    seat(1); R('discardYinghunCard(0)');
    const gg=getG();
    assert.strictEqual(gg.pending,null);
    assert.ok(gg.log.some(function(e){return e.text.indexOf('英魂')>=0;}));
  });

  await check('L6 激将/护驾仅询问对应势力角色', function(){
    const g=mkG({phase:'duel',pending:DUEL,generals:{0:'liubei',1:'caocao',2:'zhaoyun'}});
    setG(g); seat(0); R('duelResponse(false)');
    assert.strictEqual(getG().pending.asking,2);
  });

  await check('L7 刘备出牌阶段有明确【仁德】【激将】按钮', function(){
    const g=mkG({phase:'play',turn:0,generals:{0:'liubei',1:'caocao',2:'zhaoyun'},hands:{0:[SH,S],2:[S]}});
    setG(g); seat(0);
    __controlsEl=makeEl(); context.window.__controlsEl=__controlsEl;
    R('renderControls(_g)');
    const labels=R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(labels.indexOf('发动【仁德】')>=0,'应有仁德入口,实际 '+JSON.stringify(labels));
    assert.ok(labels.indexOf('发动【激将】')>=0,'应有激将入口,实际 '+JSON.stringify(labels));

    // 真实点击链:发动仁德 → 点击手牌 → 控制区出现明确目标按钮 → 确认后完成赠牌。
    R('var __savedRender=render; render=function(g){ renderControls(g); renderHand(g); };');
    R('(window.__controlsEl.children || []).find(function(el){ return el.textContent==="发动【仁德】"; }).onclick()');
    assert.strictEqual(R('rendeMode'),true);
    __handEl=makeEl(); context.window.__handEl=__handEl;
    R('renderHand(_g)');
    assert.ok(__handEl.children && __handEl.children[0] && typeof __handEl.children[0].onclick==='function','仁德模式下手牌应可点击');
    __handEl.children[0].onclick();
    __handEl.children[1].onclick();
    assert.deepStrictEqual(Array.from(R('rendePicks')), [0,1]);
    const rendeLabels=R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(rendeLabels.indexOf('把 2 张牌交给 角色1')>=0,'多选后应有批量赠牌目标,实际 '+JSON.stringify(rendeLabels));
    R('var __savedConfirmAndPlay=confirmAndPlay; confirmAndPlay=function(message,fn){ resetSelectionState(); fn(); };');
    R('(window.__controlsEl.children || []).find(function(el){ return el.textContent==="把 2 张牌交给 角色1"; }).onclick()');
    R('confirmAndPlay=__savedConfirmAndPlay;');
    assert.strictEqual(getG().players[0].hand.length,0);
    assert.strictEqual(getG().players[1].hand.length,2);
    assert.strictEqual(getG().renDeCount,2);

    // 重新构造局面验证激将入口点击后,合法目标也是明确按钮且点击会真正进入询问阶段。
    const jg=mkG({phase:'play',turn:0,generals:{0:'liubei',1:'caocao',2:'zhaoyun'},hands:{0:[SH],2:[S]}});
    setG(jg); R('resetSelectionState()');
    __controlsEl=makeEl(); context.window.__controlsEl=__controlsEl;
    R('renderControls(_g)');
    R('(window.__controlsEl.children || []).find(function(el){ return el.textContent==="发动【激将】"; }).onclick()');
    const jijiangLabels=R('(window.__controlsEl.children || []).map(function(el){ return el.textContent; })');
    assert.ok(jijiangLabels.indexOf('对 角色1 发动【激将】')>=0,'激将应有明确合法目标,实际 '+JSON.stringify(jijiangLabels));
    R('(window.__controlsEl.children || []).find(function(el){ return el.textContent==="对 角色1 发动【激将】"; }).onclick()');
    assert.strictEqual(getG().phase,'jijiangAsk');
    assert.strictEqual(getG().pending.asking,2);
    R('render=__savedRender;');
  });

  await check('L8 主动激将:选择目标→蜀将代出杀→刘备成为使用者并消耗出杀次数', function(){
    const g=mkG({phase:'play',turn:0,generals:{0:'liubei',1:'caocao',2:'zhaoyun'},hands:{0:[SH],2:[S]}});
    setG(g); seat(0); R('useJijiang(1)');
    let gg=getG();
    assert.strictEqual(gg.phase,'jijiangAsk');
    assert.strictEqual(gg.pending.asking,2);
    seat(2);
    assert.strictEqual(R('mySeat'),2);
    assert.strictEqual(R('canUseAs(_g.players[2],_g.players[2].hand[0],"杀")'),true);
    // 前面的 UI 接线用例会把公开包装函数替换成 spy；这里直接验证真实共用内核。
    R('respondLordAskCore(true,0)');
    gg=getG();
    assert.strictEqual(gg.phase,'respond','激将响应后状态 '+JSON.stringify({phase:gg.phase,pending:gg.pending,hand:gg.players[2].hand}));
    assert.strictEqual(gg.pending.from,0);
    assert.strictEqual(gg.pending.to,1);
    assert.strictEqual(gg.shaUsed,true);
    assert.strictEqual(gg.players[2].hand.length,0);
  });

  // ===== M. 无密钥零变化 =====

  await check('M1 无密钥零变化:ffa 主公弃牌阶段不受脏 lordHandCap 影响(上限仍=hp)', function(){
    // ffa 下 role 本应被 normalize 清空;这里不跑 normalize,靠 handCapLimit 自身 gameMode 守卫
    const g = mkG({ mode:'ffa', phase:'discard', turn:0, generals:{0:'caocao',1:'yuanshu'},
      hands:{0:[S,SH,{id:'t1',name:'桃',suit:'♥',rank:3},{id:'w1',name:'无中生有',suit:'♥',rank:7}]} }); // 手牌4=hp4
    g.lordHandCap = 1; // 脏数据模拟
    setG(g); seat(0);
    R('endTurn()');
    const gg = getG();
    assert.notStrictEqual(gg.phase, 'discard'); // 没被脏 lordHandCap 拦下
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + passed + ' 通过, ' + failed + ' 失败');
  console.log('='.repeat(60) + '\n');
  done = true;
  failFlag = failed > 0;
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  done = true;
  failFlag = true;
});

let done = false, failFlag = false;
(function(){
  const t = setInterval(function(){
    if (done === true) {
      clearInterval(t);
      process.exit(failFlag ? 1 : 0);
    }
  }, 10);
})();
