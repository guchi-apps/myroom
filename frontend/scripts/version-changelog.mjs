#!/usr/bin/env node
/**
 * npm version の lifecycle 用: APP_CHANGELOG 先頭に新バージョンのエントリを追加する。
 *
 * リリース自動化ワークフロー（release-develop-to-main.yml）は、developへ取り込まれた
 * 差分から利用者向けの更新履歴を生成し、環境変数 RELEASE_CHANGELOG で渡してくる。
 * 設定されていればその内容を changes へ反映する。未設定・空のとき（画面で体感できる
 * 変化が無いリリースや、ローカルで `npm version` を叩いた場合など）はエントリを作らない。
 * 仮の文言だけのエントリを作ると誰も埋めないまま更新履歴の画面に残り続けるため
 * （#446）。バージョンだけが上がる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = join(__dirname, "../lib/changelog.ts");

/**
 * RELEASE_CHANGELOG の文面を changes 配列へ整形する。
 * 生成される文面は箇条書き・段落のどちらもありうるため、行単位に分解し、
 * 箇条書き記号と番号を落として1行1項目にそろえる。
 */
export function parseReleaseChangelog(raw) {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, "").trim())
    .filter((line) => line !== "");
}

// changes は生成された文面をそのまま埋め込むため、TypeScriptの文字列リテラルを
// 壊さないようにエスケープする。
function escapeForTs(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function insertChangelogEntry(content, version, date, changes = []) {
  if (content.includes(`version: "${version}"`)) {
    return { content, inserted: false, reason: "exists" };
  }

  const marker = "export const APP_CHANGELOG: ChangelogEntry[] = [";
  const index = content.indexOf(marker);
  if (index === -1) {
    throw new Error("APP_CHANGELOG marker not found in changelog.ts");
  }

  // マーカーの検査を先に済ませる: 空でも、更新履歴の形が壊れていることは失敗として気付く。
  if (changes.length === 0) {
    return { content, inserted: false, reason: "empty" };
  }

  const insertAt = index + marker.length;
  const entry = `
  {
    version: "${version}",
    date: "${date}",
    changes: [
${changes.map((item) => `      "${escapeForTs(item)}",`).join("\n")}
    ],
  },`;

  return {
    content: `${content.slice(0, insertAt)}${entry}${content.slice(insertAt)}`,
    inserted: true,
  };
}

function todayJst() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    new Date()
  );
}

function main() {
  const version = process.env.npm_package_version;
  if (!version) {
    throw new Error("npm_package_version is not set (run via npm version)");
  }

  const changes = parseReleaseChangelog(process.env.RELEASE_CHANGELOG);
  const original = readFileSync(changelogPath, "utf8");
  const { content, inserted, reason } = insertChangelogEntry(
    original,
    version,
    todayJst(),
    changes
  );

  if (!inserted) {
    console.log(
      reason === "empty"
        ? `No changes for v${version} (RELEASE_CHANGELOG is empty); not adding a changelog entry.`
        : `changelog.ts already has version ${version}; skipping.`
    );
    return;
  }

  writeFileSync(changelogPath, content, "utf8");
  console.log(
    `Added changelog entry for v${version} (${changes.length} change(s))`
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main();
}
