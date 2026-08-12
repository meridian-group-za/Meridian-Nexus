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

test('embeds an uploaded image to the right of the notification copy', () => {
  const html = notifications.renderCard({
    card_name: 'Oral B Training',
    heading: 'Training is now live',
    image_url: 'https://example.test/oral-b.png',
  });
  assert.ok(html.includes('data-nexus-notification-image'));
  assert.ok(html.includes('width:clamp(78px,30%,104px)'));
  assert.ok(html.indexOf('data-nexus-notification-copy') < html.indexOf('data-nexus-notification-image'));
});

test('accepts browser-created private image URLs but not unsafe action URLs', () => {
  assert.equal(notifications.safeImageUrl('blob:https://nexus.example/private-image'), 'blob:https://nexus.example/private-image');
  assert.equal(notifications.safeUrl('blob:https://nexus.example/not-an-action'), '');
});

test('renders a private SharePoint loading state without embedding feed data', () => {
  const html = notifications.renderSection({ items: [] }, new Date(2026, 7, 12), { loading: true });
  assert.ok(html.includes('Loading private notifications'));
  assert.ok(html.includes('Connecting to SharePoint'));
});
