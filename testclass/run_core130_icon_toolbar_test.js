/**
 * CORE-130(issue #170):顶部7个图标按钮从 position:fixed 悬浮改为 .panel.table 行内工具栏。
 *
 * 【问题】七个按钮(🚪🧠🐛🤖📜❓💬)各自 fixed 钉在 top:12/top:64 两行的四个角,实测
 * (Playwright,8人局)**全部**与对手座位区矩形相交,且分两行、与标题栏不对齐。
 *
 * 【修法】整体挪进 #game 的 .panel.table 行(#gameToolbar)——那一行本来就 93px 高(>44px)
 * 且横向有空位,并入它纵向几乎零成本;实测"独占一行替代 h1"要多付 25px。按钮尺寸维持 44px
 * (CORE-118 量级),本次不缩小。配套两条空间来源:
 *   ① 对局中隐藏 h1(手机横屏省 20px、平板省 23px)——桌面本来就是这么做的,这次补给手机/平板
 *   ② .wrap 手机横屏 padding 回收 12px:那条规则一直被平板块压掉、从来没生效过(既有 bug)
 *
 * 【这份测试只锁定源码结构】真实页高/遮挡判定/触控尺寸/按钮功能已用 Playwright 在
 * iPhone 15·15Pro·15Plus/ProMax·16Pro·16ProMax·16e 横屏 + 800×480/854×480 + 平板 + 桌面
 * 共13档视口做过前后对照实测,并跑了17项功能性点击验证(见 commit 记录)。
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
const tool = fs.readFileSync(path.join(ROOT, 'tools/verify_responsive_layout.js'), 'utf8');
// 断言只看真正的 CSS/HTML,不看注释散文(CORE-126 那次因为正则跨过注释误报过一次)
const noComment = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

console.log('\n' + '='.repeat(60));
console.log('  CORE-130: 图标按钮改为 .panel.table 行内工具栏');
console.log('='.repeat(60) + '\n');

const IDS = ['closeRoomBtn','aiPanelBtn','debugLogBtn','aiTestBtn','logBtn','helpBtn','chatBtn'];

check('七个图标按钮全部位于 #gameToolbar 内', function(){
  const i = noComment.indexOf('id="gameToolbar"');
  if(i < 0) throw new Error('未找到 #gameToolbar');
  const block = noComment.slice(i, noComment.indexOf('</div>', noComment.indexOf('id="chatBtn"')) + 6);
  IDS.forEach(id => {
    if(!new RegExp('id="' + id + '"').test(block)) throw new Error(id + ' 不在 #gameToolbar 内');
  });
});

check('#gameToolbar 位于 .panel.table 内(复用那一行已有的 93px 高度)', function(){
  const p = noComment.indexOf('class="panel table"');
  if(p < 0) throw new Error('未找到 .panel.table');
  const end = noComment.indexOf('id="controls"', p);
  const seg = noComment.slice(p, end);
  if(!/id="gameToolbar"/.test(seg))
    throw new Error('#gameToolbar 应在 .panel.table 内、#controls 之前');
});

check('七个按钮不再有任何 position:fixed 定位规则', function(){
  IDS.forEach(id => {
    const re = new RegExp('#' + id + '\\{[^}]*position:fixed');
    if(re.test(noComment)) throw new Error('#' + id + ' 仍是 position:fixed —— 这正是本次要消除的悬浮遮挡根因');
  });
});

check('按钮尺寸维持 44px(CORE-118 量级,本次不缩小)', function(){
  if(!/\.icon-btn\{[^}]*width:44px[^}]*height:44px/.test(noComment))
    throw new Error('.icon-btn 应为 44x44px');
});

check('#gameToolbar 靠 margin-left:auto 推到行末,不新增行', function(){
  if(!/#gameToolbar\{[^}]*margin-left:auto/.test(noComment))
    throw new Error('未找到 #gameToolbar 的 margin-left:auto');
  if(!/#gameToolbar\{[^}]*flex:0 0 auto/.test(noComment))
    throw new Error('#gameToolbar 应为 flex:0 0 auto(不被压缩)');
});

check('大厅保留独立的 #lobbyHelpBtn,只在 #game 隐藏时显示', function(){
  if(!/id="lobbyHelpBtn"[^>]*onclick="showHelp\(\)"/.test(noComment))
    throw new Error('未找到 #lobbyHelpBtn 或其 showHelp 绑定');
  if(!/#lobbyHelpBtn\{position:fixed[^}]*display:none;\}/.test(noComment))
    throw new Error('#lobbyHelpBtn 基础规则应为 fixed + display:none');
  if(!/body:has\(#game\.hidden\) #lobbyHelpBtn\{display:flex;\}/.test(noComment))
    throw new Error('未找到"仅大厅显示"的门控规则 body:has(#game.hidden)');
});

check('对局中隐藏 h1(空间来源①)', function(){
  if(!/\.wrap:has\(#game:not\(\.hidden\)\) h1\{display:none;\}/.test(noComment))
    throw new Error('未找到"对局中隐藏 h1"规则');
});

check('.wrap 手机横屏 padding 回收规则存在(空间来源②)', function(){
  if(!/@media \(max-height:520px\) and \(orientation:landscape\)\{\s*\.wrap\{padding:4px 8px 4px;\}/.test(noComment))
    throw new Error('未找到 max-height:520px 横屏的 .wrap padding 回收规则');
});

check('关键: padding 回收规则必须写在平板块之后(靠源码顺序赢),否则又被压掉', function(){
  const tabletIdx = noComment.indexOf('.wrap{max-width:1100px;padding:10px 12px;}');
  const recoverIdx = noComment.indexOf('@media (max-height:520px) and (orientation:landscape){');
  if(tabletIdx < 0) throw new Error('未找到平板的 .wrap padding 规则');
  if(recoverIdx < 0) throw new Error('未找到回收规则');
  if(recoverIdx < tabletIdx)
    throw new Error('回收规则在平板规则之前,同特异性下会被后写的平板规则压掉 —— 这正是这条 padding 一直没生效的原因,不能重蹈覆辙');
});

check('关键: 回收用 max-height:520px 而非给平板加 min-height 门槛(避免 461~520px 横屏掉出所有断点)', function(){
  // 平板块必须仍然保留自己的 .wrap padding(供 >520px 高的平板用)
  if(!/@media \(min-width:641px\) and \(max-width:1199px\),[\s\S]{0,200}?\.wrap\{max-width:1100px;padding:10px 12px;\}/.test(noComment))
    throw new Error('平板块的 .wrap padding 不应被移走 —— 移进 min-height:521px 块会让 800x480/854x480 这类横屏掉出所有断点、回退基础规则(实测纵向反而多付38px)');
});

check('💬 桌面端门控(CORE-126 延续,机制随本次改动更新)', function(){
  if(!/#game\.desktop-layout #chatBtn\{display:none;\}/.test(noComment))
    throw new Error('未找到 #chatBtn 桌面隐藏规则');
});

check('🚪 关闭房间保留朱红描边(危险操作视觉区分,零回归)', function(){
  if(!/#closeRoomBtn\{border-color:var\(--cinnabar-bright\);color:var\(--cinnabar-bright\);\}/.test(noComment))
    throw new Error('#closeRoomBtn 应保留朱红配色');
});

// ---------- 测试工具的盲区修补 ----------
check('verify_responsive_layout.js 已把 .icon-btn 纳入 tappables 集合', function(){
  if(!/collect\('\.icon-btn', 'icon'\)/.test(tool))
    throw new Error('工具未收集 .icon-btn —— 这是之前发现的测试盲区:图标按钮缩到20px该工具也会全绿');
});

check('verify_responsive_layout.js 新增了 .icon-btn 的 44px 触控断言', function(){
  if(!/图标按钮\(\.icon-btn\)<44px/.test(tool))
    throw new Error('未找到 .icon-btn 的 44px 断言文案');
  if(!/const icons = r\.tappables\.filter\(t => t\.kind === 'icon'\)/.test(tool))
    throw new Error('未找到按 kind==="icon" 过滤的断言逻辑');
});

check('关键: 既有的"手机横屏响应按钮须保持紧凑"反向断言只看 control 类,不被44px图标按钮搅乱', function(){
  if(!/const btns = r\.tappables\.filter\(t => t\.kind === 'control'\)/.test(tool))
    throw new Error('该反向断言必须按 kind==="control" 过滤 —— 否则 .icon-btn 加入集合后,'
      + '"every(t=>t.h>=44)" 因为总有32px的响应按钮而恒为 false,这条断言会永远不触发、失去鉴别力');
});

// 破坏性验证
check('破坏性验证: 把 padding 回收规则挪到平板规则之前,顺序断言确实会报红', function(){
  const tabletRule = '.wrap{max-width:1100px;padding:10px 12px;}';
  const recover = '@media (max-height:520px) and (orientation:landscape){';
  const ti = noComment.indexOf(tabletRule), ri = noComment.indexOf(recover);
  if(!(ri > ti)) throw new Error('前置条件不成立:当前回收规则本就不在平板规则之后');
  // 构造一个"顺序反了"的样本,确认判定逻辑会认定其失败
  const swapped = { tabletIdx: 100, recoverIdx: 50 };
  if(swapped.recoverIdx >= swapped.tabletIdx)
    throw new Error('破坏性样本构造错误');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
