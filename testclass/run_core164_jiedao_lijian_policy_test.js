/**
 * CORE-164(issue #223)回归锁定:机器人【借刀杀人】/貂蝉【离间】的两步候选原本只排除
 * sameTeam,而 sameTeam 在非 team 模式恒为 false —— 身份局里等于完全没有阵营策略:
 * 忠臣能令人杀主公,反贼能让已知反贼互砍。修复后两条路径都叠加
 * botTargetPolicyAllows(...,'harmful')(与丈八/方天 CORE-95 同口径),team 侧的
 * sameTeam 过滤保留,两者是叠加关系。
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
R("tx=function(fn){return fn(typeof _g!=='undefined'?_g:{});};botTwoStepA=null;");

const jiedao=R('BOT_DECISIONS.jiedaoTwoStep'), lijian=R('BOT_DECISIONS.lijianTwoStep');
assert.ok(jiedao && lijian,'两个两步决策必须已注册');

// roles: [{role, revealed, team, general}]
function mkG(mode, roles){
  const players=roles.map((r,i)=>({name:'P'+i,alive:true,hp:4,maxHp:4,
    hand:[{id:'x'+i,name:'闪',suit:'♦',rank:2}],equips:R('emptyEquips')(),delays:[],
    general:r.general||'caocao',role:r.role,roleRevealed:!!r.revealed,team:r.team}));
  return {players,gameMode:mode,phase:'play',turn:0,roundNum:1,log:[],pending:null,deck:[],discard:[]};
}
function withWeapons(g){ // 借刀阶段A要求目标持有武器
  g.players.forEach((p,i)=>{ if(i!==0) p.equips.weapon={id:'w'+i,name:'青釭剑',suit:'♠',rank:6}; });
  return g;
}
function jiedaoB(g, seatA){
  R("botTwoStepA={decisionId:'jiedaoTwoStep',a:"+seatA+"};");
  const out=jiedao.buildCandidates(g,0).map(c=>c.seatB);
  R("botTwoStepA=null;");
  return out;
}
function jiedaoA(g){ return jiedao.buildCandidates(g,0).filter(c=>c.step==='A').map(c=>c.a); }
function lijianB(g, from){
  R("botTwoStepA={decisionId:'lijianTwoStep',a:"+from+"};");
  const out=lijian.buildCandidates(g,0).map(c=>c.toSeat);
  R("botTwoStepA=null;");
  return out;
}
function lijianA(g){ return lijian.buildCandidates(g,0).filter(c=>c.step==='A').map(c=>c.a); }

// ===== 借刀杀人 =====
// 身份局:座位0=忠臣(施术者),1=主公,2=已翻面反贼,3=身份未知
let g=withWeapons(mkG('identity',[{role:'zhong'},{role:'zhu'},{role:'fan',revealed:true},{role:'zhong'}]));
g.players[0].hand.push({id:'jd',name:'借刀杀人',suit:'♠',rank:5});
assert.ok(!jiedaoB(g,3).includes(1),'忠臣不得把主公选成借刀的被杀方');
assert.ok(jiedaoB(g,3).includes(2),'已知反贼仍可作为被杀方');

// 身份局:反贼施术者不得把已知反贼选成被杀方
g=withWeapons(mkG('identity',[{role:'fan'},{role:'fan',revealed:true},{role:'zhu'},{role:'zhong'}]));
g.players[0].hand.push({id:'jd',name:'借刀杀人',suit:'♠',rank:5});
assert.ok(!jiedaoB(g,3).includes(1),'反贼不得把已知反贼选成被杀方');
assert.ok(jiedaoB(g,3).includes(2),'主公仍可作为被杀方');

// 阶段A 的 hasSomeB 用同一口径:唯一可能的 B 被策略排除时,该 A 不进候选
g=withWeapons(mkG('identity',[{role:'zhong'},{role:'zhu'}]));
g.players[0].hand.push({id:'jd',name:'借刀杀人',suit:'♠',rank:5});
assert.strictEqual(jiedaoA(g).length,0,'唯一的B是主公时,忠臣的阶段A候选应为空');

// 组队模式零回归:仍排除"被逼互杀的两人同队"(sameTeam(A,B));叠加 harmful 之后,
// 施术者自己的队友同样不能被选成被杀方(botTargetPolicyAllows 在 team 模式即 sameTeam),
// 于是"让队友A去杀敌人B"是唯一合理组合——正是这条要保住。
g=withWeapons(mkG('team',[{team:1},{team:1},{team:2},{team:2}]));
g.players[0].hand.push({id:'jd',name:'借刀杀人',suit:'♠',rank:5});
assert.ok(!jiedaoB(g,2).includes(3),'组队模式仍不得让同队(A与B同队)互杀');
assert.ok(!jiedaoB(g,2).includes(1),'组队模式不得把自己的队友选成被杀方');
assert.ok(jiedaoB(g,1).includes(2)&&jiedaoB(g,1).includes(3),'让队友A去杀敌方B仍然可选');

// ffa 零回归
g=withWeapons(mkG('ffa',[{},{},{}]));
g.players[0].hand.push({id:'jd',name:'借刀杀人',suit:'♠',rank:5});
// ffa:唯一变化是施术者自己不再是合法的被杀方(harmful 策略不允许把有害效果指向自己)
// ——"花一张借刀让别人来杀我"本来就不该是候选,这是顺带修正,不是回归。
assert.strictEqual(jiedaoB(g,1).sort().join(','),'2','ffa 模式除"自己"外候选不变');

// ===== 离间 =====
// 身份局:座位0=貂蝉(忠臣,女性),其余为男性
// 说明:harmful 只施加在 B(被指定为决斗目标、真正被逼承受伤害的一方)。A 是被逼"使用"
// 决斗的人,可能掉血也可能赢,若也套 harmful 会把"让主公去决斗反贼"这种正常好棋封死
// (组队模式下更会让离间彻底无解),故 A 侧只保留既有的 sameTeam/男性/存活条件。
g=mkG('identity',[{role:'zhong',general:'diaochan'},{role:'zhu'},{role:'fan',revealed:true},{role:'zhong',revealed:true}]);
assert.ok(!lijianB(g,2).includes(1),'忠臣不得把主公选成【决斗】的承受方');
assert.ok(!lijianB(g,2).includes(3),'忠臣不得把已知忠臣选成【决斗】的承受方');
assert.ok(lijianB(g,1).includes(2),'已知反贼仍可作为承受方');

// 身份局:反贼貂蝉不得把已知反贼推进决斗
g=mkG('identity',[{role:'fan',general:'diaochan'},{role:'fan',revealed:true},{role:'zhu'},{role:'zhong',revealed:true}]);
assert.ok(!lijianB(g,2).includes(1),'反贼不得把已知反贼选成【决斗】的承受方');
assert.ok(lijianB(g,1).includes(2)&&lijianB(g,1).includes(3),'主公/已知忠臣仍可作为承受方');

// 组队零回归 + ffa 零回归
g=mkG('team',[{team:1,general:'diaochan'},{team:1},{team:2},{team:2}]);
assert.ok(!lijianB(g,2).includes(3),'组队模式仍不得让同队互相决斗');
assert.ok(!lijianB(g,1).includes(0),'组队模式不得把自己(施术者)选成承受方');
assert.ok(lijianA(g).includes(1),'组队模式仍可让队友A去决斗敌人(既有好棋不被封掉)');
assert.ok(lijianB(g,1).includes(2)&&lijianB(g,1).includes(3),'敌方仍可作为承受方');
g=mkG('ffa',[{general:'diaochan'},{},{},{}]);
assert.strictEqual(lijianB(g,1).sort().join(','),'2,3','ffa 模式离间候选不变');

console.log('CORE-164 jiedao/lijian faction policy: all passed');
