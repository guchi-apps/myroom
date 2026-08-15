# MyRoom

部屋の環境データ（温度、湿度、気圧、CO2、照度など）を可視化するアプリケーションです。ログイン後にダッシュボードで履歴グラフ・センサー一覧・記録を確認でき、Raspberry Pi からセンサー／エアコンデータを POST できます。

- **バックエンド**: FastAPI (Python)
- **フロントエンド**: Next.js (React + TypeScript + Tailwind CSS + shadcn/ui)
- **本番配信**: Next.js を静的エクスポート (`frontend/out`) し、FastAPI が API と静的ファイルの両方を配信

## プロジェクト構成

```
myroom/
├── backend/           # FastAPI API
├── frontend/          # Next.js UI（開発: port 5173）
├── data/              # 実行時設定（gitignore 対象）
│   ├── devices.json           # デバイス表示名
│   └── outdoor_location.json  # 屋外地点
├── scripts/           # 開発用起動スクリプト
└── migrate_db.py      # DB スキーマ更新
```

## 開発環境の起動方法

### 前提条件

以下のツールがインストールされていることを確認してください。

- Python 3.x
- Node.js **20.9 以上** (および npm)

初回のみ Python 依存関係をインストールします（**Streamlit は含みません**。Next.js + FastAPI の開発に必要なものだけです）。

```bash
cd /home/guchi/apps/myroom
python3 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

初回のみ、ルートに `.env` を用意してください（DB接続情報・パスワードなど）。  
起動スクリプトは **環境変数 `DB_MOCK` でモードを上書き**するため、`.env` の `DB_MOCK` 値を毎回書き換える必要はありません。

### まとめて起動（推奨）

プロジェクトルートで、どちらか **1コマンド** を実行します。バックエンド・フロントエンドを同時に起動し、Ctrl+C でまとめて停止できます。

| モード | コマンド | データ |
|--------|----------|--------|
| **開発データ（モック）** | `./scripts/start.sh mock` | ダミーデータ（DB・SSH不要） |
| **本番データ** | `./scripts/start.sh prod` | 本番MySQL（SSHトンネル自動起動） |

停止のみ行う場合:

```bash
./scripts/stop.sh
```

起動後はブラウザで **http://localhost:5173** を開いてください（API: http://localhost:8000/docs）。

#### 開発データ（モック）で起動

```bash
chmod +x scripts/*.sh scripts/lib/*.sh   # 初回のみ
./scripts/start.sh mock
```

- `DB_MOCK=true`（DB接続なし）
- UIの動作確認向け

同等: `./scripts/start-mock.sh`

#### 本番データで起動

```bash
./scripts/start.sh prod
```

- `DB_MOCK=false`
- SSHトンネル（ローカル 3307 → 本番 3306）を自動起動
- `check_db.py` で接続確認後にバックエンド・フロントエンドを起動
- `.env` の `DB_HOST` / `DB_PORT`（例: `127.0.0.1:3307`）がトンネル先と一致していること

同等: `./scripts/start-prod-db.sh`

SSHトンネルだけ別ターミナルで維持したい場合:

```bash
./scripts/start_tunnel.sh
```

### スマホなど同一 LAN の端末から見る場合

開発サーバー自体は起動時から `0.0.0.0` で待ち受けていますが、WSL2 は既定で Windows とは別ネットワーク（NAT）のため、そのままでは同じ Wi-Fi 上のスマホから届きません。`./scripts/start.sh` 実行時に Windows 側のポート転送を自動設定します（**管理者権限の確認（UAC）が毎回表示されます**）。

表示される `http://<WindowsのIPアドレス>.sslip.io:5173` にスマホからアクセスできます。UAC をキャンセルしてもバックエンド・フロントエンドの起動自体は継続します（スマホからのアクセスのみ不可）。

- **Google ログインを試す場合は sslip.io 経由の URL を使う**: Supabase Auth（GoTrue）は `redirectTo` のホスト名が生の IP アドレスだと、Redirect URLs にどう登録してもログインが無条件で失敗する仕様がある。`<IP>.sslip.io` は DNS 解決すると同じ IP を返すワイルドカード DNS のため、TCP 接続は変わらず LAN 内で完結する
- 開発用 Supabase プロジェクトの Authentication → URL Configuration → Redirect URLs に `http://<WindowsのIPアドレス>.sslip.io:5173/auth/callback` を**完全一致**で登録しておく（ポート部分を `*` にしたパターンと混在させると許可リスト全体が効かなくなることがあるため避ける）

WSL を再起動すると WSL 側の IP が変わり転送が切れます。次回 `./scripts/start.sh` 実行時に自動で更新されますが、サーバーを再起動せず再設定だけしたい場合は単独で実行できます。

```bash
./scripts/expose-lan.sh
```

### 手動で起動する場合

#### 1. 環境設定 (.env)

- **モックモード**: `DB_MOCK=true` — ダミーデータ
- **本番データモード**: `DB_MOCK=false` — 本番DB（要SSHトンネル）

本番データ利用時は別ターミナルで `./scripts/start_tunnel.sh` を実行し、接続確認:

```bash
source venv/bin/activate
python3 check_db.py
```

#### 2. バックエンド (Python / FastAPI)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

#### 3. フロントエンド (Next.js)

Google 認証を使う場合、初回のみ `frontend/.env.local` を作成してください（`.gitignore` 対象。1Password アプリから値を直接コピーし、`.env.tpl` 経由では同期されません）。

```bash
# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=<1Password「Supabase」アイテムの dev-project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<同 dev-publishable-key>
```

**バックエンド起動後**に:

```bash
cd frontend
npm install
npm run dev
```

- UI: http://localhost:5173
- 開発時は `/api` が FastAPI (`localhost:8000`) にプロキシされます

## 自動テスト

GitHub への push / PR 前に、次のコマンドで CI と同等のチェックを実行できます。

```bash
chmod +x scripts/test.sh   # 初回のみ
./scripts/test.sh
```

個別に実行する場合:

```bash
# バックエンド（pytest、DB_MOCK=true・外部APIなし）
source venv/bin/activate
pip install -r requirements-dev.txt
pytest tests/ -q

# フロントエンド
cd frontend
npm run typecheck
npm run test          # Vitest（chart-utils 等）
npm run build
```

### テスト内容

| 対象 | 内容 |
|------|------|
| `tests/test_api.py` | API エンドポイント（health、latest、history、sensor、devices、屋外地点） |
| `tests/test_config.py` | デバイス名・屋外地点の設定ファイル読み書き |
| `frontend/lib/chart-utils.test.ts` | グラフ計算・快適度・履歴マージのユニットテスト |

`main` / `develop` 向け PR と `develop` への push では [`.github/workflows/ci.yml`](.github/workflows/ci.yml) が自動実行されます（`main` への直接 push では CI は走りません）。`main` への push 時はデプロイ（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）のみ実行されます。

### ブランチとデプロイ

| ブランチ | 役割 | デプロイ先 |
|----------|------|------------|
| `develop` | 開発 | なし（ローカル） |
| `main` | 本番 | https://myroom.gucchii.com/ |

**マージの流れ**: `develop` → `main`

## システム仕様

### 画面構成

SwitchBot 風のスマートホーム UI をベースに、モバイル向け（最大幅 480px）のライト／ダークテーマで構成しています。

1. **履歴グラフ** — 画面上部。指標タブ（温度・湿度・気圧・CO2・照度）で切り替え。スマホではグラフ上と画面下部の固定バーの両方から操作可能
2. **センサー（2列グリッド）** — 屋内デバイス / 屋外 / エアコン。カードタップでデバイス詳細（グラフ・記録一覧）
3. **暮らし（1列）** — ゴミの日など、計測値ではないカード
4. **最近の記録** — 日ごとの最高・最低値をバー表示
5. **表示設定** (`/devices`) — 表示順・表示名・色・ダッシュボード表示の管理

フォントは **Noto Sans JP**、カードは角丸 18〜20px です。

#### カードのセクション分け

カードの性質はこれから増えるほどバラバラになる（計測値・操作ボタン・予定・稼働履歴）ため、
置き場所を次のように決めています（`frontend/lib/dashboard-sections.ts`）。

- **センサー** — 時系列グラフを持つ計測値。2列グリッド。並び順は `display_order`（グラフ凡例と共通）で管理
- **暮らし** — 計測値ではないもの。1行あたりの情報量がカードごとに違うため1列で全幅。
  グラフ凡例を持たないので `display_order` には混ぜず、並びは `LIFE_CARDS` の定義順で固定。
  表示・非表示だけは共通の `hidden_devices`（表示設定ページ）で管理

### 単位と表示

| 項目 | 単位 | 表示 |
|------|------|------|
| 温度 | °C | 小数点第1位、青色 (`#3498db`) |
| 湿度 | % | 整数、緑色 (`#2ecc71`) |
| 気圧 | hPa | 整数、紫色 (`#9b59b6`) |
| CO2 | ppm | 整数、オレンジ (`#e67e22`) |
| 照度 | lx | 小数点第1位、黄色 (`#f1c40f`) |

### 履歴グラフ

- **表示幅**: 日 / 週 / 月 / 年 を切り替え。左右ドラッグで表示期間を移動し、範囲外のデータを段階的に取得
- **指標切替**: 温度・湿度・気圧・CO2・照度タブ（スマホではグラフ上部＋画面下部固定バー）
- **屋内 / 屋外**: 屋内は実線、屋外（Open-Meteo）は点線。エアコンの室温・設定温度も個別に表示可能
- **DHT11 温度**: 防水温湿度計など `temperature_dht11` を別系列で表示可能
- **凡例**: 各系列の表示／非表示を切り替え（設定はセッションをまたいで保持）
- **Y軸**: 現在表示中の時間帯のデータに合わせて自動調整
- **年表示**: 日次集計（最高・最低を含む）。日・週・月は生データ（10分間隔等）
- **更新**: 30秒ごとの自動更新、手動更新ボタンあり。起動時は読み込み中表示

### デバイス管理

- **複数デバイス対応**: API の `device` クエリで `device_id` を指定（例: `?device=2`）
- **表示設定ページ** (`/devices`): 表示順のドラッグ並べ替え、表示名・グラフの色・ダッシュボード表示の ON/OFF。「暮らし」のカードは表示・非表示のみ
- **デバイス詳細**: センサーカードをタップ → そのデバイス（設置場所）のグラフと記録一覧。記録の個別削除・一括削除に対応
- **設置場所の継承**: 同じ場所でセンサーを交換した場合、`inherits_from` で過去データを連続表示。場所名は継承チェーン最古のデバイス名を使用
- **エアコン**: 室温と設定温度で色・ダッシュボード表示を個別に設定可能
- **表示名の保存**: UI 設定は DB（`ui_settings`）に永続化。デバイス名は `data/devices.json`（gitignore）にも反映

### 屋外データ

屋内センサーとは別に、[Open-Meteo](https://open-meteo.com/) から外気温・湿度・気圧を取得します。

- **最新値**: Forecast API（`/api/latest` 呼び出し時）
- **履歴**: 直近90日は Forecast API、それ以前は Archive API（1時間ごと）
- **地点の変更**: 屋外カードをタップ → 地名検索または緯度・経度を入力
- **保存先**: `data/outdoor_location.json`（gitignore 対象）
- **初期値**: `.env` の `OUTDOOR_LAT` / `OUTDOOR_LON` / `OUTDOOR_LOCATION_NAME`（未設定時: 茨木市付近）

### CO2 センサー（SwitchBot + Raspberry Pi）

SwitchBot Meter Pro (CO2) 等から **Raspberry Pi Zero W** 経由でデータを送信できます。

**本番 URL**

| 用途 | URL |
|------|-----|
| アプリ | https://myroom.gucchii.com/ |
| API（センサー POST） | https://myroom.gucchii.com/api/sensor |
| 死活監視 | https://myroom.gucchii.com/api/health |

```bash
# POST 例（温度・湿度・CO2 のみ。気圧は CO2 センサーでは省略可）
curl -X POST "https://myroom.gucchii.com/api/sensor?device=2" \
  -H "Content-Type: application/json" \
  -d '{"datetime":"2026-05-30 12:00:00","co2":600,"temperature":30.8,"humidity":31}'
```

- `temperature` / `humidity` / `pressure` / `co2` / `illuminance` / `temperature_dht11` の **いずれか1つ以上** が必須
- 複数デバイスは `device` クエリで区別（例: DHT=`1`、SwitchBot CO2=`2`）
- **SwitchBot 複数台**: Raspberry Pi の `sensors.json` に MAC と `device_id` を列挙（1回の BLE スキャンでまとめて POST）。新しい `device_id` は初回 POST で自動登録され、ダッシュボードにも自動表示
- CO2 値は UI のセンサーカードに ppm として表示

**Raspberry Pi 上のスクリプト・セットアップ手順**（WinSCP、SSH、BLE/`btmon`、systemd、トラブルシューティング）は  
[m-guchi/pi0w_260719](https://github.com/m-guchi/pi0w_260719) リポジトリに移管しました。`myroom-api/README.md` を参照してください。

### エアコン（白くまくんアプリ / AirCloud Home + Raspberry Pi）

日立ルームエアコン（白くまくんアプリ対応機）の状態を **AirCloud Home クラウド API** 経由で取得し、MyRoom に送信できます。

**前提**

- 白くまくんアプリでアカウント登録・エアコン登録済み
- エアコンが Wi-Fi に接続済み
- Raspberry Pi（または cron 実行可能な Linux マシン）から HTTPS で MyRoom API に到達できること

**本番 URL**

| 用途 | URL |
|------|-----|
| API（エアコン POST） | https://myroom.gucchii.com/api/aircon |
| API（最新状態 GET） | https://myroom.gucchii.com/api/aircon/latest |

```bash
# 5分ごとに取得・送信（Pi 上、myroom-api/ 配下）
python3 aircon_to_myroom.py

# 登録済みユニット一覧
python3 aircon_to_myroom.py --list-units

# 自動実行（systemd タイマー・5分間隔）
sudo ./install.sh
sudo systemctl start aircon-myroom.timer
```

Raspberry Pi 上のスクリプトは [m-guchi/pi0w_260719](https://github.com/m-guchi/pi0w_260719) リポジトリに移管しました。詳細は `myroom-api/README.md` を参照。

取得できる主な項目: 室温、設定温度、運転モード、電源 ON/OFF、風量・風向、オンライン状態など（詳細は下記参照）。

**DB マイグレーション**（本番 DB 利用時）:

```bash
python3 migrate_db.py   # aircon テーブルを作成
```

### ゴミの日

収集日を `data/garbage.json`（**リポジトリに含まれる**手編集ファイル）に書くと、ダッシュボードの
「暮らし」セクションに今日・明日・次の収集が並び、前日夜に Signaly へ通知が飛びます。
外部 API もスクレイピングも使わず、書いたルールから日付を計算するだけです。

```jsonc
{
  "area": "茨木市",
  "notify_hour": 20,               // 通知する時刻（JST・0〜23）
  "categories": [
    {
      "id": "burnable",
      "name": "普通ごみ",
      "color": "#e67e22",
      "note": "生ごみ・紙くずなど",
      "rules": [{ "type": "weekly", "weekdays": ["tue", "fri"] }]
    },
    {
      "id": "recyclable",
      "name": "資源ごみ",
      // 第2・最終水曜（weeks は 1〜5 と -1（最終週）が使える）
      "rules": [{ "type": "monthly", "weekday": "wed", "weeks": [2, -1] }]
    }
  ],
  "exceptions": [
    { "date": "2026-12-31", "cancel": true, "note": "年末年始のため収集なし" },
    { "date": "2027-01-05", "cancel": ["recyclable"] },
    { "date": "2027-01-06", "add": ["burnable"], "note": "振替収集" }
  ]
}
```

- `weekday` / `weekdays` は `mon`〜`sun` でも `月`〜`日` でも書けます
- 年末年始などの変則日程は `exceptions` に書きます。`cancel: true` でその日を全休、
  `cancel: ["id"]` で品目を指定して中止、`add: ["id"]` で臨時収集を追加
- 通知は `backend/garbage_notify.py`。バックエンドが5分ごとに呼び、`notify_hour` の時刻にだけ送信します
  （本番のバックエンドは PM2 が起動するプロセス1つなので、systemd タイマーではなくこのプロセス内で回しています。
  手動で試すときは `python -m backend.garbage_notify`）。
  宛先はセンサー通知と同じ `SENSOR_WEBHOOK_URL`。分けたい場合のみ `GARBAGE_WEBHOOK_URL` を設定します
- 同じ収集日に二重通知しないよう、送信済みの日付を `data/garbage_notify_state.json`（gitignore）に残します
- カードを消したい場合は表示設定ページ（`/devices`）の「暮らし」でオフにします

#### Notion への書き出し（dayspan のカレンダー連携）

収集日を Notion のデータベースへ書き出し、Notion を読むアプリ（dayspan など）のカレンダーから
見えるようにします。**収集日の正はあくまで `data/garbage.json`** で、Notion 側を手で書き換えても
次の同期で戻ります。

```json
"notion": {
  "enabled": true,
  "window_days": 60,
  "category_value": "ゴミの日",
  "properties": { "title": "タイトル", "date": "日付", "category": "種類", "memo": "メモ" }
}
```

- 実装は `backend/garbage_notion.py`（同期）と `backend/notion_api.py`（Notion API の薄いラッパ）。
  バックエンドが1時間ごとに呼び、1日1回だけ実行します。手動で試すときは
  `python -m backend.garbage_notion --dry-run`（書き込まずに差分の件数だけ表示）
- 環境変数 `GARBAGE_NOTION_TOKEN`（Notion のインテグレーショントークン）と
  `GARBAGE_NOTION_DATA_SOURCE_ID` の両方が設定されているときだけ動きます。未設定なら何もしません
- **持つのは `database_id` ではなく `data_source_id` です。** Notion API のバージョン `2025-09-03` 以降、
  プロパティ定義とクエリの対象はデータベースではなくデータソースに変わり、`database_id` では読み書きできません
- ページの粒度は「収集日 × 品目」で1件。今日から `window_days` 日先までを毎回まるごと計算し直し、
  Notion 側の同じ期間を引いて差分（作成・更新・アーカイブ）を当てます。ページIDを手元に持たないため、
  状態ファイルを失っても二重登録になりません。過ぎた収集日のページは検索対象に入らないので消えません
- **select プロパティ「種類」に `category_value` を書き込み、これを目印に myroom が作ったページを見分けます。**
  この目印が無いと人が手で作ったページと区別できず、`exceptions` で中止になった日のページを片付けられません。
  そのため「種類」は必須で、見つからない場合は1件も書かずに中止します
- プロパティ名は Notion 側で自由に付けられるため、`properties` の名前で当たらない場合は
  「その型のプロパティが1つしか無ければそれ」という判定に落とします。複数あって絞れないときは中止します
- 同期のきっかけは「日付が変わったこと」に加えて「`data/garbage.json` の内容が変わったこと」。
  収集ルールを直したあと翌日まで反映されないのを避けるため、設定のハッシュを
  `data/garbage_notion_state.json`（gitignore）に残して比べています

### その他

- **最近の記録**: 直近7日分から表示し、「もっと見る」で追加読み込み
- **モバイルアプリ対応 (PWA)**: ホーム画面に追加して全画面起動可能。専用アプリアイコン設定済み
- **オフライン表示**: ネットワーク切断時、IndexedDB に保存した最新値と直近24時間のグラフを表示
- **センサー未到達通知**: API 側で鮮度を監視し、Signaly で通知。ダッシュボードに警告表示
- **死活監視用 API**: `/api/health` が `GET` / `HEAD` で `200 OK` を返す
- **ログイン管理**:
  - ダッシュボードのデータ取得 API は **認証必須**（`Authorization: Bearer <Supabaseアクセストークン>`）。センサー POST（`/api/sensor`）・エアコン POST（`/api/aircon`）は認証なし
  - ログインは Supabase Auth 経由の Google 認証で行う（複数の自作アプリ共通の Supabase プロジェクトを使用）。許可したアカウントのみアクセス可能（`ALLOWED_GOOGLE_EMAILS` にメールアドレスをカンマ区切りで設定）
  - バックエンドは Supabase の JWKS（`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`）を取得・キャッシュし、リクエストごとに JWT を自前検証する（Supabase への問い合わせは発生しない）
  - 本番: 1Password 共有アイテム `Supabase` の `project-url` / `publishable-key` と、`MyRoom` の `allowed-google-emails` を、それぞれ `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `ALLOWED_GOOGLE_EMAILS` としてサーバー `.env` と GitHub Actions のフロントエンドビルドに自動同期（`.github/deploy.env.tpl` / `deploy.yml`）
  - ローカル開発: 本番と誤って同じ Supabase プロジェクトを操作しないよう、同アイテムの `dev-project-url` / `dev-publishable-key`（開発用の別 Supabase プロジェクト）を使用。バックエンドは `.env.tpl` 経由（`SUPABASE_URL`）で自動反映されるが、**フロントエンドは自動同期されない**ため `frontend/.env.local` に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` を手動で書き込む必要がある（値は 1Password アプリから直接コピー。詳細は下記「2. フロントエンド」参照）
  - Supabase ダッシュボードの Authentication → URL Configuration → Redirect URLs に、本番用プロジェクトには本番ドメインの、開発用プロジェクトにはローカル開発用の `/auth/callback` を、それぞれ**完全一致**で登録しておく必要がある（生の IP アドレスをホスト名にした URL は無条件で拒否される）
  - センサー異常・復旧時: Signaly（1Password の `sensor-webhook-url`）へ通知
  - ゴミの日の前日夜: 同じ Signaly の宛先へ通知（`GARBAGE_WEBHOOK_URL` で分離可能）
  - GitHub Actions（CI / デプロイ）の成功・失敗: Signaly へ通知

## API 概要

| メソッド | パス | 説明 |
|----------|------|------|
| GET/HEAD | `/api/health` | 死活監視 |
| GET | `/api/auth/me` | ログイン確認（Supabaseセッションの許可判定、要認証） |
| GET | `/api/latest?device=1` | 最新の屋内＋屋外データ（要認証） |
| GET | `/api/history?range=day&device=1` | 履歴（`range`: day/week/month/year、または `start`/`end`、要認証） |
| GET | `/api/daily-stats?device=1` | 日次統計（最近の記録、要認証） |
| GET | `/api/records?device=1` | センサー記録一覧（要認証） |
| DELETE | `/api/records` | センサー記録の削除（要認証） |
| POST | `/api/records/bulk-delete` | センサー記録の一括削除（要認証） |
| POST | `/api/sensor?device=1` | センサーデータ受信（認証不要） |
| POST | `/api/aircon` | エアコン状態受信（認証不要） |
| GET | `/api/aircon/latest?ac_id=1` | エアコン最新状態（要認証） |
| GET | `/api/aircon/history` | エアコン履歴（要認証） |
| GET | `/api/devices` | デバイス一覧（要認証） |
| PUT | `/api/devices/{id}` | デバイス表示名・継承設定の更新（要認証） |
| GET | `/api/aircon/units` | エアコンユニット一覧（要認証） |
| PUT | `/api/aircon/units/{ac_id}` | エアコン表示名の更新（要認証） |
| GET/PUT | `/api/ui-settings` | UI 設定（表示順・色・非表示デバイス、要認証） |
| GET | `/api/outdoor-location` | 屋外地点の取得（要認証） |
| PUT | `/api/outdoor-location` | 屋外地点の更新（要認証） |
| GET | `/api/outdoor-location/search?q=大阪` | 地名検索（要認証） |
| GET | `/api/sensors/status` | センサー鮮度ステータス（要認証） |
| GET | `/api/garbage` | ゴミの日（今日・明日・次の収集、要認証） |

## 設定ファイル

| ファイル | 用途 | 備考 |
|----------|------|------|
| `.env` | DB接続、モックモード、初期デフォルト値 | gitignore |
| `data/devices.json` | デバイス表示名 | gitignore、UI から自動生成 |
| `data/outdoor_location.json` | 屋外地点 | gitignore、UI から自動生成 |
| `data/garbage.json` | ゴミ収集日のルール | **リポジトリに含まれる**（手で編集してデプロイする） |

## データベース

### スキーマ更新

センサー記録テーブルは `sensor_readings`（旧名 `dht`）です。`device_id`（複合主キー）、`co2`、`illuminance`（照度・lux）、`temperature_dht11` などのカラム追加と、旧テーブル名からのリネームは `migrate_db.py` で行います。

```bash
source venv/bin/activate
python3 migrate_db.py
```

ALTER 権限がない場合は、スクリプトが表示する SQL を管理者ユーザーで実行してください。  
`DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` を `.env` に設定すると、管理者権限でのマイグレーションが可能です。

デプロイ時（GitHub Actions）も `migrate_db.py` が自動実行されます。

## 本番環境へのデプロイ

### 1. 1Password の設定

デプロイ用の秘密情報は 1Password で管理し、GitHub Actions から `1password/load-secrets-action` で読み込みます。

#### 1-1. 1Password にデプロイ用アイテムを作成

保管庫名 `apps` に、次のアイテムを作成してください。

**アイテム `Supabase`**（セキュアノート等・複数の自作アプリで共通利用）

| フィールド名 | 内容 |
|-------------|------|
| `project-url` | 本番用 Supabase プロジェクトの URL（`SUPABASE_URL` としてサーバー `.env` に、`NEXT_PUBLIC_SUPABASE_URL` としてフロントエンドのビルドに同期） |
| `publishable-key` | 本番用 Supabase の Publishable key（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` としてフロントエンドのビルドに同期。フロントに公開してよい値） |
| `dev-project-url` | ローカル開発用 Supabase プロジェクトの URL（本番と誤操作しないよう分離）。バックエンドは `.env.tpl` 経由でローカルの `.env` の `SUPABASE_URL` に自動反映。フロントエンドは `frontend/.env.local` の `NEXT_PUBLIC_SUPABASE_URL` に手動でコピー |
| `dev-publishable-key` | ローカル開発用 Supabase の Publishable key。フロントエンドは `frontend/.env.local` の `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` に手動でコピー（`.env.tpl` には含まれない） |

**アイテム `MyRoom`**（セキュアノート等）

| フィールド名 | 内容 |
|-------------|------|
| `allowed-google-emails` | ログインを許可する Google アカウントのメールアドレス（カンマ区切り、`ALLOWED_GOOGLE_EMAILS` としてサーバー `.env` に同期） |
| `sensor-webhook-url` | センサー異常・復旧通知用 Signaly Webhook URL（`SENSOR_WEBHOOK_URL` として同期） |
| `garbage-notion-token` | ゴミの日を書き出す Notion インテグレーションのトークン（`GARBAGE_NOTION_TOKEN` として同期） |
| `garbage-notion-data-source-id` | 書き出し先の Notion データソースID（`GARBAGE_NOTION_DATA_SOURCE_ID` として同期。`database_id` ではない） |
| `db-name` | 接続先データベース名（`DB_NAME` として同期） |
| `target-dir` | デプロイ先ディレクトリ（例: `/home/guchi/myroom`） |

**アイテム `Server`**（セキュアノート等）

| フィールド名 | 内容 |
|-------------|------|
| `host` | サーバーのホスト名または IP（GitHub Actions の SSH / rsync 用） |
| `username` | SSH ユーザー名 |
| `ssh-port` | SSH ポート番号 |

**アイテム `DB`**（セキュアノート等）

| フィールド名 | 内容 |
|-------------|------|
| `db-user` | MySQL ユーザー名（`DB_USER` として同期） |
| `db-password` | MySQL パスワード（`DB_PASSWORD` として同期） |
| `db-host` | MySQL ホスト（`DB_HOST` として同期） |
| `db-port` | MySQL ポート（`DB_PORT` として同期） |

**アイテム `githubaction-sshkey`**（「SSH 鍵」アイテム型）

| フィールド ID | 内容 |
|-------------|------|
| `private_key` | サーバー接続用 SSH 秘密鍵（UI 表示は「秘密鍵」だが参照は ID を使う） |

Vault 名やアイテム名を変える場合は、`.github/deploy.env.tpl` の `op://...` 参照も合わせて更新してください。日本語ラベル（`秘密鍵`）は secret reference に使えません。

正しい参照の確認:

```bash
op item get githubaction-sshkey --vault apps --format json | jq '.fields[] | {id, label, reference}'
op read "op://apps/githubaction-sshkey/private_key?ssh-format=openssh"
```

#### 1-2. Service Account を作成

1. 1Password で Service Account を作成し、`apps` 保管庫への読み取り権限を付与
2. 発行されたトークンを GitHub リポジトリの Secret に登録

| GitHub Secret | 内容 |
|---------------|------|
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password Service Account のトークン（これだけ GitHub に残す） |

#### 1-3. 本番サーバーの初期セットアップ

デプロイは `github-user` など **sudo 権限のないユーザー** で SSH 接続します。サーバー管理者が初回のみ次を入れておくとスムーズです。

```bash
sudo apt update
sudo apt install -y python3-venv nodejs npm
```

`python3-venv` が無くても、デプロイ時の `deployment/ensure_venv.sh` が **sudo なし** で [virtualenv.pyz](https://bootstrap.pypa.io/virtualenv/virtualenv.pyz) から venv を作成します（Ubuntu 24.04 の PEP 668 でも system への `pip install` は不要）。PM2 はデプロイ workflow が `npx pm2` を使うため、グローバルインストールは必須ではありません（`nodejs` / `npm` は必要）。

手動で venv だけ作る場合（`github-user` で）:

```bash
cd /apps/myroom
rm -rf venv
curl -sS https://bootstrap.pypa.io/virtualenv/virtualenv.pyz -o /tmp/virtualenv.pyz
python3 /tmp/virtualenv.pyz venv
./venv/bin/python3 -m pip install -r requirements.txt
```

#### 1-4. 本番サーバーの `.env`

rsync では `.env` を転送しません。サーバー上の `.env` には、1Password から同期しない設定も残します。

| 環境変数 | 管理方法 |
|----------|----------|
| `DB_MOCK` | デプロイ時に `false` を自動設定（本番は常に実 DB） |
| `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` | 必要な場合のみサーバー `.env` に手動設定 |

デプロイ時に 1Password から次の値が自動で `.env` に書き込まれます（既存の同名キーは上書き）。

| 環境変数 | 1Password アイテム | フィールド |
|----------|-------------------|-----------|
| `SUPABASE_URL` | Supabase | `project-url` |
| `ALLOWED_GOOGLE_EMAILS` | MyRoom | `allowed-google-emails` |
| `SENSOR_WEBHOOK_URL` | MyRoom | `sensor-webhook-url` |
| `GARBAGE_NOTION_TOKEN` | MyRoom | `garbage-notion-token` |
| `GARBAGE_NOTION_DATA_SOURCE_ID` | MyRoom | `garbage-notion-data-source-id` |
| `DB_NAME` | MyRoom | `db-name` |
| `DB_USER` | DB | `db-user` |
| `DB_PASSWORD` | DB | `db-password` |
| `DB_HOST` | DB | `db-host` |
| `DB_PORT` | DB | `db-port` |

### 2. デプロイフロー

`main` ブランチにプッシュすると GitHub Actions（`deploy.yml`）が起動し、以下を自動実行します。

1. `frontend/package.json` のバージョンから Git タグ（`v*`）を作成
2. フロントエンドのビルド（`npm run build` → `frontend/out` に静的出力）
3. ファイルの転送 (`rsync`)
4. 1Password から `SUPABASE_URL` / `ALLOWED_GOOGLE_EMAILS` / `SENSOR_WEBHOOK_URL` / `GARBAGE_NOTION_*` / DB 接続情報をサーバー `.env` に同期
5. DB マイグレーション (`migrate_db.py`)
6. バックエンドの依存関係更新と PM2 による再起動（`pm2 restart` では cwd が変わらないため、毎回 `delete` → `start`）
7. **デプロイ成功後** GitHub Release を作成
8. CI 用 Webhook へデプロイ・リリース結果を Signaly 通知

※ Actions の `GITHUB_TOKEN` で push したタグは別ワークフローを起動しないため、Release も `deploy.yml` 内で実行します。手動でタグ push した場合のみ `release.yml` が走ります。

本番では FastAPI が `frontend/out` を配信し、API と UI を同一オリジンで提供します。

### 3. バージョン管理（npm version）

アプリのバージョンは `frontend/package.json` が正です。UI の表示と更新履歴はここから同期されます。`main` へのマージ時、GitHub Actions がこの値から `v3.0.0` 形式の Git タグと GitHub Release を自動作成します。

| ファイル | 役割 |
|----------|------|
| `frontend/package.json` | バージョン番号（`npm version` で更新） |
| `frontend/lib/app-version.ts` | package.json を読み込み表示 |
| `frontend/lib/app-changelog.ts` | 更新履歴（`npm version` 時に先頭へ枠を自動追加） |

#### リリース手順

`develop` でバージョンを上げてから `main` にマージします。タグは CI が `main` 上で付けるため、ローカルでは **`--no-git-tag-version`** を付けて `frontend/package.json` / `frontend/package-lock.json` だけ更新してください（ローカルでタグを作ると、マージ後のデプロイが「タグが既に別コミットを指している」として失敗します）。

```bash
git checkout develop
git pull

# patch: 2.4.0 → 2.4.1
npm run version:patch -- -m "Release v%s: 修正内容の要約"

# minor: 2.4.0 → 2.5.0
npm run version:minor -- -m "Release v%s: 機能追加の要約"

# major: 2.4.0 → 3.0.0
npm run version:major -- -m "Release v%s: 破壊的変更の要約"
```

`npm version` 実行時の流れ:

1. `typecheck` と `test`（`preversion`）
2. `package.json` / `package-lock.json` のバージョン更新
3. `app-changelog.ts` 先頭に新バージョンの枠を追加
4. 上記をまとめて git commit（**タグは作成しない**）

changelog の「（変更内容を追記してください）」を実際の文言に直してから push してください。

```bash
# changelog を追記したら amend する例
git add frontend/lib/app-changelog.ts
git commit --amend --no-edit

git push origin develop

# PR を作成して main にマージ
```

同じバージョン番号で再デプロイする場合は、先にバージョンを上げてから `main` にマージする必要があります（タグが既に別コミットを指していると workflow がエラーになります）。
