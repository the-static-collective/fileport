# STATIC FILEPORT · Neon-first Living Intranet

**Repository:** https://github.com/the-static-collective/fileport
**Planned permanent address:** https://fileport.abundent.org
**Dedicated Neon project:** STATIC FILEPORT (`delicate-darkness-21715937`)

Fileport is a standalone private file workbench and delivery gateway. **Neon Object Storage is the primary home for actual files.** Neon Postgres holds project homes, metadata, approvals, hashes of share tokens, and minimal access events. Cloudflare Pages serves the interface and streams authorized file bytes under the **same Fileport domain**. Cloudflare R2 remains an **optional secondary adapter**, available for future expansion; no R2 bucket is required.

## What exists

- Workspaces for the Static Collective, WillowLab, and any additional owner-created project.
- Owner-only drag-and-drop upload (pilot limit 25 MiB per file), explicit file approval/disable.
- Private expiring invitation packages (24 hours, 3 days, 7 days, 30 days), rotation and revocation.
- Recipient video streaming and downloads using authenticated **same-origin GET**; correct HTTP Range and 206 response for seekable media. The browser never sees a Neon S3 or R2 object URL.
- Each file records `storage_provider` (`neon` or `r2`) alongside its `storage_key`. Reads use this recorded provider; switching future upload provider **does not make existing files disappear**.
- GitHub security checks, Node tests, Cloudflare Wrangler Pages Functions bundle check.

**Storage provisioned:** Neon private bucket `static-fileport-private` was created in dedicated project STATIC FILEPORT. The database schema and its additive `storage_provider` migration were applied to that project. The project has no uploaded file records yet. Existing WillowLab assets in a separate Neon project were **not copied, deleted, or shared**.

**Status:** Source and database are prepared; Fileport is not a verified live domain until Cloudflare is connected and a real upload/playback/revocation test passes.

## Routine owner use

1. Open `fileport.abundent.org`, unlock the owner workbench with the private key.
2. Select a project home, drop a file. It stays staged until approved.
3. Approve it, select approved files, choose expiry, create one private invitation.
4. Recipient opens invitation, plays/downloads without creating an account.
5. Revoke or rotate invitations at any time.

No GitHub, Neon, or Cloudflare dashboard should be needed for routine delivery.

## One-time Cloudflare Pages deployment

1. **Workers & Pages → Create Pages project → Connect to Git**: repo `the-static-collective/fileport`, branch `main`.
2. Set build command `npm run build`, output directory `dist`, root directory blank. `wrangler.toml` sets compatibility date and `nodejs_compat`.
3. In Cloudflare Pages **Production → Variables and secrets**, set these **encrypted** secrets. **Do not put them in GitHub or this chat**:
   - `DATABASE_URL`: Neon **STATIC FILEPORT → Connect → Postgres** connection string.
   - `FILEPORT_ADMIN_TOKEN`: a random secret of at least 32 characters, saved in your password manager. Example generator: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
   - `NEON_S3_ACCESS_KEY_ID`: `nak_live_...` key ID from **STATIC FILEPORT → Connect → Storage**.
   - `NEON_S3_SECRET_ACCESS_KEY`: the **matching** `nsk_live_...` storage secret from the **same credential**, not the API token.
4. Neon's nonsecret endpoint and bucket are already configured in server source. Override only when needed: `NEON_S3_ENDPOINT`, `NEON_S3_BUCKET`, `NEON_S3_REGION`; by default these target the known project branch, `static-fileport-private`, and `us-east-1`.
5. **No R2 binding needed.** Deploy `main`; visit `/api/health` (shows database reachable and storage *configured*, not yet verified). Then unlock owner workbench: owner `/api/admin/status` actually probes private Neon bucket and refuses to unlock if storage authentication fails.
6. Test an innocuous upload, approval, private invitation, video playback/download, byte seeking, rotate/revoke using another device.
7. Once tests pass, set Pages **Custom domains** → `fileport.abundent.org`, follow Cloudflare DNS instructions and repeat the test over HTTPS.

**Note on previous broken links:** Existing WillowLab preview URLs and the older Neon S3 presigned test links are unrelated to this app. A new Fileport invitation must be created *inside Fileport* after successful setup.

## Optional second provider: R2

The code already includes both adapters: `lib/storage.js`.

- Default: all new uploads go to **Neon**.
- Later, to use R2 for **new** files, bind an R2 bucket to Cloudflare Pages under `FILEPORT_BUCKET`, and set the trusted server-side variable `FILEPORT_WRITE_PROVIDER=r2`. Leave Neon credentials in place.
- The file record stores whether it lives in Neon or R2. Old Neon files **keep streaming from Neon**, and new R2 files stream from R2 with the same invitation interface.
- This is provider routing, **not yet automatic replication, tiered caching, failover, or migration**. Those require separate verification and explicit object-copy operations.

Do not use an R2 public bucket or make the private Neon bucket public.

## Code map

- `functions/api/[[path]].js`: Cloudflare Pages owner and recipient APIs
- `lib/storage.js`: Neon S3 primary + optional native R2 adapter
- `lib/core.js`: tokens, validation, headers, range parsing
- `schema.sql`: current schema; `migrations/002_neon_primary.sql`: additive upgrade
- `public/`: private owner workbench and recipient player
- `wrangler.toml`: Cloudflare runtime config, no credentials
- `tests/`: API safety and provider routing tests
- `OPERATIONS.md`: release gate, security boundaries, troubleshooting

## Privacy and operational boundaries

The owner secret is a single administrator credential, held only in the browser tab's session storage while unlocked. This is a single-operator pilot, **not multi-user role-based access**. For multiple operators or sensitive customer records, add verified sign-in, scoped authorization, and a security review.

Invitation URLs are bearer capabilities and can be forwarded. Their 256-bit tokens are stored only as SHA-256 hashes in Postgres. Protected file requests recheck share expiry, revocation, membership, and file approval. Previously downloaded copies cannot be revoked. The audit ledger contains no recipient IP address or email.

See `OPERATIONS.md` before external release.
