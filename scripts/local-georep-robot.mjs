import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeRecord } from './sync-georep-notifications.mjs';

const playwrightModule = process.env.NEXUS_PLAYWRIGHT_PATH
  ? await import(pathToFileURL(process.env.NEXUS_PLAYWRIGHT_PATH).href)
  : await import('playwright');
const { chromium } = playwrightModule;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const robotRoot = path.join(repositoryRoot, '.georep-robot');
const profileDir = path.join(robotRoot, 'browser-profile');
const logDir = path.join(robotRoot, 'logs');
const signInNotifiedMarker = path.join(robotRoot, '.sign-in-notified');
const geoRepPage = 'https://meridian.georep.com/portal/index.php/notifications';
const geoRepApi = 'https://meridian.georep.com/portal_api/ContentFeed/fetch';
const sharePointFolderPage = 'https://meridiangroupza.sharepoint.com/sites/MeridianNexus/Shared%20Documents/Connect/Notifications';
const sharePointFolder = '/sites/MeridianNexus/Shared Documents/Connect/Notifications';
const edgeCandidates = [
  process.env.NEXUS_ROBOT_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

function timestamp() {
  return new Date().toISOString();
}

async function log(message) {
  const line = `[${timestamp()}] ${message}`;
  console.log(line);
  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(path.join(logDir, 'robot.log'), `${line}\n`, 'utf8');
}

async function browserExecutable() {
  for (const candidate of edgeCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('Microsoft Edge or Google Chrome was not found.');
}

function isLoginPage(page) {
  const url = page.url().toLowerCase();
  return url.includes('/login') || url.includes('login.microsoftonline.com');
}

async function launch(headless) {
  await fs.mkdir(profileDir, { recursive: true });
  return chromium.launchPersistentContext(profileDir, {
    executablePath: await browserExecutable(),
    headless,
    viewport: headless ? { width: 1440, height: 1000 } : null,
    args: ['--disable-background-timer-throttling'],
  });
}

async function getJsonWithPageAuthorization(page, url) {
  return page.evaluate((requestUrl) => new Promise((resolve, reject) => {
    const jq = window.jQuery || window.$;
    if (!jq || !jq.ajax) {
      reject(new Error('GeoRep page did not initialize its authenticated API client.'));
      return;
    }
    jq.ajax({
      url: requestUrl,
      type: 'get',
      success: (response) => {
        try { resolve(typeof response === 'string' ? JSON.parse(response) : response); }
        catch (error) { reject(error); }
      },
      error: (xhr) => reject(new Error(`GeoRep API returned ${xhr.status}`)),
    });
  }), url);
}

async function fetchGeoRepRecords(page) {
  await page.goto(geoRepPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  if (isLoginPage(page) || await page.getByText('Access has expired', { exact: false }).count()) {
    const error = new Error('GeoRep sign-in is required. Run npm run robot:login.');
    error.code = 'SIGN_IN_REQUIRED';
    throw error;
  }
  const first = await getJsonWithPageAuthorization(page, `${geoRepApi}?page_nr=0`);
  const records = Array.isArray(first.data) ? [...first.data] : [];
  const totalPages = Math.max(1, Number(first.total_pages || first.totalPages || 1));
  for (let pageNumber = 1; pageNumber < totalPages; pageNumber += 1) {
    const payload = await getJsonWithPageAuthorization(page, `${geoRepApi}?page_nr=${pageNumber}`);
    if (Array.isArray(payload.data)) records.push(...payload.data);
  }
  if (!records.length) throw new Error('GeoRep returned no notification records; SharePoint was not changed.');
  return records;
}

async function downloadAuthenticatedImage(page, url) {
  return page.evaluate(({ imageUrl }) => new Promise((resolve, reject) => {
    const jq = window.jQuery || window.$;
    jq.ajax({
      url: imageUrl,
      type: 'get',
      xhr: () => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        return xhr;
      },
      success: (data, _status, xhr) => {
        const bytes = new Uint8Array(data);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        resolve({ base64: btoa(binary), contentType: xhr.getResponseHeader('content-type') || '' });
      },
      error: (xhr) => reject(new Error(`Image returned ${xhr.status}`)),
    });
  }), { imageUrl: url });
}

function extensionFor(contentType, sourceUrl) {
  const known = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const cleanType = String(contentType || '').split(';')[0].toLowerCase();
  if (known[cleanType]) return known[cleanType];
  const extension = path.extname(new URL(sourceUrl).pathname).slice(1).toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension) ? extension : 'jpg';
}

async function buildPrivateFeed(page, records) {
  const items = [];
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const item = normalizeRecord(records[index], index, geoRepApi);
    const sourceImage = item.image_url;
    item.image_url = '';
    item.image_file = '';
    if (sourceImage) {
      try {
        const image = await downloadAuthenticatedImage(page, sourceImage);
        const safeId = String(item.source_id || index).replace(/[^a-z0-9_-]/gi, '_');
        const filename = `notification-${safeId}.${extensionFor(image.contentType, sourceImage)}`;
        item.image_file = filename;
        files.push({ filename, base64: image.base64, contentType: image.contentType });
      } catch (error) {
        await log(`Image skipped for ${item.card_name}: ${error.message}`);
      }
    }
    items.push(item);
  }
  items.sort((left, right) => left.priority - right.priority || right.start_date.localeCompare(left.start_date));
  return {
    feed: { generated_at: timestamp(), source: 'GeoRep ContentFeed via Meridian local robot', items },
    files,
  };
}

async function uploadSharePointFile(page, filename, base64, contentType) {
  return page.evaluate(async ({ folder, name, encoded, mime }) => {
    const contextResponse = await fetch('/sites/MeridianNexus/_api/contextinfo', {
      method: 'POST',
      headers: { Accept: 'application/json;odata=nometadata' },
    });
    if (!contextResponse.ok) throw new Error(`SharePoint context returned ${contextResponse.status}`);
    const context = await contextResponse.json();
    const digest = context.FormDigestValue;
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const safeFolder = folder.replace(/'/g, "''");
    const safeName = name.replace(/'/g, "''");
    const endpoint = `/sites/MeridianNexus/_api/web/GetFolderByServerRelativeUrl('${safeFolder}')/Files/add(url='${safeName}',overwrite=true)`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json;odata=nometadata',
        'Content-Type': mime || 'application/octet-stream',
        'X-RequestDigest': digest,
      },
      body: bytes,
    });
    if (!response.ok) throw new Error(`SharePoint upload returned ${response.status}`);
    return true;
  }, { folder: sharePointFolder, name: filename, encoded: base64, mime: contentType });
}

async function uploadPrivateFeed(context, privateFeed) {
  const page = await context.newPage();
  await page.goto(sharePointFolderPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  if (isLoginPage(page)) {
    const error = new Error('SharePoint sign-in is required. Run npm run robot:login.');
    error.code = 'SIGN_IN_REQUIRED';
    throw error;
  }
  for (const file of privateFeed.files) {
    await uploadSharePointFile(page, file.filename, file.base64, file.contentType);
  }
  const json = Buffer.from(`${JSON.stringify(privateFeed.feed, null, 2)}\n`, 'utf8').toString('base64');
  await uploadSharePointFile(page, 'notifications.json', json, 'application/json');
  await page.close();
}

async function login() {
  const context = await launch(false);
  const pages = context.pages();
  const geoPage = pages[0] || await context.newPage();
  await geoPage.goto(geoRepPage, { waitUntil: 'domcontentloaded' });
  const sharePointPage = await context.newPage();
  await sharePointPage.goto(sharePointFolderPage, { waitUntil: 'domcontentloaded' });
  await log('Sign into GeoRep and SharePoint in the two browser tabs, then close the browser window.');
  await new Promise((resolve) => context.once('close', resolve));
}

async function sync() {
  const context = await launch(true);
  try {
    const page = context.pages()[0] || await context.newPage();
    const records = await fetchGeoRepRecords(page);
    await log(`Read ${records.length} GeoRep notification records.`);
    const privateFeed = await buildPrivateFeed(page, records);
    await uploadPrivateFeed(context, privateFeed);
    await log(`Uploaded ${privateFeed.feed.items.length} notifications and ${privateFeed.files.length} images to SharePoint.`);
    await fs.rm(signInNotifiedMarker, { force: true });
  } finally {
    await context.close();
  }
}

// A plain WinForms balloon tip rather than the modern toast APIs - those
// need an AppUserModelID registered against a real installed app or the
// call silently no-ops, which a scheduled-task script doesn't have. This
// needs an interactive desktop session to actually display (the scheduled
// task must run "only when user is logged on", not "whether logged on or
// not") but requires no extra install and no admin rights.
async function notifyUser(title, message) {
  const script = `Add-Type -AssemblyName System.Windows.Forms; ` +
    `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
    `$n.Icon = [System.Drawing.SystemIcons]::Warning; ` +
    `$n.Visible = $true; ` +
    `$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'; ` +
    `$n.BalloonTipText = '${message.replace(/'/g, "''")}'; ` +
    `$n.ShowBalloonTip(15000); ` +
    `Start-Sleep -Seconds 16; ` +
    `$n.Dispose()`;
  try {
    const { spawn } = await import('node:child_process');
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch (error) {
    await log(`Notification failed: ${error.message}`);
  }
}

async function check() {
  await log(`Browser: ${await browserExecutable()}`);
  await log(`Profile: ${profileDir}`);
  await log(`SharePoint: ${sharePointFolder}`);
}

const command = process.argv[2] || 'sync';
try {
  if (command === 'login') await login();
  else if (command === 'sync') await sync();
  else if (command === 'check') await check();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  await log(`ERROR: ${error.message}`);
  if (error.code === 'SIGN_IN_REQUIRED') {
    // Every 15-minute retry hits this same branch while the session stays
    // expired - a marker file caps it at one popup per outage instead of
    // one every 15 minutes. sync() clears the marker on its next success.
    let alreadyNotified = false;
    try { await fs.access(signInNotifiedMarker); alreadyNotified = true; } catch {}
    if (!alreadyNotified) {
      await notifyUser('Nexus Notifications robot', 'GeoRep or SharePoint sign-in expired. Run: npm run robot:login');
      await fs.writeFile(signInNotifiedMarker, new Date().toISOString(), 'utf8');
    }
  }
  process.exitCode = error.code === 'SIGN_IN_REQUIRED' ? 2 : 1;
}
