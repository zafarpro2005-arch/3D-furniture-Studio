// Файлы данных в корне проекта: apartments.json (только чтение) и booking.json (записи на показ).
// Папку можно переопределить DATA_DIR — так тесты работают на копии, не трогая настоящие файлы.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export function dataDir() {
  return process.env.DATA_DIR || path.resolve(import.meta.dirname, '..');
}

// Квартиры читаем при каждом вызове: правки apartments.json видны без перезапуска сервера
export async function loadApartments() {
  const file = path.join(dataDir(), 'apartments.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!data || !Array.isArray(data.apartments)) throw new Error('apartments.json: нет массива apartments');
  return data.apartments;
}

async function readBookings(file) {
  try {
    const list = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(list)) throw new Error('booking.json: ожидается массив записей');
    return list;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Запись в booking.json — строго по очереди (чтение → проверка → запись под одним «замком»),
// чтобы два одновременных запроса не затёрли друг друга. Пишем во временный файл и переименовываем:
// при сбое посреди записи старый booking.json остаётся целым.
let queue = Promise.resolve();
export function updateBookings(change) {
  const run = queue.then(async () => {
    const file = path.join(dataDir(), 'booking.json');
    const list = await readBookings(file);
    const result = change(list); // бросает ошибку, если запись нельзя добавить
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
    return result;
  });
  queue = run.catch(() => {}); // ошибка одного запроса не ломает очередь
  return run;
}
