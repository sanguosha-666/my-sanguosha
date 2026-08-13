// #98 回归:借刀杀人的第二目标 B 必须复用【杀】canTarget 的完整目标合法性
// (空城/智迟/同疾/多名同疾),普通借刀与蛊惑借刀同一入口;正常攻击距离保持;
// 不读取借刀使用者(mySeat)的临时天义/将驰状态。
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const card=(id,name,suit)=>({id,name,suit:suit||'♠',rank:7});
const player=(name,general)=>({name,general:general||'caocao',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true,caps:{}});
const jiedao=()=>card('j1','借刀杀人','♣');
function state(n,opts){
  opts=opts||{};
  const players=[player('使用者'),player('持刀者A'),player('被杀者B')];
  while(players.length<n) players.push(player('配角'+players.length));
  players[0].hand=[jiedao()];
  players[1].equips.weapon=card('w1','青龙偃月刀');
  players[2].hand=[card('h1','闪','♥')];
  if(opts.jiangchiNoDistance) players[0].jiangchiNoDistance=true;
  if(opts.userTianyi){ players[0].caps.tianyi=true; }
  return {players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
}
let g=sandbox.__g;
const rejected=()=>g.players[0].hand.length===1 && g.pending===null;

// 1. B 空城被拒
g=state(3);g.players[2].caps.kongcheng=true;g.players[2].hand=[];sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(rejected(),true,'借刀:B空城不得成为目标');

// 2. B 智迟被拒
g=state(3);g.zhichiImmunity={seat:2,turn:0};sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(rejected(),true,'借刀:B智迟保护不得成为目标');

// 3. B 同疾(袁术在A攻击范围内,B不是袁术)被拒
{
  const n=4;g=state(n);g.players.push(player('袁术'));g.players[3]={name:'袁术',general:'yuanshu',hp:1,maxHp:1,hand:[card('t1','闪','♥'),card('t2','桃','♥')],equips:eq(),delays:[],alive:true,caps:{tongji:true}};
  g.players[3].equips.weapon=card('w3','丈八蛇矛');
  sandbox.__g=g;
  assert.strictEqual(run("distance(__g,3,1)<=attackRange(__g,3)"),true,'同疾测试前提:A在袁术攻击范围内');
  run('jieDaoShaRen(0,1,2)');
  assert.strictEqual(rejected(),true,'借刀:B被同疾(非袁术本人)拒为目标');
}

// 4. 多名同疾被拒(两袁术均在A范围内,B不可能是两人同时)
{
  g=state(5);
  g.players[3]={name:'袁术甲',general:'yuanshu',hp:1,maxHp:1,hand:[card('t1','闪','♥'),card('t2','桃','♥')],equips:eq(),delays:[],alive:true,caps:{tongji:true}};
  g.players[4]={name:'袁术乙',general:'yuanshu',hp:1,maxHp:1,hand:[card('t3','闪','♥'),card('t4','桃','♥')],equips:eq(),delays:[],alive:true,caps:{tongji:true}};
  g.players[3].equips.weapon=card('w3','丈八蛇矛');
  g.players[4].equips.weapon=card('w4','丈八蛇矛');
  sandbox.__g=g;
  assert.strictEqual(run("distance(__g,3,1)<=attackRange(__g,3)"),true,'多名同疾前提1');
  assert.strictEqual(run("distance(__g,4,1)<=attackRange(__g,4)"),true,'多名同疾前提2');
  run('jieDaoShaRen(0,1,2)');
  assert.strictEqual(rejected(),true,'借刀:B被多名同疾联合拒为目标');
}

// 5. 正常距离仍合法
g=state(3);sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
assert.strictEqual(g.players[0].hand.length,0,'借刀:合法目标应消耗锦囊');
assert.strictEqual(['wuxie','wuxiePublicWait'].includes(g.pending&&g.pending.type),true,'借刀:合法目标应进入无懈窗口');
g.pending.publicUntil=0;run('finishWuxiePublicWait()');
assert.strictEqual(g.pending&&g.pending.type,'jiedaoChoice','借刀:无懈通过后应进入选择阶段');

// 6. 不读取使用者 mySeat 的距离/临时状态:使用者有将驰无距离,但B超出A攻击范围仍被拒
{
  g=state(4,{jiangchiNoDistance:true});
  g.players[1].equips.weapon=card('w1','诸葛连弩'); // A 射程1
  g.players[2].hand=[card('h1','闪','♥')]; // B 在座位2,距A(1)为1——仍合法,座位3才是距离2
  g.players[3].hand=[card('h2','闪','♥')];
  sandbox.__g=g;
  assert.strictEqual(run("distance(__g,1,3)"),2,'前提:B3与A距离应为2');
  assert.strictEqual(run("canReachSha(__g,1,3)"),false,'前提:A攻击范围1够不到B3');
  run('jieDaoShaRen(0,1,3)');
  assert.strictEqual(rejected(),true,'借刀:使用者将驰无距离状态不得让A打出超出射程的杀');
  // 同配置下距离内的 B2 仍合法(确认距离口径没有被改坏)
  sandbox.__g=g;run('jieDaoShaRen(0,1,2)');
  assert.strictEqual(g.players[0].hand.length,0,'借刀:距离内目标仍合法');
}

// 7. 不读取使用者 mySeat 的天义状态:使用者有天义赢,但B超出A射程仍被拒
{
  g=state(4,{userTianyi:true});
  g.tianyiWin=true;
  g.players[1].equips.weapon=card('w1','诸葛连弩');
  g.players[3].hand=[card('h2','闪','♥')];
  sandbox.__g=g;
  run('jieDaoShaRen(0,1,3)');
  assert.strictEqual(rejected(),true,'借刀:使用者天义状态不得让A打出超出射程的杀');
}

// 7b. A 响应借刀打出的杀不消耗正常出杀次数(g.shaUsed 不被改动)
{
  g=state(3);g.shaUsed=true; // 假设本回合普通杀次数已用
  g.players[0].hand=[jiedao()];
  g.players[1].hand=[card('h1','杀','♠')];
  sandbox.__g=g;
  run('jieDaoShaRen(0,1,2)');
  g.pending.publicUntil=0;run('finishWuxiePublicWait()');
  assert.strictEqual(g.pending&&g.pending.type,'jiedaoChoice','借刀应进入选择阶段');
  run('mySeat=1;respondJiedao(true,0);mySeat=0;');
  assert.strictEqual(g.players[1].hand.length,0,'A应打出杀');
  assert.strictEqual(g.shaUsed,true,'借刀响应不消耗也不改动普通出杀次数标记');
}

// 8. 蛊惑借刀与普通借刀同一入口
{
  // 8a. 蛊惑借刀:B 空城被拒(扣置牌不丢弃、pending 保留)
  g=state(3);
  g.players[2].caps.kongcheng=true;g.players[2].hand=[];
  g.phase='guhuoTarget';
  g.pending={type:'guhuoTarget',sourceSeat:0,actualCard:card('a1','闪','♥'),claimedCard:{id:'a1',name:'借刀杀人',suit:'♥',rank:8}};
  sandbox.__g=g;run('guhuoChooseJiedaoTarget(1,2)');
  assert.strictEqual(g.pending&&g.pending.type,'guhuoTarget','蛊惑借刀:B空城被拒,pending保留');
  assert.strictEqual(g.discard.length,0,'蛊惑借刀:B空城被拒,扣置牌不得丢弃');

  // 8b. 蛊惑借刀:B 同疾被拒
  g=state(4);
  g.players[3]={name:'袁术',general:'yuanshu',hp:1,maxHp:1,hand:[card('t1','闪','♥'),card('t2','桃','♥')],equips:eq(),delays:[],alive:true,caps:{tongji:true}};
  g.players[3].equips.weapon=card('w3','丈八蛇矛');
  g.phase='guhuoTarget';
  g.pending={type:'guhuoTarget',sourceSeat:0,actualCard:card('a2','闪','♥'),claimedCard:{id:'a2',name:'借刀杀人',suit:'♥',rank:8}};
  sandbox.__g=g;run('guhuoChooseJiedaoTarget(1,2)');
  assert.strictEqual(g.pending&&g.pending.type,'guhuoTarget','蛊惑借刀:B同疾被拒,pending保留');

  // 8c. 蛊惑借刀:正常目标仍生效(扣置牌丢弃、进入无懈窗口)
  g=state(3);
  g.phase='guhuoTarget';
  g.pending={type:'guhuoTarget',sourceSeat:0,actualCard:card('a3','闪','♥'),claimedCard:{id:'a3',name:'借刀杀人',suit:'♥',rank:8}};
  sandbox.__g=g;run('guhuoChooseJiedaoTarget(1,2)');
  assert.strictEqual(g.discard.length,1,'蛊惑借刀:正常目标应丢弃扣置牌');
  assert.strictEqual(['wuxie','wuxiePublicWait'].includes(g.pending&&g.pending.type),true,'蛊惑借刀:正常目标应进入无懈窗口');
}

console.log('jiedao target matrix: 22/22 passed');
