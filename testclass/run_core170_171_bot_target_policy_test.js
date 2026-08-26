/**
 * CORE-170(issue #229)/CORE-171(issue #230)回归锁定:机器人对夏侯渊【神速】选目标、
 * 陈宫【明策】两步选目标原本都是裸 findIndex/candidates[0] —— 既绕过阵营策略
 * (botTargetPolicyAllows),神速那条还绕过服务端 respondShensuSha 自己会查的
 * CARD_PLAYS['杀'].canTarget(空城/同疾/智迟),后者会让服务端原地拒绝、状态一字不变,
 * 机器人下次醒来重算又选同一个人 —— 即 CLAUDE.md 规则26 那类永久死循环。
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
// 只关心"机器人决定对谁动手",把真正的服务端调用换成记录器
R(`__calls=[];
   botInvoke=function(seat,fn){ fn&&fn(); return true; };
   respondShensuSha=function(t){ __calls.push(['shensu',t]); };
   cancelShensuSha=function(){ __calls.push(['shensuCancel']); };
   pickMingceTarget=function(t){ __calls.push(['mingce1',t]); };
   pickMingceTarget2=function(t){ __calls.push(['mingce2',t]); };
   cancelMingce=function(){ __calls.push(['mingceCancel']); };
   tx=function(fn){return fn(typeof _g!=='undefined'?_g:{});};`);

function mkG(mode, roles, phase, pending){
  const players=roles.map((r,i)=>({name:'P'+i,isBot:i===0,alive:r.alive!==false,hp:4,maxHp:4,
    hand:r.hand||[{id:'h'+i,name:'闪',suit:'♦',rank:2}],equips:R('emptyEquips')(),delays:[],
    general:r.general||'caocao',role:r.role,roleRevealed:!!r.revealed,team:r.team}));
  return {players,gameMode:mode,phase,turn:0,roundNum:1,log:[],pending,deck:[],discard:[]};
}
async function drive(g){
  R("__calls=[];");
  sandbox._g=g;
  await R("runBotDecision(_g,0)");
  return R("JSON.stringify(__calls)");
}

(async function main(){
// ===== 神速 =====
// 身份局:忠臣夏侯渊,座位1=主公(不能打),座位2=已翻面反贼(该打)
var g=mkG('identity',[{role:'zhong',general:'xiahouyuan'},{role:'zhu'},{role:'fan',revealed:true}],
  'shensuSha',{type:'shensuSha',seat:0,remaining:1});
assert.strictEqual(await drive(g),JSON.stringify([['shensu',2]]),'忠臣神速必须跳过主公,打已知反贼');

// 身份局:反贼夏侯渊不得打已知反贼
g=mkG('identity',[{role:'fan',general:'xiahouyuan'},{role:'fan',revealed:true},{role:'zhu'}],
  'shensuSha',{type:'shensuSha',seat:0,remaining:1});
assert.strictEqual(await drive(g),JSON.stringify([['shensu',2]]),'反贼神速必须跳过已知反贼,打主公');

// 规则层保护(空城)同样要跳过——否则服务端原地拒绝,机器人永久重试
g=mkG('ffa',[{general:'xiahouyuan'},{general:'zhuge',hand:[]},{}],
  'shensuSha',{type:'shensuSha',seat:0,remaining:1});
assert.strictEqual(await drive(g),JSON.stringify([['shensu',2]]),'空城目标必须跳过(服务端 canTarget 会拒绝)');

// 一个合法目标都没有:取消,不硬选、不干等超时
g=mkG('ffa',[{general:'xiahouyuan'},{general:'zhuge',hand:[]}],
  'shensuSha',{type:'shensuSha',seat:0,remaining:1});
assert.strictEqual(await drive(g),JSON.stringify([['shensuCancel']]),'无合法目标时应取消神速');

// ffa 零回归:仍然选第一个存活对手
g=mkG('ffa',[{general:'xiahouyuan'},{},{}],'shensuSha',{type:'shensuSha',seat:0,remaining:1});
assert.strictEqual(await drive(g),JSON.stringify([['shensu',1]]),'ffa 模式行为不变');

// ===== 明策第一步:把牌交给谁(帮助型) =====
g=mkG('identity',[{role:'zhong',general:'chengong'},{role:'fan',revealed:true},{role:'zhu'}],
  'mingcePickTarget',{type:'mingcePickTarget',sourceSeat:0,cardName:'杀'});
assert.strictEqual(await drive(g),JSON.stringify([['mingce1',2]]),'忠臣不得把明策的牌送给已知反贼');

g=mkG('identity',[{role:'fan',general:'chengong'},{role:'zhu'},{role:'fan'}],
  'mingcePickTarget',{type:'mingcePickTarget',sourceSeat:0,cardName:'杀'});
assert.strictEqual(await drive(g),JSON.stringify([['mingce1',2]]),'反贼不得把明策的牌送给主公');

// 没有可送的人 → 取消(cancelMingce 会复位 mingceUsed,不白白消耗限次)
g=mkG('identity',[{role:'zhong',general:'chengong'},{role:'fan',revealed:true}],
  'mingcePickTarget',{type:'mingcePickTarget',sourceSeat:0,cardName:'杀'});
assert.strictEqual(await drive(g),JSON.stringify([['mingceCancel']]),'无合法接收者时取消明策');

// ===== 明策第二步:让接收者去杀谁(伤害型) =====
g=mkG('identity',[{role:'zhong',general:'chengong'},{role:'zhong'},{role:'zhu'},{role:'fan',revealed:true}],
  'mingcePickTarget2',{type:'mingcePickTarget2',sourceSeat:0,targetSeat:1,candidates:[2,3]});
assert.strictEqual(await drive(g),JSON.stringify([['mingce2',3]]),'忠臣不得指定杀主公,应选已知反贼');

g=mkG('identity',[{role:'zhong',general:'chengong'},{role:'zhong'},{role:'zhu'}],
  'mingcePickTarget2',{type:'mingcePickTarget2',sourceSeat:0,targetSeat:1,candidates:[2]});
assert.strictEqual(await drive(g),JSON.stringify([['mingceCancel']]),'候选全被策略排除时取消,不硬选');

// ffa 零回归:仍取第一个候选
g=mkG('ffa',[{general:'chengong'},{},{},{}],
  'mingcePickTarget2',{type:'mingcePickTarget2',sourceSeat:0,targetSeat:1,candidates:[2,3]});
assert.strictEqual(await drive(g),JSON.stringify([['mingce2',2]]),'ffa 模式第二步行为不变');

console.log('CORE-170/171 bot target policy: all passed');
})().catch(e=>{ console.error(e); process.exit(1); });
