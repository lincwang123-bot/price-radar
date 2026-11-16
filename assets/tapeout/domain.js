// Browser-safe domain logic: no prices, exchange rates, storage or network access.
const CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'BEM'];
const PERIODS = ['monthly', 'yearly', 'once'];
const encoder = new TextEncoder();
const campaign = 'utm_source=tapeout&utm_medium=deweb&utm_campaign=deweb-entry';
const attributed = (path, content) => `https://airadar.vip${path}?${campaign}&utm_content=${content}`;

function stableHash(value) {
  let a = 2166136261;
  let b = 2246822519;
  for (const byte of encoder.encode(value)) {
    a = Math.imul(a ^ byte, 16777619);
    b = Math.imul(b ^ byte, 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** Return a normalized plain-text entry or a user-facing validation error. */
export function validateEntry(raw) {
  const fail = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('费用记录格式不正确。');
  if (typeof raw.name !== 'string') return fail('请填写工具名称（1–60 个字符）。');
  const name = raw.name.trim().replace(/\r\n?/g, '\n');
  if (!name || [...name].length > 60 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(name)) {
    return fail('请填写工具名称（1–60 个字符）。');
  }
  const currency = raw.currency;
  if (!CURRENCIES.includes(currency)) return fail('请选择支持的币种。');
  const period = raw.period;
  if (!PERIODS.includes(period)) return fail('请选择月付、年付或一次性费用。');

  const decimals = currency === 'BEM' ? 6 : 2;
  const scale = 10 ** decimals;
  if (typeof raw.amount !== 'string' && typeof raw.amount !== 'number') return fail('请填写实际每期费用，免费工具可填 0。');
  if (typeof raw.amount === 'string') {
    const text = raw.amount.trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) return fail('请填写实际每期费用，免费工具可填 0。');
    if ((text.split('.')[1] || '').length > decimals) return fail(`${currency} 金额最多保留 ${decimals} 位小数。`);
  }
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return fail('每期费用须在 0 到 1,000,000 之间。');
  const units = amount * scale;
  if (Math.abs(units - Math.round(units)) > Number.EPSILON * Math.max(1, Math.abs(units)) * 4) {
    return fail(`${currency} 金额最多保留 ${decimals} 位小数。`);
  }

  const renewalDate = raw.renewalDate ?? '';
  if (typeof renewalDate !== 'string' || (renewalDate !== '' && !validDate(renewalDate))) {
    return fail('请填写有效的日期，格式为 YYYY-MM-DD。');
  }
  const reminderRaw = raw.reminderDays ?? 3;
  if ((typeof reminderRaw !== 'number' && typeof reminderRaw !== 'string') || (typeof reminderRaw === 'string' && !/^\d+$/.test(reminderRaw))) {
    return fail('提醒天数须为 0–30 之间的整数。');
  }
  const reminderDays = Number(reminderRaw);
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 30) return fail('提醒天数须为 0–30 之间的整数。');
  const normalizedAmount = Math.round(units) / scale;
  const fallbackId = `entry-${stableHash(JSON.stringify([name, normalizedAmount, currency, period, renewalDate, reminderDays]))}`;
  const id = typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 160 ? raw.id.trim() : fallbackId;
  return { ok: true, entry: { id, name, amount: normalizedAmount, currency, period, renewalDate, reminderDays } };
}

function normalizedEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('费用记录格式不正确。');
  return entries.map((raw) => {
    const result = validateEntry(raw);
    if (!result.ok) throw new Error(result.error);
    return result.entry;
  });
}

/** Recurring amounts remain separate from top-ups, and currencies never mix. */
export function summarize(entries) {
  const groups = new Map();
  for (const entry of normalizedEntries(entries)) {
    const scale = entry.currency === 'BEM' ? 1_000_000 : 100;
    const group = groups.get(entry.currency) || { scale, monthly: 0n, yearly: 0n, once: 0n, count: 0 };
    group[entry.period] += BigInt(Math.round(entry.amount * scale));
    group.count += 1;
    groups.set(entry.currency, group);
  }
  return CURRENCIES.filter((currency) => groups.has(currency)).map((currency) => {
    const group = groups.get(currency);
    const annualUnits = group.monthly * 12n + group.yearly;
    return {
      currency,
      monthly: Number(annualUnits) / (group.scale * 12),
      yearly: Number(annualUnits) / group.scale,
      once: Number(group.once) / group.scale,
      count: group.count,
    };
  });
}

function escapeCalendarText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line) {
  const parts = [];
  let segment = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      parts.push(segment);
      segment = ' ';
      bytes = 1;
    }
    segment += character;
    bytes += size;
  }
  parts.push(segment);
  return parts.join('\r\n');
}

function dateString(date, utc = false) {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function followingDay(date) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(0);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCFullYear(year, month - 1, day + 1);
  return dateString(next, true).replace(/-/g, '');
}

/** Export one all-day event per entered date. No recurrence is inferred. */
export function buildCalendar(entries, { now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('当前日期无效，请刷新后重试。');
  const today = dateString(now);
  const upcoming = normalizedEntries(entries).filter((entry) => entry.renewalDate && entry.renewalDate >= today);
  if (!upcoming.length) throw new Error('没有可导出的提醒日期，请填写今天或之后的日期。');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Radar//AI Cost Helper//ZH-CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const periodNames = { monthly: '月付', yearly: '年付', once: '一次性费用或充值' };
  for (const entry of upcoming) {
    const title = `${entry.period === 'once' ? '费用检查' : '续费检查'}：${entry.name}`;
    const description = `记录的实际费用：${entry.amount} ${entry.currency}，${periodNames[entry.period]}。此事件只对应你填写的日期，不会自动重复；请自行确认是否需要续费或充值。`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:tapeout-${stableHash(entry.id)}@airadar.vip`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${entry.renewalDate.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${followingDay(entry.renewalDate)}`,
      `SUMMARY:${escapeCalendarText(title)}`,
      `DESCRIPTION:${escapeCalendarText(description)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      `TRIGGER:${entry.reminderDays === 0 ? 'PT0S' : `-P${entry.reminderDays}D`}`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeCalendarText(title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** Explain billing boundaries; prices and entitlements must be checked at source. */
export function paymentAdvice(mode, hasSubscription) {
  if (mode === 'tapecode') {
    return {
      title: '用 TapeCode，先选择平台余额或自己的 API Key',
      body: 'TapeCode 可使用官方平台余额按 token 用量付费，也可自带 API Key（BYOK）。仅为使用 TapeCode，不需要再买个人会员；个人订阅与 API 不共用账单。余额或 API 费用应按实际支出记录，平台的最新规则请以官方说明为准。',
    };
  }
  if (mode === 'coding' || mode === 'code') {
    return {
      title: hasSubscription ? '先核对已有编程工具的可用额度' : '先选编程工具，再核对它的计费方式',
      body: hasSubscription
        ? '已有可用会员时，先用现有编程或编辑器功能，再判断是否需要额外额度。编程工具会员、自带 API Key 的用量和个人聊天订阅可能分别收费，不能把一份会员当作通用 API 余额。'
        : '先确认你使用的编程工具或编辑器支持会员、按量计费还是自带 API Key。个人聊天订阅与 API 不共用账单；买会员前核对工具、套餐额度和使用方式是否匹配。',
      actionLabel: '查看 Cursor 订阅报价',
      actionUrl: attributed('/prices/cursor-pro', 'advice_cursor'),
    };
  }
  return {
    title: hasSubscription ? '先用好已有会员，再决定是否加购' : '主要在网页或 App 使用，先核对个人会员',
    body: hasSubscription
      ? '已有可用会员时，先用其现有功能，确认遇到额度或功能限制后再考虑加购。个人订阅与 API 不共用账单；请分别记录实际费用，避免为同一用途重复付费。'
      : '主要在官方网页或 App 聊天、写作和生成内容时，可先试用免费功能，再判断是否需要个人会员。个人订阅与 API 不共用账单，会员通常不能直接作为程序调用 API 的余额。',
    actionLabel: '查看官方订阅参考',
    actionUrl: attributed('/official-prices', 'advice_official'),
  };
}
