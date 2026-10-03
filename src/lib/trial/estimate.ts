import { renderCaseFile } from "./prompts";
import { isDebater, type CaseFile, type Participant } from "./schemas";
import type { TrialSettings } from "./engine";

export interface TokenEstimate {
  /** Если слушания закроются после минимума заседаний. cached — сколько входа могут прочитать из кэша провайдера */
  min: { input: number; output: number; cached: number };
  /** Если дойдут до максимума */
  max: { input: number; output: number; cached: number };
}

// Грубые константы: ~3 символа кириллицы на токен, ответы участников ~600 токенов.
const CHARS_PER_TOKEN = 3;
const SYSTEM = 900;
const SPEECH_OUT = 600;
const SPEECH_IN_CONTEXT = 350;
const DECISION_OUT = 120;
const VERDICT_OUT = 1500;

/** Примерный расход токенов на всё заседание — чтобы было видно до запуска. */
export function estimateTokens(caseFile: CaseFile, participants: Participant[], s: Pick<TrialSettings, "minRounds" | "maxRounds">): TokenEstimate {
  const debaters = participants.filter(isDebater);
  const n = debaters.length;
  // Общий системный промпт (правила + материалы) кэшируется на каждой модели после первого запроса
  const models = new Set(debaters.map((d) => (d.model ? `${d.model.providerId}:${d.model.modelId}` : d.id))).size;
  const caseTokens = Math.ceil(renderCaseFile(caseFile).length / CHARS_PER_TOKEN);

  const forRounds = (rounds: number) => {
    let input = 0;
    let output = 0;
    for (let r = 1; r <= rounds; r++) {
      const debateContext = r === 1 ? 150 : n * SPEECH_IN_CONTEXT + 400;
      input += n * (SYSTEM + caseTokens + debateContext);
      output += n * SPEECH_OUT;
      input += SYSTEM + caseTokens + n * SPEECH_IN_CONTEXT; // решение секретаря
      output += DECISION_OUT;
    }
    input += SYSTEM + caseTokens + rounds * n * (SPEECH_IN_CONTEXT + 100); // судья
    output += VERDICT_OUT;
    const cached = Math.max(0, n * rounds - models) * (SYSTEM + caseTokens);
    return { input, output, cached };
  };

  return { min: forRounds(s.minRounds), max: forRounds(s.maxRounds) };
}
