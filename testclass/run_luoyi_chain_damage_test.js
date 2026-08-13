const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const players=[player('许褚',{luoyi:true}),player('连环甲'),player('连环乙')];
players[1].chained=true;players[2].chained=true;
const fireSha={id:'fire-1',name:'火杀',suit:'♥',rank:4};
const g={players,deck:[],discard:[],log:[],phase:'respond',turn:0,roundNum:1,gameMode:'ffa',pending:null,luoyiActive:true};
sandbox.__g=g;
sandbox.__fireSha=fireSha;

const amount=run("damageAmount(__g,0,1,'sha')");
assert.strictEqual(amount,2,'裸衣火杀的原始伤害应为2点');
run("dealDamage(__g,1,damageAmount(__g,0,1,'sha'),0,'裸衣火杀','sha',__fireSha)");

assert.strictEqual(g.players[1].hp,2,'首名连环角色应受到2点属性伤害');
assert.strictEqual(g.players[2].hp,2,'第二名连环角色应传导同量2点属性伤害');
assert.strictEqual(g.players[1].chained,false,'首名角色受伤后应解除连环');
assert.strictEqual(g.players[2].chained,false,'传导目标也应解除连环');
assert.strictEqual(g.chainDamageQueue,null,'全部传导结束后队列应清空');

console.log('luoyi chained damage validation: 6/6 passed');
