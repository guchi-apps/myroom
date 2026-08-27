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
