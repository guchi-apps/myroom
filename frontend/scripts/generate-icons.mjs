#!/usr/bin/env node
// assets/app-icon-source.svg から PWA / favicon の PNG を一括生成する。
//
// sharp は Next.js が連れてくる既存の依存なので、`npm ci` 済みなら追加インストールは要らない。
// 併存する generate-icons.py は PNG を入力に取る旧経路で、Pillow が必要（requirements には無い）。
// アイコンを作り直すときはこちらを使う。
//
//   node scripts/generate-icons.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_SVG = join(ROOT, "assets", "app-icon-source.svg");
const SOURCE_PNG = join(ROOT, "assets", "app-icon-source.png");
const PUBLIC_DIR = join(ROOT, "public");
const APP_DIR = join(ROOT, "app");

// SVG の intrinsic size は 512pt。density=144 で 1024px に解像する。
const MASTER = 1024;
const DENSITY = (72 * MASTER) / 512;

const OUTPUTS = [
  [join(PUBLIC_DIR, "icon-512.png"), 512],
  [join(PUBLIC_DIR, "icon-192.png"), 192],
  [join(PUBLIC_DIR, "apple-touch-icon.png"), 180],
  [join(PUBLIC_DIR, "favicon.png"), 32],
  [join(APP_DIR, "apple-icon.png"), 180],
  [join(APP_DIR, "icon.png"), 32],
];

const svg = await readFile(SOURCE_SVG);
const master = await sharp(svg, { density: DENSITY }).resize(MASTER, MASTER).png().toBuffer();

await mkdir(PUBLIC_DIR, { recursive: true });
await mkdir(APP_DIR, { recursive: true });

// 旧経路（generate-icons.py）の入力も同じ絵に揃えておく。
await writeFile(SOURCE_PNG, master);
console.log(`Wrote ${SOURCE_PNG} (${MASTER}x${MASTER})`);

for (const [path, size] of OUTPUTS) {
  await sharp(master).resize(size, size, { kernel: "lanczos3" }).png().toFile(path);
  console.log(`Wrote ${path} (${size}x${size})`);
}
