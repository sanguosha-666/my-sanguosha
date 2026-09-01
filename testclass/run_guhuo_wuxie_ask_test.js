// #105: nextWuxieAskee 只按真实持牌过滤,有【蛊惑】无真牌的于吉永远不会被问及无懈可击。
// 本测试锁定 canWuxie 的"值得被问"判定扩展:真实持有【无懈可击】或拥有蛊惑能力且本回合未使用。
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
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>R('emptyEquips')();
const card=(id,name='杀')=>({id,name,suit:'♠',rank:7});
const wuxieCard=id=>({id,name:'无懈可击',suit:'♠',rank:3});
const mkG=(players,extra={})=>Object.assign({players,deck:[card('d1'),card('d2')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null},extra);
const mkP=(name,general,hand)=>({name,general,hp:4,maxHp:4,hand,equips:eq(),delays:[],alive:true});

// ---- T1: 于吉(guhuo)无真实无懈、guhuoUsed=false 时应被 nextWuxieAskee 算作候选 ----
let g=mkG([
  mkP('甲','caocao',[]),
  mkP('于吉','yuji',[card('k1','杀')])
]);
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.phase,'wuxie','应进入无懈窗口');
assert.strictEqual(g.pending.type,'wuxie','于吉有蛊惑且未用,不应进入公共等待窗口');
assert.strictEqual(g.pending.asking,1,'无真实无懈但蛊惑未用的于吉应被问到');
assert.strictEqual(!!g.players[1].guhuoUsed,false,'只是被问到,不得消耗蛊惑次数');

// ---- T2: guhuoUsed=true 时不算(本回合已用蛊惑),回退到公共等待窗口 ----
g=mkG([
  mkP('甲','caocao',[]),
  mkP('于吉','yuji',[card('k1','杀')])
]);
g.players[1].guhuoUsed=true;   // CORE-183:每回合限一次记在于吉自己身上
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.pending.type,'wuxiePublicWait','蛊惑已用的于吉不应再被问到');

// ---- T3: 于吉有真实无懈时照常被问到(原行为不回归,且与 guhuoUsed 无关) ----
g=mkG([
  mkP('甲','caocao',[]),
  mkP('于吉','yuji',[wuxieCard('w1')])
]);
g.players[1].guhuoUsed=true;   // CORE-183:同上
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.pending.type,'wuxie');
assert.strictEqual(g.pending.asking,1,'真实持牌路径必须保持原行为');

// ---- T4: 无真实无懈、无蛊惑能力的普通角色照常被跳过(隐私/快速跳过保持) ----
g=mkG([
  mkP('甲','caocao',[]),
  mkP('乙','liubei',[card('k1','杀')])
]);
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.pending.type,'wuxiePublicWait','无人值得被问时必须走公共等待窗口,不逐人询问');

// ---- T5: 反制层(depth>0,单目标分支)同样应把蛊惑候选算进去 ----
g=mkG([
  mkP('甲','caocao',[]),
  mkP('于吉','yuji',[card('k1','杀')])
]);
g.pending={type:'wuxie', trick:'无中生有', from:0, to:0, exclude:0, depth:1, askAll:true, asked:[]};
g.phase='wuxie';
sandbox.__g=g;
assert.strictEqual(R('nextWuxieAskee(__g,__g.pending)'),1,'反制轮蛊惑候选同样要能被问到');

// ---- T6 端到端: 于吉 startGuhuoResponse 声明蛊惑为无懈可击并成功抵消锦囊 ----
g=mkG([
  mkP('甲','caocao',[]),
  mkP('于吉','yuji',[card('k1','杀')])
]);
sandbox.__g=g;
R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
assert.strictEqual(g.pending.asking,1,'e2e 前置:于吉应被问到');
R('mySeat=1');
R("startGuhuoResponse(0,'无懈可击')");
assert.strictEqual(g.phase,'guhuoQuestion','蛊惑应进入质疑阶段');
assert.strictEqual(g.players[1].guhuoUsed,true,'发动蛊惑应消耗本回合次数');
assert.strictEqual(g.pending.sourceSeat,1);
// 甲不质疑
R('mySeat=0');
R('respondGuhuoQuestion(false)');
assert.strictEqual(g.phase,'wuxie','无人质疑后应回到无懈窗口');
assert.strictEqual(g.pending.depth,1,'蛊惑无懈应算作一次成功反制');
assert.strictEqual(g.pending.exclude,1,'反制者应为于吉');
assert.strictEqual(['wuxie','wuxiePublicWait'].includes(g.pending.type),true,'反制后开新一轮窗口(无人再值得问时即公共等待)');
assert.strictEqual(g.players[1].hand.length,0,'于吉的扣置牌应被移出手牌');
assert.strictEqual(g.discard.some(c=>c.id==='k1'),true,'于吉的扣置牌应进弃牌堆');
// 公共等待窗口结束后按 depth 奇偶判定:1=奇数=锦囊作废
g.pending.askedAt=Date.now()-3100; g.pending.publicUntil=Date.now()-1;
assert.strictEqual(R('maybeAutoRespondTimeout(__g)'),true);
assert.strictEqual(g.pending,null,'无懈成功抵消后应直接结算作废');
assert.strictEqual(g.players[0].hand.length,0,'无中生有被抵消,甲不得摸牌');

console.log('guhuo wuxie ask tests: 9/9 passed');
