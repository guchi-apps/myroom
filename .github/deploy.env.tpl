# 1Password secret references for GitHub Actions deploy.
# Vault: apps — MyRoom / Server / DB (deploy vars) + Supabase (共通プロジェクト) + githubaction-sshkey (SSH key). See README.md.
SUPABASE_URL=op://apps/Supabase/url
SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_GOOGLE_EMAILS=op://apps/MyRoom/allowed-google-emails
SENSOR_WEBHOOK_URL=op://apps/MyRoom/sensor-webhook-url
SIGNALY_WEBHOOK_URL=op://apps/MyRoom/ci-webhook-url
DB_NAME=op://apps/MyRoom/db-name
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=op://apps/DB/db-host
DB_PORT=op://apps/DB/db-port
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/private_key?ssh-format=openssh
HOST=op://apps/Server/host
USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
TARGET_DIR=op://apps/MyRoom/target-dir
