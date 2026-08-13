/**
 * 身份模式(主公局)回归 — 随实现逐步扩展断言。
 * 规格: docs/superpowers/specs/2026-07-19-identity-mode-design.md
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = __dirname;
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
const files = ['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'];
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

const EXPECT = {
  4: {zhu:1, zhong:1, fan:1, nei:1},
  5: {zhu:1, zhong:1, fan:2, nei:1},
  6: {zhu:1, zhong:1, fan:3, nei:1},
  7: {zhu:1, zhong:2, fan:3, nei:1},
  8: {zhu:1, zhong:2, fan:4, nei:1},
};

function countRoles(arr){
  const c = {zhu:0,zhong:0,fan:0,nei:0};
  arr.forEach(r=>{ if(c[r]!=null) c[r]++; });
  return c;
}

console.log('\n== Task1: IDENTITY_TABLE / assignIdentities / canSeeRole ==\n');

// vm 里 const 不挂到 sandbox 对象属性上,用 runInContext 取值
function R(code){ return vm.runInContext(code, sandbox); }

check('IDENTITY_TABLE 存在且覆盖 4~8', ()=>{
  const T = R('IDENTITY_TABLE');
  assert.ok(T);
  for(let n=4;n<=8;n++) assert.ok(Array.isArray(T[n]), '缺 '+n);
});

check('配比数量正确', ()=>{
  const T = R('IDENTITY_TABLE');
  for(let n=4;n<=8;n++){
    const c = countRoles(T[n]);
    assert.deepStrictEqual(c, EXPECT[n], 'n='+n+' got '+JSON.stringify(c));
    assert.strictEqual(T[n].length, n);
  }
});

check('ROLE_LABEL 四身份', ()=>{
  const L = R('ROLE_LABEL');
  assert.strictEqual(L.zhu, '主公');
  assert.strictEqual(L.zhong, '忠臣');
  assert.strictEqual(L.fan, '反贼');
  assert.strictEqual(L.nei, '内奸');
});

check('assignIdentities 4 人:1 主公 revealed,其余未翻', ()=>{
  const players = [1,2,3,4].map(i=>({name:'P'+i}));
  R('assignIdentities')(players);
  const lords = players.filter(p=>p.role==='zhu');
  assert.strictEqual(lords.length, 1);
  assert.strictEqual(lords[0].roleRevealed, true);
  players.filter(p=>p.role!=='zhu').forEach(p=>{
    assert.strictEqual(p.roleRevealed, false);
    assert.ok(['zhong','fan','nei'].includes(p.role));
  });
  assert.deepStrictEqual(countRoles(players.map(p=>p.role)), EXPECT[4]);
});

check('assignIdentities 3 人 no-op', ()=>{
  const players = [{name:'a'},{name:'b'},{name:'c'}];
  R('assignIdentities')(players);
  assert.strictEqual(players[0].role, undefined);
});

check('getLordSeat', ()=>{
  const g = { players:[{role:'fan'},{role:'zhu',roleRevealed:true},{role:'nei'}] };
  assert.strictEqual(R('getLordSeat')(g), 1);
  assert.strictEqual(R('getLordSeat')({players:[]}), -1);
});

check('canSeeRole 规则', ()=>{
  const g = {
    gameMode:'identity',
    players:[
      {role:'zhu', roleRevealed:true},
      {role:'zhong', roleRevealed:false},
      {role:'fan', roleRevealed:false},
      {role:'nei', roleRevealed:true},
    ]
  };
  const canSeeRole = R('canSeeRole');
  assert.strictEqual(canSeeRole(g, 1, 0), true);
  assert.strictEqual(canSeeRole(g, 2, 0), true);
  assert.strictEqual(canSeeRole(g, 1, 1), true);
  assert.strictEqual(canSeeRole(g, 0, 1), false);
  assert.strictEqual(canSeeRole(g, 0, 2), false);
  assert.strictEqual(canSeeRole(g, 0, 3), true);
  assert.strictEqual(canSeeRole({gameMode:'ffa', players:g.players}, 0, 0), false);
  assert.strictEqual(canSeeRole({gameMode:null, players:g.players}, 0, 0), false);
});

// ========== Task2+ : startGame / finish / checkWin / reward ==========

function mkPlayers(n){
  return Array.from({length:n}, (_,i)=>({
    name:'P'+i, cid:'c'+i, hp:4, maxHp:4, hand:[], alive:true, equips:R('emptyEquips')(), delays:[]
  }));
}

function freshG(n){
  return {
    started:false, players:mkPlayers(n), turn:0, phase:'lobby',
    deck:[], discard:[], pending:null, aoe:null, log:[],
    gameMode:null, winSide:null, lordGeneralPool:null,
    roundNum:1, roundSeatsActed:[], exchangeCards:[],
    shaUsed:false, lastCardSound:null, lastSkillSound:null
  };
}

function setG(g){ vm.runInContext('__setG('+JSON.stringify(g).replace(/</g,'\\u003c')+')', sandbox); }
// JSON 丢 function;改用直接赋值
function loadG(g){
  sandbox.__testG = g;
  vm.runInContext('_g = global.__testG || __testG; if(typeof __setG==="function"){} ; _g = this.__testG;', sandbox);
  // 更直接:
  vm.runInContext('void 0', sandbox);
  const ref = { get g(){ return sandbox._g; }, set g(v){ sandbox._g = v; } };
  // vm 上下文:把对象挂到 sandbox 再赋 _g
  Object.defineProperty(sandbox, '__tg', { value:g, writable:true, configurable:true });
  vm.runInContext('_g = __tg;', sandbox);
  return ()=> sandbox._g || vm.runInContext('_g', sandbox);
}

// 修复:直接在 sandbox 上设 _g
function withG(g, fn){
  sandbox._g = g;
  vm.runInContext('_g = globalThis._g;', sandbox);
  // sandbox 与 context 是同一对象 when createContext(context)
  try { return fn(g); }
  finally {}
}

// createContext 后 sandbox === context 的代理;直接 sandbox._g 可能不进 vm 的 _g 绑定
// 使用 runInContext 设置:
function bindG(g){
  global.__ID_TEST_G = g;
  vm.runInContext('globalThis.__ID_TEST_G = globalThis.__ID_TEST_G;', sandbox);
  // 把 host 对象放进 sandbox
  sandbox.__ID_TEST_G = g;
  vm.runInContext('_g = __ID_TEST_G;', sandbox);
}

console.log('\n== Task2: normalize / startGame identity ==\n');

check('normalize: 非法 gameMode→null, 清 role', ()=>{
  const g = freshG(2);
  g.gameMode = 'bogus';
  g.players[0].role = 'fan';
  g.players[0].roleRevealed = true;
  R('normalize')(g);
  assert.strictEqual(g.gameMode, null);
  assert.strictEqual(g.players[0].role, null);
  assert.strictEqual(g.players[0].roleRevealed, false);
});

check('normalize: identity 保留合法 role', ()=>{
  const g = freshG(4);
  g.gameMode = 'identity';
  g.players[0].role = 'zhu';
  g.players[0].roleRevealed = true;
  R('normalize')(g);
  assert.strictEqual(g.gameMode, 'identity');
  assert.strictEqual(g.players[0].role, 'zhu');
  assert.strictEqual(g.players[0].roleRevealed, true);
});

check('startGame identity n=3 拒绝', ()=>{
  const g = freshG(3);
  bindG(g);
  R('startGame')('pick','identity');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.phase, 'lobby');
  assert.ok(gg.gameMode==null || gg.phase==='lobby');
  assert.ok(!gg.players[0].role);
});

check('startGame identity random 拒绝', ()=>{
  const g = freshG(4);
  bindG(g);
  R('startGame')('random','identity');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.phase, 'lobby');
});

check('startGame identity n=4 pick → 发身份+主公5选', ()=>{
  const g = freshG(4);
  bindG(g);
  R('startGame')('pick','identity');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.gameMode, 'identity');
  assert.strictEqual(gg.phase, 'pickingLordGeneral');
  assert.deepStrictEqual(countRoles(gg.players.map(p=>p.role)), EXPECT[4]);
  const lord = R('getLordSeat')(gg);
  assert.ok(lord>=0);
  assert.strictEqual(gg.players[lord].roleRevealed, true);
  assert.ok(Array.isArray(gg.players[lord].generalChoices));
  assert.strictEqual(gg.players[lord].generalChoices.length, 5);
  assert.ok(Array.isArray(gg.lordGeneralPool));
  assert.strictEqual(gg.lordGeneralPool.length, 5);
  gg.players.forEach((p,i)=>{
    if(i===lord) return;
    assert.strictEqual(p.generalChoices, null);
  });
});

check('startGame ffa pick 仍 3 选', ()=>{
  const g = freshG(2);
  bindG(g);
  R('startGame')('pick','ffa');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.gameMode, 'ffa');
  assert.strictEqual(gg.phase, 'pickingGeneral');
  assert.strictEqual(gg.players[0].generalChoices.length, 3);
  assert.strictEqual(gg.players[0].role, null);
});

console.log('\n== Task3: lord pick + finishGeneralAssign ==\n');

check('主公选将后他人3张+公开武将', ()=>{
  const g = freshG(4);
  bindG(g);
  R('startGame')('pick','identity');
  let gg = vm.runInContext('_g', sandbox);
  const lord = R('getLordSeat')(gg);
  const pickId = gg.players[lord].generalChoices[0];
  vm.runInContext('mySeat = '+lord, sandbox);
  R('respondPickLordGeneral')(pickId);
  gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.players[lord].general, pickId);
  assert.strictEqual(gg.players[lord].generalChoices, null);
  assert.strictEqual(gg.phase, 'pickingGeneral');
  gg.players.forEach((p,i)=>{
    if(i===lord) return;
    assert.ok(Array.isArray(p.generalChoices), 'seat'+i);
    assert.strictEqual(p.generalChoices.length, 3);
    assert.ok(!p.generalChoices.includes(pickId), '不与主公重复');
  });
});

check('全员选完:主公+1血且从主公起手', ()=>{
  R('__setSeat')(0);
  const g = freshG(4);
  bindG(g);
  R('startGame')('pick','identity');
  let gg = vm.runInContext('_g', sandbox);
  const lord = R('getLordSeat')(gg);
  const pickId = gg.players[lord].generalChoices[0];
  vm.runInContext('mySeat = '+lord, sandbox);
  R('respondPickLordGeneral')(pickId);
  gg = vm.runInContext('_g', sandbox);
  // 他人选将
  for(let i=0;i<4;i++){
    if(i===lord) continue;
    const choices = gg.players[i].generalChoices;
    assert.ok(choices && choices.length);
    vm.runInContext('mySeat = '+i, sandbox);
    R('respondPickGeneral')(choices[0]);
    gg = vm.runInContext('_g', sandbox);
  }
  // 可能还在 huashenPick;若有左慈需跳过——强制无左慈
  // 若 started 仍 false 且 phase huashenPick,用 debug 或直接 finish
  if(!gg.started && gg.phase==='huashenPick'){
    // 不发动:找不到 respondHuashen 简单路径时,直接给所有 zuoci 声明
    while(gg.phase==='huashenPick' && gg.pending){
      const s = gg.pending.seat;
      const pl = gg.players[s];
      const gid = pl.huashenPool[0];
      const entry = R('HUASHEN_SKILL_TABLE')[gid];
      const sk = entry && entry[0] && entry[0].name;
      vm.runInContext('mySeat = '+s, sandbox);
      if(typeof R('respondHuashenPick')==='function' && sk){
        R('respondHuashenPick')(gid, sk);
      } else {
        // 兜底:清空 huashen 要求
        pl.huashenGeneral = gid;
        pl.huashenSkillName = sk || 'x';
        gg.pending = null;
        R('checkHuashenBeforeAssign')(gg);
      }
      gg = vm.runInContext('_g', sandbox);
    }
  }
  assert.strictEqual(gg.started, true, 'phase='+gg.phase);
  const lordP = gg.players[lord];
  const baseHp = R('generalMaxHp')(lordP.general);
  assert.strictEqual(lordP.maxHp, baseHp + 1, '主公+1');
  assert.strictEqual(lordP.hp, lordP.maxHp);
  // 非主公无 +1
  gg.players.forEach((p,i)=>{
    if(i===lord) return;
    assert.strictEqual(p.maxHp, R('generalMaxHp')(p.general));
  });
  assert.strictEqual(gg.turn, lord, '从主公起手');
});

console.log('\n== Task4: checkWin ==\n');

check('checkWin 主忠胜', ()=>{
  const g = {
    gameMode:'identity', players:[
      {role:'zhu', alive:true, name:'主'},
      {role:'zhong', alive:true, name:'忠'},
      {role:'fan', alive:false, name:'反'},
      {role:'nei', alive:false, name:'内'},
    ], pending:{x:1}, aoe:{}, log:[]
  };
  assert.strictEqual(R('checkWin')(g), true);
  assert.strictEqual(g.winSide, 'lord');
  assert.strictEqual(g.winner, '主公与忠臣');
  assert.strictEqual(g.phase, 'over');
});

check('checkWin 反贼胜', ()=>{
  const g = {
    gameMode:'identity', players:[
      {role:'zhu', alive:false, name:'主'},
      {role:'fan', alive:true, name:'反'},
      {role:'nei', alive:true, name:'内'},
    ], log:[]
  };
  assert.strictEqual(R('checkWin')(g), true);
  assert.strictEqual(g.winSide, 'fan');
});

check('checkWin 内奸胜', ()=>{
  const g = {
    gameMode:'identity', players:[
      {role:'zhu', alive:false, name:'主'},
      {role:'fan', alive:false, name:'反'},
      {role:'nei', alive:true, name:'内'},
    ], log:[]
  };
  assert.strictEqual(R('checkWin')(g), true);
  assert.strictEqual(g.winSide, 'nei');
});

check('checkWin 无胜者', ()=>{
  const g = {
    gameMode:'identity', players:[
      {role:'zhu', alive:false, name:'主'},
      {role:'zhong', alive:true, name:'忠'},
      {role:'fan', alive:false, name:'反'},
      {role:'nei', alive:false, name:'内'},
    ], log:[]
  };
  assert.strictEqual(R('checkWin')(g), true);
  assert.strictEqual(g.winSide, 'none');
  assert.strictEqual(g.winner, '无');
});

check('checkWin ffa 仍按人数', ()=>{
  const g = {
    gameMode:'ffa', players:[
      {alive:true, name:'A'},
      {alive:false, name:'B'},
    ], log:[]
  };
  assert.strictEqual(R('checkWin')(g), true);
  assert.strictEqual(g.winner, 'A');
  assert.strictEqual(g.winSide, null);
});

check('checkWin identity 未结束', ()=>{
  const g = {
    gameMode:'identity', players:[
      {role:'zhu', alive:true, name:'主'},
      {role:'fan', alive:true, name:'反'},
    ], log:[]
  };
  assert.strictEqual(R('checkWin')(g), false);
});

console.log('\n== Task5: applyIdentityKillReward ==\n');

check('杀反摸3', ()=>{
  const g = {
    gameMode:'identity',
    deck: Array.from({length:10}, (_,i)=>({id:i,name:'杀',suit:'♠',rank:1})),
    discard:[], log:[],
    players:[
      {role:'fan', name:'反', alive:false, hand:[], equips:R('emptyEquips')(), delays:[]},
      {role:'zhu', name:'主', alive:true, hand:[], equips:R('emptyEquips')(), delays:[], hp:5, maxHp:5},
    ]
  };
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 3);
});

check('主杀忠弃手牌装备、判定区保留', ()=>{
  const delayCard = {id:99, name:'乐不思蜀', suit:'♥', rank:6};
  const g = {
    gameMode:'identity', deck:[], discard:[], log:[],
    players:[
      {role:'zhong', name:'忠', alive:false, hand:[], equips:R('emptyEquips')(), delays:[]},
      {
        role:'zhu', name:'主', alive:true, hp:5, maxHp:5,
        hand:[{id:1,name:'杀',suit:'♠',rank:2},{id:2,name:'闪',suit:'♥',rank:2}],
        equips:{ weapon:{id:3,name:'青龙偃月刀',suit:'♠',rank:5}, armor:null, plus1:null, minus1:null },
        delays:[delayCard]
      },
    ]
  };
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 0);
  assert.strictEqual(g.players[1].equips.weapon, null);
  assert.strictEqual(g.players[1].delays.length, 1);
  assert.strictEqual(g.players[1].delays[0].name, '乐不思蜀');
  assert.ok(g.discard.length >= 3);
});

check('ffa 不奖惩', ()=>{
  const g = {
    gameMode:'ffa', deck:[{id:1,name:'杀',suit:'♠',rank:1}], discard:[], log:[],
    players:[
      {role:'fan', name:'A', alive:false, hand:[], equips:R('emptyEquips')()},
      {name:'B', alive:true, hand:[], equips:R('emptyEquips')()},
    ]
  };
  R('applyIdentityKillReward')(g, 0, 1);
  assert.strictEqual(g.players[1].hand.length, 0);
});

console.log('\n== Task6: 死亡翻身份端到端(真实 dealDamage→startDying→respondDying→finishDying,不用合成状态跳过) ==\n');

// 走真实响应循环(不预设座位顺序,动态读g.pending.asking,遵循项目"逐个询问"类响应函数的既有惯例)
function runDyingLoopNoTao(){
  let guard = 0;
  let gg = vm.runInContext('_g', sandbox);
  while(gg.phase==='dying' && gg.pending && gg.pending.type==='dying' && guard<10){
    const asking = gg.pending.asking;
    vm.runInContext('mySeat = '+asking, sandbox);
    R('respondDying')(false);
    gg = vm.runInContext('_g', sandbox);
    guard++;
  }
  assert.ok(guard<10, '不应死循环(respondDying(false)未能在10轮内收尾)');
  return gg;
}

check('端到端①:主公亲手误杀忠臣——真实死亡应正确翻身份→写日志→触发奖惩(手牌装备清空/判定区保留)→顺序正确→死后可见', ()=>{
  const g = freshG(4);
  g.gameMode = 'identity'; g.started = true; g.phase = 'play'; g.turn = 2;
  g.deck = Array.from({length:10}, (_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:1}));
  const delayCard = {id:'delay1', name:'乐不思蜀', suit:'♥', rank:6};
  // 座位0=反贼(存活) 座位1=忠臣(将死,1血) 座位2=主公(杀手,存活,持有一件武器+一张判定区牌)
  // 座位3=内奸(存活,旁观者视角,验证死后其它任意存活玩家都能看到)
  g.players[0].role='fan';   g.players[0].roleRevealed=false;
  g.players[1].role='zhong'; g.players[1].roleRevealed=false; g.players[1].hp=1; g.players[1].maxHp=1;
  g.players[2].role='zhu';   g.players[2].roleRevealed=true;
  g.players[2].hand=[{id:'h1',name:'杀',suit:'♠',rank:3},{id:'h2',name:'闪',suit:'♥',rank:4}];
  g.players[2].equips={ weapon:{id:'w1',name:'青龙偃月刀',suit:'♠',rank:5}, armor:null, plus1:null, minus1:null };
  g.players[2].delays=[delayCard];
  g.players[3].role='nei';   g.players[3].roleRevealed=false;
  g.players.forEach((p,i)=>{ if(i!==1) p.hp=4; if(i!==2){ p.hand=[]; p.equips=R('emptyEquips')(); p.delays=[]; } p.alive=true; });
  bindG(g);
  const dealDamage = R('dealDamage');
  let gg = vm.runInContext('_g', sandbox);
  const dying = dealDamage(gg, 1, 1, 2, '受到伤害', 'sha'); // 座位2(主公)对座位1(忠臣)造成1点伤害
  assert.strictEqual(dying, true, 'dealDamage 应挂起濒死流程');
  gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.phase, 'dying');
  assert.strictEqual(gg.players[1].roleRevealed, false, '濒死过程中身份还不该提前翻开');

  gg = runDyingLoopNoTao(); // 无人有桃,问完一圈后应真实死亡

  // 断言1:roleRevealed 正确从 false 变成 true(死亡这一刻才翻开,不提前不延后)
  assert.strictEqual(gg.players[1].alive, false, '忠臣应真的阵亡');
  assert.strictEqual(gg.players[1].roleRevealed, true, '阵亡后身份应翻开');

  // 断言2:执行顺序——身份翻开日志 → 主公罚没(手牌/装备)日志 → (checkWin此局未结束,不产生"游戏结束"日志)
  const logs = gg.log.map(e=>e.text);
  const roleLogIdx = logs.findIndex(t=>t.includes(gg.players[1].name) && t.includes('的身份是【忠臣】'));
  const rewardLogIdx = logs.findIndex(t=>t.includes('误杀忠臣'));
  assert.ok(roleLogIdx>=0, '应有身份翻开日志: '+JSON.stringify(logs));
  assert.ok(rewardLogIdx>=0, '应有主公误杀忠臣的奖惩日志: '+JSON.stringify(logs));
  assert.ok(roleLogIdx < rewardLogIdx, '身份翻开日志应早于奖惩日志(实际顺序 role='+roleLogIdx+' reward='+rewardLogIdx+')');

  // 断言2b:奖惩确实被真实死亡流程触发(不是孤立调用)——主公手牌/武器清空,判定区保留
  assert.strictEqual(gg.players[2].hand.length, 0, '主公手牌应被弃光');
  assert.strictEqual(gg.players[2].equips.weapon, null, '主公武器应被弃置');
  assert.strictEqual(gg.players[2].delays.length, 1, '主公判定区应保留不动');
  assert.strictEqual(gg.players[2].delays[0].name, '乐不思蜀');

  // 断言3:checkWin 已被调用检查过(反/内仍存活,主公仍存活→游戏不应结束)
  assert.notStrictEqual(gg.phase, 'over', '反贼与内奸仍存活,不应结束游戏');
  assert.strictEqual(gg.winSide, null);

  // 断言4:死后任意存活玩家(不限于主公/杀手)现在都能看到死者的真实身份
  const canSeeRole = R('canSeeRole');
  assert.strictEqual(canSeeRole(gg, 3, 1), true, '内奸(座位3,纯旁观者)现在应能看到座位1(已死忠臣)的身份');
  assert.strictEqual(canSeeRole(gg, 0, 1), true, '反贼(座位0)现在应能看到座位1的身份');
});

check('端到端②:忠臣杀死反贼——真实死亡应触发"杀反摸3"奖惩(经真实死亡流程,不是孤立调用)', ()=>{
  const g = freshG(4);
  g.gameMode = 'identity'; g.started = true; g.phase = 'play'; g.turn = 1;
  g.deck = Array.from({length:10}, (_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:1}));
  // 座位0=反贼(将死,1血) 座位1=忠臣(杀手,存活) 座位2=主公(存活) 座位3=内奸(存活)
  g.players[0].role='fan';   g.players[0].roleRevealed=false; g.players[0].hp=1; g.players[0].maxHp=1;
  g.players[1].role='zhong'; g.players[1].roleRevealed=false;
  g.players[2].role='zhu';   g.players[2].roleRevealed=true;
  g.players[3].role='nei';   g.players[3].roleRevealed=false;
  g.players.forEach((p,i)=>{ if(i!==0) p.hp=4; p.hand=[]; p.equips=R('emptyEquips')(); p.delays=[]; p.alive=true; });
  bindG(g);
  const dealDamage = R('dealDamage');
  let gg = vm.runInContext('_g', sandbox);
  const handBefore = gg.players[1].hand.length;
  const dying = dealDamage(gg, 0, 1, 1, '受到伤害', 'sha'); // 座位1(忠臣)对座位0(反贼)造成1点伤害
  assert.strictEqual(dying, true);
  gg = runDyingLoopNoTao();

  assert.strictEqual(gg.players[0].alive, false, '反贼应真的阵亡');
  assert.strictEqual(gg.players[0].roleRevealed, true, '阵亡后身份应翻开');
  assert.strictEqual(gg.players[1].hand.length, handBefore + 3, '杀反贼的忠臣应摸3张牌(经真实死亡流程触发)');
  const logs = gg.log.map(e=>e.text);
  assert.ok(logs.some(t=>t.includes('杀死反贼，摸三张牌')), '应有杀反奖惩日志: '+JSON.stringify(logs));
  assert.notStrictEqual(gg.phase, 'over', '主公/忠臣/内奸仍存活,不应结束游戏');
});

console.log('\n== Task7: applyIdentityKillReward killerSeat 非数字(如闪电致死无明确凶手) → 应安全提前return,无奖惩、不抛异常 ==\n');

check('killerSeat=undefined(如闪电劈死) → 无奖惩且不抛异常', ()=>{
  const g = {
    gameMode:'identity', deck:[{id:1,name:'杀',suit:'♠',rank:1}], discard:[], log:[],
    players:[
      {role:'fan', name:'A', alive:false, hand:[{id:9,name:'杀',suit:'♠',rank:1}], equips:R('emptyEquips')()},
      {role:'zhong', name:'B', alive:true, hand:[], equips:R('emptyEquips')()},
    ]
  };
  assert.doesNotThrow(()=>{ R('applyIdentityKillReward')(g, 0, undefined); });
  assert.strictEqual(g.players[1].hand.length, 0, '不应有人被越权摸牌/罚没');
  assert.strictEqual(g.players[0].hand.length, 1, '死者手牌不应被这个函数动(那是finishDying自己的职责)');
});

check('killerSeat=NaN(非法数字) → 同样安全提前return', ()=>{
  const g = {
    gameMode:'identity', deck:[], discard:[], log:[],
    players:[
      {role:'fan', name:'A', alive:false, hand:[], equips:R('emptyEquips')()},
      {role:'zhong', name:'B', alive:true, hand:[], equips:R('emptyEquips')()},
    ]
  };
  assert.doesNotThrow(()=>{ R('applyIdentityKillReward')(g, 0, NaN); });
  assert.strictEqual(g.players[1].hand.length, 0);
});

console.log('\n== Task8: newGame() 清空身份局残留字段 ==\n');

check('newGame() 应清空 gameMode/winSide/role/roleRevealed,不残留上一局身份信息', ()=>{
  R('__setSeat')(0);
  const g = freshG(4);
  g.gameMode = 'identity'; g.winSide = 'lord'; g.winner = '主公与忠臣'; g.phase = 'over'; g.started = true;
  g.players[0].role='zhu';   g.players[0].roleRevealed=true;
  g.players[1].role='zhong'; g.players[1].roleRevealed=true; // 死过,已翻开
  g.players[2].role='fan';   g.players[2].roleRevealed=false;
  g.players[3].role='nei';   g.players[3].roleRevealed=false;
  bindG(g);
  R('newGame')();
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.gameMode, null, 'gameMode应清空');
  assert.strictEqual(gg.winSide, null, 'winSide应清空');
  assert.strictEqual(gg.started, false);
  assert.strictEqual(gg.phase, 'lobby');
  gg.players.forEach((p,i)=>{
    assert.strictEqual(p.role, null, 'seat'+i+' role应清空');
    assert.strictEqual(p.roleRevealed, false, 'seat'+i+' roleRevealed应清空');
  });
});

console.log('\n== Task9: startGame identity 人数边界(与已有的 n=3 拒绝对称) ==\n');

check('startGame identity n=9(超过8人) 拒绝', ()=>{
  const g = freshG(9);
  bindG(g);
  R('startGame')('pick','identity');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.phase, 'lobby', '超过8人应被拒绝,不进入选将');
  assert.ok(!gg.gameMode || gg.phase==='lobby');
  assert.ok(!gg.players[0].role, '不应分配身份');
});

check('startGame identity n=8(边界内,应接受) 对照', ()=>{
  R('__setSeat')(0);
  const g = freshG(8);
  bindG(g);
  R('startGame')('pick','identity');
  const gg = vm.runInContext('_g', sandbox);
  assert.strictEqual(gg.gameMode, 'identity');
  assert.strictEqual(gg.phase, 'pickingLordGeneral');
  assert.deepStrictEqual(countRoles(gg.players.map(p=>p.role)), EXPECT[8]);
});

console.log('\n== Task10: 结束时全员身份揭晓(方案A,checkWin里批量翻转roleRevealed) ==\n');

check('端到端①:反贼杀死主公触发反贼胜——结束后全员roleRevealed=true,canSeeRole全员互相可见', ()=>{
  const g = freshG(4);
  g.gameMode = 'identity'; g.started = true; g.phase = 'play'; g.turn = 0;
  g.deck = Array.from({length:10}, (_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:1}));
  // 座位0=反贼(杀手,存活) 座位1=主公(将死,1血) 座位2=忠臣(存活,从未参与击杀,身份此前从未翻开)
  // 座位3=内奸(存活,同样从未翻开)——结束前这两人理应完全隐藏,结束后应该都能被看到
  g.players[0].role='fan';   g.players[0].roleRevealed=false;
  g.players[1].role='zhu';   g.players[1].roleRevealed=true; g.players[1].hp=1; g.players[1].maxHp=1;
  g.players[2].role='zhong'; g.players[2].roleRevealed=false;
  g.players[3].role='nei';   g.players[3].roleRevealed=false;
  g.players.forEach((p,i)=>{ if(i!==1) p.hp=4; p.hand=[]; p.equips=R('emptyEquips')(); p.delays=[]; p.alive=true; });
  bindG(g);
  const dealDamage = R('dealDamage');
  let gg = vm.runInContext('_g', sandbox);
  const canSeeRole = R('canSeeRole');

  // 结束前(伤害尚未打出):座位2/3的身份对彼此、对反贼杀手都应保持隐藏(既有规则,未受本次改动影响)
  assert.strictEqual(canSeeRole(gg, 0, 2), false, '结束前:反贼不应能看到忠臣(座位2)的身份');
  assert.strictEqual(canSeeRole(gg, 0, 3), false, '结束前:反贼不应能看到内奸(座位3)的身份');

  const dying = dealDamage(gg, 1, 1, 0, '受到伤害', 'sha'); // 座位0(反贼)对座位1(主公)造成1点伤害
  assert.strictEqual(dying, true, 'dealDamage 应挂起濒死流程');
  gg = runDyingLoopNoTao(); // 无人有桃,问完一圈后主公真实阵亡→checkWin应判定反贼胜

  assert.strictEqual(gg.phase, 'over', '主公死、反贼仍活,游戏应结束');
  assert.strictEqual(gg.winSide, 'fan');

  // 断言1(核心):结束后全部座位(不论死没死、不论此前是否翻开过)roleRevealed都应为true
  gg.players.forEach((p,i)=>{
    assert.strictEqual(p.roleRevealed, true, 'seat'+i+' 结束后roleRevealed应为true,实际='+p.roleRevealed);
  });
  // 断言2:canSeeRole 结束后对任意viewer/target组合都应返回true(哪怕viewer/target都是此前
  // 从未死过、从未主动翻开身份的座位2/3)
  for(let viewer=0; viewer<4; viewer++){
    for(let target=0; target<4; target++){
      assert.strictEqual(canSeeRole(gg, viewer, target), true,
        'canSeeRole(g,'+viewer+','+target+') 结束后应为true,实际='+canSeeRole(gg, viewer, target));
    }
  }
});

check('普通模式(ffa)回归:游戏结束不应受本次改动影响,roleRevealed字段行为不变', ()=>{
  const g = freshG(2);
  g.gameMode = 'ffa'; g.started = true; g.phase = 'play';
  g.players.forEach(p=>{ p.role=null; p.roleRevealed=false; p.alive=true; });
  g.players[1].alive = false; // 只剩座位0存活
  const checkWin = R('checkWin');
  const over = checkWin(g);
  assert.strictEqual(over, true, 'ffa下应正常判定结束(存活<=1)');
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.winSide, null, 'ffa结束不应设置winSide');
  // roleRevealed字段本来就一直是false(ffa模式role恒为null),这次改动的代码块严格限定在
  // g.gameMode==='identity'分支内,不应该被执行到,字段应保持原值不被波及
  g.players.forEach((p,i)=>{
    assert.strictEqual(p.roleRevealed, false, 'ffa下seat'+i+' roleRevealed不应被这次改动改动,实际='+p.roleRevealed);
  });
});

check('未结束路径回归:checkWin被调用但胜负条件不满足 → roleRevealed不应被提前批量翻转', ()=>{
  const g = freshG(4);
  g.gameMode = 'identity';
  // 死的是忠臣,主公/反贼/内奸都还活着——胜负条件都不满足,checkWin应提前return false
  g.players[0].role='fan';   g.players[0].roleRevealed=false; g.players[0].alive=true;
  g.players[1].role='zhong'; g.players[1].roleRevealed=false; g.players[1].alive=false; // 已死但只是忠臣,不构成任何胜负条件
  g.players[2].role='zhu';   g.players[2].roleRevealed=true;  g.players[2].alive=true;
  g.players[3].role='nei';   g.players[3].roleRevealed=false; g.players[3].alive=true;
  const checkWin = R('checkWin');
  const over = checkWin(g);
  assert.strictEqual(over, false, '主公/反贼/内奸都还活着,不应判定结束');
  assert.notStrictEqual(g.phase, 'over');
  // 断言核心:未结束时,不该死的忠臣roleRevealed可以已经是true(那是finishDying单独设的,
  // 不归这次改动管),但从未死过的反贼/内奸不应该被这次改动提前批量翻开
  assert.strictEqual(g.players[0].roleRevealed, false, '反贼(座位0)未死,不应被checkWin提前翻开身份');
  assert.strictEqual(g.players[3].roleRevealed, false, '内奸(座位3)未死,不应被checkWin提前翻开身份');
  const canSeeRole = R('canSeeRole');
  assert.strictEqual(canSeeRole(g, 1, 0), false, '死一个忠臣不应意外让全场身份都亮了——反贼身份仍应隐藏');
  assert.strictEqual(canSeeRole(g, 1, 3), false, '内奸身份仍应隐藏');
});

check('端到端②(UI数据层验证):游戏结束后重新查询,此前存活未死的角色现在也"可见"(不是空白)', ()=>{
  // 复用①的终局状态,模拟座位卡渲染逻辑会做的判断:g.started&&gen 决定显示不显示,
  // canSeeRole决定身份色块显示不显示——结束后,座位2(忠臣,全程存活未死)现在也应该"可见"。
  const g = freshG(4);
  g.gameMode = 'identity'; g.started = true; g.phase = 'play'; g.turn = 0;
  g.deck = Array.from({length:10}, (_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:1}));
  g.players[0].role='fan';   g.players[0].roleRevealed=false;
  g.players[1].role='zhu';   g.players[1].roleRevealed=true; g.players[1].hp=1; g.players[1].maxHp=1;
  g.players[2].role='zhong'; g.players[2].roleRevealed=false;
  g.players[3].role='nei';   g.players[3].roleRevealed=false;
  g.players.forEach((p,i)=>{ if(i!==1) p.hp=4; p.hand=[]; p.equips=R('emptyEquips')(); p.delays=[]; p.alive=true; });
  bindG(g);
  const dealDamage = R('dealDamage');
  let gg = vm.runInContext('_g', sandbox);
  const canSeeRole = R('canSeeRole');

  assert.strictEqual(canSeeRole(gg, 0, 2), false, '游戏进行中:座位2(存活忠臣)身份应对旁观者隐藏');

  dealDamage(gg, 1, 1, 0, '受到伤害', 'sha');
  gg = runDyingLoopNoTao();
  assert.strictEqual(gg.phase, 'over');
  assert.strictEqual(gg.players[2].alive, true, '座位2(忠臣)应全程存活,从未经历finishDying');

  // 模拟renderSeatCard里"这个座位该不该显示身份色块"的判断逻辑:g.started(结束后仍true)
  // && canSeeRole(g,mySeat,seat) —— 任取一个旁观视角(座位0)重新渲染这个从未死过的座位2
  const shouldShowIdentityBlock = gg.started && canSeeRole(gg, 0, 2);
  assert.strictEqual(shouldShowIdentityBlock, true,
    '结束后,座位2(全程存活、从未主动翻开过身份)现在应该"可见"(不再是空白/隐藏)');
  assert.strictEqual(ROLE_LABEL_FROM_SANDBOX(sandbox)['zhong'], '忠臣'); // 顺带确认ROLE_LABEL可查到正确文案
});

function ROLE_LABEL_FROM_SANDBOX(sb){ return vm.runInContext('ROLE_LABEL', sb); }

console.log('\n== summary ==');
console.log('passed:', passed, 'failed:', failed);
process.exit(failed ? 1 : 0);
