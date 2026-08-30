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
  '八卦阵':'baguazhen', '仁王盾':'renwangdun', '藤甲':'tengjia', '白银狮子':'baiyinshizi', '朱雀羽扇':'zhuqueyushan',
  '的卢':'dilu', '绝影':'jueying', '爪黄飞电':'zhuahuangfeidian',
  '赤兔':'chitu', '紫骍':'zixing', '大宛':'dawan', '骕骦':'sushuang'
};
const SKILL_PINYIN = {
  // 只登记仓库中真实存在、非空且可播放的技能音频。新增映射时必须通过
  // run_skill_audio_integrity_test.js，避免技能触发时产生静默 404。
  'qiaomeng':'qiaomeng', '不屈':'buqu', '举荐':'jujian', '义从':'yicong', '乱击':'luanji',
  '乱武':'luanwu', '争义':'zhengyi', '仁德':'rende', '仁心':'renxin', '倾国':'qingguo',
  '克己':'keji', '再起':'zaiqi', '刚烈':'ganglie', '制蛮':'zhiman', '制衡':'zhiheng',
  '制霸':'zhiba', '化身':'huashen', '双雄':'shuangxiong', '反间':'fanjian', '反馈':'fankui',
  '同疾':'tongji', '咆哮':'paoxiao', '国色':'guose', '天义':'tianyi', '天妒':'tiandu',
  '天香':'tianxiang', '奇袭':'qixi', '奋迅':'fenxun', '奸雄':'jianxiong', '好施':'haoshi',
  '妄尊':'wangzun', '完杀':'wansha', '将驰':'jiangchi', '巧变':'qiaobian', '巨象':'juxiang',
  '帷幕':'weimu', '强袭':'qiangxi', '志继':'zhiji', '忘隙':'wangxi', '急救':'jijiu',
  '恂恂':'xunxun', '恩怨':'enyuan', '悲歌':'beige', '护驾':'hujia', '挑衅':'tiaoxin',
  '据守':'jushou', '救援':'jiuyuan', '散谣':'sanyao', '断粮':'duanliang', '断肠':'duanchang',
  '新生':'xinsheng', '旋风':'xuanfeng', '无双':'wushuang', '无言':'wuyan', '明策':'mingce',
  '智迟':'zhichi', '枭姬':'xiaoji', '武圣':'wusheng', '毅重':'yizhong', '洛神':'luoshen',
  '流离':'liuli', '涅槃':'niepan', '激将':'jijiang', '激昂':'jiang', '烈刃':'lieren',
  '烈弓':'liegong', '狂骨':'kuanggu', '猛进':'mengjin', '眩惑':'xuanhuo', '短兵':'duanbing',
  '礼让':'lirang', '神速':'shensu', '祸首':'huoshou', '离间':'lijian', '称象':'chengxiang',
  '空城':'kongcheng', '突袭':'tuxi', '红颜':'hongyan', '缔盟':'dimeng', '缠怨':'chanyuan',
  '耀武':'yaowu', '节命':'jieming', '苦肉':'kurou', '英姿':'yingzi', '英魂':'yinghun',
  '落英':'luoying', '蛊惑':'guhuo', '血裔':'xueyi', '裸衣':'luoyi', '观星':'guanxing',
  '趫猛':'qiaomeng', '连环':'lianhuan', '连营':'lianying', '谦逊':'qianxun', '遗计':'yiji', '酒诗':'jiushi',
  '铁骑':'tieqi', '闭月':'biyue', '集智':'jizhi', '雷击':'leiji', '青囊':'qingnang',
  '马术':'mashu', '驱虎':'quhu', '骁果':'xiaoguo', '鬼才':'guicai', '鬼道':'guidao',
  '魂姿':'hunzi', '黄天':'huangtian', '龙胆':'longdan'
};
// cardImageSrc: 映射表里没有这张牌名(比如以后加新牌但没先配这里)时返回 null,调用方按
// null 处理成"没有插画图片可用"——牌名文字始终固定显示在 .card-title 标题栏,不受这个
// 判断影响,和早期"图片铺满全卡、靠no-art控制牌名文字显示/隐藏"那版不同(见 CLAUDE.md)。
function cardImageSrc(name){
  const py = CARD_PINYIN[name];
  return py ? ('assets/cards/'+py+'.jpg') : null;
}
function mountRoleText(card){
  const equip=card&&getEquip(card.name);
  return equip&&equip.slot==='plus1'?'防':(equip&&equip.slot==='minus1'?'攻':'');
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
// 未开局(含选将阶段)一律只显示玩家名；开局后日志及中央出牌区只显示带边框的武将名，
// 例如【貂蝉】，不再附加括号里的玩家名。
function getPlayerDisplayLabel(g, p){
  if(!p) return '';
  const gen = (g && g.started && p.general!=null) ? getGeneral(p.general) : null;
  return gen ? ('【'+gen.name+'】') : p.name;
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

// ===== "轮到你了"提示:战鼓音效 + 大字视觉双重触发,同一个去重 key(见 render() 里的调用点) =====
// lastAnnouncedTurnKey:哨兵初始值 null(不是 undefined——这里不需要"第一次render不提示历史"
// 这套逻辑,一开始就没有任何"已提示过的轮次",null 天然和任何真实 turnKey 字符串都不相等)。
let lastAnnouncedTurnKey = null;
// lastAnnouncedPendingKey:"他人回合但自己需要响应"(被杀出闪/濒死求桃/技能询问等)这一类
// 提示的去重哨兵,和 lastAnnouncedTurnKey 是两套独立的 key/触发条件(见 render() 调用点),
// 不能共用同一个变量——两种场景可能在同一局游戏里交替出现。
let lastAnnouncedPendingKey = null;
// playTurnDrum: 播放"轮到操作"提示音效(战鼓声),覆盖两种场景——轮到自己回合、以及他人
// 回合但自己需要响应。CORE-70 之前这里用浏览器内置 SpeechSynthesis 播报"轮到你了"语音,
// 现在换成音效资源,和项目其它语音/音效同一套 new Audio().play().catch() 播放方式
// (见 maybePlayCardSound/maybePlaySkillSound)。
// 【资源缺失时的降级】assets/audio/turn_drum.mp3 这个文件本身可能还没有放进项目(见
// CORE-70 备注,音频资源留给后续补齐)——不存在时 .play() 会 reject,走 .catch() 只
// console.warn,不抛异常、不影响 showMyTurnBanner 视觉兜底,和项目里所有音效播放的既定
// 降级方式完全一致,不需要额外的"文件是否存在"检测。
function playTurnDrum(){
  try{
    const audio = new Audio('assets/audio/turn_drum.mp3');
    audio.play().catch(err=>console.warn('轮到操作提示音播放失败:', err && err.name, err));
  }catch(e){ console.warn('轮到操作提示音播放失败:', e); }
}
// playStartHorn: 点击"开始游戏"系列按钮时播放号角声,同一套降级方式(资源缺失只console.warn)。
function playStartHorn(){
  try{
    const audio = new Audio('assets/audio/start_horn.mp3');
    audio.play().catch(err=>console.warn('开始游戏提示音播放失败:', err && err.name, err));
  }catch(e){ console.warn('开始游戏提示音播放失败:', e); }
}
// shouldPlayResponsePendingDrum: "他人回合但自己需要响应"这类战鼓提示的触发判断 + 去重
// key 计算,从 render() 里抽成纯函数——不依赖 DOM/Audio,方便独立测试,不需要跑一遍
// 会触碰全部座位卡/手牌 DOM 的重量级 render(g) 才能验证这段去重逻辑对不对。
// 返回 { relevant, shouldPlay, key }:
//   relevant=false 表示这一刻根本不构成"他人回合+自己是响应者"(此时 render() 应该把
//     去重哨兵重置为 null,不留着上一次的 key);
//   relevant=true 时 shouldPlay 表示这个 key 和上次不同、该播放一次,key 是这次算出的新值
//   (无论 shouldPlay 是否为 true,render() 都应该把哨兵更新成这个 key)。
function shouldPlayResponsePendingDrum(g, seat, lastKey){
  if(!(g && g.started && g.turn!==seat && g.pending && typeof g.pending.askedAt==='number')) {
    return { relevant:false, shouldPlay:false, key:null };
  }
  if(typeof pendingResponderSeat!=='function' || pendingResponderSeat(g,g.pending)!==seat){
    return { relevant:false, shouldPlay:false, key:null };
  }
  const key = g.pending.type+':'+g.pending.askedAt;
  return { relevant:true, shouldPlay: key!==lastKey, key };
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
// CORE-86(issue #133):强制横屏遮罩此前只看方向、不看屏幕大小,平板竖屏(iPad 768×1024 /
// iPad Pro 1024×1366)这种宽度完全够用的设备也被一刀切挡死。这条限制本来就只该针对"竖屏
// 时宽度窄到放不下横排对手行"的手机——index.html 的响应式体系里,手机竖屏档是
// @media(max-width:640px)/(max-width:480px),641px 以上早就被当作平板处理(见 index.html
// "平板布局"那两块:主块 (min-width:641px) and (max-width:1199px) 覆盖平板横竖屏,另有
// (min-width:641px) and (max-width:900px) and (orientation:portrait) 一整块平板竖屏专用
// 规则)。**那块平板竖屏 CSS 在这次修复之前是完全执行不到的死代码**——遮罩无条件拦截了
// 所有竖屏,CSS 写了也永远没机会生效,这本身就是"当初设计意图就是要支持平板竖屏、只是
// 遮罩这一侧漏改了"的直接证据。
// 阈值取 640 是为了和 CSS 侧的手机断点严格互补(不留空隙也不重叠):width<=640 恰好就是
// 手机竖屏 CSS 生效的范围,遮罩只在这个范围内出现;641 及以上交给平板 CSS,放行竖屏。
// 现实机型不会落进夹缝:竖屏最宽的手机(iPhone Pro Max 一类)约 430 CSS px,远低于 640;
// 折叠屏展开后约 768px,本来就该按小平板对待,放行是正确行为。
const LANDSCAPE_GATE_MAX_WIDTH = 640;
// CORE-119(issue #151):这条遮罩此前对大厅和对局一视同仁——大厅只有房间号/昵称两个
// 输入框和一个按钮,没有横屏的技术需求,但用户必须先转横屏才能点开它们。真正需要横屏的
// 是"进入对局"之后的横排对手行/中央出牌区这套布局。#game 元素是否带 .hidden class 就是
// 项目里现成的"是否已经进入对局"信号(joinRoom/backToLobby 等既有生命周期函数一直靠它
// 切换视图,这里复用同一个信号,不新增状态)。大厅阶段(#game 仍是 hidden)直接放行,不
// 拦截;进入对局后行为不变。
// 拿不到 #game 元素的极端环境(和下面拿不到有效宽度同一考虑)保持旧行为:按"已在对局中"
// 处理,不放宽——线上正常环境里 #game 必定存在于 DOM 中,只在测试/异常环境里才会缺失。
function shouldShowLandscapeGate(){
  if(!isPortrait()) return false;
  const gameEl = document.getElementById('game');
  if(gameEl && gameEl.classList.contains('hidden')) return false; // 大厅阶段,不拦截
  const w = window.innerWidth;
  // 拿不到有效宽度的极端环境(和 isPortrait 自己的兜底同一考虑)保持旧行为:提示横屏。
  if(!Number.isFinite(w) || w <= 0) return true;
  return w <= LANDSCAPE_GATE_MAX_WIDTH;
}
function checkLandscapeGate(){
  const gate = document.getElementById('landscapeGate');
  if(!gate) return;
  gate.classList.toggle('hidden', !shouldShowLandscapeGate());
}
// 和 unlockAudioOnce 同一套写法:页面加载后立即注册监听、立即跑一次初始检测——大厅阶段
// 也要跑(不能等进入房间),因为 resize/orientationchange 期间用户可能正好从大厅转到对局,
// 遮罩需要能响应这个切换;shouldShowLandscapeGate 内部会按 #game 是否可见分别处理两种场景。
checkLandscapeGate();
window.addEventListener('resize', checkLandscapeGate);
window.addEventListener('orientationchange', checkLandscapeGate);

// ===== 宽屏桌面布局(desktop-layout-8p 第3步骨架) =====
// assignSeatZones(playerCount, mySeat): 纯函数,把"我"以外的座位分到 top/left/right
// 三个区域(见函数内注释),"我"自己固定 'me'。返回数组按座位号索引取值。
// 分区规则:
//   - 对手数(others=playerCount-1) <=3(即2~4人局): 全部 top
//   - others===4(5人局): top3 + left1——这一档刻意维持不变,不套用下面 others>=5 的新规则。
//     根因:5人局的"每行最多能塞几个"这个问题,最优解在1440×900和1920×1080两档分辨率下
//     实测结果不一致(1440px下4个对手能全塞进top一行；1920px下算出来的卡片更大,4个塞不进
//     同一行,只能退回2/1/1这种更保守的切法)——也就是说5人局的最优切法不再是"只看人数"就能
//     确定的纯函数,需要在运行时查询实际视口宽度才能判断,这是比这次调整更大的架构改动
//     (assignSeatZones 目前只接收 playerCount/mySeat 两个和视口无关的参数),留给以后单独
//     的任务处理,这次不碰。
//   - others>=5(6~8人局): leftCount/rightCount 各封顶为1(而不是旧版的2)——这是这次
//     "座位卡最大化"任务验证过的核心杠杆:left/right 区的卡片只能用自己所在的那一条窄列
//     宽度(和top行共享三列合计的宽度完全不同),2张纵向堆叠必然要占2行；封顶1张后,
//     该区最多只需要1行,多出来的座位全部推给top行(topCount=n-2,top行横跨全部三列,
//     宽度富余得多),从而把原来3行压缩到2行——真实测量确认topCount最大到5(8人局)时,
//     top行横向空间依然绰绰有余,不会挤压变形,详见CLAUDE.md"座位卡最大化"条目里的
//     完整验证数据。
//   - others===8(9人局,SEATS=9扩容新增): 走 top6+left1+right1——和 6~8 人局同一套
//     公式的延伸(经典桌面牌桌布局只认 top 行 + 左右各 1 槽 grid-row:2,不识别
//     data-zone-index,left 第二槽在经典块下没有位置、会和 left 第一槽完全重叠,
//     这是 task-8 报告里用真实 chromium 渲染确认过的缺陷),所以 9 人局必须保证
//     left/right 各最多 1 个,多出的对手全部推给 top 行。top 行 6 张的横向容纳由
//     index.html 经典块的 nth-child(6) 分档(max-width:125px)保证:6×125+5*gap8px+
//     padding ≈ 790px < top 行可用宽度(1200px 视口下限时也有 ~890px,见 task-8 报告
//     的四档实测)。computeOppZoneRowsUsed 同步保持 2 行(见该函数注释)。
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
  } else if(n>=8){
    // 9人局(8个对手):top6+left1+right1——经典桌面牌桌布局只认 top 行 + 左右各 1 槽
    // (grid-row:2),left 第二槽在经典块下没有位置会与 left 第一槽重叠(见函数上方注释),
    // 所以多出的对手全部推给 top 行,top 6 张由 nth-child(6) 分档保证容纳。
    topCount = 6; leftCount = 1; rightCount = 1;
  } else {
    // n>=5(6~8人局): leftCount/rightCount 各封顶1,多出的座位全部推给top行,把原来
    // 3行压缩到2行。n=5(6人局)→top3+left1+right1；n=6(7人局)→top4+left1+right1；
    // n=7(8人局)→top5+left1+right1,同一条公式覆盖三档,不用分别写分支。
    topCount = n - 2; leftCount = 1; rightCount = 1;
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
function isDesktopLayout(){
  // 不能只看宽度：iPad Pro 等横屏平板同样可能达到 1024~1366px，旧判断会误套
  // 鼠标桌面专用的四列布局。电脑布局要求足够宽且具备精确指针；触屏设备无论横竖屏
  // 都交给 index.html 的手机/平板响应式规则。
  if(window.innerWidth < 1200) return false;
  if(typeof window.matchMedia!=='function') return true; // 旧浏览器/测试环境安全回退
  return window.matchMedia('(hover:hover) and (pointer:fine)').matches;
}
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
// ===== 桌面自适应 步骤a:对手区座位卡尺寸驱动方向反转(和"手机横屏矮视口"同一手法,
// 见 index.html 里 #game.desktop-layout #oppTopRow .seat/#oppRow .seat[data-zone] 那条
// CSS 的说明)=====
// computeOppZoneRowsUsed(playerCount): 对手区(top/left/right三个zone共用grid行)这一局
// 实际用了几行,必须和 assignSeatZones(本文件靠前)的分区规则逐档保持同步——这两个函数
// 描述的是同一件事的两个方面(assignSeatZones 决定"谁在哪个zone",这个函数决定"这些zone
// 总共占几行"),分区规则一旦变了这里必须跟着改,不能各自维护一套数字。
//   others<=3(2~4人局): 只有top,1行
//   others===4(5人局): top+left(仅1个,只占row2,row3空),2行——5人局刻意维持旧规则
//     不变(见 assignSeatZones 里的说明),这里同步保持2行。
//   others>=5(6~9人局): 【Task 8 修正】leftCount/rightCount 现在各封顶1(6~8人局是
//     "座位卡最大化"任务从旧版2改来的,9人局在 task-8 里同步归入同一档),意味着
//     left/right 各自最多占1行(row2),row3 不再被 left/right 使用——总行数统一为2行。
//     (9人局最初按 top5+left2+right1 的设计回到过3行,但那个方案在经典桌面牌桌布局下
//     left 第二槽没有 grid-row 位置、与 left 第一槽重叠,已废弃,见 assignSeatZones。)
function computeOppZoneRowsUsed(playerCount){
  const others = playerCount - 1;
  if(others<=3) return 1;
  return 2;
}
// updateDesktopSeatHeights(g): 和 updateLogPanelHeight() 同一套"JS量出实际渲染位置、
// 回写内联style"模式,调用时机也一样——必须在 tableStrip/panel.table/myGeneral/
// hand-label/meSeat/hand 全部渲染完毕之后(render(g)里放在renderControls/renderHand
// 之后),因为要测量这些区块已经占用了多少高度,才能算出"对手区还能分到多少"。
// 这一步比 updateLogPanelHeight() 多一层复杂度:可用高度不是简单地"填满剩余空间"就
// 结束,还要按 computeOppZoneRowsUsed() 算出的行数(1~3,取决于人数)均分——桌面下
// 对手区行数本身是变量,不能像手机横屏那次一样直接套一个固定的 dvh clamp(那次对手区
// 永远只有1行)。
// **这一步(步骤a)只处理座位区域自己,不管其它区块要不要一起压缩**(那是步骤b的范围)——
// 这里的"可用高度"计算方式是把 tableStrip 到 footnote 这一段(不依赖座位卡尺寸,可以
// 直接测量当前DOM,哪怕座位卡此刻还是旧尺寸)当作既定开销直接减掉,可能在步骤b压缩这些
// 开销之前算出的每行高度会偏保守(留的余量较小甚至暂时还不够填平全部溢出),这是预期的
// 阶段性状态,不是bug——步骤b会重新压缩这些开销,届时同一份计算逻辑会自动算出更宽裕的
// 每行高度,不需要改这个函数本身。
function updateDesktopSeatHeights(g){
  const oppSeatEls = document.querySelectorAll('#oppTopRow .seat, #oppRow .seat[data-zone]');
  // meSeat 真正的座位卡视觉元素是 #meSeat 的**子元素**(class="seat me",由 buildSeatDOM
  // 生成后 appendChild 进去),不是 #meSeat 这个 grid 包装 div 本身——包装 div 没有任何
  // 尺寸相关的 CSS 规则,设置在它身上不会影响子元素的实际渲染尺寸(真实踩过的坑,详见
  // 下面主逻辑里的完整说明)。清理路径同样要作用于子元素。
  const meSeatCardElForCleanup = document.querySelector('#meSeat .seat');
  if(!desktopLayoutActive || !g || !g.started){
    // 非桌面布局/未开局:清掉可能残留的内联尺寸,回退给CSS基础规则(宽度驱动)。
    // meSeat 同样要清空——空间再分配之后它的尺寸也由本函数动态设置,离开桌面布局时
    // 同样需要回退给CSS基础规则(.seat.me 的 width:220px;max-width:260px),不清空
    // 会让残留的桌面尺寸带进窄屏/手机布局。
    oppSeatEls.forEach(el=>{ el.style.height=''; el.style.width=''; });
    if(meSeatCardElForCleanup){ meSeatCardElForCleanup.style.height=''; meSeatCardElForCleanup.style.width=''; }
    return;
  }
  const seatN = (g.players||[]).length;
  if(seatN<2) return;
  const rowsUsed = computeOppZoneRowsUsed(seatN);
  const oppTopRowEl = document.getElementById('oppTopRow');
  const meSeatEl = document.getElementById('meSeat');
  const handEl = document.getElementById('hand');
  const gameEl = document.getElementById('game');
  if(!oppTopRowEl || !gameEl) return;
  // 【真实踩过的循环依赖 bug,已用真实dump定位】:.log-panel 是 grid-row:1/span 3,
  // 和对手区共享同一批行——它的高度由 updateLogPanelHeight() 算,但那个函数排在这个
  // 函数之后调用(必须如此,见调用点注释:它要读"座位区已经是这一轮最终尺寸"之后的
  // 结果)。问题是:.log-panel 的内联 height 是"设置后一直留着,下次调用才会覆盖"的
  // 写法——如果上一次 render() 是人数更多的一局(.log-panel 内联高度较大),这一次
  // render() 走到这里时,.log-panel 那个偏大的旧内联高度依然生效、依然在撑住 grid 的
  // 第1~3行,导致下面测出来的 tableStrip/footnote 位置偏低、"对手区可用高度"被污染成
  // 偏小的错误值——而且这不是"晚一帧自愈"的瞬时误差,是一个稳定的错误不动点(连续多次
  // render 同一个人数更少的对局,污染后的偏小结果会一直保持,不会自己纠正,真实dump
  // 反复验证过)。修法:这里先把 .log-panel 的内联高度清空,让 grid 用它当前真实内容
  // (不受上一次遗留高度影响)重新算行高,再做下面的测量——之后 updateLogPanelHeight()
  // 会立刻给它设上正确的新高度,不会留下"没有高度"的中间状态。
  const logPanelEl = document.getElementById('logPanel');
  if(logPanelEl) logPanelEl.style.height = '';
  const oppZoneTop = oppTopRowEl.getBoundingClientRect().top;
  const rowGap = 8; // 和 #game.desktop-layout 的 row-gap:8px 对应,行间距也要算进预算里
  // 【真实踩过的三处坑,已修复,记录下来避免以后重新踩】:
  // ①第一版直接测 tableStripEl.getBoundingClientRect().top 当"对手区下方从哪里开始"的
  // 界桩,又用 .footnote.getBoundingClientRect().bottom 当"内容到哪结束"——步骤b把
  // .footnote在游戏中隐藏(display:none)后,它的rect全部返回0,会让可用高度计算误判
  // "对手区下方毫无内容"、把几乎整个视口余量错误分给对手区,座位卡被撑得远超合理尺寸、
  // 总页面反而溢出得更厉害(真实测过:6/8人局溢出从135px恶化到412px)。
  // ②改用tableStrip的top测量后,发现#tableStrip自己有 align-self:center(把它在row2/3
  // 合并的空间里居中,而不是贴顶)——这意味着tableStrip当前的top位置本身就循环依赖"row2/3
  // (即left/right座位卡)现在有多高",正是要求解的对手区座位高度本身,会让结果偏保守/
  // 不精确(算出92.17却被地板夹到90,视口还剩128px完全没用上)。
  // ③改成"加总panelTable/myGeneral/handLabel各自的border-box高度,行间距一律按8px的
  // 网格row-gap算"——这个假设是错的:.panel.table 有 margin:0 0 6px,.hand-label 有
  // margin:6px 0 4px,这些CSS margin会叠加在grid的row-gap之上(grid不会把它们合并/
  // 吸收掉),导致算出来的可用高度比实际需要的更宽松,结果6/8人局座位卡被撑大后总页面
  // 反而溢出40px(真实测过)。
  // **最终修法**:不再假设/加总任何具体的padding/margin/gap数值,改成直接测量"对手区
  // 当前(不管此刻是什么尺寸)实际渲染到哪里结束"(取全部 oppSeatEls 里最大的 bottom,
  // 不用 tableStrip 这种会自我居中、依赖对手区高度的元素当界桩)到 contentBottom 之间
  // 的距离——这是安全的位置差測量,不是循环依赖:row4~7这几个元素都是
  // align-items:start(容器默认值,均未覆盖),会随对手区(rows1-3)增高/变矮而整体
  // 同步平移,彼此之间的间距(含它们各自的CSS margin)保持不变,所以“此刻对手区多高”
  // 不影响这段差值本身的准确性,读到的就是包含全部真实margin/padding/gap在内的精确
  // 下方开销,不需要手动枚举每一处margin/gap分别是多少。 */
  let currentOppZoneBottom = oppZoneTop;
  oppSeatEls.forEach(el=>{ currentOppZoneBottom = Math.max(currentOppZoneBottom, el.getBoundingClientRect().bottom); });
  if(oppTopRowEl) currentOppZoneBottom = Math.max(currentOppZoneBottom, oppTopRowEl.getBoundingClientRect().bottom);
  // 【空间再分配(桌面布局第10步):meSeat 不再是"下方固定开销"的一部分,改成和对手区
  // 联立求解的第二个未知数】——此前这里直接测 meSeat/hand 的 bottom 当"内容到哪结束",
  // 把 meSeat 的(固定180px宽,aspect-ratio反推240px高)当成一块不可拆分的既定开销,
  // 这正是"座位卡明显偏小"这个问题的根源:6~8人局对手区已经被压得很小,meSeat却始终
  // 占用240px纵向空间,不参与共享预算、不随对手区一起收紧。
  // 改法:只测量"从对手区当前(不管此刻是什么尺寸)结束的地方,到 meSeat 当前(同样不管
  // 此刻是什么尺寸)开始的地方"这一段固定距离(fixedMiddleHeight,涵盖panelTable/
  // myGeneral/handLabel及它们之间/前后的全部真实gap和margin)——这段距离和"三行对手区
  // 现在多高"以及"meSeat现在多高"都无关(panelTable等这几个元素是各自独立的单行,
  // 不跨行,不受相邻行尺寸变化牵连,是安全的位置差测量,同一手法这个函数上面已经用过
  // 一次)。用 meSeatEl.top(而不是 meSeatEl.bottom)作为下边界,是因为 top 只取决于
  // "meSeat这一行从哪里开始"(由前面几行多高决定),不取决于 meSeat 自己现在多高——
  // 这样即使 meSeat 当前尺寸是上一轮渲染残留的旧值,也不会污染这段测量。
  const fixedMiddleHeight = meSeatEl ? Math.max(0, meSeatEl.getBoundingClientRect().top - currentOppZoneBottom)
    : Math.max(0, gameEl.getBoundingClientRect().bottom - currentOppZoneBottom);
  // 【真实踩过的第四处坑】:曾经固定写死"留8px安全边距"当 targetBottom,但
  // meSeat/hand 之后还有 .wrap 自己的 padding-bottom(步骤b给游戏中的桌面视角设了
  // padding:10px 16px 10px)——这段 padding 在 meSeat/hand 的 getBoundingClientRect()
  // 之外,不会被前面的测量捕捉到,但它确确实实会让页面整体的 scrollHeight 比内容底部
  // 还要再高出这一截,固定8px不够覆盖,真实测过 8~14px 的溢出。改成动态读 .wrap 当前
  // 实际的 padding-bottom(getComputedStyle,不是把10px这个数字誊抄硬编码到这里——
  // 以后如果 .wrap 的 padding-bottom 数值改了,这里能跟着自动生效,不需要同步改两处)。 */
  const wrapEl = document.querySelector('.wrap');
  const wrapPaddingBottom = wrapEl ? (parseFloat(getComputedStyle(wrapEl).paddingBottom) || 0) : 0;
  const targetBottom = window.innerHeight - wrapPaddingBottom - 4; // 再留4px余量,不贴边
  // 【真实踩过的第五处坑】:top区(row1)套了一层 #oppTopRow 容器,它自己有
  // padding:8px 8px 4px(上下合计12px),而left/right区(row2/row3)的座位卡是
  // #oppRow(display:contents,不生成盒子)的直接子节点,没有这层容器包装、没有这
  // 额外的12px——三行"每行需要的总高度"并不是单纯的三份 perRowHeight 那么整齐,
  // row1 实际需要 perRowHeight+12,row2/row3 只需要 perRowHeight。旧公式假设三行
  // 完全相等平摊预算,而这12px只属于row1一行、没有从预算里单独先扣掉,导致算出的
  // perRowHeight比真正能用的偏大了一截,座位卡设成这个偏大的值后总页面因此溢出
  // ——真实测过约12px的残余溢出)。
  // 改成动态读 #oppTopRow 当前的 padding-top+padding-bottom(不硬编码12这个数字,
  // 万一以后CSS里的padding值改了这里也能跟着变),从"三行共享的预算"里单独先扣掉
  // 这部分,只属于row1、不该被三行平摊。 */
  const oppTopRowStyle = getComputedStyle(oppTopRowEl);
  const oppTopRowPadding = (parseFloat(oppTopRowStyle.paddingTop)||0) + (parseFloat(oppTopRowStyle.paddingBottom)||0);
  // ME_SEAT_RATIO: meSeat(我的座位卡)应比对手座位卡高出的固定倍率——保持既有的
  // "我的卡必须比对手更大更醒目"这条规则(verify_stage1_seatcard.js 锁定的既有回归),
  // 但不再是一个和对手区无关的绝对固定值,而是和对手区高度成比例、联立求解同一个总预算:
  //   R*h + (R-1)*rowGap + oppTopRowPadding + fixedMiddleHeight + ME_SEAT_RATIO*h = 可用总预算
  //   → h = (可用总预算 - (R-1)*rowGap - oppTopRowPadding - fixedMiddleHeight) / (R + ME_SEAT_RATIO)
  // 这样对手区吃紧(6~8人局)时,meSeat 会跟着一起收缩、不再是一块脱离预算的刚性开销;
  // 对手区宽裕(2~4人局)时,meSeat 也能相应长得更大,而不是停留在旧版写死的240px。
  const ME_SEAT_RATIO = 1.25;
  const solvedHeight = (targetBottom - oppZoneTop - (rowsUsed-1)*rowGap - oppTopRowPadding - fixedMiddleHeight) / (rowsUsed + ME_SEAT_RATIO);
  // 上下限保护:下限90px是这一步的临时值(步骤c会用真实测量+放大截图重新核实可读性
  // 下限,届时如果需要会调整这个数字或新增更紧的响应式断点,不是这里就能一次定死的)。
  // 【空间再分配第13步修正,真实bug】:上限原来写死266.7px("当前既有CSS宽度驱动方案下
  // 算出来的最大值,200px宽×4/3")——这只是一个从旧版本carry over下来的历史数字,不是
  // 真实的纵向空间上限。真实dump测过:1920×1080下2~4人局(rowsUsed=1,纵向预算最宽裕)
  // 未clamp的solvedHeight其实有336.2px,却被这个历史legacy常数硬夹回266.7,白白扔掉
  // 69.5px的真实可用高度(1440×900下2~4人局solvedHeight只有256.2,本来就没到266.7,
  // 不受这个legacy值影响;5~8人局两档分辨率下solvedHeight都远低于266.7,同样不受影响
  // ——这条legacy上限唯一真正束缚到的场景就是1920×1080的2~4人局)。改成400px(比目前
  // 测过的最大真实值336.2多留63.8px余量,对已测的两档分辨率、全部人数都不会被这个新
  // 上限反过来夹住,同时仍保留一个有限的sanity上限,不是彻底去掉夹子——防止未来在
  // 明显更高的视口下座位卡被解出一个不合理的巨大尺寸)。
  const height = Math.max(90, Math.min(400, solvedHeight));
  oppSeatEls.forEach(el=>{
    el.style.height = height+'px';
    el.style.width = 'auto';
  });
  // 【真实踩过的第六处坑,这次是空间再分配任务里引入的】:meSeat 高度尺寸真实设置在
  // 了 #meSeat 这个 grid 包装 div 上,但 #meSeat 本身没有任何 CSS 尺寸规则(aspect-ratio
  // 等全部声明在 .seat/.seat.me 这条规则上)——真正的座位卡视觉元素是 buildSeatDOM 生成、
  // 通过 meSeatEl.appendChild(meDOM) 挂进去的**子元素**(class="seat active me"),和
  // #oppTopRow/#oppRow 装 .seat 子元素同一个结构关系。给包装 div 设 height 完全不影响
  // 它内部这个子元素的实际渲染尺寸——子元素会继续按自己的 CSS(此时因为已删除桌面专属的
  // 180px覆盖,回退到基础规则 .seat.me{width:220px;max-width:260px}+aspect-ratio:3/4)
  // 独立渲染成 220×293.3px,和包装 div 上设置的高度毫无关系,包装 div 自己反而会被撑高
  // 去适应这个"实际尺寸远大于预期"的子元素——真实测过:6人局本该 178px 高的 meSeat,
  // 因为这个疏漏实际渲染成 293px,页面因此溢出101~105px(和"计算值178 vs 实际293"这个
  // 115px量级的差距基本吻合)。
  // 修法:改成给**子元素**(meSeatEl.querySelector('.seat'))设置 height/width,和
  // oppSeatEls 的选择方式保持同一模式,不是给包装 div 设置。 */
  const meSeatCardEl = meSeatEl ? meSeatEl.querySelector('.seat') : null;
  if(meSeatCardEl){
    // meSeat 的高度上限由它所在列(grid-column:1)当前实际渲染宽度反推,不再硬编码
    // 240 这个数字。【空间再分配第11步】之前左/右列固定 minmax(100px,180px),180px
    // 宽度对应的高度上限恰好是180/0.75=240,当时把这个算好的常数直接写死;这次第11步
    // 把左/右列改成 minmax(100px,1fr)(参见 index.html 对应注释),列宽本身随视口
    // 宽度变化(不再是固定180px),240 这个写死的数字就不再准确——用
    // meSeatEl.getBoundingClientRect().width(网格项默认拉伸铺满所属列轨道的整个宽度,
    // 这里从未给 #meSeat 包装div本身设置过内联宽度,读到的就是列轨道的真实宽度)重新
    // 动态算出"这条列这一刻能放下的最大高度"——列变宽时(比如更宽的桌面视口)上限
    // 跟着变宽,列变窄时上限也跟着收紧,不会出现"列已经变了、上限还停留在旧数字"这种
    // 脱节。 */
    const meSeatColumnWidth = meSeatEl.getBoundingClientRect().width;
    const meSeatHeightCeiling = meSeatColumnWidth>0 ? meSeatColumnWidth/0.75 : 240;
    const meSeatHeight = Math.max(90*ME_SEAT_RATIO, Math.min(meSeatHeightCeiling, ME_SEAT_RATIO*height));
    meSeatCardEl.style.height = meSeatHeight+'px';
    meSeatCardEl.style.width = 'auto';
  }
}
window.addEventListener('resize', () => { updateDesktopLayoutFlag(); updateDesktopSeatHeights(currentG); updateLogPanelHeight(); });

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

// ===== 实际扣血反馈:所有客户端共用 g.lastDamageEffect.seq 去重 =====
// 视觉只落在受伤座位卡上；音效按受伤武将性别选择独立的剑击+受击声文件。
let lastPlayedDamageSeq = undefined;
function playDamageHitSound(g,targetSeat){
  try{
    const p=g.players && g.players[targetSeat];
    const gen=p && typeof getGeneral==='function' ? getGeneral(p.general) : null;
    const gender=(gen && gen.gender) || (p && p.gender);
    const file=gender==='female'?'damage_female.wav':'damage_male.ogg';
    const voice=new Audio('assets/audio/'+file);
    const sword=new Audio('assets/audio/damage_sword.mp3');
    voice.volume=.82; sword.volume=.58;
    voice.play().catch(err=>console.warn('受击音效播放失败:',file,err && err.name,err));
    sword.play().catch(err=>console.warn('剑击音效播放失败:',err && err.name,err));
    // 游戏反馈只播放一次短促受击声；即使以后替换成较长源文件，也不会连续呻吟。
    setTimeout(()=>{ [voice,sword].forEach(audio=>{ try{ audio.pause(); audio.currentTime=0; }catch(e){} }); },700);
  }catch(e){ console.warn('受击音效播放失败:',e); }
}
function maybeShowDamageEffect(g){
  const evt=g.lastDamageEffect;
  if(!evt || !Number.isInteger(evt.seq)){ if(lastPlayedDamageSeq===undefined) lastPlayedDamageSeq=0; return; }
  if(lastPlayedDamageSeq===undefined){ lastPlayedDamageSeq=evt.seq; return; } // 刷新不补播历史伤害
  if(evt.seq===lastPlayedDamageSeq) return;
  lastPlayedDamageSeq=evt.seq;
  const seat=document.querySelector('.seat[data-seat="'+evt.target+'"]');
  if(seat){
    seat.dataset.damageAmount=String(Math.max(1,evt.amount||1));
    seat.classList.remove('damage-hit');
    void seat.offsetWidth;
    seat.classList.add('damage-hit');
    clearTimeout(seat._damageTimer);
    seat._damageTimer=setTimeout(()=>seat.classList.remove('damage-hit'),720);
  }
  playDamageHitSound(g,evt.target);
}

// ===== 闪电判定特效:所有客户端共用 g.lastLightningFx.seq 去重 =====
// 触发点在 data.js 的 DELAY_TRICKS['闪电'].effect(判定结果一出来就写):hit:true=劈中播
// falsh1、hit:false=未劈中播 falsh0(见 game-bg.js triggerLightningFx)。哨兵模式与
// maybePlayCardSound/maybeShowDamageEffect 同款:首次进入/刷新不补播历史,seq 未变不重复。
let lastLightningFxSeq = undefined;
function maybePlayLightningFx(g){
  const evt=g.lastLightningFx;
  if(!evt || !Number.isInteger(evt.seq)){ if(lastLightningFxSeq===undefined) lastLightningFxSeq=0; return; }
  if(lastLightningFxSeq===undefined){ lastLightningFxSeq=evt.seq; return; } // 刷新不补播历史
  if(evt.seq===lastLightningFxSeq) return;
  lastLightningFxSeq=evt.seq;
  if(typeof triggerLightningFx==='function') triggerLightningFx(evt.hit===true);
}

// ===== 过场动画:所有客户端共用 g.lastMovieFx.seq 去重 =====
// 写入端在 game.js 的 finishDying(武将死亡)/checkWin(胜负结算)。kind+seat 决定播放条件,
// 优先级:三人表情 > 左慈 > 于吉 > 阵营统一动画(用户指定)。返回要播的内容:legacy kind
// 返回 game-bg.js MOVIE_VIDEOS 的键,三人表情直接返回具体视频路径(每客户端不同,不能共用键):
//   yujiDeath :于吉死 → 于吉以外的玩家播 yuji1
//   yujiKill  :于吉杀人 → 于吉以外且仍存活的玩家播 yuji0
//   zuociDeath:左慈死 → 仅杀死左慈的玩家播 zuoci0
//   girlKill  :三人之一杀人(杀手座位/result.gen/victimSeat)→ 杀手播 gen-xiuse 无后缀、
//              被杀者播 gen-wumei 无后缀、其他玩家随机播后缀变体
//   girlDeath :三人之一被杀(死者座位/result.gen/killerSeat)→ 死者播 gen-mamu 无后缀、
//              杀手播 gen-weiju 无后缀、其他玩家随机播后缀变体
//   gameOver  :胜负结算 → 本人是三人之一:胜播 gen-kaixin / 败播 gen-beitong(无后缀);
//              旁观者:有 girlWin/girlLose 时随机播对应后缀(替换阵营动画,无后缀池则回退
//              阵营动画)→ 左慈输播 zuoci1 → 反贼输 fanze-lost / 反贼胜 fanzei-win /
//              主公输 zhuzhong-lost / 忠臣输 han / 内奸胜 neijian-win
// 表情视频表(GIRL_EMO_GENERALS 见 data.js):{武将id: {情绪: {main:无后缀路径, sfx:[后缀路径]}}}
// 命名约定 assets/video/<武将>-<情绪>.mp4 与 <武将>-<情绪>NN.mp4。
const GIRL_VIDEOS = {
  daqiao: {
    kaixin:  { main:'assets/video/daqiao-kaixin.mp4',    sfx:['assets/video/daqiao-kaixin01.mp4'] },
    beitong: { main:'assets/video/daqiao-beitong.mp4',   sfx:['assets/video/daqiao-beitong01.mp4'] },
    mamu:    { main:'assets/video/daqiao-mamu.mp4',      sfx:['assets/video/daqiao-mamu01.mp4','assets/video/daqiao-mamu02.mp4'] },
    weiju:   { main:'assets/video/daqiao-weiju.mp4',     sfx:['assets/video/daqiao-weiju01.mp4'] },
    wumei:   { main:'assets/video/daqiao-wumei.mp4',     sfx:[] },
    xiuse:   { main:'assets/video/daqiao-xiuse.mp4',     sfx:['assets/video/daqiao-xiuse01.mp4','assets/video/daqiao-xiuse02.mp4','assets/video/daqiao-xiuse03.mp4'] },
  },
  diaochan: {
    kaixin:  { main:'assets/video/diaochan-kaixin.mp4',  sfx:['assets/video/diaochan-kaixin01.mp4','assets/video/diaochan-kaixin02.mp4','assets/video/diaochan-kaixin03.mp4','assets/video/diaochan-kaixin04.mp4'] },
    beitong: { main:'assets/video/diaochan-beitong.mp4', sfx:['assets/video/diaochan-beitong01.mp4'] },
    mamu:    { main:'assets/video/diaochan-mamu.mp4',    sfx:['assets/video/diaochan-mamu01.mp4','assets/video/diaochan-mamu02.mp4','assets/video/diaochan-mamu03.mp4'] },
    weiju:   { main:'assets/video/diaochan-weiju.mp4',   sfx:['assets/video/diaochan-weiju01.mp4'] },
    wumei:   { main:'assets/video/diaochan-wumei.mp4',   sfx:[] },
    xiuse:   { main:'assets/video/diaochan-xiuse.mp4',   sfx:['assets/video/diaochan-xiuse01.mp4','assets/video/diaochan-xiuse02.mp4','assets/video/diaochan-xiuse03.mp4','assets/video/diaochan-xiuse04.mp4','assets/video/diaochan-xiuse05.mp4','assets/video/diaochan-xiuse06.mp4','assets/video/diaochan-xiuse07.mp4','assets/video/diaochan-xiuse08.mp4','assets/video/diaochan-xiuse09.mp4'] },
  },
  xiaoqiao: {
    kaixin:  { main:'assets/video/xiaoqiao-kaixin.mp4',  sfx:['assets/video/xiaoqiao-kaixin01.mp4','assets/video/xiaoqiao-kaixin02.mp4'] },
    beitong: { main:'assets/video/xiaoqiao-beitong.mp4', sfx:[] },
    mamu:    { main:'assets/video/xiaoqiao-mamu.mp4',    sfx:['assets/video/xiaoqiao-mamu01.mp4'] },
    weiju:   { main:'assets/video/xiaoqiao-weiju.mp4',   sfx:['assets/video/xiaoqiao-weiju01.mp4','assets/video/xiaoqiao-weiju02.mp4'] },
    wumei:   { main:'assets/video/xiaoqiao-wumei.mp4',   sfx:[] },
    xiuse:   { main:'assets/video/xiaoqiao-xiuse.mp4',   sfx:['assets/video/xiaoqiao-xiuse01.mp4','assets/video/xiaoqiao-xiuse02.mp4'] },
  },
  zhenji: {
    kaixin:  { main:'assets/video/zhenji-kaixin.mp4',    sfx:['assets/video/zhenji-kaixin01.mp4','assets/video/zhenji-kaixin02.mp4','assets/video/zhenji-kaixin03.mp4'] },
    beitong: { main:'assets/video/zhenji-beitong.mp4',   sfx:['assets/video/zhenji-beitong01.mp4','assets/video/zhenji-beitong02.mp4','assets/video/zhenji-beitong03.mp4'] },
    mamu:    { main:'assets/video/zhenji-mamu.mp4',      sfx:['assets/video/zhenji-mamu01.mp4','assets/video/zhenji-mamu02.mp4','assets/video/zhenji-mamu03.mp4'] },
    weiju:   { main:'assets/video/zhenji-weiju.mp4',     sfx:['assets/video/zhenji-weiju01.mp4','assets/video/zhenji-weiju02.mp4','assets/video/zhenji-weiju03.mp4'] },
    wumei:   { main:'assets/video/zhenji-wumei.mp4',     sfx:['assets/video/zhenji-wumei01.mp4','assets/video/zhenji-wumei02.mp4','assets/video/zhenji-wumei03.mp4'] },
    xiuse:   { main:'assets/video/zhenji-xiuse.mp4',     sfx:['assets/video/zhenji-xiuse01.mp4','assets/video/zhenji-xiuse02.mp4','assets/video/zhenji-xiuse03.mp4','assets/video/zhenji-xiuse04.mp4','assets/video/zhenji-xiuse05.mp4','assets/video/zhenji-xiuse06.mp4'] },
  },
};
function girlMainPath(gen, emotion){
  const e = GIRL_VIDEOS[gen] && GIRL_VIDEOS[gen][emotion];
  return (e && e.main) || null;
}
// 从多个情绪的后缀池里随机取一个(池空返回 null,调用方据此回退)
function girlSfxPath(gen, emotions){
  const pools = Array.isArray(emotions) ? emotions : [emotions];
  let arr=[];
  pools.forEach(function(em){
    const e = GIRL_VIDEOS[gen] && GIRL_VIDEOS[gen][em];
    if(e && Array.isArray(e.sfx)) arr = arr.concat(e.sfx);
  });
  if(!arr.length) return null;
  return arr[Math.floor(Math.random()*arr.length)];
}
// 哨兵模式与 maybePlayLightningFx 同款；新增队列游标 lastPlayedMovieFxLen。
let lastMovieFxSeq = undefined;
let lastPlayedMovieFxLen = undefined;
function movieVideoKeyForMe(g, evt){
  const me=g.players && g.players[mySeat];
  const girlOf = (id)=> (typeof GIRL_EMO_GENERALS!=='undefined' && GIRL_EMO_GENERALS.indexOf(id)>=0);
  switch(evt.kind){
    case 'yujiDeath':  return (mySeat!==evt.seat) ? 'yujiDeath' : null;
    case 'yujiKill':   return (mySeat!==evt.seat && !!me && !!me.alive) ? 'yujiKill' : null;
    case 'zuociDeath': return (mySeat===evt.seat) ? 'zuociDeath' : null;
    case 'yujiZuociDeath': {
      // 于吉杀左慈时合为单条，随机播 yujiKill / zuociDeath 之一（原优先级后写覆盖改为随机）
      const r=evt.result || {};
      if(typeof r.killerSeat!=='number' || typeof r.victimSeat!=='number') return null;
      return Math.random()<0.5 ? 'yujiKill' : 'zuociDeath';
    }
    case 'girlKill': {
      const r=evt.result||{}; if(!girlOf(r.gen)) return null; const seat=evt.seat;
      if(mySeat===evt.seat) return {path:girlMainPath(r.gen,'xiuse'), seat};
      if(typeof r.victimSeat==='number'&&mySeat===r.victimSeat) return {path:girlMainPath(r.gen,'wumei'), seat};
      const sp=girlSfxPath(r.gen,['xiuse','wumei']); return sp?{path:sp,seat}:null;
    }
    case 'girlDeath': {
      const r=evt.result||{}; if(!girlOf(r.gen)) return null; const seat=evt.seat;
      if(mySeat===evt.seat) return {path:girlMainPath(r.gen,'mamu'), seat};
      if(typeof r.killerSeat==='number'&&mySeat===r.killerSeat) return {path:girlMainPath(r.gen,'weiju'), seat};
      const sp=girlSfxPath(r.gen,['mamu','weiju']); return sp?{path:sp,seat}:null;
    }
    case 'girlKillDeath': {
      const r=evt.result||{};
      if(!girlOf(r.killerGen)||!girlOf(r.victimGen)) return null;
      function pick2(aPath,bPath,aSeat,bSeat){
        const arr=[]; if(aPath)arr.push({path:aPath,seat:aSeat}); if(bPath)arr.push({path:bPath,seat:bSeat});
        return arr.length?arr[Math.floor(Math.random()*arr.length)]:null;
      }
      if(typeof r.killerSeat==='number'&&mySeat===r.killerSeat)
        return pick2(girlMainPath(r.killerGen,'xiuse'), girlMainPath(r.victimGen,'weiju'), r.killerSeat, r.victimSeat);
      if(typeof r.victimSeat==='number'&&mySeat===r.victimSeat)
        return pick2(girlMainPath(r.killerGen,'wumei'), girlMainPath(r.victimGen,'mamu'), r.killerSeat, r.victimSeat);
      return pick2(girlSfxPath(r.killerGen,['xiuse','wumei']), girlSfxPath(r.victimGen,['mamu','weiju']), r.killerSeat, r.victimSeat);
    }
    case 'gameOver': {
      const r=evt.result || {};
      // 本人是三人之一 → 胜开心/败悲痛(无后缀),表情最优先(覆盖左慈/阵营)
      if(me && girlOf(me.general)){
        // 组队/乱斗分派：按 team / winnerSeat 判定胜负
        if(g.gameMode==='team' && typeof r.teamWin==='number'){
          const p=me.team===r.teamWin ? girlMainPath(me.general,'kaixin') : girlMainPath(me.general,'beitong');
          return {path:p, seat:mySeat};
        }
        if(g.gameMode==='ffa' && typeof r.winnerSeat==='number'){
          const p=mySeat===r.winnerSeat ? girlMainPath(me.general,'kaixin') : girlMainPath(me.general,'beitong');
          return {path:p, seat:mySeat};
        }
        if(me.role==='fan'){ if(r.fan==='win') return {path:girlMainPath(me.general,'kaixin'), seat:mySeat}; if(r.fan==='lose') return {path:girlMainPath(me.general,'beitong'), seat:mySeat}; return null; }
        if(me.role==='zhu'){ if(r.lord==='win') return {path:girlMainPath(me.general,'kaixin'), seat:mySeat}; if(r.lord==='lose') return {path:girlMainPath(me.general,'beitong'), seat:mySeat}; return null; }
        if(me.role==='zhong'){ if(r.zhong==='win') return {path:girlMainPath(me.general,'kaixin'), seat:mySeat}; if(r.zhong==='lose') return {path:girlMainPath(me.general,'beitong'), seat:mySeat}; return null; }
        if(me.role==='nei'){ if(r.nei==='win') return {path:girlMainPath(me.general,'kaixin'), seat:mySeat}; if(r.nei==='lose') return {path:girlMainPath(me.general,'beitong'), seat:mySeat}; return null; }
      }
      // 旁观者:有女孩胜负 → 后缀表情(替换阵营动画);后缀池空 → 回退阵营动画
      const sfx = r.girlWin ? girlSfxPath(r.girlWin.gen,'kaixin') : (r.girlLose ? girlSfxPath(r.girlLose.gen,'beitong') : null);
      if(sfx){ const girlSeat=r.girlWin?r.girlWin.seat:(r.girlLose?r.girlLose.seat:null); return {path:sfx, seat:(typeof girlSeat==='number'?girlSeat:null)}; }
      // 左慈次优先:我是左慈且左慈所在阵营输了 → zuoci1（组队/乱斗也生效）
      if(me && me.general==='zuoci' && r.zuociLose) return 'zuociLose';
      // 其次阵营统一动画（仅身份局）；组队空池回退复用 fanWin 或静默，乱斗回退静默
      if(g.gameMode==='team' && typeof r.teamWin==='number'){
        // 组队回退：有 teamWin 时尝试复用 fanWin，若无需求则静默
        // 保持静默以免误播身份局素材，旁观无女孩时返回 null
        return null;
      }
      if(g.gameMode==='ffa'){
        return null;
      }
      if(me && me.role==='fan') return r.fan==='win' ? 'fanWin' : (r.fan==='lose' ? 'fanLose' : null);
      if(me && me.role==='zhu') return r.lord==='lose' ? 'lordLose' : null;
      if(me && me.role==='zhong') return r.zhong==='lose' ? 'zhongLose' : null;
      if(me && me.role==='nei') return r.nei==='win' ? 'neiWin' : null;
      return null;
    }
  }
  return null;
}
function maybePlayMovieFx(g){
  const queue = Array.isArray(g.movieFxQueue) ? g.movieFxQueue : [];
  const single = g.lastMovieFx;
  function dispatchMovie(out){
    if(!out) return;
    if(typeof out==='string'){ if(typeof triggerMovieFx==='function') triggerMovieFx(out); return; }
    // 三姐妹 {path, seat}
    if(out.path && Number.isInteger(out.seat) && typeof triggerGirlFx==='function'){
      triggerGirlFx({path:out.path, seat:out.seat, selfSeat:mySeat});
    } else if(out.path && typeof triggerMovieFx==='function'){
      triggerMovieFx(out.path); // 无有效座位/无头像层 → 回退全屏
    }
  }
  // 首次进房：以队列长度为游标跳过历史（不整批吞掉首条后的增量），同时同步单槽 seq。
  if(lastPlayedMovieFxLen===undefined){
    lastPlayedMovieFxLen = queue.length;
    if(single && Number.isInteger(single.seq)) lastMovieFxSeq = single.seq;
    else if(lastMovieFxSeq===undefined) lastMovieFxSeq = 0;
    // 若队列为空但单槽有历史，视为已跳过；后续增量由队列或单槽兼容分支处理。
    // 首条不再整批吞掉：此 return 仅跳过历史，后续 while 会从 queue.length 开始播新增条目。
    return;
  }
  // 按队列长度游标排队播放：依次取 queue[idx] 经 movieVideoKeyForMe 取 key 调 triggerMovieFx
  while(lastPlayedMovieFxLen < queue.length){
    const evt = queue[lastPlayedMovieFxLen];
    if(evt && Number.isInteger(evt.seq)){
      dispatchMovie(movieVideoKeyForMe(g, evt));
    }
    lastPlayedMovieFxLen++;
    // 同步单槽 seq 为队尾，避免兼容分支重复播
    if(evt && Number.isInteger(evt.seq)) lastMovieFxSeq = evt.seq;
  }
  // 兼容：期间 g.lastMovieFx 单槽仍被外部写入（旧逻辑）则按 seq 去重播放
  if(single && Number.isInteger(single.seq)){
    if(lastMovieFxSeq===undefined){ lastMovieFxSeq=single.seq; return; }
    if(single.seq===lastMovieFxSeq) return;
    const tailSeq = queue.length ? queue[queue.length-1].seq : null;
    if(tailSeq !== single.seq){
      dispatchMovie(movieVideoKeyForMe(g, single));
    }
    lastMovieFxSeq=single.seq;
    // 若单槽 seq 超前于队列长度，同步游标防止下次 while 重播
    if(queue.length && single.seq > tailSeq) lastPlayedMovieFxLen = queue.length;
  } else {
    if(lastMovieFxSeq===undefined) lastMovieFxSeq=0;
  }
}

// CORE-174:动画/音效去重哨兵是模块级变量,newGame/backToLobby 原先都不清。
// 上一局的 seq 会带到下一局,导致新局首张牌/伤害/过场被当成"已播过的历史"吞掉,
// 或残留 .damage-hit 座位高亮。重置成各哨兵的声明初值(turn/pending 用 null,
// 音效/特效用 undefined——undefined 走「首次进房吞历史」,和 maybePlay* 去重逻辑对齐)。
function resetRenderSentinels(){
  lastAnnouncedTurnKey = null;
  lastAnnouncedPendingKey = null;
  lastPlayedCardSeq = undefined;
  lastPlayedSkillSeq = undefined;
  lastPlayedDamageSeq = undefined;
  lastLightningFxSeq = undefined;
  lastMovieFxSeq = undefined;
  lastPlayedMovieFxLen = undefined;
  if(typeof document === 'undefined' || !document.querySelectorAll) return;
  document.querySelectorAll('.seat.damage-hit').forEach(function(seat){
    if(seat._damageTimer) clearTimeout(seat._damageTimer);
    seat._damageTimer = null;
    seat.classList.remove('damage-hit');
  });
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
  selectedCardIdx=null; forcedShaCardId=null; resetZhangba(); resetDuanliang(); resetQixi(); resetGuose(); resetLianhuan(); resetTiesuo(); resetQingnang(); resetRende(); resetJijiang(); resetZhiheng(); resetQiaobian(); resetJiedao(); resetGuhuoJiedao(); resetFangtian(); resetGanglie(); resetQuhu(); resetLijian(); resetFanjian(); resetLirang(); resetTiaoxin(); resetDimeng(); resetSanyao(); resetZhiba();
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
  m.querySelector('#confirmAsOwn').onclick=()=>{
    hide(); resetSelectionState(); render(currentG);
    const selfTarget=!!(typeof DELAY_TRICKS==='object' && DELAY_TRICKS[card.name] && DELAY_TRICKS[card.name].onlySelf);
    playCard(idx, card.name, selfTarget?mySeat:undefined);
  };
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
// CORE-79(issue #126):原8色数组两次翻车——`#B8A22F`(暗金黄)和`#C4C44F`(黄绿)hue只差
// 10°,深色座位卡背景上几乎同色(用户实测截图证实,两名玩家"撒撒"/"机器人5"的名字都
// 显示成看不出区别的黄色)。原注释声称"每两色间隔约24°"是未经验证的估计,程序化算出的
// 真实hue分布是[209,148,321,50,268,20,180,60]——差距从10°到170°不等,并非均匀分布。
// 重新设计:8色按hue取[24,78,125,171,214,257,300,342],程序化验证两两hue差全部≥42°
// (留出高于验收标准"≥40°"的浮点误差余量,见 run_core79_name_colors_test.js),
// S=62% L=54%(平均相对亮度0.319,不低于旧色板的0.306,不是"为了拉开色相牺牲可读性")。
// 同时按用户反馈的历史结论(docs/progress-log-4.md:座位色与势力色(魏蓝#3a5f8a撞蓝、
// 群金#7d5f2a撞黄)的位置分离+形态不同已被用户拍板接受,不动)只针对"新增撞色"做best-effort
// 规避——8色里hue最接近214°的一个离魏蓝212°仅1.8°,和旧方案的209°本来就贴着魏蓝一样,
// 是延续而非新增;晋紫270°当前没有任何在场武将用到,不构成真实撞色。3个实际在场且常见
// 的蜀红(9.8°)/群金(38.3°)/吴绿(110.6°)势力色,新色板与它们的最小间距分别是
// 14.2°/14.3°/14.4°——8色只用42°间隔均匀铺满色相环、同时贴近3个挤在同一象限内的势力色
// 几乎是几何上的极限(程序化搜索验证过,继续加大这个间距会破坏≥40°的两两hue差这条硬性
// 验收标准),没有比这更好的解;但至少不再是原方案里10°~12°级别的近似撞色(原方案离
// 蜀红/群金分别只差10.5°/12.1°),没有引入比原方案更严重的新撞色。数值来源见 run_core79_
// name_colors_test.js 完整计算依据,不是凭空断言"变好了"。
// 按座位号(非名字)分配,同局内 SEATS(≤3)人或以后更多人,只要座位号不同、颜色必然不同——
// 不会因为名字巧合 hash 到相近色。seatColor(seat) 接口本身不变,全部调用点零改动。
const NAME_COLORS = ['#D27B41','#A7D241','#41D24D','#41D2BD','#4180D2','#6A41D2','#D241D2','#D2416D'];
function seatColor(seat){ return NAME_COLORS[((seat%NAME_COLORS.length)+NAME_COLORS.length)%NAME_COLORS.length]; }

// setBanner: banner 是唯一常驻可见的焦点行(原来 render() 里独立维护一份 banner + renderControls
// 里独立维护一份 hint,两处各写各的、经常重复或遗漏——现在只有 renderControls 这一处书写者,
// 每个分支把"谁对谁/发生了什么"和"你该做什么(含没有可用牌等兜底提示)"合并成一句话。
// style 可选,仅 game-over 播报胜利时需要金色特殊样式。
// 【CORE-110(issue #110)XSS安全约束】html 参数原样写进 innerHTML,setBanner 自身不做
// 任何转义(不能做——banner 本身需要拼 <span> 倒计时这类合法HTML标签)。这意味着**调用方
// 必须自行保证**:任何拼进 html 参数的用户输入(玩家名/聊天文本等,不包括武将名/牌名/
// 技能名这类固定数据)在拼接前都经过 escapeHtml()——这是审计后确立的强制约束,全部
// 155处调用点已核对过(见 render-controls.js 逐处的 escapeHtml 包裹),新增调用点必须
// 遵守同一纪律。
function setBanner(html, style){
  // A1 响应超时托管:询问型 pending 时在 banner 末尾拼"⏱ Ns 后自动…"倒计时
  // (renderResponseCountdown 定义在 bot-ai-bus.js,加载早于本文件;currentG 是本文件
  // render() 每次更新的快照)。html 为空(重置清空)时不拼,避免空 banner 只挂一个倒计时。
  const cd = html ? renderResponseCountdown(currentG) : null;
  const content = cd ? html + ' <span class="resp-countdown">' + cd + '</span>' : html;
  document.getElementById('banner').innerHTML = content ? '<div class="banner"'+(style?' style="'+style+'"':'')+'>'+content+'</div>' : '';
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
// ============ CORE-115:身份猜测标记(玩家自己对某座位身份的个人猜测) ============
// 【为什么不写进 g】这是"我自己的判断",不同玩家对同一个人的猜测允许不一样,不是需要
// 跨客户端同步的公开游戏状态——存 localStorage,和 sgsClientId(game.js:17)同一套本地
// 持久化写法,不经过 tx/Firebase。
// 【key 设计,CORE-84(issue #131)修正】格式 identityMark:<roomId>:<seed>:<seat>——
// 原设计只有 <roomId>:<seat>,依赖"重开时执行 newGame()→clearAllIdentityMarks() 清空
// 本机 localStorage"来让新局不显示旧标记,但"再来一局"按钮仅房主可见可点
// (render-controls.js isRoomOwner 守卫),房主点击只能清自己浏览器的 localStorage,
// 清不到其他玩家设备上的——localStorage 本身就是设备本地的,跨设备清除在架构上不成立。
// 加入 <seed>(g.seed,CORE-77/issue #122 在 finishGeneralAssign 时生成的每局唯一值)
// 后,新一局的 seed 必然不同于上一局,任何客户端(不管是不是房主)读旧 key 天然读不到
// 值——**不需要跨设备清除**,从根源上规避了"本地存储无法被他人清除"这个矛盾,是 issue
// 正文里的推荐方案A。clearAllIdentityMarks()(仍按 roomId 前缀扫描,不含 seed)继续保留
// 在 newGame() 里调用,现在降级为"房主本机的历史陈旧 key 清理"这个次要用途(纯粹是
// localStorage 卫生,不再是正确性的必要条件)——即使它完全不执行,新局的 seed 隔离
// 本身已经足够保证不显示旧标记。
const IDENTITY_MARK_OPTIONS = ['zhong','fan','nei']; // 忠/反/内——'zhu'(主公)身份从不隐藏,不需要猜
const IDENTITY_MARK_LABEL = { zhong:'忠', fan:'反', nei:'内' };
const IDENTITY_MARK_FULL_LABEL = { zhong:'忠臣', fan:'反贼', nei:'内奸' };
// g 参数取 g.seed 做局标识;seed 未定义时(理论上不该发生——标记UI仅在g.started时渲染,
// 而g.started与g.seed在同一次finishGeneralAssign里一起写入)回退空串,不让key直接变成
// 字面量'undefined'字符串。
function identityMarkKey(g, seat){
  const seed = (g && typeof g.seed==='number') ? g.seed : '';
  return 'identityMark:'+(typeof roomId!=='undefined'&&roomId?roomId:'')+':'+seed+':'+seat;
}
function getIdentityMark(g, seat){
  try{
    const v = localStorage.getItem(identityMarkKey(g, seat));
    return IDENTITY_MARK_OPTIONS.indexOf(v)>=0 ? v : null; // 防脏数据(如手改localStorage)
  }catch(e){ return null; } // 隐私模式/localStorage被禁用时静默返回"无标记",不影响主流程
}
function setIdentityMark(g, seat, mark){
  try{
    if(IDENTITY_MARK_OPTIONS.indexOf(mark)>=0) localStorage.setItem(identityMarkKey(g, seat), mark);
    else localStorage.removeItem(identityMarkKey(g, seat)); // mark 为 null/非法值一律视为"清除"
  }catch(e){ /* 同上,静默放弃 */ }
}
// clearAllIdentityMarks:newGame()收尾调用,清空**当前房间**全部座位、全部历史局的标记
// ——不依赖 seed(按 roomId 前缀扫描,覆盖该房间下所有旧局留下的 key),继续保留是为了
// 房主本机的 localStorage 卫生(不清理也不影响正确性,新局 seed 隔离已经足够,见上方
// 大段说明),不依赖固定座位数上限(SEATS 变化也天然覆盖)。
function clearAllIdentityMarks(){
  try{
    const prefix = 'identityMark:'+(typeof roomId!=='undefined'&&roomId?roomId:'')+':';
    const toRemove = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.indexOf(prefix)===0) toRemove.push(k);
    }
    toRemove.forEach(k=>localStorage.removeItem(k));
  }catch(e){ /* 同上 */ }
}
// openIdentityMarkMenu:座位卡标记入口(seat-identity-mark)的点击处理——复用
// #confirmModal 容器但不走 showConfirm 固定的2按钮语义,自己渲染"忠/反/内/清除/取消"
// 5个按钮,和 confirmOwnOrSha(render.js)同一套"自渲染多按钮"写法,不新造弹窗组件。
// 入口本身已在 renderSeatCard 里 onclick="event.stopPropagation();openIdentityMarkMenu(...)",
// 和座位卡整卡 onclick(出牌选目标)完全独立,互不干扰(与"?"武将说明/装备/判定区角标同一套
// stopPropagation写法)。
function openIdentityMarkMenu(seat){
  const m=document.getElementById('confirmModal');
  const current = getIdentityMark(currentG, seat);
  const p = currentG && currentG.players && currentG.players[seat];
  const name = p ? p.name : ('座位'+(seat+1));
  const optBtn = (mark, label) => '<button class="ghost'+(current===mark?' identity-mark-current':'')+'" data-mark="'+mark+'">'+label+'</button>';
  m.innerHTML='<div class="confirm-panel"><div class="confirm-msg">我对 '+escapeHtml(name)+' 身份的猜测(仅自己可见,不影响游戏结算)：</div>'
    +'<div class="confirm-btns identity-mark-btns">'
      +optBtn('zhong','忠')+optBtn('fan','反')+optBtn('nei','内')
      +'<button class="ghost" data-mark="">清除标记</button>'
      +'<button class="ghost" id="confirmCancelMark">取消</button>'
    +'</div></div>';
  m.classList.remove('hidden');
  const hide=()=>{ m.classList.add('hidden'); m.innerHTML=''; };
  m.querySelectorAll('.identity-mark-btns button[data-mark]').forEach(b=>{
    b.onclick=()=>{ setIdentityMark(currentG, seat, b.dataset.mark || null); hide(); render(currentG); };
  });
  m.querySelector('#confirmCancelMark').onclick=hide;
  m.onclick=(e)=>{ if(e.target===m) hide(); };
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
    ? '<img class="avatar" src="'+generalAvatarSrc(avatarGen.id)+'" decoding="async" onerror="avatarError(this)" alt="">'
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
    // CORE-146:额外带一个 data-hp="当前/上限" 的紧凑写法。手机横屏的小卡(≈91~97px 宽、
    // 121~129px 高)上竖排心放不下——最大 maxHp=6,竖排要 66px 高,会一路撞到左下角的手牌数
    // 图标;横排 6 颗心又约 48px 宽,会撞 x=32 起的装备槽标签。所以那个断点下改用这个数字
    // 写法(CSS ::before 读这个属性、隐藏下面的心 div),信息等价而只占 1 行。桌面/平板不受
    // 影响,仍然渲染心——这个属性在那些断点上没有任何规则读它。
    heartsHtml = '<div class="seat-hp-col" data-hp="'+shownHp+'/'+p.maxHp+'">'
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
    // CORE-146:装备名额外带一份"2字简称"(data-s)。手机横屏下座位卡只有 70~90px 宽,
    // 完整装备名("青龙偃月刀"/"雌雄双股剑")靠 text-overflow:ellipsis 会被截成"武 ♠5…"
    // 这种零信息量的状态。简称由 CSS 在窄断点里用 ::before content:attr(data-s) 取用——
    // **断点判断留在 CSS 里**(和 .wide-name 那条不同:那条是 render.js 读 isDesktopLayout(),
    // 这里刻意不再新增一处 JS 侧断点判断,避免 JS/CSS 两套口径又多一处要同步的地方)。
    // 取前 2 字而不是维护一张简称表:实测覆盖全部现有装备都能辨认(青龙偃月刀→青龙、
    // 诸葛连弩→诸葛、八卦阵→八卦、仁王盾→仁王、白银狮子→白银、爪黄飞电→爪黄),
    // 且以后新增装备零维护成本。≤2 字的名字(的卢/赤兔/绝影/大宛/紫骍)原样。
    const shortName = escapeHtml(String(c.name).slice(0, 2));
    return '<div class="erow filled'+wideNameCls+'" title="'+escapeHtml(eDesc)+'" onclick="event.stopPropagation();showEquipInfo(\''+c.name+'\')"><b>'+prefix+'</b> '+seatEquipFace(c)+'<span class="enm" data-s="'+shortName+'">'+escapeHtml(c.name)+'</span></div>';
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
  // 「化身：」这三个字在手机横屏的小卡上放不下 —— 实测 91px 宽的卡里,
  // 「化身：于吉·蛊惑 ?」需要约 90px,直接被 text-overflow 吃掉尾巴(技能名看不见,
  // 而技能名恰恰是这行最该看的信息)。处理方式沿用装备名简称那一套(CORE-146):
  // 把可省略的前缀单独包一层,由 CSS 在窄断点下隐藏——**前缀是"这是什么"的标签,
  // 而青色底衬本来就已经在表达这件事了,是四段内容里信息量最低的一段**,
  // 优先牺牲它,保住「武将名·技能名」这个真正的载荷。
  // 不用 JS 按宽度算截断:那需要读 DOM 尺寸、且要在每次 resize 后重算,
  // 而纯 CSS 的显隐是断点驱动的,零运行时成本、也不会和 render 时机耦合。
  const huashenLine = (avatarReady && isZuociWithHuashen)
    ? '<div class="seat-huashen-line" title="'+escapeHtml((avatarGen&&avatarGen.desc)||'')+'" onclick="event.stopPropagation();showGeneralInfo(\''+p.huashenGeneral+'\')">'
      + '<span class="hs-label">化身：</span>'
      // 载荷单独包一层并带上简称:最窄的一档(852x303 的 Safari 里 8 人局,"我"的卡只有
      // 70px 宽)光靠省前缀和「?」还是不够——「司马懿·鬼才」6 个字要 54px,可用只有 46px。
      // 简称规则和装备名那套一致(CORE-146):**武将名和技能名各取前 2 字**,固定 5 字符宽,
      // 不随武将名长短漂移(最长武将名「颜良文丑」4 字、化身对象里最长的「司马懿」3 字,
      // 都会被压到 2 字)。不做简称唯一性检查:这里是纯展示、不是选择控件,
      // 完整信息在 title 属性里,整行 onclick 也能点开武将详情。
      + '<span class="hs-body" data-s="'
        + escapeHtml(String(avatarGen?avatarGen.name:p.huashenGeneral).slice(0,2))
        + '·' + escapeHtml(String(p.huashenSkillName||'').slice(0,2)) + '">'
        + escapeHtml(avatarGen?avatarGen.name:p.huashenGeneral)+'·'+escapeHtml(p.huashenSkillName||'')
      + '</span> <span class="huashen-info-mark">?</span></div>'
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
        // CORE-127(issue #166):同时输出"完整"和"缩略"两种写法,由 CSS 的 @container 分档
        // 决定显示哪一个(见 index.html 的 .dchip-full/.dchip-abbr)。小卡片上只显示牌名首字
        // (乐/兵/闪——三种延时锦囊首字互不相同,DELAY_TRICKS 全表就这三种),chip 宽度从
        // 52~56px 降到十几px,三张能排进一行而不是各占一行。完整信息不丢失:title 属性和
        // 点击 showDelayInfo 弹窗都保持原样,手指点一下就能看到完整牌名+效果说明。
        const dFull = (cardFace(c)||'')+escapeHtml(c.name);
        const dAbbr = escapeHtml(String(c.name||'').slice(0,1));
        return '<span class="dchip" title="'+escapeHtml(dDesc||'')+'" onclick="event.stopPropagation();showDelayInfo(\''+c.name+'\')">'
          + '<span class="dchip-full">'+dFull+'</span><span class="dchip-abbr">'+dAbbr+'</span></span>';
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
  // 托管标识读取房间共享状态，因此所有玩家都会在被托管座位卡上看到它。
  // 共享的只有这个布尔值；API密钥和托管记录仍然只存在托管者本机。
  const autopilotBadge = p.aiAutopilot
    ? '<div class="seat-autopilot-badge" title="AI托管中" aria-label="AI托管中">'
      + '<span class="seat-autopilot-robot">🤖</span>'
      + '<span class="seat-autopilot-lazy">在偷懒</span></div>'
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
  // 组队模式:队伍公开信息,座位卡显示队伍色块+队伍号(仿 .seat-identity 定位)。
  // p.team 是 team 模式专属字段,非 team 模式恒为 null(见 normalize),天然不渲染;
  // Number.isInteger 兜底脏数据。z-index:6 保证盖在 .seat-bottom/.seat-order-badge 之上。
  const teamBlock = (g.gameMode==='team' && Number.isInteger(p.team))
    ? '<div class="seat-team" style="background:'+(TEAM_COLORS[p.team]||'#999')+'">'+(p.team+1)+'</div>'
    : '';
  // CORE-115:身份猜测标记入口——仅 identity 模式、且已正式开局(g.started)才显示,
  // 乱斗/组队模式没有"忠反内"概念、大厅阶段还没有真正在玩,两者都不渲染这个入口。
  // 卡片中心此前完全空闲(只有.flipped的"翻面"文字和罕见的托管横幅会短暂占用该区域),
  // 放在这里不与标题栏/左侧武将信息列/右上角身份·托管角标/底部装备判定区冲突。
  const identityMarkEntry = (g.gameMode==='identity' && g.started)
    ? (function(){
        const mark = getIdentityMark(g, seat);
        const label = mark ? IDENTITY_MARK_LABEL[mark] : '🔖';
        const cls = mark ? ' has-mark' : '';
        const title = mark
          ? ('我的猜测：'+IDENTITY_MARK_FULL_LABEL[mark]+'（点击修改/清除，仅自己可见）')
          : '点击标记我对这个人身份的猜测（仅自己可见，不影响游戏结算）';
        return '<div class="seat-identity-mark'+cls+'" title="'+escapeHtml(title)+'" onclick="event.stopPropagation();openIdentityMarkMenu('+seat+')">'+label+'</div>';
      })()
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
    + teamBlock
    + infoBadge
    + autopilotBadge
    + identityMarkEntry
    + '<div class="seat-bottom">'+huashenLine+buquRow+delayRow+equipRow+'</div>'
    // orderBadge 排在 .seat-bottom 之后(DOM序=层叠序,后面的盖在前面上面)——两者本来
    // 就靠 .seat-bottom 的 right 收窄互不重叠(见上面注释),这里放在最后只是双重保险:
    // 万一某个极端场景下 .seat-bottom 的内容真的溢出了预留边界,角标仍然可见、不会被
    // 悄悄盖住。
    + orderBadge;
}


// singleTargetCanTarget: 普通单目标牌选目标渲染复用业务层 canTarget 的追加约束。
// 服务端 playCard 对 target 牌的唯一合法性判断就是 spec.canTarget(见 game.js),
// 渲染层以前在 buildSeatDOM 里手写了简化版(存活/距离/空城/判定区同名…),漏掉了
// 谦逊这类技能限制,导致【顺手牵羊】【乐不思蜀】选目标时谦逊角色仍可点、点了却被
// 服务端拒绝。这里统一走真正的 canTarget(g, 使用者, 牌, 目标座位)——传参语义和
// 蛊惑(guhuoSpec.canTarget)/双雄/武圣(CARD_PLAYS['杀'].canTarget)等既有调用点
// 完全一致。只作为"追加约束"叠加在既有 targetable 条件之上:返回 false 只会让目标
// 更不可选,绝不在这里放宽任何既有判断。selSpec 无 canTarget(实际上所有 target:true
// 的牌都挂了 canTarget)时恒放行,不改变旧行为。
function singleTargetCanTarget(g, selSpec, sourcePlayer, selCard, targetSeat){
  return !(selSpec && selSpec.canTarget) || !!selSpec.canTarget(g, sourcePlayer, selCard, targetSeat);
}

// 死亡特效触发基线：记录上一帧各座位 alive 状态。纯前端视觉,不读游戏逻辑。
var lastAliveSnapshot = null;
// 检测角色死亡(alive true→false),触发纯前端死亡视觉效果。
// 仅 g.started 时对比;大厅/未开局(机器人增删)重置基线,不误触发。
function checkDeaths(g){
  if(!g || !g.started || !Array.isArray(g.players)){
    lastAliveSnapshot = null;
    return;
  }
  const alive = g.players.map(p => p ? !!p.alive : false);
  const prev = lastAliveSnapshot;
  lastAliveSnapshot = alive;
  if(!prev || prev.length !== alive.length) return; // 首次/人数变化不触发
  for(let i=0;i<alive.length;i++){
    if(prev[i] === true && alive[i] === false){
      // render 尚未清空旧座位 DOM，此时可以从存活态卡片取得完整武将立绘并制作碎裂覆层。
      // 失败只跳过动画，绝不能阻断死亡状态的正常渲染。
      if(typeof triggerDeathPortraitFx==='function'){
        try{ triggerDeathPortraitFx(i); }catch(err){ console.warn('死亡碎裂动画失败:', err); }
      }
      if(typeof triggerDeathFx==='function'){
        triggerDeathFx(i === mySeat ? 'self' : 'other');
      }
    }
  }
}

// ---------- render ----------
function render(g){
  currentG = g; // 供确认弹窗的取消回调异步刷新界面用(回调触发时早已不在 render 的调用栈里)
  // A1 响应超时托管:同步 1s 检测器的启停(任意客户端;提交幂等,谁先到谁生效)。
  // CORE-145 起它是"按需启停"的生命周期入口而不只是"启动":有询问型 pending 才运行,
  // 没有就停掉。内部持有 timer id 保证幂等,反复 render 不会起多个实例。
  // **必须在 currentG = g 之后调用**——它读 currentG 判断当前该不该运行。
  if(typeof startAutoRespondTimer==='function') startAutoRespondTimer();
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
  // checkDeaths 必须放在 mySeat 重定位之后：极端场景（机器人删除致座位前移 + 同帧死亡）
  // 里 self/other 分类依赖最新 mySeat，否则可能把"自己死亡"误判成"他人死亡"。
  checkDeaths(g);
  const closeRoomBtn=document.getElementById('closeRoomBtn');
  if(closeRoomBtn) closeRoomBtn.classList.toggle('hidden', !isRoomOwner(g,mySeat));
  // AI托管:mySeat 重定位后同步刷新托管座位。支持"大厅先开托管、进房后再自动生效"
  // (aiTestAutopilot 定义在 ai-bot.js,本文件加载更早,typeof 只是跨文件防御惯例)。
  // CORE-102(issue #149):每次render都顺带校验托管上下文(roomId/cid)是否仍然匹配——
  // 这是"强制关闭房间未清理托管状态,可能跨房间继承旧座位"这个bug的兜底防线:即使
  // backToLobby()那条主清理路径因为某种原因没有生效,这里也会在下一次render时发现
  // roomId不匹配并主动停止,不会让旧房间的托管状态悄悄接管新房间里恰好同座位号的角色。
  if(typeof aiTestAutopilot!=='undefined' && aiTestAutopilot && aiTestAutopilot.active){
    if(typeof aiTestAutopilotContextValid==='function' && !aiTestAutopilotContextValid()){
      if(typeof stopAiTestAutopilot==='function') stopAiTestAutopilot();
    } else {
      aiTestAutopilot.seat = mySeat;
      // 大厅阶段开启托管时 roomId/cid 还是 null(还没进房),进房后第一次绑定真实值——
      // 这是合法的懒绑定,不是"漂移"(aiTestAutopilotContextValid 对 null 快照直接放行)。
      if(aiTestAutopilot.roomId===null && typeof roomId!=='undefined' && roomId!==null) aiTestAutopilot.roomId = roomId;
      if(aiTestAutopilot.cid===null && typeof myClientId!=='undefined' && myClientId!==null) aiTestAutopilot.cid = myClientId;
    }
  }
  // 机器人调度必须和渲染解耦(见函数末尾的 finally):scheduleBotTurn 原本是 render 的最后
  // 一行,渲染中途任何一处抛异常都会执行不到它、机器人从此永久停摆——这个症状和"机器人不
  // 行动"的座位判定 bug 长得一模一样,会把排查方向带偏,所以这里用 try/finally 拆开。
  try{
  normalize(g);
  if(typeof syncAiTestGamePhase==='function') syncAiTestGamePhase(g.phase, g.seed);
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
    playTurnDrum();
    showMyTurnBanner();
    lastAnnouncedTurnKey = turnKey;
  } else if(g.turn!==mySeat){
    lastAnnouncedTurnKey = undefined;
  }
  // CORE-70:他人回合、但自己是当前 pending 的响应者(被杀出闪/濒死求桃/技能询问等)时,
  // 同一战鼓提示——之前只覆盖"自己回合"这一种情况,分神/切后台时容易错过这类响应。
  // 触发判断 + 去重 key 计算在 shouldPlayResponsePendingDrum(纯函数,可独立测试),这里
  // 只管按结果播放/更新哨兵。
  const respDrum = shouldPlayResponsePendingDrum(g, mySeat, lastAnnouncedPendingKey);
  if(respDrum.relevant){
    if(respDrum.shouldPlay) playTurnDrum();
    lastAnnouncedPendingKey = respDrum.key;
  } else {
    lastAnnouncedPendingKey = null;
  }
  maybePlayCardSound(g); // 打出手牌语音:和上面playTurnDrum同一批"每次状态更新都检测一次"的位置
  maybePlaySkillSound(g); // 技能发动语音:同一批检测
  maybePlayLightningFx(g); // 闪电判定特效:同一批检测(劈中/未劈中分别播 flash1/flash0)
  maybePlayMovieFx(g); // 过场动画:同一批检测(武将死亡/胜负结算,按 kind+座位/身份过滤)
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
     !(g.phase==='tiaoxinChoice' && g.pending && g.pending.type==='tiaoxinChoice' && g.pending.to===mySeat) &&
     !((g.phase==='jijiangAsk'||g.phase==='hujiaAsk') && g.pending && g.pending.asking===mySeat)) resetSelectedResponseCard();
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
  // 同款兜底:一旦不在「自己的出牌阶段」,就退出制霸选目标模式。
  if(!(g.started && g.phase==='play' && g.turn===mySeat)) resetZhiba();
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
  // 同款兜底:只要不在"轮到自己为蛊惑声明的【借刀杀人】选目标"的状态,就退出这套两步模式。
  if(!(g.phase==='guhuoTarget' && g.pending && g.pending.type==='guhuoTarget' && g.pending.sourceSeat===mySeat
       && g.pending.claimedCard && g.pending.claimedCard.name==='借刀杀人')) resetGuhuoJiedao();
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
    d.className='seat'+(g.turn===i&&g.started?' active':'')+(p.alive?'':' dead')+(i===mySeat?' me':'')+(p.faceup===false?' flipped':'')+(p.aiAutopilot?' autopilot':'');
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
    // 最后叠加业务层 canTarget 追加约束(顺手牵羊的谦逊/火攻的空城/锦囊的智迟·帷幕等):
    // canTarget 只收窄、不放宽上面已有的 targetable 判断,保证"能点"集合与服务端一致。
    const targetable = !!(selSpec && selSpec.target) && selfOK && p.alive && (!needHandOrEquip || hasHandOrEquip) && (!needHandOnly || (p.hand||[]).length>0) && inRange && !hasDupDelay && singleTargetCanTarget(g, selSpec, meP, selCard, i);
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
    // 蛊惑声明为【借刀杀人】:走专属两步选目标(A 有武器/B 在 A 攻击范围内),不进下面
    // 通用单目标块——校验口径与 isJiedaoSel 那套(1473行)完全一致,只是数据源从
    // "手牌里的借刀杀人真牌"换成"蛊惑扣置牌+guhuoChooseJiedaoTarget"。
    const isGuhuoJiedaoSel=!!(g.phase==='guhuoTarget' && g.pending && g.pending.type==='guhuoTarget'
      && g.pending.sourceSeat===mySeat && g.pending.claimedCard && g.pending.claimedCard.name==='借刀杀人');
    if(isGuhuoJiedaoSel){
      if(guhuoJiedaoSeatA===null){
        const hasSomeB = g.players.some((B,bi)=> B && B.alive && bi!==i && canReachSha(g,i,bi) && !(hasCap(B,'kongcheng') && (B.hand||[]).length===0));
        if(i!==mySeat && p.alive && p.equips && p.equips.weapon && hasSomeB){
          d.style.cursor='pointer';
          d.style.outline='2px dashed var(--cinnabar-bright)';
          d.title='选择为【借刀杀人】的目标A(需持有武器)';
          d.onclick=()=>{ guhuoJiedaoSeatA=i; render(g); };
        }
      } else if(i!==guhuoJiedaoSeatA && p.alive && canReachSha(g, guhuoJiedaoSeatA, i) && !(hasCap(p,'kongcheng') && (p.hand||[]).length===0)){
        const seatA=guhuoJiedaoSeatA, seatB=i;
        d.style.cursor='pointer';
        d.style.outline='3px solid var(--gold)';
        d.onclick=()=>{ confirmAndPlay('将【蛊惑】声明的【借刀杀人】对 '+g.players[seatA].name+' 使用,目标 '+g.players[seatB].name+'？',
            ()=>guhuoChooseJiedaoTarget(seatA, seatB)); };
      } else if(i===guhuoJiedaoSeatA){
        d.style.outline='3px solid var(--gold)';
        d.style.cursor='pointer';
        d.title='重新选择目标A';
        d.onclick=()=>{ guhuoJiedaoSeatA=null; render(g); };
      }
    }
    if(g.phase==='guhuoTarget' && g.pending && g.pending.type==='guhuoTarget' && g.pending.sourceSeat===mySeat && !isGuhuoJiedaoSel){
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
      const legalTarget = CARD_PLAYS['杀'].canTarget(g,me,{name:'杀',virtual:true},i);
      const picked = fangtianPicks.includes(i);
      const selectable = legalTarget && (picked || fangtianPicks.length<3);
      if(selectable){
        d.style.cursor='pointer';
        if(picked) d.style.outline='3px solid var(--gold)';
        else d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{
          if(picked) fangtianPicks = fangtianPicks.filter(x=>x!==i);
          else if(fangtianPicks.length<3) fangtianPicks.push(i);
          render(g);
        };
      } else if(!legalTarget){
        d.style.outline='2px dotted #6b5b4d';
        d.title='当前不能成为【杀】的目标（距离或技能限制）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
    }
    // 徐晃【断粮】选目标:已选中一张黑色基本牌/黑色装备牌后,点距离2以内的其他存活玩家提交
    // (官方规则"对距离2以内的角色使用",和杀的攻击距离同一套 distance() 口径,复用同款
    // "够不着"暗色点线+角标的视觉写法)。
    if(duanliangMode && duanliangCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const inRange = distance(g, mySeat, i) <= 2;
      // CORE-166(issue #225):目标合法性必须和服务端 duanLiang 完全一致——它走的是
      // canTargetDelayTrick(g,me,trickCard,seat,2)(帷幕挡黑色锦囊、判定区已有同名兵粮
      // 寸断等全部由它统一校验),UI 原来只手写了一条"距离≤2",于是帷幕角色仍画成可点、
      // 点了被服务端静默拒绝(表现为"点了没反应")。花色取已选那张实体黑牌本身。
      const dlCard=(meP.hand||[])[duanliangCardIdx];
      const dlTrick=dlCard?{...dlCard, name:'兵粮寸断', originalName:dlCard.name}:null;
      const dlOk = !!dlTrick && canTargetDelayTrick(g, meP, dlTrick, i, 2);
      if(dlOk){
        // 同上:idx 挂载时冻结,不在点击时才读 duanliangCardIdx
        const idx=duanliangCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【兵粮寸断】使用,对 '+g.players[i].name+' 发动【断粮】？', ()=>duanLiang(idx, i)); };
      } else if(!inRange){
        d.style.outline='2px dotted #6b5b4d';
        d.title='距离外（距离 '+distance(g,mySeat,i)+' ＞ 2）';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">够不着</span>';
      } else {
        // 帷幕/判定区已有兵粮等业务层拒绝的目标:同款暗色点线+"不可选"角标(与国色一致)
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色不能成为【兵粮寸断】的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
    }
    // 甘宁【奇袭】选目标:已选中一张黑色手牌后,点一名有手牌/装备/判定区牌的其他存活玩家提交。
    if(qixiMode && qixiCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      // CORE-166(issue #225):除"目标身上有牌"外,服务端 qiXi 还会走
      // CARD_PLAYS['过河拆桥'].canTarget(帷幕挡黑色锦囊、智迟免疫),UI 原来只查了前者。
      const qxCard=(meP.hand||[])[qixiCardIdx];
      const qxTrick=qxCard?{...qxCard, name:'过河拆桥', originalName:qxCard.name}:null;
      const qxOk = hasHandOrEquip && !!qxTrick &&
        singleTargetCanTarget(g, CARD_PLAYS['过河拆桥'], meP, qxTrick, i);
      if(qxOk){
        const idx=qixiCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【过河拆桥】使用,对 '+g.players[i].name+' 发动【奇袭】？', ()=>qiXi(idx, i)); };
      } else if(!hasHandOrEquip){
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色没有手牌、装备或判定区的牌';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">无牌</span>';
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色不能成为【过河拆桥】的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
    }
    // 大乔【国色】选目标:已选中一张方块牌后,点一名判定区没有【乐不思蜀】的其他存活玩家提交。
    if(guoseMode && guoseCardIdx!==null && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const hasLe = (p.delays||[]).some(c=>c && c.name==='乐不思蜀');
      // 目标合法性与服务端 guoSe 完全一致:复用 CARD_PLAYS['乐不思蜀'].canTarget
      // (谦逊/帷幕/判定区同名都由它统一校验,见 skills.js guoSe)——不能用 hasLe 一条
      // 手写简化,否则谦逊角色在国色选目标界面仍可点、点了被服务端拒绝。
      const guoseTargetOk = singleTargetCanTarget(g, CARD_PLAYS['乐不思蜀'], meP, {name:'乐不思蜀', virtual:true}, i);
      if(guoseTargetOk){
        const idx=guoseCardIdx;
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.onclick=()=>{ confirmAndPlay('将这张牌当【乐不思蜀】使用,对 '+g.players[i].name+' 发动【国色】？', ()=>guoSe(idx, i)); };
      } else if(hasLe){
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色判定区已有【乐不思蜀】';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">已有乐</span>';
      } else {
        // 谦逊/帷幕等业务层 canTarget 拒绝的目标:暗色点线+悬浮说明,不可点
        // (同款视觉,避免玩家点了却被服务端 canTarget 拒绝)。
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色不能成为【乐不思蜀】的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
    }
    if(lianhuanMode && lianhuanCardIdx!==null && g.phase==='play' && g.turn===mySeat && p.alive){
      // CORE-166(issue #225):连环视为使用【铁索连环】,目标合法性必须复用
      // CARD_PLAYS['铁索连环'].canTarget(帷幕/智迟),不能只判存活——服务端 lianHuan
      // 已在 CORE-176 收口到同一个 canTarget,UI 这里同步(allowSelf 仍允许点自己)。
      const lhCard=(meP.hand||[])[lianhuanCardIdx];
      const lhAs=lhCard?{name:'铁索连环', suit:lhCard.suit, rank:lhCard.rank, virtual:true}:null;
      const lhOk = !!lhAs && singleTargetCanTarget(g, CARD_PLAYS['铁索连环'], meP, lhAs, i);
      const picked=lianhuanTargets.includes(i);
      if(lhOk){
        d.style.cursor='pointer';
        d.style.outline=picked?'3px solid var(--accent)':'2px dashed var(--cinnabar-bright)';
        d.title=picked?'已选择为【铁索连环】目标':'选择为【铁索连环】目标';
        d.onclick=()=>{
          if(picked) lianhuanTargets=lianhuanTargets.filter(seat=>seat!==i);
          else if(lianhuanTargets.length<2) lianhuanTargets=[...lianhuanTargets, i];
          render(g);
        };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色不能成为【铁索连环】的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
    }
    if(selectedCardIdx!==null && selCard && resolveActionId(g,meP,selCard)==='铁索连环' && g.phase==='play' && g.turn===mySeat && p.alive){
      // CORE-166(issue #225):同上,实体【铁索连环】选目标也要走服务端同一个 canTarget。
      const tsOk = singleTargetCanTarget(g, CARD_PLAYS['铁索连环'], meP, selCard, i);
      const picked=tiesuoTargets.includes(i);
      if(tsOk){
        d.style.cursor='pointer';
        d.style.outline=picked?'3px solid var(--accent)':'2px dashed var(--cinnabar-bright)';
        d.title=picked?'已选择为【铁索连环】目标':'选择为【铁索连环】目标';
        d.onclick=()=>{
          if(picked) tiesuoTargets=tiesuoTargets.filter(seat=>seat!==i);
          else if(tiesuoTargets.length<2) tiesuoTargets=[...tiesuoTargets, i];
          render(g);
        };
      } else {
        d.style.outline='2px dotted #6b5b4d';
        d.title='该角色不能成为【铁索连环】的目标';
        d.innerHTML += '<span class="tag" style="display:inline-block;margin:6px 14px 0;background:#3a2f28">不可选</span>';
      }
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
    // 刘备【仁德】:从明确的技能入口进入后,选择手牌并交给其他角色。
    if(rendeMode && rendePicks.length>0 && g.phase==='play' && g.turn===mySeat && hasCap(meP,'rende') && i!==mySeat && p.alive){
      const picks=rendePicks.slice();
      const targetSeat=i;
      const rb=document.createElement('button');
      rb.className='ghost';
      rb.textContent='仁德:交出 '+picks.length+' 张';
      rb.style.margin='6px 14px 0';
      rb.onclick=(e)=>{ e.stopPropagation(); confirmAndPlay('将选中的 '+picks.length+' 张手牌交给 '+g.players[targetSeat].name+'，发动【仁德】？', ()=>renDe(picks, targetSeat)); };
      d.appendChild(rb);
      d.style.cursor='pointer';
      d.style.outline='2px dashed var(--cinnabar-bright)';
      d.title='选择为【仁德】的赠牌目标';
      d.onclick=()=>{ confirmAndPlay('将选中的 '+picks.length+' 张手牌交给 '+g.players[targetSeat].name+'，发动【仁德】？', ()=>renDe(picks, targetSeat)); };
    }
    // 刘备【激将】:主动使用时先选合法的【杀】目标,再进入蜀势力角色依次响应流程。
    if(jijiangMode && g.phase==='play' && g.turn===mySeat && i!==mySeat && p.alive){
      const virtualSha={name:'杀',suit:'',rank:'',id:'jijiang'};
      if(CARD_PLAYS['杀'].canTarget(g, meP, virtualSha, i)){
        d.style.cursor='pointer';
        d.style.outline='2px dashed var(--cinnabar-bright)';
        d.title='选择为【激将】的【杀】目标';
        const targetSeat=i;
        d.onclick=()=>{ resetJijiang(); useJijiang(targetSeat); };
      }
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
  // CORE-146:把"这一行里实际有几张对手卡"暴露成 CSS 变量 --opp-n。
  // 手机横屏断点用它反推座位卡的高度上限(见 index.html 里 .seat 的 min() 那条):
  // 卡片是"设 height、靠 aspect-ratio:3/4 反推 width",所以一行要放得下几张卡这件事
  // 必须回过头来限制高度。**不能在 CSS 里写死张数**——SEATS=9 意味着对手数是 1~8 的
  // 变量:写死最坏情况(8)会让 3 人局的卡片在窄屏上被无谓压小,写死 7 又会让 9 人局横向
  // 溢出。这里取 oppRow 的实际子节点数,人数怎么变都对得上。
  // 下限夹到 1:2 人局只有 1 个对手,且 calc 里它当除数,不能为 0。
  // 【注意:多数情况下这个值不会改变卡片尺寸,这是正常的】CSS 那边是
  // min(屏高预算, 本项),宽视口上本项算出来始终比屏高预算大,min() 取的是屏高那一项——
  // 所以 844/932 上 2~9 人局的卡片尺寸完全相同。只有窄屏+人多(实测 667x375 的 7、8 对手)
  // 时本项才会更小并接管。详见 index.html 里 .seat 那条 min() 的完整实测数据。
  oppRowEl.style.setProperty('--opp-n', String(Math.max(1, oppRowEl.children.length)));
  // 中央出牌区:和音效共用同一批 markCardSound 调用点、同一个 seq 序列。调用点必须放在
  // 座位卡片(.seat)全部重新创建完毕之后——曾经放在 render() 更靠前的位置(座位重绘之前),
  // 结果是这一次 render() 里先给旧的座位元素加上高亮 class,紧接着座位重绘又把这些旧元素
  // 整体销毁替换成全新的(不带任何 class),同一次 render() 内高亮被自己立刻冲掉,座位高亮
  // 永远不可见(真实复现过的 bug,Playwright 截图+DOM 检查确认过)。#tableCard 本身不受
  // 这个顺序影响(它是持久节点,不会被座位重绘销毁),但它的目标座位高亮逻辑必须在这里、
  // 座位元素已经是"这一轮最终版本"之后执行。
  renderTableCard(g);
  maybeShowDamageEffect(g);
  if(typeof observeDiscardReveal==='function') observeDiscardReveal(g);
  // 【updateLogPanelHeight() 的调用点已下移】——桌面自适应 步骤a 引入
  // updateDesktopSeatHeights() 之后,这里出现过一个真实的循环依赖 bug:原来
  // updateLogPanelHeight() 在这里(renderControls/renderHand 之前)就跑了,它会读
  // tableStrip 的位置——但 tableStrip 的位置本身又受 .log-panel(grid-row:1/span 3,
  // 和座位区共享同一批行)当前内联高度的影响;如果上一次渲染是人数更多的一局(.log-panel
  // 内联高度较大),这次即使换成人数更少的一局,.log-panel 那个偏大的旧内联高度仍会在
  // 这一刻撑住 grid 的第1~3行、让 tableStrip 的位置读出来偏低,导致 updateDesktopSeatHeights()
  // (在更后面调用)算出的"对手区可用高度"被这份还没来得及更新的旧数据污染,得到偏小的
  // 结果——而且这不是"晚一帧就能自己纠正"的瞬时误差,是一个稳定的错误不动点(连续多次
  // 对同一个g重新render,污染后的偏小结果会一直保持,不会自愈,已用真实dump复现过)。
  // 正确的依赖方向是:先算好座位卡该多高(它不依赖.log-panel),.log-panel 的高度再根据
  // "座位卡已经是这一轮最终尺寸"之后的座位区实际底边来算——所以 updateLogPanelHeight()
  // 必须挪到 updateDesktopSeatHeights() 之后调用,不能留在这里。

  // phase pill + deck info
  const phaseName={lobby:'等待开始',draw:'摸牌阶段',play:'出牌阶段',discard:'弃牌阶段',respond:'响应阶段',duel:'决斗中',wuxie:'无懈响应',aoeResp:'群体响应',pick:'选牌',qilin:'弃坐骑',dying:'濒死求桃',guicai:'鬼才改判',tieqi:'铁骑判定',liegong:'烈弓',luoshen:'洛神判定',shuangxiongAsk:'双雄询问',xiaoguo:'骁果',xiaoguoChoice:'骁果选择',jiedaoChoice:'借刀杀人选择',wugu:'五谷丰登',qiaobianTurnStart:'巧变询问',qiaobianMove:'巧变移动',qinglong:'青龙偃月刀',hanbingAsk:'寒冰剑询问',hanbing:'寒冰剑弃牌',guanshi:'贯石斧',yijiAsk:'遗计询问',yijiAssign:'遗计分配',ganglieAsk:'刚烈询问',ganglieChoice:'刚烈惩罚',luoyiAsk:'裸衣询问',lirangAsk:'礼让询问',lirangRecover:'礼让回收',zhengyi:'争义询问',quhuRespond:'驱虎拼点',quhuDamageChoice:'驱虎伤害',fanjianSuit:'反间选花色',jiemingAsk:'节命询问',liuli:'流离询问',tianxiang:'天香询问',biyue:'闭月询问',pickingGeneral:'选将阶段',guanxingReview:'观星',shaOffsetChoice:'杀被抵消后的效果选择',mengjin:'猛进选择',zhijiChoice:'志继选择',tiaoxinChoice:'挑衅选择',tiaoxinDiscard:'挑衅弃牌',xunxunPick:'恂恂选择',wangxiAsk:'忘隙询问',jijiangAsk:'激将求助',hujiaAsk:'护驾求助',zhibaAsk:'制霸拼点',zhuqueAsk:'朱雀羽扇',over:'游戏结束'}[g.phase]||g.phase;
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

  // 桌面自适应 步骤a:renderControls/renderHand(上面已执行完)渲染出的 tableStrip/
  // panel.table/myGeneral/hand-label/meSeat/hand 都已是这一轮最终状态,现在才能正确
  // 测量"对手区之外占用了多少高度",据此算出对手区座位卡该有多高。
  updateDesktopSeatHeights(g);
  // updateLogPanelHeight() 必须排在 updateDesktopSeatHeights(g) 之后——见上面
  // renderTableCard 之后那段注释,这是修复循环依赖bug之后的正确调用顺序:座位卡先
  // 定型,.log-panel 再根据座位区的最终实际底边算自己该多高。
  updateLogPanelHeight();
  } finally {
    // 双向隔离:①渲染抛异常不影响机器人继续被调度(否则机器人永久停摆);
    //          ②机器人调度自己抛异常也不污染渲染(catch 掉只记一条告警)。
    try{ if(typeof scheduleBotTurn==='function') scheduleBotTurn(g); }
    catch(e){ console.warn('bot schedule',e); }
  }
}



function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// ===== 说明浮层(独立于 render;bodyHtml 需已是安全 HTML,单条说明请自行 escapeHtml) =====
// ===== CORE-131(issue #171):#infoModal 的"归属世代号" =====
// 几个浮层(帮助/日志/武将说明/装备说明/调试日志)共用同一个 #infoModal 容器,这本身没问题;
// 问题出在**异步回填**:showDebugLog() 是先同步显示"加载中…"、再异步拉数据回填,如果这段
// 时间里用户已经打开了别的浮层,晚到的回调会把内容写进现在归别人的容器里,把它顶掉。
// 【为什么原来那层防护不够】debug-log.js 里本来就有 `if(m.classList.contains('hidden')) return`,
// 注释也预见了这个风险——但它只挡住"弹窗已被关闭"这一种情况;用户关掉🐛又打开📜时,弹窗是
// **可见**的,守卫直接放行,内容照样被覆盖(已实测复现)。要判断的不是"还开着吗",而是
// "还是我这一次开的吗"。
// 【机制】每次 showInfo/hideInfo 都把世代号 +1;异步发起方在同步阶段记下当时的世代号,
// 回填前比对——不一致说明容器已经易主,直接放弃写入。这和项目里 render-table.js 的
// lastShownEntrySeq、ai-bot.js 的 aiTestPendingRecord 是同一类"晚到的异步结果要先确认
// 自己还是当前那一次"的写法。收敛在 showInfo/hideInfo 这一层,以后再有异步浮层直接复用,
// 不需要每个调用点各写一遍。
let infoModalGen = 0;
function infoModalGeneration(){ return infoModalGen; }
function showInfo(title, bodyHtml){
  infoModalGen++;
  const m=document.getElementById('infoModal');
  m.innerHTML='<div class="info-panel"><button class="info-close icon-btn" aria-label="关闭">✕</button>'
    +'<h3>'+escapeHtml(title)+'</h3><div class="info-body">'+bodyHtml+'</div></div>';
  m.classList.remove('hidden');
  m.onclick=(e)=>{ if(e.target===m) hideInfo(); };            // 点遮罩空白处关闭
  m.querySelector('.info-close').onclick=hideInfo;
  m.querySelector('.info-panel').onclick=(e)=>e.stopPropagation(); // 点面板本身不关闭
}
function hideInfo(){ infoModalGen++; const m=document.getElementById('infoModal'); m.classList.add('hidden'); m.innerHTML=''; logModalOpen=false; }
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
  // 环境诊断附在最后:手机上没有开发者控制台,而"主屏启动画面被放大"这类问题只有在真机的
  // standalone 模式下才复现,必须有一个不依赖调试工具、随时可点的地方能读到实际视口数值。
  // pwa.js 加载顺序在 render.js 之后,所以只能在函数被调用时(用户点击时)查,不能在顶层查
  // ——和 debug-log.js 里查 infoModalGeneration 是同一个约束。
  if(typeof pwaDiagnosticsHtml === 'function') html += pwaDiagnosticsHtml();
  showInfo('规则 / 说明', html);
}
