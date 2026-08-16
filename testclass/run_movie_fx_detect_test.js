/**
 * 过场动画(武将死亡/胜负结算) 检测/触发测试
 *
 * 背景：用户请求按武将剧情点播放全屏动画(参考死亡动画)：
 *   yujiDeath : 于吉死 → 于吉以外的玩家播 yuji1.mp4
 *   yujiKill  : 于吉杀人 → 于吉以外且仍存活的玩家播 yuji0.mp4
 *   zuociDeath: 左慈死 → 仅杀死左慈的玩家播 zuoci0.mp4
 *   zuociLose : 结算时左慈所在阵营输 → 仅使用左慈的玩家播 zuoci1.mp4
 *   neiWin    : 内奸胜 → 使用主公/忠臣的玩家播 han.mp4
 * 实现：
 *   1. 游戏层——game.js markMovieFx 写 g.lastMovieFx={seq, kind, seat}：
 *      finishDying 死亡分支(于吉死/左慈死/于吉杀人)、checkWin 身份局结束(左慈输/内奸胜)。
 *   2. 防御层——game.js normalize 对 undefined/格式非法回退 null。
 *   3. 前端层——render.js 哨兵 lastMovieFxSeq + maybePlayMovieFx 按 kind+座位/身份过滤。
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
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'yujiDeath', seat:0}));
});

check('左慈死 → zuociDeath(杀手座位)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'zuoci';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'zuociDeath', seat:1}));
});

check('于吉杀人 → yujiKill(于吉座位)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[1].general = 'yuji';
  R(s, 'finishDying')(g, true);
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'yujiKill', seat:1}));
});

check('普通人死亡 → 不写任何过场事件', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  R(s, 'finishDying')(g, true);
  assert.strictEqual(g.lastMovieFx, undefined);
});

check('于吉杀死左慈 → 按序覆盖,只留 yujiKill(seq 递增)', ()=>{
  const s = freshGameSandbox();
  const g = mkDying(s, 0, 1);
  g.players[0].general = 'zuoci';
  g.players[1].general = 'yuji';
  R(s, 'finishDying')(g, true);
  // 同一死命中 zuociDeath(seq1)+yujiKill(seq2),后者覆盖;seq 已自增至 2
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'yujiKill', seat:1}));
});

console.log('\n== 游戏层：checkWin 结算事件 ==\n');

check('内奸胜 → neiWin;左慈主公(输方)→ zuociLose', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'内奸','yuji', {role:'nei'});
  const p1 = mkPlayer(s,'主公','zuoci', {role:'zhu', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'nei');
  // 左慈在主公座位(输方)先写 zuociLose,neiWin 后写覆盖
  assert.strictEqual(S(g.lastMovieFx), S({seq:2, kind:'neiWin', seat:null}));
});

check('主公与忠臣胜 → 无 neiWin;左慈反贼(输方)→ zuociLose', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'主公','zhangfei', {role:'zhu'});
  const p1 = mkPlayer(s,'反贼','zuoci', {role:'fan', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'lord');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'zuociLose', seat:1}));
});

check('左慈在赢方(忠臣,主胜) → 不写 zuociLose', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'主公','zhangfei', {role:'zhu'});
  const p1 = mkPlayer(s,'忠臣','zuoci', {role:'zhong', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'lord');
  assert.strictEqual(g.lastMovieFx, undefined);
});

check('无胜者(none) → 左慈(任意阵营)视为输,写 zuociLose', ()=>{
  const s = freshGameSandbox();
  const p0 = mkPlayer(s,'主公','zuoci', {role:'zhu', hp:0, alive:false});
  const p1 = mkPlayer(s,'反贼','zhangfei', {role:'fan', hp:0, alive:false});
  const g = mkGame(s, {gameMode:'identity', players:[p0,p1]});
  R(s, 'checkWin')(g);
  assert.strictEqual(g.winSide, 'none');
  assert.strictEqual(S(g.lastMovieFx), S({seq:1, kind:'zuociLose', seat:0}));
});

console.log('\n== 防御层：normalize ==\n');

check('脏数据防御：lastMovieFx 格式非法→normalize 回退 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastMovieFx = { seq:1, kind:123, seat:0 }; // kind 非字符串
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
  g.lastMovieFx = { seq:'x', kind:'neiWin', seat:null }; // seq 非整数
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
  g.lastMovieFx = { seq:1, kind:'neiWin', seat:'a' }; // seat 非整数非 null
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
});

check('脏数据防御：lastMovieFx 缺失→normalize 补 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastMovieFx, null);
});

check('合法 lastMovieFx 不被 normalize 清掉', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastMovieFx = { seq:3, kind:'zuociLose', seat:1 };
  R(s, 'normalize')(g);
  assert.strictEqual(S(g.lastMovieFx), S({seq:3, kind:'zuociLose', seat:1}));
});

// ============ 前端层沙箱 ============
console.log('\n== 前端层：render.js 哨兵 + 过滤 ==\n');

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
FR('window.triggerMovieFx=function(kind){ global.__mvFired.push(kind); };');
FR('triggerMovieFx=window.triggerMovieFx;');

// 辅助:一次性跑"基线 + 当前事件",返回触发的 kind 数组
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
  FR('lastMovieFxSeq=undefined; __mvFired=[]; maybePlayMovieFx({players:[{alive:true,role:"zhu"}],lastMovieFx:{seq:5,kind:"neiWin",seat:null}})');
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

check('zuociLose：仅左慈玩家触发', function(){
  const players=[{alive:true},{alive:true}];
  assert.strictEqual(S(fire({seq:1,kind:'zuociLose',seat:0}, 0, players)), S(['zuociLose']));
  assert.strictEqual(S(fire({seq:2,kind:'zuociLose',seat:1}, 0, players)), S([]), '非左慈玩家不应触发');
});

check('neiWin：主公/忠臣触发,反贼/内奸不触发', function(){
  assert.strictEqual(S(fire({seq:1,kind:'neiWin',seat:null}, 0, [{alive:true,role:'zhu'}])), S(['neiWin']));
  assert.strictEqual(S(fire({seq:2,kind:'neiWin',seat:null}, 0, [{alive:true,role:'zhong'}])), S(['neiWin']));
  assert.strictEqual(S(fire({seq:3,kind:'neiWin',seat:null}, 0, [{alive:true,role:'fan'}])), S([]), '反贼不应触发');
  assert.strictEqual(S(fire({seq:4,kind:'neiWin',seat:null}, 0, [{alive:true,role:'nei'}])), S([]), '内奸本人不应触发');
});

check('seq 未变不重复触发', function(){
  const players=[{alive:true,role:'zhu'}];
  fsandbox.__p=players;
  FR('lastMovieFxSeq=undefined; mySeat=0; __mvFired=[];');
  FR('maybePlayMovieFx({players:__p,lastMovieFx:{seq:1,kind:"neiWin",seat:null}});');
  FR('maybePlayMovieFx({players:__p,lastMovieFx:{seq:1,kind:"neiWin",seat:null}});');
  assert.strictEqual(fsandbox.__mvFired.length,0,'同 seq 不应重复触发');
});

console.log('\nmovie fx detect tests: '+passed+'/'+(passed+failed)+' passed');
process.exit(failed?1:0);
