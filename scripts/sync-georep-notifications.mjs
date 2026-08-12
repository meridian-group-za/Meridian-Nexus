import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const outputPath = path.join(repositoryRoot, 'notifications.json');
const endpoint = String(process.env.GEOREP_NOTIFICATIONS_URL || '').trim();

function canonicalKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function indexRecord(record) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [canonicalKey(key), value]));
}

function pick(index, candidates) {
  for (const candidate of candidates) {
    const value = index[canonicalKey(candidate)];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function isoDay(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dayFirst = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function detailValue(value, candidates) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = detailValue(entry, candidates);
      if (resolved !== '') return resolved;
    }
    return '';
  }
  if (value && typeof value === 'object') return pick(indexRecord(value), candidates);
  return value == null ? '' : value;
}

function absoluteUrl(value, baseUrl = endpoint) {
  let candidate = String(detailValue(value, ['url', 'link', 'path', 'file', 'src']) || '').trim();
  if (!candidate) return '';
  if (/^www\./i.test(candidate)) candidate = `https://${candidate}`;
  try {
    return new URL(candidate, baseUrl).href;
  } catch {
    return '';
  }
}

function normalizeStatus(value) {
  if (typeof value === 'boolean') return value ? 'Active' : 'Inactive';
  const status = String(value == null ? '' : value).trim();
  if (!status) return 'Active';
  if (['1', 'yes', 'true', 'on', 'enabled', 'active'].includes(status.toLowerCase())) return 'Active';
  if (['0', 'no', 'false', 'off', 'disabled', 'inactive'].includes(status.toLowerCase())) return 'Inactive';
  return status;
}

function normalizeRecord(record, position, baseUrl = endpoint) {
  const index = indexRecord(record);
  const contentType = detailValue(
    pick(index, ['content_type_details', 'content_type', 'contenttype', 'type']),
    ['content_type_name', 'name', 'label', 'type'],
  );
  const cardType = detailValue(
    pick(index, ['card_type_details', 'card_type', 'cardtype', 'layout']),
    ['card_type_name', 'name', 'label', 'type'],
  );
  const normalized = {
    source_id: String(pick(index, ['content_feed_id', 'source_id', 'notification_id', 'card_id', 'id', 'uuid'])),
    card_name: String(pick(index, ['card_name', 'cardname', 'client', 'name'])),
    heading: String(pick(index, ['card_headline', 'heading', 'landing_header', 'card_info_heading', 'title', 'subject'])),
    description: String(pick(index, ['card_sub_text', 'description', 'landing_text', 'card_info_text', 'content', 'body', 'message', 'text'])),
    start_date: isoDay(pick(index, ['start_date', 'startdate', 'date_from', 'from_date'])),
    end_date: isoDay(pick(index, ['end_date', 'enddate', 'expiry_date', 'expiration_date', 'date_to', 'to_date'])),
    content_type: String(contentType || 'Information'),
    card_type: String(cardType || ''),
    status: normalizeStatus(pick(index, ['status', 'active', 'is_active', 'enabled'])),
    priority: Number(pick(index, ['priority', 'sort_order', 'order']) || position + 1),
    image_url: absoluteUrl(pick(index, ['card_image', 'landing_image', 'card_info_image', 'hunt_image', 'image_url', 'image', 'thumbnail']), baseUrl),
    target_url: absoluteUrl(pick(index, ['web_link', 'download_file', 'app_link', 'video', 'gif', 'target_url', 'url', 'link', 'content_url', 'action_url']), baseUrl),
    action_text: String(pick(index, ['action_text']) || 'Open'),
  };
  if (!normalized.source_id) {
    normalized.source_id = crypto
      .createHash('sha256')
      .update([normalized.card_name, normalized.heading, normalized.start_date, normalized.end_date].join('|'))
      .digest('hex')
      .slice(0, 20);
  }
  if (!normalized.card_name) normalized.card_name = normalized.heading || 'GeoRep notification';
  if (!normalized.heading) normalized.heading = normalized.card_name;
  return normalized;
}

function findRecordArray(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    if (!value.length || value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return value;
    for (const item of value) {
      const nested = findRecordArray(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const preferred of ['data', 'items', 'results', 'records', 'notifications', 'aaData']) {
      if (Object.prototype.hasOwnProperty.call(value, preferred)) {
        const nested = findRecordArray(value[preferred], depth + 1);
        if (nested) return nested;
      }
    }
    for (const nestedValue of Object.values(value)) {
      const nested = findRecordArray(nestedValue, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) throw new Error(`GeoRep returned HTTP ${response.status}`);
  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error('GeoRep did not return JSON. Confirm the notification data endpoint rather than the HTML portal page.');
  }
}

async function fetchAllRecords(sourceUrl, headers) {
  const firstUrl = new URL(sourceUrl);
  if (['http:', 'https:'].includes(firstUrl.protocol) && !firstUrl.searchParams.has('page_nr')) {
    firstUrl.searchParams.set('page_nr', '0');
  }
  const firstPayload = await fetchJson(firstUrl.href, headers);
  const records = [...(findRecordArray(firstPayload) || [])];
  const totalPages = Math.max(1, Number(firstPayload.total_pages || firstPayload.totalPages || 1));
  for (let page = 1; page < totalPages; page += 1) {
    const pageUrl = new URL(sourceUrl);
    pageUrl.searchParams.set('page_nr', String(page));
    const payload = await fetchJson(pageUrl.href, headers);
    records.push(...(findRecordArray(payload) || []));
  }
  return records;
}

async function main() {
  if (!endpoint) {
    throw new Error('GEOREP_NOTIFICATIONS_URL is required. Use the authenticated GeoRep JSON endpoint.');
  }
  const headers = { Accept: 'application/json' };
  if (process.env.GEOREP_AUTHORIZATION) headers.Authorization = process.env.GEOREP_AUTHORIZATION;
  if (process.env.GEOREP_COOKIE) headers.Cookie = process.env.GEOREP_COOKIE;

  const records = await fetchAllRecords(endpoint, headers);
  if (records.length === 0) {
    throw new Error('GeoRep returned no notification records; refusing to replace the existing Nexus feed.');
  }

  const items = records.map((record, position) => normalizeRecord(record, position, endpoint)).sort((left, right) => {
    const priority = left.priority - right.priority;
    return priority || right.start_date.localeCompare(left.start_date) || left.source_id.localeCompare(right.source_id);
  });

  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  } catch {
    existing = null;
  }

  if (existing && JSON.stringify(existing.items) === JSON.stringify(items)) {
    console.log(`GeoRep notification feed is unchanged (${items.length} records).`);
    return;
  }

  const output = { generated_at: new Date().toISOString(), source: endpoint, items };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`Updated notifications.json with ${items.length} GeoRep records.`);
}

export { absoluteUrl, detailValue, fetchAllRecords, findRecordArray, isoDay, normalizeRecord, normalizeStatus };

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
