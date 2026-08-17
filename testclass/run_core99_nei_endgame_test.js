/**
 * CORE-99(issue #146):内奸AI未适配项目自定义胜利条件,反贼全灭后仍保护主公或优先攻击
 * 忠臣。
 *
 * 项目自定义身份局胜利条件(game.js checkWin,gameMode==='identity'分支):主公死亡时,
 * 反贼若还有人活着则反贼胜,否则(反贼已全灭)内奸若活着则内奸胜——忠臣是否存活完全不
 * 参与这个判断。旧的botTargetScore内奸分支用`alive&&roleRevealed&&role==='fan'`统计
 * "剩余反贼数",这个条件在正常游戏中恒为0(存活的反贼在阵亡/游戏结束前不会公开身份),
 * 导致"反贼确认全灭"这个终局阶段从未被真正识别,内奸对低血主公的保护(target.hp<=2
 * 返回-Infinity)在任何阶段都生效,即使反贼已经全部阵亡也不会去击杀主公。
 *
 * 修复:新增botNeiSituation(g,seat)(仅用公开信息:IDENTITY_TABLE按人数算出的反贼总数
 * +已阵亡且身份公开是反贼的人数,CORE-99/CORE-100共用),botTargetScore的内奸分支和
 * botCanSave(是否用桃救濒死者)都按这个真实阶段判断:反贼确认全灭后取消对主公的保护、
 * 反而以主公为最优先目标,且不会去救濒死的主公。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

const context = {
  gameRef: { transaction(fn){ return fn(context._g || {}); } },
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, push(){ return { set(){}, key:'k' }; },
      transaction(){ return {}; }, set(){}, update(){}, child(){ return this; }, remove(){},
      get(){ return { val(){ return null; } }; }
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
      style:{}, className:'', textContent:'', innerHTML:'', onclick:null, disabled:false,
      setAttribute(){}, appendChild(){ return {}; },
      classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } }
    }; },
    createTextNode(t){ return { textContent:t }; },
    createDocumentFragment(){ return { appendChild(){} }; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    body:{ appendChild(){} }, head:{ appendChild(){} }, addEventListener(){}
  },
  window: {
    location:{ search:'', href:'http://localhost' },
    localStorage:{ getItem(){ return null; }, setItem(){} },
    addEventListener(){}, setTimeout, clearTimeout, alert(){}, confirm(){ return true; },
    navigator:{ userAgent:'test' }, matchMedia(){ return { matches:false, addEventListener(){} }; }
  },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean,
  parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;
const sandbox = vm.createContext(context);

['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js',
 'weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js','ai-bot.js','render.js'
].forEach(f=>{
  vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), sandbox, { filename:f });
  if(f==='game.js'){
    vm.runInContext(`
      tx = function(fn){ if(typeof _g==='undefined'||!_g) return; return fn(_g); };
      gameRef = { transaction: function(fn){ return tx(fn); } };
      mySeat = 0;
      var _g = null;
    `, sandbox);
  }
});

function R(code){ return vm.runInContext(code, sandbox); }
function emptyEq(){ return R('emptyEquips')(); }

// 6人局(IDENTITY_TABLE[6] = ['zhu','zhong','fan','fan','fan','nei'],反贼总数3)。
// 座位0=内奸(机器人)。座位1=主公。座位2/3/4=反贼(初始全部存活)。座位5=忠臣。
function mkGame(opts){
  opts = opts || {};
  const players = [];
  for(let i=0;i<6;i++){
    players.push({
      name:'p'+i, general:'caocao', hp:4, maxHp:4,
      hand:[card('杀','s'+i)], equips: emptyEq(), delays:[], alive:true, dying:false,
      role:null, roleRevealed:false
    });
  }
  players[0].role = 'nei';
  players[1].role = 'zhu'; players[1].roleRevealed = true;
  players[1].hp = (opts.zhuHp !== undefined) ? opts.zhuHp : 4;
  players[2].role = 'fan'; players[3].role = 'fan'; players[4].role = 'fan';
  players[5].role = 'zhong'; players[5].roleRevealed = !!opts.zhongRevealed;
  (opts.deadRebels||[]).forEach(seat=>{ players[seat].alive = false; players[seat].roleRevealed = true; });
  return {
    phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:1000+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{}
  };
}
function card(name, id, suit, rank){ return { id: id||name, name, suit: suit||'♠', rank: rank||7 }; }

console.log('\n== CORE-99:内奸终局识别(反贼确认全灭后应直接击杀主公) ==\n');

check('botNeiSituation:全部反贼存活时,killLordNow为false、rebelsMayRemain为true', ()=>{
  const g = mkGame({});
  const s = R('botNeiSituation')(g, 0);
  assert.strictEqual(s.totalRebels, 3, 'IDENTITY_TABLE[6]应有3名反贼');
  assert.strictEqual(s.rebelsConfirmedDead, 0);
  assert.strictEqual(s.rebelsMayRemain, true);
  assert.strictEqual(s.killLordNow, false);
});

check('botNeiSituation:部分反贼阵亡(2/3)时仍判定rebelsMayRemain=true(未确认全灭)', ()=>{
  const g = mkGame({ deadRebels:[2,3] });
  const s = R('botNeiSituation')(g, 0);
  assert.strictEqual(s.rebelsConfirmedDead, 2);
  assert.strictEqual(s.rebelsMayRemain, true, '还有1名反贼未确认阵亡,不能判定已全灭');
  assert.strictEqual(s.killLordNow, false);
});

check('botNeiSituation:全部3名反贼确认阵亡时,killLordNow为true', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] });
  const s = R('botNeiSituation')(g, 0);
  assert.strictEqual(s.rebelsConfirmedDead, 3);
  assert.strictEqual(s.rebelsMayRemain, false);
  assert.strictEqual(s.killLordNow, true);
});

check('botTargetScore:反贼可能残存时,内奸对低血(hp<=2)主公仍保护(-Infinity)', ()=>{
  const g = mkGame({ zhuHp: 2 });
  const score = R('botTargetScore')(g, 0, 1, 'damage');
  assert.strictEqual(score, -Infinity, '反贼未确认全灭时不应对低血主公出手,实际 '+score);
});

check('botTargetScore:反贼确认全灭+主公命悬一线(hp=1)时,内奸应给主公最高分而非-Infinity(核心场景复现issue描述)', ()=>{
  const g = mkGame({ deadRebels:[2,3,4], zhuHp: 1, zhongRevealed:false });
  const score = R('botTargetScore')(g, 0, 1, 'damage');
  assert.ok(score > 0 && score !== -Infinity, '反贼全灭后应能对主公出手,实际 '+score);
  // 忠臣仍存活且未公开(zhongRevealed:false代表忠臣身份对内奸不可见,只能按suspicion打分)
  // 不应阻止上面这个针对主公的高分——用对照组验证:忠臣的分数不应高于主公。
  const zhongScore = R('botTargetScore')(g, 0, 5, 'damage');
  assert.ok(score > zhongScore, '反贼全灭后主公应是比忠臣更优先的目标,主公分='+score+' 忠臣分='+zhongScore);
});

check('botTargetScore:反贼确认全灭+忠臣仍存活,不阻止对主公的高分(忠臣是否存活不影响判断)', ()=>{
  const g1 = mkGame({ deadRebels:[2,3,4], zhuHp: 3 });
  const g2 = mkGame({ deadRebels:[2,3,4], zhuHp: 3 });
  g2.players[5].alive = false; g2.players[5].roleRevealed = true; // 忠臣已死的对照组
  const scoreZhongAlive = R('botTargetScore')(g1, 0, 1, 'damage');
  const scoreZhongDead = R('botTargetScore')(g2, 0, 1, 'damage');
  assert.strictEqual(scoreZhongAlive, scoreZhongDead, '忠臣存活与否不应改变内奸对主公的评分,实际 '+scoreZhongAlive+' vs '+scoreZhongDead);
});

check('botCanSave:反贼可能残存时,内奸应救濒死的主公(保主公当缓冲)', ()=>{
  const g = mkGame({});
  const dying = { role:'zhu', hp:0, roleRevealed:true };
  g.players[1] = Object.assign(g.players[1], dying);
  const canSave = R('botCanSave')(g, 0, 1);
  assert.strictEqual(canSave, true, '反贼未确认全灭时内奸应救濒死的主公');
});

check('botCanSave:反贼确认全灭时,内奸不应救濒死的主公(主公死正是终局胜利条件)', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] });
  const dying = { role:'zhu', hp:0, roleRevealed:true };
  g.players[1] = Object.assign(g.players[1], dying);
  const canSave = R('botCanSave')(g, 0, 1);
  assert.strictEqual(canSave, false, '反贼确认全灭后内奸不应救濒死的主公');
});

check('破坏性验证:还原成旧的rebels统计条件(alive&&roleRevealed&&fan),证明它在正常游戏里恒为0——旧写法下"反贼全灭"这一分支从未生效', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] }); // 反贼全部阵亡,roleRevealed全部为true但alive=false
  const rebelsOld = g.players.filter(p=>p&&p.alive&&p.roleRevealed&&p.role==='fan').length;
  if(rebelsOld !== 0) throw new Error('旧统计条件在这个反贼全灭场景下应该是0,如果不是0说明旧bug的复现前提本身有问题,实际 '+rebelsOld);
  // 而新的rebelsConfirmedDead能正确识别出3
  const s = R('botNeiSituation')(g, 0);
  if(s.rebelsConfirmedDead !== 3) throw new Error('新统计应该正确识别出3名反贼已阵亡,如果没有说明修复没有生效,实际 '+s.rebelsConfirmedDead);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
