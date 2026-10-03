#!/usr/bin/env node
/**
 * Импорт сгенерированных ассетов в public/assets и сборка manifest.json.
 *
 *   node scripts/assets/import.mjs            — скачать новые и пересобрать манифест
 *   node scripts/assets/import.mjs --force    — перекачать всё
 *
 * Источник — scripts/assets/sources.json (что откуда сгенерировано в Higgsfield).
 * Нужен ffmpeg в PATH.
 *
 * Обработка спрайтов персонажей и объектов:
 *  - срезается прозрачное поле под ногами, чтобы опорная точка (низ картинки) совпадала со ступнями;
 *  - ширина и верх кадра не меняются, все позы одного персонажа уменьшаются одинаково —
 *    поэтому персонаж не «прыгает» в размере при смене эмоции;
 *  - уменьшение до SPRITE_WIDTH по ширине и сжатие в WebP с прозрачностью.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "public/assets");
const sources = JSON.parse(fs.readFileSync(path.join(here, "sources.json"), "utf8"));
const force = process.argv.includes("--force");

const SPRITE_WIDTH = 440;
const BACKGROUND_WIDTH = 1920;

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} при загрузке ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function probe(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString();
  const [w, h] = out.trim().split(",").map(Number);
  return { w, h };
}

/** Последняя строка с непрозрачными пикселями (низ ступней). */
function lastOpaqueRow(file, w, h) {
  const alpha = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 24) return y;
  }
  return h - 1;
}

/** cropTop — доля высоты, отрезаемая сверху (например, кресло за столом судьи). */
function processSprite(src, dst, { cropTop = 0 } = {}) {
  const { w, h } = probe(src);
  const top = Math.round(h * cropTop);
  const bottom = Math.min(h, lastOpaqueRow(src, w, h) + 3);
  // WebP с альфой в ~9 раз легче PNG при неотличимом качестве
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `crop=${w}:${bottom - top}:0:${top},scale=${SPRITE_WIDTH}:-1:flags=lanczos`, "-c:v", "libwebp", "-quality", "88", "-pix_fmt", "yuva420p", dst]);
}

/**
 * Видео после удаления фона в Higgsfield приходит в MP4 (без альфа-канала) с чисто чёрным фоном.
 * Восстанавливаем прозрачность по яркости и пакуем в WebM VP9 с альфой.
 * Порог низкий: тёмная мантия судьи остаётся непрозрачной.
 */
function processVideo(src, dst) {
  const alpha = "clip((max(max(r(X,Y),g(X,Y)),b(X,Y))-3)*60,0,255)";
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", src,
    "-vf", `scale=416:-2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32", "-an", dst,
  ]);
}

function processBackground(src, dst) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `scale=${BACKGROUND_WIDTH}:-1:flags=lanczos`, "-q:v", "3", dst]);
}

const cacheDir = path.join(root, ".asset-cache");
fs.mkdirSync(cacheDir, { recursive: true });

async function fetchAsset(kind, url, rel, options = {}) {
  const dst = path.join(outDir, rel);
  if (fs.existsSync(dst) && !force) return rel;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const raw = path.join(cacheDir, `${url.split("/").pop()}`);
  if (!fs.existsSync(raw) || force) await download(url, raw);
  if (kind === "background") processBackground(raw, dst);
  else if (kind === "video") processVideo(raw, dst);
  else if (kind === "icon") execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-vf", "scale=512:512:flags=lanczos", dst]);
  else processSprite(raw, dst, options);
  console.log("  ✓", rel);
  return rel;
}

const manifest = { version: 1, backgrounds: {}, characters: {}, objects: {}, videos: {} };

for (const [key, url] of Object.entries(sources.backgrounds ?? {})) {
  manifest.backgrounds[key] = await fetchAsset("background", url, `bg/${key}.jpg`);
}
for (const [name, c] of Object.entries(sources.characters ?? {})) {
  const entry = { emotions: {}, walk: [], moods: {} };
  if (c.idle) entry.idle = await fetchAsset("sprite", c.idle, `characters/${name}/idle.webp`);
  for (const [emo, url] of Object.entries(c.emotions ?? {})) entry.emotions[emo] = await fetchAsset("sprite", url, `characters/${name}/${emo}.webp`);
  for (const [mood, url] of Object.entries(c.moods ?? {})) entry.moods[mood] = await fetchAsset("sprite", url, `characters/${name}/mood-${mood}.webp`);
  for (const [i, url] of (c.walk ?? []).entries()) entry.walk.push(await fetchAsset("sprite", url, `characters/${name}/walk-${i + 1}.webp`));
  manifest.characters[name] = entry;
}
// Объект — URL или { url, cropTop }. Один исходник можно разрезать на несколько объектов
// (например, перила ложи присяжных отдельно, чтобы они стояли перед присяжными).
for (const [name, src] of Object.entries(sources.objects ?? {})) {
  const { url, ...options } = typeof src === "string" ? { url: src } : src;
  manifest.objects[name] = await fetchAsset("sprite", url, `objects/${name}.webp`, options);
}
// Логотип — в public/assets, иконка приложения — по соглашению Next.js в src/app/icon.png
if (sources.brand?.logo) await fetchAsset("sprite", sources.brand.logo, "brand/logo.webp");
if (sources.brand?.icon) {
  const icon = await fetchAsset("icon", sources.brand.icon, "brand/icon.png");
  fs.copyFileSync(path.join(outDir, icon), path.join(root, "src/app/icon.png"));
}
for (const [name, url] of Object.entries(sources.videos ?? {})) {
  manifest.videos[name] = await fetchAsset("video", url, `video/${name}.webm`);
}

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json: ${Object.keys(manifest.characters).length} персонажей, ${Object.keys(manifest.objects).length} объектов`);
