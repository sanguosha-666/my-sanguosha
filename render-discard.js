// render-discard.js — 公开弃牌的中央桌面展示。
// 只观察已经写入 discard 的结果，不介入选牌和游戏结算；首次进入房间时仅建立基准，
// 不补播历史弃牌。使用/打出的牌已有中央出牌动画，按实体牌 id 过滤，避免重复展示。

const DISCARD_REVEAL_BASE_MS = 1200;
const DISCARD_REVEAL_PER_CARD_MS = 300;
const DISCARD_REVEAL_MAX_MS = 4000;

let lastObservedDiscardKeys = null;
let discardRevealQueue = [];
let discardRevealPlaying = false;

function discardRevealCardKey(card, index){
  if(card && card.id!=null) return 'id:'+card.id;
  return 'card:'+index+':'+(card&&card.name||'')+':'+(card&&card.suit||'')+':'+(card&&card.rank||'');
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
  const discard=Array.isArray(g&&g.discard)?g.discard:[];
  const keys=discard.map(discardRevealCardKey);
  if(lastObservedDiscardKeys===null){
    lastObservedDiscardKeys=keys;
    return;
  }
  const prefixIntact=lastObservedDiscardKeys.length<=keys.length &&
    lastObservedDiscardKeys.every((key,i)=>key===keys[i]);
  if(!prefixIntact){
    // 洗牌、重开或断线恢复到不同快照：重新建立基准，不把历史牌误当成刚弃置。
    lastObservedDiscardKeys=keys;
    return;
  }
  const added=discard.slice(lastObservedDiscardKeys.length);
  lastObservedDiscardKeys=keys;
  if(added.length===0) return;
  const exchangeIds=new Set((Array.isArray(g.exchangeCards)?g.exchangeCards:[])
    .map(entry=>entry&&entry.card&&entry.card.id).filter(id=>id!=null));
  const reveal=added.filter(card=>!card || card.id==null || !exchangeIds.has(card.id));
  if(reveal.length===0) return;
  discardRevealQueue.push({cards:reveal,duration:discardRevealDuration(reveal.length)});
  playNextDiscardReveal();
}
