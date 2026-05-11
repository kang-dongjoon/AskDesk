if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// ── Hero title: monitor 기준 크기 유지 ──
function setHeroSize() {
  const el = document.querySelector('.hero');
  if (!el) return;
  const base = Math.round((window.screen?.height || window.innerHeight) * 0.24);
  const size = clamp(base, 220, 330);
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
  const thumbTitleGap = Math.round(clamp(window.innerHeight * 0.28, 240, 340));
  const thumbAreaHeight = Math.max(1100, window.innerHeight * 1.45);

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
const panel   = document.getElementById('panel');
const page    = document.getElementById('page');
const btnDesk = document.getElementById('nav-desk');
let landingAccessToken = null;

btnDesk.addEventListener('click', () => {
  const open = panel.classList.toggle('open');
  page.classList.toggle('shifted', open);
  setHeroSize();
  window.setTimeout(() => {
    setLandingTail();
    layoutThumbs();
  }, 20);
});

window.addEventListener('resize', layoutThumbs);

// ── Landing upload popup ──
const uploadModal = document.getElementById('upload-modal');
const btnOpenUpload = document.getElementById('btn-open-upload');
const btnCloseUpload = document.getElementById('btn-close-upload');
const editModal = document.getElementById('edit-modal');
const btnOpenEdit = document.getElementById('btn-open-edit');
const btnCloseEdit = document.getElementById('btn-close-edit');

btnOpenUpload?.addEventListener('click', () => {
  uploadModal.classList.add('open');
  uploadModal.setAttribute('aria-hidden', 'false');
});

btnCloseUpload?.addEventListener('click', closeUploadModal);
uploadModal?.addEventListener('click', (event) => {
  if (event.target === uploadModal) closeUploadModal();
});

btnOpenEdit?.addEventListener('click', () => {
  editModal.classList.add('open');
  editModal.setAttribute('aria-hidden', 'false');
  document.getElementById('landing-edit-pin')?.focus();
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
}

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
  progress.textContent = '업로드 중...';

  try {
    const driveFileId = await uploadLandingGLB(file);
    progress.textContent = '업로드 완료. 에디터로 이동 중...';
    window.location.href = `editor.html?file=${encodeURIComponent(driveFileId)}`;
  } catch (err) {
    console.error(err);
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

async function fetchDriveBlobUrl(fileId) {
  const token = getStoredAccessToken();
  try {
    await assertDriveFileActive(fileId, token);
  } catch (err) {
    console.warn('Drive metadata check skipped', fileId, err);
  }
  const attempts = [
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media${token ? '' : `&key=${CONFIG.API_KEY}`}`,
      options: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    },
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`,
      options: {},
    },
    {
      url: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
      options: {},
    },
    {
      url: `https://drive.google.com/uc?export=download&id=${fileId}`,
      options: {},
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, attempt.options, 18000);
      if (!res.ok) throw new Error(`Drive fetch ${res.status}`);
      const blob = await res.blob();
      await assertLikelyGLB(blob);
      return URL.createObjectURL(blob);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Drive fetch failed');
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
  const input = document.getElementById('landing-edit-pin');
  const progress = document.getElementById('landing-edit-progress');
  const pin = (input.value || '').trim();

  if (!/^\d{4}$/.test(pin)) {
    progress.textContent = '편집을 위한 비밀번호 4자리를 입력해주세요.';
    return;
  }

  progress.textContent = '확인 중...';

  try {
    const desks = currentDesks.length ? currentDesks : await CMS.fetchDesks();
    const hasAnyEditableDesk = desks.some((item) => item.desk_id);
    if (!hasAnyEditableDesk) {
      progress.textContent = '아직 등록된 책상이 없습니다. 먼저 업로드해주세요.';
      return;
    }
    const desk = desks.slice().reverse().find((item) => {
      return (item.desk_id || '').split('-').pop() === pin;
    });

    if (!desk) {
      progress.textContent = '일치하는 책상을 찾을 수 없습니다.';
      return;
    }

    progress.textContent = '에디터로 이동 중...';
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

// ── Thumbnails ──
let currentDesks = [];
let currentVisibleDesks = [];
const thumbViews = [];
const thumbQueue = [];
let activeThumbLoads = 0;
const MAX_THUMB_LOADS = 2;

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
  let desks = [];
  try { desks = await CMS.fetchDesks(); } catch (e) { console.warn('Sheets fetch failed', e); }
  currentDesks = desks;
  createThumbs(desks);
  setHeroSize();
  setLandingTail();
  layoutThumbs();
  window.requestAnimationFrame(() => {
    setLandingTail();
    scrollToLandingStart();
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getStageWidth() {
  if (!page.classList.contains('shifted') || window.innerWidth <= 760) {
    return window.innerWidth;
  }
  return window.innerWidth - panel.getBoundingClientRect().width;
}

function createThumbs(desks) {
  const container = document.getElementById('thumbs');
  container.innerHTML = '';
  thumbViews.length = 0;

  const seenDeskIds = new Set();
  const visibleDesks = [];
  desks.slice().reverse().forEach((desk) => {
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

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = desk.desk_id;
    el.appendChild(label);

    el.addEventListener('click', () => {
      window.location.href = `viewer.html?desk=${encodeURIComponent(desk.desk_id)}`;
    });

    container.appendChild(el);
    thumbViews[i] = renderDeskThumb(el, desk, i);
  });
}

function layoutThumbs() {
  const container = document.getElementById('thumbs');
  const activeViews = thumbViews.filter(Boolean);
  const W = getStageWidth();
  const hasVisibleDesks = currentVisibleDesks.length > 0;
  const H = hasVisibleDesks ? getLandingMetrics().thumbAreaHeight : 0;
  const count = Math.max(activeViews.length, 1);
  const columns = W >= 920 ? 3 : W >= 620 ? 2 : 1;

  const rows = Math.ceil(count / columns);
  const gap = clamp(W * 0.045, 42, 96);
  const cellW = (W - gap * (columns + 1)) / columns;
  const cellH = (H - gap * (rows + 1)) / rows;

  container.style.width = `${W}px`;
  container.style.height = `${H}px`;
  if (!hasVisibleDesks) return;

  activeViews.forEach((view, i) => {
    const el = view.container;

    const col = i % columns;
    const row = Math.floor(i / columns);
    const w = Math.max(280, cellW);
    const h = Math.max(320, cellH);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
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
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(1, 1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.prepend(renderer.domElement);

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

  function updateCamera() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    camera.left = -viewHeight * aspect / 2;
    camera.right = viewHeight * aspect / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
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
    container.classList.remove('failed');
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
      console.warn('thumb GLB failed', desk.desk_id, err);
      handleThumbFailure(container, err);
    });
  }

  enqueueThumbLoad(loadThumbModel);

  function handleThumbFailure(el, err) {
    console.warn('Dropping failed thumbnail', desk.desk_id, err);
    dropThumbView(el);
  }

  function dropThumbView(el) {
    const idx = thumbViews.findIndex(view => view?.container === el);
    if (idx >= 0) thumbViews[idx] = null;
    el.remove();
    window.requestAnimationFrame(layoutThumbs);
  }

  container.addEventListener('mouseenter', () => {
    hovered = true;
    pivot.traverse((child) => {
      if (child.isMesh && originalMaterials.has(child.uuid)) {
        child.material = originalMaterials.get(child.uuid);
      }
    });
  });

  container.addEventListener('mouseleave', () => {
    hovered = false;
    pivot.traverse((child) => {
      if (child.isMesh) child.material = silhouetteMaterial;
    });
  });

  function animate(t) {
    if (!document.body.contains(container)) return;
    requestAnimationFrame(animate);
    if (pivot.children.length) {
      pivot.rotation.y = t * 0.00018 + index * 0.7;
      pivot.rotation.x = -0.22 + Math.sin(t * 0.001 + index) * 0.035;
      pivot.position.y = Math.sin(t * 0.0012 + index * 1.3) * 0.08;
      const hoverScale = hovered ? 1.08 : 1;
      const floatScale = 1 + Math.sin(t * 0.001 + index) * 0.012;
      pivot.scale.setScalar(baseScale * hoverScale * floatScale);
    }
    renderer.render(scene, camera);
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
  };
}

init();
