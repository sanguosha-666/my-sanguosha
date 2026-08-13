/**
 * 凌统旋风测试运行器 - 使用共享上下文的vm(和 run_lidian_test.js/run_fazheng_test.js
 * 同一套既有约定:describe/it/assert 注入 + 加载 config/data/weapons/room-lifecycle/
 * game/skills.js,再在同一个vm上下文里执行 test_xuanfeng.js)。
 * it() 失败后不中断整份文件,记录下来继续跑完剩余用例,最后统一报告 PASS/FAIL 计数。
 */

const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

let passCount = 0, failCount = 0;

// 创建共享上下文
const context = {
  gameRef: {
    transaction: function(fn) {
      return fn({});
    }
  },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; } }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: []
  },
  window: {
    firebase: null,
    location: { search: '', href: 'http://localhost', reload: function() {} },
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    setInterval: function(f, t) { return setInterval(f, t); }, clearInterval: function(t) { return clearInterval(t); },
    alert: function() {}, confirm: function() { return true; }, prompt: function() { return null; },
    open: function() { return null; }, close: function() {},
    history: { pushState: function() {}, replaceState: function() {} },
    navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', onLine: true }
  },
  joinRoom: function() {},
  mySeat: 0,
  pushLog: function(log, text) { log.push({seq: log.length, text: text}); return log; },
  console: console,
  Math: Math,
  Date: Date,
  JSON: JSON,
  RegExp: RegExp,
  assert: assert,
  describe: function(name, fn) {
    console.log('Description:', name);
    fn();
  },
  it: function(name, fn) {
    try {
      fn();
      console.log('  PASS', name);
      passCount++;
    } catch (e) {
      console.log('  FAIL', name, '-', e.message);
      failCount++;
    }
  }
};

context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

// 重新设置context中的gameRef，使其在上下文中可用
context.gameRef = {
  transaction: function(fn) {
    return fn(context.g || {});
  }
};

const sandbox = vm.createContext(context, {
  name: 'sgs-sandbox'
});

console.log('Loading Xuanfeng test environment...\n');

console.log('Loading dependencies...\n');

// 加载所有依赖文件(和 run_lidian_test.js/run_fazheng_test.js 同一份清单:
// test_xuanfeng.js 只调用 game.js/skills.js 里的函数,不涉及渲染,不需要 render*.js)
var files = ['config.js', 'data.js', 'weapons.js', 'room-lifecycle.js', 'game.js', 'skills.js'];
var loaded = 0;

files.forEach(function(file) {
  try {
    var code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, {
      filename: file,
      lineOffset: 0
    });
    loaded++;
    console.log('  OK ' + file);

    // After loading game.js, override tx and set mySeat to 0 for tests
    if (file === 'game.js') {
      vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sandbox);
      vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
      console.log('After loading ' + file + ': sandbox.mySeat =', sandbox.mySeat);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) {
      console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    }
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  Xuanfeng Tests');
console.log('='.repeat(60) + '\n');

// 加载并运行测试代码
// 旧 test_xuanfeng.js 的测试体已内联到本 runner，避免保留一个脱离 runner 就无法执行的
// 伪独立 Mocha 文件。runner 仍提供同一套 describe/it 沙箱，测试语义不变。
var testCode = String.raw`describe('凌统【旋风】修复', function() {
  function player(name, general) {
    return {
      name: name, general: general, alive: true, hp: 4, maxHp: 4,
      hand: [], equips: { weapon: null, armor: null, plus1: null, minus1: null },
      delays: [], caps: {}, huashenPool: [], huashenGeneral: null, huashenSkillName: null
    };
  }

  it('Firebase省略空数组后仍保留刚触发的旋风选择状态', function() {
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    const g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: {
        type: 'xuanfengPick', from: 0, trigger: 'equip', maxRemaining: 2,
        stage: 'selecting', previousPhase: 'play'
      },
      deck: [], discard: [], log: []
    };

    normalize(g);

    assert.strictEqual(g.pending.type, 'xuanfengPick');
    assert.deepStrictEqual(Array.from(g.pending.targets), []);
    assert.deepStrictEqual(Array.from(g.pending.discardedCounts), []);
    assert.strictEqual(g.phase, 'xuanfengPick');
  });

  it('选择1张后可以主动完成并真实弃牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    finishXuanfengSelection();

    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard.length, 1);
    assert.strictEqual(_g.pending, null);
    assert.strictEqual(_g.phase, 'play');
  });

  it('选中目标后进入逐张选牌阶段', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengTarget(1);

    assert.strictEqual(_g.pending.currentTargetSeat, 1);
    assert.strictEqual(_g.pending.maxRemaining, 1);
    assert.strictEqual(_g.pending.stage, 'chooseCard');
  });

  it('可以指定弃置目标的装备而不是随机手牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }];
    target.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [], discardedCounts: [], selections: [], maxRemaining: 2, stage: 'chooseCard', currentTargetSeat: 1, previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengCard('equip', 'armor');
    finishXuanfengSelection();

    assert.strictEqual(target.equips.armor, null);
    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard[0].name, '八卦阵');
    assert.strictEqual(_g.pending, null);
  });

  it('骁果令凌统失去装备后保留旋风pending并记录续接', function() {
    mySeat = 1;
    const yuejin = player('乐进', 'yuejin');
    const lingtong = player('凌统', 'lingtong');
    lingtong.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [yuejin, lingtong], turn: 1, phase: 'xiaoguoChoice',
      pending: { type: 'xiaoguoChoice', from: 0, endingSeat: 1, to: 1 },
      deck: [{ id: 'd1', name: '杀' }], discard: [], log: []
    };

    respondXiaoguoChoice('armor');

    assert.strictEqual(lingtong.equips.armor, null);
    assert.strictEqual(yuejin.hand.length, 1);
    assert.strictEqual(_g.pending.type, 'xuanfengPick');
    assert.strictEqual(_g.pending.from, 1);
    assert.strictEqual(_g.pending.resume.type, 'xiaoguo');
    assert.strictEqual(_g.pending.resume.endingSeat, 1);
    assert.strictEqual(_g.pending.resume.lastAsker, 0);
  });

  it('流离弃装备触发旋风后暂停，并在旋风结束后继续转移的杀', function() {
    mySeat = 1;
    const attacker = player('攻击者', 'caocao');
    const lingtong = player('兼具流离的凌统', 'lingtong');
    lingtong.caps = { liuli: true };
    lingtong.equips.armor = { id:'e-liuli', name:'八卦阵' };
    const redirected = player('转移目标', 'liubei');
    _g = {
      players:[attacker,lingtong,redirected], turn:0, phase:'liuli',
      pending:{type:'liuli',from:0,to:1,usedAs:'【杀】',shaColor:'red',targets:[2],sourceCard:{id:'sha-liuli',name:'杀',suit:'♥'}},
      deck:[],discard:[],log:[]
    };

    respondLiuli({kind:'equip',slot:'armor'},2);
    assert.strictEqual(_g.pending.type,'xuanfengPick','旋风 pending 不得被杀结算覆盖');
    assert.strictEqual(_g.pending.resume.type,'liuliAfterDiscard');
    assert.strictEqual(_g.pending.resume.newTargetSeat,2);

    cancelXuanfeng();
    assert.strictEqual(_g.phase,'respond','旋风完成后应继续转移目标的杀响应');
    assert.strictEqual(_g.pending.to,2);
    assert.strictEqual(_g.pending.from,0);
  });

  it('急救弃红色装备触发旋风后恢复原濒死上下文', function() {
    mySeat=1;
    const turnPlayer=player('当前回合角色','caocao');
    const lingtong=player('兼具急救的凌统','lingtong');
    lingtong.caps={jijiu:true};
    lingtong.equips.armor={id:'red-equip',name:'八卦阵',suit:'♥'};
    const dying=player('濒死角色','liubei'); dying.hp=0;
    _g={players:[turnPlayer,lingtong,dying],turn:0,phase:'dying',started:true,
      pending:{type:'dying',seat:2,asking:1,resume:{type:'sha'}},deck:[],discard:[],log:[],gameMode:'ffa'};

    respondDying(true,{kind:'equip',slot:'armor'});
    assert.strictEqual(_g.pending.type,'xuanfengPick','不得把旋风 pending 当作 dying 继续读取');
    assert.strictEqual(_g.pending.resume.type,'dyingJijiu');
    assert.strictEqual(dying.hp,0,'子技能完成前暂不结算回复');

    cancelXuanfeng();
    assert.strictEqual(dying.hp,1,'旋风完成后急救回复正确结算');
    assert.strictEqual(dying.dying,false,'应正常脱离濒死');
    assert.strictEqual(_g.pending,null,'不得残留旋风或 dying pending');
  });

  it('寒冰剑弃装备触发旋风后暂停，并从下一轮继续', function() {
    mySeat=0;
    const attacker=player('攻击者','caocao');
    attacker.hand=[{id:'h1',name:'杀'}];
    const lingtong=player('凌统','lingtong');
    lingtong.equips.armor={id:'e1',name:'八卦阵'};
    lingtong.equips.plus1={id:'e2',name:'的卢'};
    _g={players:[attacker,lingtong],turn:0,phase:'hanbing',started:true,
      pending:{type:'hanbing',from:0,to:1,round:0},deck:[],discard:[],log:[],gameMode:'ffa'};

    hanbingPick('armor');
    assert.strictEqual(_g.pending.type,'xuanfengPick','旋风 pending 不应被寒冰剑覆盖');
    assert.strictEqual(_g.pending.resume.type,'hanbing');
    assert.strictEqual(_g.pending.resume.round,1,'恢复时应从第二轮继续');

    mySeat=1;
    cancelXuanfeng();
    assert.strictEqual(lingtong.equips.plus1,null,'旋风结束后寒冰剑应继续弃第二张牌');
    assert.strictEqual(_g.pending.type,'xuanfengPick','第二次失去装备也应先完整结算旋风');
    assert.strictEqual(_g.pending.resume.round,2,'第二次旋风后应恢复到寒冰剑收尾');
    cancelXuanfeng();
    assert.strictEqual(_g.pending,null,'寒冰剑完成后应清空自身状态');
    assert.strictEqual(_g.phase,'play');
  });
});`;
// 在上下文中设置_g变量，用于tx函数
vm.runInContext('_g = null;', sandbox);

// 执行测试 - 在同一个上下文中运行(describe/it内部已经各自try/catch,这里只兜底
// 捕获test_xuanfeng.js顶层本身抛出的意外错误,比如文件语法错误或describe外的裸代码报错)
try {
  vm.runInContext(testCode, sandbox, {
    filename: 'test_xuanfeng.js',
    lineOffset: 0
  });

  console.log('\n' + '='.repeat(60));
  console.log('  PASS: ' + passCount + '   FAIL: ' + failCount);
  console.log('='.repeat(60) + '\n');
  process.exit(failCount > 0 ? 1 : 0);
} catch (e) {
  console.log('\nTest file itself threw (not caught by describe/it):');
  console.log('  Error:', e.message);
  if (e.stack) {
    var lines = e.stack.split('\n').slice(0, 20);
    lines.forEach(function(l) { console.log('   ', l.trim()); });
  }
  console.log('\n' + '='.repeat(60));
  console.log('  TESTS FAILED');
  console.log('='.repeat(60) + '\n');
  process.exit(1);
}
