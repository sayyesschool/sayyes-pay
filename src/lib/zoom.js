// Постоянная комната Zoom для пробных уроков.
// Ссылка с кодом внутри: клиент заходит в один клик, но номер и код тоже показываем —
// если человек заходит из приложения, ему нужен именно номер.
// Меняется комната — правим переменные окружения, код трогать не надо.
export const ZOOM_JOIN_URL = process.env.ZOOM_JOIN_URL || 'https://us06web.zoom.us/j/5479767237?pwd=TFVGd0E4TmxNTlA4TjdzZlpIL0Q5Zz09';
export const ZOOM_MEETING_ID = process.env.ZOOM_MEETING_ID || '547 976 7237';
export const ZOOM_PASSCODE = process.env.ZOOM_PASSCODE || '590010';
