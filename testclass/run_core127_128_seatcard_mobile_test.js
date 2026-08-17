/**
 * CORE-127(issue #166) + CORE-128(issue #167):移动端与桌面端差异排查修复。
 *
 * CORE-127:判定区标签 .dchip 是座位卡里唯一没进 @container 分档的元素,手机上固定
 *   52~56px 宽(带花色点数)撞进 64px 的卡片,换行成多行、吃掉 51~56% 卡高、并盖住竖排
 *   武将名。修法不是"把它也缩字号"(会和 CORE-129 座位卡字号已低到 6~7px 直接打架),
 *   而是"小卡片上少显示内容、字号不动":≤115px 档只显示牌名首字,≤85px 档再去掉
 *   padding/border 让三个首字排进一行。
 * CORE-128:平板是唯一在对局中还完整显示 标题+副标题+页脚(共102px) 的形态(桌面三块
 *   全隐藏、手机隐藏两块并压扁标题),而平板恰恰需要滚动最多。补上等价隐藏规则。
 *
 * 【真实渲染验证不在这里】判定区占卡高比例/遮挡判定/页高前后对照,已用 Playwright 在
 * 桌面1280·1440、平板横竖屏、小平板641、手机横屏SE·15/16 共七档视口逐项实测过(见
 * commit 记录的前后对照表);这份测试只锁定 CSS/JS 源码结构,防止以后被误改回去。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const renderJs = fs.readFileSync(path.join(ROOT, 'render.js'), 'utf8');
// 断言只看真正的 CSS 规则,不看注释散文——CORE-126 那次因为正则跨过注释误报过一次。
const cssOnly = html.replace(/\/\*[\s\S]*?\*\//g, '');

function extractBlock(src, startMarker){
  const start = src.indexOf(startMarker);
  if(start < 0) return null;
  let depth = 0, blockStart = -1;
  for(let i = start; i < src.length; i++){
    if(src[i] === '{'){ if(depth === 0) blockStart = i; depth++; }
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(blockStart, i + 1); }
  }
  return null;
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-127/128: 判定区标签分档 + 平板对局中收起装饰内容');
console.log('='.repeat(60) + '\n');

// ---------- CORE-127 ----------
check('CORE-127: render.js 同时输出 .dchip-full 与 .dchip-abbr 两种写法', function(){
  if(!/<span class="dchip-full">/.test(renderJs)) throw new Error('未找到 .dchip-full 输出');
  if(!/<span class="dchip-abbr">/.test(renderJs)) throw new Error('未找到 .dchip-abbr 输出');
  if(!/String\(c\.name\|\|''\)\.slice\(0,1\)/.test(renderJs))
    throw new Error('缩略写法应取牌名首字(slice(0,1))');
});

check('CORE-127: 完整信息不丢失——title 属性与 showDelayInfo 点击入口保持原样', function(){
  const m = renderJs.match(/<span class="dchip" title="[\s\S]{0,200}?showDelayInfo/);
  if(!m) throw new Error('.dchip 应仍带 title 与 showDelayInfo 点击入口(缩略后完整信息靠它们查看)');
});

check('CORE-127: .dchip-abbr 默认隐藏(大卡片显示完整牌名)', function(){
  if(!/\.dchip-abbr\{display:none;\}/.test(cssOnly)) throw new Error('未找到 .dchip-abbr 默认隐藏规则');
});

check('CORE-127: @container(max-width:115px) 档切换到缩略写法', function(){
  const b = extractBlock(cssOnly, '@container (max-width:115px){');
  if(!b) throw new Error('未能定位 115px 档');
  if(!/\.seat-delays \.dchip-full\{display:none;\}/.test(b)) throw new Error('115px 档应隐藏 .dchip-full');
  if(!/\.seat-delays \.dchip-abbr\{display:inline;\}/.test(b)) throw new Error('115px 档应显示 .dchip-abbr');
});

check('CORE-127: @container(max-width:85px) 档进一步压紧 chip(去 padding/border、gap 收到1px)', function(){
  const b = extractBlock(cssOnly, '@container (max-width:85px){');
  if(!b) throw new Error('未能定位 85px 档');
  if(!/\.seat-delays\{gap:1px;padding:0 2px 2px;\}/.test(b)) throw new Error('85px 档应收紧 .seat-delays 的 gap/padding');
  if(!/\.seat-delays \.dchip\{padding:0;border:none;border-radius:3px;\}/.test(b))
    throw new Error('85px 档应把 chip 压到只剩字+底色');
});

check('CORE-127 零回归: .dchip 基础规则字号仍是 8px(修法是换内容不是缩字号)', function(){
  if(!/\.seat-delays \.dchip\{font-size:8px;/.test(cssOnly))
    throw new Error('.dchip 基础字号不应被改动——本次刻意不缩字号,避免和 CORE-129(座位卡字号已低到6~7px)打架');
});

check('CORE-127 零回归: 桌面/平板横屏档(>115px)不受影响,没有为它们新增 dchip 规则', function(){
  const b150 = extractBlock(cssOnly, '@container (max-width:150px){');
  if(b150 && /dchip/.test(b150))
    throw new Error('150px 档不应出现 dchip 规则——桌面8人局(145px)和平板横屏(135px)实测本来就不重叠、只占15~18%,属于不该动的范围');
});

// ---------- CORE-128 ----------
check('CORE-128: 平板对局中隐藏 .sub 与 .footnote、压扁 h1', function(){
  const b = extractBlock(cssOnly, '@media (min-width:641px) and (max-width:1199px) and (min-height:521px),');
  if(!b) throw new Error('未能定位带 min-height:521px 门槛的平板块');
  if(!/\.wrap:has\(#game:not\(\.hidden\)\) h1\{font-size:15px;/.test(b)) throw new Error('平板应压扁对局中的 h1');
  if(!/\.wrap:has\(#game:not\(\.hidden\)\) \.sub\{display:none;\}/.test(b)) throw new Error('平板应隐藏对局中的 .sub');
  if(!/#game:not\(\.hidden\) ~ \.footnote\{display:none;\}/.test(b)) throw new Error('平板应隐藏对局中的 .footnote');
});

check('CORE-128 关键: 这三条必须在带 min-height:521px 的块里,不能在只按宽度分档的平板块里', function(){
  // 只按宽度分档的那个块(没有 min-height 门槛)——手机横屏 667/734px 宽同样落在里面
  const widthOnly = extractBlock(cssOnly, '@media (min-width:641px) and (max-width:1199px),\n         (min-width:641px) and (hover:none) and (pointer:coarse){');
  if(!widthOnly) throw new Error('未能定位只按宽度分档的平板块');
  if(/\.wrap:has\(#game:not\(\.hidden\)\) h1\{/.test(widthOnly))
    throw new Error('h1 规则不能放在只按宽度分档的块里——手机横屏(SE 667px/15·16 734px)宽度同样命中该区间,'
      + '实测会把手机 h1 从13px顶到15px、页高从376涨到379,突破 CORE-121 基线(第一版就是这么写的,被实测抓出来)');
  if(/\.wrap:has\(#game:not\(\.hidden\)\) \.sub\{display:none;\}/.test(widthOnly))
    throw new Error('.sub 规则同样不能放在只按宽度分档的块里');
});

check('CORE-128 零回归: 手机横屏自己的 h1 压扁规则(13px)保持不变', function(){
  const b = extractBlock(cssOnly, '@media (max-height:460px) and (orientation:landscape){');
  if(!b) throw new Error('未能定位手机横屏断点');
  if(!/\.wrap:has\(#game:not\(\.hidden\)\) h1\{font-size:13px;/.test(b))
    throw new Error('手机横屏的 h1:13px 规则不应被改动');
});

check('CORE-128 零回归: 桌面的三条隐藏规则保持不变', function(){
  if(!/\.wrap:has\(#game\.desktop-layout:not\(\.hidden\)\) h1\{display:none;\}/.test(cssOnly))
    throw new Error('桌面 h1 隐藏规则丢失');
  if(!/\.wrap:has\(#game\.desktop-layout:not\(\.hidden\)\) \.sub\{display:none;\}/.test(cssOnly))
    throw new Error('桌面 .sub 隐藏规则丢失');
});

// 破坏性验证
check('破坏性验证: 还原 .dchip-abbr 为默认显示,"默认隐藏"断言确实会报红(证明有鉴别力)', function(){
  const reverted = cssOnly.replace('.dchip-abbr{display:none;}', '.dchip-abbr{display:inline;}');
  if(reverted === cssOnly) throw new Error('还原文本没有生效,替换目标找不到');
  if(/\.dchip-abbr\{display:none;\}/.test(reverted))
    throw new Error('还原后不应再匹配到默认隐藏规则,如果还能匹配说明这条破坏性验证本身没有意义');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
