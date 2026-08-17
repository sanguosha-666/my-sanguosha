/**
 * CORE-93(issue #140):流离转移目标后错误复用攻击者自身射程重新校验距离,导致合法转移
 * 被吞。
 *
 * 【根因】respondLiuli(game.js)转移后调用 resolveShaUseNoLiuli(...) 三处均省略第7参数
 * shaInfo。resolveShaUseNoLiuli(sha/sha-resolution.js)无条件重新校验"原攻击者→新目标"
 * 的距离——但流离的合法性已由 liuliTargets()(用大乔自己的攻击范围,canReachSha(g,to,o.i))
 * 校验过一次,不该用攻击者的射程二次校验。修复:三处调用统一补传 shaInfo={noDistance:true}
 * (和神速respondShensuSha同一套既有模式)。
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
});
vm.runInContext("var EQUIP_SLOT_LABEL={weapon:'武器',armor:'防具',plus1:'防御马',minus1:'进攻马'};",sandbox);

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

// 6人环形局。座位0=攻击者(无武器,射程1)。座位1=大乔(liuli)。其余座位闲置。
function mkGame(weaponRange){
  const attacker = mkPlayer('p0', 'caocao');
  const daqiao = mkPlayer('p1', 'daqiao');
  if (weaponRange) daqiao.equips.weapon = { id:'w1', name: weaponRange===3?'青龙偃月刀':'雌雄双股剑', suit:'♠', rank:5, range: weaponRange };
  const others = [2,3,4,5].map(i=>mkPlayer('p'+i, 'caocao'));
  attacker.hand = [{id:'s0', name:'杀', suit:'♠', rank:7}];
  daqiao.hand = [{id:'h1', name:'闪', suit:'♥', rank:2}];
  others.forEach((p,idx)=>{ p.hand = [{id:'h'+(idx+2), name:'闪', suit:'♥', rank:2}]; });
  return {
    phase:'play', turn:0, started:true, players:[attacker, daqiao, ...others],
    deck: Array.from({length:30},(_,i)=>({id:200+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[],
    shaUsed:false, gameMode:'ffa'
  };
}

console.log('\n== CORE-93:流离转移后不应重新校验攻击者自身射程 ==\n');

check('流离转移给大乔射程内、攻击者射程外的目标,应正常进入 respond 阶段(不应被吞)', ()=>{
  const g = mkGame(3); // 大乔装青龙偃月刀,射程3
  bindG(g);
  setSeat(0);
  R('playCard')(0, '杀', 1);
  assert.strictEqual(G().phase, 'liuli', '出杀后大乔有流离能力,应先挂起liuli询问');
  setSeat(1);
  const cands = R('liuliTargets')(G(), 0, 1);
  if(!cands.includes(4)) throw new Error('前置条件不成立:座位4应在大乔自己射程3内的候选里,实际 '+JSON.stringify(cands));
  R('respondLiuli')({kind:'hand',idx:0}, 4);
  const gg = G();
  assert.strictEqual(gg.phase, 'respond', '转移后座位4应进入respond阶段等待出闪,实际phase='+gg.phase);
  assert.ok(gg.pending && gg.pending.to===4, '响应对象应是座位4');
  assert.ok(!gg.log.some(l=>(l.text||'').indexOf('攻击距离不足')>=0), '不应出现"攻击距离不足"的错误判定');
});

check('破坏性验证:模拟旧写法(省略noDistance)同样场景会被"攻击距离不足"吞掉(证明断言有鉴别力)', ()=>{
  const savedFn = R('resolveShaUseNoLiuli');
  vm.runInContext(`
    var __savedResolveShaUseNoLiuli = resolveShaUseNoLiuli;
    resolveShaUseNoLiuli = function(g, me, targetSeat, usedAs, shaColor, sourceCard){
      var fromSeat = g.players.indexOf(me), target = g.players[targetSeat];
      if(!canReachSha(g, fromSeat, targetSeat)){
        g.log = pushLog(g.log, me.name + ' 对 ' + target.name + ' 的攻击距离不足');
        finishSingleShaTarget(g);
        return;
      }
      return __savedResolveShaUseNoLiuli.apply(this, arguments);
    };
  `, sandbox);
  try{
    const g = mkGame(3);
    bindG(g);
    setSeat(0);
    R('playCard')(0, '杀', 1);
    setSeat(1);
    R('respondLiuli')({kind:'hand',idx:0}, 4);
    const gg = G();
    if(gg.phase !== 'play') throw new Error('旧写法下应该(错误地)把杀吞掉、回到play阶段,实际phase='+gg.phase);
    if(!gg.log.some(l=>(l.text||'').indexOf('攻击距离不足')>=0))
      throw new Error('旧写法下应该(错误地)出现"攻击距离不足",如果没有说明上面的断言对这段逻辑没有鉴别力');
  } finally {
    vm.runInContext('resolveShaUseNoLiuli = __savedResolveShaUseNoLiuli;', sandbox);
  }
});

check('对照组:大乔自身射程外的目标本就不在候选里(liuliTargets零回归)', ()=>{
  const g = mkGame(1); // 大乔无武器,射程1
  bindG(g);
  const cands = R('liuliTargets')(G(), 0, 1);
  if(cands.includes(4)) throw new Error('大乔射程1时座位4(距离3)不该在候选里,实际 '+JSON.stringify(cands));
  if(!cands.includes(2)) throw new Error('大乔射程1时相邻座位2应在候选里,实际 '+JSON.stringify(cands));
});

check('"不发动"分支零回归:取消流离后原目标(大乔自己)仍正常进入respond阶段', ()=>{
  const g = mkGame(3);
  bindG(g);
  setSeat(0);
  R('playCard')(0, '杀', 1);
  setSeat(1);
  R('respondLiuli')(null, null);
  const gg = G();
  assert.strictEqual(gg.phase, 'respond', '不发动流离后应回到原目标(大乔自己)的响应阶段,实际phase='+gg.phase);
  assert.ok(gg.pending && gg.pending.to===1, '响应对象应仍是大乔自己(座位1)');
});

check('弃装备发动流离转移后同样不应被吞', ()=>{
  const g = mkGame(3);
  // 装防具(不影响距离,不像+1马那样会让攻击者一开始就够不到大乔本人)
  g.players[1].equips.armor = { id:'armor1', name:'八卦阵' };
  bindG(g);
  setSeat(0);
  R('playCard')(0, '杀', 1);
  setSeat(1);
  R('respondLiuli')({kind:'equip',slot:'armor'}, 4);
  const gg = G();
  assert.strictEqual(gg.phase, 'respond', '弃装备发动流离转移后座位4应进入respond阶段,实际phase='+gg.phase);
  assert.ok(gg.pending && gg.pending.to===4, '响应对象应是座位4');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
