const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const game=fs.readFileSync('game.js','utf8');
const data=fs.readFileSync('stages/stage-table.js','utf8');
const bus=fs.readFileSync('bot-ai-bus.js','utf8');
const stageBlock=data.match(/const STAGE_TABLE = Object\.create\(null\);[\s\S]*?\}\)\.forEach\(\(\[type,actor\]\)=>registerStage\(type,\{actor\}\)\);/);
const responderBlock=game.match(/function pendingResponderSeat\(g, pending\)\{[\s\S]*?\n\}/);
const timedBlock=game.match(/function isTimedResponsePending\(g, pending\)\{[\s\S]*?\n\}/);
const txBlock=game.match(/function tx\(fn, onCommitted\)\{[\s\S]*?\r?\n\}\r?\n\r?\nfunction doDraw/);
const abandonBlock=bus.match(/function defaultAbandonPending\(snapshot\)\{[\s\S]*?\n\}/);
assert(stageBlock&&responderBlock&&timedBlock&&txBlock&&abandonBlock,'应能提取通用超时函数');

let now=1000;
let state={
  phase:'futureSkill',turn:1,log:[],players:[{name:'甲'},{name:'乙'}],
  pending:{type:'futureSkill',seat:1,askedAt:100,resumePhase:'play'}
};
const context={
  Number,
  Date:{now:()=>now},
  RESPONSE_TIMEOUT_MS:30000,
  mySeat:1,
  gameRef:{transaction:function(fn){ state=fn(state); return null; }},
  normalize:function(g){return g;},
  pruneExchangeCards:function(){},
  tryFlushLianying:function(){},
  stripUndefined:function(g){return g;},
  setResponseAskedAt:function(d){d.askedAt=now;return d;},
  pushLog:function(log,text){return (log||[]).concat(text);},
  resumeAfterInterrupt:function(g,resume){g.phase=resume.type;},
  // CORE-77(issue #122)第一期:tx() 内新增了 commandLog 采集(见 game.js tx() 顶部)——
  // 这里只 regex 提取了 tx() 函数体本身(txBlock)，没有加载整个 game.js，所以 tx() 依赖
  // 的 commandLog/commandLogSeq/COMMAND_LOG_MAX/captureCommandName 这几个模块级变量/
  // 函数需要在这个最小 context 里补上最简单的桩，和同一个 context 里已有的
  // normalize/pruneExchangeCards/stripUndefined 等桩同一个写法——这个测试关心的是超时
  // 相关逻辑，不需要真实的命令日志行为（那由 run_core77_replay_infra_test.js 覆盖）。
  commandLog:[], commandLogSeq:0, COMMAND_LOG_MAX:500,
  captureCommandName:function(){ return null; }
};
vm.createContext(context);
vm.runInContext(stageBlock[0],context);
vm.runInContext(responderBlock[0],context);
vm.runInContext(timedBlock[0],context);
vm.runInContext(txBlock[0].replace(/\r?\n\r?\nfunction doDraw$/,''),context);
vm.runInContext(abandonBlock[0],context);

assert.strictEqual(context.isTimedResponsePending({phase:'futureSkill'},{type:'futureSkill',seat:1}),true,'未知类型按响应者字段自动计时');
assert.strictEqual(context.isTimedResponsePending({phase:'futureSkill'},{type:'futureSkill'}),false,'无响应者的未知内部状态不应误计时');

state={phase:'play',turn:1,log:[],players:[{name:'甲'},{name:'乙'}],pending:null};
context.mySeat=1;
now=500;
context.tx(function(g){g.pending={type:'futureSkill',seat:1};return g;});
assert.strictEqual(state.pending.askedAt,500,'tx 创建未知类型 pending 时应零登记自动打戳');

state={
  phase:'futureSkill',turn:1,log:[],players:[{name:'甲'},{name:'乙'}],
  pending:{type:'futureSkill',seat:1,askedAt:100,resumePhase:'play'}
};
now=1000;
context.tx(function(g){return g;});
assert.strictEqual(state.pending.askedAt,1000,'当前响应者操作应重置 askedAt');

context.mySeat=0;
now=2000;
context.tx(function(g){return g;});
assert.strictEqual(state.pending.askedAt,1000,'旁观者操作不得重置 askedAt');

context.mySeat=1;
now=32001;
const snapshot=JSON.parse(JSON.stringify(state));
context.defaultAbandonPending(snapshot);
assert.strictEqual(state.pending,null,'未知可取消 pending 超时后应自动放弃');
assert.strictEqual(state.phase,'play','默认放弃应恢复安全阶段');
assert(state.log.some(function(line){return line.includes('响应超时');}),'默认放弃应留下可见日志');

state={
  phase:'futureInterrupt',turn:0,log:[],players:[{name:'甲'},{name:'乙'}],
  pending:{type:'futureInterrupt',seat:1,askedAt:1,resume:{type:'afterFuture'}}
};
now=40000;
context.defaultAbandonPending(JSON.parse(JSON.stringify(state)));
assert.strictEqual(state.pending,null,'带 resume 的未知 pending 应可自动放弃');
assert.strictEqual(state.phase,'afterFuture','带 resume 的未知 pending 应走统一恢复出口');

console.log('universal timeout tests: 10 checks passed');
