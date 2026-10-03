import type { AskRequest, ModelProvider, ProviderAdapter } from "./types";

/* ---------- Мок для тестов: ответы задаются функцией ---------- */

export type MockHandler = (req: AskRequest, callIndex: number) => string | Promise<string>;

export function mockModel(id: string, handler: MockHandler): ModelProvider & { calls: AskRequest[] } {
  const calls: AskRequest[] = [];
  return {
    id,
    label: id,
    capabilities: { images: true, video: true, pdf: true },
    calls,
    async ask(req) {
      calls.push(req);
      const out = await handler(req, calls.length - 1);
      req.onUsage?.({ inputTokens: 100, outputTokens: 50 });
      return out;
    },
    healthCheck: async () => ({ ok: true }),
  };
}

/** Название схемы ответа (title из zod .meta) — по нему мок понимает, что от него хотят. */
export function schemaTitle(req: AskRequest): string | undefined {
  return (req.jsonSchema as { title?: string } | undefined)?.title;
}

/* ---------- Демо-провайдер: правдоподобное заседание без реальных моделей ---------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length];
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const lastUser = (req: AskRequest) => req.messages.findLast((m) => m.role === "user")?.content ?? "";

function excerpt(req: AskRequest): string {
  // Материалы дела у выступающих — в общем системном промпте, у остальных — в сообщении
  const m = lastUser(req).match(/<<<\n([\s\S]*?)\n>>>/) ?? req.system.match(/<<<\n([\s\S]*?)\n>>>/);
  const text = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text || "материал";
}

const ROLE_BASE: Record<string, { base: number; emotions: string[] }> = {
  Прокурор: { base: 32, emotions: ["angry", "skeptical"] },
  "Адвокат защиты": { base: 80, emotions: ["confident", "laughing"] },
  Свидетель: { base: 58, emotions: ["thinking", "surprised"] },
  Присяжный: { base: 55, emotions: ["thinking", "skeptical", "calm"] },
};

function demoParticipant(req: AskRequest): object {
  const user = lastUser(req);
  // Роль и имя — в начале сообщения участника (системный промпт общий для всех)
  const name = user.match(/\*\*Имя:\*\* (.+)/)?.[1]?.trim() ?? "Участник";
  const role = user.match(/\*\*Твоя роль:\*\* (.+)/)?.[1]?.trim() ?? "Присяжный";
  const round = Number(user.match(/заседание №(\d+)/i)?.[1] ?? 1);
  const seed = hash(name);
  const { base, emotions } = ROLE_BASE[role] ?? ROLE_BASE["Присяжный"];
  const noise = (seed % 21) - 10;
  // От заседания к заседанию оценки сходятся к общему центру — как в настоящих прениях.
  const pull = 1 - 0.55 ** (round - 1);
  const score = clamp(base + noise + (60 - base - noise) * pull);
  const others = [...user.matchAll(/^### (.+?) — /gm)].map((m) => m[1]).filter((n) => n !== name);
  const target = others.length ? pick(others, seed + round) : undefined;
  const quote = excerpt(req);

  const lines: Record<string, string[]> = {
    Прокурор: [
      `Ваша честь, «${quote}» — это набор общих слов без внятного оффера. Клиент не поймёт, зачем ему это.`,
      `Протестую! Призыв к действию размыт, выгода не доказана, а конкурентов с таким же посылом — десятки.`,
    ],
    "Адвокат защиты": [
      `Уважаемый суд, в «${quote}» есть живая интонация и понятная выгода — это уже больше, чем у половины рынка.`,
      `Обвинение сгущает краски: материал цепляет эмоцию, а недочёты исправляются за вечер.`,
    ],
    Свидетель: [
      `Честно? Я бы задержал взгляд на «${quote}», но не уверен, что сразу понял, что мне предлагают.`,
      `Мне в целом откликается, но хочется увидеть цену и почему это лучше того, чем я пользуюсь сейчас.`,
    ],
    Присяжный: [
      `С профессиональной точки зрения у «${quote}» есть потенциал, но ему не хватает конкретики и доказательств.`,
      `Баланс аргументов пока в пользу доработки: идея рабочая, исполнение — на троечку с плюсом.`,
    ],
  };
  const stance = pick(lines[role] ?? lines["Присяжный"], seed + round);

  return {
    score,
    plan_quality: Math.min(100, score + 10),
    stance,
    speech: `${stance} Прошу занести в протокол: в заседании №${round} я оцениваю шансы на успех в ${score} из 100. ${
      target ? `Отвечаю коллеге ${target}: часть доводов принимаю, но главный вопрос остаётся открытым.` : ""
    } Это демо-реплика: подключите настоящего провайдера, чтобы суд спорил всерьёз.`,
    strengths: ["Понятная тема", "Эмоциональная подача"].slice(0, 1 + (seed % 2)),
    weaknesses: ["Нет конкретного оффера", "Слабый призыв к действию", "Не указана цена"].slice(0, 1 + (seed % 3)),
    audience_guess: [{ segment: pick(["Молодые специалисты", "Родители школьников", "Владельцы малого бизнеса"], seed), age_from: 25, age_to: 40 }],
    ...(round > 1 && target
      ? {
          responses_to_others: [{ participant: target, agree: seed % 2 === 0, argument: "Аргумент услышан, но не меняет сути." }],
          changed_score_because: "Аргументы оппонентов частично убедили меня скорректировать оценку.",
          reacts_to: target,
        }
      : {}),
    emotion: pick(emotions, seed + round),
    intensity: ((seed + round) % 3) + 1,
  };
}

function demoPrepare(req: AskRequest): object {
  const user = lastUser(req);
  const attachment = user.match(/## Вложение 1: «(.+?)» \((.+?)\)/);
  const quote = attachment ? attachment[1] : excerpt(req);
  // Тип материала — по первому вложению, чтобы в зале был подходящий подсудимый
  const materialType = attachment
    ? ({ видео: "video_ad", изображение: "image_ad", документ: "strategy" } as Record<string, string>)[attachment[2]] ?? "other"
    : "text_ad";
  return {
    title: `Дело о материале «${quote.split(" ").slice(0, 4).join(" ")}»`,
    material_type: materialType,
    summary: `Рекламный материал: «${quote}». Демо-режим — выжимку составил демо-секретарь без анализа.`,
    key_facts: ["Канал не указан", "Бюджет не указан"],
    prosecutor: { name: "Антон Строгий", character: "Циничный бывший арбитражник трафика, не верит обещаниям без цифр" },
    defense: { name: "Вера Надеждина", character: "Оптимистичный креативщик, видит потенциал даже в черновике" },
    witness: { name: "Ольга Покупаева", segment: "Городские работающие женщины", age: 34, character: "Занята, листает ленту между делами, ценит конкретику" },
    jurors: [
      { name: "Глеб Конверсин", specialization: "Performance-маркетолог", character: "Смотрит на CTR и стоимость лида" },
      { name: "Мария Брендова", specialization: "Бренд-стратег", character: "Следит за тоном и позиционированием" },
      { name: "Илья Копирайтов", specialization: "Копирайтер", character: "Придирается к каждому слову" },
    ],
  };
}

function demoDecision(req: AskRequest): object {
  const round = Number(req.system.match(/заседание №(\d+)/)?.[1] ?? 1);
  const fresh = round < 3;
  return {
    new_arguments: fresh,
    reason: fresh
      ? "Стороны представили новые доводы, суд готов выслушать прения."
      : "Стороны повторяют прежние тезисы. Слушания объявляются закрытыми.",
    established_facts: round > 1 ? ["Материалу не хватает конкретного оффера"] : [],
  };
}

function demoVerdict(req: AskRequest): object {
  const score = Number(req.system.match(/\*\*(\d+(?:\.\d+)?)\*\* из 100/)?.[1] ?? 50);
  // Апелляция: зафиксированная аудитория идёт первой
  const appeal = lastUser(req).match(/\*\*Аудитория:\*\* (.+?), (\d+)–(\d+) лет/);
  const outcome = score >= 70 ? "acquitted" : score >= 45 ? "conditional" : "guilty";
  const prior = req.system.match(/\*\*каждый\*\* из (\d+) прошлых советов/);
  return {
    confidence: "medium",
    outcome,
    verdict_speech:
      outcome === "acquitted"
        ? "Именем маркетинга! Суд, рассмотрев материалы дела, признаёт подсудимого невиновным в скучности. Выпустить в эфир немедленно!"
        : outcome === "conditional"
          ? "Именем маркетинга! Суд признаёт за подсудимым потенциал, но назначает ему исправительные правки. Условно, с доработками."
          : "Именем маркетинга! Суд признаёт подсудимого виновным в скучности и отправляет на доработку без права публикации.",
    verdict: `Итоговая оценка ${score} из 100. Это демо-вердикт: подключите реальные модели для настоящего разбора.`,
    audiences: [
      ...(appeal
        ? [{ segment: appeal[1], age_from: Number(appeal[2]), age_to: Number(appeal[3]), fit: 75, why: "Аудитория апелляции: материал доработан под неё" }]
        : []),
      { segment: "Городские работающие женщины", age_from: 28, age_to: 40, fit: 70, why: "Совпадают ценности и сценарий использования" },
      { segment: "Молодые специалисты", age_from: 22, age_to: 30, fit: 55, why: "Интересна тема, но не хватает конкретики" },
    ],
    improvements: [
      { change: "Добавить в заголовок конкретную выгоду с цифрой", why: "Конкретика повышает CTR", impact: "high", effort: "low", blocking: true },
      { change: "Сделать один ясный призыв к действию", why: "Сейчас непонятно, что делать дальше", impact: "high", effort: "low", blocking: false },
      { change: "Добавить социальное доказательство", why: "Снимает недоверие", impact: "medium", effort: "medium", blocking: false },
    ],
    risks: ["Нерелевантный охват при широком таргетинге"],
    dissent: ["Антон Строгий (прокурор): считает, что без оффера материал запускать нельзя"],
    ...(prior ? { prior_recommendations: demoPrior(Number(prior[1])) } : {}),
  };
}

/** Повторное рассмотрение: отчёт судьи по каждому прошлому совету. */
function demoPrior(count: number) {
  const positions = ["done", "kept", "revised"] as const;
  return Array.from({ length: count }, (_, i) => {
    const position = positions[i % positions.length];
    return {
      index: i + 1,
      position,
      explanation:
        position === "done"
          ? "Совет выполнен, суд считает его по-прежнему верным."
          : position === "kept"
            ? "Совет не выполнен и остаётся в силе."
            : "В прошлый раз суд советовал сделать это главным; теперь суд считает это второстепенным, потому что новая версия решила проблему иначе. Это демо-пояснение.",
    };
  });
}

function demoCompare(req: AskRequest): object {
  const recs = lastUser(req).match(/# Советы суда по прошлой версии\n\n([\s\S]*?)\n\n---/)?.[1] ?? "";
  const count = (recs.match(/^\d+\. /gm) ?? []).length;
  const statuses = ["implemented", "partial", "not_implemented"] as const;
  return {
    changes: ["Демо-сравнение: изменён заголовок", "Демо-сравнение: добавлен призыв к действию"],
    recommendations: Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      status: statuses[i % statuses.length],
      evidence: "Демо-секретарь не сравнивает версии по-настоящему.",
    })),
  };
}

function demoImage(req: AskRequest): object {
  const name = lastUser(req).match(/Файл: (.+)/)?.[1] ?? "изображение";
  return {
    description: `Демо-описание «${name}»: яркий рекламный креатив, в центре — продукт крупным планом, слева заголовок с оффером, внизу кнопка призыва к действию. Подключите настоящую модель, чтобы получить реальное описание.`,
    visible_text: "Скидка 20% · Заказать",
  };
}

function demoVideo(req: AskRequest): object {
  const name = lastUser(req).match(/Файл: (.+)/)?.[1] ?? "видео";
  const times = lastUser(req).match(/таймкоды\): (.+)/)?.[1]?.split(", ") ?? ["00:00", "00:03", "00:07", "00:12"];
  return {
    description: `Демо-разбор ролика «${name}»: динамичный монтаж, герой пробует продукт, в финале — логотип и оффер. Подключите Gemini или другую модель, чтобы получить реальный разбор.`,
    storyboard: times.map((t, i) => ({ time: t, description: ["Крупный план продукта", "Герой улыбается", "Текст оффера на экране", "Логотип и призыв к действию"][i % 4] })),
    transcript: lastUser(req).match(/Расшифровка речи:\n([\s\S]+)/)?.[1]?.trim() ?? "",
  };
}

export const demoAdapter: ProviderAdapter = {
  kind: "demo",
  title: "Демо (без модели)",
  capabilities: { images: true, video: true, pdf: true },
  createModel(config, modelId): ModelProvider {
    return {
      id: `${config.id}:${modelId}`,
      label: `${config.label} · ${modelId}`,
      capabilities: this.capabilities,
      healthCheck: async () => ({ ok: true }),
      async ask(req) {
        // Имитация задержки, чтобы в интерфейсе было видно ход заседания (VERDICT_DEMO_DELAY=0 — без задержки)
        const scale = Number(process.env.VERDICT_DEMO_DELAY ?? 1);
        await new Promise((r) => setTimeout(r, scale * (400 + (hash(req.system + lastUser(req)) % 1600))));
        const title = schemaTitle(req);
        const out =
          title === "participant_response"
            ? demoParticipant(req)
            : title === "secretary_prepare"
              ? demoPrepare(req)
              : title === "secretary_decision"
                ? demoDecision(req)
                : title === "judge_verdict"
                  ? demoVerdict(req)
                  : title === "image_description"
                    ? demoImage(req)
                    : title === "video_analysis"
                      ? demoVideo(req)
                      : title === "revision_compare"
                        ? demoCompare(req)
                        : { text: "Демо-провайдер не знает такой задачи" };
        req.onUsage?.({ inputTokens: Math.round(req.system.length / 3 + lastUser(req).length / 3), outputTokens: 400 });
        return JSON.stringify(out);
      },
    };
  },
  healthCheck: async () => ({ ok: true }),
  listModels: async () => [{ id: "demo", label: "Демо-модель" }],
};
