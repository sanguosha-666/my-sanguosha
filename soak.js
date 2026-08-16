#!/usr/bin/env node
/**
 * soak.js —— 整局级随机压测驱动器(CORE-108 / issue #108 方案第1项:soak驱动循环)。
 *
 * 用法: node soak.js [局数=20] [最大人数=6] [单局步数上限=4000]
 *
 * 【做什么】从 startGame 一路驱动到 checkWin,全程由机器人决策/超时保守动作自动推进,
 * 不需要真人操作、不需要 DOM——用于压测"随机对局会不会卡死/触发 normalize 孤儿 pending/
 * 机器人决策异常"这类只有靠大量随机对局才容易撞见的问题。
 *
 * 【CORE-92 / issue #139 重构说明】这份脚本原本把 vm 沙箱、快照 tx stub、逃生舱、驱动
 * 循环全部内联写死(281行)。issue #139 要把 AI 长局压测扩成分层矩阵(身份局/组队/托管/
 * 确定性LLM),同时明确"保留现有 soak.js,不要改成巨型万能脚本"——于是把那套骨架整体
 * 搬进 soak-harness.js,这里退化成一个薄入口。**这一层是矩阵的 A 层(FFA + 本地 fallback),
 * 行为逐字不变**(由 testclass/run_soak_driver_test.js 锁定),其余各层见 soak-ai.js。
 *
 * 【骨架本身的设计说明(为什么不加载真实DOM、为什么用保守动作表当逃生舱、为什么 tx stub
 * 必须返回真 Promise 等)已随代码一起搬到 soak-harness.js,不在这里重复。】
 */

const { createSandbox, installDriver, runMatrix } = require('./soak-harness');

const GAMES = parseInt(process.argv[2], 10) || 20;
const MAX_PLAYERS = Math.max(2, Math.min(9, parseInt(process.argv[3], 10) || 6));
// 第4个可选参数:单局步数上限,超过视为疑似卡死(而不是无限跑)。默认4000够跑完绝大多数
// 随机对局;快速冒烟用小步数(比如300)可以在几秒内验证驱动器本身没坏。
const MAX_STEPS_PER_GAME = parseInt(process.argv[4], 10) || 4000;

const { sandbox, diagnostics } = createSandbox();
installDriver(sandbox, { maxSteps: MAX_STEPS_PER_GAME, stuckEscapeAfter: 2 });

(async function(){
  const r = await runMatrix({
    sandbox, diagnostics, games: GAMES, maxPlayers: MAX_PLAYERS, minPlayers: 2,
    title: 'soak',
    // A 层:FFA + random 开局 + 无 AI Key 本地 fallback + 全员机器人(与重构前逐字一致)
    cfgFor: () => ({ gameMode: 'ffa', startMode: 'random' })
  });
  process.exit((r.stuck + r.crashed) > 0 ? 1 : 0);
})();
