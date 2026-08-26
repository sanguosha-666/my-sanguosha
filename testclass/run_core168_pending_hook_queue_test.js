/**
 * CORE-168(issue #227)回归锁定:triggerHook 里"自己的 hook 已挂起 pending、借来的 hook
 * 也想触发"时排队用的 g.pendingHookQueue 原本是**单个槽位、直接赋值**,已有的排队项会被
 * 无声覆盖丢失(同一次伤害里连续排两项、或上一项还没消费完又来了下一次伤害)。
 * 修复后改成数组队列:enqueuePendingHook 追加、consumePendingHookQueue 先进先出逐项消费、
 * normalize 逐项做形状防御(坏项单独剔除,不再因一项有问题就整体清空)。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};tx=function(fn,cb){var r=fn(__g);if(r&&typeof r==='object')__g=r;if(cb)cb(__g);return r;};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(name,general)=>({name,general,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});

function state(){
  const g={players:[mk('左慈','zuoci'),mk('甲','caocao'),mk('乙','liubei')],
    deck:[{id:'d1',name:'杀',suit:'♠',rank:2},{id:'d2',name:'桃',suit:'♥',rank:3}],
    discard:[],log:[],phase:'play',turn:1,roundNum:1,gameMode:'ffa',pending:null,exchangeCards:[]};
  // 左慈借用郭嘉【遗计】(hook:onDamaged),自身【新生】同样挂在 onDamaged 上
  g.players[0].huashenGeneral='guojia';
  g.players[0].huashenSkillName='遗计';
  sandbox.__g=g;
  return g;
}
const qlen=()=>{const q=sandbox.__g.pendingHookQueue; return q?(Array.isArray(q)?q.length:1):0;};

// 1) 自身 hook 挂起后,借来的 hook 进队列
let g=state();
R("tx(function(gg){ triggerHook(gg,0,'onDamaged',{amount:1,sourceSeat:1,srcType:'sha'}); return gg; })");
assert.strictEqual(sandbox.__g.phase,'xinshengAsk','自身【新生】先挂起询问');
assert.strictEqual(qlen(),1,'借来的【遗计】应进入排队');

// 2) 队列已有一项时,再来一次触发必须追加而不是覆盖(这正是本票的缺陷)
R("tx(function(gg){ triggerHook(gg,0,'onDamaged',{amount:1,sourceSeat:2,srcType:'sha'}); return gg; })");
assert.strictEqual(qlen(),2,'第二次触发必须追加进队列,不得覆盖第一项');
const q=sandbox.__g.pendingHookQueue;
assert.strictEqual(q[0].ctx.sourceSeat,1,'先排的那一项必须仍在队首');
assert.strictEqual(q[1].ctx.sourceSeat,2,'后排的那一项排在其后');

// 3) consumePendingHookQueue 按序消费:第一项挂起 pending 后返回 true,剩余项保留
sandbox.__g.pending=null;
let consumed=R("tx(function(gg){ return consumePendingHookQueue(gg,{type:'sha'}); })");
assert.strictEqual(consumed,true,'第一项(遗计)挂起了新 pending,应返回 true');
assert.strictEqual(sandbox.__g.pending.resume.type,'sha','恢复点必须用外部传入的 resume');
assert.strictEqual(qlen(),1,'剩余的第二项必须保留,等下一次消费');

// 4) 再消费一次把队列清空,清空后回落 null(不是空数组:Firebase 存不下空数组)
sandbox.__g.pending=null;
consumed=R("tx(function(gg){ return consumePendingHookQueue(gg,{type:'sha'}); })");
assert.strictEqual(consumed,true,'第二项同样应被真正执行');
assert.strictEqual(sandbox.__g.pendingHookQueue,null,'队列消费完必须回落 null');
assert.strictEqual(R("tx(function(gg){ return consumePendingHookQueue(gg,{type:'sha'}); })"),false,'空队列消费返回 false');

// 5) 队列中间夹着一条已失效的排队项(座位已阵亡)时,不阻塞后面的项
g=state();
g.players[1].huashenGeneral='guojia'; g.players[1].huashenSkillName='遗计';
R("tx(function(gg){ enqueuePendingHook(gg,{seat:1,hookName:'onDamaged',ctx:{amount:1,sourceSeat:0,srcType:'sha'},source:'borrowed'}); enqueuePendingHook(gg,{seat:0,hookName:'onDamaged',ctx:{amount:1,sourceSeat:1,srcType:'sha'},source:'own'}); return gg; })");
assert.strictEqual(qlen(),2,'两项都进了队列');
sandbox.__g.players[1].alive=false;   // 队首那一项的座位失效
consumed=R("tx(function(gg){ return consumePendingHookQueue(gg,{type:'sha'}); })");
assert.strictEqual(consumed,true,'跳过失效项后,后面那项(左慈自己的新生)仍必须被执行');
assert.strictEqual(sandbox.__g.phase,'xinshengAsk','确认执行的确实是后面那一项');

// 6) normalize 逐项防御:坏项剔除、好项保留
g=state();
sandbox.__g.pendingHookQueue=[
  {seat:'x',hookName:'onDamaged',ctx:{},source:'own'},              // seat 非数字
  {seat:0,hookName:'onDamaged',ctx:{amount:1},source:'borrowed'},   // 合法
  {seat:0,hookName:'onDamaged',ctx:{amount:1},source:'weird'}       // source 非法
];
R("normalize(__g)");
assert.strictEqual(qlen(),1,'normalize 只应剔除坏项,保留合法项');
assert.strictEqual(sandbox.__g.pendingHookQueue[0].source,'borrowed','保留下来的必须是那条合法项');

// 7) normalize 兼容改动前写进 Firebase 的旧单槽形状
g=state();
sandbox.__g.pendingHookQueue={seat:0,hookName:'onDamaged',ctx:{amount:1},source:'borrowed'};
R("normalize(__g)");
assert.ok(Array.isArray(sandbox.__g.pendingHookQueue),'旧单槽形状应被升级成数组');
assert.strictEqual(qlen(),1,'旧单槽内容不得丢失');

// 8) 全部坏项 → 回落 null
g=state();
sandbox.__g.pendingHookQueue=[{seat:99,hookName:'onDamaged',ctx:{},source:'own'}];
R("normalize(__g)");
assert.strictEqual(sandbox.__g.pendingHookQueue,null,'全部剔完应回落 null');

console.log('CORE-168 pendingHookQueue: all passed');
