/**
 * CORE-162(issue #221)回归锁定:带【酒】的【杀】被大乔【流离】挂起后,恢复结算时必须
 * 保留酒的 +1 伤害。修复前 maybeStartLiuli 丢掉了 resolveShaUse 的第7参 shaInfo,
 * respondLiuli/liuliAfterDiscard 恢复时又用只含 {noDistance:true} 的新对象覆盖,
 * 目标只受 1 点伤害。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
// EQUIP_SLOT_LABEL 定义在 render-controls.js(渲染层),本测试不加载渲染层,补一份等价常量。
R("var EQUIP_SLOT_LABEL={weapon:'武器',armor:'防具',plus1:'+1马',minus1:'-1马'};");
R("gameRef={transaction:function(fn){return fn(__g);}};tx=function(fn,cb){var r=fn(__g);__g=r||__g;if(cb)cb(__g);return r;};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(name,general)=>({name,general,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});

// useJiu:是否先喝酒;liuli:'transfer'(转移给丙) | 'decline'(不发动) | 'equipCost'(弃装备发动)
function run(useJiu, liuli){
  const g={players:[mk('甲','caocao'),mk('大乔','daqiao'),mk('丙','liubei')],
    deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',
    pending:null,exchangeCards:[]};
  g.players[0].hand=[{id:'j1',name:'酒',suit:'♠',rank:9},{id:'s1',name:'杀',suit:'♠',rank:7}];
  // 大乔必须有可弃的牌才能发动流离;丙留一张手牌避免空城无关干扰
  if(liuli==='equipCost') g.players[1].equips.weapon={id:'w1',name:'青釭剑',suit:'♠',rank:6};
  else g.players[1].hand=[{id:'c1',name:'闪',suit:'♦',rank:2}];
  g.players[2].hand=[{id:'c2',name:'闪',suit:'♦',rank:3}];
  sandbox.__g=g;
  R("mySeat=0;");
  if(useJiu) R("playCard(0,'酒')");
  const shaIdx=sandbox.__g.players[0].hand.findIndex(c=>c.name==='杀');
  R("playCard("+shaIdx+",'杀',1)");
  let s=sandbox.__g;
  assert.strictEqual(s.phase,'liuli','必须进入流离询问');
  R("mySeat=1;");
  if(liuli==='decline') R("respondLiuli(null)");
  else if(liuli==='transfer') R("respondLiuli({kind:'hand',idx:0},2)");
  else R("respondLiuli({kind:'equip',slot:'weapon'},2)");
  // 目标不出闪
  let guard=0;
  while(guard++<10){
    s=sandbox.__g;
    if(s.phase==='respond') R('mySeat='+s.pending.to+';respondShan(null)');
    else break;
  }
  return sandbox.__g;
}

// 1) 酒杀被流离转移到第三人:第三人受 2 点
let g=run(true,'transfer');
assert.strictEqual(g.players[2].hp,2,'酒杀转移后新目标应受2点伤害');
assert.strictEqual(g.players[1].hp,4,'原目标不受伤害');

// 2) 酒杀,流离不发动:原目标仍受 2 点
g=run(true,'decline');
assert.strictEqual(g.players[1].hp,2,'流离不发动时原目标仍应受2点伤害');

// 3) 未喝酒的杀走流离仍为 1 点
g=run(false,'transfer');
assert.strictEqual(g.players[2].hp,3,'普通杀转移后只受1点伤害');

// 4) 弃装备发动流离(liuliAfterDiscard 续接路径)同样保留酒加成
g=run(true,'equipCost');
assert.strictEqual(g.players[2].hp,2,'弃装备发动流离时酒加成同样保留');

console.log('CORE-162 liuli jiu bonus: all passed');
