// render-log.js — 日志/toast 展示层,从 render.js 拆分出来(纯重构第一步,行为零变化)。
// 只包含"渲染/格式化日志文本、决定要不要弹 toast、toast 排队播放"这部分逻辑;
// getPlayerDisplayLabel/seatColor/escapeHtml/logModalOpen 等被 render.js 其它部分
// (座位卡渲染、中央出牌区、通用说明浮层)共用的函数/变量仍留在 render.js,这里按
// 全局作用域直接调用它们(和 render.js 内部互相调用同一套 <script> 全局作用域,不需要
// import/require)。


// 日志 toast:"刚刚发生了什么"的瞬时提示,和 banner("当前该谁做什么")信息类型不同,不复用。
// undefined 是哨兵值,只在"页面/模块刚加载后的第一次 render()"这一刻生效一次——把它设成当时
// 最新一条日志的 seq、不弹任何 toast(否则中途加入/刷新页面进入一局进行中的对局,会把历史
// 最后一条日志误当"新发生的事"弹出来)。之后每次 render() 都是和"上一次真实记过的 seq"比较,
// 包括 Firebase 断线重连后的自动重新推送——不会重置回 undefined,所以重连瞬间不会被误判成
// "有新日志"。
// **这里存的是 g.log 每条元素自带的 seq(全局单调递增,见 game.js 的 pushLog/normalize),
// 不是"最后一条日志的文本"也不是"g.log.length"**——这套方案专门消掉了旧文本比较方案踩过的
// 两个真实 bug:①历史版本曾在数据层截断日志,按 length 比较会在封顶后再也算不出"有新增";
// ②若按"最后一条文本是否变化"比较,连续两条日志文本恰好完全相同(比如两人先后
// 都摸了两张牌,文案巧合一致)会被误判成"没有新日志"而漏弹一次。seq 由 pushLog 从上一条派生
// 自增,不依赖数组长度也不比较文本内容；两条文本相同也各自有独立的 seq,天然规避
// 这两个问题。
// 【排队展示,不再只弹最后一条】曾经这里"多条连续新日志只弹最后一条",导致延时锦囊判定
// (乐不思蜀/兵粮寸断的"判定为XX,生效/无效"这条中间结果)被同一次事务里紧跟着的下一条日志
// 淹没、玩家完全看不到判定过程发生了什么——已改成把本次新增的全部日志交给 queueLogToasts
// 排队依次展示(见该函数),上限5条防止无懈连锁反应这类极端场景排队太久。
let lastToastedSeq = undefined;

// SUIT_COLOR: 红桃/方块用醒目的朱红色(呼应主题色 --cinnabar-bright),黑桃/梅花不特意变色,
// 沿用正文默认文字色(暗色主题下强行标"黑色"对比度反而不够,不如不处理)。
const SUIT_COLOR = { '♥':'var(--cinnabar-bright)', '♦':'var(--cinnabar-bright)' };

// 无懈逐个轮询的 asking 属于内部调度信息。共享日志保留原始文本供结算/诊断使用，
// 但所有客户端在展示日志或 toast 时统一隐藏当前被询问者姓名；本人仍由 controls banner
// 显示具体操作提示和按钮，不依赖这条日志。
function hideWuxiePollingPlayer(text){
  if(typeof text!=='string') return text;
  if(/^询问 .+ 是否(?:使用|反制)【无懈可击】…$/.test(text)){
    return '等待其他玩家响应【无懈可击】…';
  }
  return text;
}

// colorizeSuits: 对一段"确定没有被姓名替换占用"的纯文本,逐字符扫描,给花色符号包色、
// 其余字符正常转义。只处理未被姓名匹配占用的片段,不会和 formatLogEntry 的姓名替换重叠处理。
function colorizeSuits(segment){
  let out = '';
  for(const ch of segment){
    if(SUIT_COLOR[ch]) out += '<span style="color:'+SUIT_COLOR[ch]+'">'+ch+'</span>';
    else out += escapeHtml(ch);
  }
  return out;
}

// formatLogEntry: 日志展示层的统一格式化入口,给常驻面板和完整历史弹窗共用。不改变 g.log 里
// 存储的原始文本——原文本仍是各处手写的纯字符串,只在这一步做两件事:①把玩家名字替换成
// "【武将名】"并按座位色染色(getPlayerDisplayLabel);②给文本里的花色符号染色
// (colorizeSuits)。和 colorizeLogLine 同一套"先在纯文本坐标系标记已占用区间、长名字优先
// 占坑、最后一次性拼出HTML"写法,避免嵌套/重叠替换,同时保证姓名区间不会被花色染色重复处理
// (colorizeSuits 只作用于姓名匹配之间/之外的剩余片段)。
function formatLogEntry(g, text){
  text = hideWuxiePollingPlayer(text);
  const entries = (g.players||[]).map((p,i)=>({i,p}))
    .filter(o=>o.p && o.p.name)
    .map(o=>Object.assign(o, {label:getPlayerDisplayLabel(g, o.p)}))
    .sort((a,b)=>b.p.name.length-a.p.name.length); // 长名字优先占坑,避免被短名字子串抢先匹配

  const claimed = new Array(text.length).fill(false);
  const matches = []; // {start,end,html}
  entries.forEach(({i,p,label})=>{
    const name = p.name;
    let searchFrom = 0;
    while(true){
      const idx = text.indexOf(name, searchFrom);
      if(idx<0) break;
      const end = idx+name.length;
      let overlap = false;
      for(let k=idx;k<end;k++){ if(claimed[k]){ overlap=true; break; } }
      if(!overlap){
        for(let k=idx;k<end;k++) claimed[k]=true;
        matches.push({start:idx, end, html:'<span style="color:'+seatColor(i)+'">'+escapeHtml(label)+'</span>'});
      }
      searchFrom = idx+1; // 继续找同一名字在这条日志里的其它出现位置(比如同时提到来源和目标)
    }
  });
  matches.sort((a,b)=>a.start-b.start);

  let result = '';
  let cursor = 0;
  matches.forEach(m=>{
    result += colorizeSuits(text.slice(cursor, m.start));
    result += m.html;
    cursor = m.end;
  });
  result += colorizeSuits(text.slice(cursor));
  return result;
}
// colorizeLogLine: 只在 toast 这一处渲染路径把日志行里出现的玩家名字染上座位色(呼应座位卡片
// 的 seatColor),不碰 g.log 本身的存储(依然是纯字符串,日志面板 renderLogModal 不受影响)。
// 先转义整行,再用转义后的名字做字面 split/join 替换(不用正则,不用处理名字里的正则特殊字符);
// 按名字长度从长到短替换,防止"某玩家名字是另一玩家名字子串"时被短名字提前抢先替换掉。
// 名字长度<2的不参与染色:三国杀满屏都是单字游戏术语(杀/闪/桃/牌/堆/弃...),1个字的玩家名
// 几乎必然和这些词撞在一起,误染色概率很高;2字以上撞上无关词组纯属巧合,概率低很多,
// 这里只接受"低概率的巧合误染色"这一种代价,不为它再引入正则/语境匹配的复杂度。
// colorizeLogLine: 在原始纯文本上一次性算好所有"该染色的区间"（长名字优先占坑、已占用的
// 区间后续短名字不能再匹配),再统一拼出最终HTML,不对已生成的HTML做二次查找替换——旧实现
// 靠反复对同一段文本做"整串split/join"来判断该给谁上色,当一个玩家名字是另一个玩家名字的
// 子字符串时(如"AA"和"BAA"),长名字"BAA"先被包进彩色span,但"AA"这几个字符依然字面存在
// 于生成出的HTML字符串内部,轮到处理"AA"时又在已生成的HTML里重新匹配到、再包一层嵌套span,
// 内层颜色覆盖外层,导致同一个名字在一句话里被拆成两种颜色。这次改成先在纯文本坐标系里
// 用 claimed 数组标记哪些字符位置已经被占用,长名字优先占坑,从根本上避免嵌套/重叠染色。
function colorizeLogLine(g, text){
  const entries = (g.players||[]).map((p,i)=>({i,p}))
    .filter(o=>o.p && o.p.name && o.p.name.length>=2)
    .sort((a,b)=>b.p.name.length-a.p.name.length); // 长名字优先占坑,避免被短名字的子串匹配抢先

  const claimed = new Array(text.length).fill(false);
  const matches = []; // {start,end,color}
  entries.forEach(({i,p})=>{
    const name = p.name;
    let searchFrom = 0;
    while(true){
      const idx = text.indexOf(name, searchFrom);
      if(idx<0) break;
      const end = idx+name.length;
      let overlap = false;
      for(let k=idx;k<end;k++){ if(claimed[k]){ overlap=true; break; } }
      if(!overlap){
        for(let k=idx;k<end;k++) claimed[k]=true;
        matches.push({start:idx, end, color:seatColor(i)});
      }
      searchFrom = idx+1; // 继续找同一个名字在这条日志里的其它出现位置(比如同时提到来源和目标)
    }
  });
  matches.sort((a,b)=>a.start-b.start);

  let result = '';
  let cursor = 0;
  matches.forEach(m=>{
    result += escapeHtml(text.slice(cursor, m.start));
    result += '<span style="color:'+m.color+'">'+escapeHtml(text.slice(m.start, m.end))+'</span>';
    cursor = m.end;
  });
  result += escapeHtml(text.slice(cursor));
  return result;
}
function showLogToast(g, entry){
  const el = document.getElementById('logToast');
  const text = (entry && typeof entry==='object') ? entry.text : entry; // 兼容极端情况下传进来的是字符串
  const kind = (entry && typeof entry==='object') ? entry.kind : null;
  // toast 与右侧日志使用同一套姓名格式，避免一处显示【武将名】、另一处仍泄露玩家名。
  el.innerHTML = formatLogEntry(g, text);
  // 先清空 class(#logToast 基础样式来自 id 选择器,清 class 不影响基础外观),再按本条 kind 上强调色。
  // 无 kind 则保持默认金色样式;染色的玩家名字有 inline color、不受强调色影响,只影响其余文字。
  el.className = '';
  if(kind) el.classList.add('toast-'+kind);
  // 重新触发 CSS 动画:强制回流后加回 .show(和原来一致)。
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// isToastworthyLog: 判断一条日志文本是否值得弹 toast 提醒——覆盖出牌动作("使用【"/"打出【"/
// "当【")、延时锦囊判定结果("生效"/"无效",如"【乐不思蜀】生效"/"【兵粮寸断】无效"、闪电
// 判定命中的"【闪电】发动")、伤害结算("受到",dealDamage 统一走"受到N点伤害"这个固定文案,
// 覆盖所有伤害来源)、以及部分技能发动提示("发动")。不是每条新增日志都弹——摸牌/回合切换
// 这类高频但信息量低的日志不触发,避免刷屏。
// 【结构化事件层接入后的定位】这套"从文本嗅探子串"的判定本身很脆弱——改一处措辞或撞上无关词
// 就可能误伤/误弹。日志条目现在可以携带 kind 标签(见 game.js 的 logEvent),打了标签的条目
// 改走下面 isToastworthyEntry 的 kind 白名单判定,不再嗅探文本;这个函数只作为"未打标签的旧
// 条目"的 fallback 继续存在(目前只有 damage/sha 两个漏斗打了标签,其余日志仍然全部落到这里,
// 行为和结构化事件层接入之前完全一致)。
function isToastworthyLog(text){
  return text.includes('使用【')
    || text.includes('打出【')
    || text.includes('当【')
    || text.includes('生效')      // 延时锦囊判定成功(如"【乐不思蜀】生效"、"【兵粮寸断】生效"、"【闪电】发动")
    || text.includes('无效')      // 延时锦囊判定失败/未生效(如"【乐不思蜀】无效")
    || text.includes('受到')      // 受到伤害(掉血)
    || text.includes('发动');     // 闪电等判定生效的措辞变体,以及部分技能发动提示
}

// TOAST_KINDS: 会弹 toast 的事件类型白名单(取代"从文本嗅探子串")。设成较全的一组,方便以后新 tag 的
// 同类事件自动纳入;当前只有 damage/sha 被真正打了标签,其余靠 fallback。
const TOAST_KINDS = new Set(['damage','sha','useCard','playCard','convertCard','judge','skill']);
// isToastworthyEntry: 打了结构标签(有 kind)的条目只看 kind 白名单,不再嗅探文本;未打标签的旧条目
// (占绝大多数)回退到 isToastworthyLog 的文本子串判定,行为与第二步之前完全一致。
function isToastworthyEntry(entry){
  if(entry && typeof entry==='object' && entry.kind){
    return TOAST_KINDS.has(entry.kind);
  }
  const text = (entry && typeof entry==='object') ? entry.text : entry;
  return isToastworthyLog(text);
}

// queueLogToasts: 把一次事务里新增的多条日志排队依次展示(每条showLogToast后等一段时间
// 再切下一条),而不是只弹最后一条——解决延时锦囊判定这类"中间结果"被淹没看不到的问题。
// 上限 5 条:无懈连锁反应这种极端场景可能一次性新增十几条日志,全部排队展示会等很久、
// 影响体验,这里只展示"最近的几条"(丢弃更早的),不追求条条必达——toast 本来就是
// "尽量提醒瞥一眼"的定位,完整过程始终能在 #logBtn 的日志面板里查看。
const LOG_TOAST_QUEUE_CAP = 5;
let toastQueue = [];
let toastQueueRunning = false;
function queueLogToasts(g, entries){
  // 用 isToastworthyEntry 过滤(有 kind 看白名单、无 kind 回退子串)。队列里存整条目对象,
  // 供 showLogToast 取 text 显示、取 kind 决定强调色。上限只针对过滤后"真正会弹"的这些条目计数。
  const worthy = entries.filter(isToastworthyEntry);
  const capped = worthy.length > LOG_TOAST_QUEUE_CAP ? worthy.slice(-LOG_TOAST_QUEUE_CAP) : worthy;
  toastQueue.push(...capped);
  if(toastQueueRunning) return;
  toastQueueRunning = true;
  const step=()=>{
    if(toastQueue.length===0){ toastQueueRunning=false; return; }
    const entry = toastQueue.shift();
    showLogToast(g, entry);
    // 间隔要略大于动画总时长(2.5s),否则下一条会在上一条淡入-停留-淡出还没播完时就提前打断它。
    setTimeout(step, 2600);
  };
  step();
}

// showLog/renderLogModal: 日志浮层,复用 showInfo/#infoModal(和武将/装备说明、帮助面板同一套
// "只读+关闭"组件),不是新造的展开/收起控件。区别于那些一次性静态内容:日志在面板开着时
// 还会继续变化(Firebase 实时推送),所以 render() 每次都会在 logModalOpen 为真时重新调用
// renderLogModal 刷新内容,而不是只在打开的一瞬间生成一次。
function showLog(){ logModalOpen=true; renderLogModal(currentG); }
function renderLogModal(g){
  if(!logModalOpen || !g) return;
  const html=(g.log||[]).map(l=>'<div>'+formatLogEntry(g, l && typeof l==='object' ? l.text : l)+'</div>').join('');
  showInfo('日志', '<div class="log-modal">'+html+'</div>');
  const body=document.querySelector('#infoModal .log-modal');
  if(body) body.scrollTop=body.scrollHeight; // 每次刷新都跟到最新一条,和以前常驻日志的行为一致
}
// renderLogPanel: 右侧常驻日志显示本局全部记录，并在自己的面板内滚动。用户正在查看
// 较早记录时保留当前位置；只有原本就在底部时，新日志到来才自动跟到最新一条。
// 📜 按钮的完整历史弹窗继续保留，适合需要更大阅读面积时使用。
let lastChatSentAt = 0;
const QUICK_CHAT_PHRASES = [
  '快点吧，花儿都谢了！',
  '别急，让我想想。',
  '你这牌打得很有想法。',
  '好家伙，直接给我整不会了。',
  '不是吧，这也能中？',
  '这波啊，这波是天命。',
  '我就静静地看着你表演。',
  '给个机会，我还能抢救一下。',
  '稳住，我们能赢。',
  '承让承让！'
];
const CHAT_EMOJIS = ['😀','😂','🤣','😊','😍','😎','😭','😡','👍','👏'];

// ===== 聊天语音播报(Chat TTS, 2026-08):收到新聊天消息用 speechSynthesis 念内容,
// 按发送者武将性别选声(男低音/女高音)。纯客户端本地行为,不写 Firebase。
// 复用 announceMyTurn(render.js)同款写法:cancel() 防堆积 + try/catch 静默失败。
let chatVoiceEnabled = (function(){
  try{ return !(typeof localStorage!=='undefined' && localStorage.getItem('sgs_chat_voice')==='0'); }
  catch(e){ return true; }
})();
const spokenChatIds = new Set(); // 已见消息 id 去重:跨同步累积、跨enterGame累积(重进不重念);
                                 // 关闭语音期间的消息也标记(重开不重放);页面刷新时重建
function toggleChatVoice(){
  chatVoiceEnabled = !chatVoiceEnabled;
  try{ localStorage.setItem('sgs_chat_voice', chatVoiceEnabled?'1':'0'); }catch(e){}
  const btn=document.getElementById('chatVoiceBtn');
  if(btn) btn.textContent = chatVoiceEnabled ? '🔊' : '🔇';
  return chatVoiceEnabled;
}
// detectChatLang:按文本主要字符集判断语言,返回 BCP47 lang 标签。修复"英文/韩文消息
// 不发声"问题的根因——SpeechSynthesisUtterance.lang 若与文本实际语言不匹配,很多浏览器
// 的语音引擎会静默跳过整句、不报错也不出声。规则:先查韩文(谚文音节/字母/兼容字母区
// U+AC00-D7A3/U+1100-11FF/U+3130-318F,和中文区间互斥,须先判断避免被中文规则截胡)、
// 再查日语(平假名 U+3040-309F/片假名 U+30A0-30FF 是日语强特征字符,必须在中文判断
// 之前检测——日语句子常混杂汉字,和中文CJK统一表意文字区间重叠,若先判中文会把带假名
// 的日语句子误判成中文;但纯汉字的日语句子里没有任何假名字符,天然无法靠字符区间和中文
// 区分开,这种情况会落回中文判断,是字符区间判断法的固有局限,不引入分词/语言检测库解决)、
// 再查中文(CJK统一表意文字 U+4E00-9FFF),都不含则默认英文——简单字符区间判断,不引入
// 语言检测库,够用即可。混合语言消息(一句话中英夹杂)按"整句判一次主要语言"处理,不做
// 分段;真要分段需要按语言切分文本+逐段调用speak,复杂度明显超出这次修复范围,列后续优化项。
function detectChatLang(text){
  const s = String(text||'');
  if(/[가-힣ᄀ-ᇿ㄰-㆏]/.test(s)) return 'ko-KR';
  if(/[ぁ-んァ-ヿ]/.test(s)) return 'ja-JP';
  if(/[一-鿿]/.test(s)) return 'zh-CN';
  return 'en-US';
}
// pickChatVoice:按性别选对应语言的 voice(名字关键词只覆盖中文声库命名习惯,英文/韩文
// 声库无统一命名规则,退化为"只匹配语言前缀、忽略性别关键词");列表为空/无匹配返回 null
// (调用方 fallback pitch,不影响是否发声——发声与否由 u.lang 是否匹配文本决定)。
function pickChatVoice(gender, lang){
  try{
    if(!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if(!voices || !voices.length) return null;
    const isFemale = gender==='female';
    const kw = isFemale ? /female|女|huihui|xiaoxiao|xiaoyi/i : /male|男|kangkang|yunxi/i;
    const prefix = (lang||'zh-CN').split('-')[0];
    const langRe = new RegExp('^'+prefix, 'i');
    return voices.find(v => kw.test(v.name) && langRe.test(v.lang||''))
        || voices.find(v => langRe.test(v.lang||''))
        || null;
  }catch(e){ return null; }
}
function speakChatMessage(text, gender){
  try{
    if(!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(String(text||'').slice(0,60));
    u.lang = detectChatLang(text);
    const v = pickChatVoice(gender, u.lang);
    if(v) u.voice = v;
    u.pitch = (gender==='female') ? 1.2 : 0.8;
    window.speechSynthesis.cancel(); // 防多次快速触发排队堆积
    window.speechSynthesis.speak(u);
  }catch(e){ /* 语音失败静默忽略 */ }
}
// detectAndSpeakNewChat:遍历聊天消息,念"新且非emoji"的。性别来源:消息 general 字段→getGeneral。
// M-6:标记 id 与"念不念"解耦——先遍历把"新 id"全部记入 spokenChatIds(含关闭语音时),
// 再按 chatVoiceEnabled 决定是否真的念。这样开关关闭期间到达的消息也被标记为"已见",
// 重开语音后不会把旧消息重新念一遍(只念真正新到达的)。emoji 跳过/空文本跳过行为保持。
function detectAndSpeakNewChat(messages){
  if(!Array.isArray(messages)) return;
  const shouldSpeak = chatVoiceEnabled;
  messages.forEach(function(m){
    if(!m || typeof m!=='object') return;
    if(m.id!=null && spokenChatIds.has(m.id)) return; // 已念过去重
    if(m.id!=null) spokenChatIds.add(m.id);
    if(!shouldSpeak) return; // 关闭语音:只标记 id 不念(M-6)
    if(m.type==='emoji') return; // 表情不念
    const text = (m.text!=null ? String(m.text) : '').trim();
    if(!text) return;
    let gender = 'male';
    try{
      const gen = (typeof getGeneral==='function' && m.general) ? getGeneral(m.general) : null;
      if(gen && gen.gender==='female') gender = 'female';
    }catch(e){}
    speakChatMessage(text, gender);
  });
}
function chatSenderLabel(g, msg){
  const p=Number.isInteger(msg.seat) && g.players ? g.players[msg.seat] : null;
  const generalId=(p&&p.general)||msg.general;
  const gen=g.started && generalId ? getGeneral(generalId) : null;
  return gen ? ('【'+gen.name+'】') : ((p&&p.name)||msg.playerName||'玩家');
}
function pushChatMessage(text, type){
  text=String(text||'').trim().slice(0,60);
  if(!text || !chatRef || !currentG || mySeat===null) return;
  const now=Date.now();
  if(now-lastChatSentAt<600) return;
  const p=currentG.players&&currentG.players[mySeat];
  if(!p) return;
  lastChatSentAt=now;
  const ts=(typeof firebase!=='undefined' && firebase.database && firebase.database.ServerValue)
    ? firebase.database.ServerValue.TIMESTAMP : now;
  chatRef.push({text,type:type||'text',seat:mySeat,playerName:p.name||'玩家',general:p.general||null,ts});
  const input=document.getElementById('chatInput');
  if(input) input.value='';
}
function sendChatMessage(text){ pushChatMessage(text,'text'); }
function sendChatEmoji(emoji){
  if(CHAT_EMOJIS.includes(emoji)) pushChatMessage(emoji,'emoji');
}
function toggleEmojiPicker(){
  const picker=document.getElementById('emojiPicker');
  if(!picker) return;
  const opening=picker.classList.contains('hidden');
  picker.classList.toggle('hidden');
  if(opening){
    const button=document.querySelector('.emoji-toggle');
    if(!button) return;
    const rect=button.getBoundingClientRect();
    const width=Math.min(210,window.innerWidth-16);
    picker.style.width=width+'px';
    picker.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';
    picker.style.top=Math.max(8,rect.top-picker.offsetHeight-6)+'px';
  }
}
function sendQuickChat(text){ if(text) sendChatMessage(text); }
function sendChatFromInput(){
  const input=document.getElementById('chatInput');
  if(input) sendChatMessage(input.value);
}
function chatInputKeydown(e){
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendChatFromInput(); }
}
function renderLogPanel(g){
  const el = document.getElementById('logPanel');
  if(!el) return;
  const log = g.log||[];
  const oldLogBody=el.querySelector('.log-panel-scroll');
  const oldChatBody=el.querySelector('.chat-panel-scroll');
  const oldLogScrollTop=oldLogBody?oldLogBody.scrollTop:0;
  const oldChatScrollTop=oldChatBody?oldChatBody.scrollTop:0;
  const logWasAtBottom=!oldLogBody || oldLogBody.scrollHeight-oldLogBody.scrollTop-oldLogBody.clientHeight<24;
  const chatWasAtBottom=!oldChatBody || oldChatBody.scrollHeight-oldChatBody.scrollTop-oldChatBody.clientHeight<24;
  const messages=(chatMessages||[]).map(m=>{
    const isEmoji=m.type==='emoji' && CHAT_EMOJIS.includes(m.text);
    const content=isEmoji ? '<span class="chat-emoji">'+escapeHtml(m.text)+'</span>' : escapeHtml(m.text||'');
    return '<div class="chat-message'+(isEmoji?' emoji-message':'')+'"><b style="color:'+seatColor(Number.isInteger(m.seat)?m.seat:0)+'">'+escapeHtml(chatSenderLabel(g,m))+'</b>：'+content+'</div>';
  }).join('');
  const quick='<select class="quick-chat-select" onchange="sendQuickChat(this.value);this.value=\'\'"><option value="">快捷语</option>'+QUICK_CHAT_PHRASES.map(t=>'<option value="'+escapeHtml(t)+'">'+escapeHtml(t)+'</option>').join('')+'</select>';
  const emojiPicker='<div id="emojiPicker" class="emoji-picker hidden">'+CHAT_EMOJIS.map(e=>'<button type="button" onclick="sendChatEmoji(\''+e+'\')">'+e+'</button>').join('')+'</div>';
  // 语音开关按钮:emojiPicker 前插入(聊天语音核心在 Task 1 已就位,开关状态存 localStorage)
  const voiceBtn = '<button type="button" id="chatVoiceBtn" class="emoji-toggle" onclick="toggleChatVoice()" title="聊天语音开关">'+(chatVoiceEnabled?'🔊':'🔇')+'</button>';
  // 输入区只在首次进入房间时创建。之后的实时状态刷新仅更新两个滚动区，避免重建
  // #chatInput 导致正在输入的文字、输入法组合状态和光标位置被清空。
  if(!el.querySelector('.log-panel-section') || !el.querySelector('.chat-panel-section')){
    el.innerHTML = '<section class="log-panel-section"><div class="log-panel-head"></div><div class="log-panel-scroll"></div></section>'
      + '<section class="chat-panel-section"><div class="chat-panel-head"></div><div class="chat-panel-scroll"></div>'
      + '<div class="chat-compose">'+voiceBtn+emojiPicker+quick+'<div class="chat-input-row"><button type="button" class="emoji-toggle" onclick="toggleEmojiPicker()" title="选择表情">😊</button><input id="chatInput" maxlength="60" placeholder="说点什么…" onkeydown="chatInputKeydown(event)"><button onclick="sendChatFromInput()">发送</button></div></div></section>';
  }
  const logBody=el.querySelector('.log-panel-scroll');
  const chatBody=el.querySelector('.chat-panel-scroll');
  const logHead=el.querySelector('.log-panel-head');
  const chatHead=el.querySelector('.chat-panel-head');
  if(logHead) logHead.textContent='本局日志（共'+log.length+'条）';
  if(chatHead) chatHead.textContent='聊天（'+(chatMessages||[]).length+'条）';
  if(logBody) logBody.innerHTML=log.map(l=>'<div class="log-panel-entry">'+formatLogEntry(g, l && typeof l==='object' ? l.text : l)+'</div>').join('');
  if(chatBody) chatBody.innerHTML=messages||'<div class="chat-empty">还没有人说话</div>';
  if(logBody) logBody.scrollTop = logWasAtBottom ? logBody.scrollHeight : oldLogScrollTop;
  if(chatBody) chatBody.scrollTop = chatWasAtBottom ? chatBody.scrollHeight : oldChatScrollTop;
}
