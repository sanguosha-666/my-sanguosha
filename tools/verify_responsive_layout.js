// 响应式布局真实浏览器验证(Playwright)——CORE-86(issue #133 平板适配)时建立。
//
// 【为什么不放进 run_all_tests.js】需要真实 Chromium 二进制,常规 Node 测试套件里
// 跑不了;这是一个"改响应式布局/断点/遮罩逻辑时手动跑一遍"的验证工具,不是每次
// 提交都跑的回归测试。遮罩判定本身的纯逻辑回归由
// testclass/run_tablet_landscape_gate_test.js 覆盖(在常规套件里)。
//
// 【怎么跑】
//   1) npm i playwright-core            (装 API,不装浏览器)
//   2) 需要 ~/.cache/ms-playwright 下已有 chromium;若缺共享库且无 root 权限,按
//      docs/methodology.md「前端/UI」那条:apt-get download libnspr4 libnss3
//      libasound2t64 → dpkg-deb -x 解包 → LD_LIBRARY_PATH 指过去。
//   3) node tools/verify_responsive_layout.js
//
// 【验证口径,按 CLAUDE.md 规则18/22】宽度和高度两个维度分别拉到下限单独测(不能只
// 按宽度分档——手机横屏 667×375 宽度落在平板区间里,只看宽度会把它误当平板);样本
// 一律取最刁钻的:8人局、最长武将名"颜良文丑"、装备槽全满(含最长装备名"青龙偃月刀")。
// 断言全部是程序化量取(矩形/尺寸/溢出),不靠肉眼看截图。
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH
  || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');

// 覆盖矩阵:平板竖屏/横屏各档 + 手机(必须仍被拦) + 桌面(零回归)
const VIEWPORTS = [
  { name: 'iPad 竖屏',            w: 768,  h: 1024, touch: true,  expectGate: false },
  { name: 'iPad 横屏',            w: 1024, h: 768,  touch: true,  expectGate: false },
  { name: 'iPad Pro 竖屏',        w: 1024, h: 1366, touch: true,  expectGate: false },
  { name: 'iPad Pro 横屏',        w: 1366, h: 1024, touch: true,  expectGate: false },
  { name: '安卓平板竖屏(800)',     w: 800,  h: 1280, touch: true,  expectGate: false },
  { name: '小平板竖屏(641边界内)', w: 641,  h: 1000, touch: true,  expectGate: false },
  { name: '手机竖屏(640边界上)',   w: 640,  h: 960,  touch: true,  expectGate: true  },
  { name: '手机竖屏 iPhone SE',    w: 375,  h: 667,  touch: true,  expectGate: true  },
  { name: '手机竖屏 Pro Max',      w: 430,  h: 932,  touch: true,  expectGate: true  },
  // 手机横屏宽度 667 落在平板块的 641~1199 区间里,但高度只有 375——必须继续走手机紧凑
  // 尺寸,不能被平板触控目标规则波及(maxDocH 是改动前实测的页高基线 382,留 2px 容差)
  { name: '手机横屏 SE',           w: 667,  h: 375,  touch: true,  expectGate: false, compact: true, maxDocH: 384 },
  { name: '桌面 1440x900',        w: 1440, h: 900,  touch: false, expectGate: false },
];

// 构造一个"最刁钻"的 8 人局状态:全部用最长武将名 + 装备槽全满(含最长装备名)
const SETUP = `
  mySeat = 0;
  roomId = '666';
  const eq = () => ({
    weapon:{id:'w1',name:'青龙偃月刀',suit:'♠',rank:5},
    armor:{id:'a1',name:'八卦阵',suit:'♠',rank:2},
    plus1:{id:'p1',name:'的卢',suit:'♣',rank:5},
    minus1:{id:'m1',name:'赤兔',suit:'♥',rank:5}
  });
  const mkHand = n => Array.from({length:n},(_,i)=>({id:'h'+i,name:'杀',suit:'♠',rank:7}));
  const g = {
    started:true, phase:'play', turn:0, roundNum:3, gameMode:'identity',
    seed: 12345,
    players: Array.from({length:8},(_,i)=>({
      name: i===0 ? '我自己' : ('玩家'+i),
      general:'yanliangwenchou',
      role: i===0?'zhu':(i%3===0?'fan':(i%3===1?'zhong':'nei')),
      roleRevealed: false,
      hp: 3, maxHp: 4, alive:true,
      hand: i===0 ? mkHand(6) : mkHand(4),
      equips: eq(), delays:[], isBot: i!==0
    })),
    deck:[], discard:[], log:[{seq:0,text:'游戏开始'}], pending:null, exchangeCards:[]
  };
  currentG = g;
  render(g);
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  let pass = 0, fail = 0;
  const problems = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: vp.touch,
      isMobile: vp.touch,
      deviceScaleFactor: 1
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForTimeout(400);

    // 进入游戏视图 + 注入刁钻样本
    await page.evaluate(`
      document.getElementById('lobby').classList.add('hidden');
      document.getElementById('game').classList.remove('hidden');
      ${SETUP}
    `).catch(e => errors.push('SETUP:' + String(e.message).split('\n')[0]));
    await page.waitForTimeout(300);
    // 遮罩的显隐由 resize/orientationchange 驱动,注入状态后主动跑一次(真实设备上
    // 加载时/旋转时都会自然触发,这里只是补上测试环境里没有的那次事件)
    await page.evaluate('checkLandscapeGate()');
    await page.waitForTimeout(120);

    const r = await page.evaluate(() => {
      const gate = document.getElementById('landscapeGate');
      const gateVisible = gate && !gate.classList.contains('hidden');
      const q = s => document.querySelector(s);
      const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x:b.x, y:b.y, w:b.width, h:b.height, bottom:b.bottom, right:b.right }; };
      // 桌面四列布局把座位摆进 data-zone 分区(不在 .opp-row 里),平板/手机才用 .opp-row——
      // 统一按"除自己以外的全部座位卡"计数,两种布局都适用,不会把布局差异误报成缺卡。
      const allSeats = Array.from(document.querySelectorAll('.seat')).filter(s => !s.closest('#meSeat'));
      const seats = allSeats.map(rect);
      const cards = Array.from(document.querySelectorAll('.hand .card')).map(rect);
      // 所有可点击控件(用于触控目标尺寸检查)
      // CORE-130(issue #170):补上 .icon-btn 的覆盖——这是之前排查发现的测试盲区:图标按钮
      // (🚪🧠🐛🤖📜❓💬)此前完全不在这个集合里,把它们缩到 20px 这个工具也会照样全绿,
      // 拿它当验收依据是假绿灯。加进来时用 kind 区分种类:既有的"手机横屏按钮必须保持紧凑
      // (<44px)"反向断言针对的是 #controls 的响应按钮,不能被 44px 的图标按钮混进去搅乱,
      // 所以下面两处断言各自只看自己那一类。
      const collect = (sel, kind) => Array.from(document.querySelectorAll(sel))
        .map(el => { const b = el.getBoundingClientRect(); return { kind, tag: el.tagName, text: (el.textContent||'').trim().slice(0,10), w: b.width, h: b.height }; })
        .filter(t => t.w > 0 && t.h > 0);
      const tappables = [
        ...collect('#controls button', 'control'),
        ...collect('.hand .card', 'card'),
        ...collect('.icon-btn', 'icon'),
      ];
      return {
        gateVisible,
        docScrollW: document.documentElement.scrollWidth,
        docScrollH: document.documentElement.scrollHeight,
        innerW: window.innerWidth, innerH: window.innerHeight,
        seatCount: seats.length,
        seats, cards,
        tappables,
        meSeat: rect(q('#meSeat .seat')),
        tableStrip: rect(q('#tableStrip')),
        hand: rect(q('.hand')),
        // 武将名/装备条是否溢出自己的卡片
        nameOverflow: allSeats.map(s => {
          const n = s.querySelector('.seat-name'); if (!n) return null;
          const sb = s.getBoundingClientRect(), nb = n.getBoundingClientRect();
          return { over: nb.right > sb.right + 1 || nb.bottom > sb.bottom + 1 };
        }).filter(Boolean),
        desktopLayout: !!(q('#game') && q('#game').classList.contains('desktop-layout'))
      };
    });

    const issues = [];
    if (errors.length) issues.push('JS错误: ' + errors.join(' / '));
    if (r.gateVisible !== vp.expectGate) issues.push(`遮罩应${vp.expectGate?'显示':'隐藏'},实际${r.gateVisible?'显示':'隐藏'}`);

    if (!vp.expectGate) {
      // 只有能真正进入游戏的档才检查布局质量
      if (r.docScrollW > r.innerW + 1) issues.push(`横向溢出: scrollW=${r.docScrollW} > 视口${r.innerW}`);
      if (r.seatCount !== 7) issues.push(`对手座位应7个,实际${r.seatCount}`);
      const overflowed = r.nameOverflow.filter(n => n.over).length;
      if (overflowed) issues.push(`${overflowed}张座位卡的武将名溢出卡片边界`);
      // 触控目标:触屏设备下可点击控件应达到 44px 惯例(取最小的那个报出来)
      if (vp.compact && r.tappables.length) {
        // 反向断言:手机横屏必须保持紧凑按钮(<44px),证明平板的 min-height:44px 规则确实被
        // (min-height:521px) 挡在门外,不是"碰巧没生效"。**只看 #controls 的响应按钮**——
        // CORE-130 之后 .icon-btn 也进了这个集合,而图标按钮就是 44px(不受紧凑折中约束),
        // 混进来会让这条断言恒不触发(永远有元素<44px),失去鉴别力。
        const btns = r.tappables.filter(t => t.kind === 'control');
        if (btns.length && btns.every(t => t.h >= 44)) issues.push('手机横屏响应按钮被平板触控规则误抬到44px(应保持紧凑)');
        if (vp.maxDocH && r.docScrollH > vp.maxDocH) issues.push(`手机横屏页高回归: ${r.docScrollH} > 基线${vp.maxDocH}`);
      } else if (vp.touch && r.tappables.length) {
        const tooSmall = r.tappables.filter(t => t.kind !== 'icon' && Math.min(t.w, t.h) < 44);
        if (tooSmall.length) {
          const worst = tooSmall.reduce((a, b) => (Math.min(a.w,a.h) < Math.min(b.w,b.h) ? a : b));
          issues.push(`${tooSmall.length}个触控目标<44px(最小: ${worst.tag}"${worst.text}" ${worst.w.toFixed(0)}x${worst.h.toFixed(0)})`);
        }
      }
      // CORE-130(issue #170)新增:图标按钮触控目标断言。图标按钮不参与 CORE-118 那次的
      // "32px 紧凑折中"(那是给 #controls 响应按钮在纵向预算极限下的让步),它们应当在**所有**
      // 触屏视口下都维持 44px 下限。手机横屏(compact)同样适用——本次 CORE-130 把它们挪进
      // .panel.table 时明确没有缩小尺寸,这条断言就是钉住这一点。
      if (vp.touch) {
        const icons = r.tappables.filter(t => t.kind === 'icon');
        if (icons.length) {
          const small = icons.filter(t => Math.min(t.w, t.h) < 44);
          if (small.length) {
            const worst = small.reduce((a, b) => (Math.min(a.w,a.h) < Math.min(b.w,b.h) ? a : b));
            issues.push(`${small.length}/${icons.length}个图标按钮(.icon-btn)<44px(最小: "${worst.text}" ${worst.w.toFixed(0)}x${worst.h.toFixed(0)})`);
          }
        }
      }
      // 座位卡不该退化到不可读的尺寸
      const tinySeat = r.seats.filter(s => s.w < 60 || s.h < 80);
      if (tinySeat.length) issues.push(`${tinySeat.length}张座位卡过小(<60x80)`);
    }

    const status = issues.length ? 'FAIL' : 'PASS';
    if (issues.length) { fail++; problems.push({ vp: vp.name, issues }); } else pass++;
    console.log(`  ${status} ${vp.name.padEnd(22)} ${String(vp.w).padStart(4)}x${String(vp.h).padStart(4)} 遮罩=${r.gateVisible?'显示':'隐藏'} 页高=${r.docScrollH}/${r.innerH} 座位=${r.seatCount} 桌面布局=${r.desktopLayout}`);
    if (issues.length) issues.forEach(i => console.log(`         ↳ ${i}`));

    await ctx.close();
  }

  await browser.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (problems.length) { console.log('\n问题汇总:'); problems.forEach(p => console.log(` [${p.vp}] ` + p.issues.join('; '))); }
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
