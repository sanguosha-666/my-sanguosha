/**
 * CORE-178(issue #237)回归锁定:群体锦囊(南蛮入侵)结算途中,夏侯惇【刚烈】让伤害来源
 * 也受到伤害后,南蛮队列必须继续询问剩余目标。
 *
 * 根因:嵌套的 dealDamage(刚烈反弹给伤害来源那一下)会新建 g.afterDamageEffects,
 * 把外层(夏侯惇本人那次 aoe 伤害)尚未走完、且携带 originalResume:{type:'aoe'} 的队列
 * 整个挤掉;内层队列走完后置 null,外层的 aoe 恢复信息随之丢失,resumeAfterInterrupt
 * 退化成默认的 {type:'sha'} → g.phase='play',g.aoe 变成永久孤儿。
 * 修法:新建队列时把外层队列存进 outer,队列结束时还原,而不是一律置 null。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};tx=function(fn,cb){var r=fn(__g);__g=r||__g;if(cb)cb(__g);return r;};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(name,general)=>({name,general,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});

// ganglieAction: 'damage'(伤害来源选择受伤) 或 'discard'(弃2张手牌)
function run(ganglieAction){
  const g={players:[mk('大乔','daqiao'),mk('夏侯惇','xiahoudun'),mk('丙','liubei')],
    deck:[{id:'d1',name:'杀',suit:'♠',rank:2}],discard:[],log:[],phase:'play',turn:0,
    roundNum:1,gameMode:'ffa',pending:null,exchangeCards:[]};
  g.players[0].hand=[{id:'n1',name:'南蛮入侵',suit:'♠',rank:7},
    {id:'h1',name:'桃',suit:'♥',rank:3},{id:'h2',name:'桃',suit:'♥',rank:4}];
  sandbox.__g=g;
  R("mySeat=0;playCard(0,'南蛮入侵')");
  let guard=0, sawGanglie=false;
  while(guard++<40){
    const s=sandbox.__g;
    if(s.phase==='wuxie'){
      if(s.pending.type==='wuxiePublicWait'){s.pending.publicUntil=0;R('finishWuxiePublicWait()');}
      else R('mySeat='+s.pending.asking+';respondWuxie(false)');
    } else if(s.phase==='aoeResp'){
      R('mySeat='+s.pending.to+';aoeRespond(false)');
    } else if(s.phase==='ganglieAsk'){
      sawGanglie=true; R('mySeat='+s.pending.seat+';respondGanglieAsk(true)');
    } else if(s.phase==='ganglieChoice'){
      R('mySeat='+s.pending.sourceSeat+";respondGanglieChoice('"+ganglieAction+"',[0,1])");
    } else break;
  }
  assert.ok(sawGanglie,'刚烈询问必须出现');
  return sandbox.__g;
}

// 场景1:刚烈选"扣一滴血"——南蛮必须继续问第三名玩家
let g=run('damage');
assert.strictEqual(g.players[0].hp,3,'伤害来源受到刚烈的1点伤害');
assert.ok(!g.aoe,'南蛮队列必须走完并清空,不能留下孤儿 g.aoe');
assert.strictEqual(g.players[2].hp,3,'剩余目标必须继续被询问并结算南蛮伤害');
assert.strictEqual(g.phase,'play','结算完毕回到出牌阶段');
assert.strictEqual(g.afterDamageEffects,null,'受伤后队列必须彻底清空,不留残余');

// 场景2:刚烈选"弃2张手牌"(不产生嵌套伤害)——同样必须继续
g=run('discard');
assert.strictEqual(g.players[0].hp,4,'弃牌分支伤害来源不掉血');
assert.strictEqual(g.players[0].hand.length,0,'弃牌分支必须真的弃掉2张手牌');
assert.ok(!g.aoe,'弃牌分支同样不得留下孤儿 g.aoe');
assert.strictEqual(g.players[2].hp,3,'弃牌分支剩余目标同样必须继续结算');

// 场景3:非AOE来源(单体杀)的刚烈行为不变
const g3={players:[mk('甲','caocao'),mk('夏侯惇','xiahoudun')],
  deck:[{id:'d1',name:'杀',suit:'♠',rank:2}],discard:[],log:[],phase:'play',turn:0,
  roundNum:1,gameMode:'ffa',pending:null,exchangeCards:[]};
g3.players[0].hand=[{id:'s1',name:'杀',suit:'♠',rank:9}];
sandbox.__g=g3;
R("mySeat=0;playCard(0,'杀',1)");
let guard=0;
while(guard++<20){
  const s=sandbox.__g;
  if(s.phase==='respond') R('mySeat='+s.pending.to+';respondShan(null)');
  else if(s.phase==='ganglieAsk') R('mySeat='+s.pending.seat+';respondGanglieAsk(true)');
  else if(s.phase==='ganglieChoice') R('mySeat='+s.pending.sourceSeat+";respondGanglieChoice('damage')");
  else break;
}
assert.strictEqual(sandbox.__g.players[0].hp,3,'单体杀触发的刚烈仍正常反弹伤害');
assert.strictEqual(sandbox.__g.phase,'play','单体杀刚烈结算后回到出牌阶段');
assert.strictEqual(sandbox.__g.afterDamageEffects,null,'单体杀链路受伤后队列同样清空');

console.log('CORE-178 ganglie during aoe: all passed');
