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
['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>R('emptyEquips')();
const card=(name,suit,rank,id)=>({name,suit,rank,id});

function game(targetGeneral,targetHp){
  return {players:[
    {name:'小乔',general:'xiaoqiao',hp:3,maxHp:3,hand:[card('闪','♥',2,'heart')],equips:eq(),delays:[],alive:true},
    {name:'目标',general:targetGeneral,hp:targetHp,maxHp:4,hand:[],equips:eq(),delays:[],alive:true},
    {name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true}
  ],deck:[card('杀','♣',3,'d1'),card('闪','♦',4,'d2'),card('桃','♥',5,'d3'),card('杀','♠',6,'d4')],discard:[],log:[],phase:'play',turn:2,roundNum:1,gameMode:'ffa',pending:null};
}

let g=game('caocao',4); sandbox.__g=g;
assert.strictEqual(R(`dealDamage(__g,0,2,2,'酒杀','sha',${JSON.stringify(card('杀','♠',9,'wineSha'))})`),true);
assert.strictEqual(g.pending.amount,2,'天香 pending 必须保存酒杀的完整2点伤害');
R('respondTianxiang({idx:0},1)');
assert.strictEqual(g.players[0].hp,3,'小乔不受转移伤害');
assert.strictEqual(g.players[1].hp,2,'目标承受完整2点伤害');
assert.strictEqual(g.players[1].hand.length,2,'目标按已损失2点体力摸2张');

g=game('caochong',3); sandbox.__g=g;
R(`dealDamage(__g,0,1,2,'普通杀','sha',${JSON.stringify(card('杀','♣',7,'sha'))})`);
R('respondTianxiang({idx:0},1)');
assert.strictEqual(g.pending.type,'chengxiangAsk','目标受伤后技能先正常结算');
R('mySeat=1; cancelChengxiangAsk()');
assert.strictEqual(g.players[1].hand.length,2,'受伤后技能结束仍须完成天香摸牌');
assert.strictEqual(g.pending,null);

console.log('tianxiang transfer tests: 9/9 passed');
