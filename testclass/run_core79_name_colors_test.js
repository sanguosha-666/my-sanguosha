/**
 * CORE-79(issue #126):NAME_COLORS 存在色相过近的色对(#B8A22F暗金黄 vs #C4C44F黄绿,
 * hue只差10°,深色座位卡背景上几乎同色——用户实测截图证实,两名玩家"撒撒"/"机器人5"
 * 的名字都显示成看不出区别的黄色)。
 *
 * 修复:重新设计8色,程序化验证两两hue差≥40°(不是"每两色间隔约24°"这种未经验证的估计
 * ——旧数组实测hue分布是[209,148,321,50,268,20,180,60],差距10°~170°不等)。同时对
 * 实际在场的势力色(蜀红/群金/吴绿)做best-effort规避,不比旧方案更接近;魏蓝/晋紫两个
 * 已有历史结论(progress-log-4:魏蓝撞色已被用户拍板接受不动;晋紫当前无任何在场武将
 * 使用,不构成真实撞色),不作为硬性阻塞项。
 *
 * seatColor(seat)接口本身不变,不需要加载完整游戏引擎,直接从源码正则提取NAME_COLORS
 * 数组+用真实WCAG相对亮度/HSL公式计算,不手抄字面量、不凭肉眼判断。
 */
const fs = require('fs');
const assert = require('assert');

let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

// ---- 从源码提取真实的 NAME_COLORS 定义(不手抄字面量,源码改了这条测试跟着改) ----
function extractNameColors(source){
  const m = source.match(/const NAME_COLORS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, '应能在render.js里找到NAME_COLORS定义');
  return m[1].split(',').map(s => s.trim().replace(/'/g, ''));
}

const renderSrc = fs.readFileSync('render.js', 'utf8');
const NAME_COLORS = extractNameColors(renderSrc);

// ---- HSL/相对亮度计算(标准WCAG公式,自行实现,不依赖第三方库) ----
function hexToHsl(hex){
  hex = hex.replace('#', '');
  const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if(max===min){ h=0; s=0; }
  else {
    const d = max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      case b: h=(r-g)/d+4; break;
    }
    h *= 60;
  }
  return { h, s: s*100, l: l*100 };
}
function circHueDiff(a, b){
  const d = Math.abs(a-b) % 360;
  return Math.min(d, 360-d);
}
function srgbToLin(c){
  c = c/255;
  return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
}
function relLuminance(hex){
  hex = hex.replace('#','');
  const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
  return 0.2126*srgbToLin(r)+0.7152*srgbToLin(g)+0.0722*srgbToLin(b);
}

console.log('\n== CORE-79:NAME_COLORS 色相过近修复 ==\n');

// ---- 基础结构:8色,合法hex ----
check('NAME_COLORS恰好8个合法#RRGGBB色值', ()=>{
  assert.strictEqual(NAME_COLORS.length, 8, '应恰好8色,实际 '+NAME_COLORS.length);
  NAME_COLORS.forEach(c=>{
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(c), c+' 不是合法的#RRGGBB六位十六进制颜色');
  });
});

// ---- 核心验收标准:8色两两hue差≥40° ----
check('8色两两hue差≥40°(issue验收标准,程序化WCAG-style计算)', ()=>{
  const hues = NAME_COLORS.map(c => hexToHsl(c).h);
  for(let i=0;i<hues.length;i++){
    for(let j=i+1;j<hues.length;j++){
      const diff = circHueDiff(hues[i], hues[j]);
      assert.ok(diff >= 40, '色'+i+'('+NAME_COLORS[i]+',hue='+hues[i].toFixed(1)+') 与 色'
        +j+'('+NAME_COLORS[j]+',hue='+hues[j].toFixed(1)+') 差仅'+diff.toFixed(1)+'°,应≥40°');
    }
  }
});

// ---- 直接复现issue报告的原始bug:旧的两个黄色系颜色不应再同时出现在新数组里 ----
check('原报告的两个近似黄色(#B8A22F暗金黄/#C4C44F黄绿)不应再同时存在于NAME_COLORS里', ()=>{
  const hasOldGold = NAME_COLORS.some(c => c.toUpperCase() === '#B8A22F');
  const hasOldYellowGreen = NAME_COLORS.some(c => c.toUpperCase() === '#C4C44F');
  assert.ok(!(hasOldGold && hasOldYellowGreen), '不应同时保留原来那对被用户实测认定"几乎同色"的黄色系颜色');
});

// ---- 明度不应比旧方案更暗(不能为了拉开色相牺牲可读性) ----
check('新色板平均相对亮度不低于旧色板(不是靠牺牲可读性换取色相分散)', ()=>{
  const OLD_NAME_COLORS = ['#3B82C4','#2FBF71','#C4519B','#B8A22F','#8B5FBF','#D9713C','#4FA8A8','#C4C44F'];
  const avgLum = arr => arr.reduce((s,c)=>s+relLuminance(c),0)/arr.length;
  const oldAvg = avgLum(OLD_NAME_COLORS);
  const newAvg = avgLum(NAME_COLORS);
  assert.ok(newAvg >= oldAvg - 0.02, '新色板平均亮度('+newAvg.toFixed(3)+')不应明显低于旧色板('+oldAvg.toFixed(3)+')');
});

// ---- 不引入与实际在场势力色的"近似撞色"(蜀红/群金/吴绿;魏蓝/晋紫见下方注释,不作为硬阻塞) ----
check('不与实际在场势力色(蜀红#b1361e/群金#7d5f2a/吴绿#5f7a5a)产生≤12°的近似撞色', ()=>{
  // 魏蓝(#3a5f8a)在progress-log-4已有历史结论:座位色与势力色撞色已被用户拍板接受不动,
  // 不在这里重新judge;晋紫(#5a3a7a)是"预留"势力,当前没有任何在场武将使用,不构成真实
  // 撞色,同样不作为本条断言的检查对象——只检查真正会同屏出现的三个势力色。
  // 阈值取12°:这正是本次issue报告的原始bug严重度量级(旧方案离蜀红/群金分别只差
  // 10.5°/12.1°,被用户实测认定"几乎同色")——程序化搜索验证过,在满足"8色两两hue差
  // ≥40°"这条硬性验收标准的前提下,继续加大与3个挤在同一象限内的势力色的间距已经逼近
  // 几何极限(约14°),不可能做到完全不接近;这里只要求不复现原始bug那种10°~12°级别的
  // 近似撞色,不要求做到零距离。
  const activeFactions = { shu:'#b1361e', qun:'#7d5f2a', wu:'#5f7a5a' };
  const hues = NAME_COLORS.map(c=>hexToHsl(c).h);
  Object.keys(activeFactions).forEach(k=>{
    const fh = hexToHsl(activeFactions[k]).h;
    const minDist = Math.min(...hues.map(h=>circHueDiff(h, fh)));
    assert.ok(minDist > 12, k+' 势力色('+activeFactions[k]+')与NAME_COLORS里最近的颜色只差'
      +minDist.toFixed(1)+'°,复现了原始bug级别的近似撞色');
  });
});

// ---- seatColor(seat) 接口不变:验证顺序、取模、负数安全 ----
check('seatColor(seat)接口不变:按顺序对应NAME_COLORS,支持取模与负数座位号', ()=>{
  const m = renderSrc.match(/function seatColor\(seat\)\{([^}]+)\}/);
  assert.ok(m, '应能找到seatColor函数定义');
  // eslint-disable-next-line no-new-func
  const seatColor = new Function('NAME_COLORS', 'seat', m[1].replace('return ', 'return '));
  for(let i=0;i<8;i++){
    assert.strictEqual(seatColor(NAME_COLORS, i), NAME_COLORS[i], '座位'+i+'应对应NAME_COLORS['+i+']');
  }
  assert.strictEqual(seatColor(NAME_COLORS, 8), NAME_COLORS[0], '座位8应取模回到NAME_COLORS[0]');
  assert.strictEqual(seatColor(NAME_COLORS, -1), NAME_COLORS[7], '负数座位号应安全取模,不抛异常/不越界');
});

// ---- 破坏性验证:还原成旧的8色数组,证明hue差断言确实会在原始bug上报红 ----
check('破坏性验证:还原成旧NAME_COLORS,hue差≥40°的断言应在暗金黄/黄绿这对上报红(证明断言有鉴别力)', ()=>{
  const OLD_NAME_COLORS = ['#3B82C4','#2FBF71','#C4519B','#B8A22F','#8B5FBF','#D9713C','#4FA8A8','#C4C44F'];
  const hues = OLD_NAME_COLORS.map(c => hexToHsl(c).h);
  let foundViolation = false;
  for(let i=0;i<hues.length;i++){
    for(let j=i+1;j<hues.length;j++){
      if(circHueDiff(hues[i], hues[j]) < 40) foundViolation = true;
    }
  }
  if(!foundViolation)
    throw new Error('旧色板应该(正确地)存在hue差<40°的色对(暗金黄vs黄绿,10°),如果没查到说明上面的断言对这个bug没有鉴别力');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
