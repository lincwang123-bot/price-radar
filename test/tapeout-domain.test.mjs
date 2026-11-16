import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, summarize, buildCalendar, paymentAdvice } from '../assets/tapeout/domain.js';

const draft = (overrides = {}) => ({
  id: 'entry-1', name: '我的 AI 工具', amount: '20', currency: 'USD',
  period: 'monthly', renewalDate: '2026-10-12', reminderDays: '3', ...overrides,
});
const valid = (overrides = {}) => {
  const result = validateEntry(draft(overrides));
  assert.equal(result.ok, true, result.error);
  return result.entry;
};
const now = new Date(2026, 9, 12, 12);
const unfold = (text) => text.replace(/\r\n[ \t]/g, '');

test('normalize form values, allow free plans and create a stable missing id', () => {
  const entry = valid({ name: '  免费工具  ', amount: '0', renewalDate: '', reminderDays: '0' });
  assert.deepEqual(entry, {
    id: 'entry-1', name: '免费工具', amount: 0, currency: 'USD',
    period: 'monthly', renewalDate: '', reminderDays: 0,
  });
  const first = valid({ id: undefined });
  const second = valid({ id: undefined });
  assert.ok(first.id);
  assert.equal(first.id, second.id);
});

test('validate amount precision and bounds without accepting coercion, exponent strings or unknown options', () => {
  for (const amount of ['', ' ', '-1', 'NaN', 'Infinity', '1e2', '0x10', '1,000', 1000000.01, Infinity, NaN, null, true, {}, '0.001']) {
    assert.equal(validateEntry(draft({ amount })).ok, false, `amount ${String(amount)}`);
  }
  assert.equal(valid({ amount: '1000000.00' }).amount, 1000000);
  assert.equal(valid({ amount: '0.000001', currency: 'BEM' }).amount, 0.000001);
  assert.equal(valid({ amount: 0.000001, currency: 'BEM' }).amount, 0.000001);
  assert.equal(validateEntry(draft({ amount: '0.0000001', currency: 'BEM' })).ok, false);
  for (const patch of [
    { name: '' }, { name: ' '.repeat(20) }, { name: 'a'.repeat(61) }, { name: 123 },
    { currency: 'BTC' }, { period: 'weekly' }, { reminderDays: -1 },
    { reminderDays: 31 }, { reminderDays: 1.5 }, { reminderDays: '' }, { reminderDays: false },
  ]) assert.equal(validateEntry(draft(patch)).ok, false, JSON.stringify(patch));
  assert.equal(validateEntry(null).ok, false);
});

test('validate real dates, including leap years, without Date rollover', () => {
  assert.equal(valid({ renewalDate: '2028-02-29' }).renewalDate, '2028-02-29');
  assert.equal(valid({ renewalDate: '2000-02-29' }).renewalDate, '2000-02-29');
  for (const renewalDate of ['2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '2026-10-12T00:00:00Z', '0000-01-01']) {
    assert.equal(validateEntry(draft({ renewalDate })).ok, false, renewalDate);
  }
});

test('keep currencies separate and distinguish recurring budget from one-off top-ups', () => {
  const entries = [
    valid({ id: 'usd-month', amount: 20 }),
    valid({ id: 'usd-year', amount: 120, period: 'yearly' }),
    valid({ id: 'usd-once', amount: 50, period: 'once' }),
    valid({ id: 'cny-month', amount: 99, currency: 'CNY' }),
    valid({ id: 'bem-once', amount: '0.000001', currency: 'BEM', period: 'once' }),
  ];
  assert.deepEqual(summarize(entries), [
    { currency: 'CNY', monthly: 99, yearly: 1188, once: 0, count: 1 },
    { currency: 'USD', monthly: 30, yearly: 360, once: 50, count: 3 },
    { currency: 'BEM', monthly: 0, yearly: 0, once: 0.000001, count: 1 },
  ]);
  assert.deepEqual(summarize([]), []);
  assert.equal(summarize([valid({ amount: '0.10' }), valid({ amount: '0.20' })])[0].monthly, 0.3);
  assert.equal(summarize([valid({ amount: 100, period: 'yearly' })])[0].monthly, 100 / 12);
});

test('calendar keeps today, omits past and undated items and creates real all-day events without recurrence', () => {
  const result = unfold(buildCalendar([
    valid({ id: 'today', renewalDate: '2026-10-12' }),
    valid({ id: 'past', renewalDate: '2026-10-11' }),
    valid({ id: 'undated', renewalDate: '' }),
    valid({ id: 'year-end', renewalDate: '2026-12-31', period: 'yearly', reminderDays: 0 }),
    valid({ id: 'leap-day', renewalDate: '2028-02-29', period: 'once' }),
  ], { now }));
  assert.ok(result.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(result.endsWith('END:VCALENDAR\r\n'));
  assert.equal((result.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(result, /DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013/);
  assert.match(result, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(result, /DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301/);
  assert.match(result, /BEGIN:VALARM\r\nTRIGGER:-P3D\r\nACTION:DISPLAY/);
  assert.match(result, /TRIGGER:PT0S/);
  assert.doesNotMatch(result, /RRULE|DTSTART;VALUE=DATE:20261011/);
  assert.equal((result.match(/BEGIN:VALARM/g) || []).length, 3);
});

test('calendar escapes untrusted text and folds UTF-8 at no more than 75 bytes', () => {
  const entry = valid({ id: 'id\r\nATTENDEE:malicious', name: '研发工具,费用;续费\\记录\nEND:VEVENT' + '中文'.repeat(12) });
  const output = buildCalendar([entry], { now });
  for (const line of output.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeded 75 bytes: ${line}`);
    assert.ok(!line.includes('\uFFFD'), 'UTF-8 character was split');
  }
  const unfolded = unfold(output);
  assert.match(unfolded, /研发工具\\,费用\\;续费\\\\记录\\nEND:VEVENT/);
  assert.doesNotMatch(unfolded, /\r\nATTENDEE:/);
  assert.equal((unfolded.match(/\r\nEND:VEVENT\r\n/g) || []).length, 1);
  const later = buildCalendar([entry], { now: new Date(2026, 9, 12, 23) });
  assert.equal(output.match(/UID:([^\r]+)/)[1], later.match(/UID:([^\r]+)/)[1]);
});

test('calendar reports a usable Chinese error if no upcoming date can be exported', () => {
  for (const entries of [[], [valid({ renewalDate: '' })], [valid({ renewalDate: '2026-10-11' })]]) {
    assert.throws(() => buildCalendar(entries, { now }), /没有可导出的.*日期/);
  }
  assert.throws(() => buildCalendar([valid()], { now: new Date(NaN) }), /日期/);
});

test('advice separates personal subscriptions, API use and TapeCode, with attributed relevant links', () => {
  const web = paymentAdvice('subscription', false);
  const existing = paymentAdvice('subscription', true);
  const coding = paymentAdvice('coding', false);
  const tape = paymentAdvice('tapecode', false);
  for (const advice of [web, existing, coding, tape]) {
    assert.equal(typeof advice.title, 'string');
    assert.equal(typeof advice.body, 'string');
    assert.ok(advice.title && advice.body);
    if (advice.actionUrl) {
      const url = new URL(advice.actionUrl);
      assert.equal(url.origin, 'https://airadar.vip');
      assert.equal(url.searchParams.get('utm_source'), 'tapeout');
      assert.equal(url.searchParams.get('utm_medium'), 'deweb');
      assert.equal(url.searchParams.get('utm_campaign'), 'deweb-entry');
    }
  }
  assert.match(web.body, /API/);
  assert.match(existing.body, /已有|现有/);
  assert.match(coding.body, /编程|编辑器/);
  assert.match(tape.body, /token/);
  assert.match(tape.body, /BYOK/);
  assert.match(tape.body, /不需要.*个人会员/);
  assert.doesNotMatch([web.body, existing.body, coding.body, tape.body].join(''), /共享账号|合租/);
});
