// Перенос - это новый урок. Всё, что относилось к прошлому времени урока,
// сбрасываем в одном месте для всех путей переноса (бот, воронка, админка).
//
// 16.11.2026: раньше каждый путь перечислял флаги сам, и «⏰ Не вышел, напомнить»
// (lateNudgedAt) не сбрасывался. Ученица не вышла 13.11, получила напоминание,
// перенеслась на 16.11, снова не вышла - и кнопка ответила «Уже отправлено».
// Новые поля урока добавлять сюда.
export const LESSON_RESET = {
  // 19.11.2026: перенос оживляет и снятую запись. Раньше бот переносил снятую
  // автоматикой запись, но статус оставался «отменена»: урок пропадал из расписания,
  // напоминаний и брифа (Jana, d4kj4evj: перенесли с 13.11 на 18.11 - урока не было видно),
  // а ссылка «выберите новое время» из письма о снятии отвечала «Запись недействительна».
  status: 'confirmed',
  releasedUnconfirmed: false,
  releasedAt: null,
  cancelledAt: null,
  cancelSource: null,
  releaseReason: null,
  reminded24h: false,
  reminded1h: false,
  mailed24h: false,
  mailed12h: false,
  mailed1h: false,
  morningSent: null,
  hostBriefed: false,
  attendanceAsked: false,
  attendanceAskedStage: 0,
  // «Не вышел, напомнить» и повторное напоминание ведущей через 10 минут
  lateNudgedAt: null,
  lateNudgedBy: null,
  lateNudgeChat: null,
  lateFollowupSent: false,
  // Список «не подтвердили» для менеджеров (contactList.js)
  contactListAt: null,
  contactList: null,
  contactClaimBy: null,
  contactClaimAt: null,
  // Ведущий брал прошлое время: на новое время урок берут заново
  hostUsername: null,
  hostName: null,
  hostAssignedAt: null,
  // Отметки прошлого урока
  attended: null,
  attendedBy: null,
  attendanceMarkedAt: null,
  attendedSent: false,
  introExpiresAt: null,
  confirmed: false,
  confirmedAt: null,
  confirmedVia: null
};

// Запись о переносе в переписке карточки: кто, откуда и куда перенёс (19.11.2026).
// Раньше по карточке нельзя было понять, кто и как поставил время.
export function rescheduleNote(booking, newSlot, who) {
  const fmt = slot => {
    if (!slot || slot === 'no_time') return 'без времени';
    const [d, t] = String(slot).split('_');

    return d.slice(8, 10) + '.' + d.slice(5, 7) + ' ' + t;
  };
  const was = booking && booking.status === 'cancelled' ? ' (запись была снята)' : '';

  return '🔄 Перенос: ' + fmt(booking && booking.slot) + ' → ' + fmt(newSlot) + ' МСК' + was + (who ? ' · ' + who : '');
}
