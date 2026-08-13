/**
 * 李典测试运行器 - 使用共享上下文的vm
 */

const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

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
    } catch (e) {
      console.log('  FAIL', name, '-', e.message);
      throw e;
    }
  }
};

context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

// 创建VM上下文
// 重新设置context中的gameRef，使其在上下文中可用
context.gameRef = {
  transaction: function(fn) {
    return fn(context.g || {});
  }
};

const sandbox = vm.createContext(context, {
  name: 'sgs-sandbox'
});

console.log('Loading Li Dian test environment...\n');

console.log('Loading dependencies...\n');

// 加载所有依赖文件
var files = ['config.js', 'data.js', 'stages/stage-table.js', 'weapons.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'skills.js'];
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
console.log('  Li Dian Tests');
console.log('='.repeat(60) + '\n');

// 加载并运行测试代码
var testCode = String.raw`function card(name, suit, rank){
  return { id:name+'-'+suit+'-'+rank+'-'+Math.random(), name, suit, rank };
}

function player(name, general){
  return {
    name,
    general,
    hp:3,
    maxHp:3,
    alive:true,
    hand:[],
    equips:{weapon:null, armor:null, atkHorse:null, defHorse:null},
    delays:[]
  };
}

function baseGame(){
  return {
    players:[player('李典','lidian'), player('张飞','zhangfei')],
    deck:[
      card('杀','♠',1),
      card('闪','♥',2),
      card('桃','♦',3),
      card('杀','♣',4),
      card('闪','♠',5)
    ],
    discard:[],
    log:[],
    pending:null,
    phase:'draw',
    turn:0,
    roundNum:1
  };
}

describe('李典【恂恂/忘隙】', function(){
  it('恂恂可以放弃摸牌,获得2张并将其余牌置底', function(){
    mySeat=0;
    _g=baseGame();
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'xunxunPick');
    assert.strictEqual(_g.pending.cards.length, 4);
    respondXunxun([0,3], [1,2]);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.players[0].hand.length, 2);
    assert.strictEqual(_g.deck.length, 3);
    assert.deepStrictEqual(_g.deck.slice(0,2).map(c=>c.rank), [3,4]);
  });

  it('非李典不能发动恂恂', function(){
    mySeat=0;
    _g=baseGame();
    _g.players[0].general='zhangfei';
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'draw');
    assert.strictEqual(_g.pending, null);
  });

  it('忘隙发动后双方各摸指定数量的牌', function(){
    mySeat=0;
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    respondWangxi(true);
    assert.strictEqual(_g.players[0].hand.length, 1);
    assert.strictEqual(_g.players[1].hand.length, 1);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  // ============ normalize校验 bug 修复:致命伤害场景(death:true)不应被误判为脏数据 ============

  it('normalize:忘隙致死场景(death:true,otherSeat已死亡)不应清空pending', function(){
    _g=baseGame();
    _g.players[1].alive=false; // otherSeat(张飞)已经死亡结算完毕
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.phase, 'wangxiAsk');
    assert.notStrictEqual(_g.pending, null);
    assert.strictEqual(_g.pending.type, 'wangxiAsk');
  });

  it('normalize+respondWangxi:致死场景发动忘隙,只有李典自己摸牌,流程正确推进', function(){
    mySeat=0;
    _g=baseGame();
    _g.players.push(player('第三人','yuJi')); // 3人局,otherSeat死亡后仍有2人存活,不会触发checkWin结束游戏
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g); // 模拟真实tx()入口:respondWangxi被调用前,服务端总会先跑一次normalize
    assert.notStrictEqual(_g.pending, null, 'normalize不应误杀这条致死场景的pending');
    respondWangxi(true);
    assert.strictEqual(_g.players[0].hand.length, 1, '李典应摸1张牌');
    assert.strictEqual(_g.players[1].hand.length, 0, '已死亡的对方不应摸牌');
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  it('normalize+respondWangxi:致死场景选择不发动忘隙,流程正确推进', function(){
    mySeat=0;
    _g=baseGame();
    _g.players.push(player('第三人','yuJi'));
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.notStrictEqual(_g.pending, null);
    respondWangxi(false);
    assert.strictEqual(_g.players[0].hand.length, 0, '不发动不应摸牌');
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  it('normalize:忘隙一般场景(death:false,otherSeat存活)原有行为不受影响', function(){
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.phase, 'wangxiAsk');
    assert.notStrictEqual(_g.pending, null);
  });

  it('normalize:忘隙一般场景(death:false)若otherSeat已死亡,仍应判定为脏数据清空(对照组)', function(){
    _g=baseGame();
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.pending, null, 'death:false时otherSeat必须存活,否则仍是脏数据');
    assert.strictEqual(_g.phase, 'play');
  });

  it('normalize:otherSeat座位号越界(玩家不存在)依然要被正确拦截清空(负向场景,防止这次修复整体放水)', function(){
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:99, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.pending, null, 'otherSeat对应玩家不存在,即使death:true也应判定为脏数据');
    assert.strictEqual(_g.phase, 'play');
  });
});`;

// 在上下文中设置_g变量，用于tx函数
vm.runInContext('_g = null;', sandbox);

// 执行测试 - 在同一个上下文中运行
try {
  vm.runInContext(testCode, sandbox, {
    filename: 'test_lidian.js',
    lineOffset: 0
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('  ALL TESTS PASSED!');
  console.log('='.repeat(60) + '\n');
  process.exit(0);
} catch (e) {
  console.log('\nTest failed:');
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
