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

export function getApartment(list, number) {
  const a = list.find((x) => x.number === number);
  if (!a) throw new Error(`Квартира №${number} не найдена`);
  return view(a);
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

// Телефон: +998XXXXXXXXX или 9 цифр местного номера (добавим +998); пробелы, скобки, дефисы допустимы
export function normalizePhone(phone) {
  const s = String(phone).replace(/[\s()-]/g, '');
  if (/^\d{9}$/.test(s)) return '+998' + s;
  if (/^\+?\d{11,15}$/.test(s)) return s.startsWith('+') ? s : '+' + s;
  throw new Error('Телефон: ожидается +998XXXXXXXXX или 9 цифр номера');
}

// datetime — «YYYY-MM-DDTHH:MM» по Ташкенту
export function parseVisitTime(datetime, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetime)) throw new Error('Дата и время: формат YYYY-MM-DDTHH:MM (по Ташкенту)');
  const t = new Date(datetime + ':00' + TZ_OFFSET);
  if (isNaN(t)) throw new Error('Дата и время: такой даты нет');
  // проверка, что дата не «перескочила» (31 февраля и т. п.)
  const local = new Date(t.getTime() + 5 * 3600e3).toISOString().slice(0, 16);
  if (local !== datetime) throw new Error('Дата и время: такой даты нет');
  const hour = Number(datetime.slice(11, 13));
  if (hour < WORK_FROM || hour >= WORK_TO) throw new Error(`Показы — с ${WORK_FROM}:00 до ${WORK_TO}:00`);
  if (t <= now) throw new Error('Дата и время показа уже прошли');
  if (t - now > MAX_DAYS_AHEAD * 864e5) throw new Error(`Записаться можно не дальше чем на ${MAX_DAYS_AHEAD} дней вперёд`);
  return t;
}

// booking_view: проверяет вход и добавляет запись в список (список потом сохраняет data.js)
export function addBooking(apartments, bookings, input, now = new Date()) {
  const name = String(input.name).trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f<>]/.test(name)) throw new Error('Имя: от 2 до 100 символов, без служебных знаков');
  const phone = normalizePhone(input.phone);
  const t = parseVisitTime(input.datetime, now);
  const apt = apartments.find((a) => a.number === input.apartment);
  if (!apt) throw new Error(`Квартира №${input.apartment} не найдена`);
  if (apt.status !== 'for_sale') throw new Error(`Квартира №${apt.number} продана — показ невозможен`);
  // одна квартира — один показ в час
  const busy = bookings.some((b) => b.apartment === apt.number && b.status !== 'cancelled' &&
    Math.abs(new Date(b.datetime + ':00' + TZ_OFFSET) - t) < 3600e3);
  if (busy) throw new Error(`На ${input.datetime} квартира №${apt.number} уже занята — выберите другое время`);
  const record = {
    id: 'B' + now.getTime().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(),
    apartment: apt.number, name, phone, datetime: input.datetime, timezone: 'Asia/Tashkent',
    status: 'new', created_at: now.toISOString()
  };
  bookings.push(record);
  return record;
}
