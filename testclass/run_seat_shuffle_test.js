// run_seat_shuffle_test.js —— GAME P2 #104 回归:开局座位号随机打乱 + 房主稳定标识
// 规格:GitHub Issue #104(开局座位号完全由加入顺序决定,从未随机打乱)
// 修复:①joinRoom 首个加入者打 owner:true 标记;②startGame 事务内 shuffleSeats 随机重排
//      g.players(只动数组顺序,player 对象引用原样保留);③isRoomOwner 改为按 owner 标记
//      判定,不再硬编码座位 0。
// 用法: node testclass/run_seat_shuffle_test.js
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.stack || e.message); failed++; }
}

// 元素桩:按 id 区分,供 joinRoom 读 roomInput/nameInput 值、写 lobbyErr 文案
const elMap = {};
function mkEl(){
  return {
    onclick:null, innerHTML:'', style:{}, className:'', textContent:'', value:'',
    classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }
  };
}

const context = {
  // ref().transaction 捕获回调,供 joinRoom 用例手动喂入旧/新房间状态
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(fn){ context.__txFn = fn; return {}; },
      set(){}, update(){}, child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; }
    }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(id){ return elMap[id] || (elMap[id] = mkEl()); },
    createElement(){ return mkEl(); },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){} }; },
    body:{ appendChild(){} }, head:{ appendChild(){} },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
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
function R(code){ return vm.runInContext(code, sandbox); }

const files = ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js'];
console.log('Loading...');
files.forEach(f=>{
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename:f });
  if(f === 'game.js'){
    // 与 run_identity_mode_test 同款 tx 桩:对共享 _g 做事务(写路径先 normalize)
    vm.runInContext(`
      var _g = null;
      tx = function(fn){
        if(!_g) return;
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

// 大厅状态构造:座位0 是房主(owner:true),其余普通玩家
function mkPlayers(n){
  return Array.from({length:n}, (_,i)=>({
    name:'P'+i, cid:'c'+i, hp:4, maxHp:4, hand:[], alive:true,
    equips:R('emptyEquips')(), delays:[], ...(i===0 ? {owner:true} : {})
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
function bindG(g){ sandbox.__tg = g; R('_g = __tg;'); }

console.log('\n== Task A: shuffleSeats 纯函数 ==\n');

check('shuffleSeats 存在且是函数', ()=>{
  assert.strictEqual(typeof R('shuffleSeats'), 'function');
});

check('shuffleSeats: cid 集合不变、player 对象引用齐全、长度不变', ()=>{
  const g = freshG(4);
  const beforeCids = g.players.map(p=>p.cid).sort().join(',');
  const refs = g.players.slice(); // 原对象引用集合
  R('shuffleSeats')(g);
  assert.strictEqual(g.players.length, 4);
  assert.strictEqual(g.players.map(p=>p.cid).sort().join(','), beforeCids, 'cid 集合不应有丢失/新增');
  g.players.forEach(p=>{
    assert.ok(refs.includes(p), '每个座位都应是原数组中的同一个对象引用(只动顺序不动内容)');
  });
  // owner 标记跟着对象走,重排后仍在数组里
  assert.ok(g.players.some(p=>p.owner === true));
});

check('shuffleSeats: stub Math.random 恒 0.5 → 确定性重排(验证打乱逻辑真实生效)', ()=>{
  const g = freshG(4); // cids: c0,c1,c2,c3
  const origRandom = Math.random;
  Math.random = ()=>0.5;
  try {
    R('shuffleSeats')(g);
  } finally {
    Math.random = origRandom;
  }
  // 降序 Fisher-Yates,恒 j=floor(0.5*(i+1)):
  //   i=3: j=2 → 换3/2 → c0,c1,c3,c2
  //   i=2: j=1 → 换2/1 → c0,c3,c1,c2
  //   i=1: j=1 → 无操作
  // 固定输出 c0,c3,c1,c2,且必须 ≠ 加入顺序
  const order = g.players.map(p=>p.cid).join(',');
  assert.notStrictEqual(order, 'c0,c1,c2,c3', '重排后顺序不应等于加入顺序,实际 '+order);
  assert.strictEqual(order, 'c0,c3,c1,c2', '恒 0.5 输入应产出确定排列,实际 '+order);
});

check('shuffleSeats: 空数组/无 players 安全', ()=>{
  assert.doesNotThrow(()=>R('shuffleSeats')({ players:[] }));
  assert.doesNotThrow(()=>R('shuffleSeats')({}));
});

console.log('\n== Task B: isRoomOwner 新语义(owner 标记,不再硬编码座位0) ==\n');

check('isRoomOwner: owner 玩家坐在座位0 → 是房主', ()=>{
  const g = { players:[{name:'主', owner:true, cid:'c0'},{name:'客', cid:'c1'}] };
  assert.strictEqual(R('isRoomOwner')(g, 0), true);
});

check('isRoomOwner: 无 owner 标记的座位0(老房间/普通玩家) → 不是房主', ()=>{
  const g = { players:[{name:'A', cid:'c0'},{name:'B', cid:'c1'}] };
  assert.strictEqual(R('isRoomOwner')(g, 0), false);
});

check('isRoomOwner: 重排后 owner 不在座位0 → 仍判定为房主;座位0普通玩家不是房主', ()=>{
  // 模拟 shuffleSeats 后 owner 被排到座位2
  const g = { players:[{name:'客', cid:'c0'},{name:'客2', cid:'c1'},{name:'主', cid:'c2', owner:true}] };
  assert.strictEqual(R('isRoomOwner')(g, 2), true, 'owner 在座位2 应是房主');
  assert.strictEqual(R('isRoomOwner')(g, 0), false, '座位0 的普通玩家不是房主');
  assert.strictEqual(R('isRoomOwner')(g, 1), false);
});

check('isRoomOwner: isBot 防御——机器人即使误带 owner 标记也不当房主', ()=>{
  const g = { players:[{name:'bot', cid:'b1', owner:true, isBot:true}] };
  assert.strictEqual(R('isRoomOwner')(g, 0), false);
});

check('isRoomOwner: null / 空数组 / 坏座位安全', ()=>{
  assert.strictEqual(R('isRoomOwner')(null, 0), false);
  assert.strictEqual(R('isRoomOwner')({ players:[] }, 0), false);
  assert.strictEqual(R('isRoomOwner')({ players:['x'] }, 0), false);
  assert.strictEqual(R('isRoomOwner')({ players:[] }, -1), false);
});

console.log('\n== Task C: joinRoom 房主标记写入 ==\n');

check('joinRoom: 第一个加入者获得 owner:true', ()=>{
  R('__txFn = null;');
  context.document.getElementById('roomInput').value = 'room1';
  context.document.getElementById('nameInput').value = 'Alice';
  R('joinRoom();');
  assert.strictEqual(typeof context.__txFn, 'function', 'joinRoom 应发起事务');
  const out = context.__txFn(null); // g===null → 建房间
  assert.strictEqual(out.players.length, 1);
  assert.strictEqual(out.players[0].name, 'Alice');
  assert.strictEqual(out.players[0].owner, true, '首个加入者应打 owner 标记');
});

check('joinRoom: 第二个加入者不加 owner,已有房主标记保留', ()=>{
  // 换一个 cid 模拟"另一个客户端"(首例的 myClientId 会走重连复用路径)
  R('myClientId = "second-client"; __txFn = null;');
  context.document.getElementById('nameInput').value = 'Bob';
  R('joinRoom();');
  assert.strictEqual(typeof context.__txFn, 'function');
  const room = {
    started:false, players:[{name:'Alice', cid:'first-client', owner:true, hp:4, maxHp:4, hand:[], alive:true}],
    turn:0, phase:'lobby', deck:[], discard:[], pending:null,
    shaUsed:false, roundNum:1, roundSeatsActed:[], lastCardSound:null, lastSkillSound:null, log:[]
  };
  sandbox.__joinRoom2 = room;
  const out = R('__txFn(__joinRoom2)');
  assert.strictEqual(out.players.length, 2);
  assert.strictEqual(out.players[1].name, 'Bob');
  assert.ok(!out.players[1].owner, '第二个加入者不应获得 owner');
  assert.strictEqual(out.players[0].owner, true, '原房主的 owner 标记应保留');
});

console.log('\n== Task D: startGame 集成(重排贯穿,owner 标记随对象存活) ==\n');

check('身份局 4 人 startGame:重排后 owner 仍在、主公/身份配比正确、cid 集合不变', ()=>{
  const g = freshG(4);
  bindG(g);
  R('mySeat = 0; startGame("pick","identity");');
  const gg = R('_g');
  assert.strictEqual(gg.gameMode, 'identity');
  assert.strictEqual(gg.phase, 'pickingLordGeneral');
  // 身份配比:1主1忠1反1内
  const counts = {};
  gg.players.forEach(p=>{ counts[p.role] = (counts[p.role]||0)+1; });
  assert.deepStrictEqual(counts, {zhu:1,zhong:1,fan:1,nei:1});
  const lord = R('getLordSeat')(gg);
  assert.ok(lord >= 0 && lord < 4, '应能找到主公座位');
  assert.strictEqual(gg.players[lord].role, 'zhu');
  assert.strictEqual(gg.players[lord].roleRevealed, true);
  assert.strictEqual(gg.players[lord].generalChoices.length, 5, '主公 5 选 1');
  gg.players.forEach((p,i)=>{
    if(i === lord) return;
    assert.strictEqual(p.roleRevealed, false, '非主公不翻开身份');
    assert.strictEqual(p.generalChoices, null, '非主公等待主公先选');
  });
  // 房主标记与 cid 集合随重排保留(对象引用未变)
  assert.ok(gg.players.some(p=>p.owner === true), 'owner 标记应仍在数组中');
  assert.strictEqual(gg.players.find(p=>p.owner===true).cid, 'c0', 'owner 标记应仍在原房主的对象上');
  assert.strictEqual(gg.players.map(p=>p.cid).sort().join(','), 'c0,c1,c2,c3');
});

check('身份局 4 人完整开局:主公选将→全员选将→started=true 且从主公座位起手', ()=>{
  const g = freshG(4);
  bindG(g);
  R('mySeat = 0; startGame("pick","identity");');
  let gg = R('_g');
  const lord = R('getLordSeat')(gg);
  // 主公选将(避开左慈,避免 huashenPick 打断;5 候选里最多 1 个左慈,一定有非左慈可选)
  // 也避开袁术:若袁术是非主公座位,身份局主公回合 startTurn 会触发【妄尊】给袁术摸1张,
  // 使"全员初始手牌=4"的精确断言 flaky(妄尊行为本身正确,是测试假设需排除副作用源)。
  const lordPick = gg.players[lord].generalChoices.find(id=>id !== 'zuoci' && id !== 'yuanshu');
  assert.ok(lordPick, '主公应有可选的候选');
  R('mySeat = ' + lord);
  R('respondPickLordGeneral')(lordPick);
  gg = R('_g');
  assert.strictEqual(gg.phase, 'pickingGeneral');
  // 其余玩家用调试入口选非左慈/非袁术武将(排除袁术原因见上方主公选将注释)
  for(let i=0;i<4;i++){
    if(i === lord) continue;
    const safe = gg.players[i].generalChoices.find(id=>id !== 'zuoci' && id !== 'yuanshu');
    assert.ok(safe, 'seat'+i+' 应有非左慈非袁术候选');
    R('mySeat = ' + i);
    R('debugPickGeneral')(safe);
    gg = R('_g');
  }
  assert.strictEqual(gg.started, true, '全员选完应已开局, phase='+gg.phase);
  assert.strictEqual(gg.turn, lord, '身份局应从主公座位起手');
  assert.ok(gg.players.some(p=>p.owner === true), '开局后 owner 标记应仍在');
  gg.players.forEach((p,i)=>{
    assert.strictEqual(p.hand.length, 4, 'seat'+i+' 应拿到初始手牌');
  });
});

check('乱斗 pick 2 人:重排后进入选将,各玩家 3 候选', ()=>{
  const g = freshG(2);
  bindG(g);
  R('mySeat = 0; startGame("pick","ffa");');
  const gg = R('_g');
  assert.strictEqual(gg.gameMode, 'ffa');
  assert.strictEqual(gg.phase, 'pickingGeneral');
  gg.players.forEach((p,i)=>{
    assert.ok(Array.isArray(p.generalChoices), 'seat'+i);
    assert.strictEqual(p.generalChoices.length, 3, 'seat'+i);
  });
  assert.ok(gg.players.some(p=>p.owner === true));
  assert.strictEqual(gg.players.map(p=>p.cid).sort().join(','), 'c0,c1');
});

check('乱斗 random 2 人完整开局:started=true,座位0(重排后随机玩家)先手', ()=>{
  const g = freshG(2);
  bindG(g);
  R('mySeat = 0; startGame("random","ffa");');
  let gg = R('_g');
  // 若随机分到左慈 → 处理 huashenPick(与 run_identity_mode_test 同款兜底)
  let guard = 0;
  while(gg.phase === 'huashenPick' && gg.pending && guard < 10){
    const s = gg.pending.seat;
    const pl = gg.players[s];
    const pool = pl.huashenPool || [];
    let gid = null, sk = null;
    for(const cand of pool){
      const entry = R('HUASHEN_SKILL_TABLE')[cand];
      if(entry && entry[0] && entry[0].name){ gid = cand; sk = entry[0].name; break; }
    }
    if(gid && sk){
      R('mySeat = ' + s);
      R('respondHuashenPick')(gid, sk);
    } else {
      pl.huashenGeneral = pool[0];
      pl.huashenSkillName = sk || 'x';
      gg.pending = null;
      R('checkHuashenBeforeAssign')(gg);
    }
    gg = R('_g');
    guard++;
  }
  assert.strictEqual(gg.started, true, '应已开局, phase='+gg.phase);
  assert.strictEqual(gg.turn, 0, '乱斗仍从座位0起手(重排后座位0=随机玩家)');
  assert.ok(gg.players.some(p=>p.owner === true), '开局后 owner 标记应仍在');
  gg.players.forEach(p=>{ assert.strictEqual(p.hand.length, 4); });
  assert.strictEqual(gg.players.map(p=>p.cid).sort().join(','), 'c0,c1');
});

check('组队 pick 4 人:重排后进入选将,队伍归属(对象引用)保留', ()=>{
  const g = freshG(4);
  g.players[0].team=0; g.players[1].team=0; g.players[2].team=1; g.players[3].team=1;
  g.gameMode = 'team'; // 选队已锁定(生产环境 joinTeam 写过 gameMode),normalize 才不抹 team
  bindG(g);
  R('mySeat = 0; startGame("pick","team");');
  const gg = R('_g');
  assert.strictEqual(gg.gameMode, 'team');
  assert.strictEqual(gg.phase, 'pickingGeneral');
  assert.strictEqual(gg.players.map(p=>p.team).sort().join(','), '0,0,1,1', '队伍归属应随玩家对象保留');
  assert.ok(gg.players.some(p=>p.owner === true));
  assert.strictEqual(gg.players.map(p=>p.cid).sort().join(','), 'c0,c1,c2,c3');
});

console.log('\n== Task E: ensureOwner 存量房间迁移(#104 部署兼容) ==\n');

check('ensureOwner 存在且是函数', ()=>{
  assert.strictEqual(typeof R('ensureOwner'), 'function');
});

check('ensureOwner: 无 owner 老房间 → 第一个非 bot 玩家被补 owner:true', ()=>{
  const g = { players:[
    {name:'机', isBot:true, cid:'b0'},
    {name:'A', cid:'c0'},
    {name:'B', cid:'c1'}
  ] };
  R('ensureOwner')(g);
  assert.strictEqual(g.players[0].owner, undefined, 'bot 不应被补 owner');
  assert.strictEqual(g.players[1].owner, true, '第一个非 bot 玩家应被补 owner(老房间从未重排,数组首位即原房主)');
  assert.strictEqual(g.players[2].owner, undefined);
  assert.strictEqual(g.players.filter(p=>p.owner).length, 1, '只补一个 owner');
});

check('ensureOwner: 已有 owner 时不变', ()=>{
  const g = { players:[
    {name:'主', owner:true, cid:'c0'},
    {name:'客', cid:'c1'}
  ] };
  R('ensureOwner')(g);
  assert.strictEqual(g.players[0].owner, true);
  assert.strictEqual(g.players[1].owner, undefined);
  assert.strictEqual(g.players.filter(p=>p.owner).length, 1);
});

check('ensureOwner: 全 bot 房间不补(避免机器人被认作房主)', ()=>{
  const g = { players:[{name:'bot1', isBot:true},{name:'bot2', isBot:true}] };
  R('ensureOwner')(g);
  assert.ok(g.players.every(p=>!p.owner));
});

check('ensureOwner: 空 players/无 players 安全,幂等', ()=>{
  assert.doesNotThrow(()=>R('ensureOwner')({ players:[] }));
  assert.doesNotThrow(()=>R('ensureOwner')({}));
  const g = { players:[{name:'A', owner:true},{name:'B'}] };
  R('ensureOwner')(g);
  R('ensureOwner')(g); // 再调不变
  assert.strictEqual(g.players.filter(p=>p.owner).length, 1);
  assert.strictEqual(g.players[0].owner, true);
});

console.log('\n== Task F: 存量老房间集成(无 owner → startGame 守卫放行) ==\n');

check('老房间(无 owner) startGame 通过守卫:ensureOwner 迁移 → isRoomOwner 放行', ()=>{
  // 修复前创建的真实房间:players 无任何 owner 标记(部署后存量房间真实状态)
  const g = {
    started:false, players:[
      {name:'P0', cid:'c0', hp:4, maxHp:4, hand:[], alive:true, equips:R('emptyEquips')(), delays:[]},
      {name:'P1', cid:'c1', hp:4, maxHp:4, hand:[], alive:true, equips:R('emptyEquips')(), delays:[]}
    ], turn:0, phase:'lobby', deck:[], discard:[], pending:null, aoe:null, log:[],
    gameMode:null, winSide:null, lordGeneralPool:null,
    roundNum:1, roundSeatsActed:[], exchangeCards:[],
    shaUsed:false, lastCardSound:null, lastSkillSound:null
  };
  assert.ok(g.players.every(p=>!p.owner), '前置:老房间应无 owner 标记');
  bindG(g);
  R('mySeat = 0; startGame("pick","ffa");');
  const gg = R('_g');
  assert.strictEqual(gg.gameMode, 'ffa', '守卫应放行(seat0 被补 owner → isRoomOwner 通过)');
  assert.strictEqual(gg.phase, 'pickingGeneral', '应正常进入选将流程');
  assert.ok(gg.players.some(p=>p.owner === true), '开局后应有玩家被补 owner 标记');
  assert.strictEqual(gg.players.map(p=>p.cid).sort().join(','), 'c0,c1', 'cid 集合不变');
});

console.log('\n== summary ==');
console.log('passed:', passed, 'failed:', failed);
process.exit(failed ? 1 : 0);
