/**
 * 法正测试运行器 - 使用共享上下文的vm(和 run_lidian_test.js 同一套既有约定:
 * describe/it/assert 注入 + 加载 config/data/weapons/room-lifecycle/game/skills.js,
 * 再在同一个vm上下文里执行 test_fazheng.js)。
 * 与 run_lidian_test.js 唯一的行为差异:it() 失败后不再 throw 中断整份文件,而是记录
 * 下来继续跑完剩余用例,最后统一报告 PASS/FAIL 计数——这样一次失败不会掩盖同文件里
 * 其它用例本该有的结果,更贴近真实 mocha 的报告方式。
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
    addEventListener: function() {}, removeEventListener: function() {},
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

console.log('Loading Fazheng test environment...\n');

console.log('Loading dependencies...\n');

// 法正曾出现过“逻辑测试全过、真实界面因缺失 helper 直接 ReferenceError”的问题，因此这里
// 同时加载真实渲染层，让专项测试覆盖 renderControls，而不再只测 game.js 状态转换。
// 【测试加载清单修复】原来漏了bot-ai-bus.js——renderResponseCountdown(A1响应超时倒计时
// 功能,db415d7引入)定义在那个文件里,被render-controls.js的渲染路径引用。这个测试文件
// 写在bot-ai-bus.js从bot.js拆分出来(2940b65)之前,后续没有同步补上,导致眩惑/恩怨这几个
// "真实渲染不抛错"的场景在依赖缺失上直接ReferenceError崩溃,根本没跑到断言逻辑本身。
// 按真实index.html的加载顺序补在game.js之后、render.js之前。
var files = ['config.js', 'data.js', 'weapons.js', 'room-lifecycle.js', 'game.js', 'bot-ai-bus.js', 'skills.js', 'render.js', 'render-controls.js'];
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
console.log('  Fazheng Tests');
console.log('='.repeat(60) + '\n');

// 加载并运行测试代码
var testCode = String.raw`function fazhengCard(name,suit,rank,id){
  return {id:id||name+'-'+suit+'-'+rank,name,suit,rank};
}

function fazhengPlayer(name,general){
  return {
    name,general,hp:3,maxHp:3,alive:true,hand:[],
    equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]
  };
}

function fazhengGame(){
  return {
    players:[fazhengPlayer('法正','fazheng'),fazhengPlayer('甲','xiahoudun'),fazhengPlayer('乙','zhangfei')],
    deck:[fazhengCard('杀','♠',7,'deck-1')],discard:[],log:[],pending:null,
    phase:'play',turn:0,started:true,huanhuoUsed:false
  };
}

describe('法正【恩怨/眩惑】',function(){
  it('眩惑目标阶段真实渲染不抛错',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'ui-heart')];
    startHuanhuo();
    assert.doesNotThrow(function(){ renderControls(_g); });
  });

  it('眩惑四个操作阶段经过Firebase回读后均可真实渲染',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('杀','♠',7,'not-heart'),fazhengCard('桃','♥',9,'ui-peach')];
    _g.players[1].hand=[fazhengCard('闪','♦',8,'target-card')];
    startHuanhuo();
    pickHuanhuoTarget(1);
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.pending.heartCards,undefined);
    assert.doesNotThrow(function(){ renderControls(_g); });

    pickHuanhuoHeartCard(1);
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.phase,'huanhuoPickGotCard');
    assert.doesNotThrow(function(){ renderControls(_g); });

    const oldRandom=Math.random; Math.random=()=>0;
    pickHuanhuoGotCard('hand');
    Math.random=oldRandom;
    _g=JSON.parse(JSON.stringify(_g)); normalize(_g);
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.doesNotThrow(function(){ renderControls(_g); });
  });

  it('眩惑可以完成交红桃、获得牌并转交另一名角色的完整流程',function(){
    mySeat=0;
    _g=fazhengGame();
    const heart=fazhengCard('闪','♥',3,'heart');
    const taken=fazhengCard('杀','♠',9,'taken');
    _g.players[0].hand=[heart];
    _g.players[1].hand=[taken];

    startHuanhuo();
    assert.strictEqual(_g.phase,'huanhuoPick');
    assert.deepStrictEqual(Array.from(_g.pending.candidates),[1,2]);
    pickHuanhuoTarget(1);
    assert.strictEqual(_g.phase,'huanhuoPickCard');
    // 模拟 Firebase 完整序列化/回读后再执行下一次点击，不能依赖旧牌对象快照。
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending.type,'huanhuoPickCard');
    pickHuanhuoHeartCard(0);
    assert.strictEqual(_g.phase,'huanhuoPickGotCard');
    const oldRandom=Math.random; Math.random=()=>0;
    pickHuanhuoGotCard('hand');
    Math.random=oldRandom;
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.strictEqual(_g.pending.firstTargetSeat,1);
    assert.deepStrictEqual(Array.from(_g.pending.candidates),[2]);
    pickHuanhuoSecondTarget(2);

    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    assert.strictEqual(_g.huanhuoUsed,true);
    assert.ok(_g.players[1].hand.some(c=>c.id==='heart'));
    assert.ok(_g.players[2].hand.some(c=>c.id==='taken'));
    assert.ok(!_g.players[0].hand.some(c=>c.id==='taken'));
  });

  it('眩惑按官方规则可指定获得装备，并触发失去装备钩子',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('桃','♥',3,'heart-equip')];
    _g.players[1].general='sunshangxiang';
    _g.players[1].equips.weapon=fazhengCard('青龙偃月刀','♠',5,'taken-equip');
    _g.deck=[fazhengCard('杀','♠',7,'draw-a'),fazhengCard('闪','♦',8,'draw-b')];

    startHuanhuo();
    pickHuanhuoTarget(1);
    pickHuanhuoHeartCard(0);
    pickHuanhuoGotCard('equip','weapon');

    assert.strictEqual(_g.players[1].equips.weapon,null);
    assert.strictEqual(_g.players[1].hand.length,3,'孙尚香失去装备应因枭姬摸两张');
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.ok(_g.players[0].hand.some(c=>c.id==='taken-equip'));
    pickHuanhuoSecondTarget(2);
    assert.ok(_g.players[2].hand.some(c=>c.id==='taken-equip'));
  });

  it('眩惑拿走凌统装备时，旋风结算后继续转交而不丢失流程',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('桃','♥',3,'heart-lingtong')];
    _g.players[1].general='lingtong';
    _g.players[1].equips.armor=fazhengCard('八卦阵','♣',2,'lingtong-equip');

    startHuanhuo();
    pickHuanhuoTarget(1);
    pickHuanhuoHeartCard(0);
    pickHuanhuoGotCard('equip','armor');
    assert.strictEqual(_g.phase,'xuanfengPick');
    assert.strictEqual(_g.pending.resume.type,'huanhuoTransfer');

    mySeat=1;
    cancelXuanfeng();
    assert.strictEqual(_g.phase,'huanhuoPickSecond');
    assert.strictEqual(_g.pending.sourceSeat,0);
    mySeat=0;
    pickHuanhuoSecondTarget(2);
    assert.ok(_g.players[2].hand.some(c=>c.id==='lingtong-equip'));
  });

  it('眩惑选择红桃阶段经过normalize后仍可取消',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'heart-cancel')];
    startHuanhuo();
    pickHuanhuoTarget(1);
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending.type,'huanhuoPickCard');
    cancelHuanhuo();
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
  });

  it('眩惑目标选择阶段取消后可再次发动，不残留死界面',function(){
    mySeat=0;
    _g=fazhengGame();
    _g.players[0].hand=[fazhengCard('闪','♥',3,'heart-retry')];
    startHuanhuo();
    cancelHuanhuo();
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    startHuanhuo();
    assert.strictEqual(_g.pending.type,'huanhuoPick');
    assert.strictEqual(_g.phase,'huanhuoPick');
  });

  it('恩怨失去体力不是伤害，不会触发伤害类技能',function(){
    mySeat=1;
    _g=fazhengGame();
    _g.turn=2;
    _g.players[1].hp=2;
    _g.pending={type:'enyuanChooseOption',sourceSeat:0,damagerSeat:1,heartCards:[],resume:{type:'fanjian'}};
    _g.phase='enyuanChooseOption';

    chooseEnyuanOption('loseHp');

    assert.strictEqual(_g.players[1].hp,1);
    assert.strictEqual(_g.pending,null);
    assert.strictEqual(_g.phase,'play');
    assert.ok(!_g.log.some(x=>String(x.text||x).includes('刚烈')));
  });

  it('恩怨可交出不在手牌首位的桃',function(){
    mySeat=1;
    _g=fazhengGame();
    const nonHeart=fazhengCard('杀','♣',4,'first-card');
    const peach=fazhengCard('桃','♥',9,'second-peach');
    _g.players[1].hand=[nonHeart,peach];
    _g.pending={type:'enyuanGiveCard',sourceSeat:0,damagerSeat:1,resume:{type:'sha'}};
    _g.phase='enyuanGiveCard';
    _g=JSON.parse(JSON.stringify(_g));
    normalize(_g);
    assert.doesNotThrow(function(){ renderControls(_g); });

    giveEnyuanCard(1);

    assert.strictEqual(_g.pending,null);
    assert.ok(_g.players[0].hand.some(c=>c.id==='second-peach'));
    assert.deepStrictEqual(Array.from(_g.players[1].hand).map(c=>c.id),['first-card']);
  });

  it('非伤害来源不能替别人操作恩怨',function(){
    mySeat=2;
    _g=fazhengGame();
    _g.pending={type:'enyuanChoose',sourceSeat:0,damagerSeat:1,resume:{type:'sha'}};
    _g.phase='enyuanChoose';
    triggerEnyuan();
    assert.strictEqual(_g.pending.type,'enyuanChoose');
  });

  it('其他角色用青囊令法正回血时，施术者因恩怨摸一张牌',function(){
    mySeat=1;
    _g=fazhengGame();
    _g.turn=1;
    _g.players[1].general='huatuo';
    _g.players[0].hp=2;
    _g.players[1].hand=[fazhengCard('杀','♣',4,'cost')];
    _g.deck=[fazhengCard('闪','♦',8,'reward')];

    qingNang(0,0);

    assert.strictEqual(_g.players[0].hp,3);
    assert.strictEqual(_g.players[1].hand.length,1);
    assert.strictEqual(_g.players[1].hand[0].id,'reward');
  });
});`;

// 在上下文中设置_g变量，用于tx函数
vm.runInContext('_g = null;', sandbox);

// 执行测试 - 在同一个上下文中运行(describe/it内部已经各自try/catch,这里只兜底
// 捕获test_fazheng.js顶层本身抛出的意外错误,比如文件语法错误或describe外的裸代码报错)
try {
  vm.runInContext(testCode, sandbox, {
    filename: 'test_fazheng.js',
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
