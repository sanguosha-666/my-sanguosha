const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=name=>({name,general:'liubei',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const sha=id=>({id,name:'杀',suit:'♠',rank:7});
function state(shaUsed,extra){const players=[player('攻击者'),player('目标')];players[0].hand=[sha('follow')];return{players,deck:[],discard:[],log:[],phase:'qinglong',turn:0,roundNum:1,gameMode:'ffa',pending:{type:'qinglong',from:0,to:1},shaUsed,jiangchiExtraShaLeft:extra};}

let g=state(false,0);sandbox.__g=g;run('respondQinglong(true,0)');
assert.strictEqual(g.shaUsed,false,'青龙追杀不应占用尚未使用的普通杀额度');
assert.strictEqual(g.players[0].hand.length,0,'合法青龙追杀应正常使用一张杀');

g=state(true,1);sandbox.__g=g;run('respondQinglong(true,0)');
assert.strictEqual(g.shaUsed,true,'青龙追杀不应改变已使用普通杀的标记');
assert.strictEqual(g.jiangchiExtraShaLeft,1,'青龙追杀不应消耗将驰额外杀次数');

g=state(false,1);g.phase='play';g.pending=null;sandbox.__g=g;run("playCard(0,'杀',1)");
assert.strictEqual(g.shaUsed,true,'普通出牌阶段使用杀仍应占用正常额度');
assert.strictEqual(g.jiangchiExtraShaLeft,1,'首次普通杀不应提前消耗将驰额外次数');

console.log('qinglong quota validation: 6/6 passed');
