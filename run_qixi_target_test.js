const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const black=(id,name='杀')=>({id,name,suit:'♠',rank:7});
function state(targetCaps){const players=[player('甘宁',{qixi:true}),player('目标',targetCaps),player('旁观者')];players[0].hand=[black('b1')];players[1].hand=[{id:'t1',name:'闪',suit:'♥',rank:2}];return{players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};}

let g=state({weimu:true});sandbox.__g=g;run('qiXi(0,1)');
assert.strictEqual(g.players[0].hand.length,1,'奇袭不能穿透帷幕');
assert.strictEqual(g.pending,null,'帷幕保护目标不能开启奇袭锦囊结算');

g=state();g.zhichiImmunity={seat:1,turn:0};sandbox.__g=g;run('qiXi(0,1)');
assert.strictEqual(g.players[0].hand.length,1,'奇袭不能穿透智迟');
assert.strictEqual(g.pending,null,'智迟保护目标不能开启奇袭锦囊结算');

g=state();sandbox.__g=g;run('qiXi(0,1)');
g.pending.publicUntil=0;run('finishWuxiePublicWait()');
assert.strictEqual(g.players[0].hand.length,0,'奇袭对合法目标应正常消耗黑色牌');
assert.ok(g.discard.some(card=>card.id==='b1'),'奇袭使用的物理牌应进入弃牌堆');
assert.strictEqual(g.players[1].hand.length,0,'奇袭对合法目标应正常结算过河拆桥效果');

g=state({weimu:true});g.players[0].hand=[black('g1','过河拆桥')];sandbox.__g=g;run("playCard(0,'过河拆桥',1)");
assert.strictEqual(g.players[0].hand.length,1,'真实黑色过河拆桥同样不能穿透帷幕');

console.log('qixi target validation: 8/8 passed');
