/**
 * CORE-78(issue #123)第一期:技能注册表骨架 —— 交叉验证。
 *
 * 【这个测试要防什么】注册表是"把散落在多个核心文件里的技能触发时机/条件/接入点
 * 摘录成一份清单"。摘录本身就可能出错(抄错 cap 名、漏登记某个技能、写了一个不存在
 * 的函数名),而且这类错误**不会让游戏跑挂**——本期注册表还没有被任何代码读取,错了
 * 也不影响运行,只会在第二、三期真正开始按表驱动时才爆炸。所以这份表的可信度不能
 * 靠"人工审阅看着对",必须由本测试回到真实代码逐条核对。
 *
 * 9 条规则(与 issue #123 处理方案确认稿一致):
 *   正向(登记内容必须与真实代码一致):
 *     1. 武将必须在 GENERALS 里存在
 *     2. 技能名必须出现在 GENERALS[id].skill 的斜杠拆分结果里(两处已知缺口除外,见下)
 *     3. 能力标识集合必须与 GENERALS[id].caps 的键完全一致(该武将全部技能合并后比对)
 *     4. 钩子集合必须与 GENERALS[id].hooks 的键完全一致(同上)
 *     5. 触发阶段每一项必须在 STAGE_TABLE 里真实存在
 *     6. 机器人接入每一项必须在 BOT_DECISIONS / BOT_SEAT_PICKS 里真实存在
 *     7. 效果函数每一项在沙箱全局里必须 typeof==='function'
 *   反向(防漏登记,最关键):
 *     8. GENERALS 里每一条 caps/hooks 声明都必须被注册表覆盖 —— 66 个武将一个不漏
 *     9. STAGE_TABLE / BOT_DECISIONS / BOT_SEAT_PICKS 每一项要么被注册表引用,
 *        要么在显式白名单里(白名单也是登记的一部分,不允许"没登记就算了")
 *
 * 【CORE-117(issue #125)已修复,不再需要规则2豁免】simayi/鬼才 原本因为
 * GENERALS.skill 漏写需要豁免,CORE-117 已把 data.js 改成 skill:'反馈/鬼才',
 * 现在和其它条目一样自然通过规则2,不再需要特殊处理。
 *
 * 【仍然存在的一处特征,不是缺口】sunce/魂姿 的 yinghun 能力是觉醒后运行时授予
 * (game.js 里 p.caps.yinghun=true),不在 GENERALS 静态 caps 里,所以它的触发阶段
 * 登记在魂姿名下、能力标识为空——这是技能本身的真实实现方式。
 *
 * 【CORE-117 新增:GENERALS.skill 与 HUASHEN_SKILL_TABLE 的全武将一致性校验】
 * simayi 这次的缺陷之所以能被发现,是因为 HUASHEN_SKILL_TABLE 恰好独立维护了一份
 * "真实技能名清单",两者一比对就露馅了。这条一致性本该对全部 66 个武将成立、不该
 * 只在出问题时临时人工比对——补一条通用校验,把 GENERALS[id].skill 斜杠拆分结果
 * 与 HUASHEN_SKILL_TABLE[id] 的技能名集合逐一比对,覆盖全部武将,不止司马懿一个。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const ctx = {
  console, Math, Date, JSON, RegExp, Object, Array, String, Number, Boolean, Set, Map, Promise,
  setTimeout, clearTimeout, setInterval, clearInterval,
  firebase:{ initializeApp:()=>({database:()=>({ref:()=>({on(){},once(){},push:()=>({set(){},key:'k'}),transaction(){return{};},set(){},update(){},child(){return{};},remove(){},get(){return{val(){return null;}};}})})}), database:()=>({ref:()=>({on(){},once(){},push:()=>({set(){},key:'k'}),transaction(){return{};},set(){},child(){return{};},remove(){}})})},
  document:{ getElementById:()=>({onclick:null,innerHTML:'',style:{},className:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},appendChild:()=>({}),remove(){},setAttribute(){},getAttribute:()=>null,addEventListener(){},removeEventListener(){}}), createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){},contains:()=>false},appendChild:()=>({}),setAttribute(){},getAttribute:()=>null,addEventListener(){}}), body:{appendChild:()=>({})}, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){}, removeEventListener(){} },
  window:{ location:{search:'',href:'http://x'}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}}, addEventListener(){}, removeEventListener(){}, navigator:{userAgent:'x'}, aiConversations:{} }
};
ctx.window.document = ctx.document; ctx.window.firebase = ctx.firebase; ctx.global = ctx;
vm.createContext(ctx);

const LOAD = ['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js',
  'sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js','bot.js',
  'ai-bot.js','render.js','render-table.js','render-hand.js','render-controls.js','render-log.js',
  'skills/skill-registry.js'];
console.log('\n加载真实源码 + 注册表...');
LOAD.forEach(function(f){
  try{ vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'), ctx, {filename:f}); }
  catch(e){ console.log('  加载失败 ' + f + ': ' + e.message); process.exit(1); }
});

const REG   = vm.runInContext('技能注册表', ctx);
const G     = vm.runInContext('GENERALS', ctx);
const ST    = vm.runInContext('STAGE_TABLE', ctx);
const BD    = vm.runInContext('BOT_DECISIONS', ctx);
const BSP   = vm.runInContext('BOT_SEAT_PICKS', ctx);
const hasWL = typeof vm.runInContext('typeof 非技能阶段白名单', ctx) === 'string'
  && vm.runInContext('typeof 非技能阶段白名单', ctx) === 'object';
const WL_STAGE = vm.runInContext('typeof 非技能阶段白名单!=="undefined" ? 非技能阶段白名单 : null', ctx);
const WL_BD    = vm.runInContext('typeof 非技能机器人决策白名单!=="undefined" ? 非技能机器人决策白名单 : null', ctx);

const keys = Object.keys(REG);
const partial = (WL_STAGE === null); // 分批登记过程中白名单还没写入 → 只跑正向规则

console.log('\n' + '='.repeat(64));
console.log('  CORE-78 第一期:技能注册表交叉验证' + (partial ? '（分批进行中，暂只跑正向规则1-7）' : ''));
console.log('  注册表条目数: ' + keys.length);
console.log('='.repeat(64) + '\n');

// CORE-117 修复后:GENERALS.skill 已不再有已知缺口,规则2 不再需要豁免任何条目。
// (历史上 simayi/鬼才 曾在这里豁免,见 issue #125。)

// ---------- 规则 1:武将存在 ----------
check('规则1:每条登记的武将都在 GENERALS 里存在', function(){
  const bad = keys.filter(function(k){ return !G[REG[k].武将]; });
  if(bad.length) throw new Error('这些登记的武将不存在: ' + bad.join(', '));
});

// ---------- 规则 2:技能名存在于 GENERALS[id].skill ----------
check('规则2:每条登记的技能名都出现在 GENERALS[id].skill 里', function(){
  const bad = [];
  keys.forEach(function(k){
    const e = REG[k];
    const names = ((G[e.武将]||{}).skill || '').split('/').map(function(s){ return s.trim(); });
    if(names.indexOf(e.技能名) < 0) bad.push(k + '(GENERALS.skill=' + names.join(',') + ')');
  });
  if(bad.length) throw new Error('这些技能名在 GENERALS.skill 里找不到: ' + bad.join(' | '));
});

// ---------- 规则 3 / 4:caps 与 hooks 必须与 GENERALS 完全一致 ----------
function unionOf(id, field){
  const s = new Set();
  keys.forEach(function(k){ if(REG[k].武将===id) (REG[k][field]||[]).forEach(function(x){ s.add(x); }); });
  return s;
}
check('规则3:每个武将的能力标识合集与 GENERALS[id].caps 完全一致(不多不少)', function(){
  const bad = [];
  const idsInReg = new Set(keys.map(function(k){ return REG[k].武将; }));
  idsInReg.forEach(function(id){
    const declared = new Set(Object.keys((G[id]||{}).caps || {}));
    const got = unionOf(id, '能力标识');
    declared.forEach(function(c){ if(!got.has(c)) bad.push(id + ' 漏登记cap:' + c); });
    got.forEach(function(c){ if(!declared.has(c)) bad.push(id + ' 多登记cap:' + c); });
  });
  if(bad.length) throw new Error(bad.join(' | '));
});
check('规则4:每个武将的钩子合集与 GENERALS[id].hooks 完全一致(不多不少)', function(){
  const bad = [];
  const idsInReg = new Set(keys.map(function(k){ return REG[k].武将; }));
  idsInReg.forEach(function(id){
    const declared = new Set(Object.keys((G[id]||{}).hooks || {}));
    const got = unionOf(id, '钩子');
    declared.forEach(function(h){ if(!got.has(h)) bad.push(id + ' 漏登记hook:' + h); });
    got.forEach(function(h){ if(!declared.has(h)) bad.push(id + ' 多登记hook:' + h); });
  });
  if(bad.length) throw new Error(bad.join(' | '));
});

// ---------- 规则 5:触发阶段真实存在 ----------
check('规则5:登记的每个触发阶段都在 STAGE_TABLE 里真实存在', function(){
  const bad = [];
  keys.forEach(function(k){
    (REG[k].触发阶段 || []).forEach(function(s){ if(!ST[s]) bad.push(k + ' -> ' + s); });
  });
  if(bad.length) throw new Error('这些阶段在 STAGE_TABLE 里不存在: ' + bad.join(', '));
});

// ---------- 规则 6:机器人接入点真实存在 ----------
check('规则6:登记的每个机器人接入点都在 BOT_DECISIONS / BOT_SEAT_PICKS 里真实存在', function(){
  const bad = [];
  keys.forEach(function(k){
    const m = REG[k].机器人接入 || {};
    (m.决策 || []).forEach(function(d){ if(!BD[d]) bad.push(k + ' 决策 -> ' + d); });
    (m.座位选择 || []).forEach(function(d){ if(!BSP[d]) bad.push(k + ' 座位选择 -> ' + d); });
  });
  if(bad.length) throw new Error('这些接入点不存在: ' + bad.join(', '));
});

// ---------- 规则 7:效果函数真实存在 ----------
check('规则7:登记的每个效果函数在沙箱全局里都是真实的 function', function(){
  const bad = [];
  keys.forEach(function(k){
    (REG[k].效果函数 || []).forEach(function(fn){
      let t = 'undefined';
      try{ t = vm.runInContext('typeof ' + fn, ctx); }catch(e){ t = 'ERR'; }
      if(t !== 'function') bad.push(k + ' -> ' + fn + '(实际 ' + t + ')');
    });
  });
  if(bad.length) throw new Error('这些效果函数不存在或不是函数: ' + bad.join(', '));
});

// ---------- 规则 8:反向完备性 —— GENERALS 每条 caps/hooks 都被覆盖 ----------
if(!partial){
  check('规则8:GENERALS 全部 66 名武将的每一条 caps/hooks 声明都被注册表覆盖(一个不漏)', function(){
    const bad = [];
    Object.keys(G).forEach(function(id){
      const declaredCaps  = Object.keys((G[id].caps || {}));
      const declaredHooks = Object.keys((G[id].hooks || {}));
      const hasEntry = keys.some(function(k){ return REG[k].武将 === id; });
      if(!hasEntry){ bad.push(id + ' 完全没有任何登记条目'); return; }
      const gotCaps  = unionOf(id, '能力标识');
      const gotHooks = unionOf(id, '钩子');
      declaredCaps.forEach(function(c){ if(!gotCaps.has(c)) bad.push(id + ' cap未覆盖:' + c); });
      declaredHooks.forEach(function(h){ if(!gotHooks.has(h)) bad.push(id + ' hook未覆盖:' + h); });
    });
    if(bad.length) throw new Error(bad.join(' | '));
  });

  check('规则8附加:GENERALS 里每一个武将都至少有一条登记(66/66)', function(){
    const idsInReg = new Set(keys.map(function(k){ return REG[k].武将; }));
    const missing = Object.keys(G).filter(function(id){ return !idsInReg.has(id); });
    if(missing.length) throw new Error('这些武将完全没登记: ' + missing.join(', '));
    console.log('    (GENERALS 武将数=' + Object.keys(G).length + ',注册表覆盖武将数=' + idsInReg.size + ')');
  });

  check('规则8附加:GENERALS.skill 里每一个技能名都被登记(不漏技能)', function(){
    const bad = [];
    Object.keys(G).forEach(function(id){
      const names = (G[id].skill || '').split('/').map(function(s){ return s.trim(); }).filter(Boolean);
      names.forEach(function(n){
        if(!REG[id + '/' + n]) bad.push(id + '/' + n);
      });
    });
    if(bad.length) throw new Error('这些技能没有登记条目: ' + bad.join(', '));
  });

  // ---------- 规则 9:反向完备性 —— 阶段/决策要么被引用要么在白名单 ----------
  check('规则9:STAGE_TABLE 每一项要么被注册表引用,要么在非技能白名单里', function(){
    const claimed = new Set();
    keys.forEach(function(k){ (REG[k].触发阶段 || []).forEach(function(s){ claimed.add(s); }); });
    const wl = new Set(WL_STAGE);
    const orphan = Object.keys(ST).filter(function(s){ return !claimed.has(s) && !wl.has(s); });
    if(orphan.length) throw new Error('这些阶段既没被任何技能登记、也不在白名单里(必须显式归类): ' + orphan.join(', '));
    console.log('    (STAGE_TABLE=' + Object.keys(ST).length + ' 项;被技能认领 ' + claimed.size + ',白名单 ' + wl.size + ')');
  });

  check('规则9:BOT_DECISIONS 每一项要么被注册表引用,要么在非技能白名单里', function(){
    const claimed = new Set();
    keys.forEach(function(k){ ((REG[k].机器人接入 || {}).决策 || []).forEach(function(s){ claimed.add(s); }); });
    const wl = new Set(WL_BD);
    const orphan = Object.keys(BD).filter(function(s){ return !claimed.has(s) && !wl.has(s); });
    if(orphan.length) throw new Error('这些机器人决策既没被登记、也不在白名单里: ' + orphan.join(', '));
    console.log('    (BOT_DECISIONS=' + Object.keys(BD).length + ' 项;被技能认领 ' + claimed.size + ',白名单 ' + wl.size + ')');
  });

  check('规则9:BOT_SEAT_PICKS 每一项都被注册表引用(座位技能全部属于武将技能,无白名单)', function(){
    const claimed = new Set();
    keys.forEach(function(k){ ((REG[k].机器人接入 || {}).座位选择 || []).forEach(function(s){ claimed.add(s); }); });
    const orphan = Object.keys(BSP).filter(function(s){ return !claimed.has(s); });
    if(orphan.length) throw new Error('这些座位技能决策没被登记: ' + orphan.join(', '));
    console.log('    (BOT_SEAT_PICKS=' + Object.keys(BSP).length + ' 项,全部被认领)');
  });

  // ---------- 白名单本身也要有效 ----------
  check('白名单里的每一项都必须是真实存在的阶段/决策(防止白名单堆废弃名字)', function(){
    const bad = [];
    WL_STAGE.forEach(function(s){ if(!ST[s]) bad.push('阶段白名单里不存在的项:' + s); });
    WL_BD.forEach(function(s){ if(!BD[s]) bad.push('决策白名单里不存在的项:' + s); });
    if(bad.length) throw new Error(bad.join(', '));
  });

  // ---------- 结构自洽 ----------
  check('注册表结构自洽:key 必须等于 武将/技能名,且字段类型正确', function(){
    const bad = [];
    keys.forEach(function(k){
      const e = REG[k];
      if(k !== e.武将 + '/' + e.技能名) bad.push('key不匹配:' + k);
      ['能力标识','钩子','触发阶段','效果函数','查询点'].forEach(function(f){
        if(!Array.isArray(e[f])) bad.push(k + ' 字段 ' + f + ' 不是数组');
      });
      if(!e.机器人接入 || !Array.isArray(e.机器人接入.决策) || !Array.isArray(e.机器人接入.座位选择))
        bad.push(k + ' 机器人接入结构不对');
      if(typeof e.主公技 !== 'boolean') bad.push(k + ' 主公技不是布尔');
      if(['cap-被动查询','cap-主动阶段','cap-自动生效','hook','cap+hook','状态字段'].indexOf(e.实现方式) < 0)
        bad.push(k + ' 实现方式取值非法:' + e.实现方式);
    });
    if(bad.length) throw new Error(bad.join(' | '));
  });

  check('登记条目总数符合预期(CORE-117修复后,GENERALS.skill 技能总数与注册表条目数应完全相等,不再需要豁免补登记)', function(){
    let total = 0;
    Object.keys(G).forEach(function(id){
      total += (G[id].skill || '').split('/').map(function(s){ return s.trim(); }).filter(Boolean).length;
    });
    if(keys.length !== total)
      throw new Error('应为 ' + total + ' 条(等于 GENERALS.skill 技能名总数),实际 ' + keys.length);
    console.log('    (GENERALS.skill 技能名共 ' + total + ' 条,注册表条目数 ' + keys.length + ' 条,完全相等)');
  });

  // ---------- CORE-117:hasSkillName 对已修复的休眠路径回归 ----------
  check('CORE-117:hasSkillName(司马懿玩家,\'鬼才\')应返回true(此前因GENERALS.skill漏写会错误返回false)', function(){
    const player = { general:'simayi', skillsLost:false, huashenSkillName:null };
    vm.runInContext('__hsn_player = ' + JSON.stringify(player) + ';', ctx);
    const got = vm.runInContext("hasSkillName(__hsn_player, '鬼才')", ctx);
    if(got !== true) throw new Error('应为 true,实际 ' + got);
  });
  check('回归对照:hasSkillName(司马懿玩家,\'反馈\')同样应返回true(确认没有把原有技能改坏)', function(){
    const got = vm.runInContext("hasSkillName(__hsn_player, '反馈')", ctx);
    if(got !== true) throw new Error('应为 true,实际 ' + got);
  });
  check('回归对照:hasSkillName(司马懿玩家,\'不存在的技能\')应返回false(确认不是恒真)', function(){
    const got = vm.runInContext("hasSkillName(__hsn_player, '不存在的技能')", ctx);
    if(got !== false) throw new Error('应为 false,实际 ' + got);
  });

  // ---------- CORE-117:GENERALS.skill 与 HUASHEN_SKILL_TABLE 全武将一致性(通用校验,不止司马懿) ----------
  // simayi 这次的缺陷,是靠 HUASHEN_SKILL_TABLE 这份独立维护的"真实技能名清单"和
  // GENERALS.skill 交叉比对才发现的——但这条一致性**不能要求两个集合完全相等**:
  // data.js(约528-543行)自己的注释明确记录了 HUASHEN_SKILL_TABLE 按设计排除
  // 主公技(激将/护驾/黄天/妄尊/血裔/救援/制霸)、马谡"散谣"(caps从未被查询过的死代码,
  // 单独排除)——这些技能只出现在 GENERALS.skill、不出现在 HUASHEN_SKILL_TABLE 里,
  // 是**有意为之的设计**,不是数据遗漏。第一版按"完全相等"写这条断言时,把这10个
  // 正常的设计排除全部误报成了"不一致"(已在开发过程中发现并纠正,过程记录见
  // progress-log)。
  // 真正有意义、且能复现 simayi 这次真实缺陷的方向,是**单向子集关系**:
  // HUASHEN_SKILL_TABLE 里出现的技能名,必须是 GENERALS.skill 的子集——因为
  // HUASHEN_SKILL_TABLE 是"这个武将确实拥有、且可被借用"的技能,不可能出现一个
  // GENERALS.skill 里都没有的技能名(simayi 当初正是"鬼才"只在 HUASHEN_SKILL_TABLE
  // 出现、GENERALS.skill 没有,方向就是这一个)。反过来(GENERALS.skill 有、
  // HUASHEN没有)则是合法的常态(主公技等),不校验。
  check('CORE-117:HUASHEN_SKILL_TABLE 里的每个技能名都必须是 GENERALS.skill 的子集(66个武将全覆盖,单向检查,不误报主公技等设计排除项)', function(){
    const H = vm.runInContext('HUASHEN_SKILL_TABLE', ctx);
    const bad = [];
    Object.keys(H).forEach(function(id){
      if(!G[id]) { bad.push(id + ' 不在 GENERALS 里'); return; }
      const skillNames = new Set(
        (G[id].skill || '').split('/').map(function(s){ return s.trim(); }).filter(Boolean)
      );
      (H[id] || []).forEach(function(e){
        if(!skillNames.has(e.name)) bad.push(id + '(' + G[id].name + '): HUASHEN有"' + e.name + '",GENERALS.skill没有(=' + [...skillNames].join(',') + ')');
      });
    });
    if(bad.length) throw new Error(bad.join(' | '));
    console.log('    (已核对 HUASHEN_SKILL_TABLE 覆盖的全部 ' + Object.keys(H).length + ' 个武将,零遗漏)');
  });
}

console.log('\n' + '='.repeat(64));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(64) + '\n');
process.exit(fail > 0 ? 1 : 0);
