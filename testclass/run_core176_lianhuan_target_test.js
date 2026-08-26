/**
 * CORE-176(issue #235)回归锁定:庞统【连环】(把♣牌当【铁索连环】使用)的目标筛选原本
 * 只判存活,绕过 CARD_PLAYS['铁索连环'].canTarget 里的贾诩【帷幕】(黑色锦囊免疫)和
 * 陈宫【智迟】保护。修复后连环复用同一个 canTarget,与真实铁索口径一致。
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

// seat0=庞统(连环),seat1=可被保护的目标,seat2=普通目标
function state(){
  const g={players:[mk('庞统','pangtong'),mk('乙','liubei'),mk('丙','liubei')],
    deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',
    pending:null,exchangeCards:[]};
  g.players[0].hand=[{id:'c1',name:'杀',suit:'♣',rank:5}];
  sandbox.__g=g;
  return g;
}
function drive(){
  let guard=0;
  while(guard++<20){
    const s=sandbox.__g;
    if(s.phase==='wuxie'){
      if(s.pending.type==='wuxiePublicWait'){s.pending.publicUntil=0;R('finishWuxiePublicWait()');}
      else R('mySeat='+s.pending.asking+';respondWuxie(false)');
    } else break;
  }
  return sandbox.__g;
}

// 1) 正常目标可以连环
let g=state();
R("mySeat=0;lianHuan(0,[1,2])");
g=drive();
assert.strictEqual(g.players[0].hand.length,0,'合法目标应正常消耗牌');
assert.strictEqual(g.players[1].chained,true,'目标1应进入连环状态');
assert.strictEqual(g.players[2].chained,true,'目标2应进入连环状态');

// 2) 帷幕(贾诩)不能成为黑色锦囊目标 —— 连环用的是♣牌,属黑色锦囊
g=state(); g.players[1].general='jiaxu';
R("mySeat=0;lianHuan(0,[1])");
assert.strictEqual(sandbox.__g.players[0].hand.length,1,'帷幕目标必须被拒绝且不消耗牌');
assert.ok(!sandbox.__g.players[1].chained,'帷幕目标不得进入连环状态');

// 3) 帷幕目标混在双目标里 —— 整体拒绝(与真实铁索 playCard 同口径)
g=state(); g.players[1].general='jiaxu';
R("mySeat=0;lianHuan(0,[1,2])");
assert.strictEqual(sandbox.__g.players[0].hand.length,1,'双目标含帷幕目标时整体拒绝');
assert.ok(!sandbox.__g.players[2].chained,'整体拒绝时合法目标也不结算');

// 4) 智迟免疫目标同样被拒绝
g=state(); g.zhichiImmunity={seat:1,turn:0};
R("mySeat=0;lianHuan(0,[1])");
assert.strictEqual(sandbox.__g.players[0].hand.length,1,'智迟目标必须被拒绝且不消耗牌');

// 5) 已阵亡目标仍然被拒绝(原有存活校验零回归)
g=state(); g.players[1].alive=false;
R("mySeat=0;lianHuan(0,[1])");
assert.strictEqual(sandbox.__g.players[0].hand.length,1,'阵亡目标必须被拒绝');

console.log('CORE-176 lianhuan canTarget: all passed');
