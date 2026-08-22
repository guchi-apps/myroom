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

CI（`.github/workflows/ci.yml`）は `backend`（Python 3.11）と `frontend`（Node 20）の
2ジョブに分かれている。**触った層のコマンドだけ実行すればよい。**

**`npm run lint` は CI で実行していない。** frontend ジョブが回すのは typecheck / test / build の3つだけ。
手元で lint を実行すると `react-hooks/refs`・「effect内の同期setState」のエラーが既存ファイル
（`use-chart-history.ts`・`device-detail-panel.tsx`・`outdoor-detail-panel.tsx` など）で十数件出るが、
**これは develop 時点からある。** 自分の変更が原因とは限らないので、件数を増やしていないかだけ見ればよい。

`npm run dev` は `frontend/` で `next dev --port 5173`。

**`npm run build` は `frontend/public/sw.js` を書き換える。** postbuild の
`scripts/sync-sw-cache.mjs` が `CACHE_NAME` を `package.json` の version に合わせるため、
検証目的でビルドしただけでも差分が出る。**リリース作業以外では、この差分をコミットに含めないこと。**

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

- 新しいテーブル・列を足すときは `migrate_db.py` に「存在チェック → 無ければ作る」の形で追記する
- **マイグレーション専用ユーザーにそのDBのGRANTが無ければ、上記を渡しても落ちる。**
  その場合はVPS上で管理者ユーザーからGRANTを1度だけ実行する必要がある（手作業。Git管理外）

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
- Secretsや環境変数（`.env.tpl`・1Password関連）
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
