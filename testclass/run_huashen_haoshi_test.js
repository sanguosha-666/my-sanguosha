/**
 * 左慈【化身】借用鲁肃【好施】回归测试。
 * 规格: HUASHEN_SKILL_TABLE.lusu 的"好施"必须把 caps:['haoshi','extraDrawPhase']
 * 捆绑在同一个条目里整体借用(仿凌统【旋风】caps+hook 捆绑的架构约定)——曾经被拆成
 * "好施"和"好施(额外摸牌)"两条可独立借用的记录,导致左慈无论声明哪一条都只能拿到
 * 摸牌加成或交牌门槛判定中的一半,永远无法同时获得完整【好施】。
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const context = {
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document: {
    getElementById() { return { onclick:null, onchange:null, style:{}, innerHTML:'', textContent:'', value:'', classList:{ add(){}, remove(){}, toggle(){} } }; },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener(){}, createElement(){ return {}; }
  },
  window: { location:{ search:'', href:'' }, localStorage:{ getItem(){ return null; }, setItem(){} }, addEventListener(){}, setTimeout, clearTimeout, alert(){} },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean, parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document; context.window.firebase = context.firebase; context.global = context;
const sandbox = vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js']
  .forEach(f => vm.runInContext(fs.readFileSync(f,'utf8'), sandbox, { filename:f }));
const R = code => vm.runInContext(code, sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq = () => R('emptyEquips')();
const card = (id, name='杀') => ({ id, name, suit:'♠', rank:7 });

let passed = 0;
function check(name, fn){ try { fn(); console.log('  PASS', name); passed++; } catch(e){ console.log('  FAIL', name, '-', e.stack || e.message); process.exitCode = 1; } }

// ---------- 断言 1: HUASHEN_SKILL_TABLE.lusu 只有"好施"和"缔盟"两个条目 ----------
check('HUASHEN_SKILL_TABLE.lusu 只有好施/缔盟两条,不存在"好施(额外摸牌)"', function(){
  const entries = R('HUASHEN_SKILL_TABLE.lusu');
  assert.ok(Array.isArray(entries), 'lusu 应有技能条目数组');
  assert.deepStrictEqual(Array.from(entries, e => e.name), ['好施','缔盟']);
  assert.ok(!entries.some(e => e.name.includes('好施(额外摸牌)')), '不得残留非官方技能名"好施(额外摸牌)"');
  const haoshiEntry = entries.find(e => e.name === '好施');
  assert.ok(haoshiEntry, '应有"好施"条目');
  assert.deepStrictEqual(Array.from(haoshiEntry.caps), ['haoshi','extraDrawPhase'], '好施必须捆绑声明 haoshi 和 extraDrawPhase 两个 cap(仿凌统旋风整体借用)');
  assert.strictEqual(haoshiEntry.hook, undefined, '好施不依赖 hook(和旋风特例不同,两个 cap 都是查询型)');
});

// ---------- 通用玩家构造 ----------
function makeG(opts){
  const zuoci = { name:'左慈', general:'zuoci', hp:3, maxHp:3, hand:[], equips:eq(), delays:[], alive:true, caps:{} };
  if(opts.huashen){ zuoci.huashenGeneral = opts.huashen; zuoci.huashenSkillName = opts.skill; }
  const others = (opts.others || []).map((h, i) => ({
    name: '对手'+i, general:'caocao', hp:4, maxHp:4, hand: h, equips:eq(), delays:[], alive:true, caps:{}
  }));
  const players = [zuoci].concat(others);
  return { players, deck:[], discard:[], log:[], phase:'draw', turn:0, roundNum:1, gameMode:'ffa', pending:null, lianyingQueue:[] };
}

// ---------- 断言 2: huashenHasCap / huashenCapValue 对借用的好施同时生效 ----------
check('左慈声明借用"好施"后 huashenHasCap(haoshi)=true 且 huashenCapValue(extraDrawPhase)=2', function(){
  const g = makeG({ huashen:'lusu', skill:'好施' });
  sandbox.__g = g;
  assert.strictEqual(R('huashenHasCap')(g.players[0], 'haoshi'), true, '应能判定拥有 haoshi 能力');
  assert.strictEqual(R('huashenCapValue')(g.players[0], 'extraDrawPhase', 0), 2, '数值型 cap 应现查 GENERALS.lusu.caps.extraDrawPhase = 2');
  assert.strictEqual(R('hasCap')(g.players[0], 'haoshi'), true, 'hasCap 统一入口也应命中借用的好施');
});

// ---------- 断言 3: 摸牌阶段实际摸牌数 = 2 基础 + 2 好施 = 4 ----------
check('drawPhaseCount: 左慈借好施 = 4(2基础+2好施),与真实鲁肃一致', function(){
  const huashenG = makeG({ huashen:'lusu', skill:'好施' });
  sandbox.__g = huashenG;
  assert.strictEqual(R('drawPhaseCount')(huashenG, 0), 4, '左慈借好施摸牌数应为4');
  const lusuG = makeG({});
  lusuG.players[0].general = 'lusu';
  lusuG.players[0].name = '鲁肃';
  sandbox.__g = lusuG;
  assert.strictEqual(R('drawPhaseCount')(lusuG, 0), 4, '真实鲁肃摸牌数应为4');
});

check('doDraw 端到端: 左慈借好施实际摸 4 张(与真实鲁肃走同一分支)', function(){
  const g = makeG({ huashen:'lusu', skill:'好施' });
  g.deck = [card('d1'), card('d2'), card('d3'), card('d4')];
  sandbox.__g = g;
  R('doDraw')();
  assert.strictEqual(g.players[0].hand.length, 4, 'doDraw 后左慈应摸到4张牌');
  assert.strictEqual(g.phase, 'play', '摸牌完成后应正常进入出牌阶段');
});

// ---------- 断言 4: 手牌数超过 5 时触发"交给手牌最少角色"判定 ----------
check('手牌>5 时触发好施交牌: 交给手牌最少角色(与真实鲁肃同分支)', function(){
  // 左慈借好施: 初始3张 + 摸4张 = 7张 > 5, 需交出 floor(7/2)=3 张
  const g = makeG({ huashen:'lusu', skill:'好施', others:[ [card('o1')] ] });
  g.players[0].hand = [card('h1'), card('h2'), card('h3')];
  g.deck = [card('d1'), card('d2'), card('d3'), card('d4')];
  sandbox.__g = g;
  R('doDraw')();
  assert.strictEqual(g.players[0].hand.length, 4, '左慈交出3张后应剩4张');
  assert.strictEqual(g.players[1].hand.length, 4, '对手(全场手牌最少)应收下3张');
  assert.ok(g.log.some(l => l.text.includes('发动【好施】')), '日志应记录发动好施');
});

check('真实鲁肃同样场景: 手牌>5 时走同一交牌分支', function(){
  const g = makeG({ others:[ [card('o1')] ] });
  g.players[0].general = 'lusu';
  g.players[0].name = '鲁肃';
  g.players[0].hand = [card('h1'), card('h2'), card('h3')];
  g.deck = [card('d1'), card('d2'), card('d3'), card('d4')];
  sandbox.__g = g;
  R('doDraw')();
  assert.strictEqual(g.players[0].hand.length, 4, '真实鲁肃交出3张后应剩4张');
  assert.strictEqual(g.players[1].hand.length, 4, '对手应收下3张');
  assert.ok(g.log.some(l => l.text.includes('发动【好施】')), '日志应记录发动好施');
});

// ---------- 断言 5: 周瑜【英姿】不被破坏(共用 extraDrawPhase 的回归) ----------
check('周瑜【英姿】回归: 借用英姿时 extraDrawPhase=1', function(){
  const g = makeG({ huashen:'zhouyu', skill:'英姿' });
  sandbox.__g = g;
  assert.strictEqual(R('huashenCapValue')(g.players[0], 'extraDrawPhase', 0), 1, '借英姿应现查 GENERALS.zhouyu.caps.extraDrawPhase = 1');
  assert.strictEqual(R('drawPhaseCount')(g, 0), 3, '借英姿摸牌数应为3');
});

check('validateHuashenPick: "好施"是合法可借用技能名', function(){
  assert.strictEqual(R('validateHuashenPick')(['lusu'], 'lusu', '好施'), true, '好施应可被声明借用');
  assert.strictEqual(R('validateHuashenPick')(['lusu'], 'lusu', '好施(额外摸牌)'), false, '非官方技能名"好施(额外摸牌)"不得通过校验');
});

console.log('huashen-haoshi tests: ' + passed + '/8 passed');
