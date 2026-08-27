#!/usr/bin/env node
/**
 * ビルド後に Service Worker のキャッシュ名へアプリバージョンを埋め込み、
 * あわせて配信物へ `version.json` を書き出す。
 *
 * `version.json` は動いているアプリが「新しいビルドが出ているか」を確かめるための
 * 唯一の手掛かり（`components/app-update-checker.tsx`）。**`out/` にだけ書く。**
 * `public/` にも置くとリポジトリにバージョンごとの差分が生まれるうえ、
 * 開発サーバーでは常に自分と同じ値が返るので意味が無い。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const cacheName = `myroom-shell-v${version.replace(/\./g, "-")}`;

for (const relativePath of ["public/sw.js", "out/sw.js"]) {
  const path = join(root, relativePath);
  try {
    const content = readFileSync(path, "utf8");
    const next = content.replace(
      /const CACHE_NAME = "[^"]+";/,
      `const CACHE_NAME = "${cacheName}";`
    );
    if (next === content) {
      console.warn(`CACHE_NAME marker not found in ${relativePath}`);
      continue;
    }
    writeFileSync(path, next, "utf8");
    console.log(`Updated ${relativePath} -> ${cacheName}`);
  } catch (error) {
    if (relativePath === "out/sw.js") {
      console.warn(`Skipped missing ${relativePath}: ${error.message}`);
    } else {
      throw error;
    }
  }
}

const versionJsonPath = join(root, "out/version.json");
try {
  writeFileSync(versionJsonPath, `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
  console.log(`Wrote out/version.json -> ${version}`);
} catch (error) {
  console.warn(`Skipped out/version.json: ${error.message}`);
}
