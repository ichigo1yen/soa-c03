# 学習クイズサイト（静的サイト）

4〜6択の単一・複数選択問題を、問題データ（JSON）とサイト本体（HTML/CSS/JS）を分離した形で
出題する学習サイトです。サーバーサイド処理は一切なく、**静的ファイルのみ**で完結するため、

## 特徴

- 問題は **JSON ファイル** に保存（`data/*.json`）。1ファイル最大20問を目安に分割。
- 各問題には正解の選択肢に「正解」マークが仕込んであり、初期状態では**非表示**。
  問題ごとの「解答を表示」ボタン、または画面上部の「すべての解答を表示」ボタンで
  **表示・非表示をトグル**できます。
- 単一選択（ラジオボタン）・複数選択（チェックボックス）の両方に対応（`type: "single" / "multiple"`）。
- 回答した選択肢と正誤、解答表示状態は `localStorage` に保存され、次回訪問時も復元されます
  （サーバー不要・完全にブラウザ内で完結）。
- セット一覧ページ（`index.html`）に各セットの回答済み件数を進捗バーで表示。
- 200問程度・10セット規模を想定した前後セットへのナビゲーション付き。

## フォルダ構成

```
quiz-site/
├── index.html            セット一覧ページ（トップページ）
├── quiz.html              1セット分（最大20問）を表示するクイズページ
├── assets/
│   ├── style.css          スタイル
│   ├── index.js           index.html 用スクリプト
│   └── quiz.js            quiz.html 用スクリプト（出題・採点・解答表示トグル）
├── data/
│   ├── manifest.json      セット一覧の定義（自動生成・更新される）
│   └── 101-110.json       問題セットのサンプル（添付いただいたHTMLから変換したもの）
└── tools/
    └── convert_htm_to_json.py   exam-topics形式の.htmを問題JSONに変換するスクリプト
```

## 問題データの形式（JSON）

`data/xxx.json`:

```json
{
  "title": "AWS 認定機械学習 MLS-C01 問題 101-110",
  "questions": [
    {
      "id": "101",
      "text": "問題文...",
      "type": "single",          // "single" または "multiple"
      "choices": [
        { "letter": "A", "text": "選択肢A" },
        { "letter": "B", "text": "選択肢B" },
        { "letter": "C", "text": "選択肢C" },
        { "letter": "D", "text": "選択肢D" }
      ],
      "correct": ["A"]           // 複数選択なら ["A", "C"] のように複数指定
    }
  ]
}
```

`data/manifest.json`（セット一覧。index.html / quiz.html のナビゲーションに使用）:

```json
{
  "sets": [
    { "id": "101-110", "file": "101-110.json", "title": "…問題 101-110", "count": 10 }
  ]
}
```

## 新しい問題セットの追加方法

### A. 添付いただいたような exam-topics 形式の .htm ファイルがある場合

`tools/convert_htm_to_json.py` で自動変換できます（要 Python 3 + BeautifulSoup4）。

```bash
pip install beautifulsoup4
cd tools
python3 convert_htm_to_json.py path/to/*.htm --out-dir ../data --chunk-size 20 \
  --title-prefix "AWS 認定機械学習 MLS-C01"
```

- `--chunk-size 20` … 1 JSON ファイルあたりの最大問題数（デフォルト20）。
- 質問番号でソートしたうえで20問ずつ自動分割し、`data/xxx-yyy.json` を生成します。
- `data/manifest.json` も自動で追記・更新されます（既存セットは重複追加されません）。
- 正解が2文字以上検出された問題は自動的に複数選択（`type: "multiple"`）として扱われます。
- 正解を検出できなかった問題はスキップされ、警告が表示されます（手動確認してください）。

exam-topics系サイトのHTML構造はバージョンによって異なるため、正解の検出は以下の順で試行します（いずれか1つでも見つかれば採用）。

1. 旧形式: `<span class="correct-answer">A</span>`（Suggested Answer ボックス）
2. 新形式: 正解の選択肢の `<li>` に付与される `class="...correct-hidden"`
3. 新形式のフォールバック: 問題内の `<script type="application/json">` に含まれる `voted_answers`（最多投票の解答）

どちらの形式のHTMLが混在していても同じコマンドで変換できます。

複数の .htm をまとめて1回で変換する場合は、そのままワイルドカードで渡してください
（問題番号順に結合してから20問ずつに再分割されます）。

### B. JSON を直接手動で用意する場合

上記の JSON 形式に沿ってファイルを作成し、`data/manifest.json` の `sets` 配列に
`{ "id", "file", "title", "count" }` を追記してください。

## ローカルでの動作確認

ブラウザの `fetch()` で `data/*.json` を読み込むため、`file://` では動作しません（CORS制限）。
簡易HTTPサーバーで確認してください。

```bash
cd quiz-site
python3 -m http.server 8000
# ブラウザで http://localhost:8000/index.html を開く
```


## 補足・カスタマイズしやすいポイント

- 1ファイルあたりの問題数上限（20問）は変換スクリプトの `--chunk-size` で変更可能です。
- 配色・フォントは `assets/style.css` の `:root` 変数（`--paper`, `--accent` など）で一括調整できます。
- 正誤判定や進捗保存は `localStorage` のみに依存しており、バックエンド／ログイン機能はありません。
  複数端末での進捗共有が必要な場合は別途バックエンドの追加が必要です。
