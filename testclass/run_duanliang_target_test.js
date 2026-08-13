const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);
run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const black=id=>({id,name:'杀',suit:'♠',rank:7});
const supply=id=>({id,name:'兵粮寸断',suit:'♣',rank:10});
function state(targetCaps){
  const players=[player('徐晃',{duanliang:true}),player('甲'),player('目标',targetCaps),player('乙')];
  players[0].hand=[black('b1')];
  return{players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
}

let g=state({weimu:true});sandbox.__g=g;run('duanLiang(0,2)');
assert.strictEqual(g.players[0].hand.length,1,'黑色断粮不能穿透帷幕');
assert.strictEqual(g.duanliangUsed,undefined,'非法目标不能消耗断粮次数');

g=state();g.players[2].delays=[supply('s0')];sandbox.__g=g;run('duanLiang(0,2)');
assert.strictEqual(g.players[0].hand.length,1,'断粮不能对已有兵粮寸断的判定区重复放置');
assert.strictEqual(g.players[2].delays.length,1,'非法断粮不能改变目标判定区');

g=state();sandbox.__g=g;run('duanLiang(0,2)');
g.pending.publicUntil=0;run('finishWuxiePublicWait()');
assert.strictEqual(g.players[0].hand.length,0,'断粮应允许距离 2 的合法目标');
assert.strictEqual(g.players[2].delays.length,1,'合法断粮应放入目标判定区');
assert.strictEqual(g.players[2].delays[0].name,'兵粮寸断','结算期间应表现为兵粮寸断');
assert.strictEqual(g.players[2].delays[0].originalName,'杀','转化牌应保留原物理牌名');

console.log('duanliang target validation: 8/8 passed');
