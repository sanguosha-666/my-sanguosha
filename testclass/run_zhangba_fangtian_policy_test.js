/**
 * CORE-95(issue #142):丈八蛇矛(zhangbaTwoStep)和方天画戟(fangtian)走各自独立的候选
 * 生成路径,原来只检查存活/距离/空城,没有调用 botTargetPolicyAllows——身份局里忠臣可能
 * 攻击已知主公、主公可能攻击已知忠臣、反贼可能攻击已知反贼,方天的多目标组合也可能混入
 * 己方角色,绕过 #136/#137 已经给普通出牌候选建立的阵营硬过滤。
 *
 * 修复:
 * - 新增 botZhangbaLegalTargets(g,seat) 共用 helper,统一给 match(存在性判断)和
 *   buildCandidates 阶段C(真正枚举)过 botTargetPolicyAllows。
 * - botFangtianTargets(g,seat) 在游戏规则 canTarget 之后叠加 botTargetPolicyAllows,
 *   这样后续 botFangtianCombinations 的多目标组合天然不会混入被过滤的目标。
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
function card(name, id, suit, rank){ return { id: id||name, name, suit: suit||'♠', rank: rank||7 }; }
function setBotTwoStepA(v){ sandbox.__v = v; vm.runInContext('botTwoStepA = __v;', sandbox); }

// 6人环形局。座位0=机器人(装青龙偃月刀保证射程覆盖全部座位,身份可变)。座位1=已知主公
// (role='zhu' 天然公开,不需要 roleRevealed)。座位2=已知反贼(roleRevealed=true)。
// 座位3/4/5=身份未知(role=null,suspicion默认0——忠臣/主公面对未知身份默认不打,
// 见 botTargetRelationAllowed 的 suspicion>=30/35 门槛)。
function mkGame(seat0Role){
  const players = [];
  for(let i=0;i<6;i++){
    players.push({
      name:'p'+i, general:'caocao', hp:4, maxHp:4,
      hand:[], equips: emptyEq(), delays:[], alive:true, dying:false, role:null, roleRevealed:false
    });
  }
  players[0].equips.weapon = { id:'w0', name:'青龙偃月刀', suit:'♠', rank:5, range:3 };
  players[0].hand = [card('杀','a0'), card('杀','a1')];
  players[0].role = seat0Role;
  players[1].role = 'zhu';
  players[2].role = 'fan'; players[2].roleRevealed = true;
  return {
    phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:400+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false,
    aiRebelSuspicion: {}
  };
}

console.log('\n== CORE-95:丈八蛇矛/方天画戟绕过身份局阵营目标保护 ==\n');

// ---- 丈八蛇矛 ----
check('丈八蛇矛(忠臣视角):阶段C候选不应包含已知主公(座位1),已知反贼(座位2)应保留', ()=>{
  const g = mkGame('zhong');
  g.players[0].caps = { twoAsSha:true };
  const s = R('BOT_DECISIONS').zhangbaTwoStep;
  setBotTwoStepA({ decisionId:'zhangbaTwoStep', a:0, b:1 });
  const cands = s.buildCandidates(g, 0);
  const seats = cands.map(c=>c.targetSeat);
  assert.ok(!seats.includes(1), '忠臣不应能对已知主公(座位1)出丈八杀,实际候选 '+JSON.stringify(seats));
  assert.ok(seats.includes(2), '忠臣应仍能对已知反贼(座位2)出丈八杀,实际候选 '+JSON.stringify(seats));
});

check('丈八蛇矛(主公视角):阶段C候选不应包含已知忠臣', ()=>{
  const g = mkGame('zhu');
  g.players[1].role = 'zhong'; // 覆盖:座位1改为已知忠臣(role天然公开靠roleRevealed补上)
  g.players[1].roleRevealed = true;
  g.players[0].caps = { twoAsSha:true };
  const s = R('BOT_DECISIONS').zhangbaTwoStep;
  setBotTwoStepA({ decisionId:'zhangbaTwoStep', a:0, b:1 });
  const cands = s.buildCandidates(g, 0);
  const seats = cands.map(c=>c.targetSeat);
  assert.ok(!seats.includes(1), '主公不应能对已知忠臣(座位1)出丈八杀,实际候选 '+JSON.stringify(seats));
  assert.ok(seats.includes(2), '主公应仍能对已知反贼(座位2)出丈八杀,实际候选 '+JSON.stringify(seats));
});

check('丈八蛇矛(反贼视角):阶段C候选不应包含已知反贼(己方)', ()=>{
  const g = mkGame('fan');
  g.players[0].caps = { twoAsSha:true };
  const s = R('BOT_DECISIONS').zhangbaTwoStep;
  setBotTwoStepA({ decisionId:'zhangbaTwoStep', a:0, b:1 });
  const cands = s.buildCandidates(g, 0);
  const seats = cands.map(c=>c.targetSeat);
  assert.ok(!seats.includes(2), '反贼不应能对已知反贼(座位2,己方)出丈八杀,实际候选 '+JSON.stringify(seats));
  assert.ok(seats.includes(1), '反贼应仍能对已知主公(座位1)出丈八杀,实际候选 '+JSON.stringify(seats));
});

check('丈八蛇矛(内奸视角):不套固定敌我硬禁,已知主公/反贼均可留在候选里(动态评分自行判断)', ()=>{
  const g = mkGame('nei');
  g.players[0].caps = { twoAsSha:true };
  const s = R('BOT_DECISIONS').zhangbaTwoStep;
  setBotTwoStepA({ decisionId:'zhangbaTwoStep', a:0, b:1 });
  const cands = s.buildCandidates(g, 0);
  const seats = cands.map(c=>c.targetSeat);
  assert.ok(seats.includes(1) && seats.includes(2), '内奸不应被硬性禁止任何已知身份目标,实际候选 '+JSON.stringify(seats));
});

check('丈八蛇矛 match():唯一候选是已知主公时,忠臣不应命中(策略过滤后无合法目标)', ()=>{
  const players = [];
  for(let i=0;i<2;i++){
    players.push({ name:'p'+i, general:'caocao', hp:4, maxHp:4, hand:[], equips: emptyEq(), delays:[], alive:true, dying:false, role:null, roleRevealed:false });
  }
  players[0].equips.weapon = { id:'w0', name:'青龙偃月刀', suit:'♠', rank:5, range:3 };
  players[0].hand = [card('杀','b0'), card('杀','b1')];
  players[0].role = 'zhong'; players[0].caps = { twoAsSha:true };
  players[1].role = 'zhu';
  const g = { phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:500+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{} };
  const s = R('BOT_DECISIONS').zhangbaTwoStep;
  setBotTwoStepA(null);
  assert.strictEqual(s.match(g, 0), false, '唯一可达目标是已知主公时忠臣不应命中(应保守不发动)');
});

// ---- 方天画戟 ----
check('方天画戟(忠臣视角):目标集合不应包含已知主公,组合里也不应混入', ()=>{
  const g = mkGame('zhong');
  g.players[0].caps = { fangtian:true };
  const targets = R('botFangtianTargets')(g, 0);
  assert.ok(!targets.includes(1), '方天目标集合不应含已知主公(座位1),实际 '+JSON.stringify(targets));
  assert.ok(targets.includes(2), '方天目标集合应仍含已知反贼(座位2),实际 '+JSON.stringify(targets));
  const combos = R('botFangtianCombinations')(g, 0);
  assert.ok(!combos.some(c=>c.includes(1)), '方天多目标组合不应有任何一个组合混入已知主公(座位1),实际 '+JSON.stringify(combos));
});

check('方天画戟(反贼视角):目标集合不应包含已知反贼(己方)', ()=>{
  const g = mkGame('fan');
  g.players[0].caps = { fangtian:true };
  const targets = R('botFangtianTargets')(g, 0);
  assert.ok(!targets.includes(2), '方天目标集合不应含已知反贼(座位2,己方),实际 '+JSON.stringify(targets));
  assert.ok(targets.includes(1), '方天目标集合应仍含已知主公(座位1),实际 '+JSON.stringify(targets));
});

check('方天画戟(TEAM模式):目标集合按队伍关系过滤,同队目标不应出现', ()=>{
  const players = [];
  for(let i=0;i<4;i++){
    players.push({ name:'p'+i, general:'caocao', hp:4, maxHp:4, hand:[], equips: emptyEq(), delays:[], alive:true, dying:false, team: i<2?0:1 });
  }
  players[0].equips.weapon = { id:'w0', name:'青龙偃月刀', suit:'♠', rank:5, range:3 };
  players[0].hand = [card('杀','c0')];
  players[0].caps = { fangtian:true };
  const g = { phase:'play', turn:0, started:true, gameMode:'team', players,
    deck: Array.from({length:20},(_,i)=>({id:600+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false };
  const targets = R('botFangtianTargets')(g, 0);
  assert.ok(!targets.includes(1), 'TEAM模式下同队(座位1)不应出现在方天目标集合里,实际 '+JSON.stringify(targets));
  assert.ok(targets.includes(2) && targets.includes(3), 'TEAM模式下异队(座位2/3)应仍在方天目标集合里,实际 '+JSON.stringify(targets));
});

check('方天画戟(内奸视角):不套固定敌我硬禁,已知主公/反贼均可留在目标集合里', ()=>{
  const g = mkGame('nei');
  g.players[0].caps = { fangtian:true };
  const targets = R('botFangtianTargets')(g, 0);
  assert.ok(targets.includes(1) && targets.includes(2), '内奸不应被硬性禁止任何已知身份目标,实际 '+JSON.stringify(targets));
});

check('破坏性验证:还原成"只用game规则canTarget、不叠加策略过滤"的旧写法,忠臣确实能把已知主公列进方天目标(证明断言有鉴别力)', ()=>{
  const savedFn = R('botFangtianTargets');
  vm.runInContext(`
    var __savedBotFangtianTargets = botFangtianTargets;
    botFangtianTargets = function(g, seat){
      var me=g.players[seat], out=[];
      if(!me) return out;
      g.players.forEach(function(p, i){
        if(!p || !p.alive || i===seat) return;
        if(!CARD_PLAYS['杀'].canTarget(g,me,{name:'杀',virtual:true},i)) return;
        out.push(i);
      });
      return out;
    };
  `, sandbox);
  try{
    const g = mkGame('zhong');
    g.players[0].caps = { fangtian:true };
    const targets = R('botFangtianTargets')(g, 0);
    if(!targets.includes(1)) throw new Error('旧写法下忠臣应该(错误地)把已知主公(座位1)列进方天目标,如果没有说明上面的断言对这段逻辑没有鉴别力');
  } finally {
    vm.runInContext('botFangtianTargets = __savedBotFangtianTargets;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
