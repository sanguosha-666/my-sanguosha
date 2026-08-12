const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("tx=function(fn){return fn(__g);};mySeat=0;var actualTieCanTarget=CARD_PLAYS['铁索连环'].canTarget;CARD_PLAYS['铁索连环'].canTarget=function(g,me,card,seat){return seat!==1;};");
const eq=()=>R('emptyEquips')();
const mk=(name,general)=>({name,general,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const chain=id=>({id,name:'铁索连环',suit:'♠',rank:12});
function state(){const players=[mk('使用者','caocao'),mk('被canTarget拒绝','chengong'),mk('合法目标','liubei')];players[0].hand=[chain('c1')];return{players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};}

let g=state();sandbox.__g=g;
R('playCard(0,"铁索连环",[1,2])');
assert.strictEqual(g.players[0].hand.length,1,'双目标含非法目标时必须原子拒绝且不消耗牌');
assert.strictEqual(g.tiesuoQueue,undefined,'非法目标不得进入铁索结算队列');

g=state();sandbox.__g=g;
R('playCard(0,"铁索连环",1)');
assert.strictEqual(g.players[0].hand.length,1,'单目标同样执行 canTarget 并拒绝');

g=state();sandbox.__g=g;
R('playCard(0,"铁索连环",[0,2])');
assert.strictEqual(g.players[0].hand.length,0,'两个合法目标正常消耗牌');
assert.strictEqual(g.players[0].chained,true,'第一个合法目标正常结算');
assert.strictEqual(g.players[2].chained,true,'第二个合法目标正常结算');

R("CARD_PLAYS['铁索连环'].canTarget=actualTieCanTarget;");
assert.strictEqual(R("isBlackTactics({name:'铁索连环',suit:'♠'})"),true,'黑色铁索必须属于黑色锦囊');
assert.strictEqual(R("isNormalTacticsCard({name:'铁索连环',suit:'♠'})"),true,'铁索必须属于普通锦囊');

g=state();g.players[1].general='jiaxu';sandbox.__g=g;
R('playCard(0,"铁索连环",1)');
assert.strictEqual(g.players[0].hand.length,1,'帷幕应拒绝黑色铁索且不消耗牌');

g=state();g.zhichiImmunity={seat:1,turn:0};sandbox.__g=g;
R('playCard(0,"铁索连环",1)');
assert.strictEqual(g.players[0].hand.length,1,'智迟应拒绝铁索且不消耗牌');

const source=fs.readFileSync('game.js','utf8');
assert.ok(source.includes('(spec.canTarget && !spec.canTarget(g,me,card,seat))'));
console.log('tiesuo target validation: 12/12 passed');
