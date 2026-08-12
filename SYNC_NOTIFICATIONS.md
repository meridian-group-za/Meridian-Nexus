# GeoRep notification sync

The Connect page reads `notifications.json` and displays records only when all
of these conditions are true:

- the record status is active;
- its start date is blank or has arrived; and
- its end date is blank or has not passed.

Expired records therefore disappear from Nexus automatically without being
deleted from GeoRep.

## Repository secrets

Configure these in **Settings > Secrets and variables > Actions**:

- `GEOREP_NOTIFICATIONS_URL` - required authenticated JSON endpoint used by the
  GeoRep notification table. For Meridian GeoRep this is
  `https://meridian.georep.com/portal_api/ContentFeed/fetch`.
- `GEOREP_AUTHORIZATION` - optional complete `Authorization` header value, such
  as `Bearer ...`.
- `GEOREP_COOKIE` - optional service-account cookie when GeoRep does not provide
  a token-based API. A stable token or service account is preferred over a
  short-lived browser session.

The scheduled workflow runs every 15 minutes. It normalizes GeoRep fields,
loads every results page, updates `notifications.json` only when records change,
and commits the refreshed feed to the same branch. The Meridian field mapping
includes `web_link`, `app_link`, `download_file`, `video`, `gif`, `card_image`,
`card_headline`, `card_sub_text`, `active`, `start_date`, and `end_date`.

## Local verification

```sh
node --test tests/notifications.test.cjs
```

To test the sync script against an endpoint:

```sh
GEOREP_NOTIFICATIONS_URL="https://example.test/api/notifications" \
GEOREP_AUTHORIZATION="Bearer ..." \
node scripts/sync-georep-notifications.mjs
```
