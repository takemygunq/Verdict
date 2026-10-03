import { z } from "zod";
import { listCaseFiles, type CaseFileView } from "../materials/files";
import { getCase, listAppeals, listRevisions, rootCaseId, updateCase, type CaseView } from "../store/cases";
import { listProviders } from "../store/providers";
import { getSettings } from "../store/settings";
import { estimateTokens, type TokenEstimate } from "./estimate";
import { findRevisionCandidate, type RevisionCandidate } from "./revision";
import { CaseStateError } from "./runner";
import { caseFileSchema, participantSchema, type Participant } from "./schemas";

/** Коротко о связанном деле: для ссылок «исходное дело» и списка апелляций */
export interface CaseLink {
  id: string;
  title: string;
  status: CaseView["status"];
  appeal: CaseView["appeal"];
  score: number | null;
  outcome: NonNullable<CaseView["verdict"]>["outcome"] | null;
}

export interface CaseDetails {
  case: CaseView;
  estimate: TokenEstimate | null;
  files: CaseFileView[];
  parent: CaseLink | null;
  appeals: CaseLink[];
  /** Повторное рассмотрение: прошлая версия (если не удалена) и более новые версии */
  previous: CaseLink | null;
  newerVersions: CaseLink[];
  /** Похожее дело из архива — предложить связать как новую версию (до заседания) */
  revisionCandidate: RevisionCandidate | null;
}

export function caseLink(c: CaseView): CaseLink {
  return {
    id: c.id,
    title: c.caseFile?.title ?? c.materialText.slice(0, 80),
    status: c.status,
    appeal: c.appeal,
    score: c.verdict?.success_score ?? null,
    outcome: c.verdict?.outcome ?? null,
  };
}

export function caseDetails(id: string): CaseDetails {
  const c = getCase(id);
  return {
    case: c,
    estimate: c.caseFile && c.participants ? estimateTokens(c.caseFile, c.participants, getSettings()) : null,
    files: listCaseFiles(rootCaseId(id)),
    parent: c.parentId ? caseLink(getCase(c.parentId)) : null,
    appeals: listAppeals(id).map(caseLink),
    previous: c.previousId ? caseLink(getCase(c.previousId)) : null,
    newerVersions: listRevisions(id).map(caseLink),
    revisionCandidate: c.status === "ready" ? findRevisionCandidate(c) : null,
  };
}

const ONE_EACH = ["secretary", "judge", "prosecutor", "defense", "witness"] as const;

/** Состав суда: по одному на каждую ключевую роль, 2–4 присяжных, у всех назначена существующая модель. */
export const rosterSchema = z.array(participantSchema).superRefine((list, ctx) => {
  for (const role of ONE_EACH) {
    const count = list.filter((p) => p.role === role).length;
    if (count !== 1) ctx.addIssue({ code: "custom", message: `Роль «${role}» должна быть ровно одна (сейчас ${count})` });
  }
  const jurors = list.filter((p) => p.role === "juror").length;
  if (jurors < 2 || jurors > 4) ctx.addIssue({ code: "custom", message: `Присяжных должно быть от 2 до 4 (сейчас ${jurors})` });
  const ids = new Set(list.map((p) => p.id));
  if (ids.size !== list.length) ctx.addIssue({ code: "custom", message: "Повторяются идентификаторы участников" });
  const names = new Set(list.map((p) => p.name.toLowerCase()));
  if (names.size !== list.length) ctx.addIssue({ code: "custom", message: "Имена участников должны быть разными" });
});

export const casePatchSchema = z.object({
  caseFile: caseFileSchema.optional(),
  participants: rosterSchema.optional(),
});

export function patchCase(id: string, input: z.input<typeof casePatchSchema>): CaseDetails {
  const patch = casePatchSchema.parse(input);
  const c = getCase(id);
  if (c.status === "running" || c.status === "preparing" || c.status === "draft") {
    throw new CaseStateError("Сейчас дело нельзя редактировать");
  }
  if (patch.participants) assertModelsExist(patch.participants);
  updateCase(id, patch);
  return caseDetails(id);
}

function assertModelsExist(participants: Participant[]) {
  const providers = new Map(listProviders().map((p) => [p.id, p]));
  for (const p of participants) {
    if (!p.model) throw new CaseStateError(`Участнику «${p.name}» не назначена модель`);
    const provider = providers.get(p.model.providerId);
    if (!provider) throw new CaseStateError(`Провайдер модели участника «${p.name}» удалён`);
    if (!provider.enabled) throw new CaseStateError(`Провайдер «${provider.label}» выключен (участник «${p.name}»)`);
  }
}
