// CORE-121(issue #153):手机横屏手牌数较多时(实测9~10张起)flex-wrap:wrap把手牌换到
// 第2行,导致纵向溢出+81~+105px(第2行几乎完全落在视口外,需要滚动才能看到)。
//
// 【锁定什么】手机横屏紧凑断点(@media(max-height:520px) and (orientation:landscape)
// and (pointer:coarse),真实生效的是.hand .card{width:60px}这条,已用Playwright实测
// 确认压过了另一个特异性更低的@media(max-height:460px)断点里的.card{width:44px})
// 里,.hand改成flex-wrap:nowrap+overflow-x:auto,手牌永远保持一行、横向滚动查看,
// 彻底消除这个纵向溢出来源。.hand .card补flex:0 0 auto,防止nowrap容器里浏览器默认
// flex-shrink:1把卡片挤扁而不是触发滚动。
//
// 【这份测试只测CSS源码结构,不重复真实渲染测量】真实溢出量/滚动可达性/长按预览兼容性
// 已用Playwright在SE/15/15Pro/16/16Pro等机型上实测过(见issue讨论的完整对比数据和
// 三组长按预览功能测试),这里锁定"CSS源码写的是什么值",防止以后被误改回wrap。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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
console.log('  CORE-121:手机横屏手牌区改横向滚动,消除换行纵向溢出');
console.log('='.repeat(60) + '\n');

const compactTouchBlock = extractBlock(
  html,
  '@media (max-height:520px) and (orientation:landscape) and (pointer:coarse){'
);
check('能定位到手机横屏紧凑触屏断点(@media(max-height:520px) and (orientation:landscape) and (pointer:coarse))', function(){
  if(!compactTouchBlock) throw new Error('未能定位到该断点——CSS结构是否被重构了?');
});

check('该断点内 .hand 已改为 flex-wrap:nowrap(不再换行)', function(){
  if(!/\.hand\{[^}]*flex-wrap:nowrap[^}]*\}/.test(compactTouchBlock))
    throw new Error('未找到.hand的flex-wrap:nowrap规则,实际片段: ' + (compactTouchBlock.match(/\.hand\{[^}]*\}/) || ['(未找到)'])[0]);
});

check('该断点内 .hand 已开启 overflow-x:auto(横向滚动)', function(){
  if(!/\.hand\{[^}]*overflow-x:auto[^}]*\}/.test(compactTouchBlock))
    throw new Error('未找到.hand的overflow-x:auto规则');
});

check('该断点内 .hand .card 补了 flex:0 0 auto(防止nowrap容器里卡片被压扁,确保触发滚动而不是挤压)', function(){
  if(!/\.hand \.card\{flex:0 0 auto;\}/.test(compactTouchBlock))
    throw new Error('未找到.hand .card{flex:0 0 auto;}规则——缺了这条,浏览器默认flex-shrink:1会把卡片压扁而不是滚动');
});

check('该断点内 .hand .card 宽度仍是60px(真正生效的那条规则,零回归)', function(){
  if(!/\.hand \.card\{width:60px;height:86px;--badge:15px;\}/.test(compactTouchBlock))
    throw new Error('.hand .card的尺寸规则被意外改动了,不在这次改动范围内');
});

// 零回归:另一个特异性更低的@media(max-height:460px)断点里的.card{width:44px}不应被
// 这次改动影响(它本来就不是真正生效的规则,但也不应该被顺手改掉)。
check('零回归:@media(max-height:460px)断点里的.card规则保持不变(不属于这次改动范围)', function(){
  const otherBlock = extractBlock(html, '@media (max-height:460px) and (orientation:landscape){');
  if(!otherBlock) throw new Error('未能定位到@media(max-height:460px)断点');
  if(!/\.card\{width:44px;height:64px;--badge:12px;\}/.test(otherBlock))
    throw new Error('.card{width:44px...}规则被意外改动,这不属于CORE-121的改动范围');
});

// 零回归:平板/桌面的.hand不应被这次改动影响
check('零回归:平板断点(min-width:641px)里没有出现nowrap/overflow-x(手牌换行行为不变)', function(){
  const tabletBlock = extractBlock(html, '@media (min-width:641px) and (max-width:1199px),');
  if(tabletBlock && /flex-wrap:nowrap/.test(tabletBlock))
    throw new Error('平板断点不应包含flex-wrap:nowrap,CORE-121只针对手机横屏紧凑断点');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
