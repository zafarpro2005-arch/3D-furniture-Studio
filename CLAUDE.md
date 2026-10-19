# 3D Furniture Studio

Статический сайт без сборки: `index.html` — новостройка (шахматка, план этажа, 3D), `planner.html` — планировщик мебели. Код в `js/`, стили в `style.css`.

Запуск: `python -m http.server 8765` → http://localhost:8765 (через файл `index.html` JSON не загрузится).

## Данные

- `apartments.json` (корень проекта) — квартиры: `number`, `floor`, `rooms`, `area` (м²), `price`, `status` (`for_sale` / `sold`).
- `booking.json` (корень проекта) — записи на показ квартир.
- Все цены — в сумах (UZS), целым числом, без копеек.

## MCP-сервер

- Лежит в папке `mcp-server/`.
- Стек: Node.js и официальный SDK `@modelcontextprotocol/sdk`.
- Транспорт: HTTP (Streamable HTTP), порт `3001`.
- Доступ по токену: `Authorization: Bearer <MCP_TOKEN>`, токен берётся из `.env` (переменная `MCP_TOKEN`; шаблон — `.env.example`). Запрос без токена или с неверным токеном → `401 Unauthorized`.
- Работает с теми же файлами: квартиры читает из `apartments.json`, записи на показ хранит в `booking.json`. Цены — в сумах.
- `.env` и `.mcp.json` в git не попадают — реальные токены туда не коммитить. `booking.json` (имена и телефоны) тоже в `.gitignore`.

Файлы: `server.js` — HTTP, проверка токена, регистрация инструментов; `tools.js` — логика инструментов (чистые функции); `data.js` — чтение `apartments.json`, запись `booking.json` по очереди через временный файл; `test/server.test.js` — тесты. Зависимости — только `@modelcontextprotocol/sdk` и `zod` (нужен SDK для схем).

Инструменты:
- `search_apartments` — `rooms`, `max_price`, `min_area`, `floor`, `include_sold`, `limit` (все необязательны) → квартиры в продаже по возрастанию цены.
- `get_apartments` — `number` → одна квартира (с ценой за м²) или ошибка.
- `calc_mortgage` — `loan_amount` **или** `price` + `down_payment_percent`; `annual_rate_percent`, `years` → месячная ставка, ежемесячный платёж (аннуитет), общая сумма выплат (платёж × месяцы), переплата.
- `booking_view` — `name`, `phone`, `datetime` (`YYYY-MM-DDTHH:MM`, Ташкент, 9:00–20:00), `apartment` → запись в `booking.json`.

Запуск и проверка:
```bash
cd mcp-server && npm install && npm test   # тесты на копии данных
npm start                                   # нужен MCP_TOKEN (≥ 16 символов) в .env
```

Подключение в Claude Code — в `.mcp.json` (токен — из переменной окружения, не текстом):
```json
"novostroyka": { "type": "http", "url": "http://127.0.0.1:3001/mcp", "headers": { "Authorization": "Bearer ${MCP_TOKEN}" } }
```

Субагенты (`.claude/agents/`): `apartment-consultant` — подбор квартир (только чтение), `mortgage-advisor` — расчёт ипотеки, `booking-manager` — запись на показ (подтверждает данные с клиентом перед записью).
