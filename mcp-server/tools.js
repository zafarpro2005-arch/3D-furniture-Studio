// Логика инструментов без HTTP и MCP — чистые функции, их проверяют тесты.
// Все деньги — в сумах, целыми числами (см. CLAUDE.md).

export const TZ_OFFSET = '+05:00'; // время показа — ташкентское
const WORK_FROM = 9, WORK_TO = 20;  // показы с 9:00, последний — до 20:00
const MAX_DAYS_AHEAD = 60;

function view(a) {
  return {
    number: a.number, floor: a.floor, rooms: a.rooms, area: a.area, price: a.price,
    price_per_m2: Math.round(a.price / a.area), status: a.status
  };
}

// search_apartments: все фильтры необязательны; проданные — только по include_sold
export function searchApartments(list, f = {}) {
  const found = list.filter((a) =>
    (f.include_sold || a.status === 'for_sale') &&
    (f.rooms === undefined || a.rooms === f.rooms) &&
    (f.max_price === undefined || a.price <= f.max_price) &&
    (f.min_area === undefined || a.area >= f.min_area) &&
    (f.floor === undefined || a.floor === f.floor)
  ).sort((a, b) => a.price - b.price || a.number - b.number);
  const limit = f.limit || 20;
  return { total: found.length, shown: Math.min(limit, found.length), currency: 'UZS', apartments: found.slice(0, limit).map(view) };
}

// calc_mortgage: аннуитет. Платёж = S · r / (1 − (1 + r)^−n), где S — сумма кредита,
// r — месячная ставка (годовая / 12 / 100), n — число месяцев. Общая сумма выплат — платёж × n
// (платёж округлён до сума, как его и платят), переплата — выплаты минус кредит.
// Кредит задаётся либо прямо (loan_amount), либо ценой и первоначальным взносом в процентах.
export function calcMortgage({ loan_amount, price, down_payment_percent = 0, annual_rate_percent, years }) {
  if ((loan_amount === undefined) === (price === undefined)) throw new Error('Укажите либо сумму кредита (loan_amount), либо цену (price) с первоначальным взносом');
  const down = price === undefined ? 0 : Math.round(price * down_payment_percent / 100);
  const loan = price === undefined ? loan_amount : price - down;
  const n = years * 12;
  const r = annual_rate_percent / 100 / 12;
  const exact = loan === 0 ? 0 : r === 0 ? loan / n : loan * r / (1 - Math.pow(1 + r, -n));
  const monthly = Math.round(exact);
  const totalPaid = monthly * n;
  const out = {
    currency: 'UZS', loan_amount: loan, months: n, monthly_rate_percent: Math.round(r * 100 * 1e6) / 1e6,
    monthly_payment: monthly, total_paid: totalPaid, overpayment: totalPaid - loan
  };
  if (price !== undefined) Object.assign(out, { price, down_payment: down, total_cost: down + totalPaid });
  return out;
}

// Номер квартиры: целое число (можно строкой «37» или «№37»), иначе — понятная ошибка
export function parseNumber(value, apartments) {
  const max = apartments.reduce((m, a) => Math.max(m, a.number), 0);
  if (value === undefined || value === null || String(value).trim() === '') throw new Error('Не указан номер квартиры — например, 37.');
  const n = typeof value === 'number' ? value : Number(String(value).replace(/^\s*№\s*/, '').trim());
  if (!Number.isInteger(n) || n < 1) throw new Error(`«${value}» — не номер квартиры. Номер — целое число от 1 до ${max}, например 37.`);
  return n;
}
function findApartment(apartments, value) {
  const n = parseNumber(value, apartments);
  const a = apartments.find((x) => x.number === n);
  if (!a) {
    const max = apartments.reduce((m, x) => Math.max(m, x.number), 0);
    throw new Error(`Квартиры №${n} нет. В доме квартиры с №1 по №${max}.`);
  }
  return a;
}

// get_apartment: одна квартира по номеру
export function getApartment(list, number) {
  return view(findApartment(list, number));
}

// Телефон: +998XXXXXXXXX или 9 цифр местного номера (добавим +998); пробелы, скобки, дефисы допустимы
export function normalizePhone(phone) {
  const s = String(phone).replace(/[\s()-]/g, '');
  if (/^\d{9}$/.test(s)) return '+998' + s;
  if (/^\+?\d{11,15}$/.test(s)) return s.startsWith('+') ? s : '+' + s;
  throw new Error(`Телефон «${phone}» не похож на номер. Укажите в формате +998 90 123 45 67.`);
}

const pad = (n) => String(n).padStart(2, '0');
const at = (datetime) => new Date(datetime + ':00' + TZ_OFFSET);
const human = (datetime) => `${datetime.slice(8, 10)}.${datetime.slice(5, 7)}.${datetime.slice(0, 4)} в ${datetime.slice(11)}`;

// datetime — «YYYY-MM-DDTHH:MM» по Ташкенту
export function parseVisitTime(datetime, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetime)) {
    throw new Error(`Не понял дату и время «${datetime}». Нужен формат ГГГГ-ММ-ДДTЧЧ:ММ по Ташкенту, например 2026-10-25T11:00.`);
  }
  const t = at(datetime);
  // дата не должна «перескочить» (31 февраля, 25:00 и т. п.)
  if (isNaN(t) || new Date(t.getTime() + 5 * 3600e3).toISOString().slice(0, 16) !== datetime) {
    throw new Error(`Даты ${human(datetime)} не существует — проверьте число, месяц и время.`);
  }
  const hour = Number(datetime.slice(11, 13));
  if (hour < WORK_FROM || hour >= WORK_TO) throw new Error(`Показы проходят с ${WORK_FROM}:00 до ${WORK_TO}:00, а запрошено ${datetime.slice(11)}. Выберите время в этом промежутке.`);
  if (t <= now) throw new Error(`${human(datetime)} уже прошло — выберите время в будущем.`);
  if (t - now > MAX_DAYS_AHEAD * 864e5) throw new Error(`Записаться можно не дальше чем на ${MAX_DAYS_AHEAD} дней вперёд.`);
  return t;
}

// Показ длится час: записи конфликтуют, если начинаются ближе чем через час друг от друга.
// Один менеджер — один показ одновременно, поэтому проверяем по всему дому, а не только по квартире.
const SLOT = 3600e3;
function clash(bookings, t) {
  return bookings.find((b) => b.status !== 'cancelled' && Math.abs(at(b.datetime) - t) < SLOT);
}
// ближайшее свободное время в тот же день (шаг 30 минут), не раньше «сейчас»
function nearestFree(bookings, datetime, now) {
  const day = datetime.slice(0, 10), want = at(datetime);
  const slots = [];
  for (let h = WORK_FROM; h < WORK_TO; h++) for (const m of [0, 30]) slots.push(`${day}T${pad(h)}:${pad(m)}`);
  return slots
    .filter((s) => at(s) > now && !clash(bookings, at(s)))
    .sort((a, b) => Math.abs(at(a) - want) - Math.abs(at(b) - want))[0] || null;
}

// book_viewing: проверяет заявку и добавляет её в список (список сохраняет data.js под «замком»).
// Ошибки по полям собираем вместе — клиенту не придётся исправлять их по одной.
export function addBooking(apartments, bookings, input, now = new Date()) {
  const fields = [['name', 'имя'], ['phone', 'телефон'], ['datetime', 'дата и время'], ['apartment', 'номер квартиры']];
  const missing = fields.filter(([k]) => input[k] === undefined || input[k] === null || String(input[k]).trim() === '').map(([, v]) => v);
  if (missing.length) throw new Error(`Не хватает данных для записи: ${missing.join(', ')}.`);

  const problems = [];
  const name = String(input.name).trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f<>]/.test(name)) problems.push('Имя должно быть от 2 до 100 символов, без служебных знаков.');
  const datetime = String(input.datetime).trim();
  let phone, t, apt;
  try { phone = normalizePhone(input.phone); } catch (e) { problems.push(e.message); }
  try { t = parseVisitTime(datetime, now); } catch (e) { problems.push(e.message); }
  try { apt = findApartment(apartments, input.apartment); } catch (e) { problems.push(e.message); }
  if (apt && apt.status !== 'for_sale') problems.push(`Квартира №${apt.number} уже продана — показать её нельзя. Подберите другую квартиру.`);
  if (problems.length) throw new Error(problems.join('\n'));

  const other = clash(bookings, t);
  if (other) {
    const free = nearestFree(bookings, datetime, now);
    throw new Error(`Время ${human(datetime)} занято: на ${other.datetime.slice(11)} уже записан показ квартиры №${other.apartment} (показ длится час). ` +
      (free ? `Ближайшее свободное время в этот день — ${free.slice(11)}.` : 'В этот день свободного времени нет — выберите другой день.'));
  }
  const last = bookings.reduce((m, b) => Math.max(m, Number((/^BV-(\d+)$/.exec(b.id) || [])[1] || 0)), 0);
  const record = {
    id: 'BV-' + String(last + 1).padStart(4, '0'),
    apartment: apt.number, name, phone, datetime, timezone: 'Asia/Tashkent',
    status: 'new', created_at: now.toISOString()
  };
  bookings.push(record);
  return record;
}
