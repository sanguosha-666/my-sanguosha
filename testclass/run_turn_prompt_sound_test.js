/**
 * CORE-70:轮到玩家操作时播战鼓提示音效(替换"轮到你了"语音)+ 开始游戏播号角 —— 最小验证。
 *
 * 只抽取相关的独立函数片段进极简 Audio 桩沙箱运行(和 run_skill_audio_mapping_test.js
 * 同一种"regex 抽片段 + 轻量沙箱"手法),不需要跑一遍会触碰全部座位卡/手牌 DOM 的重量级
 * render(g)——shouldPlayResponsePendingDrum 就是为了这个目的专门从 render() 里抽出来的
 * 纯函数(见 render.js 注释)。
 *
 * 覆盖范围:
 *  - playTurnDrum()/playStartHorn():正常创建 Audio 并调用 play();资源缺失(play()拒绝)
 *    时降级为 console.warn,不抛异常。
 *  - shouldPlayResponsePendingDrum():他人回合+自己是响应者时判定为true且给出去重key;
 *    自己回合/无pending/非本人响应/无askedAt 均判定为不相关;同一key不重复触发,
 *    key变化(新一次被问/自己操作后重置计时)重新触发。
 *  - render-controls.js 源码扫描:确认全部四个"开始游戏"按钮的 onclick 都接了
 *    playStartHorn()(不需要真的驱动一遍点击,和 run_skill_audio_mapping_test.js
 *    扫描 markSkillSound 调用点是同一类做法)。
 */

const fs = require('fs');
const vm = require('vm');

const renderSource = fs.readFileSync('render.js', 'utf8');
const playTurnDrumSnippet = renderSource.match(/function playTurnDrum\(\)\{[\s\S]*?\n\}/);
const playStartHornSnippet = renderSource.match(/function playStartHorn\(\)\{[\s\S]*?\n\}/);
const shouldPlaySnippet = renderSource.match(/function shouldPlayResponsePendingDrum\([\s\S]*?\n\}/);
if(!playTurnDrumSnippet || !playStartHornSnippet || !shouldPlaySnippet){
  console.log('FAIL: 无法从 render.js 定位 playTurnDrum/playStartHorn/shouldPlayResponsePendingDrum');
  process.exit(1);
}

const gameSource = fs.readFileSync('game.js', 'utf8');
const pendingResponderSeatMatch = gameSource.match(/function pendingResponderSeat\([\s\S]*?\n\}/);
if(!pendingResponderSeatMatch){ console.log('FAIL: 无法从 game.js 定位 pendingResponderSeat'); process.exit(1); }
// 直接复用 game.js 里真实的 pendingResponderSeat 实现源码(不重新造一个假的响应者解析
// 逻辑——那样测的就不是"和超时托管CORE-52同一套响应者判定"这件事本身了)。它内部会调用
// stageActorField(依赖 STAGE_TABLE),测试场景走的是它自身内置的 fields 兜底列表用不到,
// 给个返回 undefined 的桩,避免 ReferenceError。
const pendingResponderSeatSource = 'var stageActorField = function(){ return null; };\n' + pendingResponderSeatMatch[0];

let pass = 0, fail = 0;
async function check(name, fn){
  try{
    await fn();
    console.log('  PASS ' + name); pass++;
  }catch(e){
    console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++;
  }
}

function makeAudioContext(playResult){
  const created = [];
  const warnCalls = [];
  const context = {
    console: { warn: function(){ warnCalls.push(Array.prototype.slice.call(arguments)); }, log: function(){} },
    Audio: function(src){ created.push(src); this.play = function(){ return playResult(); }; }
  };
  vm.createContext(context);
  vm.runInContext(playTurnDrumSnippet[0] + '\n' + playStartHornSnippet[0], context, { filename: 'turn-prompt-sound.js' });
  return { context, created, warnCalls };
}

function evalShouldPlay(g, seat, lastKey){
  const context = { console };
  vm.createContext(context);
  vm.runInContext(pendingResponderSeatSource + '\n' + shouldPlaySnippet[0], context, { filename: 'should-play-response-pending-drum.js' });
  return vm.runInContext('shouldPlayResponsePendingDrum', context)(g, seat, lastKey);
}

(async function(){
  await check('playTurnDrum: 创建 assets/audio/turn_drum.mp3 并调用 play()', function(){
    const { context, created } = makeAudioContext(function(){ return Promise.resolve(); });
    vm.runInContext('playTurnDrum()', context);
    if(created.length !== 1) throw new Error('应创建1次Audio,实际 ' + created.length);
    if(created[0] !== 'assets/audio/turn_drum.mp3') throw new Error('资源路径不对: ' + created[0]);
  });

  await check('playStartHorn: 创建 assets/audio/start_horn.mp3 并调用 play()', function(){
    const { context, created } = makeAudioContext(function(){ return Promise.resolve(); });
    vm.runInContext('playStartHorn()', context);
    if(created.length !== 1) throw new Error('应创建1次Audio,实际 ' + created.length);
    if(created[0] !== 'assets/audio/start_horn.mp3') throw new Error('资源路径不对: ' + created[0]);
  });

  await check('playTurnDrum: 资源缺失(play()拒绝)时降级为console.warn,不抛异常', async function(){
    const { context, warnCalls } = makeAudioContext(function(){ return Promise.reject(new Error('NotSupportedError: no such file')); });
    vm.runInContext('playTurnDrum()', context); // 不应该同步抛出
    await new Promise(function(r){ setTimeout(r, 20); }); // 等 play() 的 rejection 真正落地
    if(warnCalls.length !== 1) throw new Error('应有1次warn,实际 ' + warnCalls.length);
    if(String(warnCalls[0][0]).indexOf('轮到操作提示音播放失败') < 0) throw new Error('warn文案不对: ' + warnCalls[0][0]);
  });

  await check('playStartHorn: 资源缺失(play()拒绝)时降级为console.warn,不抛异常', async function(){
    const { context, warnCalls } = makeAudioContext(function(){ return Promise.reject(new Error('NotSupportedError: no such file')); });
    vm.runInContext('playStartHorn()', context);
    await new Promise(function(r){ setTimeout(r, 20); });
    if(warnCalls.length !== 1) throw new Error('应有1次warn,实际 ' + warnCalls.length);
    if(String(warnCalls[0][0]).indexOf('开始游戏提示音播放失败') < 0) throw new Error('warn文案不对: ' + warnCalls[0][0]);
  });

  await check('shouldPlayResponsePendingDrum: 他人回合+自己是响应者+首次出现该pending → 应播放', function(){
    const g = { started: true, turn: 1, pending: { type: 'respond', to: 0, askedAt: 1000 } };
    const r = evalShouldPlay(g, 0, null);
    if(!r.relevant) throw new Error('应判定为相关');
    if(!r.shouldPlay) throw new Error('应判定为需要播放');
    if(r.key !== 'respond:1000') throw new Error('key不对: ' + r.key);
  });

  await check('shouldPlayResponsePendingDrum: 同一key(同一次被问)不重复播放', function(){
    const g = { started: true, turn: 1, pending: { type: 'respond', to: 0, askedAt: 1000 } };
    const r = evalShouldPlay(g, 0, 'respond:1000');
    if(!r.relevant) throw new Error('应判定为相关');
    if(r.shouldPlay) throw new Error('同一key不应重复播放');
  });

  await check('shouldPlayResponsePendingDrum: askedAt变化(新一次被问/自己操作后重置计时)→重新播放', function(){
    const g = { started: true, turn: 1, pending: { type: 'respond', to: 0, askedAt: 2000 } };
    const r = evalShouldPlay(g, 0, 'respond:1000');
    if(!r.shouldPlay) throw new Error('key变化应重新播放');
    if(r.key !== 'respond:2000') throw new Error('key不对: ' + r.key);
  });

  await check('shouldPlayResponsePendingDrum: 轮到自己回合时不相关(交给"自己回合"那套逻辑)', function(){
    const g = { started: true, turn: 0, pending: { type: 'respond', to: 0, askedAt: 1000 } };
    const r = evalShouldPlay(g, 0, null);
    if(r.relevant) throw new Error('自己回合不应由这个函数处理');
  });

  await check('shouldPlayResponsePendingDrum: 无pending时不相关', function(){
    const g = { started: true, turn: 1, pending: null };
    const r = evalShouldPlay(g, 0, null);
    if(r.relevant) throw new Error('无pending不应相关');
  });

  await check('shouldPlayResponsePendingDrum: pending存在但响应者不是自己时不相关', function(){
    const g = { started: true, turn: 1, pending: { type: 'respond', to: 2, askedAt: 1000 } };
    const r = evalShouldPlay(g, 0, null);
    if(r.relevant) throw new Error('响应者不是自己不应相关');
  });

  await check('shouldPlayResponsePendingDrum: pending无askedAt(非询问型)时不相关', function(){
    const g = { started: true, turn: 1, pending: { type: 'pick', to: 0 } };
    const r = evalShouldPlay(g, 0, null);
    if(r.relevant) throw new Error('无askedAt不应相关');
  });

  await check('shouldPlayResponsePendingDrum: g.started为false时不相关', function(){
    const g = { started: false, turn: 1, pending: { type: 'respond', to: 0, askedAt: 1000 } };
    const r = evalShouldPlay(g, 0, null);
    if(r.relevant) throw new Error('未开局不应相关');
  });

  await check('render-controls.js: 四个开始游戏按钮onclick均调用playStartHorn', function(){
    const src = fs.readFileSync('render-controls.js', 'utf8');
    const startGameCalls = src.match(/startGame\('[^']+','[^']+'\)/g) || [];
    if(startGameCalls.length !== 4) throw new Error('预期4处startGame调用,实际 ' + startGameCalls.length + ':' + startGameCalls.join(','));
    startGameCalls.forEach(function(call){
      const idx = src.indexOf(call);
      const before = src.slice(Math.max(0, idx - 200), idx);
      if(before.indexOf('playStartHorn') < 0){
        throw new Error('startGame调用 "' + call + '" 附近未找到playStartHorn: ...' + before.slice(-120));
      }
    });
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  process.exit(fail > 0 ? 1 : 0);
})();
