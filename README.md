# STATIC FILEPORT · The Living Intranet

**Canonical code:** https://github.com/the-static-collective/fileport
**Permanent public address (planned):** https://fileport.abundent.org

Fileport is a standalone, owner-operated private file delivery service with modular project homes. It is separate from WillowLab's website and Git branches. Files are stored in **private Cloudflare R2**, share metadata lives in a dedicated **Neon Postgres** project, and Cloudflare Pages serves both the workbench and the receiving page.

## Real-world interaction

1. Owner opens the workbench and enters their private operator key.
2. Owner chooses a project home (e.g., Static Collective or WillowLab) and drops a file (pilot limit 25 MiB).
3. New files remain **staged**. Owner explicitly approves a file before sharing.
4. Owner ticks approved files, adds a package title and expiry, then copies one invitation link.
5. Recipient opens the link, streams video or downloads approved files on the **same Fileport domain**, without registering an account.
6. Owner can revoke the invitation or rotate its bearer token. Old links immediately fail further authorization checks.

**No one needs to open GitHub, Cloudflare, or Neon for routine uploads and sharing.** Those services are the infrastructure, not the user interface.

## What's built and what's not

- Implemented in this repo: owner dashboard, workspaces, upload/approval, private invite creation, invite refresh/revocation, minimal access receipts, same-origin protected download and HTTP range streaming for media.
- Dedicated Neon project **STATIC FILEPORT** (`delicate-darkness-21715937`) created, schema applied, and Static Collective + WillowLab homes seeded.
- GitHub workflow checks the code and builds static assets; Cloudflare automatically deploys approved changes from `main` once connected.
- **Not live until Cloudflare Pages, a private R2 bucket binding, runtime secrets, and `fileport.abundent.org` are configured and end-to-end tests pass.**
- The video from the old WillowLab proof-of-concept still lives in its original Neon private bucket. It has **not** been silently copied to this new system. Upload it once through Fileport when the workbench is operational.

## One-time Cloudflare setup

1. In Cloudflare R2 create a **private** bucket named `static-fileport-private`; do not enable public bucket access.
2. Workers & Pages → Create Pages application → Connect to Git → select `the-static-collective/fileport`.
3. Set **production branch** `main`; **root directory** blank; **build command** `npm run build`; **output directory** `dist`. Cloudflare installs `package.json` dependencies automatically.
4. Under Pages → Settings → Bindings → R2 bucket, add variable name `FILEPORT_BUCKET` pointing to the private bucket `static-fileport-private`, for the **Production** environment.
5. Under Settings → Variables and secrets → **Production**, add **encrypted** `DATABASE_URL` (from Neon project STATIC FILEPORT → Connect → Postgres) and **encrypted** `FILEPORT_ADMIN_TOKEN` (an unpredictable secret of at least 32 characters).
6. To generate your own operator key locally: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Save it in your password manager. **Never paste it into chat, files, GitHub, or a shared screenshot.**
7. Deploy `main`. Visit `/api/health` and expect `{ "ok": true, "storage": true, "database": true }` only when the runtime is wired correctly.
8. Test owner login, a small file upload, approval, invitation, playback/download on a separate browser, expiration and revocation.
9. Under Pages → Custom domains, connect `fileport.abundent.org` and follow the DNS instructions shown for your zone. Verify HTTPS and repeat the recipient test using that permanent domain.

**Important:** The old WillowLab Cloudflare Pages application and its `main` production branch are separate; do not retarget them. The old Neon bucket remains private and untouched.

## Development

Requires Node 22+. From a local checkout: `npm install && npm run check`.

- `public/` browser assets (no private credentials)
- `functions/api/[[path]].js` Cloudflare Pages Functions route
- `lib/core.js` validation, tokens, cookies, and security helpers
- `schema.sql` Postgres schema (already applied to the dedicated project)
- `scripts/build.mjs` produces `dist/` with only public assets
- `.github/workflows/ci.yml` runs unit/security contract checks

## Security and boundaries

- Strong owner secret required; no public admin registration. Owner key stays in tab session storage, never in the URL. This is a **single-operator pilot**, not multi-user SSO; strengthen with Cloudflare Access before inviting multiple administrators.
- Invite tokens are 32 random bytes, hashed with SHA-256 before storing in Postgres, and transmitted from URL fragment to a same-origin API.
- The receiving API issues a bounded `HttpOnly; Secure; SameSite=Lax` share cookie. File streaming rechecks expiry, revocation, membership, and file approval on every request.
- Storage access uses the Cloudflare R2 **server-side binding**, not presigned S3 query URLs, so link tracking parameters cannot break file authentication.
- Private files are never exposed as public R2 URLs. No IP addresses, recipient email addresses or tracking pixels are stored in the Fileport event ledger.
- Shares are bearer links; people can forward them. Already downloaded copies cannot be remotely revoked. This is not a DRM service.
- The app limits single uploads to 25 MiB and is not yet a resumable/multipart uploader. See `OPERATIONS.md` for constraints and the release gate.

## Project lineage

Fileport grew out of `the-static-collective/willowlab` draft PR #2; that pilot remains as historical evidence. The independent Fileport repository is now the source of truth for the service. This does not expose Colton's private WillowConnect data.
