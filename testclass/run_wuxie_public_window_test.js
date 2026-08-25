const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js', 'skills/late-generals.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>R('emptyEquips')();
const card=id=>({name:'杀',suit:'♣',rank:2,id});
const g={players:[
  {name:'甲',general:'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true},
  {name:'乙',general:'liubei',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true}
],deck:[card('d1'),card('d2')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.phase,'wuxie');
assert.strictEqual(g.pending.type,'wuxiePublicWait','无人有无懈也必须进入公共窗口');
assert(g.pending.publicUntil-g.pending.askedAt>=3000);
assert.strictEqual(g.players[0].hand.length,0,'公共窗口结束前锦囊不得立即结算');
assert.strictEqual(R('maybeAutoRespondTimeout(__g)'),false,'未满3秒不得自动结束');
g.pending.askedAt=Date.now()-3100; g.pending.publicUntil=Date.now()-1;
assert.strictEqual(R('maybeAutoRespondTimeout(__g)'),true);
assert.strictEqual(g.players[0].hand.length,2,'窗口结束后正常结算锦囊');
assert.strictEqual(g.pending,null);

const g2={...g,players:g.players.map(p=>({...p,hand:[]})),deck:[card('e1'),card('e2')],phase:'play',pending:null};
g2.players[1].hand=[{name:'无懈可击',suit:'♠',rank:3,id:'w1'}]; sandbox.__g=g2;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g2.pending.type,'wuxie'); assert.strictEqual(g2.pending.asking,1);

console.log('wuxie public window tests: 10/10 passed');
