const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>R('emptyEquips')();
const card=(id,name='杀')=>({id,name,suit:'♠',rank:7});
const luxun=R("getGeneral('luxun')");
assert(luxun,'应登记陆逊武将');
assert.strictEqual(luxun.name,'陆逊');
assert.strictEqual(luxun.faction,'wu');
assert.strictEqual(luxun.maxHp,3);
assert.strictEqual(luxun.skill,'谦逊/连营');
assert.strictEqual(luxun.caps.qianxun,true);
assert.strictEqual(luxun.caps.lianying,true);
const skillEntries=R('HUASHEN_SKILL_TABLE.luxun');
assert.deepStrictEqual(Array.from(skillEntries,e=>e.name),['谦逊','连营']);

const players=[
  {name:'陆逊',general:'luxun',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true},
  {name:'对手',general:'caocao',hp:4,maxHp:4,hand:[card('c1')],equips:eq(),delays:[],alive:true}
];
let g={players,deck:[card('draw','闪')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,lianyingQueue:[]};
sandbox.__g=g;
assert.strictEqual(R("CARD_PLAYS['顺手牵羊'].canTarget(__g,__g.players[1],{name:'顺手牵羊'},0)"),false,'谦逊应阻止顺手牵羊');
assert.strictEqual(R("CARD_PLAYS['乐不思蜀'].canTarget(__g,__g.players[1],{name:'乐不思蜀'},0)"),false,'谦逊应阻止乐不思蜀');

g.players[0].hand=[]; // 调用点语义：最后一张牌已经移走，cardsLost 说明本次失去1张
assert.strictEqual(R('maybeStartLianying(__g,0,1)'),true,'失去最后一张手牌应排入连营');
assert.strictEqual(R('tryFlushLianying(__g)'),true,'空闲时应开启连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk');
assert.strictEqual(typeof g.pending.askedAt,'number','连营询问应具备30秒超时');
R('respondLianying(true)');
assert.strictEqual(g.players[0].hand.length,1,'发动连营应摸1张');
assert.strictEqual(g.pending,null);

console.log('luxun tests: 14/14 passed');
