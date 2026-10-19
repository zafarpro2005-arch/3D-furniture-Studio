// node --test: логика инструментов и HTTP-сервер (токен, MCP-протокол) на копии данных во временной папке
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { searchApartments, getApartment, calcMortgage, addBooking, normalizePhone } from '../tools.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TOKEN = 'test-token-0123456789abcdef';
let dir, server, url, apartments;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'novostroyka-'));
  await copyFile(path.join(ROOT, 'apartments.json'), path.join(dir, 'apartments.json'));
  process.env.DATA_DIR = dir;
  apartments = JSON.parse(await readFile(path.join(dir, 'apartments.json'), 'utf8')).apartments;
  const { createHttpServer } = await import('../server.js');
  server = createHttpServer({ token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

// ---------- логика ----------
test('search_apartments: фильтры, без проданных, по возрастанию цены', () => {
  const r = searchApartments(apartments, { rooms: 2, max_price: 3e9, min_area: 80, floor: 7, limit: 180 });
  assert.ok(r.apartments.every((a) => a.rooms === 2 && a.price <= 3e9 && a.area >= 80 && a.floor === 7 && a.status === 'for_sale'));
  const all = searchApartments(apartments, { limit: 180 });
  assert.equal(all.total, apartments.filter((a) => a.status === 'for_sale').length);
  for (let i = 1; i < all.apartments.length; i++) assert.ok(all.apartments[i - 1].price <= all.apartments[i].price);
  assert.equal(searchApartments(apartments, {}).shown, 20);
});

test('get_apartments: по номеру и ошибка для несуществующего', () => {
  const a = getApartment(apartments, 37);
  assert.equal(a.number, 37);
  assert.equal(a.price_per_m2, Math.round(a.price / a.area));
  assert.throws(() => getApartment(apartments, 999), /не найдена/);
});

test('calc_mortgage: аннуитет и нулевая ставка', () => {
  const m = calcMortgage({ price: 1_000_000_000, down_payment_percent: 20, annual_rate_percent: 24, years: 10 });
  assert.equal(m.loan_amount, 800_000_000);
  assert.equal(m.months, 120);
  const r = 0.02, exact = 800_000_000 * r / (1 - (1 + r) ** -120);
  assert.equal(m.monthly_payment, Math.round(exact));
  assert.ok(Math.abs(m.monthly_payment - 17_638_000) < 5_000); // ≈ 17,64 млн в месяц
  assert.equal(m.overpayment, m.total_paid - m.loan_amount);
  const z = calcMortgage({ price: 1_200_000_000, down_payment_percent: 0, annual_rate_percent: 0, years: 1 });
  assert.equal(z.monthly_payment, 100_000_000);
  assert.equal(z.overpayment, 0);
});

test('booking_view: проверки входа', () => {
  const now = new Date('2026-10-20T06:00:00Z'); // 11:00 в Ташкенте
  const free = apartments.find((a) => a.status === 'for_sale'), sold = apartments.find((a) => a.status === 'sold');
  const ok = { name: 'Азиз', phone: '90 123 45 67', datetime: '2026-10-21T11:00', apartment: free.number };
  const list = [];
  const rec = addBooking(apartments, list, ok, now);
  assert.equal(rec.phone, '+998901234567');
  assert.equal(list.length, 1);
  assert.throws(() => addBooking(apartments, list, { ...ok, datetime: '2026-10-21T11:30' }, now), /занята/);
  assert.throws(() => addBooking(apartments, [], { ...ok, datetime: '2026-10-19T11:00' }, now), /прошли/);
  assert.throws(() => addBooking(apartments, [], { ...ok, datetime: '2026-10-21T22:00' }, now), /9:00/);
  assert.throws(() => addBooking(apartments, [], { ...ok, datetime: '2026-02-31T11:00' }, now), /нет/);
  assert.throws(() => addBooking(apartments, [], { ...ok, apartment: sold.number }, now), /продана/);
  assert.throws(() => addBooking(apartments, [], { ...ok, apartment: 999 }, now), /не найдена/);
  assert.throws(() => normalizePhone('abc'), /Телефон/);
});

// ---------- HTTP и токен ----------
const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
async function post(headers) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(initBody) });
}

test('без токена и с неверным токеном — 401', async () => {
  for (const h of [{}, { Authorization: 'Bearer wrong' }, { Authorization: TOKEN }]) {
    const r = await post(h);
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), 'Bearer');
  }
});

test('с токеном: список инструментов, поиск и запись на показ через MCP-клиент', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['booking_view', 'calc_mortgage', 'get_apartments', 'search_apartments']);

  const s = await client.callTool({ name: 'search_apartments', arguments: { rooms: 1, limit: 3 } });
  assert.ok(!s.isError);
  assert.ok(s.structuredContent.apartments.length <= 3);

  const bad = await client.callTool({ name: 'get_apartments', arguments: { number: 999 } });
  assert.equal(bad.isError, true);

  const free = apartments.find((a) => a.status === 'for_sale');
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const b = await client.callTool({ name: 'booking_view', arguments: { name: 'Тест', phone: '+998901112233', datetime: `${day}T12:00`, apartment: free.number } });
  assert.ok(!b.isError, b.content?.[0]?.text);
  const saved = JSON.parse(await readFile(path.join(dir, 'booking.json'), 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].apartment, free.number);
  await client.close();
});
