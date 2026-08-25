/**
 * CORE-159(issue #218):AI 太史慈反复发动天义再取消形成循环。
 *
 * botTryStartExtraSkills 天义分支只检查「其他存活且有手牌」,不叠加阵营策略。
 * tianyiPickTarget 用 pickBestCandidateSeat('damage')——全部候选被策略禁止时返回 null,
 * 走 cancelTianyi。cancelTianyi 只清 pending、回 play,不置 g.tianyiUsed。
 * 下一轮 play 条件仍成立 → 再发动 → 再取消。
 *
 * 与 CORE-96 强袭同型:发动检查与选目标检查口径不一致。
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
function card(name, id){ return { id: id||name, name, suit:'♠', rank:7 }; }

// 4人身份局。座位0=太史慈(机器人)。默认:1=主公有手牌,2/3空手牌。
function mkIdentity(seat0Role, opts){
  opts = opts || {};
  const players = [];
  for(let i=0;i<4;i++){
    players.push({
      name:'p'+i, general: i===0 ? 'taishici' : 'caocao',
      hp:4, maxHp:4, hand:[], equips: emptyEq(), delays:[],
      alive:true, dying:false, role:null, roleRevealed:false, isBot: i===0
    });
  }
  players[0].role = seat0Role;
  players[0].caps = { tianyi:true };
  players[0].hand = [card('杀','a0'), card('闪','a1')];
  players[1].role = 'zhu';
  players[1].hand = [card('桃','h1')];
  players[2].role = opts.seat2Role || 'zhong';
  if(opts.seat2Revealed) players[2].roleRevealed = true;
  if(opts.seat2Hand) players[2].hand = opts.seat2Hand;
  players[3].role = opts.seat3Role || 'fan';
  if(opts.seat3Revealed) players[3].roleRevealed = true;
  if(opts.seat3Hand) players[3].hand = opts.seat3Hand;
  return {
    phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:800+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false,
    tianyiUsed:false, aiRebelSuspicion:{}
  };
}

function tryStart(g){
  bindG(g);
  setSeat(0);
  return R('botTryStartExtraSkills')(g, 0);
}

console.log('\n== CORE-159:天义发动-取消循环 ==\n');

check('忠臣太史慈:唯一有手牌的是主公 → 不应发动', ()=>{
  const g = mkIdentity('zhong');
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '不该对唯一主公发动天义');
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.tianyiUsed, false);
});

check('反贼太史慈:主公有手牌 → 应发动', ()=>{
  const g = mkIdentity('fan');
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '反贼对主公应发动天义');
  assert.strictEqual(g.phase, 'tianyiPickCard');
});

check('组队:唯一有手牌的是队友 → 不应发动', ()=>{
  const g = mkIdentity('zhong');
  g.gameMode = 'team';
  g.players.forEach((p,i)=>{ p.team = (i<2)?0:1; p.role = null; });
  g.players[2].hand = [];
  g.players[3].hand = [];
  const invoked = tryStart(g);
  assert.strictEqual(invoked, false, '不该对唯一队友发动天义');
});

check('组队:异队有手牌 → 应发动', ()=>{
  const g = mkIdentity('zhong');
  g.gameMode = 'team';
  g.players.forEach((p,i)=>{ p.team = (i<2)?0:1; p.role = null; });
  g.players[1].hand = [];
  g.players[2].hand = [card('杀','e1')];
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, '异队有手牌应发动');
});

check('FFA 零回归:有其他存活有手牌仍发动', ()=>{
  const g = mkIdentity('zhong');
  g.gameMode = 'ffa';
  const invoked = tryStart(g);
  assert.strictEqual(invoked, true, 'FFA 不套身份硬禁');
});

check('cancelTianyi 后本回合视为已用,不能再 startTianyi', ()=>{
  const g = mkIdentity('fan');
  bindG(g);
  setSeat(0);
  R('startTianyi')();
  assert.strictEqual(g.phase, 'tianyiPickCard');
  R('cancelTianyi')();
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.tianyiUsed, true, '取消应置 tianyiUsed,堵住再发动');
  const again = R('startTianyi');
  again();
  assert.strictEqual(g.phase, 'play', '已标记用过后再点天义应被拒绝');
  assert.strictEqual(g.pending, null);
});

check('选目标全被策略禁止时取消后,第二次 botTryStartExtraSkills 不再发动', ()=>{
  const g = mkIdentity('zhong');
  bindG(g);
  setSeat(0);
  R('startTianyi')();
  R('pickTianyiCard')(0);
  assert.strictEqual(g.phase, 'tianyiPickTarget');
  const target = R('pickBestCandidateSeat')(g, 0, [{seat:1},{seat:2},{seat:3}], 'damage');
  assert.strictEqual(target, null, '预条件:策略过滤后无目标');
  R('cancelTianyi')();
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '取消后不应再发动,否则就是循环');
  assert.strictEqual(g.phase, 'play');
});

check('破坏性验证:去掉策略过滤后忠臣会对主公发动(证明断言有鉴别力)', ()=>{
  vm.runInContext('var __savedBotTargetPolicyAllows = botTargetPolicyAllows; botTargetPolicyAllows = function(){ return true; };', sandbox);
  try{
    const g = mkIdentity('zhong');
    const invoked = tryStart(g);
    if(invoked !== true) throw new Error('去掉过滤后应该(错误地)发动;若没有,说明发动分支没走策略谓词');
  } finally {
    vm.runInContext('botTargetPolicyAllows = __savedBotTargetPolicyAllows;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
