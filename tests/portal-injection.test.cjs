const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const notifications = require('../notifications.js');

test('places Notifications below Jem and before Insights', () => {
  const html = fs.readFileSync(require.resolve('../portal.html'), 'utf8');
  const match = html.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, 'bundled portal template was not found');

  let template = JSON.parse(match[1]);
  const connectStart = template.indexOf('<!-- CONNECT -->');
  const insightsStart = template.indexOf('<!-- INSIGHTS -->', connectStart);
  const connectClose = template.lastIndexOf('</div>\n    </sc-if>', insightsStart);
  assert.ok(connectStart >= 0 && insightsStart > connectStart && connectClose > connectStart);

  const section = notifications.renderSection({ items: [{
    source_id: 'integration-check',
    card_name: 'Test notification',
    heading: 'Visible beneath Jem',
    start_date: '2026-08-01',
    end_date: '2026-08-31',
    status: 'Active',
  }] }, new Date(2026, 7, 12));
  template = template.slice(0, connectClose) + section + template.slice(connectClose);

  const jem = template.indexOf('>Jem<', connectStart);
  const notificationSection = template.indexOf('id="nexus-georep-notifications"', connectStart);
  const insights = template.indexOf('<!-- INSIGHTS -->', connectStart);
  assert.ok(jem > connectStart, 'Jem card was not found');
  assert.ok(notificationSection > jem, 'Notifications was not placed below Jem');
  assert.ok(insights > notificationSection, 'Notifications must remain inside Connect');
});
