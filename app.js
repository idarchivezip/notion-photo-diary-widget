/* ---------------- Settings (theme / accent color / corner style) ---------------- */
/* localStorage에만 저장되는 기기별 화면 설정이라 노션/서버 데이터와는 분리되어 있습니다. */

const SETTINGS_KEY = "pd_settings";
const DEFAULT_SETTINGS = { theme: "system", accent: "#e78895", corner: "round" };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function darkenHex(hex, amount = 0.14) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) * (1 - amount));
  const g = Math.max(0, ((n >> 8) & 255) * (1 - amount));
  const b = Math.max(0, (n & 255) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

function applySettings(s) {
  const root = document.documentElement;
  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", s.theme);
  root.style.setProperty("--accent", s.accent);
  root.style.setProperty("--accent-dark", darkenHex(s.accent));
  root.setAttribute("data-corner", s.corner);
}

let settings = loadSettings();
applySettings(settings); // FOUC 방지를 위해 다른 초기화보다 먼저 적용

/* ---------------- State ---------------- */

let workspaceToken = null;
let currentPlan = "free";
let currentLimit = 2;
let viewYear, viewMonth; // viewMonth: 0-11
let monthEntries = {};   // { "YYYY-MM-DD": { text, photos: [{url, name}] } }
let selectedDateStr = null;

const $ = (id) => document.getElementById(id);
const connectScreen = $("connect-screen");
const mainScreen = $("main-screen");
const dayModal = $("day-modal");
const calendarGrid = $("calendar-grid");
const monthLabel = $("month-label");

function pad2(n) { return String(n).padStart(2, "0"); }
function dateStr(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

/* ---------------- Workspace link ---------------- */

function myLinkUrl() {
  const url = new URL(location.href);
  url.searchParams.set("w", workspaceToken);
  url.searchParams.delete("connected");
  return url.toString();
}

function showWelcomeBanner(message) {
  if (message) $("welcome-text").textContent = message;
  $("my-link-input").value = myLinkUrl();
  $("welcome-banner").hidden = false;
}

$("show-link-btn").addEventListener("click", () => showWelcomeBanner());
$("dismiss-banner-btn").addEventListener("click", () => { $("welcome-banner").hidden = true; });
$("copy-link-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("my-link-input").value);
  $("copy-link-btn").textContent = "복사됨 ✓";
  setTimeout(() => { $("copy-link-btn").textContent = "복사"; }, 1500);
});

async function regenerateLink() {
  const ok = confirm(
    "링크를 재발급하면 기존 링크는 더 이상 작동하지 않아요.\n" +
    "노션에 저장된 내용은 그대로 유지되고, 새 링크로만 접근할 수 있게 됩니다. 계속할까요?"
  );
  if (!ok) return;

  const res = await fetch("/api/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ w: workspaceToken }),
  });
  if (!res.ok) {
    alert("재발급에 실패했어요. 잠시 후 다시 시도해주세요.");
    return;
  }
  const { token } = await res.json();
  workspaceToken = token;
  const url = new URL(location.href);
  url.searchParams.set("w", token);
  url.searchParams.delete("connected");
  history.replaceState({}, "", url.toString());

  showWelcomeBanner("🔄 링크가 재발급되었어요! 이전 링크는 더 이상 동작하지 않습니다. 아래 새 링크로 Notion embed 주소를 교체해주세요.");
  await loadMonth();
}

$("regenerate-link-btn").addEventListener("click", regenerateLink);

/* ---------------- Settings UI ---------------- */

const settingsModal = $("settings-modal");

function syncSettingsUI() {
  document.querySelectorAll("#theme-segmented button").forEach(
    (b) => b.classList.toggle("active", b.dataset.value === settings.theme)
  );
  document.querySelectorAll("#corner-segmented button").forEach(
    (b) => b.classList.toggle("active", b.dataset.value === settings.corner)
  );
  document.querySelectorAll("#accent-swatches .swatch").forEach(
    (b) => b.classList.toggle("active", b.dataset.color.toLowerCase() === settings.accent.toLowerCase())
  );
  $("accent-picker").value = settings.accent;
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettings(settings);
  syncSettingsUI();
}

$("show-settings-btn").addEventListener("click", () => {
  syncSettingsUI();
  settingsModal.hidden = false;
});
$("settings-close-btn").addEventListener("click", () => { settingsModal.hidden = true; });
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) settingsModal.hidden = true; });

$("theme-segmented").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (btn) updateSettings({ theme: btn.dataset.value });
});
$("corner-segmented").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (btn) updateSettings({ corner: btn.dataset.value });
});
$("accent-swatches").addEventListener("click", (e) => {
  const btn = e.target.closest("button.swatch");
  if (btn) updateSettings({ accent: btn.dataset.color });
});
$("accent-picker").addEventListener("input", (e) => updateSettings({ accent: e.target.value }));

/* ---------------- Init ---------------- */

function init() {
  const url = new URL(location.href);
  const token = url.searchParams.get("w");
  const justConnected = url.searchParams.get("connected") === "1";
  const connectError = url.searchParams.get("connect_error");

  if (!token) {
    connectScreen.hidden = false;
    mainScreen.hidden = true;
    if (connectError) {
      $("connect-error").textContent = "노션 연결에 실패했어요. 다시 시도해주세요.";
      $("connect-error").hidden = false;
    }
    return;
  }

  workspaceToken = token;
  connectScreen.hidden = true;
  mainScreen.hidden = false;

  if (justConnected) showWelcomeBanner("🎉 노션 연결이 완료됐어요! 아래 링크를 복사해서 Notion에 embed하세요.");

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  loadMonth();
}

init();

/* ---------------- Calendar ---------------- */

$("prev-month-btn").addEventListener("click", () => changeMonth(-1));
$("next-month-btn").addEventListener("click", () => changeMonth(1));

function changeMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  loadMonth();
}

async function loadMonth() {
  monthLabel.textContent = `${viewYear}년 ${viewMonth + 1}월`;
  calendarGrid.innerHTML = "";
  monthEntries = {};

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startStr = dateStr(viewYear, viewMonth, 1);
  const endStr = dateStr(viewYear, viewMonth, daysInMonth);

  let res;
  try {
    res = await fetch(`/api/entries?w=${workspaceToken}&start=${startStr}&end=${endStr}`);
  } catch {
    monthLabel.textContent += " (연결 오류, 새로고침 해주세요)";
    return;
  }

  if (res.status === 401) {
    alert("연결이 만료되었거나 잘못된 링크예요. 다시 연결해주세요.");
    workspaceToken = null;
    history.replaceState({}, "", location.pathname);
    connectScreen.hidden = false;
    mainScreen.hidden = true;
    return;
  }
  if (!res.ok) {
    monthLabel.textContent += " (불러오기 실패, 새로고침 해주세요)";
    return;
  }

  const data = await res.json();
  monthEntries = data.entries || {};
  currentPlan = data.plan || "free";
  currentLimit = data.photoLimit || 2;

  renderCalendar(daysInMonth);
}

function renderCalendar(daysInMonth) {
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = dateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "day-cell empty";
    calendarGrid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dateStr(viewYear, viewMonth, d);
    const entry = monthEntries[ds];
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (ds === todayStr) cell.classList.add("today");

    if (entry?.photos?.length) {
      cell.classList.add("has-photo");
      cell.style.setProperty("--thumb-url", `url("${entry.photos[0].url}")`);
    }

    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = d;
    cell.appendChild(num);

    if (entry?.text) {
      const dot = document.createElement("span");
      dot.className = "diary-dot";
      cell.appendChild(dot);
    }

    cell.addEventListener("click", () => openDayModal(ds));
    calendarGrid.appendChild(cell);
  }
}

/* ---------------- Day modal ---------------- */

function openDayModal(ds) {
  selectedDateStr = ds;
  const entry = monthEntries[ds] || { text: "", photos: [] };
  const [y, m, d] = ds.split("-").map(Number);
  $("modal-date-label").textContent = `${y}년 ${m}월 ${d}일`;
  $("diary-text").value = entry.text || "";
  const used = (entry.photos || []).length;
  $("upload-status").textContent = `${used} / ${currentLimit}장 사용 중 (${currentPlan === "free" ? "무료" : "프로"} 플랜)`;
  $("save-hint").hidden = true;
  renderPhotoGrid(entry.photos || []);
  dayModal.hidden = false;
}

$("modal-close-btn").addEventListener("click", () => { dayModal.hidden = true; });
dayModal.addEventListener("click", (e) => { if (e.target === dayModal) dayModal.hidden = true; });

function renderPhotoGrid(photos) {
  const grid = $("photo-grid");
  grid.innerHTML = "";
  photos.forEach((p) => {
    const item = document.createElement("div");
    item.className = "photo-item";
    const img = document.createElement("img");
    img.src = p.url;
    img.loading = "lazy";
    item.appendChild(img);

    const removeBtn = document.createElement("button");
    removeBtn.className = "photo-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => removePhoto(p));
    item.appendChild(removeBtn);

    grid.appendChild(item);
  });
}

async function patchEntry(body) {
  const res = await fetch(`/api/entries?w=${workspaceToken}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: selectedDateStr, ...body }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "request_failed");
  return res.json();
}

async function removePhoto(photo) {
  await patchEntry({ removePhoto: { url: photo.url } });

  const entry = monthEntries[selectedDateStr];
  entry.photos = (entry.photos || []).filter((p) => p.url !== photo.url);
  renderPhotoGrid(entry.photos);
  updateCellPreview(selectedDateStr);
}

/* ---------------- Photo upload (signed direct-to-Cloudinary) ---------------- */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB, Cloudinary 프리셋 제한과 맞춰주세요.

async function getCloudinarySign(date) {
  const res = await fetch(`/api/cloudinary-sign?w=${workspaceToken}&date=${date}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error === "plan_limit_reached" ? `LIMIT:${data.limit}` : "sign_failed");
  return data;
}

async function uploadToCloudinary(file, sign) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", sign.apiKey);
  formData.append("timestamp", sign.timestamp);
  formData.append("signature", sign.signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

$("photo-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;

  if (!monthEntries[selectedDateStr]) monthEntries[selectedDateStr] = { text: "", photos: [] };
  if (!monthEntries[selectedDateStr].photos) monthEntries[selectedDateStr].photos = [];

  const statusEl = $("upload-status");
  let done = 0;

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      statusEl.textContent = `${file.name}은 이미지 파일이 아니에요.`;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      statusEl.textContent = `${file.name}은 10MB를 넘어서 건너뛸게요.`;
      continue;
    }
    try {
      statusEl.textContent = `업로드 중... ${done + 1} / ${files.length}`;
      const sign = await getCloudinarySign(selectedDateStr);
      const result = await uploadToCloudinary(file, sign);
      const photoObj = { url: result.secure_url, name: file.name };
      await patchEntry({ addPhoto: photoObj });
      monthEntries[selectedDateStr].photos.push(photoObj);
      done++;
      renderPhotoGrid(monthEntries[selectedDateStr].photos);
      updateCellPreview(selectedDateStr);
      $("upload-status").textContent = `${monthEntries[selectedDateStr].photos.length} / ${currentLimit}장 사용 중 (${currentPlan === "free" ? "무료" : "프로"} 플랜)`;
    } catch (err) {
      if (String(err.message).startsWith("LIMIT:")) {
        statusEl.textContent = `${currentPlan === "free" ? "무료" : "프로"} 플랜은 하루 최대 ${currentLimit}장까지 업로드할 수 있어요.`;
        break;
      }
      statusEl.textContent = `업로드 실패: ${file.name}`;
    }
  }
});

function updateCellPreview(ds) {
  if (ds.slice(0, 4) != viewYear || Number(ds.slice(5, 7)) - 1 != viewMonth) return;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  renderCalendar(daysInMonth);
}

/* ---------------- Save diary text ---------------- */

$("save-diary-btn").addEventListener("click", async () => {
  const text = $("diary-text").value;
  await patchEntry({ text });

  if (!monthEntries[selectedDateStr]) monthEntries[selectedDateStr] = { text, photos: [] };
  else monthEntries[selectedDateStr].text = text;

  $("save-hint").hidden = false;
  setTimeout(() => { $("save-hint").hidden = true; }, 1800);
  updateCellPreview(selectedDateStr);
});
