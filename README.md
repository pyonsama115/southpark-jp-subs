# South Park 日本語字幕 (Chrome拡張)

[southparkstudios.com](https://www.southparkstudios.com) の公式エピソードページに**日本語字幕**を表示するサイト特化のChrome拡張(Manifest V3)。

公式の英語字幕(WebVTT)を **Chrome内蔵 Translator API**(オンデバイス・完全無料)で正確な基本訳にし、解説用に導入した **Gemini Nano** が利用できる場合は、その意味を基準に前後の会話・話者・キャラクターの口調を考慮した自然な字幕へ編集する。Nanoが固有名詞・数字・否定を壊した場合は基本訳を維持する。さらに単語ホバー辞書・AI文法解説・オートポーズなどの**英語学習モード**を搭載。外部サーバーには一切データを送らない(Gemini APIキーを任意設定した場合の解説機能のみ例外)。

---

## 動作要件

| 項目 | 要件 |
|---|---|
| ブラウザ | Chrome 138以上(Translator API必須。確認: `chrome://version`) |
| 翻訳モデル | 初回に英→日モデルを1回ダウンロード(拡張popupから) |
| AI自然訳(任意) | 日本語Prompt API対応のChrome 149以上を推奨。解説と同じGemini Nanoモデル資産を利用し、未準備・非対応・失敗時は基本訳を維持(セッションは分離) |
| AI解説(任意) | オンデバイス版はGemini Nano(ディスク空き約22GB必要)。無い場合はGemini APIキー(無料枠)で代替 |
| 対象サイト | `https://www.southparkstudios.com/*` のみ |

## インストール

1. このリポジトリをclone(またはZIPダウンロード)
   ```bash
   git clone git@github.com:pyonsama115/southpark-jp-subs.git
   ```
2. Chromeで `chrome://extensions` を開く
3. 右上「**デベロッパーモード**」をON
4. 「**パッケージ化されていない拡張機能を読み込む**」→ このフォルダを選択
5. 拡張アイコン(ツールバーの「字」)→ **モデルをダウンロード**(初回のみ・英→日翻訳モデル)
6. AI自然訳も使う場合はpopup→ **AIモデルを準備**(解説から導入済みなら再ダウンロード不要。同じモデル資産を利用)
7. エピソードページを開いて再生 → 基本訳を即表示し、品質検査に合格したAI自然訳だけへ自動差し替え

> ⚠️ **拡張を更新(リロード)したら、開いているエピソードページも必ず再読み込み(⌘R)すること。** 古いcontent scriptがページに残り、設定変更が効かない・ホバーが死ぬ等の不可解な挙動になる。

---

## 機能

### 表示モード(1ボタンで巡回)

動画上のコントロールチップ先頭ボタン、または拡張popupで切替:

| モード | チップ表示 | 内容 |
|---|---|---|
| **学習** | `学` | 英語(主役・大)+日本語(補助)の二段+単語ホバー辞書+未知語ハイライト |
| **日本語のみ** | `あ` | 日本語字幕だけ(普通に視聴する用) |
| **英語のみ** | `A` | 英語字幕だけ |
| **オフ** | `無` | 字幕非表示 |

### 字幕表示

- 翻訳はセリフ単位でオンデバイス実行。**エピソード単位でキャッシュ**され、シーク・再視聴・リロード時は即表示(再翻訳ゼロ)
- 翻訳が間に合わないセリフは英語のまま表示 → 翻訳完了で自動差し替え
- **AI自然訳**: Translator APIの基本訳を意味参照として、再生中の1セリフをGemini Nanoで先に編集した後、未来の最大5セリフを前後文脈付きで自然訳へ差し替え
  - WebVTTの`<v Speaker>`と既知の話者ラベルを保持し、明示話者だけキャラクター台帳の一人称・語尾・呼称を適用
  - スタン、カイル、カートマン、ケニー、バターズ等の子供に加え、両親・兄弟・教師まで収録
  - 例: カートマンは「オイラ」、リアンは平常時カートマンを「エリックちゃん」、マッケイ先生の原文`m’kay`は「ンケーイ」
  - 子供・友達同士は常体を既定とし、文中・行末の呼びかけ名→直前話者→直後話者の順で相手候補を渡す。バターズも同年代には柔らかい常体、大人には丁寧語を使い分ける
  - 友達同士の会話でNanoが不自然な「です・ます」を返した時だけ、15秒以内の短い文体修正を1回実行。芝居・公的発言・怯えた懇願の意図的な丁寧語は残す
  - 話者不明時は人物を断定せず、普通の会話では簡潔な常体へフォールバック
  - 基本訳は固有名詞・否定・数字・行為者・目的語の意味確認に使い、敬語・語尾・一人称・語順はコピー禁止。英語原文を最終根拠にする
  - 原文に実在する語だけを動的用語集へ入れ、`Kyle→カイル`、`South Park→サウスパーク`などを追加推論なしで固定。既知の「ケイル」「南パーク」も自動補正し、同じ語が複数回出た時は出現数まで照合
  - Nanoが必須固有名詞を落とした、数字を変えた、明確な否定を反転した場合は、AI訳で上書きせず正規化済み基本訳へ戻す
  - モデルを先に準備し、バッチ間待機と全件一律の2回目AI短縮処理をなくして初回結果を優先表示。シーク時は旧位置のTranslator/Nano処理を中断。タイムアウト時はバッチを縮小し、失敗は指数バックオフ。3回失敗後は安全な基本訳を記録して再読込時の再推論を防ぐ
  - 1秒4文字・1行13全角相当・最大2行を目安に圧縮し、罵倒・皮肉・差別表現を勝手に弱めない
- 英語字幕は言語判定を待たず先に英→日翻訳し、その結果が原文コピー・日本語なしの時だけ、混在する**外国語セリフ(独語等)を自動判定**して該当ペア(de→ja等)で再翻訳
- WebVTT装飾タグ(`<i>`等)は自動除去
- 広告(DAI)区間は字幕なし(公式データに追従)
- フォントはプレーヤー幅に自動追従(フルスクリーンで拡大)。サイズ(小/中/大)・背景帯の濃さはpopupで調整可

### 学習モード

- **単語ホバー辞書**: 英単語にマウスを乗せると、その単語の直上にカードを表示
  - **カタカナ読み**(priest → プリースト)+ **IPA発音記号**(/priːst/)
  - 日本語の意味(最大4義)・原形(running → run)
  - 頻出度バッジ: `基礎`(頻度上位1000語)/ `頻出`(上位3000語)
  - ホバー中は自動一時停止(popupでOFF可)
  - 全データ同梱・完全オフラインなので表示は即時
- **単語クリック → 「知ってる」登録**: 以後その単語はハイライト対象外(自分専用に育つ字幕)
- **未知語ハイライト**: 基礎語でも既知語でもない単語に点線下線
- **自動単語帳**: 辞書を引いた単語は自動記録(popup→単語帳タブ)。出現セリフ・エピソード付き。CSVエクスポート可
- **AI解説(「解説」ボタン / Eキー)**: いま流れているセリフの「意味の塊(句動詞・イディオム・口語表現)」と文法ポイントを日本語で解説
  - 優先順: ①オンデバイスGemini Nano(無料・要ディスク約22GB)→ ②Gemini API `gemini-2.5-flash-lite`(popupでキー設定時。無料枠あり: https://aistudio.google.com/apikey )
  - 直前のセリフも文脈として渡す。結果はセリフ単位でキャッシュ。解説ごとに履歴のないsessionをcloneし、閉じる・再実行・60秒timeoutで確実にcancel
- **オートポーズ**(`S`キーで巡回): オフ → 毎セリフ → **未知語のみ**(知らない単語を含むセリフだけ止まる)
- **日本語ぼかし**(popup): 訳をぼかして表示し、ホバーで見える(まず英語で理解に挑戦する用)

### セリフ一覧ドロワー(`T`キー / チップ`≡`)

- 全セリフを時刻+英日併記でリスト表示、現在行をハイライト
- クリックでそのセリフへジャンプ
- **展開中は動画が左に自動縮小**して一覧と被らない(字幕位置も追従)。✕ボタン/`T`/`Esc`で閉じると元に戻る

### キーボードショートカット

| キー | 動作 |
|---|---|
| `←` | このセリフの頭からリプレイ(学習モード時。視聴モードではサイト標準の10秒戻し) |
| `A` / `D` | 前のセリフ / 次のセリフへジャンプ |
| `S` | オートポーズ切替(オフ→毎セリフ→未知語のみ) |
| `E` | いまのセリフをAI解説 |
| `T` | セリフ一覧の開閉 |
| `?` | ショートカット一覧 |
| `Esc` | パネル類を閉じる |

### 動画上のコントロールチップ

プレーヤー上でマウスを動かすと右上に表示(`学/あ/A/無` `解` `⏸` `↻` `≡` `?`)。**2.5秒操作が無ければ自動で消える**(全画面でも邪魔にならない)。拡張アイコンを開かなくても全操作が動画上で完結する。

---

## 仕組み(技術)

```
公式プレーヤー(hls.js + MSE)
  └ video.textTracks に公式英語字幕(WebVTT)が存在
      └ 拡張が track.mode='hidden' を強制維持
          → hls.jsが字幕セグメントを自動ロード(見えないままcueが溜まる)
          → cueの時刻は広告(DAI)込みタイムラインに補正済み
              → m3u8解析・認証トークン・広告オフセット計算が一切不要
cue収集(800msポーリング)
  → 現在→未来→過去の順に1件ずつ基本翻訳(Translator API)
      → 1件完成するたび即表示し、残りを待たずNano編集を開始
  → 英語＋意味参照訳＋関連用語集をGemini Nanoへ渡し、現在の1件→未来の最大5件を文脈付き編集
      → 固有名詞・数字・否定・構造・長さ検査OKなら差し替え
      → 意味劣化・拒否・誤形式・タイムアウト時は基本訳を維持
  → chrome.storage.local にエピソード単位キャッシュ
  → 自前オーバーレイ(video親要素内)に描画
```

設計上の要点(ハマりどころ):

- **サイトはtrack.modeを`showing`に戻してくる** → 常時`hidden`へ戻し続ける(ネイティブ字幕の二重表示防止とcueロード維持の両立)
- **英語行のDOMはcue切替時のみ再構築**。翻訳到着のたびに単語spanを作り直すとホバー中の辞書処理が中断する(過去に実際に起きたバグ)
- **cueテキストはVTTタグ除去必須**(`<i>`が翻訳に混入する)
- **`<v Speaker>`はタグ除去前に保存**。`VTTCue.getCueAsHTML()`の`span[title]`を優先し、raw VTT解析をフォールバックにする
- Gemini Nanoの自然訳は**解説セッションを共用しない**。同じモデル資産から翻訳専用base sessionを作り、バッチごとにclone/destroyする
- Translator APIは1件ずつ結果を公開する。Nanoは基本訳を意味のアンカーとして受け取り、現在→未来を優先。通常は1回目の有効訳をそのまま表示し、高信頼な友達敬語違反だけ短い文体修正を行う
- シーク・設定OFF・ページ遷移時はTranslator APIと自然訳workerの両方へAbortSignalを渡して旧処理を止める。逐次実行のTranslatorキューへtimeout済み処理を残さず、45秒のNano timeoutはユーザーcancelと区別し、低速端末では5→3→2→1件へ自動縮小する
- AI自然訳キャッシュは`tr-ai:<episode>`へ基本訳と分離し、原文・基本訳・プロンプト・用語集/キャラ台帳の版が変わると自動無効化する。品質フォールバック済みも記録し、同じ失敗を繰り返さない
- **ボタンはクリック後にblur()** — フォーカスが残るとスペースキーが「ボタン再押下」になり再生/停止を奪う
- チップ等のホバーUI表示判定は**documentレベルのmousemove**で行う(コンテナ直付けはサイトUIのレイヤに食われる)
- Translator APIがページ内で使えない環境では**offscreen documentへ自動フォールバック**(background.js経由)
- SPA遷移(エピソード切替)はURL監視で検知して状態リセット

### ファイル構成

```
southpark-jp-subs/
├── manifest.json        # MV3。permissions: storage, offscreen のみ
├── background.js        # offscreenフォールバックの中継
├── offscreen.html/js    # Translator API実行係(フォールバック用)
├── src/
│   ├── common.js        # 設定管理・storage抽象化・ユーティリティ
│   ├── lemma.js         # 英単語の原形化(ルール+不規則テーブル)
│   ├── kana.js          # ARPAbet発音 → カタカナ読み+IPA変換
│   ├── dict.js          # 辞書3種の遅延ロードと検索
│   ├── translator.js    # 翻訳レイヤ(内蔵API+言語判定+offscreen委譲)
│   ├── characters.js    # 話者抽出+キャラクター口調/呼称台帳
│   ├── natural-translator.js # Gemini Nano文脈付き自然訳+構造/字幕長検査
│   ├── content.js       # 本体(cue収集・翻訳キュー・オーバーレイ・学習UI)
│   └── overlay.css      # オーバーレイ全UIのスタイル
├── popup/               # 設定UI+単語帳
├── data/
│   ├── ejdict.txt       # 英和辞書 約4.6万語(5MB)
│   ├── cmudict.dict     # 発音辞書 約13.5万語(3.5MB)
│   └── freq10k.txt      # 頻度上位1万語
└── icons/
```

### 翻訳エンジンの差し替え

DeepL API等に変えたい場合は `src/translator.js` の `translateBatch(texts) -> Promise<string[]>` だけ差し替えればよい(呼び出し側は翻訳の実装を知らない)。

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| 字幕が出ない | ①拡張popupで翻訳モデルが「✓導入済み」か確認 ②ページを再読み込み ③popupのモードが「オフ」になっていないか |
| 拡張更新後に挙動がおかしい | **ページを再読み込み**(古いcontent scriptが残るため) |
| 「(翻訳中…)」のまま進まない | popup→モデルをダウンロード。Chrome 138未満なら更新 |
| AI解説が「オンデバイスAIが使えません」 | Gemini Nanoにディスク空き約22GBが必要。無理ならpopupにGemini APIキー(無料枠)を設定 |
| AI自然訳へ切り替わらない | ①popupの「AI自然訳」をON ②AIモデル状態を確認 ③Chrome 149以上へ更新。非対応・拒否・長さ超過時は安全に基本訳を維持 |
| AI自然訳が遅い | 初回だけモデル準備が必要。以後は現在1件を先行する。拡張更新後は拡張とエピソードページの両方を再読み込みし、古いcontent scriptと訳キャッシュを更新する |
| 翻訳の質が物足りない | AI自然訳はローカル小型モデルのためプロ品質を保証するものではない。基本訳を残しつつ、キャラ台帳・文脈・字幕長検査で品質を高めている |
| 字幕がズレる/出ない区間がある | 広告区間は公式データ上字幕なし(正常)。エピソード頭のリキャップも無いことがある |

## データソースとライセンス

| データ | 用途 | ライセンス |
|---|---|---|
| [EJDict-hand](https://github.com/kujirahand/EJDict) | 英和辞書 | パブリックドメイン |
| [CMUdict](https://github.com/cmusphinx/cmudict) | 発音(ARPAbet) | BSD |
| [google-10000-english](https://github.com/first20hours/google-10000-english) | 頻度リスト | リポジトリ記載の条件 |

## 開発メモ

- 実機検証は chrome-devtools MCP で実ページにバンドルを注入して行った(`window.__SPJS_TEST_BASE` にローカルHTTPサーバを指定すると拡張なしで動作確認できる)
- 構文チェック: `for f in src/*.js background.js offscreen.js popup/popup.js; do node --check "$f"; done`
- ロジックテスト: `node --test tests/*.test.js`

### AI自然訳の調査基準

- [Netflix Japanese Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215767517-Japanese-Timed-Text-Style-Guide): 1行13全角相当、最大2行、最大4文字/秒、原文のトーンと罵倒を維持
- [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api) / [モデル管理](https://developer.chrome.com/docs/ai/understand-built-in-model-management): LanguageModelの言語能力判定、structured output、セッション分離、端末要件
- [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api): 翻訳専用モデルを意味精度の基準として使い、汎用Prompt APIはキャラ口調の字幕編集に限定
- [South Park Studios公式キャラクター一覧](https://southpark.cc.com/w/index.php?title=List_of_Characters): 英語名・関係性・設定を確認する参照入口
- [日本向け公式リリース](https://prtimes.jp/main/html/rd/p/000000221.000002319.html): 作品名「サウスパーク」と主要人物「カートマン、ケニー、カイル、スタン」の日本語表記を固定
- 親・教職員の訳調は公式人物資料と公式クリップで個別確認: [Randy](https://southpark.cc.com/w/index.php/Randy)、[Sharon](https://southpark.cc.com/w/index.php/Sharon_Marsh)、[Gerald](https://southpark.cc.com/w/index.php/Gerald_Broflovski)、[Sheila](https://southpark.cc.com/w/index.php/Sheila_Broflovski)、[Garrison](https://southpark.cc.com/w/index.php?title=Mr._Garrison)、[PC Principal](https://southpark.cc.com/w/index.php?title=PC_Principal)、[Victoria](https://southpark.cc.com/w/index.php?title=Principal_Victoria)、[Chef](https://southpark.cc.com/w/index.php/Chef)
- **日本公式で確認済み**: カートマンの一人称「オイラ」は[Viacom Japanの25周年資料](https://prtimes.jp/a/?c=23241&f=d23241-262-06da7026ba8adb2e05078eeaa5a42158.pdf&r=262)で確認
- **非公式の公開訳例**: リアンの「エリックちゃん」は[公開されている日本語訳例](https://yamashita621.blog.fc2.com/blog-entry-236.html)にあるが、公式台本ではないため確定公式訳とは扱わない
- **この拡張のhouse style**: ユーザー指定を優先して「エリックちゃん」を採用し、「ンケーイ」や各人物の一人称を同一ルールで統一。台帳内の英日訳調例は公式日本語字幕の転載ではなく、公式の英語人物像を基に本拡張用に作った短い例。確認できない呼称は話者不明時に捏造しない

## 注意

- 個人利用のローカル拡張。Chrome Web Storeへの公開・再配布は想定していない
- southparkstudios.com のページ構造・プレーヤー仕様の変更で動かなくなる可能性がある(2026-07時点で動作確認)
