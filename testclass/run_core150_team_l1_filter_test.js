/**
 * CORE-150(issue #209):组队模式下 L1「按钮镜像」路径必须做同队硬过滤。
 *
 * 【背景】L1 是"DOM 隔离渲染 renderControls(g) → 收集全部可点按钮 → 交给模型选 index"
 * 的决策路径,不经过 botTargetScore / botBestTarget / pickBestCandidateSeat 中任何一个,
 * 组队模式既有的两条敌我硬边界全都够不着它。服务端渲染出的目标按钮**本来就含队友**
 * (规则允许把伤害转给任何人),于是"不选队友"只能靠模型自觉。
 * 更反直觉的是无密钥本地兜底反而安全(botTargetScore 对队友恒 -Infinity),
 * 等于"配了密钥安全网更弱"。
 */
const assert=require('assert'), vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0;
const check=(n,fn)=>{ try{ fn(); console.log('  PASS '+n); pass++; }
  catch(e){
    const msg = String((e && e.message) || e);
    console.log('  FAIL '+n+' - '+msg.split('\n')[0]);
    // 打出失败断言所在行,否则一条 check 里有多个断言时根本分不清是哪个挂了
    const st = String((e && e.stack) || '').split('\n')
      .find(function(l){ return l.indexOf('run_core150') >= 0; });
    if(st) console.log('        ↑ '+st.trim());
    fail++;
  } };

// ---- 极简 DOM:够 collectControlsCandidates 跑通即可 ----
function mkEl(tag){
  const el={ tagName:(tag||'div').toUpperCase(), children:[], dataset:{}, style:{}, id:'',
    className:'', textContent:'', disabled:false, onclick:null, _clicked:false,
    appendChild(c){ c._parent=this; this.children.push(c); return c; },
    querySelectorAll(sel){
      const out=[]; const want=/^button/.test(sel);
      (function walk(n){ (n.children||[]).forEach(function(c){
        if(want && c.tagName==='BUTTON' && !c.disabled) out.push(c);
        walk(c); }); })(this);
      return out;
    },
    click(){ this._clicked=true; if(typeof this.onclick==='function') this.onclick(); },
    // collectControlsCandidates 的 dispose 会调 box.remove() 归还 DOM
    remove(){ if(this._parent){ const i=this._parent.children.indexOf(this);
      if(i>=0) this._parent.children.splice(i,1); } } };
  return el;
}
function load(botSrc){
  const controls=mkEl('div'); controls.id='controls';
  const body=mkEl('body');
  // 【getElementById 必须是真实的树查找,不能用静态映射】collectControlsCandidates 会
  // 先把真实 #controls 改名成 human-controls、再造一个同样 id='controls' 的隐藏 box
  // append 到 body,然后调 renderControls(g) 让按钮渲染进那个 box。静态映射会一直返回
  // 改名前的旧节点,按钮全被渲染到旧 controls 里、box 恒为空 —— 所有断言都拿到 0 个候选。
  const doc={ body:body, _roots:[controls, body],
    getElementById(id){
      let found=null;
      const walk=(n)=>{ if(!n||found) return;
        if(n.id===id){ found=n; return; }
        (n.children||[]).forEach(walk); };
      this._roots.forEach(walk);
      return found;
    },
    createElement:mkEl, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){} };
  const sb={ console:{log(){},warn(){},debug(){},error(){}}, Math,JSON,Date,Object,Array,String,
    Number,Boolean,RegExp,isNaN,parseInt,parseFloat,Promise,setTimeout,clearTimeout,
    setInterval,clearInterval, document:doc, mySeat:0,
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    navigator:{userAgent:'node'}, location:{search:'',href:''},
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}) };
  sb.window=sb; sb.globalThis=sb;
  const ctx=vm.createContext(sb);
  ['data.js','stages/stage-table.js','ai-bot.js','bot-ai-bus.js','bot.js'].forEach(f=>{
    // botSrc 传入时用它替换 bot.js —— 破坏性验证必须在**全新 ctx** 里只加载一次 bot.js,
    // 否则 const/let 顶层声明会重复(第一版就是在已加载的 ctx 里再跑一遍 broken 源码,
    // 直接 'botTimer has already been declared')。
    const code = (f==='bot.js' && botSrc) ? botSrc : fs.readFileSync(path.join(ROOT,f),'utf8');
    try{ vm.runInContext(code, ctx, {filename:f}); }
    catch(e){ if(!/is not defined|Cannot read|Cannot access/.test(e.message)) throw e; }
  });
  return {ctx, doc, controls, body};
}

// 组队局:seat0/seat1 同队(team 0),seat2/seat3 敌队(team 1)
function mkG(){
  const P=(i,team)=>({name:'P'+i,seat:i,team:team,hp:3,maxHp:4,alive:true,general:null,hand:[],
    equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[],role:null});
  return { players:[P(0,0),P(1,0),P(2,1),P(3,1)], phase:'liuli', turn:0,
    pending:{type:'liuli', to:0, from:2, targets:[1,2,3]},
    deck:[],discard:[],log:[],started:true,gameMode:'team' };
}
// 装一个假的 renderControls:按 pending.targets 造带 data 标注的按钮(与真实渲染同构)
function installRender(ctx, effect){
  vm.runInContext(`
    renderControls = function(g){
      var c = document.getElementById('controls');
      (g.pending.targets||[]).forEach(function(t){
        var b = document.createElement('button');
        b.textContent = '弃牌 → ' + g.players[t].name;
        b.dataset.targetSeat = String(t);
        b.dataset.targetEffect = ${JSON.stringify(effect||'harmful')};
        c.appendChild(b);
      });
      var no = document.createElement('button');
      no.textContent = '不发动';          // 刻意不标注:安全出口,不该被过滤
      c.appendChild(no);
    };
  `, ctx);
}
const labels = (arr)=>arr.map(c=>c.label);
// 【断言用结构化的 targetSeat,不要匹配 label 文本】label 交给模型前会经 botScrubLogText
// 把昵称替换成"座位N"代号(CORE-101),按 'P1' 这类原始昵称去匹配必然落空 ——
// 这正是本次改动在实现侧坚持"结构化标注而非文本解析"的同一个理由,测试也该遵守。
// 【必须用扩展运算符转回主 realm 的数组】vm.createContext 建的是**独立 realm**,
// 沙箱里 filter/map 产生的数组,其原型是沙箱自己的 Array.prototype,与本文件所在主
// realm 的 Array.prototype 不是同一个对象。assert.deepStrictEqual 会**严格比较原型**,
// 于是 [2,3] 和 [2,3] 判为不等 —— 报错信息里两个值看起来一模一样,极难看出问题。
// (注入 sb.Array = Array 不解决:那只覆盖全局变量名,不改变字面量与内置方法返回值的原型。)
const seats = (arr)=>[...arr].filter(c=>Number.isInteger(c.targetSeat)).map(c=>c.targetSeat);

console.log('== CORE-150: 组队模式 L1 同队硬过滤 ==\n');

check('组队模式:指向队友的候选被移除,敌方与未标注的保留',()=>{
  const {ctx}=load(); installRender(ctx,'harmful');
  const g=mkG();
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(g,0);
  const sm=seats(out);

  assert.ok(!sm.includes(1), '队友 seat1 不应出现在候选里,实际 targetSeat='+JSON.stringify(sm));
  assert.deepStrictEqual([...sm].sort(), [2,3], '敌方 seat2/seat3 应保留,实际 '+JSON.stringify(sm));
  assert.ok(out.some(c=>c.targetSeat===null), '未标注的安全出口(不发动)应保留');
});

check('index 保持按钮在 DOM 中的原始下标(execute 依赖它定位,不得重编号)',()=>{
  const {ctx}=load(); installRender(ctx,'harmful');
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(mkG(),0);
  // targets=[1,2,3] → 按钮下标 0..2,再加"不发动"=3。队友 seat1 在下标 0,应被删掉。
  assert.deepStrictEqual([...out].map(c=>c.index), [1,2,3],
    'index 必须保留原始下标(只删不重排),实际 '+JSON.stringify(out.map(c=>c.index)));
});

check('helpful 效果方向相反:只保留队友,敌方被移除',()=>{
  const {ctx}=load(); installRender(ctx,'helpful');
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(mkG(),0);
  const sm=seats(out);
  assert.deepStrictEqual([...sm], [1], '帮助型应只保留队友 seat1,实际 '+JSON.stringify(sm));
});

check('身份局不受影响(本票只处理 team;身份局有自己的 suspicion 策略)',()=>{
  const {ctx}=load(); installRender(ctx,'harmful');
  const g=mkG(); g.gameMode='identity';
  g.players.forEach(p=>{ p.team=null; p.role='unknown'; });
  g.players[0].role='fan'; g.players[1].role='fan'; g.players[1].roleRevealed=true;
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(g,0);
  // 反贼对已知反贼:botTargetRelationAllowed 返回 false,同样会被过滤 —— 这是既有谓词
  // 的正确行为(复用而非新造),这里只确认它没有崩、且仍保留了其它候选。
  assert.ok(out.length>0, '身份局不应把候选清空');
  assert.ok(out.some(c=>c.targetSeat===null), '安全出口仍在');
});

check('乱斗(ffa)完全不过滤(无阵营概念,零回归)',()=>{
  const {ctx}=load(); installRender(ctx,'harmful');
  const g=mkG(); g.gameMode='ffa'; g.players.forEach(p=>{p.team=null;});
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(g,0);
  assert.strictEqual(out.length, 4, 'ffa 应保留全部 4 个候选,实际 '+out.length);
});

check('未标注 data 的按钮一律不过滤(绝大多数响应类按钮,零回归)',()=>{
  const {ctx}=load();
  vm.runInContext(`
    renderControls = function(g){
      var c=document.getElementById('controls');
      ['出闪','不出'].forEach(function(t){
        var b=document.createElement('button'); b.textContent=t; c.appendChild(b); });
    };`, ctx);
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(mkG(),0);
  assert.strictEqual(out.length,2,'无标注时应原样返回');
});

check('全部候选都指向队友时不清空(保留原列表,避免 L1 整体失效)',()=>{
  const {ctx}=load(); installRender(ctx,'harmful');
  const g=mkG();
  g.pending.targets=[1];                 // 只剩队友可选
  vm.runInContext(`renderControls = function(g){
      var c=document.getElementById('controls');
      (g.pending.targets||[]).forEach(function(t){
        var b=document.createElement('button');
        b.textContent='弃牌 → '+g.players[t].name;
        b.dataset.targetSeat=String(t); b.dataset.targetEffect='harmful';
        c.appendChild(b); });
    };`, ctx);
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(g,0);
  assert.ok(out.length>0, '不得返回空候选(那会让 L1 整体失效、行为不可预期)');
});

check('破坏性验证:移除过滤后队友确实会出现在候选里',()=>{
  const src=fs.readFileSync(path.join(ROOT,'bot.js'),'utf8');
  const broken=src.replace('res.candidates = controlsChoiceFilterTeam(g, seat, res.candidates);','');
  assert.notStrictEqual(broken,src,'替换未命中');
  const {ctx}=load(broken);
  installRender(ctx,'harmful');
  const out=vm.runInContext('controlsChoiceBuildCandidates',ctx)(mkG(),0);
  assert.ok(seats(out).includes(1),
    '移除过滤后队友 seat1 应出现在候选里——说明断言确实能变红');
});

console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
