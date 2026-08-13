const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const game=fs.readFileSync('game.js','utf8');
const bus=fs.readFileSync('bot-ai-bus.js','utf8');
const bot=fs.readFileSync('bot.js','utf8');
const setBlock=game.match(/const RESPONSE_PENDING_TYPES = new Set\(\[[\s\S]*?\n\]\);/);
const actionBlock=bus.match(/function autoRespondAction\(g\)\{[\s\S]*?\n\s*return null;\n\}/);
const actorBlock=bot.match(/const BOT_PHASE_ACTOR = \{[\s\S]*?\n\};/);
assert(setBlock&&actionBlock&&actorBlock,'应能定位超时托管三项核心定义');
const ctx=vm.createContext({Math});
vm.runInContext(`${setBlock[0]}\n${actionBlock[0]}\n${actorBlock[0]}`,ctx);
const read=expr=>vm.runInContext(expr,ctx);

const expected=[
  'pick',
  'haoshiPick','leijiChoose','leijiJudge','mengjin','mingcePickTarget','mingceChoice',
  'qiaobianMove','enyuanChoose','jiushiFlipAsk','wangxiAsk','buquAsk','luanwuChoose','wugu',
  'hanbingAsk','jujianPickCard','jushouChoose','shuangxiongAsk','luoyiAsk','xunxunPick','luoshen',
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
  assert.strictEqual(read(`RESPONSE_PENDING_TYPES.has(${JSON.stringify(type)})`),true,`${type} 应登记 askedAt`);
  assert.strictEqual(read(`typeof autoRespondAction({phase:${JSON.stringify(type==='chengxiangChoose'?'chengxiangAsk':type)},pending:{type:${JSON.stringify(type)},cards:[],players:[],candidates:[],targets:[],options:[],available:[],availableSlots:[],pool:[]}})`),'function',`${type} 应有保守动作`);
  if(type!=='wugu'){
    const phase=type==='chengxiangChoose'?'chengxiangAsk':type;
    assert.strictEqual(read(`typeof BOT_PHASE_ACTOR[${JSON.stringify(phase)}]`),'string',`${type} 应能解析行动座位`);
  }
}
assert(game.includes("RESPONSE_PENDING_TYPES.has(result.pending.type)"),'tx 写回前必须统一补 askedAt');
assert(!game.match(/pending\s*=\s*\{\s*type:\s*['\"]sanyaoDamage['\"]/),'sanyaoDamage 只是 resume 类型，不是人工 pending');

console.log(`pending timeout audit tests: ${expected.length*3-1} checks passed (wugu actor uses order[idx])`);
