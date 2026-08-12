const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,style:{},classList:{add(){},remove(){},toggle(){}}});
const db=()=>({ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}});
const c={firebase:{initializeApp(){return{database:db};},database:db},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
c.window.document=c.document;c.window.firebase=c.firebase;c.global=c;const s=vm.createContext(c);
['config.js','data.js','room-lifecycle.js','game.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),s,{filename:f}));
const R=x=>vm.runInContext(x,s);R('mySeat=0;');const eq=()=>R('emptyEquips')();
const p=(name,active)=>({name,general:'liubei',caps:{tongji:true},hp:active?1:2,maxHp:4,hand:active?[{name:'闪'},{name:'桃'}]:[],equips:eq(),delays:[],alive:true});
const attacker={name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
const card={name:'杀',suit:'♣',rank:7};
function can(players,target){s.__g={players,turn:0,phase:'play'};s.__card=card;return R("CARD_PLAYS['杀'].canTarget(__g,__g.players[0],__card,"+target+")");}

let players=[attacker,p('先扫描但不满足',false),p('后扫描且满足',true)];
assert.strictEqual(can(players,1),false,'后扫描的同疾满足条件时必须拦截其他目标');
assert.strictEqual(can(players,2),true,'可以选择真正形成限制的同疾拥有者');

players=[attacker,p('先扫描且满足',true),p('后扫描但不满足',false)];
assert.strictEqual(can(players,1),true,'换座位后仍可选择满足条件的拥有者');
assert.strictEqual(can(players,2),false,'换座位后其他目标仍被拦截');

players=[attacker,p('同疾甲',true),p('同疾乙',true)];
assert.strictEqual(can(players,1),false,'两个同疾均形成限制时不能绕过乙选择甲');
assert.strictEqual(can(players,2),false,'两个同疾均形成限制时不能绕过甲选择乙');
console.log('multi tongji targeting: 6/6 passed');
