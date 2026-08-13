// run_qianxun_target_ui_test.js —— #102 谦逊目标在选目标界面不可点的渲染层回归测试
// 用法: node run_qianxun_target_ui_test.js
//
// 背景:render.js buildSeatDOM 的普通单目标牌 targetable 计算以前手写简化合法性判断,
// 漏掉业务层 CARD_PLAYS 的 canTarget 里的技能限制(陆逊/SP陆逊的谦逊等),导致
// 【顺手牵羊】【乐不思蜀】选目标时谦逊角色仍可点、点了却被服务端 playCard 拒绝。
// 修复后 targetable 追加 singleTargetCanTarget(复用 selSpec.canTarget),国色转化的
// 【乐不思蜀】选目标同样复用 CARD_PLAYS['乐不思蜀'].canTarget。
//
// 本测试在 vm 里加载完整源码栈(含 render.js),直接断言 render.js 导出的
// singleTargetCanTarget 行为:canTarget 作为"追加约束",只收窄不放宽既有条件。
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

// render.js 顶层注册横屏引导/音频解锁/出牌音效监听需要 document/window 级
// addEventListener,顶层还绑定了 closeRoomBtn.onclick(cleanupRoom 在 room-lifecycle.js)。
const context = {
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return { on(){}, once(){}, transaction(){}, set(){}, update(){}, child(){ return this; }, remove(){} }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(){ return { onclick:null, innerHTML:'', textContent:'', style:{}, className:'', classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }, querySelector(){ return null; }, appendChild(){}, addEventListener(){} }; },
    createElement(){ return { src:'', textContent:'', innerHTML:'', className:'', style:{}, onclick:null, appendChild(){}, setAttribute(){}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } } }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ innerHTML:'', appendChild(){} }, head:{ appendChild(){} },
    addEventListener(){}, removeEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' }, localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){}, clear(){} },
    addEventListener(){}, removeEventListener(){}, setTimeout(f){ return setTimeout(f); }, clearTimeout(){}, alert(){}, confirm(){ return true; }, open(){},
    innerWidth: 1280, innerHeight: 800, matchMedia(){ return { matches:false }; },
    speechSynthesis: { cancel(){}, speak(){} }, navigator:{ userAgent:'test' }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean, parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
// 与 run_team_mode_test.js 同一套已验证可加载的完整文件顺序:render.js 殿后。
const files = ['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','render.js'];
files.forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }));
const run = code => vm.runInContext(code, sandbox);
// mySeat 是 game.js 顶层 let 绑定(脚本作用域),必须用裸标识符赋值(沙箱属性赋值无效);
// gameRef 同款。CARD_PLAYS['顺手牵羊'].canTarget 内部距离判断就读这个 mySeat。
run('gameRef = { transaction: function(fn){ return fn(g || {}); } }; mySeat = 0;');

const equips = () => run('emptyEquips')();
function mkPlayer(name, opts){
  const p = { name, general:'liubei', hp:4, maxHp:4, hand:[], equips: equips(), delays:[], alive:true };
  if(opts && opts.caps) p.caps = opts.caps;
  if(opts && opts.hand) p.hand = opts.hand;
  return p;
}
function gameState(){
  // 顺手牵羊的业务层 canTarget 额外要求目标有可拿的牌(hasTargetCard:手牌/装备/判定区任一非空),
  // 所以目标统一给一张手牌,确保测试聚焦"谦逊/距离/重复"这些真正的差异点。
  return {
    players: [
      mkPlayer('我'),
      mkPlayer('谦逊目标', {caps:{qianxun:true}, hand:[{id:'h1', name:'闪', suit:'♥', rank:2}]}),
      mkPlayer('普通目标', {hand:[{id:'h2', name:'杀', suit:'♠', rank:7}]})
    ],
    deck: [], discard: [], log: [], phase:'play', turn:0, roundNum:1, gameMode:'ffa', pending:null
  };
}
// 在沙箱内求值 singleTargetCanTarget:参数与 buildSeatDOM 的调用完全一致
// (g, selSpec, 使用者, 实体牌, 目标座位)。
function renderCanTarget(g, specExpr, cardObj, targetSeat){
  context.g = g;
  return run('singleTargetCanTarget(g, '+specExpr+', g.players[0], '+JSON.stringify(cardObj)+', '+targetSeat+')');
}

let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e && e.message || e)); fail++; }
}

console.log('== 普通单目标牌追加 canTarget 约束(#102) ==');
check('顺手牵羊:谦逊目标不可点(singleTargetCanTarget=false)', function(){
  const g = gameState();
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["顺手牵羊"]', {name:'顺手牵羊', suit:'♥', rank:2}, 1), false,
    '谦逊角色不能成为顺手牵羊目标');
});
check('顺手牵羊:非谦逊、有牌可拿且在距离1内仍可点', function(){
  const g = gameState();
  g.players[1] = mkPlayer('普通目标A', {hand:[{id:'h3', name:'闪', suit:'♥', rank:3}]}); // 座位1换成普通目标(带手牌)
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["顺手牵羊"]', {name:'顺手牵羊', suit:'♥', rank:2}, 1), true,
    '普通目标应放行');
});
check('顺手牵羊:非谦逊但距离2的不可点(业务层距离约束同样生效)', function(){
  // 3人局任意两人距离恒为1,换成5人局:座位0→座位2 距离为2。
  const g = {
    players: [
      mkPlayer('我'),
      mkPlayer('邻座1', {hand:[{id:'a1', name:'闪'}]}),
      mkPlayer('距离2目标', {hand:[{id:'a2', name:'杀'}]}),
      mkPlayer('邻座3', {hand:[{id:'a3', name:'桃'}]}),
      mkPlayer('邻座4', {hand:[{id:'a4', name:'闪'}]})
    ],
    deck: [], discard: [], log: [], phase:'play', turn:0, roundNum:1, gameMode:'ffa', pending:null
  };
  context.g = g; // 先挂载 g,预检与断言读的是同一份状态
  assert.strictEqual(run('distance(g,0,2)'), 2, '预检:5人局 0→2 距离应为2');
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["顺手牵羊"]', {name:'顺手牵羊', suit:'♥', rank:2}, 2), false,
    '距离2超出顺手牵羊距离1限制,应拒绝');
});
check('乐不思蜀:谦逊目标不可点', function(){
  const g = gameState();
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["乐不思蜀"]', {name:'乐不思蜀', suit:'♥', rank:6}, 1), false,
    '谦逊角色不能成为乐不思蜀目标');
});
check('乐不思蜀:非谦逊目标可点', function(){
  const g = gameState();
  g.players[1].caps = undefined;
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["乐不思蜀"]', {name:'乐不思蜀', suit:'♥', rank:6}, 1), true,
    '普通目标应放行');
});
check('乐不思蜀:判定区已有同名仍被拒绝(追加约束含重复判定)', function(){
  const g = gameState();
  g.players[1].caps = undefined;
  g.players[1].delays = [{ id:'l1', name:'乐不思蜀' }];
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["乐不思蜀"]', {name:'乐不思蜀', suit:'♥', rank:6}, 1), false,
    '判定区同名应拒绝');
});
check('国色转化的乐不思蜀:谦逊目标不可点(镜像 render.js 国色块调用)', function(){
  const g = gameState();
  // render.js 国色选目标块正是这么调的:{name:'乐不思蜀', virtual:true} + CARD_PLAYS['乐不思蜀']
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["乐不思蜀"]', {name:'乐不思蜀', virtual:true}, 1), false,
    '国色转化牌不能以谦逊角色为目标');
});
check('国色转化的乐不思蜀:非谦逊目标可点', function(){
  const g = gameState();
  g.players[1].caps = undefined;
  assert.strictEqual(renderCanTarget(g, 'CARD_PLAYS["乐不思蜀"]', {name:'乐不思蜀', virtual:true}, 1), true,
    '国色转化对普通目标应放行');
});
check('追加约束语义:无 canTarget 的 spec 恒放行(不改变旧行为)', function(){
  const g = gameState();
  assert.strictEqual(renderCanTarget(g, '{target:true}', {name:'某牌'}, 1), true,
    'selSpec 没有 canTarget 时应放行');
  assert.strictEqual(renderCanTarget(g, 'null', {name:'某牌'}, 1), true,
    'selSpec 为空时应放行');
});

console.log('== 源码结构守卫(#102:既有 targetable 条件不得被替换/丢弃) ==');
check('targetable 行保留全部既有条件且追加 singleTargetCanTarget', function(){
  const src = fs.readFileSync('render.js', 'utf8');
  const line = src.split('\n').find(l => l.includes('const targetable =') && l.includes('singleTargetCanTarget'));
  assert.ok(line, 'targetable 计算应调用 singleTargetCanTarget');
  ['!!(selSpec && selSpec.target)', 'selfOK', 'p.alive', 'needHandOrEquip', 'needHandOnly',
   'inRange', 'hasDupDelay', 'singleTargetCanTarget'].forEach(k => {
    assert.ok(line.includes(k), 'targetable 应保留既有条件 '+k);
  });
});
check('国色选目标块复用 singleTargetCanTarget', function(){
  const src = fs.readFileSync('render.js', 'utf8');
  const i = src.indexOf('发动【国色】？');
  const block = src.slice(src.lastIndexOf('// 大乔【国色】选目标', i), src.indexOf('if(lianhuanMode', i));
  assert.ok(block.includes('singleTargetCanTarget(g, CARD_PLAYS[\'乐不思蜀\']'), '国色块应调用业务层 canTarget');
  assert.ok(block.includes('谦逊') || block.includes('谦逊'), '国色块应带谦逊注释');
});

console.log('\nqianxun target UI tests: '+pass+' passed, '+fail+' failed');
if(fail > 0) process.exit(1);
