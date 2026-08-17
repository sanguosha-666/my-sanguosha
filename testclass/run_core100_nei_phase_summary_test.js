/**
 * CORE-100(issue #147):内奸阶段识别与身份推断未真正进入本地评分,三阶段策略与实际行为
 * 脱节。
 *
 * AI prompt(BOT_IDENTITY_GUIDANCE.nei)描述了内奸分阶段策略,但无Key本地评分(见CORE-99/
 * issue #146已修复的botTargetScore)和有Key的LLM prompt此前各自独立、没有共用同一份
 * "公开信息阶段摘要",容易出现有Key/无Key两套行为分裂。
 *
 * 修复(在CORE-99已建立的botNeiSituation基础上):
 * - buildBotVisibleState新增neiSituation字段(仅身份局+内奸座位时出现),把
 *   {totalRebels,rebelsConfirmedDead,rebelsMayRemain,killLordNow}这份结构化数据交给
 *   LLM,和本地兜底botTargetScore用的是同一个botNeiSituation函数算出来的同一份数字。
 * - botIdentityGuidance的nei分支把这份局势数字直接拼进prompt文字里(不只是让LLM自己
 *   从state字段猜),前中期/终局两种阶段各自有明确的文字提示。
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
function card(name, id, suit, rank){ return { id: id||name, name, suit: suit||'♠', rank: rank||7 }; }

// 6人局(IDENTITY_TABLE[6],反贼总数3)。座位0=内奸。座位1=主公。座位2/3/4=反贼。座位5=忠臣。
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
  players[2].role = 'fan'; players[3].role = 'fan'; players[4].role = 'fan';
  players[5].role = 'zhong';
  (opts.deadRebels||[]).forEach(seat=>{ players[seat].alive = false; players[seat].roleRevealed = true; });
  return {
    phase:'play', turn:0, started:true, gameMode:'identity', players,
    deck: Array.from({length:20},(_,i)=>({id:1100+i,name:'杀',suit:'♠',rank:1})),
    discard:[], pending:null, log:[], exchangeCards:[], shaUsed:false, aiRebelSuspicion:{}
  };
}

console.log('\n== CORE-100:内奸阶段识别真正进入本地评分与LLM prompt ==\n');

// ---- 场景1:前期(反贼全部存活)----
check('buildBotVisibleState:前期(反贼全部存活),neiSituation.killLordNow为false', ()=>{
  const g = mkGame({});
  const state = R('buildBotVisibleState')(g, 0);
  assert.ok(state.neiSituation, 'neiSituation字段应存在');
  assert.strictEqual(state.neiSituation.totalRebels, 3);
  assert.strictEqual(state.neiSituation.rebelsConfirmedDead, 0);
  assert.strictEqual(state.neiSituation.rebelsMayRemain, true);
  assert.strictEqual(state.neiSituation.killLordNow, false);
});

check('botIdentityGuidance:前期prompt应提示"不能排除还有反贼",不应提示终局', ()=>{
  const g = mkGame({});
  const text = R('botIdentityGuidance')(g, 0);
  assert.ok(text.indexOf('不能排除还有反贼') >= 0, 'prompt应包含前中期提示,实际 '+text);
  assert.ok(text.indexOf('已经确认全部阵亡') < 0, '前期prompt不应出现终局措辞,实际 '+text);
});

// ---- 场景2:反贼可能残存(部分阵亡)----
check('buildBotVisibleState:反贼部分阵亡(2/3),rebelsMayRemain仍为true', ()=>{
  const g = mkGame({ deadRebels:[2,3] });
  const state = R('buildBotVisibleState')(g, 0);
  assert.strictEqual(state.neiSituation.rebelsConfirmedDead, 2);
  assert.strictEqual(state.neiSituation.rebelsMayRemain, true);
  assert.strictEqual(state.neiSituation.killLordNow, false);
});

check('botIdentityGuidance:反贼部分阵亡时,prompt数字应反映已确认死亡人数(2)且仍是前中期措辞', ()=>{
  const g = mkGame({ deadRebels:[2,3] });
  const text = R('botIdentityGuidance')(g, 0);
  assert.ok(text.indexOf('已通过阵亡公开确认2人是反贼') >= 0, 'prompt应包含具体数字2,实际 '+text);
  assert.ok(text.indexOf('不能排除还有反贼') >= 0, '仍应是前中期措辞,实际 '+text);
});

// ---- 场景3:反贼确认全灭(终局) ----
check('buildBotVisibleState:反贼确认全灭(3/3),killLordNow为true', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] });
  const state = R('buildBotVisibleState')(g, 0);
  assert.strictEqual(state.neiSituation.rebelsConfirmedDead, 3);
  assert.strictEqual(state.neiSituation.rebelsMayRemain, false);
  assert.strictEqual(state.neiSituation.killLordNow, true);
});

check('botIdentityGuidance:反贼确认全灭时,prompt应明确提示"终局阶段""主公是唯一需要解决的目标"', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] });
  const text = R('botIdentityGuidance')(g, 0);
  assert.ok(text.indexOf('已经确认全部阵亡') >= 0, 'prompt应包含终局措辞,实际 '+text);
  assert.ok(text.indexOf('终局阶段') >= 0, 'prompt应明确提到终局阶段,实际 '+text);
  assert.ok(text.indexOf('主公是你唯一需要解决的目标') >= 0, 'prompt应明确点出主公是终局目标,实际 '+text);
});

// ---- 非内奸身份/非身份局:不应出现neiSituation字段(避免不必要的信息泄露/噪音) ----
check('buildBotVisibleState:忠臣视角不应出现neiSituation字段', ()=>{
  const g = mkGame({});
  const state = R('buildBotVisibleState')(g, 5); // 座位5=忠臣
  assert.strictEqual(state.neiSituation, undefined, '忠臣不应看到内奸专属的neiSituation字段');
});

check('buildBotVisibleState:FFA模式不应出现neiSituation字段', ()=>{
  const g = mkGame({});
  g.gameMode = 'ffa';
  const state = R('buildBotVisibleState')(g, 0);
  assert.strictEqual(state.neiSituation, undefined, 'FFA模式不应出现neiSituation字段');
});

check('botIdentityGuidance:FFA模式返回空串,不含任何内奸阶段文字', ()=>{
  const g = mkGame({ deadRebels:[2,3,4] });
  g.gameMode = 'ffa';
  const text = R('botIdentityGuidance')(g, 0);
  assert.strictEqual(text, '', 'FFA模式应返回空串');
});

// ---- LLM/fallback口径一致性:两者用的是同一个botNeiSituation ----
check('口径一致性:buildBotVisibleState.neiSituation与botIdentityGuidance文字数字、以及botTargetScore实际行为三方一致', ()=>{
  const g = mkGame({ deadRebels:[2,3,4], });
  g.players[1].hp = 1; // 主公命悬一线
  const state = R('buildBotVisibleState')(g, 0);
  const text = R('botIdentityGuidance')(g, 0);
  const scoreToLord = R('botTargetScore')(g, 0, 1, 'damage');
  assert.strictEqual(state.neiSituation.killLordNow, true);
  assert.ok(text.indexOf('终局阶段') >= 0);
  assert.ok(scoreToLord > 0 && scoreToLord !== -Infinity, '本地兜底评分应与终局判断一致(给主公正分),实际 '+scoreToLord);
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
