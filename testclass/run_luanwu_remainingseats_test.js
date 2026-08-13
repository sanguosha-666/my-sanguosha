/**
 * 修复:贾诩【乱武】pending 被 normalize 误杀——debugLogs 抓到真实
 * pending_orphan_detected(phase=luanwuChoose,currentSeat=6/sourceSeat=0,
 * 7人局,缺 remainingSeats 字段)。
 *
 * 排查结论:
 * ①先排除"debugLogs白名单遗漏remainingSeats导致误报"——检查 debug-log.js 的
 *   PENDING_SNAPSHOT_ALLOWED_FIELDS,remainingSeats 本来就在白名单里,这条日志
 *   是真实反映(不是被过滤掉、看起来缺失实际是被删掉的假象)。
 * ②真实根因:CLAUDE.md 记录的 Firebase 坑——"存进去的空数组读回来会变成
 *   undefined"。乱武链条推进到最后一人时 remainingSeats 正好是空数组([]),
 *   写入 Firebase 后下一次读出来这个字段就直接消失(不是空数组,是没有这个
 *   key),normalize 里 `!Array.isArray(d.remainingSeats)` 命中,把整个刚推进
 *   到"最后一人"的 pending 判死清空——症状和之前"remainingSeats.length===0
 *   被误判"那次几乎一样,只是触发路径从"检查长度"变成了"检查字段类型",是
 *   同一个 Firebase 坑在同一处代码的第二次翻版。g.luanwuResume.remainingSeats
 *   (杀路径跨pending接回链用的字段)也有同一个坑。
 *
 * 修复:两处都改成"remainingSeats 不是数组时补默认值 []",而不是把整个
 * pending/luanwuResume 判死清空——本地 stub 测试模拟"Firebase 吞掉空数组"这
 * 个真实序列化行为(用 JSON 往返 + 手动删除空数组字段来模拟,因为项目测试用
 * 的 tx stub 本身不模拟 Firebase 的这条特殊行为,必须显式构造这个场景)。
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

['config.js','data.js', 'stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>{
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
// simulateFirebaseRoundTrip: 模拟"Firebase 存进去的空数组读回来会变成 undefined"这条
// 真实序列化行为——递归删掉所有长度为0的数组字段(JSON.stringify 不会自动做这件事,
// 这里手动模拟,不是简单 JSON 往返)。
function simulateFirebaseRoundTrip(obj){
  if(Array.isArray(obj)){
    return obj.map(simulateFirebaseRoundTrip);
  }
  if(obj && typeof obj==='object'){
    const out = {};
    Object.keys(obj).forEach(function(k){
      const v = obj[k];
      if(Array.isArray(v) && v.length===0) return; // 空数组:Firebase 吞掉,key 直接消失
      out[k] = simulateFirebaseRoundTrip(v);
    });
    return out;
  }
  return obj;
}

console.log('\n== 贾诩【乱武】remainingSeats 被 Firebase 空数组坑误杀的回归 ==\n');

// 场景1:白名单确认——remainingSeats 本来就在 debug-log.js 的白名单里
check('确认:remainingSeats 已在 PENDING_SNAPSHOT_ALLOWED_FIELDS 白名单里(排除误报可能)', ()=>{
  const src = fs.readFileSync(path.join(ROOT,'debug-log.js'), 'utf8');
  const m = src.match(/PENDING_SNAPSHOT_ALLOWED_FIELDS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, '找不到 PENDING_SNAPSHOT_ALLOWED_FIELDS 定义');
  assert.ok(m[1].indexOf("'remainingSeats'") >= 0, 'remainingSeats 应已在白名单里');
});

// 场景2:7人局,乱武链条推进到最后一人(currentSeat=6,remainingSeats本该是[])——
// 模拟这个 pending 经过一次 Firebase 空数组吞噬后再走 normalize,应保留 pending
// 而不是被清空(还原 debugLogs 记录的真实现场)
check('7人局链条推进到最后一人,remainingSeats=[]经Firebase往返变undefined后不应被清空', ()=>{
  const players = [];
  for(let i=0;i<7;i++) players.push(mkPlayer('P'+i, 'yuJi'));
  players[0] = mkPlayer('贾诩','jiaxu');
  let g = {
    phase:'luanwuChoose', turn:0, started:true, players,
    deck:[], discard:[], log:[], exchangeCards:[], gameMode:'ffa',
    pending: { type:'luanwuChoose', currentSeat:6, remainingSeats:[], sourceSeat:0, targetMap:{} }
  };
  // 模拟这份 pending 被写入 Firebase 又读回来(remainingSeats:[] 消失)
  g.pending = simulateFirebaseRoundTrip(g.pending);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(g.pending,'remainingSeats'), false,
    '模拟环节本身应确认 remainingSeats 字段已经消失(否则没有复现Firebase的坑)');

  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.strictEqual(gg.phase, 'luanwuChoose', 'normalize后pending不应被清空,实际phase='+gg.phase);
  assert.ok(gg.pending, 'pending不应为null');
  assert.strictEqual(gg.pending.type, 'luanwuChoose');
  assert.strictEqual(gg.pending.currentSeat, 6, 'currentSeat应保留');
  assert.ok(Array.isArray(gg.pending.remainingSeats), 'remainingSeats应补默认值为数组');
  assert.strictEqual(gg.pending.remainingSeats.length, 0, '应补为空数组(链条本来就该问到最后一人)');
});

// 场景3:对照——currentSeat/sourceSeat 真的指向不合法座位(死亡/越界)时,pending 仍应
// 被正确清空(确认这次修复没有削弱其它维度的校验)
check('对照:currentSeat指向已死亡角色时,pending仍应被正确清空(其它校验不受影响)', ()=>{
  const players = [];
  for(let i=0;i<7;i++) players.push(mkPlayer('P'+i, 'yuJi'));
  players[0] = mkPlayer('贾诩','jiaxu');
  players[6].alive = false; // 座位6已死亡
  const g = {
    phase:'luanwuChoose', turn:0, started:true, players,
    deck:[], discard:[], log:[], exchangeCards:[], gameMode:'ffa',
    pending: { type:'luanwuChoose', currentSeat:6, remainingSeats:[], sourceSeat:0, targetMap:{} }
  };
  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.strictEqual(gg.pending, null, 'currentSeat指向死亡角色时pending应被清空');
  assert.strictEqual(gg.phase, 'play');
});

// 场景4:g.luanwuResume 同一坑——杀结算跨pending接回链用的字段,remainingSeats=[]
// 经Firebase往返变undefined后,luanwuResume不应被整体清空
check('g.luanwuResume.remainingSeats同一坑:经Firebase往返变undefined后不应整体清空luanwuResume', ()=>{
  const players = [];
  for(let i=0;i<7;i++) players.push(mkPlayer('P'+i, 'yuJi'));
  players[0] = mkPlayer('贾诩','jiaxu');
  let g = {
    phase:'play', turn:0, started:true, players,
    deck:[], discard:[], log:[], exchangeCards:[], gameMode:'ffa', pending:null,
    luanwuResume: { sourceSeat:0, remainingSeats:[], targetMap:{} }
  };
  g.luanwuResume = simulateFirebaseRoundTrip(g.luanwuResume);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(g.luanwuResume,'remainingSeats'), false,
    '模拟环节应确认字段已消失');

  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.ok(gg.luanwuResume, 'luanwuResume不应被整体清空');
  assert.strictEqual(gg.luanwuResume.sourceSeat, 0);
  assert.ok(Array.isArray(gg.luanwuResume.remainingSeats), 'remainingSeats应补默认值为数组');
  assert.strictEqual(gg.luanwuResume.remainingSeats.length, 0);
});

// 场景5:对照——g.luanwuResume.sourceSeat 类型不合法时,仍应被整体清空(确认没有削弱这条)
check('对照:luanwuResume.sourceSeat类型不合法时仍应被整体清空', ()=>{
  const players = [];
  for(let i=0;i<3;i++) players.push(mkPlayer('P'+i, 'yuJi'));
  const g = {
    phase:'play', turn:0, started:true, players,
    deck:[], discard:[], log:[], exchangeCards:[], gameMode:'ffa', pending:null,
    luanwuResume: { sourceSeat:'not-a-number', remainingSeats:[] }
  };
  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.strictEqual(gg.luanwuResume, null, 'sourceSeat类型不合法应整体清空luanwuResume');
});

// 场景6:端到端——完整走一遍 startLuanwu→chooseLuanwuOption 链条推进到最后一人,期间
// 每一步都过一次"模拟Firebase往返"(和真实tx→写入→下次normalize的时序等价),验证最后
// 一人真的能被问到,不会在半路被吞掉(还原用户最初报告的symptom:"最后一人从不会被真正
// 询问")
check('端到端:3人局乱武链条经反复Firebase往返模拟,最后一人仍能被正确询问到', ()=>{
  const jiaxu = mkPlayer('贾诩','jiaxu');
  const p1 = mkPlayer('玩家1','yuJi');
  const p2 = mkPlayer('玩家2','yuJi');
  let g = {
    phase:'play', turn:0, started:true, players:[jiaxu,p1,p2],
    deck: Array.from({length:20},(_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:(i%13)+1})),
    discard:[], log:[], exchangeCards:[], gameMode:'ffa', pending:null, luanwuUsed:false
  };
  bindG(g);
  setSeat(0);
  R('startLuanwu')();
  let gg = G();
  assert.strictEqual(gg.phase, 'luanwuChoose');
  assert.strictEqual(gg.pending.currentSeat, 1, '应先问座位1');
  assert.strictEqual(JSON.stringify(gg.pending.remainingSeats), JSON.stringify([2]));

  // 模拟这份pending经Firebase往返(此时remainingSeats=[2]非空,不受影响)
  gg.pending = simulateFirebaseRoundTrip(gg.pending);
  bindG(gg);
  R('normalize')(G());
  gg = G();
  assert.strictEqual(gg.phase, 'luanwuChoose', '第1次往返后pending应仍在');

  setSeat(1);
  R('chooseLuanwuOption')('hp'); // 座位1选择失去体力,推进到座位2(remainingSeats变为[])
  gg = G();
  assert.strictEqual(gg.pending.currentSeat, 2, '应推进到座位2(最后一人)');
  assert.strictEqual(JSON.stringify(gg.pending.remainingSeats), JSON.stringify([]), '此时remainingSeats应为空数组');

  // 关键步骤:模拟这份"链条到最后一人"的pending经过Firebase往返(空数组变undefined),
  // 再走一次normalize——这正是debugLogs记录的那个真实场景
  gg.pending = simulateFirebaseRoundTrip(gg.pending);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(gg.pending,'remainingSeats'), false);
  bindG(gg);
  R('normalize')(G());
  gg = G();
  assert.strictEqual(gg.phase, 'luanwuChoose', '最后一人的pending不应被误杀,实际phase='+gg.phase);
  assert.ok(gg.pending, 'pending不应为null');
  assert.strictEqual(gg.pending.currentSeat, 2, '座位2仍应是当前被问的人');

  // 座位2也能正常响应,链条正确结束
  setSeat(2);
  R('chooseLuanwuOption')('hp');
  gg = G();
  assert.strictEqual(gg.pending, null, '最后一人问完,链条应正常结束');
  assert.strictEqual(gg.phase, 'play');
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败\n');
if(failed>0) process.exit(1);
