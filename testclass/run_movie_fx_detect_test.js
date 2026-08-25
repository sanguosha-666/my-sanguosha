/**
 * 过场动画(武将死亡/胜负结算) 检测/触发测试
 *
 * 背景：用户请求按武将剧情点播放全屏动画(参考死亡动画)，优先级：左慈 > 于吉 > 阵营统一动画。
 *   yujiDeath : 于吉死 → 于吉以外的玩家播 yuji1.mp4
 *   yujiKill  : 于吉杀人 → 于吉以外且仍存活的玩家播 yuji0.mp4
 *   zuociDeath: 左慈死 → 仅杀死左慈的玩家播 zuoci0.mp4
 *   gameOver  : 胜负结算结果表 → 按身份分派：
 *               左慈所在阵营输 → 仅左慈玩家播 zuoci1.mp4(最优先)
 *               反贼输/胜 → 反贼玩家播 fanze-lost.mp4 / fanzei-win.mp4
 *               主公输 → 主公玩家播 zhuzhong-lost.mp4
 *               忠臣输 → 忠臣玩家播 han.mp4
 * 实现：
 *   1. 游戏层——game.js markMovieFx 写 g.lastMovieFx={seq, kind, seat, result?}：
 *      finishDying 死亡分支(于吉死/左慈死/于吉杀人，左慈最优先最后写)、
 *      checkWin 身份局结束(写 gameOver 结果表)。
 *   2. 防御层——game.js normalize 对 undefined/格式非法回退 null。
 *   3. 前端层——render.js 哨兵 lastMovieFxSeq + movieVideoKeyForMe 按 kind+座位/身份分派。
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
const S = (o)=>JSON.stringify(o);

// ============ 游戏层沙箱 ============
function freshGameSandbox(){
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
  return sandbox;
}
function R(sandbox, code){ return vm.runInContext(code, sandbox); }
function bindG(sandbox, g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function mkPlayer(sandbox, name, genId, extra){
  const gen = R(sandbox, 'getGeneral')(genId);
  return Object.assign({
    name, general: genId, gender: gen&&gen.gender,
    hp: gen?gen.maxHp:4, maxHp: gen?gen.maxHp:4,
    hand: [], equips: R(sandbox, 'emptyEquips')(), delays: [], alive: true, dying: false
  }, extra||{});
}
function mkGame(sandbox, opts){
  opts = opts || {};
  const g = {
    phase:'play', turn:0, started:true, gameMode: opts.gameMode || 'ffa',
    players: opts.players || [mkPlayer(sandbox,'张飞','zhangfei'), mkPlayer(sandbox,'关羽','guanyu')],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[],
    shaUsed:false
  };
  bindG(sandbox, g);
  return g;
}
function mkDying(sandbox, victimSeat, killerSeat){
  const g = mkGame(sandbox);
  g.pending = { type:'dying', seat:victimSeat, resume: { type:'sha', sourceSeat:killerSeat, amount:1 } };
  bindG(sandbox, g);
  return g;
}

console.log('\n== 游戏层：finishDying 死亡事件 ==\n');

check('于吉死 → yujiDeath(死者座位)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'yuji';
  R(s, 'finishDying')(g, true);
  // ffa 2人局死亡即终局，队列：死亡事件 + gameOver
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'yujiDeath', seat:0}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:false}}));
  assert.strictEqual(S(g.movieFxQueue[1]), S(g.lastMovieFx));
});

check('左慈死 → zuociDeath(杀手座位)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'zuoci';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'zuociDeath', seat:1}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:true}}));
});

check('于吉杀人 → yujiKill(于吉座位)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[1].general = 'yuji';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'yujiKill', seat:1}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:false}}));
});

check('普通人死亡 → 仅 gameOver（ffa 2人局终局）', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  R(s, 'finishDying')(g, true);
  assert.strictEqual(g.movieFxQueue.length, 1);
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:false}}));
});

check('于吉杀死左慈 → 单条 yujiZuociDeath，yujiKill/zuociDeath 随机', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'zuoci';
  g.players[1].general = 'yuji';
  R(s, 'finishDying')(g, true);
  const want={seq:1, kind:'yujiZuociDeath', seat:1, result:{killerSeat:1, victimSeat:0}};
  assert.strictEqual(S(g.movieFxQueue[0]), S(want));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:true}}));
});

console.log('\n== 游戏层：大乔/小乔/貂蝉 表情事件 ==\n');

check('三人之一杀人 → girlKill(杀手座位, gen+victimSeat)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[1].general = 'daqiao';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'girlKill', seat:1, result:{gen:'daqiao', victimSeat:0}}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, girlWin:{seat:1, gen:'daqiao'}, zuociLose:false}}));
});

check('三人之一被杀 → girlDeath(死者座位, gen+killerSeat)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'xiaoqiao';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'girlDeath', seat:0, result:{gen:'xiaoqiao', killerSeat:1}}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:false, girlLose:{seat:0, gen:'xiaoqiao'}}}));
});

check('三人互杀 → 单条 girlKillDeath，杀与被杀视频随机', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'diaochan';
  g.players[1].general = 'daqiao';
  R(s, 'finishDying')(g, true);
  // 覆盖前：seq=2 的 girlDeath；现：单条 girlKillDeath，seq=1，含双方信息，终局 gameOver 为 seq2
  const want = {seq:1, kind:'girlKillDeath', seat:0, result:{killerGen:'daqiao', victimGen:'diaochan', killerSeat:1, victimSeat:0}};
  assert.strictEqual(S(g.movieFxQueue[0]), S(want));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, girlWin:{seat:1, gen:'daqiao'}, zuociLose:false}}));
});

check('三人被杀无杀手(如闪电) → girlDeath killerSeat:null', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'diaochan';
  delete g.pending.resume.sourceSeat;
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.movieFxQueue[0]), S({seq:1, kind:'girlDeath', seat:0, result:{gen:'diaochan', killerSeat:null}}));
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'gameOver', seat:null, result:{winnerSeat:1, zuociLose:false, girlLose:{seat:0, gen:'diaochan'}}}));
});

console.log('\n== 游戏层：checkWin 结算结果表 ==\n');

check('内奸胜 → gameOver 全员输,左慈主公输 zuociLose=true', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'内奸','yuji', {role:'nei'});
  const p1 = mkPlayer(s,'主公','zuoci', {role:'zhu', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'nei');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'lose',lord:'lose',zhong:'lose',nei:'win',zuociLose:true}}));
});

check('主公与忠臣胜 → 反贼输,左慈反贼输 zuociLose=true', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'主公','zhangfei', {role:'zhu'});
  const p1 = mkPlayer(s,'反贼','zuoci', {role:'fan', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'lord');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'lose',lord:'win',zhong:'win',nei:'lose',zuociLose:true}}));
});

check('反贼胜 → 反贼 win,左慈反贼赢 zuociLose=false', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'反贼','zuoci', {role:'fan'});
  const p1 = mkPlayer(s,'主公','zhangfei', {role:'zhu', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'fan');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false}}));
});

check('无胜者(none) → 全员输,左慈输 zuociLose=true', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'主公','zuoci', {role:'zhu', hp:0, alive:false});
  const p1 = mkPlayer(s,'反贼','zhangfei', {role:'fan', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'none');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'lose',lord:'lose',zhong:'lose',nei:'lose',zuociLose:true}}));
});

check('大乔胜利 → gameOver 带 girlWin;无女孩时无 girl 字段', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'大乔','daqiao', {role:'fan'});
  const p1 = mkPlayer(s,'主公','zhangfei', {role:'zhu', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false,girlWin:{seat:0,gen:'daqiao'}}}));
});

check('貂蝉失败 → gameOver 带 girlLose', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'貂蝉','diaochan', {role:'zhu', hp:0, alive:false});
  const p1 = mkPlayer(s,'反贼','zhangfei', {role:'fan'});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'fan');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false,girlLose:{seat:0,gen:'diaochan'}}}));
});

console.log('\n== 游戏层：checkWin 组队/乱斗 gameOver ==\n');

check('组队胜 → gameOver 带 teamWin 与 girlWin/girlLose 首个', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'大乔','daqiao', {team:0});
  const p1 = mkPlayer(s,'小乔','xiaoqiao', {team:1, hp:0, alive:false});
  const p2 = mkPlayer(s,'路人','zhangfei', {team:0});
  const p3 = mkPlayer(s,'路人2','guanyu', {team:1, hp:0, alive:false});
  const g = mkGame(s, {gameMode:'team', players:[p0,p1,p2,p3]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'team:0');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{teamWin:0, zuociLose:false, girlWin:{seat:0, gen:'daqiao'}, girlLose:{seat:1, gen:'xiaoqiao'}}}));
  assert.strictEqual(g.movieFxQueue.length, 1);
});

check('组队无胜者 → gameOver 空 res 仍入队', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'张飞','zhangfei', {team:0, hp:0, alive:false});
  const p1 = mkPlayer(s,'关羽','guanyu', {team:1, hp:0, alive:false});
  const g = mkGame(s, {gameMode:'team', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winner, '无');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{zuociLose:false}}));
});

check('乱斗胜 → gameOver 带 winnerSeat 与 girlWin', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'大乔','daqiao', {hp:0, alive:false});
  const p1 = mkPlayer(s,'胜者','zhangfei', {general:'daqiao'});
  const g = mkGame(s, {gameMode:'ffa', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{winnerSeat:1, girlWin:{seat:1, gen:'daqiao'}, zuociLose:false}}));
});

check('乱斗无胜者 → gameOver 空 res 仍入队', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'张飞','zhangfei', {hp:0, alive:false});
  const p1 = mkPlayer(s,'关羽','guanyu', {hp:0, alive:false});
  const g = mkGame(s, {gameMode:'ffa', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winner, '无');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'gameOver', seat:null, result:{zuociLose:false}}));
});

console.log('\n== 防御层：normalize ==\n');

check('脏数据防御：lastMovieFx 格式非法→normalize 回退 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastMovieFx = { seq:1, kind:123, seat:0 }; // kind 非字符串
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
  g.lastMovieFx = { seq:'x', kind:'gameOver', seat:null }; // seq 非整数
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
  g.lastMovieFx = { seq:1, kind:'gameOver', seat:'a' }; // seat 非整数非 null
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
  g.lastMovieFx = { seq:1, kind:'gameOver', seat:null, result:['x'] }; // result 是数组
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
});

check('脏数据防御：lastMovieFx 缺失→normalize 补 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
});

check('合法 lastMovieFx(含 result)不被 normalize 清掉', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastMovieFx = { seq:3, kind:'gameOver', seat:null, result:{fan:'lose',lord:'win',zhong:'win',zuociLose:false} };
  R(s, 'normalize')(g);
  assert.strictEqual(S(g.lastMovieFx), S({seq:3, kind:'gameOver', seat:null, result:{fan:'lose',lord:'win',zhong:'win',zuociLose:false}}));
});

check('Firebase 丢 seat:null 后仍保留 gameOver（缺 seat 键视为 null）', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  // RTDB 不存 null：写入 {seq,kind:'gameOver',seat:null,result} 读回没有 seat 键
  g.lastMovieFx = { seq:1, kind:'gameOver', result:{fan:'win',lord:'lose',zhong:'lose',zuociLose:false} };
  R(s, 'normalize')(g);
  assert.ok(g.lastMovieFx, '缺 seat 不应整条清掉');
  assert.strictEqual(g.lastMovieFx.kind, 'gameOver');
  assert.strictEqual(g.lastMovieFx.seq, 1);
  assert.strictEqual(g.lastMovieFx.seat, null, '缺席 seat 应回填 null');
  assert.strictEqual(g.lastMovieFx.result.fan, 'win');
});

// ============ 前端层沙箱 ============
console.log('\n== 前端层：render.js 哨兵 + 分派 ==\n');

const context = {
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document;
context.window.firebase=context.firebase;
context.global=context;
const fsandbox=vm.createContext(context);
['config.js','data.js','room-lifecycle.js','render.js'].forEach(file=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),fsandbox,{filename:file});
});
function FR(code){return vm.runInContext(code,fsandbox);}
fsandbox.__mvFired=[];
FR('window.triggerMovieFx=function(key){ global.__mvFired.push(key); };');
FR('triggerMovieFx=window.triggerMovieFx;');

// 一次性跑"基线 + 当前事件",返回触发的 key 数组
function fire(evt, mySeat, players){
  FR('lastMovieFxSeq=undefined;');
  FR('mySeat='+mySeat+';');
  fsandbox.__g = { players: players, lastMovieFx: evt };
  fsandbox.__mvFired=[];
  FR('lastMovieFxSeq=undefined; maybePlayMovieFx({lastMovieFx:{seq:0,kind:"baseline",seat:null}});');
  FR('maybePlayMovieFx(__g);');
  return fsandbox.__mvFired;
}

check('首次调用(无基线)不触发', function(){
  fsandbox.__mvFired=[];
  FR('lastMovieFxSeq=undefined; __mvFired=[]; maybePlayMovieFx({players:[{alive:true,role:"zhu"}],lastMovieFx:{seq:5,kind:"gameOver",seat:null,result:{}}})');
  assert.strictEqual(fsandbox.__mvFired.length,0,'首次不应触发');
});

check('yujiDeath：非于吉玩家触发 / 于吉本人不触发', function(){
  const players=[{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'yujiDeath',seat:1}, 0, players)), S(['yujiDeath']), '座位0非于吉(于吉=1)应触发');
  assert.strictEqual(S(fire({seq:2,kind:'yujiDeath',seat:0}, 0, players)), S([]), '于吉本人(0)不应触发');
});

check('yujiKill：于吉以外且存活触发 / 于吉本人不触发 / 自己已死不触发', function(){
  assert.strictEqual(S(fire({seq:1,kind:'yujiKill',seat:1}, 0, [{alive:true},{alive:true}])), S(['yujiKill']));
  assert.strictEqual(S(fire({seq:2,kind:'yujiKill',seat:0}, 0, [{alive:true},{alive:true}])), S([]), '于吉本人(0)不应触发');
  assert.strictEqual(S(fire({seq:3,kind:'yujiKill',seat:1}, 0, [{alive:false},{alive:true}])), S([]), '自己已死不应触发');
});

check('zuociDeath：仅杀手触发', function(){
  const players=[{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'zuociDeath',seat:0}, 0, players)), S(['zuociDeath']), '杀手本人应触发');
  assert.strictEqual(S(fire({seq:2,kind:'zuociDeath',seat:1}, 0, players)), S([]), '非杀手不应触发');
});

check('gameOver：反贼胜→fanWin / 反贼输→fanLose', function(){
  const res={fan:'win',lord:'lose',zhong:'lose',zuociLose:false};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:res}, 0, [{alive:true,role:'fan'}])), S(['fanWin']));
  const res2={fan:'lose',lord:'win',zhong:'win',zuociLose:false};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:res2}, 0, [{alive:true,role:'fan'}])), S(['fanLose']));
});

check('gameOver：主公输→lordLose / 主公赢不播', function(){
  const res={fan:'win',lord:'lose',zhong:'lose',zuociLose:false};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:res}, 0, [{alive:true,role:'zhu'}])), S(['lordLose']));
  const res2={fan:'lose',lord:'win',zhong:'win',zuociLose:false};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:res2}, 0, [{alive:true,role:'zhu'}])), S([]), '主公赢不应触发');
});

check('gameOver：忠臣输→zhongLose / 忠臣赢不播', function(){
  const res={fan:'win',lord:'lose',zhong:'lose',zuociLose:false};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:res}, 0, [{alive:true,role:'zhong'}])), S(['zhongLose']));
  const res2={fan:'lose',lord:'win',zhong:'win',zuociLose:false};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:res2}, 0, [{alive:true,role:'zhong'}])), S([]), '忠臣赢不应触发');
});

check('gameOver：左慈玩家且左慈输→zuociLose(最优先,覆盖阵营动画)', function(){
  // 左慈是反贼且反贼输:应播 zuociLose 而非 fanLose(左慈最优先)
  const res={fan:'lose',lord:'win',zhong:'win',zuociLose:true};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:res}, 0, [{alive:true,role:'fan',general:'zuoci'}])), S(['zuociLose']));
  // 左慈是主公且主公输:播 zuociLose 而非 lordLose
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:res}, 0, [{alive:true,role:'zhu',general:'zuoci'}])), S(['zuociLose']));
  // 左慈玩家但左慈没输(反贼赢):按阵营播 fanWin
  const res2={fan:'win',lord:'lose',zhong:'lose',zuociLose:false};
  assert.strictEqual(S(fire({seq:3,kind:'gameOver',seat:null,result:res2}, 0, [{alive:true,role:'fan',general:'zuoci'}])), S(['fanWin']));
});

check('gameOver：内奸胜→neiWin / 内奸输不播', function(){
  const win={fan:'lose',lord:'lose',zhong:'lose',nei:'win',zuociLose:false};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:win}, 0, [{alive:true,role:'nei'}])), S(['neiWin']));
  const lose={fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:lose}, 0, [{alive:true,role:'nei'}])), S([]), '内奸输不应触发');
});

console.log('\n== 前端层：大乔/小乔/貂蝉 表情分派 ==\n');

check('girlKill：杀手播羞涩无后缀 / 被杀者播妩媚无后缀 / 他人播后缀', function(){
  const players=[{alive:true},{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},0,players)), S(['assets/video/daqiao-xiuse.mp4']), '杀手本人');
  assert.strictEqual(S(fire({seq:2,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},1,players)), S(['assets/video/daqiao-wumei.mp4']), '被杀者');
  const other=fire({seq:3,kind:'girlKill',seat:0,result:{gen:'daqiao',victimSeat:1}},2,players);
  const pool=['assets/video/daqiao-xiuse01.mp4','assets/video/daqiao-xiuse02.mp4','assets/video/daqiao-xiuse03.mp4'];
  assert.ok(pool.indexOf(other[0])>=0, '他人应播后缀羞涩(daqiao 妩媚无后缀),实际 '+S(other));
});

check('girlDeath：被杀者播麻木 / 杀手播畏惧 / 他人播后缀', function(){
  const players=[{alive:true},{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'girlDeath',seat:0,result:{gen:'xiaoqiao',killerSeat:1}},0,players)), S(['assets/video/xiaoqiao-mamu.mp4']), '被杀者本人');
  assert.strictEqual(S(fire({seq:2,kind:'girlDeath',seat:0,result:{gen:'xiaoqiao',killerSeat:1}},1,players)), S(['assets/video/xiaoqiao-weiju.mp4']), '杀手');
  const other=fire({seq:3,kind:'girlDeath',seat:0,result:{gen:'xiaoqiao',killerSeat:1}},2,players);
  const pool=['assets/video/xiaoqiao-mamu01.mp4','assets/video/xiaoqiao-weiju01.mp4','assets/video/xiaoqiao-weiju02.mp4'];
  assert.ok(pool.indexOf(other[0])>=0, '他人应播后缀,实际 '+S(other));
});

check('girlKillDeath：三人互杀时杀与被杀视频随机', function(){
  const players=[{alive:true},{alive:true},{alive:true}];
  const evt={seq:1,kind:'girlKillDeath',seat:0,result:{killerGen:'daqiao', victimGen:'diaochan', killerSeat:1, victimSeat:0}};
  // 杀手视角: 杀时羞涩(daqiao-xiuse) vs 被杀时畏惧(diaochan-weiju) 二选一
  const killerSeen=new Set();
  for(let i=0;i<20;i++) killerSeen.add(fire({seq:10+i,kind:'girlKillDeath',seat:0,result:{killerGen:'daqiao', victimGen:'diaochan', killerSeat:1, victimSeat:0}},1,players)[0]);
  assert.ok(killerSeen.has('assets/video/daqiao-xiuse.mp4'), '杀手应能看到 daqiao-xiuse');
  assert.ok(killerSeen.has('assets/video/diaochan-weiju.mp4'), '杀手应能看到 diaochan-weiju');
  // 被杀者视角: 杀时妩媚(daqiao-wumei) vs 被杀时麻木(diaochan-mamu) 二选一
  const victimSeen=new Set();
  for(let i=0;i<20;i++) victimSeen.add(fire({seq:30+i,kind:'girlKillDeath',seat:0,result:{killerGen:'daqiao', victimGen:'diaochan', killerSeat:1, victimSeat:0}},0,players)[0]);
  assert.ok(victimSeen.has('assets/video/daqiao-wumei.mp4'), '被杀者应能看到 daqiao-wumei');
  assert.ok(victimSeen.has('assets/video/diaochan-mamu.mp4'), '被杀者应能看到 diaochan-mamu');
  // 其他玩家: 后缀池随机(杀后缀 vs 被杀后缀 二选一)
  const other=fire({seq:100,kind:'girlKillDeath',seat:0,result:{killerGen:'daqiao', victimGen:'diaochan', killerSeat:1, victimSeat:0}},2,players);
  const killSfx=['assets/video/daqiao-xiuse01.mp4','assets/video/daqiao-xiuse02.mp4','assets/video/daqiao-xiuse03.mp4'];
  const deathSfx=['assets/video/diaochan-mamu01.mp4','assets/video/diaochan-mamu02.mp4','assets/video/diaochan-mamu03.mp4','assets/video/diaochan-weiju01.mp4'];
  const pool=killSfx.concat(deathSfx);
  assert.ok(pool.indexOf(other[0])>=0, '他人应播后缀(杀或被杀),实际 '+S(other));
});

check('gameOver：三人胜利播开心 / 失败播悲痛(无后缀)', function(){
  const win={fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false,girlWin:{seat:0,gen:'diaochan'}};
  assert.strictEqual(S(fire({seq:1,kind:'gameOver',seat:null,result:win},0,[{alive:true,role:'fan',general:'diaochan'}])), S(['assets/video/diaochan-kaixin.mp4']), '女孩胜利');
  const lose={fan:'lose',lord:'win',zhong:'win',nei:'lose',zuociLose:false,girlLose:{seat:0,gen:'diaochan'}};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:lose},0,[{alive:true,role:'fan',general:'diaochan'}])), S(['assets/video/diaochan-beitong.mp4']), '女孩失败');
});

check('gameOver：旁观者看后缀表情(替换阵营动画);无后缀池时回退阵营动画', function(){
  const win={fan:'win',lord:'lose',zhong:'lose',nei:'lose',zuociLose:false,girlWin:{seat:0,gen:'daqiao'}};
  const other=fire({seq:1,kind:'gameOver',seat:null,result:win},1,[{alive:true,role:'fan',general:'daqiao'},{alive:true,role:'zhong'}]);
  assert.ok(['assets/video/daqiao-kaixin01.mp4'].indexOf(other[0])>=0, '旁观者应播后缀开心,实际 '+S(other));
  // xiaoqiao 悲痛无后缀 → 旁观者回退阵营动画(忠臣赢不播)
  const lose={fan:'lose',lord:'win',zhong:'win',nei:'lose',zuociLose:false,girlLose:{seat:0,gen:'xiaoqiao'}};
  assert.strictEqual(S(fire({seq:2,kind:'gameOver',seat:null,result:lose},1,[{alive:true,role:'fan',general:'xiaoqiao'},{alive:true,role:'zhong'}])), S([]), '无后缀池回退阵营(忠臣赢不播)');
});

check('seq 未变不重复触发', function(){
  const players=[{alive:true,role:'zhu'}];
  fsandbox.__p=players;
  FR('lastMovieFxSeq=undefined; mySeat=0; __mvFired=[];');
  FR('maybePlayMovieFx({players:__p,lastMovieFx:{seq:1,kind:"gameOver",seat:null,result:{fan:"win",lord:"lose",zhong:"lose",zuociLose:false}}});');
  FR('maybePlayMovieFx({players:__p,lastMovieFx:{seq:1,kind:"gameOver",seat:null,result:{fan:"win",lord:"lose",zhong:"lose",zuociLose:false}}});');
  assert.strictEqual(fsandbox.__mvFired.length,0,'同 seq 不应重复触发');
});

console.log('\nmovie fx detect tests: '+passed+'/'+(passed+failed)+' passed');
process.exit(failed?1:0);
