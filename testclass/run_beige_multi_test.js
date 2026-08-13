const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
function state(){const players=[player('悲歌甲',{beige:true}),player('悲歌乙',{beige:true}),player('受伤者'),player('伤害来源')];players[0].hand=[{id:'c0',name:'杀',suit:'♠',rank:2}];players[1].hand=[{id:'c1',name:'闪',suit:'♣',rank:3}];return{players,deck:[],discard:[],log:[],phase:'respond',turn:3,roundNum:1,gameMode:'ffa',pending:null};}

let g=state();sandbox.__g=g;run("dealDamage(__g,2,1,3,'杀伤害','sha',{id:'s1',name:'杀',suit:'♠',rank:7})");
assert.strictEqual(g.pending.sourceSeat,0,'第一名悲歌拥有者应先收到询问');
run('triggerBeige(false)');
assert.strictEqual(g.pending.sourceSeat,1,'第一人放弃后第二名悲歌拥有者仍应收到询问');
run('mySeat=1;triggerBeige(false)');
assert.strictEqual(g.pending,null,'全部悲歌拥有者回答后应清空 pending');
assert.strictEqual(g.afterDamageEffects,null,'全部悲歌结束后应完成受伤后效果队列');

g=state();g.deck=[{id:'judge-heart',name:'桃',suit:'♥',rank:5}];sandbox.__g=g;run('mySeat=0');
run("dealDamage(__g,2,1,3,'杀伤害','sha',{id:'s2',name:'杀',suit:'♠',rank:7})");
run('triggerBeige(true)');
assert.strictEqual(g.pending.type,'beigeDiscard','第一名发动后应进入弃牌阶段');
run('beigeDiscard(0,false)');
run('doBeigeJudge()');
assert.strictEqual(g.players[2].hp,4,'第一名悲歌红桃判定应令受伤者回复1点');
assert.strictEqual(g.pending.sourceSeat,1,'第一名发动并结算后仍应询问第二名');
run('mySeat=1;triggerBeige(false)');
assert.strictEqual(g.pending,null,'第二名放弃后整条悲歌链应结束');

console.log('multi beige validation: 9/9 passed');
