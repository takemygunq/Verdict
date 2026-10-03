# Ассеты сцены

Всё здесь сгенерировано в Higgsfield и собрано скриптом — руками файлы не правятся.

- **Источник:** `scripts/assets/sources.json` — что из чего сгенерировано (ссылки на результаты Higgsfield).
- **Импорт:** `node scripts/assets/import.mjs` (нужен ffmpeg) — скачивает, обрабатывает и пишет `manifest.json`.
  С флагом `--force` перекачивает всё заново.

Обработка при импорте:
- персонажи и объекты — обрезка пустого поля под ногами, ширина 440 px, WebP с прозрачностью;
- `cropTop` у объекта отрезает верх (кресло за столом судьи; перила ложи присяжных — отдельный спрайт `jury-box-front`);
- фоны — JPEG 1920 px;
- видео — после удаления фона в Higgsfield приходят в MP4 с чёрным фоном, прозрачность восстанавливается
  по яркости, результат — WebM VP9 с альфой (Chrome, Firefox, Edge; в Safari видео не показывается, сцена работает без него);
- иконка приложения копируется в `src/app/icon.png`.

Если ассета нет в манифесте, сцена рисует заглушку, поэтому любой файл можно убрать или заменить, не трогая код.

## Ключи манифеста

**Персонажи:** `judge`, `secretary`, `prosecutor`, `defense`, `witness` (+ необязательный `witness-female`),
`juror-1`…`juror-6`, `defendant-film`, `defendant-scroll`, `defendant-folder`, `defendant-frame`.
У каждого: `idle`, `emotions` (`confident`, `angry`, `skeptical`, `surprised`, `laughing`, `thinking`, `sad`; `calm` = `idle`),
`walk` (кадры ходьбы, персонаж смотрит вправо), у подсудимых — `moods` (`ecstatic`, `happy`, `nervous`, `sweating`).

Присяжным спрайт подбирается по полу, угаданному по имени: мужчины — `juror-1`, `juror-4`, `juror-5`,
женщины — `juror-2`, `juror-3`, `juror-6` (см. `JUROR_SPRITES` в `src/lib/scene/layout.ts`).

**Объекты:** `judge-bench`, `secretary-desk`, `witness-stand`, `podium`, `counsel-table`, `dock`,
`jury-box`, `jury-box-front`, `gallery-bench`, `gavel`, `verdict-plaque`.

**Фоны:** `default` (пустой зал, пол начинается на ~30% высоты), `verdict` (тот же зал с прожектором).

**Видео:** `gavel` (крупный план удара молотка), `verdict` (судья объявляет вердикт).

Персонажи рисуются с опорной точкой посередине снизу (ноги), фон сцены — 1280×720.
