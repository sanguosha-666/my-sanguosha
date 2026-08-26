/**
 * CORE-172(issue #231):弃牌阶段"确认弃牌"按钮二次点击会读到已经被第一次点击清空的
 *   discardSelectedSet,提交空集合被服务端静默拒绝(表现为"点了确认没弃掉")。
 *   修复后:挂载时冻结选中快照,点击后立刻 disabled 防二次提交。
 * CORE-173(issue #232):"最近N次出牌"历史是纯客户端本地记忆,跨局残留——新局前两次出牌
 *   期间仍显示上一局的记录。修复后由 newGame()/backToLobby() 显式清空。
 *
 * 本测试真实驱动 renderControls(g)/pushRecentPlayHistory(),按按钮实际的 onclick 行为断言。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
let created=[];
function mkEl(tag){
  const e={tagName:tag,children:[],dataset:{},style:{setProperty(){},removeProperty(){},getPropertyValue(){return '';}},
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    innerHTML:'',textContent:'',title:'',className:'',id:'',value:'',disabled:false,onclick:null,onchange:null,
    appendChild(c){this.children.push(c);return c;},removeChild(){},insertBefore(){},remove(){},
    setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){},
    querySelector(){return null;},querySelectorAll(){return[];},
    getBoundingClientRect(){return{left:0,top:0,width:10,height:10,right:10,bottom:10};},closest(){return null;},focus(){}};
  created.push(e);return e;
}
const byId={};
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(id){ if(!byId[id]){ byId[id]=mkEl('div'); byId[id].id=id; } return byId[id]; },
    createElement:mkEl,createTextNode:t=>({textContent:t}),createDocumentFragment:()=>mkEl('frag'),
    querySelector(){return null;},querySelectorAll(){return[];},body:mkEl('body'),head:mkEl('head'),addEventListener(){},removeEventListener(){}},
  window:{location:{search:'',href:'http://localhost'},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,alert(){},confirm(){return true;},open(){},innerWidth:1280,innerHeight:800,matchMedia(){return{matches:false,addEventListener(){}};},speechSynthesis:{cancel(){},speak(){}},navigator:{userAgent:'test'},requestAnimationFrame(){return 0;}},
  Audio:function(){return{play(){return Promise.resolve();},pause(){},addEventListener(){}};},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,parseFloat,isNaN,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}
};
context.window.document=context.document;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','render-table.js','render-hand.js','render-controls.js','render-log.js','render-discard.js','game-bg.js','render.js']
  .forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};mySeat=0;");
// 记录 discardCards 的真实调用参数(不走服务端)
R("__discardCalls=[];discardCards=function(list){ __discardCalls.push(list.slice()); };");
const eq=()=>R('emptyEquips')();
const mk=(n)=>({name:n,general:'liubei',hp:2,maxHp:2,hand:[],equips:eq(),delays:[],alive:true});

// ===== CORE-172:确认弃牌按钮 =====
const g={players:[mk('我'),mk('乙')],deck:[],discard:[],log:[],phase:'discard',turn:0,
  roundNum:1,gameMode:'ffa',pending:null,exchangeCards:[],started:true};
g.players[0].hand=[{id:'a',name:'杀',suit:'♠',rank:2},{id:'b',name:'闪',suit:'♦',rank:3},
                   {id:'c',name:'桃',suit:'♥',rank:4}];  // 3张 > 体力2,需弃1张
sandbox.__g=g;
R("discardSelectedSet=new Set([0]);");
created=[];
R("renderControls(__g)");
const confirmBtn=created.find(e=>typeof e.textContent==='string' && e.textContent.indexOf('确认弃牌')===0);
assert.ok(confirmBtn,'弃牌阶段必须渲染出"确认弃牌"按钮');
assert.strictEqual(confirmBtn.disabled,false,'选够数量时按钮应可点');
confirmBtn.onclick();
assert.strictEqual(R("JSON.stringify(__discardCalls)"),'[[0]]','第一次点击应提交选中的那张牌');
assert.strictEqual(confirmBtn.disabled,true,'点击后按钮必须立刻 disabled,防二次提交');
confirmBtn.onclick();   // 模拟网络往返未完成时的误触双击
assert.strictEqual(R("JSON.stringify(__discardCalls)"),'[[0]]','二次点击不得再次提交(尤其不得提交空集合)');
assert.strictEqual(R("discardSelectedSet.size"),0,'第一次点击后选中集合应被清空');

// 选中数量不够时按钮仍然是禁用的(既有行为零回归)
R("discardSelectedSet=new Set();");
created=[];
R("renderControls(__g)");
const btn2=created.find(e=>typeof e.textContent==='string' && e.textContent.indexOf('确认弃牌')===0);
assert.strictEqual(btn2.disabled,true,'没选够时按钮应禁用');
R("__discardCalls=[];");
btn2.onclick();
assert.strictEqual(R("JSON.stringify(__discardCalls)"),'[]','禁用状态下点击不得提交');

// ===== CORE-173:最近出牌历史跨局清空 =====
assert.strictEqual(typeof R("resetRecentPlaysHistory"),'function','必须提供显式清空入口');
R("pushRecentPlayHistory(__g,[{seat:0,name:'杀',targets:[1]}]);");
assert.strictEqual(R("recentPlaysHistory.length"),1,'出牌应被记进历史');
R("resetRecentPlaysHistory()");
assert.strictEqual(R("recentPlaysHistory.length"),0,'清空入口必须真的清空');
assert.strictEqual(R("document.getElementById('recentPlaysHistory').innerHTML"),'','清空后 DOM 内容也应被清掉');

// 上限仍为 3(既有行为零回归)
R("for(var i=0;i<5;i++) pushRecentPlayHistory(__g,[{seat:0,name:'杀',targets:[1]}]);");
assert.strictEqual(R("recentPlaysHistory.length"),3,'FIFO 上限仍是 3');

// newGame()/backToLobby() 必须调用清空入口(源码接线检查:两处都要有)
const lifecycle=fs.readFileSync('room-lifecycle.js','utf8');
const newGameBody=lifecycle.slice(lifecycle.indexOf('function newGame()'), lifecycle.indexOf('function cleanupRoom()'));
const backBody=lifecycle.slice(lifecycle.indexOf('function backToLobby()'));
assert.ok(newGameBody.indexOf('resetRecentPlaysHistory')>=0,'newGame() 必须清空最近出牌历史');
assert.ok(backBody.indexOf('resetRecentPlaysHistory')>=0,'backToLobby() 必须清空最近出牌历史');

console.log('CORE-172/173 discard button + recent plays reset: all passed');
