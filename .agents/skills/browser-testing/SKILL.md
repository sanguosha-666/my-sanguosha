---
name: sanguosha-browser-testing
description: Run focused browser gameplay checks for the static sanguosha app, including explicitly authorized local state scenarios when Firebase access is unavailable.
---

# 三国殺ブラウザ検証

## 起動
- ビルドや依存インストールは不要。リポジトリルートで `python3 -m http.server 8000 --bind 127.0.0.1` を起動し、Chromeで `http://127.0.0.1:8000/index.html` を開く。
- 通常プレイはFirebase房間参加→bot追加→開始。静的配信だけで完全オフライン対局が始まるわけではない。
- 必ず専用房間名を使う。`permission_denied` が表示される場合は、実同期の検証を未実施として明記する。

## 許可された状態作成
- ユーザーがスクリプトによる再現を許可した場合のみ使用する。実対局・実同期の証拠と混同しない。
- `test-tx-stub.js` のスナップショット分離方式を参考に、`gameRef.transaction` をローカル状態のclone→updater→commit→renderに置換する。既存 `tx()` と技能・UIハンドラーは維持する。
- Promiseとsnapshot.val()の返却も実装すると、botのコミット後継続処理を試せる。renderはupdaterが終了してから実行する。
- 外部状態の更新を避けるため、gameRef/chatQueryの購読を解除してからローカルアダプターを割り当てる。
- `render()` はプレイヤーのcidとmyClientIdからmySeatを再決定する。別席視点で応答UIを試すときは、テスト状態のcid割当も対応させる。
- `normalize()`・`buildDeck()`・`getGeneral()` で実データ形式に合わせる。カードのsuitは `♥` / `♦` / `♠` / `♣`、装備スロットはweapon/armor/plus1/minus1。
- 応答にはタイムアウトがある。撮影中に自動応答した場合は手動操作の証拠にせず、状態を初期化して再実行する。

## 証拠
- 実UIのクリックで技能・カード・対象選択を行い、HP・手札・装備・pending・phaseを実状態から読み戻す。
- 画面の状態を主証拠とし、表示のないbot候補は実候補列挙の返却値を補助証拠とする。
- 「结束出牌」のあと「结束回合」が必要な場合がある。botの出牌と、次の人間ターンへの復帰まで確認する。
- 限定した再現経路だけを検証した場合、同じヘルパーを呼ぶ全技能を検証したとは扱わない。

## Devin Secrets Needed
- ローカル静的配信・許可されたローカル状態作成には不要。
- Firebase実同期のアクセスは環境依存。権限拒否時はリポジトリのGitHubトークンを代用品として使わない。
