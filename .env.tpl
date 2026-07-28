# ローカル開発用 .env テンプレート（1Password のシークレット参照のみ記載 — 実値は含めない）
#
# 使い方:
#   op run --env-file=.env.tpl -- uvicorn backend.main:app --reload --port 8000
#
# SSH トンネルが必要（WSL で別ターミナルで事前に実行）:
#   ssh -i ~/.ssh/shinvps-20260215 -L 3307:localhost:3306 guchi@162.43.74.7 -p 19622

# --- DB 接続（ローカルは SSH トンネル経由で固定値） ---
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=op://apps/MyRoom/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_MOCK=false

# --- 認証（Supabaseは複数アプリ共通プロジェクトのため共有アイテムを参照） ---
SUPABASE_URL=op://apps/Supabase/url
NEXT_PUBLIC_SUPABASE_URL=op://apps/Supabase/url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_GOOGLE_EMAILS=op://apps/MyRoom/allowed-google-emails

# --- Web Push ---
VAPID_PUBLIC_KEY=op://apps/MyRoom/vapid-public-key
VAPID_PRIVATE_KEY=op://apps/MyRoom/vapid-private-key
VAPID_SUBJECT=op://apps/MyRoom/vapid-subject

# --- 通知 ---
SENSOR_WEBHOOK_URL=op://apps/MyRoom/sensor-webhook-url
