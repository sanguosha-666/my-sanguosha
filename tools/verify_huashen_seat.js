// 「化身」类技能的座位卡验证（左慈等带化身的武将 vs 普通武将对照）。
//
// 【为什么单独一个脚本】这是独立于 standalone/Safari 缩放那条线的缺陷,用户明确要求
// 单独验证、不混进 verify_mobile_landscape.js 的人数×视口矩阵。
//
// 【这里要钉住什么】
//   1. 多出「化身：…」这一行**不能改变卡片尺寸** —— 卡片宽高必须和同一视口下的
//      普通武将完全相同(这是用户报告的主诉:"比其他座位卡明显更宽")。
//   2. 化身行**不能被截断** —— 截掉的尾巴正好是技能名,而技能名是这行最该看的信息。
//   3. 化身行**不能挤压装备区** —— 自己的卡上装备是固定 4 行(空槽也显示"—"),
//      加上化身行一共 5 行内容,必须都在卡内、不溢出。
//
// 【一个必须留意的坑,已经害我测出过假绿】normalize()(game.js)会把不在 huashenPool
// 里的 huashenGeneral 整体清空。构造测试状态时如果只设 huashenGeneral 而漏了
// huashenPool,化身行**根本不会渲染**,所有断言都在一个没有化身行的页面上跑,
// 全绿但什么都没验证到。下面的 setup 两个字段一起设。
const path=require('path'), {chromium}=require('playwright-core');
const ROOT=path.join(__dirname,'..');
const CHROME = process.env.CHROME_PATH
  || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
let pass=0,fail=0;
const P=(m)=>{console.log('  PASS '+m);pass++;}; const F=(m)=>{console.log('  FAIL '+m);fail++;};

// meGen: "我"的武将; hs: 是否带化身; hsGen/hsSkill: 化身成谁、借用什么技能
const setup=(meGen,hs,hsGen,hsSkill)=>`
  mySeat=0; roomId='666';
  const names=['我自己','夏侯渊','凌统','机器人4','曹操','徐晃','华佗','华雄'];
  const gens=['${meGen}','xiahouyuan','lingtong','caocao','xuhuang','huatuo','huaxiong','dianwei'];
  const eq={weapon:{id:1,name:'贯石斧',suit:'spade',rank:5},armor:{id:2,name:'八卦阵',suit:'club',rank:5},plus1:null,minus1:null};
  currentG={ players: names.map((nm,i)=>({
      name:nm, seat:i, hp:3, maxHp:4, alive:true, general:gens[i],
      huashenGeneral: (i===0 && ${hs?'true':'false'})?'${hsGen}':null,
      huashenPool:    (i===0 && ${hs?'true':'false'})?['${hsGen}']:[],
      huashenSkillName:(i===0 && ${hs?'true':'false'})?'${hsSkill}':null,
      hand:Array(4).fill({id:1,name:'杀',suit:'spade',rank:5}),
      equips:eq, delays:[], role:'unknown', faction:'qun' })),
    phase:'play', turn:0, deck:[], discard:[], log:[], started:true, gameMode:'identity' };
  render(currentG);
`;

const probe = `(() => {
  const me=document.querySelector('#meSeat .seat');
  if(!me) return {err:'找不到 #meSeat .seat'};
  const mr=me.getBoundingClientRect();
  const hs=me.querySelector('.seat-huashen-line');
  const bot=me.querySelector('.seat-bottom');
  const br=bot?bot.getBoundingClientRect():null;
  const er=[...me.querySelectorAll('.seat-equip-bar .erow')];
  return {
    w:Math.round(mr.width), h:Math.round(mr.height),
    hasHs:!!hs,
    hsClipped: hs ? (hs.scrollWidth > hs.clientWidth+1) : null,
    hsText: hs ? hs.textContent.trim() : '',
    hsW: hs ? Math.round(hs.getBoundingClientRect().width) : 0,
    botH: br?Math.round(br.height):0,
    botOverflow: br?Math.max(0,Math.round(br.bottom-mr.bottom)):0,
    eqRows: er.length,
    eqClipped: er.filter(e=>e.scrollWidth>e.clientWidth+1).length,
  };
})()`;

async function shot(b, vw, vh, meGen, hs, hsGen, hsSkill){
  const ctx=await b.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  const p=await ctx.newPage();
  await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(180);
  await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');`);
  await p.evaluate(setup(meGen,hs,hsGen,hsSkill));
  await p.waitForTimeout(380);
  const m=await p.evaluate(probe);
  await ctx.close(); return m;
}

(async()=>{
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});
// 真机实测的两个 layout viewport:Safari 852x303、从主屏启动 852x393。
// 再加最矮的横屏样本 667x375,以及 2 人局(卡最宽)做另一端。
const VPS=[[852,393,'standalone'],[852,303,'Safari'],[667,375,'SE横屏']];
// 化身对象取最刁钻:武将名最长的之一(司马懿 3 字)+ 技能名 2 字
const CASES=[['yuji','蛊惑','于吉·蛊惑'],['simayi','鬼才','司马懿·鬼才']];

for(const [vw,vh,mode] of VPS){
  console.log('\n■ '+mode+' '+vw+'x'+vh);
  const base=await shot(b,vw,vh,'xiaoqiao',false);
  console.log('    对照(普通武将 小乔):'+base.w+'x'+base.h+' 装备'+base.eqRows+'行 seat-bottom '+base.botH+'px');
  for(const [hsGen,hsSkill,label] of CASES){
    const m=await shot(b,vw,vh,'zuoci',true,hsGen,hsSkill);
    // ① 尺寸不因多一行技能提示而改变
    (m.w===base.w && m.h===base.h)
      ? P(mode+' / '+label+':卡片尺寸与普通武将一致 ('+m.w+'x'+m.h+')')
      : F(mode+' / '+label+':卡片尺寸被撑变了 '+m.w+'x'+m.h+' vs 普通武将 '+base.w+'x'+base.h);
    // ② 化身行必须真的渲染出来了(防 huashenPool 漏设导致的假绿)
    m.hasHs ? P(mode+' / '+label+':化身行已渲染 "'+m.hsText+'"')
            : F(mode+' / '+label+':化身行没渲染!(检查 huashenPool 是否漏设)');
    // ③ 不截断
    m.hsClipped===false
      ? P(mode+' / '+label+':化身行未被截断 (宽 '+m.hsW+'px)')
      : F(mode+' / '+label+':化身行被截断,丢的正是技能名 (宽 '+m.hsW+'px)');
    // ④ 不挤压装备区:装备行数与普通武将相同、且都不截断、整体不溢出卡片
    (m.eqRows===base.eqRows && m.eqClipped<=base.eqClipped)
      ? P(mode+' / '+label+':装备区未被挤压 ('+m.eqRows+'行,截断'+m.eqClipped+'≤对照'+base.eqClipped+')')
      : F(mode+' / '+label+':装备区被挤压 '+m.eqRows+'行/截断'+m.eqClipped
          +',对照 '+base.eqRows+'行/截断'+base.eqClipped);
    m.botOverflow===0
      ? P(mode+' / '+label+':底部内容未溢出卡片 (seat-bottom '+m.botH+'px)')
      : F(mode+' / '+label+':底部内容溢出卡片 '+m.botOverflow+'px');
  }
}
await b.close();
console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
})();
