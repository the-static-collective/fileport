# Fileport · Operations and Release Gate

## Policy

Goal: **zero infrastructure dashboard visits for ordinary file delivery**. The owner's everyday workflow is open → upload → approve → copy invite → send; recipients open or stream. Cloudflare and Neon only surface for infrastructure administration and incident response.

## Architecture

- Pages (this repo) hosts the interface and `functions/api/[[path]].js`.
- R2 (`FILEPORT_BUCKET`) holds **private** object bytes. No public `r2.dev` address.
- Neon (`DATABASE_URL`) stores projects, file metadata, hashed invitations and minimal audit events; project ID: `delicate-darkness-21715937`.
- Recipients receive only a URL fragment token. Opening it sets a same-origin HttpOnly share cookie. Protected GETs include video Range support; the server checks share validity each time.

## Operator access

`FILEPORT_ADMIN_TOKEN` must be at least 32 unpredictable characters, stored in Cloudflare **encrypted Production secrets**. Keep a copy in the owner's password manager. A visitor without it cannot upload, list projects, approve, or share. This token grants complete authority to the pilot owner. Do not distribute it to Colton or other recipients. Before team access, integrate verified identity, per-project membership and audit-backed authorization. Do not store this token in source control or use a memorable password.

## First live verification — mandatory

- [ ] Cloudflare Pages project points to `the-static-collective/fileport`, production branch `main`.
- [ ] `npm run build` successfully publishes `dist` and bundles Pages Functions.
- [ ] Private R2 bucket `static-fileport-private` has a Production `FILEPORT_BUCKET` binding.
- [ ] Neon `DATABASE_URL` and long random `FILEPORT_ADMIN_TOKEN` exist only as encrypted Production secrets.
- [ ] `/api/health` returns `{ok:true,storage:true,database:true}`.
- [ ] Owner logs in, uploads 1 small harmless file, explicitly approves it, and makes a 1-hour invitation.
- [ ] Recipient opens it in a different browser/device, views a video and downloads a matching file.
- [ ] Revoke the invitation: new opens fail; refresh invitation: old URL fails.
- [ ] Attach `fileport.abundent.org` and repeat using HTTPS on that **one permanent hostname**.
- [ ] Only then send the actual WillowLab video through a new approved share.

## Known limits

- Files capped at 25 MiB in this pilot; avoid large or confidential customer archives until additional security review.
- Uploaded objects are private; disabling a file or revoking a share prevents subsequent authorized reads but cannot erase bytes already saved by recipients.
- Each share open stores a cookie for up to 12 hours, bounded by the invitation expiry; every file read still checks the live database.
- An owner key remains in session storage for the active browser tab. Locking the workbench clears it.
- One globally powerful owner key, rather than per-user permissions. If compromised, replace the Cloudflare secret and close existing sessions.
- Activity receipts are minimal; they are not proof that a recipient actually watched a video.
- The old WillowLab Neon-uploaded video has not been migrated; re-upload via the new workbench. Do not delete the original until a verified new delivery exists.

## Troubleshooting

| Symptom | Next check |
|---|---|
| `Nothing is here yet` | Incorrect preview alias or a Pages project not yet deployed; use configured production hostname. |
| `/api/health` returns 503 | Confirm Production `DATABASE_URL` and `FILEPORT_BUCKET` binding; view Pages Function logs. |
| Login returns 401 | Check Production `FILEPORT_ADMIN_TOKEN` and use the saved owner key. Never paste it in logs. |
| Upload returns 503 | Inspect R2 binding and Neon project; object bytes and metadata must both succeed. |
| Recipient cannot open invitation | Confirm share unexpired, not revoked, approved file, and same domain in invite URL. |
| Media player cannot seek | Inspect `Range` response (`206` and `Content-Range`) in browser network panel. |
| Domain gives a parking page | Check Pages custom domain and DNS configuration, not an old random preview URL. |

**Do not use the old WillowLab static site as Fileport production.**
