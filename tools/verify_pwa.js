// PWA 支持的验证:能力检测 / 引导条显隐 / standalone 下 landscapeGate 是否误触发。
// display-mode 用 CDP 的 Emulation.setEmulatedMedia 模拟 —— Playwright 的 emulateMedia()
// 不支持 display-mode 特性,只能走 CDP。
const path=require('path'), {chromium}=require('playwright-core');
const ROOT=path.join(__dirname,'..');
const CHROME = process.env.CHROME_PATH
  || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
// 8人局 / 最长武将名「颜良文丑」/ 装备槽全满 —— 和 verify_mobile_landscape.js 用的是
// 同一组刁钻样本。**下面的空白断言会先确认 render 真的生效(内容元素总高 > 0)**,
// 否则元素高度全是 0 时空白也会算成 0,又是一条假绿。
const mkSetup=(n)=>`
  mySeat = 0; roomId = '666';
  currentG = {
    players: Array.from({length:${n}}, (_,i)=>({
      name:'玩家'+i, seat:i, hp:3, maxHp:4, alive:true,
      general: i===0?'zuoci':'yanliangwenchou',
      hand: Array(4).fill({id:1,name:'杀',suit:'spade',rank:5}),
      equips:{ weapon:{id:1,name:'青龙偃月刀',suit:'spade',rank:5},
               armor:{id:2,name:'八卦阵',suit:'club',rank:5},
               plus1:{id:3,name:'的卢',suit:'heart',rank:5},
               minus1:{id:4,name:'赤兔',suit:'diamond',rank:5} },
      delays:[], role: i===0?'zhu':'unknown', faction:'qun'
    })),
    phase:'play', turn:0, deck:[], discard:[], log:[], started:true, gameMode:'identity'
  };
  render(currentG);
`;
let pass=0,fail=0;
const P=(m)=>{console.log('  PASS '+m);pass++;}; const F=(m)=>{console.log('  FAIL '+m);fail++;};

async function open(b, vp, {displayMode=null, standaloneProp=false, inGame=true}={}){
  const ctx=await b.newContext({viewport:{width:vp.w,height:vp.h},hasTouch:!!vp.touch,isMobile:!!vp.touch,deviceScaleFactor:1});
  const p=await ctx.newPage();
  if(standaloneProp){
    // iOS Safari 的私有属性,Chromium 没有 —— 注入以验证我们的检测确实读了它
    await p.addInitScript(()=>{ Object.defineProperty(navigator,'standalone',{value:true,configurable:true}); });
  }
  if(displayMode){
    // 【为什么是 stub 而不是真模拟】CDP 的 Emulation.setEmulatedMedia 对 display-mode 特性
    // 在这个 Chromium 版本上**完全不生效**(实测 features-only / 带 media / goto 之后设置
    // 三种写法都拿到 browser=true);真正能触发 standalone 的 --app= 启动参数需要 headed
    // 模式,本机没有 xvfb。所以改成覆写 matchMedia。
    // **这几条断言验的是"我的检测逻辑在给定 display-mode 下是否正确响应",不是"浏览器
    //   会不会因为 manifest 而进入该 display-mode"** —— 后者只能真机验证。
    await p.addInitScript((mode)=>{
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        const m = /\(display-mode:\s*([a-z-]+)\)/.exec(q);
        // MediaQueryList.matches 只有 getter,不能 Object.assign 覆盖 —— 返回一个
        // 结构相同的替身对象(pwaIsStandalone 只读 .matches)。
        if(m) return {matches: m[1]===mode, media:q,
                      addEventListener(){}, removeEventListener(){},
                      addListener(){}, removeListener(){}};
        return orig(q);
      };
    }, displayMode);
  }
  await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(250);
  if(inGame) await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');`);
  await p.evaluate(`if(typeof pwaInit==='function') pwaInit(); if(typeof checkLandscapeGate==='function') checkLandscapeGate();`);
  await p.waitForTimeout(120);
  return {ctx,p};
}
const probe = (p) => p.evaluate(()=>({
  standalone: pwaIsStandalone(), mobile: pwaIsMobile(),
  fsSupported: pwaFullscreenSupported(),
  btnHidden: document.getElementById('fullscreenBtn').classList.contains('hidden'),
  hintHidden: document.getElementById('pwaHint').classList.contains('hidden'),
  hintText: (document.querySelector('#pwaHint .pwa-hint-text')||{}).textContent||'',
  gateHidden: document.getElementById('landscapeGate').classList.contains('hidden'),
  vh: innerHeight, vw: innerWidth,
  docH: document.documentElement.scrollHeight,
}));

(async()=>{
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});

console.log('\n■ manifest.json 内容');
{
  const m=require(path.join(ROOT,'manifest.json'));
  m.display==='fullscreen' ? P('display=fullscreen') : F('display='+m.display);
  m.orientation==='landscape' ? P('orientation=landscape') : F('orientation='+m.orientation);
  (m.name&&m.short_name) ? P('name/short_name 齐备: '+m.name+' / '+m.short_name) : F('name/short_name 缺失');
  (m.background_color&&m.theme_color) ? P('background_color/theme_color 齐备: '+m.background_color+' / '+m.theme_color) : F('颜色字段缺失');
  const sizes=[...new Set(m.icons.map(i=>i.sizes))];
  (sizes.includes('192x192')&&sizes.includes('512x512')) ? P('图标含 192 与 512 两档: '+sizes.join(',')) : F('图标档位不全: '+sizes.join(','));
  const fs=require('fs');
  m.icons.forEach(i=>{ fs.existsSync(path.join(ROOT,i.src)) ? 0 : F('图标文件缺失: '+i.src); });
  P('全部图标文件存在');
  // 【为什么还要查 git 跟踪状态】"文件在本地存在"不等于"文件会被部署上去"。
  // 真实踩过:图标最初放在仓库根,而 .gitignore 有一条忽略根目录 png 的规则,
  // `git add -A` 把它们**静默跳过**(不报错、git status 也不显示),于是提交里根本没有图标,
  // 线上 manifest 引用的路径全是 404 —— 而这条只查文件系统的断言当时是绿的。
  // 这类"文件进不了库"的失败没有任何提示,比误提交更难发现,必须由断言兜住。
  {
    const {execSync}=require('child_process');
    const tracked=new Set(execSync('git ls-files',{cwd:ROOT}).toString().split('\n'));
    const missing=[...new Set(m.icons.map(i=>i.src))].filter(src=>!tracked.has(src));
    missing.length===0
      ? P('全部图标已被 git 跟踪(会真正部署到线上)')
      : F('图标存在于本地但未被 git 跟踪(线上会 404): '+missing.join(', ')
          +' —— 多半是被 .gitignore 静默忽略了,用 `git check-ignore -v <路径>` 查');
  }
}

console.log('\n■ <head> 的 PWA 标签');
{
  const html=require('fs').readFileSync(path.join(ROOT,'index.html'),'utf8').slice(0,4000);
  const need=[['<link rel="manifest"','manifest link'],
    ['apple-mobile-web-app-capable','apple-mobile-web-app-capable'],
    ['apple-mobile-web-app-status-bar-style','status-bar-style'],
    ['rel="apple-touch-icon"','apple-touch-icon'],
    ['name="theme-color"','theme-color']];
  need.forEach(([k,label])=> html.includes(k)?P('<head> 含 '+label):F('<head> 缺 '+label));
}

console.log('\n■ 全屏按钮的能力检测(不支持的平台必须不显示,而不是显示了点了没反应)');
{
  const {ctx,p}=await open(b,{w:844,h:390,touch:true});
  const r=await probe(p);
  r.fsSupported ? P('Chromium(模拟 Android):Fullscreen API 可用 → 按钮显示='+(!r.btnHidden)) : F('Chromium 竟报告不支持 Fullscreen API');
  !r.btnHidden ? P('支持的平台:全屏按钮显示') : F('支持的平台:全屏按钮却被隐藏');
  await ctx.close();
}
{ // 模拟 iPhone Safari:删掉 requestFullscreen 系列
  const ctx=await b.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  const p=await ctx.newPage();
  await p.addInitScript(()=>{
    delete Element.prototype.requestFullscreen;
    delete Element.prototype.webkitRequestFullscreen;
    Object.defineProperty(document,'fullscreenEnabled',{value:undefined,configurable:true});
  });
  await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(250);
  await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');pwaInit();`);
  const r=await probe(p);
  !r.fsSupported ? P('模拟 iPhone Safari(无 requestFullscreen):检测为不支持') : F('模拟 iPhone Safari 仍报告支持!');
  r.btnHidden ? P('模拟 iPhone Safari:全屏按钮已隐藏') : F('模拟 iPhone Safari:全屏按钮仍显示(会点了没反应)');
  await ctx.close();
}
{ // 已从主屏启动:按钮是噪音,应隐藏
  const {ctx,p}=await open(b,{w:844,h:390,touch:true},{displayMode:'fullscreen'});
  const r=await probe(p);
  r.standalone ? P('display-mode:fullscreen → pwaIsStandalone()=true') : F('display-mode:fullscreen 未被识别为 standalone');
  r.btnHidden ? P('standalone 下全屏按钮已隐藏(地址栏本就没了)') : F('standalone 下仍显示全屏按钮');
  await ctx.close();
}
{ // iOS 的 navigator.standalone
  const {ctx,p}=await open(b,{w:844,h:390,touch:true},{standaloneProp:true});
  const r=await probe(p);
  r.standalone ? P('navigator.standalone=true(iOS 路径)→ 被识别为 standalone') : F('navigator.standalone 未被识别');
  await ctx.close();
}

console.log('\n■ 首次访问引导提示');
{
  const {ctx,p}=await open(b,{w:844,h:390,touch:true});
  let r=await probe(p);
  !r.hintHidden ? P('移动端 + 非 standalone + 未关闭 → 引导条显示') : F('引导条未显示');
  /添加到主屏幕/.test(r.hintText) ? P('引导文案: '+r.hintText) : F('引导文案异常: '+r.hintText);
  await p.evaluate(`pwaDismissHint()`);
  r=await probe(p);
  r.hintHidden ? P('点关闭后立即隐藏') : F('点关闭后仍显示');
  const stored=await p.evaluate(()=>localStorage.getItem('sgs_pwa_hint_dismissed'));
  stored==='1' ? P('已写入 localStorage(sgs_pwa_hint_dismissed=1)') : F('localStorage 未写入: '+stored);
  // 同 context 重新加载 = 模拟"下次再来"
  await p.reload(); await p.waitForTimeout(250);
  await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');pwaInit();`);
  r=await probe(p);
  r.hintHidden ? P('重新加载后仍不出现(永久关闭生效)') : F('重新加载后又出现了(localStorage 没起作用)');
  await ctx.close();
}
{
  const {ctx,p}=await open(b,{w:844,h:390,touch:true},{displayMode:'fullscreen'});
  const r=await probe(p);
  r.hintHidden ? P('standalone 下不再劝装(引导条隐藏)') : F('standalone 下仍显示引导条');
  await ctx.close();
}
{
  const {ctx,p}=await open(b,{w:1440,h:900,touch:false});
  const r=await probe(p);
  !r.mobile ? P('桌面:pwaIsMobile()=false') : F('桌面被判为移动端');
  r.hintHidden ? P('桌面不显示引导条') : F('桌面显示了引导条');
  await ctx.close();
}

console.log('\n■ 真机环境诊断入口(pwaDiagnostics)');
{
  // 【为什么这里只验"入口可用"】"主屏冷启动画面被放大"只在真机 standalone 下复现,
  // Playwright 里既没有 iOS 的 viewport 行为、也没有系统状态保留,**测不出那个现象**。
  // 所以这里只保证:诊断函数不报错、把判断所需的关键量都列出来了、并且真的接进了
  // ? 帮助弹窗(手机上唯一随时可点、不依赖房间的入口)。数值本身要靠用户真机读。
  const {ctx,p}=await open(b,{w:844,h:390,touch:true});
  await p.evaluate(mkSetup(8));
  await p.waitForTimeout(200);
  const d=await p.evaluate(()=>pwaDiagnostics());
  const need=['运行形态','window.inner','layoutViewport(documentElement.client)','visualViewport',
              'screen','viewport meta','关键断点','手牌卡计算值','对手座位卡实测'];
  const miss=need.filter(k=>!(k in d));
  miss.length===0 ? P('诊断项齐备('+Object.keys(d).length+' 项)') : F('诊断缺少: '+miss.join(','));
  /scale=1\.000/.test(d['visualViewport']) ? P('visualViewport 可读: '+d['visualViewport'])
                                           : F('visualViewport 读数异常: '+d['visualViewport']);
  /\d+ × \d+/.test(d['对手座位卡实测']) ? P('座位卡实测可读: '+d['对手座位卡实测'])
                                        : F('座位卡实测不可读: '+d['对手座位卡实测']);
  const inHelp=await p.evaluate(()=>{ showHelp();
    const t=(document.getElementById('infoModal')||document.body).textContent||'';
    return t.indexOf('环境诊断')>=0 && t.indexOf('visualViewport')>=0; });
  inHelp ? P('诊断已出现在 ? 帮助弹窗里(真机可读)') : F('诊断未接入帮助弹窗');
  await ctx.close();
}
{
  // pwaResetZoom 已移除(假设被真机推翻),确认不再有残留引用
  const {ctx,p}=await open(b,{w:844,h:390,touch:true},{displayMode:'fullscreen'});
  const gone=await p.evaluate(()=>typeof pwaResetZoom==='undefined');
  const vp=await p.evaluate(()=>document.querySelector('meta[name="viewport"]').getAttribute('content'));
  gone ? P('pwaResetZoom 已移除(基于已被真机推翻的假设)') : F('pwaResetZoom 仍存在');
  !/maximum-scale|user-scalable/.test(vp) ? P('viewport 未被任何代码改动: '+vp)
                                          : F('viewport 仍被改动: '+vp);
  await ctx.close();
}

console.log('\n■ 与 landscapeGate 的关系(用户点名要实测)');
{
  const {ctx,p}=await open(b,{w:844,h:390,touch:true},{displayMode:'fullscreen'});
  const r=await probe(p);
  r.gateHidden ? P('standalone + 横屏:gate 未误触发') : F('standalone + 横屏:gate 误触发了!');
  await ctx.close();
}
{ // standalone 但竖屏(iOS 不支持 manifest 的 orientation 锁定,这个组合真实存在)
  const {ctx,p}=await open(b,{w:390,h:844,touch:true},{displayMode:'fullscreen'});
  const r=await probe(p);
  !r.gateHidden ? P('standalone + 竖屏(iOS 无方向锁):gate 仍正确拦截 —— 这是期望行为,不是 bug')
                : F('standalone + 竖屏:gate 被 PWA 意外放行了');
  await ctx.close();
}
{ // 大厅阶段不该拦(CORE-119 的既有行为不能被 PWA 改动破坏)
  const {ctx,p}=await open(b,{w:390,h:844,touch:true},{displayMode:'fullscreen',inGame:false});
  const r=await probe(p);
  r.gateHidden ? P('standalone + 竖屏 + 大厅:仍放行(CORE-119 行为未被破坏)') : F('大厅阶段被拦截了');
  await ctx.close();
}

console.log('\n■ 视口变高后横屏布局是否出现新空白/错位');
{
  // 之前的空白压缩是按 390px 调的。standalone 去掉地址栏后视口会变高,这里把高度往上推,
  // 检查(a)是否出现纵向溢出 (b)是否出现大片空白。
  for(const h of [390, 414, 430, 446]){
    const {ctx,p}=await open(b,{w:844,h,touch:true});
    await p.evaluate(mkSetup(8));
    await p.evaluate(`document.querySelectorAll('.my-turn-banner').forEach(e=>e.classList.remove('show'));`);
    await p.waitForTimeout(300);
    const m=await p.evaluate(()=>{
      const docH=document.documentElement.scrollHeight;
      // 逐行扫描"整行都是背景色"的像素带,量真实视觉空白(不是容器 margin)
      // 【必须排除装饰层】#game 的直接子元素里有 gameBgCanvas / deathFxVideo /
      // lightningFxVideo / movieFxVideo 四个**绝对定位、覆盖整个视口高度**的背景层
      // (实测 rect=0~446)。第一版没排除它们,prev 一上来就被推到视口底部,于是
      // **gap 恒为 0、四档视口全报 0.0%** —— 一条永远绿的断言(CLAUDE.md 规则 20)。
      // 空白要量的是"内容元素之间的空隙",背景层不是内容。
      const els=[...document.querySelectorAll('#game > *')].filter(e=>{
        if(e.classList.contains('hidden')) return false;
        const cs=getComputedStyle(e);
        if(cs.position==='absolute'||cs.position==='fixed') return false;
        if(cs.display==='none'||cs.visibility==='hidden') return false;
        return true;
      });
      const bands=els.map(e=>{const r=e.getBoundingClientRect();return {t:r.top,b:r.bottom,c:e.className||e.id};})
        .filter(x=>x.b>x.t).sort((a,b)=>a.t-b.t);
      let gaps=[], prev=0;
      bands.forEach(x=>{ if(x.t-prev>6) gaps.push({from:Math.round(prev),to:Math.round(x.t),h:Math.round(x.t-prev)}); prev=Math.max(prev,x.b); });
      if(innerHeight-prev>6) gaps.push({from:Math.round(prev),to:innerHeight,h:Math.round(innerHeight-prev)});
      const contentH = bands.reduce((t,x)=>t+(x.b-x.t), 0);
      return {docH, vh:innerHeight, gaps, totalGap:gaps.reduce((s,g)=>s+g.h,0),
              contentH:Math.round(contentH), nEls:els.length,
              seatH: Math.round((document.querySelector('#oppRow .seat')||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height)};
    });
    // 【先证明 render 真的生效】元素高度全是 0 的话空白也会算成 0,那是假绿不是通过。
    (m.contentH > m.vh*0.5 && m.seatH > 20)
      ? P('视口 844x'+h+':render 已生效(内容总高 '+m.contentH+'px, 座位卡高 '+m.seatH+'px)')
      : F('视口 844x'+h+':render 未生效!内容总高 '+m.contentH+'px 座位卡高 '+m.seatH+'px —— 空白断言不可信');
    const overflow = m.docH - m.vh;
    const pct = (m.totalGap/m.vh*100).toFixed(1);
    (overflow<=1) ? P('视口 844x'+h+':无纵向溢出 ('+m.docH+'/'+m.vh+')')
                  : F('视口 844x'+h+':纵向溢出 '+overflow+'px');
    (m.totalGap <= m.vh*0.20)
      ? P('视口 844x'+h+':空白 '+m.totalGap+'px = '+pct+'% ≤20%'+(m.gaps.length?' '+JSON.stringify(m.gaps):''))
      : F('视口 844x'+h+':空白 '+m.totalGap+'px = '+pct+'% >20% '+JSON.stringify(m.gaps));
    await ctx.close();
  }
}

await b.close();
console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
process.exit(fail?1:0);
})();
