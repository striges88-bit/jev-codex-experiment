# JEV-LAYER v1: итоговая спецификация context/enhance, tool outputs и evaluate

2026-10-04. Все 18 policy decisions согласованы. Это спецификация будущей реализации: final shared understanding/поручение первого этапа ещё ожидается. Production-ready runtime и разрешение конкретного pilot packet не заявлены. [Текущая матрица](project-status.md), [измерительный протокол](measurement-design.md).

## Цель и границы

Сократить суммарный input основной модели без регрессии качества, учитывая дочитывания, задержку и собственные затраты Jev. Обязательная среда — этот существующий Codex Desktop-чат. Gateway сохраняется как транспорт/input seam; model/subagent routing вне этого scope. Основная модель/auth, native history/memory/compaction, чужие изменения и execution approvals сохраняются. Отсутствие input byte cap сохраняется; protected данные не обрезаются из-за budget/provider failure.

Выбран собственный pipeline с существующими integration modules, без внедрения целого внешнего proxy/framework. Заимствованные идеи — domain-specific output views, epoch/binding discipline, сохранение originals/provenance и requirement/evidence evaluation. Применение/выигрыш подтверждается локальным evidence; чужие benchmarks не являются результатом JEV.

## Полная матрица принятых требований

| ID / human decision | Обязательное поведение |
|---|---|
| R01 / Q1 | Баланс сокращения контекста, задержки и rereads при обязательном качестве |
| R02 / Q2 | Разрешённые категории обрабатываются автоматически после scoped promotion; разрешение категории не означает ненужность каждого item |
| R03 / Q3 | Enhance — актуальное task state и точное дочитывание originals; без новых semantic summaries истории в v1 |
| R04 / Q4 | Pruning только exact duplicates и proven full supersession; semantic duplicates/low-value logs/reasoning artifacts отложены |
| R05 / Q5 | Первые tool profiles tests/logs/Git; read_thread/memory profiles отложены |
| R06 / Q6 | Evaluate только critical + explicit acceptance criteria; пять текущих инвариантов сохраняются |
| R07 / Q7 | Explicit old→new + same scope + complete replacement + preserved provenance/readback; любой no/unknown оставляет оба; Jev не угадывает ненужность |
| R08 / Q8 | Compact только completed supported success с proven extraction и атомарно сохранённым original до выдачи; unsafe/unknown outputs verbatim |
| R09 / Q9 | До исполнения frozen criteria ID/requirement/source/evidence_required; per-criterion PASS/FAIL/UNKNOWN, mandatory FAIL/UNKNOWN→NOT_ACCEPTED; observations отдельно |
| R10 / Q10 | Per-tool deterministic checks; evaluate один раз на independently acceptable unit, mandatory criteria в одном frozen packet. Meaningful milestones only; максимум один evidence-backed repair, no unchanged retry; re-evaluation только actual change+remaining lifecycle budget |
| R11 / Q11 | Нет необратимой потери originals ради экономии; reliable original/provenance/readback или verbatim. Required originals не удаляются автоматически; retention/GC отдельным будущим этапом |
| R12 / Q12 | Filter/parser fault→full/verbatim; judge unavailable→UNKNOWN/NOT_ACCEPTED с доступным ответом; gateway failure→transport failure/recovery/controlled rollback |
| R13 / Q13 | Tests/logs/Git→formal pruning→frozen evaluate; offline→shadow→scoped actual proof/revoke/readback в этом чате |
| R14 / Q14 | Frozen independent hold-out; любой из семи blockers ниже блокирует release. Report count/classes/coverage/false rejections/unnecessary retained context/compression/readbacks; finite PASS только в объявленной области |
| R15 / Q15 | No quality regression+statistically stable total primary-input reduction; rereads в input/latency, p95≤baseline+10%; Jev costs отдельно, insufficient data→shadow. Minimum saving% не фиксируется сейчас |
| R16 / Q16 | Human promotion после проверенного отчёта; затем category automation. Safety stop затронутой функции; resume после исправления/checks/human согласования |
| R17 / Q17 | Frozen paired protocol, grouped task requests, joint95% bounds: lower net saving>0, upper p95 ratio≤1.10. Separate pilot определяет sample size; freeze до final unseen hold-out, no convenient peeking/criteria tuning |
| R18 / Q18 | Bounded measuring pilot отдельно от general apply; после offline quality gate и отдельного concrete packet согласования, read-only cases в этом чате/narrow binding/safety stop/возврат shadow |

Пять critical invariants: Scope preserved, User state preserved, Blast radius controlled, Claims are evidenced, Secrets protected. MUST_KEEP берётся из действующих инструкций/критериев/необходимых evidence, не из judge guesses. Сохраняются permission/binding/revision/protected guards, целостность logical call/result groups и последние восемь protected groups. Новая instruction/compaction/scope drift требует проверенной привязки; до неё full context.

## Pipeline и ответственность

1. **Originals/evidence.** Сначала полный полученный original атомарно сохраняется и проверяется, затем появляется compact с provenance/readback ID. Host-truncated source не становится полным исходником команды. Невозможность сохранить/дочитать приводит к verbatim. Artifacts остаются локальными; создание artifact не означает его экспорт judge или publication.
2. **Tool profiles.** Producer-side обработка completed outputs tests/logs/Git. Known supported grammar, реальный exit/completion, отсутствие unsafe states и полнота extraction проверяются детерминированно. Unknown warning/format, error/truncation/incomplete/parser failure остаются verbatim. Explicit counts/exit0 без completeness недостаточны. Начальные parsers используют форматы проекта; exact grammars/command envelopes фиксируются до их gate.
3. **Task state/enhance.** Coordinator сохраняет текущие goal/requirements/frozen criteria/решения/проверенные результаты/unfinished work и ссылки на originals. Jev не создаёт новые обязательные требования. Missing/contradictory state не устраняется выдуманным summary.
4. **Gateway pruning.** Работает с копией model-visible input и доказанным original inventory/binding. Исключает только разрешённые взаимозаменяемые exact duplicates или old по formal full-supersession proof. Hash content не переносит permission на новое вхождение; untrusted metadata complete/newer не заменяет proof. Original reconstruction/revoke/full fallback сохраняются; opaque/unknown native items остаются защищёнными.
5. **Evaluate.** Coordinator freezes acceptance-unit contract/result/evidence. Deterministic facts проверяются локально, judge проверяет support в declared scope. Каждый mandatory ID учтён; missing/invalid/unavailable evidence→UNKNOWN, confirmed violation→FAIL. Score/Noul probability alone не даёт ACCEPTED/permission. Legacy score может остаться observation, а не admission threshold. Один frozen packet; capacity failure→UNKNOWN без slicing/silent splitting.

Budget: existing30HTTP/30000ms aggregate provider wait/5000ms attempt в одном owned lifecycle, close in finally; no reset by new ID/no automatic retries. Low score/UNKNOWN не запускает repair; только concrete evidenced violation в scope и remaining budget. Точная новая serialisation/adapter mapping/version compatibility должны быть проверены при реализации evaluate; этот документ не утверждает, что legacy wire уже реализует frozen criteria.

## Gates и состояния

Release blockers: MUST_KEEP lost; wrong exclusion; materially incorrect compact; protected-data violation; false ACCEPTED; original/readback unavailable where required; fallback contract violated. Count/classes/coverage и все согласованные diagnostic metrics публикуются в отчёте текущей задачи с denominator/UNKNOWN. External GitHub publication требует своего разрешения.20/20PASS доказывает эти20заранее frozen cases; не универсальную безопасность.

Efficiency: main total input включает все rereads/continuations за unit, cached usage отдельно, Jev tokens/calls/latency/cost отдельно. Gross compression bytes не заменяет net tokens или current occupancy. Frozen paired protocol учитывает task grouping, workload/conditions, sample plan, suitability estimator/tail evidence, stop/exclusion rules. Joint95% bounds соблюдают R17; недостаточные/несопоставимые данные→UNKNOWN/shadow.10% latency — ceiling, не target; saving% floor не выдумывается.

```text
implementation + offline quality checks
  → shadow / observations
  → concrete frozen read-only pilot packet + human approval
  → bounded measuring pilot / safety stop / return shadow
  → untouched final hold-out + frozen statistical gate
  → verified report + human promotion
  → automatic permitted categories within scope
```

Для каждого этапа отдельно доказываются actual apply/revoke/readback и Desktop attribution. Evaluate отключение означает прекращение новых внешних оценок с сохранением честного UNKNOWN; gateway outage не обещает forwarding через dead process. Crash/storage/parser/judge/transport failures имеют разные причины и соответствующий R12 fallback.

## Реализация по этапам: конкретный следующий slice

### Этап1: tests/logs/Git outputs

Переиспользовать integration/compact-output.mjs и существующие process/receipt patterns. Добавить атомарную publication originals, стабильный readback/provenance, completed-success eligibility gate и narrow parsers. Unsafe/unsupported output возвращается исходным received verbatim; сохранять command exit/completion и diagnostics. Node test summary уже распознаётся helper, но verified parser contract должен охватывать полный поддерживаемый dialect, warnings и completeness. Logs/Git только известные structured formats; unknown остаётся full.

Done when: exact bytes/readback подтверждены; compact выдаётся только после storage proof и parser success; все unsafe fixtures дают verbatim; counts/status/paths/существенная диагностика не потеряны; вызов из нужного producer seam подтверждён отдельно. Offline frozen independent cases, module tests/diff/source preservation; без benchmark claim или general activation. Детали parser grammar/record version оформляются перед изменением соответствующей поверхности. Этот этап не переписывает историю, не меняет основной model/auth и не реализует deferred error compaction.

### Этап2: formal pruning и task state

Переиспользовать existing gateway/context binding/reconstruction/filter surfaces. Добавить formal duplicate/supersession verification, protection/current-state integration и безопасное renewal в существующем permission scope. Не исключать независимые измерения одинакового содержания, новый occurrence по старому hash или summary без complete proof. Unknown/stale binding→full. Done when: required groups/evidence сохранены, разрешённое исключение имеет proof, реальный scoped Desktop receipt и live revoke/full original restoration совпадают; comprehensive gate/benefit остаются отдельными.

### Этап3: frozen-contract evaluate

Переиспользовать existing transport/lifecycle/schema/assessment и заменить admission logic per-criterion contract/evidence statuses с backward compatibility проверкой. Current evaluate.mjs формирует3Score+5Noul, не является этой реализацией. Проверить provider response mapping, all mandatory IDs, malformed/partial/unavailable/unsupported capacity→UNKNOWN и one-packet/no-retry/repair policy. Process-client15s vs aggregate30s budget из matrix учитывается только если применимый call path действительно требует большего deadline; не расширять provider budget. Choice-only дефект M1 не включать в этот routing-free scope без конкретной зависимости.

Done when: correct positive/contradicted/missing evidence panel по независимым labels; no false ACCEPTED/missing IDs; observations не изменяют frozen rules; одна подтверждённая correction и same-budget re-evaluation привязаны к actual changes; transport/budget/outage tests соответствуют изменённой поверхности. Specific export restrictions не обходить; необходимые разрешения для конкретного reviewable payload проверяются отдельно.

## Что требуется заморозить перед конкретным испытанием

Supported parser/command contracts; case IDs/classes/expected labels/MUST_KEEP; independent tuning/pilot/final datasets; code/contract versions; exact unit boundaries/usage attribution; workload weights и paired conditions/order; statistical estimator+validated coverage/tail assumptions; sample size/repeats/stop/censoring rules; current Desktop scope/binding/allowed IDs; originals/readback/storage proof; safety-stop/recovery; prepared provider packet в разрешённой области. Отсутствие обязательного элемента блокирует соответствующий gate, а не подменяется догадкой. Значения sample size/estimator/cases пока не выбраны — предусмотрен порядок их определения и freeze.

## Состояние реализации и доказательств

Источник текущей baseline:73c0b30; source hashes сверены при завершении design-stage. Narrow WS apply/revoke и98/98test log — исторические ограниченные свидетельства, не новые результаты этого spec-stage. После поздней compaction последний исследовательский runtime snapshot давал full inventory_changed/exclusions0; runtime в этом этапе не перепроверялся. Autostart/logon order/general net benefit ещё не доказаны.

Свежая проверка source compact-output.mjs показывает write wx + readback hash + caller select, но не новую atomic publication/full parser safety gate. Legacy evaluate source показывает3Score+5Noul; новые per-criterion contracts ещё не реализованы. Эти разрывы — предмет этапов1/3, а не скрытое production-ready состояние.

Deferred: routing, semantic pruning/error compaction, read_thread/memory output profiles, broad claim evaluation, storage retention/GC, внешний framework install. Этот public documentation checkpoint не реализует redesign, не запускает pilot и не делает production promotion. Policy interview завершён; финальная shared understanding/поручение этапа1 — следующий человеческий шаг.
