// run_team_mode_test.js —— 组队模式回归套件(Task 按实施计划增量扩展)
// 用法: node run_team_mode_test.js
const vm = require('vm');
const fs = require('fs');
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){ return {}; }, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, insertAdjacentHTML: function(){}, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { src:'', textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, disabled:false }; }, createTextNode: function(t){ return { nodeValue:t }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage:{ getItem:function(){ return null; }, setItem:function(){}, removeItem:function(){}, clear:function(){} }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
const files = ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  await check('normalize: gameMode=team 不被清空', function(){
    const g = { players:[], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.gameMode!=='team') throw new Error('应保留team,实际 '+g.gameMode);
  });
  await check('normalize: p.team 非法值→null', function(){
    const g = { players:[{ team:'x' }, { team:1 }], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.players[0].team!==null) throw new Error('非法team应null');
    if(g.players[1].team!==1) throw new Error('合法team应保留');
  });
  await check('normalize: 非team模式清空p.team', function(){
    const g = { players:[{ team:0 }], log:[], gameMode:'ffa' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.players[0].team!==null) throw new Error('ffa应清空team');
  });
  await check('normalize: team模式 teamCount 从players推导', function(){
    const g = { players:[{ team:0 }, { team:0 }, { team:2 }], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.teamCount!==3) throw new Error('应推导为3,实际 '+g.teamCount);
  });
  await check('TEAM_COLORS: 至少9色', function(){
    const c = vm.runInContext('TEAM_COLORS', sandbox);
    if(!c || c.length<9) throw new Error('应≥9色,实际 '+(c&&c.length));
  });
  // 沙箱内显式赋值 gameRef/mySeat(game.js 顶层的 let gameRef=null / let mySeat=null
  // 全局词法绑定会遮蔽 context 同名属性,必须像其它 run_*_test.js 那样在 vm 作用域内赋值)
  vm.runInContext('gameRef = { transaction: function(fn){ return fn(typeof g !== "undefined" ? g : {}); } }; mySeat = 0;', sandbox);
  // 以下 joinTeam/createNewTeam 用例全部用真实大厅形态:gameMode 恒 null/缺失
  // (全项目只有 startGame 才写 gameMode),选队即锁定 team 模式。修复前这些用例
  // 会红——守卫 `g.gameMode!=='team'` 在 null!=='team' 下恒 return。
  await check('joinTeam: 真实大厅(null gameMode)选队锁定模式', function(){
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(0);
    if(g.players[0].team!==0) throw new Error('应写team=0,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team,实际 '+g.gameMode);
    if(g.teamCount!==1) throw new Error('teamCount应1,实际 '+g.teamCount);
  });
  await check('joinTeam: 换队覆盖(初始0→选1)', function(){
    const g = { players:[{team:0},{team:0}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(1);
    if(g.players[0].team!==1) throw new Error('应覆盖为1,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team');
  });
  await check('createNewTeam: 真实大厅(null gameMode)建新队并入队', function(){
    // 首次建队:真实大厅 teamCount 恒 0(非team模式 normalize 归零),createNewTeam 应入新队0
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('createNewTeam', sandbox)();
    if(g.players[0].team!==0) throw new Error('首次建队应入队0,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team');
    if(g.teamCount!==1) throw new Error('teamCount应1,实际 '+g.teamCount);
  });
  await check('createNewTeam: 模式已锁后新建第二队', function(){
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(0); // 先选队锁定 team 模式
    if(g.gameMode!=='team') throw new Error('应先锁定gameMode=team');
    vm.runInContext('createNewTeam', sandbox)();
    if(g.players[0].team!==1) throw new Error('应入新队1,实际 '+g.players[0].team);
    if(g.teamCount!==2) throw new Error('teamCount应2,实际 '+g.teamCount);
  });
  await check('addBot(team): 机器人入指定队', function(){
    const g = { players:[{name:'a',isBot:false,team:0}], log:[], gameMode:'team', phase:'lobby', started:false, teamCount:2 };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(1);
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==1) throw new Error('机器人应入队1,实际 '+bots[0].team);
    if(g.teamCount!==2) throw new Error('teamCount应保持2,实际 '+g.teamCount);
  });
  // 真实乱斗大厅 gameMode 恒 null(全项目只有 startGame 才写 ffa/identity),通用"添加机器人"
  // 按钮(handleAddBotClick)无参调 addBot()——必须保持旧行为零变化:能加、不写队、不锁模式。
  await check('addBot(): 非team(默认/乱斗)房间不写队不锁模式(零变化)', function(){
    const g = { players:[], log:[], phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)();
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==null) throw new Error('非team模式机器人team应null,实际 '+bots[0].team);
    if(g.gameMode!==null) throw new Error('非team房间addBot不应锁定gameMode,实际 '+g.gameMode);
  });
  await check('addBot(team): 非法队伍号拒绝入队', function(){
    const g = { players:[{name:'a',isBot:false,team:0}], log:[], gameMode:'team', phase:'lobby', started:false, teamCount:2 };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(99); // 越界队伍号 → team 落 null(仍加机器人)
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==null) throw new Error('越界队伍号team应null,实际 '+bots[0].team);
  });
  // —— Task 4 修复:游离机器人软锁。真实时序=房主先点"组队"模式按钮(只改 selectedGameMode,
  // g.gameMode 仍 null)→ 面板出现 → 点"+机器人"(addBot(t))→ 旧实现 gameMode!=='team' 导致
  // botTeam=null → 机器人游离无队 → 选队锁定模式后开始按钮 hasNoTeam 校验永远拦截。
  await check('addBot(team): gameMode未锁定(null)指定队伍=选队即锁定', function(){
    const g = { players:[{name:'a',isBot:false,team:null}], log:[], phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(1); // 面板"+机器人"传队伍号
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==1) throw new Error('机器人应入队1,实际 '+bots[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team,实际 '+g.gameMode);
  });
  await check('addBot(): team房间无参(通用入口)拒绝游离机器人', function(){
    const g = { players:[{name:'a',isBot:false,team:0},{name:'b',isBot:false,team:1}], log:[], gameMode:'team', phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    const before = g.players.length;
    vm.runInContext('addBot', sandbox)(); // 通用入口无参(既有路径 render-controls.js:1811)
    if(g.players.length!==before) throw new Error('应拒绝添加,players '+before+'→'+g.players.length);
    if((g.players.filter(p=>p&&p.isBot)).length!==0) throw new Error('不应产生游离机器人');
  });
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
