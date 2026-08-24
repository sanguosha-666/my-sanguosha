/**
 * CORE-151(issue #210):【酒】的 +1 伤害必须作用于同一张【杀】的**每个**目标。
 *
 * 方天画戟/丁奉【短兵】是同一张【杀】指定多个目标(不是重新使用新的杀),
 * 而【酒】的效果是"此【杀】造成的伤害+1",因此每个目标都应受到 2 点。
 * 改动前 advanceFangtianQueue 推进到第 2 个目标时把 shaInfo 显式置空并传 undefined,
 * 于是只有第一个目标吃到 +1。
 *
 * 对照:青龙偃月刀是【杀】被闪后**重新使用一张新的【杀】**,按规则酒只加"本回合第一张杀",
 * 那张新杀**不带**加成是正确的 —— 这条既有行为不得被本次改动带偏。
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


const t = check;   // 复用脚手架已有的 check(name,fn) 与 passed/failed 计数

const SHA={id:7,name:'杀',suit:'♣',rank:7};
function mkG(n, opts){
  const o=opts||{};
  const P=(i)=>({name:'P'+i,seat:i,cid:'c'+i,hp:5,maxHp:5,alive:true,general:null,hand:[],
    equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[],role:null,jiuShaBonus:false});
  const players=[]; for(let i=0;i<n;i++) players.push(P(i));
  if(o.weapon) players[0].equips.weapon={id:60,name:o.weapon,suit:'♠',rank:2};
  if(o.targetHand) players.forEach((p,i)=>{ if(i>0) p.hand=[{id:80+i,name:'桃',suit:'♥',rank:2}]; });
  return { players, phase:'play', pending:null, turn:0, deck:[], discard:[], log:[],
    started:true, gameMode:'ffa', jiuUsed:false, shaUsed:false, fangtianQueue:null };
}
// 把随之产生的响应阶段全部走完(一律不出闪/不出无懈/不救)
function drive(){
  for(let k=0;k<60;k++){
    const g=vm.runInContext('__getG()', sandbox);
    if(!g.pending && !g.fangtianQueue) break;
    const d=g.pending||{};
    if(d.type==='wuxiePublicWait'){ vm.runInContext('finishWuxiePublicWait()', sandbox); }
    else if(g.phase==='wuxie' && d.type==='wuxie' && typeof d.asking==='number'){
      vm.runInContext('__setSeat('+d.asking+')', sandbox);
      vm.runInContext('respondWuxie(false)', sandbox);
    } else if(g.phase==='respond' && typeof d.to==='number'){
      vm.runInContext('__setSeat('+d.to+')', sandbox);
      vm.runInContext('respondShan(false)', sandbox);
    } else if(g.phase==='dying' && typeof d.asking==='number'){
      vm.runInContext('__setSeat('+d.asking+')', sandbox);
      vm.runInContext('respondDying(false)', sandbox);
    } else if(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong'){
      // 青龙:发动 → 对同一目标再使用一张**新的**杀。那张新杀按规则不带酒加成,
      // 正是下面那条对照断言要观察的。其它用例没装青龙,不会走到这里。
      vm.runInContext('__setSeat('+g.pending.from+')', sandbox);
      // respondQinglong(activate, cardIdx):第二个参数是拿手里哪张牌当这张新【杀】,
      // 漏传会取不到牌、停在 qinglong 阶段不动(第一版就卡在这里,目标 0 点伤害)。
      vm.runInContext('respondQinglong(true, 0)', sandbox);
    } else if(g.phase==='hanbingAsk'){
      vm.runInContext('__setSeat('+d.from+')', sandbox);
      vm.runInContext('respondHanbingAsk(false)', sandbox);
    } else break;
    vm.runInContext('__setSeat(0)', sandbox);
  }
  return vm.runInContext('__getG()', sandbox);
}
// 构造"一张杀同时指定多个目标"的队列(方天画戟/短兵共用),withJiu 决定是否带酒
// 【为什么有些场景要给长武器】杀受攻击距离限制,而距离是**存活玩家环上的最近间隔**:
// 4 人局里 seat0 到 seat1/seat3 都是 1、到 seat2 是 2,默认攻击范围 1 够不着 seat2,
// 日志会写"攻击距离不足"、那个目标直接被跳过(实测过一次 [2,0,2],差点误判成漏加成)。
// 麒麟弓 range 5 能覆盖全场,且它的特效是"命中后弃对方坐骑"——目标没有坐骑就不触发,
// 不会污染本测试要观察的伤害数值。
function runMulti(targets, withJiu, weapon){
  const gg=mkG(targets.length+1);
  if(weapon) gg.players[0].equips.weapon={id:60,name:weapon,suit:'♠',rank:2};
  vm.runInContext('__setG('+JSON.stringify(gg)+')', sandbox);
  vm.runInContext('__setSeat(0)', sandbox);
  vm.runInContext(`(function(){
    const g=__getG();
    g.players[0].jiuShaBonus = ${withJiu?'true':'false'};
    const info = consumeJiuShaBonus(g, g.players[0]);
    g.fangtianQueue = { from:0, targets:${JSON.stringify(targets)}, idx:0, usedAs:'出【杀】',
                        shaColor:'black', sourceCard:${JSON.stringify(SHA)}, shaInfo:info };
    resolveShaUse(g, g.players[0], ${targets[0]}, '出【杀】', 'black', ${JSON.stringify(SHA)}, info);
  })();`, sandbox);
  const g=drive();
  return targets.map(s=>5-g.players[s].hp);
}

console.log('\n== CORE-151: 酒的+1作用于多目标杀的每个目标 ==\n');

t('两个目标:都受到 2 点(核心验收)',()=>{
  assert.deepStrictEqual(runMulti([1,2], true), [2,2]);
});
t('三个目标:全部 2 点(不是只有第一个)',()=>{
  const r=runMulti([1,2,3], true, '麒麟弓');   // 长武器,否则 seat2 因距离不足被跳过
  assert.deepStrictEqual([...r], [2,2,2], '实际 '+JSON.stringify(r));
});
t('不带酒时全部 1 点(零回归,不会凭空加成)',()=>{
  assert.deepStrictEqual(runMulti([1,2], false), [1,1]);
});
t('单目标带酒仍是 2 点(普通杀路径未被波及)',()=>{
  assert.deepStrictEqual(runMulti([1], true), [2]);
});

t('青龙偃月刀:被闪后重新使用的新【杀】不带酒加成(既有正确行为不得被带偏)',()=>{
  // 目标有闪 → 第一张杀被闪抵消(0 点) → 青龙追加一张**新的**杀 → 那张不带酒加成。
  const g0=mkG(2); g0.players[0].equips.weapon={id:61,name:'青龙偃月刀',suit:'♠',rank:5};
  // canStartQinglong 要求攻击者手里**还有能当【杀】用的牌**(它发动的是"再使用一张杀"),
  // 手牌为空时根本不会弹出询问 —— 第一版漏了这张牌,青龙没触发、目标 0 点伤害。
  g0.players[0].hand=[{id:91,name:'杀',suit:'♠',rank:6}];
  g0.players[1].hand=[{id:90,name:'闪',suit:'♦',rank:2}];
  vm.runInContext('__setG('+JSON.stringify(g0)+')', sandbox);
  vm.runInContext('__setSeat(0)', sandbox);
  vm.runInContext(`(function(){
    const g=__getG();
    g.players[0].jiuShaBonus=true;
    const info=consumeJiuShaBonus(g,g.players[0]);
    resolveShaUse(g,g.players[0],1,'出【杀】','black',${JSON.stringify(SHA)},info);
  })();`, sandbox);
  // 第一张杀:目标打出【闪】抵消(这一步必须真的出闪,否则青龙不会触发)
  let g=vm.runInContext('__getG()', sandbox);
  assert.strictEqual(g.phase,'respond','前置:应进入响应阶段');
  vm.runInContext('__setSeat(1)', sandbox);
  vm.runInContext('respondShan(true)', sandbox);
  vm.runInContext('__setSeat(0)', sandbox);
  // 随后的青龙询问由 drive() 统一处理(发动),再走完新杀的响应
  g=drive();
  assert.ok((g.log||[]).some(e=>/青龙/.test(typeof e==='object'?e.text:e)),
    '前置:青龙应已触发(否则这条断言什么都没验证到)');
  const dmg=5-g.players[1].hp;
  assert.strictEqual(dmg, 1,
    '青龙追加的是一张新杀,酒只加本回合第一张杀 → 应为 1 点,实际 '+dmg
    +'(若为 2 说明本次改动把酒加成错误地带进了新杀)');
});

t('破坏性验证:还原成 shaInfo=null + 传 undefined,第2个目标确实只有1点',()=>{
  const src=fs.readFileSync(path.join(ROOT,'game.js'),'utf8');
  const i=src.indexOf('  // CORE-151(issue #210)');
  const j=src.indexOf('q.shaColor, q.sourceCard, q.shaInfo);');
  assert.ok(i>=0 && j>i, '定位不到本次改动那段');
  const broken = src.slice(0,i)
    + '  q.shaInfo=null;\n  resolveShaUse(g, g.players[q.from], q.targets[q.idx], q.usedAs, q.shaColor, q.sourceCard, undefined);'
    + src.slice(j + 'q.shaColor, q.sourceCard, q.shaInfo);'.length);
  const ctx2=vm.createContext(Object.assign({}, context));
  ['config.js','data.js','stages/stage-table.js','room-lifecycle.js'].forEach(f=>
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx2, {filename:f}));
  vm.runInContext(broken, ctx2, {filename:'game-broken.js'});
  ['sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx2, {filename:f}));
  vm.runInContext(`
    var _g=null;
    tx=function(fn){ if(!_g) return; normalize(_g); const r=fn(_g); return r===undefined?_g:r; };
    gameRef={transaction:function(fn){return tx(fn);}}; mySeat=0;
    function __setG(g){_g=g;} function __getG(){return _g;} function __setSeat(s){mySeat=s;}
  `, ctx2);
  vm.runInContext('__setG('+JSON.stringify(mkG(3))+')', ctx2);
  vm.runInContext(`(function(){
    const g=__getG(); g.players[0].jiuShaBonus=true;
    const info=consumeJiuShaBonus(g,g.players[0]);
    g.fangtianQueue={from:0,targets:[1,2],idx:0,usedAs:'出【杀】',shaColor:'black',
                     sourceCard:${JSON.stringify(SHA)},shaInfo:info};
    resolveShaUse(g,g.players[0],1,'出【杀】','black',${JSON.stringify(SHA)},info);
  })();`, ctx2);
  for(let k=0;k<60;k++){
    const g=vm.runInContext('__getG()', ctx2);
    if(!g.pending && !g.fangtianQueue) break;
    const d=g.pending||{};
    if(g.phase==='respond' && typeof d.to==='number'){
      vm.runInContext('__setSeat('+d.to+');respondShan(false);__setSeat(0);', ctx2);
    } else if(g.phase==='dying' && typeof d.asking==='number'){
      vm.runInContext('__setSeat('+d.asking+');respondDying(false);__setSeat(0);', ctx2);
    } else break;
  }
  const g=vm.runInContext('__getG()', ctx2);
  assert.strictEqual(5-g.players[2].hp, 1, '旧写法下第2个目标应只有1点——证明断言有鉴别力');
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败');
process.exit(failed?1:0);
