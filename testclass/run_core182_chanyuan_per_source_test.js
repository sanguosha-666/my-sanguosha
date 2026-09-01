// CORE-182(issue #244):【缠怨】曾是玩家身上的单一全局布尔 p.chanyuan,与"是哪个于吉
// 来源授予的"无关。场上同时存在两个蛊惑来源时(真实于吉 + 左慈化身于吉),某玩家对其中
// 一个来源获得缠怨后,会对另一个来源也一并免疫、永远不再被询问。
// 本测试锁定:缠怨按蛊惑来源(sourceSeat)分别记录,两个来源互不影响;单来源场景行为不变。
const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);};');
const setSeat=s=>R('mySeat='+s+';');
const eq=()=>R('emptyEquips')();
const card=(id,name='杀')=>({id,name,suit:'♠',rank:7});
const mkP=(name,general,hand)=>({name,general,hp:4,maxHp:4,hand,equips:eq(),delays:[],alive:true,chanyuan:false,chanyuanSources:[]});
// 座位0=真实于吉,座位1=丙(质疑者),座位2=左慈(化身于吉)
const mkG=()=>({
  players:[
    mkP('于吉甲','yuji',[card('a1','杀'),card('a2','杀')]),
    mkP('丙','liubei',[card('b1','杀')]),
    Object.assign(mkP('左慈乙','zuoci',[card('c1','杀'),card('c2','杀')]),
      {huashenPool:['yuji'],huashenGeneral:'yuji',huashenSkillName:'蛊惑'})
  ],
  deck:[card('d1'),card('d2'),card('d3')],discard:[],log:[],
  phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,guhuoUsed:false
});

let g=mkG();
sandbox.__g=g;
// 前置:确认左慈化身于吉后确实拥有【蛊惑】——否则本测试的"两个来源"前提不成立(断言会永远绿)
assert.ok(R('hasCap')(g.players[2],'guhuo'),'左慈化身于吉应拥有蛊惑能力(两来源前提)');
assert.ok(R('hasCap')(g.players[0],'guhuo'),'真实于吉应拥有蛊惑能力');

// ---- T1: 丙质疑真实于吉(座位0)的蛊惑且为真 → 只获得对座位0的缠怨 ----
setSeat(0);
R("startGuhuo(0,'杀')");   // 扣置的实体牌就是【杀】,声明【杀】=> 质疑必为真
assert.strictEqual(g.phase,'guhuoQuestion','应进入质疑询问');
assert.strictEqual(g.pending.sourceSeat,0);
// 逐个把非质疑者答掉,直到问到丙(不预设座位顺序)
while(g.phase==='guhuoQuestion' && g.pending.asking!==1){
  setSeat(g.pending.asking);
  R('respondGuhuoQuestion(false)');
}
assert.strictEqual(g.pending && g.pending.asking,1,'丙应被问到');
setSeat(1);
R('respondGuhuoQuestion(true)');
assert.deepStrictEqual(g.players[1].chanyuanSources,[0],'缠怨应只记在来源座位0上');
assert.strictEqual(g.players[1].chanyuan,true,'旧的全局布尔语义保留(角标/体力≤1锁技能)');

// ---- T2: 左慈(座位2)随后发动蛊惑 → 丙仍必须被询问(修复前会被整个跳过) ----
g.phase='play'; g.turn=2; g.pending=null; g.guhuoUsed=false;
sandbox.__g=g;
setSeat(2);
R("startGuhuo(0,'杀')");
assert.strictEqual(g.phase,'guhuoQuestion','左慈的蛊惑应正常开启询问');
assert.strictEqual(g.pending.sourceSeat,2);
let askedC=false;
while(g.phase==='guhuoQuestion'){
  const asking=g.pending.asking;
  if(asking===1){ askedC=true; break; }
  setSeat(asking);
  R('respondGuhuoQuestion(false)');
}
assert.ok(askedC,'对座位0有缠怨的丙,仍必须被座位2的蛊惑询问(CORE-182核心)');

// ---- T3: 丙也质疑左慈且为真 → 两个来源各自记录,互不覆盖 ----
setSeat(1);
R('respondGuhuoQuestion(true)');
assert.deepStrictEqual(g.players[1].chanyuanSources.slice().sort(),[0,2],'两个来源应分别记录');

// ---- T4: 此后座位0再发动蛊惑,丙已对座位0有缠怨 → 照常跳过(原有语义不回归) ----
g.phase='play'; g.turn=0; g.pending=null; g.guhuoUsed=false;
sandbox.__g=g;
setSeat(0);
R("startGuhuo(0,'杀')");
let askedCAgain=false;
while(g.phase==='guhuoQuestion'){
  if(g.pending.asking===1){ askedCAgain=true; break; }
  setSeat(g.pending.asking);
  R('respondGuhuoQuestion(false)');
}
assert.strictEqual(askedCAgain,false,'对该来源已有缠怨的玩家必须继续被跳过');

// ---- T5: respondGuhuoQuestion 的服务端守卫也按来源判断 ----
g=mkG(); sandbox.__g=g;
g.players[1].chanyuanSources=[0]; g.players[1].chanyuan=true;   // 只对座位0有缠怨
g.phase='guhuoQuestion';
g.pending={type:'guhuoQuestion',sourceSeat:2,actualCard:card('x1','杀'),claimedCard:card('x1','杀'),questioners:[],answered:[],asking:1};
setSeat(1);
R('respondGuhuoQuestion(true)');
assert.ok((g.players[1].chanyuanSources||[]).includes(2),'守卫不得因其它来源的缠怨拒绝本次质疑');

// ---- T6: normalize 对 chanyuanSources 补默认值(Firebase 吞空数组) ----
g=mkG(); delete g.players[1].chanyuanSources; sandbox.__g=g;
R('normalize(__g)');
assert.ok(Array.isArray(g.players[1].chanyuanSources),'normalize 应补回 chanyuanSources 数组');

console.log('CORE-182 缠怨按蛊惑来源分离 tests: 6/6 passed');
