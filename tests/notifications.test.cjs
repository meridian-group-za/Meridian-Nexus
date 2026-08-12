const assert = require('node:assert/strict');
const test = require('node:test');
const notifications = require('../notifications.js');

test('keeps only active notifications inside their inclusive date range', () => {
  const items = [
    { id: 'active', status: 'Active', start_date: '2026-08-01', end_date: '2026-08-12' },
    { id: 'future', status: 'Active', start_date: '2026-08-13', end_date: '2026-08-30' },
    { id: 'expired', status: 'Active', start_date: '2026-07-01', end_date: '2026-08-11' },
    { id: 'inactive', status: 'Inactive', start_date: '2026-08-01', end_date: '2026-08-30' },
  ];
  assert.deepEqual(
    notifications.activeForDate(items, new Date(2026, 7, 12)).map((item) => item.id),
    ['active'],
  );
});

test('sorts by priority and then newest start date', () => {
  const items = [
    { id: 'later', priority: 2, status: 'Active', start_date: '2026-08-02' },
    { id: 'older', priority: 1, status: 'Active', start_date: '2026-08-01' },
    { id: 'newer', priority: 1, status: 'Active', start_date: '2026-08-03' },
  ];
  assert.deepEqual(
    notifications.activeForDate(items, new Date(2026, 7, 12)).map((item) => item.id),
    ['newer', 'older', 'later'],
  );
});

test('escapes untrusted notification text and rejects unsafe links', () => {
  const html = notifications.renderCard({
    card_name: '<img src=x onerror=alert(1)>',
    heading: '<script>alert(1)</script>',
    target_url: 'javascript:alert(1)',
    status: 'Active',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
});
