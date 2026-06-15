if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// ── Hero title: available landing width에 맞춰 한 줄로 유지 ──
function setHeroSize() {
  const el = document.querySelector('.hero');
  if (!el) return;
  const stageWidth = typeof getStageWidth === 'function' ? getStageWidth() : window.innerWidth;
  const availableWidth = Math.max(320, stageWidth - 96);
  const previousSize = el.style.fontSize;
  el.style.fontSize = '100px';
  const range = document.createRange();
  range.selectNodeContents(el);
  const measuredWidth = range.getBoundingClientRect().width || 1;
  el.style.fontSize = previousSize;
  const size = clamp(Math.floor(100 * availableWidth / measuredWidth), 100, 600);
  document.documentElement.style.setProperty('--hero-size', `${size}px`);
  window.requestAnimationFrame(setLandingTail);
}

function setLandingTail() {
  const metrics = getLandingMetrics();
  document.documentElement.style.setProperty('--landing-tail', `${Math.round(metrics.edgeSpace)}px`);
  document.documentElement.style.setProperty('--thumb-title-gap', `${Math.round(metrics.thumbTitleGap)}px`);
  document.documentElement.style.setProperty('--thumb-area-height', `${Math.round(metrics.thumbAreaHeight)}px`);
}

function getLandingMetrics() {
  const hero = document.querySelector('.hero');
  const heroHeight = hero?.getBoundingClientRect().height || 150;
  const edgeGap = window.innerHeight * 0.08;
  const edgeSpace = Math.max(320, window.innerHeight - heroHeight - edgeGap);
  const thumbTitleGap = Math.round(clamp(window.innerHeight * 0.1, 76, 120));
  const thumbAreaHeight = Math.max(0, window.innerHeight * 1.45);

  return { edgeGap, edgeSpace, thumbTitleGap, thumbAreaHeight };
}

document.fonts.ready.then(() => {
  setHeroSize();
  setLandingTail();
});
window.addEventListener('resize', () => {
  setHeroSize();
  setLandingTail();
});

// ── Panel ──
const performPanel = document.getElementById('panel-perform');
const declarePanel = document.getElementById('panel-declare');
const page = document.getElementById('page');
const btnPerform = document.getElementById('nav-perform');
const btnDeclare = document.getElementById('nav-declare');
let landingAccessToken = null;
let declarationPrintSelecting = false;
let declarationPrintImageSrc = '';
const declarationPrintCropCache = new Map();

function toggleLandingPanel(panelName) {
  const target = panelName === 'perform' ? performPanel : declarePanel;
  const other = panelName === 'perform' ? declarePanel : performPanel;
  const open = !target.classList.contains('open');
  target.classList.toggle('open', open);
  other.classList.remove('open');
  btnPerform.classList.toggle('active', open && panelName === 'perform');
  btnDeclare.classList.toggle('active', open && panelName === 'declare');
  page.classList.toggle('shifted-left', open && panelName === 'perform');
  page.classList.toggle('shifted-right', open && panelName === 'declare');
  setHeroSize();
  window.setTimeout(() => {
    setLandingTail();
    layoutThumbs();
    scrollToLandingStart();
  }, 20);
  window.setTimeout(() => {
    setHeroSize();
    setLandingTail();
    layoutThumbs();
    window.requestAnimationFrame(scrollToLandingStart);
  }, 420);
}

function closeLandingPanels() {
  performPanel.classList.remove('open');
  declarePanel.classList.remove('open');
  btnPerform.classList.remove('active');
  btnDeclare.classList.remove('active');
  page.classList.remove('shifted-left', 'shifted-right');
  setHeroSize();
  setLandingTail();
  layoutThumbs();
  window.requestAnimationFrame(scrollToLandingStart);
}

btnPerform.addEventListener('click', () => toggleLandingPanel('perform'));
btnDeclare.addEventListener('click', () => toggleLandingPanel('declare'));
document.getElementById('btn-print-declaration')?.addEventListener('click', beginDeclarationPrintSelection);

window.addEventListener('resize', layoutThumbs);

function beginDeclarationPrintSelection() {
  if (declarePanel.classList.contains('open')) toggleLandingPanel('declare');
  declarationPrintSelecting = true;
  document.body.classList.add('print-selecting');
  const bar = document.getElementById('print-select-bar');
  bar.classList.add('open');
  bar.setAttribute('aria-hidden', 'false');
}

function endDeclarationPrintSelection() {
  declarationPrintSelecting = false;
  document.body.classList.remove('print-selecting');
  const bar = document.getElementById('print-select-bar');
  bar.querySelector('span').textContent = '인쇄할 표지를 선택하세요.';
  bar.classList.remove('open');
  bar.setAttribute('aria-hidden', 'true');
}

async function getPrintableThumbSource(container) {
  if (container.dataset.thumbnailFileId) {
    try {
      return await fetchDriveBlobUrl(container.dataset.thumbnailFileId, { validateGlb: false });
    } catch (err) {
      console.warn('print thumbnail fetch failed', err);
    }
  }
  const image = container.querySelector('.thumb-image');
  if (image?.src) return image.src;
  const canvas = container.querySelector('canvas');
  if (!canvas) return '';
  try {
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('thumbnail capture failed', err);
    return '';
  }
}

async function prepareDeclarationPrintImage(imageSrc) {
  if (declarationPrintCropCache.has(imageSrc)) return declarationPrintCropCache.get(imageSrc);

  const image = new Image();
  image.crossOrigin = 'anonymous';
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  image.src = imageSrc;
  await loaded;

  const source = document.createElement('canvas');
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;

  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha > 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) throw new Error('실루엣을 찾을 수 없습니다.');
  const padding = Math.max(2, Math.round(Math.max(source.width, source.height) * 0.005));
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(source.width - 1, maxX + padding);
  maxY = Math.min(source.height - 1, maxY + padding);

  const cropped = document.createElement('canvas');
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  cropped.getContext('2d').drawImage(
    source,
    minX,
    minY,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height
  );
  const croppedContext = cropped.getContext('2d');
  const croppedPixels = croppedContext.getImageData(0, 0, cropped.width, cropped.height);
  for (let offset = 0; offset < croppedPixels.data.length; offset += 4) {
    const alpha = croppedPixels.data[offset + 3];
    if (alpha > 20) {
      croppedPixels.data[offset] = 0;
      croppedPixels.data[offset + 1] = 0;
      croppedPixels.data[offset + 2] = 0;
      croppedPixels.data[offset + 3] = 255;
    } else {
      croppedPixels.data[offset + 3] = 0;
    }
  }
  croppedContext.putImageData(croppedPixels, 0, 0);
  const result = cropped.toDataURL('image/png');
  declarationPrintCropCache.set(imageSrc, result);
  return result;
}

async function openPrintOptions(imageSrc) {
  const bar = document.getElementById('print-select-bar');
  bar.querySelector('span').textContent = '실루엣을 분석하는 중';
  try {
    declarationPrintImageSrc = await prepareDeclarationPrintImage(imageSrc);
  } catch (err) {
    console.warn('silhouette crop failed', err);
    declarationPrintImageSrc = imageSrc;
  } finally {
    if (imageSrc.startsWith('blob:')) URL.revokeObjectURL(imageSrc);
  }
  endDeclarationPrintSelection();
  const modal = document.getElementById('print-option-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closePrintOptions() {
  const modal = document.getElementById('print-option-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function printDeclaration(mode) {
  if (!declarationPrintImageSrc) return;
  const stage = document.getElementById('print-stage');
  const styleId = 'print-page-size';
  document.getElementById(styleId)?.remove();
  const pageStyle = document.createElement('style');
  pageStyle.id = styleId;
  pageStyle.textContent = mode === 'a3'
    ? '@media print { @page { size: A3 landscape; margin: 0; } }'
    : '@media print { @page { size: A3 portrait; margin: 0; } }';
  document.head.appendChild(pageStyle);

  const artwork = () => `
    <div class="print-artwork">
      <img src="${declarationPrintImageSrc}" alt="">
    </div>
  `;
  stage.innerHTML = mode === 'a3'
    ? `<section class="print-sheet print-single">${artwork()}</section>`
    : `
      <section class="print-sheet print-split print-split-left">${artwork()}</section>
      <section class="print-sheet print-split print-split-right">${artwork()}</section>
    `;
  closePrintOptions();
  window.setTimeout(() => window.print(), 80);
}

document.getElementById('btn-cancel-print-select')?.addEventListener('click', endDeclarationPrintSelection);
document.getElementById('btn-close-print-options')?.addEventListener('click', closePrintOptions);
document.getElementById('print-option-modal')?.addEventListener('click', event => {
  if (event.target.id === 'print-option-modal') closePrintOptions();
});
document.getElementById('btn-print-a3')?.addEventListener('click', () => printDeclaration('a3'));
document.getElementById('btn-print-a2-split')?.addEventListener('click', () => printDeclaration('a2-split'));
window.addEventListener('afterprint', () => {
  document.getElementById('print-stage').innerHTML = '';
  document.getElementById('print-page-size')?.remove();
});

// ── Landing upload popup ──
const uploadModal = document.getElementById('upload-modal');
const btnOpenUpload = document.getElementById('btn-open-upload');
const btnCloseUpload = document.getElementById('btn-close-upload');
const editModal = document.getElementById('edit-modal');
const btnOpenEdit = document.getElementById('btn-open-edit');
const btnCloseEdit = document.getElementById('btn-close-edit');
const thumbContextMenu = document.getElementById('thumb-context-menu');
let pendingLandingEditDeskId = null;
let pendingLandingEditMode = null;

btnOpenUpload?.addEventListener('click', () => {
  closeLandingPanels();
  uploadModal.classList.add('open');
  uploadModal.setAttribute('aria-hidden', 'false');
});

btnCloseUpload?.addEventListener('click', closeUploadModal);
uploadModal?.addEventListener('click', (event) => {
  if (event.target === uploadModal) closeUploadModal();
});

btnOpenEdit?.addEventListener('click', () => {
  openEditModal();
});

btnCloseEdit?.addEventListener('click', closeEditModal);
editModal?.addEventListener('click', (event) => {
  if (event.target === editModal) closeEditModal();
});

function closeUploadModal() {
  uploadModal.classList.remove('open');
  uploadModal.setAttribute('aria-hidden', 'true');
}

function closeEditModal() {
  editModal.classList.remove('open');
  editModal.setAttribute('aria-hidden', 'true');
  pendingLandingEditDeskId = null;
  pendingLandingEditMode = null;
}

function openEditModal({ deskId = null, mode = null } = {}) {
  closeLandingPanels();
  closeThumbContextMenu();
  pendingLandingEditDeskId = deskId;
  pendingLandingEditMode = mode;
  document.getElementById('landing-edit-progress').textContent = '';
  editModal.classList.add('open');
  editModal.setAttribute('aria-hidden', 'false');
  document.getElementById('landing-edit-pin')?.focus();
}

function openThumbContextMenu(event, deskId) {
  event.preventDefault();
  event.stopPropagation();
  pendingLandingEditDeskId = deskId;
  pendingLandingEditMode = 'thumbnail';
  const menuWidth = 132;
  const menuHeight = 40;
  thumbContextMenu.style.left = `${Math.min(event.clientX, innerWidth - menuWidth - 8)}px`;
  thumbContextMenu.style.top = `${Math.min(event.clientY, innerHeight - menuHeight - 8)}px`;
  thumbContextMenu.classList.add('open');
  thumbContextMenu.setAttribute('aria-hidden', 'false');
}

function closeThumbContextMenu() {
  thumbContextMenu?.classList.remove('open');
  thumbContextMenu?.setAttribute('aria-hidden', 'true');
}

document.getElementById('btn-edit-thumbnail')?.addEventListener('click', () => {
  openEditModal({ deskId: pendingLandingEditDeskId, mode: 'thumbnail' });
});
document.addEventListener('click', closeThumbContextMenu);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeThumbContextMenu();
  endDeclarationPrintSelection();
  closePrintOptions();
});
window.addEventListener('scroll', closeThumbContextMenu, { passive: true });

document.getElementById('landing-google-login')?.addEventListener('click', () => {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (res) => {
      if (res.error) {
        console.error(res);
        return;
      }
      landingAccessToken = res.access_token;
      localStorage.setItem('gtoken', landingAccessToken);
      localStorage.setItem('gtoken_exp', Date.now() + (res.expires_in - 60) * 1000);
      showLandingLoggedIn();
    },
  });
  client.requestAccessToken();
});

function showLandingLoggedIn() {
  document.getElementById('landing-google-login').style.display = 'none';
  document.getElementById('landing-login-status').style.display = 'flex';
  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${landingAccessToken}` }
  }).then(r => r.json()).then(user => {
    document.getElementById('landing-login-name').textContent = user.name || user.email;
  }).catch(() => {
    localStorage.removeItem('gtoken');
    localStorage.removeItem('gtoken_exp');
    document.getElementById('landing-google-login').style.display = 'inline-block';
    document.getElementById('landing-login-status').style.display = 'none';
  });
}

(function restoreLandingToken() {
  const token = localStorage.getItem('gtoken');
  const exp = parseInt(localStorage.getItem('gtoken_exp') || '0');
  if (token && Date.now() < exp) {
    landingAccessToken = token;
    showLandingLoggedIn();
  }
})();

document.getElementById('landing-select-file')?.addEventListener('click', () => {
  document.getElementById('landing-file-input').click();
});

document.getElementById('landing-file-input')?.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const progress = document.getElementById('landing-upload-progress');
  progress.style.display = 'block';
  progress.textContent = '등록 중';

  try {
    const driveFileId = await uploadLandingGLB(file);
    progress.textContent = '등록 완료';
    window.location.href = `editor.html?file=${encodeURIComponent(driveFileId)}`;
  } catch (err) {
    console.error(err);
    progress.style.display = 'block';
    progress.textContent = '오류: ' + err.message;
  }
});

async function uploadLandingGLB(file) {
  if (!landingAccessToken) throw new Error('Google 로그인 필요');

  const meta = JSON.stringify({ name: file.name, parents: [CONFIG.DRIVE_FOLDER_ID] });
  const form = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: `Bearer ${landingAccessToken}` }, body: form }
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  const data = await res.json();

  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${landingAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
  });

  return data.id;
}

function getStoredAccessToken() {
  const token = localStorage.getItem('gtoken');
  const exp = parseInt(localStorage.getItem('gtoken_exp') || '0');
  return token && Date.now() < exp ? token : null;
}

function getDriveApiMediaUrl(fileId) {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`;
}

async function fetchDriveBlobUrl(fileId, { validateGlb = true } = {}) {
  const token = getStoredAccessToken();
  if (token) {
    try {
      await assertDriveFileActive(fileId, token);
    } catch (err) {
      console.warn('Drive metadata check skipped', fileId, err);
    }
  }
  const publicAttempt = {
    url: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
    options: {},
    timeout: 12000,
  };
  const attempts = [
    ...(!token ? [publicAttempt] : []),
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media${token ? '' : `&key=${CONFIG.API_KEY}`}`,
      options: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      timeout: 8000,
    },
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`,
      options: {},
      timeout: 8000,
    },
    ...(token ? [publicAttempt] : []),
    {
      url: `https://drive.google.com/uc?export=download&id=${fileId}`,
      options: {},
      timeout: 8000,
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, attempt.options, attempt.timeout || 18000);
      if (!res.ok) throw new Error(`Drive fetch ${res.status}`);
      const blob = await resolveDriveDownload(res, attempt.options);
      if (validateGlb) await assertLikelyGLB(blob);
      return URL.createObjectURL(blob);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Drive fetch failed');
}

async function resolveDriveDownload(response, options = {}) {
  const blob = await response.blob();
  const head = await blob.slice(0, 80).text();
  if (!head.startsWith('<!') && !head.startsWith('<html') && !head.includes('<HTML')) {
    return blob;
  }

  const html = await blob.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const form = doc.querySelector('#download-form, form[action*="download"]');
  if (!form?.action) throw new Error('Drive returned HTML without a download confirmation form');

  const confirmedUrl = new URL(form.action, response.url);
  form.querySelectorAll('input[name]').forEach(input => {
    confirmedUrl.searchParams.set(input.name, input.value);
  });

  const confirmed = await fetchWithTimeout(confirmedUrl.href, options, 60000);
  if (!confirmed.ok) throw new Error(`Drive confirmed fetch ${confirmed.status}`);
  return confirmed.blob();
}

function fetchWithTimeout(url, options = {}, timeout = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { cache: 'no-store', ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function assertDriveFileActive(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=trashed,mimeType${token ? '' : `&key=${CONFIG.API_KEY}`}&cacheBust=${Date.now()}`;
  const options = token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : {};
  const res = await fetchWithTimeout(url, { ...options, cache: 'no-store' }, 4500);
  if (!res.ok) throw new Error(`Drive metadata ${res.status}`);
  const meta = await res.json();
  if (meta.trashed) throw new Error('Drive file is trashed');
}

async function assertLikelyGLB(blob) {
  const head = await blob.slice(0, 80).text();
  if (head.startsWith('glTF') || head.trim().startsWith('{')) return;
  if (head.startsWith('<!') || head.startsWith('<html') || head.includes('<HTML')) {
    throw new Error('Drive returned HTML instead of GLB');
  }
}

document.getElementById('landing-edit-submit')?.addEventListener('click', verifyLandingEditPin);
document.getElementById('landing-edit-pin')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') verifyLandingEditPin();
});

async function verifyLandingEditPin() {
  // UX-04: 랜딩 수정 및 표지 수정 책상 식별 번호 검증 상태 문구
  const input = document.getElementById('landing-edit-pin');
  const progress = document.getElementById('landing-edit-progress');
  const pin = (input.value || '').trim();

  if (!/^\d{4}$/.test(pin)) {
    progress.textContent = '책상 식별 번호 4자리를 입력해주세요.';
    return;
  }

  progress.textContent = '확인 중';

  try {
    const desks = currentDesks.length ? currentDesks : await CMS.fetchDesks();
    const hasAnyEditableDesk = desks.some((item) => item.desk_id);
    if (!hasAnyEditableDesk) {
      progress.textContent = '아직 등록된 책상이 없습니다. 먼저 등록해주세요.';
      return;
    }
    const desk = CMS.findLatestDesk(desks, (item) => {
      const matchesDesk = !pendingLandingEditDeskId || item.desk_id === pendingLandingEditDeskId;
      return matchesDesk && (item.desk_id || '').split('-').pop() === pin;
    });

    if (!desk) {
      progress.textContent = '일치하는 책상을 찾을 수 없습니다.';
      return;
    }

    progress.textContent = '';
    if (pendingLandingEditDeskId && pendingLandingEditMode === 'thumbnail') {
      window.location.href = `editor.html?edit=${encodeURIComponent(desk.desk_id)}&mode=thumbnail`;
      return;
    }
    window.location.href = `editor.html?edit=1&pin=${encodeURIComponent(pin)}`;
  } catch (err) {
    console.error(err);
    progress.textContent = '책상 목록을 불러올 수 없습니다.';
  }
}

// ── Seeded pseudo-random ──
function rand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// ── 상 ──
let currentDesks = [];
let currentVisibleDesks = [];
const thumbViews = [];
const thumbQueue = [];
const noteCountCache = new Map();
let activeThumbLoads = 0;
let hoveredThumbDeskId = null;
const MAX_THUMB_LOADS = 2;
const thumbTooltip = document.createElement('div');
thumbTooltip.id = 'thumb-tooltip';
document.body.appendChild(thumbTooltip);

function enqueueThumbLoad(task) {
  thumbQueue.push(task);
  runNextThumbLoad();
}

function runNextThumbLoad() {
  while (activeThumbLoads < MAX_THUMB_LOADS && thumbQueue.length) {
    const task = thumbQueue.shift();
    activeThumbLoads += 1;
    Promise.resolve()
      .then(task)
      .finally(() => {
        activeThumbLoads -= 1;
        runNextThumbLoad();
      });
  }
}

async function init() {
  setCollectionStatus('loading');
  let desks = [];
  try {
    desks = await CMS.fetchDesks();
  } catch (e) {
    console.warn('Sheets fetch failed', e);
    setCollectionStatus('error');
  }
  currentDesks = desks;
  createThumbs(desks);
  if (!document.body.classList.contains('collection-error')) {
    setCollectionStatus(currentVisibleDesks.length ? 'ready' : 'empty');
  }
  setHeroSize();
  setLandingTail();
  layoutThumbs();
  window.requestAnimationFrame(() => {
    setLandingTail();
    scrollToLandingStart();
  });
}

function setCollectionStatus(state) {
  // UX-01: 랜딩 컬렉션 로딩·빈 상태·오류 문구
  const status = document.getElementById('collection-status');
  document.body.classList.remove('collection-loading', 'collection-empty', 'collection-error');
  if (state === 'loading') {
    document.body.classList.add('collection-loading');
    status.textContent = '책상 목록을 불러오는 중';
  } else if (state === 'empty') {
    document.body.classList.add('collection-empty');
    status.textContent = '아직 등록된 책상이 없습니다.';
  } else if (state === 'error') {
    document.body.classList.add('collection-error');
    status.textContent = '책상 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getStageWidth() {
  if (
    (!page.classList.contains('shifted-left') && !page.classList.contains('shifted-right'))
    || window.innerWidth <= 760
  ) {
    return window.innerWidth;
  }
  const openPanel = performPanel.classList.contains('open') ? performPanel : declarePanel;
  return window.innerWidth - openPanel.getBoundingClientRect().width;
}

function createThumbs(desks) {
  const container = document.getElementById('thumbs');
  container.innerHTML = '';
  thumbViews.length = 0;

  const seenDeskIds = new Set();
  const visibleDesks = [];
  CMS.sortDesksLatest(desks).forEach((desk) => {
    if (!desk.drive_file_id || !desk.desk_id || seenDeskIds.has(desk.desk_id)) return;
    seenDeskIds.add(desk.desk_id);
    visibleDesks.push(desk);
  });
  currentVisibleDesks = visibleDesks;
  document.body.classList.toggle('is-empty-collection', visibleDesks.length === 0);
  visibleDesks.forEach((desk, i) => {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.index = i;
    el.dataset.driveFileId = desk.drive_file_id;
    el.dataset.thumbnailFileId = CMS.getDeskMeta(desk).thumbnail_file_id || '';

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = desk.desk_id;
    el.appendChild(label);

    el.addEventListener('click', async event => {
      if (declarationPrintSelecting) {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector('#print-select-bar span').textContent = '표지를 불러오는 중';
        const source = await getPrintableThumbSource(el);
        if (source) {
          await openPrintOptions(source);
        } else {
          document.querySelector('#print-select-bar span').textContent = '이 표지는 아직 인쇄할 수 없습니다.';
        }
        return;
      }
      window.location.href = `viewer.html?desk=${encodeURIComponent(desk.desk_id)}`;
    });

    el.addEventListener('contextmenu', event => {
      openThumbContextMenu(event, desk.desk_id);
    });

    el.addEventListener('mouseenter', async (event) => {
      hoveredThumbDeskId = desk.desk_id;
      moveThumbTooltip(event);
      showThumbTooltip('기록 확인 중');
      try {
        const count = await getNoteCount(desk.desk_id);
        if (hoveredThumbDeskId !== desk.desk_id) return;
        showThumbTooltip(`${count}개의 기록`);
      } catch (err) {
        console.warn('note count failed', desk.desk_id, err);
        hideThumbTooltip();
      }
    });

    el.addEventListener('mousemove', moveThumbTooltip);
    el.addEventListener('mouseleave', hideThumbTooltip);

    container.appendChild(el);
    thumbViews[i] = renderDeskThumb(el, desk, i);
  });
}

async function getNoteCount(deskId) {
  if (noteCountCache.has(deskId)) return noteCountCache.get(deskId);
  const objects = await CMS.fetchObjects(deskId);
  const count = objects.filter(obj => obj.object_id || obj.name || obj.memory_note).length;
  noteCountCache.set(deskId, count);
  return count;
}

function showThumbTooltip(text) {
  // UX-01: 표지 hover 기록 개수 문구
  thumbTooltip.textContent = text;
  thumbTooltip.style.display = 'block';
}

function hideThumbTooltip() {
  hoveredThumbDeskId = null;
  thumbTooltip.style.display = 'none';
}

function moveThumbTooltip(event) {
  thumbTooltip.style.left = `${event.clientX + 14}px`;
  thumbTooltip.style.top = `${event.clientY + 14}px`;
}

function layoutThumbs() {
  const container = document.getElementById('thumbs');
  const activeViews = thumbViews.filter(Boolean);
  const W = getStageWidth();
  const hasVisibleDesks = currentVisibleDesks.length > 0;
  const count = Math.max(activeViews.length, 1);
  const columns = W >= 920 ? 3 : W >= 620 ? 2 : 1;

  const rows = Math.ceil(count / columns);
  const colGap = clamp(W * 0.045, 42, 96);
  const rowGap = clamp(window.innerHeight * 0.11, 86, 132);
  const bottomGap = clamp(window.innerHeight * 0.02, 18, 32);
  const cellW = (W - colGap * (columns + 1)) / columns;
  const thumbW = Math.max(300, cellW);
  const thumbH = clamp(thumbW * 1.08, 360, 560);
  const H = hasVisibleDesks ? rows * thumbH + (rows - 1) * rowGap + bottomGap : 0;

  container.style.width = `${W}px`;
  container.style.height = `${H}px`;
  if (!hasVisibleDesks) return;

  activeViews.forEach((view, i) => {
    const el = view.container;

    const col = i % columns;
    const row = Math.floor(i / columns);
    const w = thumbW;
    const h = thumbH;
    const x = colGap + col * (cellW + colGap);
    const y = H - bottomGap - h - row * (h + rowGap);
    const rot = (rand(i * 3 + 2) - 0.5) * 5;

    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = `rotate(${rot}deg)`;

    view.resize(w, h);
  });
}

function scrollToLandingStart() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const top = Math.max(0, hero.offsetTop - Math.round(window.innerHeight * 0.08));
  window.scrollTo({ top, left: 0, behavior: 'auto' });
}

function renderDeskThumb(container, desk, index) {
  const deskMeta = CMS.getDeskMeta(desk);
  if (deskMeta.thumbnail_file_id) {
    return renderSavedThumbnail(container, desk, deskMeta, index);
  }
  container.classList.add('loading');

  let renderer = null;
  const scene = new THREE.Scene();
  const aspect = container.clientWidth / container.clientHeight;
  const viewHeight = 2.8;
  const camera = new THREE.OrthographicCamera(
    -viewHeight * aspect / 2,
    viewHeight * aspect / 2,
    viewHeight / 2,
    -viewHeight / 2,
    -10,
    10
  );
  camera.position.set(0, 0.05, 4);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));

  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 3, 4);
  scene.add(key);

  const silhouetteMaterial = new THREE.MeshStandardMaterial({
    color: 0x050505,
    roughness: 0.68,
    metalness: 0.02,
  });
  const originalMaterials = new Map();
  const pivot = new THREE.Group();
  scene.add(pivot);
  let hovered = false;
  let baseScale = 1;
  let radius = 1;
  let retryOnHoverBound = false;

  function updateCamera() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    if (renderer) {
      renderer.setSize(width, height);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    }
    const fitWidth = viewHeight * aspect;
    const fitSize = Math.min(viewHeight, fitWidth) * 0.68;
    baseScale = fitSize / radius;
  }

  const loader = new THREE.GLTFLoader();

  async function loadThumbModel() {
    let blobUrl;
    const token = getStoredAccessToken();
    let sourceUrl;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      container.prepend(renderer.domElement);
      updateCamera();

      sourceUrl = token
        ? await fetchDriveBlobUrl(desk.drive_file_id).then(url => {
            blobUrl = url;
            return url;
          })
        : getDriveApiMediaUrl(desk.drive_file_id);
    } catch (err) {
      console.warn('thumb GLB fetch failed', desk.desk_id, err);
      handleThumbFailure(container, err);
      return;
    }

    loader.load(sourceUrl, (gltf) => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const model = gltf.scene;
      container.classList.remove('failed', 'loading');
      container.style.opacity = '';
      pivot.add(model);
      model.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      radius = Math.max(size.length() / 2, 0.001);

      model.position.sub(center);
      updateCamera();
      pivot.scale.setScalar(baseScale);

      model.traverse((child) => {
        if (!child.isMesh) return;
        originalMaterials.set(child.uuid, child.material);
        child.material = silhouetteMaterial;
      });
    }, undefined, (err) => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      console.warn('thumb GLB failed', desk.desk_id, {
        fileId: desk.drive_file_id,
        status: err?.target?.status,
        statusText: err?.target?.statusText,
        responseUrl: err?.target?.responseURL,
        error: err,
      });
      handleThumbFailure(container, err);
    });
  }

  enqueueThumbLoad(loadThumbModel);

  function handleThumbFailure(el, err) {
    console.warn('Showing failed thumbnail fallback', desk.desk_id, err);
    renderer?.dispose();
    renderer?.domElement.remove();
    renderer = null;
    el.classList.remove('loading');
    el.classList.add('failed');
    if (!retryOnHoverBound) {
      retryOnHoverBound = true;
      el.addEventListener('mouseenter', () => {
        retryOnHoverBound = false;
        enqueueThumbLoad(loadThumbModel);
      }, { once: true });
    }
  }

  container.addEventListener('mouseenter', () => {
    if (declarationPrintSelecting) return;
    hovered = true;
    pivot.traverse((child) => {
      if (child.isMesh && originalMaterials.has(child.uuid)) {
        child.material = originalMaterials.get(child.uuid);
      }
    });
  });

  container.addEventListener('mouseleave', () => {
    hovered = false;
    pivot.rotation.set(0, 0, 0);
    pivot.position.y = 0;
    pivot.traverse((child) => {
      if (child.isMesh) child.material = silhouetteMaterial;
    });
  });

  function animate(t) {
    if (!document.body.contains(container)) return;
    requestAnimationFrame(animate);
    if (pivot.children.length) {
      if (hovered) {
        pivot.rotation.y += 0.004;
      }
      const hoverScale = hovered ? 1.08 : 1;
      pivot.scale.setScalar(baseScale * hoverScale);
    }
    renderer?.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return {
    container,
    desk,
    resize(width, height) {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      updateCamera();
    },
    dispose() {
      renderer?.dispose();
    },
  };
}

window.addEventListener('pagehide', () => {
  thumbViews.forEach(view => view?.dispose?.());
});

function renderSavedThumbnail(container, desk, deskMeta, index) {
  const image = document.createElement('img');
  image.className = 'thumb-image';
  image.alt = '';
  image.src = getDriveApiMediaUrl(deskMeta.thumbnail_file_id);
  container.prepend(image);
  const silhouetteMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
  });

  let renderer = null;
  let camera = null;
  let pivot = null;
  let hovered = false;
  let loading = false;
  let loaded = false;
  let failed = false;
  const originalMaterials = new Map();

  image.addEventListener('error', () => {
    container.classList.add('thumb-image-failed');
    ensure3D();
  });

  function resize(width, height) {
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    if (!renderer || !camera) return;
    renderer.setSize(width, height);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  async function ensure3D() {
    if (loaded || loading || failed) return;
    loading = true;
    container.classList.add('loading-3d');

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.className = 'thumb-3d';
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    const pos = new THREE.Vector3(
      parseFloat(deskMeta.thumb_cam_pos_x) || 0,
      parseFloat(deskMeta.thumb_cam_pos_y) || 0,
      parseFloat(deskMeta.thumb_cam_pos_z) || 0
    );
    const target = new THREE.Vector3(
      parseFloat(deskMeta.thumb_cam_target_x) || 0,
      parseFloat(deskMeta.thumb_cam_target_y) || 0,
      parseFloat(deskMeta.thumb_cam_target_z) || 0
    );
    camera.position.copy(pos);
    camera.lookAt(target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(2, 4, 3);
    scene.add(key);

    resize(container.clientWidth, container.clientHeight);

    try {
      const glbUrl = await fetchDriveBlobUrl(desk.drive_file_id);
      await new Promise((resolve, reject) => {
        new THREE.GLTFLoader().load(glbUrl, gltf => {
          URL.revokeObjectURL(glbUrl);
          const model = gltf.scene;
          model.traverse(child => {
            if (!child.isMesh) return;
            originalMaterials.set(child.uuid, child.material);
            child.material = silhouetteMaterial;
          });
          if (hovered) {
            model.traverse(child => {
              if (child.isMesh && originalMaterials.has(child.uuid)) {
                child.material = originalMaterials.get(child.uuid);
              }
            });
          }
          model.updateMatrixWorld(true);
          const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
          pivot = new THREE.Group();
          pivot.position.copy(center);
          model.position.sub(center);
          pivot.add(model);
          scene.add(pivot);
          loaded = true;
          container.classList.remove('loading-3d');
          if (hovered || container.classList.contains('thumb-image-failed')) {
            container.classList.add('show-3d');
          }
          resolve();
        }, undefined, reject);
      });
    } catch (err) {
      console.warn('hover GLB failed', desk.desk_id, err);
      failed = true;
      container.classList.remove('loading-3d');
      container.classList.add('failed');
      renderer.domElement.remove();
      renderer.dispose();
      renderer = null;
      camera = null;
    }

    function animate(t) {
      if (!document.body.contains(container) || failed) return;
      requestAnimationFrame(animate);
      if (hovered && pivot) pivot.rotation.y += 0.004;
      renderer?.render(scene, camera);
    }
    requestAnimationFrame(animate);
  }

  container.addEventListener('mouseenter', () => {
    if (declarationPrintSelecting) return;
    hovered = true;
    ensure3D();
    pivot?.traverse(child => {
      if (child.isMesh && originalMaterials.has(child.uuid)) {
        child.material = originalMaterials.get(child.uuid);
      }
    });
    if (loaded) container.classList.add('show-3d');
  });
  container.addEventListener('mouseleave', () => {
    hovered = false;
    pivot?.rotation.set(0, 0, 0);
    pivot?.traverse(child => {
      if (child.isMesh) child.material = silhouetteMaterial;
    });
    container.classList.remove('show-3d');
  });

  return {
    container,
    desk,
    resize,
    dispose() {
      renderer?.dispose();
    },
  };
}

init();
