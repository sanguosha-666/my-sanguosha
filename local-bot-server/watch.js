// watch.js —— 阶段1骨架:订阅一个房间的 Firebase RTDB 状态并打印,仅此而已。
//
// 【硬性边界,任务要求,不要在这个文件里加】
//   - 不调用任何写入 API(不用 .set()/.update()/.push()/.transaction())。
//   - 不运行任何机器人决策逻辑(不加载 bot.js/bot-ai-bus.js/game.js,不判断"该谁行动"、
//     不选牌/选目标)。
//   - 不改动浏览器端任何文件。
// 这一步的目的只是验证"Node 进程能不能读到房间真实状态",把"环境能不能跑起来"和
// "决策正确性"彻底解耦(见 docs/local-bot-server-feasibility.md 阶段1 的既定范围)。
// 阶段2 才会在这个骨架上接机器人决策 + botServerActive 开关。
//
// 【运行方式】见同目录 README.md,这里只放代码。

'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { sanitizePendingForLog, playersSummary } = require('./sanitize');

// ---------- 极简 .env 加载(不引入 dotenv 依赖):存在则解析,不存在则完全跳过 ----------
// 只支持最简单的 KEY=VALUE 一行一条,不支持引号转义/多行值——够用就好,复杂配置直接用
// 系统环境变量。已经存在的同名环境变量优先(不覆盖),方便命令行临时覆盖 .env 里的值。
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

// ---------- 读取配置(环境变量,不硬编码任何路径/URL/房间号) ----------
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, 'serviceAccountKey.json'); // 约定的默认路径,文件本身受 .gitignore 保护
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const ROOM_ID = process.env.ROOM_ID;

function fail(msg) {
  console.error('\n[启动失败] ' + msg + '\n');
  console.error('请检查 local-bot-server/README.md 里的「运行说明」一节。');
  process.exit(1);
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  fail('找不到服务账号密钥文件:' + SERVICE_ACCOUNT_PATH
    + '\n请先在 Firebase 控制台生成密钥并放到这个路径(或用 FIREBASE_SERVICE_ACCOUNT_PATH 指定别处)。');
}
if (!DATABASE_URL) {
  fail('缺少环境变量 FIREBASE_DATABASE_URL(和浏览器端 config.js 里的 databaseURL 应该是同一个值)。');
}
if (!ROOM_ID) {
  fail('缺少环境变量 ROOM_ID(要订阅哪个房间号,和浏览器端加入房间时填的房间号一致)。');
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
} catch (e) {
  fail('服务账号密钥文件解析失败(不是合法 JSON?):' + e.message);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });
} catch (e) {
  fail('用服务账号密钥初始化 Firebase 失败(密钥文件内容可能不完整/被截断):' + (e && e.message || e));
}

// 【硬性边界】这里只创建了 db 句柄用于订阅(.on('value',...)),下面全程只调用读 API。
// 不要在这个文件的任何地方引入 .set()/.update()/.push()/.transaction()。
const db = admin.database();
const gameRef = db.ref('rooms/' + ROOM_ID + '/game');

// ---------- 打印:参照 debugLogs 的字段设计风格(phase/pending/turn/roundNum 这类结构性
// 摘要 + 白名单化的 pending 快照),不打印任何隐藏信息(手牌内容/判定牌/身份等)。----------
function printSnapshot(g) {
  const ts = new Date().toISOString();
  if (g === null) {
    console.log('[' + ts + '] 房间 ' + ROOM_ID + ' 当前不存在(rooms/' + ROOM_ID + '/game 为空)');
    return;
  }
  const summary = {
    phase: g.phase || null,
    turn: (typeof g.turn === 'number' ? g.turn : null),
    roundNum: (typeof g.roundNum === 'number' ? g.roundNum : null),
    started: !!g.started,
    over: g.phase === 'over',
    pendingType: (g.pending && g.pending.type) || null,
    players: playersSummary(g),
  };
  console.log('[' + ts + '] --- 房间 ' + ROOM_ID + ' 状态更新 ---');
  console.log(JSON.stringify(summary, null, 2));
  if (g.pending) {
    const pendingSafe = sanitizePendingForLog(g.pending);
    console.log('pending(白名单脱敏后):', JSON.stringify(pendingSafe, null, 2));
  }
}

console.log('==============================================');
console.log(' 本地机器人服务 阶段1骨架 —— 只订阅只打印,不写入');
console.log(' 房间号     : ' + ROOM_ID);
console.log(' 数据库地址 : ' + DATABASE_URL);
console.log(' 密钥文件   : ' + SERVICE_ACCOUNT_PATH);
console.log('==============================================\n');
console.log('正在订阅 rooms/' + ROOM_ID + '/game ,等待状态变化...\n');

gameRef.on(
  'value',
  function (snap) {
    printSnapshot(snap.val());
  },
  function (err) {
    console.error('\n[订阅错误] ' + (err && err.message || err));
    console.error('常见原因:数据库地址/房间号不对,或服务账号权限不足。');
  }
);

process.on('SIGINT', function () {
  console.log('\n收到退出信号,断开订阅并退出。');
  gameRef.off();
  process.exit(0);
});
