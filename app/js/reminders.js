// 월간 점검 알림.
// 1) 휴대폰·PC 달력에 매달 반복 일정(.ics) 등록 — 앱이 꺼져 있어도 알림이 온다.
// 2) 앱을 열었을 때 이번 달 할 일이 있으면 시스템 알림 1회.

const pad = (n) => String(n).padStart(2, '0');

export function buildICS({ day, url, year }) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), day);
  if (start < now) start.setMonth(start.getMonth() + 1);
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//taxcheck//monthly//KO',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:taxcheck-monthly-${year}@taxcheck`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(start)}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
    'SUMMARY:연말정산 월간 점검',
    `DESCRIPTION:지난달 카드 사용액과 연금저축·IRP 납입액을 입력하세요.\\n${url}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:연말정산 월간 점검',
    'TRIGGER:PT9H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadICS(opts) {
  const blob = new Blob([buildICS(opts)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '연말정산-월간점검.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

// 이번 달에 아직 알리지 않은 긴급 항목이 있으면 시스템 알림
export async function notifyIfNeeded(recommendations, settings, saveSettings) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const key = `${new Date().getFullYear()}-${new Date().getMonth() + 1}`;
  if (settings.lastNotified === key) return;
  const urgent = recommendations.filter((r) => r.level === 'urgent');
  if (!urgent.length) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const title = '연말정산 월간 점검';
  const body = urgent.map((r) => `• ${r.title}`).join('\n');
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'monthly' };
  if (reg) reg.showNotification(title, opts);
  else new Notification(title, opts);
  saveSettings({ lastNotified: key });
}
