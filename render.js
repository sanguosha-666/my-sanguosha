// ---------- 座位卡片头像 ----------
// generalAvatarSrc: 按 id 拼路径的约定式查询(不在 GENERALS 表里存 img 字段)——和 getGeneral(id)
// 是唯一查询入口同一个道理,业务层永远调这个函数,不硬编码路径。"以后换图"只需要覆盖
// assets/generals/{id}.jpg(或同 id 的其它格式,见 avatarError),不用碰这里的代码。
function generalAvatarSrc(id){ return 'assets/generals/'+id+'.jpg'; }
// avatarError: <img onerror> 挂载。依次尝试 jpg(默认) → jpeg → png → webp → gif → svg,
// 这是为了"以后素材可能换成同 id 的其它常见格式"这个场景不用改代码,只要文件名前缀(id)不变。
// 全部格式都试完仍失败(比如日后新增武将暂时没配图)才真正隐藏 <img>、显示占位块——
// 不能只隐藏不管,浏览器会在原地画一个"图裂了"的破图标,必须真正 display:none 才行。
// 【曾经的闪烁 bug】默认格式曾经是 svg,但项目里实际所有武将素材都是 .jpg,没有任何 .svg
// 文件——导致每次渲染头像都必然先经历一次注定失败的 .svg 请求(等404)、fallback 到当时
// 排在前面的 .png(同样不存在,再失败一次),才轮到 .jpg 成功显示,这个"连续多次失败再成功"
// 的加载过程在每次页面重绘时都会重演一遍,就是头像闪烁的根源。现在默认直接用 jpg(和实际
// 素材一致,一次请求即可成功),svg 挪到 fallback 链末尾(不再作为默认首选,仅保留兼容,
// 万一以后真的换成 svg 素材)。
const AVATAR_FALLBACK_EXTS = ['jpeg','png','webp','gif','svg']; // 默认从 .jpg 开始(和当前实际素材一致,一次请求即可成功,不再有先失败几次的闪烁),失败后依次重试其它格式
function avatarError(imgEl){
  const tried = imgEl.dataset.avatarTry ? parseInt(imgEl.dataset.avatarTry, 10) : 0;
  if(tried >= AVATAR_FALLBACK_EXTS.length){
    imgEl.style.display='none';
    const ph = imgEl.parentElement && imgEl.parentElement.querySelector('.avatar-placeholder');
    if(ph) ph.style.display='flex';
    return;
  }
  const nextExt = AVATAR_FALLBACK_EXTS[tried];
  imgEl.dataset.avatarTry = String(tried+1);
  imgEl.src = imgEl.src.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, '.'+nextExt);
}

// ---------- 手牌卡面图(基本牌/普通锦囊/延时锦囊/装备牌,不含武将头像) ----------
// CARD_PINYIN: 牌名(与 data.js 的 CARD_DESC/EQUIPS 的 key 完全对应)→拼音文件名前缀的
// 约定式映射表,和 generalAvatarSrc 同一个道理——业务层永远查这张表,不硬编码路径。
// 图片是通用美术图(按牌名配一张,不按具体花色点数),所以每张牌实例真实的花色点数信息
// 靠 .corner 角标叠加显示,不受这张表影响。新增牌时在这里补一条映射即可。
const CARD_PINYIN = {
  '杀':'sha', '火杀':'huosha', '雷杀':'leisha', '闪':'shan', '桃':'tao', '酒':'jiu',
  '决斗':'juedou', '无中生有':'wuzhongshengyou', '顺手牵羊':'shunshouqianyang',
  '过河拆桥':'guohechaiqiao', '无懈可击':'wuxiekeji', '南蛮入侵':'nanmanruqin',
  '万箭齐发':'wanjianqifa', '火攻':'huogong', '闪电':'shandian', '乐不思蜀':'lebusishu',
  '兵粮寸断':'bingliangcunduan', '借刀杀人':'jiedaosharen', '五谷丰登':'wugufengdeng',
  '桃园结义':'taoyuanjieyi', '铁索连环':'tiesuolianhuan',
  '诸葛连弩':'zhugeliannu', '雌雄双股剑':'cixiongshuanggujian', '青釭剑':'qinggangjian', '青龙偃月刀':'qinglongyanyuedao',
  '丈八蛇矛':'zhangbashemao', '贯石斧':'guanshifu', '方天画戟':'fangtianhuaji',
  '麒麟弓':'qilingong', '寒冰剑':'hanbingjian', '古锭刀':'gudingdao',
  '八卦阵':'baguazhen', '仁王盾':'renwangdun',
  '的卢':'dilu', '绝影':'jueying', '爪黄飞电':'zhuahuangfeidian',
  '赤兔':'chitu', '紫骍':'zixing', '大宛':'dawan', '骕骦':'sushuang'
};
const SKILL_PINYIN = {
  '天妒':'tiandu', '遗计':'yiji', '枭姬':'xiaoji', '反馈':'fankui',
  '鬼才':'guicai', '龙胆':'longdan', '武圣':'wusheng', '奇袭':'qixi',
  '苦肉':'kurou', '集智':'jizhi', '制衡':'zhiheng', '奸雄':'jianxiong',
  '反间':'fanjian',
  '仁德':'rende', '激昂':'jiang', '青囊':'qingnang', '急救':'jijiu',
  '刚烈':'ganglie', '裸衣':'luoyi', '驱虎':'quhu', '节命':'jieming',
  '国色':'guose', '流离':'liuli', '天香':'tianxiang', '红颜':'hongyan',
  '连环':'lianhuan', '涅槃':'niepan', '离间':'lijian', '闭月':'biyue',
  '双雄':'shuangxiong',
  '礼让':'lirang', '争义':'zhengyi',
  '恂恂':'xunxun', '忘隙':'wangxi', '狂骨':'kuanggu',
  '神速':'shensu',
  '天义':'tianyi',
  '完杀':'wansha', '乱武':'luanwu', '帷幕':'weimu',
  '雷击':'leiji', '鬼道':'guidu',
  '乱击':'luanji',
  '同疾':'tongji',
  '妄尊':'wangzun',
  '悲歌':'beige', '断肠':'duanchang',
  '巨象':'juxiang', '烈刃':'lieRen',
  '明策':'mingce', '智迟':'zhichi',
  '旋风':'xuanfeng',
  '短兵':'duanbing',
  '奋迅':'fenxun',
  '恩怨':'enyuan',
  '眩惑':'huanhuo',
  '无言':'wuyan', '举荐':'jujian',
  '将驰':'jiangchi',
  '落英':'luoying', '酒诗':'jiushi'
};
// cardImageSrc: 映射表里没有这张牌名(比如以后加新牌但没先配这里)时返回 null,调用方按
// null 处理成"没有插画图片可用"——牌名文字始终固定显示在 .card-title 标题栏,不受这个
// 判断影响,和早期"图片铺满全卡、靠no-art控制牌名文字显示/隐藏"那版不同(见 CLAUDE.md)。
function cardImageSrc(name){
  const py = CARD_PINYIN[name];
  return py ? ('assets/cards/'+py+'.jpg') : null;
}
// CARD_FALLBACK_EXTS: 和 AVATAR_FALLBACK_EXTS 同款设计——默认 jpg 优先(cardImageSrc 已经
// 直接返回 .jpg),这里只需要列出"jpg失败之后"还要依次重试的格式,不需要再包含jpg本身。
const CARD_FALLBACK_EXTS = ['jpeg','png','webp','gif'];
// cardImgError: <img onerror> 挂载。全部格式都试完仍失败(比如这张牌暂时还没准备图片素材)
// 才真正隐藏 <img>、给 .card 加上 no-art 标记——让 CSS 给插画区域(.card-art-box)显示一块
// 占位底色,不留完全空白/破图标。牌名文字(.card-title)不受这个标记影响,本来就始终显示。
function cardImgError(imgEl){
  const tried = imgEl.dataset.cardTry ? parseInt(imgEl.dataset.cardTry, 10) : 0;
  if(tried >= CARD_FALLBACK_EXTS.length){
    imgEl.style.display='none';
    const cardEl = imgEl.closest('.card');
    if(cardEl) cardEl.classList.add('no-art');
    return;
  }
  const nextExt = CARD_FALLBACK_EXTS[tried];
  imgEl.dataset.cardTry = String(tried+1);
  imgEl.src = imgEl.src.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, '.'+nextExt);
}

let currentG = null; // 最近一次 render 收到的 g,供确认弹窗取消时重新渲染
// 日志浮层:默认收起,点 #logBtn 打开,复用 showInfo/#infoModal 机制(见 renderLogModal)。
// 这个标志只是"面板现在开着吗",供 render() 判断要不要跟着这次状态更新同步刷新面板内容。
let logModalOpen = false;
// getPlayerDisplayLabel: 日志里玩家的显示文本。**可见性规则必须和座位卡一致**——座位卡用
// avatarReady = g.started && gen 判断"能不能亮出具体武将"(见 renderSeats 附近注释:选将阶段
// p.general 选完就已经写进共享状态,但正式开局前仍是隐藏信息,只判断 gen 非空会在选将阶段
// 提前剧透,是真实修过的信息泄露 bug)。这里同样以 g.started 为准，不只看 p.general 有没有值：
// 未开局(含选将阶段)一律只显示玩家名，开局后才显示"武将名(玩家名)"。
function getPlayerDisplayLabel(g, p){
  if(!p) return '';
  const gen = (g && g.started && p.general!=null) ? getGeneral(p.general) : null;
  return gen ? (gen.name+'('+p.name+')') : p.name;
}
function chainedTagText(g, seat){
  const p=g.players && g.players[seat];
  if(!g.started || !p || !p.chained) return '';
  const others=(g.players||[])
    .map((op,i)=>({op,i}))
    .filter(o=>o.i!==seat && o.op && o.op.alive && o.op.chained)
    .map(o=>{
      const gen=getGeneral(o.op.general);
      return gen ? gen.name : o.op.name;
    });
  return others.length ? ('连环-'+others.join('/')) : '连环';
}

// ===== "轮到你了"提示:语音 + 大字视觉双重触发,同一个去重 key(见 render() 里的调用点) =====
// lastAnnouncedTurnKey:哨兵初始值 null(不是 undefined——这里不需要"第一次render不提示历史"
// 这套逻辑,一开始就没有任何"已提示过的轮次",null 天然和任何真实 turnKey 字符串都不相等)。
let lastAnnouncedTurnKey = null;
// announceMyTurn:用浏览器内置 SpeechSynthesis 播报"轮到你了"。浏览器的自动播放策略可能在
// 玩家还没和页面发生过任何交互时静默拒绝播放(不抛错、就是没声音)——showMyTurnBanner 是
// 专门给这种情况准备的视觉兜底,两者同时触发,不互相依赖对方是否成功。
function announceMyTurn(){
  try{
    if(!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance('轮到你了');
    u.lang = 'zh-CN';
    window.speechSynthesis.cancel(); // 避免多次快速触发时语音排队堆积
    window.speechSynthesis.speak(u);
  }catch(e){ /* 语音播放失败静默忽略,反正有大字视觉兜底 */ }
}
// showMyTurnBanner: 居中大字短暂覆层,和 showLogToast 同一套"class 加/减触发CSS动画"写法,
// 但视觉上更醒目(更大字号、居中、短暂遮罩),专用于"轮到我了"这一个场景,不复用常驻的
// .banner(那是被决斗/技能询问等很多场景复用的"当前该谁做什么"提示条,改大会影响那些场景)。
function showMyTurnBanner(){
  const el = document.getElementById('myTurnBanner');
  if(!el) return;
  el.textContent = '轮到你了';
  el.classList.remove('show');
  void el.offsetWidth; // 强制回流,保证连续触发时动画能重新播放(和 showLogToast 的写法一致)
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(()=>{ el.classList.remove('show'); }, 1800);
}

// ===== 音频引擎解锁(手机浏览器,尤其 iOS Safari,自动播放策略要求) =====
// 移动端浏览器(尤其 iOS Safari)的自动播放策略:音频播放必须紧跟一次真实的用户手势
// (点击/触摸)才会被允许,由 Firebase 异步事件(别人操作后同步过来的状态变化)触发的
// render()→play() 完全不在用户手势的调用栈里,会被静默拒绝(Promise reject,不抛同步异常)。
// 这解释了真实反馈的现象:自己主动点击出牌/出闪之类的操作,点击本身就是用户手势,播放能
// 通过;别人操作后异步推送过来触发的语音,没有这层手势,在手机上被拦截——桌面浏览器的自动
// 播放策略普遍宽松得多,两端表现不一致。
// 标准解法:页面第一次收到任意点击/触摸时,主动播放一次(不需要真的发出声音,play()后立刻
// pause()即可)来"解锁"这个页面生命周期内浏览器的音频引擎,之后同一页面里由异步事件触发的
// 播放就不再被当成"和用户手势无关"而拦截。只需全局解锁一次,不需要每次播放前都重新解锁。
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
  audioUnlocked = true;
  try{
    const silent = new Audio();
    silent.src = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA';
    const p = silent.play();
    if(p && p.catch) p.catch(()=>{}); // 解锁本身失败也不影响后续逻辑,只是"多一次机会没抓住"
    silent.pause();
  }catch(e){}
}
// 监听器要在页面加载后尽早注册(不等进入房间),玩家第一次点"加入房间"或任何按钮时就顺带解锁,
// 不需要额外引导玩家做什么特殊操作。{once:true} 保证只解锁一次,不重复播放这个静音音频。
document.addEventListener('touchstart', unlockAudioOnce, {once:true, passive:true});
document.addEventListener('click', unlockAudioOnce, {once:true, passive:true});

// ===== 强制横屏软引导(骨架级重建阶段3) =====
// CSS/浏览器原生的 Screen Orientation Lock API 支持非常有限(iOS Safari 完全不支持),
// 这个项目是普通网页、不是安装到主屏幕的 PWA,没有条件依赖那套 API 真正锁死方向——标准
// 做法是软引导:检测到当前是竖屏就盖一层全屏遮罩提示手动旋转,不做任何"真正锁定"的尝试。
// isPortrait 优先用 matchMedia(标准、能响应 resize/orientationchange 事件),极少数不支持
// matchMedia 的环境退回宽高比较——这只是兜底,不追求精确到"设备物理方向"这种细节,单纯
// "宽>高就当横屏"这个近似对这个用途完全够用。
function isPortrait(){
  // 以实际可交互视口为准。部分内嵌浏览器/桌面缩放环境的 orientation media query 会沿用
  // 设备自然方向，明明当前内容区宽>高仍报告 portrait，导致全屏遮罩错误拦截所有按钮。
  if(Number.isFinite(window.innerWidth)&&Number.isFinite(window.innerHeight)&&window.innerWidth>0&&window.innerHeight>0){
    return window.innerHeight > window.innerWidth;
  }
  return !!(window.matchMedia&&window.matchMedia('(orientation: portrait)').matches);
}
function checkLandscapeGate(){
  const gate = document.getElementById('landscapeGate');
  if(!gate) return;
  gate.classList.toggle('hidden', !isPortrait());
}
// 和 unlockAudioOnce 同一套写法:页面加载后立即注册监听、立即跑一次初始检测,不等进入
// 房间/不等第一次 render(g)——大厅表单和游戏内视图都需要这层引导,不依赖任何游戏状态。
checkLandscapeGate();
window.addEventListener('resize', checkLandscapeGate);
window.addEventListener('orientationchange', checkLandscapeGate);

// ===== 宽屏桌面布局(desktop-layout-8p 第3步骨架) =====
// assignSeatZones(playerCount, mySeat): 纯函数,把"我"以外的座位分到 top/left/right
// 三个区域(见函数内注释),"我"自己固定 'me'。返回数组按座位号索引取值。
// 分区规则(过渡态刻意从简,不追求精雕细琢):
//   - 对手数(others=playerCount-1) <=3(即2~4人局): 全部 top
//   - others===4(5人局): top3 + left1
//   - others===5(6人局): top3 + left2
//   - others>=6(7/8人局): top3 + left2 + right(others-5),7人局right1、8人局right2,
//     同一条公式覆盖两档,不用为7人单独写分支。
// 区内顺序按绝对座位号从小到大(不随mySeat旋转),保证同一输入永远同一输出。
function assignSeatZones(playerCount, mySeat){
  const zones = new Array(playerCount);
  zones[mySeat] = 'me';
  const others = [];
  for(let s=0; s<playerCount; s++){
    if(s!==mySeat) others.push(s);
  }
  const n = others.length;
  let topCount, leftCount, rightCount;
  if(n<=3){
    topCount = n; leftCount = 0; rightCount = 0;
  } else if(n===4){
    topCount = 3; leftCount = 1; rightCount = 0;
  } else if(n===5){
    topCount = 3; leftCount = 2; rightCount = 0;
  } else {
    // n===6(7人局): top3+left2+right1；n===7(8人局): top3+left2+right2
    topCount = 3; leftCount = 2; rightCount = n - 5;
  }
  let i = 0;
  for(let k=0;k<topCount;k++)   zones[others[i++]] = 'top';
  for(let k=0;k<leftCount;k++)  zones[others[i++]] = 'left';
  for(let k=0;k<rightCount;k++) zones[others[i++]] = 'right';
  return zones;
}
// isDesktopLayout(): 宽屏(>=1024px)专属"座位按上/左/右/我四区摆位"布局是否启用的唯一
// 开关——和 isPortrait()/checkLandscapeGate() 同一套写法,页面加载后立即算一次+注册
// resize 监听动态更新,不是只在加载那一刻判断一次。desktopLayoutActive 这个标志位供
// render() 决定要不要计算/写入 data-zone,后续步骤(日志面板挪位置/内容密度分支)会
// 复用同一个标志位,不重复判断。#game 上的 desktop-layout class 只是把这个 JS 判断结果
// 同步给 CSS(CSS 自己的 @media(min-width:1024px) 断点是双重保险,两边同时满足才生效)。
let desktopLayoutActive = false;
function isDesktopLayout(){ return window.innerWidth >= 1024; }
function updateDesktopLayoutFlag(){
  desktopLayoutActive = isDesktopLayout();
  const gameEl = document.getElementById('game');
  if(gameEl) gameEl.classList.toggle('desktop-layout', desktopLayoutActive);
}
updateDesktopLayoutFlag();
// updateLogPanelHeight(): 第8步——日志面板的高度不能靠纯CSS的grid-row:span N声明
// (最初的实现方式),因为"座位区+中央出牌区"这个组合的真实渲染底边,在不同人数/座位
// 组合下,既可能比#tableStrip自身的渲染框更低(#tableStrip用align-self:center只占
// 约64px、被更高的座位卡挤在中间时——8人局left/right都占满的场景),也可能反过来
// (5人局这类left/right没坐满、tableStrip自身的最小高度反而撑出了原本没有座位卡的
// 那一行,导致按grid行数对齐会比座位卡实际渲染的位置多出一截)。两个方向都可能出问题,
// 靠纯CSS写死"跨几行"算不出正确结果,只能在JS里动态测量实际渲染出来的位置:取
// "#oppTopRow/#oppRow 内所有座位卡的底边"(注意排除#meSeat——那是"我"的座位卡,
// 已经合并到手牌那一行,不属于"座位区+中央出牌区"这个范围,如果不排除会把日志面板
// 撑到页面最下面)和"#tableStrip自身底边"两者中更靠下(视口坐标更大)的那一个,减去
// 日志面板自身的顶边,换算成一个具体像素高度,直接用内联style覆盖掉CSS里那份声明
// (那份CSS的grid-row:1/span 3依然保留在index.html里,是这个JS计算失效时的兜底,
// 比如极端边界下座位/tableStrip都不存在时这个函数会直接不设置任何内联高度)。
function updateLogPanelHeight(){
  const logEl = document.getElementById('logPanel');
  if(!logEl) return;
  if(!desktopLayoutActive){
    logEl.style.height=''; // 窄屏下清掉可能残留的内联高度,让窄屏自己的CSS(max-height:132px等)重新生效
    return;
  }
  let maxBottom = -Infinity;
  document.querySelectorAll('#oppTopRow .seat, #oppRow .seat').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(r.bottom>maxBottom) maxBottom=r.bottom;
  });
  const tableStripEl=document.getElementById('tableStrip');
  if(tableStripEl){
    const r=tableStripEl.getBoundingClientRect();
    if(r.bottom>maxBottom) maxBottom=r.bottom;
  }
  if(maxBottom===-Infinity) return; // 理论边界:座位卡和tableStrip都不存在(尚未开局等),不设置,交给CSS兜底
  const logTop = logEl.getBoundingClientRect().top;
  const height = maxBottom - logTop;
  if(height>0) logEl.style.height = height+'px';
}
window.addEventListener('resize', () => { updateDesktopLayoutFlag(); updateLogPanelHeight(); });

// 常驻"关闭房间"按钮(cleanupRoom):只需要绑定一次,不放进render(g)里——这是一个固定
// 挂在页面角落、不随游戏状态变化的元素,和 #helpBtn/#logBtn 同一类"页面初始化时绑一次"
// 的静态入口,不需要每次重绘都重新赋值 onclick(重复赋值同一个函数本身无害,但没必要)。
document.getElementById('closeRoomBtn').onclick = cleanupRoom;

// ===== 打出手牌语音:所有在场玩家(不只是出牌的人自己)都应该听到,靠共享状态
// g.lastCardSound(game.js 的 markCardSound 在每个"真正打出/使用一张牌"的关键节点写入)
// 同步触发,和 lastAnnouncedTurnKey 同一套去重模式(哨兵值+序号比较,不是比较牌名文本——
// 连续两次打出同一张牌名,如果只比较文本会被误判成同一个事件而漏播,详见 markCardSound
// 的 seq 自增设计)。 =====
let lastPlayedCardSeq = undefined;
function maybePlayCardSound(g){
  if(!g.lastCardSound) return;
  if(lastPlayedCardSeq===undefined){ lastPlayedCardSeq=g.lastCardSound.seq; return; } // 首次进入房间/刷新页面,不补放历史
  if(g.lastCardSound.seq===lastPlayedCardSeq) return;
  lastPlayedCardSeq = g.lastCardSound.seq;
  const py = CARD_PINYIN[g.lastCardSound.name];
  if(!py) return; // 没有对应语音文件的牌,静默跳过,不报错
  try{
    const audio = new Audio('assets/audio/'+py+'.mp3');
    // 播放失败原因打进console.warn(不是静默吞掉),方便真机排查——重点看err.name是不是
    // 'NotAllowedError'(浏览器自动播放策略拦截,标准解法见上面的unlockAudioOnce)还是别的
    // 原因(如404文件不存在)。这不影响游戏运行,失败与否都不会抛出未捕获异常。
    audio.play().catch(err=>console.warn('卡牌语音播放失败:', py, err && err.name, err));
  }catch(e){}
}
// maybePlaySkillSound: 和 maybePlayCardSound 同一模式,独立字段(lastSkillSound)+独立哨兵变量。
let lastPlayedSkillSeq = undefined;
function maybePlaySkillSound(g){
  if(!g.lastSkillSound) return;
  if(lastPlayedSkillSeq===undefined){ lastPlayedSkillSeq=g.lastSkillSound.seq; return; }
  if(g.lastSkillSound.seq===lastPlayedSkillSeq) return;
  lastPlayedSkillSeq = g.lastSkillSound.seq;
  const py = SKILL_PINYIN[g.lastSkillSound.name];
  if(!py) return;
  try{
    const audio = new Audio('assets/audio/'+py+'.mp3');
    audio.play().catch(err=>console.warn('技能语音播放失败:', py, err && err.name, err));
  }catch(e){}
}


// ===== 出牌确认弹窗:独立于 showInfo(那是"只读说明+关闭",这里是"确定/取消"两种不同结果) =====
function showConfirm(message, onOk, onCancel){
  const m=document.getElementById('confirmModal');
  m.innerHTML='<div class="confirm-panel"><div class="confirm-msg">'+escapeHtml(message)+'</div>'
    +'<div class="confirm-btns"><button class="ghost" id="confirmCancel">取消</button><button class="primary" id="confirmOk">确定</button></div></div>';
  m.classList.remove('hidden');
  const hide=()=>{ m.classList.add('hidden'); m.innerHTML=''; };
  m.querySelector('#confirmOk').onclick=()=>{ hide(); onOk(); };
  m.querySelector('#confirmCancel').onclick=()=>{ hide(); onCancel(); };
  m.onclick=(e)=>{ if(e.target===m){ hide(); onCancel(); } };
}
// resetSelectionState: 从 confirmAndPlay 原来的内部私有闭包 cleanup 提取出来的独立函数——
// 纯提取重构,行为零变化,只是让 confirmOwnOrSha(按原效果用/当杀 二选一弹窗)也能调用同一份
// "清空全部客户端选牌/选目标状态"逻辑,不用另外复制一份 reset* 列表。
function resetSelectionState(){
  selectedCardIdx=null; forcedShaCardId=null; resetZhangba(); resetDuanliang(); resetQixi(); resetGuose(); resetLianhuan(); resetTiesuo(); resetQingnang(); resetZhiheng(); resetQiaobian(); resetJiedao(); resetFangtian(); resetGanglie(); resetQuhu(); resetLijian(); resetFanjian(); resetLirang(); resetTiaoxin(); resetDimeng(); resetSanyao();
}
// confirmAndPlay: 出牌四类触发点(选目标/不选目标/丈八两张当杀)统一委托的包装——
// 无论确定还是取消都先清空客户端选牌状态(selectedCardIdx/zhangba*),只有确定才真正执行 actionFn。
// 只插在"UI 已决定要调用出牌函数"和"真正调用"之间一道用户复核,不碰 canPlay/canTarget 等校验。
function confirmAndPlay(message, actionFn){
  showConfirm(message,
    // 确定后也立即 render(currentG):cleanup 清空的是 JS 变量,不会自动重绘 DOM——网络往返
    // (playCard 的 tx)完成前,旧的座位/手牌节点(连同其 onclick)会一直留在页面上可点。
    // 立即重绘让"选目标"相关的 onclick 不再被挂上(selectedCardIdx 已是 null),防止这段
    // 等待期内误触第二下(常见于手机网络延迟)。
    ()=>{ resetSelectionState(); render(currentG); actionFn(); },
    ()=>{ resetSelectionState(); render(currentG); });
}
// forcedShaCardId: 武圣类(目前只有关羽)"这张牌自己有独立入口、但也能当杀使用"场景下,玩家在
// confirmOwnOrSha 弹窗里明确选择"当杀"后记录的那张牌的 id(用 id 不用下标,避免手牌
// 数组变动导致下标错位)。只在这一种场景下被设置,和 selectedCardIdx 同步在
// resetSelectionState 里清空,不持久化(不进 g,纯客户端本地状态)。
let forcedShaCardId = null;
// resolveActionId: 点一张手牌该按"它自己的牌名"结算,还是按"当杀"结算(赵云龙胆/关羽武圣)——
// 优先它自己的 CARD_PLAYS 入口:只要这张牌本身就是一张能主动出的牌(CARD_PLAYS[card.name] 存在
// 且此刻 canPlay),就按它自己的效果走,"点哪张牌就是哪张牌的效果",符合直觉。只有这张牌本身
// 没有独立可出的入口时(目前只有【闪】——它从来不是主动可出的 CARD_PLAYS 项,只能被动响应)才走
// canUseAs 的转化路径。这样关羽武圣/甄姬倾国拿到一张红/黑色的无中生有/南蛮入侵/过河拆桥等"本身
// 就有效果"的牌时,默认还是按它自己的效果走,不会被误判成杀(此前的真实 bug:这类牌被强制当成
// 杀,点击只会"选中"而不触发确认框,或错误套用杀的攻击距离限制);而武圣/倾国对【闪】的转化、
// 赵云龙胆的双向转化完全不受影响,因为【闪】走不到"自己的 CARD_PLAYS 入口"这条路,天然落回转化。
// 注意:这只管"主动点一张牌该按什么结算"这一层客户端判断——决斗出杀/濒死出桃/打闪/万箭出闪
// 这类被动响应场景依然直接用 canUseAs/findUsableAs 找"任意能顶替用的牌",不经过这个函数,
// 武圣/倾国/龙胆在那些场景的转化能力完全不受影响(那正是这些技能的核心用途)。
//
// forcedShaCardId 覆盖:装备牌/target:false 的红牌(见 confirmOwnOrSha)这类"自己有独立入口、同时也能当杀"的牌,
// 原本的优先级规则会让"自己的入口"100%胜出,玩家永远点不到"当杀"这个选项——一旦玩家在
// 二选一弹窗里明确选了"当杀",这里在最前面加一行判断直接返回'杀',后续座位点击/目标高亮/
// playCard 的 actionId 等所有重新调用 resolveActionId 的地方(render.js 座位循环3处、
// render-controls.js 选中面板1处)天然全部尊重这次选择,不需要各处分别打补丁。对
// card.id!==forcedShaCardId 的绝大多数调用(99.99%的场景),这一行恒假,不影响原有逻辑。
function resolveActionId(g, me, card){
  if(card && forcedShaCardId!==null && card.id===forcedShaCardId) return '杀';
  const ownSpec = CARD_PLAYS[card.name];
  if(ownSpec && ownSpec.canPlay(g, me, card)) return card.name;
  if(canUseAs(me, card, '杀')) return '杀';
  return card.name;
}
// confirmOwnOrSha: 武圣类(目前只有关羽)"这张牌自己有独立入口、但也能当杀使用"的二选一弹窗——
// 复用 showConfirm 同一个 #confirmModal 容器,但不走 showConfirm/confirmAndPlay 固定的
// 2按钮(确定/取消)语义,自己渲染3个按钮(按原效果用/当杀/取消),故意不改 showConfirm/confirmAndPlay
// 本身的签名或既有调用点行为。
//
// 【适用范围:target:false 的牌】这个弹窗处理的是"这张牌自己的用法不需要选目标"的情况——
// 装备牌(equipPlay,target:false)+ 6 张 target:false 的普通红牌(桃/无中生有/五谷丰登/桃园结义/
// 酒/万箭齐发)。它们点击即出、没有目标选择流程要保护,所以"立即3选1"这个形状合适。
// 调用方的 gate 见 render-hand.js:结构化判断 ownSpec && !ownSpec.target && ownSpec.canPlay(...)
// && CARD_PLAYS['杀'].canPlay(...),不硬编码牌名、不查 getEquip(遵循规则5),以后新增同型牌零改动。
//
// 【和座位按钮的分工】target:true 的牌(乐不思蜀/闪电/决斗/顺手牵羊/过河拆桥/火攻 共9张红牌)
// 两种用法都要选目标、必须同屏共存,走的是 render.js 座位循环里的"武圣:杀"独立按钮,不走这里
// ——两套机制共用同一个触发判据,只按 spec.target 分流,天然互斥不重叠。
//
// 【文案不逐牌适配】第一个按钮/描述里的动词由 ownSpec.noDiscard 派生(noDiscard 是项目里既有的
// "这是装备牌"统一标志,playConfirmMsg 也是这么用的、注释明写"不硬编码牌名"),装备→"直接装备/装备",
// 其余→"按原本的效果使用/使用【X】"。装备牌的文案和改动前逐字一致。
function confirmOwnOrSha(card, idx){
  const ownSpec = CARD_PLAYS[card.name];
  const isEquip = !!(ownSpec && ownSpec.noDiscard);
  const ownVerb = isEquip ? '直接装备' : '按原本的效果使用';
  const ownBtn  = isEquip ? '装备' : '使用【'+escapeHtml(card.name)+'】';
  const m=document.getElementById('confirmModal');
  m.innerHTML='<div class="confirm-panel"><div class="confirm-msg">【'+escapeHtml(card.name)+'】可以'+ownVerb+',也可以当【杀】使用,请选择：</div>'
    +'<div class="confirm-btns"><button class="ghost" id="confirmCancelOwn">取消</button>'
    +'<button class="primary" id="confirmAsSha">当【杀】使用</button>'
    +'<button class="primary" id="confirmAsOwn">'+ownBtn+'</button></div></div>';
  m.classList.remove('hidden');
  const hide=()=>{ m.classList.add('hidden'); m.innerHTML=''; };
  // 这两个分支都是牌种类无关的,不需要按牌种类各自路由:playCard 内部自己查 CARD_PLAYS[actionId]
  // 分派(装备拿到 equipPlay、桃拿到 CARD_PLAYS['桃']),分派本来就在 playCard 里、不在这里。
  m.querySelector('#confirmAsOwn').onclick=()=>{ hide(); resetSelectionState(); render(currentG); playCard(idx, card.name); };
  m.querySelector('#confirmAsSha').onclick=()=>{ hide(); selectedCardIdx=idx; forcedShaCardId=card.id; render(currentG); };
  m.querySelector('#confirmCancelOwn').onclick=()=>{ hide(); };
  m.onclick=(e)=>{ if(e.target===m){ hide(); } };
}
function canShuangxiongDuelCard(player, card){
  return !!(player && card && hasCap(player,'shuangxiong') && player.shuangxiongColor
    && cardColorForPlayer(player, card)!==player.shuangxiongColor);
}
// playConfirmMsg: 按牌类型生成确认文案。装备用"装备"(spec.noDiscard 是装备牌的统一标志,不硬编码牌名),
// 其余用"使用";带目标的加上目标姓名;杀由非'杀'名的牌顶替时(赵云的闪)标注"当【杀】"。
function playConfirmMsg(g, actionId, card, targetSeat){
  const spec = CARD_PLAYS[actionId];
  if(spec && spec.noDiscard) return '装备【'+card.name+'】？';
  const label = (actionId==='杀' && card.name!=='杀') ? '【'+card.name+'】当【杀】'
    : (actionId==='决斗' && card.name!=='决斗') ? '【'+card.name+'】当【决斗】'
    : '【'+card.name+'】';
  if(spec && spec.target) return '对 '+g.players[targetSeat].name+' 使用'+label+'？';
  return '使用'+label+'？';
}

// ---------- 按座位号分配固定颜色(纯身份标识,不参与任何游戏状态,不入库) ----------
// 冷色调 8 色,按 hue 均匀展开(每两色间隔约24°),刻意避开现有语义色(朱红=--cinnabar/回合朱红框、
// 金=--gold/回合金框、玉=--jade)所在的暖色/绿色区间。按座位号(非名字)分配,同局内 SEATS(≤3)人
// 或以后更多人,只要座位号不同、颜色必然不同——不会因为名字巧合 hash 到相近色。
const NAME_COLORS = ['#3B82C4','#2FBF71','#C4519B','#B8A22F','#8B5FBF','#D9713C','#4FA8A8','#C4C44F'];
function seatColor(seat){ return NAME_COLORS[((seat%NAME_COLORS.length)+NAME_COLORS.length)%NAME_COLORS.length]; }

// setBanner: banner 是唯一常驻可见的焦点行(原来 render() 里独立维护一份 banner + renderControls
// 里独立维护一份 hint,两处各写各的、经常重复或遗漏——现在只有 renderControls 这一处书写者,
// 每个分支把"谁对谁/发生了什么"和"你该做什么(含没有可用牌等兜底提示)"合并成一句话。
// style 可选,仅 game-over 播报胜利时需要金色特殊样式。
function setBanner(html, style){
  document.getElementById('banner').innerHTML = html ? '<div class="banner"'+(style?' style="'+style+'"':'')+'>'+html+'</div>' : '';
}

// 座位卡装备行的单字缩写——刻意和 render-controls.js 的 EQUIP_SLOT_LABEL(完整词:
// 武器/防具/防御马/进攻马,用于顺手牵羊/过河拆桥选牌列表等场景)分开维护,不能简单取
// EQUIP_SLOT_LABEL 的首字——"防具"和"防御马"都以"防"开头,直接截取会让两个槽位的
// 缩写撞在一起,4个字符必须两两不同。
const EQUIP_SLOT_ABBR = { weapon:'武', armor:'防', plus1:'御', minus1:'攻' };

// 座位卡装备行的花色+点数。**不能直接用 data.js 的 cardFace(card)**——它把颜色写死成
// inline style(红 #b33 / 黑 #3a2f28),那套配色是给**浅色背景**设计的(当初装备条是不透明
// 白底)。第5次微调把白底条换成"白字+深色渐变垫底"之后,背景变成近黑,实测这两个颜色在
// 近黑底上的对比度只有 3.16 和 1.40,双双远低于 WCAG AA 的 4.5(黑色花色几乎完全看不见);
// 而 inline style 优先级最高,也没法用 CSS 类覆盖掉。
// 所以这里按 render-log.js 里 SUIT_COLOR 的**同一个思路**(红桃/方块着红、其余走正文色)
// 重新取色,只是换成适配深色底的两个值,**不新造花色映射表**:
//   - 红色花色 -> #ff6a4d(和本文件 .seat-hp-col 血量红心用的是同一个色值,深色底上的
//     红色在这个项目里就用这一个,不再各处自己挑;实测近黑底上对比度 6.44)
//   - 黑色花色 -> var(--paper)(正文白,实测 14.04)
// 复用 data.js 已有的 isRed(card) 和 rankText(rank),不重复实现"哪些花色算红"这件事。
function seatEquipFace(card){
  if(!card || !card.suit) return '';
  const color = isRed(card) ? '#ff6a4d' : 'var(--paper)';
  return '<span class="efd" style="color:'+color+'">'+card.suit+rankText(card.rank)+'</span>';
}

// ===== renderSeatCard: 座位卡片的视觉结构 =====
// 只负责"这张卡片长什么样",不管点击/目标选择这类交互逻辑(那批~15种技能各自的客户端
// 选牌状态机变量仍留在 render() 里,和这次视觉结构无关)。
//
// 【第3次布局:头像铺满整卡 + 文字叠加在图片上层】
// **这是本项目第三次采用"文字叠在武将立绘上"的设计,前两次(头像铺满整卡 / 头像居左
// 固定大块)都因为"文字盖在可变内容图片上导致可读性差"而主动放弃,详见CLAUDE.md。
// 这次是在完全知情的前提下有意识地做回来,不是不知情地重踩旧坑——能成立的关键在于
// 换了一套前两次没用对的手法解决可读性:**保证对比度的是"文字和图片之间的那一层"
// (backing layer),不是文字本身的描边**。前两次都试图靠半透明小色块+文字描边硬顶,
// 在中间调/浅色的立绘上必然失效;这次每个文字元素都有自己的底衬层,且底衬的强度是按
// **最亮的立绘**实测反推出来的,不是"看着差不多"。**
//
// 逐元素的可读性方案(每一项都必须有backing layer,不能只靠text-shadow):
//   - 标题栏(玩家名,居中;回合中/连环/濒死状态标签):顶部深色渐变遮罩 .seat-scrim-top
//     打底 + text-shadow(第7次微调:标题栏的数字血量已删除,和左侧心形血量重复;
//     **顶部遮罩本想也改成半透明,实测发现基本没有下调空间,已如实报告用户,维持原值
//     不变,见 index.html 里 .seat-scrim-top 的详细说明**)
//   - 武将名竖排:落在顶部遮罩的深色区内 + text-shadow
//   - 血量竖排:位置在卡片中部,顶部/底部遮罩都够不到——所以它自带一个近乎不透明的深色
//     胶囊底衬(.seat-hp-col 自己的 background),不依赖任何遮罩(这次未改动)
//   - 装备条(第5次微调改白字+底部渐变垫底;第6次微调放大撑满阴影区;
//     **第7次微调:字号缩回和其它文字协调的比例,不再追求撑满**),
//     以及新增的**手牌数量图标**(两张交叉卡牌轮廓+黑色描边白字数字),两者并排组成
//     .seat-equip-row,由 .seat-scrim-bottom **底部**渐变垫底(这层这次真的改成了半透明)
//   - 判定区:自带半透明深色底衬(同血量思路),这次未改动
//
// 【第7次微调:阴影层从"必须不透明/近乎不透明"改成半透明——用户主动要求的知情例外,
//  但只有底部渐变真正做成了半透明,顶部渐变实测后维持原值】
// 第3~6次微调反复验证过"没有不透明底衬的文字,可读性直接取决于背后立绘明暗"这条规则
// (半透明血量胶囊 rgba(0,0,0,.42) 在最亮立绘上对比度只有2.30,远低于WCAG AA的4.5)。
// **这次用户在完全知情这条规则和历史教训的前提下,明确要求"阴影要透出立绘"**——不是
// 像前两次"文字叠图片"那样不知情地重踩旧坑,是主动要求做一次例外。半透明意味着装备
// 文字(+ 手牌数量图标数字)的对比度会重新依赖背后立绘的明暗,所以必须逐行实测(见
// CLAUDE.md 第7次微调条目的实测数据),不能凭感觉判断"看起来还行"。
// **实测结果:底部渐变(装备条+手牌图标区域)有空间做成半透明,全部通过;顶部渐变
// (标题栏)几乎没有下调空间——标题栏紧贴渐变顶端(y=0),该处不透明度约等于渐变
// 第一阶段的α值本身,α从原值.80降到.79,最亮立绘(马超)上标题栏对比度就跌到WCAG AA
// 的临界值(4.50,浮点误差下判定失败),再往下(.78/.65等)直接跌破。这条余量是实测
// 出来的硬约束,不是主观判断的风险,所以顶部渐变这次维持原值不变,不是自己偷偷决定
// 放弃用户的要求,是把这个发现如实报告给了用户。**
//
// isSelf=true 时装备条显示全部4槽(没装备的槽位显示"—",提示自己缺什么装备),对手只
// 显示已装备的槽位(没装备的行完全不渲染)——**这条不对称是此前经用户明确确认保留的
// 既有惯例,不是随手实现的默认值,不要"顺手统一"掉。**手牌数量图标不受这条不对称影响,
// 自己和对手都会显示(手牌张数在这个项目里本来就是公开信息,不是隐藏的具体牌面内容)。

// 出牌顺序编号:从 g.turn 开始按真实轮转顺序(nextAlive,game.js 已验证正确的轮转逻辑)
// 依次给每个存活玩家编号 1,2,3...,死亡玩家不参与编号(返回的 map 里没有它的座位号,
// 调用方据此不渲染角标)。纯展示层的派生计算,不写回 g、不需要 normalize 防御。
// g.turn 理论上不该指向死亡玩家(引擎自身的不变量),但这里不假设这一点——万一真的
// 撞上脏数据,兜底先用 nextAlive 找到第一个存活的人再开始编号,不崩溃、不显示错误角标。
function computeTurnOrderNumbers(g){
  const map = {};
  if(!g || !g.started) return map;
  const players = g.players||[];
  const aliveCount = players.filter(p=>p&&p.alive).length;
  if(aliveCount===0) return map;
  let seat = Number.isInteger(g.turn) ? g.turn : 0;
  if(!players[seat] || !players[seat].alive) seat = nextAlive(g, seat);
  for(let i=1; i<=aliveCount; i++){
    map[seat] = i;
    seat = nextAlive(g, seat);
  }
  return map;
}
function renderSeatCard(g, seat, isSelf){
  const p = g.players[seat];
  const gen = getGeneral(p.general); // 可能为 null(大厅/旧数据)
  // 未正式开局时(g.started仍为false,含三选一选将阶段pickingGeneral):不能显示具体武将
  // 名字——gen 在这个玩家选完之后就已经非空了(respondPickGeneral 立即赋值,不等其他人
  // 选完),所以不能直接判断"gen是否非空"决定显示什么,要按"选没选"这个状态本身区分文案,
  // 只暴露"选没选"、不暴露选的是谁,和"其他玩家选择进度"那部分的隐藏信息原则一致。
  // 身份局主公选完将后全场立刻可见其武将(规格),不必等 g.started
  const lordGeneralPublic = !!(g.gameMode==='identity' && p.role==='zhu' && gen);
  const genLabel = g.started
    ? (gen?gen.name:'—')
    : (lordGeneralPublic ? gen.name : (gen ? '已选' : '未定'));
  // 头像:必须同时满足"真的选定了武将(gen 非空)"和"g.started"才显示真实头像——只查 gen
  // 不够,三选一选将阶段选完但还没正式开局前仍是隐藏信息,这是一个真实修过的信息泄露bug
  // (见CLAUDE.md)。**例外**:身份局主公选定后立刻公开立绘(lordGeneralPublic)。
  const avatarReady = !!(gen && (g.started || lordGeneralPublic));
  // 左慈【化身】:声明借用某个武将后,座位卡头像改用那个武将的立绘,只改这一处视觉展示——
  // p.general 本身恒为'zuoci',技能判定(hasCap/generalHasCap等)、genLabel、genNameVert
  // 全部继续走 p.general/gen,不受这条影响。只在 p.general==='zuoci' 时才生效,不碰其他
  // 任何武将的座位卡渲染(renderSeatCard 是所有座位共用的同一个函数)。avatarGen 拿不到
  // (huashenGeneral 是脏数据/查无对应武将,理论上不该发生)时兜底退回 gen,不崩溃。
  const isZuociWithHuashen = p.general==='zuoci' && p.huashenGeneral;
  const avatarGen = isZuociWithHuashen ? (getGeneral(p.huashenGeneral) || gen) : gen;
  const avatarImg = avatarReady
    ? '<img class="avatar" src="'+generalAvatarSrc(avatarGen.id)+'" onerror="avatarError(this)" alt="">'
    : '';
  const avatarPlaceholder = '<div class="avatar-placeholder"'+(avatarReady?' style="display:none"':'')+'>'+escapeHtml(genLabel)+'</div>';
  // 武将名竖排(writing-mode:vertical-rl + text-orientation:upright,见CSS)。固定字号,
  // 不是 fitFontSize 那套动态测量——武将名长度上限被 GENERALS 表本身锁定(已核实最长是
  // "颜良文丑"4字),固定字号配合对这个具体worst case的真实测量验证即可。
  const genNameVert = avatarReady ? escapeHtml(gen.name) : '';
  // 势力标识:不透明色块+白字单字(魏/蜀/吴/群/晋)。势力值走 generalFaction(p)——它跟随
  // 左慈【化身】(借了别人的武将,势力也跟着变,和上面 avatarGen 跟随化身表现一致)。
  // 显示条件和头像/武将名同一个 avatarReady(g.started && gen):三选一选将阶段选完但未正式
  // 开局前仍是隐藏信息,不能提前泄露势力(和头像那次修过的信息泄露bug同一条件)。
  // 不透明色块:对比度恒定、不随背后立绘明暗漂移(中央区角标那次的教训)。class 里的
  // faction-<势力> 决定色块颜色(见 index.html)。FACTION_LABEL(data.js,单一来源,第3步起
  // 座位卡/#myGeneral/说明弹窗/选将候选卡共用同一张表)缺失时兜底不渲染,不崩。
  const factionKey = avatarReady ? generalFaction(p) : null;
  const factionBadge = (factionKey && FACTION_LABEL[factionKey])
    ? '<div class="seat-faction faction-'+factionKey+'">'+FACTION_LABEL[factionKey]+'</div>'
    : '<div class="seat-faction"></div>'; // 未开局/无将:保持原空壳(不可见),不占视觉
  // 血量:纵向堆叠,每颗心一个独立的 div(不能用 repeat 拼一整串字符串,那样只是一行文字
  // 里连续的字符、不会各自换行;必须逐个包成块级元素配合 flex-direction:column)。
  // 大厅(未开局)不显示具体血条格数,避免"占位4格→开局3格"的误导跳变。
  let heartsHtml;
  if(g.started){
    // 血格显示:先把 hp 钳进 [0, maxHp] 这个"可显示区间",再由它派生实心/空心格数——
    // 这里(渲染层)才是钳制该待的地方,数据层的 p.hp 保留真实值(可以为负,见 dealDamage 的注释)。
    // 四种情况都必须对(总格数恒等于 maxHp):
    //   hp=-2/maxHp=4(濒死欠血) -> shown=0 -> 0实心+4空心   ← 曾经的 bug:empty 直接用
    //       maxHp-hp 算成 6,4血角色显示6个空格(Math.max(0,...) 防的是反方向、挡不住这个)
    //   hp=0  -> 0实心+4空心
    //   hp=3  -> 3实心+1空心
    //   hp=5/maxHp=4(理论超上限) -> shown=4 -> 4实心+0空心(旧写法这里会画5个实心)
    const shownHp = Math.min(Math.max(0, p.hp), p.maxHp);
    const filled = shownHp, empty = Math.max(0, p.maxHp - shownHp);
    heartsHtml = '<div class="seat-hp-col">'
      + '❤'.repeat(filled).split('').map(c=>'<div>'+c+'</div>').join('')
      + '♡'.repeat(empty).split('').map(c=>'<div class="empty">'+c+'</div>').join('')
      + '</div>';
  } else {
    heartsHtml = '';
  }
  // 装备条(沉底):对手只显示已装备的槽位(没装备的行完全不渲染),自己显示全部4槽
  // (没装备的显示"—")。每行"类别首字 + 花色点数 + 装备名",前缀取自 EQUIP_SLOT_ABBR
  // (不能直接截 EQUIP_SLOT_LABEL 首字,"防具"/"防御马"会撞在同一个"防"字上)。
  // 花色点数走 seatEquipFace(见文件上方):红花色着红、黑花色走正文白,两个色值都是按
  // "深色渐变垫底"这个新背景实测选的,不是沿用 cardFace 那套给浅色底设计的配色。
  const eq = p.equips || emptyEquips();
  const equipSlotsToShow = isSelf ? EQUIP_SLOTS : EQUIP_SLOTS.filter(s=>eq[s]);
  // 内容密度分支(desktop-layout-8p 第5步):装备名文字本来就一直在渲染(不是这步新加的
  // 文字节点),窄屏下靠 .erow 的 white-space:nowrap+ellipsis 截断长名字(如"雌雄双股剑"/
  // "青龙偃月刀")。宽屏(isDesktopLayout())卡片更宽、且这是"内容密度分支"这个机制本身
  // 要验证的地方,所以在这里读同一个已经维护好的开关(不新增基于 @media 的重复判断,
  // 复用 render.js 顶部 checkLandscapeGate 同款写法引入的 isDesktopLayout()),给宽屏下
  // 的这一行额外加 wide-name 这个 class,取消 ellipsis 截断、允许完整显示装备名
  // (见 index.html 里 .seat-equip-bar .erow.wide-name 对应的纯 class 选择器,不建立新的
  // @media 断点)。
  const wideNameCls = isDesktopLayout() ? ' wide-name' : '';
  const equipRows = g.started ? equipSlotsToShow.map(s=>{
    const c = eq[s];
    const prefix = EQUIP_SLOT_ABBR[s];
    if(!c) return isSelf ? '<div class="erow empty-slot"><b>'+prefix+'</b> —</div>' : '';
    const eDesc = (getEquip(c.name) && getEquip(c.name).desc) || '';
    return '<div class="erow filled'+wideNameCls+'" title="'+escapeHtml(eDesc)+'" onclick="event.stopPropagation();showEquipInfo(\''+c.name+'\')"><b>'+prefix+'</b> '+seatEquipFace(c)+escapeHtml(c.name)+'</div>';
  }).join('') : '';
  // 装备条(文字列本身)只在真的有内容时才渲染——对手一件装备都没有时不渲染这一块。
  const equipBar = equipRows ? '<div class="seat-equip-bar">'+equipRows+'</div>' : '';
  // 手牌数量图标(第7次微调新增):两张交叉卡牌轮廓 + 黑色描边白字数字,叠在图标最左侧、
  // 装备文字挪到它右侧同一横向区域(见 index.html 的 .seat-equip-row)。手牌数是公开
  // 信息(和阵亡时手牌张数只记数量、不记牌名同一原则),自己和对手都显示,不受装备槽
  // "自己显示全部4槽/对手只显示已装备槽位"那条不对称规则影响——两者是完全独立的两件事。
  const handCount = g.started ? (p.hand||[]).length : null;
  const handIcon = handCount!=null
    ? '<div class="seat-hand-icon"><span class="hi-card a"></span><span class="hi-card b"></span>'
      + '<span class="hi-count">'+handCount+'</span></div>'
    : '';
  // 图标和装备文字包进同一个 .seat-equip-row(水平flex,见CSS),只要两者有一个非空就
  // 渲染这一整行;手牌数在 g.started 时恒非空(至少是数字0,不会是空字符串),所以这行
  // 在开局后基本总会渲染,除非连手牌图标都判断为 null(未开局时)且也没有装备可显示。
  const equipRow = (handIcon || equipBar) ? '<div class="seat-equip-row">'+handIcon+equipBar+'</div>' : '';
  // 左慈【化身】:声明借用某个武将后,座位卡新增一行"化身：<武将名>·<技能名>"+可点击
  // "?"角标(复用 showGeneralInfo,和武将说明"?"同一套展示组件,不新造弹窗)。
  // **放置位置的取舍**:字面上"名字下方"更贴近标题栏(.seat-title)正下方,但那一带
  // (.seat-title/.seat-left 的像素级 top 偏移、竖排武将名高度、血量胶囊位置)是经过多轮
  // WCAG对比度实测+响应式断点校准出来的脆弱几何(见CLAUDE.md第7次微调等多轮记录),往
  // 那里插一条新行需要重新验证整套断点下的重叠/对比度,风险和工作量都明显偏高。改放进
  // 已经证明能安全伸缩的 .seat-bottom(判定区+装备行所在的底部flex列,行数本来就是可变
  // 的,判定区0~N行、装备区对手0~4行不等,早已验证过增删行不会打乱布局)。视觉上仿
  // .seat-delays 的 .dchip(紫色系呼应锦囊)、装备行的金色高亮,这里用青色系区分"这是
  // 借用的技能"这个新概念,不与既有色系混淆。
  const huashenLine = (avatarReady && isZuociWithHuashen)
    ? '<div class="seat-huashen-line" title="'+escapeHtml((avatarGen&&avatarGen.desc)||'')+'" onclick="event.stopPropagation();showGeneralInfo(\''+p.huashenGeneral+'\')">化身：'
      + escapeHtml(avatarGen?avatarGen.name:p.huashenGeneral)+'·'+escapeHtml(p.huashenSkillName||'')
      + ' <span class="huashen-info-mark">?</span></div>'
    : '';
  // 周泰【不屈】:不屈牌行,红色系 chip,只显示花色+点数(不显示牌名——数量可变、名字长度
  // 不可控,塞进小 chip 容易在窄屏挤爆;规则判定只需要点数,牌名放 title 属性里,hover仍可见,
  // 信息不丢失)。**所有玩家可见,不做 isSelf/视角限制**——周泰的存活判定规则是"所有不屈牌
  // 点数唯一才能不死",这是场上其他人必须能看到才能参与博弈判断的公开信息,不能藏起来。
  // **用不透明底衬**(#4a1414,深红色,不透明)——这次不抄 .dchip/.seat-huashen-line 现有的
  // 半透明+text-shadow那套旧写法,而是走势力标识/装备条那次确立的"对比度不随立绘明暗漂移"
  // 标准。红/黑花色文字复用 seatEquipFace 已经校准过的两个色值(#ff6a4d红/var(--paper)白)——
  // 这两个颜色原本是为装备条那层半透明深色渐变背景调的,这次用真实WCAG计算逐一验证过,在
  // 这个新的 #4a1414 不透明红底上同样达标(红花色5.30、白字11.54,均远超4.5),所以直接复用,
  // 不新造一套颜色——全项目"红花色统一用这一个色值"这条既有约定继续保持,不因为这次新增
  // 一个新背景就分裂出第二套配色。门控条件和判定区同一原则(g.started且非空才渲染,空数组
  // 时整个容器不渲染,不留空占位;不需要 hasCap 判断——buquCards 只有真的放置过不屈牌才会
  // 非空,天然只有周泰才可能命中,不会误伤其他角色)。
  const buquRow = (g.started && (p.buquCards||[]).length>0)
    ? '<div class="seat-buqu-row">'+p.buquCards.map(c=>{
        return '<span class="bchip" title="不屈牌：'+escapeHtml(c.name)+' '+escapeHtml(c.suit+rankText(c.rank))+'">'+(seatEquipFace(c)||'')+'</span>';
      }).join('')+'</div>'
    : '';
  // 判定区(延时锦囊):紫色 chip,叠在装备条上方(仍在图片上层),同样自带半透明底衬。
  const delayRow = (g.started && (p.delays||[]).length>0)
    ? '<div class="seat-delays">'+p.delays.map(c=>{
        const dDesc = getCardDesc(c.name);
        return '<span class="dchip" title="'+escapeHtml(dDesc||'')+'" onclick="event.stopPropagation();showDelayInfo(\''+c.name+'\')">'+(cardFace(c)||'')+escapeHtml(c.name)+'</span>';
      }).join('')+'</div>'
    : '';
  // 标题栏(叠在顶部遮罩上):玩家名(居中)+状态标签(回合中/连环/濒死)。
  // **第7次微调:删掉数字血量**——血量已经在左侧 .seat-hp-col 的心形图标里完整显示,
  // 标题栏再放一遍数字是冗余信息,直接删掉(不是隐藏,是这个字段这次彻底不再生成)。
  const tags =
    (g.turn===seat&&g.started?'<span class="tag turn">回合</span>':'')+
    (p.chained?'<span class="tag">'+escapeHtml(chainedTagText(g, seat))+'</span>':'')+
    (p.chanyuan?'<span class="tag">缠怨</span>':'')+
    (p.dying?'<span class="tag" style="background:var(--cinnabar)">濒死</span>':'');
  // 标题栏不再包含"?"说明入口(第4次微调把它挪到右上角、身份方块的正下方,见下面的
  // infoBadge)。**玩家名这次改成居中(原来靠左)**——标签(tags)不参与居中的flex流,
  // 单独包一层 .seat-title-tags 绝对定位钉在标题栏右侧,不然标签的有无会让名字的居中
  // 位置跟着晃动(详见 index.html 里 .seat-title 的说明)。
  const titleRow =
    '<div class="seat-title">'+
      '<span class="seat-title-name" style="color:'+seatColor(seat)+'">'+escapeHtml(p.name)+'</span>'+
      (tags ? '<span class="seat-title-tags">'+tags+'</span>' : '')+
    '</div>';
  // "?"说明入口:第4次微调从标题栏挪到右上角、身份占位方块的正下方(绝对定位,见CSS)。
  // **它在新位置上落在顶部遮罩几乎完全透明的区域(实测该处 scrim alpha≈0,等于直接压在
  // 裸立绘上)**,所以必须自带不透明底衬——通用 .info-badge 本身就带 background:#1a1410
  // (不透明十六进制色,不是 rgba 半透明),这条正好满足本方案"每个可见元素都要有自己的
  // 不透明底衬、不能只靠 text-shadow/半透明色块"的硬要求,挪位置时不能把它弄丢。
  const infoBadge = (avatarReady&&gen)
    ? '<span class="seat-info-badge info-badge" title="'+escapeHtml(gen.skill+'：'+(gen.desc||''))+'" onclick="event.stopPropagation();showGeneralInfo(\''+gen.id+'\')">?</span>'
    : '';
  // 出牌顺序编号角标(右下角,常驻显示):死亡玩家不参与编号、不显示(orderMap 里没有
  // 它的座位号,下面这行天然拿到 undefined)。**位置冲突排查**:.seat-bottom(判定区+
  // 装备行)是 left:0;right:0;bottom:0 铺满整个底部的绝对定位容器,里面的不屈牌行/
  // 判定区都是 justify-content:flex-end(贴右对齐),装备文字也可能延伸到接近右边缘——
  // 也就是说右下角这块区域此刻已经被 .seat-bottom 的动态内容实际占用着,不能简单再叠一个
  // 绝对定位元素上去(会盖住装备名/不屈牌,或反过来被它们盖住,取决于DOM顺序)。
  // **解决方式:给 .seat-bottom 的 right 从 0 收进来一小条(见 index.html 对应位置的
  // 注释),专门空出这个角标的位置,不是覆盖掉已有元素**——.seat-bottom 内部所有行(装备/
  // 判定区/不屈牌)因此整体让出这一条,不管哪一行恰好是最底下那行都不会撞上。角标本身
  // 复用 .info-badge 已验证过的不透明底衬(#1a1410)+ --paper 文字(真实WCAG对比度14.04,
  // 远超AA的4.5),不新造配色。
  const orderNum = computeTurnOrderNumbers(g)[seat];
  const orderBadge = orderNum
    ? '<div class="seat-order-badge" title="出牌顺序:第'+orderNum+'位">'+orderNum+'</div>'
    : '';
  // DOM 顺序 = 层叠顺序(都在同一个 .seat 定位上下文里,后面的盖在前面的上面):
  // 图片 → 顶部遮罩 → 底部遮罩 → 标题栏/武将名/血量(文字层) → 底部区(判定区+装备行)。
  // 判定区和装备行(手牌图标+装备文字)一起包进 .seat-bottom(底部锚定的 flex column),
  // 这样判定区自然被装备行顶到上方,不依赖任何"装备行大概多高"的魔数(装备文字行数是
  // 可变的:对手0~4行、"我"固定4行,手牌图标本身高度固定)——详见 index.html 里
  // .seat-bottom 的说明。
  return '<div class="seat-art">'+avatarImg+avatarPlaceholder+'</div>'
    + '<div class="seat-scrim-top"></div>'
    + '<div class="seat-scrim-bottom"></div>'
    + titleRow
    // 左侧一列(从上往下):玩家名(在标题栏里,居中)→ 势力/所属占位 → 武将名竖排 → 血量。
    // **势力(魏/蜀/吴/群)这个字段游戏数据模型里还没有**(和身份局系统一样未实现,见
    // CLAUDE.md),这里只留空壳占位、预留出位置,**不造假数据**——和 .seat-identity
    // 一贯的处理原则一致。等以后真做了势力系统再回填内容。**这个占位从第4次微调起就
    // 存在,这次(第7次微调)的草图确认它的位置("标题栏下方、武将名竖排上方")继续
    // 保留,不是这次新增的元素。**
    //
    // **这四样包成一个 .seat-left 竖直 flex 列,而不是各自写死绝对定位的 top 偏移量。**
    // 原因是真实踩到的坑:武将名竖排的高度随字数变化(2字"马超"到4字"颜良文丑"差一倍),
    // 而血量胶囊原本是"垂直居中"绝对定位——在矮的对手卡(SE 横屏下仅 128.66px 高)上,
    // 3~4 字的武将名会直接和血量胶囊叠在一起(**这个重叠在上一轮 PR#20 里其实就已经存在,
    // 只是当时的截图恰好都用了 2 字武将名而没暴露**)。用 flex 列让它们自然依次往下排,
    // 字数怎么变都不会撞车,也不需要任何"武将名大概多高"的魔数——和 .seat-bottom
    // (判定区+装备行)当初用同一套办法解决同一类问题。
    + '<div class="seat-left">'
      + factionBadge
      + '<div class="seat-gen-name">'+genNameVert+'</div>'
      + heartsHtml
    + '</div>'
    // 右上角:身份(主公/忠臣/反贼/内奸)。identity 模式且 canSeeRole 时填单字+色块;
    // 否则保持空壳(与未实现时视觉一致,不暗示隐藏身份)。
    + (function(){
        if(g.gameMode==='identity' && p.role && typeof canSeeRole==='function' && canSeeRole(g, mySeat, seat)){
          const ch = {zhu:'主',zhong:'忠',fan:'反',nei:'内'}[p.role] || '';
          const title = (typeof ROLE_LABEL!=='undefined' && ROLE_LABEL[p.role]) ? ROLE_LABEL[p.role] : '';
          return '<div class="seat-identity role-'+p.role+'" title="'+escapeHtml(title)+'">'+ch+'</div>';
        }
        return '<div class="seat-identity"></div>';
      })()
    + infoBadge
    + '<div class="seat-bottom">'+huashenLine+buquRow+delayRow+equipRow+'</div>'
    // orderBadge 排在 .seat-bottom 之后(DOM序=层叠序,后面的盖在前面上面)——两者本来
    // 就靠 .seat-bottom 的 right 收窄互不重叠(见上面注释),这里放在最后只是双重保险:
    // 万一某个极端场景下 .seat-bottom 的内容真的溢出了预留边界,角标仍然可见、不会被
    // 悄悄盖住。
    + orderBadge;
}


// ---------- render ----------
function render(g){
  currentG = g; // 供确认弹窗的取消回调异步刷新界面用(回调触发时早已不在 render 的调用栈里)
  if(!g){
    // room was deleted by someone (or doesn't exist) while we're in-game -> return to lobby
    if(!document.getElementById('game').classList.contains('hidden')){
      if(gameRef) gameRef.off();
      backToLobby();
      document.getElementById('lobbyErr').textContent = '房间已被关闭,可重新进入。';
    }
    return;
  }
  // 大厅机器人允许增删 players 项；若机器人之后又有真人加入，删除中间的机器人会让后面
  // 真人的数组下标左移。每次快照都用稳定 cid 重新定位自己，避免客户端继续拿旧座位号操作。
  const currentSeat=(g.players||[]).findIndex(p=>p&&p.cid===myClientId);
  if(currentSeat>=0) mySeat=currentSeat;
  // 机器人调度必须和渲染解耦(见函数末尾的 finally):scheduleBotTurn 原本是 render 的最后
  // 一行,渲染中途任何一处抛异常都会执行不到它、机器人从此永久停摆——这个症状和"机器人不
  // 行动"的座位判定 bug 长得一模一样,会把排查方向带偏,所以这里用 try/finally 拆开。
  try{
  normalize(g);
  // 轮到自己回合:语音+大字视觉双重提示,同一个触发时机、同一套去重判断——只在"刚刚轮到
  // 自己回合"这一刻提示一次,不会因为同一回合内的其它状态变化(如无关的日志/别人操作)
  // 而反复重复提示。
  // 【曾经的时机偏差】判断条件曾经是 g.phase==='play'&&g.turn===mySeat,导致提示要等
  // 玩家自己点了摸牌按钮、阶段从'draw'推进到'play'之后才触发,比"轮到你回合"这个真正的
  // 时间点晚了一步——现在改成只看"轮到谁"(g.turn===mySeat),不管当前是draw还是play哪个
  // 子阶段,回合刚开始(摸牌按钮出现的那一刻)就立刻提示。
  // turnKey 也不能再包含 g.phase:否则同一个回合从draw切到play,key会变化,又会被误判成
  // "新的一次轮到自己"而重复触发一次提示。key 用 (turn,roundNum) 组合:同一玩家在不同
  // 轮次会重新拿到同一个 turn 座位号,必须靠 roundNum 区分,不能只用 turn 本身。
  const turnKey = g.started ? (g.turn+':'+(g.roundNum||0)) : null;
  if(g.started && g.turn===mySeat && turnKey!==lastAnnouncedTurnKey){
    announceMyTurn();
    showMyTurnBanner();
    lastAnnouncedTurnKey = turnKey;
  } else if(g.turn!==mySeat){
    lastAnnouncedTurnKey = undefined;
  }
  maybePlayCardSound(g); // 打出手牌语音:和上面announceMyTurn同一批"每次状态更新都检测一次"的位置
  maybePlaySkillSound(g); // 技能发动语音:同一批检测
  // 单点兜底:只要不在「自己的出牌阶段」,就退出丈八选牌模式——覆盖换回合/进弃牌/游戏结束/中断/离开等一切离开出牌阶段的情形。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetZhangba();
  // 同款兜底:只要不在「自己的弃牌阶段」,就清空已勾选待弃置的手牌下标——覆盖克己跳过/确认
  // 提交完毕换下一回合/中断离开等一切离开弃牌阶段的情形。注意这里不能靠 renderControls
  // 内部discard分支末尾自己清(那段代码被套在 if(!myTurn){return;} 之后,轮到别人时根本
  // 不会执行到,必须放在这个不受myTurn限制的单点兜底里才能真正覆盖"换到别人回合"这个最
  // 常见的离开discard阶段的场景)。
  if(!(g.started && g.phase==='discard' && g.turn===mySeat)) resetDiscardSelected();
  // 同款兜底:一旦不在任何一个"轮到自己响应、需要多候选选牌"的状态,清空多候选选牌状态
  // (selectedResponseCardIdx),不留残留到下一次响应场景。五个场景共用同一个状态,所以这里
  // 必须把五个 phase 全部列全——漏掉任何一个,那个场景选中的牌会残留到下一次响应(规则14)。
  if(!(g.phase==='respond' && g.pending && g.pending.to===mySeat) &&
     !(g.phase==='aoeResp' && g.pending && g.pending.type==='aoeResp' && g.pending.to===mySeat) &&
     !(g.phase==='duel' && g.pending && g.pending.active===mySeat) &&
     !(g.phase==='jiedaoChoice' && g.pending && g.pending.type==='jiedaoChoice' && g.pending.seatA===mySeat) &&
     !(g.phase==='tiaoxinChoice' && g.pending && g.pending.type==='tiaoxinChoice' && g.pending.to===mySeat)) resetSelectedResponseCard();
  // 同款兜底:一旦不在"轮到自己响应鬼才改判"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='guicai' && g.pending && g.pending.type==='guicai' && g.pending.asking===mySeat)) resetGuicai();
  // 同款兜底:只要不在「自己的恂恂选择阶段」,就退出恂恂选牌模式。
  if(!(g.phase==='xunxunPick' && g.pending && g.pending.type==='xunxunPick' && g.pending.seat===mySeat)) resetXunxun();
  // 同款兜底:只要不在「自己的摸牌阶段」,就退出突袭选目标模式。
  if(!(g.started && g.phase==='draw' && g.turn===mySeat)) resetTuxi();
  // 同款兜底:只要不在「自己的出牌阶段」,就退出断粮选牌+选目标模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetDuanliang();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetQixi();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetGuose();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetLianhuan();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetTiesuo();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetZhiheng();
  // 散谣全程停在 g.phase='play',没有独立的服务端 pending 可判——判据和 zhihengMode 同款,
  // 只要不在"自己的出牌阶段"就退出本地发动流程。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetSanyao();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetTiaoxin();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetQingnang();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetQuhu();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetLijian();
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetFanjian();
  if(!(g.phase==='lirangAsk' && g.pending && g.pending.type==='lirangAsk' && g.pending.from===mySeat)) resetLirang();
  // 同款兜底:一旦不在"轮到自己响应骁果"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='xiaoguo' && g.pending && g.pending.type==='xiaoguo' && g.pending.asking===mySeat)) resetXiaoguo();
  // 同款兜底:一旦不在"轮到自己(攻击者)响应青龙偃月刀"的状态,退出选牌模式,不留残留。
  if(!(g.phase==='qinglong' && g.pending && g.pending.type==='qinglong' && g.pending.from===mySeat)) resetQinglong();
  // 同款兜底:雌雄双股剑目标选手牌弃置模式
  if(!(g.phase==='cixiongChoice' && g.pending && g.pending.type==='cixiongChoice' && g.pending.to===mySeat)) resetCixiongDiscard();
  // 同款兜底:一旦不在"轮到自己(攻击者)响应贯石斧"的状态,清空已选的弃牌项,不留残留。
  if(!(g.phase==='guanshi' && g.pending && g.pending.type==='guanshi' && g.pending.from===mySeat)) resetGuanshi();
  // 同款兜底:一旦不在"轮到自己分配遗计牌"的状态,清空已选的分配项,不留残留。
  if(!(g.phase==='yijiAssign' && g.pending && g.pending.type==='yijiAssign' && g.pending.seat===mySeat)) resetYiji();
  // 同款兜底:一旦不在"刚烈惩罚由自己选择"的状态,清空已选弃牌。
  if(!(g.phase==='ganglieChoice' && g.pending && g.pending.type==='ganglieChoice' && g.pending.sourceSeat===mySeat)) resetGanglie();
  // 同款兜底:只要不在"轮到自己的巧变回合开始询问"或"轮到自己的巧变移动询问"这两个状态,
  // 就退出巧变选牌/选阶段/选源/选目标模式——巧变完整版横跨两个不同的服务端阶段。
  if(!(g.phase==='qiaobianTurnStart' && g.pending && g.pending.type==='qiaobianTurnStart' && g.pending.seat===mySeat) &&
     !(g.phase==='qiaobianMove' && g.pending && g.pending.type==='qiaobianMove' && g.pending.seat===mySeat)) resetQiaobian();
  // 同款兜底:只要不在「自己的出牌阶段」,就退出借刀杀人选 A/B 模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetJiedao();
  // 同款兜底:只要不在左慈"选武将→选技能"的三个阶段(开局初次声明/回合开始更改/回合结束
  // 更改)里、且轮到自己操作,就退出两级选择模式,不留残留。
  if(!(g.pending && g.pending.seat===mySeat &&
       (g.pending.type==='huashenPick' || g.pending.type==='huashenChangePickStart' || g.pending.type==='huashenChangePickEnd'))) resetHuashenPick();
  const oppRowEl=document.getElementById('oppRow');
  const oppTopRowEl=document.getElementById('oppTopRow');
  const meSeatEl=document.getElementById('meSeat');
  // 骨架级重建(landscape-ui 第1阶段):.opp-row/#meSeat 各自独立容器,不再共用一个
  // #seats 网格——#tableCard 这次已经不是它们的子元素(见 index.html 的说明),两个
  // 容器整体清空重建没有"常驻子节点被连带销毁"这个历史包袱,可以直接 innerHTML=''。
  // #oppTopRow(宽屏桌面布局专用,装zone==='top'的座位卡)同样每次整体清空重建。
  oppRowEl.innerHTML=''; if(oppTopRowEl) oppTopRowEl.innerHTML=''; meSeatEl.innerHTML='';
  const seatN=(g.players||[]).length;
  // 对手在行内的左右顺序:从"我"的下家开始按回合顺序排列,单独一整行的横排场景下比旧版
  // "回合顺序上离我近的分左右两侧"更直觉,也不需要为不同人数维护不同的分侧规则。
  const oppOrder=[];
  if(mySeat!==null){
    for(let k=1;k<seatN;k++) oppOrder.push((mySeat+k)%seatN);
  } else {
    for(let k=0;k<seatN;k++) oppOrder.push(k); // mySeat 还未确定(理论边界):按原始顺序
  }
  // 宽屏桌面布局(desktop-layout-8p 第3步):只在 desktopLayoutActive 时才计算/写入
  // data-zone,窄屏时完全不算(assignSeatZones 需要 mySeat 非 null,理论边界下也不算)。
  // zoneIndexBySeat 按 assignSeatZones 内部同一套"绝对座位号从小到大"的顺序派生
  // (不是按 oppOrder 的回合顺序派生),保证和 assignSeatZones 声明的区内顺序一致,
  // 不会出现"两套顺序各算各的"这种潜在不一致。
  const zones = (desktopLayoutActive && mySeat!==null) ? assignSeatZones(seatN, mySeat) : null;
  const zoneIndexBySeat = {};
  if(zones){
    const counters = {top:0, left:0, right:0};
    for(let s=0;s<seatN;s++){
      const z = zones[s];
      if(z==='top'||z==='left'||z==='right') zoneIndexBySeat[s]=counters[z]++;
    }
  }
  // buildSeatDOM: 创建一个座位的完整 DOM 节点——视觉结构由 renderSeatCard 生成(纯粹
  // 描述"这张卡片长什么样"),随后接上目标选择/技能发动的交互逻辑(读一批客户端选牌/
  // 选目标状态机变量,和 render-hand.js 拆分时"这批状态不是手牌专属、不搬"是同一个
  // 原则,这里同样不搬进 renderSeatCard)。返回创建好的节点,调用方决定挂到哪个容器。
  function buildSeatDOM(i){
    const p=g.players[i];
    if(!p) return null;
    const d=document.createElement('div');
    // 骨架级重建后不再用 seatSlot/slot-*；酒诗等翻面状态用 .flipped 标记
    d.className='seat'+(g.turn===i&&g.started?' active':'')+(p.alive?'':' dead')+(i===mySeat?' me':'')+(p.faceup===false?' flipped':'');
    d.dataset.seat = i; // 供中央出牌区(renderTableCard)按座位号选中,高亮出牌方/目标座位用
    if(zones){
      d.dataset.zone = zones[i];
      if(zoneIndexBySeat[i]!==undefined) d.dataset.zoneIndex = zoneIndexBySeat[i];
    }
    d.innerHTML = renderSeatCard(g, i, i===mySeat);
    // targeting: clickable opponents when choosing a target card
    const meP=g.players[mySeat];
    const selCard=(selectedCardIdx!==null)?(meP.hand||[])[selectedCardIdx]:null;
    const isShaSel=!!(selCard && resolveActionId(g,meP,selCard)==='杀');    // 选的牌最终按"杀"结算(含赵云的闪、没有独立效果的红/黑牌)
    const isShuangxiongDuelSel=canShuangxiongDuelCard(meP, selCard);
    const isJiedaoSel=!!(selCard && selCard.name==='借刀杀人');             // 借刀杀人走专属两步选择,不进通用单目标块
    const needHandOrEquip=!!(selCard && (selCard.name==='顺手牵羊'||selCard.name==='过河拆桥'));
    const needHandOnly=!!(selCard && selCard.name==='火攻');
    // 顺手/拆桥对目标"有没有效果"的口径要和服务端 resolveTrick 的 optCount===0 一致:
    // 手牌、装备、判定区(延时锦囊)任一非空即可选——否则"手牌0但有装备/判定区的牌"会被
    // UI 误挡在选目标这一步(官方规则判定区也在可拿/可拆范围内,见 CLAUDE.md 改动记录)。
    const hasHandOrEquip = (p.hand||[]).length>0 || EQUIP_SLOTS.some(s=>p.equips && p.equips[s]) || (p.delays||[]).length>0;
    // 顺手牵羊/兵粮寸断(直接使用场景,不是徐晃【断粮】那条路径)距离限制均为1,和服务端
    // canTarget 的口径一致;过河拆桥/乐不思蜀/闪电均无此限制,不在这个判断范围内。
    const distLimited = !!(selCard && (selCard.name==='顺手牵羊' || selCard.name==='兵粮寸断'));
    const duelSel = !!(selCard && (selCard.name==='决斗' || isShuangxiongDuelSel)); // 决斗:无距离限制,但同样受空城限制
    // 诸葛亮【空城】:若目标没有手牌,不能成为【杀】或【决斗】的目标,和服务端
    // CARD_PLAYS['杀'/'决斗'].canTarget 的判断口径一致。
    const kongchengBlocked = (isShaSel || duelSel) && hasCap(p,'kongcheng') && (p.hand||[]).length===0;
    const inRange = (!isShaSel || canReachSha(g, mySeat, i)) && (!distLimited || distance(g, mySeat, i) <= 1) && !kongchengBlocked;
    // 默认不能选自己;是否放行自选要按这张延时锦囊自己的 onlySelf 判断(闪电 onlySelf:true 只能选自己,
    // 乐不思蜀/兵粮寸断 onlySelf:false 和普通牌一样不能选自己)。
    // 之前误用 CARD_PLAYS[name].allowSelf(delayTrickPlay 这个共享对象,所有延时锦囊都是 allowSelf:true,
    // 只用来放行服务端 playCard 的默认排自选校验)当"这张牌能不能选自己"的判断依据——allowSelf 为真时
    // (i!==mySeat || allowSelf) 对任何座位恒真,等于"选中任意延时锦囊后谁都能点",和服务端 canTarget
    // (按 DELAY_TRICKS[card.name].onlySelf 分别限制)不一致:闪电点别人在服务端被正确拒绝,但UI没跟着限制,
    // 表现为"点了没反应"。这里直接查 DELAY_TRICKS 复刻服务端同一条判断,不再经 allowSelf 这层间接。
    const selDT = selCard && DELAY_TRICKS[selCard.name];
    const selSpec = selCard ? CARD_PLAYS[resolveActionId(g, g.players[mySeat], selCard)] : null;
    const selfOK = selDT ? (selDT.onlySelf ? i===mySeat : i!==mySeat) : (i!==mySeat || !!(selSpec && selSpec.allowSelf));
    // 官方规则:同一判定区不能有两张同名的延时类锦囊牌,和服务端 canTarget 的 hasDup 判断口径一致。
    const hasDupDelay = !!(selDT && (p.delays||[]).some(c=>c && c.name===selCard.name));
    const targetable = !!(selSpec && selSpec.target) && selfOK && p.alive && (!needHandOrEquip || hasHandOrEquip) && (!needHandOnly || (p.hand||[]).length>0) && inRange && !hasDupDelay;
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat && !isJiedaoSel){
      if(targetable){
        // idx 在这里(渲染时/挂载 onclick 那一刻)冻结,而不是等点击时才读 selectedCardIdx——
        // 否则确认框弹出后、tx 网络往返完成前,旧节点还挂着这个 onclick,手机上一次误触的
        // 二次点击会读到已被 confirmAndPlay 的 cleanup 清空的 selectedCardIdx(=null),
        // 显示"使用【undefined】"且 playCard(null,...) 静默失败(此前的真实 bug)。
        const idx=selectedCardIdx;
        const c0=((g.players[mySeat].hand||[])[idx])||{};
        const actionId = resolveActionId(g, g.players[mySeat], c0); // 优先这张牌自己的效果,没有独立入口才转化为杀(见 resolveActionId 注释)
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay(playConfirmMsg(g, actionId, c0, i), ()=>playCard(idx, actionId, i)); };
      } else if((isShaSel||duelSel) && i!==mySeat && p.alive && kongchengBlocked){
        // 诸葛亮【空城】:没有手牌,不能被选为杀/决斗的目标 —— 暗色点线 + 角标 + 悬浮说明,
        // 不可点(同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title = '【空城】：该角色没有手牌,不能成为杀/决斗的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">空城</span>';
      } else if((isShaSel||distLimited) && i!==mySeat && p.alive && !inRange){
        // 够不着:选了杀但超出攻击距离,或选了顺手牵羊/兵粮寸断但超出距离1 —— 暗色点线 + 角标 +
        // 悬浮说明,不可点(和杀同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title = isShaSel
          ? '攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）'
          : '距离外（距离 '+distance(g,mySeat,i)+' ＞ 1）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      } else if(selDT && hasDupDelay && selfOK && p.alive){
        // 判定区已有同名延时锦囊:官方规则不允许重复,暗色点线 + 角标 + 悬浮说明,不可点
        // (同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title='判定区已有【'+selCard.name+'】,不能重复放置';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">已有同名</span>';
      }
    }
    if(g.phase==='guhuoTarget' && g.pending && g.pending.type==='guhuoTarget' && g.pending.sourceSeat===mySeat){
      const claimed=g.pending.claimedCard;
      const guhuoSpec=claimed ? CARD_PLAYS[guhuoActionId(claimed.name)] : null;
      const selfAllowed=i!==mySeat || !!(guhuoSpec && guhuoSpec.allowSelf);
      const guhuoTargetable=!!(guhuoSpec && guhuoSpec.target) && selfAllowed && p.alive && (!guhuoSpec.canTarget || guhuoSpec.canTarget(g, meP, claimed, i));
      if(guhuoTargetable){
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.title='选择为【蛊惑】声明牌的目标';
        d.onclick=()=>{ confirmAndPlay('将【蛊惑】声明的【'+claimed.name+'】对 '+g.players[i].name+' 使用？', ()=>guhuoChooseTarget(i)); };
      } else if(guhuoSpec && guhuoSpec.target && p.alive){
        d.style.outline='2px dotted #6b5b4d';
        d.title='不是这张声明牌的合法目标';
      }
    }
    // 丈八蛇矛:已选满两张牌后,对手作为杀的目标(距离规则同普通杀,与 selectedCardIdx 路径互斥)
    if(zhangbaMode && zhangbaPicks.length===2 && g.phase==='play' && g.turn===mySeat){
      const reach = canReachSha(g, mySeat, i);
      const zhangbaKongcheng = hasCap(p,'kongcheng') && (p.hand||[]).length===0; // 【空城】同样限制丈八蛇矛这条杀的路径
      if(i!==mySeat && p.alive && reach && !zhangbaKongcheng){
        // 同上:a/b 在挂载时冻结,不在点击时才读 zhangbaPicks(它会被 confirmAndPlay 的 cleanup 清空)
        const a=zhangbaPicks[0], b=zhangbaPicks[1];
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('对 '+g.players[i].name+' 使用两张牌当【杀】？', ()=>playZhangbaSha(a, b, i)); };
      } else if(i!==mySeat && p.alive && zhangbaKongcheng){
        d.style.outline='2px dotted #6b5b4d';
        d.title = '【空城】：该角色没有手牌,不能成为杀的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">空城</span>';
      } else if(i!==mySeat && p.alive && !reach){
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
    }
    // 姜维【挑衅】:出牌阶段,选择一个其他角色作为目标
    if(tiaoxinMode && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive && (p.hand||[]).length>0 && !tiaoxinTarget){
      d.style.cursor='pointer';
      d.style.outline='2px dashed var(--cinnabar-bright)';
      d.onclick=()=>{ confirmAndPlay('对 '+g.players[i].name+' 发动【挑衅】？', ()=>respondTiaoxin(i)); };
    }
    // 方天画戟选目标模式:点存活的、在攻击距离内的其他玩家 = 切换选中/取消,上限 min(3,范围内合法目标数)。
    // 不强制选满(选够1个即可点"确认发动");距离限制是推断而非确证的官方规则(见 EQUIPS['方天画戟'].desc)。
    if(fangtianMode && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const reach = canReachSha(g, mySeat, i);
      const fangtianKongcheng = hasCap(p,'kongcheng') && (p.hand||[]).length===0; // 【空城】同样限制方天画戟的额外目标
      const picked = fangtianPicks.includes(i);
      const selectable = reach && !fangtianKongcheng && (picked || fangtianPicks.length<3);
      if(selectable){
        d.style.cursor='pointer';
        if(picked) d.style.outline='3px solid var(--gold)';
        else d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{
          if(picked) fangtianPicks = fangtianPicks.filter(x=>x!==i);
          else if(fangtianPicks.length<3) fangtianPicks.push(i);
          render(g);
        };
      } else if(fangtianKongcheng){
        d.style.outline='2px dotted #6b5b4d';
        d.title = '【空城】：该角色没有手牌,不能成为杀的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">空城</span>';
      } else if(!reach){
        d.style.outline='2px dotted #6b5b4d';
        d.title='攻击距离外（距离 '+distance(g,mySeat,i)+' ＞ 射程 '+attackRange(g,mySeat)+'）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
    }
    // 徐晃【断粮】选目标:已选中一张黑色基本牌/黑色装备牌后,点距离2以内的其他存活玩家提交
    // (官方规则"对距离2以内的角色使用",和杀的攻击距离同一套 distance() 口径,复用同款
    // "够不着"暗色点线+角标的视觉写法)。
    if(duanliangMode && duanliangCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const inRange = distance(g, mySeat, i) <= 2;
      if(inRange){
        // 同上:idx 挂载时冻结,不在点击时才读 duanliangCardIdx
        const idx=duanliangCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【兵粮寸断】使用,对 '+g.players[i].name+' 发动【断粮】？', ()=>duanLiang(idx, i)); };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='距离外（距离 '+distance(g,mySeat,i)+' ＞ 2）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      }
    }
    // 甘宁【奇袭】选目标:已选中一张黑色手牌后,点一名有手牌/装备/判定区牌的其他存活玩家提交。
    if(qixiMode && qixiCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      if(hasHandOrEquip){
        const idx=qixiCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【过河拆桥】使用,对 '+g.players[i].name+' 发动【奇袭】？', ()=>qiXi(idx, i)); };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色没有手牌、装备或判定区的牌';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">无牌</span>';
      }
    }
    // 大乔【国色】选目标:已选中一张方块牌后,点一名判定区没有【乐不思蜀】的其他存活玩家提交。
    if(guoseMode && guoseCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const hasLe = (p.delays||[]).some(c=>c && c.name==='乐不思蜀');
      if(!hasLe){
        const idx=guoseCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【乐不思蜀】使用,对 '+g.players[i].name+' 发动【国色】？', ()=>guoSe(idx, i)); };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色判定区已有【乐不思蜀】';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">已有乐</span>';
      }
    }
    if(lianhuanMode && lianhuanCardIdx!==null && g.phase==='play' && g.turn===mySeat && p.alive){
      const picked=lianhuanTargets.includes(i);
      d.style.cursor='pointer';
      d.style.outline=picked?'3px solid var(--accent)':'2px dashed var(--cinnabar-bright)';
      d.title=picked?'已选择为【铁索连环】目标':'选择为【铁索连环】目标';
      d.onclick=()=>{
        if(picked) lianhuanTargets=lianhuanTargets.filter(seat=>seat!==i);
        else if(lianhuanTargets.length<2) lianhuanTargets=[...lianhuanTargets, i];
        render(g);
      };
    }
    if(selectedCardIdx!==null && selCard && resolveActionId(g,meP,selCard)==='铁索连环' && g.phase==='play' && g.turn===mySeat && p.alive){
      const picked=tiesuoTargets.includes(i);
      d.style.cursor='pointer';
      d.style.outline=picked?'3px solid var(--accent)':'2px dashed var(--cinnabar-bright)';
      d.title=picked?'已选择为【铁索连环】目标':'选择为【铁索连环】目标';
      d.onclick=()=>{
        if(picked) tiesuoTargets=tiesuoTargets.filter(seat=>seat!==i);
        else if(tiesuoTargets.length<2) tiesuoTargets=[...tiesuoTargets, i];
        render(g);
      };
    }
    if(g.phase==='quhuDamageChoice' && g.pending && g.pending.type==='quhuDamageChoice' && g.pending.seat===mySeat && (g.pending.targets||[]).includes(i)){
      d.style.cursor='pointer';
      d.style.outline='3px solid var(--accent)';
      d.title='选择该角色承受【驱虎】伤害';
      d.onclick=()=>respondQuhuDamage(i);
    }
    if(lijianMode && lijianCardIdx!==null && g.phase==='play' && g.turn===mySeat && p.alive){
      if(isMale(p)){
        if(lijianFromSeat===null){
          d.style.cursor='pointer';
          d.style.outline='2px dashed var(--cinnabar-bright)';
          d.title='选择视为使用【决斗】的男性角色';
          d.onclick=()=>{ lijianFromSeat=i; render(g); };
        } else if(i!==lijianFromSeat){
          const idx=lijianCardIdx, from=lijianFromSeat, to=i;
          d.style.cursor='pointer';
          d.style.outline='2px solid var(--accent)';
          d.title='选择【决斗】目标';
          d.onclick=()=>{ confirmAndPlay('发动【离间】:令 '+g.players[from].name+' 视为对 '+g.players[to].name+' 使用【决斗】？', ()=>liJian(idx, from, to)); };
        } else {
          d.style.outline='3px solid var(--gold)';
          d.title='已选择为【决斗】使用者';
        }
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='女性角色不能成为【离间】目标';
      }
    }
    if(fanjianMode && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      d.style.cursor='pointer';
      d.style.outline='2px dashed var(--cinnabar-bright)';
      d.title='选择为【反间】目标';
      d.onclick=()=>{ confirmAndPlay('对 '+g.players[i].name+' 发动【反间】？', ()=>fanJian(i)); };
    }
    // 华佗【青囊】:已选一张手牌后,点任意已受伤角色回复1点体力(可以选自己)。
    if(qingnangMode && qingnangCardIdx!==null && g.phase==='play' && g.turn===mySeat && p.alive){
      if(p.hp<p.maxHp){
        const idx=qingnangCardIdx, targetSeat=i;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('弃置这张手牌,发动【青囊】令 '+g.players[targetSeat].name+' 回复1点体力？', ()=>qingNang(idx, targetSeat)); };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色未受伤,不能成为【青囊】目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">未受伤</span>';
      }
    }
    // 刘备【仁德】:出牌阶段选中任意一张手牌后,可直接交给一名其他存活角色。
    // 这里不覆盖座位本身原有的"使用这张牌"onclick,而是在座位卡上追加一个小按钮,
    // 让"正常出牌"和"仁德给牌"作为两个明确选项并存。
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat && hasCap(meP,'rende') && i!==mySeat && p.alive){
      const idx=selectedCardIdx;
      const targetSeat=i;
      const rb=document.createElement('button');
      rb.className='ghost';
      rb.textContent='仁德:交给此人';
      rb.style.margin='6px 14px 0';
      rb.onclick=(e)=>{ e.stopPropagation(); confirmAndPlay('将这张手牌交给 '+g.players[targetSeat].name+'，发动【仁德】？', ()=>renDe(idx, targetSeat)); };
      d.appendChild(rb);
    }
    // 颜良文丑【双雄】:选中一张与判定牌异色的手牌后,可明确选择"当【决斗】"使用。
    // 用座位上的独立按钮,避免覆盖这张牌原本自己的出牌效果。
    // 【目标校验必须和服务端逐项对齐,不要手写简化版】——这里曾经手写 blocked=空城判断,
    // 漏了 CARD_PLAYS['决斗'].canTarget 里同样会查的 isZhichiImmune(陈宫智迟)/weimu(贾诩帷幕),
    // 导致按钮会渲染在服务端必然拒绝的座位上、点了没反应。现在直接调用真正的 canTarget,
    // 和武圣按钮(下面)同一写法,不再自己重算一遍。
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat && isShuangxiongDuelSel && i!==mySeat && p.alive
       && CARD_PLAYS['决斗'].canTarget(g, meP, selCard, i)){
        const idx=selectedCardIdx;
        const targetSeat=i;
        const db=document.createElement('button');
        db.className='ghost';
        db.textContent='双雄:决斗';
        db.style.margin='6px 14px 0';
        db.onclick=(e)=>{ e.stopPropagation(); confirmAndPlay('将这张手牌当【决斗】对 '+g.players[targetSeat].name+' 使用,发动【双雄】？', ()=>playCard(idx, '决斗', targetSeat)); };
        d.appendChild(db);
    }
    // 关羽【武圣】:选中一张"自己有独立效果、但也能当【杀】使用"的红色牌后,可明确选择"当【杀】"使用。
    // 和双雄同一个思路:用座位上的独立按钮,不覆盖这张牌原本自己的出牌效果——两种解读同屏共存,
    // 常用路径(按这张牌自己的效果用)零额外点击。刻意不走 forcedShaCardId 那套 flag:那是给装备牌
    // (target:false、选了"当杀"就等于彻底放弃装备)设计的"替换"语义,一旦置了 flag,座位高亮(它自己
    // 就读 resolveActionId)会立刻整体变成杀的目标集,这张牌自己的目标选择当场消失,和"两种用法要
    // 同时可选"这个需求直接冲突。
    //
    // isWushengShaSel 的判断刻意不写死牌名、也不查 DELAY_TRICKS:条件就是"这张牌此刻正被按它自己的
    // 效果解读(resolveActionId!=='杀'),但它同时也能当杀打出"。这一条通用条件天然覆盖全部9张红色
    // target:true 牌(乐不思蜀♥6/闪电♥12/决斗♥1/过河拆桥♥1/顺手牵羊♥2/火攻♥3;兵粮寸断/借刀杀人/
    // 铁索连环在牌堆里没有红色副本,永远进不来)。target:false 的红牌(桃/无中生有/五谷/桃园/酒/万箭)
    // 天然被 selectedCardIdx!==null 挡在外面——它们点击即走 confirmAndPlay、根本不会进入"选中"状态
    // (见 render-hand.js 那处 spec.target 分支),这次不处理,见 CLAUDE.md 待优化点。
    //
    // 【目标校验必须和服务端逐项对齐,不要手写简化版】playCard 对 target 牌的校验是三件事:
    // ①非自己(除非 spec.allowSelf,杀没有) ②目标存活 ③spec.canTarget——这里必须同样调用真正的
    // CARD_PLAYS['杀'].canTarget(而不是自己重算一遍 canReachSha),否则杀日后新增任何目标限制
    // (智迟/帷幕这类)这个按钮都不会跟着变,会渲染在服务端必然拒绝的座位上、点了没反应。
    // 双雄那个按钮就是手写了简化版(只查了空城,漏了 isZhichiImmune/weimu),已记进 CLAUDE.md
    // 待优化点,新代码不要重蹈覆辙。
    const isWushengShaSel = !!(selCard && resolveActionId(g, meP, selCard)!=='杀'
      && CARD_PLAYS['杀'].canPlay(g, meP, selCard));
    if(selectedCardIdx!==null && g.phase==='play' && g.turn===mySeat && isWushengShaSel
       && i!==mySeat && p.alive && CARD_PLAYS['杀'].canTarget(g, meP, selCard, i)){
      const idx=selectedCardIdx;
      const targetSeat=i;
      const wb=document.createElement('button');
      wb.className='ghost';
      wb.textContent='武圣:杀';
      wb.style.margin='6px 14px 0';
      wb.onclick=(e)=>{ e.stopPropagation(); confirmAndPlay('将这张手牌当【杀】对 '+g.players[targetSeat].name+' 使用,发动【武圣】？', ()=>playCard(idx, '杀', targetSeat)); };
      d.appendChild(wb);
    }
    // 借刀杀人:选中这张牌后走专属两步流程——先选 A(有武器),再选 B(A 攻击范围内的其他角色)。
    if(isJiedaoSel && g.phase==='play' && g.turn===mySeat){
      if(jiedaoSeatA===null){
        // 选 A:排除自己;要有武器;且场上要存在至少一个 A 攻击范围内、不是空城状态的其他存活角色
        // (否则选了也选不出合法的 B)。诸葛亮【空城】:B 不能是没有手牌的诸葛亮,和服务端
        // jieDaoShaRen 的校验口径一致。
        const hasSomeB = g.players.some((B,bi)=> B && B.alive && bi!==i && canReachSha(g,i,bi) && !(hasCap(B,'kongcheng') && (B.hand||[]).length===0));
        if(i!==mySeat && p.alive && p.equips && p.equips.weapon && hasSomeB){
          d.style.cursor='pointer';
          d.style.outline='2px dashed var(--cinnabar-bright)';
          d.onclick=()=>{ jiedaoSeatA=i; render(g); };
        }
      } else if(i!==jiedaoSeatA && p.alive && canReachSha(g, jiedaoSeatA, i) && !(hasCap(p,'kongcheng') && (p.hand||[]).length===0)){
        // 同上:idx/seatA 挂载时冻结,不在点击时才读 selectedCardIdx/jiedaoSeatA
        const idx=selectedCardIdx, seatA=jiedaoSeatA, seatB=i;
        d.style.cursor='pointer';
        d.style.outline='3px solid var(--gold)';
        d.onclick=()=>{ confirmAndPlay('对 '+g.players[seatA].name+' 使用【借刀杀人】,目标 '+g.players[seatB].name+'？',
            ()=>jieDaoShaRen(idx, seatA, seatB)); };
      } else if(i===jiedaoSeatA){
        d.style.outline='3px solid var(--gold)';
        d.style.cursor='pointer';
        d.onclick=()=>{ jiedaoSeatA=null; render(g); };
      }
    }
    // 张辽【突袭】选目标模式:点存活的其他玩家 = 切换选中/取消,上限 min(2,其他存活玩家数)。
    if(tuxiMode && g.phase==='draw' && g.turn===mySeat && i!==mySeat && p.alive){
      const otherAliveCount = g.players.filter((pp,ii)=>ii!==mySeat && pp && pp.alive).length;
      const maxPick = Math.min(2, otherAliveCount);
      const picked = tuxiPicks.includes(i);
      const selectable = picked || tuxiPicks.length<maxPick;
      if(selectable){
        d.style.cursor='pointer';
        if(picked) d.style.outline='3px solid var(--gold)';
        else d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{
          if(picked) tuxiPicks = tuxiPicks.filter(x=>x!==i);
          else if(tuxiPicks.length<maxPick) tuxiPicks.push(i);
          render(g);
        };
      }
    }
    // 凌统【旋风】:旋风选择阶段高亮可选目标
    if(g.pending && g.pending.type === 'xuanfengPick' && g.pending.from === mySeat && g.pending.stage === 'selecting') {
      if(i !== mySeat && p.alive) {
        d.style.cursor = 'pointer';
        d.style.outline = '2px dashed #4a90d9';
        d.onclick = () => pickXuanfengTarget(i);
      }
    }
    return d;
  }
  if(mySeat!==null && g.players[mySeat]){
    const meDOM = buildSeatDOM(mySeat);
    if(meDOM) meSeatEl.appendChild(meDOM);
  }
  // 按zone分流挂载容器:zone==='top'时进#oppTopRow(宽屏专用,3张座位卡靠它自身的flex横排,
  // 不再各自精确写grid-column/grid-row),其余(left/right,以及zones为null的窄屏/理论边界
  // 情况)一律沿用原有的#oppRow(display:contents,靠座位卡自己的grid-column/grid-row精确
  // 定位)。窄屏下zones恒为null,这个判断天然全部落到"其余"分支,和改动前的行为完全一致,
  // 不会把任何座位误分流进#oppTopRow。
  oppOrder.forEach(i=>{
    const oppDOM = buildSeatDOM(i);
    if(!oppDOM) return;
    if(zones && zones[i]==='top' && oppTopRowEl) oppTopRowEl.appendChild(oppDOM);
    else oppRowEl.appendChild(oppDOM);
  });
  // 中央出牌区:和音效共用同一批 markCardSound 调用点、同一个 seq 序列。调用点必须放在
  // 座位卡片(.seat)全部重新创建完毕之后——曾经放在 render() 更靠前的位置(座位重绘之前),
  // 结果是这一次 render() 里先给旧的座位元素加上高亮 class,紧接着座位重绘又把这些旧元素
  // 整体销毁替换成全新的(不带任何 class),同一次 render() 内高亮被自己立刻冲掉,座位高亮
  // 永远不可见(真实复现过的 bug,Playwright 截图+DOM 检查确认过)。#tableCard 本身不受
  // 这个顺序影响(它是持久节点,不会被座位重绘销毁),但它的目标座位高亮逻辑必须在这里、
  // 座位元素已经是"这一轮最终版本"之后执行。
  renderTableCard(g);
  // 第8步:座位卡分流挂载(#oppTopRow/#oppRow)和#tableStrip内容(renderTableCard)都已经
  // 是这一轮最终状态之后,才能测量出正确的"座位区+中央出牌区"实际渲染高度,所以放在这两者
  // 之后执行,和上面renderTableCard必须晚于座位重绘同一个理由。
  updateLogPanelHeight();

  // phase pill + deck info
  const phaseName={lobby:'等待开始',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段',respond:'响应阶段',duel:'决斗中',wuxie:'无懈响应',aoeResp:'群体响应',pick:'选牌',qilin:'弃坐骑',dying:'濒死求桃',guicai:'鬼才改判',tieqi:'铁骑判定',liegong:'烈弓',luoshen:'洛神判定',shuangxiongAsk:'双雄询问',xiaoguo:'骁果',xiaoguoChoice:'骁果选择',jiedaoChoice:'借刀杀人选择',wugu:'五谷丰登',qiaobianTurnStart:'巧变询问',qiaobianMove:'巧变移动',qinglong:'青龙偃月刀',hanbingAsk:'寒冰剑询问',hanbing:'寒冰剑弃牌',guanshi:'贯石斧',yijiAsk:'遗计询问',yijiAssign:'遗计分配',ganglieAsk:'刚烈询问',ganglieChoice:'刚烈惩罚',luoyiAsk:'裸衣询问',lirangAsk:'礼让询问',lirangRecover:'礼让回收',zhengyi:'争义询问',quhuRespond:'驱虎拼点',quhuDamageChoice:'驱虎伤害',fanjianSuit:'反间选花色',jiemingAsk:'节命询问',liuli:'流离询问',tianxiang:'天香询问',biyue:'闭月询问',pickingGeneral:'选将阶段',guanxingReview:'观星',shaOffsetChoice:'杀被抵消后的效果选择',mengjin:'猛进选择',zhijiChoice:'志继选择',tiaoxinChoice:'挑衅选择',tiaoxinDiscard:'挑衅弃牌',xunxunPick:'恂恂选择',wangxiAsk:'忘隙询问',over:'游戏结束'}[g.phase]||g.phase;
  document.getElementById('phasePill').textContent=phaseName;
  document.getElementById('deckInfo').textContent = g.started ? ('第'+(g.roundNum||1)+'轮 · 牌堆 '+g.deck.length+' · 弃牌堆 '+g.discard.length) : '';

  // banner 的全部内容现在唯一由 renderControls 负责写入(见该函数顶部 setBanner 说明),
  // 这里不再并行维护一份——避免同一份信息有两个书写者、两边不同步。
  renderControls(g);
  renderHand(g);

  // 常驻小面板:不受 logModalOpen 影响,每次 render 都刷新,只展示最近 LOG_PANEL_LINES 条。
  renderLogPanel(g);
  // 完整历史弹窗:仍然默认收起,只有 #logBtn 点开时才需要跟着这次 render 同步刷新内容
  // (Firebase 是实时推送,面板开着的时候底下状态可能还在变,不刷新就会显示过期日志)。
  if(logModalOpen) renderLogModal(g);

  // 日志 toast:有新日志才弹,把本次新增的日志(可能不止一条,比如延时锦囊判定这类一次事务
  // 里连续 pushLog 好几次)排队依次展示——早期版本"只弹最新一条"会把中间结果(比如判定牌本身
  // 生效/无效那条)淹没掉,只看到判定后紧跟着的下一条日志,看不出判定过程发生了什么。
  // 定位新增日志:直接用每条元素自带的 seq 过滤(> 上次已弹的 seq)即可,不用再"从数组末尾
  // 回溯匹配文本"——seq 单调递增且跨读取稳定,不受 slice(-40) 长度封顶影响,详见上面
  // lastToastedSeq 声明处的说明。
  const log = g.log||[];
  if(lastToastedSeq===undefined){
    lastToastedSeq = log.length ? log[log.length-1].seq : 0; // 第一次 render:只记当前最新 seq,不弹历史
  } else if(log.length){
    const newEntries = log.filter(e => e && Number.isInteger(e.seq) && e.seq > lastToastedSeq);
    if(newEntries.length){
      queueLogToasts(g, newEntries); // 直接传整条目(含 kind),由 queueLogToasts/showLogToast 内部取 text 与 kind
      lastToastedSeq = log[log.length-1].seq;
    }
  }
  } finally {
    // 双向隔离:①渲染抛异常不影响机器人继续被调度(否则机器人永久停摆);
    //          ②机器人调度自己抛异常也不污染渲染(catch 掉只记一条告警)。
    try{ if(typeof scheduleBotTurn==='function') scheduleBotTurn(g); }
    catch(e){ console.warn('bot schedule',e); }
  }
}



function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// ===== 说明浮层(独立于 render;bodyHtml 需已是安全 HTML,单条说明请自行 escapeHtml) =====
function showInfo(title, bodyHtml){
  const m=document.getElementById('infoModal');
  m.innerHTML='<div class="info-panel"><button class="info-close icon-btn" aria-label="关闭">✕</button>'
    +'<h3>'+escapeHtml(title)+'</h3><div class="info-body">'+bodyHtml+'</div></div>';
  m.classList.remove('hidden');
  m.onclick=(e)=>{ if(e.target===m) hideInfo(); };            // 点遮罩空白处关闭
  m.querySelector('.info-close').onclick=hideInfo;
  m.querySelector('.info-panel').onclick=(e)=>e.stopPropagation(); // 点面板本身不关闭
}
function hideInfo(){ const m=document.getElementById('infoModal'); m.classList.add('hidden'); m.innerHTML=''; logModalOpen=false; }
// 供座位卡内联触发(武将/装备,均公开信息);inline onclick 已 stopPropagation,不触发选目标
// showGeneralInfo(id):势力信息直接查 getGeneral(id).faction,不经过 generalFaction(player)——
// 这个函数的两个调用点(座位卡自己的"?"角标 / 化身行的"?")传入的 id 本身就已经是"该显示
// 哪个武将的信息"这个问题的答案(前者是 p.general 本身、后者是 p.huashenGeneral),不存在
// "要不要跟随化身"的二义性:座位卡"?"传的是玩家自己的 general(左慈点自己的"?"传'zuoci'、
// 显示群),化身行"?"传的是被借用武将的 id(如'caocao'、显示魏)——caller 已经选好了具体
// 描述哪个武将,这里只负责把这一个武将自己的势力如实显示出来。
// 势力块放进 body 而不是 title:showInfo 会对 title 整体做 escapeHtml,塞进去的 <span> 标签
// 会被转义成字面文本、色块渲染不出来;body 是原样插入(不转义),放这里才能正常显示。
function showGeneralInfo(id){
  const gen=getGeneral(id);
  if(!gen) return;
  const factionKey = gen.faction && FACTION_LABEL[gen.faction] ? gen.faction : null;
  const factionLine = factionKey
    ? '<div class="info-faction-line">势力：<span class="inline-faction faction-'+factionKey+'">'+FACTION_LABEL[factionKey]+'</span></div>'
    : '';
  showInfo(gen.name+' · '+gen.skill, factionLine+escapeHtml(gen.desc||'(暂无说明)'));
}
function showEquipInfo(name){ const e=getEquip(name); showInfo(name, escapeHtml((e&&e.desc)||'(暂无说明)')); }
function showDelayInfo(name){ showInfo(name, escapeHtml(getCardDesc(name)||'(暂无说明)')); }
// 帮助按钮:一次性列出全部牌/武将/装备说明
function showHelp(){
  let html='<div class="sec">基础牌 / 锦囊</div>';
  ['杀','火杀','雷杀','闪','桃','酒','决斗','无中生有','桃园结义','顺手牵羊','过河拆桥','无懈可击','南蛮入侵','万箭齐发','火攻','闪电','乐不思蜀','兵粮寸断','借刀杀人','五谷丰登','铁索连环'].forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getCardDesc(n))+'</div>'; });
  html+='<div class="sec">武将</div>';
  GENERAL_IDS.forEach(id=>{ const gg=getGeneral(id);
    html+='<div class="item"><b>'+escapeHtml(gg.name)+'【'+escapeHtml(gg.skill)+'】</b>：'+escapeHtml(gg.desc||'')+'</div>'; });
  html+='<div class="sec">装备</div>';
  Object.keys(EQUIPS).forEach(n=>{
    html+='<div class="item"><b>'+escapeHtml(n)+'</b>：'+escapeHtml(getEquip(n).desc||'')+'</div>'; });
  showInfo('规则 / 说明', html);
}
