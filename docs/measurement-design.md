# JEV-LAYER: согласованный порядок измерения перед production promotion

2026-10-04. Q14–Q18 — human resolutions, включая joint95% paired protocol и bounded measuring pilot перед general promotion. Метод estimator, размеры/сценарии и конкретный pilot packet ещё предстоит подготовить/freeze; measurements не выполнялись. Definitions ниже — инженерная детализация согласованных метрик для reviewable measurement plan, не готовые результаты. Contract: [согласованные контракты](context-quality-v1.md); итоговая spec: [context-quality-v1.md](context-quality-v1.md).

## Уже принято

Frozen independent hold-out; любой из семи quality blockers блокирует выпуск. No quality regression; статистически устойчивое сокращение total primary-model input; все rereads входят в input/latency; p95 end-to-end≤baseline+10%. Minimum saving% не назначен. Jev latency/token/call costs отдельно, insufficient evidence→shadow. Human promotion/resume, safety stop затронутой функции.20/20PASS означает только эти20заранее определённых cases.

## Определения для будущего frozen measurement plan

| Метрика | Предлагаемый состав/знаменатель |
|---|---|
| Scenario count/classes | Frozen case IDs с классами safe success, unsafe/failure, ambiguous/adversarial; поддерживаемые tests/logs/Git форматы и условия listed явно |
| Coverage | Матрица case→requirement/parser/proof/failure-mode. Нет придуманного процента покрытия всех возможных контекстов |
| False rejections | Expected ACCEPTED по заранее независимой метке и достаточным frozen evidence, но фактический NOT_ACCEPTED. Expected UNKNOWN при missing evidence не false rejection; unavailable judge показывается отдельной причиной |
| Retained unnecessary context | Сохранённые human-labelled unnecessary fragments, отдельно для eligible optional/proof-covered и неразрешённых категорий; counts/bytes/token availability и protection reasons раздельно |
| Compression ratio | UTF-8 bytes model-visible compact representation включая provenance/readback metadata / bytes original received output. Verbatim ratio1. Success-eligible subset и все outputs показать отдельно; это не token/cost saving |
| Readback frequency | Доля acceptance units с readback плюс число readbacks/unit; объём/latency rereads входит в итоговую input/latency метрику |
| Total primary input | Сумма authoritative input usage всех запросов основной модели, атрибутированных unit, включая tool continuations/rereads. Cached usage отдельно; не вычитать cache по умолчанию. При отсутствии достоверной attribution/usage — UNKNOWN; tokenizer/byte estimates имеют отдельную подпись |
| Net input saving | Baseline total primary input минус apply total primary input для заранее заданного representative workload; gross compact/pruning bytes отдельно |
| End-to-end | От зафиксированного начала acceptance unit до доступного результата с evaluate status; preprocessing, queue/wait, model/tools, rereads и разрешённый repair включены. Start/end markers одинаковы в обеих ветках; недоступные markers→UNKNOWN |
| Jev costs | Фактические собственные tokens, HTTP calls, wait/latency и доступная цена отдельно от main-model accounting; недоступная price/usage→UNKNOWN |

## Q17: согласованный statistical gate

1. До final evaluation фиксировать corpus/classes/workload weights, contract и parser versions, метрики/start-end markers, сопоставимые baseline/apply условия, парность/порядок запуска, независимые task groups, exclusions и stop rules. Drift/несопоставимость нельзя молча исключать ради PASS.
2. Один task с многими requests не превращать во множество независимых samples. При наличии групп/повторов метод учитывает зависимость; suitability estimator надо проверять, не объявлять по одному названию.
3. Согласованный совместный95% confidence gate: lower bound net saving>0 и upper bound p95 latency ratio≤1.10. Не трактовать95% как вероятность корректности конкретного ответа/безопасности всех контекстов. Две отдельные95% границы сами по себе не означают совместного95% утверждения.
4. По отдельному pilot variance/точности определить размер/повторы, затем freeze final sample plan и estimator до вскрытия unseen hold-out. Pilot не входит в final confirmation. Нет peeking/остановки по первому удобному PASS; exposed tuning cases не объявляются unseen после исправления реализации.
5. При insufficient tail data, широких границах, недостоверном usage или confounds — UNKNOWN и shadow. При timeout/ошибке не выкидывать наблюдение как неудобное; quality/outage outcome сохранён, способ обработки latency censoring фиксируется заранее.

Общие основания: [NIST — Confidence Limits for the Mean](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm) объясняет смысл confidence interval и зависимость precision от sample size/variability; это не p95 formula. [NIST — Bonferroni's method](https://www.itl.nist.gov/div898/handbook/prc/section4/prc473.htm) описывает общий принцип сохранения overall confidence для нескольких intervals. Из этих принципов предложен совместный gate JEV; конкретный корректный percentile/ratio estimator ими не выбран. Первичные источники были прочитаны без выполнения third-party scripts. Конкретный estimator остаётся будущим frozen engineering choice.

## Q18: согласованная граница measuring pilot

Согласованный apply gate требует actual end-to-end/readback evidence. Shadow/replay считает потенциальное сокращение, но не показывает реальное поведение модели после сокращения. Следовательно, ungated production apply нельзя обосновать одной shadow byte ratio.

Пользователь принял bounded measuring pilot до general promotion с отдельным конкретным reviewable pilot packet/условиями. Только после offline quality gate, frozen read-only cases, в этом existing Desktop-чате, узкий binding, original/readback и safety stop; после пилота shadow. Trial exceptions/measurement changes не распространяются на обычную работу. Native history/model/auth/memory/compaction не меняются. Если реальные условия baseline/apply сопоставить нельзя — actual comparison UNKNOWN, а не обещание корректного A/B.

Q18 согласовал порядок, а не запуск ещё не подготовленного pilot packet. Сначала итоговая spec/shared understanding и поручение реализации; затем offline quality evidence, конкретный pilot packet и отдельное согласование его применения. В packet заранее фиксируются cases/метки, baseline/apply conditions, estimator/выборка, attribution/start-end markers, scope/binding и recovery. До этого обычный режим shadow; readiness UNKNOWN. No automatic pilot or production activation.
