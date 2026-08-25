/**
 * CORE-155/156(issue #214/#215):濒死跳过不能救的人 + 放弃日志脱敏 + 无人可救公共窗。
 *
 * 立刻跳过所有人会暴露「全场没桃」。无人可救时进 dyingPublicWait 停 4 秒。
 * 无懈公共窗改为 3 秒(原 1 秒)。放弃/询问日志不写玩家名。
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
function logs(g){ return (g.log||[]).map(l=>(l&&l.text)||String(l)).join('\n'); }

function mkPlayers(n){
  const out=[];
  for(let i=0;i<n;i++){
    out.push({
      name:'p'+i, general:'caocao', hp:4, maxHp:4, hand:[],
      equips:emptyEq(), delays:[], alive:true, dying:false
    });
  }
  return out;
}

console.log('\n== CORE-155/156:濒死跳过 + 公共窗 + 日志脱敏 ==\n');

check('无人可救:进入 dyingPublicWait,窗口≥4秒,不立刻阵亡', ()=>{
  const players = mkPlayers(3);
  players[1].hp = 0;
  const g = {
    phase:'play', turn:0, started:true, players, deck:[], discard:[],
    pending:null, log:[], gameMode:'ffa'
  };
  bindG(g);
  R('startDying')(g, 1, 'sha', 0, 1);
  assert.strictEqual(g.phase, 'dying');
  assert.strictEqual(g.pending.type, 'dyingPublicWait', '无人可救应进公共窗,实际 '+ (g.pending&&g.pending.type));
  assert.ok(g.pending.publicUntil - g.pending.askedAt >= 4000, '濒死公共窗应≥4秒');
  assert.strictEqual(g.players[1].alive, true, '窗口结束前不得阵亡');
  assert.ok(!/不使用【桃】/.test(logs(g)), '不得写不使用桃');
});

check('无桃玩家被跳过:只问有桃的人', ()=>{
  const players = mkPlayers(3);
  players[0].hp = 0;
  players[2].hand = [{id:'t1', name:'桃', suit:'♥', rank:3}];
  const g = {
    phase:'play', turn:0, started:true, players, deck:[], discard:[],
    pending:null, log:[], gameMode:'ffa'
  };
  bindG(g);
  R('startDying')(g, 0, 'sha', 1, 1);
  assert.strictEqual(g.pending.type, 'dying');
  assert.strictEqual(g.pending.asking, 2, '应跳过无桃的座位1,问有桃的座位2,实际 '+g.pending.asking);
});

check('有桃的人放弃:日志不写名字、不写「不使用【桃】」', ()=>{
  const players = mkPlayers(2);
  players[0].hp = 0;
  players[0].hand = [{id:'t1', name:'桃', suit:'♥', rank:3}];
  const g = {
    phase:'play', turn:0, started:true, players, deck:[], discard:[],
    pending:null, log:[], gameMode:'ffa'
  };
  bindG(g);
  R('startDying')(g, 0, 'sha', 1, 1);
  setSeat(0);
  R('respondDying')(false);
  const text = logs(g);
  assert.ok(!/p0：不使用【桃】/.test(text), '放弃不得带名字: '+text);
  assert.ok(!/不使用【桃】/.test(text), '不得写不使用桃: '+text);
});

check('无懈无人可出:公共窗≥3秒', ()=>{
  const players = mkPlayers(2);
  const g = {
    phase:'play', turn:0, started:true, players,
    deck:[{id:'d1',name:'杀',suit:'♣',rank:2},{id:'d2',name:'杀',suit:'♣',rank:3}],
    discard:[], pending:null, log:[], gameMode:'ffa'
  };
  bindG(g);
  R("startTrick(_g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.type, 'wuxiePublicWait');
  assert.ok(g.pending.publicUntil - g.pending.askedAt >= 3000, '无懈公共窗应≥3秒');
});

check('无懈放弃:日志不写「名字：不出」', ()=>{
  const players = mkPlayers(2);
  players[1].hand = [{id:'w1', name:'无懈可击', suit:'♠', rank:11}];
  const g = {
    phase:'play', turn:0, started:true, players,
    deck:[{id:'d1',name:'杀',suit:'♣',rank:2},{id:'d2',name:'杀',suit:'♣',rank:3}],
    discard:[], pending:null, log:[], gameMode:'ffa'
  };
  bindG(g);
  R("startTrick(_g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.asking, 1);
  setSeat(1);
  R('respondWuxie')(false);
  const text = logs(g);
  assert.ok(!/p1：不出/.test(text), '无懈放弃不得带名字: '+text);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
