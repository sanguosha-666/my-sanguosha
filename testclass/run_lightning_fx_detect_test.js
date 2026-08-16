/**
 * 闪电判定全屏特效 检测/触发测试
 *
 * 背景：用户请求"闪电判定有结果时在所有玩家画面播放全屏动画"（参考死亡动画）。
 * 实现：
 *   1. 游戏层——data.js 的 DELAY_TRICKS['闪电'].effect 在判定结果一出来就写
 *      g.lastLightningFx={seq, seat, hit}（劈中 hit:true 播 falsh1 / 未劈中 hit:false 播 falsh0），
 *      seq 自增跨读取稳定，只保留最新一次（与 g.lastDamageEffect 同款模式）。
 *   2. 防御层——game.js normalize 对 undefined/格式非法的 lastLightningFx 回退 null。
 *   3. 前端层——render.js 哨兵 lastLightningFxSeq 检测 seq 变化后调用 triggerLightningFx(hit)；
 *      首次进入/刷新不补播历史（与 maybePlayCardSound/maybeShowDamageEffect 同款约定）。
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

// ============ 游戏层沙箱（config/data/stages/room-lifecycle/game/sha/weapons/skills） ============
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
function mkGame(sandbox){
  const g = {
    phase:'judge', turn:0, started:true,
    players:[mkPlayer(sandbox,'张飞','zhangfei'), mkPlayer(sandbox,'关羽','guanyu')],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[],
    shaUsed:false, gameMode:'ffa'
  };
  bindG(sandbox, g);
  return g;
}

console.log('\n== 游戏层：闪电判定写 g.lastLightningFx ==\n');

check('判定不中(非黑桃2~9)→ hit:false + seat 正确 + 返回下家座位', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  const lt = R(s, 'DELAY_TRICKS')['闪电'];
  const judgeCard = { name:'杀', suit:'♥', rank:3 };
  const card = { name:'闪电', suit:'♠', rank:1 };
  const result = lt.effect(g, 0, judgeCard, card);
  assert.strictEqual(JSON.stringify(g.lastLightningFx), JSON.stringify({ seq:1, seat:0, hit:false }));
  assert.strictEqual(result, 1, '未劈中应返回下家座位号');
});

check('判定劈中(黑桃2~9)→ hit:true + 扣3血', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  const lt = R(s, 'DELAY_TRICKS')['闪电'];
  const judgeCard = { name:'杀', suit:'♠', rank:3 };
  const card = { name:'闪电', suit:'♠', rank:1 };
  const result = lt.effect(g, 0, judgeCard, card);
  assert.strictEqual(JSON.stringify(g.lastLightningFx), JSON.stringify({ seq:1, seat:0, hit:true }));
  assert.strictEqual(g.players[0].hp, 1, '劈中应扣3点伤害(4-3=1)');
  assert.strictEqual(result, undefined, '劈中不传牌');
});

check('连续两次判定 seq 单调递增', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  const lt = R(s, 'DELAY_TRICKS')['闪电'];
  lt.effect(g, 0, { name:'杀', suit:'♥', rank:3 }, { name:'闪电', suit:'♠', rank:1 });
  lt.effect(g, 1, { name:'杀', suit:'♣', rank:5 }, { name:'闪电', suit:'♠', rank:1 });
  assert.strictEqual(g.lastLightningFx.seq, 2, '第二次判定 seq 应为 2');
  assert.strictEqual(g.lastLightningFx.seat, 1);
  assert.strictEqual(g.lastLightningFx.hit, false);
});

check('脏数据防御：lastLightningFx 格式非法→normalize 回退 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastLightningFx = { seq:1, seat:0, hit:'yes' }; // hit 非布尔
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastLightningFx, null, 'hit 非布尔应回退 null');
});

check('脏数据防御：lastLightningFx 缺失→normalize 补 null', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  delete g.lastLightningFx;
  R(s, 'normalize')(g);
  assert.strictEqual(g.lastLightningFx, null, '缺失应补 null');
});

check('脏数据防御：合法 lastLightningFx 不被 normalize 清掉', ()=>{
  const s = freshGameSandbox();
  const g = mkGame(s);
  g.lastLightningFx = { seq:3, seat:1, hit:true };
  R(s, 'normalize')(g);
  assert.strictEqual(JSON.stringify(g.lastLightningFx), JSON.stringify({ seq:3, seat:1, hit:true }));
});

// ============ 前端层沙箱（config/data/room-lifecycle/render + mock triggerLightningFx） ============
console.log('\n== 前端层：render.js 哨兵检测 ==\n');

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
fsandbox.__ltFired=[];
FR('window.triggerLightningFx=function(hit){ global.__ltFired.push(hit); };');
FR('triggerLightningFx=window.triggerLightningFx;');

check('首次调用(无基线)不触发', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:{seq:5,seat:1,hit:false}})');
  assert.strictEqual(fsandbox.__ltFired.length,0,'首次不应触发');
});

check('新事件触发且透传 hit=false(未劈中)', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:{seq:5,seat:1,hit:false}}); maybePlayLightningFx({lastLightningFx:{seq:6,seat:1,hit:false}})');
  assert.strictEqual(JSON.stringify(fsandbox.__ltFired),JSON.stringify([false]),'seq 变化应触发一次,hit 应为 false');
});

check('新事件触发且透传 hit=true(劈中)', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:{seq:5,seat:1,hit:false}}); maybePlayLightningFx({lastLightningFx:{seq:7,seat:2,hit:true}})');
  assert.strictEqual(JSON.stringify(fsandbox.__ltFired),JSON.stringify([true]),'seq 变化应触发一次,hit 应为 true');
});

check('seq 未变不重复触发', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:{seq:5,seat:1,hit:false}}); maybePlayLightningFx({lastLightningFx:{seq:5,seat:1,hit:false}})');
  assert.strictEqual(fsandbox.__ltFired.length,0,'同 seq 不应重复触发');
});

check('无事件(字段缺失/null)不触发', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:null}); maybePlayLightningFx({})');
  assert.strictEqual(fsandbox.__ltFired.length,0,'无事件不应触发');
});

check('跨事件连续触发且去重正确', function(){
  fsandbox.__ltFired=[];
  FR('lastLightningFxSeq=undefined; __ltFired=[]; maybePlayLightningFx({lastLightningFx:{seq:1,seat:0,hit:false}}); maybePlayLightningFx({lastLightningFx:{seq:2,seat:0,hit:true}}); maybePlayLightningFx({lastLightningFx:{seq:2,seat:0,hit:true}}); maybePlayLightningFx({lastLightningFx:{seq:3,seat:1,hit:false}})');
  assert.strictEqual(JSON.stringify(fsandbox.__ltFired),JSON.stringify([true,false]),'应触发 seq2(hit true)与 seq3(hit false),seq2 重复不二次触发');
});

console.log('\nlightning fx detect tests: '+passed+'/'+(passed+failed)+' passed');
process.exit(failed?1:0);
