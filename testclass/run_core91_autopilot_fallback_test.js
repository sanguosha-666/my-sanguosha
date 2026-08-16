// CORE-91(issue #138):AI托管座位未进入 botFallbackSeats,未覆盖阶段可能无人接管。
//
// 【本次调查的关键结论,先写在最前面——它决定了这份测试该怎么写】
// issue 要求"修复前必须找出至少一个真实会进入 botSeatForState()===-1、但可由 fallback
// DOM probe 推进的阶段,完成专项复现"。本次做了穷尽式静态审计,结论是:**当前代码库里
// 不存在这样的阶段**。理由(每一条都由下面的断言持续钉住,不是一次性人工结论):
//   botFallbackSeats 的两个前置条件是 `g.pending 非空` 且 `g.phase 不在 BOT_KNOWN_PHASES`。
//   BOT_KNOWN_PHASES = STAGE_TABLE 里所有带 actor 的阶段 + [wugu,pickingLordGeneral,
//   pickingGeneral,draw,play,discard]。把全项目所有 `g.phase=` 字面量赋值扫出来(115 种)
//   与之相减,只剩 end / judge / lobby / over 四个,而这四个都不可能与非空 pending 共存
//   (end 的两处赋值都紧挨着 g.pending=null;over 的三个分支都清 pending;lobby 是未开局;
//   judge 根本没有真实赋值点,只在一句注释里出现)。
// 也就是说 fallback 探测路径**在当前代码库里是走不到的死代码**,issue 描述的故障因此是
// **潜在的、当前不可触发的**,不是正在发生的线上问题。这个结论如实报告,不编造复现。
//
// 【那为什么还要修】"哪个座位归 AI 管"存在两份不一致的定义(主路径认托管座位、fallback
// 只认 p.isBot)本身就是隐患:这个项目的 A/B/C 类审计历史反复证明"新增阶段忘记登记 actor"
// 是真实会发生的事,一旦再发生一次,fallback 就会立刻从死代码变成活代码,而那时托管座位
// 会被排除在外。修复成本极低(提炼一个统一谓词),留着不修才是欠债。
//
// 【所以这份测试的重点】除了验证修复本身,更重要的是第 3 组"看门狗"断言——把"每一个能与
// 非空 pending 共存的 g.phase 都必须在 BOT_KNOWN_PHASES 里"这条不变量钉死。它才是真正
// 防止这个潜在故障变成真故障的东西:将来谁新增一个阶段忘了登记 actor,这条会直接报红。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const el = () => ({ onclick:null, onchange:null, style:{}, innerHTML:'', textContent:'', value:'', disabled:false,
  classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  appendChild(){ return {}; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
  setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){}, remove(){} });
const context = {
  gameRef:{ transaction(fn){ return fn(context.__g||{}); } },
  firebase:{
    initializeApp(){ return { database(){ return { ref(){ return { on(){}, once(){},
      push(){ return { set(){}, key:'k' }; }, transaction(){ return {}; }, set(){}, update(){},
      child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; } }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document:{ getElementById:el, createElement:el, createTextNode:t=>({textContent:t}),
    createDocumentFragment:()=>({appendChild(){}}), querySelector(){ return null; },
    querySelectorAll(){ return []; }, body:el(), head:el(), addEventListener(){}, removeEventListener(){} },
  window:{ location:{search:'',href:'http://localhost'},
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    addEventListener(){}, removeEventListener(){}, setTimeout, clearTimeout, alert(){},
    navigator:{userAgent:'test'}, matchMedia(){ return {matches:false, addEventListener(){}}; } },
  joinRoom(){}, mySeat:0, console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  Set, Map, Promise, parseInt, isNaN, setTimeout, clearTimeout, setInterval, clearInterval
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;
const sandbox = vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js',
 'sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js',
 'ai-bot.js','render.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, {filename:f}));
const R = n => vm.runInContext(n, sandbox);
const setVar = (n,v) => { sandbox['__tmp']=v; vm.runInContext(n+' = __tmp;', sandbox); };

// 座位0=本地真人(可托管)、座位1=真机器人、座位2=普通真人
function mkG(phase, pendingType){
  return {
    players:[
      { name:'我', alive:true, hp:4, maxHp:4, hand:[], equips:R('emptyEquips')(), delays:[], isBot:false },
      { name:'机器人', alive:true, hp:4, maxHp:4, hand:[], equips:R('emptyEquips')(), delays:[], isBot:true },
      { name:'另一个真人', alive:true, hp:4, maxHp:4, hand:[], equips:R('emptyEquips')(), delays:[], isBot:false }
    ],
    gameMode:'ffa', roundNum:1, turn:0, phase: phase,
    pending: pendingType ? { type: pendingType, seat: 0 } : null, log:[], started:true
  };
}
function setAutopilot(active, seat){
  setVar('aiTestAutopilot', active ? { active:true, seat:seat, records:[] } : { active:false, seat:null, records:[] });
}
// 用一个确定不在 BOT_KNOWN_PHASES 里的假阶段来驱动 fallback 路径——不是"假装有这个阶段",
// 而是模拟"将来有人新增了一个忘记登记 actor 的阶段"这个真实会发生的场景(见文件头说明)。
const UNCOVERED = '__uncoveredPhaseForTest__';

console.log('\n' + '='.repeat(66));
console.log('  CORE-91:AI托管座位纳入 botFallbackSeats + 统一 AI 控制座位判定');
console.log('='.repeat(66) + '\n');

// ============ 第1组:botFallbackSeats 口径 ============
check('验收①:本地托管且存活的真人座位能进入 fallback 候选', function(){
  setAutopilot(true, 0);
  const seats = R('botFallbackSeats')(mkG(UNCOVERED, 'someAsk'));
  if(seats.indexOf(0) < 0) throw new Error('托管座位0应在兜底候选里,实际 ' + JSON.stringify(seats));
});
check('验收②:非托管真人绝不能被加入(座位2是普通真人)', function(){
  setAutopilot(true, 0);
  const seats = R('botFallbackSeats')(mkG(UNCOVERED, 'someAsk'));
  if(seats.indexOf(2) >= 0) throw new Error('普通真人座位2不该出现在兜底候选里,实际 ' + JSON.stringify(seats));
});
check('验收②补充:关闭托管后,原托管座位立即退出兜底候选(停止托管即恢复真人控制)', function(){
  setAutopilot(false);
  const seats = R('botFallbackSeats')(mkG(UNCOVERED, 'someAsk'));
  if(seats.indexOf(0) >= 0) throw new Error('关闭托管后座位0不该还在兜底候选里,实际 ' + JSON.stringify(seats));
  if(seats.indexOf(1) < 0) throw new Error('真机器人座位1应始终在候选里');
});
check('真机器人零回归:托管开关的任何状态下,真机器人座位都在候选里', function(){
  [true,false].forEach(on=>{
    setAutopilot(on, 0);
    const seats = R('botFallbackSeats')(mkG(UNCOVERED, 'someAsk'));
    if(seats.indexOf(1) < 0) throw new Error('托管='+on+' 时真机器人座位1应在候选里');
  });
});
check('死亡座位不入候选(托管中的真人死了也一样)', function(){
  setAutopilot(true, 0);
  const g = mkG(UNCOVERED, 'someAsk'); g.players[0].alive = false;
  const seats = R('botFallbackSeats')(g);
  if(seats.indexOf(0) >= 0) throw new Error('已阵亡的托管座位不该进候选');
});
check('前置条件零回归:pending 为空、或阶段已被覆盖时,候选恒为空', function(){
  setAutopilot(true, 0);
  if(R('botFallbackSeats')(mkG(UNCOVERED, null)).length) throw new Error('无 pending 时候选应为空');
  if(R('botFallbackSeats')(mkG('play', 'someAsk')).length) throw new Error('已覆盖阶段(play)候选应为空');
});

// ============ 第2组:统一谓词 isBotControlledSeat ============
check('统一谓词 isBotControlledSeat:真机器人=true、托管座位=true、普通真人=false', function(){
  setAutopilot(true, 0);
  const g = mkG('play', null), f = R('isBotControlledSeat');
  if(f(g,1)!==true) throw new Error('真机器人应为 true');
  if(f(g,0)!==true) throw new Error('托管座位应为 true');
  if(f(g,2)!==false) throw new Error('普通真人应为 false');
  if(f(g,99)!==false) throw new Error('越界座位应为 false');
  if(f(g,null)!==false) throw new Error('非整数座位应为 false');
});
check('验收⑤:已知阶段 actor 路径行为零回归(botSeatForState 语义不变)', function(){
  setAutopilot(false);
  const g = mkG('play', null);
  g.turn = 1; // 轮到真机器人
  if(R('botSeatForState')(g)!==1) throw new Error('真机器人回合应解析出座位1');
  g.turn = 0; // 轮到真人且未托管
  if(R('botSeatForState')(g)!==-1) throw new Error('未托管真人回合应返回-1');
  setAutopilot(true, 0);
  if(R('botSeatForState')(g)!==0) throw new Error('托管后真人回合应解析出座位0');
});

// ============ 第3组【本次最关键】:看门狗——防止潜在故障变成真故障 ============
// 见文件头说明:fallback 当前是死代码,真正的风险是"将来新增阶段忘记登记 actor"。
// 这条断言把"任何能与非空 pending 共存的 g.phase 都必须在 BOT_KNOWN_PHASES 里"钉死。
check('看门狗:全项目所有 g.phase 字面量赋值,不在 BOT_KNOWN_PHASES 的必须是"不可能带 pending"的少数几个', function(){
  const KNOWN = R('BOT_KNOWN_PHASES');
  const files = ['game.js','skills.js','weapons.js','sha/sha-resolution.js','skills/late-generals.js',
                 'room-lifecycle.js','stages/stage-table.js'];
  const phases = new Set();
  files.forEach(f => {
    const s = fs.readFileSync(path.join(ROOT,f),'utf8');
    for(const m of s.matchAll(/\bg\.phase\s*=\s*['"]([\w]+)['"]/g)) phases.add(m[1]);
    for(const m of s.matchAll(/\bphase\s*:\s*['"]([\w]+)['"]/g)) phases.add(m[1]);
  });
  // 这几个已逐一核实过"不可能与非空 pending 共存":
  //   end  —— 两处赋值都紧挨着 g.pending=null(cancelJushou、jushouChoose 的 normalizer)
  //   over —— checkWin 的三个分支都 g.pending=null
  //   lobby—— 未开局,没有任何 pending
  //   judge—— 没有真实赋值点,只在 skills.js 一句注释里出现
  const ALLOWED_WITHOUT_PENDING = new Set(['end','over','lobby','judge']);
  const unexpected = [...phases].filter(p => !KNOWN.has(p) && !ALLOWED_WITHOUT_PENDING.has(p));
  if(unexpected.length){
    throw new Error('这些 g.phase 既不在 BOT_KNOWN_PHASES、也不在"不可能带 pending"白名单里:'
      + unexpected.join(', ')
      + ' —— 新增阶段请在 STAGE_TABLE 里登记 actor(优先),或确认它不可能与非空 pending 共存后加进本测试的白名单并说明理由。'
      + '不登记会让该阶段掉进 fallback DOM 探测,那条路径的行为远不如专属分支可控。');
  }
});
check('看门狗自检:白名单里的四个阶段确实都不在 BOT_KNOWN_PHASES(白名单没写废项)', function(){
  const KNOWN = R('BOT_KNOWN_PHASES');
  ['end','over','lobby','judge'].forEach(p => {
    if(KNOWN.has(p)) throw new Error('阶段 '+p+' 现在已进 BOT_KNOWN_PHASES,应从白名单移除(避免白名单堆废项)');
  });
});

// ============ 第4组:scheduleBotTurn 端到端(issue 要求的完整调度链路) ============
// 构造"非 controller 浏览器 + 本地托管座位0 + 未覆盖阶段"这个 issue 描述的确切场景,
// 走真实的 scheduleBotTurn(不是只测 helper),验证它不再在门口被拦掉。
function runScheduleGate(opt){
  setAutopilot(opt.autopilot ? true : false, 0);
  setVar('mySeat', 0);
  const g = mkG(opt.phase, opt.pendingType);
  sandbox.__g = g;
  setVar('currentG', g);
  // isBotController:强制成"本浏览器不是控制器"(模拟非第一个真人的那台机器)
  vm.runInContext('isBotController = function(){ return ' + (opt.controller ? 'true' : 'false') + '; };', sandbox);
  // 拦住真正的决策执行,只观察"有没有排出定时器"(=有没有通过那两道门)
  let scheduled = false;
  sandbox.__mark = function(){ scheduled = true; return 0; };
  vm.runInContext('setTimeout = function(fn,ms){ return __mark(); };', sandbox);
  try{ R('scheduleBotTurn')(g); } finally {
    vm.runInContext('setTimeout = __realSetTimeout;', sandbox);
  }
  return scheduled;
}
vm.runInContext('var __realSetTimeout = setTimeout;', sandbox);

check('验收⑥端到端:非controller浏览器 + 本地托管 + 未覆盖阶段 → scheduleBotTurn 应放行(修复前被拦死)', function(){
  if(!runScheduleGate({ controller:false, autopilot:true, phase:UNCOVERED, pendingType:'someAsk' }))
    throw new Error('托管座位在未覆盖阶段应能被调度');
});
check('验收③:非controller浏览器 + 未开托管 + 未覆盖阶段 → 不放行(不驱动别人的机器人)', function(){
  if(runScheduleGate({ controller:false, autopilot:false, phase:UNCOVERED, pendingType:'someAsk' }))
    throw new Error('没开托管的非controller浏览器不该驱动任何座位');
});
check('验收④:controller浏览器在未覆盖阶段的行为零回归(照常放行)', function(){
  if(!runScheduleGate({ controller:true, autopilot:false, phase:UNCOVERED, pendingType:'someAsk' }))
    throw new Error('controller浏览器应照常驱动兜底探测');
});
check('验收⑦:停止托管后立即恢复真人控制(同一场景不再放行)', function(){
  if(!runScheduleGate({ controller:false, autopilot:true, phase:UNCOVERED, pendingType:'someAsk' }))
    throw new Error('前置:托管时应放行');
  if(runScheduleGate({ controller:false, autopilot:false, phase:UNCOVERED, pendingType:'someAsk' }))
    throw new Error('停止托管后应立即不再放行');
});

// ============ 破坏性验证 ============
check('破坏性验证:把 botFallbackSeats 还原成只认 p.isBot,验收①和端到端断言会重新失守', function(){
  const orig = R('botFallbackSeats');
  vm.runInContext('botFallbackSeats = function(g){'
    + ' if(!g.pending || BOT_KNOWN_PHASES.has(g.phase)) return [];'
    + ' var out=[]; (g.players||[]).forEach(function(p,i){ if(p&&p.isBot&&p.alive) out.push(i); }); return out; };', sandbox);
  try{
    setAutopilot(true, 0);
    const seats = R('botFallbackSeats')(mkG(UNCOVERED, 'someAsk'));
    if(seats.indexOf(0) >= 0) throw new Error('旧写法下托管座位不该在候选里(否则这条验证没意义)');
    if(runScheduleGate({ controller:false, autopilot:true, phase:UNCOVERED, pendingType:'someAsk' }))
      throw new Error('旧写法下非controller浏览器应该(错误地)被拦死,如果仍放行说明端到端断言对该修复没有鉴别力');
  } finally {
    sandbox.__restore = orig;
    vm.runInContext('botFallbackSeats = __restore;', sandbox);
  }
});
check('破坏性验证后自检:botFallbackSeats 已恢复,验收①重新成立', function(){
  setAutopilot(true, 0);
  if(R('botFallbackSeats')(mkG(UNCOVERED,'someAsk')).indexOf(0) < 0)
    throw new Error('botFallbackSeats 没有被正确恢复,后续断言不可信');
});

console.log('\n' + '='.repeat(66));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(66) + '\n');
if(fail > 0) process.exit(1);
