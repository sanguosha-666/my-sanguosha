/**
 * 阶段0 调查产物:本地机器人服务(Node宿主)迁移的三项行为验收基线。
 *
 * 这个文件不是功能测试,是【迁移前的行为快照】——把阶段0 调查中用来判定
 * "DOM 宿主够不够用 / confirmAndPlay 是否对机器人可达 / controlsChoiceCtx
 * 单房间是否安全" 的三个复现场景固化下来,供后续阶段2/3 验收时对照。
 *
 * 详见 docs/local-bot-server-feasibility.md「阶段0 调查补全」一节。
 *
 * 【断言状态更新】文件初版有3条断言锁定的是"缺陷存在"这个现状。其中
 * confirmAndPlay 那条对应的缺陷已经在「调查顺带发现的既有bug」批次里修掉了
 * (bot.js 新增 botClickInProgress + render.js confirmAndPlay 旁路),该条断言
 * 已相应反转成修复后的正确命题,并补了一条"真人路径未被波及"的对照。
 * 剩余两条(shim 缺口 P1/P2)锁定的是 Node 最小 DOM shim 的语义缺口,属于
 * 迁移工程阶段3 的范围,尚未修复,断言维持"锁定缺陷"语义不变。
 */
const vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=__dirname;
let pass=0, fail=0;
function check(name, fn){ try{ fn(); console.log('  PASS', name); pass++; }
  catch(e){ console.log('  FAIL', name, '-', (e&&e.message||e)); fail++; } }

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
    document:documentStub, setBanner(){}, escapeHtml(s){return String(s==null?'':s);},
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
  // render.js 顶层有立即执行的 DOM 绑定,本测试不整体加载它;这里按 render.js:612-639
  // 的真实实现复刻 showConfirm/confirmAndPlay 的语义(确认框必须有人点"确定"动作才执行)。
  vm.runInContext(`
    __confirmCalls=0;
    function showConfirm(message,onOk,onCancel){ __confirmCalls++; /* 等人点确定,不自动调 onOk */ }
    function confirmAndPlay(message, actionFn){
      // 与 render.js 现状一致:机器人点击直接执行,不走确认框(既有bug修复批次)
      if(typeof botClickInProgress !== 'undefined' && botClickInProgress){ actionFn(); return; }
      showConfirm(message, function(){ actionFn(); }, function(){});
    }
    function resetSelectionState(){}
    function render(){}
  `,sb);
  return {context,sb,realControls,bodyEl};
}
function card(n,id,suit,rank){return {id,name:n,suit:suit||'♥',rank:rank||5};}
function baseG(sb,phase,generals){
  const emptyEq=vm.runInContext('emptyEquips',sb);
  const players=[];
  for(let i=0;i<3;i++) players.push({name:'P'+i,cid:i===2?'human':null,isBot:i!==2,alive:true,hp:3,maxHp:4,
    hand:[card('杀','h'+i+'a','♠',7),card('闪','h'+i+'b','♦',2)],
    equips:emptyEq(),delays:[],general:(generals&&generals[i])||'zhangfei',role:null,buquCards:[]});
  return {phase,turn:0,roundNum:1,started:true,players,gameMode:'ffa',
    deck:Array.from({length:20},(_,i)=>card('杀','d'+i,'♠',(i%13)+1)),
    discard:[],log:[],exchangeCards:[],pending:null,aoe:null,shaUsed:false,
    roundSeatsActed:[],guhuoUsed:false,wanshaActive:false,wanshaDyingSeat:null};
}

console.log('\n== 阶段0 行为基线:Node DOM 宿主探针 ==\n');

// ---------- 场景1:confirmAndPlay 对机器人是否可达(wuxie + 于吉蛊惑) ----------
// wuxie 在 CONTROLS_CHOICE_ALLOWLIST 里(无AI密钥也由L1接管)、且不在 EXCLUDE 里,
// 而 addGuhuoResponseButtons 在 wuxie 分支里挂的按钮 onclick 是 confirmAndPlay。
check('confirmAndPlay 可达性:wuxie 阶段 + 于吉【蛊惑】,L1 确实收集到 confirmAndPlay 按钮', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'wuxie',['yuji','zhangfei','zhangfei']);
  g.pending={type:'wuxie',asking:0,from:1,to:1,trick:'过河拆桥',depth:0,exclude:[],resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=2;",env.sb);   // 无密钥:ALLOWLIST 仍接管
  const match=vm.runInContext('controlsChoiceMatch(__g,0)',env.sb);
  if(!match) throw new Error('前提不成立:controlsChoiceMatch 应为 true(wuxie 在 ALLOWLIST)');
  const labels=JSON.parse(vm.runInContext(
    '(function(){var r=collectControlsCandidates(__g,0);var o=JSON.stringify(r.candidates.map(function(c){return c.label;}));if(r.dispose)r.dispose();return o;})()',env.sb));
  const guhuo=labels.filter(l=>/蛊惑/.test(l));
  if(guhuo.length===0) throw new Error('未收集到蛊惑按钮,labels='+JSON.stringify(labels));
  console.log('        └ 收集到的蛊惑按钮:', JSON.stringify(guhuo));
});

check('confirmAndPlay 后果【已修复,断言已反转】:机器人点击直接执行动作、不弹确认框;真人点击仍弹框', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'wuxie',['yuji','zhangfei','zhangfei']);
  g.pending={type:'wuxie',asking:0,from:1,to:1,trick:'过河拆桥',depth:0,exclude:[],resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=2;",env.sb);
  // 埋点:showConfirm 被调用几次 / startGuhuoResponse 被调用几次
  vm.runInContext(`
    __confirmCalls=0; __actionCalls=0;
    startGuhuoResponse=function(){ __actionCalls++; };
  `,env.sb);
  vm.runInContext(`
    var r=collectControlsCandidates(__g,0);
    var g1=r.candidates.filter(function(c){return /蛊惑/.test(c.label);})[0];
    __hadBtn = !!g1;
    // 走机器人路径(controlsChoiceExecute 会置这个标志位)
    botClickInProgress = true;
    try{ if(g1) g1.invoke(); } finally { botClickInProgress = false; }
    if(r.dispose) r.dispose();
  `,env.sb);
  const hadBtn=vm.runInContext('__hadBtn',env.sb);
  const confirms=vm.runInContext('__confirmCalls',env.sb);
  const actions=vm.runInContext('__actionCalls',env.sb);
  if(!hadBtn) throw new Error('前提不成立:没有蛊惑按钮可点');
  // 【断言已反转】原来这里锁定的是缺陷现状(confirms===1 && actions===0)。
  // 既有bug修复批次引入 botClickInProgress 之后,机器人点击不再弹确认框、动作直接执行,
  // 所以这条命题必须跟着改——不能让它继续"静静通过"(CLAUDE.md 第20条)。
  if(confirms!==0) throw new Error('机器人点击不应再弹确认框,实际弹了 '+confirms+' 次');
  if(actions!==1) throw new Error('机器人点击应直接执行动作1次,实际 '+actions+' 次');
  console.log('        └ 机器人点击:确认框 '+confirms+' 次、动作执行 '+actions+' 次(修复后的正确行为)');
  // 同一环境下再验真人路径未被波及:标志位为 false 时仍然只弹框、不执行
  vm.runInContext(`
    __confirmCalls=0; __actionCalls=0;
    var r2=collectControlsCandidates(__g,0);
    var p2=r2.candidates.filter(function(c){return /蛊惑/.test(c.label);})[0];
    botClickInProgress=false;
    if(p2) p2.invoke();
    if(r2.dispose) r2.dispose();
  `,env.sb);
  const hc=vm.runInContext('__confirmCalls',env.sb), ha=vm.runInContext('__actionCalls',env.sb);
  if(hc!==1 || ha!==0) throw new Error('真人路径应仍为"弹框1次/动作0次",实际 '+hc+'/'+ha);
  console.log('        └ 真人点击:确认框 '+hc+' 次、动作执行 '+ha+' 次(未被波及)');
});

// ---------- 场景2:controlsChoiceCtx 跨 await 期间,单房间内是否真的安全 ----------
check('controlsChoiceCtx:collect 之后 execute 之前,真实 #controls 一直顶着改名状态', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'wuxie',['yuji','zhangfei','zhangfei']);
  g.pending={type:'wuxie',asking:0,from:1,to:1,trick:'过河拆桥',depth:0,exclude:[],resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=2;",env.sb);
  if(env.realControls.id!=='controls') throw new Error('初始 id 应为 controls');
  vm.runInContext('__res=collectControlsCandidates(__g,0);',env.sb);
  // 此刻等价于"AI 正在思考"的那 15 秒
  const midId=env.realControls.id;
  vm.runInContext('if(__res.dispose)__res.dispose();',env.sb);
  const afterId=env.realControls.id;
  if(midId!=='human-controls') throw new Error('collect 期间真实控件应被改名为 human-controls,实际 '+midId);
  if(afterId!=='controls') throw new Error('dispose 后应归还为 controls,实际 '+afterId);
  console.log('        └ 改名窗口确实存在(collect→dispose 之间 id='+midId+'),dispose 后正确归还');
});

check('controlsChoiceCtx 单房间安全性:await 期间来一次新状态渲染,不会破坏后续 execute', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'wuxie',['yuji','zhangfei','zhangfei']);
  g.pending={type:'wuxie',asking:0,from:1,to:1,trick:'过河拆桥',depth:0,exclude:[],resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=2;",env.sb);
  vm.runInContext('__actionCalls=0; startGuhuoResponse=function(){ __actionCalls++; };',env.sb);
  vm.runInContext('__res=collectControlsCandidates(__g,0);',env.sb);
  // 模拟 await 期间真人客户端收到新快照又渲染了一次(单房间下真实会发生:别人出牌/日志更新)
  vm.runInContext('renderControls(__g);',env.sb);
  // 然后 AI 返回,execute 点击此前冻结的按钮
  vm.runInContext(`
    var g1=__res.candidates.filter(function(c){return /蛊惑/.test(c.label);})[0];
    __ok = !!g1; if(g1) g1.invoke();
    if(__res.dispose) __res.dispose();
  `,env.sb);
  const ok=vm.runInContext('__ok',env.sb);
  const acted=vm.runInContext('__actionCalls',env.sb);
  const finalId=env.realControls.id;
  if(!ok) throw new Error('前提不成立:没拿到按钮');
  if(finalId!=='controls') throw new Error('dispose 后 id 应归还 controls,实际 '+finalId);
  // 注:这里 startGuhuoResponse 被 confirmAndPlay 包着,所以 acted 恒为0;
  // 本条断言的是"按钮对象在期间渲染后仍可安全 invoke、dispose 仍能正确归还 id"
  console.log('        └ await 期间重渲染后,冻结的按钮仍可 invoke,dispose 归还 id 正常');
});

// ---------- 场景3:最小 shim 的两类语义缺口(P1 容器innerHTML / P2 按钮label innerHTML) ----------
check('shim 缺口 P2:按钮 label 用 innerHTML 设置时,textContent 恒空 → label 退化成"按钮N"', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'huogongReveal',['zhangfei','zhangfei','zhangfei']);
  g.pending={type:'huogongReveal',to:0,from:1,resume:{type:'sha'}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey='sk-test'; aiProvider='groq'; mySeat=2;",env.sb);
  const labels=JSON.parse(vm.runInContext(
    '(function(){var r=collectControlsCandidates(__g,0);var o=JSON.stringify(r.candidates.map(function(c){return c.label;}));if(r.dispose)r.dispose();return o;})()',env.sb));
  if(!labels.length) throw new Error('应渲染出展示手牌的按钮');
  const degraded=labels.filter(l=>/^按钮\d+$/.test(l));
  if(degraded.length!==labels.length)
    throw new Error('预期全部退化成"按钮N"(证明 shim 缺口存在),实际 '+JSON.stringify(labels));
  console.log('        └ shim 下 labels='+JSON.stringify(labels)+'(真实DOM应为"展示 ♠7【杀】"这类)');
});

check('shim 缺口 P1:容器 innerHTML 里的按钮 HTML 不被解析 → 机器人看到 0 个候选', ()=>{
  const env=makeEnv();
  const g=baseG(env.sb,'zhimengAsk',['zhangfei','zhangfei','zhangfei']);
  g.pending={type:'zhimengAsk',from:0,to:1,seat:0,sourceSeat:0,targetSeat:1,resume:{type:'sha'},
             originalCtx:{amount:1,sourceSeat:0,to:1}};
  env.context._g=g; env.sb.__g=g;
  vm.runInContext("aiApiKey='sk-test'; aiProvider='groq'; mySeat=2;",env.sb);
  const n=vm.runInContext(
    '(function(){var r=collectControlsCandidates(__g,0);var n=r.candidates.length;if(r.dispose)r.dispose();return n;})()',env.sb);
  if(n!==0) throw new Error('预期 shim 下收集到 0 个按钮(证明缺口存在),实际 '+n);
  console.log('        └ shim 下候选数=0(真实DOM应为「发动」「不发动」两个按钮)');
});

console.log('\n结果: '+pass+' 通过, '+fail+' 失败\n');
if(fail>0) process.exit(1);
