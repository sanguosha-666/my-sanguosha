// CORE-88(#135):酒杀被闪抵消后发动贯石斧,只造成1点伤害(酒加成jiuBonus丢失)
// 根因:jiuBonus 是随"杀被闪抵消后的效果调度"链条(maybeStartShaOffsetEffects →
// startShaOffsetEffect → maybeStartGuanshifu/maybeStartQinglong → continueShaOffsetEffects
// → finishGuanshiDamage)一路透传的可选参数,和 sourceCard 同一套写法;贯石斧自己的
// pending/finishGuanshiDamage 此前完全没接这条链,酒 +1 全程丢失。
// 覆盖范围:respondShan 直接触发贯石斧(唯一效果自动结算 + shaOffsetChoice 多选一);
// 八卦阵判红(视为出闪)触发的两条路径(继续绕开 respondShan 的老 bug,继续绕开 respondShan
// 触发贯石斧同样受影响);青龙偃月刀"不发动"退回贯石斧仍要带上酒加成;未用酒的对照组无回归。
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);
run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();

function player(name,extra){
  return Object.assign({name,general:'liubei',hp:4,maxHp:6,hand:[],equips:eq(),delays:[],alive:true},extra||{});
}
const sha=id=>({id,name:'杀',suit:'♠',rank:7});
const shan=id=>({id,name:'闪',suit:'♥',rank:2});

let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}

// ---- 1. respondShan 直接触发(唯一效果,自动结算):酒杀被闪抵消后发动贯石斧 → 2点伤害 ----
check('respondShan路径:酒杀被闪抵消,贯石斧弃两张牌强制命中 → 目标受2点伤害(酒+1生效)', function(){
  const players=[
    player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3}], equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'},plus1:{id:'horse1',name:'的卢'}}), jiuShaBonus:true}),
    player('目标',{hand:[shan('h1')], hp:6})
  ];
  const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)"); // 攻击者出杀(酒加成在这一刻被 consumeJiuShaBonus 消耗、存进 pending.jiuBonus)
  assert.strictEqual(g.pending && g.pending.jiuBonus, true, '出杀后 pending 应带 jiuBonus=true(前置条件)');
  run('mySeat=1;'); run('respondShan(true,0)'); run('mySeat=0;'); // 目标打出闪抵消
  // 贯石斧是这名攻击者唯一可用的抵消后效果(无猛进/青龙cap)→ 应已自动进入 guanshi 阶段
  assert.strictEqual(g.phase, 'guanshi', '应自动进入贯石斧发动询问阶段');
  assert.strictEqual(g.pending.jiuBonus, true, 'guanshi pending 应保留 jiuBonus');
  run("respondGuanshi(['hand:0','equip:plus1'])");
  assert.strictEqual(g.players[1].hp, 4, '目标应受2点伤害(6-2=4):酒+1 + 贯石斧强命1点');
});

// ---- 2. 对照组:未用酒的杀被闪抵消后发动贯石斧,仍为1点伤害(无回归) ----
check('respondShan路径对照组:未用酒的杀被闪抵消,贯石斧强命 → 仍只1点伤害', function(){
  const players=[
    player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3}], equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'},plus1:{id:'horse1',name:'的卢'}}), jiuShaBonus:false}),
    player('目标',{hand:[shan('h1')], hp:6})
  ];
  const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)");
  assert.ok(!g.pending.jiuBonus, '未用酒,pending 不应带 jiuBonus(前置条件)');
  run('mySeat=1;'); run('respondShan(true,0)'); run('mySeat=0;');
  assert.strictEqual(g.phase, 'guanshi', '应自动进入贯石斧发动询问阶段');
  run("respondGuanshi(['hand:0','equip:plus1'])");
  assert.strictEqual(g.players[1].hp, 5, '目标应只受1点伤害(6-1=5):无酒加成,仅贯石斧强命');
});

// ---- 3. shaOffsetChoice 多选一路径(同时有青龙+贯石斧可选):酒杀→闪抵消→选贯石斧→2点伤害 ----
check('shaOffsetChoice多选一路径:酒杀被闪抵消,青龙+贯石斧都可选,选贯石斧仍应2点伤害', function(){
  const players=[
    player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3},{id:'extra2',name:'杀',suit:'♦',rank:4}], equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'}}), caps:{qinglong:true}, jiuShaBonus:true}),
    player('目标',{hand:[shan('h1')], hp:6})
  ];
  const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)");
  run('mySeat=1;'); run('respondShan(true,0)'); run('mySeat=0;');
  assert.strictEqual(g.phase, 'shaOffsetChoice', '青龙(caps注入)与贯石斧(装备)同时可用,应进入多选一阶段');
  assert.strictEqual(g.pending.jiuBonus, true, 'shaOffsetChoice pending 应保留 jiuBonus');
  run("respondShaOffsetChoice('guanshifu')");
  assert.strictEqual(g.phase, 'guanshi', '选择贯石斧后应进入贯石斧发动询问');
  assert.strictEqual(g.pending.jiuBonus, true, '切到guanshi pending后仍应保留jiuBonus');
  run("respondGuanshi(['hand:0','hand:1'])");
  assert.strictEqual(g.players[1].hp, 4, '选贯石斧后应仍是2点伤害(酒+1生效)');
});

// ---- 4. 青龙偃月刀"不发动"退回贯石斧,酒加成仍要透传 ----
check('青龙"不发动"退回贯石斧路径:酒加成经过一次青龙可选环节后仍不丢失', function(){
  const players=[
    player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3},{id:'extra2',name:'杀',suit:'♦',rank:4}], caps:{qinglong:true}, equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'}}), jiuShaBonus:true}),
    player('目标',{hand:[shan('h1')], hp:6})
  ];
  const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)");
  run('mySeat=1;'); run('respondShan(true,0)'); run('mySeat=0;');
  assert.strictEqual(g.phase, 'shaOffsetChoice');
  run("respondShaOffsetChoice('qinglong')");
  assert.strictEqual(g.phase, 'qinglong', '应进入青龙偃月刀发动询问');
  assert.strictEqual(g.pending.jiuBonus, true, '青龙pending应携带jiuBonus(仅为continue链使用,不代表青龙自己的新杀会用到)');
  run('respondQinglong(false)'); // 不发动青龙
  assert.strictEqual(g.phase, 'guanshi', '青龙不发动后应continue到贯石斧');
  assert.strictEqual(g.pending.jiuBonus, true, '青龙不发动后,贯石斧pending仍应保留原杀的jiuBonus');
  run("respondGuanshi(['hand:0','hand:1'])");
  assert.strictEqual(g.players[1].hp, 4, '青龙不发动、贯石斧强命,酒加成仍生效,应为2点伤害');
});

// ---- 5. 八卦阵判红(视为出闪,绕开 respondShan)触发贯石斧:酒杀被"判红"抵消后仍应2点伤害 ----
check('八卦阵判红路径:酒杀被目标八卦阵判红抵消(视为出闪),贯石斧强命仍应2点伤害', function(){
  const players=[
    player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3}], equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'},plus1:{id:'horse1',name:'的卢'}}), jiuShaBonus:true}),
    player('目标',{hand:[], hp:6, equips:Object.assign(eq(),{armor:{id:'a1',name:'八卦阵'}})})
  ];
  // deck.pop() 取牌堆顶,放一张红桃保证判红(视为出闪),不依赖随机性
  const g={players,deck:[{id:'redcard',name:'A',suit:'♥',rank:1}],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)"); // 目标持有八卦阵,resolveShaUseNoLiuli 内部自动触发判定,红→视为出闪→立即调度抵消后效果
  assert.strictEqual(g.phase, 'guanshi', '八卦阵判红后应自动进入贯石斧发动询问(唯一可用效果)');
  assert.strictEqual(g.pending.jiuBonus, true, '八卦阵判红路径的guanshi pending应保留jiuBonus(此前respondShan之外的这条路径同样会漏)');
  run("respondGuanshi(['hand:0','equip:plus1'])");
  assert.strictEqual(g.players[1].hp, 4, '八卦阵判红、贯石斧强命,酒加成仍生效,应为2点伤害');
});

// ---- 5. 破坏性验证:临时把 finishGuanshiDamage 的 damageAmount 调用改回不传 options,
//      应该重新只造成1点伤害——证明测试1真的在检测这条修复,不是巧合通过 ----
check('破坏性验证:去掉jiuBonus透传,伤害应退回1点(证明断言有鉴别力)', function(){
  const original = run('finishGuanshiDamage');
  run(`
    finishGuanshiDamage = function(g, from, to, sourceCard, jiuBonus){
      const dying = dealDamage(g, to, damageAmount(g, from, 1, 'sha'), from, '贯石斧强制命中(破坏性验证)', 'sha', sourceCard);
      if(dying) return;
      finishSingleShaTarget(g);
    };
  `);
  try{
    const players=[
      player('攻击者',{hand:[sha('s1'),{id:'extra',name:'杀',suit:'♦',rank:3}], equips:Object.assign(eq(),{weapon:{id:'w1',name:'贯石斧'},plus1:{id:'horse1',name:'的卢'}}), jiuShaBonus:true}),
      player('目标',{hand:[shan('h1')], hp:6})
    ];
    const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
    sandbox.__g=g;
    run("playCard(0,'杀',1)");
    run('mySeat=1;'); run('respondShan(true,0)'); run('mySeat=0;');
    run("respondGuanshi(['hand:0','equip:plus1'])");
    assert.strictEqual(g.players[1].hp, 5, '去掉透传后应该退回1点伤害的bug症状,如果不是说明这条断言对该函数没有鉴别力');
  } finally {
    sandbox.finishGuanshiDamage = original;
  }
});

console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
if(fail>0) process.exit(1);
