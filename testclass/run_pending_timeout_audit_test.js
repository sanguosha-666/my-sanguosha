const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const game=fs.readFileSync('game.js','utf8');
const data=fs.readFileSync('stages/stage-table.js','utf8');
const bus=fs.readFileSync('bot-ai-bus.js','utf8');
const bot=fs.readFileSync('bot.js','utf8');
const timeoutBlock=data.match(/function registerStageTimeoutAction\([\s\S]*$/);
const actionBlock=bus.match(/function autoRespondAction\(g\)\{[\s\S]*?\n\}/);
const stageBlock=data.match(/const STAGE_TABLE = Object\.create\(null\);[\s\S]*?\}\)\.forEach\(\(\[type,actor\]\)=>registerStage\(type,\{actor\}\)\);/);
const responderBlock=game.match(/function pendingResponderSeat\(g, pending\)\{[\s\S]*?\n\}/);
const canAbandonBlock=bus.match(/function canDefaultAbandonPending\(g\)\{[\s\S]*?\n\}/);
assert(timeoutBlock&&actionBlock&&stageBlock&&responderBlock&&canAbandonBlock,'应能定位超时托管核心定义');
const ctx=vm.createContext({Math,Number});
vm.runInContext(`${stageBlock[0]}\n${responderBlock[0]}\n${canAbandonBlock[0]}\n${timeoutBlock[0]}\n${actionBlock[0]}`,ctx);
const read=expr=>vm.runInContext(expr,ctx);

const expected=[
  'pick',
  'haoshiPick','leijiChoose','leijiJudge','mengjin','mingcePickTarget','mingceChoice',
  'qiaobianMove','enyuanChoose','jiushiFlipAsk','wangxiAsk','buquAsk','luanwuChoose','wugu',
  // 【自动发动改造】'luoshen' 已从这份清单移除:甄姬【洛神】不再有交互阶段
  // (autoLuoshenRound 直接自动循环判定),对应的 registerStageTimeoutAction 也已删除,
  // 不再需要超时托管(没有"询问"这一步可超时)。
  'hanbingAsk','jujianPickCard','jushouChoose','shuangxiongAsk','luoyiAsk','xunxunPick',
  'enyuanChooseOption','enyuanGiveCard','guhuoTarget','guanxingReview','quhuDamageChoice','tianyiRespond',
  'jiemingAsk','xinshengAsk','yijiAssign','tiaoxinDiscard','qiaomengPickEquip','lieRenRespond',
  'jujianPickTarget','jujianChooseEffect','luoyingAsk','cixiongAsk','chengxiangAsk','chengxiangChoose',
  'renxinChoose','xuanfengPick','beigeChoose','beigeDiscard','beigeJudge','tianyiPickCard','tianyiPickTarget',
  'zhimengAsk','zhimengPick','biyue','yaowu_choose','shensuSha','fenxunDiscard','fenxunTarget'
  ,'ganglieAsk','guiduAsk','huanhuoPick','huanhuoPickCard','huanhuoPickGotCard','huanhuoPickSecond',
  'huashenChangeAskEnd','huashenChangeAskStart','huashenChangePickStart','huashenChangePickEnd',
  'jiangchiAsk','lieRenChoose','lieRenPickCard','mingcePickTarget2','qiaobianTurnStart',
  'shaOffsetChoice','shensuChoose1','shensuChoose2','tiaoxinChoice','yijiAsk','zhijiChoice'
];
for(const type of expected){
  assert.strictEqual(read(`typeof autoRespondAction({phase:${JSON.stringify(type==='chengxiangChoose'?'chengxiangAsk':type)},pending:{type:${JSON.stringify(type)},cards:[],players:[],candidates:[],targets:[],options:[],available:[],availableSlots:[],pool:[]}})`),'function',`${type} 应有保守动作`);
  if(type!=='wugu'){
    const phase=type==='chengxiangChoose'?'chengxiangAsk':type;
    assert.strictEqual(read(`typeof stageActorField(${JSON.stringify(phase)})`),'string',`${type} 应能解析行动座位`);
  }
}
assert(!game.includes("RESPONSE_PENDING_TYPES.has(result.pending.type)"),'tx 新 pending 补戳不得依赖 type 白名单');
assert(!game.includes('const RESPONSE_PENDING_TYPES'),'不得保留平行的超时阶段白名单');
assert(game.includes('isTimedResponsePending(result,result.pending)'),'tx 写回前应按通用响应者字段补 askedAt');
assert(game.includes('actingSeat===responderAtStart'),'只有当前响应者操作才重置 askedAt');
assert.strictEqual(read("pendingResponderSeat({phase:'futureSkill'},{type:'futureSkill',seat:2})"),2,'新增 pending 应零登记识别 seat');
assert.strictEqual(read("pendingResponderSeat({phase:'futureSkill'},{type:'futureSkill',asking:3,seat:2})"),3,'asking 应优先于通用 seat');
assert.strictEqual(read("typeof autoRespondAction({phase:'futureSkill',turn:2,pending:{type:'futureSkill',seat:2,askedAt:1}})"),'function','新增可取消 pending 应零登记获得默认放弃动作');
assert.strictEqual(read("typeof autoRespondAction({phase:'futureSkill',turn:0,pending:{type:'futureSkill',seat:2,askedAt:1}})"),'object','无安全恢复出口的未知 pending 不得被盲清');
assert(!game.match(/pending\s*=\s*\{\s*type:\s*['\"]sanyaoDamage['\"]/),'sanyaoDamage 只是 resume 类型，不是人工 pending');

console.log(`pending timeout audit tests: ${expected.length*2+6} checks passed (universal responder + safe abandon)`);
