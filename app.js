/* ---------------- Settings (theme / accent / background / corner style) ---------------- */
/* localStorage에만 저장되는 기기별 화면 설정이라 노션/서버 데이터와는 분리되어 있습니다. */

const SETTINGS_KEY = "pd_settings";
const DEFAULT_SETTINGS = { theme: "system", accent: "#e78895", bg: "auto", corner: "round", showRating: true };

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
  if (s.bg === "auto") root.style.removeProperty("--bg");
  else root.style.setProperty("--bg", s.bg);
  root.setAttribute("data-corner", s.corner);
}

let settings = loadSettings();
applySettings(settings); // FOUC 방지를 위해 다른 초기화보다 먼저 적용

/* ---------------- State ---------------- */

let workspaceToken = null;
let currentPlan = "free";
let currentLimit = 2;
let isReadOnly = false;
let viewYear, viewMonth; // viewMonth: 0-11
let monthEntries = {};   // { "YYYY-MM-DD": { text, rating, photos: [{url, name}] } }
let monthCache = {};     // "YYYY-MM" -> API response
let loadingMonth = false;
let selectedDateStr = null;

const $ = (id) => document.getElementById(id);
const connectScreen = $("connect-screen");
const mainScreen = $("main-screen");
const dayModal = $("day-modal");
const calendarGrid = $("calendar-grid");
const monthLabel = $("month-label");

function pad2(n) { return String(n).padStart(2, "0"); }
function dateStr(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Notion 임베드 iframe 등에서 클립보드 API가 막혀 있을 때의 대체 경로.
    try {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(temp);
      return ok;
    } catch {
      return false;
    }
  }
}

function selectText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function flashCopyButton(btn, ok, textEl) {
  btn.textContent = ok ? "복사됨 ✓" : "직접 선택해서 복사";
  btn.classList.toggle("copied", ok);
  if (!ok && textEl) selectText(textEl);
  setTimeout(() => {
    btn.textContent = "복사";
    btn.classList.remove("copied");
  }, ok ? 1500 : 2500);
}

/* ---------------- Workspace link ---------------- */

function myLinkUrl() {
  const url = new URL(location.href);
  url.searchParams.set("w", workspaceToken);
  url.searchParams.delete("connected");
  return url.toString();
}

function showWelcomeBanner(message) {
  if (message) $("welcome-text").textContent = message;
  $("my-link-input").textContent = myLinkUrl();
  $("welcome-banner").hidden = false;
}

$("show-link-btn").addEventListener("click", () => showWelcomeBanner());
$("dismiss-banner-btn").addEventListener("click", () => { $("welcome-banner").hidden = true; });
$("my-link-input").addEventListener("click", () => selectText($("my-link-input")));
$("copy-link-btn").addEventListener("click", async () => {
  const ok = await copyText($("my-link-input").textContent);
  flashCopyButton($("copy-link-btn"), ok, $("my-link-input"));
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
}

$("regenerate-link-btn").addEventListener("click", regenerateLink);

$("create-view-link-btn").addEventListener("click", async () => {
  const btn = $("create-view-link-btn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "생성 중...";
  try {
    const res = await fetch("/api/create-view-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ w: workspaceToken }),
    });
    if (!res.ok) {
      alert("보기 전용 링크 생성에 실패했어요.");
      return;
    }
    const { token } = await res.json();
    const url = new URL(location.href);
    url.searchParams.set("w", token);
    url.searchParams.delete("connected");
    $("view-link-input").textContent = url.toString();
    $("view-link-row").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
$("view-link-input").addEventListener("click", () => selectText($("view-link-input")));
$("copy-view-link-btn").addEventListener("click", async () => {
  const ok = await copyText($("view-link-input").textContent);
  flashCopyButton($("copy-view-link-btn"), ok, $("view-link-input"));
});

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
  document.querySelectorAll("#bg-swatches .swatch").forEach(
    (b) => b.classList.toggle("active", b.dataset.color.toLowerCase() === settings.bg.toLowerCase())
  );
  document.querySelectorAll("#rating-visible-segmented button").forEach(
    (b) => b.classList.toggle("active", b.dataset.value === (settings.showRating ? "on" : "off"))
  );
  $("accent-picker").value = settings.accent;
  if (settings.bg !== "auto" && settings.bg !== "transparent") $("bg-picker").value = settings.bg;
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
$("bg-swatches").addEventListener("click", (e) => {
  const btn = e.target.closest("button.swatch");
  if (btn) updateSettings({ bg: btn.dataset.color });
});
$("bg-picker").addEventListener("input", (e) => updateSettings({ bg: e.target.value }));
$("rating-visible-segmented").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (!btn) return;
  updateSettings({ showRating: btn.dataset.value === "on" });
  if (selectedDateStr && !dayModal.hidden) {
    renderStarRating((monthEntries[selectedDateStr]?.rating) || 0);
  }
  if (viewYear !== undefined) {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    renderCalendar(daysInMonth);
  }
});

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
  if (loadingMonth) return;
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  loadMonth();
}

function setNavDisabled(disabled) {
  $("prev-month-btn").disabled = disabled;
  $("next-month-btn").disabled = disabled;
}

function monthKey(y, m) { return `${y}-${pad2(m + 1)}`; }

function renderSkeleton(daysInMonth) {
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  calendarGrid.innerHTML = "";
  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "day-cell empty";
    calendarGrid.appendChild(blank);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement("div");
    cell.className = "day-cell skeleton";
    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = d;
    cell.appendChild(num);
    calendarGrid.appendChild(cell);
  }
}

async function fetchMonth(y, m) {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startStr = dateStr(y, m, 1);
  const endStr = dateStr(y, m, daysInMonth);
  const res = await fetch(`/api/entries?w=${workspaceToken}&start=${startStr}&end=${endStr}`);
  if (!res.ok) throw Object.assign(new Error("fetch_failed"), { status: res.status });
  return res.json();
}

function prefetchAdjacentMonths() {
  [-1, 1].forEach((delta) => {
    let y = viewYear, m = viewMonth + delta;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    const key = monthKey(y, m);
    if (monthCache[key]) return;
    fetchMonth(y, m).then((data) => { monthCache[key] = data; }).catch(() => {});
  });
}

async function loadMonth() {
  const key = monthKey(viewYear, viewMonth);
  monthLabel.textContent = `${viewYear}년 ${viewMonth + 1}월`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  if (monthCache[key]) {
    applyMonthData(monthCache[key]);
    prefetchAdjacentMonths();
    return;
  }
  if (loadingMonth) return;

  loadingMonth = true;
  renderSkeleton(daysInMonth); // 데이터가 오기 전에 뼈대부터 즉시 그려서 반응성을 높임
  setNavDisabled(true);

  try {
    const data = await fetchMonth(viewYear, viewMonth);
    monthCache[key] = data;
    applyMonthData(data);
    prefetchAdjacentMonths();
  } catch (err) {
    if (err.status === 401) {
      alert("연결이 만료되었거나 잘못된 링크예요. 다시 연결해주세요.");
      workspaceToken = null;
      history.replaceState({}, "", location.pathname);
      connectScreen.hidden = false;
      mainScreen.hidden = true;
    } else {
      monthLabel.textContent += " (불러오기 실패, 새로고침 해주세요)";
    }
  } finally {
    loadingMonth = false;
    setNavDisabled(false);
  }
}

function applyMonthData(data) {
  monthEntries = data.entries || {};
  currentPlan = data.plan || "free";
  currentLimit = data.photoLimit || 2;
  isReadOnly = !!data.readOnly;
  document.body.classList.toggle("read-only", isReadOnly);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  renderCalendar(daysInMonth);
}

function renderCalendar(daysInMonth) {
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const todayStr = dateStr(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  calendarGrid.innerHTML = "";

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

    const hasEntry = !!(entry?.text || entry?.rating);
    if (entry?.photos?.length) {
      cell.classList.add("has-photo");
      cell.style.setProperty("--thumb-url", `url("${entry.photos[0].url}")`);
    }
    if (hasEntry) cell.classList.add("has-entry");

    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = d;
    cell.appendChild(num);

    if (entry?.text) {
      const dot = document.createElement("span");
      dot.className = "diary-dot";
      cell.appendChild(dot);
    }

    if (entry?.rating && settings.showRating) {
      const badge = document.createElement("span");
      badge.className = "day-rating-badge";
      badge.textContent = `★${entry.rating}`;
      cell.appendChild(badge);
    }

    const hasContent = hasEntry || entry?.photos?.length;
    if (!isReadOnly || hasContent) {
      cell.addEventListener("click", () => openDayModal(ds));
    }
    if (hasContent) {
      cell.addEventListener("mouseenter", (e) => showDayTooltip(e, entry));
      cell.addEventListener("mousemove", positionDayTooltip);
      cell.addEventListener("mouseleave", hideDayTooltip);
    }
    calendarGrid.appendChild(cell);
  }
}

/* ---------------- Hover preview tooltip ---------------- */

function showDayTooltip(e, entry) {
  const tip = $("day-tooltip");
  tip.querySelector(".day-tooltip-stars").textContent = (settings.showRating && entry.rating)
    ? "★".repeat(entry.rating) + "☆".repeat(5 - entry.rating)
    : "";
  tip.querySelector(".day-tooltip-text").textContent = entry.text || "";
  tip.hidden = false;
  positionDayTooltip(e);
}
function positionDayTooltip(e) {
  const tip = $("day-tooltip");
  const pad = 14;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + 210 > window.innerWidth) x = e.clientX - 210 - pad;
  if (y + 110 > window.innerHeight) y = e.clientY - 110 - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideDayTooltip() { $("day-tooltip").hidden = true; }

/* ---------------- Day modal ---------------- */

function openDayModal(ds) {
  selectedDateStr = ds;
  const entry = monthEntries[ds] || { text: "", photos: [], rating: 0 };
  const [y, m, d] = ds.split("-").map(Number);
  dayModal.hidden = false; // 캐러셀 폭을 재기 전에 모달을 먼저 화면에 띄워야 clientWidth가 0으로 안 잡힘
  $("modal-date-label").textContent = `${y}년 ${m}월 ${d}일`;
  renderStarRating(entry.rating || 0);
  renderCarousel(entry.photos || []);

  if (isReadOnly) {
    document.querySelector(".diary-textarea-wrap").hidden = true;
    const viewText = $("diary-view-text");
    viewText.textContent = entry.text || "";
    viewText.hidden = false;
  } else {
    document.querySelector(".diary-textarea-wrap").hidden = false;
    $("diary-view-text").hidden = true;
    $("diary-text").value = entry.text || "";
  }

  const used = (entry.photos || []).length;
  $("upload-status").textContent = `${used} / ${currentLimit}장 사용 중 (${currentPlan === "free" ? "무료" : "프로"} 플랜)`;
  $("save-hint").hidden = true;
}

$("modal-close-btn").addEventListener("click", () => { dayModal.hidden = true; });
dayModal.addEventListener("click", (e) => { if (e.target === dayModal) dayModal.hidden = true; });

/* ---------------- Star rating ---------------- */

function renderStarRating(rating) {
  const container = $("star-rating");
  container.innerHTML = "";
  container.hidden = !settings.showRating;
  if (!settings.showRating) return;
  container.classList.toggle("readonly", isReadOnly);
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "★";
    if (i <= rating) btn.classList.add("filled");
    if (!isReadOnly) btn.addEventListener("click", () => setRating(i));
    container.appendChild(btn);
  }
}

async function setRating(value) {
  const entry = monthEntries[selectedDateStr] || { text: "", photos: [], rating: 0 };
  const newValue = entry.rating === value ? 0 : value; // 같은 별 다시 누르면 취소
  await patchEntry({ rating: newValue });
  entry.rating = newValue;
  monthEntries[selectedDateStr] = entry;
  renderStarRating(newValue);
  updateCellPreview(selectedDateStr);
}

/* ---------------- Photo carousel (인스타그램 스타일: 별점/일기는 그대로 보이고 사진만 스와이프) ---------------- */

let carouselPhotos = [];
let carouselIndex = 0;

const carouselEl = $("photo-carousel");

function renderCarousel(photos, startIndex = 0) {
  carouselPhotos = photos;
  carouselIndex = Math.min(Math.max(0, startIndex), Math.max(0, photos.length - 1));

  $("photo-carousel").hidden = photos.length === 0;
  $("carousel-actions").hidden = isReadOnly || photos.length === 0;

  // 컨테이너가 방금 hidden 상태에서 풀렸을 수 있어, 실제 렌더된 폭을 강제로 읽어온 뒤
  // 퍼센트 대신 픽셀 값으로 슬라이드를 배치한다 (aspect-ratio + display 전환 시
  // flex-basis:%가 낡은 값으로 굳어버리는 렌더링 버그를 피하기 위함).
  const containerWidth = carouselEl.clientWidth;

  const track = $("carousel-track");
  track.innerHTML = "";
  photos.forEach((p) => {
    const slide = document.createElement("div");
    slide.className = "carousel-slide";
    slide.style.width = `${containerWidth}px`;
    const img = document.createElement("img");
    img.src = p.url;
    img.loading = "lazy";
    slide.appendChild(img);
    track.appendChild(slide);
  });

  updateCarouselUI();
}

function updateCarouselUI() {
  carouselEl.scrollLeft = 0; // 트랙이 컨테이너보다 넓어서, 버튼 포커스 시 브라우저가 자동 스크롤시키는 것을 막음
  const containerWidth = carouselEl.clientWidth;
  // 스크롤바 등장/소멸으로 폭이 바뀌면 슬라이드 폭도 같이 갱신 (안 하면 다음 슬라이드가 살짝 비어져 보임)
  $("carousel-track").querySelectorAll(".carousel-slide").forEach((s) => { s.style.width = `${containerWidth}px`; });
  $("carousel-track").style.transform = `translateX(${-carouselIndex * containerWidth}px)`;

  const dotsWrap = $("carousel-dots");
  dotsWrap.innerHTML = "";
  if (carouselPhotos.length > 1) {
    carouselPhotos.forEach((_, i) => {
      const dot = document.createElement("span");
      if (i === carouselIndex) dot.className = "active";
      dotsWrap.appendChild(dot);
    });
  }

  $("carousel-prev-btn").hidden = carouselIndex === 0;
  $("carousel-next-btn").hidden = carouselIndex >= carouselPhotos.length - 1;
  $("carousel-cover-btn").hidden = carouselIndex === 0;
}

function carouselStep(delta) {
  if (!carouselPhotos.length) return;
  carouselIndex = Math.min(Math.max(0, carouselIndex + delta), carouselPhotos.length - 1);
  updateCarouselUI();
}

$("carousel-prev-btn").addEventListener("click", () => carouselStep(-1));
$("carousel-next-btn").addEventListener("click", () => carouselStep(1));

// 드래그로 스와이프 (마우스+터치 공용, pointer 이벤트)
let dragging = false, dragStartX = 0, dragDeltaX = 0;

carouselEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button") || carouselPhotos.length < 2) return;
  dragging = true;
  dragStartX = e.clientX;
  dragDeltaX = 0;
  $("carousel-track").classList.add("dragging");
  carouselEl.setPointerCapture(e.pointerId);
});
carouselEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  dragDeltaX = e.clientX - dragStartX;
  const containerWidth = carouselEl.clientWidth;
  $("carousel-track").style.transform = `translateX(${-carouselIndex * containerWidth + dragDeltaX}px)`;
});
function endCarouselDrag() {
  if (!dragging) return;
  dragging = false;
  $("carousel-track").classList.remove("dragging");
  const threshold = carouselEl.clientWidth * 0.18;
  if (dragDeltaX < -threshold) carouselStep(1);
  else if (dragDeltaX > threshold) carouselStep(-1);
  else updateCarouselUI();
}
carouselEl.addEventListener("pointerup", endCarouselDrag);
carouselEl.addEventListener("pointercancel", endCarouselDrag);
carouselEl.addEventListener("pointerleave", endCarouselDrag);

async function patchEntry(body) {
  const res = await fetch(`/api/entries?w=${workspaceToken}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: selectedDateStr, ...body }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "request_failed");
  return res.json();
}

async function setCoverPhoto(photo) {
  const entry = monthEntries[selectedDateStr];
  const reordered = [photo, ...entry.photos.filter((p) => p.url !== photo.url)];
  await patchEntry({ reorderPhotos: reordered });
  entry.photos = reordered;
  renderCarousel(reordered, 0);
  updateCellPreview(selectedDateStr);
}

async function removePhoto(photo) {
  await patchEntry({ removePhoto: { url: photo.url } });
  const entry = monthEntries[selectedDateStr];
  entry.photos = (entry.photos || []).filter((p) => p.url !== photo.url);
  renderCarousel(entry.photos, carouselIndex);
  updateCellPreview(selectedDateStr);
}

$("carousel-cover-btn").addEventListener("click", () => {
  if (carouselIndex === 0 || !carouselPhotos.length) return;
  setCoverPhoto(carouselPhotos[carouselIndex]);
});
$("carousel-remove-btn").addEventListener("click", () => {
  if (!carouselPhotos.length) return;
  if (confirm("이 사진을 삭제할까요?")) removePhoto(carouselPhotos[carouselIndex]);
});
$("carousel-crop-btn").addEventListener("click", async () => {
  if (!carouselPhotos.length) return;
  const photo = carouselPhotos[carouselIndex];
  const keepIndex = carouselIndex;
  const btn = $("carousel-crop-btn");
  const original = btn.textContent;
  btn.disabled = true;
  try {
    btn.textContent = "불러오는 중...";
    const blob = await fetch(photo.url).then((r) => r.blob());
    const file = new File([blob], photo.name || "photo.jpg", { type: blob.type || "image/jpeg" });
    const cropped = await openCropModal(file);

    btn.textContent = "업로드 중...";
    const sign = await getCloudinarySign(selectedDateStr, true);
    const result = await uploadToCloudinary(cropped, sign);
    const newPhoto = { url: result.secure_url, name: photo.name };
    await patchEntry({ addPhoto: newPhoto, removePhoto: { url: photo.url } });

    const entry = monthEntries[selectedDateStr];
    entry.photos = entry.photos.map((p) => (p.url === photo.url ? newPhoto : p));
    renderCarousel(entry.photos, keepIndex);
    updateCellPreview(selectedDateStr);
  } catch {
    alert("사진을 다시 자르는 데 실패했어요. 잠시 후 다시 시도해주세요.");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

/* ---------------- Photo crop ---------------- */

function openCropModal(file) {
  return new Promise((resolve) => {
    const modal = $("crop-modal");
    const img = $("crop-image");
    const stage = $("crop-stage");
    const box = $("crop-box");
    const skipBtn = $("crop-skip-btn");
    const applyBtn = $("crop-apply-btn");
    const url = URL.createObjectURL(file);

    let scale = 1, dw = 0, dh = 0, size = 0, boxX = 0, boxY = 0;
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;

    function onPointerDown(e) {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = boxX; origY = boxY;
      box.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
      if (!dragging) return;
      boxX = Math.min(Math.max(0, origX + (e.clientX - startX)), dw - size);
      boxY = Math.min(Math.max(0, origY + (e.clientY - startY)), dh - size);
      box.style.left = `${boxX}px`;
      box.style.top = `${boxY}px`;
    }
    function onPointerUp() { dragging = false; }

    function cleanup(result) {
      URL.revokeObjectURL(url);
      modal.hidden = true;
      img.onload = null;
      box.removeEventListener("pointerdown", onPointerDown);
      box.removeEventListener("pointermove", onPointerMove);
      box.removeEventListener("pointerup", onPointerUp);
      skipBtn.removeEventListener("click", onSkip);
      applyBtn.removeEventListener("click", onApply);
      resolve(result);
    }

    function onSkip() { cleanup(file); }
    function onApply() {
      const outputSize = Math.min(Math.round(size / scale), 1600);
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      canvas.getContext("2d").drawImage(
        img,
        boxX / scale, boxY / scale, size / scale, size / scale,
        0, 0, outputSize, outputSize
      );
      canvas.toBlob(
        (blob) => cleanup(new File([blob], file.name, { type: "image/jpeg" })),
        "image/jpeg",
        0.9
      );
    }

    img.onload = () => {
      const maxW = Math.min(window.innerWidth * 0.82, 340);
      scale = Math.min(maxW / img.naturalWidth, 340 / img.naturalHeight, 1);
      dw = img.naturalWidth * scale;
      dh = img.naturalHeight * scale;
      img.style.width = `${dw}px`;
      img.style.height = `${dh}px`;
      stage.style.width = `${dw}px`;
      stage.style.height = `${dh}px`;

      size = Math.min(dw, dh);
      boxX = (dw - size) / 2;
      boxY = (dh - size) / 2;
      box.style.width = `${size}px`;
      box.style.height = `${size}px`;
      box.style.left = `${boxX}px`;
      box.style.top = `${boxY}px`;
    };

    box.addEventListener("pointerdown", onPointerDown);
    box.addEventListener("pointermove", onPointerMove);
    box.addEventListener("pointerup", onPointerUp);
    skipBtn.addEventListener("click", onSkip);
    applyBtn.addEventListener("click", onApply);

    img.src = url;
    modal.hidden = false;
  });
}

/* ---------------- Photo upload (signed direct-to-Cloudinary) ---------------- */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB, Cloudinary 프리셋 제한과 맞춰주세요.

async function getCloudinarySign(date, replace = false) {
  const res = await fetch(`/api/cloudinary-sign?w=${workspaceToken}&date=${date}${replace ? "&replace=1" : ""}`);
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

    const toUpload = await openCropModal(file);

    try {
      statusEl.textContent = `업로드 중... ${done + 1} / ${files.length}`;
      const sign = await getCloudinarySign(selectedDateStr);
      const result = await uploadToCloudinary(toUpload, sign);
      const photoObj = { url: result.secure_url, name: file.name };
      await patchEntry({ addPhoto: photoObj });
      monthEntries[selectedDateStr].photos.push(photoObj);
      done++;
      renderCarousel(monthEntries[selectedDateStr].photos, monthEntries[selectedDateStr].photos.length - 1);
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
  updateCellPreview(selectedDateStr);
  setTimeout(() => { dayModal.hidden = true; }, 500);
});
