/**
 * CORE-181(issue #240):别人濒死时手上只有酒仍被询问救不救。
 *
 * 连环 chainDamageQueue 曾绕过 canRescueSeat，救不了别人的人也会被问。
 * 连环仍要逐个濒死结算，但不能问所有人；无人可救时不要进 dyingPublicWait 吞队列。
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
 'weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js'
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

function mkPlayers(){
  return [
    {name:'甲',general:'caocao',hp:4,maxHp:4,hand:[{id:'j1',name:'酒',suit:'♠',rank:3}],equips:emptyEq(),delays:[],alive:true,dying:false},
    {name:'乙',general:'liubei',hp:0,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true,dying:false},
    {name:'丙',general:'sunquan',hp:4,maxHp:4,hand:[{id:'t1',name:'桃',suit:'♥',rank:3}],equips:emptyEq(),delays:[],alive:true,dying:false}
  ];
}

console.log('\n== CORE-181 别人濒死只有酒不被问 ==\n');

check('无连环:别人濒死,甲只有酒 → 跳过甲,问有桃的丙', ()=>{
  const g = {phase:'play',turn:0,started:true,players:mkPlayers(),deck:[],discard:[],pending:null,log:[],gameMode:'ffa'};
  bindG(g);
  R('startDying')(g, 1, 'sha', 0, 1);
  assert.strictEqual(g.pending.type, 'dying');
  assert.strictEqual(g.pending.asking, 2, '应问有桃的丙,实际 '+g.pending.asking);
  assert.strictEqual(R('canRescueSeat(_g,0,1)'), false);
});

check('连环:别人濒死,甲只有酒,丙有桃 → 仍跳过甲,问丙', ()=>{
  const g = {
    phase:'play',turn:0,started:true,players:mkPlayers(),deck:[],discard:[],pending:null,log:[],gameMode:'ffa',
    chainDamageQueue:{targets:[1,2], idx:0, originalSeat:0, amount:1}
  };
  bindG(g);
  R('startDying')(g, 1, 'sha', 0, 1);
  assert.strictEqual(g.pending.type, 'dying', '连环有人可救不应进公共窗');
  assert.strictEqual(g.pending.asking, 2, '连环也应跳过只有酒的甲,问丙,实际 '+g.pending.asking);
});

check('连环:无人可救 → 不进 dyingPublicWait,直接阵亡并继续队列', ()=>{
  const players = mkPlayers();
  players[2].hand = [{id:'j2',name:'酒',suit:'♣',rank:3}];
  players[2].hp = 4;
  const g = {
    phase:'play',turn:0,started:true,players,deck:[],discard:[],pending:null,log:[],gameMode:'ffa',
    chainDamageQueue:{targets:[2], idx:0, originalSeat:0, amount:1, sourceSeat:0, srcType:'sha', finalResume:{type:'sha'}}
  };
  bindG(g);
  R('startDying')(g, 1, 'sha', 0, 1);
  assert.notStrictEqual(g.pending && g.pending.type, 'dyingPublicWait', '连环无人可救不应进公共窗');
  assert.strictEqual(g.players[1].alive, false, '无人可救应阵亡');
  assert.ok(g.players[2].hp < 4, '队列应继续打下一个传导目标,丙体力='+g.players[2].hp);
});

check('自己濒死有酒仍问自救', ()=>{
  const players = mkPlayers();
  players[0].hp = 0;
  const g = {phase:'play',turn:1,started:true,players,deck:[],discard:[],pending:null,log:[],gameMode:'ffa'};
  bindG(g);
  R('startDying')(g, 0, 'sha', 1, 1);
  assert.strictEqual(g.pending.asking, 0, '自己有酒应先问自救');
});

check('华佗红酒急救:别人濒死仍问', ()=>{
  const players = mkPlayers();
  players[0].general = 'huatuo';
  players[0].hand = [{id:'j1',name:'酒',suit:'♥',rank:3}];
  players[2].hand = [];
  const g = {phase:'play',turn:1,started:true,players,deck:[],discard:[],pending:null,log:[],gameMode:'ffa'};
  bindG(g);
  assert.strictEqual(R('hasCap(_g.players[0],"jijiu")'), true);
  R('startDying')(g, 1, 'sha', 2, 1);
  assert.strictEqual(g.pending.asking, 0, '华佗红酒应被问急救,实际 '+ (g.pending&&g.pending.asking));
});

console.log('\ncore181 dying jiu ask: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
