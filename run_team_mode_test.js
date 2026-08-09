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
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
