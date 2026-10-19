// MCP-сервер «Новостройка»: Streamable HTTP на порту 3001, доступ по токену из .env (MCP_TOKEN).
// Без токена или с неверным токеном — 401, до MCP дело не доходит.
// Режим без сессий: на каждый запрос — свой экземпляр сервера и транспорта (состояние — только в файлах).
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadApartments, updateBookings } from './data.js';
import { searchApartments, getApartment, calcMortgage, addBooking } from './tools.js';

const MAX_BODY = 1024 * 1024; // 1 МБ на запрос

// Ответ инструмента: JSON текстом (его читает модель) и он же структурой
function ok(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
}
function fail(e) {
  return { isError: true, content: [{ type: 'text', text: e.message }] };
}
async function run(fn) {
  try { return ok(await fn()); } catch (e) { return fail(e); }
}

export function buildMcpServer() {
  const server = new McpServer({ name: 'novostroyka', title: 'Новостройка', version: '1.0.0' });

  server.registerTool('search_apartments', {
    title: 'Поиск квартир',
    description: 'Ищет квартиры в продаже по фильтрам (все необязательны). Цены в сумах. Результат отсортирован по цене.',
    inputSchema: {
      rooms: z.number().int().min(1).max(3).optional().describe('Число комнат: 1, 2 или 3'),
      max_price: z.number().int().positive().optional().describe('Максимальная цена, сум'),
      min_area: z.number().positive().optional().describe('Минимальная площадь, м²'),
      floor: z.number().int().min(1).max(30).optional().describe('Этаж 1–30'),
      include_sold: z.boolean().optional().describe('Показывать и проданные (по умолчанию нет)'),
      limit: z.number().int().min(1).max(180).optional().describe('Сколько показать, по умолчанию 20')
    }
  }, (args) => run(async () => searchApartments(await loadApartments(), args)));

  // Поля get_apartment и book_viewing принимают и строку, и число, а проверяет их tools.js:
  // так любая ошибка ввода приходит понятным русским текстом, а не технической строкой валидатора.
  const loose = () => z.union([z.string(), z.number()]).optional();

  server.registerTool('get_apartment', {
    title: 'Квартира по номеру',
    description: 'Данные одной квартиры по номеру: этаж, комнаты, площадь, цена и цена за м² (сум), статус.',
    inputSchema: { number: loose().describe('Номер квартиры, целое число, например 37') }
  }, ({ number }) => run(async () => getApartment(await loadApartments(), number)));

  server.registerTool('calc_mortgage', {
    title: 'Ипотека (аннуитет)',
    description: 'Аннуитет с месячной ставкой: ежемесячный платёж, общая сумма выплат и переплата. Кредит — либо loan_amount, либо price с первоначальным взносом. Все суммы в сумах.',
    inputSchema: {
      loan_amount: z.number().int().positive().optional().describe('Сумма кредита, сум (вместо price)'),
      price: z.number().int().positive().optional().describe('Цена квартиры, сум (вместо loan_amount)'),
      down_payment_percent: z.number().min(0).max(90).optional().describe('Первоначальный взнос, % от цены (только с price, по умолчанию 0)'),
      annual_rate_percent: z.number().min(0).max(100).describe('Ставка, % годовых'),
      years: z.number().int().min(1).max(30).describe('Срок, лет')
    }
  }, (args) => run(async () => calcMortgage(args)));

  server.registerTool('book_viewing', {
    title: 'Запись на показ',
    description: 'Записывает на показ квартиры: проверяет, что квартира существует и в продаже и что в это время нет другого показа (показ длится час), и сохраняет заявку с id и временем создания в booking.json. Время — по Ташкенту, 9:00–20:00. Перед вызовом подтвердите данные с клиентом.',
    inputSchema: {
      name: loose().describe('Имя клиента'),
      phone: loose().describe('Телефон: +998XXXXXXXXX'),
      datetime: loose().describe('Дата и время показа: YYYY-MM-DDTHH:MM по Ташкенту, например 2026-10-25T11:00'),
      apartment: loose().describe('Номер квартиры, например 37')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, (args) => run(async () => {
    const apartments = await loadApartments();
    return { saved: true, booking: await updateBookings((list) => addBooking(apartments, list, args)) };
  }));

  return server;
}

// Токен сравниваем по SHA-256 за постоянное время: длина и содержимое не утекают по времени ответа
function tokenOk(header, token) {
  const m = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!m) return false;
  const a = createHash('sha256').update(m[1].trim()).digest(), b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// opts: { token } — обязательный
export function createHttpServer({ token }) {
  if (!token) throw new Error('MCP_TOKEN не задан');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' });
    // 1) токен — до всего остального
    if (!tokenOk(req.headers.authorization, token)) {
      return sendJson(res, 401, rpcError(-32001, 'Unauthorized: нужен заголовок Authorization: Bearer <MCP_TOKEN>'), { 'WWW-Authenticate': 'Bearer' });
    }
    // 2) без сессий нужны только POST-запросы
    if (req.method !== 'POST') return sendJson(res, 405, rpcError(-32000, 'Method not allowed'), { Allow: 'POST' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, e.status || 400, rpcError(-32700, 'Parse error')); }
    // 3) MCP: новый сервер и транспорт на запрос
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error('MCP error:', e);
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, 'Internal error'));
    }
  });
}

// Запуск: node server.js (токен — из ../.env или из окружения)
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const envFile = path.resolve(import.meta.dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const token = process.env.MCP_TOKEN || '';
  if (token.length < 16) {
    console.error('MCP_TOKEN не задан или короче 16 символов. Добавьте его в .env (шаблон — .env.example).');
    process.exit(1);
  }
  const port = Number(process.env.MCP_PORT) || 3001;
  const host = process.env.MCP_HOST || '127.0.0.1';
  createHttpServer({ token }).listen(port, host, () => console.log(`MCP «Новостройка»: http://${host}:${port}/mcp`));
}
