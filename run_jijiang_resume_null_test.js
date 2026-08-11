/**
 * 修复:刘备【激将】主动入口(useJijiang)的 resume.pending=null 被 Firebase 吞掉,
 * normalize 误杀整个 jijiangAsk pending —— debugLogs 抓到真实
 * pending_orphan_detected(phase=jijiangAsk,lordSeat=0,asking=2,resume 只有 phase)。
 *
 * 排查结论(和乱武 remainingSeats 两次 bug 同族,第三次翻版):
 * ①useJijiang 主动激将构造 resume={phase:'play',pending:null,jijiangTarget:X}
 *   (出牌阶段主动激将,此时没有正在响应的原 pending,所以 pending 字段是 null)。
 * ②Firebase 序列化:null 值字段 = 删除该键(CLAUDE.md 只记了"不保存空数组/空对象",
 *   null 是同一族序列化限制的第三个表现)。
 * ③读回来 resume 没有 pending 键 → normalize 校验
 *   `!Object.prototype.hasOwnProperty.call(resume,'pending')`(game.js)命中,
 *   把整个刚创建的 jijiangAsk pending 判死清空——主动激将 100% 失效(响应者点
 *   按钮时 tx 开头 normalize 已清掉 pending,守卫静默返回),debug 日志记一条
 *   pending_orphan_detected。
 * ④被动激将(respondShan/duelResponse/aoeRespond 里 canTriggerLordAsk 触发)的
 *   resume={phase:g.phase,pending:g.pending},pending 是真实对象非 null,不受影响。
 *
 * 修复:normalize 里 jijiangAsk/hujiaAsk 校验拆两层——必填结构字段
 * (lordSeat/asking/need/resume.phase)不合法才整体判死;resume 缺 pending 键时
 * 补默认 null(出牌阶段主动激将的合法中间态),不整体清空。和乱武修复同一模式。
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

['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>{
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
// simulateFirebaseRoundTrip: 模拟 Firebase 真实序列化行为——递归删掉所有
// 值为 null 的字段(以及长度为0的空数组,乱武测试已覆盖那类),本地 tx stub
// 不模拟这条特殊行为,必须显式构造。
function simulateFirebaseRoundTrip(obj){
  if(Array.isArray(obj)){
    return obj.map(simulateFirebaseRoundTrip);
  }
  if(obj && typeof obj==='object'){
    const out = {};
    Object.keys(obj).forEach(function(k){
      const v = obj[k];
      if(v===null || v===undefined) return;       // null/undefined:Firebase 吞掉,key 直接消失
      if(Array.isArray(v) && v.length===0) return; // 空数组:同前
      out[k] = simulateFirebaseRoundTrip(v);
    });
    return out;
  }
  return obj;
}

function baseGame(players, extra){
  return Object.assign({
    phase:'play', turn:0, started:true, players,
    deck:[], discard:[], log:[], exchangeCards:[], gameMode:'identity',
    pending:null
  }, extra||{});
}

console.log('\n== 刘备【激将】主动入口 resume.pending=null 被 Firebase 吞掉、normalize 误杀回归 ==\n');

// 场景0:确认 normalize 的 jijiangAsk 校验已拆层——resume 缺 pending 键时补默认而非判死
check('确认:normalize的jijiangAsk校验已拆层(resume缺pending键补null不判死)', ()=>{
  const src = fs.readFileSync(path.join(ROOT,'game.js'), 'utf8');
  const m = src.match(/if\(g\.pending && \(g\.pending\.type==='jijiangAsk'\|\|g\.pending\.type==='hujiaAsk'\)\)\{[\s\S]{0,600}/);
  assert.ok(m, '应找到 jijiangAsk/hujiaAsk 校验块');
  assert.ok(m[0].indexOf('d.resume.pending = null') >= 0, '应存在 resume 缺 pending 键补 null 的分支');
  assert.ok(m[0].indexOf('hasOwnProperty') >= 0, '补 null 分支本身用到 hasOwnProperty(判断键缺失)');
});

// 场景1:主动激将 resume={phase:'play',pending:null,jijiangTarget:X} 经 Firebase 往返后
// pending 键消失 → normalize 应保留 pending(补默认null),不误杀
check('主动激将resume经Firebase往返后normalize不应清空pending', ()=>{
  const players = [
    mkPlayer('主公', 'liubei', { role:'zhu' }),
    mkPlayer('蜀1', 'zhaoyun', {}),
    mkPlayer('魏1', 'simayi', {}),
  ];
  let g = baseGame(players);
  g.phase='jijiangAsk';
  g.pending = { type:'jijiangAsk', lordSeat:0, asking:1, need:'杀',
    resume:{ phase:'play', pending:null, jijiangTarget:2 }, askedAt:Date.now() };
  // 模拟这份 pending 被写入 Firebase 又读回来(resume.pending:null 消失)
  g.pending = simulateFirebaseRoundTrip(g.pending);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(g.pending.resume,'pending'), false,
    '模拟环节本身应确认 resume.pending 键已消失(否则没有复现Firebase的坑)');

  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.ok(gg.pending && gg.pending.type==='jijiangAsk',
    'normalize后pending应保留(主动激将resume.pending=null是合法中间态),实际 '+JSON.stringify(gg.pending));
  assert.strictEqual(gg.phase, 'jijiangAsk', 'phase应保持jijiangAsk');
  assert.ok(gg.pending.resume && Object.prototype.hasOwnProperty.call(gg.pending.resume,'pending'),
    'normalize应补回resume.pending键,实际 '+JSON.stringify(gg.pending.resume));
  assert.strictEqual(gg.pending.resume.pending, null, '补回的pending应为null');
});

// 场景2:被动激将(respondShan 路径,resume.pending 是真实对象)不受影响——零回归
check('被动激将resume.pending为真实对象时normalize保留原值', ()=>{
  const players = [
    mkPlayer('主公', 'liubei', { role:'zhu' }),
    mkPlayer('蜀1', 'zhaoyun', {}),
    mkPlayer('魏1', 'simayi', {}),
  ];
  const originalPending = { type:'respond', from:2, to:0, askedAt:Date.now() };
  let g = baseGame(players);
  g.phase='jijiangAsk';
  g.pending = { type:'jijiangAsk', lordSeat:0, asking:1, need:'杀',
    resume:{ phase:'respond', pending: originalPending }, askedAt:Date.now() };
  // 模拟 Firebase 往返:非 null 对象字段保留
  g.pending = simulateFirebaseRoundTrip(g.pending);
  assert.ok(Object.prototype.hasOwnProperty.call(g.pending.resume,'pending'),
    '被动激将resume.pending是对象,不应被吞');

  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.ok(gg.pending && gg.pending.type==='jijiangAsk', '被动激将pending应保留');
  assert.deepStrictEqual(gg.pending.resume.pending, originalPending, '对象型resume.pending不应被改动');
});

// 场景3:结构必填字段缺失(lordSeat 非数字)仍应判死——确认没有削弱校验
check('结构必填字段缺失仍判死清空(不削弱校验)', ()=>{
  const players = [ mkPlayer('主公','liubei',{role:'zhu'}), mkPlayer('蜀1','zhaoyun',{}) ];
  let g = baseGame(players);
  g.phase='jijiangAsk';
  g.pending = { type:'jijiangAsk', lordSeat:'x', asking:1, need:'杀',
    resume:{ phase:'play', pending:null }, askedAt:Date.now() };
  bindG(g);
  R('normalize')(g);
  const gg = G();
  assert.ok(!gg.pending, 'lordSeat 非数字应判死清空');
  assert.strictEqual(gg.phase, 'play');
});

// 场景4:端到端——完整走一遍 useJijiang 创建 → 模拟Firebase往返吞null → normalize →
// respondJijiangAsk 响应(和真实"tx写入→下次normalize"的时序等价),验证主动激将
// 真的能走通(还原用户报告的symptom:"主动激将报错/没反应")
check('端到端:主动激将经往返+normalize后响应者能正常出杀', ()=>{
  const players = [
    mkPlayer('主公', 'liubei', { role:'zhu', hand:[{id:'s1',name:'杀',suit:'♠',rank:7}] }),
    mkPlayer('蜀1', 'zhaoyun', { hand:[{id:'s2',name:'杀',suit:'♠',rank:5}] }),
    mkPlayer('蜀2', 'zhangfei', { hand:[] }),
    mkPlayer('魏1', 'simayi', { hand:[] }),
  ];
  let g = baseGame(players);
  g.deck = Array.from({length:20},(_,i)=>({id:'d'+i,name:'杀',suit:'♠',rank:(i%13)+1}));
  g.phase='play'; g.turn=0; g.jijiangUsed=false;
  bindG(g);
  setSeat(0);
  R('useJijiang')(1);
  let gg = G();
  assert.ok(gg.pending && gg.pending.type==='jijiangAsk', 'useJijiang后应有jijiangAsk pending');
  assert.strictEqual(gg.pending.resume.phase, 'play');
  assert.strictEqual(gg.pending.resume.jijiangTarget, 1);

  // 模拟这份pending经Firebase往返(pending:null 被吞)
  gg.pending = simulateFirebaseRoundTrip(gg.pending);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(gg.pending.resume,'pending'), false,
    '模拟环节应确认resume.pending已消失');
  bindG(gg);
  R('normalize')(G());
  gg = G();
  assert.ok(gg.pending && gg.pending.type==='jijiangAsk', 'normalize后主动激将pending应保留');
  assert.strictEqual(gg.pending.asking, 1, '应先问座位1(蜀将赵云)');

  // 座位1响应:出杀替主公打出
  setSeat(1);
  R('respondJijiangAsk')(true, 0);
  gg = G();
  // 出杀后 jijiangAsk 应结束,进入正常"杀的目标确认"阶段(phase='respond',等座位1出闪;
  // respond 类型的 pending 不存 type 字段,靠 phase 区分)
  assert.ok(gg.pending && gg.pending.from===0 && gg.pending.to===1,
    '出杀后应进入杀的目标确认(from=0,to=1),实际 '+JSON.stringify(gg.pending));
  assert.strictEqual(gg.phase, 'respond', 'phase 应为 respond');
});

console.log('\n 结果: '+passed+' 通过, '+failed+' 失败');
process.exit(failed>0?1:0);
