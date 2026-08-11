/**
 * 修复"本地机器人服务可行性调查"顺带发现的既有 bug(与 Node 迁移工程无关)。
 *
 * Bug1 guhuoTarget 未登记 BOT_PHASE_ACTOR —— botSeatForState 恒返回 -1,
 *      BOT_SEAT_PICKS.guhuoTarget 那套早就写好的接入是死代码;而该阶段
 *      renderControls 只渲染 banner+座位卡高亮、不产生任何 #controls 按钮,
 *      botSafePrompt 一个按钮都点不到 → 真正的永久卡死。
 * Bug2 quhuDamageChoice 未登记 BOT_PHASE_ACTOR —— 同一类漏登记。该阶段有按钮,
 *      但文案("令X对Y造成1点伤害")不命中 botSafePrompt 的安全/必选正则,
 *      只有"目标恰好1个"时才靠"唯一按钮"兜底侥幸走通,≥2个目标即卡死。
 * Bug3 机器人点到 confirmAndPlay 类按钮时,把真人专属的二次确认框弹了出来,
 *      而机器人自己的动作永远不执行(决策被静默转交给人类)。
 *      真实可达路径:wuxie(在 ALLOWLIST、不在 EXCLUDE,无密钥也由 L1 接管)
 *      + 于吉【蛊惑】(addGuhuoResponseButtons 挂的 onclick 就是 confirmAndPlay)。
 *
 * Bug4(zhimengPick label 渲染成 "undefined")经复核为【调查阶段的假阳性】:
 *      是当时合成测试数据把 options 写成了 ['A','B'] 字符串导致的,真实
 *      getZhimengOptions 永远带 label。本文件最后一条用真实服务端函数产出的
 *      options 钉住这个结论,防止以后又被误报成 bug。
 */
const vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=__dirname;
let pass=0, fail=0;
const QUEUE=[];
// check 支持同步/异步两种 fn:异步的必须 await,否则 fn 只是返回一个 promise、
// 断言还没跑就被记成 PASS(第一版就踩了这个坑,两条 runBotDecision 用例是假通过)。
function check(name, fn){ QUEUE.push({name,fn}); }
function section(title){ QUEUE.push({section:title}); }
async function runAll(){
  for(const item of QUEUE){
    if(item.section){ console.log(item.section); continue; }
    try{ await item.fn(); console.log('  PASS', item.name); pass++; }
    catch(e){ console.log('  FAIL', item.name, '-', (e&&e.message||e)); fail++; }
  }
}

function mkEl(tag){
  const el={tagName:String(tag).toUpperCase(),children:[],style:{},_text:'',_html:'',id:'',className:'',
    disabled:false,onclick:null,parentEl:null,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(c){c.parentEl=el;el.children.push(c);return c;},
    removeChild(c){const i=el.children.indexOf(c);if(i>=0){el.children.splice(i,1);c.parentEl=null;}return c;},
    remove(){if(el.parentEl)el.parentEl.removeChild(el);},
    set textContent(v){el._text=String(v==null?'':v);}, get textContent(){return el._text;},
    set innerHTML(v){el._html=String(v==null?'':v);el.children=[];}, get innerHTML(){return el._html;},
    click(){if(typeof el.onclick==='function')el.onclick();},
    setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){},
    querySelector(){return null;},
    querySelectorAll(){const out=[];(function w(n){if(n!==el&&n.tagName==='BUTTON'&&!n.disabled)out.push(n);(n.children||[]).forEach(w);})(el);return out;}};
  return el;
}
function makeEnv(){
  const realControls=mkEl('div'); realControls.id='controls';
  const bodyEl=mkEl('body'); bodyEl.appendChild(realControls);
  const documentStub={ body:bodyEl, head:mkEl('head'),
    getElementById(id){let f=null;(function w(n){if(f)return;if(n.id===id){f=n;return;}(n.children||[]).forEach(w);})(bodyEl);return f||mkEl('div');},
    createElement(t){return mkEl(t);}, createTextNode(t){return{nodeValue:t,textContent:t};},
    createDocumentFragment(){return mkEl('frag');},
    querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){}, removeEventListener(){} };
  const context={
    gameRef:{transaction(fn){ try{ return fn(context._g||{}); }catch(e){ context.__txErr=String(e&&e.message); } }},
    firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},push(){return{set(){},key:'k'};},transaction(){return{};},set(){},update(){},child(){return this;},remove(){},get(){return{val(){return null;}};}};}};}};},database(){return this.initializeApp().database();}},
    document:documentStub, setBanner(){},
    // 逐字照抄 render.js 的真实实现——注意是 String(s) 不是 String(s==null?'':s):
    // 后者会把 undefined 变成空串,恰好掩盖 Bug4 要钉住的那个现象。
    escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));},
    window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
      sessionStorage:{getItem(){return null;},setItem(){}},addEventListener(){},removeEventListener(){},
      setTimeout,clearTimeout,setInterval,clearInterval,alert(){},confirm(){return true;},
      navigator:{userAgent:'test'},matchMedia(){return{matches:false,addEventListener(){}};}},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    sessionStorage:{getItem(){return null;},setItem(){}},
    joinRoom(){}, mySeat:0, console:{log(){},warn(){},error(){}},
    Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,parseFloat,isNaN,
    setTimeout,clearTimeout,setInterval,clearInterval,
    fetch:()=>Promise.resolve({ok:false,status:0,text:()=>Promise.resolve(''),json:()=>Promise.resolve({})}),
    AbortController:function(){this.signal=null;this.abort=()=>{};} };
  context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
  const sb=vm.createContext(context);
  for(const f of ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','bot-ai-bus.js','bot.js','ai-bot.js','render-controls.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sb,{filename:f});
  // render.js 顶层有立即执行的 DOM 绑定,不整体加载;按 render.js 真实实现复刻这几个函数
  // (confirmAndPlay 必须连同这次新增的 botClickInProgress 旁路一起复刻,否则测不到修复)。
  vm.runInContext(`
    __confirmCalls=0;
    function showConfirm(message,onOk,onCancel){ __confirmCalls++; /* 真人路径:等人点确定 */ }
    function resetSelectionState(){}
    function render(){}
    function confirmAndPlay(message, actionFn){
      if(typeof botClickInProgress !== 'undefined' && botClickInProgress){ actionFn(); return; }
      showConfirm(message, function(){ actionFn(); }, function(){});
    }
  `,sb);
  return {context,sb,realControls,bodyEl};
}
function card(n,id,suit,rank){return {id,name:n,suit:suit||'♥',rank:rank||5};}
function baseG(sb,phase,generals,n){
  const emptyEq=vm.runInContext('emptyEquips',sb);
  const players=[]; const cnt=n||4;
  for(let i=0;i<cnt;i++) players.push({name:'P'+i,cid:i===cnt-1?'human':null,isBot:i!==cnt-1,alive:true,hp:3,maxHp:4,
    hand:[card('杀','h'+i+'a','♠',7),card('闪','h'+i+'b','♦',2)],
    equips:emptyEq(),delays:[],general:(generals&&generals[i])||'zhangfei',role:null,buquCards:[]});
  return {phase,turn:0,roundNum:1,started:true,players,gameMode:'ffa',
    deck:Array.from({length:20},(_,i)=>card('杀','d'+i,'♠',(i%13)+1)),
    discard:[],log:[],exchangeCards:[],pending:null,aoe:null,shaUsed:false,
    roundSeatsActed:[],guhuoUsed:false,wanshaActive:false,wanshaDyingSeat:null};
}

console.log('\n== 调查顺带发现的既有 bug 修复验证 ==\n');

// ---------------- Bug1: guhuoTarget ----------------
section('-- Bug1: 于吉【蛊惑】选目标 guhuoTarget 漏登记 BOT_PHASE_ACTOR --');

check('Bug1 登记已补齐:BOT_PHASE_ACTOR.guhuoTarget === "sourceSeat"(与服务端守卫字段一致)', ()=>{
  const env=makeEnv();
  const f=vm.runInContext('BOT_PHASE_ACTOR.guhuoTarget',env.sb);
  if(f!=='sourceSeat') throw new Error('应登记为 sourceSeat,实际 '+f);
  // 与服务端 guhuoChooseTarget 的身份守卫字段对齐(skills.js: pending.sourceSeat!==mySeat)
  const src=fs.readFileSync(path.join(ROOT,'skills.js'),'utf8');
  if(!/g\.pending\.sourceSeat!==mySeat/.test(src))
    throw new Error('服务端守卫字段与登记不一致,需要重新核对');
});

check('Bug1 修复效果:botSeatForState 能解析出行动者(修复前恒为 -1)', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'guhuoTarget',['yuji','zhangfei','zhangfei','zhangfei']);
  g.pending={type:'guhuoTarget',sourceSeat:0,
    actualCard:card('闪','a1','♦',2), claimedCard:card('杀','c1','♠',7)};
  env.context._g=g; env.sb.__g=g;
  const seat=vm.runInContext('botSeatForState(__g)',env.sb);
  if(seat!==0) throw new Error('应解析出座位0,实际 '+seat);
  const known=vm.runInContext('BOT_KNOWN_PHASES.has("guhuoTarget")',env.sb);
  if(!known) throw new Error('应进入 BOT_KNOWN_PHASES');
});

check('Bug1 卡死复现依据:该阶段确实不渲染任何 #controls 按钮(所以兜底救不了)', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'guhuoTarget',['yuji','zhangfei','zhangfei','zhangfei']);
  g.pending={type:'guhuoTarget',sourceSeat:0,
    actualCard:card('闪','a1','♦',2), claimedCard:card('杀','c1','♠',7)};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext('mySeat=3;',env.sb);
  const n=vm.runInContext('(function(){var r=collectControlsCandidates(__g,0);var n=r.candidates.length;if(r.dispose)r.dispose();return n;})()',env.sb);
  if(n!==0) throw new Error('预期0个按钮(证明botSafePrompt无从下手),实际 '+n);
});

check('Bug1 专用分支现在真的会被调用:runBotDecision 走到 seatPick 并提交目标', async()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'guhuoTarget',['yuji','zhangfei','zhangfei','zhangfei']);
  g.pending={type:'guhuoTarget',sourceSeat:0,
    actualCard:card('闪','a1','♦',2), claimedCard:card('杀','c1','♠',7)};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=3;",env.sb);
  vm.runInContext('__picked=null; guhuoChooseTarget=function(t){ __picked=t; };',env.sb);
  const seat=vm.runInContext('botSeatForState(__g)',env.sb);
  await vm.runInContext('runBotDecision(__g,'+seat+')',env.sb);
  const picked=vm.runInContext('__picked',env.sb);
  if(picked===null) throw new Error('机器人应选出一个蛊惑目标,实际没有调用 guhuoChooseTarget');
  if(picked===0) throw new Error('不应选自己(杀不能对自己使用),实际 '+picked);
});

// ---------------- Bug2: quhuDamageChoice ----------------
section('-- Bug2: 荀彧【驱虎】选伤害目标 quhuDamageChoice 漏登记 --');

check('Bug2 登记已补齐:BOT_PHASE_ACTOR.quhuDamageChoice === "seat"(与服务端守卫一致)', ()=>{
  const env=makeEnv();
  const f=vm.runInContext('BOT_PHASE_ACTOR.quhuDamageChoice',env.sb);
  if(f!=='seat') throw new Error('应登记为 seat,实际 '+f);
  const src=fs.readFileSync(path.join(ROOT,'skills.js'),'utf8');
  if(!/g\.phase!=='quhuDamageChoice'[\s\S]{0,160}?g\.pending\.seat!==mySeat/.test(src))
    throw new Error('服务端守卫字段与登记不一致,需要重新核对');
});

check('Bug2 修复效果:botSeatForState 能解析出行动者(修复前恒为 -1)', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'quhuDamageChoice');
  g.pending={type:'quhuDamageChoice',seat:0,targetSeat:1,targets:[1,2]};
  env.context._g=g; env.sb.__g=g;
  const seat=vm.runInContext('botSeatForState(__g)',env.sb);
  if(seat!==0) throw new Error('应解析出座位0,实际 '+seat);
});

check('Bug2 卡死复现依据:≥2个目标时按钮文案不命中 botSafePrompt 任何正则', ()=>{
  const safeRe=/不发动|不使用|不出|不获得|取消|跳过|放弃|结束/;
  const mandRe=/选择|交给|弃置|摸牌|回复|打出/;
  const label='令 P1 对 P2 造成1点伤害';
  if(safeRe.test(label)) throw new Error('不该命中安全正则');
  if(!/发动/.test(label) && mandRe.test(label)) throw new Error('不该命中必选正则');
  // 两个按钮都不命中 → botSafePrompt 的 (buttons.length===1?buttons[0]:null) 也救不了
});

check('Bug2 专用分支现在真的会被调用:runBotDecision 提交一个伤害目标', async()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'quhuDamageChoice');
  g.pending={type:'quhuDamageChoice',seat:0,targetSeat:1,targets:[1,2]};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=3;",env.sb);
  vm.runInContext('__dmg=null; respondQuhuDamage=function(t){ __dmg=t; };',env.sb);
  const seat=vm.runInContext('botSeatForState(__g)',env.sb);
  await vm.runInContext('runBotDecision(__g,'+seat+')',env.sb);
  const dmg=vm.runInContext('__dmg',env.sb);
  if(dmg===null) throw new Error('机器人应选出一个伤害目标,实际没有调用 respondQuhuDamage');
  if(![1,2].includes(dmg)) throw new Error('应从 targets=[1,2] 里选,实际 '+dmg);
});

// ---------------- Bug3: 机器人点击不该弹真人确认框 ----------------
section('-- Bug3: 机器人点到 confirmAndPlay 按钮时弹出真人专属确认框 --');

function wuxieGuhuoEnv(){
  const env=makeEnv();
  const g=baseG(env.sb,'wuxie',['yuji','zhangfei','zhangfei'],3);
  g.pending={type:'wuxie',asking:0,from:1,to:1,trick:'过河拆桥',depth:0,exclude:[],resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=2;",env.sb);
  vm.runInContext('__confirmCalls=0; __acted=0; startGuhuoResponse=function(){ __acted++; };',env.sb);
  return env;
}

check('Bug3 前提仍成立:wuxie 由 L1 接管(ALLOWLIST,无密钥也接管)且能收集到蛊惑按钮', ()=>{
  const env=wuxieGuhuoEnv();
  if(!vm.runInContext('controlsChoiceMatch(__g,0)',env.sb)) throw new Error('controlsChoiceMatch 应为 true');
  const labels=JSON.parse(vm.runInContext(
    '(function(){var r=collectControlsCandidates(__g,0);var o=JSON.stringify(r.candidates.map(function(c){return c.label;}));if(r.dispose)r.dispose();return o;})()',env.sb));
  if(!labels.some(l=>/蛊惑/.test(l))) throw new Error('未收集到蛊惑按钮,labels='+JSON.stringify(labels));
});

check('Bug3 修复:经 controlsChoiceExecute 点击 → 不弹确认框,动作直接执行', ()=>{
  const env=wuxieGuhuoEnv();
  vm.runInContext(`
    var res=collectControlsCandidates(__g,0);
    controlsChoiceCtx=res;
    var pick=res.candidates.filter(function(c){return /蛊惑/.test(c.label);})[0];
    __had=!!pick;
    if(pick) controlsChoiceExecute(__g,0,pick);
  `,env.sb);
  if(!vm.runInContext('__had',env.sb)) throw new Error('前提不成立:没有蛊惑按钮');
  const confirms=vm.runInContext('__confirmCalls',env.sb);
  const acted=vm.runInContext('__acted',env.sb);
  if(confirms!==0) throw new Error('机器人点击不应弹确认框,实际弹了 '+confirms+' 次');
  if(acted!==1) throw new Error('真实动作应执行1次,实际 '+acted+' 次');
});

check('Bug3 修复:botSafePrompt 兜底路径点到 confirmAndPlay 按钮时同样不弹确认框', ()=>{
  // 【为什么要另造场景】wuxie+于吉 实际渲染出的按钮是
  // ["蛊惑:手牌【杀】当【无懈可击】","蛊惑:手牌【闪】当【无懈可击】","不出"],
  // botSafePrompt 的安全正则会先命中"不出",走不到 confirmAndPlay 按钮上——也就是说
  // 这条兜底路径目前没有已知的真实可达场景。但 botSafePrompt 和 L1 是两个独立的点击
  // 入口,兜底同样必须遵守"机器人点击不弹真人确认框"这条约定,否则以后某个只渲染
  // confirmAndPlay 按钮的新阶段一出现就会再犯同一个错。这里用一个只有单个
  // confirmAndPlay 按钮的受控渲染,直接把 botSafePrompt 自己那条 click 路径钉住。
  const env=wuxieGuhuoEnv();
  vm.runInContext(`
    __acted=0; __confirmCalls=0; __seen=null;
    renderControls=function(){
      var box=document.getElementById('controls');
      var b=document.createElement('button');
      b.textContent='发动【某技能】';   // 刻意不命中安全/必选正则 → 走"唯一按钮"兜底
      b.onclick=function(){ confirmAndPlay('确定发动？', function(){ __acted++; __seen=botClickInProgress; }); };
      box.appendChild(b);
    };
    __ret = botSafePrompt(__g, 0);
  `,env.sb);
  if(vm.runInContext('__ret',env.sb)!==true) throw new Error('botSafePrompt 应点到那个唯一按钮并返回 true');
  if(vm.runInContext('__confirmCalls',env.sb)!==0)
    throw new Error('机器人兜底点击不应弹确认框,实际弹了 '+vm.runInContext('__confirmCalls',env.sb)+' 次');
  if(vm.runInContext('__acted',env.sb)!==1) throw new Error('真实动作应执行1次');
  if(vm.runInContext('__seen',env.sb)!==true) throw new Error('动作执行时标志位应为 true');
  if(vm.runInContext('botClickInProgress',env.sb)!==false) throw new Error('botSafePrompt 返回后标志位必须复位');
});

check('Bug3 不回归:真人点击(标志位为false)仍然正常弹确认框、不直接执行', ()=>{
  const env=wuxieGuhuoEnv();
  vm.runInContext(`
    var res=collectControlsCandidates(__g,0);
    var pick=res.candidates.filter(function(c){return /蛊惑/.test(c.label);})[0];
    botClickInProgress=false;          // 真人点击
    pick.invoke();
    if(res.dispose) res.dispose();
  `,env.sb);
  const confirms=vm.runInContext('__confirmCalls',env.sb);
  const acted=vm.runInContext('__acted',env.sb);
  if(confirms!==1) throw new Error('真人点击应弹1次确认框,实际 '+confirms);
  if(acted!==0) throw new Error('真人未点"确定"前动作不应执行,实际 '+acted);
});

check('Bug3 标志位卫生:controlsChoiceExecute 结束后必定复位(即使 invoke 抛错)', ()=>{
  const env=wuxieGuhuoEnv();
  vm.runInContext(`
    __threw=false;
    try{ controlsChoiceExecute(__g,0,{invoke:function(){ throw new Error('boom'); }}); }
    catch(e){ __threw=true; }
  `,env.sb);
  const flag=vm.runInContext('botClickInProgress',env.sb);
  if(flag!==false) throw new Error('异常路径后标志位也必须复位,实际 '+flag);
});

// ---------------- Bug4: 复核为假阳性 ----------------
section('-- Bug4(复核): zhimengPick label "undefined" 是调查阶段的假阳性 --');

check('Bug4 复核:真实 getZhimengOptions 产出的 options 恒带 label,渲染不含 undefined', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'zhimengPick');
  g.players[1].equips.weapon=card('青龙偃月刀','w1','♠',5);
  g.players[1].delays=[card('乐不思蜀','dl1','♥',6)];
  env.context._g=g; env.sb.__g=g;
  const opts=vm.runInContext('getZhimengOptions(__g,1)',env.sb);
  if(!opts.length) throw new Error('前提不成立:应产出候选');
  opts.forEach(o=>{ if(typeof o.label!=='string' || !o.label) throw new Error('label 缺失: '+JSON.stringify(o)); });
  g.pending={type:'zhimengPick',from:0,to:1,
    options:opts.map(o=>({type:o.type,label:o.label,index:o.index})),originalCtx:{}};
  env.sb.__g=g; env.context._g=g;
  vm.runInContext('mySeat=0;',env.sb);
  const html=String(vm.runInContext('renderZhimengPick(__g)',env.sb));
  const labels=[...html.matchAll(/>([^<]*)<\/button>/g)].map(m=>m[1]);
  if(!labels.length) throw new Error('应渲染出按钮');
  if(labels.some(l=>/undefined/.test(l)))
    throw new Error('真实数据下不应出现 undefined,labels='+JSON.stringify(labels));
});

check('Bug4 复核:只有把 options 写成裸字符串(调查时的合成数据)才会渲染出 undefined', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'zhimengPick');
  g.pending={type:'zhimengPick',from:0,to:1,options:['A','B'],originalCtx:{}};  // 当初的错误合成数据
  env.context._g=g; env.sb.__g=g;
  vm.runInContext('mySeat=0;',env.sb);
  const html=String(vm.runInContext('renderZhimengPick(__g)',env.sb));
  const labels=[...html.matchAll(/>([^<]*)<\/button>/g)].map(m=>m[1]);
  if(!labels.every(l=>l==='undefined'))
    throw new Error('本条用于钉住"假阳性成因",预期全是 undefined,实际 '+JSON.stringify(labels));
});

runAll().then(()=>{
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败\n');
  if(fail>0) process.exit(1);
});
