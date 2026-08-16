// CORE-92(issue #139):AI 长局压测矩阵 —— 骨架/检测器/LLM stub 的单元级回归。
//
// 【这份测试和 soak-ai.js 的分工】soak-ai.js 是"跑很多局随机对局看会不会出事"的长跑工具
// (几分钟到十几分钟量级),不适合进每次提交都跑的常规套件。这里锁定的是那套工具**自身**
// 必须成立的性质——尤其是阵营违规检测器的鉴别力(CLAUDE.md 规则20:一条永远绿的断言和
// 永远红的一样没价值)。检测器在真实压测里长期输出 0 违规,如果它其实是坏的,这个 0 就是
// 假绿、整层压测等于没跑;所以必须有一组"故意造违规、必须被抓到"的断言把它钉住。
//
// 【已完成的端到端鉴别力验证(一次性,记录在此供追溯)】把 botTargetPolicyAllows 与
// botTargetScore 的阵营惩罚同时中和后跑 25 局身份局压测,检测器真实抓到
// "identity:zhong-harms-zhu | playCard 杀 座位4→座位3 @play 回合12";恢复后同样配置 0 违规。
// 那次验证证明的是"检测器接在真实对局链路上能响",这份文件锁定的是"检测器的判定规则本身
// 正确",两者互补。
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const { createSandbox, installDriver } = require(path.join(ROOT, 'soak-harness'));
const { sandbox } = createSandbox();
installDriver(sandbox, { maxSteps: 40, stuckEscapeAfter: 2 });
const R = code => vm.runInContext(code, sandbox);

console.log('\n' + '='.repeat(66));
console.log('  CORE-92:AI 压测矩阵(骨架 / 阵营违规检测器 / 确定性LLM stub)');
console.log('='.repeat(66) + '\n');

// ---------- 工具:构造一局并跑一次"主动动作",返回记录到的违规 ----------
R('__installViolationHooks();');
function probePlayCard(setup, actorSeat, action, targetSeat){
  sandbox.__setup = setup;
  R(`
    commitGameState(__setup);
    mySeat = ${actorSeat};
    __resetViolations();
  `);
  R(`playCard(0, ${JSON.stringify(action)}, ${targetSeat});`);
  return JSON.parse(R('JSON.stringify(__getViolations())'));
}
function mkIdentityG(roles, revealed, handName){
  return {
    gameMode:'identity', phase:'play', turn:0, roundNum:1, log:[], pending:null, discard:[], deck:[],
    players: roles.map((role,i)=>({
      name:'p'+i, role, roleRevealed: !!(revealed||{})[i], alive:true, hp:4, maxHp:4,
      hand: [{ id:'c'+i, name: handName||'杀', suit:'♠', rank:7 }],
      equips: R('emptyEquips')(), delays:[]
    }))
  };
}

// ========== 第1组:检测器必须抓到真实违规(鉴别力,最关键) ==========
check('检测器鉴别力①:忠臣主动对主公出杀 → 必须被记为违规', function(){
  const v = probePlayCard(mkIdentityG(['zhong','zhu']), 0, '杀', 1);
  if(!v.length) throw new Error('应记到违规,实际一条都没有——检测器失效,整层压测的"0违规"都是假绿');
  if(v[0].rule !== 'identity:zhong-harms-zhu') throw new Error('规则名应为 zhong-harms-zhu,实际 ' + v[0].rule);
  if(v[0].via !== 'playCard') throw new Error('来源应为 playCard');
});
check('检测器鉴别力②:主公主动对已揭示忠臣出杀 → 必须被记为违规', function(){
  const v = probePlayCard(mkIdentityG(['zhu','zhong'], {1:true}), 0, '杀', 1);
  if(!v.length || v[0].rule !== 'identity:zhu-harms-zhong') throw new Error('应记到 zhu-harms-zhong,实际 ' + JSON.stringify(v));
});
check('检测器鉴别力③:反贼主动对已揭示反贼出杀 → 必须被记为违规', function(){
  const v = probePlayCard(mkIdentityG(['fan','fan'], {1:true}), 0, '杀', 1);
  if(!v.length || v[0].rule !== 'identity:fan-harms-fan') throw new Error('应记到 fan-harms-fan,实际 ' + JSON.stringify(v));
});
check('检测器鉴别力④:忠臣主动把桃送给已揭示反贼 → 帮助型违规必须被记到', function(){
  const v = probePlayCard(mkIdentityG(['zhong','fan'], {1:true}, '桃'), 0, '桃', 1);
  if(!v.length || v[0].rule !== 'identity:zhong-helps-fan') throw new Error('应记到 zhong-helps-fan,实际 ' + JSON.stringify(v));
});
check('检测器鉴别力⑤:组队模式对同队队友出杀 → 必须被记为违规', function(){
  const g = mkIdentityG([null,null]);
  g.gameMode = 'team'; g.players[0].team = 0; g.players[1].team = 0;
  const v = probePlayCard(g, 0, '杀', 1);
  if(!v.length || v[0].rule !== 'team:harmful-to-teammate') throw new Error('应记到 team:harmful-to-teammate,实际 ' + JSON.stringify(v));
});

// ========== 第2组:不能误报(否则压测结果全是噪音,同样等于没用) ==========
check('不误报①:忠臣对已揭示反贼出杀 = 完全正当,不该记违规', function(){
  const v = probePlayCard(mkIdentityG(['zhong','fan'], {1:true}), 0, '杀', 1);
  if(v.length) throw new Error('正当攻击不该被记违规,实际 ' + JSON.stringify(v));
});
check('不误报②:目标身份尚未公开时不判违规(机器人也不可能知道,判了就是噪音)', function(){
  // 座位1 是忠臣但没揭示、也不是主公 —— 对忠臣自己来说这是"未知身份",不该算违规
  const v = probePlayCard(mkIdentityG(['zhong','zhong'], {}), 0, '杀', 1);
  if(v.length) throw new Error('未公开身份不该判违规,实际 ' + JSON.stringify(v));
});
check('不误报③:内奸不设固定敌我,任何主动攻击都不判违规(设计如此)', function(){
  const v = probePlayCard(mkIdentityG(['nei','zhu']), 0, '杀', 1);
  if(v.length) throw new Error('内奸不该被判违规,实际 ' + JSON.stringify(v));
});
check('不误报④:非身份局(ffa)不判任何阵营违规', function(){
  const g = mkIdentityG(['zhong','zhu']); g.gameMode = 'ffa';
  const v = probePlayCard(g, 0, '杀', 1);
  if(v.length) throw new Error('ffa 不该判阵营违规,实际 ' + JSON.stringify(v));
});
check('不误报⑤:群体牌(南蛮/万箭)不参与目标检查(使用者无法选目标,不算"选错自己人")', function(){
  const g = mkIdentityG(['zhong','zhu'], {}, '南蛮入侵');
  const v = probePlayCard(g, 0, '南蛮入侵', 1);
  if(v.length) throw new Error('群体牌不该被判目标违规,实际 ' + JSON.stringify(v));
});

// ========== 第3组:必须区分"主动决策"与"被迫响应/结算"(issue 明确要求) ==========
check('主动/被迫区分:被迫响应类服务端函数不经过挂钩点,天然不会被误判为主动违规', function(){
  // 检测器只挂在 playCard 和 seatPickExecute 两个"自己选的动作"入口上。这里验证的是这个
  // 设计事实本身:响应类函数(respondShan/duelResponse/aoeRespond)不在挂钩名单里——
  // 不是靠事后过滤规则去排除,是挂钩点本身就只覆盖主动动作。
  const src = fs.readFileSync(path.join(ROOT, 'soak-harness.js'), 'utf8');
  const hookBody = src.match(/function __installViolationHooks\(\)\{[\s\S]*?\n\}/);
  if(!hookBody) throw new Error('未能定位 __installViolationHooks');
  ['respondShan','duelResponse','aoeRespond','dealDamage','advanceTieSuoQueue'].forEach(function(fn){
    if(new RegExp('\\b' + fn + '\\s*=').test(hookBody[0]))
      throw new Error('挂钩点不该覆盖被迫响应/结算函数 ' + fn + '(会把AOE/连环/反弹误报成主动违规)');
  });
  if(!/\bplayCard\s*=/.test(hookBody[0])) throw new Error('应挂钩 playCard(主动出牌)');
  if(!/\bseatPickExecute\s*=/.test(hookBody[0])) throw new Error('应挂钩 seatPickExecute(主动发动座位技能)');
});
check('检测器独立性:不复用 botTargetPolicyAllows(否则是拿被测实现验证自己,同义反复)', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak-harness.js'), 'utf8');
  const det = src.match(/function __factionViolation\([\s\S]*?\n\}/);
  if(!det) throw new Error('未能定位 __factionViolation');
  ['botTargetPolicyAllows','botTargetRelationAllowed','botTargetHelpfulAllowed','botTargetScore','canSeeRole'].forEach(function(fn){
    if(det[0].indexOf(fn) >= 0)
      throw new Error('检测器不得调用被测实现 ' + fn + '——策略写错时检测器会跟着一起错,永远测不出问题');
  });
});

// ========== 第4组:确定性 LLM stub ==========
// 【这条必须用 await,不能 return Promise】check() 的 try/catch 只能抓同步抛出;第一版
// 这条 return 了一个 Promise,断言即使写成 res[0]!==999 也照样 PASS(异步 reject 变成
// 未捕获拒绝,还顺带把结尾汇总吞掉)——典型的"永远绿的断言"(CLAUDE.md 规则20),已实测
// 确认过这个假绿并改成下面的 await 写法。
async function checkAsync(name, fn){
  try{ await fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}
const asyncChecks = [];
asyncChecks.push(function(){
  return checkAsync('LLM stub:best 模式选 localHeuristicScore 最高项、worst 选最低项', async function(){
    sandbox.__cands = [{index:0,localHeuristicScore:10},{index:1,localHeuristicScore:99},{index:2,localHeuristicScore:-5}];
    const best = await R('(async function(){ __installAiStub("best"); var r = await callAiChooseIndex({ g: currentGameState()||{players:[]}, seat:0, candidates: __cands, systemPrompt:"s", userPrompt:"u" }); __uninstallAiStub(); return r; })()');
    const worst = await R('(async function(){ __installAiStub("worst"); var r = await callAiChooseIndex({ g: currentGameState()||{players:[]}, seat:0, candidates: __cands, systemPrompt:"s", userPrompt:"u" }); __uninstallAiStub(); return r; })()');
    if(best !== 1) throw new Error('best 应选 index1(分数99),实际 ' + best);
    if(worst !== 2) throw new Error('worst 应选 index2(分数-5),实际 ' + worst);
  });
});
check('LLM stub:绝不发真实 API 请求(callAI 被整体替换,且用后还原)', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak-harness.js'), 'utf8');
  const stub = src.match(/function __installAiStub\([\s\S]*?\n\}/);
  if(!stub) throw new Error('未能定位 __installAiStub');
  if(!/callAI\s*=\s*async function/.test(stub[0])) throw new Error('必须整体替换 callAI,不能让真实 provider 逻辑发请求');
  if(stub[0].indexOf('fetch') >= 0) throw new Error('stub 内不得出现 fetch');
  // 走的是真实 callAiChooseIndex(保留解析/越界校验),不是把它整个绕过去
  if(stub[0].indexOf('__realCallAiChooseIndex') < 0) throw new Error('应调用真实 callAiChooseIndex,以覆盖其解析/边界校验逻辑');
});

// ========== 第5组:骨架本身 ==========
check('骨架:soak.js 仍是 A 层(FFA+random),配置未被新层污染', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak.js'), 'utf8');
  if(!/gameMode:\s*'ffa'/.test(src) || !/startMode:\s*'random'/.test(src))
    throw new Error('soak.js 应保持 FFA + random 开局(A层行为逐字不变)');
  if(/detectViolations|aiStubMode|autopilotSeat/.test(src))
    throw new Error('A 层不该带上新层的配置(会改变既有压测的语义)');
});
check('骨架:soak-ai.js 覆盖 issue 要求的全部层(identity/team/autopilot/llm三模式)', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak-ai.js'), 'utf8');
  ['identity','team','autopilot','llm-best','llm-worst','llm-random'].forEach(function(k){
    if(src.indexOf("'" + k + "'") < 0 && src.indexOf(k + ':') < 0)
      throw new Error('缺少层: ' + k);
  });
});
check('骨架:D层用 p.isBot=false 的真人座位(不能用全员 isBot=true 冒充托管)', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak-harness.js'), 'utf8');
  if(!/g\.players\[autopilotSeat\]\.isBot\s*=\s*false/.test(src))
    throw new Error('托管座位必须显式保持 isBot=false');
  if(!/aiTestAutopilot\s*=\s*\{\s*active:\s*true/.test(src))
    throw new Error('必须真实开启 aiTestAutopilot');
});
check('骨架:卡死诊断包含 issue 要求的全部字段', function(){
  const src = fs.readFileSync(path.join(ROOT, 'soak-harness.js'), 'utf8');
  ['seed','phase','turn','pendingType','resolvedSeat','recentAiDecisions','recentCommands'].forEach(function(f){
    if(src.indexOf(f + ':') < 0) throw new Error('诊断包缺字段: ' + f);
  });
});

// 异步断言统一在这里 await 执行完再汇总(不能 fire-and-forget,否则失败被吞)
(async function(){
  for(const c of asyncChecks) await c();
})().then(function(){
  console.log('\n' + '='.repeat(66));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(66) + '\n');
  process.exit(fail > 0 ? 1 : 0);
});
