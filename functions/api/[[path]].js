import { neon } from "@neondatabase/serverless";
import {
  MAX_UPLOAD_BYTES, json, validUuid, validSlug, validToken,
  cleanName, mimeType, generateToken, sha256, adminAuthorized,
  cookieToken, shareCookie, removeShareCookie, contentDisposition,
  safeInline, readObject, parseByteRange
} from "../../lib/core.js";
import {
  storageConfigured, writeProvider, providerForFile,
  storageProbe, storagePut, storageGet, storageDelete
} from "../../lib/storage.js";

function configured(env) {
  return Boolean(env.DATABASE_URL && storageConfigured(env));
}
function db(env) {
  return neon(env.DATABASE_URL);
}
function logEvent(sql, action, workspaceId = null, shareId = null, fileId = null) {
  return sql.query(
    "INSERT INTO public.fileport_events(action,workspace_id,share_id,file_id) VALUES($1,$2,$3,$4)",
    [action, workspaceId, shareId, fileId]
  ).catch(() => { /* An audit failure must not hide a successful file operation. */ });
}
function error(message, status = 400) { return json({ error: message }, status); }
async function body(request) {
  try { return await readObject(request); }
  catch { return null; }
}
function secondsUntil(dateString) {
  return (new Date(dateString).getTime() - Date.now()) / 1000;
}
async function authorizedShare(sql, token) {
  if (!validToken(token)) return null;
  const hash = await sha256(token);
  const rows = await sql.query(
    "SELECT id,workspace_id,title,expires_at FROM public.fileport_shares WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1",
    [hash]
  );
  return rows[0] || null;
}

async function handleShareOpen(request, env, sql) {
  if (request.method !== "POST") return error("Method not allowed", 405);
  const data = await body(request);
  const share = data && await authorizedShare(sql, data.token);
  if (!share) return error("Link not found or expired", 404);
  const files = await sql.query(
    "SELECT f.id,f.display_name AS name,f.mime_type AS type,f.bytes AS size FROM public.fileport_files f JOIN public.fileport_share_files sf ON sf.file_id=f.id WHERE sf.share_id=$1 AND f.state='approved' ORDER BY f.display_name",
    [share.id]
  );
  await logEvent(sql, "share_viewed", share.workspace_id, share.id);
  return json({
    title: share.title, expiresAt: share.expires_at,
    files: files.map(f => ({ ...f, size: Number(f.size) }))
  }, 200, { "Set-Cookie": shareCookie(data.token, secondsUntil(share.expires_at)) });
}
async function handleShareFile(request, env, sql, fileId) {
  if (request.method !== "GET") return error("Method not allowed", 405);
  if (!validUuid(fileId)) return error("File not found", 404);
  const share = await authorizedShare(sql, cookieToken(request));
  if (!share) return error("Invitation expired or revoked", 404);
  const files = await sql.query(
    "SELECT f.id,f.storage_provider,f.storage_key,f.display_name,f.mime_type,f.bytes FROM public.fileport_files f JOIN public.fileport_share_files sf ON sf.file_id=f.id WHERE sf.share_id=$1 AND f.id=$2 AND f.state='approved' LIMIT 1",
    [share.id, fileId]
  );
  const file = files[0];
  if (!file) return error("File not found", 404);
  const range = parseByteRange(request.headers.get("Range"), Number(file.bytes));
  if (range === false) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": "bytes */" + file.bytes, "Cache-Control": "no-store", "Accept-Ranges": "bytes" }
    });
  }
  let object;
  try {
    object = await storageGet(env, providerForFile(file), file.storage_key, range, Number(file.bytes));
  } catch (err) {
    console.error("Private file delivery failed:", err?.name || "Error");
    return error("Unable to read file", 503);
  }
  if (!object) return error("File unavailable", 404);
  const type = mimeType(file.mime_type);
  const download = new URL(request.url).searchParams.get("download") === "1" || !safeInline(type);
  const h = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": contentDisposition(file.display_name, download),
    "Accept-Ranges": "bytes"
  });
  if (object.etag) h.set("ETag", object.etag);
  if (range) {
    h.set("Content-Range", "bytes " + range.start + "-" + range.end + "/" + range.total);
    h.set("Content-Length", String(range.length));
  } else {
    h.set("Content-Length", String(object.size));
  }
  await logEvent(sql, "file_opened", share.workspace_id, share.id, file.id);
  return new Response(object.body, {
    status: h.has("Content-Range") ? 206 : 200,
    headers: h
  });
}

async function handleOwner(request, env, sql, pathname, url) {
  if (!await adminAuthorized(request, env)) return error("Owner key required", 401);

  if (pathname === "/api/admin/status" && request.method === "GET") {
    await sql.query("SELECT 1");
    await storageProbe(env, "neon");
    return json({
      ok: true, maxUploadBytes: MAX_UPLOAD_BYTES, primaryProvider: "neon",
      uploadProvider: writeProvider(env), r2Available: Boolean(env.FILEPORT_BUCKET)
    });
  }
  if (pathname === "/api/admin/workspaces" && request.method === "GET") {
    return json({ workspaces: await sql.query("SELECT id,slug,name,description FROM public.fileport_workspaces ORDER BY name") });
  }
  if (pathname === "/api/admin/workspaces" && request.method === "POST") {
    const d = await body(request);
    if (!d || !validSlug(d.slug) || typeof d.name !== "string" || !d.name.trim() || d.name.length > 120) return error("Valid workspace name and slug required");
    const rows = await sql.query(
      "INSERT INTO public.fileport_workspaces(slug,name,description) VALUES($1,$2,$3) ON CONFLICT (slug) DO NOTHING RETURNING id,slug,name",
      [d.slug, d.name.trim(), String(d.description || "").slice(0, 500)]
    );
    if (!rows.length) return error("Workspace already exists", 409);
    return json({ workspace: rows[0] }, 201);
  }
  if (pathname === "/api/admin/files" && request.method === "GET") {
    const slug = url.searchParams.get("workspace");
    if (!validSlug(slug)) return error("Workspace required");
    const rows = await sql.query(
      "SELECT f.id,f.storage_provider,f.display_name,f.mime_type,f.bytes,f.state,f.created_at FROM public.fileport_files f JOIN public.fileport_workspaces w ON w.id=f.workspace_id WHERE w.slug=$1 ORDER BY f.created_at DESC LIMIT 300",
      [slug]
    );
    return json({ files: rows.map(x => ({ ...x, bytes: Number(x.bytes) })) });
  }
  if (pathname === "/api/admin/upload" && request.method === "PUT") {
    const slug = url.searchParams.get("workspace");
    if (!validSlug(slug)) return error("Workspace required");
    const workspaces = await sql.query("SELECT id,slug FROM public.fileport_workspaces WHERE slug=$1", [slug]);
    const ws = workspaces[0];
    if (!ws) return error("Workspace not found", 404);
    let raw;
    try { raw = decodeURIComponent(request.headers.get("X-File-Name") || ""); }
    catch { return error("Invalid filename"); }
    const name = cleanName(raw);
    if (!name) return error("Filename required");
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > MAX_UPLOAD_BYTES) return error("File exceeds 25 MB pilot limit", 413);
    if (!request.body) return error("No file received");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return error("File must be between 1 byte and 25 MB", 413);
    const type = mimeType(request.headers.get("Content-Type"));
    const provider = writeProvider(env); // Neon by default; R2 only when explicitly selected and bound.
    const key = "workspaces/" + slug + "/" + crypto.randomUUID() + "/" + name.replace(/[^a-zA-Z0-9._-]/g, "_");
    try {
      await storagePut(env, provider, key, bytes, type);
    } catch (err) {
      console.error("Private file upload failed:", err?.name || "Error");
      return error("Private storage upload failed", 503);
    }
    try {
      const rows = await sql.query(
        "INSERT INTO public.fileport_files(workspace_id,storage_provider,storage_key,display_name,mime_type,bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,display_name,storage_provider,state,bytes",
        [ws.id, provider, key, name, type, bytes.byteLength]
      );
      await logEvent(sql, "upload", ws.id, null, rows[0].id);
      return json({ file: { ...rows[0], bytes: Number(rows[0].bytes) } }, 201);
    } catch {
      await storageDelete(env, provider, key).catch(() => {});
      return error("Unable to register upload", 503);
    }
  }
  if (pathname === "/api/admin/file-state" && request.method === "POST") {
    const d = await body(request);
    if (!d || !validUuid(d.fileId) || !["approved", "disabled"].includes(d.state)) return error("Valid file and state required");
    const rows = await sql.query(
      "UPDATE public.fileport_files SET state=$1,approved_at=CASE WHEN $1='approved' THEN now() ELSE approved_at END WHERE id=$2 RETURNING id,workspace_id,state",
      [d.state, d.fileId]
    );
    if (!rows.length) return error("File not found", 404);
    await logEvent(sql, d.state === "approved" ? "approve" : "disable", rows[0].workspace_id, null, d.fileId);
    return json({ file: rows[0] });
  }
  if (pathname === "/api/admin/shares" && request.method === "GET") {
    const slug = url.searchParams.get("workspace");
    if (!validSlug(slug)) return error("Workspace required");
    const rows = await sql.query(
      "SELECT s.id,s.title,s.expires_at,s.revoked_at,s.created_at,(now() >= s.expires_at) AS expired,count(sf.file_id)::int AS file_count FROM public.fileport_shares s JOIN public.fileport_workspaces w ON w.id=s.workspace_id LEFT JOIN public.fileport_share_files sf ON sf.share_id=s.id WHERE w.slug=$1 GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100",
      [slug]
    );
    return json({ shares: rows });
  }
  if (pathname === "/api/admin/shares" && request.method === "POST") {
    const d = await body(request);
    const fileIds = Array.isArray(d?.fileIds) ? [...new Set(d.fileIds)] : [];
    const hours = Number(d?.hours);
    if (!validSlug(d?.workspace) || typeof d?.title !== "string" ||
        !d.title.trim() || d.title.length > 150 || fileIds.length < 1 ||
        fileIds.length > 30 || !fileIds.every(validUuid) ||
        !Number.isInteger(hours) || hours < 1 || hours > 720) {
      return error("Title, approved files and expiration (1–720 hours) required");
    }
    const workspaces = await sql.query("SELECT id FROM public.fileport_workspaces WHERE slug=$1", [d.workspace]);
    if (!workspaces.length) return error("Workspace not found", 404);
    const ws = workspaces[0];
    const picked = await sql.query(
      "SELECT id FROM public.fileport_files WHERE workspace_id=$1 AND state='approved' AND id=ANY(string_to_array($2, ',')::uuid[])",
      [ws.id, fileIds.join(",")]
    );
    if (picked.length !== fileIds.length) return error("Every file must be approved within this workspace", 409);
    const token = generateToken();
    const hash = await sha256(token);
    const shares = await sql.query(
      "INSERT INTO public.fileport_shares(workspace_id,token_hash,title,expires_at) VALUES($1,$2,$3,now()+($4::integer * interval '1 hour')) RETURNING id,expires_at",
      [ws.id, hash, d.title.trim(), hours]
    );
    const share = shares[0];
    const linked = await sql.query(
      "INSERT INTO public.fileport_share_files(share_id,file_id) SELECT $1,id FROM public.fileport_files WHERE id=ANY(string_to_array($2, ',')::uuid[]) AND workspace_id=$3 AND state='approved' RETURNING file_id",
      [share.id, fileIds.join(","), ws.id]
    );
    if (linked.length !== fileIds.length) {
      await sql.query("UPDATE public.fileport_shares SET revoked_at=now() WHERE id=$1", [share.id]);
      return error("File approval changed. Share not issued", 409);
    }
    await logEvent(sql, "share_created", ws.id, share.id);
    return json({ id: share.id, expiresAt: share.expires_at, token }, 201);
  }
  if ((pathname === "/api/admin/revoke" || pathname === "/api/admin/rotate") && request.method === "POST") {
    const d = await body(request);
    if (!d || !validUuid(d.shareId)) return error("Valid invitation required");
    if (pathname.endsWith("/revoke")) {
      const rows = await sql.query("UPDATE public.fileport_shares SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id,workspace_id", [d.shareId]);
      if (!rows.length) return error("Active invitation not found", 404);
      await logEvent(sql, "share_revoked", rows[0].workspace_id, rows[0].id);
      return json({ revoked: true });
    }
    const token = generateToken();
    const rows = await sql.query(
      "UPDATE public.fileport_shares SET token_hash=$1 WHERE id=$2 AND revoked_at IS NULL AND expires_at>now() RETURNING id,expires_at",
      [await sha256(token), d.shareId]
    );
    if (!rows.length) return error("Active invitation not found", 404);
    return json({ id: rows[0].id, expiresAt: rows[0].expires_at, token });
  }
  if (pathname === "/api/admin/events" && request.method === "GET") {
    const rows = await sql.query(
      "SELECT e.action,e.created_at,w.slug AS workspace FROM public.fileport_events e LEFT JOIN public.fileport_workspaces w ON w.id=e.workspace_id ORDER BY e.created_at DESC LIMIT 60"
    );
    return json({ events: rows });
  }
  return error("Not found", 404);
}

export async function onRequest({ request, env }) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const url = new URL(request.url);
  if (!pathname.startsWith("/api/")) return error("Not found", 404);
  if (!configured(env)) return error("Fileport not configured", 503);
  try {
    const sql = db(env);
    if (pathname === "/api/health" && request.method === "GET") {
      await sql.query("SELECT 1");
      return json({
        ok: true, database: true, primaryProvider: "neon",
        storage: "configured", storageVerified: false
      });
    }
    if (pathname.startsWith("/api/admin/")) return await handleOwner(request, env, sql, pathname, url);
    if (pathname === "/api/share/open") return await handleShareOpen(request, env, sql);
    if (pathname === "/api/share/logout" && request.method === "POST") {
      return json({ ok: true }, 200, { "Set-Cookie": removeShareCookie() });
    }
    if (pathname.startsWith("/api/share/file/")) {
      return await handleShareFile(request, env, sql, pathname.slice("/api/share/file/".length));
    }
    return error("Not found", 404);
  } catch (err) {
    console.error("Fileport request failed:", err?.name || "Error");
    return error("Fileport temporarily unavailable", 503);
  }
}
