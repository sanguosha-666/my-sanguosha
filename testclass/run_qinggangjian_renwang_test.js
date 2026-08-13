/**
 * 青釭剑无视仁王盾 回归测试
 *
 * 背景：青釭剑锁定技"无视对方防具"应连仁王盾这种防具产生的黑杀无效锁定技效果一并破解，
 * 目标必须正常出闪应战（不是直接免疫）；而于禁【毅重】的触发条件是"没有装备防具"这个
 * 状态本身，不是"防具的效果"，青釭剑"无视防具"对着一件不存在的防具无从谈起，不受影响。
 * 已用 WebSearch 核实官方 FAQ 原文：
 *   "装备了【青釭剑】是否可以对装备了【仁王盾】的角色用黑【杀】攻击？答案是可以，
 *    对方需要出【闪】。【青釭剑】的锁定技是无视防具，同时也无视【仁王盾】的技能效果。"
 *   "【毅重】——锁定技，当你没装备防具时，黑色的【杀】对你无效。"
 * 排查确认：game.js:afterShaTargetSkills / weapons.js:continueAfterCixiong 这两处黑杀
 * 无效判断，此前已由 c8164d4c（"修复连环伤害与多目标杀结算"）一并修好，本次任务是
 * 独立验证 + 补齐 CLAUDE.md 记录，不是重新实现。
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

function freshSandbox(){
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
  ['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>{
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
  return sandbox;
}

function R(sandbox, code){ return vm.runInContext(code, sandbox); }
function bindG(sandbox, g){ sandbox.__tg = g; vm.runInContext('_g = __tg;', sandbox); }

function emptyEq(sandbox){ return R(sandbox, 'emptyEquips')(); }
function mkPlayer(sandbox, name, genId, extra){
  const gen = R(sandbox, 'getGeneral')(genId);
  return Object.assign({
    name, general: genId, gender: gen&&gen.gender,
    hp: gen?gen.maxHp:4, maxHp: gen?gen.maxHp:4,
    hand: [], equips: emptyEq(sandbox), delays: [], alive: true, dying: false
  }, extra||{});
}

console.log('\n== 青釭剑无视仁王盾 ==\n');

check('数据表：青釭剑 cap=ignoreArmor，仁王盾 cap=renwang，于禁毅重 caps 含 yizhong', ()=>{
  const sandbox = freshSandbox();
  const qgj = R(sandbox, 'getEquip')('青釭剑');
  assert.strictEqual(qgj.cap, 'ignoreArmor');
  const rwd = R(sandbox, 'getEquip')('仁王盾');
  assert.strictEqual(rwd.cap, 'renwang');
  assert.strictEqual(rwd.slot, 'armor');
  const gen = R(sandbox, 'getGeneral')('yujin');
  assert.ok(gen.caps && gen.caps.yizhong);
});

// 场景1(核心)：攻击者装备青釭剑，对装备仁王盾的目标使用黑杀 → 应正常进入响应阶段(respond)，
// 不应被直接判定无效(finishSingleShaTarget/phase='play')。
check('核心:攻击者有青釭剑,对仁王盾目标使用黑杀 → 正常进入响应阶段(respond),需要目标出闪', ()=>{
  const sandbox = freshSandbox();
  const attacker = mkPlayer(sandbox, '攻击者', 'zhangfei', { equips: Object.assign(emptyEq(sandbox), { weapon:{id:1,name:'青釭剑'} }) });
  const target = mkPlayer(sandbox, '目标', 'zhaoyun', { equips: Object.assign(emptyEq(sandbox), { armor:{id:2,name:'仁王盾'} }), hand:[{id:3,name:'闪'}] });
  const g = { players:[attacker, target], turn:0, phase:'play', pending:null, log:[], discard:[], deck:[] };
  bindG(sandbox, g);
  const resolveShaUse = R(sandbox, 'resolveShaUse');
  const singleCardShaColor = R(sandbox, 'singleCardShaColor');
  const blackSha = { id:9, name:'杀', suit:'♠', rank:5 };
  resolveShaUse(sandbox.__tg, attacker, 1, '杀', singleCardShaColor(blackSha), blackSha, undefined);
  const finalG = sandbox.__tg;
  // 本项目的杀响应约定是 g.phase==='respond'（不是 pending.type=='respond'——标准杀响应
  // 的 pending 结构本来就只是 {from,to,noShan,shaColor,sourceCard}，没有 type 字段，
  // 见 game.js:continueShaAfterTieqi）。
  assert.strictEqual(finalG.phase, 'respond', 'phase 应为 respond，实际=' + finalG.phase);
  assert.ok(finalG.pending, 'pending 不应为空');
  assert.strictEqual(finalG.pending.to, 1, 'pending.to 应指向目标座位1');
  const lastLog = finalG.log[finalG.log.length-1];
  const lastText = typeof lastLog==='string' ? lastLog : lastLog.text;
  assert.ok(!/仁王盾.*无效/.test(lastText), '日志不应出现"仁王盾无效"，实际日志=' + lastText);
});

// 场景2(回归)：攻击者没有青釭剑，对装备仁王盾的目标使用黑杀 → 依然正确无效。
check('回归:攻击者无青釭剑,对仁王盾目标使用黑杀 → 依然正确判定无效', ()=>{
  const sandbox = freshSandbox();
  const attacker = mkPlayer(sandbox, '攻击者', 'zhangfei');
  const target = mkPlayer(sandbox, '目标', 'zhaoyun', { equips: Object.assign(emptyEq(sandbox), { armor:{id:2,name:'仁王盾'} }), hand:[{id:3,name:'闪'}] });
  const g = { players:[attacker, target], turn:0, phase:'play', pending:null, log:[], discard:[], deck:[] };
  bindG(sandbox, g);
  const resolveShaUse = R(sandbox, 'resolveShaUse');
  const singleCardShaColor = R(sandbox, 'singleCardShaColor');
  const blackSha = { id:9, name:'杀', suit:'♠', rank:5 };
  resolveShaUse(sandbox.__tg, attacker, 1, '杀', singleCardShaColor(blackSha), blackSha, undefined);
  const finalG = sandbox.__tg;
  assert.strictEqual(finalG.phase, 'play', 'phase 应回到 play，实际=' + finalG.phase);
  assert.strictEqual(finalG.pending, null, 'pending 应为 null');
  const lastLog = finalG.log[finalG.log.length-1];
  const lastText = typeof lastLog==='string' ? lastLog : lastLog.text;
  assert.ok(/仁王盾.*无效/.test(lastText), '日志应出现"仁王盾…无效"，实际=' + lastText);
});

// 场景3(回归)：攻击者装备青釭剑，对没有防具且有毅重能力的目标使用黑杀 → 青釭剑不破毅重,
// 依然正确无效(因为毅重触发条件是"没有防具"这个状态本身,不是防具产生的效果)。
check('回归:攻击者有青釭剑,对无防具的于禁(毅重)使用黑杀 → 青釭剑不破毅重,依然无效', ()=>{
  const sandbox = freshSandbox();
  const attacker = mkPlayer(sandbox, '攻击者', 'zhangfei', { equips: Object.assign(emptyEq(sandbox), { weapon:{id:1,name:'青釭剑'} }) });
  const target = mkPlayer(sandbox, '于禁', 'yujin', { hand:[{id:3,name:'闪'}] }); // 无防具
  const g = { players:[attacker, target], turn:0, phase:'play', pending:null, log:[], discard:[], deck:[] };
  bindG(sandbox, g);
  const resolveShaUse = R(sandbox, 'resolveShaUse');
  const singleCardShaColor = R(sandbox, 'singleCardShaColor');
  const blackSha = { id:9, name:'杀', suit:'♠', rank:5 };
  resolveShaUse(sandbox.__tg, attacker, 1, '杀', singleCardShaColor(blackSha), blackSha, undefined);
  const finalG = sandbox.__tg;
  assert.strictEqual(finalG.phase, 'play', 'phase 应回到 play(毅重无效收尾)，实际=' + finalG.phase);
  assert.strictEqual(finalG.pending, null, 'pending 应为 null');
  const lastLog = finalG.log[finalG.log.length-1];
  const lastText = typeof lastLog==='string' ? lastLog : lastLog.text;
  assert.ok(/毅重.*无效/.test(lastText), '日志应出现"毅重…无效"，实际=' + lastText);
});

// 场景3b(对照):不装青釭剑同样对无防具的于禁使用黑杀 → 同样无效(确认场景3的"无效"结果
// 不是巧合，就算没有青釭剑也一样无效——真正要验证的是"有青釭剑时依然无效"这件事)。
check('对照:无青釭剑,对无防具的于禁使用黑杀 → 同样正确无效', ()=>{
  const sandbox = freshSandbox();
  const attacker = mkPlayer(sandbox, '攻击者', 'zhangfei');
  const target = mkPlayer(sandbox, '于禁', 'yujin', { hand:[{id:3,name:'闪'}] });
  const g = { players:[attacker, target], turn:0, phase:'play', pending:null, log:[], discard:[], deck:[] };
  bindG(sandbox, g);
  const resolveShaUse = R(sandbox, 'resolveShaUse');
  const singleCardShaColor = R(sandbox, 'singleCardShaColor');
  const blackSha = { id:9, name:'杀', suit:'♠', rank:5 };
  resolveShaUse(sandbox.__tg, attacker, 1, '杀', singleCardShaColor(blackSha), blackSha, undefined);
  const finalG = sandbox.__tg;
  assert.strictEqual(finalG.phase, 'play');
  assert.strictEqual(finalG.pending, null);
});

// 场景4(顺带回归)：青釭剑对八卦阵的既有"无视判定"逻辑不受这次核查影响，仍正常工作——
// 官方FAQ:青釭剑无视防具只对使用【杀】生效,效果是"跳过防具的判定机会,直接进入正常的
// 杀/闪响应"，不是"直接造成伤害"(见 game.js:continueShaAfterTieqi 2971-2975:
// hasCap(me,'ignoreArmor') 命中时只是跳过 tryBagua、直接 phase='respond'，目标仍要
// 正常应战,和仁王盾一样都是"跳过防具专属的锁定判定,回到正常响应流程"这同一个机制)。
check('顺带回归:青釭剑对八卦阵的既有无视逻辑不受影响,仍正常工作', ()=>{
  const sandbox = freshSandbox();
  const attacker = mkPlayer(sandbox, '攻击者', 'zhangfei', { equips: Object.assign(emptyEq(sandbox), { weapon:{id:1,name:'青釭剑'} }) });
  const target = mkPlayer(sandbox, '目标', 'zhaoyun', { equips: Object.assign(emptyEq(sandbox), { armor:{id:2,name:'八卦阵'} }), hand:[] });
  const g = { players:[attacker, target], turn:0, phase:'play', pending:null, log:[], discard:[], deck:[{id:99,name:'杀',suit:'♠',rank:3}] };
  bindG(sandbox, g);
  const resolveShaUse = R(sandbox, 'resolveShaUse');
  const singleCardShaColor = R(sandbox, 'singleCardShaColor');
  const redSha = { id:9, name:'杀', suit:'♥', rank:5 };
  resolveShaUse(sandbox.__tg, attacker, 1, '杀', singleCardShaColor(redSha), redSha, undefined);
  const finalG = sandbox.__tg;
  assert.strictEqual(finalG.phase, 'respond', 'phase 应为 respond(跳过八卦阵判定,直接进入正常响应)，实际=' + finalG.phase);
  assert.ok(finalG.pending, 'pending 不应为空');
  const lastLog = finalG.log[finalG.log.length-1];
  const lastText = typeof lastLog==='string' ? lastLog : lastLog.text;
  assert.ok(/青釭剑.*无视/.test(lastText), '日志应出现"…青釭剑…无视…"，实际=' + lastText);
  // 牌堆不应被消耗——tryBagua(翻判定牌)这一步应该被完全跳过，没有发生任何判定。
  assert.strictEqual(finalG.deck.length, 1, '牌堆不应被消耗(说明八卦阵判定确实被跳过,不是判定后恰好没生效)');
});

console.log('\n============================================================');
console.log('  PASS:', passed, '  FAIL:', failed);
console.log('============================================================\n');
process.exit(failed ? 1 : 0);
