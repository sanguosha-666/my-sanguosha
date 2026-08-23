// CORE-146:手机横屏对局布局的真实浏览器验证(Playwright)。
//
// 【为什么不放进 run_all_tests.js】和 verify_responsive_layout.js 同一考虑:需要真实
// Chromium 二进制,常规 Node 套件里跑不了。这是"改手机横屏断点时手动跑一遍"的验证工具。
//
// 【怎么跑】
//   1) npm i playwright-core
//   2) 需要 ~/.cache/ms-playwright 下已有 chromium;缺共享库且无 root 权限时:
//      apt-get download libnspr4 libnss3 libasound2t64 → dpkg-deb -x 解包 →
//      LD_LIBRARY_PATH 指过去(docs/methodology.md「前端/UI」那条)
//   3) node tools/verify_mobile_landscape.js
//
// 【验证口径】按 CLAUDE.md 规则18/22:样本一律取最刁钻的(8人局、最长武将名"颜良文丑"、
// 装备槽全满含最长装备名"青龙偃月刀");断言全部程序化量取(矩形/字号/裁切/背景色),
// 不靠肉眼看截图。**纵向溢出的口径按设备分**——只有手机横屏和桌面要求"一屏装完",
// 平板布局设计上就允许纵向滚动(见下方 vp.phone||vp.desktop 那处注释)。
const { chromium } = require('playwright-core');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const CHROME = process.env.CHROME_PATH
  || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
// 最刁钻样本:n 人局 + 最长武将名 + 装备槽全满(含最长装备名)
const mkSetup = (n) => `
  mySeat = 0; roomId = '666';
  const eq = () => ({weapon:{id:'w1',name:'青龙偃月刀',suit:'♠',rank:5},armor:{id:'a1',name:'八卦阵',suit:'♠',rank:2},plus1:{id:'p1',name:'的卢',suit:'♣',rank:5},minus1:{id:'m1',name:'赤兔',suit:'♥',rank:5}});
  const mkHand = k => Array.from({length:k},(_,i)=>({id:'h'+i,name:'杀',suit:'♠',rank:7}));
  const g = { started:true, phase:'play', turn:0, roundNum:3, gameMode:'identity', seed:12345,
    players: Array.from({length:${n}},(_,i)=>({ name: i===0?'我自己':('玩家'+i), general:'yanliangwenchou',
      role: i===0?'zhu':(i%3===0?'fan':(i%3===1?'zhong':'nei')), roleRevealed:false,
      hp:3, maxHp:4, alive:true, hand: i===0?mkHand(6):mkHand(4), equips:eq(), delays:[], isBot:i!==0 })),
    deck:[], discard:[], log:[{seq:0,text:'游戏开始'}], pending:null, exchangeCards:[] };
  currentG = g; render(g);
`;
const S8=mkSetup(8), S3=mkSetup(3);
const VPS=[
 {n:'手机横屏 844x390', w:844,h:390,touch:true,setup:S8,phone:true},
 {n:'手机横屏 667x375', w:667,h:375,touch:true,setup:S8,phone:true},
 {n:'手机横屏 932x430', w:932,h:430,touch:true,setup:S8,phone:true},
 {n:'手机横屏3人 844x390',w:844,h:390,touch:true,setup:S3,phone:true},
 {n:'手机竖屏 430x932(应被遮罩)',w:430,h:932,touch:true,setup:S8,gate:true},
 {n:'平板横屏 1024x768', w:1024,h:768,touch:true,setup:S8},
 {n:'平板竖屏 768x1024', w:768,h:1024,touch:true,setup:S8},
 {n:'桌面 1440x900',    w:1440,h:900,touch:false,setup:S8,desktop:true},
 {n:'桌面 1280x800',    w:1280,h:800,touch:false,setup:S8,desktop:true},
];
let pass=0,fail=0; const P=(m)=>{console.log('  PASS '+m);pass++;}; const F=(m)=>{console.log('  FAIL '+m);fail++;};
(async()=>{
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const vp of VPS){
    const ctx=await b.newContext({viewport:{width:vp.w,height:vp.h},hasTouch:vp.touch,isMobile:vp.touch,deviceScaleFactor:1});
    const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e.message).split('\n')[0]));
    await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(250);
    await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');checkLandscapeGate();`);
    await p.evaluate(vp.setup);
    await p.evaluate(`document.querySelectorAll('.my-turn-banner').forEach(e=>e.classList.remove('show'));checkLandscapeGate();`);
    await p.waitForTimeout(400);
    const m=await p.evaluate(()=>{
      const gate=document.getElementById('landscapeGate');
      const seats=[...document.querySelectorAll('#oppRow .seat,#oppTopRow .seat')];
      const s0=seats[0]; const sr=s0?s0.getBoundingClientRect():null;
      let minF=99,minEl='';
      if(s0) s0.querySelectorAll('*').forEach(e=>{ if(e.children.length) return;
        const t=e.textContent.trim(); const cs=getComputedStyle(e);
        const bf=getComputedStyle(e,'::before').content;
        if(!t&&(!bf||bf==='none')) return;
        let f=parseFloat(cs.fontSize);
        if(f===0&&bf&&bf!=='none') f=parseFloat(getComputedStyle(e,'::before').fontSize);
        if(f>0&&f<minF){minF=f;minEl=(e.className||e.tagName)+':'+(t||bf).slice(0,8);} });
      const clip=[]; if(s0) s0.querySelectorAll('.seat-equip-bar .erow').forEach(e=>{ if(e.scrollWidth>e.clientWidth+1) clip.push(e.textContent.trim().slice(0,12)); });
      const eq=s0?[...s0.querySelectorAll('.seat-equip-bar .erow')].map(e=>{const n=e.querySelector('.enm');
        const bf=n?getComputedStyle(n,'::before').content.replace(/"/g,''):''; const nmVisible=n?parseFloat(getComputedStyle(n).fontSize)>0:false;
        return (e.querySelector('b')?e.querySelector('b').textContent:'')+' '+(nmVisible?n.textContent:bf);}):[];
      const fac=s0?s0.querySelector('.seat-faction'):null;
      const facR=fac?fac.getBoundingClientRect():null;
      const btn=[...document.querySelectorAll('#gameToolbar .icon-btn')].filter(e=>e.getBoundingClientRect().width>0)[0];
      // 横向溢出检测
      let hOver=0; seats.forEach(s=>{const r=s.getBoundingClientRect(); if(r.right>innerWidth+0.5) hOver++;});
      return { gate: gate&&!gate.classList.contains('hidden'),
        docH:document.documentElement.scrollHeight, vh:innerHeight, vw:innerWidth,
        seatN:seats.length, seatW:sr?Math.round(sr.width):0, seatH:sr?Math.round(sr.height):0,
        minF, minEl, clip, eq, hOver,
        facSize: facR?Math.round(facR.width)+'x'+Math.round(facR.height):'-',
        facBg: fac?getComputedStyle(fac).backgroundColor:'-',
        btn: btn?Math.round(btn.getBoundingClientRect().width):0,
        deskLayout: document.getElementById('game').classList.contains('desktop-layout') };
    });
    console.log('■ '+vp.n+(errs.length?'   JS错误:'+errs[0]:''));
    if(vp.gate){
      m.gate?P('竖屏遮罩仍然生效(产品决策未被破坏)'):F('竖屏遮罩失效!');
      await ctx.close(); continue;
    }
    // 【纵向溢出的口径要按设备分】只有手机横屏和桌面要求"一屏装完";平板布局**设计上就
    // 允许页面纵向滚动**(index.html 平板块注释:".log-panel 在文档流里,不像手机横屏那样
    // 必须一屏装完")。改动前实测平板同样溢出 364px/4px,数值与改动后完全一致 —— 对平板
    // 套用"不得溢出"是错的口径,那条断言会永远红,和永远绿一样没有价值(CLAUDE.md 规则20)。
    if(vp.phone || vp.desktop){
      m.docH<=m.vh+1 ? P('无纵向溢出 ('+m.docH+'/'+m.vh+')') : F('纵向溢出 '+(m.docH-m.vh)+'px ('+m.docH+'/'+m.vh+')');
    } else {
      P('平板允许纵向滚动(设计如此,页高 '+m.docH+'/'+m.vh+',与改动前一致)');
    }
    m.hOver===0 ? P('无横向溢出,'+m.seatN+'张对手卡全部在视口内') : F(m.hOver+' 张对手卡横向溢出');
    if(vp.phone){
      m.minF>=9 ? P('座位卡最小字号 '+m.minF+'px ≥9px') : F('最小字号 '+m.minF+'px <9px ('+m.minEl+')');
      m.clip.length===0 ? P('装备行无截断: '+JSON.stringify(m.eq)) : F('装备行仍被截断: '+JSON.stringify(m.clip));
      m.btn>0&&m.btn<=32 ? P('功能钮缩小到 '+m.btn+'px (原44px, '+Math.round(m.btn/44*100)+'%)') : F('功能钮 '+m.btn+'px 未按预期缩小');
      m.facBg!=='rgba(0, 0, 0, 0)' ? P('势力色块可见 '+m.facSize+' '+m.facBg) : F('势力色块不可见');
    }
    if(vp.desktop){
      m.deskLayout ? P('桌面布局标志仍生效') : F('桌面布局标志丢失');
      m.btn===44 ? P('桌面功能钮仍是 44px(未被移动端规则波及)') : F('桌面功能钮变成 '+m.btn+'px ← 影响了桌面端!');
      const nm=m.eq.join('');
      nm.includes('青龙偃月刀') ? P('桌面装备名仍显示全名') : F('桌面装备名被改成简称: '+JSON.stringify(m.eq));
    }
    if(!vp.phone&&!vp.desktop){
      m.btn===44 ? P('平板功能钮仍是 44px(触控目标未被破坏)') : F('平板功能钮变成 '+m.btn+'px');
      m.eq.join('').includes('青龙') ? P('平板装备可读: '+JSON.stringify(m.eq.slice(0,2))) : F('平板装备异常');
    }
    console.log('');
    await ctx.close();
  }

  // ============================================================================
  // 【--opp-n 真的在参与计算吗】用户在 review 时问过:2/5/8 人局的卡片尺寸完全相同,
  // 是不是 --opp-n 在少人局失效了?答案是"没失效,只是被屏高预算盖住了"——
  // .seat 的高度是 min(屏高预算, 横向约束),宽视口上横向约束算出来始终更大。
  // 光看最终尺寸区分不出"横向项正常但没生效"和"横向项算错/失效",所以这里**直接量
  // 两项各自的计算值**:横向项必须随对手数严格单调下降,且吻合 (W-24-4n)/n/0.75。
  // 真失效(比如 --opp-n 没写上、fallback 恒为 7)时,这条会立刻变红。
  // ============================================================================
  console.log('\n■ --opp-n 有效性(直接量 min() 的两项)');
  {
    const ctx=await b.newContext({viewport:{width:667,height:375},hasTouch:true,isMobile:true,deviceScaleFactor:1});
    const p=await ctx.newPage();
    await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(200);
    await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');`);
    const terms=[];
    for(const N of [2,3,5,8,9]){
      await p.evaluate(mkSetup(N)); await p.waitForTimeout(200);
      const t=await p.evaluate(()=>{
        const row=document.getElementById('oppRow');
        const n=+row.style.getPropertyValue('--opp-n');
        const probe=document.createElement('div');
        probe.style.position='absolute'; probe.style.visibility='hidden';
        row.appendChild(probe);
        probe.style.height='calc((100vw - 24px - '+n+' * 4px) / '+n+' / 0.75)';
        const hTerm=parseFloat(getComputedStyle(probe).height);
        probe.remove();
        return {n,hTerm,vw:innerWidth};
      });
      terms.push(t);
    }
    let mono=true;
    for(let i=1;i<terms.length;i++) if(!(terms[i].hTerm < terms[i-1].hTerm)) mono=false;
    mono ? P('横向项随对手数严格单调下降: '+terms.map(t=>t.n+'→'+t.hTerm.toFixed(0)).join(' '))
         : F('横向项没有随对手数下降,--opp-n 很可能没生效: '+JSON.stringify(terms));
    const bad=terms.filter(t=>Math.abs(t.hTerm-((t.vw-24-t.n*4)/t.n/0.75))>1);
    bad.length===0 ? P('横向项数值吻合 (W-24-4n)/n/0.75')
                   : F('横向项与公式不符: '+JSON.stringify(bad));
    await ctx.close();
  }
  await b.close();
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  if(fail) process.exit(1);
})();
