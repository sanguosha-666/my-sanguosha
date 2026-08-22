// render-table.js — 中央出牌区展示层。
// tableCardFaceHtml/renderTableCard 原本是"单槽位覆盖"和"交换数组追加"两套并存机制各自
// 一段代码,现在统一成一套:g.exchangeCards 是唯一的数据源,永远追加,链结束才整批淡出。
// cardImageSrc/cardImgError/CARD_FALLBACK_EXTS/getPlayerDisplayLabel 等被 renderHand 等
// 其它渲染逻辑共用的函数仍留在 render.js,这里按全局作用域直接调用它们。

// tableCardFaceHtml: 中央出牌区共用的牌面结构——和手牌同一套图片素材(cardImageSrc)+
// 同一套失败降级(cardImgError/CARD_FALLBACK_EXTS),只是尺寸更小、没有手牌那套按视口自适应
// 字号的复杂逻辑(中央区文字量小、固定尺寸足够,不需要那么精细)。card 为空时返回空字符串。
function tableCardFaceHtml(card){
  if(!card) return '';
  const imgSrc = cardImageSrc(card.name);
  const imgTag = imgSrc ? '<img class="card-art" src="'+imgSrc+'" decoding="async" onerror="cardImgError(this)" alt="">' : '';
  const cornerText = cardFace(card)||'';
  const mountRole = mountRoleText(card);
  return '<div class="card '+(imgSrc?'':'no-art')+' table-card-mini">'
    + '<div class="card-art-box">'+imgTag+'</div>'
    + '<div class="corner">'+cornerText+'</div>'
    + (mountRole?'<div class="mount-role">'+mountRole+'</div>':'')
    + '</div>';
}
// 两个独立的 seq 去重,分别驱动完全不同的两件事,不要混在一起判断:
// - lastShownEntrySeq:"有没有新牌加入这条链"——只要数组最后一项的 seq 变了就触发,
//   不管链有没有结束,每加一张都重绘一次内容 + 对这张新牌重新播一次飞牌/连线/座位高亮。
// - lastFadedBatchSeq:"这一批结果有没有淡出过"——只在"链已结束"(!g.pending&&!g.aoe)
//   成立、且这批结果(以最后一项的 seq 为标识)还没淡出过时触发一次,负责切到淡出动画。
// 链进行中新牌不断加入时,lastShownEntrySeq 会一直变、lastFadedBatchSeq 保持不变(还没到
// 该淡出的时候);链结束的那一刻两者可能同时变化(比如无需响应的单次出牌,一push完pending
// 就已经是空的),也可能分开发生(比如决斗打了几个回合后认输,"新牌加入"在中途已经触发过
// 好几次,"链结束"是最后单独发生的一次,不一定伴随新牌)。
let lastShownEntrySeq = undefined;
let lastFadedBatchSeq = undefined;
// CORE-122(issue #154)方向2:平板"最近N次出牌"历史记忆——纯客户端本地内存,不写入g,
// 不碰pruneExchangeCards/game.js任何共享状态。固定大小FIFO(RECENT_PLAYS_LIMIT条),
// 超出自动丢最老的一条,不额外监听"新对局开始"信号做重置——新对局里最多3次真实出牌,
// 旧对局的记录就被自然挤出窗口,逻辑更简单、和服务端状态零交集。刷新页面/重进房间时
// 这个模块级变量本来就会重新初始化,天然清空,不需要专门处理。
const RECENT_PLAYS_LIMIT = 3;
let recentPlaysHistory = [];
// summarizeCompletedChain: 把一条刚结束的结算链(g.exchangeCards这一批)总结成一行纯
// 文字chip(不带卡面图片,故意保持轻量——只在平板断点内展示,见index.html对应CSS)。
// 出牌方取链里第一项的seat(链条自始至终都是同一个人在操作,取第一项和取最后一项等价,
// 这里选第一项是因为语义上"是谁发起了这条链"更贴近直觉);牌名按链里出现顺序拼接
// (决斗/铁索连环这类一条链打出多张牌时,能看到完整过程,不止最后一张);目标座位取
// 最后一项的targets(响应链条打到最后,目标信息一般也稳定在最后一项)。
// 任何字段缺失都不抛错、静默降级成更短的文本——这是纯装饰性历史记忆,不能因为异常
// 数据影响主渲染(和上面飞牌/连线动画的异常处理原则一致)。
function summarizeCompletedChain(g, chainEntries){
  try{
    if(!Array.isArray(chainEntries) || chainEntries.length===0) return null;
    const first = chainEntries[0];
    const lastEntry = chainEntries[chainEntries.length-1];
    const actorSeat = Number.isInteger(first.seat) ? first.seat : null;
    const actorLabel = (actorSeat!==null && g.players && g.players[actorSeat])
      ? getPlayerDisplayLabel(g, g.players[actorSeat]) : '？';
    const cardNames = chainEntries.map(e=>e && e.name ? e.name : '').filter(Boolean).join('、') || '？';
    let targetsLabel = '';
    if(Array.isArray(lastEntry.targets) && lastEntry.targets.length>0){
      const names = lastEntry.targets
        .map(t => (g.players && g.players[t]) ? getPlayerDisplayLabel(g, g.players[t]) : null)
        .filter(Boolean);
      if(names.length) targetsLabel = '→'+names.join('、');
    }
    return actorLabel+' '+cardNames+targetsLabel;
  }catch(e){
    return null; // 静默降级:纯展示性历史记忆,数据异常时宁可不显示这一条,不影响主渲染
  }
}
function pushRecentPlayHistory(g, chainEntries){
  const summary = summarizeCompletedChain(g, chainEntries);
  if(!summary) return;
  recentPlaysHistory.push(summary);
  if(recentPlaysHistory.length > RECENT_PLAYS_LIMIT){
    recentPlaysHistory.splice(0, recentPlaysHistory.length - RECENT_PLAYS_LIMIT);
  }
  renderRecentPlaysHistory();
}
// renderRecentPlaysHistory: #recentPlaysHistory是#tableCard的独立兄弟节点(见index.html
// #tableStrip结构),只在平板断点内可见(CSS控制display,这里始终渲染内容、不判断断点——
// 和.log-panel同款"始终渲染、靠CSS决定看不看得见"的既有写法一致)。最新一条排最前面。
function renderRecentPlaysHistory(){
  const el = document.getElementById('recentPlaysHistory');
  if(!el) return;
  if(recentPlaysHistory.length===0){ el.innerHTML=''; return; }
  el.innerHTML = recentPlaysHistory.slice().reverse()
    .map(s=>'<span class="recent-play-chip">'+escapeHtml(s)+'</span>').join('');
}
function renderWuguPool(g, el, pending){
  const pool=Array.isArray(pending.pool)?pending.pool:[];
  const picker=Array.isArray(pending.order)?pending.order[pending.idx]:null;
  const selectable=g.phase==='wugu' && pending.type==='wugu' && picker===mySeat;
  el.classList.add('wugu-pool-mode','exchange-mode');
  el.classList.remove('show');
  el.innerHTML='<div class="wugu-pool-title">【五谷丰登】'+(selectable?'请选择一张牌':'亮出的牌')+'</div>';
  const row=document.createElement('div');
  row.className='wugu-pool';
  pool.forEach((card,pi)=>{
    const item=document.createElement(selectable?'button':'div');
    item.className='wugu-pool-card'+(selectable?' selectable':'');
    item.innerHTML='<div class="wugu-card-name">'+escapeHtml(card.name)+'</div>'+tableCardFaceHtml(card);
    if(selectable){
      item.title='选择【'+card.name+'】';
      item.onclick=()=>{
        row.querySelectorAll('button').forEach(btn=>{btn.disabled=true;});
        wuguPick(pi,pending.idx,card&&card.id);
      };
    }
    row.appendChild(item);
  });
  el.appendChild(row);
}
function renderTableCard(g){
  const el = document.getElementById('tableCard');
  if(!el) return;
  const wuguPending=g.pending && (
    g.pending.type==='wugu' || (g.pending.type==='wuxie' && g.pending.ctx==='wugu')
  ) ? g.pending : null;
  if(wuguPending && Array.isArray(wuguPending.pool) && wuguPending.pool.length){
    renderWuguPool(g,el,wuguPending);
    return;
  }
  el.classList.remove('wugu-pool-mode');
  const list = Array.isArray(g.exchangeCards) ? g.exchangeCards : [];
  if(list.length===0){
    // 数组已被 normalize 清空(上一条链彻底结束、下一条链还没开始):清掉展示,不留残影。
    // 不需要在这里对 lastShownEntrySeq/lastFadedBatchSeq 做任何特殊重置——seq 是跨整局
    // 游戏单调递增的全局计数器,下一条新链的第一项 seq 必然大于这两个变量当前记的值,
    // 下一次非空渲染会自然被判定为"新牌"和"还没淡出过",不需要额外的重置逻辑。
    el.classList.remove('exchange-mode');
    el.classList.remove('show');
    el.innerHTML = '';
    return;
  }
  const last = list[list.length-1];
  const idle = !g.pending && !g.aoe;
  if(lastShownEntrySeq===undefined){
    // 首次进入房间/刷新页面:不把已经存在的历史内容当成"刚发生的新事件"来播动画,只记录
    // 当前基准、静默返回——和 maybePlayCardSound/原来的单槽位版本同一个"不补放历史"约定。
    lastShownEntrySeq = last.seq;
    if(idle) lastFadedBatchSeq = last.seq; // 若这一刻已经是空闲的(历史上早已结束的一条链残留),
    // 同样不倒放一次淡出动画,直接当成"已经淡出过"处理。
    return;
  }
  const hasNewEntry = last.seq !== lastShownEntrySeq;
  if(hasNewEntry){
    lastShownEntrySeq = last.seq;
    el.innerHTML = list.map(entry=>{
      const w = (Number.isInteger(entry.seat) && g.players[entry.seat]) ? getPlayerDisplayLabel(g, g.players[entry.seat]) : '';
      const f = entry.card ? tableCardFaceHtml(entry.card) : '';
      return '<div class="exchange-card">'
        + (w ? '<div class="table-card-who">'+escapeHtml(w)+'</div>' : '')
        + '<div class="table-card-name">'+escapeHtml(entry.name)+'</div>'
        + f
        + '</div>';
    }).join('');
    // 座位高亮:出牌方 + 目标座位,只对"最新加入的这一张"生效,每加一张就重新触发一次
    // (和原来单槽位版本每次 seq 变化都重触发一次是同一行为,只是数据源从 g.tableCard 换成
    // 数组最后一项)。
    document.querySelectorAll('.seat.table-actor,.seat.table-target').forEach(elx=>{
      elx.classList.remove('table-actor','table-target');
    });
    if(Number.isInteger(last.seat)){
      const actorEl = document.querySelector('.seat[data-seat="'+last.seat+'"]');
      if(actorEl) actorEl.classList.add('table-actor');
    }
    if(Array.isArray(last.targets)){
      last.targets.forEach(t=>{
        const targetEl = document.querySelector('.seat[data-seat="'+t+'"]');
        if(targetEl) targetEl.classList.add('table-target');
      });
    }
    // 飞牌动画:出牌方座位 -> 这一张新牌自己在行内的位置(不是整个 #tableCard 容器的中心——
    // 容器会随着牌数增多变宽,取整体中心会导致落点随链条进行不断左右漂移;取"最后一张卡片
    // 自己的 DOM 元素"作为落点,不受行宽变化影响)。用 getBoundingClientRect 算屏幕坐标差,
    // 生成一个绝对定位的临时元素做 transform 位移动画,动画结束后移除,不常驻 DOM。任何一步
    // 拿不到有效坐标就静默跳过——这是纯装饰层,绝不能因为它出错而影响上面已经完成的文字
    // 展示/座位高亮(那两块必须始终生效)。
    const existingFly = document.getElementById('flyingCard');
    if(existingFly) existingFly.remove(); // 连续快速出牌:先清掉上一张还没飞完的,不叠加多个
    if(Number.isInteger(last.seat)){
      const actorEl = document.querySelector('.seat[data-seat="'+last.seat+'"]');
      const newestCardEl = el.lastElementChild; // 刚刚重建的行里,最后一个 .exchange-card 就是这次新加入的
      if(actorEl && newestCardEl){
        try{
          const fromRect = actorEl.getBoundingClientRect();
          const toRect = newestCardEl.getBoundingClientRect();
          const seatsEl = document.getElementById('game');
          const containerRect = seatsEl.getBoundingClientRect();
          // 坐标都换算成相对 #game 容器的偏移(骨架级重建后坐标基准从旧版 #seats 改为
          // #game,见 CLAUDE.md),配合 #game 的 position:relative 定位飞牌元素,
          // 不用 fixed(fixed 相对视口,#game 内部滚动/布局变化时容易和真实座位位置脱节)。
          const fromX = fromRect.left - containerRect.left + fromRect.width/2;
          const fromY = fromRect.top - containerRect.top + fromRect.height/2;
          const toX = toRect.left - containerRect.left + toRect.width/2;
          const toY = toRect.top - containerRect.top + toRect.height/2;
          const fly = document.createElement('div');
          fly.id = 'flyingCard';
          fly.className = 'flying-card';
          fly.textContent = last.name; // 飞行途中只显示牌名文字,足够传达"这张牌在飞",不需要完整牌面渲染
          fly.style.left = fromX + 'px';
          fly.style.top = fromY + 'px';
          seatsEl.appendChild(fly);
          // 强制回流后再设置终点坐标,触发 CSS transition 位移(而不是直接跳到终点)——这段
          // "同步设起点->强制回流->同步设终点"的顺序对代码改动极度敏感,坐标来源换成
          // newestCardEl 之后这个执行顺序本身没有任何变化,仍然是先设起点、强制回流、再设终点。
          void fly.offsetWidth;
          fly.style.left = toX + 'px';
          fly.style.top = toY + 'px';
          fly.style.opacity = '0';
          setTimeout(()=>{ if(fly.parentNode) fly.remove(); }, 650); // 略长于 CSS transition 时长,确保动画播完再摘除
        }catch(e){
          // 坐标计算出任何异常(理论上不该发生,但飞牌是装饰层,宁可静默跳过也不能抛出影响主渲染)
          const stray = document.getElementById('flyingCard');
          if(stray) stray.remove();
        }
      }
    }
    // 目标连线:这一张新牌自己在行内的位置 -> 每个目标座位。和上面飞牌动画同一套坐标获取/
    // 清理/异常处理写法,起点同样从"整个 #tableCard 容器中心"改成"这张新牌自己的 DOM 元素"。
    const existingLines = document.getElementById('targetLines');
    if(existingLines) existingLines.remove(); // 连续快速出牌:先清掉上一批还没淡出的连线
    if(Array.isArray(last.targets) && last.targets.length>0){
      const newestCardEl2 = el.lastElementChild;
      const seatsEl2 = document.getElementById('game');
      if(newestCardEl2 && seatsEl2){
        try{
          const containerRect = seatsEl2.getBoundingClientRect();
          const toRect = newestCardEl2.getBoundingClientRect();
          const fromX = toRect.left - containerRect.left + toRect.width/2;
          const fromY = toRect.top - containerRect.top + toRect.height/2;
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.id = 'targetLines';
          svg.setAttribute('class', 'target-lines');
          svg.setAttribute('width', containerRect.width);
          svg.setAttribute('height', containerRect.height);
          let anyLine = false;
          last.targets.forEach(t=>{
            const targetEl = document.querySelector('.seat[data-seat="'+t+'"]');
            if(!targetEl) return;
            const tRect = targetEl.getBoundingClientRect();
            const tx = tRect.left - containerRect.left + tRect.width/2;
            const ty = tRect.top - containerRect.top + tRect.height/2;
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', fromX); line.setAttribute('y1', fromY);
            line.setAttribute('x2', tx); line.setAttribute('y2', ty);
            line.setAttribute('class', 'target-line');
            svg.appendChild(line);
            anyLine = true;
          });
          if(anyLine){
            seatsEl2.appendChild(svg);
            setTimeout(()=>{ if(svg.parentNode) svg.remove(); }, 2600); // 和淡出节奏(2.6s)一致
          }
        }catch(e){
          // 坐标计算出任何异常(理论上不该发生,但连线是装饰层,宁可静默跳过也不能抛出影响主渲染)
          const stray = document.getElementById('targetLines');
          if(stray) stray.remove();
        }
      }
    }
  }
  // 淡出触发:和上面"有没有新牌"完全独立判断——链结束(idle)这件事既可能和新牌加入同一刻
  // 发生(无需响应的单次出牌,一push完pending就已经是空的,这一分支和上面的hasNewEntry分支
  // 会在同一次调用里都触发,效果上和原来的单槽位模式完全一样),也可能单独发生(决斗打了
  // 几个回合后认输,"新牌加入"在中途已经各自触发过,认输这一刻没有新牌但链结束了)。
  if(idle){
    if(lastFadedBatchSeq !== last.seq){
      lastFadedBatchSeq = last.seq;
      // CORE-122(issue #154)方向2:这条链即将淡出的这一刻,存一份文字摘要副本进本地历史
      // 记忆(list此刻就是这条链打出的全部牌,和下面淡出动画读的是同一份数据)。纯新增
      // 这一行,不影响下面原有的淡出动画逻辑一个字。
      pushRecentPlayHistory(g, list);
      // 和 #logToast 同款"淡入-停留-淡出"手法:先移除 .show 强制回流,再加回去,保证 CSS
      // 动画每次都从头重新播放。这一刻数组里已经包含了这条链打出的全部牌,不会出现"最后
      // 一张牌被瞬间清空来不及看清"的问题(清空数据是等下一条链开始时才会发生的完全独立的
      // 另一件事,见 pruneExchangeCards)。
      //
      // 移除 exchange-mode 这一行不是为了控制布局(布局现在完全交给 index.html 里的
      // .table-card:has(.exchange-card + .exchange-card) 选择器,只看子元素数量,和这里
      // 加不加/删不删 class 完全无关——这正是这次要修的 bug 本身:hasNewEntry 和 idle 可能
      // 在同一次调用里同时触发,原来布局属性挂在 exchange-mode 上、被这里的 idle 分支同一
      // 时刻移除,会导致横排布局在还没来得及展示出来之前就被打回竖排,多张牌一起以竖排淡出)。
      // 保留这行是因为 animation 属性本身有真实的优先级冲突:.exchange-mode{animation:none}
      // 和 .show{animation:tableCardFade...} 选择器优先级相同,源码顺序 exchange-mode 在
      // show 后面,如果不移除、两个 class 同时挂着,exchange-mode 的 animation:none 会赢过
      // show,淡出动画整个放不出来——这是逐一核对两条 CSS 规则属性后确认的真实冲突,不是
      // "习惯性互斥、图省事",所以只对 exchange-mode 保留互斥移除,不对布局做任何特殊处理。
      el.classList.remove('exchange-mode');
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
  } else {
    // 链还在进行:保持静态横排展示,不触发淡出动画。每次调用都重新确认这个 class 组合,
    // 即使这次没有新牌加入也无副作用(classList 操作本身是幂等的)。
    el.classList.add('exchange-mode');
    el.classList.remove('show');
  }
}
