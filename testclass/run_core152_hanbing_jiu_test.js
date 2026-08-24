/**
 * CORE-152(issue #211):酒杀在「装备寒冰剑但选择不发动」时不得丢失 +1 伤害。
 *
 * 寒冰剑的询问分支排在正常结算**之前**就 return 了,而那条正常结算才是把酒加成
 * (damageAmount 的 options.jiuBonus)和古锭刀加成算进去的地方。改动前 hanbingAsk 的
 * pending 只存了 from/to/sourceCard,"不发动"分支补伤害时无从取用 → 酒的 +1 丢失。
 *
 * 关联:CORE-151(#210,多目标杀队列)、#135(已关闭,贯石斧路径)是同一类问题的另外两个入口
 * —— jiuBonus 需要在【杀】结算链的**每一次跨 pending 往返**中显式透传。
 */

/**
 * 身份模式(主公局)回归 — 随实现逐步扩展断言。
 * 规格: docs/superpowers/specs/2026-07-19-identity-mode-design.md
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.stack||e.message); failed++; }
}

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(fn){ const r=fn(function(){}); if(typeof r==='function') r(); return {}; },
      set(){}, update(){}, child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; }
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
      src:'', style:{}, className:'', id:'', textContent:'', innerHTML:'',
      onclick:null, disabled:false, setAttribute(){}, getAttribute(){ return null; },
      appendChild(){ return {}; }, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){ return {}; } }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} },
    addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    addEventListener(){}, removeEventListener(){},
    setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;

const sandbox = vm.createContext(context);
const files = ['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'];
console.log('Loading...\n');
files.forEach(f=>{
  const code = fs.readFileSync(path.join(ROOT,f),'utf8');
  vm.runInContext(code, sandbox, { filename:f });
  if(f==='game.js'){
    // 真实 tx:对共享 _g 做 transaction
    vm.runInContext(`
      var _g = null;
      tx = function(fn){
        if(!_g) return;
        // 与生产 tx 保持一致：Firebase 读回的空数组可能缺失，业务函数执行前必须 normalize。
        // 否则随机选到左慈时 huashenPool 为 undefined，测试会偶发在 .length 处崩溃。
        normalize(_g);
        const r = fn(_g);
        return r === undefined ? _g : r;
      };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
    `, sandbox);
  }
  console.log('  OK', f);
});

// 暴露测试用 setter
vm.runInContext(`
  function __setG(g){ _g = g; }
  function __getG(){ return _g; }
  function __setSeat(s){ mySeat = s; }
`, sandbox);


const t = check;
const SHA={id:7,name:'杀',suit:'♣',rank:7};

function mkG(opts){
  const o=opts||{};
  const P=(i)=>({name:'P'+i,seat:i,cid:'c'+i,hp:5,maxHp:5,alive:true,general:null,
    hand:[], equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[],role:null,jiuShaBonus:false});
  const players=[P(0),P(1)];
  if(o.weapon) players[0].equips.weapon={id:60,name:o.weapon,suit:'♠',rank:2};
  // 目标手里留一张牌:寒冰剑要求 hanbingDiscardCount(target)>0 才会弹询问
  if(o.targetHand!==false) players[1].hand=[{id:80,name:'桃',suit:'♥',rank:2}];
  return { players, phase:'play', pending:null, turn:0, deck:[], discard:[], log:[],
    started:true, gameMode:'ffa', jiuUsed:false, shaUsed:false, fangtianQueue:null };
}
// hanbingChoice: true=发动寒冰剑(防止伤害改弃牌) / false=不发动(补正常伤害)
function run(opts, withJiu, hanbingChoice){
  vm.runInContext('__setG('+JSON.stringify(mkG(opts))+')', sandbox);
  vm.runInContext('__setSeat(0)', sandbox);
  vm.runInContext(`(function(){
    const g=__getG();
    g.players[0].jiuShaBonus = ${withJiu?'true':'false'};
    const info = consumeJiuShaBonus(g, g.players[0]);
    resolveShaUse(g, g.players[0], 1, '出【杀】', 'black', ${JSON.stringify(SHA)}, info);
  })();`, sandbox);
  for(let k=0;k<40;k++){
    const g=vm.runInContext('__getG()', sandbox);
    if(!g.pending) break;
    const d=g.pending;
    if(g.phase==='respond' && typeof d.to==='number'){
      vm.runInContext('__setSeat('+d.to+');respondShan(false);__setSeat(0);', sandbox);
    } else if(g.phase==='hanbingAsk'){
      vm.runInContext('__setSeat('+d.from+');respondHanbingAsk('+(hanbingChoice?'true':'false')+');__setSeat(0);', sandbox);
    } else if(g.phase==='dying' && typeof d.asking==='number'){
      vm.runInContext('__setSeat('+d.asking+');respondDying(false);__setSeat(0);', sandbox);
    } else break;
  }
  const g=vm.runInContext('__getG()', sandbox);
  return { dmg: 5-g.players[1].hp, handLeft: g.players[1].hand.length,
           log: (g.log||[]).map(e=>typeof e==='object'?e.text:e) };
}

console.log('\n== CORE-152: 寒冰剑「不发动」不得丢失酒的+1 ==\n');

t('核心验收:酒 + 寒冰剑 + 不发动 → 2 点',()=>{
  const r=run({weapon:'寒冰剑'}, true, false);
  assert.strictEqual(r.dmg, 2, '实际 '+r.dmg+' 点;日志 '+JSON.stringify(r.log));
  assert.ok(r.log.some(l=>/【酒】生效/.test(l)), '应出现酒生效日志');
});

t('对照:同样带酒但不装寒冰剑 → 2 点(证明差异来自寒冰剑路径)',()=>{
  assert.strictEqual(run({}, true, false).dmg, 2);
});

t('不带酒 + 寒冰剑 + 不发动 → 1 点(不会凭空加成)',()=>{
  const r=run({weapon:'寒冰剑'}, false, false);
  assert.strictEqual(r.dmg, 1, '实际 '+r.dmg);
  assert.ok(!r.log.some(l=>/【酒】生效/.test(l)), '不该出现酒生效日志');
});

t('发动寒冰剑:防止伤害改为弃牌(既有行为不变,酒加成随之作废是规则正常)',()=>{
  const r=run({weapon:'寒冰剑'}, true, true);
  assert.strictEqual(r.dmg, 0, '发动后不应造成伤害,实际 '+r.dmg);
  assert.strictEqual(r.handLeft, 0, '目标那张手牌应被弃掉');
});

t('目标无牌可弃时不弹询问,直接走正常结算(酒加成正常生效)',()=>{
  const r=run({weapon:'寒冰剑', targetHand:false}, true, false);
  assert.ok(!r.log.some(l=>/是否发动【寒冰剑】/.test(l)), '无牌可弃不该弹询问');
  assert.strictEqual(r.dmg, 2, '应走正常结算并带酒加成,实际 '+r.dmg);
});

t('古锭刀路径未被波及(目标无手牌时 +1,与寒冰剑互斥所以走正常结算)',()=>{
  const r=run({weapon:'古锭刀', targetHand:false}, false, false);
  assert.strictEqual(r.dmg, 2, '古锭刀对无手牌目标应 +1,实际 '+r.dmg);
});

t('破坏性验证:还原成不传 options,酒的+1 确实丢失',()=>{
  const src=fs.readFileSync(path.join(ROOT,'weapons.js'),'utf8');
  const broken=src.replace(
    "dealDamage(g, to, damageAmount(g, from, 1+gudingBonus, 'sha', {jiuBonus:jiuBonus}), from, '不闪', 'sha', sourceCard)",
    "dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '不闪', 'sha', sourceCard)");
  assert.notStrictEqual(broken, src, '替换未命中');
  const ctx2=vm.createContext(Object.assign({}, context));
  ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js']
    .forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx2, {filename:f}));
  vm.runInContext(broken, ctx2, {filename:'weapons-broken.js'});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'skills.js'),'utf8'), ctx2, {filename:'skills.js'});
  vm.runInContext(`
    var _g=null;
    tx=function(fn){ if(!_g) return; normalize(_g); const r=fn(_g); return r===undefined?_g:r; };
    gameRef={transaction:function(fn){return tx(fn);}}; mySeat=0;
    function __setG(g){_g=g;} function __getG(){return _g;} function __setSeat(s){mySeat=s;}
  `, ctx2);
  vm.runInContext('__setG('+JSON.stringify(mkG({weapon:'寒冰剑'}))+')', ctx2);
  vm.runInContext(`(function(){
    const g=__getG(); g.players[0].jiuShaBonus=true;
    const info=consumeJiuShaBonus(g,g.players[0]);
    resolveShaUse(g,g.players[0],1,'出【杀】','black',${JSON.stringify(SHA)},info);
  })();`, ctx2);
  for(let k=0;k<40;k++){
    const g=vm.runInContext('__getG()', ctx2);
    if(!g.pending) break;
    const d=g.pending;
    if(g.phase==='respond'){ vm.runInContext('__setSeat('+d.to+');respondShan(false);__setSeat(0);', ctx2); }
    else if(g.phase==='hanbingAsk'){ vm.runInContext('__setSeat('+d.from+');respondHanbingAsk(false);__setSeat(0);', ctx2); }
    else break;
  }
  const g=vm.runInContext('__getG()', ctx2);
  assert.strictEqual(5-g.players[1].hp, 1, '旧写法下应只有 1 点——证明断言有鉴别力');
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败');
process.exit(failed?1:0);
