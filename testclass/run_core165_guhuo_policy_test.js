/**
 * CORE-165(issue #224)回归锁定:于吉【蛊惑】原本被当成"零风险固定发动"——只查
 * spec.canPlay + guhuoHasLegalTarget(纯规则 canTarget)就扣牌发动,阵营策略要到后续
 * BOT_SEAT_PICKS.guhuoTarget(effectKind:'harmful')才生效。于是忠臣于吉在"规则合法目标
 * 只剩主公"时照样扣牌发动,seatPick 滤空后本回合空转,牌和 guhuoUsed 都白白消耗。
 * 修复后发动前先过同一套 harmful 策略(botGuhuoHasPolicyTarget),发动门槛=执行门槛。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const elm=()=>({onclick(){},onerror(){},onload(){},src:'',href:'',rel:'',type:'',textContent:'',innerHTML:'',className:'',id:'',style:{},value:'',classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(){return{};},remove(){},setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){}});
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},push(){return{set(){},key:'k'};},transaction(){return{};},set(){},update(){},child(){return{};},remove(){},get(){return{val(){return null;}};}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById:elm,createElement:elm,createTextNode:t=>({textContent:t}),createDocumentFragment:()=>({appendChild(){return{};},querySelector(){return null;},querySelectorAll(){return[];}}),querySelector(){return null;},querySelectorAll(){return[];},body:{innerHTML:'',appendChild(){return{};},removeChild(){return{};},insertBefore(){return{};}},head:{appendChild(){return{};}},forms:[],images:[],scripts:[],addEventListener(){},removeEventListener(){}},
  window:{firebase:null,location:{search:'',href:'http://localhost'},localStorage:{getItem(){return null;},setItem(){},removeItem(){},clear(){}},sessionStorage:{getItem(){return null;},setItem(){}},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,setInterval,clearInterval,alert(){},confirm(){return true;},prompt(){return null;},open(){return null;},close(){},history:{pushState(){},replaceState(){}},navigator:{userAgent:'Mozilla/5.0',platform:'Win32',language:'zh-CN',onLine:true}},
  joinRoom(){},mySeat:0,console,Math,Date,JSON,RegExp,setTimeout,clearTimeout,setInterval,clearInterval
};
context.window.firebase=context.firebase;context.window.document=context.document;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js']
  .forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
// botInvoke 会真正去调服务端函数;这里只关心"有没有决定发动",把它换成记录器。
R("__invoked=[];botInvoke=function(seat,fn){ __invoked.push(seat); return true; };");
R("tx=function(fn){return fn(typeof _g!=='undefined'?_g:{});};");

function mkG(mode, roles){
  const players=roles.map((r,i)=>({name:'P'+i,alive:true,hp:4,maxHp:4,
    hand:[],equips:R('emptyEquips')(),delays:[],general:i===0?'yuji':'caocao',
    role:r.role,roleRevealed:!!r.revealed,team:r.team}));
  players[0].hand=[{id:'g1',name:'桃',suit:'♥',rank:6}];
  return {players,gameMode:mode,phase:'play',turn:0,roundNum:1,log:[],pending:null,
          deck:[],discard:[]};
}
function triedGuhuo(g){
  R("__invoked=[];");
  sandbox._g=g;
  const r=R("botTryStartExtraSkills(_g,0)");
  return !!r && R("__invoked.length")>0;
}
// 前置:确认于吉的确有蛊惑能力(否则下面的否定断言可能只是因为压根没这个技能)
assert.strictEqual(R("hasCap({general:'yuji'},'guhuo')"),true,'于吉必须真的有蛊惑能力');

// 1) 身份局:忠臣于吉,唯一规则合法目标是主公 → 不发动
let g=mkG('identity',[{role:'zhong'},{role:'zhu'}]);
assert.strictEqual(triedGuhuo(g),false,'忠臣在唯一目标是主公时不得发动蛊惑');
assert.strictEqual(g.players[0].hand.length,1,'不发动就不应该扣掉手牌');

// 2) 身份局:同样是忠臣,场上多一个已翻面反贼 → 仍应发动
g=mkG('identity',[{role:'zhong'},{role:'zhu'},{role:'fan',revealed:true}]);
assert.strictEqual(triedGuhuo(g),true,'存在策略允许的目标时仍应发动蛊惑');

// 3) 身份局:反贼于吉,唯一目标是已知反贼 → 不发动
g=mkG('identity',[{role:'fan'},{role:'fan',revealed:true}]);
assert.strictEqual(triedGuhuo(g),false,'反贼不得对已知反贼发动蛊惑');

// 4) 身份不明:沿用 harmful 既有口径——忠臣要求怀疑度≥35 才对身份不明者动手
g=mkG('identity',[{role:'zhong'},{role:'fan'}]);
assert.strictEqual(triedGuhuo(g),false,'忠臣对怀疑度不足的身份不明者不发动(harmful 既有口径)');
g=mkG('identity',[{role:'zhong'},{role:'fan'}]);
g.aiRebelSuspicion={1:60};
assert.strictEqual(triedGuhuo(g),true,'怀疑度足够时仍应发动');

// 5) 组队模式:唯一对手是队友 → 不发动;有敌方 → 发动
g=mkG('team',[{team:1},{team:1}]);
assert.strictEqual(triedGuhuo(g),false,'组队模式不得把蛊惑的杀指向队友');
g=mkG('team',[{team:1},{team:1},{team:2}]);
assert.strictEqual(triedGuhuo(g),true,'组队模式存在敌方时仍应发动');

// 6) ffa 零回归
g=mkG('ffa',[{},{}]);
assert.strictEqual(triedGuhuo(g),true,'ffa 模式行为不变');

// 7) 已用过 guhuoUsed 时不发动(既有门槛零回归)
g=mkG('ffa',[{},{}]); g.players[0].guhuoUsed=true;   // CORE-183:每回合限一次记在于吉自己身上
assert.strictEqual(triedGuhuo(g),false,'本回合已用过蛊惑时不得再发动');

console.log('CORE-165 guhuo faction policy: all passed');
