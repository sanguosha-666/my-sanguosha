const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const player=(name,caps)=>({name,general:'liubei',caps:caps||{},hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const jiedao=()=>({id:'j1',name:'借刀杀人',suit:'♣',rank:12});
function state(targetCaps){const players=[player('使用者'),player('持刀者',targetCaps),player('被杀者')];players[0].hand=[jiedao()];players[1].equips.weapon={id:'w1',name:'青龙偃月刀',suit:'♠',rank:5};return{players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};}

let g=state({weimu:true});sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(g.players[0].hand.length,1,'借刀杀人专用路径不能穿透帷幕');
assert.strictEqual(g.pending,null,'帷幕保护目标不能进入借刀结算');

g=state();g.zhichiImmunity={seat:1,turn:0};sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(g.players[0].hand.length,1,'借刀杀人专用路径不能穿透智迟');
assert.strictEqual(g.pending,null,'智迟保护目标不能进入借刀结算');

g=state();sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
g.pending.publicUntil=0;run('finishWuxiePublicWait()');
assert.strictEqual(g.players[0].hand.length,0,'合法借刀目标应正常消耗锦囊');
assert.strictEqual(g.pending&&g.pending.type,'jiedaoChoice','合法 A/B 目标应进入借刀选择阶段');
assert.strictEqual(g.pending.seatA,1,'借刀第一目标应保持为持武器角色');
assert.strictEqual(g.pending.seatB,2,'借刀第二目标应保持为被杀角色');

g=state();g.players[2].caps={kongcheng:true};sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(g.players[0].hand.length,1,'复用统一校验后仍须保留 B 的空城限制');

console.log('jiedao target validation: 9/9 passed');
