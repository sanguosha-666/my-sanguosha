/**
 * 修复:贾诩【完杀】的濒死轮询没有跳过限制范围外的座位。
 *
 * 根因:respondDying 只在"某人真的选择用桃"时拦截完杀限制(静默拒绝),但濒死流程
 * "按座位顺序依次问是否救援"的推进逻辑(nextAskee)没有感知完杀限制,导致贾诩回合内
 * 让人濒死时,除贾诩本人和濒死者外的其他角色依然会被正常问一轮(问了也白问)。
 * 修复:respondDying 的"不救→推进到下一个该问的座位"改用新写的 nextDyingAskee,
 * 完杀生效期间(g.wanshaActive && g.wanshaDyingSeat===当前濒死者)只在贾诩本人/
 * 濒死者本人之间跳转,中间座位直接跳过、不产生等待响应的 pending。
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

['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  if(f==='game.js'){
    vm.runInContext(`
      tx = function(fn){ if(typeof _g==='undefined'||!_g) return; return fn(_g); };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
      var _g = null;
    `, sandbox);
  }
  console.log('  OK', f);
});

function R(code){ return vm.runInContext(code, sandbox); }
function bindG(g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function G(){ return vm.runInContext('_g', sandbox); }
function setSeat(s){ vm.runInContext('mySeat='+s+';', sandbox); }

function emptyEq(){ return R('emptyEquips')(); }
function mkPlayer(name, genId, extra){
  const gen = R('getGeneral')(genId);
  return Object.assign({
    name, general: genId, gender: gen&&gen.gender,
    hp: gen?gen.maxHp:4, maxHp: gen?gen.maxHp:4,
    hand: [], equips: emptyEq(), delays: [], alive: true, dying: false
  }, extra||{});
}

console.log('\n== 贾诩【完杀】濒死轮询跳过限制外座位 ==\n');

// 场景1:贾诩(座位0)回合内,座位2 濒死,场上还有座位1/3/4 —— 只应问 座位2(濒死者)和座位0(贾诩)
check('完杀生效:轮询只问濒死者本人和贾诩,其余座位被跳过(不产生等待响应的pending)', ()=>{
  const jiaxu = mkPlayer('贾诩','jiaxu', {hand:[{id:'jt',name:'桃',suit:'♥',rank:3}]});
  const p1 = mkPlayer('玩家1','yuJi');
  const dyingP = mkPlayer('濒死者','yuJi', {hp:0, hand:[{id:'dt',name:'桃',suit:'♥',rank:4}]});
  const p3 = mkPlayer('玩家3','yuJi');
  const p4 = mkPlayer('玩家4','yuJi');
  const g = {
    phase:'play', turn:0, started:true, players:[jiaxu,p1,dyingP,p3,p4],
    deck:[], discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa',
    wanshaActive:false, wanshaDyingSeat:null
  };
  bindG(g);
  R('startDying')(g, 2, 'sha');
  let gg = G();
  assert.strictEqual(gg.wanshaActive, true, '完杀应生效');
  assert.strictEqual(gg.wanshaDyingSeat, 2, '完杀限制的应是座位2');
  assert.strictEqual(gg.pending.asking, 2, '起点应问濒死者本人');

  // 濒死者(2)不救 -> 应直接跳到贾诩(0),跳过1/3/4
  setSeat(2);
  R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.phase, 'dying', '流程未结束');
  assert.strictEqual(gg.pending.asking, 0, '应跳过座位1/3/4直接问贾诩,实际问了 '+gg.pending.asking);

  // 贾诩(0)不救 -> 问完一圈(只有0和2两人),无人救,死亡结算
  setSeat(0);
  R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.phase !== 'dying', true, '两人都不救应结束濒死流程,实际仍在 '+gg.phase);
  assert.strictEqual(dyingP.alive, false, '两人都不救,濒死者应阵亡');
});

// 场景1b:确认非贾诩/非濒死者的座位全程没有被问过(逐一验证不会意外落在1/3/4上)
check('完杀生效:座位1/3/4全程不会被 asking 命中', ()=>{
  const jiaxu = mkPlayer('贾诩','jiaxu', {hand:[{id:'jt',name:'桃',suit:'♥',rank:3}]});
  const p1 = mkPlayer('玩家1','yuJi');
  const dyingP = mkPlayer('濒死者','yuJi', {hp:0, hand:[{id:'dt',name:'桃',suit:'♥',rank:4}]});
  const p3 = mkPlayer('玩家3','yuJi');
  const p4 = mkPlayer('玩家4','yuJi');
  const g = {
    phase:'play', turn:0, started:true, players:[jiaxu,p1,dyingP,p3,p4],
    deck:[], discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa',
    wanshaActive:false, wanshaDyingSeat:null
  };
  bindG(g);
  R('startDying')(g, 2, 'sha');
  const askedSeats = [G().pending.asking];
  setSeat(2); R('respondDying')(false); askedSeats.push(G().pending && G().pending.asking);
  setSeat(0); R('respondDying')(false); // 结束
  assert.ok(!askedSeats.includes(1) && !askedSeats.includes(3) && !askedSeats.includes(4),
    '不应问到座位1/3/4,实际询问序列 '+JSON.stringify(askedSeats));
});

// 场景2:贾诩本人恰好是濒死者(座位0) —— 只应问这一个人
check('边界:贾诩本人濒死时,只问贾诩自己一人,不救即直接死亡结算', ()=>{
  const jiaxu = mkPlayer('贾诩','jiaxu', {hp:0, hand:[{id:'jt',name:'桃',suit:'♥',rank:3}]});
  const p1 = mkPlayer('玩家1','yuJi');
  const p2 = mkPlayer('玩家2','yuJi');
  const g = {
    phase:'play', turn:0, started:true, players:[jiaxu,p1,p2],
    deck:[], discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa',
    wanshaActive:false, wanshaDyingSeat:null
  };
  bindG(g);
  R('startDying')(g, 0, 'sha');
  let gg = G();
  assert.strictEqual(gg.wanshaActive, true);
  assert.strictEqual(gg.wanshaDyingSeat, 0);
  assert.strictEqual(gg.pending.asking, 0, '应先问贾诩自己');

  setSeat(0);
  R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.phase !== 'dying', true, '贾诩本人不救应结束濒死流程,实际仍在 '+gg.phase);
  assert.strictEqual(jiaxu.alive, false, '贾诩本人不救(无其他人可问)应阵亡');
});

// 场景3:非贾诩回合内让人濒死 —— 完杀不生效,原有"依次问所有人"逻辑不受影响
check('对照:非贾诩回合完杀不生效,依次问所有存活玩家', ()=>{
  const jiaxu = mkPlayer('贾诩','jiaxu', {hand:[{id:'t0',name:'桃',suit:'♥',rank:2}]});
  const p1 = mkPlayer('玩家1','yuJi', {hand:[{id:'t1',name:'桃',suit:'♥',rank:3}]});
  const dyingP = mkPlayer('濒死者','yuJi', {hp:0, hand:[{id:'t2',name:'桃',suit:'♥',rank:4}]});
  const p3 = mkPlayer('玩家3','yuJi', {hand:[{id:'t3',name:'桃',suit:'♥',rank:5}]});
  const g = {
    phase:'play', turn:3, started:true, players:[jiaxu,p1,dyingP,p3], // turn=3,不是贾诩(0)的回合
    deck:[], discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa',
    wanshaActive:false, wanshaDyingSeat:null
  };
  bindG(g);
  R('startDying')(g, 2, 'sha');
  let gg = G();
  assert.strictEqual(gg.wanshaActive, false, '非贾诩回合完杀不应生效');
  assert.strictEqual(gg.pending.asking, 2);

  setSeat(2); R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.pending.asking, 3, '应依次问下一个存活玩家(座位3),实际 '+gg.pending.asking);

  setSeat(3); R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.pending.asking, 0, '应继续问座位0(贾诩,此处只是普通玩家身份),实际 '+gg.pending.asking);

  setSeat(0); R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.pending.asking, 1, '应继续问座位1,实际 '+gg.pending.asking);

  setSeat(1); R('respondDying')(false);
  gg = G();
  assert.strictEqual(gg.phase !== 'dying', true, '问完一圈无人救应结束濒死流程,实际仍在 '+gg.phase);
  assert.strictEqual(dyingP.alive, false, '问完一圈无人救,濒死者应阵亡');
});

check('多个完杀拥有者:当前回合的后扫描拥有者仍正常发动', ()=>{
  const first = mkPlayer('先扫描完杀','jiaxu');
  const p1 = mkPlayer('玩家1','yuJi');
  const dyingP = mkPlayer('濒死者','yuJi',{hp:0, hand:[{id:'dt',name:'桃',suit:'♥',rank:4}]});
  const current = mkPlayer('当前回合完杀','jiaxu', {hand:[{id:'ct',name:'桃',suit:'♥',rank:3}]});
  const g={phase:'play',turn:3,started:true,players:[first,p1,dyingP,current],deck:[],discard:[],pending:null,log:[],exchangeCards:[],gameMode:'ffa',wanshaActive:false,wanshaDyingSeat:null};
  bindG(g);
  R('startDying')(g,2,'sha');
  assert.strictEqual(g.wanshaActive,true,'不能因座位0先被扫描到而让座位3的完杀失效');
  assert.ok((g.log||[]).some(entry=>(entry.text||entry).includes('当前回合完杀')),'日志应记录真正的当前回合完杀拥有者');
  setSeat(2); R('respondDying')(false);
  assert.strictEqual(g.pending.asking,3,'应跳过非当前回合的另一名完杀拥有者,直接问座位3');
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败\n');
if(failed>0) process.exit(1);
