# WSL2 の開発用ポートを LAN 上の他端末（スマホ等）から到達できるようにする。
# 管理者権限の PowerShell から実行すること（netsh / New-NetFirewallRule は要管理者）。
#
# 使い方:
#   .\update-portproxy.ps1                        # WSL IP は自動検出、ポートは既定 (5173, 8000)
#   .\update-portproxy.ps1 -PortsCsv "5173,8000"  # ポートを指定
#
# WSL2 は再起動のたびに IP が変わるため、スマホから見れなくなったら再実行する。

param(
    [string]$WslIp,
    [string]$PortsCsv = "5173,8000",
    [string]$LanIpOutFile
)

# [int[]] 配列パラメータだと、外部プロセスから "5173,8000" のような単一文字列で
# 渡された際にカンマが桁区切りとして解釈され 51738000 になってしまうため、
# 文字列として受け取り明示的に分割する。
$Ports = $PortsCsv -split ',' | ForEach-Object { [int]$_.Trim() }

if (-not $WslIp) {
    $WslIp = (wsl.exe hostname -I).Trim().Split(" ")[0]
}

if (-not $WslIp) {
    Write-Error "WSL の IP アドレスを取得できませんでした。WSL が起動しているか確認してください。"
    exit 1
}

$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($currentUser)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "管理者権限が必要です。PowerShell を「管理者として実行」してから再度実行してください。"
    exit 1
}

Write-Host "WSL IP: $WslIp"

foreach ($port in $Ports) {
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 | Out-Null
    netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$WslIp

    $ruleName = "WSL Dev Port $port"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        try {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -ErrorAction Stop | Out-Null
            Write-Host "ファイアウォール規則を追加しました: $ruleName"
        } catch {
            Write-Warning "ファイアウォール規則の追加に失敗しました: $ruleName ($($_.Exception.Message))"
        }
    }
}

Write-Host ""
Write-Host "現在のポート転送設定:"
netsh interface portproxy show v4tov4

$lanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1 -ExpandProperty IPAddress

if ($lanIp) {
    Write-Host ""
    Write-Host "スマホから開発環境を見る場合はこちら（同じ Wi-Fi 上で）:"
    foreach ($port in $Ports) {
        Write-Host "  http://${lanIp}:${port}"
    }
}

# -Verb RunAs の別ウィンドウで実行されるとこの標準出力は呼び出し元（expose-lan.sh）から
# 見えないため、LAN IP をファイルに書き出して渡す（呼び出し側で powershell.exe を
# 再度起動して同じ値を計算し直す二度手間を避ける）。
if ($LanIpOutFile) {
    Set-Content -Path $LanIpOutFile -Value $lanIp -Encoding ascii -NoNewline
}
