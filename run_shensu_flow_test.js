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
const equip={name:'八卦阵',suit:'♣',rank:2,id:'armor'};
function game(){return {players:[
  {name:'夏侯渊',general:'xiahouyuan',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true},
  {name:'远处目标',general:'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true}
],deck:[],discard:[],log:[],phase:'shensuChoose1',turn:0,roundNum:1,gameMode:'ffa',pending:{type:'shensuChoose1',seat:0},shensuUsed1:false,shensuUsed2:false,shensuShaRemaining:0};}

let g=game(); sandbox.__g=g;
R('triggerShensu1()');
assert.strictEqual(g.phase,'shensuSha'); assert.strictEqual(g.pending.noDistance,true);
assert.strictEqual(typeof g.pending.askedAt,'number','神速选目标应自带30秒超时戳');
assert.strictEqual(g.shensuSkipJudgingAndDraw,true);
g.shensuResume={seat:0,remaining:0,fromShensu:'shensu1'}; R('finishShensuSha(__g)');
assert.strictEqual(g.phase,'play'); assert.strictEqual(g.shensuSkipJudgingAndDraw,false);

g=game(); g.phase='shensuChoose2'; g.pending={type:'shensuChoose2',seat:0}; g.players[0].equips.armor=equip; sandbox.__g=g;
R('triggerShensu2()');
assert.strictEqual(g.players[0].equips.armor,null); assert.strictEqual(g.discard[0].id,'armor');
assert.strictEqual(g.pending.noDistance,true); assert.strictEqual(g.shensuSkipPlay,true);
g.shensuResume={seat:0,remaining:0,fromShensu:'shensu2'}; R('finishShensuSha(__g)');
assert.strictEqual(g.phase,'discard');

g=game(); sandbox.__g=g; R('triggerShensu1()');
g.players[0].equips.armor=equip; g.phase='shensuChoose2'; g.pending={type:'shensuChoose2',seat:0}; R('triggerShensu2()');
assert.strictEqual(g.pending.remaining,2); assert.strictEqual(g.pending.fromShensu,'shensu1+2');
g.shensuResume={seat:0,remaining:0,fromShensu:'shensu1+2'}; R('finishShensuSha(__g)');
assert.strictEqual(g.phase,'discard'); assert.strictEqual(g.shensuSkipJudgingAndDraw,false); assert.strictEqual(g.shensuSkipPlay,false);

const source=fs.readFileSync('skills.js','utf8');
assert(source.includes('noDistance: true')); assert(source.includes('skipShaLimit: true'));

// 神速只无视距离，不能绕过【杀】的其它目标合法性。
g=game(); g.players[1].general='zhuge'; g.players[1].hand=[];
g.phase='shensuSha'; g.pending={type:'shensuSha',seat:0,remaining:1,noDistance:true,fromShensu:'shensu1'};
sandbox.__g=g; R('respondShensuSha(1)');
assert.strictEqual(g.phase,'shensuSha','空城目标必须被服务端拒绝');
assert.strictEqual(g.pending.type,'shensuSha','拒绝非法目标后应保留原选择阶段');

g=game();
g.players.push({name:'同疾拥有者',general:'yuanshu',hp:1,maxHp:4,hand:[{id:'h1',name:'闪',suit:'♣',rank:3},{id:'h2',name:'桃',suit:'♥',rank:4}],equips:eq(),delays:[],alive:true});
g.phase='shensuSha'; g.pending={type:'shensuSha',seat:0,remaining:1,noDistance:true,fromShensu:'shensu1'};
sandbox.__g=g; R('respondShensuSha(1)');
assert.strictEqual(g.phase,'shensuSha','同疾生效时不能绕过袁术指定其它目标');
assert.strictEqual(g.pending.type,'shensuSha');

console.log('shensu flow tests: 23/23 passed');
