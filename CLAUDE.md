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
- `.env` и `.mcp.json` в git не попадают — реальные токены туда не коммитить.
