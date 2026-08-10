/**
 * 修复:周泰【不屈】触发次数——一次伤害如果让"体力降到0或以下"的部分有N点,
 * 就该连续问N次是否放置不屈牌,而不是不管扣了几点血都只问一次。
 *
 * 公式:overkillPoints = max(0, min(amount, amount - max(hpBeforeThisDamage-1, 0)))
 * 推导见 game.js dealDamage 注释——把 amount 点伤害看成 amount 次连续的-1,第k次扣完后
 * 的体力是 hpBefore-k;结果>0(不落在"降到0或以下"区间)的次数 = max(hpBefore-1,0),
 * 其余次数(amount 减去这部分)才落在区间内,需要逐次询问。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = __dirname;
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

['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>{
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
    hand: [], equips: emptyEq(), delays: [], alive: true, dying: false, buquCards: []
  }, extra||{});
}
// 牌堆:全部用同一个点数,保证不会意外触发"点数唯一"防死条件(测试要精确控制触发次数,
// 不希望半路因为点数凑巧唯一而提前结束——除非某条用例就是要测这个,会单独构造)
function sameRankDeck(n, rank){
  const arr=[];
  for(let i=0;i<n;i++) arr.push({id:'d'+i, name:'杀', suit:'♠', rank: rank||3});
  return arr;
}

console.log('\n== 周泰【不屈】触发次数按扣血点数逐次询问 ==\n');

// 场景1:体力已经是0,被酒杀(2点伤害)命中 —— 应连续问2次
check('体力0血,受2点伤害:连续问2次是否发动不屈', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:0, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: sameRankDeck(10), discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null);
  let gg = G();
  assert.strictEqual(gg.phase, 'buquAsk');
  assert.strictEqual(gg.pending.remaining, 2, '应设置remaining=2,实际 '+gg.pending.remaining);

  setSeat(0);
  R('respondBuqu')(false); // 第1次:不发动
  gg = G();
  assert.strictEqual(gg.phase, 'buquAsk', '第1次不发动后应该继续问第2次,而不是直接进濒死');
  assert.strictEqual(gg.pending.remaining, 1, '剩余次数应减到1,实际 '+gg.pending.remaining);

  R('respondBuqu')(false); // 第2次:不发动
  gg = G();
  assert.strictEqual(gg.phase, 'dying', '2次问完(都不发动)才应进入濒死,实际 '+gg.phase);
});

// 场景2:体力是1,被酒杀(2点伤害)命中,一次性打到-1 —— 公式:
// overkillPoints = amount - max(hpBefore-1,0) = 2 - max(0,0) = 2,应问2次
check('体力1血,受2点伤害打到-1:公式算出2次(两点都落在≤0区间)', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:1, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: sameRankDeck(10), discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null);
  let gg = G();
  assert.strictEqual(gg.phase, 'buquAsk');
  assert.strictEqual(gg.pending.remaining, 2, '体力1血挨2点应算出2次,实际 '+gg.pending.remaining);
  assert.strictEqual(zt.hp, -1, '体力应扣到-1');

  setSeat(0);
  R('respondBuqu')(false);
  gg = G();
  assert.strictEqual(gg.pending.remaining, 1);
  R('respondBuqu')(false);
  gg = G();
  assert.strictEqual(gg.phase, 'dying', '2次问完才进入濒死,实际 '+gg.phase);
});

// 场景3(对照):体力3,受2点伤害,打到1(没有降到0以下) —— 不屈完全不触发
check('对照:体力3血受2点伤害打到1,不屈不触发(原有逻辑不受影响)', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:3, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: sameRankDeck(10), discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null);
  const gg = G();
  assert.strictEqual(gg.phase, 'play', '不应进入buquAsk,实际 '+gg.phase);
  assert.strictEqual(zt.hp, 1);
  assert.strictEqual(gg.pending, null);
});

// 场景4:询问过程中途不屈牌堆够了(点数唯一)——提前回复体力,不应继续问剩余次数
check('中途凑够点数唯一提前回体,不会继续问剩余次数', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:0, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  // 精心构造牌堆:第一张rank=3,第二张rank=5(点数不同,凑够"唯一"条件)
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: [ {id:'d2', name:'杀', suit:'♠', rank:5}, {id:'d1', name:'杀', suit:'♠', rank:3} ], // pop()从末尾取,先拿到rank3
    discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null); // hp0挨2点->remaining=2
  let gg = G();
  assert.strictEqual(gg.pending.remaining, 2);

  setSeat(0);
  R('respondBuqu')(true); // 第1次:放置rank3,此时只有1张,不满足"唯一"(需要>=1张即算唯一?)
  gg = G();
  // checkBuquUnique 要求 ranks.length>0 且各不相同——1张牌本身就满足"各不相同"(数组内没有重复),
  // 所以放第一张就会触发"防死"逻辑,直接回体力,不会再问第二次。
  assert.strictEqual(gg.phase !== 'buquAsk', true, '放置第1张后应已回体力/接回原流程,不应再停留buquAsk,实际 '+gg.phase);
  assert.strictEqual(zt.hp, 0, '防死后体力应为0');
  assert.strictEqual(zt.buquCards.length, 1, '应只放置了1张不屈牌就提前结束,不应再放第2张');
});

// 场景4b:每次放置都独立重新检查(不是等N次问完才统一检查一次)——已有一张不屈牌,
// 第1次放置的新牌和已有那张点数重复(永久破坏"全部唯一",checkBuquUnique 要求所有牌
// 两两不同),之后不管再放几张都不可能再凑齐唯一;验证这种情况下会正确问完remaining次
// 后老实进入濒死流程,而不是错误地在某次放置后又判定成功。
check('多次放置逐次检查:首次放置即和已有牌重复,后续不可能再凑齐→问完remaining后濒死', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:0, caps:{buqu:true}, buquCards:[{id:'old', name:'杀', suit:'♥', rank:3}]});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    // 两张都是rank3,和已有old(rank3)一起构成3张重复点数,永远无法凑齐"全部唯一"
    deck: [ {id:'d2', name:'杀', suit:'♠', rank:3}, {id:'d1', name:'杀', suit:'♠', rank:3} ],
    discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null); // remaining=2
  setSeat(0);
  R('respondBuqu')(true); // 放第1张rank3,和已有old(rank3)重复,不唯一,继续问
  let gg = G();
  assert.strictEqual(gg.phase, 'buquAsk', '第1次放置后点数重复,应继续问第2次,实际 '+gg.phase);
  assert.strictEqual(gg.pending.remaining, 1);
  assert.strictEqual(zt.buquCards.length, 2, '第1次放置应已计入不屈牌堆');

  R('respondBuqu')(true); // 放第2张仍是rank3,继续重复,remaining耗尽
  gg = G();
  assert.strictEqual(gg.phase, 'dying', '问完remaining次仍无法凑齐唯一,应进入濒死,实际 '+gg.phase);
  assert.strictEqual(zt.buquCards.length, 3, '两次都成功放置,应有3张不屈牌');
});

// 场景5:牌堆中途耗尽——提前进入濒死流程,不会卡住
check('牌堆中途耗尽:提前进入濒死流程,不会因为牌不够而卡住', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:0, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: [ {id:'d1', name:'杀', suit:'♠', rank:3} ], // 只有1张牌,够第1次不够第2次
    discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null); // remaining=2,牌堆有1张,足够开始第1次询问
  let gg = G();
  assert.strictEqual(gg.phase, 'buquAsk');
  assert.strictEqual(gg.pending.remaining, 2);

  setSeat(0);
  R('respondBuqu')(false); // 第1次不发动(不消耗牌堆),remaining->1,但此时牌堆还有1张,应该继续问
  gg = G();
  assert.strictEqual(gg.phase, 'buquAsk', '牌堆还有牌时应继续问,实际 '+gg.phase);

  R('respondBuqu')(true); // 第2次选择发动,取走最后1张牌,不唯一/唯一都行——重点是这之后remaining会降到0
  gg = G();
  // 不论这次是否凑齐唯一,流程都不应再卡在buquAsk(remaining已耗尽,或成功防死/或牌堆空)
  assert.notStrictEqual(gg.phase, 'buquAsk', '流程不应卡在buquAsk,实际 '+gg.phase);
});

// 场景5b:牌堆在第1次询问前就已经空——不进入buquAsk,直接濒死(复用原有防御分支)
check('牌堆一开始就是空的:不进入buquAsk,直接濒死', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:0, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: [], discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 2, 1, '酒杀', 'sha', null);
  const gg = G();
  assert.strictEqual(gg.phase, 'dying', '牌堆为空应直接濒死,实际 '+gg.phase);
});

// 场景6:单点伤害维持改动前行为——只问1次(零回归)
check('回归:单点伤害(amount=1)命中hp<=0仍只问1次,行为零变化', ()=>{
  const zt = mkPlayer('周泰','zhoutai', {hp:1, caps:{buqu:true}});
  const other = mkPlayer('其他','yuJi');
  const g = {
    phase:'play', turn:1, started:true, players:[zt, other],
    deck: sameRankDeck(10), discard:[], pending:null, log:[], exchangeCards:[], gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g, 0, 1, 1, '杀', 'sha', null);
  let gg = G();
  assert.strictEqual(gg.phase, 'buquAsk');
  assert.strictEqual(gg.pending.remaining, 1, '单点伤害应仍只问1次,实际 '+gg.pending.remaining);

  setSeat(0);
  R('respondBuqu')(false);
  gg = G();
  assert.strictEqual(gg.phase, 'dying', '问完1次(不发动)即应进入濒死,实际 '+gg.phase);
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败\n');
if(failed>0) process.exit(1);
