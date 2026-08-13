// #97 回归:顺手牵羊/过河拆桥缺少"目标有牌"校验;奇袭与实体过河拆桥须口径一致。
// 无手牌/无装备/无判定牌的角色不可成为目标;仅手牌/仅装备/仅判定区均合法。
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

// 1. 空目标(无手牌/无装备/无判定牌)被拒
assert.strictEqual(run("CARD_PLAYS['顺手牵羊'].canTarget(__g,__g.players[0],{name:'顺手牵羊',suit:'♠'},1)"),false,'空目标不能成为顺手牵羊目标');
assert.strictEqual(run("CARD_PLAYS['过河拆桥'].canTarget(__g,__g.players[0],{name:'过河拆桥',suit:'♠'},1)"),false,'空目标不能成为过河拆桥目标');

// 2. 仅手牌合法
g.players[1].hand=[card('h1','闪')];
assert.strictEqual(run("CARD_PLAYS['顺手牵羊'].canTarget(__g,__g.players[0],{name:'顺手牵羊',suit:'♠'},1)"),true,'仅手牌应为合法顺手牵羊目标');
assert.strictEqual(run("CARD_PLAYS['过河拆桥'].canTarget(__g,__g.players[0],{name:'过河拆桥',suit:'♠'},1)"),true,'仅手牌应为合法过河拆桥目标');

// 3. 仅装备合法
g.players[1].hand=[];g.players[1].equips.weapon=card('w1','青龙偃月刀');
assert.strictEqual(run("CARD_PLAYS['顺手牵羊'].canTarget(__g,__g.players[0],{name:'顺手牵羊',suit:'♠'},1)"),true,'仅装备应为合法顺手牵羊目标');
assert.strictEqual(run("CARD_PLAYS['过河拆桥'].canTarget(__g,__g.players[0],{name:'过河拆桥',suit:'♠'},1)"),true,'仅装备应为合法过河拆桥目标');

// 4. 仅判定区合法
g.players[1].equips.weapon=null;g.players[1].delays=[card('d1','乐不思蜀')];
assert.strictEqual(run("CARD_PLAYS['顺手牵羊'].canTarget(__g,__g.players[0],{name:'顺手牵羊',suit:'♠'},1)"),true,'仅判定区应为合法顺手牵羊目标');
assert.strictEqual(run("CARD_PLAYS['过河拆桥'].canTarget(__g,__g.players[0],{name:'过河拆桥',suit:'♠'},1)"),true,'仅判定区应为合法过河拆桥目标');

// 5. 奇袭与实体过河拆桥口径一致
// 5a. 目标无牌:奇袭不得消耗手牌、不得进入结算
g=state();
g.players[0]={name:'甘宁',general:'ganning',hp:4,maxHp:4,hand:[card('b1','杀')],equips:eq(),delays:[],alive:true};
sandbox.__g=g;run('qiXi(0,1)');
assert.strictEqual(g.players[0].hand.length,1,'目标无牌时奇袭不得消耗手牌');
assert.strictEqual(g.pending,null,'目标无牌时奇袭不得进入结算');

// 5b. 目标仅判定区有牌:奇袭可正常消耗并进入无懈窗口
g.players[1].delays=[card('d1','乐不思蜀')];sandbox.__g=g;run('qiXi(0,1)');
assert.strictEqual(g.players[0].hand.length,0,'目标仅判定区有牌时奇袭应消耗手牌');
assert.strictEqual(['wuxie','wuxiePublicWait'].includes(g.pending&&g.pending.type),true,'奇袭应进入无懈窗口');

// 5c. 目标仅装备有牌:奇袭同样合法(与实体过河拆桥一致)
g=state();
g.players[0]={name:'甘宁',general:'ganning',hp:4,maxHp:4,hand:[card('b2','杀')],equips:eq(),delays:[],alive:true};
g.players[1].equips.armor=card('w2','八卦阵');sandbox.__g=g;run('qiXi(0,1)');
assert.strictEqual(g.players[0].hand.length,0,'目标仅装备有牌时奇袭应消耗手牌');

console.log('shunshou/guohai target validation: 16/16 passed');
