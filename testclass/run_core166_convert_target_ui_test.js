/**
 * CORE-166(issue #225)回归锁定:徐晃【断粮】/甘宁【奇袭】/庞统【连环】以及实体
 * 【铁索连环】的选目标 UI 原本各自手写了一份"看起来够用"的点击条件(断粮只查距离≤2、
 * 奇袭只查"目标身上有牌"、铁索两处只查存活),没有复用服务端同一个 canTarget。
 * 结果帷幕/智迟/判定区已有同名等被服务端拦下的目标在界面上仍画成朱红虚线可点,
 * 玩家点了却被静默拒绝——表现为"点了没反应"。
 *
 * 本测试真实驱动 render(g)(document.createElement 全部替换成可记录的桩节点),
 * 按座位卡实际拿到的 onclick/title/角标做行为断言,不是源码文本扫描。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
let created=[];
function mkEl(tag){
  const e={tagName:tag,children:[],dataset:{},style:{setProperty(){},removeProperty(){},getPropertyValue(){return '';}},classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    innerHTML:'',textContent:'',title:'',className:'',id:'',value:'',onclick:null,onchange:null,
    appendChild(c){this.children.push(c);return c;},removeChild(){},insertBefore(){},remove(){},
    setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){},
    querySelector(){return null;},querySelectorAll(){return[];},
    getBoundingClientRect(){return{left:0,top:0,width:10,height:10,right:10,bottom:10};},
    closest(){return null;},focus(){},scrollIntoView(){}};
  created.push(e);return e;
}
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(id){const e=mkEl('div');e.id=id;return e;},createElement:mkEl,createTextNode:t=>({textContent:t}),createDocumentFragment:()=>mkEl('frag'),
    querySelector(){return null;},querySelectorAll(){return[];},body:mkEl('body'),head:mkEl('head'),addEventListener(){},removeEventListener(){}},
  window:{location:{search:'',href:'http://localhost'},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,alert(){},confirm(){return true;},open(){},innerWidth:1280,innerHeight:800,matchMedia(){return{matches:false,addEventListener(){}};},speechSynthesis:{cancel(){},speak(){}},navigator:{userAgent:'test'},requestAnimationFrame(){return 0;}},
  Audio:function(){return{play(){return Promise.resolve();},pause(){},addEventListener(){}};},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,parseFloat,isNaN,setTimeout,clearTimeout,requestAnimationFrame(){return 0;}
};
context.window.document=context.document;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','render-table.js','render-hand.js','render-controls.js','render-log.js','render-discard.js','game-bg.js','render.js']
  .forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=c=>vm.runInContext(c,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(n,gen)=>({name:n,general:gen,hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});

// 驱动一次真实 render(g),返回每个座位卡的 {可点?, title, 角标文本}
function renderSeats(g, setup){
  created=[];
  sandbox.__g=g;
  R("selectedCardIdx=null;duanliangMode=false;duanliangCardIdx=null;qixiMode=false;qixiCardIdx=null;lianhuanMode=false;lianhuanCardIdx=null;lianhuanTargets=[];tiesuoTargets=[];");
  R(setup);
  // 座位区在 render() 的前半段就已经建好;后半段的手牌/布局代码依赖更完整的浏览器
  // API(getComputedStyle/字体测量等),在这个轻量桩里会抛错——座位卡的断言不受影响,
  // 这里捕获并忽略,只要座位节点已经产出即可。
  try{ R("render(__g)"); }catch(e){ /* 见上 */ }
  const seats=created.filter(e=>typeof e.className==='string' && e.className.indexOf('seat')===0);
  assert.strictEqual(seats.length,g.players.length,'必须真的渲染出全部座位卡(否则下面的断言等于没跑)');
  const bySeat={};
  seats.forEach(e=>{ bySeat[Number(e.dataset.seat)]={clickable:!!e.onclick, title:e.title||'', html:e.innerHTML||''}; });
  return bySeat;
}
function base(myGeneral, others){
  const g={players:[mk('我',myGeneral)].concat(others.map((o,idx)=>mk('P'+(idx+1),o))),
    deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',
    pending:null,exchangeCards:[],started:true};
  g.players.forEach((p,i)=>{ if(i>0) p.hand=[{id:'h'+i,name:'闪',suit:'♦',rank:2}]; });
  return g;
}

// ===== 断粮(徐晃):黑色基本牌当兵粮寸断,距离≤2 =====
let g=base('xuhuang',['jiaxu','liubei']);           // 座位1=贾诩(帷幕)
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
let s=renderSeats(g,"duanliangMode=true;duanliangCardIdx=0;");
assert.strictEqual(s[2].clickable,true,'断粮:普通目标应可点');
assert.strictEqual(s[1].clickable,false,'断粮:帷幕角色不得可点(黑色锦囊免疫)');
assert.ok(s[1].title.indexOf('兵粮寸断')>=0,'断粮:帷幕目标应给出不可选说明');
assert.ok(s[1].html.indexOf('不可选')>=0,'断粮:帷幕目标应带"不可选"角标');

g=base('xuhuang',['liubei','liubei']);
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
g.players[1].delays=[{id:'d1',name:'兵粮寸断',suit:'♣',rank:6}];  // 判定区已有同名
s=renderSeats(g,"duanliangMode=true;duanliangCardIdx=0;");
assert.strictEqual(s[1].clickable,false,'断粮:判定区已有兵粮寸断时不得可点');
assert.strictEqual(s[2].clickable,true,'断粮:其他目标不受影响');

// 距离外仍保留"够不着"角标(既有行为零回归):7 人局座位 3 距离 3 > 2
g=base('xuhuang',['liubei','liubei','liubei','liubei','liubei','liubei']);
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
s=renderSeats(g,"duanliangMode=true;duanliangCardIdx=0;");
assert.strictEqual(s[3].clickable,false,'断粮:距离3的目标不可点');
assert.ok(s[3].html.indexOf('够不着')>=0,'断粮:距离外仍用"够不着"角标,不改成"不可选"');

// ===== 奇袭(甘宁):黑色手牌当过河拆桥 =====
g=base('ganning',['jiaxu','liubei']);
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
s=renderSeats(g,"qixiMode=true;qixiCardIdx=0;");
assert.strictEqual(s[2].clickable,true,'奇袭:普通目标应可点');
assert.strictEqual(s[1].clickable,false,'奇袭:帷幕角色不得可点');
assert.ok(s[1].html.indexOf('不可选')>=0,'奇袭:帷幕目标应带"不可选"角标');

g=base('ganning',['liubei','liubei']);
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
g.zhichiImmunity={seat:1,turn:0};
s=renderSeats(g,"qixiMode=true;qixiCardIdx=0;");
assert.strictEqual(s[1].clickable,false,'奇袭:智迟免疫目标不得可点');
assert.strictEqual(s[2].clickable,true,'奇袭:其他目标不受影响');

g=base('ganning',['liubei','liubei']);
g.players[0].hand=[{id:'b1',name:'杀',suit:'♠',rank:5}];
g.players[1].hand=[];   // 身上没有任何牌
s=renderSeats(g,"qixiMode=true;qixiCardIdx=0;");
assert.strictEqual(s[1].clickable,false,'奇袭:目标无牌时不可点');
assert.ok(s[1].html.indexOf('无牌')>=0,'奇袭:无牌仍用"无牌"角标,不改成"不可选"');

// ===== 连环(庞统,♣牌当铁索连环) =====
g=base('pangtong',['jiaxu','liubei']);
g.players[0].hand=[{id:'c1',name:'杀',suit:'♣',rank:5}];
s=renderSeats(g,"lianhuanMode=true;lianhuanCardIdx=0;");
assert.strictEqual(s[2].clickable,true,'连环:普通目标应可点');
assert.strictEqual(s[1].clickable,false,'连环:帷幕角色不得可点');
assert.strictEqual(s[0].clickable,true,'连环:allowSelf,自己仍可选');

g=base('pangtong',['liubei','liubei']);
g.players[0].hand=[{id:'c1',name:'杀',suit:'♣',rank:5}];
g.zhichiImmunity={seat:1,turn:0};
s=renderSeats(g,"lianhuanMode=true;lianhuanCardIdx=0;");
assert.strictEqual(s[1].clickable,false,'连环:智迟免疫目标不得可点');

// ===== 实体【铁索连环】 =====
g=base('liubei',['jiaxu','liubei']);
g.players[0].hand=[{id:'t1',name:'铁索连环',suit:'♠',rank:12}];
s=renderSeats(g,"selectedCardIdx=0;");
assert.strictEqual(s[2].clickable,true,'铁索:普通目标应可点');
assert.strictEqual(s[1].clickable,false,'铁索:帷幕角色不得可点');
assert.strictEqual(s[0].clickable,true,'铁索:allowSelf,自己仍可选');

console.log('CORE-166 convert-target UI canTarget: all passed');
