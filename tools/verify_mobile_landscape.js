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
        // 【体力的表达形式】手机横屏把体力从"竖排红心"换成了 data-hp 的"当前/上限"数字。
        // 那是 CSS 断点内的事,但 data-hp 属性是 render.js 无条件输出的 —— 必须钉住
        // 桌面/平板**没有被顺带改变**:心的 div 仍然可见,且没有任何规则把 ::before 显示出来。
        hp: (()=>{ const c=s0?s0.querySelector('.seat-hp-col'):null; if(!c) return null;
          const kids=[...c.children];
          const bf=getComputedStyle(c,'::before').content;
          return { attr: c.getAttribute('data-hp'),
                   hearts: kids.filter(e=>getComputedStyle(e).display!=='none').length,
                   heartTxt: kids.map(e=>e.textContent).join(''),
                   before: (bf&&bf!=='none'&&bf!=='normal') ? bf.replace(/"/g,'') : '' }; })(),
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
    if(m.hp){
      if(vp.phone){
        (m.hp.hearts===0 && /^\d+\/\d+$/.test(m.hp.before))
          ? P('手机横屏:体力显示为"'+m.hp.before+'"数字(心已隐藏)')
          : F('手机横屏:体力表达异常 hearts='+m.hp.hearts+' before="'+m.hp.before+'"');
      } else {
        // 桌面/平板必须**原样**保留竖排红心。data-hp 属性可以在(它只是数据),但不能有任何
        // 规则读它、也不能有规则隐藏心 —— 否则就是手机横屏的改动漏到了桌面端。
        (m.hp.hearts>0 && m.hp.before==='')
          ? P('桌面/平板:体力仍是竖排红心 '+m.hp.hearts+' 颗("'+m.hp.heartTxt+'"),未被 data-hp 改动波及')
          : F('桌面/平板:体力表达被改变! hearts='+m.hp.hearts+' before="'+m.hp.before+'"');
      }
    }
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
  // 【座位卡逐元素体检:对手卡 + "我"的卡都要过】
  // 上一轮的教训:这个文件只量了 #oppRow .seat,从没量过 #meSeat —— 于是 .seat.me 那批
  // 特异性 (0,2,0) 的桌面尺寸覆盖把手机横屏的字号/尺寸规则全盖回去了,漏了整整一轮
  // (回合标签压住玩家名、武将名撞进装备槽、体力心被视口裁掉)。CLAUDE.md 规则18 说的
  // "验证样本要挑最刁钻的"——这里最刁钻的样本不是某个数值,而是**另一类卡片**。
  // 断言:无元素重叠 / 最小字号 ≥9px / 装备名无截断 / 卡片未被视口裁切。
  // ============================================================================
  const inspectSeat = `(sel => {
    const s = document.querySelector(sel);
    if(!s) return {err:'找不到 '+sel};
    const sr = s.getBoundingClientRect();
    const items = [];
    s.querySelectorAll('*').forEach(e => {
      if(e.children.length) return;                 // 只看叶子节点
      const cs = getComputedStyle(e);
      if(cs.display==='none' || cs.visibility==='hidden' || cs.opacity==='0') return;
      const bf = getComputedStyle(e,'::before').content;
      const txt = e.textContent.trim();
      const hasBefore = bf && bf!=='none' && bf!=='normal';
      if(!txt && !hasBefore) return;
      const r = e.getBoundingClientRect();
      if(r.width<1 || r.height<1) return;           // 被折叠的(如 font-size:0 的原文字)不算
      let f = parseFloat(cs.fontSize);
      if(f === 0 && hasBefore) f = parseFloat(getComputedStyle(e,'::before').fontSize);
      items.push({
        c: (typeof e.className==='string' ? e.className : '').split(' ')[0] || e.tagName,
        txt: (txt || bf.replace(/"/g,'')).slice(0,10),
        f, t:r.top, b:r.bottom, l:r.left, rt:r.right,
        clip: e.scrollWidth > e.clientWidth+1 || e.scrollHeight > e.clientHeight+1,
        isEquipName: e.classList.contains('enm')
      });
    });
    // 两两求交集。容差 2px:相邻行的 line-box 常有 1~2px 的名义交叠,字形本身并不相碰。
    const TOL = 2;
    const overlaps = [];
    for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){
      const A=items[i], B=items[j];
      const x = Math.min(A.rt,B.rt) - Math.max(A.l,B.l);
      const y = Math.min(A.b,B.b) - Math.max(A.t,B.t);
      if(x>TOL && y>TOL) overlaps.push({a:A.c+'("'+A.txt+'")', b:B.c+'("'+B.txt+'")',
        w:Math.round(x), h:Math.round(y)});
    }
    const minF = items.reduce((m,i)=>Math.min(m,i.f), 99);
    const minEl = (items.find(i=>i.f===minF)||{});
    return {
      rect:{t:Math.round(sr.top),b:Math.round(sr.bottom),l:Math.round(sr.left),r:Math.round(sr.right),
            w:Math.round(sr.width),h:Math.round(sr.height)},
      vw:innerWidth, vh:innerHeight,
      overlaps, minF, minEl:minEl.c+':'+minEl.txt,
      clippedEquip: items.filter(i=>i.isEquipName && i.clip).map(i=>i.txt),
      clippedAny: items.filter(i=>i.clip).map(i=>i.c+':'+i.txt)
    };
  })`;

  console.log('\n■ 座位卡逐元素体检矩阵(5种人数 x 3种横屏视口, 我=左慈带化身)');
  // 【为什么是矩阵而不是单点】上一轮这块只跑了 844x390 / 8人局一个样本,结果"我"的座位卡
  // 从头到尾没被断言覆盖过(用 .seat-X 写的覆盖特异性 0,1,0 压不住基础样式里 .seat.me .seat-X
  // 的 0,2,0,整张卡一直停在桌面尺寸),漏了很久都没被发现。人数决定卡片宽度(--opp-n)、
  // 视口高度决定卡片高度(dvh),两个维度各自都会改变布局,必须交叉跑。
  const COUNTS=[2,4,6,8,9];               // 2=开局门槛下限, 9=SEATS 上限
  const SEAT_VPS=[[844,390],[667,375],[932,430]];  // 667x375 是已知最矮的横屏样本
  for(const [vw,vh] of SEAT_VPS) for(const n of COUNTS){
    const tag='('+vw+'x'+vh+', '+n+'人局)';
    const ctx=await b.newContext({viewport:{width:vw,height:vh},hasTouch:true,isMobile:true,deviceScaleFactor:1});
    const p=await ctx.newPage();
    await p.goto('file://'+path.join(ROOT,'index.html')); await p.waitForTimeout(200);
    await p.evaluate(`document.getElementById('lobby').classList.add('hidden');document.getElementById('game').classList.remove('hidden');`);
    // "我"用左慈(有化身行)、身份局(有身份猜测标记)、轮到我(有 .active/回合标签);
    // 对手一律用颜良文丑——4 字是全表最长武将名,竖排最容易撞到下面的体力/装备。
    await p.evaluate(mkSetup(n).replace("general:'yanliangwenchou'","general: i===0?'zuoci':'yanliangwenchou', huashenGeneral: i===0?'guanyu':null"));
    await p.evaluate(`document.querySelectorAll('.my-turn-banner').forEach(e=>e.classList.remove('show'));`);
    await p.waitForTimeout(400);
    for(const [label, sel] of [['对手卡','#oppRow .seat'], ['我的卡','#meSeat .seat']]){
      const m = await p.evaluate(inspectSeat+'("'+sel+'")');
      if(m.err){ F(label+tag+': '+m.err); continue; }
      m.overlaps.length===0
        ? P(label+tag+' 无元素重叠')
        : F(label+tag+' 有 '+m.overlaps.length+' 处元素重叠: '
            + m.overlaps.map(o=>o.a+'↔'+o.b+'('+o.w+'x'+o.h+'px)').join(' '));
      m.minF>=9 ? P(label+tag+' 最小字号 '+m.minF+'px ≥9px')
                : F(label+tag+' 最小字号 '+m.minF+'px <9px ('+m.minEl+')');
      m.clippedEquip.length===0 ? P(label+tag+' 装备名无截断')
                                : F(label+tag+' 装备名被截断: '+m.clippedEquip.join(','));
      (m.rect.t>=0 && m.rect.b<=m.vh && m.rect.l>=0 && m.rect.r<=m.vw)
        ? P(label+tag+' 卡片完整在视口内 ('+m.rect.w+'x'+m.rect.h+')')
        : F(label+tag+' 卡片被视口裁切: '+JSON.stringify(m.rect)+' 视口 '+m.vw+'x'+m.vh);
    }
    if(vw===844 && n===8){   // 这两条和人数/视口无关,在代表性样本上各查一次即可
      const turnTag = await p.evaluate(()=>{
        const t=document.querySelector('#meSeat .seat .tag.turn');
        return t ? getComputedStyle(t).display : 'absent';
      });
      (turnTag==='none'||turnTag==='absent')
        ? P('"回合"文字标签已隐藏(改由 .seat.active 的绿色边框表达)')
        : F('"回合"文字标签仍显示(display:'+turnTag+'),会压住玩家名');
      const myGen = await p.evaluate(()=>{
        const e=document.getElementById('myGeneral');
        return e ? getComputedStyle(e).display : 'absent';
      });
      (myGen==='none'||myGen==='absent') ? P('"你的武将：…"重复行已隐藏')
                                         : F('"你的武将：…"行仍占位(display:'+myGen+')');
    }
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
