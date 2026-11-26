# HARVEST 050 — private operator return

Source-owned adapter: [convergent-codec at fcba098](https://github.com/the-static-collective/convergent-codec/tree/fcba0981514c8891896bd56b5aa6563f68141d2f/research/harvest-050/integration). Vendored exact Git blob `5af40cb00df03d32cbd1a046f8b6f77f1c9ff726`. The Python exporter rechecks a local restored directory against a separately pinned CC1 manifest and receipt bytes, then emits a small canonical JSON card. It omits private paths, contents, approval IDs and credentials; hashes and counts remain private metadata. A receiver checks an independently obtained raw card SHA-256. A digest match does not authenticate the exporter, establish current authority, or verify a claimed recovery independently. Keep the pin separately; never derive the expected pin from the received card itself.

No network, app login, background work, UI or production activation. Node 20+; trusted local paths. No automatic writing, execution, publication, grant, or admission.

## Private delivery byte check

Use existing Fileport owner upload, approval, invitation and download procedures. Separately retain the SHA-256 and size of the original artifact before transfer. After downloading an authorized file to a local directory:

```sh
node scripts/harvest-return.mjs fileport DOWNLOADED_FILE EXPECTED_SHA256 EXPECTED_BYTES
```

Returns `BYTES_MATCH_EXPECTED_PIN` on exact match, otherwise HOLD with nonzero exit. Local limit is the existing 25 MiB pilot upload bound. This is a local operator-side byte check, not a server-side upload hash, automatic replication, provider failover, upload, credential exchange, or change to invitation handling. No Fileport API, DB, Cloudflare, Neon, R2, or StaticID config changed. StaticID session is not an HV1 assent. The full HARVEST package fits the current per-file size limit; no live upload/download was performed.

