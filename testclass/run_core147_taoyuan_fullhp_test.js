// CORE-147(issue #204):【桃园结义】不得对满体力角色开启无效的无懈轮询。
// 【规则依据】标准版 FAQ:满体力角色视为不受桃园结义影响,不能对其使用【无懈可击】,
// 应直接跳过该角色的结算。
const assert=require('assert'), vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0;
const check=(name,fn)=>{ try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+e.message); fail++; } };

function load(){
  const sb={console,Math,JSON,Object,Array,String,Number,Boolean,Date,isNaN,parseInt,parseFloat,
    setTimeout:()=>{},clearTimeout:()=>{},setInterval:()=>{},clearInterval:()=>{}};
  sb.window=sb; sb.globalThis=sb;
  sb.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
    addEventListener:()=>{},createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}},appendChild(){},remove(){}}),
    documentElement:{style:{},classList:{toggle(){},add(){},remove(){},contains:()=>false}},body:{appendChild(){},style:{}}};
  sb.localStorage={getItem:()=>null,setItem(){},removeItem(){},key:()=>null,length:0};
  sb.navigator={userAgent:'node',maxTouchPoints:0};
  sb.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  const ctx=vm.createContext(sb);
  for(const f of ['data.js','game.js']){
    try{ vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),ctx,{filename:f}); }
    catch(e){ if(!/is not defined|Cannot read/.test(e.message)) throw e; }
  }
  return ctx;
}
const ctx=load();
const call=(fn,...a)=>vm.runInContext('typeof '+fn,ctx)==='function'
  ? ctx[fn](...a) : (()=>{throw new Error(fn+' 未定义')})();

// n 人局,hp 数组指定各人当前体力(maxHp 固定 4)
function mkGame(hps){
  return { players: hps.map((hp,i)=>({
      name:'P'+i, seat:i, hp, maxHp:4, alive:true, general:null,
      hand:[], equips:{weapon:null,armor:null,plus1:null,minus1:null},
      delays:[], role:'unknown' })),
    phase:'play', pending:null, turn:0, deck:[], discard:[], log:[], started:true, gameMode:'free' };
}
const logHas=(g,re)=>g.log.some(l=>re.test(typeof l==='string'?l:JSON.stringify(l)));
const countLog=(g,re)=>g.log.filter(l=>re.test(typeof l==='string'?l:JSON.stringify(l))).length;

console.log('== CORE-147: 桃园结义跳过满体力角色 ==\n');

check('全员满血:一轮无懈询问都不开,直接结算完毕',()=>{
  const g=mkGame([4,4,4]);
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.notStrictEqual(g.phase,'wuxie','不应进入无懈询问阶段');
  assert.strictEqual(g.phase,'play','应直接回到出牌阶段,实际 '+g.phase);
  assert.strictEqual(g.pending,null,'pending 必须置空(链结束的既有纪律)');
  assert.ok(logHas(g,/结算完毕/),'应记录结算完毕');
  assert.strictEqual(countLog(g,/体力已满/),3,'三个满血角色都应各记一条"体力已满"');
});

check('全员满血:不产生任何"结算对…的【桃园结义】"询问日志',()=>{
  const g=mkGame([4,4,4]);
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.strictEqual(countLog(g,/结算对 .* 的【桃园结义】/),0,
    '满血角色不应触发逐目标询问');
});

check('混合顺序:满血的被跳过,受伤的仍正常进入无懈询问',()=>{
  const g=mkGame([4,2,4]);            // 只有 P1 受伤
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.strictEqual(g.phase,'wuxie','受伤角色应进入无懈询问');
  assert.ok(g.pending && g.pending.to===1,'当前询问目标应是受伤的 P1,实际 '
    +(g.pending?g.pending.to:'无 pending'));
  assert.strictEqual(countLog(g,/体力已满/),1,'跳过的 P0 应记一条"体力已满"');
});

check('受伤者在队列末尾:前面的满血全部跳过后仍能被结算到',()=>{
  const g=mkGame([4,4,1]);
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.strictEqual(g.phase,'wuxie');
  assert.strictEqual(g.pending.to,2,'应推进到队列最后的受伤者');
  assert.strictEqual(countLog(g,/体力已满/),2);
});

check('阵亡者仍然被跳过(既有行为未被破坏)',()=>{
  const g=mkGame([4,2,2]);
  g.players[1].alive=false;
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.strictEqual(g.pending.to,2,'阵亡的 P1 应被跳过,推进到 P2');
  assert.ok(!logHas(g,/P1 受【桃园结义】影响,体力已满/),
    '阵亡者不应记"体力已满"(他是因阵亡被跳过,不是因满血)');
});

check('超过体力上限(理论脏数据)同样按满血跳过',()=>{
  const g=mkGame([5,2,2]);            // P0 的 hp 高于 maxHp
  call('startTaoyuanWuxie', g, 0, [0,1,2], 0);
  assert.strictEqual(g.pending.to,1,'hp>maxHp 也应被跳过');
});

check('破坏性验证:还原成只跳过阵亡者的旧写法,满血角色确实会开轮询(证明断言有鉴别力)',()=>{
  const src=fs.readFileSync(path.join(ROOT,'game.js'),'utf8');
  const i=src.indexOf('function startTaoyuanWuxie(g, from, order, idx){');
  const j=src.indexOf('function finishTaoyuanTarget');
  assert.ok(i>=0&&j>i,'定位不到 startTaoyuanWuxie');
  const old=src.slice(0,i)
    + 'function startTaoyuanWuxie(g, from, order, idx){\n'
    + '  while(idx<order.length && (!g.players[order[idx]] || !g.players[order[idx]].alive)) idx++;\n'
    + src.slice(src.indexOf('  if(idx>=order.length){', i), j);
  const sb2=load();
  vm.runInContext(old.slice(old.indexOf('function startTaoyuanWuxie')), sb2, {filename:'old'});
  const g=mkGame([4,4,4]);
  sb2.startTaoyuanWuxie(g,0,[0,1,2],0);
  assert.strictEqual(g.phase,'wuxie','旧写法下满血角色确实会开无懈轮询——断言能变红');
});

console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
