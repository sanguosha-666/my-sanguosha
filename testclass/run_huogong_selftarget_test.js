// #99 回归:火攻自选目标支持。
// 自己持有火攻且另有至少一张手牌时可对自己使用;自己只有火攻一张手牌时不可对自己使用;
// 对有手牌角色正常、对无手牌角色拒绝;智迟/帷幕不回归。
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const card=(id,name,suit)=>({id,name,suit:suit||'♠',rank:7});
const player=(name,general)=>({name,general:general||'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const state=()=>{const players=[player('甲'),player('乙')];return{players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};};
let g=state();sandbox.__g=g;
const inWuxie=()=>['wuxie','wuxiePublicWait'].includes(g.pending&&g.pending.type);

// 1. 自己持有火攻且另有至少一张手牌 → 可对自己使用
g.players[0].hand=[card('h1','火攻'),card('h2','闪','♥')];
run("playCard(0,'火攻',0)");
assert.strictEqual(g.players[0].hand.length,1,'自己另有手牌时对己用火攻应消耗火攻');
assert.strictEqual(g.players[0].hand[0].name,'闪','自己另有手牌时对己用火攻应保留其余手牌');
assert.strictEqual(inWuxie(),true,'对己用火攻应进入无懈窗口');

// 2. 自己只有火攻一张手牌 → 不可对自己使用
g=state();g.players[0].hand=[card('h1','火攻')];sandbox.__g=g;
run("playCard(0,'火攻',0)");
assert.strictEqual(g.players[0].hand.length,1,'只有火攻一张手牌时对己用火攻应被拒绝');
assert.strictEqual(g.pending,null,'只有火攻一张手牌时对己用火攻不得进入结算');

// 3. 对有手牌角色正常
g=state();g.players[0].hand=[card('h1','火攻')];g.players[1].hand=[card('h2','闪','♥')];sandbox.__g=g;
run("playCard(0,'火攻',1)");
assert.strictEqual(g.players[0].hand.length,0,'对有手牌角色用火攻应消耗火攻');
assert.strictEqual(inWuxie(),true,'对有手牌角色用火攻应进入无懈窗口');

// 4. 对无手牌角色拒绝
g=state();g.players[0].hand=[card('h1','火攻')];sandbox.__g=g;
run("playCard(0,'火攻',1)");
assert.strictEqual(g.players[0].hand.length,1,'对无手牌角色用火攻应被拒绝');
assert.strictEqual(g.pending,null,'对无手牌角色用火攻不得进入结算');

// 5. 智迟不回归
g=state();g.zhichiImmunity={seat:1,turn:0};g.players[0].hand=[card('h1','火攻')];g.players[1].hand=[card('h2','闪','♥')];sandbox.__g=g;
assert.strictEqual(run("CARD_PLAYS['火攻'].canTarget(__g,__g.players[0],{name:'火攻',suit:'♠'},1)"),false,'智迟保护目标不能成为火攻目标');

// 6. 帷幕不回归(黑色火攻)
g=state();g.players[0].hand=[card('h1','火攻','♠')];g.players[1]={name:'贾诩',general:'jiaxu',hp:3,maxHp:3,hand:[card('h2','闪','♥')],equips:eq(),delays:[],alive:true};sandbox.__g=g;
assert.strictEqual(run("CARD_PLAYS['火攻'].canTarget(__g,__g.players[0],{name:'火攻',suit:'♠'},1)"),false,'帷幕保护目标不能成为黑色火攻目标');

// 7. 红色火攻对帷幕目标合法(帷幕只挡黑色锦囊)
g.players[1].hand=[card('h2','闪','♥')];sandbox.__g=g;
assert.strictEqual(run("CARD_PLAYS['火攻'].canTarget(__g,__g.players[0],{name:'火攻',suit:'♥'},1)"),true,'红色火攻对帷幕目标应合法');

console.log('huogong self-target validation: 12/12 passed');
