import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRecord } from '../scripts/sync-georep-notifications.mjs';

test('maps the live GeoRep ContentFeed field names', () => {
  const item = normalizeRecord({
    content_feed_id: 731,
    card_name: 'Client update',
    card_headline: 'New content is live',
    card_sub_text: 'Review the new planogram.',
    start_date: '2026-08-12',
    end_date: '2026-09-30',
    active: 1,
    priority: 2,
    content_type_details: { content_type_name: 'Information' },
    card_type_details: { card_type_name: '3 Row_Image' },
    card_image: '/uploads/card.png',
    web_link: 'https://example.test/content/731',
    action_text: 'View content',
  }, 0, 'https://meridian.georep.com/portal_api/ContentFeed/fetch');

  assert.deepEqual(item, {
    source_id: '731',
    card_name: 'Client update',
    heading: 'New content is live',
    description: 'Review the new planogram.',
    start_date: '2026-08-12',
    end_date: '2026-09-30',
    content_type: 'Information',
    card_type: '3 Row_Image',
    status: 'Active',
    priority: 2,
    image_url: 'https://meridian.georep.com/uploads/card.png',
    target_url: 'https://example.test/content/731',
    action_text: 'View content',
  });
});
