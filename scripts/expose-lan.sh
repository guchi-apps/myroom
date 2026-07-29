#!/usr/bin/env bash
# スマホなど同一 LAN 上の端末から開発環境（フロントエンド:5173 / バックエンド:8000）を
# 見られるようにする。WSL2 はデフォルトで NAT 接続のため、Windows 側で
# netsh のポート転送とファイアウォール規則を設定する必要がある。
#
# 実行すると Windows 側で管理者権限（UAC）の確認が表示される。
# キャンセルされた場合や失敗した場合は非ゼロで終了するが、呼び出し側
# （scripts/start.sh 等）は開発サーバーの起動自体は継続する。
#
# 使い方: ./scripts/expose-lan.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PS1_PATH_WIN="$(wslpath -w "${SCRIPT_DIR}/windows/update-portproxy.ps1")"

WSL_IP="$(hostname -I | awk '{print $1}')"
if [[ -z "${WSL_IP}" ]]; then
  echo "Error: WSL の IP アドレスを取得できませんでした。" >&2
  exit 1
fi

# 昇格した update-portproxy.ps1 に LAN IP をここへ書き出させる。Windows 側の
# 一時ディレクトリを使うことで、WSL からは /mnt/c 経由で読み取れる
# （-Verb RunAs の別ウィンドウの標準出力は呼び出し元から見えないため）。
LAN_IP_OUT_WIN='C:\Windows\Temp\myroom-lan-ip.txt'
LAN_IP_OUT_WSL="$(wslpath -u "${LAN_IP_OUT_WIN}")"
rm -f "${LAN_IP_OUT_WSL}" 2>/dev/null || true

echo "Windows 側でポート転送を設定します（管理者権限の確認が表示されます）..."

# -Verb RunAs は別ウィンドウで実行されるため、この場では出力が見えない。
# 終了コードだけ拾って成否を判定する（-PassThru + $p.ExitCode）。
if ! powershell.exe -NoProfile -Command "
  try {
    \$p = Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${PS1_PATH_WIN}','-WslIp','${WSL_IP}','-LanIpOutFile','${LAN_IP_OUT_WIN}' -Wait -PassThru
    exit \$p.ExitCode
  } catch {
    Write-Warning \$_.Exception.Message
    exit 1
  }
"; then
  echo "警告: ポート転送の設定に失敗、またはキャンセルされました。スマホからのアクセスはできない可能性があります。" >&2
  echo "       再試行する場合は ./scripts/expose-lan.sh を実行してください。" >&2
  exit 1
fi

LAN_IP="$(cat "${LAN_IP_OUT_WSL}" 2>/dev/null | tr -d '\r\n')"

if [[ -n "${LAN_IP}" ]]; then
  echo "スマホから開発環境を見る場合はこちら（同じ Wi-Fi 上で）:"
  echo "  http://${LAN_IP}.sslip.io:5173"
  echo "  http://${LAN_IP}.sslip.io:8000"
  echo ""
  echo "注意: 生の IP アドレス（http://${LAN_IP}:5173）では Google ログインが必ず失敗します。"
  echo "      Supabase ダッシュボードの Redirect URLs に"
  echo "      http://${LAN_IP}.sslip.io:5173/auth/callback を完全一致で登録してください。"
fi
