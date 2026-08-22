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

AirCloud Home から日別の電力使用量（kWh）を取り、`POST /api/energy` へ送る。

- **エネルギー取得APIは期間の合計しか返さない**（`POST /rac/energy-consumptions/summary/v3?familyId=...`
  に `{"from": ..., "to": ...}` を渡す）。日別が要るので、**日付ごとに `from` と `to` に同じ日を入れて**引いている
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

> **`api-kuma`（白くまくん＝国内向け）でエネルギー取得APIが通るかは未確認。**
> 調査元は海外向けホスト（`api-global-prod`）の Home Assistant 統合
> （[svmironov/aircloud_ha](https://github.com/svmironov/aircloud_ha)）。応答の形が違った場合は
> `individualRacsData` が無いというエラーで止まるので、`--dump-raw` で実際の形を見ること。

## 定期実行

ユニットは [`../deployment/subpc/`](../deployment/subpc/) にある。`aide` と同じく
**サブPCの `~/.config/systemd/user/` へ手でコピーする**（リポジトリからは自動反映されない）。

```bash
cp deployment/subpc/myroom-aircon-energy.service deployment/subpc/myroom-aircon-energy.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now myroom-aircon-energy.timer

systemctl --user list-timers myroom-aircon-energy.timer
journalctl --user -u myroom-aircon-energy.service -n 50
```
