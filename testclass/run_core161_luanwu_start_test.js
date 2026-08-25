/**
 * CORE-161(issue #220):乱武被误判为零风险固定发动。
 *
 * botTryStartExtraSkills 原来只要 hasCap('luanwu') && !g.luanwuUsed && 场上有其他存活
 * 角色就 botInvoke(startLuanwu)。注释写成「对发动者自己零代价零风险」,但 CORE-94 之后
 * findNearestTargets 包含发动者本人,其他角色可以杀贾诩;身份/组队里友方也会被逼出杀或
 * 掉血。限定技被开局无脑烧掉。
 *
 * 本文件钉住「应发动 / 应保留」的确定性场面,并覆盖反噬贾诩或友方。真人 startLuanwu
 * 结算不受评估函数影响。
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

function mkGame(n, opts){
  opts = opts || {};
  const players = [];
  for(let i=0;i<n;i++){
    players.push({
      name:'p'+i, general: i===0 ? 'jiaxu' : 'caocao',
      hp: 4, maxHp: 4, hand:[], equips: emptyEq(), delays:[],
      alive:true, dying:false, role:null, roleRevealed:false, isBot: i===0
    });
  }
  players[0].caps = { luanwu:true };
  if(opts.gameMode==='team'){
    players.forEach((p,i)=>{ p.team = (i<Math.ceil(n/2))?0:1; });
  }
  return {
    phase:'play', turn:0, started:true, gameMode: opts.gameMode||'ffa',
    players, deck: Array.from({length:20},(_,i)=>({id:800+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false,
    luanwuUsed:false, aiRebelSuspicion:{}
  };
}

function tryStart(g){
  bindG(g);
  setSeat(0);
  return R('botTryStartExtraSkills')(g, 0);
}

console.log('\n== CORE-161:乱武不再因「场上有人」就固定发动 ==\n');

check('FFA 全员满血空手:有其他存活角色也不应发动(限定技机会成本)', ()=>{
  const g = mkGame(3, { gameMode:'ffa' });
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '开局满血不应浪费乱武');
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.luanwuUsed, false);
});

check('FFA 敌方1血无杀:应发动(可收割)', ()=>{
  const g = mkGame(2, { gameMode:'ffa' });
  g.players[1].hp = 1;
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '敌方1血无杀应收割');
  assert.strictEqual(g.phase, 'luanwuChoose');
  assert.strictEqual(g.luanwuUsed, true);
});

check('FFA 两名其他角色均≤2血且无杀:应发动(压制)', ()=>{
  const g = mkGame(3, { gameMode:'ffa' });
  g.players[1].hp = 2;
  g.players[2].hp = 2;
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '两名低血无杀应压制');
  assert.strictEqual(g.phase, 'luanwuChoose');
});

check('FFA 贾诩2血且是对方唯一最近目标、对方有杀:应保留(反噬)', ()=>{
  const g = mkGame(2, { gameMode:'ffa' });
  g.players[0].hp = 2;
  g.players[1].hand = [card('杀','s1')];
  const nearest = R('findNearestTargets')(g, 1);
  assert.ok(nearest.indexOf(0)>=0, '两人局对方最近目标必须含贾诩,实际 '+JSON.stringify(nearest));
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '自己会被杀且血薄时不应发动');
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.luanwuUsed, false);
});

check('身份局忠臣贾诩:主公1血无杀应保留(友方致命)', ()=>{
  const g = mkGame(4, { gameMode:'identity' });
  g.players[0].role = 'zhong';
  g.players[1].role = 'zhu';
  g.players[1].hp = 1;
  g.players[2].role = 'fan'; g.players[2].roleRevealed = true;
  g.players[3].role = 'nei';
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '主公命悬一线时忠臣不应乱武');
  assert.strictEqual(g.luanwuUsed, false);
});

check('身份局反贼贾诩:主公1血无杀、己方未暴露应发动', ()=>{
  const g = mkGame(4, { gameMode:'identity' });
  g.players[0].role = 'fan';
  g.players[1].role = 'zhu';
  g.players[1].hp = 1;
  g.players[2].role = 'zhong';
  g.players[3].role = 'nei';
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '反贼对1血主公应收割');
  assert.strictEqual(g.phase, 'luanwuChoose');
});

check('身份局反贼贾诩:已知反贼队友1血无杀应保留', ()=>{
  const g = mkGame(4, { gameMode:'identity' });
  g.players[0].role = 'fan';
  g.players[1].role = 'zhu';
  g.players[2].role = 'fan'; g.players[2].roleRevealed = true; g.players[2].hp = 1;
  g.players[3].role = 'zhong';
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '已知反贼队友致命时不应乱武');
  assert.strictEqual(g.luanwuUsed, false);
});

check('组队:同队1血无杀应保留', ()=>{
  const g = mkGame(4, { gameMode:'team' });
  g.players[1].hp = 1; // team 0 队友
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '队友命悬一线不应乱武');
  assert.strictEqual(g.luanwuUsed, false);
});

check('组队:异队1血无杀、队友满血应发动', ()=>{
  const g = mkGame(4, { gameMode:'team' });
  g.players[2].hp = 1; // team 1 敌人
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '异队1血无杀应收割');
  assert.strictEqual(g.phase, 'luanwuChoose');
});

check('FFA 不套身份友方:即使对方 role=zhong 且1血,仍应发动', ()=>{
  const g = mkGame(2, { gameMode:'ffa' });
  g.players[0].role = 'zhong';
  g.players[1].role = 'zhong';
  g.players[1].hp = 1;
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, 'FFA 不得把 role 当友方而留技能');
});

check('内奸不套固定友方:主公1血无杀可以发动', ()=>{
  const g = mkGame(4, { gameMode:'identity' });
  g.players[0].role = 'nei';
  g.players[1].role = 'zhu';
  g.players[1].hp = 1;
  g.players[2].role = 'fan'; g.players[2].roleRevealed = true;
  g.players[3].role = 'zhong';
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '内奸对1血主公不应被硬禁');
});

check('真人 startLuanwu 不受 AI 评估影响:满血场面仍能发动', ()=>{
  const g = mkGame(3, { gameMode:'ffa' });
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  assert.strictEqual(g.phase, 'luanwuChoose', '真人按钮仍应能发动');
  assert.strictEqual(g.luanwuUsed, true);
});

check('破坏性验证:评估恒 true 时满血场面会(错误地)发动,证明保留断言有鉴别力', ()=>{
  const exists = R('typeof botShouldStartLuanwu');
  assert.strictEqual(exists, 'function', '应存在 botShouldStartLuanwu 供评估/打桩');
  vm.runInContext('var __savedBotShouldStartLuanwu = botShouldStartLuanwu; botShouldStartLuanwu = function(){ return true; };', sandbox);
  try{
    const g = mkGame(3, { gameMode:'ffa' });
    const invoked = tryStart(g);
    if(invoked !== true) throw new Error('打桩恒 true 后应发动;若没有,说明发动分支没走评估函数');
  } finally {
    vm.runInContext('botShouldStartLuanwu = __savedBotShouldStartLuanwu;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
