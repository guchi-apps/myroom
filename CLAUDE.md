# myroom 固有ルール

このリポジトリで作業する Claude Code エージェント向けのルールを記載する。

**GitHub Actions 上での実行は、このリポジトリをチェックアウトしたワークツリーしか参照できない。**
したがって無人実行でも守られる必要があるルールは、このファイルに明文化しておく必要がある。

## このリポジトリの作り

**Python バックエンド + Node フロントエンドの2層構成。** どこでコマンドを打つかが層ごとに違う。

| 層 | 場所 | 依存 |
|---|---|---|
| バックエンド | **リポジトリルート** | `requirements.txt` / `requirements-dev.txt`（pip） |
| フロントエンド | **`frontend/`** | `frontend/package.json` / `frontend/package-lock.json`（npm） |

**ルートの `package.json` はバージョン管理用のscriptだけで、依存を持たない。**
`package-lock.json` も空のスタブ（`"packages": {}`）。**ここで `npm ci` しても何も入らない。**

### 検証コマンド

**`cd frontend` を忘れるとフロントエンドのコマンドは動かない。**

| 目的 | コマンド | 実行場所 |
|---|---|---|
| バックエンドのテスト | `pytest tests/ -q`（環境変数 `DB_MOCK=true`） | ルート |
| バックエンドの依存 | `pip install -r requirements-dev.txt` | ルート |
| フロントエンドの型チェック | `npm run typecheck` | **`frontend/`** |
| フロントエンドのテスト | `npm run test`（vitest） | **`frontend/`** |
| フロントエンドのビルド | `npm run build` | **`frontend/`** |
| フロントエンドのLint | `npm run lint` | **`frontend/`** |
| フロントエンドの依存 | `npm ci` | **`frontend/`** |

**リポジトリ直下の `venv/` は触らないこと。** `.gitignore` に `venv/` と書かれているが、
**このディレクトリは既に Git 管理下にある**（6,400ファイル超）。`.gitignore` は追跡済みの
ファイルには効かないため、作り直すと数千ファイルの差分がコミット候補に並ぶ。しかも中身の
`python3` は存在しない `~/.pyenv/versions/3.9.4` を指す壊れた symlink で、**素の worktree では
そのまま実行できない。** バックエンドのテストを回すときは、リポジトリの外
（セッションのスクラッチパッドなど）に別の venv を作って
`pip install -r requirements-dev.txt` してから `pytest` を実行する。

**新しく作った worktree では、まず `cd frontend && npm ci` から始めること。**
issue-deck のランチャーが「依存インストール済み」と伝えてくる場合でも、それが見ているのは
リポジトリルートで、ルートには実質の依存が無い（`package-lock.json` は空のスタブ）。
`frontend/node_modules` は空のままなので、`npm run test` は
`Cannot find module 'vitest/config'` で落ちる。**なお、ルートで `npm install` 系を実行すると
空のスタブだった `package-lock.json` に `packages` が書き足されて差分が出る。**
コミットに含めないこと。

**バックエンドを触るなら、Python環境も自分で作ること。** サブPCには `pytest` も `pip` も
素では入っていない（`python3 -m pip` すら無い）。**リポジトリルートに `venv/` があっても信用しない。**
`.gitignore` 済みで中身は各ホストの残骸であり、実際に存在しない pyenv（`/home/guchi/.pyenv/versions/3.9.4`）を
指したまま壊れていることがある。`venv/bin/python` はシンボリックリンクとして見えるのに
`No such file or directory` で落ちる。作り直すなら worktree の外（スクラッチ領域）に置く。

```bash
python3 -m venv /tmp/<任意>/pyenv
/tmp/<任意>/pyenv/bin/pip install -r requirements-dev.txt
DB_MOCK=true /tmp/<任意>/pyenv/bin/python -m pytest tests/ -q
```

CI（`.github/workflows/ci.yml`）は `backend`（Python 3.11）と `frontend`（Node 20）の
2ジョブに分かれている。**触った層のコマンドだけ実行すればよい。**

**`npm run lint` は CI で実行していない。** frontend ジョブが回すのは typecheck / test / build の3つだけ。
手元で lint を実行すると `react-hooks/refs`・「effect内の同期setState」のエラーが既存ファイル
（`use-chart-history.ts`・`device-detail-panel.tsx`・`outdoor-detail-panel.tsx` など）で十数件出るが、
**これは develop 時点からある。** 自分の変更が原因とは限らないので、件数を増やしていないかだけ見ればよい。

**アイコンをデータに応じて動的に選ぶ実装は`react-hooks/refs`系の`error`（"Cannot create components
during render"）を新たに踏みやすい。** `const Icon = pickIcon(...)`のように選んだコンポーネントを
変数へ入れてから`<Icon .../>`とJSXタグにする書き方は、"レンダー中にコンポーネントを生成している"と
静的解析され`error`になる（#308の天気アイコン選択で発生）。**`switch`で各アイコンを`<Sun .../>`の
ように直接JSXとして返す形にすれば起きない**（変数を経由しないため）。同じ理由で、この変換元の
関数（`pickIcon`自体）はコンポーネントではなく素の値を返す関数として残し、JSXを返す側だけ分ける
とよい（`frontend/lib/weather-icon.tsx`の`getWeatherIcon()`と`WeatherIcon`の分け方）。

`npm run dev` は `frontend/` で `next dev --port 5173`。**worktree ごとのポートは
envファイルに入っていない。** 別ポートで立てるなら
`cd frontend && npx next dev --port <ポート>` のようにその場で渡す
（ルートには `dev` script が無く、`npm run dev` は `Missing script: "dev"` で落ちる）。

**テストで `disabled` を確かめるときは `disabled=""` で照合する。** フロントのテストは
`renderToStaticMarkup` の文字列を見ているが、Tailwind の `disabled:opacity-30` のような
バリアントが `class` に入るため、`toContain("disabled")` は押せるボタンにも通ってしまう
（#269）。

**`npm run build` は `frontend/public/sw.js` を書き換える。** postbuild の
`scripts/sync-sw-cache.mjs` が `CACHE_NAME` を `package.json` の version に合わせるため、
検証目的でビルドしただけでも差分が出る。**リリース作業以外では、この差分をコミットに含めないこと。**

## アプリの自動更新（`version.json`）

**動いているアプリが新しいビルドに気付くための正は `out/version.json`。** 同じ postbuild の
`scripts/sync-sw-cache.mjs` が `frontend/package.json` の version を書き出し、
`components/app-update-checker.tsx` が10分ごとと画面復帰時に `cache: "no-store"` で読む（#277）。
バックグラウンドから戻ったときは読み込み画面を出してそのままリロードし、開きっぱなしのときは
バナーを出して押されるのを待つ。

- **`/version.json` を Service Worker のキャッシュ対象に入れないこと。** `public/sw.js` の
  `fetch` ハンドラで `/api/` と同じように素通しさせている。一度でもキャッシュに載ると古い値を
  返し続け、**アプリは永久に更新へ気付けない**（症状は「ビルドしてデプロイしたのに画面が変わらない」）
- **`public/version.json` は作らないこと。** バージョンごとの差分がリポジトリに出るうえ、
  開発サーバーでは常に自分と同じ値が返るので意味が無い。書き出すのは `out/` だけでよい
- **配信漏れは404にならない。** `backend/main.py` の `serve_frontend` は見つからないパスに
  `index.html` を200で返すため、`version.json` が無いと「HTMLが返り `res.json()` が失敗し、
  握り潰されて自動更新が黙って止まる」。そのため `sync-sw-cache.mjs` は `out/` があるのに
  書けなければ**落とし**、取得側は `content-type` がJSONかを確かめて `console.warn` を出す
- **未保存の編集を抱える画面では、復帰時の自動リロードを止める。** このアプリの設定シートは
  閉じるまで保存しないので、`lib/unsaved-edits.ts` の `useUnsavedEdits()` を呼んで印を立てる
  （掃除の設定・電気の操作の設定・`/devices`）。**新しく「保存ボタンを押すまで書かない」画面を
  足したら、そこでも呼ぶこと。** 忘れると、編集中に別アプリへ行って戻っただけで入力が消える
- 静的書き出しなのでバックエンドに `/api/app-version` のようなエンドポイントは要らない

## 認証状態と起動時の画面

**`output: "export"` の静的書き出しなので、クライアントコンポーネントの `useState` 初期値は
そのまま `out/index.html` に焼き込まれる。** `lib/use-auth.ts` の `isAuthenticated` を
`false`（未ログイン）で始めると、書き出されたHTMLにログイン画面が入り、`getSession()` が
解決するまでの数百msだけログイン済みのユーザーにもログイン画面が見える（#250）。
**判定中は `null` にして、`resolveAuthGate()` で読み込み画面に倒すこと。**

確認は `npm run build` 後に `grep -o "Googleでログイン" out/index.html` が空になることで足りる
（開発サーバーの `curl http://localhost:13250/` でも同じHTMLが返る）。

起動直後の画面（読み込み中・ログイン）は `components/app-entry-screen.tsx` の
`AppEntryScreen` にアイコン・アプリ名・説明文の配置を固定し、下段のブロックだけを差し替える。
片方だけ余白を変えると、切り替わった瞬間に要素が飛び跳ねる。

## 設定への入口

**設定を開くボタンは `components/ui/settings-icon-button.tsx` に統一する**（#277）。
文字ラベルは出さず、`label` が `aria-label` と `title` の両方に入る。**位置だけが意味を分ける。**

- ヘッダー右上（`tone="header"`・枠付き）＝ アプリ全体の設定。再読み込み・ログアウト・
  バージョンは `components/app-settings-sheet.tsx` に入っており、**ページ末尾にフッターは無い**
- セクション見出し・カード見出し（既定の `tone="inline"`）＝ その場の設定

新しく設定の入口を足すときは、独自にボタンを組まずこのコンポーネントを使う。

**セクションの設定は、そのセクションの見出しから開く**（#283）。`/devices`（いまの環境の設定）は
センサー・屋外・エアコンだけを扱い、**暮らしの設定は置かない。** 暮らしのカードの並び順と表示は
ダッシュボードの「暮らし」の見出しにある設定アイコン（`components/life-settings-sheet.tsx`）から
変える。同じ設定を2か所に置くと片方が古くなるので、入口は1つに保つこと。

**カードを全部隠せるセクションでは、見出しと設定アイコンを残す。** 節ごと消すと、隠したあとで
戻す入口が画面から無くなる（暮らしは空のときだけ「表示するカードがありません」を出す）。

暮らしの並び順は `app_settings` の `life_card_order`（キーの配列）で、**どのカードが存在するかの正は
`lib/dashboard-sections.ts` の `LIFE_CARDS`。** バックエンドには既定の並びを持たせず、知らないキーを
落として足りないキーを末尾へ足すのは `lib/life-card-order.ts` が行う。カードを1枚増やしたときに
「並べ替え済みの人にだけ出ない」を避けるための分担なので、両側に一覧を持たせないこと。

## 読み込み表示（スケルトン）

**シート・パネルの読み込み表示は、実データと同じ骨格・同じ高さで作る**（#329）。このアプリの
ボトムシート（`components/power-detail-panel.tsx`など）は高さが中身で決まるため、3本線だけの
簡素なスケルトンを出すと**シートが画面の下端まで縮み、データ到着でまた最大高へ戻る**。
利用者にはこの上下動が「ちらつき」として見える。

- 消費電力の詳細では`components/power-skeleton.tsx`にタイル・棒グラフ・一覧行の骨格を置き、
  日別（デバイス選択後）と時間ごとの両方で使い回している。**行数は取得前に分からないので、
  親がすでに持っている件数（`breakdown.daily.length`）を借りて高さを近づける**
- **骨格は`.skeleton-delayed`（`app/globals.css`）で150ms遅らせてフェードインさせる。**
  枠は最初から置くので高さは確保されたまま、取得がすぐ終わるときは骨格そのものが見えない。
  **点滅（`animate-pulse`）と同じ要素に付けないこと**——どちらも`animation`を使うため片方が消える
- **取り直しの失敗でエラー表示へ倒さない。** すでに取れている内容があるなら出し続ける
  （`error && !summary`で判定）。取得済みの内容をシートを開いているあいだ覚えておくと、
  別の対象を見てから戻ったときに読み込み表示そのものを挟まずに済む

## 設定の数値入力欄

**`type="number"` の入力欄を「変更のたびに保存」でつながないこと**（#348）。通知設定の室温・湿度の
閾値がこの形になっており、**数字がまともに打てなかった。** 原因は3つ重なっている。

- **`disabled={saving}` が入力中に効く。** 1文字打つたびに保存が走って入力欄が `disabled` になり、
  ブラウザがフォーカスを外す。**2文字目以降が入らない**のはこれ
- **`Number(event.target.value)` は空欄を `0` にする。** 全部消して打ち直そうとした瞬間に `0` が
  保存され、`"-"` や `"18."` のような入力途中の文字列は `NaN` になる
- **中途半端な値がバックエンドの正規化に当たる。** `ui_settings.py` の
  `_normalize_room_anomaly_thresholds()` は `min >= max` を**既定値（16/30）へ丸ごと落とす**ため、
  上限を `25` にしようとして `2` まで打った時点で両方が既定へ戻る

**下書きは文字列で持ち、確定は `onBlur`（と Enter）だけにする。** `drafts[key] ?? String(保存済みの値)`
を `value` に出す形にすれば、下書きを effect で詰め直さずに済む（`react-hooks/set-state-in-effect`
を増やさない）。確定時に数値へ変換し、読めない文字列は保存せず保存済みの値へ戻す。
**入力欄からは `disabled={saving}` を外す**（確定はフォーカスを抜けた後なので入力を邪魔しない）。
`min >= max` のような組み合わせの不正はフロントで弾いてメッセージを出す——バックエンドに任せると
「既定値へ戻る」という結果だけが返り、理由が画面に出ない。

## アプリアイコン

**アイコンの正は `frontend/assets/app-icon-source.svg`。** ここを編集して
`cd frontend && node scripts/generate-icons.mjs` を実行すると、`public/` の
`icon-512.png` / `icon-192.png` / `apple-touch-icon.png` / `favicon.png` と
`app/apple-icon.png` / `app/icon.png`、それに旧経路の入力である
`assets/app-icon-source.png`（1024px）がまとめて書き出される。

ラスタライズには **sharp** を使う。これは Next.js が連れてくる既存の依存なので、
`npm ci` 済みなら追加インストールは要らない。

**`frontend/scripts/generate-icons.py` は旧経路。** PNG を入力に取る Pillow 版だが、
**Pillow は `requirements.txt` にも `requirements-dev.txt` にも入っていない。**
素の worktree では動かないので、アイコンを作り直すときは `.mjs` のほうを使う。

**`manifest.json` の `icon-512.png` には `purpose: "maskable"` が付いている。**
Android は中央80%の円で切り抜くため、絵柄は中心 (256,256)・半径 204.8 の円に収める。
はみ出すと端が欠ける。

## 本番DBのマイグレーション

**テーブルや列を増やす変更（`migrate_db.py` へのDDL追加）は、本番の「アプリ用DBユーザー」では実行できない。**
本番は共有MariaDBで、アプリ用ユーザー（`SHARED_DB_USER`）には
`SELECT / INSERT / UPDATE / DELETE` しか付いていない。DDLを含むマイグレーションをそのまま流すと
`CREATE command denied` / `ALTER command denied`（MySQLエラー1142）でデプロイが落ちる（#193）。

そのため `deploy.yml` は、**マイグレーション専用ユーザー**（organization secret の
`SHARED_DB_MIGRATE_USER` / `SHARED_DB_MIGRATE_PASSWORD`）を `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`
として `migrate_db.py` の実行時にだけ渡す。**この値は本番の `.env` には書かない**
（常時稼働するバックエンドにDDL権限を持たせないため）。`migrate_db.py` はこの2つが空なら
アプリ用ユーザーへフォールバックする。

**その前に、`app_settings` テーブル（`setting_key` varchar(64) / `setting_value` TEXT）で足りないかを
必ず検討すること。** 画面から編集する設定や、件数がせいぜい数十件で1行の JSON に収まるデータは、
新しいテーブルを作らずにここへキーを1つ足すだけで持てる。**DDL が無ければ上記の権限問題を
そもそも踏まない。** 既存の設定なら `backend/ui_settings.py` にキーと正規化関数を1つ足せば済む
（#262 の `remote_button_defs` / `remote_catalog` がこの形）。

**`ui_settings.py` にキーを足すときは、同じファイルの3か所すべてに書くこと。**
`_default_settings()`・`_normalize_settings()`・**`save_settings()` の `merged` 辞書**の3つで、
最後の1つを忘れると GET では正しく返るのに、**別の設定を保存した瞬間に既定値へ戻る**
（`save_settings` は `merged` に並べたキーだけを引き継ぐため）。テストは「そのキーを保存 → 別の
キーだけを保存 → 取り直して残っているか」の形にしないとこの抜けを拾えない（#258 の
`light_thresholds`）。`PUT /api/ui-settings` を通すには `backend/main.py` の
`UiSettingsUpdate` にもフィールドが要る。まとまった機能なら `backend/cleaning.py`
のように専用モジュールで読み書きしてもよい（掃除の予定と実施履歴・`cleaning_tasks`、#259）。
どちらもマイグレーションを1行も足さずに追加できた。`setting_value` は `Text`（64KB）なので、
数百KBになるものだけは別の置き場を考える。時系列で伸び続けるもの・期間で絞って引くものは
この器に向かないので、そのときは下記に従ってテーブルを足す。

- 新しいテーブル・列を足すときは `migrate_db.py` に「存在チェック → 無ければ作る」の形で追記する
- **マイグレーション専用ユーザーにそのDBのGRANTが無ければ、上記を渡しても落ちる。**
  その場合はVPS上で管理者ユーザーからGRANTを1度だけ実行する必要がある（手作業。Git管理外）

**`app_settings` に入っているJSONの形を変えるときは、読み取り時に古い形も受けて移行する。**
DDLもデータの一括書き換えも要らず、本番の権限問題（上記）をそもそも踏まない。掃除の実施履歴を
`["2026-08-30"]` から `[{"date": …, "recorded_at": …}]` へ変えたとき（#294）は、
`backend/cleaning.py` の `_normalize_history()` が文字列の要素も受けて足りない項目を補う形にした。
**移行スクリプトを書いて既存の行を書き換える形にはしないこと**（本番と手元で実行のタイミングが
揃わず、片方だけ新しい形になる）。テストは「古い形を読める」ことを1件、独立して残す。

**単一オブジェクトを複数件の配列へ広げるときも同じ考え方が使える。** 屋外の地点データを
1件から複数件へ広げたとき（#308）、`outdoor_location`キーの値を`{"latitude", "longitude", "name"}`から
`{"locations": [...], "primary_id": "..."}`へ変えた。`backend/outdoor_config.py`の`_parse_state()`は
「`locations`配列を持つ新形式」「`latitude`を直接持つ旧形式（1件だけの配列＋そのIDを基準地点として
扱う）」の両方を読み、どちらの場合も既存データを失わない。**複数地点を扱うAPI・地点選択のUIを
足す一方で、推移グラフ・表示順序・チャート色設定は「屋外は1件」という前提のまま変えなかった**
（display-order.ts・chart-colors.tsを地点ごとに複数持たせる形にすると改修範囲が全面改修になるため）。
グラフに出すのは常に基準地点で、他の地点は屋外詳細パネル内の切り替えタブから選ぶと、その地点の
今の天気・推移グラフだけが差し替わる（`weather.get_coords()`が`location_id`省略時に基準地点へ
フォールバックする形にしてある）。

**カードも地点ごとに1枚並べるようにしたのが#321。** 並び順（`display_order`）と非表示
（`hidden_devices`）のキーを`outdoor`から**`outdoor:<地点ID>`**へ広げた。移行はフロントの
読み込み時に行い、DDLもデータの書き換えもしていない。

- **旧`outdoor`のキーは「基準地点」として読み替える**（`lib/display-order.ts`の
  `resolveOutdoorOrderItem()`・`lib/visible-devices.ts`の`normalizeHiddenDeviceKeys()`）。
  **`backend/ui_settings.py`は1行も変えていない**——`_normalize_display_order()`は任意の文字列を
  素通しするため、`outdoor:<id>`はそのまま往復する。`DEFAULT_DISPLAY_ORDER`に残る`"outdoor"`は
  保存のたび末尾へ足されるが、読み込み時に基準地点へ読み替えられて重複として落ちる
- **推移グラフの屋外ラインとグラフ色は基準地点の1本のまま**（#308の判断を引き継ぐ）。
  `applyHiddenDevicesToLineVisibility()`には**基準地点のキー**を第4引数で渡す。
  ここを地点ごとに増やすと`/api/history`のレスポンス形・凡例・色設定まで波及する
- 地点の数だけ`/api/outdoor-locations/{id}/weather`を叩かずに済むよう
  `GET /api/outdoor-locations/weather`（全地点ぶん）を足した。`weather.get_outdoor_weather()`の
  座標ごとのキャッシュ（5分）に乗るので、外部APIの呼び出し回数は増えない
- **`normalizeDisplayOrder()`はダッシュボードのレンダー時にも通す。** 地点を足した直後は
  保存済みの並びにその地点が無く、設定を取り直さないとカードが出ないため

**シートの下書きはeffectで詰め直さない。** 開いた地点の値をフォームへ入れるのに
`useEffect(() => setForm(...), [open, location])`と書くと`react-hooks/set-state-in-effect`の
**error**が1件増える。呼び出し側が「開いているあいだだけ描く＋`key`に地点IDを渡す」形にして、
`useState`の初期値で作れば増えない（`components/outdoor-location-sheet.tsx`と
`device-visibility-page.tsx`の呼び出し）。

## 収集スクリプトの再送信を時系列データのポーリングに使う（電気代・時間ごと表示）

**「時間ごと」のような、より細かい粒度の表示が要るとき、収集スクリプト自体を変更しなくてよい
ことがある。** `collectors/aircon_energy_to_myroom.py` は1時間ごと、`collectors/tapo_to_myroom.py`
は5分ごとに systemd timer から実行され、そのたびに「当日ぶんの累計」を `/api/energy` へ
POST し直している（`daily_energy` は同じ `(date, source)` を上書きする設計のため）。
この**受信そのものがすでに一定間隔のポーリングになっている**ので、時間ごと表示（#300）は
収集スクリプトを変えず、バックエンド側で受信のたびに「その時点までの当日累計」を
追記専用の新テーブル（`energy_readings`）へ書き足すだけで実現できた
（`backend/energy.py` の `upsert_records(..., now=...)`）。時間帯ごとの使用量は隣接する
スナップショットの差分から出す（`build_hourly`）。

- **収集頻度がそのまま得られる時間粒度の上限になる。** エアコン側は1時間おきの受信なので、
  「◯時台の使用量」はポーリング時刻に依存する近似値になる。秒単位の正確さが要るなら
  収集頻度そのものを上げる必要がある
- **過去分は遡れない。** この方式は「受信を記録し始めた時点から先」のログしか作れない。
  機能をリリースする前の日は時間ごとのデータが存在しないため、無ければ「記録がありません」と
  出す（過去分を埋め直す移行スクリプトは書かない）
- 同じ考え方が使える場面: 取得元がすでに周期実行されていて、かつ「今の値」だけでなく
  「時間の推移」を新しく見せたいとき。逆に、取得元の実行頻度が要求粒度より粗い場合
  （例: 1日1回しか叩けない外部APIから時間ごとを作りたい場合）は使えない

## 保存していない「疑似 source」を集計のたびに組み立てる（消費電力の「その他」）

**消費電力の「その他」（KEPCO実測 − 機器の実測）は、どのテーブルにも保存していない。**
`kepco_hourly_usage`（時間ごとの実測）だけを持ち、差分は `backend/energy.py` の
`build_hourly`（時間ごと・#302）と `build_breakdown`（日別・#319）が算出のたびに組み立てる。
**日別のために日別テーブルを足す必要はない**——`_fetch_kepco_daily()` が同じ器を
`SUM(kwh) GROUP BY date` で引くだけで済む（マイグレーションが1行も要らない）。

- **フロントで「その一覧に無い取得元」が落ちないかを確かめる。** 積み上げの組み立ては
  `buildEnergyStackSegments`（日別）と `buildEnergyHourlyColumns`（時間ごと）の2か所にあり、
  **`breakdown.sources`（機器の一覧）を起点に回すと疑似 source は黙って消える。**
  `by_source` のキーを起点にし、`sources` に無いものを後ろへ回す形にすること（#319）
- **疑似 source を `sources` へ足さないこと。** あの一覧は押すと `/api/energy/summary?source=…`
  で機器ごとの推移が開くボタンで、`daily_energy` に行が無い「その他」は必ず空になる。
  代わりに一覧の下へ「その他 = …」の注記を出す（`KepcoOtherNote`）
- **期間合計（今月・先月）には混ぜない。** KEPCOのCSVは直近1か月強しか落とせないため、
  混ぜると取り込んだ範囲によって「先月」の金額が動く。**タイルの合計と日別行の合計は
  一致しない**が、これは意図した状態

## 取得元の表示名は「別名」で持ち、`source` は変えない（消費電力）

**`daily_energy` の主キーは `(date, source)` で、`source` そのものが表示名の出どころ**
（`tapo:冷蔵庫` → `冷蔵庫`）。スマートプラグの名前はTapoアプリで付けたものが
`collectors/tapo_to_myroom.py` の `device.alias` 経由でここに入っている
（`TAPO_HOSTS` に `192.168.2.21=冷蔵庫` と書くとそちらが優先される）。
**名前を変えたいときに `source` を書き換えないこと**——`(date, source)` が別物になり、
過去の使用量・時間ごとの記録（`energy_readings`）と切れる。

- 別名は `app_settings` の `energy_source_names`（`{"tapo:冷蔵庫": "キッチンの冷蔵庫"}`）に
  持つ（#335）。**マイグレーションは1行も要らない**
- **ラベルを決める関数は2つに分ける。** `energy.source_label()` は既定の名前（`source` から
  導ける純関数）、`energy.resolve_source_label(source, overrides)` が別名を優先する。
  `build_breakdown` は `label`（別名を当てたあと）と `default_label`（当てる前）の両方を返す。
  設定画面が「Tapoの名前」を出すのと、上書き中かどうかの判定に `default_label` を使う
- **画面の入口は消費電力の詳細パネルのヘッダー1か所。** 消費電力カードはカード全体が詳細を
  開くボタンなので、カード見出しの中に `SettingsIconButton` を置けない
- **Tapo側で名前を変えると新しい取得元として現れる。** 別名は付け直しになる（記録は
  古い `source` に残り、繋がらない）。アプリ側で名前を変える経路を用意してあるのはこのため

## 掃除記録の「掃除した日」と「登録した日時」

**実施履歴の1件は `{"date": "掃除した日", "recorded_at": "アプリへ登録した日時"}` で、この2つは
別の値**（#294）。当日に押し忘れて翌日に前日ぶんを登録できるようにするための分けかたで、
**最終掃除日・次にやる日・一覧・履歴の表示はすべて `date` を見る。** `recorded_at` は
「いつ入力したか」を後から辿るためだけに持ち、古い記録では `null` になる。

- **未来の日付は `backend/main.py` の `_parse_cleaning_done_date()` が400で弾く。**
  `_normalize_history()` も未来日を落とすが、そちらに任せると「押したのに履歴が増えない」に
  見えるだけで理由が返らない
- **日付は文字列のまま扱い、`new Date(...)` で解釈し直さない。** フロントは
  `frontend/lib/cleaning.ts` の `shiftDate()`（UTC正午で数える）を使い、`recorded_at` の表示は
  サーバーが返したJSTの文字列を `T` で切って組み立てる。端末の時計で解釈すると1日ずれる
- 日付を間違えて登録したときの直し方は `DELETE /api/cleaning/tasks/{id}/done/{date}` で1件消して
  入れ直す形だけ。履歴を直接書き換える口は作らない（`recorded_at` が実態とずれるため）

## Notionへの書き出し（ゴミの収集日・掃除）

**日付プロパティに時刻を入れると、dayspan のカレンダーはその時刻の位置に出す。** 終日エリアと
時間グリッドの振り分けは時刻の有無だけで決まる（dayspan#483）。ゴミの収集日は
`backend/garbage_notion.py` が `data/garbage.json` の `collection_time`（既定 08:30）を足して
`2026-09-01T08:30:00+09:00` の形で書く（#296）。**オフセットを省かないこと**——省くと Notion 側が
閲覧者のタイムゾーンで解釈する。

- **照合キーは日付だけに保ち、時刻の差は「更新」で直す。** キーへ時刻まで入れると、収集時刻を
  変えたときに同じ日のページがアーカイブ＋再作成になり、Notion 側の並びが入れ替わる。
  `parse_page()` は照合用の `date`（`[:10]`）と、書かれたままの `start` を両方返し、
  `plan_changes()` が `start` の差を更新の理由として拾う。**この形なら、時刻を書くようになる前の
  ページも次の同期で自動的に直る**（移行スクリプトも手作業も要らない）
- **日付プロパティの値を文字列のまま比べないこと。** Notion が返す値は書き込んだ文字列と
  1バイトずつ同じとは限らず（ミリ秒が付く・オフセットの書き方が変わる）、文字列比較にすると
  毎回「変わった」と判定して同期のたびに全件を更新してしまう。`datetime.fromisoformat()` に
  通して同じ時点かで比べる（`garbage_notion._same_instant()`）
- 掃除の書き出し（`backend/cleaning_notion.py`）は別モジュールで、いまは日付のみを書いている。
  同じ扱いにするなら両方を直す必要がある

## data/ 配下のファイルはデプロイで上書きされる

**`deploy.yml` の rsync は `data` を除外していない。** リポジトリに含まれる
`data/*.json`（`remote.json`・`garbage.json` など）は、デプロイのたびに**リポジトリの中身で
本番が上書きされる**。

- **利用者が画面から書き換えるものを `data/` に置かない。** 書けたように見えても次のデプロイで消える
  （#262。`data/remote.json` は `"groups": []` のままリポジトリにあり、本番の「電気の操作」カードが
  ずっと未設定だった）。画面から書き換える値は `app_settings`（DB）へ置く
- `data/` に残してよいのは、**リポジトリが正の初期値・定義**だけ。読む側は「DBに保存済みなら
  そちらを使い、まだ無ければファイルを読む」の形にして、保存済みかどうかを区別できるようにする
  （空の保存とファイル未保存を同じ扱いにすると、画面から消したものがデプロイで復活する）
- **手で書くファイルの時刻値を `datetime.time.fromisoformat()` で受けないこと。** 時は0詰め必須で、
  `"9:15"` は `ValueError` になる（`"08:30"` は通るので、既定値だけを試すと気付かない）。
  `":"` で割って `int()` する形にして、`f"{hour:02d}:{minute:02d}"` へ揃えて持つ
  （#270 の `collection_time`）

## デプロイの値の取得先

**ワークフローは実行時に1Passwordを呼ばない。** 以前は実行のたびに `1password/load-secrets-action`
で読んでいたが、1Passwordサービスアカウントの日次レート制限（**1Passwordアカウント全体で
1,000リクエスト/日**。サービスアカウントを分けても分割されない）を使い切り、フリート全体の
デプロイが止まった（guchi-apps/issue-deck#1302・#1307）。実行時の取得先はGitHubの
secret / variable で、1Passwordは「人が管理する唯一の正」として残す。

**どの値をGitHubのどこから取るかの正は `.github/secrets-manifest.tsv`。**
`SCOPE` が `inherit` の行はorganizationの共通値（このリポジトリでは同期しない）、
`repo` の行はこのリポジトリのsecret。

- **デプロイで使う値を増やすときは、まずマニフェストに行を足す。**
  `deploy.yml` の `env:` ブロックは `scripts/generate-workflow-env-block.sh` で生成する。
  ワークフローに直接書き足すとマニフェストと食い違う
- **順序は「値の投入 → ワークフロー切り替え」。** 投入前にワークフローを切り替えるとデプロイが失敗する
- 1Password側の値を変えたときだけGitHubへ同期する（デプロイのたびには実行しない）。
  `sync-secrets.yml` を `workflow_dispatch` で起こすか、手元で `scripts/sync-github-secrets.sh` を実行する。
  **後者は個人アカウントのセッションが必要**（サービスアカウントではGitHubへ書き込めない）
- `OP_SERVICE_ACCOUNT_TOKEN` のrepository secretは残してある。使うのは上記の同期のときだけで、
  デプロイでは使わない
- **secretの値は必ず1行に収める。** `deploy.yml`の`sync_env_var`は`printf '%s=%s\n'`で本番の
  `.env`へ書くため、改行を含む値（PEM・秘密鍵・JSON）を入れると`.env`の書式そのものが壊れ、
  python-dotenvが2行目以降を**別のキー**として読む（#337でVAPID秘密鍵に実際に該当した）。
  複数行になる値は、base64などの1行の表現に直してから1Passwordへ入れること
- **`provision-secret.sh --from-stdin` へ値をパイプで渡さない。** 必ずファイルへ書いて
  `< ファイル` でリダイレクトする（#343）。スクリプトは値を読んだあともstdinをそのまま
  引き継ぎ、`op item edit` / `op item create` は**stdinがパイプだと中身をJSONのアイテム
  テンプレートとして読む**ため、空になったパイプで`op: [ERROR] invalid JSON provided`と
  なって落ちる。**このときスクリプトは「トークンに write_items があるかを疑ってください」と
  出すが、権限とは無関係**（`op whoami`は通る）。通常ファイル・端末・`/dev/null`がstdinなら
  opはこの解釈をしない。手順は`README.md`の「VAPID 鍵の初回登録」を参照

## デプロイ後のヘルスチェック

`deploy.yml` の `Restart Backend Service` は `pm2 save` のあとに
`http://127.0.0.1:8000/api/health` を **2秒間隔・最大30回（60秒）** 叩き、成功したら `exit 0`、
60秒たっても成功しなければ `pm2 describe` / `pm2 logs` を出して `exit 1` する。
**固定の `sleep` 1回に戻さないこと**（起動が間に合わないだけで赤くなる／即死していても緑で終わる。#205）。

**このステップのヒアドキュメントは `<< EOF`（クォート無し）。** リモートで評価してほしい
`$` はすべて `\$` でエスケープする。忘れるとGitHub Actionsのランナー側で展開され、
リモートには展開済みの文字列が渡る（`\$(seq 1 30)` を素で書くとループが壊れる）。

**リモートが実際に受け取る文字列は、ローカルで確認できる。** `run:` を取り出して
`ssh ... bash -s <<` を `cat <<` へ差し替えて実行すれば、展開後のスクリプトがそのまま出る。
`bash -n` に通せば構文も確認できる。

## 本番デプロイが起動しないとき

**mainへマージしたのに「Deploy to Production」が1件も作られないことがある。** 実測で
`deploy.yml`導入後のmainへのマージ55件中1件（#315のv4.8.0）。原因はGitHub側のイベント
取りこぼしで、**このリポジトリの設定では直せない**（設定で決められるのは「届いたイベントに
どう反応するか」だけで、今回はイベント自体が届いていない）。

- **見分け方はマージコミットのcheck-suiteが0件かどうか。** 正常時はマージの2〜5秒後に2件
  作られる。0件なら、そのpushに対してGitHubがワークフローを1つも作っていない。**`push`
  だけが落ちるのではなく、`issue-labels.yml`の`pull_request(closed)`も同時に落ちる**ので、
  トリガーを書き足しても救えない

  ```bash
  gh api repos/guchi-apps/myroom/commits/<マージコミット>/check-suites --jq .total_count
  ```

- **`.github/workflows/deploy-watchdog.yml`が拾って起動し直す。** mainのHEADの**tree**と
  `deploy.yml`直近成功実行のtreeを比べ、一致するものが無ければ`deploy.yml`を`--ref main`で
  起動する。**`schedule`だけには頼れない**——このリポジトリの`*/15`は実測で1日5〜8回しか
  起動していない（期待96回）。そのため`workflow_run`（`CI`・`Issue Progress`の完了）にも
  相乗りさせている
- **手で起動するときは必ず`--ref main`にする。** リリースブランチのref（例:
  `release-main/v4.8.0`）から起動すると`deploy.yml`の`tag`ジョブが`v<version>`をmain上に
  無いコミットへ付けてしまい、**以後mainから起動したデプロイはタグ検証で必ず失敗する**
  （`Tag v4.8.0 already exists on ...`で`tag`がexit 1し、`deploy`はskipされる。#315で実際に
  起きた。次のバージョンへ上がるまで解消しない）

  ```bash
  gh workflow run deploy.yml --repo guchi-apps/myroom --ref main
  ```

- `deploy-retry.yml`は**起動したデプロイが失敗したとき**に1回だけ再実行する仕組みで、
  **そもそも起動しなかったとき**には何もしない。役割が違うので混同しない

## マルチエージェント運用（GitHub Actions 無人実行）

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成までを GitHub Actions 上で無人実行する。
ワークフローの実体は `guchi-apps/issue-deck` にあり、このリポジトリの `.github/workflows/` には
`uses:` で参照する薄い caller だけを置いている（タグは全 caller で揃える。現在は `@workflows/v23`）。

| ファイル | 役割 |
|---|---|
| `claude-issue-dispatch.yml` | `@claude` 起点の無人実行（計画提示・実装・PR作成・質問応答） |
| `issue-labels.yml` | Issueの進捗（Project Status）の状態遷移 |
| `claude-conflict-resolve.yml` | develop向けPRが `develop` とコンフリクトした際の無人解消 |

### 無人実行で使える環境

**`claude-issue-dispatch.yml` は `runtime-setup: minimal` を指定している。** 準備ステップは全てリポジトリルートで動くが、
ルートに実質の依存が無いため意味が無い。**依存のインストールは実装エージェント自身が行う。**

- フロントエンドを触るなら `cd frontend && npm ci`
- バックエンドを触るなら `pip install -r requirements-dev.txt`

`claude-conflict-resolve.yml` だけは `runtime-setup: node` + `install-dependencies: false` にしている
（CI と同じ Node 20 のセットアップだけ行い、意味の無いルートでの `npm ci` は行わない）。
こちらも依存のインストールはエージェント自身が `cd frontend && npm ci` から始める。

**Python のバージョンは固定されない。** CI は `setup-python` で 3.11 に固定しているが、
共有ワークフローに Python のプリセットは無く、実装ステップは**ランナー標準の Python** を使う。
バージョン依存の挙動に当たった場合は、無理に回避せず `00.check-user` を付けて相談すること。

**`24.screenshot-required` は無人実行では成立しない。** `minimal` のため Playwright が
インストールされない。ローカル実行でのみ意味を持つラベルとして扱う。

設計・運用の詳細は issue-deck 側を参照する。

- 進捗管理の設計: [progress-status-architecture.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/progress-status-architecture.md)
- 無人実行の挙動: [multi-agent/dispatch.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/multi-agent/dispatch.md)

**`/install-github-app` を実行しないこと。** 生成される素の `claude.yml` は
`claude-issue-dispatch.yml` と同じ `issue_comment` イベントで起動するため、1つのコメントで
Claude が二重に走る（`subscription-lists` で実際に起きた）。

### `.shared-context/` と `.shared-prompts/`

無人実行のたびにワークツリーへcheckoutされる**リポジトリ管理外**のディレクトリ。
`.gitignore` 済み。**編集・`git add`・コミットを一切行わないこと。**

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ。**デフォルトブランチは `develop`**（`issues`・`issue_comment`
  イベントはデフォルトブランチのワークフローしか起動しないため、変更すると無人実行が動かなくなる）
- Issue専用ブランチは `develop` から作成し、ブランチ名は **`issue-<Issue番号>`** とする（例: `issue-111`）。
  ワークフローはブランチ名から対象Issueを特定するため、**この命名規約に従わないブランチはすべて対象外**になる

## Issueの進捗

**進捗は GitHub Projects の Status で管理する。進捗ラベルは存在しない**
（issue-deck#1010 / #991 Phase 5 で `01.wip`〜`09.main` を廃止した）。

1. `Ready` — 未着手
2. `Planning` — 計画検討中（`21.plan-required` 選択時のみ経由）
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへPR作成・マージ中
7. `Done` — mainへマージ完了。この時点でissueをcloseする

**`gh issue edit` で進捗を進めることはできない。** Status を書けるのは issue-deck だけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、エージェントが自分で進捗を動かす必要はない。

## 条件を表すラベル（進捗とは別軸）

| ラベル | 意味 |
|---|---|
| `00.check-user` | ユーザーの確認・指示が必要。どの段階でも併用する |
| `00.qa-answered` | 質問への回答のみ完了（`00.check-user` と常に併用） |
| `11.local` | ローカル（VSCode等）で対応中。付いている間は無人実行を起動しない |
| `21.plan-required` | 実装前に計画を提示し承認を得る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーでの画面確認を必須にする |
| `24.screenshot-required` | PR作成前にスクリーンショット取得を必須にする（**無人実行では成立しない**） |

## 自動マージ不可カテゴリ

以下に該当する変更は自動マージせず `00.check-user` を付与してユーザーの確認を待つ。

- 認証・認可
- DBスキーマ変更・マイグレーション（`init_db.py`・`migrate_db.py`）
- 本番環境の設定（`deployment/`・`ecosystem.config.js`）
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.github/secrets-manifest.tsv`・1Password関連）
- 大規模な依存関係の更新（`requirements.txt`・`frontend/package.json`）
- `develop` → `main` のマージ

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチの編集
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- `.shared-context/` / `.shared-prompts/` の編集・コミット

## コミット・PR・コメントの書き方

- コミットメッセージ・PRタイトル・PR本文・issueコメントは**日本語**で書く
- コミットの author は `Claude Code <claude-code@example.com>` にする
- `develop` 宛のPR本文には、対応Issue・実装内容・テスト内容・確認方法・注意点を記載する。
  developマージ時点ではissueをcloseしない運用のため、`closes #番号` / `fixes #番号` は使わず
  `#番号` のみ記載する

## 依存関係の追加

新しい依存関係（`requirements.txt`・`frontend/package.json` のいずれも）を追加する前には、
必ずユーザーに確認を取る。無人実行では確認相手がいないため、追加が必要だと判断した場合は
追加せずに作業を止め、`00.check-user` を付与したうえでなぜ必要かをIssueコメントで相談する。
