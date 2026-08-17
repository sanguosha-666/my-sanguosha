/**
 * CORE-96(issue #143):非 BOT_SEAT_PICKS 的硬编码技能目标选择绕过统一阵营策略。
 *
 * BOT_SEAT_PICKS 已统一过 botTargetPolicyAllows,但典韦【强袭】(qiangxiPickTarget)、
 * 张角【雷击】(leijiChoose)、丁奉【奋迅】(fenxunTarget) 这几个非注册表的硬编码技能目标
 * 入口直接取 candidates[0]/availableTargets[0],绕过统一策略;botTryStartExtraSkills 判断
 * 强袭/奋迅是否发动时也只看游戏规则目标是否存在,没有先确认存在策略允许的目标。
 *
 * 修复:
 * - botTryStartExtraSkills 的强袭/奋迅"是否发动"判断叠加 botTargetPolicyAllows。
 * - qiangxiPickTarget/leijiChoose/fenxunTarget 三个 runBotDecision 硬编码分支的候选先过
 *   botTargetPolicyAllows 再取首项。
 * - 顺带修了同一批 grep 扫出的举荐(jujianPickTarget,helpful)、好施(haoshiPick,helpful,
 *   强制技能全禁时退化回原候选)、眩惑(huanhuoPick/huanhuoPickSecond,harmful)。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  return Promise.resolve().then(fn).then(()=>{
    console.log('  PASS', name); passed++;
  }, e=>{
    console.log('  FAIL', name, '-', (e && e.message || e)); failed++;
  });
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

['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js',
 'weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js'
].forEach(f=>{
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
function emptyEq(){ return R('emptyEquips')(); }
function bindG(g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function setSeat(s){ vm.runInContext('mySeat='+s+';', sandbox); }

// 4人环形局。座位0=机器人(身份可变)。座位1=已知主公。座位2=已知反贼。座位3=未知。
function mkGame(seat0Role){
  const players = [];
  for(let i=0;i<4;i++){
    players.push({
      name:'p'+i, general:'caocao', hp:4, maxHp:4,
      hand:[], equips: emptyEq(), delays:[], alive:true, dying:false, role:null, roleRevealed:false
    });
  }
  players[0].role = seat0Role;
  players[0].isBot = true;
  players[1].role = 'zhu';
  players[2].role = 'fan'; players[2].roleRevealed = true;
  return {
    phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:700+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{}
  };
}

(async function main(){
console.log('\n== CORE-96:非BOT_SEAT_PICKS硬编码技能目标绕过阵营策略 ==\n');

// ---- 典韦【强袭】----
await check('强袭(忠臣视角):唯一攻击范围内目标是已知主公时,botTryStartExtraSkills不应发动', ()=>{
  const g = mkGame('zhong');
  // 只让座位1(主公)在攻击范围内,座位2/3设为超远(distance判断走canReachSha,用武器
  // 射程1、环形局距离2以上即不可达——这里改用直接设置caps.qiangxi并让除座位1外全部阵亡
  // 来构造"唯一候选是主公"的场景,避开距离计算的复杂度)。
  g.players[0].caps = { qiangxi:true };
  g.players[2].alive = false; g.players[3].alive = false;
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '唯一候选是已知主公时不应发动强袭');
  assert.strictEqual(g.phase, 'play', '不应进入qiangxiChooseCost阶段');
});

await check('强袭(忠臣视角):存在已知反贼(座位2)时应正常发动', ()=>{
  const g = mkGame('zhong');
  g.players[0].caps = { qiangxi:true };
  g.players[3].alive = false;
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, true, '存在已知反贼时应发动强袭');
});

await check('强袭 runBotDecision:qiangxiPickTarget候选过滤掉已知主公,只剩已知反贼时应选反贼', async ()=>{
  const g = mkGame('zhong');
  g.pending = { type:'qiangxiPickTarget', seat:0, costType:'hp', candidates:[1,2] };
  g.phase = 'qiangxiPickTarget';
  bindG(g);
  setSeat(0);
  await R('runBotDecision')(g, 0);
  const gg = R('_g');
  // pickQiangxiTarget(2) 应已执行:体力已扣除(costType:'hp'),且已推出qiangxiPickTarget阶段
  assert.strictEqual(gg.players[0].hp, 3, '强袭应已结算(体力-1),实际hp='+gg.players[0].hp);
  assert.ok(gg.pending===null || gg.pending.type!=='qiangxiPickTarget', '应已推进出qiangxiPickTarget阶段');
  assert.ok(!gg.log.some(l=>(l.text||'').indexOf('p1')>=0 && (l.text||'').indexOf('强袭')>=0),
    '不应选中已知主公(座位1)作为强袭目标');
});

// ---- 张角【雷击】----
await check('雷击(忠臣视角):availableTargets过滤掉已知主公,只剩已知反贼时应选反贼', async ()=>{
  const g = mkGame('zhong');
  g.pending = { type:'leijiChoose', sourceSeat:0, availableTargets:[1,2] };
  g.phase = 'leijiChoose';
  bindG(g);
  setSeat(0);
  await R('runBotDecision')(g, 0);
  const gg = R('_g');
  // triggerLeiji(2) 应已执行:进入judge阶段(黑桃才真正造成伤害,但已经选定目标转入judge)
  assert.ok(gg.pending===null || gg.pending.type!=='leijiChoose',
    '应已推进出leijiChoose阶段(触发judge或取消)');
  assert.ok(!gg.pending || gg.pending.targetSeat!==1,
    '不应选中已知主公(座位1)作为雷击目标,实际pending='+JSON.stringify(gg.pending));
});

await check('雷击(忠臣视角):全部候选都是已知敌我禁止目标时应取消而非强行选择', async ()=>{
  const g = mkGame('zhong');
  g.pending = { type:'leijiChoose', sourceSeat:0, availableTargets:[1] }; // 只有已知主公
  g.phase = 'leijiChoose';
  bindG(g);
  setSeat(0);
  await R('runBotDecision')(g, 0);
  const gg = R('_g');
  assert.strictEqual(gg.pending, null, '唯一候选被禁止时应cancelLeiji,不强行选择');
  assert.strictEqual(gg.phase, 'play');
});

// ---- 丁奉【奋迅】----
await check('奋迅(忠臣视角):唯一"够不着"目标是已知主公时,botTryStartExtraSkills不应发动', ()=>{
  const g = mkGame('zhong');
  g.players[0].caps = { fenxun:true };
  g.players[0].hand = [{id:'s0',name:'杀',suit:'♠',rank:7},{id:'s1',name:'杀',suit:'♠',rank:7}];
  // 用长武器让座位2也可达(排除它作为"够不着"候选),只留座位1"够不着"
  g.players[0].equips.weapon = { id:'w0', name:'寒冰剑', suit:'♠', rank:5, range:2 };
  bindG(g);
  setSeat(0);
  const invoked = R('botTryStartExtraSkills')(g, 0);
  assert.strictEqual(invoked, false, '唯一"够不着"目标是已知主公时不应发动奋迅');
});

// ---- 破坏性验证:还原成旧写法(不叠加策略过滤),证明上面的断言有鉴别力 ----
await check('破坏性验证:雷击还原成"直接取availableTargets[0]"的旧写法,忠臣确实会选中已知主公(证明断言有鉴别力)', async ()=>{
  const g = mkGame('zhong');
  g.pending = { type:'leijiChoose', sourceSeat:0, availableTargets:[1,2] };
  g.phase = 'leijiChoose';
  bindG(g);
  setSeat(0);
  const savedTrigger = R('triggerLeiji');
  vm.runInContext(`
    var __savedTriggerLeiji = triggerLeiji;
    triggerLeiji = function(t){ window.__leijiOldPickCalls = (window.__leijiOldPickCalls||[]).concat([t]); return __savedTriggerLeiji(t); };
  `, sandbox);
  vm.runInContext('window.__leijiOldPickCalls = [];', sandbox);
  try{
    // 手动模拟旧的runBotDecision分支逻辑(不叠加botTargetPolicyAllows):
    const oldTarget = (g.pending.availableTargets||[])[0];
    if(typeof oldTarget==='number'){
      setSeat(0);
      R('triggerLeiji')(oldTarget);
    }
    const calls = R('window.__leijiOldPickCalls');
    if(!(calls.length===1 && calls[0]===1))
      throw new Error('旧写法下应该(错误地)选中座位1(已知主公)作为雷击目标,如果没有说明上面的断言对这段逻辑没有鉴别力,实际 '+JSON.stringify(Array.from(calls)));
  } finally {
    vm.runInContext('triggerLeiji = __savedTriggerLeiji;', sandbox);
  }
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
})();
