# Raspberry Pi: SwitchBot CO2 → MyRoom

SwitchBot CO2 センサー（Meter Pro CO2 等）の BLE アドバタイズを読み取り、[MyRoom](https://myroom.gucchii.com/) API へ POST します。

```
SwitchBot CO2 ──BLE──► Raspberry Pi Zero W ──HTTPS──► myroom.gucchii.com/api/sensor
                                                          │
                                                          ▼
                                                       MySQL (device_id=2 等)
```

## 前提

| 項目 | 内容 |
|------|------|
| ハードウェア | Raspberry Pi Zero W / Zero 2 W（Bluetooth 内蔵） |
| センサー | SwitchBot Meter Pro (CO2) 等（Manufacturer ID `0x0969` / 2409） |
| ネットワーク | Pi から `https://myroom.gucchii.com` へ HTTPS で到達できること |
| 本番 API | 温度・湿度・気圧・CO2 は **いずれか1つ以上** で POST 可（気圧は CO2 センサーでは送信しない） |

> **Pi Zero W 向け実装**: `bleak` / `dbus-fast` はビルドが重いため使わず、BlueZ の **`btmon` + `hcitool lescan`** で BLE を読み取ります。Python 依存は `requests` と `python-dotenv` のみです。

---

## 1. ファイル配置（WinSCP 推奨）

### WinSCP で接続

| 項目 | 値 |
|------|-----|
| プロトコル | SFTP |
| ホスト名 | `pi0w.local`（または IP `192.168.2.x`） |
| ユーザー名 | `guchi`（Imager で設定した名前） |
| 秘密鍵 | `C:\Users\<ユーザー>\.ssh\pi0w.ppk` |

詳細設定 → SSH → 認証 → 秘密鍵ファイルで `.ppk` を指定。

### アップロード先

ラズパイ上に作業ディレクトリを作成（例: `/home/guchi/myroom-api/`）し、以下をコピー:

| ファイル | 必須 |
|---------|------|
| `switchbot_to_myroom.py` | ✅ |
| `aircon_to_myroom.py` | エアコン連携時 |
| `aircloudhome_client.py` | エアコン連携時 |
| `requirements.txt` | ✅ |
| `.env.example` | ✅ |
| `install.sh` | 任意（systemd 自動化用） |

### `.env` と `sensors.json` の作成

作業ディレクトリ（`~/myroom-api` 等）に **`.env` と `sensors.json` を用意**してから `install.sh` を実行するのがおすすめです。  
初回インストール時、`/opt/myroom-pi/` に無いファイルだけ、**同ディレクトリの実ファイル → 無ければ `*.example`** の順でコピーされます。既にある設定は上書きしません。

**複数台（推奨）** — `sensors.json`:

```json
[
  { "mac": "B0:E9:FE:B3:5F:B5", "device_id": 2, "name": "寝室" },
  { "mac": "11:22:33:44:55:66", "device_id": 4, "name": "書斎" }
]
```

- **mac**: SwitchBot アプリ → デバイス設定で確認（コロン区切り）
- **device_id**: MyRoom の `?device=` と一致させる（DHT=`1`、1台目 CO2=`2` など重複不可）
- **name**: 初回 POST 時に MyRoom へ表示名として登録（任意）。`data/devices.json` への手動追記は不要
- **type**: `co2`（CO2センサー）/ `meter`（温湿度計・防水温湿度計）/ `auto`（省略時・自動判定）

`.env`（API 共通）:

```env
MYROOM_API_URL=https://myroom.gucchii.com/api/sensor
SCAN_TIMEOUT=90
HTTP_TIMEOUT=30
```

**1台だけ（従来）** — `.env` に MAC を直接書く方法も利用できます:

```env
SWITCHBOT_MAC=B0:E9:FE:B3:5F:B5
MYROOM_DEVICE_ID=2
```

> `sensors.json` がある場合はそちらが優先されます。1台運用で `sensors.json` を使わない場合はファイルを削除するか、上記の従来形式のみにしてください。

---

## 2. SSH 接続

### PuTTY / WinSCP（`.ppk` そのまま）

- Host: `pi0w.local`
- User: `guchi`
- 秘密鍵: `pi0w.ppk`

### PowerShell / WSL（OpenSSH 鍵が必要）

PuTTYgen → Load (`pi0w.ppk`) → **Conversions → Export OpenSSH key** → `pi0w` として保存:

```powershell
ssh -i C:\Users\<ユーザー>\.ssh\pi0w guchi@pi0w.local
```

> **WSL から `pi0w.local` / `192.168.2.x` に届かない場合**  
> WSL2 は仮想ネットワーク（`172.x.x.x`）のため、**Windows PowerShell** から SSH / WinSCP を使ってください。

---

## 3. ラズパイの IP アドレスを調べる

再起動後に `pi0w.local` が解決できないことがあります。

### 方法 A: ELECOM ルーター（WRC-1167GS2 等）

1. ブラウザで `http://192.168.2.1`
2. **WAN&LAN** → **LAN** → **接続端末の表示**
3. `pi0w` / `raspberrypi`、または MAC **`B8:27:EB:...`** を探す

Pi の電源 OFF → 30秒 → ON 後、一覧に **新しく増えた** `192.168.2.x` が Pi です。

### 方法 B: Windows PowerShell

```powershell
ping -4 pi0w.local
# または
1..254 | ForEach-Object {
  $ip = "192.168.2.$_"
  if (Test-Connection -ComputerName $ip -Count 1 -Quiet -TimeoutSeconds 1) { $ip }
}
```

### 方法 C: モニター接続

```bash
hostname -I
iwgetid -r    # 接続中 Wi-Fi SSID（2.4GHz の elecom-xxxx 等）
```

### IP 固定（推奨）

ELECOM 管理画面で **DHCP 予約**（Pi の MAC → 固定 IP）を設定すると、再起動後も SSH しやすくなります。

---

## 4. Python 環境セットアップ

```bash
cd ~/myroom-api

# venv を作り直す場合（フォルダ名変更後は必須）
rm -rf venv
python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

sudo apt update
sudo apt install -y bluez    # btmon, hcitool
```

### Pi Zero W の注意点

| 問題 | 対処 |
|------|------|
| `python3 -m venv` が終わらない | Zero W では 5〜15 分かかることがある。`sudo apt install python3-venv` を確認 |
| venv パスエラー（誤ったインタプリタ） | フォルダ名変更後は **`rm -rf venv` して作り直し** |
| `bleak` / `dbus-fast` ビルド | **使わない**（本リポジトリの `requirements.txt` は bleak 非含有） |
| Python 3.7 + piwheels | `requests` / `python-dotenv` は `<2.32` / `<1.0` にピン留め済み |

---

## 5. 動作確認

`btmon` は **root 権限** が必要です。

```bash
cd ~/myroom-api
source venv/bin/activate

# BLE 読み取りのみ（API 送信なし）
sudo ./venv/bin/python3 switchbot_to_myroom.py --dry-run --debug

# 本番 POST
sudo ./venv/bin/python3 switchbot_to_myroom.py
```

成功例:

```text
read: T=30.8C H=31% CO2=604ppm battery=None
posted: {'status': 'ok'}
```

### API / DB 確認

```bash
curl "https://myroom.gucchii.com/api/latest?device=2"
curl "https://myroom.gucchii.com/api/health"
```

ブラウザ: **https://myroom.gucchii.com/**

---

## 6. 定期実行（systemd・5分ごと）

SwitchBot は約 **5分間隔** で BLE を送信するため、5分ごとの実行を推奨します。  
エアコンも同じ **5分間隔** で AirCloud Home から取得します。

```bash
cd ~/myroom-api
chmod +x install.sh
sudo ./install.sh

sudo nano /opt/myroom-pi/.env          # MAC / エアコン認証情報を設定

# SwitchBot CO2
sudo systemctl start switchbot-co2.timer
sudo systemctl enable switchbot-co2.timer
journalctl -u switchbot-co2.service -f

# エアコン（AirCloud Home）
sudo /opt/myroom-pi/run-aircon-collector.sh --dry-run --debug
sudo systemctl start aircon-myroom.timer
sudo systemctl enable aircon-myroom.timer
journalctl -u aircon-myroom.service -f
```

タイマーの状態確認:

```bash
systemctl list-timers switchbot-co2.timer aircon-myroom.timer
```

手動テスト（btmon に root 権限が必要）:

```bash
sudo /opt/myroom-pi/venv/bin/python3 /opt/myroom-pi/switchbot_to_myroom.py --dry-run --debug
sudo /opt/myroom-pi/run-aircon-collector.sh --dry-run --debug
```

`install.sh` 更新後はサービス定義を再適用:

```bash
sudo ./install.sh
sudo systemctl daemon-reload
sudo systemctl restart switchbot-co2.timer aircon-myroom.timer
```

---

## 7. ネットワーク（Pi の IPv4）

ELECOM ルーター（`192.168.2.1`）環境で、Pi に **`192.168.0.x` の固定 IP** が残っていると外部 API に届きません（`No route to host`）。

```bash
grep static /etc/dhcpcd.conf
hostname -I
ping -4 -c 2 192.168.2.1
curl -4 https://myroom.gucchii.com/api/health
```

`/etc/dhcpcd.conf` の `static ip_address=192.168.0.x` をコメントアウト → `sudo reboot`  
再起動後、`hostname -I` が **`192.168.2.x`** になっていることを確認してください。

---

## 8. 本番 API について

CO2 のみ / 温度・湿度・CO2 の部分送信には、本番 API が **任意フィールド対応版** である必要があります。

```bash
# 422 が返る場合 → 本番未デプロイ。main へ push 後 PM2 再起動
curl -X POST "https://myroom.gucchii.com/api/sensor?device=2" \
  -H "Content-Type: application/json" \
  -d '{"datetime":"2026-05-30 12:00:00","co2":400}'
```

CO2 センサーからは **気圧を送りません**（DB には `NULL`）。

---

## 環境変数一覧

| 変数 / ファイル | 説明 | 例 |
|----------------|------|-----|
| `sensors.json` | 複数台の MAC と `device_id`（推奨） | 上記 JSON |
| `SWITCHBOT_SENSORS_FILE` | センサー定義ファイルパス | `sensors.json` |
| `SWITCHBOT_SENSORS_JSON` | 同上を JSON 文字列で指定 | `[{"mac":"...","device_id":2}]` |
| `SWITCHBOT_MAC` | 1台用 MAC（レガシー） | `B0:E9:FE:B3:5F:B5` |
| `MYROOM_API_URL` | POST 先 URL | `https://myroom.gucchii.com/api/sensor` |
| `MYROOM_DEVICE_ID` | 1台用 `device` クエリ | `2` |
| `SCAN_TIMEOUT` | BLE 待ち秒数（秒） | `90`（長い場合は `300`） |
| `HTTP_TIMEOUT` | HTTP タイムアウト（秒） | `30` |
| `PARTIAL_SCAN_GRACE_SEC` | 1台見つかった後、他を待つ秒数 | `20` |
| `REQUIRE_ALL_SENSORS` | `1` で全台必須（未検出なら失敗） | `0`（通常・部分送信可） |
| `MATCH_ANY_SWITCHBOT` | `1` で MAC フィルタ無効（1台のみ） | `0`（通常） |

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `pi0w.local` が解決できない | mDNS 未動作 / Wi-Fi 未接続 | ルーター「接続端末の表示」で IP 確認。Imager で Wi-Fi 再設定 |
| WSL から SSH タイムアウト | WSL2 は LAN 外 | **Windows PowerShell** から接続 |
| `btmon: unrecognized option '--timeout'` | BlueZ 5.50 | スクリプト最新版を使用（`timeout 90 btmon` 方式） |
| `utf-8' codec can't decode`（journalctl） | btmon 出力に非 UTF-8 バイト | `switchbot_to_myroom.py` 最新版を `/opt/myroom-pi/` にコピー |
| センサーが見つからない（90s） | アドバタイズ待ち / MAC 不一致 / btmon 未起動 | 上記 sudo エラーを解消。Pi を近づける、`SCAN_TIMEOUT=300` |
| `LE Advertising Report` は出るが SwitchBot なし | 5分間隔のため | 最大5分待つか `SCAN_TIMEOUT` を延長 |
| `No route to host`（API） | Pi の IPv4 設定ミス | `192.168.0.x` 固定 IP を解除、DHCP で `192.168.2.x` を取得 |
| API 422 `pressure` required | 本番 API が旧版 | `main` デプロイ + `pm2 restart myroom-backend` |
| venv `誤ったインタプリタ` | フォルダ移動後の venv | `rm -rf venv && python3 -m venv venv` |
| `Permission denied: '/opt/myroom-pi/.env'`（aircon） | `.env` が `root:root` のまま（旧 install.sh） | `sudo chown switchbot:switchbot /opt/myroom-pi/.env && sudo chmod 600 /opt/myroom-pi/.env` のあと `sudo systemctl start aircon-myroom.service` |

### btmon で SwitchBot が見えているか

ログに次のような行があれば BLE 取得成功です:

```text
Address: B0:E9:FE:B3:5F:B5
Company: not assigned (2409)
  Data: b0e9feb35fb5b7e4099e1f0318025700
```

---

## 運用チェックリスト

```
□ WinSCP でファイル配置・.env 設定
□ sudo apt install bluez
□ pip install -r requirements.txt
□ sudo ./venv/bin/python3 switchbot_to_myroom.py --dry-run --debug
□ sudo ./venv/bin/python3 switchbot_to_myroom.py → posted: ok
□ curl https://myroom.gucchii.com/api/latest?device=2
□ systemd タイマー有効化（SwitchBot / エアコン）
□ ルーター DHCP 予約（任意）
```

---

## エアコン（白くまくんアプリ / AirCloud Home）→ MyRoom

日立ルームエアコン（RAS-KW4025D 等、白くまくんアプリ対応機）の運転状態を AirCloud Home クラウド API から取得し、MyRoom へ POST します。

```
白くまくんアプリ (AirCloud Home)
        │
        ▼ HTTPS (クラウド API)
Raspberry Pi / Linux ──HTTPS──► myroom.gucchii.com/api/aircon
                                      │
                                      ▼
                                   MySQL (aircon テーブル)
```

### 前提

| 項目 | 内容 |
|------|------|
| エアコン | 白くまくんアプリ対応・Wi-Fi 接続済み |
| アカウント | 白くまくんアプリで登録済み（メール/パスワード） |
| ネットワーク | Pi から `https://myroom.gucchii.com` と AirCloud Home API へ到達できること |
| Python | 3.7 以上（`requests`, `python-dotenv`） |

### ファイル

| ファイル | 説明 |
|---------|------|
| `aircloudhome_client.py` | AirCloud Home API クライアント |
| `aircon_to_myroom.py` | 取得 → POST スクリプト |

### `.env` 設定

`.env.example` を参考に以下を追加:

```env
AIRCON_EMAIL=your@email.com
AIRCON_PASSWORD=your_password
MYROOM_AIRCON_API_URL=https://myroom.gucchii.com/api/aircon
# 複数台ある場合のみ
# AIRCON_UNIT_NAME=リビング
# AIRCON_UNIT_ID=12345
```

### 動作確認

```bash
# 登録済みユニット一覧
python3 aircon_to_myroom.py --list-units

# 取得のみ（POST しない）
python3 aircon_to_myroom.py --dry-run --debug

# 未加工の API レスポンス（JSON）を確認（電気代など未対応フィールドの調査用）
python3 aircon_to_myroom.py --dump-raw

# 本番 POST
python3 aircon_to_myroom.py
```

### 自動取得（systemd・5分ごと）

`install.sh` で SwitchBot と一緒に **`aircon-myroom.timer`** が登録されます。

```bash
cd ~/myroom-api
sudo ./install.sh

sudo nano /opt/myroom-pi/.env
# AIRCON_EMAIL / AIRCON_PASSWORD / MYROOM_AIRCON_API_URL を設定

sudo /opt/myroom-pi/run-aircon-collector.sh --dry-run --debug
sudo systemctl start aircon-myroom.timer
sudo systemctl enable aircon-myroom.timer
journalctl -u aircon-myroom.service -f
```

認証情報が未設定の場合、タイマーはスキップします（ログに `skip` と出ます）。

### cron（systemd を使わない場合）

```cron
*/5 * * * * cd /home/guchi/myroom-api && ./venv/bin/python3 aircon_to_myroom.py >> /var/log/aircon-myroom.log 2>&1
```

本番 DB 利用時は、サーバー側で `python3 migrate_db.py` を実行して `aircon` テーブルを作成してください。

---

## 関連ドキュメント

- プロジェクト全体: [../README.md](../README.md)
- DB マイグレーション（`co2` カラム）: `python3 migrate_db.py`
- 本番 Apache 設定例: [../deployment/apache.conf](../deployment/apache.conf)
