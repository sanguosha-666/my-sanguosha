// CORE-90(issue #137):seatPick 技能选目标路径的阵营安全策略硬过滤。
//
// 【锁定什么】改动前 pickBestCandidateSeat 把"策略禁止"当成"分数很低"处理,有两条确定
// 错误路径:①唯一候选完全不检查策略直接返回;②所有候选都是 -Infinity 时没有任何
// s>bestScore 成立,最终返回初始化的 candidates[0].seat(一个禁止目标)。
// pickHealFallbackSeat(青囊)则只给明确敌方加 1000 软惩罚,唯一候选是敌方时照样帮敌人。
//
// 【和 CORE-89(#136) 的关系】那次在 seatPickBuildCandidates 聚合出口加了硬过滤,但 11 个
// 技能各自的 fallbackSeat 直接调 buildSeatCandidates()(未过滤的原始清单)再交给
// pickBestCandidateSeat,绕过那道过滤;天义更是自己攒候选直接调,完全没被保护到。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const el = () => ({ onclick:null, onchange:null, style:{}, innerHTML:'', textContent:'', value:'',
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
const R = name => vm.runInContext(name, sandbox);

let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}

// 身份局:座位0=忠臣(决策者)、1=主公(role==='zhu' 恒公开)、2=已揭示反贼、3=未知(低嫌疑)
function mkG(opt){
  opt = opt || {};
  const roles = opt.roles || ['zhong','zhu','fan',null];
  const revealed = opt.revealed || {2:true};
  return {
    players: roles.map((role,i)=>({
      name:'玩家'+i, alive:true, hp: (opt.hpOf&&opt.hpOf[i]!==undefined)?opt.hpOf[i]:3, maxHp:4,
      hand:[], equips: R('emptyEquips')(), delays:[], role, roleRevealed: !!revealed[i]
    })),
    gameMode: opt.gameMode || 'identity', roundNum:1, phase:'play', turn:0,
    aiRebelSuspicion: opt.suspicion || {}, pending:null, log:[]
  };
}
const pickBest = R('pickBestCandidateSeat');
const pickHeal = R('pickHealFallbackSeat');

console.log('\n'+'='.repeat(64));
console.log('  CORE-90:seatPick 选目标的阵营安全策略硬过滤');
console.log('='.repeat(64)+'\n');

// ---- 验收①:唯一 -Infinity 候选应返回 null ----
check('验收①:唯一候选是策略禁止目标(忠臣→主公)时应返回 null,不是硬选它', function(){
  const g = mkG();
  const r = pickBest(g, 0, [{seat:1}], 'damage'); // 座位1=主公,忠臣绝不能打
  if(r !== null) throw new Error('应返回null(唯一候选被策略禁止),实际返回座位 '+r);
});

// ---- 验收②:多候选全部 -Infinity 应返回 null ----
check('验收②:多个候选全部被策略禁止时应返回 null,不是退回 candidates[0]', function(){
  const g = mkG({ roles:['zhong','zhu','zhong',null], revealed:{2:true} });
  // 座位1=主公、座位2=已揭示忠臣、座位3=未知且嫌疑0(<35)——对忠臣而言三个都是禁止目标
  const r = pickBest(g, 0, [{seat:1},{seat:2},{seat:3}], 'damage');
  if(r !== null) throw new Error('应返回null(全部被禁止),实际返回座位 '+r);
});

// ---- 验收③:存在允许目标时只从非禁止目标中选 ----
check('验收③:混合候选(禁止的主公 + 允许的已知反贼)只会选中允许的那个', function(){
  const g = mkG();
  const r = pickBest(g, 0, [{seat:1},{seat:2}], 'damage');
  if(r !== 2) throw new Error('应选已知反贼(座位2),实际返回座位 '+r);
});
check('验收③补充:禁止目标排在候选列表第一位时也不会被误选(排除"靠顺序侥幸")', function(){
  const g = mkG();
  const r = pickBest(g, 0, [{seat:1},{seat:2}], 'damage'); // 主公在前
  if(r === 1) throw new Error('绝不能选主公');
  const r2 = pickBest(g, 0, [{seat:2},{seat:1}], 'damage'); // 反贼在前
  if(r2 !== 2 || r !== 2) throw new Error('两种顺序都应选反贼,实际 '+r+' / '+r2);
});

// ---- 验收⑤:三种身份的敌我边界 ----
check('验收⑤-忠臣:不能通过 seatPick 有害技能针对主公', function(){
  const g = mkG({ roles:['zhong','zhu','fan',null] });
  if(pickBest(g, 0, [{seat:1}], 'damage') !== null) throw new Error('忠臣不该选主公');
});
check('验收⑤-主公:不能针对已知忠臣', function(){
  const g = mkG({ roles:['zhu','zhong','fan',null], revealed:{1:true,2:true} });
  if(pickBest(g, 0, [{seat:1}], 'damage') !== null) throw new Error('主公不该选已知忠臣');
  if(pickBest(g, 0, [{seat:2}], 'damage') !== 2) throw new Error('主公应该可以选已知反贼');
});
check('验收⑤-反贼:不能针对已知反贼队友,但主公仍是合法目标', function(){
  const g = mkG({ roles:['fan','zhu','fan',null], revealed:{2:true} });
  if(pickBest(g, 0, [{seat:2}], 'damage') !== null) throw new Error('反贼不该选已知反贼队友');
  if(pickBest(g, 0, [{seat:1}], 'damage') !== 1) throw new Error('反贼应该可以选主公');
});

// ---- 验收⑥:帮助型技能不能无脑帮明确敌方 ----
check('验收⑥:青囊唯一候选是已知反贼时(忠臣视角)应返回 null,不无脑帮敌人', function(){
  const g = mkG({ hpOf:{2:1} }); // 座位2=已揭示反贼,残血1
  const r = pickHeal(g, 0, [{seat:2}]);
  if(r !== null) throw new Error('忠臣不该给已知反贼回血,应返回null,实际返回座位 '+r);
});
check('验收⑥对照:青囊候选含自己人时正常选血量最低的自己人(帮助型未被过度收紧)', function(){
  const g = mkG({ hpOf:{1:2, 2:1} }); // 主公2血、已知反贼1血
  const r = pickHeal(g, 0, [{seat:1},{seat:2}]);
  if(r !== 1) throw new Error('应给主公回血(反贼被硬过滤掉,不看它更残血),实际 '+r);
});
check('验收⑥对照:青囊给自己回血永远允许(不因身份过滤被误杀)', function(){
  const g = mkG({ hpOf:{0:1} });
  if(pickHeal(g, 0, [{seat:0}]) !== 0) throw new Error('给自己回血应恒合法');
});

// ---- 内奸零回归 ----
check('内奸零回归:harmful/helpful 两侧都不设硬边界(维持现有动态策略)', function(){
  const g = mkG({ roles:['nei','zhu','fan','zhong'], revealed:{2:true,3:true} });
  const allowH = R('botTargetPolicyAllows');
  [1,2,3].forEach(t=>{
    if(allowH(g,0,t,'harmful')!==true) throw new Error('内奸有害型不该被硬过滤(目标'+t+')');
    if(allowH(g,0,t,'helpful')!==true) throw new Error('内奸帮助型不该被硬过滤(目标'+t+')');
  });
});

// ---- 非身份局零回归 ----
check('非身份局(ffa)零回归:harmful/helpful 均放行,选择行为不受影响', function(){
  const g = mkG({ gameMode:'ffa', roles:[null,null,null,null] });
  if(pickBest(g, 0, [{seat:1}], 'damage') !== 1) throw new Error('ffa 唯一候选应正常返回');
  if(pickHeal(g, 0, [{seat:1}]) !== 1) throw new Error('ffa 青囊应正常返回');
});

// ---- allowSelf 场景零回归 ----
check('allowSelf 零回归:自己作为候选不参与敌我过滤(对自己用技能不存在打错阵营)', function(){
  const g = mkG();
  if(pickBest(g, 0, [{seat:0}], 'damage') !== 0) throw new Error('自己应始终是合法候选');
});

// ---- 验收⑦:全表 effectKind 审计完整性 ----
check('验收⑦:BOT_SEAT_PICKS 全部注册项都显式声明了 effectKind(防新增技能漏过审计)', function(){
  const T = R('BOT_SEAT_PICKS');
  const keys = Object.keys(T);
  if(keys.length !== 12) throw new Error('注册项数量变化(预期12,实际'+keys.length+')——新增技能请同步补 effectKind 声明并更新本断言');
  const miss = keys.filter(k => !T[k].effectKind);
  if(miss.length) throw new Error('这些注册项没有声明 effectKind: '+miss.join(', '));
  const bad = keys.filter(k => ['harmful','helpful','neutral'].indexOf(T[k].effectKind) < 0);
  if(bad.length) throw new Error('effectKind 取值非法: '+bad.map(k=>k+'='+T[k].effectKind).join(', '));
  if(T.qingnang.effectKind !== 'helpful') throw new Error('青囊应声明为 helpful');
  const harmfulCount = keys.filter(k => T[k].effectKind==='harmful').length;
  if(harmfulCount !== 11) throw new Error('应有11项 harmful,实际 '+harmfulCount);
});

// ---- 天义:直接调用 pickBestCandidateSeat、完全不经 seatPick 聚合过滤的独立路径 ----
check('天义路径:自攒候选直接调 pickBestCandidateSeat,同样受策略保护(CORE-89未覆盖此路径)', function(){
  const g = mkG({ roles:['zhong','zhu','zhong',null], revealed:{2:true} });
  // 模拟 tianyiPickTarget 分支的候选构造:其他存活且有手牌的角色
  const cands = [{seat:1},{seat:2},{seat:3}];
  if(pickBest(g, 0, cands, 'damage') !== null)
    throw new Error('全部禁止时天义应拿到 null(上层会 cancelTianyi),而不是硬选一个自己人');
});

// ---- 破坏性验证:证明断言真的在检测硬过滤,不是巧合通过 ----
check('破坏性验证:把策略谓词改成恒真,验收①②⑥会重新失守(证明断言有鉴别力)', function(){
  const orig = R('botTargetPolicyAllows');
  vm.runInContext('botTargetPolicyAllows = function(){ return true; };', sandbox);
  try{
    const g = mkG();
    const r1 = R('pickBestCandidateSeat')(g, 0, [{seat:1}], 'damage');
    if(r1 !== 1) throw new Error('恒真后唯一候选应该(错误地)被选中,实际 '+r1);
    const g2 = mkG({ hpOf:{2:1} });
    const r2 = R('pickHealFallbackSeat')(g2, 0, [{seat:2}]);
    if(r2 !== 2) throw new Error('恒真后青囊应该(错误地)帮到敌人,实际 '+r2);
  } finally {
    sandbox.botTargetPolicyAllows = orig;
    vm.runInContext('botTargetPolicyAllows = this.botTargetPolicyAllows;', sandbox);
  }
});
// 恢复后必须真的恢复(防上一条的 finally 没生效、污染后续)
check('破坏性验证后自检:策略谓词已恢复,验收①重新成立', function(){
  const g = mkG();
  if(R('pickBestCandidateSeat')(g, 0, [{seat:1}], 'damage') !== null)
    throw new Error('策略谓词没有被正确恢复,后续断言不可信');
});

console.log('\n'+'='.repeat(64));
console.log('  结果: '+pass+' 通过, '+fail+' 失败');
console.log('='.repeat(64)+'\n');
if(fail>0) process.exit(1);
