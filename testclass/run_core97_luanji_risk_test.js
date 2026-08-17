/**
 * CORE-97(issue #144):乱击自动发动绕过身份局AOE风险判断,可主动误伤主公或队友。
 *
 * botTryStartExtraSkills 里袁绍【乱击】原来只检查"其他存活角色数≥2"+"手牌有同花色对子"
 * 就固定发动——乱击视为万箭齐发,全场其他存活角色都会受到伤害,发动判断完全不考虑主公、
 * 已知队友的生存风险,可能主动造成致命误伤(比如忠臣袁绍、主公仅1点体力时)。
 *
 * 修复:新增共用helper botAoeSelfRiskAllows(g,seat)(和CORE-98/issue #145的南蛮/万箭
 * 风险判断共用),identity模式下已知同阵营(忠/主互为友军,反贼互为友军)中有人hp<=1就
 * 不发动;team模式同队友军hp<=1不发动;内奸/FFA不受影响。乱击发动分支叠加这条判断。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(){ return {}; }, set(){}, update(){}, child(){ return this; }, remove(){},
      get(){ return { val(){ return null; } }; }
    }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(){ return {
      onclick:null, innerHTML:'', style:{}, className:'', textContent:'',
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
      addEventListener(){}, removeEventListener(){}, querySelector(){ return null; },
      querySelectorAll(){ return []; }
    }; },
    createElement(){ return {
      style:{}, className:'', textContent:'', innerHTML:'', onclick:null, disabled:false,
      setAttribute(){}, appendChild(){ return {}; },
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){} }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){} }, head:{ appendChild(){} }, addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){} },
    addEventListener(){}, setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;
const sandbox = vm.createContext(context);

['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js',
 'weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js'
].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  if(f==='game.js'){
    vm.runInContext(`
      tx = function(fn){ if(typeof _g==='undefined'||!_g) return; return fn(_g); };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
      var _g = null;
    `, sandbox);
  }
});

function R(code){ return vm.runInContext(code, sandbox); }
function emptyEq(){ return R('emptyEquips')(); }
function bindG(g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function setSeat(s){ vm.runInContext('mySeat='+s+';', sandbox); }
function card(name, id, suit, rank){ return { id: id||name, name, suit: suit||'♠', rank: rank||7 }; }

// 4人环形局。座位0=袁绍(机器人,身份可变,手牌两张同花色)。座位1=已知主公。座位2=已知
// 反贼。座位3=身份未知。
function mkGame(seat0Role, opts){
  opts = opts || {};
  const players = [];
  for(let i=0;i<4;i++){
    players.push({
      name:'p'+i, general:'caocao', hp:4, maxHp:4,
      hand:[], equips: emptyEq(), delays:[], alive:true, dying:false, role:null, roleRevealed:false
    });
  }
  players[0].role = seat0Role;
  players[0].isBot = true;
  players[0].caps = { luanji:true };
  players[0].hand = [card('杀','a0','♠'), card('闪','a1','♠')];
  players[1].role = 'zhu';
  players[1].hp = (opts.zhuHp !== undefined) ? opts.zhuHp : 4;
  players[2].role = 'fan'; players[2].roleRevealed = true;
  if(opts.gameMode==='team'){
    players.forEach((p,i)=>{ p.team = (i<2)?0:1; });
  }
  return {
    phase:'play', turn:0, started:true, gameMode: opts.gameMode||'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:800+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{}
  };
}

console.log('\n== CORE-97:乱击自动发动绕过身份局AOE风险判断 ==\n');

check('忠臣袁绍:主公仅1点体力时不应发动乱击', ()=>{
  const g = mkGame('zhong', { zhuHp: 1 });
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '主公命悬一线时忠臣不应发动乱击');
  assert.strictEqual(g.phase, 'play', '不应进入luanjiChoose阶段');
});

check('忠臣袁绍:主公体力充足(4点)时应正常发动乱击', ()=>{
  const g = mkGame('zhong', { zhuHp: 4 });
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, '主公体力充足时应正常发动乱击');
  assert.strictEqual(g.phase, 'luanjiChoose');
});

check('主公袁绍:已知忠臣仅1点体力时不应发动乱击', ()=>{
  const g = mkGame('zhu');
  g.players[1].role = 'zhong'; g.players[1].roleRevealed = true; g.players[1].hp = 1;
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '已知忠臣命悬一线时主公不应发动乱击');
});

check('反贼袁绍:已知反贼(己方)仅1点体力时不应发动乱击', ()=>{
  const g = mkGame('fan');
  g.players[2].hp = 1; // 座位2已是已知反贼(mkGame默认设置)
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '已知反贼(己方)命悬一线时不应发动乱击');
});

check('反贼袁绍:己方体力充足、敌方(主公)命悬一线时应正常发动乱击(有害目标不拦)', ()=>{
  const g = mkGame('fan');
  g.players[1].hp = 1; // 主公命悬一线,对反贼是好事,不应拦
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, '敌方(主公)命悬一线不应拦住反贼发动乱击');
});

check('内奸袁绍:不套固定敌我硬禁,即使已知主公/反贼命悬一线也不拦(动态判断基调)', ()=>{
  const g = mkGame('nei');
  g.players[1].hp = 1; g.players[2].hp = 1;
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, '内奸不应被硬性禁止发动乱击');
});

check('TEAM模式:同队队友命悬一线时不应发动乱击', ()=>{
  const g = mkGame(null, { gameMode:'team' });
  g.players[1].hp = 1; // 座位1和座位0同队(team=0)
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, 'TEAM模式下同队队友命悬一线时不应发动乱击');
});

check('TEAM模式:异队命悬一线不拦,应正常发动乱击', ()=>{
  const g = mkGame(null, { gameMode:'team' });
  g.players[2].hp = 1; // 座位2和座位0异队(team=1)
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, 'TEAM模式下异队命悬一线不应拦住发动乱击');
});

check('FFA零回归:非identity/team模式,不评估风险,行为和修复前完全一致', ()=>{
  const g = mkGame('zhong', { zhuHp: 1 });
  g.gameMode = 'ffa';
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, 'FFA模式下即使有玩家hp=1也不应受风险评估影响(零回归)');
});

check('破坏性验证:去掉botAoeSelfRiskAllows过滤,忠臣确实会在主公命悬一线时发动乱击(证明断言有鉴别力)', ()=>{
  const saved = R('botAoeSelfRiskAllows');
  vm.runInContext('var __savedBotAoeSelfRiskAllows = botAoeSelfRiskAllows; botAoeSelfRiskAllows = function(){ return true; };', sandbox);
  try{
    const g = mkGame('zhong', { zhuHp: 1 });
    bindG(g);
    setSeat(0);
    const invoked = R('botTryStartExtraSkills')(g, 0);
    if(invoked !== true) throw new Error('去掉风险过滤后应该(错误地)发动乱击,如果没有说明上面的断言对这段逻辑没有鉴别力');
  } finally {
    vm.runInContext('botAoeSelfRiskAllows = __savedBotAoeSelfRiskAllows;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
