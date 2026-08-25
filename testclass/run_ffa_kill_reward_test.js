/**
 * CORE-160(issue #219):非身份局击杀奖励——杀人后摸两张牌。
 *
 * applyIdentityKillReward 原来首行 `if(g.gameMode!=='identity') return`,
 * ffa/team 击杀没有任何奖励。身份局原奖惩(杀反摸三、主杀忠弃牌)必须零回归。
 *
 * 规则:杀手存活且击杀他人 → drawN(2);自杀/同归于尽(杀手已死)不摸;
 * 无来源(闪电,killerSeat 非数字)不摸。
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
 'weapons.js','skills.js'
].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
});

function R(code){ return vm.runInContext(code, sandbox); }
function emptyEq(){ return R('emptyEquips')(); }

function mkG(mode, opts){
  opts = opts || {};
  return {
    gameMode: mode,
    deck: Array.from({length:10}, (_,i)=>({id:i, name:'杀', suit:'♠', rank:1})),
    discard:[], log:[],
    players:[
      { name:'死者', alive:false, hand:[], equips:emptyEq(), delays:[], role:opts.victimRole||null },
      {
        name:'杀手', alive: opts.killerAlive!==false, hand:[],
        equips:emptyEq(), delays:[], hp:4, maxHp:4, role:opts.killerRole||null
      }
    ]
  };
}

function logText(g){
  return (g.log||[]).map(l=> (l && l.text) || String(l)).join('\n');
}

console.log('\n== CORE-160:非身份局击杀摸两张 ==\n');

check('FFA:杀手存活击杀他人 → 摸两张 + 日志', ()=>{
  const g = mkG('ffa');
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 2, '应摸2张,实际 '+g.players[1].hand.length);
  assert.ok(logText(g).indexOf('击杀')>=0 && logText(g).indexOf('摸两张')>=0,
    '应有击杀摸两张日志: '+logText(g));
});

check('组队:杀手存活击杀他人 → 摸两张', ()=>{
  const g = mkG('team');
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 2);
});

check('FFA:杀手已死(自杀/同归于尽) → 不摸', ()=>{
  const g = mkG('ffa', { killerAlive:false });
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 0);
});

check('FFA:无来源(闪电,killerSeat 非数字) → 不摸、不抛', ()=>{
  const g = mkG('ffa');
  assert.doesNotThrow(()=>{ R('applyIdentityKillReward')(g, 0, undefined); });
  assert.strictEqual(g.players[1].hand.length, 0);
});

check('身份局零回归:杀反仍摸三张,不是两张', ()=>{
  const g = mkG('identity', { victimRole:'fan', killerRole:'zhu' });
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 3);
  assert.ok(logText(g).indexOf('杀死反贼，摸三张牌')>=0, logText(g));
});

check('身份局零回归:主杀忠仍弃牌,不摸两张', ()=>{
  const g = mkG('identity', { victimRole:'zhong', killerRole:'zhu' });
  g.players[1].hand = [{id:99,name:'闪',suit:'♥',rank:2}];
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 0, '主杀忠应弃手牌');
});

check('大厅/未知模式不摸', ()=>{
  const g = mkG(null);
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 0);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
