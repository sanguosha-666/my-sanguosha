const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync('render-controls.js','utf8');
const table=source.match(/const PENDING_RENDERERS = \{[\s\S]*?\r?\n\};/);
const dispatch=source.match(/function renderRegisteredPending\(g,c\)\{[\s\S]*?\r?\n\}/);
const banner=source.match(/function waitAskBanner\(name, skill\)\{[\s\S]*?\r?\n\}/);
const controlsStart=source.indexOf('function renderControls(g){');
const controlsEnd=source.indexOf('function renderZhimengAsk',controlsStart);
const controls=controlsStart>=0&&controlsEnd>controlsStart ? [source.slice(controlsStart,controlsEnd)] : null;
assert(table&&dispatch&&banner&&controls,'应能定位 pending 注册表、分派器和 renderControls');

const migrated=[
  'huashenPick','haoshiPick','jujianPickCard','jujianPickTarget','jujianChooseEffect',
  'jiangchiAsk','luoyingAsk','jiushiFlipAsk','jushouChoose','qiaomengChoose',
  'tieqi','shuangxiongAsk','liegong','qinglong','lianyingAsk','guanshi','shaOffsetChoice',
  'mengjin','yijiAsk','ganglieAsk','luoyiAsk','lirangAsk','lirangRecover','zhengyi',
  'quhuRespond','tianyiRespond','zhibaAsk','jiemingAsk','xinshengAsk','liuli','tianxiang',
  'huashenChangeAskStart','huashenChangePickStart','huashenChangeAskEnd','huashenChangePickEnd',
  'biyue','cixiongAsk','hanbingAsk','xiaoguo','xiaoguoChoice','cixiongChoice','zhijiChoice',
  'luoshen','huogongReveal','guicai','ganglieChoice','yaowu_choose','wangxiAsk',
  'quhuDamageChoice','fanjianSuit','jiedaoChoice','tiaoxinChoice','tiaoxinDiscard',
  'qiaobianTurnStart','qiaobianMove','leijiChoose','leijiJudge','guiduAsk','jijiangAsk','hujiaAsk',
  'lieRenChoose','lieRenPickCard','lieRenRespond','shensuChoose1','shensuChoose2',
  'qiaomengPickEquip','qilin','qiangxiChooseCost','qiangxiChooseWeaponFromHand','qiangxiPickTarget',
  'mingcePickCard','mingcePickTarget','mingcePickTarget2','mingceChoice','luanjiConfirm',
  'yijiAssign','luanwuChoose','hanbing','zhibaGain','yinghunTarget','yinghunChoice',
  'yinghunDiscard','enyuanChoose','enyuanChooseOption','enyuanGiveCard','huanhuoPick',
  'huanhuoPickCard','huanhuoPickGotCard','huanhuoPickSecond','luanjiChoose'
];
migrated.forEach(function(type){
  assert(new RegExp('\\b'+type+'\\s*:\\s*\\{actor:').test(table[0]),type+' 应登记 actor');
  assert(!new RegExp("g\\.phase===['\"]"+type+"['\"]").test(controls[0]),type+' 旧 if 分支应已移除');
});
assert(banner[0].includes('等待其他玩家响应【'),'旁观提示应统一匿名');
assert(!banner[0].includes("escapeHtml(name"),'旁观提示不得再渲染响应者姓名');

let rendered=0;
let shown='';
const context={Number,mySeat:1,setBanner:function(text){shown=text;}};
Array.from(table[0].matchAll(/render:(renderPending[A-Za-z0-9_]+)/g)).forEach(function(match){
  context[match[1]]=function(){rendered++;};
});
vm.createContext(context);
vm.runInContext(banner[0],context);
vm.runInContext(table[0],context);
vm.runInContext(dispatch[0],context);

assert.strictEqual(context.renderRegisteredPending({phase:'haoshiPick',pending:{type:'haoshiPick',seat:1}},{}),true,'本人阶段应由注册表命中');
assert.strictEqual(rendered,1,'本人阶段应调用专用 renderer');
assert.strictEqual(context.renderRegisteredPending({phase:'haoshiPick',pending:{type:'haoshiPick',seat:2}},{}),true,'旁观阶段应由注册表命中');
assert.strictEqual(shown,'等待其他玩家响应【好施】…','旁观阶段应显示匿名技能提示');
assert.strictEqual(context.renderRegisteredPending({phase:'play',pending:{type:'haoshiPick',seat:1}},{}),false,'phase 不匹配不得误分派');

console.log('pending renderer registry tests: 186 checks passed (90 phases migrated)');
