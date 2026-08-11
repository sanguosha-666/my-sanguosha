// bot-runtime.js —— 阶段2:把浏览器端真实源码(game.js/bot.js/bot-ai-bus.js 等)加载进
// 一个 vm 沙箱,只暴露"结构化决策(无密钥、不依赖DOM宿主)"这条路径给 Node 进程调用。
//
// 【这个文件不直接连 Firebase,不做任何 I/O】它只负责"把真实游戏逻辑跑起来"这一件事,
// 由调用方(run.js)传入一个真实的 Admin SDK gameRef,并驱动 decide()/runDecision()。
//
// 【为什么用 vm 加载真实源码,而不是重写一份决策逻辑】和 run_ai_bus_*.js 测试套件同一个
// 理由:bot.js/bot-ai-bus.js/game.js 是这个项目里"机器人决策该怎么做"的唯一真相来源,
// 重写一份等于两份逻辑要长期保持同步、必然会漂移。vm 沙箱加载真实文件,只在沙箱边界处
// 提供最小 DOM/window/firebase stub,让这些文件能像在浏览器里一样加载、跑起来。
//
// 【DOM 隔离边界,这次任务的硬性范围】只有三个 phase(wuxie/luoyingAsk/luoshen)在无密钥
// 模式下依赖 L1(collectControlsCandidates,真的要渲染出按钮再镜像点击)才能决策,
// 其余全部走 BOT_DECISIONS 里的结构化分支或 runBotDecision 里的硬编码 phase 分支,是纯
// 状态判断,不摸 DOM(依据:docs/local-bot-server-feasibility.md 的 C-1 调查)。这个沙箱
// 只提供“不会崩溃”的最小 document/window stub(所有方法返回无害的空实现),同时显式把
// L1(BOT_DECISIONS.controlsChoice.buildCandidates)和最终兜底(botSafePrompt)替换成
// 直接返回"我处理不了"的空实现——即使某处遗漏、真的落到这两个入口,也是"明确什么都不做",
// 不是"侥幸没崩溃"。EXCLUDED_PHASES 就是这三个 phase 的名单,由 run.js 在决策前用它判断
// "这次该不该由 Node 接管"。

'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// 无密钥模式下,只有这三个 phase 依赖 L1(渲染真实控件再镜像点击)才能决策——
// 其余全部有结构化分支覆盖。这次任务明确不碰 DOM,遇到这三个 phase 一律不处理。
const EXCLUDED_PHASES = ['wuxie', 'luoyingAsk', 'luoshen'];

function mkEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, className: '', id: '', textContent: '', innerHTML: '',
    onclick: null, onerror: null, onload: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() { return {}; }, removeChild() { return {}; }, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function buildSandboxContext() {
  const context = {
    // gameRef 这里先占位,run.js 加载完 game.js 后会用真实 Admin SDK ref 替换
    // (game.js 里 gameRef 是 `let` 声明,必须用 vm.runInContext 裸标识符赋值,见下方 wireGameRef)。
    gameRef: { transaction() { return Promise.resolve({ committed: false, snapshot: { val() { return null; } } }); } },
    firebase: {
      initializeApp() { return {}; },
      database() { return { ref() { return context.gameRef; } }; },
    },
    document: {
      getElementById() { return mkEl('div'); },
      createElement(tag) { return mkEl(tag); },
      createTextNode(t) { return { nodeValue: t, textContent: t }; },
      createDocumentFragment() { return { appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      body: mkEl('body'), head: mkEl('head'),
      addEventListener() {}, removeEventListener() {},
    },
    window: {
      firebase: null,
      location: { search: '', href: 'http://localhost', reload() {} },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} },
      sessionStorage: { getItem() { return null; }, setItem() {} },
      addEventListener() {}, removeEventListener() {},
      setTimeout(f, t) { return setTimeout(f, t); }, clearTimeout(t) { return clearTimeout(t); },
      setInterval(f, t) { return setInterval(f, t); }, clearInterval(t) { return clearInterval(t); },
      alert() {}, confirm() { return true; }, prompt() { return null; },
      open() { return null; }, close() {},
      history: { pushState() {}, replaceState() {} },
      navigator: { userAgent: 'sgs-local-bot-server', platform: 'node', language: 'zh-CN', onLine: true },
    },
    joinRoom() {},
    mySeat: -1,
    pushLog(log, text) { log.push({ seq: log.length, text: text }); return log; },
    setTimeout(f, t) { return setTimeout(f, t); },
    clearTimeout(t) { return clearTimeout(t); },
    console: console,
    Math: Math,
    Date: Date,
    JSON: JSON,
    RegExp: RegExp,
  };
  context.window.firebase = context.firebase;
  context.window.document = context.document;
  context.global = context;
  return context;
}

// 加载顺序遵循 index.html/CLAUDE.md 的既定约束:room-lifecycle.js 必须排在 game.js
// 之前(game.js 顶层有绑定 joinRoom 的 onclick);render.js 殿后(seatPick 的武圣/双雄
// match 引用 render.js 的 resolveActionId/canShuangxiongDuelCard)。不加载任何
// render-controls.js/render-hand.js/render-table.js/render-log.js/render-discard.js/
// debug-log.js——这次任务的决策路径不需要真的渲染 UI。
const LOAD_FILES = [
  'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js',
  'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js',
];

function loadSandbox(log) {
  const context = buildSandboxContext();
  const sandbox = vm.createContext(context, { name: 'sgs-local-bot-runtime' });
  LOAD_FILES.forEach(function (file) {
    const code = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    if (log) log('  已加载 ' + file);
  });

  // 【DOM 隔离,这次任务的核心边界】把 L1 和最终兜底显式替换成"直接承认处理不了",
  // 不依赖"引用不到 renderControls 时恰好被 try/catch 兜住"这种侥幸行为。
  vm.runInContext(String.raw`
    BOT_DECISIONS.controlsChoice.buildCandidates = function(){ return []; };
    botSafePrompt = function(){ return false; };
  `, sandbox);

  // 桥接函数:全部在沙箱内部执行,只把两个入口暴露给宿主 Node 代码调用(见文件头说明,
  // BOT_DECISIONS/gameRef/mySeat 这类 let/const 顶层声明不会自动挂到 context 对象上,
  // 只有在沙箱内部执行的代码才能直接按标识符引用它们)。
  vm.runInContext(String.raw`
    var __EXCLUDED_PHASES = ${JSON.stringify(EXCLUDED_PHASES)};
    function __botRuntimeDecide(g) {
      if (!g) return { skip: true, reason: 'no-game' };
      normalize(g);
      var seat = botSeatForState(g);
      if (seat < 0) return { skip: true, reason: 'no-bot-seat', phase: g.phase, g: g };
      if (__EXCLUDED_PHASES.indexOf(g.phase) >= 0) {
        return { skip: true, reason: 'dom-required-phase', phase: g.phase, seat: seat, g: g };
      }
      return { skip: false, phase: g.phase, seat: seat, g: g };
    }
    async function __botRuntimeRun(g, seat) {
      mySeat = seat;
      return await runBotDecision(g, seat);
    }
  `, sandbox);

  return { context: context, sandbox: sandbox };
}

// game.js 里 `let gameRef = null;` 是模块顶层声明,host 侧 `context.gameRef = xxx` 这种
// 属性赋值对它不生效,必须用 vm.runInContext 对裸标识符重新赋值(和 mySeat/BOT_DECISIONS
// 同一类 vm 已知坑,run_ai_bus_*.js 测试套件同样绕过的方式)。
function wireGameRef(sandbox, context, adminGameRef) {
  context.__adminGameRef = adminGameRef;
  vm.runInContext('gameRef = __adminGameRef;', sandbox);
}

module.exports = { loadSandbox, wireGameRef, EXCLUDED_PHASES, LOAD_FILES };
