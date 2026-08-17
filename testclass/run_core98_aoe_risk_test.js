/**
 * CORE-98(issue #145):南蛮入侵和万箭齐发阵营保护只覆盖忠臣,主公与反贼缺少主动AOE风险
 * 判断。
 *
 * botPlay(旧枚举)和enumerateAllLegalOneStepActions(新枚举)原来都只有同一条特判:
 * `if(me.role==='zhong' && (action==='南蛮入侵'||action==='万箭齐发')) return;`——
 * 主公、反贼、TEAM与内奸均没有AOE收益/风险模型,可能大量伤害已知己方角色。
 *
 * 修复:两处特判改用CORE-97(issue #144)乱击风险判断共用的botAoeSelfRiskAllows(g,seat),
 * 覆盖全部角色(identity:忠/主互为友军、反贼互为友军;team:同队;内奸不设固定敌我;
 * FFA不评估)。
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
function card(name, id, suit, rank){ return { id: id||name, name, suit: suit||'♠', rank: rank||7 }; }

// 4人环形局。座位0=机器人(身份可变,手牌一张南蛮+一张万箭)。座位1=已知主公。座位2=已知
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
  players[0].hand = [card('南蛮入侵','n0','♠'), card('万箭齐发','w0','♠')];
  players[1].role = 'zhu';
  players[1].hp = (opts.zhuHp !== undefined) ? opts.zhuHp : 4;
  players[2].role = 'fan'; players[2].roleRevealed = true;
  players[2].hp = (opts.fanHp !== undefined) ? opts.fanHp : 4;
  if(opts.gameMode==='team'){
    players.forEach((p,i)=>{ p.team = (i<2)?0:1; });
  }
  return {
    phase:'play', turn:0, started:true, gameMode: opts.gameMode||'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:900+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{}
  };
}

console.log('\n== CORE-98:南蛮入侵/万箭齐发阵营保护覆盖全部角色 ==\n');

// ---- botPlay(旧枚举)----
check('botPlay:忠臣视角,主公命悬一线时不应把南蛮/万箭列为候选动作', async ()=>{
  const g = mkGame('zhong', { zhuHp: 1 });
  bindG(g);
  const result = await R('botPlay')(g, 0);
  // botPlay 无密钥兜底会直接选出一个动作;验证它选中的不是南蛮/万箭
  // (更直接的验证见下面 enumerateAllLegalOneStepActions,这里只做botPlay层面的抽样交叉验证)
  assert.ok(!result || (result.action!=='南蛮入侵' && result.action!=='万箭齐发'),
    '忠臣主公命悬一线时不应选择南蛮/万箭,实际 '+JSON.stringify(result && result.action));
});

check('botPlay:主公视角,已知忠臣命悬一线时不应把南蛮/万箭列为候选动作', async ()=>{
  const g = mkGame('zhu');
  g.players[1].role = 'zhong'; g.players[1].roleRevealed = true; g.players[1].hp = 1;
  bindG(g);
  const result = await R('botPlay')(g, 0);
  assert.ok(!result || (result.action!=='南蛮入侵' && result.action!=='万箭齐发'),
    '主公面对已知忠臣命悬一线时不应选择南蛮/万箭,实际 '+JSON.stringify(result && result.action));
});

// ---- enumerateAllLegalOneStepActions(新枚举,AI候选生成)----
check('enumerateAllLegalOneStepActions:忠臣视角,主公命悬一线时南蛮/万箭不应出现在候选里', ()=>{
  const g = mkGame('zhong', { zhuHp: 1 });
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(!candidates.some(c=>c.action==='南蛮入侵'), '忠臣主公命悬一线时不应有南蛮候选');
  assert.ok(!candidates.some(c=>c.action==='万箭齐发'), '忠臣主公命悬一线时不应有万箭候选');
});

check('enumerateAllLegalOneStepActions:忠臣视角,主公体力充足时南蛮/万箭应正常出现在候选里(这是本次修复新增的能力,原来忠臣被无条件硬禁)', ()=>{
  const g = mkGame('zhong', { zhuHp: 4 });
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(candidates.some(c=>c.action==='南蛮入侵'), '忠臣主公体力充足时应能选择南蛮');
  assert.ok(candidates.some(c=>c.action==='万箭齐发'), '忠臣主公体力充足时应能选择万箭');
});

check('enumerateAllLegalOneStepActions:主公视角,已知忠臣命悬一线时南蛮/万箭不应出现在候选里(修复前主公完全没有这层保护)', ()=>{
  const g = mkGame('zhu');
  g.players[1].role = 'zhong'; g.players[1].roleRevealed = true; g.players[1].hp = 1;
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(!candidates.some(c=>c.action==='南蛮入侵'), '主公面对已知忠臣命悬一线时不应有南蛮候选');
  assert.ok(!candidates.some(c=>c.action==='万箭齐发'), '主公面对已知忠臣命悬一线时不应有万箭候选');
});

check('enumerateAllLegalOneStepActions:反贼视角,已知反贼(己方)命悬一线时南蛮/万箭不应出现在候选里(修复前反贼完全没有这层保护)', ()=>{
  const g = mkGame('fan', { fanHp: 1 });
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(!candidates.some(c=>c.action==='南蛮入侵'), '反贼面对已知反贼(己方)命悬一线时不应有南蛮候选');
  assert.ok(!candidates.some(c=>c.action==='万箭齐发'), '反贼面对已知反贼(己方)命悬一线时不应有万箭候选');
});

check('enumerateAllLegalOneStepActions:反贼视角,己方体力充足、敌方(主公)命悬一线时南蛮/万箭应正常出现', ()=>{
  const g = mkGame('fan', { zhuHp: 1, fanHp: 4 });
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(candidates.some(c=>c.action==='南蛮入侵'), '敌方命悬一线不应拦住反贼使用南蛮');
  assert.ok(candidates.some(c=>c.action==='万箭齐发'), '敌方命悬一线不应拦住反贼使用万箭');
});

check('enumerateAllLegalOneStepActions:内奸视角,不套固定敌我硬禁,即使已知角色命悬一线也不拦', ()=>{
  const g = mkGame('nei', { zhuHp: 1, fanHp: 1 });
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(candidates.some(c=>c.action==='南蛮入侵'), '内奸不应被硬性禁止使用南蛮');
  assert.ok(candidates.some(c=>c.action==='万箭齐发'), '内奸不应被硬性禁止使用万箭');
});

check('enumerateAllLegalOneStepActions:TEAM模式,同队队友命悬一线时南蛮/万箭不应出现', ()=>{
  const g = mkGame(null, { gameMode:'team', zhuHp: 1 }); // 座位1和座位0同队(team=0)
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(!candidates.some(c=>c.action==='南蛮入侵'), 'TEAM模式下同队队友命悬一线时不应有南蛮候选');
  assert.ok(!candidates.some(c=>c.action==='万箭齐发'), 'TEAM模式下同队队友命悬一线时不应有万箭候选');
});

check('enumerateAllLegalOneStepActions:TEAM模式,异队命悬一线不拦', ()=>{
  const g = mkGame(null, { gameMode:'team', fanHp: 1 }); // 座位2和座位0异队(team=1)
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(candidates.some(c=>c.action==='南蛮入侵'), 'TEAM模式下异队命悬一线不应拦住南蛮');
  assert.ok(candidates.some(c=>c.action==='万箭齐发'), 'TEAM模式下异队命悬一线不应拦住万箭');
});

check('FFA零回归:非identity/team模式,不评估风险', ()=>{
  const g = mkGame('zhong', { zhuHp: 1 });
  g.gameMode = 'ffa';
  bindG(g);
  const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
  assert.ok(candidates.some(c=>c.action==='南蛮入侵'), 'FFA模式下即使有玩家hp=1也不应受风险评估影响(零回归)');
  assert.ok(candidates.some(c=>c.action==='万箭齐发'), 'FFA模式下即使有玩家hp=1也不应受风险评估影响(零回归)');
});

check('破坏性验证:去掉botAoeSelfRiskAllows过滤,主公确实会在已知忠臣命悬一线时把南蛮列为候选(证明断言有鉴别力)', ()=>{
  vm.runInContext('var __savedBotAoeSelfRiskAllows2 = botAoeSelfRiskAllows; botAoeSelfRiskAllows = function(){ return true; };', sandbox);
  try{
    const g = mkGame('zhu');
    g.players[1].role = 'zhong'; g.players[1].roleRevealed = true; g.players[1].hp = 1;
    bindG(g);
    const candidates = R('enumerateAllLegalOneStepActions')(g, 0);
    if(!candidates.some(c=>c.action==='南蛮入侵'))
      throw new Error('去掉风险过滤后应该(错误地)把南蛮列为候选,如果没有说明上面的断言对这段逻辑没有鉴别力');
  } finally {
    vm.runInContext('botAoeSelfRiskAllows = __savedBotAoeSelfRiskAllows2;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
