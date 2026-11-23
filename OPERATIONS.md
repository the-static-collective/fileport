# STATIC FILEPORT · Neon-first operational runbook

## System boundaries
- **Canonical bytes:** private Neon Object Storage bucket `static-fileport-private` in Neon project `delicate-darkness-21715937`, branch `br-billowing-rain-bcf3ywwi`.
- **Metadata:** Neon Postgres, same project; schema migration `migrations/002_neon_primary.sql` applied to `main` on Nov 23, 2026.
- **Public gateway:** Cloudflare Pages `fileport.abundent.org` after custom-domain activation; only owner-approved sharing may expose bytes.
- **Secondary provider:** R2 adapter supported for future objects; binding absent by default, **not required**.
- **Upload routing:** `FILEPORT_WRITE_PROVIDER` defaults to `neon`, can explicitly become `r2` after R2 binding.
- **Per-file routing:** `fileport_files.storage_provider` stores object location; no automatic or implicit fallback between clouds.

## Deployment checklist
- [ ] GitHub `main` has latest tested Fileport implementation.
- [ ] Cloudflare Pages project `fileport` attached to `the-static-collective/fileport`; `npm run build` outputs `dist`.
- [ ] Production secrets: `DATABASE_URL`, `FILEPORT_ADMIN_TOKEN`, `NEON_S3_ACCESS_KEY_ID`, `NEON_S3_SECRET_ACCESS_KEY`. All encrypted; do not commit credentials. The Neon S3 access ID and secret must be the **same Neon credential**.
- [ ] No R2 binding required. Do not choose `FILEPORT_WRITE_PROVIDER=r2` until R2 is actually attached.
- [ ] `GET /api/health` succeeds, meaning database and environment are *configured*. It is not a storage verification.
- [ ] Owner can unlock; `/api/admin/status` probes Neon storage for a real authenticated list operation before returning success.
- [ ] Upload a harmless small MP4: new record `storage_provider=neon`, staged. Explicitly approve.
- [ ] Open a share in a separate browser and verify same-domain playback, Range `206`, and download.
- [ ] Rotate link (old URL fails); revoke link (file access fails).
- [ ] Configure `fileport.abundent.org` as Pages custom domain, verify HTTPS; repeat cross-device test.
- [ ] Only after successful testing, share actual assets.

## Storage credentials

Neon → project STATIC FILEPORT → Connect → Storage supplies:
- Key ID (`nak_live_...`) → `NEON_S3_ACCESS_KEY_ID`
- Matching S3 secret (`nsk_live_...`) → `NEON_S3_SECRET_ACCESS_KEY`
- S3 endpoint/region already configured in backend defaults

Do **not** paste secrets into chat, PRs, screenshots, Github Actions variables, or browser JavaScript. Cloudflare encrypted Production secrets only. A wrong credential pair will cause authenticated private storage probe to fail; changing GitHub code will not repair wrong credentials.

## Common failures

| Observation | Action |
|---|---|
| "Nothing is here yet" | Wrong or unconfigured Cloudflare Pages address; use production project or the configured permanent domain. |
| Health 503 | DATABASE_URL or Neon storage credentials absent or malformed. |
| Health OK, owner unlock 503 | Private Neon S3 credential/bucket inaccessible or unmatched; check same-pair credentials. |
| Upload 503 | Private Neon storage PUT or database insert failed; consult Pages runtime logs (without tokens). |
| Video 206 not returned | Check Range request and storage backend range handling; verify Content-Range. |
| Existing file unavailable after provider switch | Check recorded `storage_provider`, not current `FILEPORT_WRITE_PROVIDER`. Do not overwrite metadata blindly. |
| Share does not open | Confirm expiry, revocation, approved file, same hostname, and HttpOnly cookie. |

## Limitations / next work

- The 25 MiB per-file pilot cap remains; no resumable uploads, CDN caching, or automatic multi-cloud copy.
- Owner uses one shared secret with full access. Not appropriate for independent untrusted users without per-workspace roles.
- Private server-side streaming avoids exposing presigned URLs but consumes Cloudflare/Neon request and transfer quotas.
- R2 is a secondary routing option, **not** an established replicated archive. Copying objects between providers requires a separate explicitly authorized migration workflow.
- Neon quotas and egress depend on the active plan and project; monitor storage consumption before bulk ingest.
- Old WillowLab assets remain in a separate Neon bucket, not yet imported.

## Engineering checks

`npm install && npm run check`. CI also builds Pages Functions with Wrangler, confirms public asset output contains no server code or database credentials.
