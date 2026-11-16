// Перенос - это новый урок. Всё, что относилось к прошлому времени урока,
// сбрасываем в одном месте для всех путей переноса (бот, воронка, админка).
//
// 16.11.2026: раньше каждый путь перечислял флаги сам, и «⏰ Не вышел, напомнить»
// (lateNudgedAt) не сбрасывался. Ученица не вышла 13.11, получила напоминание,
// перенеслась на 16.11, снова не вышла - и кнопка ответила «Уже отправлено».
// Новые поля урока добавлять сюда.
export const LESSON_RESET = {
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
