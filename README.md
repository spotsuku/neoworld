# NEO 2050 社会シミュレーター

「余白理論」に基づく2050年日本の社会シミュレーター Webアプリ版。
Vite + React 18 + Tailwind CSS v4 で構築し、Anthropic API へのアクセスは
Vercel サーバーレス関数(`api/claude.js`)経由でプロキシする(APIキーはブラウザに露出しない)。

## セットアップ

```bash
npm install
```

## ローカル開発

AI生成を使う場合は `ANTHROPIC_API_KEY` を設定して `vercel dev` で起動する
(`/api/claude` のサーバーレス関数を含めて動作する):

```bash
cp .env.example .env   # ANTHROPIC_API_KEY を記入
vercel dev
```

キー未設定でもアプリは動作する(AI呼び出し失敗時は簡易フォールバックエンジンに自動切替)。
UIだけ確認するなら `npm run dev` でも起動できる(この場合 `/api/claude` は無いので常に簡易エンジン)。

## エンジンの動作確認

UI から分離した純関数エンジン(`src/engine/`)の初期値検証:

```bash
npm run verify:engine
```

- 初期人口50人
- 資産ジニ ≈ 0.6
- S2(資本主義×ロボ)の収入ジニ ≈ 0.58
- S3(応援×ロボ)の就労16人・初期幸福 ≈ 40

## シミュレーション記録の保存(Supabase)

「💾 保存」でシミュレーション全状態(住民・年代記・指標・施行ルール等)をSupabaseに記録し、
「📂 記録」から読み込んで続きを再開できる。一度保存すると、時間を進めるたびに同じ記録へ
自動上書き保存される(3秒デバウンス)。

セットアップ:

1. [Supabase](https://supabase.com) でプロジェクトを作成
2. SQL Editor で `supabase/schema.sql` を実行(`sim_runs` テーブル作成)
3. Vercel の環境変数に `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を設定
   (Settings → API の Project URL / service_role キー)

キーはサーバーレス関数 `api/state.js` だけが使用し、ブラウザには露出しない。
未設定でもアプリは動作する(保存ボタンでエラーメッセージが出るだけ)。

## ビルド / デプロイ

```bash
npm run build     # 静的ビルド
vercel deploy     # Vercelへデプロイ(ANTHROPIC_API_KEY を環境変数に設定)
```

## 構成

```
├─ index.html
├─ package.json / vite.config.js
├─ src/
│  ├─ main.jsx
│  ├─ App.jsx            … NeoSimulator本体(UI)
│  ├─ engine/
│  │  ├─ population.js   … generatePopulation, derive, gini 等の純関数
│  │  ├─ fallback.js     … 簡易フォールバックエンジン(fbHour/fbDay/fbMonth/fbYear)
│  │  └─ prompts.js      … COMMON_RULE, SCENARIOS, HOUR/DAY/MONTH/YEAR_SYSTEM
│  └─ api.js             … callClaude(自サーバーの /api/claude を叩く)+ parseJSON
├─ api/
│  └─ claude.js          … Vercelサーバーレス関数(Anthropic APIプロキシ)
└─ .env.example
```
