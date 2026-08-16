#!/usr/bin/env node
/**
 * soak-ai.js —— AI 使用模式的长局压测矩阵(CORE-92 / issue #139)。
 *
 * 用法: node soak-ai.js [层=all] [局数=10] [单局步数上限=4000]
 *   层 ∈ identity | team | autopilot | llm-best | llm-worst | llm-random | all
 *
 * 【要解决什么】现有 soak.js(矩阵 A 层)固定跑 FFA + 无 AI Key 本地 fallback,覆盖不到
 * AI 的主要实际使用面。"FFA soak 多局无卡死"因此不能外推成"身份局AI/托管AI/LLM路径长局
 * 稳定"——CORE-89(忠臣候选里出现【杀→主公】)和 CORE-91(托管 fallback 口径)这两个真实
 * 缺陷,现有 soak 天然抓不到。这份脚本补齐剩下四层:
 *
 *   A. FFA fallback soak            —— soak.js(现有,不动)
 *   B. Identity fallback soak       —— 身份局四阵营 + 阵营违规检测
 *   C. Team fallback soak           —— 组队局 + 队友保护违规检测
 *   D. Autopilot scheduler 专项     —— p.isBot=false 真人座位 + aiTestAutopilot,
 *                                      真实走 scheduleBotTurn/botSeatForState/
 *                                      botFallbackSeats/runBotDecision
 *   E. LLM decision simulation      —— 确定性 stub(最高分/最低分/任意),不发真实 API
 *
 * 【E 层里"最低分"模式为什么重要】它是一条安全边界的证明:即使模型故意每次都挑候选列表里
 * 最差的一项,也**不可能**选到策略层禁止的目标——因为禁止目标在候选生成阶段就已经被删掉了
 * (CORE-89/CORE-90 建立的硬过滤)。所以这一层的期望结果是"违规数恒为 0",一旦冒出违规,
 * 说明硬过滤又被某条路径绕过去了。
 *
 * 【不发真实 AI 请求】E 层把 callAI(provider 层)整体换成返回固定 JSON 的 stub,真实的
 * callAiChooseIndex(解析/越界校验/超时兜底)照常跑。CI 环境下不会产生任何网络请求。
 */

const { createSandbox, installDriver, runMatrix } = require('./soak-harness');

const LAYER = (process.argv[2] || 'all').toLowerCase();
const GAMES = parseInt(process.argv[3], 10) || 10;
const MAX_STEPS = parseInt(process.argv[4], 10) || 4000;

// 各层配置。minPlayers/maxPlayers 受各模式自身的开局校验约束:
//   identity —— startGame 要求 4~8 人且 mode 必须是 'pick'(见 room-lifecycle.js)
//   team     —— 要求 ≥2 人、≥2 个队伍且每人都有 team(这里交替分 0/1)
const LAYERS = {
  identity: {
    title: 'B层 身份局(本地fallback)', minPlayers: 4, maxPlayers: 8,
    cfg: () => ({ gameMode:'identity', startMode:'pick', detectViolations:true })
  },
  team: {
    title: 'C层 组队局(本地fallback)', minPlayers: 4, maxPlayers: 6,
    cfg: () => ({ gameMode:'team', startMode:'random', assignTeams:true, detectViolations:true })
  },
  autopilot: {
    // D 层刻意用身份局:托管座位在身份局里才有阵营策略可违反,顺带把违规检测也覆盖到
    // 托管路径上;driveVia:'scheduler' 让它真实走完整调度链路而不是直接调 runBotDecision。
    title: 'D层 AI托管(真人座位+scheduleBotTurn)', minPlayers: 4, maxPlayers: 6,
    cfg: (i) => ({ gameMode:'identity', startMode:'pick', autopilotSeat:i, driveVia:'scheduler', detectViolations:true })
  },
  'llm-best': {
    title: 'E层 确定性LLM(最高分模式)', minPlayers: 4, maxPlayers: 6,
    cfg: () => ({ gameMode:'identity', startMode:'pick', aiStubMode:'best', detectViolations:true })
  },
  'llm-worst': {
    title: 'E层 确定性LLM(最低分模式,证明硬安全边界)', minPlayers: 4, maxPlayers: 6,
    cfg: () => ({ gameMode:'identity', startMode:'pick', aiStubMode:'worst', detectViolations:true })
  },
  'llm-random': {
    title: 'E层 确定性LLM(任意候选模式)', minPlayers: 4, maxPlayers: 6,
    cfg: () => ({ gameMode:'identity', startMode:'pick', aiStubMode:'random', detectViolations:true })
  }
};

const ORDER = ['identity','team','autopilot','llm-best','llm-worst','llm-random'];
const toRun = (LAYER === 'all') ? ORDER : [LAYER];
const unknown = toRun.filter(k => !LAYERS[k]);
if(unknown.length){
  console.error('未知的层: ' + unknown.join(', ') + '\n可选: ' + ORDER.join(' | ') + ' | all');
  process.exit(2);
}

(async function(){
  let bad = 0;
  const summary = [];
  for(const key of toRun){
    const layer = LAYERS[key];
    console.log('\n' + '#'.repeat(64));
    console.log('# ' + layer.title + '  (' + GAMES + ' 局)');
    console.log('#'.repeat(64));
    // 每层各自一个全新沙箱:层与层之间不共享任何客户端全局状态(aiTestAutopilot/
    // botTwoStepA/aiSummary/commandLog 等),避免上一层的残留污染下一层的结论。
    const { sandbox, diagnostics } = createSandbox();
    installDriver(sandbox, { maxSteps: MAX_STEPS, stuckEscapeAfter: 2 });
    const r = await runMatrix({
      sandbox, diagnostics, games: GAMES,
      minPlayers: layer.minPlayers, maxPlayers: layer.maxPlayers,
      title: layer.title, cfgFor: layer.cfg
    });
    const layerBad = r.stuck + r.crashed + r.violations.length;
    bad += layerBad;
    summary.push({ key, title: layer.title, finished: r.finished, stuck: r.stuck,
                   crashed: r.crashed, capped: r.capped, violations: r.violations.length });
  }
  console.log('\n' + '='.repeat(64));
  console.log('AI 压测矩阵总汇');
  console.log('='.repeat(64));
  summary.forEach(s => {
    console.log('  ' + (s.violations||s.stuck||s.crashed ? '✗' : '✓') + ' ' + s.title
      + ' —— 完成 ' + s.finished + ' / 卡死 ' + s.stuck + ' / 崩溃 ' + s.crashed
      + ' / 超限 ' + s.capped + ' / 阵营违规 ' + s.violations);
  });
  console.log('='.repeat(64));
  process.exit(bad > 0 ? 1 : 0);
})();
