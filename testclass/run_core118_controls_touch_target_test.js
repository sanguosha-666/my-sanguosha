// CORE-118(issue #150):手机横屏下 .controls button 触控目标低于44px下限。
//
// 【锁定什么】
//  手机横屏紧凑断点(@media(max-height:520px) and (orientation:landscape))里,
//  .controls button 原来 padding:3px 7px + font-size:10px,真实渲染高度只有23px
//  (用Playwright真实测量过,不是估算)。改动后 padding:7px 7px + font-size:11px,
//  真实渲染高度=32px(用同一套Playwright方法在SE/15/15Pro/15ProMax/16/16Pro/16ProMax
//  全系列验证过)。目标定在32px而不是WCAG建议的44px——44px需要挤占别处至少18~23px
//  纵向预算,当前没有那么多富余;32px只需要+9px。
//
//  同一断点里补了一条 .hand-label:not(#myGeneral){display:none} 隐藏"你的手牌"这个
//  无id静态标签(index.html 2238-2239行两个.hand-label的第二个),回收16.5px用于支付
//  上面按钮扩大的+9px开销——刻意没有吃满全部16.5px,剩余部分留给CORE-121(issue #153,
//  手牌换行纵向预算风险,尚未修复)。
//
// 【这份测试只测CSS规则本身,不重复真实渲染测量】真实渲染高度/整页溢出量的验证由
//  tools/verify_responsive_layout.js(需要真实Chromium,不适合放进这个纯Node套件)覆盖,
//  已在改动时人工跑过全部机型并给出对比数据(见commit记录)。这里锁定的是"CSS源码写的
//  是什么值",防止以后有人不小心改回旧值或删掉隐藏规则却没人发现。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 定位手机横屏紧凑断点这一整块(和run_tablet_landscape_gate_test.js/
// run_core119_lobby_portrait_gate_test.js同款"从大括号配对定位代码块"手法)。
function extractBlock(src, startMarker){
  const start = src.indexOf(startMarker);
  if(start < 0) return null;
  let depth = 0, i = start, blockStart = -1;
  for(; i < src.length; i++){
    if(src[i] === '{'){
      if(depth === 0) blockStart = i;
      depth++;
    } else if(src[i] === '}'){
      depth--;
      if(depth === 0) return src.slice(blockStart, i + 1);
    }
  }
  return null;
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-118:手机横屏 .controls button 触控目标扩大到32px');
console.log('='.repeat(60) + '\n');

const compactBlock = extractBlock(html, '@media (max-height:460px) and (orientation:landscape){');
check('能定位到手机横屏紧凑断点代码块(@media(max-height:460px) and (orientation:landscape))', function(){
  if(!compactBlock) throw new Error('未能定位到该断点——CSS结构是否被重构了?');
});

check('.controls button 的 padding/font-size 已更新为目标值(padding:7px 7px, font-size:11px)', function(){
  if(!/\.controls button\{padding:7px 7px;font-size:11px;\}/.test(compactBlock))
    throw new Error('未找到目标CSS值,实际内容片段: ' + (compactBlock.match(/\.controls button\{[^}]*\}/) || ['(未找到)'])[0]);
});

check('.controls button 不应再是修复前的旧值(padding:3px 7px, font-size:10px)', function(){
  if(/\.controls button\{padding:3px 7px;font-size:10px;\}/.test(compactBlock))
    throw new Error('仍然是修复前的旧值,改动没有生效');
});

check('新增 .hand-label:not(#myGeneral){display:none} 隐藏"你的手牌"标签', function(){
  if(!/\.hand-label:not\(#myGeneral\)\{display:none;\}/.test(compactBlock))
    throw new Error('未找到隐藏第二个.hand-label的规则');
});

check('#myGeneral 本身的隐藏规则(隐藏描述span,不是隐藏整个元素)保持不变,零回归', function(){
  if(!/#myGeneral span\{display:none;\}/.test(compactBlock))
    throw new Error('#myGeneral span{display:none;}规则丢失,这是既有的CORE-86前功能,不应被这次改动影响');
});

// 结构断言:index.html 里确实存在两个 .hand-label(否则上面 :not(#myGeneral) 选择器
// 选不中任何东西,规则形同虚设)。
check('index.html 里确实存在两个 .hand-label 元素(myGeneral + 无id的"你的手牌")', function(){
  const matches = html.match(/class="hand-label"/g) || [];
  if(matches.length !== 2)
    throw new Error('.hand-label 元素数量应为2,实际' + matches.length + '——如果不是2,上面新增的:not(#myGeneral)选择器可能选中了错误的元素或选不中任何元素');
  if(!/<div class="hand-label" id="myGeneral"><\/div>\s*\n\s*<div class="hand-label">你的手牌<\/div>/.test(html))
    throw new Error('两个.hand-label的HTML结构和预期不符(顺序/属性可能被改动过),需要重新核对:not(#myGeneral)选择器是否仍然精确命中第二个');
});

// 零回归:平板触控目标规则(CORE-86,44px)不应受这次改动影响
check('零回归:平板触控目标规则(min-height:521px门槛+44px)保持不变', function(){
  const m = html.match(/@media[^{]*min-height:521px[^{]*\{\s*#controls button\{min-height:44px;\}/);
  if(!m) throw new Error('平板触控目标规则丢失或被改动——这条规则不属于这次CORE-118的改动范围,应保持不变');
});

// 破坏性验证:还原成旧值,证明上面"padding:7px 7px"那条断言确实有鉴别力
check('破坏性验证:还原成修复前的旧padding/font-size值,"应为目标值"的断言确实会报红(证明有鉴别力)', function(){
  const oldStyleBlock = compactBlock.replace(
    '.controls button{padding:7px 7px;font-size:11px;}',
    '.controls button{padding:3px 7px;font-size:10px;}'
  );
  if(oldStyleBlock === compactBlock)
    throw new Error('还原文本没有生效,替换的目标字符串在compactBlock里找不到');
  if(/\.controls button\{padding:7px 7px;font-size:11px;\}/.test(oldStyleBlock))
    throw new Error('旧写法下不应该还能匹配到新值,如果匹配到了说明还原本身有问题');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
