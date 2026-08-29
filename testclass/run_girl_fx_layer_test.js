/**
 * 三姐妹表情动画头像化层：纯判定 + 几何函数单测（game-bg.js）。
 * 用 vm 沙箱加载 game-bg.js，注入可控 window.matchMedia / innerWidth/Height，
 * 直接调 girlFxComputeMode / girlFxDecide / girlFxTargetBox（几何是纯函数，无需真 DOM）。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
let passed=0, failed=0;
function check(name, fn){
  try{ fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e&&e.message)||e); failed++; }
}
function loadGameBg(mode){
  const context={
    Math,console,Number,String,Array,Object,Set,document:{getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},removeEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};},body:{}},
    setTimeout(){return 0;}, clearTimeout(){},
    requestAnimationFrame(){return 0;}, cancelAnimationFrame(){},
  };
  context.window={
    innerWidth: mode==='phone'?844:1400,
    innerHeight: mode==='phone'?390:900,
    devicePixelRatio:1, matchMedia:undefined, addEventListener(){}, removeEventListener(){},
  };
  if(mode==='phone') context.window.matchMedia=q=>({matches: q==='(max-width:640px)'?false:(q==='(max-height:460px) and (orientation:landscape)'?true:false)});
  else if(mode==='desktop') context.window.matchMedia=q=>({matches: /hover:\s*hover/.test(q)&&/pointer:\s*fine/.test(q)});
  else context.window.matchMedia=q=>({matches:false}); // tablet: 无手机断点、无 hover/fine
  context.window.document=context.document;
  context.global=context;
  const sb=vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'game-bg.js'),'utf8'),sb,{filename:'game-bg.js'});
  return expr=>vm.runInContext(expr,sb);
}
const R_phone=loadGameBg('phone'), R_desktop=loadGameBg('desktop'), R_tablet=loadGameBg('tablet');

check('girlFxComputeMode: 手机横屏(844x390 落平板宽度但命中手机断点)判为 phone', ()=>{
  assert.strictEqual(R_phone('girlFxComputeMode()'), 'phone');
});
check('girlFxComputeMode: 桌面 hover+fine 判为 desktop', ()=>{
  assert.strictEqual(R_desktop('girlFxComputeMode()'), 'desktop');
});
check('girlFxComputeMode: 平板既非手机也非桌面 → fullscreen', ()=>{
  assert.strictEqual(R_tablet('girlFxComputeMode()'), 'fullscreen');
});
check('girlFxDecide: desktop 自己座位→desktop-self, 他人→desktop-other', ()=>{
  assert.strictEqual(R_desktop('girlFxDecide(2,2)'), 'desktop-self');
  assert.strictEqual(R_desktop('girlFxDecide(1,2)'), 'desktop-other');
});
check('girlFxDecide: phone 一律 phone(不分自我); tablet→fullscreen', ()=>{
  assert.strictEqual(R_phone('girlFxDecide(0,0)'), 'phone');
  assert.strictEqual(R_phone('girlFxDecide(1,0)'), 'phone');
  assert.strictEqual(R_tablet('girlFxDecide(0,0)'), 'fullscreen');
});
check('girlFxTargetBox: desktop-self 精确贴合头像矩形', ()=>{
  const a={left:100,top:50,width:220,height:293};
  const got=R_desktop(`girlFxTargetBox('desktop-self', ${JSON.stringify(a)}, 1400,900, 0.75)`);
  // vm 沙箱对象与主 realm 原型不同，deepStrictEqual 会误判为原型不一致，改用属性逐项比较
  assert.strictEqual(got.left, a.left); assert.strictEqual(got.top, a.top);
  assert.strictEqual(got.width, a.width); assert.strictEqual(got.height, a.height);
});
check('girlFxTargetBox: desktop-other 1.8x 放大且中心≈头像中心、不越视口', ()=>{
  const a={left:100,top:50,width:100,height:133};
  const b=R_desktop(`girlFxTargetBox('desktop-other', ${JSON.stringify(a)}, 1400,900, 0.75)`);
  assert.ok(Math.abs(b.width-180)<1, '宽应约1.8x=180, 实际'+b.width);
  assert.ok(Math.abs((b.left+b.width/2)-(a.left+a.width/2))<1, '水平居中于头像');
  assert.ok(b.left>=0 && b.left+b.width<=1400 && b.top>=0 && b.top+b.height<=900, '不越视口');
});
check('girlFxTargetBox: phone 按视频比例撑满可用边、居中', ()=>{
  // 手机横屏 844x390, 3:4 竖版视频 → 高为约束: h=390, w=292.5, 居中
  const b=R_phone('girlFxTargetBox("phone", {left:10,top:10,width:50,height:66}, 844,390, 0.75)');
  assert.ok(Math.abs(b.height-390)<1, '高应撑满390, 实际'+b.height);
  assert.ok(Math.abs(b.width-292.5)<1, '宽应=390*0.75, 实际'+b.width);
  assert.ok(Math.abs(b.left-(844-292.5)/2)<1, '水平居中');
  assert.ok(Math.abs(b.top-0)<1, '垂直居中(高撑满→top0)');
});
check('girlFxTargetBox: phone 比例已知变化(2:3)也生效', ()=>{
  const b=R_phone('girlFxTargetBox("phone", {left:0,top:0,width:50,height:66}, 844,390, 0.667)');
  assert.ok(Math.abs(b.height-390)<1);
  assert.ok(Math.abs(b.width-390*0.667)<1, '宽=高*aspect');
});
check('girlFxTargetBox: fullscreen/无锚点 返回 null', ()=>{
  assert.strictEqual(R_tablet('girlFxTargetBox("fullscreen", {left:0,top:0,width:10,height:10}, 800,600, 0.75)'), null);
  assert.strictEqual(R_phone('girlFxTargetBox("phone", null, 844,390, 0.75)'), null);
});

console.log('\ngirl_fx_layer: '+passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
