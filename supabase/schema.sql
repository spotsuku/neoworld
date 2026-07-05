-- シミュレーション記録テーブル
-- SupabaseダッシュボードのSQL Editorでこのファイルの内容を実行してください
create table if not exists public.sim_runs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  scenario text not null default 'post',
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- アクセスはVercelサーバーレス関数(service_roleキー)経由のみ。
-- RLSを有効化し、ポリシーを作らないことで匿名/一般キーからのアクセスを遮断する。
alter table public.sim_runs enable row level security;
