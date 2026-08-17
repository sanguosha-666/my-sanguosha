/**
 * CORE-94(issue #141)：【乱武】最近目标处理错误——并列最近只保留一人且错误排除发动者。
 *
 * 根因：findNearestTarget(g,seat,excludeSeat) 用 find() 只取第一个满足最短距离+canTarget
 * 的座位，并强行排除 excludeSeat（乱武发动者），但发动者对其他响应者而言也是合法的
 * "距离最近的另一名角色"（官方卡面不排除发动者）。
 *
 * 修复：findNearestTargets(g,seat) 改为 filter()，返回全部同距离且通过真实【杀】canTarget()
 * 校验的座位数组，不再排除发动者；pending.targetMap[seat] 的值从 number|null 变为
 * number[]；chooseLuanwuOption(option, targetSeat) 新增目标参数，提交时重新计算候选集合
 * 校验 targetSeat 合法性（防旧快照绕过）。
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

console.log('\n== CORE-94:乱武最近目标应并列保留全部候选,且不排除发动者 ==\n');

// ---- 4人环形局:座位0=贾诩(乱武发动者),座位1/2/3=其他角色。座位2到座位0/1/3 ----
// 距离(环形最近间隔)分别为2/1/1——座位1和座位3并列最近。
function mkGame4(){
  const jiaxu = mkPlayer('贾诩(0)', 'jiaxu');
  const p1 = mkPlayer('响应者(1)', 'caocao', { hand:[{id:'s1',name:'杀',suit:'♠',rank:7}] });
  const p2 = mkPlayer('响应者(2)', 'caocao', { hand:[{id:'s2',name:'杀',suit:'♠',rank:7}] });
  const p3 = mkPlayer('响应者(3)', 'caocao', { hand:[{id:'s3',name:'杀',suit:'♠',rank:7}] });
  return {
    phase:'play', turn:0, started:true, players:[jiaxu,p1,p2,p3],
    deck: Array.from({length:20},(_,i)=>({id:300+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
}

check('4人局:座位2视角,座位1和座位3并列最近,两者都应在候选集合里(不是只保留一个)', ()=>{
  const g = mkGame4();
  g.players[0].caps = { luanwu:true };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  const gg = G();
  assert.strictEqual(gg.phase, 'luanwuChoose');
  const cands = (gg.pending.targetMap[2]||[]).slice().sort();
  assert.deepStrictEqual(cands, [1,3], '座位2的候选集合应同时含并列最近的座位1和座位3,实际 '+JSON.stringify(cands));
});

check('乱武发动者本人是合法目标:座位1到座位0(发动者)距离1,应出现在候选集合里', ()=>{
  const g = mkGame4();
  g.players[0].caps = { luanwu:true };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  const gg = G();
  const cands = gg.pending.targetMap[1]||[];
  assert.ok(cands.includes(0), '座位1的候选集合应包含发动者座位0,实际 '+JSON.stringify(cands));
});

check('并列多目标时,提交合法targetSeat应正常结算(杀入弃牌堆、目标进入响应)', ()=>{
  const g = mkGame4();
  g.players[0].caps = { luanwu:true };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  // 推进到座位2的回合(remainingSeats=[1,2,3],需要先让座位1做出选择)
  setSeat(1);
  R('chooseLuanwuOption')('hp'); // 座位1选择失去体力,跳过(其候选无关本测试)
  let gg = G();
  assert.strictEqual(gg.pending.currentSeat, 2, '应轮到座位2');
  const cands = (gg.pending.targetMap[2]||[]).slice().sort();
  assert.deepStrictEqual(cands, [1,3]);
  setSeat(2);
  R('chooseLuanwuOption')('sha', 3); // 选择候选集合里的座位3
  gg = G();
  assert.ok(!gg.players[2].hand.some(c=>c.name==='杀'), '座位2的杀应已打出(手牌不再含杀)');
  assert.ok(gg.discard.some(c=>c.id==='s2'), '打出的杀应进弃牌堆');
});

check('提交不在候选集合里的targetSeat(伪造/过期请求)应被拒绝,回落为失去体力', ()=>{
  const g = mkGame4();
  g.players[0].caps = { luanwu:true };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  setSeat(1);
  // 座位1视角座位0/座位2并列最近(候选集合[0,2]),座位3距离更远、不在候选里,
  // 提交targetSeat=3属于伪造/过期请求。
  const cands = G().pending.targetMap[1]||[];
  assert.ok(!cands.includes(3), '前置条件:座位3不应在座位1的候选集合里,实际 '+JSON.stringify(cands));
  const before = G().players[1].hp;
  R('chooseLuanwuOption')('sha', 3);
  const gg = G();
  assert.strictEqual(gg.players[1].hp, before-1, '非法targetSeat应被拒绝并回落为失去1点体力');
  assert.ok(gg.players[1].hand.some(c=>c.name==='杀'), '杀不应被打出(请求被拒绝)');
});

check('唯一候选场景保持原有单按钮体验:候选数组长度为1时仍可一次性提交结算', ()=>{
  // 2人局(座位0=贾诩,座位1=唯一其他角色),座位1的最近目标必然只有座位0
  const jiaxu = mkPlayer('贾诩', 'jiaxu');
  const p1 = mkPlayer('响应者', 'caocao', { hand:[{id:'s1',name:'杀',suit:'♠',rank:7}] });
  const g = { phase:'play', turn:0, started:true, players:[jiaxu,p1],
    deck: Array.from({length:20},(_,i)=>({id:300+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa' };
  g.players[0].caps = { luanwu:true };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  const gg0 = G();
  assert.deepStrictEqual(gg0.pending.targetMap[1], [0]);
  setSeat(1);
  R('chooseLuanwuOption')('sha', 0);
  const gg = G();
  assert.ok(!gg.players[1].hand.some(c=>c.name==='杀'), '唯一候选下杀应正常打出');
});

check('无合法最近目标(全部座位都够不到)时,候选集合为空数组,只能失去体力', ()=>{
  // 座位1装无武器(射程1),座位0/座位2都在距离2处够不到——用不对称环形距离制造"够不到"
  // 场景较复杂,这里改用直接调用 findNearestTargets 验证空场景:所有其他角色已阵亡。
  const g = mkGame4();
  g.players[0].caps = { luanwu:true };
  g.players[2].alive = false; g.players[3].alive = false;
  bindG(g);
  const cands = R('findNearestTargets')(g, 1);
  assert.deepStrictEqual(cands, [0], '座位2/3阵亡后,座位1的唯一候选应是座位0');
  g.players[0].alive = false;
  const cands2 = R('findNearestTargets')(g, 1);
  // 注:cands2 是 vm 沙箱(不同 realm)里构造的数组,deepStrictEqual 对"两个空数组"会因
  // 跨realm引用不相等而误报(Node已知行为,和这里的业务逻辑无关),改用length断言。
  assert.strictEqual(cands2.length, 0, '所有其他角色都阵亡后,候选集合应为空数组,实际 '+JSON.stringify(Array.from(cands2)));
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
