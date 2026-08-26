/**
 * CORE-175(issue #234)回归锁定:典韦【强袭】的候选生成原本只按攻击距离筛选,不走
 * CARD_PLAYS['杀'].canTarget,于是诸葛亮【空城】/袁术【同疾】/陈宫【智迟】保护下的角色
 * 仍会出现在候选里并可被选中(pickQiangxiTarget 只校验 candidates.includes,不再兜底)。
 * 修复后候选统一由 qiangxiCandidateSeats 生成(距离 + canTarget),落地前再兜底一次。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};tx=function(fn,cb){var r=fn(__g);__g=r||__g;if(cb)cb(__g);return r;};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(name,general)=>({name,general,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});

// seat0=典韦,seat1=待保护目标,seat2=普通目标(2人环上距离都是1,均在默认射程内)
function state(){
  const g={players:[mk('典韦','dianwei'),mk('乙','liubei'),mk('丙','liubei')],
    deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',
    pending:null,exchangeCards:[],qiangxiUsed:false};
  g.players[1].hand=[{id:'a1',name:'闪',suit:'♦',rank:2}];
  g.players[2].hand=[{id:'a2',name:'闪',suit:'♦',rank:3}];
  sandbox.__g=g;
  return g;
}
function startCostHp(){ R("mySeat=0;startQiangxi();chooseQiangxiCost('hp')"); }

// 1) 正常情况:两个目标都在候选里,强袭正常造成1点伤害
let g=state(); startCostHp();
assert.strictEqual(JSON.stringify(sandbox.__g.pending.candidates),JSON.stringify([1,2]),'正常局面两名对手都应在候选中');
R("pickQiangxiTarget(2)");
assert.strictEqual(sandbox.__g.players[2].hp,3,'合法目标应受到1点强袭伤害');
assert.strictEqual(sandbox.__g.players[0].hp,3,'典韦失去1点体力');

// 2) 空城(诸葛亮无手牌)目标不得进入候选
g=state(); g.players[1].general='zhuge'; g.players[1].hand=[];
startCostHp();
assert.strictEqual(JSON.stringify(sandbox.__g.pending.candidates),JSON.stringify([2]),'空城目标必须被排除出候选');

// 3) 智迟免疫目标不得进入候选
g=state(); g.zhichiImmunity={seat:1,turn:0};
startCostHp();
assert.strictEqual(JSON.stringify(sandbox.__g.pending.candidates),JSON.stringify([2]),'智迟目标必须被排除出候选');

// 4) 同疾(袁术手牌>体力且典韦在其攻击范围内):只能选袁术
g=state(); g.players[1].general='yuanshu'; g.players[1].hp=1;
g.players[1].hand=[{id:'b1',name:'闪',suit:'♦',rank:4},{id:'b2',name:'闪',suit:'♦',rank:5}];
startCostHp();
assert.strictEqual(JSON.stringify(sandbox.__g.pending.candidates),JSON.stringify([1]),'同疾生效时只有袁术能成为目标');

// 5) 绕过候选强行提交也必须被拒绝(candidates.includes 兜底)
g=state(); g.players[1].general='zhuge'; g.players[1].hand=[];
startCostHp();
R("pickQiangxiTarget(1)");
assert.strictEqual(sandbox.__g.players[1].hp,4,'非候选目标强行提交必须被拒绝');
assert.strictEqual(sandbox.__g.phase,'qiangxiPickTarget','拒绝后仍停留在选目标阶段');

// 6) 候选算好之后局势变化(目标手牌被拿空触发空城),落地前的二次 canTarget 必须拦住
g=state(); g.players[1].general='zhuge';
startCostHp();
assert.ok(sandbox.__g.pending.candidates.includes(1),'发动时诸葛亮有手牌,应在候选中');
sandbox.__g.players[1].hand=[];
R("pickQiangxiTarget(1)");
assert.strictEqual(sandbox.__g.players[1].hp,4,'候选快照过期时必须由二次校验拦住');

// 7) 全场无合法目标时不进入选目标阶段
g=state(); g.players[1].general='zhuge'; g.players[1].hand=[];
g.players[2].general='zhuge'; g.players[2].hand=[];
startCostHp();
assert.strictEqual(sandbox.__g.phase,'play','无合法目标时回到出牌阶段');
assert.strictEqual(sandbox.__g.pending,null,'无合法目标时不留下 pending');

console.log('CORE-175 qiangxi canTarget: all passed');
