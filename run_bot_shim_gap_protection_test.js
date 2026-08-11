/**
 * C-4 收尾产物:锁定"最小 DOM shim 的 9 个语义缺口 phase 全部被结构化路径保护住"这个不变量。
 *
 * 背景(详见 docs/local-bot-server-feasibility.md「阶段0 调查补全」/「C-4 补齐」):
 * 最小 shim 与规范 DOM 在 9 个 phase 上会渲染出不同的按钮集合,成因只有 innerHTML 一个
 * API 的两种用法:
 *   P1 容器 innerHTML 里塞 <button> 字符串(shim 不解析 HTML → 0 个按钮):
 *      beigeChoose / beigeDiscard / beigeJudge / chengxiangAsk / zhimengAsk / zhimengPick / renxinChoose
 *   P2 按钮 label 用 innerHTML 设置(shim 的 textContent 恒空 → label 退化成"按钮N"):
 *      huogong / huogongReveal
 *
 * 这些缺口【当前对生产无害】,靠的是三条同时成立:
 *   ① 该 phase 在 CONTROLS_CHOICE_EXCLUDE 里 → L1 不会去镜像它的按钮;
 *   ② 在 BOT_PHASE_ACTOR 里登记 → botSeatForState 能解析出行动者;
 *   ③ runBotDecision 有能真正提交动作的专用分支 → 不依赖读按钮。
 * 三条里任意一条被破坏,这些 phase 就会退化成"机器人读 shim 渲染出的错误按钮集合",
 * 在 Node 宿主下直接卡死。所以这里把三条一起钉住 —— 这是迁移阶段3 之前的护栏。
 */
const vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=__dirname;
let pass=0, fail=0;
const Q=[];
function check(name,fn){ Q.push({name,fn}); }
async function runAll(){ for(const it of Q){ try{ await it.fn(); console.log('  PASS',it.name); pass++; }
  catch(e){ console.log('  FAIL',it.name,'-',(e&&e.message||e)); fail++; } } }

function mkEl(tag){const el={tagName:String(tag).toUpperCase(),children:[],style:{},_text:'',_html:'',id:'',className:'',
 disabled:false,onclick:null,parentEl:null,value:'',checked:false,
 classList:{add(){},remove(){},toggle(){},contains(){return false;}},
 appendChild(c){c.parentEl=el;el.children.push(c);return c;},
 removeChild(c){const i=el.children.indexOf(c);if(i>=0){el.children.splice(i,1);c.parentEl=null;}return c;},
 remove(){if(el.parentEl)el.parentEl.removeChild(el);},
 set textContent(v){el._text=String(v==null?'':v);},get textContent(){return el._text;},
 set innerHTML(v){el._html=String(v==null?'':v);el.children=[];},get innerHTML(){return el._html;},
 click(){if(typeof el.onclick==='function')el.onclick();},
 setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){},
 querySelector(){return null;},
 querySelectorAll(){const out=[];(function w(n){if(n!==el&&n.tagName==='BUTTON'&&!n.disabled)out.push(n);(n.children||[]).forEach(w);})(el);return out;}};return el;}
function makeEnv(){
  const rc=mkEl('div'); rc.id='controls';
  const body=mkEl('body'); body.appendChild(rc);
  const doc={body,head:mkEl('head'),
    getElementById(id){let f=null;(function w(n){if(f)return;if(n.id===id){f=n;return;}(n.children||[]).forEach(w);})(body);return f||mkEl('div');},
    createElement(t){return mkEl(t);},createTextNode(t){return{nodeValue:t,textContent:t};},
    createDocumentFragment(){return mkEl('frag');},querySelector(){return null;},querySelectorAll(){return [];},
    addEventListener(){},removeEventListener(){}};
  const context={
    gameRef:null,
    firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},push(){return{set(){},key:'k'};},transaction(){return{};},set(){},update(){},child(){return this;},remove(){},get(){return{val(){return null;}};}};}};}};},database(){return this.initializeApp().database();}},
    document:doc,setBanner(){},escapeHtml(s){return String(s==null?'':s);},
    generalAvatarSrc(){return '';},avatarError(){},cardImageSrc(){return '';},cardImgError(){},
    window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null;},setItem(){}},addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,setInterval,clearInterval,alert(){},confirm(){return true;},navigator:{userAgent:'t'},matchMedia(){return{matches:false,addEventListener(){}};}},
    localStorage:{getItem(){return null;},setItem(){},removeItem(){}},sessionStorage:{getItem(){return null;},setItem(){}},
    joinRoom(){},mySeat:0,console:{log(){},warn(){},error(){}},
    Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,parseFloat,isNaN,setTimeout,clearTimeout,setInterval,clearInterval,
    fetch:()=>Promise.resolve({ok:false,status:0,text:()=>Promise.resolve(''),json:()=>Promise.resolve({})}),
    AbortController:function(){this.signal=null;this.abort=()=>{};}};
  context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
  const sb=vm.createContext(context);
  for(const f of ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','bot-ai-bus.js','bot.js','ai-bot.js','render-controls.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sb,{filename:f});
  return {context,sb};
}
function card(n,id,s,r){return{id,name:n,suit:s||'♥',rank:r||5};}
function baseG(sb,phase){
  const emptyEq=vm.runInContext('emptyEquips',sb);const players=[];
  for(let i=0;i<4;i++)players.push({name:'P'+i,cid:i===3?'human':null,isBot:i!==3,alive:true,hp:3,maxHp:4,
    hand:[card('杀','h'+i+'a','♠',7),card('闪','h'+i+'b','♦',2),card('桃','h'+i+'c','♥',9)],
    equips:emptyEq(),delays:[],general:'zhangfei',role:null,buquCards:[],huashenPool:['zhangfei']});
  return {phase,turn:0,roundNum:1,started:true,players,gameMode:'ffa',
    deck:Array.from({length:30},(_,i)=>card('杀','d'+i,'♠',(i%13)+1)),discard:[],log:[],exchangeCards:[],
    pending:null,aoe:null,shaUsed:false,roundSeatsActed:[],guhuoUsed:false,wanshaActive:false,wanshaDyingSeat:null};
}
const P1=['beigeChoose','beigeDiscard','beigeJudge','chengxiangAsk','zhimengAsk','zhimengPick','renxinChoose'];
const P2=['huogong','huogongReveal'];
const GAPS=P1.concat(P2);
const SCEN={
  beigeChoose:(sb)=>{const g=baseG(sb,'beigeChoose');g.players[0].general='caiwenji';
    g.pending={type:'beigeChoose',sourceSeat:0,damagedSeat:1,damagerSeat:2,resume:{type:'sha'},originalCtx:{amount:1,sourceSeat:2,to:1}};return g;},
  beigeDiscard:(sb)=>{const g=baseG(sb,'beigeDiscard');g.players[0].general='caiwenji';
    g.pending={type:'beigeDiscard',sourceSeat:0,damagedSeat:1,damagerSeat:2,resume:{type:'sha'}};return g;},
  beigeJudge:(sb)=>{const g=baseG(sb,'beigeJudge');g.players[0].general='caiwenji';
    g.pending={type:'beigeJudge',sourceSeat:0,damagedSeat:1,damagerSeat:2,resume:{type:'sha'}};return g;},
  chengxiangAsk:(sb)=>{const g=baseG(sb,'chengxiangAsk');g.players[0].general='caochong';
    g.pending={type:'chengxiangAsk',seat:0,resume:{type:'sha'}};return g;},
  zhimengAsk:(sb)=>{const g=baseG(sb,'zhimengAsk');g.players[0].general='masu';
    g.players[1].equips.weapon=card('青龙偃月刀','w1','♠',5);
    g.pending={type:'zhimengAsk',from:0,to:1,options:[{type:'hand',label:'一张手牌'},{type:'weapon',label:'装备【青龙偃月刀】'}],
      originalCtx:{amount:1,sourceSeat:0,to:1,srcType:'sha'}};return g;},
  zhimengPick:(sb)=>{const g=baseG(sb,'zhimengPick');g.players[0].general='masu';
    g.players[1].equips.weapon=card('青龙偃月刀','w1','♠',5);
    g.pending={type:'zhimengPick',from:0,to:1,options:[{type:'hand',label:'一张手牌'},{type:'weapon',label:'装备【青龙偃月刀】'}],
      originalCtx:{amount:1,sourceSeat:0,to:1,srcType:'sha'}};return g;},
  renxinChoose:(sb)=>{const g=baseG(sb,'renxinChoose');g.players[0].general='caochong';
    g.players[0].equips.weapon=card('青龙偃月刀','w4','♠',5);
    g.pending={type:'renxinChoose',seat:0,target:1,damage:1,sourceSeat:2,equipSlots:['weapon'],
      originalDamageInfo:{amount:1,sourceSeat:2,to:1},skipRenxinSeats:[]};return g;},
  huogong:(sb)=>{const g=baseG(sb,'huogong');g.players[0].hand=[card('杀','q1','♠',7),card('闪','q2','♦',2)];
    g.pending={type:'huogong',from:0,to:1,suit:'♠',resume:{type:'sha'}};return g;},
  huogongReveal:(sb)=>{const g=baseG(sb,'huogongReveal');g.pending={type:'huogongReveal',to:0,from:1,resume:{type:'sha'}};return g;},
};

console.log('\n== shim 语义缺口 phase 的保护不变量 ==\n');

check('缺口清单本身没变:P1 七个 + P2 两个(成因都只是 innerHTML 的两种用法)', ()=>{
  const rc=fs.readFileSync(path.join(ROOT,'render-controls.js'),'utf8');
  // P2 = 按钮变量上直接 .innerHTML=,全项目应恰好 2 处
  const btnVars=new Set();
  rc.split('\n').forEach(l=>{const m=l.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\('button'\)/);if(m)btnVars.add(m[1]);});
  let n=0;
  rc.split('\n').forEach(l=>{const m=l.match(/([A-Za-z_$][\w$]*)\.innerHTML\s*=/);if(m&&btnVars.has(m[1]))n++;});
  if(n!==2) throw new Error('按钮 label 用 innerHTML 的写法应恰好 2 处(huogong/huogongReveal),实际 '+n
    +' 处 —— 新增了就要同步扩充本测试的 P2 清单');
});

GAPS.forEach(phase=>{
  check('['+phase+'] 三重保护齐全:在 EXCLUDE + 已登记 ACTOR + 专用分支真的提交动作', async()=>{
    const env=makeEnv();
    const inEx=vm.runInContext('CONTROLS_CHOICE_EXCLUDE.has("'+phase+'")',env.sb);
    if(!inEx) throw new Error('必须在 CONTROLS_CHOICE_EXCLUDE 里,否则 L1 会镜像 shim 渲染出的错误按钮集合');
    const actor=vm.runInContext('BOT_PHASE_ACTOR["'+phase+'"]',env.sb);
    if(actor===undefined) throw new Error('必须登记 BOT_PHASE_ACTOR,否则 botSeatForState 恒 -1(guhuoTarget 那类死代码)');
    const g=SCEN[phase](env.sb);
    env.context._g=g; env.sb.__g=g;
    // 必须用 runInContext 赋裸标识符:game.js 的 let gameRef 是脚本作用域绑定
    vm.runInContext('__commits=0; gameRef={transaction:function(fn){ __commits++; try{ return fn(__g); }catch(e){} }};',env.sb);
    vm.runInContext("aiApiKey=''; aiProvider=null; mySeat=3;",env.sb);
    const seat=vm.runInContext('botSeatForState(__g)',env.sb);
    if(seat<0) throw new Error('botSeatForState 应解析出行动者,实际 '+seat);
    await vm.runInContext('runBotDecision(__g,'+seat+')',env.sb);
    if(vm.runInContext('__commits',env.sb)<=0)
      throw new Error('专用分支应真正提交动作(不依赖读按钮),实际一次 tx 都没发生');
  });
});

check('对照:这 9 个 phase 在 shim 下确实渲染不出正确按钮(证明保护不是多余的)', ()=>{
  const env=makeEnv();
  vm.runInContext("aiApiKey='sk-test'; aiProvider='groq'; mySeat=3;",env.sb);
  const broken=[];
  GAPS.forEach(phase=>{
    const g=SCEN[phase](env.sb); env.context._g=g; env.sb.__g=g;
    const labels=JSON.parse(vm.runInContext(
      '(function(){var r=collectControlsCandidates(__g,0);var o=JSON.stringify(r.candidates.map(function(c){return c.label;}));if(r.dispose)r.dispose();return o;})()',env.sb));
    // P1 → 0 个按钮;P2 → 至少有一个 label 退化成"按钮N"这种无信息文案。
    // 注意用 some 不是 every:huogong 会同时渲染出退化的"弃置 ♠7【杀】"(→按钮0)和
    // 正常的"不弃牌",只坏一半也是失真(AI 拿不到那一项的任何信息)。
    const bad = labels.length===0 || labels.some(l=>/^按钮\d+$/.test(l));
    if(bad) broken.push(phase);
  });
  if(broken.length!==GAPS.length)
    throw new Error('预期 9 个都在 shim 下失真(这正是需要保护的原因),实际只有 '+broken.length+' 个:'+JSON.stringify(broken));
});

runAll().then(()=>{
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败\n');
  if(fail>0) process.exit(1);
});
