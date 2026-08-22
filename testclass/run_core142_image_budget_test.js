/**
 * CORE-142(issue #195): 素材分辨率对账 + <img> decoding="async"。
 *
 * 【这个测试真正在钉什么】素材是二进制文件,没法像代码那样"逐字比对";这里钉的是
 * **不变量**:任何一张立绘/卡面的分辨率都不得超过它在 UI 里实际可能的最大显示尺寸
 * (乘 DPR 余量)。以后有人补新素材时,如果直接把 1086x1448 的原图丢进来,这条会变红。
 *
 * 覆盖:
 *  1. 全部立绘宽度 ≤ GENERAL_MAX_W,全部卡面宽度 ≤ CARD_MAX_W
 *  2. 上限值本身与 index.html 里的实际显示尺寸对账(不是拍脑袋的数字)
 *  3. 缩放没有改变宽高比(object-fit:cover 的裁切表现不变)
 *  4. 素材数量没有少(不是靠删文件"优化")
 *  5. 四处 <img> 都带 decoding="async"
 *  6. 扩展名回退链未被触碰(仍从 .jpg 开始)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e && e.message) || e); failed++; }
}

// 目标上限的推导(见 issue #195 / progress-log),全部来自 index.html 的实际显示尺寸:
//   立绘:全局最大显示是基础规则 .seat.me{max-width:260px} → @DPR2 = 520
//        手机 .seat.me{width:180px} → @DPR3 = 540;桌面 meSeat 受 grid 列轨道限制 ≤180px
//   卡面:手牌最大 .hand .card{width:88px}(平板) × 长按/悬停放大 2.2 = 194 CSS → @DPR2 = 388
//        手机 60 × 2.2 = 132 → @DPR3 = 396
const GENERAL_MAX_W = 576;   // 覆盖 540 并留余量
const CARD_MAX_W    = 480;   // 覆盖 396 并留余量

// 极小的 JPEG/PNG 尺寸读取,不引第三方依赖(测试环境没有 sharp/Pillow)
function imgSize(file){
  const d = fs.readFileSync(file);
  if(d[0]===0xFF && d[1]===0xD8){                     // JPEG
    let i = 2;
    while(i < d.length){
      if(d[i] !== 0xFF){ i++; continue; }
      const m = d[i+1];
      if(m>=0xC0 && m<=0xCF && m!==0xC4 && m!==0xC8 && m!==0xCC){
        return { w: d.readUInt16BE(i+7), h: d.readUInt16BE(i+5) };
      }
      if(m===0xD8 || m===0xD9 || (m>=0xD0 && m<=0xD7)){ i+=2; continue; }
      i += 2 + d.readUInt16BE(i+2);
    }
    throw new Error('JPEG 尺寸解析失败: ' + file);
  }
  if(d.slice(0,8).toString('hex') === '89504e470d0a1a0a'){  // PNG
    return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
  }
  throw new Error('无法识别的图片格式: ' + file);
}

function listImgs(dir){
  return fs.readdirSync(path.join(ROOT,'assets',dir))
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f));
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-142:素材分辨率预算 + decoding="async"');
console.log('='.repeat(60) + '\n');

// ---------- 1. 分辨率上限 ----------
check('全部立绘宽度 ≤ ' + GENERAL_MAX_W + '(补新素材时别直接丢原图进来)', () => {
  const over = [];
  listImgs('generals').forEach(f => {
    const s = imgSize(path.join(ROOT,'assets','generals',f));
    if(s.w > GENERAL_MAX_W) over.push(f + ' ' + s.w + 'x' + s.h);
  });
  if(over.length) throw new Error('超出上限的立绘: ' + over.join(', '));
});

check('全部卡面宽度 ≤ ' + CARD_MAX_W, () => {
  const over = [];
  listImgs('cards').forEach(f => {
    const s = imgSize(path.join(ROOT,'assets','cards',f));
    if(s.w > CARD_MAX_W) over.push(f + ' ' + s.w + 'x' + s.h);
  });
  if(over.length) throw new Error('超出上限的卡面: ' + over.join(', '));
});

check('像素总量确实显著下降(立绘+卡面合计 < 60MP)', () => {
  let mp = 0;
  ['generals','cards'].forEach(d => listImgs(d).forEach(f => {
    const s = imgSize(path.join(ROOT,'assets',d,f)); mp += s.w*s.h;
  }));
  mp /= 1e6;
  // 改动前实测:立绘 83.3MP + 卡面 39.0MP = 122.3MP
  if(mp >= 60) throw new Error('合计 ' + mp.toFixed(1) + 'MP,未达到预期降幅(改动前 122.3MP)');
  console.log('       ↳ 当前合计 ' + mp.toFixed(1) + 'MP(改动前 122.3MP)');
});

// ---------- 2. 上限与实际显示尺寸对账 ----------
check('上限值与 index.html 的实际显示尺寸对账(不是拍脑袋的数字)', () => {
  const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const norm = t => t.replace(/\s+/g,'');
  // 立绘:基础 .seat.me 的 max-width 决定全局最大显示宽度
  const m = norm(html).match(/\.seat\.me\{width:220px;max-width:(\d+)px/);
  if(!m) throw new Error('index.html 里找不到 .seat.me 的基础宽度规则,上限推导失去依据');
  const seatMax = Number(m[1]);
  if(GENERAL_MAX_W < seatMax * 2)
    throw new Error('立绘上限 ' + GENERAL_MAX_W + ' 应至少覆盖 .seat.me(' + seatMax + 'px) @DPR2 = ' + seatMax*2);
  // 卡面:平板手牌宽度 × 放大倍率
  if(norm(html).indexOf(norm('.hand .card{width:88px;height:126px;')) < 0)
    throw new Error('index.html 里找不到平板手牌尺寸规则');
  if(norm(html).indexOf('scale(2.2)') < 0)
    throw new Error('index.html 里找不到长按/悬停的 2.2 倍放大');
  if(CARD_MAX_W < Math.ceil(88 * 2.2 * 2))
    throw new Error('卡面上限 ' + CARD_MAX_W + ' 应覆盖 88×2.2 @DPR2 = ' + Math.ceil(88*2.2*2));
});

// ---------- 3. 宽高比 ----------
check('缩放保持各自宽高比(object-fit:cover 的裁切表现不变)', () => {
  // 立绘只允许 2:3(0.667) 与 3:4(0.75) 两种既有比例;卡面只允许 2:3 与 1:2
  const bad = [];
  listImgs('generals').forEach(f => {
    const s = imgSize(path.join(ROOT,'assets','generals',f));
    const r = s.w/s.h;
    if(Math.abs(r-2/3) > 0.01 && Math.abs(r-0.75) > 0.01) bad.push('generals/'+f+' '+s.w+'x'+s.h);
  });
  listImgs('cards').forEach(f => {
    const s = imgSize(path.join(ROOT,'assets','cards',f));
    const r = s.w/s.h;
    if(Math.abs(r-2/3) > 0.01 && Math.abs(r-0.5) > 0.01) bad.push('cards/'+f+' '+s.w+'x'+s.h);
  });
  if(bad.length) throw new Error('宽高比异常(可能被拉伸): ' + bad.join(', '));
});

// ---------- 4. 素材数量 ----------
check('素材数量没有减少(不是靠删文件"优化")', () => {
  const g = listImgs('generals').length, c = listImgs('cards').length;
  if(g !== 67) throw new Error('立绘应为 67 个,实际 ' + g);
  if(c !== 40) throw new Error('卡面应为 40 个,实际 ' + c);
});

check('每个 GENERALS 表里的武将都有对应立绘文件', () => {
  const data = fs.readFileSync(path.join(ROOT,'data.js'),'utf8');
  const ids = [...data.matchAll(/^\s{2}(\w+):\s*\{\s*id:'(\w+)'/gm)].map(m => m[2]);
  if(ids.length < 30) throw new Error('从 data.js 解析出的武将 id 过少(' + ids.length + '),解析口径可能失效');
  const missing = ids.filter(id => !fs.existsSync(path.join(ROOT,'assets','generals',id+'.jpg')));
  if(missing.length) throw new Error('缺立绘的武将: ' + missing.join(','));
});

// ---------- 5. decoding="async" ----------
check('四处 <img> 都带 decoding="async"(避免主线程同步解码)', () => {
  const sites = [
    ['render.js',        'class="avatar"'],
    ['render-controls.js','class="avatar"'],
    ['render-hand.js',   'class="card-art"'],
    ['render-table.js',  'class="card-art"']
  ];
  sites.forEach(([file, cls]) => {
    const s = fs.readFileSync(path.join(ROOT,file),'utf8');
    const lines = s.split('\n').filter(l => l.indexOf('<img ' + cls) >= 0 && l.indexOf('//') !== 0);
    if(!lines.length) throw new Error(file + ' 里找不到 <img ' + cls + ' 的生成点');
    lines.forEach(l => {
      if(l.indexOf('decoding="async"') < 0)
        throw new Error(file + ' 的 <img ' + cls + '> 缺 decoding="async": ' + l.trim().slice(0,110));
    });
  });
});

// ---------- 6. 回退链未被触碰 ----------
check('扩展名回退链未被触碰(仍从 .jpg 开始,失败后依次重试)', () => {
  const s = fs.readFileSync(path.join(ROOT,'render.js'),'utf8');
  if(s.indexOf("function generalAvatarSrc(id){ return 'assets/generals/'+id+'.jpg'; }") < 0)
    throw new Error('generalAvatarSrc 应保持不变(本次只换素材,不动路径约定)');
  if(s.indexOf("const AVATAR_FALLBACK_EXTS = ['jpeg','png','webp','gif','svg']") < 0)
    throw new Error('AVATAR_FALLBACK_EXTS 应保持不变');
  if(s.indexOf("const CARD_FALLBACK_EXTS = ['jpeg','png','webp','gif']") < 0)
    throw new Error('CARD_FALLBACK_EXTS 应保持不变');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if(failed > 0) process.exit(1);
