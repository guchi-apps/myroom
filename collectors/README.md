# collectors — サブPCで動かす収集スクリプト

MyRoom へデータを送る収集処理のうち、**外部のクラウドAPIを叩くだけで完結するもの**を置く。

```
AirCloud Home (白くまくんアプリ)
        │ HTTPS
        ▼
     サブPC（systemd user timer・1時間ごと）
        │ HTTPS
        ▼
  myroom.gucchii.com/api/energy  →  MySQL (daily_energy)
```

## ラズパイとサブPCの分担

| 収集するもの | 動かす場所 | 理由 |
|---|---|---|
| SwitchBot の CO2・温湿度 | ラズパイ（`guchi-apps/pi0w_260719`） | BLE のアドバタイズを拾うため、センサーの近くに居る必要がある |
| エアコンの運転状態（5分ごと） | ラズパイ（同上） | すでに動いており、移す理由が無い |
| **エアコンの日別使用量（1時間ごと）** | **サブPC（ここ）** | クラウドAPI同士で完結し、ラズパイである必然性が無い |

エアコン関係が2箇所に分かれるため、AirCloud Home のクライアント実装もラズパイ側と
このディレクトリの2つある。**このディレクトリのクライアントは電気代の取得だけを持ち、
運転状態（`idu-list`）は移植していない。**

## aircon_energy_to_myroom.py

AirCloud Home から日別の電力使用量（kWh）と電気代（円）を取り、`POST /api/energy` へ送る。

- **エネルギー取得APIは期間の合計しか返さない**（`POST /rac/energy-consumptions/summary/v3?familyId=...`
  に `{"from": ..., "to": ...}` を渡す）。日別が要るので、**日付ごとに `from` と `to` に同じ日を入れて**引いている
- **応答には `energyConsumed`（kWh）だけでなく `cost`（円）も入っている。** これを `cost_yen` として
  送るので、エアコンの金額は MyRoom 側で単価を掛けた目安ではなく**白くまくんアプリと同じ実額**になる
  （`allRacsData.currency` が `JPY` 以外なら送らない）
- **同じ `(date, source)` は MyRoom 側で上書きされる。** 当日ぶんは1日のあいだ増えていくため、
  何度送っても二重計上にならない。既定では当日と前日の2日ぶんを送り直す（`ENERGY_DAYS`）
- 複数台ある場合は**全台の合計**を送る。1台だけにしたいときは `--unit`（`racName` か `vendorThingId`）
- レート制限（429）に当たったら、理由を出して終了コード1で終わる。次回の実行で取り直せばよい

### 依存

**`requests` だけ。** サブPCのシステムPython（3.12）に導入済みなので、venvを用意しなくても動く。
リポジトリの `venv/` はメインPCのpyenv（3.9.4）向けで、**サブPCでは壊れている**ので使わないこと。

`.env` の読み取りに `python-dotenv` は使っていない（サブPCに入っていないため、`KEY=value` を自前で読む）。

### 設定

`.env.example` を `collectors/.env` にコピーして実値を入れる（`.env` は gitignore 済み）。
実値は 1Password の `apps/MyRoom` から取る。リポジトリルートの `.env` も読むが、
`collectors/.env` のほうが優先される。

### 動作確認

```bash
cd ~/apps/myroom

# 登録されているエアコンの一覧
python3 collectors/aircon_energy_to_myroom.py --list-units

# 取得のみ（POSTしない）
python3 collectors/aircon_energy_to_myroom.py --dry-run --debug

# 未加工の応答（応答の形が想定と違うときの調査用）
python3 collectors/aircon_energy_to_myroom.py --dump-raw

# 特定の日だけ送り直す
python3 collectors/aircon_energy_to_myroom.py --date 2026-08-21

# 本番へ送る
python3 collectors/aircon_energy_to_myroom.py
```

> 調査元は海外向けホスト（`api-global-prod`）の Home Assistant 統合
> （[svmironov/aircloud_ha](https://github.com/svmironov/aircloud_ha)）。`api-kuma`（白くまくん＝国内向け）
> でも同じ形で通ることは確認済み。応答の形が変わった場合は `individualRacsData` が無いという
> エラーで止まるので、`--dump-raw` で実際の形を見ること。

### 収集が止まっていた期間を埋め直す

**毎時の実行が送るのは当日と前日の2日ぶんだけ**（`ENERGY_DAYS`）なので、収集や受け口が
半日以上止まると、その期間の日は**放っておいても埋まらない**。カードの「今月」「先月」の
合計からエアコンぶんが抜けたままになる（#204）。

AirCloud Home は過去の日付も返すので、`--days` で遡って送り直す。`(date, source)` は
上書きなので、すでに入っている日を含めても二重計上にならない。

```bash
cd ~/apps/myroom

# まず取れるか確認（POSTしない）
python3 collectors/aircon_energy_to_myroom.py --days 53 --dry-run

# 本番へ送る（日付ごとに1回・2秒間隔なので53日ぶんで2分ほどかかる）
python3 collectors/aircon_energy_to_myroom.py --days 53
```

- **カードが使うのは「先月1日」か「今日の29日前」の古いほうから今日まで**なので、
  月初なら60日ぶんほど遡れば足りる
- レート制限（429）に当たったら終了コード1で止まる。`--date` で日を分けるか、
  30分ほど空けてから残りの期間をやり直す

## tapo_to_myroom.py

Tapo スマートプラグ（P110系）の消費電力を LAN 内から読み、`POST /api/energy` へ送る（計測のみ）。
`python-kasa` が要るため、**専用の venv（`collectors/.venv-tapo/`）で動かす**
（`requirements-tapo.txt`）。設定は `tapo.env.example` を `collectors/.env` へ追記する。

```bash
cd ~/apps/myroom

# LAN 上の Tapo 機器を探して IP を調べる（初回の設定用）
# ここで IP を調べるのだから、TAPO_HOSTS はまだ空でよい（認証情報だけ要る）
collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --list-devices

# 読み取るだけ（POSTしない）
collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --dry-run -v

# 過去1か月ぶんを取り込む（プラグを増やしたとき・収集が長く止まったときに1度だけ）
collectors/.venv-tapo/bin/python collectors/tapo_to_myroom.py --days 31
```

### 過去ぶんはプラグ本体から取れる

**P110 系は日別の使用量をプラグ自身が覚えている。** `get_energy_data`（`interval=1440`）で
月初起点の 92 日ぶんが Wh の配列として返るため、収集を始める前の日や、収集が止まっていた
あいだの日も後から埋められる（#208）。

- 既定は `--days 3`（当日＋直近2日）。当日ぶんは1日のあいだ増えていくので、直近の確定値も
  送り直して最終値へ寄せる。**5分ごとの定期実行で毎回30行を書き直すのは重いので、
  1か月ぶんは既定にしない**
- **計測を始める前の日も `0` が返る。** 「まだ計測していない日」と「本当に0だった日」は
  区別できないため、返ってきた履歴全体で最初に0でなかった日より前は送らない
  （プラグを付ける前の日が0で埋まり、グラフが平らに伸びるのを防ぐ）。その日以降の0は
  「使わなかった日」として送る
- **瞬時電力（`power_w`）が付くのは当日ぶんだけ。** 過去ぶんは日別の積算しか残っていない
- `--days` の上限は 92（プラグが返す履歴の長さ）。それ以前の日は取得できない

### ディスカバリーの応答は ufw に落とされる

**`--list-devices` が0台になっても、プラグが応答していないとは限らない。**
ブロードキャスト（255.255.255.255）宛に投げた問い合わせへの応答は、送信元がプラグ個々の
IP になるため conntrack の ESTABLISHED に一致しない。サブPCは ufw が
`DEFAULT_INPUT_POLICY="DROP"` なので、応答は届いたそばから捨てられる（#199）。

```
[UFW BLOCK] IN=enp1s0 SRC=192.168.2.143 DST=192.168.2.167 PROTO=UDP SPT=20002 DPT=34149
```

- **ユニキャストなら通る。** そのため `--list-devices` はブロードキャストが空だったときに、
  同じサブネットを1台ずつ当たり直す（/24 でおよそ12秒。範囲は `--scan 192.168.2.0/23` で指定）
- **収集本体（`--dry-run`・定期実行）は最初からユニキャスト**なので、この状態でも普通に読める。
  ブロードキャストが0台でも、`TAPO_HOSTS` に IP さえ書いてあれば消費電力は取れる
- ufw 側で通すなら `ufw allow proto udp from <LAN>/24 port 20002`（送信元ポート指定）だが、
  ufw はサブPCのリポジトリで Git 管理していないため、今のところ手作業になる

### 読み終えたら必ず切断する

python-kasa の `Device` は aiohttp のセッションを握る。`disconnect()` せずに捨てると解放時に
`Unclosed client session` を **ERROR で** 吐き、送信自体は成功しているのに
`journalctl --user -u myroom-tapo-energy.service` では失敗に見える。`close_device()` を通すこと。

## 定期実行

ユニットは [`systemd/`](systemd/) にある。`aide` と同じく
**サブPCの `~/.config/systemd/user/` へ手でコピーする**（リポジトリからは自動反映されない）。

```bash
cp collectors/systemd/myroom-aircon-energy.service collectors/systemd/myroom-aircon-energy.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now myroom-aircon-energy.timer

systemctl --user list-timers myroom-aircon-energy.timer
journalctl --user -u myroom-aircon-energy.service -n 50
```

Tapo ぶん（5分ごと）も同じ手順で、ユニット名を `myroom-tapo-energy` に読み替える。
