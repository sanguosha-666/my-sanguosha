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

check('triggerGirlFx: 平板 → 转调 triggerMovieFx, #girlFxVideo 不动', ()=>{
  const run=R_tablet;
  run(`window.triggerMovieFx=function(k){ global.__m=(global.__m||[]).concat(k); };`);
  run(`triggerMovieFx=window.triggerMovieFx;`);
  run(`document.getElementById=function(id){ return id==='girlFxVideo' ? {style:{},classList:{add(){},remove(){}}, load(){},play(){return{catch(){}}},pause(){},removeAttribute(){}} : null; };`);
  run(`triggerGirlFx({path:'assets/video/daqiao-xiuse.mp4', seat:0, selfSeat:1});`);
  assert.ok(run(`(global.__m||[]).indexOf('assets/video/daqiao-xiuse.mp4')>=0`), '应回退到 triggerMovieFx');
});
check('triggerGirlFx: 桌面但座位不可见(girlFxAnchorRect 返回 null)→ 回退全屏', ()=>{
  const run=R_desktop;
  run(`window.triggerMovieFx=function(k){ global.__m=(global.__m||[]).concat(k); }; triggerMovieFx=window.triggerMovieFx;`);
  run(`girlFxAnchorRect=function(){ return null; };`);
  run(`document.getElementById=function(){ return {style:{},classList:{add(){},remove(){}}, load(){},play(){return{catch(){}}},pause(){},removeAttribute(){},addEventListener(){}}; };`);
  run(`triggerGirlFx({path:'assets/video/xiaoqiao-mamu.mp4', seat:3, selfSeat:0});`);
  assert.ok(run(`(global.__m||[]).indexOf('assets/video/xiaoqiao-mamu.mp4')>=0`));
});
check('girlFxAnchorRect: 正常头像矩形返回原值', ()=>{
  const run=loadGameBg('desktop');
  run(`document.querySelector=function(sel){ if(sel==='.seat[data-seat="2"] .seat-art') return { getBoundingClientRect(){ return {left:10,top:20,width:100,height:133,right:110,bottom:153}; } }; return null; };`);
  run(`window.innerWidth=1400; window.innerHeight=900;`);
  const got=run(`girlFxAnchorRect(2)`);
  assert.strictEqual(got.left,10); assert.strictEqual(got.top,20);
  assert.strictEqual(got.width,100); assert.strictEqual(got.height,133);
});
check('girlFxAnchorRect: 宽<2px 返回 null', ()=>{
  const run=loadGameBg('desktop');
  run(`document.querySelector=function(){ return { getBoundingClientRect(){ return {left:0,top:0,width:1,height:10,right:1,bottom:10}; } }; };`);
  assert.strictEqual(run(`girlFxAnchorRect(0)`), null);
});
check('girlFxAnchorRect: 视口相交<50% 返回 null', ()=>{
  const run=loadGameBg('desktop');
  // 头像 100x100 在 (0,0), 视口 1400x900 下大半被裁: 模拟 right 30 只有 30% 可见
  run(`document.querySelector=function(){ return { getBoundingClientRect(){ return {left:-70,top:0,width:100,height:100,right:30,bottom:100}; } }; };`);
  run(`window.innerWidth=1400; window.innerHeight=900;`);
  assert.strictEqual(run(`girlFxAnchorRect(0)`), null);
});
check('girlFxAnchorRect: querySelector 返回 null 时返回 null', ()=>{
  const run=loadGameBg('desktop');
  run(`document.querySelector=function(){ return null; };`);
  assert.strictEqual(run(`girlFxAnchorRect(5)`), null);
});
check('triggerGirlFx 世代令牌: 旧触发的缩回 timer 不杀新动画', ()=>{
  const run=loadGameBg('desktop');
  // 注入可控视频与可控 anchor, 以及可捕获 timer 的 setTimeout
  run(`
    var __fakeVideo={style:{visibility:'hidden'},classList:{add(){},remove(){}},load(){},pause(){},removeAttribute(){},addEventListener(){},_girlEpoch:0,_girlMode:null,_girlAnchor:null,src:''};
    __fakeVideo.play=function(){ return {catch(fn){ __fakeVideo._catch=fn; }}; };
    document.getElementById=function(id){ return id==='girlFxVideo'?__fakeVideo:null; };
    document.querySelector=function(){ return { getBoundingClientRect(){ return {left:50,top:50,width:80,height:106,right:130,bottom:156}; } }; };
    window.innerWidth=1400; window.innerHeight=900;
    document.documentElement={clientWidth:1400,clientHeight:900};
    window.matchMedia=function(q){ return {matches:/hover:\\s*hover/.test(q)&&/pointer:\\s*fine/.test(q)}; };
    // 捕获 setTimeout 回调
    var __timers=[];
    var _origSetTimeout=setTimeout;
    setTimeout=function(fn,ms){ __timers.push(fn); return 1; };
    // 绑定 triggerMovieFx 空实现避免回退分支
    window.triggerMovieFx=function(){};
    triggerMovieFx=window.triggerMovieFx;
  `);
  // 第一次触发 A
  run(`triggerGirlFx({path:'assets/video/a.mp4', seat:0, selfSeat:0});`);
  // 立即让 A 进入结束流程 (模拟 ended → girlFxEnd(false) 排 timer)
  run(`girlFxEnd(__fakeVideo,false);`);
  assert.strictEqual(run(`__timers.length`), 1, 'A 应排一个缩回 timer');
  // 第二次触发 B (应递增 epoch, 使 A 的 timer 过期)
  run(`triggerGirlFx({path:'assets/video/b.mp4', seat:0, selfSeat:1});`);
  assert.strictEqual(run(`__fakeVideo.src`), 'assets/video/b.mp4', 'B 应覆盖 src');
  // 执行 A 的过期 timer, 不应隐藏 B
  run(`var _t=__timers[0]; __timers=[]; _t();`);
  assert.strictEqual(run(`__fakeVideo.style.visibility`), 'visible', 'B 不应被 A 的过期 timer 隐藏');
  // B 的结束 timer 仍有效: 触发 B 的结束并执行其 timer 应隐藏
  run(`girlFxEnd(__fakeVideo,false);`);
  assert.strictEqual(run(`__timers.length`), 1, 'B 应排新 timer');
  run(`__timers[0]();`);
  assert.strictEqual(run(`__fakeVideo.style.visibility`), 'hidden', 'B 的正常结束应隐藏');
});

console.log('\ngirl_fx_layer: '+passed+' passed, '+failed+' failed');
process.exit(failed?1:0);
