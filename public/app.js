const $ = id => document.getElementById(id);
const state = {
  key: sessionStorage.getItem("fileport-owner-key") || "",
  authMode: "",
  workspace: sessionStorage.getItem("fileport-workspace") || "",
  workspaces: [], files: [], shares: [], selected: new Set()
};
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function toast(message, failed = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", failed);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 5400);
}
function size(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "file";
  if (n < 1024) return n + " B";
  const units = ["KB","MB","GB"];
  let value = n / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return value.toFixed(value < 10 ? 1 : 0) + " " + units[i];
}
function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
async function api(path, { method = "GET", data, owner = false } = {}) {
  const headers = { "Accept": "application/json" };
  if (owner && state.key) headers.Authorization = "Bearer " + state.key;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method, headers, credentials: owner && state.key ? "omit" : "same-origin",
    cache: "no-store", body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "Request failed (" + response.status + ")");
    error.status = response.status;
    throw error;
  }
  return result;
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = $("share-url");
    input.value = text; input.focus(); input.select();
    toast("Select and copy the link from the field.");
    return;
  }
  toast("Invitation link copied.");
}
function updateSelected() {
  $("selected-count").textContent = state.selected.size + (state.selected.size === 1 ? " file selected" : " files selected");
}
async function checkHealth() {
  try {
    await api("/api/health");
    $("service-indicator").classList.add("good");
    $("service-state").textContent = "Service ready";
  } catch {
    $("service-indicator").classList.remove("good");
    $("service-state").textContent = "Setup required";
  }
}

async function openWorkbench() {
  await api("/api/admin/status", { owner: true });
  state.authMode = state.key ? "recovery" : "staticid";
  if (state.key) sessionStorage.setItem("fileport-owner-key", state.key);
  else sessionStorage.removeItem("fileport-owner-key");
  $("login-panel").hidden = true;
  $("desk").hidden = false;
  $("intro-hero").hidden = true;
  $("desk").scrollIntoView({block:"start"});
  try { await loadWorkspaces(); }
  catch (e) {
    $("desk-status").textContent = e.status === 401 ? "Your session is no longer authorized. Lock the workbench and sign in again." : "Signed in. Workspace loading failed; use Retry workspaces.";
    return;
  }
  $("desk-status").textContent = "";
  try { await loadActivity(); }
  catch { $("desk-status").textContent = "Workspaces loaded. Activity history is temporarily unavailable."; }
}
function lockWorkbench() {
  state.authMode = "";
  state.key = "";
  state.files = []; state.shares = []; state.workspaces = []; state.selected.clear();
  sessionStorage.removeItem("fileport-owner-key");
  $("owner-key").value = "";
  $("login-panel").hidden = false;
  $("intro-hero").hidden = false;
  $("desk").hidden = true;
  $("desk-status").textContent = "";
  $("new-share").hidden = true;
  toast("Workbench locked.");
}
async function loadWorkspaces() {
  const data = await api("/api/admin/workspaces", { owner: true });
  state.workspaces = data.workspaces || [];
  const select = $("workspace-picker");
  select.replaceChildren();
  for (const workspace of state.workspaces) {
    const option = document.createElement("option");
    option.value = workspace.slug;
    option.textContent = workspace.name;
    select.append(option);
  }
  if (!state.workspaces.some(w => w.slug === state.workspace)) state.workspace = state.workspaces[0]?.slug || "";
  select.value = state.workspace;
  sessionStorage.setItem("fileport-workspace", state.workspace);
  if (state.workspace) await loadWorkspace();
}
async function loadWorkspace() {
  state.selected.clear();
  updateSelected();
  $("new-share").hidden = true;
  await Promise.all([loadFiles(), loadShares()]);
}
async function loadFiles() {
  const data = await api("/api/admin/files?workspace=" + encodeURIComponent(state.workspace), { owner: true });
  state.files = data.files || [];
  state.selected = new Set([...state.selected].filter(id => state.files.some(f => f.id === id && f.state === "approved")));
  renderFiles();
}
async function loadShares() {
  const data = await api("/api/admin/shares?workspace=" + encodeURIComponent(state.workspace), { owner: true });
  state.shares = data.shares || [];
  renderShares();
}
async function loadActivity() {
  const data = await api("/api/admin/events", { owner: true });
  const list = $("activity-list");
  list.replaceChildren();
  const labels = { upload:"File received", approve:"File approved", disable:"File disabled", share_created:"Invitation created", share_viewed:"Invitation opened", file_opened:"File requested", share_revoked:"Invitation revoked" };
  if (!data.events?.length) list.append(node("p","empty-state","No activity recorded yet."));
  for (const e of data.events || []) {
    const row = node("div","activity-row");
    row.append(node("strong","",labels[e.action] || e.action));
    row.append(node("div","",when(e.created_at) + (e.workspace ? " · " + e.workspace : "")));
    list.append(row);
  }
}
function renderFiles() {
  const list = $("files-list");
  list.replaceChildren();
  $("library-count").textContent = state.files.length + " FILE" + (state.files.length === 1 ? "" : "S");
  if (!state.files.length) {
    list.append(node("p","empty-state","No files here yet. Drop your first one above."));
    updateSelected();
    return;
  }
  for (const file of state.files) {
    const row = node("div","file-row");
    const check = node("input");
    check.type = "checkbox"; check.checked = state.selected.has(file.id);
    check.disabled = file.state !== "approved";
    check.setAttribute("aria-label","Include " + file.display_name + " in the next invitation");
    check.addEventListener("change", () => {
      check.checked ? state.selected.add(file.id) : state.selected.delete(file.id);
      updateSelected();
    });
    const icon = node("span","file-icon",file.mime_type.startsWith("video/") ? "▶" : "↳");
    const info = node("div","file-info");
    info.append(node("strong","",file.display_name));
    info.append(node("small","",size(file.bytes) + " · " + when(file.created_at) + " · " + (file.storage_provider || "unknown").toUpperCase()));
    const actions = node("div","file-actions");
    const pill = node("span","pill " + file.state,file.state.toUpperCase());
    const button = node("button","button small outline",file.state === "approved" ? "Disable" : "Approve");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api("/api/admin/file-state", {
          method: "POST", owner: true,
          data: { fileId: file.id, state: file.state === "approved" ? "disabled" : "approved" }
        });
        toast(file.state === "approved" ? "File disabled." : "File approved. Ready to share.");
        await Promise.all([loadFiles(), loadActivity()]);
      } catch (e) { toast(e.message, true); button.disabled = false; }
    });
    actions.append(pill, button);
    row.append(check,icon,info,actions);
    list.append(row);
  }
  updateSelected();
}
function showNewLink(token) {
  const url = location.origin + "/#share=" + token;
  $("share-url").value = url;
  $("new-share").hidden = false;
  $("new-share").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function renderShares() {
  const list = $("share-list");
  list.replaceChildren();
  if (!state.shares.length) {
    list.append(node("p","empty-state","No handoffs yet. Select approved files to begin."));
    return;
  }
  for (const share of state.shares) {
    const row = node("div","share-row");
    row.append(node("strong","",share.title));
    const closed = share.revoked_at || share.expired;
    row.append(node("small","",share.file_count + " file(s) · " + (share.revoked_at ? "Revoked" : share.expired ? "Expired" : "Expires " + when(share.expires_at))));
    const actions = node("div","share-actions");
    if (!closed) {
      const rotate = node("button","button small outline","Refresh link");
      const revoke = node("button","button small danger","Revoke");
      rotate.type = "button"; revoke.type = "button";
      rotate.addEventListener("click", async () => {
        rotate.disabled = true;
        try {
          const d = await api("/api/admin/rotate", { method:"POST", owner:true, data:{ shareId:share.id } });
          showNewLink(d.token);
          toast("Link refreshed. The old one is now invalid.");
        } catch (e) { toast(e.message,true); }
        finally { rotate.disabled = false; }
      });
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoke this invitation immediately? This cannot be undone.")) return;
        revoke.disabled = true;
        try {
          await api("/api/admin/revoke", { method:"POST", owner:true, data:{shareId:share.id} });
          await Promise.all([loadShares(),loadActivity()]);
          toast("Invitation revoked.");
        } catch (e) { toast(e.message,true); revoke.disabled = false; }
      });
      actions.append(rotate,revoke);
    }
    row.append(actions);
    list.append(row);
  }
}
async function upload(file) {
  if (!file) return;
  if (!state.workspace) { toast("Select a project workspace.",true); return; }
  if (file.size === 0 || file.size > 25 * 1024 * 1024) { toast("Choose a file between 1 byte and 25 MB.",true); return; }
  const progress = $("upload-progress"), bar = $("upload-progress-bar");
  const message = $("upload-status");
  $("file-input").disabled = true;
  progress.hidden = false; bar.style.width = "0%"; message.textContent = "Uploading " + file.name + "…";
  try {
    await new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT","/api/admin/upload?workspace=" + encodeURIComponent(state.workspace));
      if (state.key) xhr.setRequestHeader("Authorization","Bearer " + state.key);
      else xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type",file.type || "application/octet-stream");
      xhr.setRequestHeader("X-File-Name",encodeURIComponent(file.name));
      xhr.upload.addEventListener("progress", e => {
        if (e.lengthComputable) bar.style.width = Math.min(100,Math.round(e.loaded / e.total * 100)) + "%";
      });
      xhr.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(new Error(data.error || "Upload failed (" + xhr.status + ")"));
      });
      xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
      xhr.send(file);
    });
    bar.style.width = "100%";
    message.textContent = "Uploaded. Approve it in the library below when ready.";
    toast("Upload complete. File is staged and private.");
    await Promise.all([loadFiles(),loadActivity()]);
  } catch (e) {
    message.textContent = e.message;
    toast(e.message,true);
  } finally {
    $("file-input").disabled = false;
    $("file-input").value = "";
  }
}
async function showReceiver(token) {
  $("operator").hidden = true; $("receiver").hidden = false;
  const stateEl = $("receive-state"), list = $("receive-files");
  try {
    const data = await api("/api/share/open",{ method:"POST", data:{token} });
    $("receive-title").textContent = data.title || "Your shared files";
    $("receive-expiry").textContent = "EXPIRES " + when(data.expiresAt).toUpperCase();
    list.replaceChildren();
    const files = data.files || [];
    stateEl.textContent = files.length ? files.length + (files.length === 1 ? " file is ready." : " files are ready.") : "No approved files available in this invitation.";
    for (const file of files) {
      const item = node("article","receive-item");
      item.append(node("h3","",file.name));
      const row = node("div","row");
      row.append(node("span","muted",size(file.size) + " · " + file.type));
      const actions = node("div","receive-actions");
      const download = node("a","button primary","Download ↓");
      download.href = "/api/share/file/" + encodeURIComponent(file.id) + "?download=1";
      download.rel = "noreferrer";
      actions.append(download);
      if (/^(video\/(mp4|webm)|audio\/(mpeg|mp4|ogg|wav))$/.test(file.type)) {
        const button = node("button","button outline","Watch / listen");
        button.type = "button";
        button.addEventListener("click", () => {
          let media = item.querySelector(".preview");
          if (media) { media.remove(); button.textContent = "Watch / listen"; return; }
          media = node(file.type.startsWith("video/") ? "video" : "audio","preview");
          media.controls = true; media.preload = "metadata"; media.playsInline = true;
          media.src = "/api/share/file/" + encodeURIComponent(file.id);
          item.append(media); button.textContent = "Close player";
        });
        actions.append(button);
      }
      row.append(actions); item.append(row); list.append(item);
    }
  } catch (e) {
    $("receive-title").textContent = "This door is closed.";
    stateEl.textContent = e.message;
    list.replaceChildren();
  }
}
function bindEvents() {
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    state.key = $("owner-key").value.trim();
    try { await openWorkbench(); toast("Workbench opened."); }
    catch (e) { lockWorkbench(); toast(e.message,true); }
  });
  $("sign-out").addEventListener("click",async () => {
    if (state.authMode === "staticid") {
      try {
        const response = await fetch("/api/static-id/logout", { method:"POST", credentials:"same-origin", cache:"no-store" });
        if (!response.ok) throw new Error("Sign-out failed");
      }
      catch { toast("Unable to contact shared sign-out; retry when online.",true); return; }
    }
    lockWorkbench();
  });
  $("retry-workspaces").addEventListener("click", async () => {
    try { await openWorkbench(); }
    catch { $("desk-status").textContent = "Could not reopen workbench. Lock it and sign in again, or check service status."; }
  });
  $("workspace-picker").addEventListener("change", async event => {
    state.workspace = event.target.value;
    sessionStorage.setItem("fileport-workspace",state.workspace);
    try { await loadWorkspace(); } catch (e) { toast(e.message,true); }
  });
  $("workspace-form").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("workspace-name").value.trim();
    const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48).replace(/-$/,"");
    if (!/^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) { toast("Use a project name of at least three letters.",true); return; }
    try {
      await api("/api/admin/workspaces",{method:"POST",owner:true,data:{name,slug}});
      state.workspace = slug;
      $("workspace-name").value = "";
      await loadWorkspaces(); toast("Project home created.");
    } catch (e) { toast(e.message,true); }
  });
  $("dropzone").addEventListener("click",event => { if (event.target !== $("file-input")) $("file-input").click(); });
  $("dropzone").addEventListener("keydown",e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file-input").click(); } });
  $("file-input").addEventListener("change",e => upload(e.target.files?.[0]));
  for (const type of ["dragenter","dragover"]) $("dropzone").addEventListener(type,e => {e.preventDefault(); $("dropzone").classList.add("over");});
  for (const type of ["dragleave","drop"]) $("dropzone").addEventListener(type,e => {e.preventDefault(); $("dropzone").classList.remove("over");});
  $("dropzone").addEventListener("drop", e => upload(e.dataTransfer?.files?.[0]));
  $("refresh-library").addEventListener("click",async () => {
    try { await Promise.all([loadFiles(),loadShares(),loadActivity()]); toast("Workbench refreshed."); }
    catch (e) { toast(e.message,true); }
  });
  $("share-form").addEventListener("submit",async event => {
    event.preventDefault();
    if (!state.selected.size) { toast("Select at least one approved file from the library.",true); return; }
    const button = $("share-form").querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("/api/admin/shares", { method:"POST", owner:true,
        data:{workspace:state.workspace,title:$("share-title").value.trim(),hours:Number($("share-hours").value),fileIds:[...state.selected]} });
      showNewLink(data.token);
      state.selected.clear(); updateSelected(); renderFiles();
      await Promise.all([loadShares(),loadActivity()]);
      toast("Private invitation created.");
    } catch(e) { toast(e.message,true); }
    finally { button.disabled = false; }
  });
  $("copy-share").addEventListener("click",() => copy($("share-url").value));
}
async function checkStaticId() {
  const status = $("identity-status"),button = $("static-id-login");
  try {
    const response = await fetch("/api/static-id/status",{credentials:"same-origin",cache:"no-store"});
    if (!response.ok) throw Error("identity offline");
    const data = await response.json();
    button.hidden = false;
    if (data.authenticated === true) {
      state.key = "";
      sessionStorage.removeItem("fileport-owner-key");
      try { await openWorkbench(); return; }
      catch (e) {
        status.textContent = e.status === 401
          ? "Identity session found, but owner API authorization failed."
          : "Signed in successfully. Fileport service is temporarily unavailable; retry or check service status.";
        button.textContent = "Sign in again";
        return;
      }
    }
    status.textContent = "No active Fileport session. Sign in with your existing HUMKIN identity and Proton Authenticator.";
  } catch {
    button.hidden = true;
    status.textContent = "Shared login is not connected yet. Emergency recovery remains available.";
  }
}
async function init() {
  bindEvents();
  checkHealth();
  const token = new URLSearchParams(location.hash.slice(1)).get("share");
  if (token) { await showReceiver(token); return; }
  if (state.key) {
    try { await openWorkbench(); return; }
    catch { lockWorkbench(); }
  }
  await checkStaticId();
}
init();
