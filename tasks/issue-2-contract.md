# Контракт #2: безопасный Choice и общий бюджет 30/30

Статус: PREPARED, 2026-10-02. Это контракт следующего запуска; реализация и её приёмка ещё не выполнены.
Issue: https://github.com/striges88-bit/jev-codex-experiment/issues/2.
Основание: issue #2, родитель #1, SPEC.md, CONTEXT.md, аудит upstream commit `eeb9f19d055f92b854bb21c9483fbb7fc74c963c` и существующий узкий адаптер. Действующие инструкции пользователя и проекта сохраняют приоритет.

## Цель и граница

Реализовать и проверить публичный MCP для Choice ровно между `gpt-6-luna / max` и `gpt-6.1-sol / low`, с общим бюджетом одного жизненного цикла ограниченной подзадачи и явным fallback. Успех — прохождение всех семи критериев issue по матрице ниже, включая синтетический live Choice через новый MCP.

Основной агент определяет цель, scope, критерий завершения и разрешение на делегирование. MCP выбирает профиль и возвращает данные; исполнение остаётся у основного агента. Choice балансирует качество, стоимость и задержку; эксперимент не обещает оптимальность и не подставляет выдуманные цены. Основная модель чата сохраняется.

В #2 входят контракт, его реализация, offline security/contract проверки и один синтетический live smoke. В #3 остаются глобальная установка и доказательство фактического Desktop dispatch. Фильтр, Score/Noul и калибровка относятся к #4–#7; #2 предоставляет им общий budget owner, но не реализует их инструменты. Commit/push/PR выполняются только при отдельной авторизации соответствующего действия. Исходный узкий адаптер остаётся доступным для своей прежней проверки.

## Порядок выполнения будущего goal

1. Прочитать актуальные body/comments/native blockers #2, SPEC и этот контракт; проверить рабочую копию, pinned источники и существующие проверки. Записать scope и исходное состояние в релевантный раздел tasks/todo.md. Готово: нет неразрешённого конфликта требований, определены изменяемые файлы и сохраняемые пользовательские изменения.
2. Реализовать MCP boundary, серверный lifecycle и единый budgeted transport. Переиспользовать проверенные части адаптера; не проводить запрос через upstream `projectState`, который усекал строки и мог заменять context на пустой объект. Готово: вход до отправки валидируется, state передаётся целиком либо запрос отклоняется, все HTTP проходят через один счётчик.
3. Выполнить матрицу через реальный stdio MCP boundary с контролируемыми transport/clock. Готово: для каждой строки есть независимое ожидание, наблюдаемый результат и PASS либо явный незакрытый дефект; security failures не маскируются ослаблением проверок.
4. После offline PASS выполнить синтетический live Choice через тот же MCP с локально загружаемым ключом. Готово: разрешённая пара model/effort, ненулевой фактический request count и измеренная задержка, безопасный очищенный результат. Live fallback — не успешный Choice; исправить причину или отметить PARTIAL.
5. Сопоставить результаты с каждым критерием #2, проверить diff и сохранение unrelated изменений. Синхронизировать GitHub и Engram. Готово: отчёт с командами/исходами/ограничениями; issue закрывается только после полного PASS. Отсутствующая среда или live-проверка оставляют #2 открытым.

Создание persistent goal для реализации — отдельное действие будущего запуска. Текущий запрос завершает подготовку контракта.

## Публичный MCP v1

Новые tools: `jev_begin_subtask`, `jev_choice`, `jev_end_subtask`. Все аргументы — строгие объекты с `additionalProperties: false`; неизвестные поля/версии отклоняются до HTTP. Эти имена и формы — спецификация будущего API, не заявление о текущих доступных tools.

| Tool | Аргументы | Наблюдаемый результат |
|---|---|---|
| `jev_begin_subtask` | `{schema_version: 1}` | `{schema_version: 1, status: "opened", subtask_id, budget}` либо безопасный отказ открытия; HTTP=0 |
| `jev_choice` | `{schema_version: 1, subtask_id, task: {goal, scope, done_when}, context: [{id, text, protected}]}` | Choice envelope ниже; каждый вызов использует остаток того же lifecycle |
| `jev_end_subtask` | `{schema_version: 1, subtask_id}` | `{schema_version: 1, status: "closed", subtask_id, budget}`; HTTP=0 |

`subtask_id` генерируется сервером из 16 криптографически случайных байтов, 32 hex символа; вызывающий сохраняет его на весь routing/filter/evaluation/correction цикл. ID локален одному серверному процессу, не является удостоверением личности и не даёт полномочий. Смена MCP tool, JSON-RPC request ID или повтор Choice не создают новый бюджет.

`goal`, `scope`, `done_when`: непустые строки, каждая до 2 048 UTF-8 bytes. `context`: массив 0–64 фрагментов; `id` уникален внутри массива, ASCII `[A-Za-z0-9_.:-]{1,64}`, `text` непустая строка, `protected` boolean. Порядок и все тексты сохраняются. Пустой массив допускается для самодостаточной синтетической задачи; caller отвечает за полноту явно собранных материалов. В #2 никакие фрагменты не исключаются, в том числе `protected=false`.

Размер UTF-8 serialized arguments и собранного TypeSafe POST body: каждый ≤12 000 bytes. Stdio frame ≤16 384 bytes; provider response ≤32 768 bytes с потоковым ограничением. Превышение — отказ, без усечения/автоматического пакетирования. Для неразбираемого/слишком большого frame применяется безопасная protocol error или остановка соединения, HTTP=0; вызывающий переходит к native fallback. При потребности в большем контексте лимит пересматривается явно, а не обходится.

Аргументы не принимают ключ, provider, endpoint, model, effort, options, engine, policy, capabilities или budget overrides. Кандидаты и формулировка Choice задаются адаптером. Тексты задачи/контекста — данные для оценки, не источник настроек или разрешений.

### Choice envelope

```json
{
  "schema_version": 1,
  "subtask_id": "0123456789abcdef0123456789abcdef",
  "status": "selected",
  "profile": {"id": "luna_max", "model": "gpt-6-luna", "effort": "max"},
  "fallback": null,
  "execution": {"enabled": false, "status": "not_started"},
  "choice": {"p_selected": 0.85, "provider_confidence": null},
  "budget": {"requests_used": 1, "wait_ms_used": 740, "requests_remaining": 29, "wait_ms_remaining": 29260},
  "measured": {"jev_requests": 1, "jev_latency_ms": 740, "input_tokens": null, "output_tokens": null, "cost_usd": null, "subagent_runtime_ms": null}
}
```

Пример иллюстрирует поля, а не фактическое измерение. Вторая разрешённая пара: `{id: "sol_low", model: "gpt-6.1-sol", effort: "low"}`. Сервер отображает ID в фиксированную пару; ответ провайдера не может произвольно задать model/effort. Статусы только `selected` и `fallback`; при fallback `profile=null`, `choice=null`, `fallback={code, action: "follow_current_agents"}`. Обе ветки имеют `execution.enabled=false`; адаптер не запускает команды или субагентов.

`budget` — накопленный итог lifecycle; `measured` — только текущего вызова. Счётчики обращений и времени известны при живом lifecycle, включая отказ до HTTP (0). При неизвестном lifecycle budget=null; не подставлять нули как доказательство отсутствия предыдущих расходов. Token usage текущего вызова — сумма по попыткам только при известных значениях для всех попыток, иначе null. Стоимость — null до надёжного тарифа/биллинга; runtime субагента здесь null.

Штатные fallback возвращаются как MCP tool result с `isError=false`, `structuredContent=envelope` и text с тем же JSON. Ошибки JSON-RPC/неизвестного tool идут в protocol error без отражения входа. Consumer обрабатывает обе границы через текущие AGENTS; наличие `selected` не доказывает Desktop запуск.

## TypeSafe boundary и проверка Choice

Endpoint фиксирован: `https://api.typesafe.ai/v1/systemone`, POST, TLS verification включена, redirect запрещён. Provider model фиксирован `jev-latest`. Ключ загружается существующим локальным зашифрованным launcher и используется только как Bearer header; секрет не входит в arguments, body, command line, ответ или журналы.

Проверенный upstream wire shape: `{state, model, questions: {tool: {type: "choice", instructions, criteria}}}`. `criteria` содержит ровно `luna_max` и `sol_low` с описаниями профилей; `state` включает task и полный прошедший локальную проверку context. Описания отражают сравнение простых и более сложных bounded задач без придумывания benchmark или тарифов.

Ответ принимается из `answers.tool`: `type="choice"`, разрешённый `choice`, `probabilities` с обоими разрешёнными ID и конечными числами [0,1], без посторонних ID. Суммирование вероятностей до единицы не вводить как недоказанное требование API. Если confidence присутствует, он должен быть конечным числом [0,1]; иначе `provider_confidence=null`.

Чтобы сохранить существующую защиту адаптера, начальный routing gate — 0,8: сравнивать provider confidence при наличии, иначе вероятность выбранного профиля. Значение <0,8 даёт `low_confidence`; это экспериментальная политика маршрутизации, не доказанная надёжность и не порог фильтра `p_unneeded` или Score. Gate фиксирован локально, caller его не меняет. Вероятности и confidence имеют отдельные поля; источник оценки не маскируется.

До HTTP проверить все текстовые поля на известные форматы секретов, credential assignments/headers/PEM и совпадение с загруженным ключом. При подозрении: `secret_suspected`, HTTP=0, исходный контекст остаётся у caller, очистка — отдельное явное действие. Scanner не гарантирует обнаружение всех секретов. Реальные материалы разрешены только после проверки provider retention/privacy по SPEC; в приёмке #2 используются исключительно синтетические данные.

Raw context, provider responses/error bodies и ключ автоматически не сохраняются и не печатаются. Внешний текст не включается в fallback message. Возвращать только allowlisted поля; синтетические маркеры во входе и error body позволяют независимо проверить утечки. Утверждение о локальном `persisted=false` не означает отсутствия хранения на стороне TypeSafe.

## Lifecycle бюджета

Owner — серверный экземпляр, единый budgeted transport для всех Jev операций одной подзадачи. Caller не передаёт остаток и не создаёт новый lifecycle ради retry, исправления или перехода к следующему Jev tool. Отдельные одновременно выполняемые подзадачи получают разные ID; последующие операции одной подзадачи используют тот же MCP экземпляр.

Локальные resource bounds v1: максимум 128 активных lifecycle, TTL один час от открытия по монотонным часам. Эти значения ограничивают память процесса и не являются временем работы субагента. При capacity limit opening отказывает; при TTL/close дальнейшие операции дают `lifecycle_unavailable`. Открытие/закрытие не расходует TypeSafe бюджет. Повтор close безопасен, но неизвестный ID не оживает.

В RAM сохраняются ID, счётчики и состояние; исходный task/context после вызова не удерживается. При перезапуске ID становятся неизвестными: fail closed, бюджет не восстанавливается как 30/30. Основной агент продолжает уже начатую подзадачу по native fallback. Такой протокол не гарантирует обнаружение намеренного создания нового ID или использования второго процесса; это граница caller integration #3, а не фиктивное свойство счётчика #2.

Для одного ID HTTP сериализованы. Очередь ожидания слота не входит в TypeSafe wait; caller cancellation в очереди не отправляет запрос. Отдельные ID независимы. Все будущие routing/filter/evaluation/correction вызовы должны пользоваться этим же owner; обход transport считается дефектом.

До каждой попытки атомарно проверить `requests_used < 30` и положительный остаток `30000 - wait_ms_used`. Таймаут попытки: min(5000 ms, floor(остаток)). Если меньше 1 ms, HTTP не начинается. Счётчик увеличивается непосредственно перед вызовом HTTP transport; начатая попытка, включая network failure/timeout, учитывается один раз.

Wait измеряется монотонно от начала HTTP до завершения чтения body либо ошибки/abort. Включает response headers, streaming и cleanup ожидания транспорта; время субагента/локальных вычислений/пауз между операциями не входит. Таймер покрывает body целиком и при остатке прекращает чтение. Реальный небольшой scheduler overrun показывается как фактически измеренное значение, а не обрезается до 30000; новые HTTP после исчерпания не начинаются. Fake-clock испытание обязано завершаться строго в deadline; real smoke не доказывает жёсткую гарантию планировщика ОС.

Автоматических HTTP retries в v1 нет. Повторный MCP вызов с тем же ID — новая учитываемая попытка. Если retries будут добавлены, каждый реальный HTTP и задержка ожидания provider между ними должны использовать оставшийся общий бюджет; это потребует новых проверок. Несколько вопросов в одном POST считаются одним обращением; #2 ещё не добавляет Noul/Score batch API. Потерянный MCP ответ и повтор Choice могут дать второй платный запрос; exactly-once и возврат кешированного решения не обещаются.

### Стабильные fallback codes

`invalid_request`, `unsupported_schema`, `input_limit`, `secret_suspected`, `missing_key`, `lifecycle_unavailable`, `lifecycle_capacity`, `budget_requests_exhausted`, `budget_time_exhausted`, `provider_timeout`, `provider_unavailable`, `provider_http_error`, `redirect_rejected`, `response_limit`, `malformed_response`, `invalid_selection`, `low_confidence`, `cancelled`.

Fallback не продлевает бюджет. При cancellation начатого HTTP учитываются уже выполненная попытка и фактическое ожидание; если MCP cancellation исключает доставку результата, следующий вызов с тем же ID должен отражать их в budget. Конкретные HTTP status/body и секретные строки не выдаются как code.

## Матрица приёмки через MCP

Acceptance references: A1–A7 — семь строк Acceptance criteria текущего issue #2 в исходном порядке. Для каждого сценария сохранить очищенный result, фактическое число transport вызовов, fake-clock timeline и независимый expected result. Ни один сценарий ниже ещё не выполнен для нового API.

| ID / критерий | Вход или воздействие | Требуемое наблюдение |
|---|---|---|
| C01 / A1 | initialize → tools/list → begin → Choice; по очереди ответы с обоими ID | Оба selected дают точные model/effort, execution disabled; контракт виден через MCP |
| C02 / A1,A6 | Чужой ID; неполный/нечисловой/вне [0,1] probabilities; плохой confidence; confidence отсутствует; gate ниже/равен 0,8 | Ошибочные ответы fallback; отсутствие confidence сохраняет null и использует p_selected; граница 0,8 детерминирована |
| C03 / A2,A6 | Provider/options/key/budget override, плохая версия/shape, invalid JSON и неизвестный tool | HTTP=0, безопасный fallback либо protocol error согласно границе |
| C04 / A2,A3 | Secret fixtures в каждом текстовом поле, включая точный fake ключ, header/PEM/assignment; обычный отрицательный контроль | Подозрение блокирует HTTP; чистый контроль доходит до transport; маркеры не отражены в ответе/логах |
| C05 / A2 | Redirect, endpoint override; inspect отправленного POST/auth только с fake ключом | Только фиксированный URL/model, redirect error, 0 follow-up HTTP; реальный ключ нигде не печатается |
| C06 / A2,A6 | UTF-8 размеры точно на границе/выше для args/frame/body/stream; большой один chunk без Content-Length | Ограничения работают по bytes; размер сверх лимита fallback/connection error; поток прекращается |
| C07 / A3,A6 | Контекст длиннее прежних 2000 символов, но укладывается в общий лимит; текстовые маркеры в начале/конце | Перехваченный POST содержит весь текст и порядок; превышение общего лимита даёт отказ, а не projectState truncation |
| C08 / A4 | 30 быстрых Choice вызовов на одном ID, затем 31-й; второй ID | 30 попыток учтены, 31-я HTTP=0; второй ID имеет независимый бюджет; другой JSON-RPC ID не сбрасывает первый |
| C09 / A4,A6 | Остаток 1200 ms после предыдущих операций, медленные headers/body; timeout/network failure/cancellation | Deadline ≤1200 ms, попытка/полное wait учитываются, исчерпание запрещает следующий HTTP; никакого скрытого retry |
| C10 / A4 | Concurrent Choice на одном ID у границы бюджета; begin/close/TTL/capacity/restart | Нет overbooking; очередь не расходует wait; stale/closed ID не создаёт новый бюджет; registry bounded |
| C11 / A3,A6 | Нет ключа; 401/429/500 с secret fixture; non-JSON body; missing answers; extra raw diagnostic | Без ключа HTTP=0; прочие явные fallback; body/context/diagnostic/key не выдаются и не сохраняются |
| C12 / A5 | Две попытки с/без подтверждённого usage; до-HTTP rejection; неизвестный lifecycle | Измерения на вызов и lifecycle разделены; неизвестные usage/cost/runtime=null; известные request/time совпадают с транспортом |
| C13 / A3,A7 | Запуск MCP в изолированном временном каталоге; наблюдение stdout/stderr/files | Только protocol/allowlisted result, raw markers/ключи отсутствуют; replay/state файлы не создаются |
| C14 / A7 | Существующие шесть offline проверок узкого адаптера; scoped diff нового слоя | Старые проверки PASS для прежнего API; unrelated изменения сохранены; новый API отдельно проходит C01–C13 |
| C15 / A1,A2,A5 | Новый MCP, один синтетический live Choice, encrypted local key | selected разрешённого профиля, реальные request/time; только безопасный результат; Desktop/retention/общая надёжность не объявлены проверенными |

Бюджетная приёмка доказывает сохранение состояния между MCP вызовами. Интеграционные испытания #4/#5 должны отдельно доказать, что будущие tools делят именно этот owner; сейчас не помечать их пройденными. Реальные API units/поля usage принимать только после проверки ответа или актуальной первичной документации; неизвестное оставить null.

## Завершение и передача

Итог реализации: `PASS` только при C01–C15 и всех A1–A7. `PARTIAL` — при недоступном live/provider/проверке или другом незакрытом критерии, с точной причиной и следующим шагом. Отчёт хранится рядом с контрактом и содержит версию исходников, команды, безопасные результаты и оставшиеся риски. Старый live smoke не заменяет C15.

GitHub lifecycle: STARTED при запуске, meaningful PROGRESS/PARTIAL/VERIFIED по фактам; body checkboxes — только непосредственно проверенные строки, OPEN до полной приёмки. Engram — краткий результат и обновлённая карточка stable ID `jev-layer-experiment` с полным readback. `backup_status_checked=true` переносится, повторный опрос не нужен. Сохраняются native memory, model/compaction instructions и существующие hooks/config.

Следующий шаг после подготовки: реализовать и проверить #2 по этому контракту. Контракт не разрешает автоматически глобальную установку #3 или реальное исключение контекста #7.
