# South Park 日本語字幕 (Chrome拡張)

southparkstudios.com の公式エピソードページに日本語字幕を表示するサイト特化Chrome拡張。
英語字幕(公式WebVTT)を **Chrome内蔵 Translator API**(オンデバイス・完全無料)で翻訳して重ねる。

## インストール

1. Chrome で `chrome://extensions` を開く
2. 右上「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択
4. 初回のみ: 拡張アイコン → **モデルをダウンロード**(英→日翻訳モデル、1回だけ)
5. https://www.southparkstudios.com のエピソードページを開いて再生

## 機能

### 字幕
- 日本語のみ / 英語のみ / 英日両方 / オフ を切替(popupまたは動画上のチップ)
- 翻訳はオンデバイス(Gemini Nano)。エピソード単位でキャッシュされ、再視聴時は即表示
- 広告(DAI)区間は字幕なし(公式データに追従)
- フォントサイズ・背景帯の濃さを調整可

### 学習モード
- 英語主役の二段表示+未知語(頻出上位1000語以外)に点線ハイライト
- **単語ホバーで辞書ポップアップ**: カタカナ読み+IPA+日本語の意味+原形(EJDict-hand / CMUdict 同梱・全オフライン)
- 単語クリックで「知ってる」登録 → 以後ハイライト対象外
- 引いた単語は自動で**単語帳**に記録(popup→単語帳タブ、CSVエクスポート可)
- オートポーズ: 毎セリフ / 未知語を含むセリフのみ
- 字幕ホバーで一時停止・日本語ぼかしモード

### ショートカット(動画上で)
| キー | 動作 |
|---|---|
| `←` | このセリフをリプレイ(学習モード時) |
| `A` / `D` | 前のセリフ / 次のセリフ |
| `S` | オートポーズ切替 |
| `T` | セリフ一覧ドロワー(クリックでジャンプ) |
| `?` | ショートカット一覧 |

## 仕組み

- プレーヤーの `textTrack`(公式英語字幕)を `mode='hidden'` で強制ロードし cue を収集(サイトが `showing` に戻すのを常時抑止)
- cue を再生位置優先でバッチ翻訳 → `chrome.storage.local` にエピソード単位キャッシュ
- Translator API がページ内で使えない場合は offscreen document に自動フォールバック
- 翻訳を DeepL 等へ差し替える場合は `src/translator.js` の `translateBatch` のみ変更

## データソース

- [EJDict-hand](https://github.com/kujirahand/EJDict) — 英和辞書(パブリックドメイン)
- [CMUdict](https://github.com/cmusphinx/cmudict) — 発音辞書(BSD)
- [google-10000-english](https://github.com/first20hours/google-10000-english) — 頻度リスト

個人利用のローカル拡張。ストア公開はしない。
