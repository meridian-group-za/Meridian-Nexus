(function attachNexusNotifications(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NexusNotifications = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createNexusNotifications() {
  // Graph doesn't support chaining two colon-addressed path segments in one
  // request (sites/{hostname}:/{path}: followed by /drive/root:/{path}:
  // fails with "Resource not found for the segment 'root:'") - the site has
  // to be resolved to its plain ID first, then the drive item is addressed
  // from that ID in a separate call.
  const graphSiteLookupUrl = 'https://graph.microsoft.com/v1.0/sites/meridiangroupza.sharepoint.com:/sites/MeridianNexus';
  // Files.Read only covers the user's own OneDrive plus items explicitly
  // shared with them by name - it does not extend to a SharePoint team
  // site's document library reached via normal site membership (confirmed
  // 2026-08-13: Graph Explorer got accessDenied on this site's /drive with
  // Files.Read consented, and succeeded once Sites.Read.All was consented
  // instead).
  const sharePointScopes = ['Sites.Read.All'];
  let sharePointClient = null;
  let sharePointAccount = null;
  let siteIdPromise = null;

  async function resolveSiteId(token) {
    if (!siteIdPromise) {
      siteIdPromise = fetch(graphSiteLookupUrl, { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => {
          if (!response.ok) throw new Error(`Site lookup returned ${response.status}`);
          return response.json();
        })
        .then((site) => site.id)
        .catch((error) => { siteIdPromise = null; throw error; });
    }
    return siteIdPromise;
  }
  let currentFeed = { items: [] };
  let currentSettings = { loading: true };
  let loadingPromise = null;
  const objectUrls = [];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    const candidate = String(value || '').trim();
    if (!candidate) return '';
    if (/^(https?:\/\/|\.\.?\/)/i.test(candidate)) return escapeHtml(candidate);
    return '';
  }

  function safeImageUrl(value) {
    const candidate = String(value || '').trim();
    if (/^blob:/i.test(candidate)) return escapeHtml(candidate);
    return safeUrl(candidate);
  }

  function isoDay(value) {
    if (!value) return '';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  function isActiveStatus(value) {
    if (value == null || value === '') return true;
    if (typeof value === 'boolean') return value;
    const status = String(value).trim().toLowerCase();
    return ['active', 'enabled', 'on', 'true', '1', 'yes'].includes(status);
  }

  function activeForDate(items, now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    const today = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

    return (Array.isArray(items) ? items : [])
      .filter((item) => {
        const start = isoDay(item.start_date);
        const end = isoDay(item.end_date);
        return isActiveStatus(item.status)
          && (!start || start <= today)
          && (!end || end >= today);
      })
      .sort((left, right) => {
        const priority = Number(left.priority || 999) - Number(right.priority || 999);
        if (priority) return priority;
        return isoDay(right.start_date).localeCompare(isoDay(left.start_date));
      });
  }

  function formatDate(value) {
    const day = isoDay(value);
    if (!day) return '';
    const [year, month, date] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, date));
  }

  function renderCard(item) {
    const link = safeUrl(item.target_url || item.url);
    const image = safeImageUrl(item.image_url);
    const name = escapeHtml(item.card_name || item.client || 'Notification');
    const heading = escapeHtml(item.heading || item.title || name);
    const description = escapeHtml(item.description || item.content || '');
    const type = escapeHtml(item.content_type || 'Information');
    const actionText = escapeHtml(item.action_text || 'Open');
    const endDate = formatDate(item.end_date);
    const imageMarkup = image
      ? `<img data-nexus-notification-image src="${image}" alt="" loading="lazy" style="flex:0 0 auto; width:clamp(78px,30%,104px); aspect-ratio:1/1; object-fit:cover; object-position:center; border-radius:10px; border:1px solid rgba(157,196,236,0.2); background:rgba(8,27,52,0.55); cursor:zoom-in;">`
      : '';
    const actionMarkup = link
      ? `<a href="${link}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:7px; padding:8px 13px; border-radius:8px; border:1px solid rgba(236,109,37,0.42); background:rgba(236,109,37,0.13); color:#f2955c; font-size:12.5px; font-weight:600; text-decoration:none;">${actionText} <span aria-hidden="true">&rarr;</span></a>`
      : '';

    return `<article data-nexus-notification="${escapeHtml(item.source_id || item.id || '')}" style="display:flex; flex-direction:column; min-width:0; padding:18px; border-radius:13px; border:1px solid rgba(28,63,107,0.95); background:rgba(18,58,104,0.42);">
      <div style="display:flex; align-items:flex-start; gap:14px; min-width:0;">
        <div data-nexus-notification-copy style="flex:1; min-width:0;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <div style="font-size:14.5px; font-weight:600; color:#eef3f9;">${name}</div>
            <span style="flex:none; padding:3px 8px; border-radius:20px; background:rgba(236,109,37,0.12); border:1px solid rgba(236,109,37,0.28); color:#f2955c; font-size:10.5px; font-weight:600;">${type}</span>
          </div>
          <div style="font-size:13.5px; font-weight:600; color:#dce9f7; margin-top:11px;">${heading}</div>
          ${description ? `<div style="font-size:12.5px; line-height:1.5; color:#9dc4ec; margin-top:6px;">${description}</div>` : ''}
        </div>
        ${imageMarkup}
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:17px; flex-wrap:wrap;">
        ${actionMarkup}
        ${endDate ? `<span style="font-size:11.5px; color:#86a7c9; white-space:nowrap;">Until ${escapeHtml(endDate)}</span>` : ''}
      </div>
    </article>`;
  }

  // Lazily builds a single full-viewport overlay the first time a section
  // renders in a real DOM, and wires one delegated click listener so it
  // works for every card's image, including ones re-rendered later by
  // refresh(). No-ops under Node (tests call renderCard/renderSection
  // directly without a document).
  let lightboxWired = false;
  function ensureLightbox() {
    if (lightboxWired || typeof document === 'undefined') return;
    lightboxWired = true;
    const overlay = document.createElement('div');
    overlay.id = 'nexus-notification-lightbox';
    overlay.style.cssText = 'display:none; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; padding:32px; box-sizing:border-box; background:rgba(5,15,30,0.86); cursor:zoom-out;';
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'max-width:90vw; max-height:90vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.5); cursor:default;';
    overlay.appendChild(img);
    const close = () => { overlay.style.display = 'none'; img.src = ''; };
    overlay.addEventListener('click', close);
    img.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    document.addEventListener('click', (event) => {
      const target = event.target.closest && event.target.closest('[data-nexus-notification-image]');
      if (!target) return;
      img.src = target.getAttribute('src') || '';
      overlay.style.display = 'flex';
    });
    document.body.appendChild(overlay);
  }

  function renderSection(feed, now, options) {
    ensureLightbox();
    const settings = options || {};
    // Admin consent for the SharePoint Files.Read scope is still pending;
    // keep the anchor element so a later refresh() can populate it, but
    // don't show a "Permission required" banner to every signed-in user.
    if (settings.permission) {
      return '<section id="nexus-georep-notifications" aria-label="GeoRep notifications" style="display:none;"></section>';
    }
    const items = activeForDate(feed && feed.items, now);
    const generatedAt = feed && feed.generated_at ? new Date(feed.generated_at) : null;
    const syncText = settings.loading
      ? 'Connecting to SharePoint'
      : settings.error
      ? 'Feed temporarily unavailable'
      : generatedAt && !Number.isNaN(generatedAt.getTime())
        ? `Synced ${generatedAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'Synced from GeoRep';
    const cards = settings.loading
      ? '<div style="grid-column:1/-1; padding:18px; border:1px dashed rgba(28,63,107,0.95); border-radius:12px; color:#9dc4ec;">Loading private notifications...</div>'
      : settings.error
      ? '<div style="grid-column:1/-1; padding:18px; border:1px dashed rgba(28,63,107,0.95); border-radius:12px; color:#9dc4ec;">Notifications could not be refreshed. Existing Nexus tools are unaffected.</div>'
      : items.length
        ? items.map(renderCard).join('')
        : '<div style="grid-column:1/-1; padding:18px; border:1px dashed rgba(28,63,107,0.95); border-radius:12px; color:#9dc4ec;">No active notifications right now.</div>';

    return `<section id="nexus-georep-notifications" aria-label="GeoRep notifications" style="margin-top:30px; padding-top:24px; border-top:1px solid rgba(157,196,236,0.22);">
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin-bottom:17px; flex-wrap:wrap;">
        <div>
          <h2 style="font-size:20px; font-weight:600; margin:0; color:#f3f7fc;">Notifications</h2>
          <div style="font-size:12.5px; color:#9dc4ec; margin-top:4px;">Latest GeoRep updates for Meridian teams.</div>
        </div>
        <div style="display:flex; align-items:center; gap:7px; font-size:11.5px; color:${settings.error ? '#f2955c' : settings.loading ? '#9dc4ec' : '#8fd6a8'};">
          <span style="width:7px; height:7px; border-radius:50%; background:currentColor;"></span>
          ${escapeHtml(items.length + ' active - ' + syncText)}
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(min(250px,100%),1fr)); gap:14px;">${cards}</div>
    </section>`;
  }

  function refresh() {
    const section = typeof document !== 'undefined' && document.getElementById('nexus-georep-notifications');
    if (section) section.outerHTML = renderSection(currentFeed, new Date(), currentSettings);
    return currentFeed;
  }

  async function hydrateImages(items, token, siteId) {
    return Promise.all((items || []).map(async (item) => {
      if (!item.image_file) return item;
      const imageUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/Connect/Notifications/${encodeURIComponent(item.image_file)}:/content`;
      try {
        const response = await fetch(imageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`Image returned ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        objectUrls.push(objectUrl);
        return Object.assign({}, item, { image_url: objectUrl });
      } catch (error) {
        console.warn('[notifications] Image could not be loaded:', item.image_file, error);
        return item;
      }
    }));
  }

  async function loadSharePoint(interactive) {
    if (!sharePointClient || !sharePointAccount) return currentFeed;
    currentSettings = { loading: true };
    refresh();
    try {
      const request = { scopes: sharePointScopes, account: sharePointAccount };
      const auth = interactive
        ? await sharePointClient.acquireTokenPopup(request)
        : await sharePointClient.acquireTokenSilent(request);
      const siteId = await resolveSiteId(auth.accessToken);
      const graphFeedUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/Connect/Notifications/notifications.json:/content`;
      const response = await fetch(graphFeedUrl, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (response.status === 404) {
        currentFeed = { items: [] };
      } else {
        if (!response.ok) throw new Error(`SharePoint feed returned ${response.status}`);
        currentFeed = await response.json();
      }
      currentFeed.items = await hydrateImages(currentFeed.items, auth.accessToken, siteId);
      currentSettings = {};
    } catch (error) {
      const code = String(error && (error.errorCode || error.code || error.message) || '').toLowerCase();
      currentSettings = code.includes('interaction_required') || code.includes('consent_required') || code.includes('login_required')
        ? { permission: true }
        : { error: true };
      console.warn('[notifications] Private SharePoint feed unavailable:', error);
    }
    refresh();
    return currentFeed;
  }

  function attachSharePoint(msalClient, account) {
    sharePointClient = msalClient;
    sharePointAccount = account;
    if (!loadingPromise) loadingPromise = loadSharePoint(false).finally(() => { loadingPromise = null; });
    return loadingPromise;
  }

  function connectSharePoint() {
    loadingPromise = loadSharePoint(true).finally(() => { loadingPromise = null; });
    return loadingPromise;
  }

  return { activeForDate, attachSharePoint, connectSharePoint, escapeHtml, formatDate, refresh, renderCard, renderSection, safeImageUrl, safeUrl };
});
