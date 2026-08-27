// 闪电 onlySelf：点击即对自己使用，不进选目标。服务端仍只接受自己。
const fs=require('fs');
const assert=require('assert');
const vm=require('vm');
const path=require('path');
const ROOT=path.join(__dirname,'..');

const hand=fs.readFileSync(path.join(ROOT,'render-hand.js'),'utf8');
assert.ok(/DELAY_TRICKS\[card\.name\]\.onlySelf/.test(hand)
  || /onlySelfDelay/.test(hand)
  || /onlySelf/.test(hand) && /playCard\(idx,\s*actionId,\s*mySeat\)/.test(hand),
  'render-hand 应对 onlySelf 延时锦囊走 playCard(idx, actionId, mySeat)，不进 selectedCardIdx');
assert.ok(/playCard\(idx,\s*actionId,\s*mySeat\)/.test(hand),
  '闪电点击应直接 playCard(..., mySeat)');

const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);
run('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>run('emptyEquips')();
const card=(id,name)=>({id,name,suit:'♠',rank:1});
const g={
  players:[
    {name:'甲',general:'caocao',hp:4,maxHp:4,hand:[card('s1','闪电')],equips:eq(),delays:[],alive:true},
    {name:'乙',general:'liubei',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true}
  ],
  deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null
};
sandbox.__g=g;
assert.strictEqual(run("CARD_PLAYS['闪电'].canTarget(__g,__g.players[0],{name:'闪电'},0)"),true,'闪电可以对自己');
assert.strictEqual(run("CARD_PLAYS['闪电'].canTarget(__g,__g.players[0],{name:'闪电'},1)"),false,'闪电不能对别人');
run("playCard(0,'闪电',0)");
assert.ok(['wuxie','wuxiePublicWait'].includes(g.pending&&g.pending.type),'对自己出闪电应进无懈');
assert.strictEqual(g.pending.to,0,'闪电目标必须是自己');

const g2=JSON.parse(JSON.stringify(g));
g2.pending=null; g2.phase='play'; g2.players[0].hand=[card('s2','闪电')]; g2.players[0].delays=[]; sandbox.__g=g2;
run("playCard(0,'闪电',1)");
assert.strictEqual(g2.players[0].hand.length,1,'对别人出闪电应被拒绝');
assert.strictEqual(g2.pending,null,'对别人出闪电不得进结算');

console.log('shandian skip target: passed');
