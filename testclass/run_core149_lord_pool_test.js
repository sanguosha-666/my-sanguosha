/**
 * CORE-149(issue #208):身份局主公的 5 张候选按"带不带主公技"分层抽取。

 覆盖:
  1. 分类元数据本身:LORD_SKILL_CAPS / generalHasLordSkill 与 desc 双向一致,
     且袁术【妄尊】(作用于主公的普通技,不是主公技)必须被排除
  2. 正常局:恰好 2 张带主公技 + 3 张不带
  3. 位置随机:带主公技的不能恒定排在前两位(否则顺序本身泄露信息)
  4. 降级:带主公技的武将不足 2 张时凑满 5 张、不报错、不卡在选将阶段
  5. 不重叠语义仍成立(主公选完后其他人的候选不含已选武将)
  6. 破坏性验证:还原成 shuffled.slice(0,5),"恰好 2 张"必须变红
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.stack||e.message); failed++; }
}

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(fn){ const r=fn(function(){}); if(typeof r==='function') r(); return {}; },
      set(){}, update(){}, child(){ return this; }, remove(){}, get(){ return { val(){ return null; } }; }
    }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: {
    getElementById(){ return {
      onclick:null, innerHTML:'', style:{}, className:'', textContent:'',
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      appendChild(){ return {}; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
      addEventListener(){}, removeEventListener(){}, querySelector(){ return null; },
      querySelectorAll(){ return []; }
    }; },
    createElement(){ return {
      src:'', style:{}, className:'', id:'', textContent:'', innerHTML:'',
      onclick:null, disabled:false, setAttribute(){}, getAttribute(){ return null; },
      appendChild(){ return {}; }, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){ return {}; } }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){}, removeChild(){} }, head:{ appendChild(){} },
    addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    addEventListener(){}, removeEventListener(){},
    setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addListener(){}, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, parseFloat, isNaN, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;

const sandbox = vm.createContext(context);
const files = ['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'];
console.log('Loading...\n');
files.forEach(f=>{
  const code = fs.readFileSync(path.join(ROOT,f),'utf8');
  vm.runInContext(code, sandbox, { filename:f });
  if(f==='game.js'){
    // 真实 tx:对共享 _g 做 transaction
    vm.runInContext(`
      var _g = null;
      tx = function(fn){
        if(!_g) return;
        // 与生产 tx 保持一致：Firebase 读回的空数组可能缺失，业务函数执行前必须 normalize。
        // 否则随机选到左慈时 huashenPool 为 undefined，测试会偶发在 .length 处崩溃。
        normalize(_g);
        const r = fn(_g);
        return r === undefined ? _g : r;
      };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
    `, sandbox);
  }
  console.log('  OK', f);
});

// 暴露测试用 setter
vm.runInContext(`
  function __setG(g){ _g = g; }
  function __getG(){ return _g; }
  function __setSeat(s){ mySeat = s; }
`, sandbox);


let passedAll = true;
console.log('\n== CORE-149: 主公候选池分层 ==\n');

const G       = vm.runInContext('GENERALS', sandbox);
const hasLord = vm.runInContext('generalHasLordSkill', sandbox);
const CAPS    = vm.runInContext('LORD_SKILL_CAPS', sandbox);

// ---------- 1. 分类元数据 ----------
check('LORD_SKILL_CAPS 里每个 cap 都至少有一个武将声明(防写错 cap 名)', ()=>{
  CAPS.forEach(cap=>{
    const owners = Object.keys(G).filter(id=>G[id].caps && G[id].caps[cap]);
    assert.ok(owners.length>0, cap+' 没有任何武将声明——多半是 cap 名拼错了');
  });
});

check('双向一致:desc 写了"主公技" ⟺ generalHasLordSkill 为真', ()=>{
  const byCap  = Object.keys(G).filter(id=>hasLord(id)).sort();
  const byDesc = Object.keys(G).filter(id=>/主公技/.test(G[id].desc||'')).sort();
  assert.deepStrictEqual(byCap, byDesc,
    '两处漂移了:caps 判定 ['+byCap.map(i=>G[i].name)+'] vs desc 标注 ['+byDesc.map(i=>G[i].name)+']');
  assert.strictEqual(byCap.length, 6, '当前应恰好 6 名带主公技,实际 '+byCap.length);
});

check('袁术【妄尊】不算主公技(它是"作用于主公"的普通武将技)', ()=>{
  assert.strictEqual(hasLord('yuanshu'), false,
    '妄尊的 role===zhu 守卫判断的是别人(当前回合的主公),不是"只有主公能发动"');
  assert.ok(!CAPS.includes('wangzun'), 'wangzun 不应出现在 LORD_SKILL_CAPS 里');
});

// ---------- 驱动 startGame 的公共部分 ----------
function runStart(n){
  const players = Array.from({length:n},(_,i)=>({
    name:'P'+i, seat:i, cid:'c'+i, hp:4, maxHp:4, alive:true,
    hand:[], equips:{weapon:null,armor:null,plus1:null,minus1:null}, delays:[] }));
  vm.runInContext('__setG('+JSON.stringify({
    players, phase:'lobby', pending:null, turn:0, deck:[], discard:[], log:[],
    started:false, gameMode:'identity' })+')', sandbox);
  vm.runInContext('__setSeat(0)', sandbox);
  vm.runInContext("startGame('pick','identity')", sandbox);
  return vm.runInContext('__getG()', sandbox);
}

// ---------- 2. 组成 ----------
check('正常局:主公候选恰好 5 张 = 2 张带主公技 + 3 张不带', ()=>{
  for(let trial=0; trial<40; trial++){
    const g = runStart(5);
    const pool = g.lordGeneralPool;
    assert.ok(Array.isArray(pool) && pool.length===5, '候选应为 5 张,实际 '+JSON.stringify(pool));
    const k = pool.filter(id=>hasLord(id)).length;
    assert.strictEqual(k, 2, '第'+trial+'次:带主公技的应为 2 张,实际 '+k+' ('+pool.map(i=>G[i].name)+')');
    assert.strictEqual(new Set(pool).size, 5, '候选内部不得重复');
  }
});

check('主公的 generalChoices 与 lordGeneralPool 一致,且未预先指定武将', ()=>{
  const g = runStart(5);
  const lord = g.players.findIndex(p=>p.role==='zhu');
  assert.ok(lord>=0, '应有主公');
  assert.deepStrictEqual(g.players[lord].generalChoices, g.lordGeneralPool);
  assert.strictEqual(g.players[lord].general, null, '主公此时不应已有武将');
  assert.strictEqual(g.phase, 'pickingLordGeneral');
});

// ---------- 3. 位置随机 ----------
check('带主公技的两张不恒定排在前两位(顺序本身不得泄露信息)', ()=>{
  const posCount = [0,0,0,0,0];
  for(let t=0;t<80;t++){
    runStart(5).lordGeneralPool.forEach((id,i)=>{ if(hasLord(id)) posCount[i]++; });
  }
  // 80 次 x 2 张 = 160 个"带主公技"的位置样本,均匀分布下每个位置期望 32 次。
  // 只要证明它没有集中在前两位即可,不追求严格的均匀性检验。
  const tail = posCount[2]+posCount[3]+posCount[4];
  assert.ok(tail > 40, '后三个位置总共只出现 '+tail+' 次,分布疑似固定:'+JSON.stringify(posCount));
  posCount.forEach((c,i)=>assert.ok(c>0, '位置 '+i+' 从未出现过带主公技的武将:'+JSON.stringify(posCount)));
});

// ---------- 4. 降级 ----------
check('降级:带主公技的武将只剩 1 名时,仍凑满 5 张且不报错', ()=>{
  const removed = {};
  ['sunquan','sunce','caocao','yuanshao','zhangjiao'].forEach(id=>{ removed[id]=G[id]; delete G[id]; });
  try{
    const g = runStart(5);
    assert.strictEqual(g.lordGeneralPool.length, 5, '仍应凑满 5 张');
    assert.strictEqual(g.lordGeneralPool.filter(id=>hasLord(id)).length, 1, '应只有仅存的那 1 张');
    assert.strictEqual(g.phase, 'pickingLordGeneral', '不得卡在选将阶段之外');
  } finally { Object.assign(G, removed); }
});

check('降级:一名带主公技的武将都没有时,仍凑满 5 张且不报错', ()=>{
  const removed = {};
  Object.keys(G).filter(id=>hasLord(id)).forEach(id=>{ removed[id]=G[id]; delete G[id]; });
  try{
    const g = runStart(5);
    assert.strictEqual(g.lordGeneralPool.length, 5);
    assert.strictEqual(g.lordGeneralPool.filter(id=>hasLord(id)).length, 0);
    assert.strictEqual(g.phase, 'pickingLordGeneral');
  } finally { Object.assign(G, removed); }
});

// ---------- 5. 不重叠 ----------
check('主公选完后,其他玩家的候选不含已选武将(不重叠语义未被破坏)', ()=>{
  const g = runStart(5);
  const lord = g.players.findIndex(p=>p.role==='zhu');
  const picked = g.lordGeneralPool[0];
  vm.runInContext('__setSeat('+lord+')', sandbox);
  vm.runInContext('respondPickLordGeneral('+JSON.stringify(picked)+')', sandbox);
  const g2 = vm.runInContext('__getG()', sandbox);
  assert.strictEqual(g2.players[lord].general, picked, '主公武将应已写入');
  const all = [];
  g2.players.forEach((p,i)=>{ if(i!==lord && Array.isArray(p.generalChoices)) all.push(...p.generalChoices); });
  assert.ok(all.length>0, '其他玩家应已发到候选');
  assert.ok(!all.includes(picked), '已被主公选走的武将不应再出现在别人的候选里');
  assert.strictEqual(new Set(all).size, all.length, '其他玩家之间的候选也不得重复');
});

// ---------- 6. 破坏性验证 ----------
check('破坏性验证:还原成 shuffled.slice(0,5) 后,"恰好 2 张"确实会变红', ()=>{
  const src = fs.readFileSync(path.join(ROOT,'room-lifecycle.js'),'utf8');
  const i = src.indexOf('      const withLordSkill = shuffled.filter');
  const j = src.indexOf('g.lordGeneralPool = lordPool.sort');
  assert.ok(i>=0 && j>i, '定位不到分层抽取那段');
  const broken = src.slice(0,i) + '      g.lordGeneralPool = shuffled.slice(0, LORD_PICK);\n'
               + src.slice(src.indexOf('\n', j)+1);
  const ctx2 = vm.createContext(Object.assign({}, context));
  ['config.js','data.js','stages/stage-table.js'].forEach(f=>
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx2, {filename:f}));
  vm.runInContext(broken, ctx2, {filename:'room-lifecycle-broken.js'});
  ['game.js','sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx2, {filename:f}));
  vm.runInContext(`
    var _g=null;
    tx=function(fn){ if(!_g) return; normalize(_g); const r=fn(_g); return r===undefined?_g:r; };
    gameRef={transaction:function(fn){return tx(fn);}}; mySeat=0;
    function __setG(g){_g=g;} function __getG(){return _g;}
  `, ctx2);
  const hasLord2 = vm.runInContext('generalHasLordSkill', ctx2);
  let sawWrong = false;
  for(let t=0;t<40 && !sawWrong;t++){
    const players=Array.from({length:5},(_,i)=>({name:'P'+i,seat:i,cid:'c'+i,hp:4,maxHp:4,alive:true,
      hand:[],equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]}));
    vm.runInContext('__setG('+JSON.stringify({players,phase:'lobby',pending:null,turn:0,
      deck:[],discard:[],log:[],started:false,gameMode:'identity'})+')', ctx2);
    vm.runInContext("startGame('pick','identity')", ctx2);
    const pool = vm.runInContext('__getG()', ctx2).lordGeneralPool;
    if(pool.filter(id=>hasLord2(id)).length !== 2) sawWrong = true;
  }
  assert.ok(sawWrong, '40 次随机切片竟然次次都恰好 2 张主公技武将——断言没有鉴别力');
});

console.log('\n结果: '+passed+' 通过, '+failed+' 失败');
process.exit(failed?1:0);
