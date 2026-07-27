/**
 * 雌雄双股剑回归
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = __dirname;
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
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

['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  if(f==='game.js'){
    vm.runInContext(`
      tx = function(fn){ if(typeof _g==='undefined'||!_g) return; return fn(_g); };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
      var _g = null;
    `, sandbox);
  }
  console.log('  OK', f);
});

function R(code){ return vm.runInContext(code, sandbox); }
function bindG(g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }
function G(){ return vm.runInContext('_g', sandbox); }

function emptyEq(){ return R('emptyEquips')(); }
function mkPlayer(name, genId, extra){
  const gen = R('getGeneral')(genId);
  return Object.assign({
    name, general: genId, gender: gen&&gen.gender,
    hp: gen?gen.maxHp:4, maxHp: gen?gen.maxHp:4,
    hand: [], equips: emptyEq(), delays: [], alive: true, dying: false
  }, extra||{});
}

console.log('\n== 雌雄双股剑 ==\n');

check('EQUIPS 与 buildDeck 含雌雄', ()=>{
  const e = R('getEquip')('雌雄双股剑');
  assert.ok(e);
  assert.strictEqual(e.range, 2);
  assert.strictEqual(e.cap, 'cixiong');
  const deck = R('buildDeck')();
  const n = deck.filter(c=>c.name==='雌雄双股剑').length;
  assert.strictEqual(n, 1);
  assert.ok(deck.some(c=>c.name==='雌雄双股剑' && c.suit==='♠' && c.rank===2));
});

check('isOppositeGender', ()=>{
  const m = mkPlayer('男','zhangfei');
  const f = mkPlayer('女','daqiao');
  assert.strictEqual(R('isOppositeGender')(m,f), true);
  assert.strictEqual(R('isOppositeGender')(m,m), false);
});

check('异性杀触发 cixiongAsk', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'play', turn:0, started:true, players:[male,female],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[],
    shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  const gg = G();
  assert.strictEqual(gg.phase, 'cixiongAsk', 'phase='+gg.phase);
  assert.strictEqual(gg.pending.type, 'cixiongAsk');
  assert.strictEqual(gg.pending.from, 0);
  assert.strictEqual(gg.pending.to, 1);
});

check('同性不触发', ()=>{
  const m1 = mkPlayer('张飞','zhangfei');
  m1.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  m1.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const m2 = mkPlayer('关羽','guanyu');
  m2.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'play', turn:0, started:true, players:[m1,m2],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  const gg = G();
  assert.notStrictEqual(gg.phase, 'cixiongAsk');
  assert.ok(gg.phase==='respond' || gg.phase==='play' || gg.pending);
});

check('发动后目标弃牌再进 respond', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'杀',suit:'♠',rank:5},{id:4,name:'桃',suit:'♥',rank:3}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  let gg = G();
  assert.strictEqual(gg.phase, 'cixiongChoice');
  vm.runInContext('mySeat=1;', sandbox);
  R('respondCixiongChoice')('discard', 0);
  gg = G();
  assert.strictEqual(female.hand.length, 1);
  assert.ok(gg.discard.some(c=>c.name==='杀'));
  assert.strictEqual(gg.phase, 'respond');
});

check('发动后目标令摸牌', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'杀',suit:'♠',rank:5}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  vm.runInContext('mySeat=1;', sandbox);
  R('respondCixiongChoice')('draw');
  const gg = G();
  assert.strictEqual(male.hand.length, 1);
  assert.strictEqual(gg.phase, 'respond');
});

check('目标无手牌发动直接摸', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [];
  const female = mkPlayer('大乔','daqiao');
  female.hand = [];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'black' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true);
  const gg = G();
  assert.strictEqual(male.hand.length, 1);
  // 黑杀无仁王应进 respond
  assert.strictEqual(gg.phase, 'respond');
});

check('不发动直接继续', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  const female = mkPlayer('大乔','daqiao');
  female.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck:[], discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'red' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(false);
  assert.strictEqual(G().phase, 'respond');
});

check('黑杀+仁王:雌雄后仍可无效', ()=>{
  const male = mkPlayer('张飞','zhangfei');
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  const female = mkPlayer('大乔','daqiao');
  female.equips.armor = {id:9,name:'仁王盾',suit:'♣',rank:2};
  female.hand = [];
  const g = {
    phase:'cixiongAsk', turn:0, started:true,
    players:[male,female],
    deck: Array.from({length:5},(_,i)=>({id:100+i,name:'闪',suit:'♦',rank:2})),
    discard:[], log:[], exchangeCards:[],
    pending:{ type:'cixiongAsk', from:0, to:1, noShan:false, shaColor:'black' },
    shaUsed:true, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('respondCixiongAsk')(true); // 无手牌 → 摸后 continueAfter → 仁王无效
  const gg = G();
  assert.ok(male.hand.length>=1, '先摸了牌');
  // 仁王无效后 finishSingleShaTarget → phase play
  assert.strictEqual(gg.phase, 'play');
  const logText = (gg.log||[]).map(e=>e.text||e).join('|');
  assert.ok(logText.includes('仁王盾') || logText.includes('无效'), logText);
});

check('青釭剑黑杀无视仁王盾，目标仍可正常出闪', ()=>{
  const attacker=mkPlayer('张飞','zhangfei');
  attacker.equips.weapon={id:1,name:'青釭剑',suit:'♠',rank:6};
  attacker.hand=[{id:2,name:'杀',suit:'♠',rank:7}];
  const target=mkPlayer('大乔','daqiao');
  target.equips.armor={id:9,name:'仁王盾',suit:'♣',rank:2};
  target.hand=[{id:3,name:'闪',suit:'♦',rank:2}];
  const g={
    phase:'play',turn:0,started:true,players:[attacker,target],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],
    shaUsed:false,gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;',sandbox);
  R('playCard')(0,'杀',1);
  const gg=G();
  assert.strictEqual(gg.phase,'respond');
  assert.strictEqual(gg.pending.from,0);
  assert.strictEqual(gg.pending.to,1);
  const logText=(gg.log||[]).map(e=>e.text||e).join('|');
  assert.ok(logText.includes('青釭剑') && logText.includes('无视'),logText);
  assert.ok(!logText.includes('因【仁王盾】无效'),logText);
});

check('没有青釭剑时黑杀仍被仁王盾正常抵消', ()=>{
  const attacker=mkPlayer('张飞','zhangfei');
  attacker.hand=[{id:2,name:'杀',suit:'♠',rank:7}];
  const target=mkPlayer('大乔','daqiao');
  target.equips.armor={id:9,name:'仁王盾',suit:'♣',rank:2};
  const g={
    phase:'play',turn:0,started:true,players:[attacker,target],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],
    shaUsed:false,gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;',sandbox);
  R('playCard')(0,'杀',1);
  const gg=G();
  assert.strictEqual(gg.phase,'play');
  const logText=(gg.log||[]).map(e=>e.text||e).join('|');
  assert.ok(logText.includes('仁王盾') && logText.includes('无效'),logText);
});

check('丁奉短兵选择后按队列依次结算两个目标', ()=>{
  const dingfeng=mkPlayer('丁奉','dingfeng');
  dingfeng.hand=[{id:1,name:'杀',suit:'♠',rank:7}];
  const first=mkPlayer('甲','guanyu');
  first.hand=[{id:2,name:'闪',suit:'♦',rank:2}];
  const second=mkPlayer('乙','zhangfei');
  second.hand=[{id:3,name:'闪',suit:'♥',rank:4}];
  const g={
    phase:'play',turn:0,started:true,players:[dingfeng,first,second],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],
    shaUsed:false,gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;',sandbox);
  R('playCard')(0,'杀',1);
  let gg=G();
  assert.strictEqual(gg.phase,'duanbingChoose');
  assert.deepStrictEqual(Array.from(gg.pending.availableTargets),[2]);

  R('triggerDuanbing')(2);
  gg=G();
  assert.strictEqual(gg.phase,'respond');
  assert.strictEqual(gg.pending.to,1,'应先结算座位1');
  assert.strictEqual(gg.fangtianQueue.kind,'duanbing');
  assert.strictEqual(gg.fangtianQueue.targets.length,2);

  vm.runInContext('mySeat=1;',sandbox);
  R('respondShan')(true,0);
  gg=G();
  assert.strictEqual(gg.phase,'respond');
  assert.strictEqual(gg.pending.to,2,'第一个目标结束后才推进座位2');

  vm.runInContext('mySeat=2;',sandbox);
  R('respondShan')(true,0);
  gg=G();
  assert.strictEqual(gg.phase,'play');
  assert.strictEqual(gg.fangtianQueue,null);
  assert.strictEqual(first.hand.length,0);
  assert.strictEqual(second.hand.length,0);
});

check('丁奉取消短兵后只结算原目标', ()=>{
  const dingfeng=mkPlayer('丁奉','dingfeng');
  dingfeng.hand=[{id:1,name:'杀',suit:'♠',rank:7}];
  const first=mkPlayer('甲','guanyu');
  first.hand=[{id:2,name:'闪',suit:'♦',rank:2}];
  const second=mkPlayer('乙','zhangfei');
  const g={
    phase:'play',turn:0,started:true,players:[dingfeng,first,second],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],
    shaUsed:false,gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;',sandbox);
  R('playCard')(0,'杀',1);
  assert.strictEqual(G().phase,'duanbingChoose');
  R('cancelDuanbing')();
  const gg=G();
  assert.strictEqual(gg.phase,'respond');
  assert.strictEqual(gg.pending.to,1);
  assert.strictEqual(gg.fangtianQueue,null);
});

check('闪电令首名连环角色死亡后继续传导下一名角色', ()=>{
  const diaochan=mkPlayer('貂蝉','diaochan',{hp:1,chained:true});
  const guojia=mkPlayer('郭嘉','guojia',{hp:2,chained:true});
  const third=mkPlayer('第三人','zhangfei');
  const lightning={id:90,name:'闪电',suit:'♠',rank:1};
  const g={
    phase:'judge',turn:0,started:true,players:[diaochan,guojia,third],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],gameMode:'ffa'
  };
  bindG(g);
  assert.strictEqual(R('dealDamage')(g,0,3,undefined,'【闪电】发动','delay',lightning),true);
  let gg=G();
  assert.strictEqual(gg.phase,'dying');
  assert.strictEqual(diaochan.chained,false);
  assert.strictEqual(guojia.chained,false,'传导开始时参与者应解除连环');
  gg.pending.resume={type:'delay',seat:0};

  vm.runInContext('mySeat=0;',sandbox); R('respondDying')(false);
  vm.runInContext('mySeat=1;',sandbox); R('respondDying')(false);
  vm.runInContext('mySeat=2;',sandbox); R('respondDying')(false);
  gg=G();
  assert.strictEqual(diaochan.alive,false);
  assert.strictEqual(gg.phase,'dying','郭嘉受到传导后也应进入濒死');
  assert.strictEqual(gg.pending.seat,1);
  assert.strictEqual(guojia.hp,-1);
});

check('首名连环角色被桃救回后仍继续传导', ()=>{
  const diaochan=mkPlayer('貂蝉','diaochan',{hp:3,chained:true});
  diaochan.hand=[{id:1,name:'桃',suit:'♥',rank:3}];
  const guojia=mkPlayer('郭嘉','guojia',{hp:4,chained:true});
  const third=mkPlayer('第三人','zhangfei');
  const lightning={id:90,name:'闪电',suit:'♠',rank:1};
  const g={
    phase:'judge',turn:0,started:true,players:[diaochan,guojia,third],
    deck:[],discard:[],pending:null,log:[],exchangeCards:[],gameMode:'ffa'
  };
  bindG(g);
  R('dealDamage')(g,0,3,undefined,'【闪电】发动','delay',lightning);
  let gg=G();
  gg.pending.resume={type:'delay',seat:0};
  vm.runInContext('mySeat=0;',sandbox);
  R('respondDying')(true);
  gg=G();
  assert.strictEqual(diaochan.alive,true);
  assert.strictEqual(diaochan.hp,1);
  assert.strictEqual(guojia.hp,1,'貂蝉脱离濒死后郭嘉仍应受到3点雷伤');
  assert.strictEqual(gg.chainDamageQueue,null);
});

check('hasCap cixiong', ()=>{
  const p = mkPlayer('张飞','zhangfei');
  p.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  assert.strictEqual(R('hasCap')(p,'cixiong'), true);
  p.equips.weapon = null;
  assert.strictEqual(R('hasCap')(p,'cixiong'), false);
});

// ===== 优先级交互 1:大乔【流离】转移后,雌雄双股剑按转移后的新目标重新判断性别 =====
// 用真实调用链驱动(playCard→maybeStartLiuli挂起→respondLiuli转移→resolveShaUseNoLiuli
// 重入→afterShaTargetSkills→maybeStartCixiong),不直接调用底层判断函数跳过中间环节。
// 3人局:distance() 在存活玩家数=3时任意两人间恒为1,不需要额外配马/武器控制距离。
function mkLiuliScene(bGeneralId){
  const male = mkPlayer('张飞','zhangfei'); // 攻击者:男
  male.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  male.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const daqiao = mkPlayer('大乔','daqiao'); // 原目标A:女,有流离
  daqiao.hand = [{id:3,name:'闪',suit:'♦',rank:2}]; // 供流离弃置
  const b = mkPlayer('B','b'+bGeneralId, {general: bGeneralId}); // 占位,下面用真实武将覆盖
  const bGen = R('getGeneral')(bGeneralId);
  b.gender = bGen && bGen.gender;
  b.hp = bGen ? bGen.maxHp : 4; b.maxHp = b.hp;
  const g = {
    phase:'play', turn:0, started:true, players:[male, daqiao, b],
    deck: Array.from({length:20},(_,i)=>({id:100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
  return { male, daqiao, b, g };
}

check('流离转移:攻击者与转移后新目标同性 → 雌雄双股剑不应触发(不是巧合,是重判生效)', ()=>{
  const { g } = mkLiuliScene('guanyu'); // 关羽:男,与攻击者(张飞,男)同性
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1); // 张飞对大乔(座位1)使用杀
  let gg = G();
  assert.strictEqual(gg.phase, 'liuli', 'phase应挂起流离,实际='+gg.phase);
  assert.strictEqual(gg.pending.to, 1);
  vm.runInContext('mySeat=1;', sandbox);
  R('respondLiuli')({kind:'hand', idx:0}, 2); // 大乔发动流离,转移给座位2(关羽)
  gg = G();
  assert.notStrictEqual(gg.phase, 'cixiongAsk',
    '转移后新目标(关羽,男)与攻击者同性,雌雄双股剑不应触发,实际phase='+gg.phase);
  // 反向确认:如果重判逻辑没生效、还在用原目标(大乔,女)的性别判断,这里就会误触发——
  // 这条断言失败即代表"重判没有真的生效",不是断言写宽松了。
});

check('流离转移:攻击者与转移后新目标异性 → 雌雄双股剑应正确触发(和上一条互为对照,排除巧合)', ()=>{
  const { g } = mkLiuliScene('zhenji'); // 甄姬:女,与攻击者(张飞,男)异性
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  let gg = G();
  assert.strictEqual(gg.phase, 'liuli', 'phase应挂起流离,实际='+gg.phase);
  vm.runInContext('mySeat=1;', sandbox);
  R('respondLiuli')({kind:'hand', idx:0}, 2); // 转移给座位2(甄姬)
  gg = G();
  assert.strictEqual(gg.phase, 'cixiongAsk',
    '转移后新目标(甄姬,女)与攻击者异性,雌雄双股剑应正确触发,实际phase='+gg.phase);
  assert.strictEqual(gg.pending.from, 0);
  assert.strictEqual(gg.pending.to, 2, '触发对象应是转移后的新目标(座位2),不是原目标(座位1)');
});

// ===== 优先级交互 2:铁骑/烈弓判定流程走完后,雌雄双股剑仍正确进入 =====
// 同样用真实调用链(playCard→铁骑/烈弓pending→respondTieqi/respondLiegong→
// afterShaTargetSkills→maybeStartCixiong),验证"完整杀结算流程里两个技能真的按顺序衔接"。
check('铁骑判定后,雌雄双股剑仍正确触发(判定流程走完不会跳过或状态错乱)', ()=>{
  const machao = mkPlayer('马超','machao'); // 男,自带铁骑
  machao.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2};
  machao.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const zhenji = mkPlayer('甄姬','zhenji'); // 女,与马超异性,无流离/铁骑冲突
  zhenji.hand = [{id:3,name:'闪',suit:'♦',rank:2}];
  const g = {
    phase:'play', turn:0, started:true, players:[machao, zhenji],
    deck: [{id:200,name:'杀',suit:'♠',rank:9}, {id:201,name:'杀',suit:'♠',rank:8}], // 判定牌(黑桃,判红黑均可,不影响本测试)
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  let gg = G();
  assert.strictEqual(gg.phase, 'tieqi', '应先挂起铁骑判定询问,实际='+gg.phase);
  assert.strictEqual(gg.pending.from, 0);
  R('respondTieqi')(true); // 马超发动铁骑,真实judge()翻牌
  gg = G();
  assert.strictEqual(gg.phase, 'cixiongAsk',
    '铁骑判定流程走完后,雌雄双股剑应正确触发,实际phase='+gg.phase);
  assert.strictEqual(gg.pending.from, 0);
  assert.strictEqual(gg.pending.to, 1);
});

check('烈弓判定后,雌雄双股剑仍正确触发(同上,验证另一件武器的衔接)', ()=>{
  const huangzhong = mkPlayer('黄忠','huangzhong'); // 男,自带烈弓
  huangzhong.equips.weapon = {id:1,name:'雌雄双股剑',suit:'♠',rank:2}; // 射程2,满足烈弓触发条件之一
  huangzhong.hand = [{id:2,name:'杀',suit:'♥',rank:7}];
  const zhenji = mkPlayer('甄姬','zhenji'); // 女,与黄忠异性
  zhenji.hand = []; // 手牌数0<=攻击距离2,满足烈弓触发条件
  const g = {
    phase:'play', turn:0, started:true, players:[huangzhong, zhenji],
    deck: Array.from({length:5},(_,i)=>({id:300+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, gameMode:'ffa'
  };
  bindG(g);
  vm.runInContext('mySeat=0;', sandbox);
  R('playCard')(0, '杀', 1);
  let gg = G();
  assert.strictEqual(gg.phase, 'liegong', '应先挂起烈弓询问,实际='+gg.phase);
  R('respondLiegong')(true); // 黄忠发动烈弓
  gg = G();
  assert.strictEqual(gg.phase, 'cixiongAsk',
    '烈弓判定流程走完后,雌雄双股剑应正确触发,实际phase='+gg.phase);
  assert.strictEqual(gg.pending.to, 1);
});

console.log('\npassed:', passed, 'failed:', failed);
process.exit(failed?1:0);
