import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { setupTempDataDir } from "./helpers";

setupTempDataDir();
process.env.VERDICT_DEMO_DELAY = "0";
const { extractDocxText, extractPdfText, truncate } = await import("@/lib/materials/extract");
const ffmpeg = await import("@/lib/materials/ffmpeg");
const { processMaterials } = await import("@/lib/materials/process");
const { mockModel, schemaTitle } = await import("@/lib/providers/mock");
const { ProviderError } = await import("@/lib/providers/types");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-media-"));
const hasFfmpeg = await ffmpeg.hasFfmpeg();

/** Минимальный корректный PDF с одной строкой текста (смещения xref считаются честно). */
function makePdf(text: string): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const file = path.join(tmp, "doc.pdf");
  fs.writeFileSync(file, out, "latin1");
  return file;
}

async function makeDocx(paragraphs: string[]): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  const file = path.join(tmp, "doc.docx");
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

function makeVideo(): string {
  const file = path.join(tmp, "ad.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-shortest", "-pix_fmt", "yuv420p", file,
  ]);
  return file;
}

function makeImage(): string {
  const file = path.join(tmp, "banner.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=orange:s=2400x1200", "-frames:v", "1", file]);
  return file;
}

describe("извлечение текста", () => {
  it("PDF", async () => {
    expect(await extractPdfText(makePdf("Hello Verdict court"))).toContain("Hello Verdict court");
  });

  it("DOCX", async () => {
    const text = await extractDocxText(await makeDocx(["Стратегия продвижения", "Бюджет 100 000 рублей"]));
    expect(text).toContain("Стратегия продвижения");
    expect(text).toContain("Бюджет 100 000 рублей");
  });

  it("обрезает слишком длинные документы и чистит пустые строки", () => {
    expect(truncate("а\n\n\n\nб")).toEqual({ text: "а\n\nб", truncated: false });
    expect(truncate("x".repeat(100), 10)).toEqual({ text: "xxxxxxxxxx\n…", truncated: true });
  });
});

describe("ключевые кадры", () => {
  it("начало + смены сцен, не чаще раза в minGap, не больше max", () => {
    // 0.1 и 3.2 слишком близко к соседям; равномерная добивка до 4 кадров даёт 5 (2.5 и 7.5 — слишком близко)
    expect(ffmpeg.pickKeyframeTimes(10, [0.1, 3, 3.2, 7], 20)).toEqual([0, 3, 5, 7]);
    const many = ffmpeg.pickKeyframeTimes(600, Array.from({ length: 100 }, (_, i) => i * 6 + 1), 20);
    expect(many).toHaveLength(20);
    expect(many[0]).toBe(0);
  });

  it("таймкоды в формате ММ:СС", () => {
    expect(ffmpeg.formatTime(0)).toBe("00:00");
    expect(ffmpeg.formatTime(75.4)).toBe("01:15");
  });

  it.runIf(hasFfmpeg)("нарезает кадры и вынимает аудио из видео", async () => {
    const video = makeVideo();
    const frames = await ffmpeg.extractKeyframes(video, tmp, "t", 20);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.every((f) => fs.existsSync(f.file))).toBe(true);
    const audio = await ffmpeg.extractAudio(video, path.join(tmp, "a.mp3"));
    expect(audio && fs.statSync(audio).size).toBeGreaterThan(0);
  });
});

describe("обработка материалов дела", () => {
  const ref = (modelId: string) => ({ providerId: "p", modelId });
  const files = (list: { id: string; kind: "image" | "video" | "pdf" | "docx" | "text"; name: string; mime: string; path: string }[]) => ({
    views: list.map((f) => ({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: 1 })),
    paths: Object.fromEntries(list.map((f) => [f.id, f.path])),
  });

  it.runIf(hasFfmpeg)("картинка, документ, текст и видео без Gemini (кадры + расшифровка)", async () => {
    const txt = path.join(tmp, "note.txt");
    fs.writeFileSync(txt, "Слоган: кофе, который будит");
    const { views, paths } = files([
      { id: "img", kind: "image", name: "banner.png", mime: "image/png", path: makeImage() },
      { id: "pdf", kind: "pdf", name: "brief.pdf", mime: "application/pdf", path: makePdf("Media plan Q4") },
      { id: "txt", kind: "text", name: "note.txt", mime: "text/plain", path: txt },
      { id: "vid", kind: "video", name: "ad.mp4", mime: "video/mp4", path: makeVideo() },
    ]);
    const vision = mockModel("vision", (req) =>
      schemaTitle(req) === "image_description"
        ? JSON.stringify({ description: "Оранжевый фон", visible_text: "КУПИ" })
        : JSON.stringify({ description: "Тестовая таблица", storyboard: [{ time: "00:00", description: "Цветные полосы" }], transcript: "" }),
    );
    const progress: string[] = [];
    const out = await processMaterials("case-1", views, "Для Instagram", {
      getModel: () => vision,
      vision: ref("vision"),
      video: null,
      transcribe: async () => "Привет, это реклама",
      ffmpeg: true,
      filePath: (id) => paths[id],
      onProgress: (t) => progress.push(t),
    });

    expect(out.extraText).toContain("кофе, который будит");
    const [img, pdf, vid] = out.media;
    expect(img).toMatchObject({ kind: "image", description: "Оранжевый фон\n\nТекст на изображении: КУПИ" });
    expect(img.frames).toEqual(["img-image.jpg"]);
    expect(pdf).toMatchObject({ kind: "document" });
    expect(pdf.text).toContain("Media plan Q4");
    expect(vid.transcript).toBe("Привет, это реклама");
    expect(vid.storyboard).toHaveLength(1);
    expect(vid.frames.length).toBeGreaterThan(0);
    expect(vid.frames.length).toBeLessThanOrEqual(4);
    // Модель со зрением получила картинку и кадры, а в запросе — расшифровку речи
    const videoCall = vision.calls.find((c) => schemaTitle(c) === "video_analysis")!;
    expect(videoCall.attachments!.length).toBeGreaterThan(0);
    expect(videoCall.messages[0].content).toContain("Привет, это реклама");
    expect(progress.some((p) => p.includes("Расшифровываем"))).toBe(true);
  });

  it.runIf(hasFfmpeg)("видео анализирует Gemini; при его ошибке — запасной путь по кадрам", async () => {
    const { views, paths } = files([{ id: "v2", kind: "video", name: "ad.mp4", mime: "video/mp4", path: makeVideo() }]);
    const gemini = mockModel("gemini", () =>
      JSON.stringify({ description: "Нативный разбор", storyboard: [{ time: "00:02", description: "Полосы" }], transcript: "Речь" }),
    );
    const deps = {
      getModel: (r: { modelId: string }) => (r.modelId === "gemini" ? gemini : broken),
      vision: ref("vision"),
      video: ref("gemini"),
      transcribe: null,
      ffmpeg: true,
      filePath: (id: string) => paths[id],
      onProgress: () => {},
    };
    const broken = mockModel("vision", () => {
      throw new ProviderError("не должна вызываться", false);
    });
    const ok = await processMaterials("case-2", views, "", deps);
    expect(ok.media[0]).toMatchObject({ description: "Нативный разбор", transcript: "Речь" });
    expect(gemini.calls[0].attachments![0]).toMatchObject({ kind: "video", filePath: paths.v2 });

    // Gemini падает → кадры описывает модель со зрением, а речь не расшифрована (нет OpenAI)
    const failing = mockModel("gemini", () => {
      throw new ProviderError("квота", false);
    });
    const vision = mockModel("vision", () => JSON.stringify({ description: "По кадрам", storyboard: [], transcript: "" }));
    const fallback = await processMaterials("case-3", views, "", {
      ...deps,
      getModel: (r: { modelId: string }) => (r.modelId === "gemini" ? failing : vision),
    });
    expect(fallback.media[0].description).toBe("По кадрам");
    expect(fallback.media[0].warnings.join(" ")).toMatch(/Gemini не смог/);
    expect(fallback.media[0].warnings.join(" ")).toMatch(/Речь не расшифрована/);
  });

  it("сломанный файл не роняет обработку остальных", async () => {
    const { views, paths } = files([
      { id: "bad", kind: "pdf", name: "broken.pdf", mime: "application/pdf", path: path.join(tmp, "missing.pdf") },
      { id: "ok", kind: "pdf", name: "ok.pdf", mime: "application/pdf", path: makePdf("Still works") },
    ]);
    const out = await processMaterials("case-4", views, "", {
      getModel: () => mockModel("x", () => "{}"),
      vision: ref("x"),
      video: null,
      transcribe: null,
      ffmpeg: hasFfmpeg,
      filePath: (id) => paths[id],
      onProgress: () => {},
    });
    expect(out.media[0].warnings[0]).toMatch(/Не удалось обработать/);
    expect(out.media[1].text).toContain("Still works");
  });
});
