// #103 回归:陆逊【连营】必须覆盖所有手牌失去路径。
// 使用最后一张手牌/响应打出最后一张闪/杀/被顺走最后一张/一次失去多张到0都要触发;
// 一次失去多张只触发一次;不因 pending 被覆盖而丢询问、不重复触发。
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const card=(id,name,suit)=>({id,name,suit:suit||'♠',rank:7});
const luxun=()=>({name:'陆逊',general:'luxun',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true,caps:{}});
const other=()=>({name:'对手',general:'caocao',hp:4,maxHp:4,hand:[card('c1','闪','♥')],equips:eq(),delays:[],alive:true,caps:{}});
const state=()=>({players:[luxun(),other()],deck:[card('d1','闪','♥')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null});
let g=sandbox.__g;
const flush=()=>run('tryFlushLianying(__g)');
const queued=()=>Array.isArray(g.lianyingQueue)&&g.lianyingQueue.includes(0);

// 1. 使用最后一张手牌(playCard)触发
g=state();g.players[0].hand=[card('h1','杀')];sandbox.__g=g;
run("playCard(0,'杀',1)");
assert.strictEqual(queued(),true,'使用最后一张手牌应入连营队列');
g.pending=null;assert.strictEqual(flush(),true,'空闲时应挂起连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk','应开连营询问');
run('respondLianying(true)');
assert.strictEqual(g.players[0].hand.length,1,'发动连营应摸1张');

// 2. 响应打出最后一张闪(respondShan)触发
g=state();g.players[0].hand=[card('h1','闪','♥')];
g.pending={type:'respond',from:1,to:0,sourceCard:card('s1','杀')};g.phase='respond';sandbox.__g=g;
run('respondShan(true,0)');
assert.strictEqual(queued(),true,'打出最后一张闪应入连营队列');
assert.strictEqual(flush(),true,'打出最后一张闪后空闲应挂起连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk','打出最后一张闪应开连营询问');

// 3. 响应打出最后一张杀(duelResponse)触发
g=state();g.players[0].hand=[card('h1','杀')];
g.pending={type:'duel',from:1,to:0,active:0,shaCount:0};g.phase='duel';sandbox.__g=g;
run('duelResponse(true,0)');
assert.strictEqual(queued(),true,'决斗中打出最后一张杀应入连营队列');

// 4. 南蛮/万箭响应打出最后一张(aoeRespond)触发
g=state();g.players[0].hand=[card('h1','杀')];
g.aoe={trick:'南蛮入侵',need:'杀',from:1};g.pending={type:'aoeResp',from:1,to:0,need:'杀'};g.phase='aoeResp';sandbox.__g=g;
run('aoeRespond(true,0)');
assert.strictEqual(queued(),true,'AOE响应打出最后一张应入连营队列');

// 5. 被顺手牵羊拿走最后一张触发
g=state();g.players[0].hand=[card('h1','闪','♥')];sandbox.__g=g;
run('applyTrickOnHand(__g,{trick:\'顺手牵羊\',from:1,to:0})');
assert.strictEqual(g.players[0].hand.length,0,'被顺走手牌应离手');
assert.strictEqual(queued(),true,'被顺走最后一张应入连营队列');

// 6. 一次失去多张且由有牌变为0:只触发一次
g=state();g.players[0].hp=1;g.players[0].maxHp=1;g.players[0].hand=[card('h1','杀'),card('h2','闪','♥')];
g.phase='discard';sandbox.__g=g;
run('discardCards([0,1])');
assert.strictEqual(g.players[0].hand.length,0,'批量弃牌后手牌应为0');
assert.strictEqual(queued(),true,'一次失去多张到0应触发连营');
assert.strictEqual(g.lianyingQueue.filter(s=>s===0).length,1,'一次失去多张只应入队一次');
assert.strictEqual(flush(),true,'批量弃牌到0后应能挂起询问');
assert.strictEqual(g.pending.type,'lianyingAsk','批量弃牌到0应开连营询问');

// 7. 不因 pending 被覆盖而丢询问、不重复触发
g=state();g.players[0].hand=[card('h1','杀')];sandbox.__g=g;
run("playCard(0,'杀',1)");
assert.strictEqual(queued(),true,'入队成功');
assert.strictEqual(g.lianyingQueue.filter(s=>s===0).length,1,'同一失去事件只入队一次');
// 模拟后续结算继续覆盖 pending(杀响应→被抵消→回到出牌)
g.pending={type:'respond',from:1,to:0,noShan:true}; // 中间又挂了一个 pending
assert.strictEqual(flush(),false,'pending 非空闲时不应提前开询问(询问不丢,留在队列)');
assert.strictEqual(queued(),true,'pending 非空闲时连营仍在队列等待');
g.pending=null;
assert.strictEqual(flush(),true,'pending 最终空闲后应补开询问');
assert.strictEqual(g.pending.type,'lianyingAsk','补开连营询问');
run('respondLianying(true)');
assert.strictEqual(g.players[0].hand.length,1,'发动连营应摸1张');
assert.strictEqual(g.lianyingQueue.length,0,'询问结束后队列应清空');

// 8. 被司马懿【反馈】夺走最后一张手牌触发
g=state();g.players[0].hand=[card('h1','闪','♥')];sandbox.__g=g;
// 座位1(司马懿)受伤,伤害来源是座位0(陆逊):反馈随机拿走陆逊唯一手牌
run("GENERALS.simayi.hooks.onDamaged(__g, 1, {amount:1, sourceSeat:0})");
assert.strictEqual(g.players[0].hand.length,0,'被反馈拿走最后一张后手牌应为0');
assert.strictEqual(g.players[1].hand.length,2,'反馈拿到牌应进司马懿手牌');
assert.strictEqual(queued(),true,'被反馈夺走最后一张应入连营队列');
assert.strictEqual(flush(),true,'被反馈夺走后空闲应挂起连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk','被反馈夺走应开连营询问');

// 9. 被【英魂】弃置最后一张手牌触发
g=state();g.players[0].hand=[card('h1','闪','♥')];
g.pending={type:'yinghunDiscard',ownerSeat:1,targetSeat:0,remaining:1};g.phase='yinghunDiscard';sandbox.__g=g;
run('discardYinghunCard(0)');
assert.strictEqual(g.players[0].hand.length,0,'被英魂弃最后一张后手牌应为0');
assert.strictEqual(queued(),true,'被英魂弃最后一张应入连营队列');
assert.strictEqual(flush(),true,'被英魂弃后空闲应挂起连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk','被英魂弃应开连营询问');

// 10. 烈刃拼点失去最后一张手牌触发
g=state();g.players[0].hand=[card('h1','闪','♥')];g.players[1].hand=[card('z1','杀')];
g.pending={type:'lieRenRespond',sourceSeat:1,targetSeat:0,sourceCard:g.players[1].hand[0]};g.phase='lieRenRespond';sandbox.__g=g;
run('respondLieRen(0)');
assert.strictEqual(g.players[0].hand.length,0,'拼点后陆逊手牌应为0');
assert.strictEqual(g.players[1].hand.length,0,'拼点后祝融手牌应为0');
assert.strictEqual(g.discard.length,2,'双方拼点牌应进弃牌堆');
assert.strictEqual(queued(),true,'拼点失去最后一张应入连营队列');
assert.strictEqual(flush(),true,'拼点后空闲应挂起连营询问');
assert.strictEqual(g.pending.type,'lianyingAsk','拼点失去最后一张应开连营询问');

console.log('lianying all paths: 36/36 passed');
