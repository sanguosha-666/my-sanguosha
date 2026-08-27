// render-discard.js — 公开弃牌的中央桌面展示。
// 只监听业务入口显式产生的 discardRevealEvents，不再根据整个 discard 数组猜测移动原因。
// 首次进入房间时仅建立 seq 基准，不补播历史事件。

const DISCARD_REVEAL_BASE_MS = 1200;
const DISCARD_REVEAL_PER_CARD_MS = 300;
const DISCARD_REVEAL_MAX_MS = 4000;

let lastObservedDiscardRevealSeq = null;
let discardRevealQueue = [];
let discardRevealPlaying = false;

// CORE-174:弃牌展示哨兵/队列是模块级状态,跨局不清会残留 #discardReveal 或误播旧事件。
function resetDiscardReveal(){
  lastObservedDiscardRevealSeq = null;
  discardRevealQueue = [];
  discardRevealPlaying = false;
  if(typeof document === 'undefined') return;
  const el = document.getElementById('discardReveal');
  if(el){
    el.classList.remove('show');
    el.innerHTML = '';
  }
}

function discardRevealDuration(cardCount){
  return Math.min(DISCARD_REVEAL_MAX_MS,
    DISCARD_REVEAL_BASE_MS + Math.max(1,cardCount)*DISCARD_REVEAL_PER_CARD_MS);
}

function playNextDiscardReveal(){
  if(discardRevealPlaying || discardRevealQueue.length===0) return;
  const el=document.getElementById('discardReveal');
  if(!el){ discardRevealQueue=[]; return; }
  const batch=discardRevealQueue.shift();
  discardRevealPlaying=true;
  el.innerHTML='<div class="discard-reveal-title">弃置</div><div class="discard-reveal-cards">'
    +batch.cards.map(card=>'<div class="discard-reveal-card"><div class="table-card-name">'
      +escapeHtml(card.name||'牌')+'</div>'+tableCardFaceHtml(card)+'</div>').join('')+'</div>';
  el.classList.remove('show');
  void el.offsetWidth;
  el.style.setProperty('--discard-reveal-ms',batch.duration+'ms');
  el.classList.add('show');
  setTimeout(()=>{
    el.classList.remove('show');
    el.innerHTML='';
    discardRevealPlaying=false;
    playNextDiscardReveal();
  },batch.duration);
}

function observeDiscardReveal(g){
  const events=Array.isArray(g&&g.discardRevealEvents)?g.discardRevealEvents
    .filter(event=>event&&Number.isInteger(event.seq)&&Array.isArray(event.cards)) : [];
  const latestSeq=events.reduce((max,event)=>Math.max(max,event.seq),0);
  if(lastObservedDiscardRevealSeq===null){
    lastObservedDiscardRevealSeq=latestSeq;
    return;
  }
  if(latestSeq<lastObservedDiscardRevealSeq){
    // 重开或恢复到更早快照：重新建立基准，不补播历史事件。
    lastObservedDiscardRevealSeq=latestSeq;
    return;
  }
  const added=events.filter(event=>event.seq>lastObservedDiscardRevealSeq).sort((a,b)=>a.seq-b.seq);
  lastObservedDiscardRevealSeq=latestSeq;
  added.forEach(event=>{
    if(event.cards.length) discardRevealQueue.push({cards:event.cards,duration:discardRevealDuration(event.cards.length)});
  });
  playNextDiscardReveal();
}
