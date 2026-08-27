/**
 * CORE-174(issue #233):动画哨兵 flyingCard/targetLines 跨局未重置。
 *
 * 锁定：
 *  1. resetRenderSentinels / resetTableSentinels / resetDiscardReveal 把哨兵收回初始值
 *  2. 残留 DOM（#flyingCard/#targetLines/.damage-hit/.discard-reveal）被摘掉
 *  3. lastShownEntrySeq 重置为 null 而不是 undefined——undefined 会走「首次进房吞历史」，
 *     重开后首张飞牌被吞，违反验收「重开后首张牌飞牌正常」
 *  4. newGame()/backToLobby() 以 typeof 守卫调用上述三个函数（同 CORE-113 写法）
 */
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

function extractFn(src, name, nextName){
  const start = src.indexOf('function '+name+'()');
  if(start < 0) throw new Error('找不到 function '+name+'()');
  const end = nextName ? src.indexOf('function '+nextName+'()') : src.length;
  if(nextName && end < 0) throw new Error('找不到下一个 function '+nextName+'()');
  return src.slice(start, end < 0 ? src.length : end);
}

function makeDom(){
  const byId = Object.create(null);
  const seats = [];
  function classListFrom(set){
    return {
      add(){ for(let i=0;i<arguments.length;i++) set.add(arguments[i]); },
      remove(){ for(let i=0;i<arguments.length;i++) set.delete(arguments[i]); },
      contains(n){ return set.has(n); },
      toggle(n, force){
        if(force===false) set.delete(n);
        else if(force===true) set.add(n);
        else if(set.has(n)) set.delete(n); else set.add(n);
      }
    };
  }
  function makeEl(id, extra){
    const classes = new Set();
    const el = {
      id: id || '',
      innerHTML: '',
      style: {},
      dataset: {},
      parentNode: {},
      _damageTimer: null,
      _removed: false,
      classList: classListFrom(classes),
      remove(){
        el._removed = true;
        if(el.id) delete byId[el.id];
      }
    };
    Object.assign(el, extra || {});
    if(id) byId[id] = el;
    return el;
  }
  const tableCard = makeEl('tableCard');
  tableCard.classList.add('exchange-mode', 'show');
  tableCard.innerHTML = '<div class="exchange-card">旧牌</div>';
  const discardReveal = makeEl('discardReveal');
  discardReveal.classList.add('show');
  discardReveal.innerHTML = '<div>旧弃牌</div>';
  const flying = makeEl('flyingCard');
  const lines = makeEl('targetLines');
  const seat0 = makeEl(null, { dataset:{ seat:'0' } });
  seat0.classList.add('seat', 'damage-hit', 'table-actor');
  seat0._damageTimer = 123;
  seats.push(seat0);
  return {
    byId, seats, tableCard, discardReveal, flying, lines, seat0,
    document: {
      getElementById(id){
        if(byId[id]) return byId[id];
        // render.js 顶层会给 closeRoomBtn 等绑 onclick，未知 id 必须返回可写 stub
        return makeEl(id);
      },
      querySelector(sel){
        const m = /^\.seat\[data-seat="(\d+)"\]$/.exec(sel);
        if(m){
          for(let i=0;i<seats.length;i++) if(seats[i].dataset.seat===m[1]) return seats[i];
          return null;
        }
        return null;
      },
      querySelectorAll(sel){
        if(sel === '.seat.damage-hit') return seats.filter(s => s.classList.contains('damage-hit'));
        if(sel === '.seat.table-actor,.seat.table-target')
          return seats.filter(s => s.classList.contains('table-actor') || s.classList.contains('table-target'));
        return [];
      },
      addEventListener(){},
      createElement(){ return { style:{}, classList:{ add(){}, remove(){} } }; }
    }
  };
}

function loadSandbox(){
  const dom = makeDom();
  const context = {
    firebase:{ initializeApp(){ return { database(){ return { ref(){ return {
      on(){}, once(){}, transaction(){}, set(){}, update(){}, child(){ return this; }, remove(){}
    }; } }; } }; }, database(){ return this.initializeApp().database(); } },
    document: dom.document,
    window:{ location:{ search:'', href:'' }, localStorage:{ getItem(){ return null; }, setItem(){} },
      addEventListener(){}, setTimeout, clearTimeout, alert(){}, innerWidth:1280, innerHeight:720 },
    console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean, parseInt, isNaN,
    setTimeout, clearTimeout,
    Audio: function(){ this.play=function(){ return { catch(){} }; }; this.pause=function(){}; this.volume=1; this.currentTime=0; }
  };
  context.window.document = context.document;
  context.window.firebase = context.firebase;
  context.global = context;
  const sandbox = vm.createContext(context);
  ['config.js','data.js','room-lifecycle.js','render.js','render-table.js','render-discard.js'].forEach(file=>{
    vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'), sandbox, { filename:file });
  });
  return { sandbox, dom, R(code){ return vm.runInContext(code, sandbox); } };
}

console.log('\n== CORE-174 动画哨兵跨局重置 ==\n');

check('resetRenderSentinels / resetTableSentinels / resetDiscardReveal 均已定义', function(){
  const { R } = loadSandbox();
  assert.strictEqual(R('typeof resetRenderSentinels'), 'function');
  assert.strictEqual(R('typeof resetTableSentinels'), 'function');
  assert.strictEqual(R('typeof resetDiscardReveal'), 'function');
});

check('resetRenderSentinels 把音效/伤害/特效哨兵收回初始值', function(){
  const { R } = loadSandbox();
  R('lastAnnouncedTurnKey="t1"; lastAnnouncedPendingKey="p1";');
  R('lastPlayedCardSeq=9; lastPlayedSkillSeq=8; lastPlayedDamageSeq=7;');
  R('lastLightningFxSeq=6; lastMovieFxSeq=5; lastPlayedMovieFxLen=4;');
  R('resetRenderSentinels()');
  assert.strictEqual(R('lastAnnouncedTurnKey'), null);
  assert.strictEqual(R('lastAnnouncedPendingKey'), null);
  assert.strictEqual(R('lastPlayedCardSeq'), undefined);
  assert.strictEqual(R('lastPlayedSkillSeq'), undefined);
  assert.strictEqual(R('lastPlayedDamageSeq'), undefined);
  assert.strictEqual(R('lastLightningFxSeq'), undefined);
  assert.strictEqual(R('lastMovieFxSeq'), undefined);
  assert.strictEqual(R('lastPlayedMovieFxLen'), undefined);
});

check('resetRenderSentinels 摘掉残留 .damage-hit 并清定时器', function(){
  const { R, dom } = loadSandbox();
  assert.ok(dom.seat0.classList.contains('damage-hit'));
  R('resetRenderSentinels()');
  assert.ok(!dom.seat0.classList.contains('damage-hit'), 'damage-hit 应被移除');
});

check('reset 后旧伤害事件被当成历史吞掉，新 seq 才播', function(){
  const { R, dom } = loadSandbox();
  R('lastPlayedDamageSeq=42');
  R('resetRenderSentinels()');
  R('maybeShowDamageEffect({lastDamageEffect:{seq:42,target:0,amount:1}})');
  assert.ok(!dom.seat0.classList.contains('damage-hit'), '旧 seq 不应补播');
  R('maybeShowDamageEffect({lastDamageEffect:{seq:43,target:0,amount:1}})');
  assert.ok(dom.seat0.classList.contains('damage-hit'), '新 seq 应播伤害动效');
});

check('resetTableSentinels：seq 置 null（不是 undefined），飞牌/连线 DOM 摘掉，台面 class 清掉', function(){
  const { R, dom } = loadSandbox();
  R('lastShownEntrySeq=11; lastFadedBatchSeq=11;');
  R('resetTableSentinels()');
  assert.strictEqual(R('lastShownEntrySeq'), null, '必须是 null，undefined 会吞首张飞牌');
  assert.strictEqual(R('lastFadedBatchSeq'), null);
  assert.strictEqual(R('lastShownEntrySeq===undefined'), false);
  assert.ok(R('1!==lastShownEntrySeq'), '新 seq 应被当成 hasNewEntry');
  assert.ok(dom.flying._removed, '#flyingCard 应被移除');
  assert.ok(dom.lines._removed, '#targetLines 应被移除');
  assert.ok(!dom.tableCard.classList.contains('exchange-mode'));
  assert.ok(!dom.tableCard.classList.contains('show'));
  assert.strictEqual(dom.tableCard.innerHTML, '');
  assert.ok(!dom.seat0.classList.contains('table-actor'));
});

check('resetDiscardReveal 清空队列/哨兵/展示 DOM', function(){
  const { R, dom } = loadSandbox();
  R('lastObservedDiscardRevealSeq=3; discardRevealQueue=[{cards:[]}]; discardRevealPlaying=true;');
  R('resetDiscardReveal()');
  assert.strictEqual(R('lastObservedDiscardRevealSeq'), null);
  assert.strictEqual(R('discardRevealQueue.length'), 0);
  assert.strictEqual(R('discardRevealPlaying'), false);
  assert.ok(!dom.discardReveal.classList.contains('show'));
  assert.strictEqual(dom.discardReveal.innerHTML, '');
});

check('newGame() 以 typeof 守卫调用三个重置函数', function(){
  const src = fs.readFileSync(path.join(ROOT,'room-lifecycle.js'),'utf8');
  const body = extractFn(src, 'newGame', 'cleanupRoom');
  ['resetRenderSentinels','resetTableSentinels','resetDiscardReveal'].forEach(fn=>{
    assert.ok(body.indexOf("typeof "+fn+"==='function'") >= 0, 'newGame 缺 typeof '+fn);
    assert.ok(body.indexOf(fn+'()') >= 0, 'newGame 未调用 '+fn+'()');
  });
});

check('backToLobby() 以 typeof 守卫调用三个重置函数', function(){
  const src = fs.readFileSync(path.join(ROOT,'room-lifecycle.js'),'utf8');
  const body = extractFn(src, 'backToLobby', null);
  ['resetRenderSentinels','resetTableSentinels','resetDiscardReveal'].forEach(fn=>{
    assert.ok(body.indexOf("typeof "+fn+"==='function'") >= 0, 'backToLobby 缺 typeof '+fn);
    assert.ok(body.indexOf(fn+'()') >= 0, 'backToLobby 未调用 '+fn+'()');
  });
});

console.log('\ncore174 anim sentinel reset: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
