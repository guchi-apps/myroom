# Tapo 収集スクリプト（scripts/tapo_to_myroom.py）の設定。
#
# **実シークレットはここに書かない。** 1Password の参照だけを置き、実行時に注入する。
#
#   op run --env-file=scripts/tapo.env.tpl -- python3 scripts/tapo_to_myroom.py
#
# TAPO_HOSTS は `IP=表示名` をカンマ区切りで並べる。`=表示名` を省くとプラグ自身に
# 設定されている名前を使う。表示名はそのまま `daily_energy.source`（`tapo:<表示名>`）
# になるため、**あとから変えると別の機器として記録される。**
# IP は --list-devices で調べられる。DHCP で変わらないよう固定しておくこと。

TAPO_USERNAME="op://apps/MyRoom/tapo-username"
TAPO_PASSWORD="op://apps/MyRoom/tapo-password"
TAPO_HOSTS="op://apps/MyRoom/tapo-hosts"
MYROOM_API_BASE="https://myroom.gucchii.com"
