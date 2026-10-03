# Промпты Verdict

Все системные промпты и шаблоны сообщений. Файлы перечитываются при каждом вызове модели —
правки применяются сразу, без перезапуска приложения.

Подстановки пишутся как `{{имя}}`. Если в шаблоне есть подстановка, которую код не передаёт,
вызов упадёт с понятной ошибкой — так опечатки не уйдут в модель молча.

| Файл | Кто использует | Подстановки |
|---|---|---|
| `secretary-prepare.md` | секретарь, подготовка дела | — |
| `secretary-decision.md` | секретарь, решение после заседания | `round`, `std`, `threshold`, `outcome_rules` (исход по регламенту, посчитанный кодом заранее), `max_facts` |
| `participant.md` | системный промпт всех выступающих: правила, состав суда, материалы дела. Одинаковый у всех — провайдеры его кэшируют | `roster`, `case` |
| `participant-persona.md` | начало сообщения участника: роль, имя, характер | `role_title`, `name`, `specialization`, `character`, `role_instructions` |
| `role-prosecutor.md`, `role-defense.md`, `role-witness.md`, `role-juror.md` | дополнения к роли | — |
| `round-blind.md` | сообщение участнику в заседании №1 | `round` |
| `round-debate.md` | сообщение участнику в заседаниях дебатов | `round`, `facts` (установленные факты секретаря), `own_position`, `others` |
| `judge.md` | судья | `success_score`, `score_min`, `score_max`, `std`, `plan_quality`, `revision_rules` |
| `judge-revision.md` | судья при повторном рассмотрении: отчёт по каждому прошлому совету | `count` |
| `appeal.md` | контекст апелляции для всех | `segment`, `age_from`, `age_to`, `note`, `previous_verdict`, `positions` |
| `revision.md` | контекст повторного рассмотрения для всех | `version`, `previous_date`, `previous_verdict`, `recommendations`, `changes`, `positions` |
| `secretary-revision.md` | секретарь сравнивает новую версию с прошлой | — |

Формат JSON-ответов задаётся схемами в коде (`src/lib/trial/schemas.ts`) и передаётся моделям
отдельно, поэтому в промптах достаточно описать смысл полей.
