/**
 * CORE-167(issue #226)回归锁定:典韦【强袭】是"出牌阶段限一次发动",不是"限一次成功"。
 * 攻击范围内无合法目标的早退分支原本不置 g.qiangxiUsed,可以反复点发动刷询问/日志,
 * 而且不消耗体力/武器。
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
function state(){
  const g={players:[mk('典韦','dianwei'),mk('乙','liubei'),mk('丙','liubei')],
    deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',
    pending:null,exchangeCards:[],qiangxiUsed:false};
  g.players[1].hand=[{id:'a1',name:'闪',suit:'♦',rank:2}];
  g.players[2].hand=[{id:'a2',name:'闪',suit:'♦',rank:3}];
  sandbox.__g=g;
  return g;
}

// 1) 无合法目标(两名对手都空城)时,发动一次就消耗掉本阶段的次数
let g=state();
g.players[1].general='zhuge'; g.players[1].hand=[];
g.players[2].general='zhuge'; g.players[2].hand=[];
const hpBefore=g.players[0].hp, logBefore=g.log.length;
R("mySeat=0;startQiangxi();chooseQiangxiCost('hp')");
assert.strictEqual(sandbox.__g.phase,'play','无目标时回到出牌阶段');
assert.strictEqual(sandbox.__g.qiangxiUsed,true,'无目标的早退分支必须消耗本阶段发动次数');
assert.strictEqual(sandbox.__g.players[0].hp,hpBefore,'早退不扣体力');
const logAfterFirst=sandbox.__g.log.length;
R("startQiangxi();chooseQiangxiCost('hp')");
assert.strictEqual(sandbox.__g.log.length,logAfterFirst,'第二次点击不得再刷任何日志');
assert.strictEqual(sandbox.__g.pending,null,'第二次点击不得再开询问');
assert.ok(logAfterFirst>logBefore,'第一次发动确实写了日志(证明上面那条断言有鉴别力)');

// 2) 有合法目标时仍可正常发动并造成伤害
g=state();
R("mySeat=0;startQiangxi();chooseQiangxiCost('hp');pickQiangxiTarget(1)");
assert.strictEqual(sandbox.__g.players[1].hp,3,'正常目标仍受到1点强袭伤害');
assert.strictEqual(sandbox.__g.players[0].hp,3,'正常路径仍失去1点体力');
assert.strictEqual(sandbox.__g.qiangxiUsed,true,'成功结算同样置位');

// 3) 玩家主动取消不消耗次数(取消 ≠ 发动)
g=state();
R("mySeat=0;startQiangxi();cancelQiangxi()");
assert.strictEqual(sandbox.__g.qiangxiUsed,false,'主动取消不应消耗本阶段发动次数');
R("startQiangxi();chooseQiangxiCost('hp');pickQiangxiTarget(1)");
assert.strictEqual(sandbox.__g.players[1].hp,3,'取消后仍可正常发动');

// 4) startTurn 重置后下个回合可以重新发动
g=state();
g.players[1].general='zhuge'; g.players[1].hand=[];
g.players[2].general='zhuge'; g.players[2].hand=[];
R("mySeat=0;startQiangxi();chooseQiangxiCost('hp')");
assert.strictEqual(sandbox.__g.qiangxiUsed,true,'先消耗掉');
R("tx(function(gg){ startTurn(gg, 0); return gg; })");
assert.strictEqual(sandbox.__g.qiangxiUsed,false,'startTurn 必须重置强袭限次标志');

console.log('CORE-167 qiangxi once-per-phase: all passed');
