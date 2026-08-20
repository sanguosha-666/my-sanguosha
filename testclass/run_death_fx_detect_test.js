const vm=require('vm');
const fs=require('fs');
const assert=require('assert');

const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document;
context.window.firebase=context.firebase;
context.global=context;
const sandbox=vm.createContext(context);
// render.js 顶层绑定了 closeRoomBtn.onclick=cleanupRoom(定义在 room-lifecycle.js),
// 因此沙箱需先加载 room-lifecycle.js 才能承载 render.js。
['config.js','data.js','room-lifecycle.js','render.js'].forEach(file=>{
  vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
});
function R(code){return vm.runInContext(code,sandbox);}

let passed=0, failed=0;
function check(name,fn){
  try{ fn(); passed++; console.log('PASS '+name); }
  catch(e){ failed++; console.log('FAIL '+name+' -- '+e.message); }
}

const playersOf=(aliveArr)=>aliveArr.map((al,i)=>({name:'p'+i,alive:al}));

// 触发记录
sandbox.__fired=[];
sandbox.__portraitFired=[];
R('mySeat=0;');
// 浏览器中 window===全局对象,game-bg.js 的 triggerDeathFx 挂到 window 后 render.js 的裸标识符
// 引用即可解析;vm 沙箱的 context.window 是独立对象,需同时挂到全局才等价,故两者都设置。
R('window.triggerDeathFx=function(kind){ global.__fired.push(kind); };');
R('triggerDeathFx=window.triggerDeathFx;');
R('window.triggerDeathPortraitFx=function(seat){ global.__portraitFired.push(seat); };');
R('triggerDeathPortraitFx=window.triggerDeathPortraitFx;');

check('首次调用(无基线)不触发', function(){
  sandbox.__fired=[];
  const g={started:true,players:playersOf([true,true,true])};
  sandbox.__g=g;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths(__g)');
  assert.strictEqual(sandbox.__fired.length,0,'首次不应触发');
});

check('alive true→false 且非本人触发 other', function(){
  sandbox.__fired=[];
  sandbox.__portraitFired=[];
  const g1={started:true,players:playersOf([true,true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,false,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.deepStrictEqual(sandbox.__fired,['other'],'座位1死亡应触发 other');
  assert.deepStrictEqual(sandbox.__portraitFired,[1],'座位1应触发武将立绘碎裂');
});

check('本人死亡触发 self', function(){
  sandbox.__fired=[];
  sandbox.__portraitFired=[];
  R('lastAliveSnapshot=null; __fired=[]; mySeat=0;');
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([false,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.deepStrictEqual(sandbox.__fired,['self'],'座位0死亡应触发 self');
  assert.deepStrictEqual(sandbox.__portraitFired,[0],'本人也应触发武将立绘碎裂');
});

check('碎裂视觉异常不阻断既有死亡特效', function(){
  sandbox.__fired=[];
  R("lastAliveSnapshot=null; triggerDeathPortraitFx=function(){ throw new Error('visual only'); };");
  sandbox.__a=playersOf([true,true]);
  R('checkDeaths({started:true,players:__a})');
  sandbox.__a=playersOf([true,false]);
  R('checkDeaths({started:true,players:__a})');
  assert.deepStrictEqual(sandbox.__fired,['other'],'碎裂失败后既有特效仍须触发');
  R('triggerDeathPortraitFx=window.triggerDeathPortraitFx;');
});

check('无变化不重复触发', function(){
  sandbox.__fired=[];
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'无变化不应触发');
});

check('未开局(started=false)重置基线不触发', function(){
  sandbox.__fired=[];
  R('lastAliveSnapshot=null; __fired=[];');
  const g1={started:true,players:playersOf([true,true])};
  sandbox.__a=g1.players;
  R('checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:false,players:playersOf([true,false])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:false,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'未开局应重置且不触发');
});

check('人数变化(机器人增删)不触发', function(){
  sandbox.__fired=[];
  const g1={started:true,players:playersOf([true,true,true])};
  sandbox.__a=g1.players;
  R('lastAliveSnapshot=null; __fired=[]; checkDeaths({started:true,players:__a})');
  sandbox.__fired=[];
  const g2={started:true,players:playersOf([true,true])};
  sandbox.__a=g2.players;
  R('checkDeaths({started:true,players:__a})');
  assert.strictEqual(sandbox.__fired.length,0,'人数变化不应触发');
});

// 加载实际视觉实现，用最小 DOM 验证它确实生成 1 个底图、9 个碎片和 1 层裂纹，
// 而不是只验证 render.js 调到了一个同名桩函数。
R(`
  (function(){
    function style(){ return {setProperty:function(k,v){this[k]=v;}}; }
    function avatar(){ return {className:'avatar'}; }
    function art(){
      return {className:'seat-art',style:style(),children:[],
        querySelector:function(sel){return sel==='.avatar'?avatar():null;},
        cloneNode:function(){return art();},
        appendChild:function(n){this.children.push(n);n.parentNode=this;return n;}};
    }
    var sourceArt=art();
    var card={querySelector:function(sel){return sel==='.seat-art'?sourceArt:null;},
      getBoundingClientRect:function(){return {left:10,top:20,width:120,height:160};}};
    document.body={children:[],appendChild:function(n){this.children.push(n);n.parentNode=this;global.__deathFxNode=n;return n;},
      removeChild:function(n){this.children=this.children.filter(function(x){return x!==n;});}};
    document.querySelector=function(sel){return sel==='.seat[data-seat="2"]'?card:null;};
    document.createElement=function(){return {className:'',style:style(),children:[],setAttribute:function(){},
      appendChild:function(n){this.children.push(n);n.parentNode=this;return n;}};};
    global.__realSetTimeout=setTimeout;
    setTimeout=function(fn){global.__deathCleanup=fn;return 1;};
  })();
`);
vm.runInContext(fs.readFileSync('game-bg.js','utf8'),sandbox,{filename:'game-bg.js'});

check('实际视觉实现生成九块立绘碎片并安排自动清理', function(){
  assert.strictEqual(R('triggerDeathPortraitFx(2)'),true,'有效座位应成功生成动画');
  assert.strictEqual(R('__deathFxNode.children.length'),11,'应包含底图+9碎片+裂纹层');
  assert.strictEqual(R('__deathFxNode.children.filter(function(n){return n.className==="death-shatter-shard";}).length'),9,'碎片必须为9块');
  assert.strictEqual(R('typeof __deathCleanup'),'function','必须安排自动清理');
});

console.log('death fx detect tests: '+passed+'/'+(passed+failed)+' passed');
process.exit(failed?1:0);
