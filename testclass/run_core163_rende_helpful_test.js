/**
 * CORE-163(issue #222)回归锁定:刘备【仁德】的机器人阶段A候选原本只有一条
 * `g.gameMode==='team' && !sameTeam(...)` 过滤——身份局里 sameTeam 恒为 false,
 * 这条过滤是空操作,于是忠臣/主公会把 2 张牌白送给已知反贼(还顺带回血)。
 * 修复后阶段A统一走 botTargetPolicyAllows(...,'helpful'),和青囊/举荐/好施同口径。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const elm=()=>({onclick(){},onerror(){},onload(){},src:'',href:'',rel:'',type:'',textContent:'',innerHTML:'',className:'',id:'',style:{},value:'',classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(){return{};},remove(){},setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){}});
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},push(){return{set(){},key:'k'};},transaction(){return{};},set(){},update(){},child(){return{};},remove(){},get(){return{val(){return null;}};}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById:elm,createElement:elm,createTextNode:t=>({nodeValue:t,textContent:t}),createDocumentFragment:()=>({appendChild(){return{};},querySelector(){return null;},querySelectorAll(){return[];}}),querySelector(){return null;},querySelectorAll(){return[];},body:{innerHTML:'',appendChild(){return{};},removeChild(){return{};},insertBefore(){return{};}},head:{appendChild(){return{};}},forms:[],images:[],scripts:[],addEventListener(){},removeEventListener(){}},
  window:{firebase:null,location:{search:'',href:'http://localhost',reload(){}},localStorage:{getItem(){return null;},setItem(){},removeItem(){},clear(){}},sessionStorage:{getItem(){return null;},setItem(){}},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,setInterval,clearInterval,alert(){},confirm(){return true;},prompt(){return null;},open(){return null;},close(){},history:{pushState(){},replaceState(){}},navigator:{userAgent:'Mozilla/5.0',platform:'Win32',language:'zh-CN',onLine:true}},
  joinRoom(){},mySeat:0,console,Math,Date,JSON,RegExp,setTimeout,clearTimeout,setInterval,clearInterval
};
context.window.firebase=context.firebase;context.window.document=context.document;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js']
  .forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("tx=function(fn){return fn(typeof _g!=='undefined'?_g:{});};botTwoStepA=null;");

const spec=R('BOT_DECISIONS.rendeTwoStep');
assert.ok(spec,'BOT_DECISIONS.rendeTwoStep 必须已注册');

function mkG(mode, roles){
  const players=roles.map((role,i)=>({name:'P'+i,alive:true,hp:3,maxHp:4,hand:[],equips:R('emptyEquips')(),
    delays:[],general:i===0?'liubei':'caocao',role:role.role,roleRevealed:!!role.revealed,team:role.team}));
  players[0].hand=[{id:'c1',name:'杀',suit:'♠',rank:5}];
  return {players,gameMode:mode,phase:'play',turn:0,roundNum:1,log:[],pending:null,deck:[],discard:[]};
}
function seatsA(g){ return spec.buildCandidates(g,0).filter(c=>c.step==='A').map(c=>c.a); }

// 身份局:主公(座位0,刘备) + 已翻面反贼(1) + 身份未知(2)
let g=mkG('identity',[{role:'zhu'},{role:'fan',revealed:true},{role:'zhong'}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([2]),'主公不得把仁德送给已知反贼');

// 身份局:忠臣视角(座位0是忠臣,座位1是主公——主公身份天然公开,座位2已翻面反贼)
g=mkG('identity',[{role:'zhong'},{role:'zhu'},{role:'fan',revealed:true}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([1]),'忠臣不得把仁德送给已知反贼');

// 身份局:反贼视角,不得送给主公/已知忠臣
g=mkG('identity',[{role:'fan'},{role:'zhu'},{role:'zhong',revealed:true},{role:'fan'}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([3]),'反贼不得把仁德送给主公或已知忠臣');

// 身份未知仍可给(helpful 现有口径)
g=mkG('identity',[{role:'zhu'},{role:'fan'},{role:'zhong'}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([1,2]),'身份未知时放行,行为不变');

// 内奸不设硬边界
g=mkG('identity',[{role:'nei'},{role:'fan',revealed:true},{role:'zhu'}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([1,2]),'内奸保持动态策略,不套固定敌我');

// 组队模式仍只给队友(零回归)
g=mkG('team',[{team:1},{team:1},{team:2},{team:2}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([1]),'组队模式仍只给队友');

// ffa 无身份信息:全部存活他人都可给(零回归)
g=mkG('ffa',[{},{},{}]);
assert.strictEqual(JSON.stringify(seatsA(g)),JSON.stringify([1,2]),'ffa 模式行为不变');

// 全部候选被过滤掉时候选为空(契约:botDecide 返回 false,本轮不发动仁德)
g=mkG('identity',[{role:'zhu'},{role:'fan',revealed:true}]);
assert.strictEqual(seatsA(g).length,0,'无合法目标时阶段A候选为空');

console.log('CORE-163 rende helpful filter: all passed');
