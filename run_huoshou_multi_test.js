const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const players=[player('使用者'),player('祸首甲',{huoshou:true}),player('目标'),player('祸首乙',{huoshou:true})];
const g={players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};sandbox.__g=g;

assert.strictEqual(run('nanmanHuoshouSource(__g,0)'),3,'从当前回合角色开始行动时，最后执行的祸首应成为来源');
g.turn=2;
assert.strictEqual(run('nanmanHuoshouSource(__g,0)'),1,'当前回合位置变化时应严格按行动顺序重新确定，而非数组首项');
g.turn=0;
run("aoeEffect(__g,__g.players[0],{id:'n1',name:'南蛮入侵',suit:'♠',rank:7})");
assert.strictEqual(g.aoe.huoshouSourceSeat,3,'南蛮指定目标时应固定多祸首最终来源');
g.players[3].alive=false;
assert.strictEqual(g.aoe.huoshouSourceSeat,3,'来源死亡后不应改选另一名祸首');

run("__captured='unset';dealDamage=function(g,to,amount,sourceSeat){__captured=sourceSeat;return false;};mySeat=2;__g.phase='aoeResp';__g.pending={type:'aoeResp',from:0,to:2,need:'杀'};aoeRespond(false)");
assert.strictEqual(sandbox.__captured,null,'已固定的祸首死亡后，后续南蛮伤害应为无来源');

console.log('multi huoshou validation: 5/5 passed');
