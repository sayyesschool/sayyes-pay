import { NextResponse } from 'next/server';

import { kvMGet } from '@/lib/redis';
import { loadBookings, slotStartMs, dayKey } from '@/lib/analytics';
import { outsideTargetTz } from '@/lib/meta';

// Кто отменяет записи и что с этими людьми потом. Только счётчики, без имён и почт.
//
// До 26.09.2026 отмена учеником в боте и отмена менеджером писали в заявку одно и то же
// (status: 'cancelled'), поэтому для старых записей источник восстанавливается
// по косвенным признакам и помечен как «вероятно». С поля cancelSource источник точный.
//
// ?days=N - записи, чьё время урока попало в последние N суток (по умолчанию 30),
// включая будущие уроки, которые уже успели отменить.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function digits(value) {
  const d = String(value || '').replace(/\D/g, '');

  return d.length >= 7 ? d.slice(-9) : '';
}

// Ключи, по которым два заявки считаются одним человеком.
function personKeys(b) {
  const keys = [];

  if (b.chatId) keys.push('c:' + b.chatId);
  if (norm(b.email)) keys.push('e:' + norm(b.email));
  if (digits(b.phone)) keys.push('p:' + digits(b.phone));
  if (norm(b.telegram).replace(/^@/, '')) keys.push('t:' + norm(b.telegram).replace(/^@/, ''));

  return keys;
}

function bucketHours(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return 'нет времени отмены';
  if (hours < 0) return 'после начала урока';
  if (hours < 6) return 'меньше 6 ч до урока';
  if (hours < 24) return '6-24 ч';
  if (hours < 72) return '1-3 дня';
  return 'больше 3 дней';
}

function bucketLead(hours) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return 'не указано';
  if (hours < 8) return 'меньше 8 ч';
  if (hours < 24) return '8-24 ч';
  if (hours < 72) return '1-3 дня';
  return 'больше 3 дней';
}

function inc(map, key, by = 1) {
  const safe = String(key === undefined || key === null || key === '' ? 'не указано' : key).slice(0, 60);

  map[safe] = (map[safe] || 0) + by;
}

export async function GET(request) {
  try {
    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days')) || 30, 1), 120);
    const now = Date.now();
    const since = now - days * DAY;
    const all = await loadBookings();

    // Люди: кто из отменивших записался снова и дошёл ли.
    const byPerson = new Map();

    for (const b of all) {
      for (const key of personKeys(b)) {
        if (!byPerson.has(key)) byPerson.set(key, []);
        byPerson.get(key).push(b);
      }
    }

    const inWindow = all.filter(b => {
      const start = slotStartMs(b);

      return start && start >= since;
    });
    const cancelled = inWindow.filter(b => b.status === 'cancelled');

    // Ученик, отменивший запись в боте, теряет привязку user:<chatId> (clearUserBooking).
    // Менеджерская отмена её не трогает. Для старых записей это единственный след.
    const chatIds = [...new Set(cancelled.filter(b => b.chatId && !b.cancelSource).map(b => String(b.chatId)))];
    const links = chatIds.length ? await kvMGet(chatIds.map(id => 'user:' + id)) : [];
    const linkOf = new Map(chatIds.map((id, i) => [id, links[i] || null]));

    const source = {};
    const hoursBefore = {};
    const confirmedAtCancel = {};
    const lead = {};
    const bySourceUtm = {};
    const country = {};
    const byWeek = {};
    const tzOutside = { outside: 0, inside: 0, unknown: 0 };
    const after = { rebooked: 0, rebookedAttended: 0, rebookedPaid: 0, notRebooked: 0 };
    const afterBySource = {};

    for (const b of cancelled) {
      let src = b.cancelSource;

      if (!src) {
        if (b.releasedUnconfirmed) src = 'auto_unconfirmed';
        else if (b.releasedByManager) src = 'cleanslots';
        else if (b.cancelledBy) src = 'admin';
        else if (!b.chatId) src = 'неизвестно (без бота)';
        else {
          const link = linkOf.get(String(b.chatId));

          if (link === b.id) src = 'вероятно менеджер в боте';
          else if (!link) src = 'вероятно ученик в боте';
          else src = 'бот, записался заново';
        }
      }

      inc(source, src);

      const start = slotStartMs(b);
      const at = b.cancelledAt || b.releasedAt;
      const atMs = at ? new Date(at).getTime() : null;

      inc(hoursBefore, bucketHours(atMs ? (start - atMs) / HOUR : null));
      inc(confirmedAtCancel, b.confirmed ? 'подтверждал' : 'не подтверждал');

      const created = b.createdAt ? new Date(b.createdAt).getTime() : null;

      inc(lead, bucketLead(created ? (start - created) / HOUR : null));

      const attr = b.attribution || {};

      inc(bySourceUtm, attr.utm_source || (attr.fbclid || attr.ad_id ? 'meta' : 'без метки'));
      inc(country, (b.quizAnswers || {})['Страна']);
      inc(byWeek, dayKey(start - ((new Date(start).getUTCDay() + 6) % 7) * DAY));

      const tz = b.tz || attr.tz;

      if (!tz) tzOutside.unknown++;
      else if (outsideTargetTz(tz)) tzOutside.outside++;
      else tzOutside.inside++;

      // Записался ли тот же человек снова после этой заявки.
      const later = new Set();

      for (const key of personKeys(b)) {
        for (const other of byPerson.get(key) || []) {
          if (other.id === b.id) continue;
          if (other.status === 'cancelled') continue;
          if ((other.createdAt || '') <= (b.createdAt || '')) continue;
          later.add(other);
        }
      }

      const cell = afterBySource[src] || (afterBySource[src] = { cancelled: 0, rebooked: 0, attended: 0 });

      cell.cancelled++;

      if (later.size) {
        after.rebooked++;
        cell.rebooked++;

        if ([...later].some(o => o.attended === true)) {
          after.rebookedAttended++;
          cell.attended++;
        }

        if ([...later].some(o => o.paid)) after.rebookedPaid++;
      } else {
        after.notRebooked++;
      }
    }

    const lessonsPast = inWindow.filter(b => b.status !== 'cancelled' && slotStartMs(b) <= now).length;

    return NextResponse.json({
      note: 'Отменённые записи с временем урока за последние N суток. Источник без префикса точный, «вероятно» восстановлен по следам в базе.',
      days,
      bookings: inWindow.length,
      cancelled: cancelled.length,
      lessonsPast,
      source,
      hoursBeforeLesson: hoursBefore,
      confirmedAtCancel,
      leadTime: lead,
      utmSource: bySourceUtm,
      country,
      timezone: tzOutside,
      byWeek,
      afterCancel: after,
      afterCancelBySource: afterBySource
    }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
