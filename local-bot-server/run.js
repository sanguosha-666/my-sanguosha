// run.js —— 阶段2:真正接管机器人决策并写入 Firebase 的 Node 进程入口。
//
// 【和 watch.js(阶段1骨架)的区别】watch.js 是且永远是"只订阅只打印,不写入"——它自己
// 文件头就写了这条硬性边界,这次任务不碰它。这个文件是新的、独立的入口,专门做阶段2要求的
// "真正调用 tx()/gameRef.transaction 提交机器人动作"。两个脚本可以独立运行、互不影响。
//
// 【这次任务的边界,务必卡死】
//   - 只处理无密钥模式(从不设置 aiApiKey/aiProvider,见 bot-runtime.js 的沙箱)。
//   - 不接入任何 AI API 调用。
//   - 不处理需要 DOM 宿主的决策路径(wuxie/luoyingAsk/luoshen 这三个 phase,见
//     bot-runtime.js 的 EXCLUDED_PHASES)——遇到就把 botServerActive 让给浏览器端,
//     自己明确跳过、不尝试处理。
//   - 阶段3才会接 AI API 调用 / botSafePrompt 这条 DOM 兜底链路。
//
// 【运行方式】见同目录 README.md。

'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { loadSandbox, wireGameRef, EXCLUDED_PHASES } = require('./bot-runtime');

// ---------- .env 加载(和 watch.js 同一份极简实现,故意不抽公共模块——两个脚本各自
// 独立、互不依赖,任何一个出问题不牵连另一个) ----------
(function loadDotEnvIfPresent() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 0) return;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  });
})();

const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, 'serviceAccountKey.json');
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const ROOM_ID = process.env.ROOM_ID;

function fail(msg) {
  console.error('\n[启动失败] ' + msg + '\n');
  console.error('请检查 local-bot-server/README.md 里「阶段2:接管机器人决策」一节。');
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  fail('找不到服务账号密钥文件:' + SERVICE_ACCOUNT_PATH);
}
if (!DATABASE_URL) fail('缺少环境变量 FIREBASE_DATABASE_URL。');
if (!ROOM_ID) fail('缺少环境变量 ROOM_ID。');

let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
} catch (e) {
  fail('服务账号密钥文件解析失败:' + e.message);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
} catch (e) {
  fail('用服务账号密钥初始化 Firebase 失败:' + (e && e.message || e));
}

const db = admin.database();
const gameRef = db.ref('rooms/' + ROOM_ID + '/game');
const botServerActiveRef = gameRef.child('botServerActive');

function ts() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
}
function log(msg) { console.log(ts() + ' ' + msg); }

console.log('==============================================');
console.log(' 本地机器人服务 阶段2 —— 接管结构化决策,真正写入');
console.log(' 房间号     : ' + ROOM_ID);
console.log(' 数据库地址 : ' + DATABASE_URL);
console.log(' 排除的phase: ' + EXCLUDED_PHASES.join('、') + '(依赖DOM宿主,这次不处理,让给浏览器)');
console.log('==============================================\n');

log('正在加载游戏逻辑源码进沙箱...');
const { context, sandbox } = loadSandbox(function (m) { log(m); });
wireGameRef(sandbox, context, gameRef);
log('沙箱加载完成,开始订阅并接管决策。\n');

// 崩溃/断线安全网:进程异常退出时,RTDB 服务端自动把 botServerActive 置回 false,
// 浏览器端 scheduleBotTurn 的 `if(g.botServerActive && !aiTestSelf) return;` 立刻失效,
// 自动接管回去。这是防"Node 进程崩了机器人永久瘫痪"的降级方案。
botServerActiveRef.onDisconnect().set(false);

let lastLoggedYieldPhase = null; // 避免同一个 DOM-required phase 连续多次刷同样的让路日志

async function setActive(active, reason) {
  try {
    await botServerActiveRef.set(active);
    log((active ? '🔒 接管 botServerActive=true' : '🔓 让路 botServerActive=false') + '(' + reason + ')');
  } catch (e) {
    log('[写入botServerActive失败] ' + (e && e.message || e));
  }
}

async function handleSnapshot(g) {
  if (!g) { log('房间 ' + ROOM_ID + ' 当前不存在,等待中...'); return; }

  const decision = context.__botRuntimeDecide(g);

  if (decision.skip) {
    if (decision.reason === 'dom-required-phase') {
      if (g.botServerActive) await setActive(false, '当前phase=' + decision.phase + ' 依赖DOM宿主,这轮不处理');
      else if (lastLoggedYieldPhase !== decision.phase) log('⏭️  跳过 phase=' + decision.phase + '(依赖DOM宿主,已让浏览器端处理)');
      lastLoggedYieldPhase = decision.phase;
    } else {
      lastLoggedYieldPhase = null;
      // 'no-bot-seat':真人回合,或这个 phase 没有结构化分支覆盖——两种情况都不该
      // 由 Node 抢着接管,维持 botServerActive 现状即可(不主动改)。
    }
    return;
  }

  lastLoggedYieldPhase = null;
  if (!g.botServerActive) await setActive(true, '出现可结构化处理的动作,phase=' + decision.phase);

  // 和浏览器端 scheduleBotTurn 同款的小幅随机延迟(650~1150ms→这里用稍短的
  // 400~800ms):给 botServerActive 的写入留出网络传播时间,降低"浏览器端还没看到
  // 最新flag、双方都认为自己该行动"的重叠窗口。真正的动作安全性最终由 tx() 内部的
  // phase/turn 校验兜底(见 README「竞态冲突识别与处理」)。
  await new Promise(function (resolve) { setTimeout(resolve, 400 + Math.random() * 400); });

  try {
    log('▶️  执行决策 phase=' + decision.phase + ' seat=' + decision.seat);
    await context.__botRuntimeRun(g, decision.seat);
    log('✅ 决策执行完成 phase=' + decision.phase + ' seat=' + decision.seat);
  } catch (e) {
    log('[决策执行异常] phase=' + decision.phase + ' seat=' + decision.seat + ' ' + (e && e.stack || e));
  }
}

// 重入保护 + "只处理最新一份"去抖:决策执行期间可能又收到新的 value 回调,
// 排队只保留最新快照,处理完当前这轮后立刻继续处理最新的,不逐条堆积重放。
let busy = false;
let queued;
let hasQueued = false;
function enqueue(g) {
  queued = g; hasQueued = true;
  if (!busy) drain();
}
async function drain() {
  busy = true;
  try {
    while (hasQueued) {
      const g = queued; hasQueued = false;
      await handleSnapshot(g);
    }
  } finally {
    busy = false;
  }
}

gameRef.on('value', function (snap) { enqueue(snap.val()); }, function (err) {
  log('[订阅错误] ' + (err && err.message || err));
});

process.on('SIGINT', function () {
  log('收到退出信号,让路 botServerActive 并退出...');
  botServerActiveRef.set(false).catch(function () {}).then(function () {
    gameRef.off();
    process.exit(0);
  });
  // 保底:即使上面的 set 因为网络问题卡住,onDisconnect 兜底也会最终把它置回 false,
  // 不能让 Ctrl+C 永远卡住不退出。
  setTimeout(function () { process.exit(0); }, 3000);
});
