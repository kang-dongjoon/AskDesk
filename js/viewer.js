// ── URL param ──
const params  = new URLSearchParams(location.search);
const deskId  = params.get('desk');
if (!deskId) location.href = 'index.html';

// ── Renderer ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(2, 4, 3);
scene.add(dir);

function getStoredAccessToken() {
  const token = localStorage.getItem('gtoken');
  const exp = parseInt(localStorage.getItem('gtoken_exp') || '0');
  return token && Date.now() < exp ? token : null;
}

async function fetchDriveBlobUrl(fileId) {
  const token = getStoredAccessToken();
  await assertDriveFileActive(fileId, token);
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
      const res = await fetchWithTimeout(attempt.url, attempt.options, 4500);
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

// ── State ──
let savedPos    = new THREE.Vector3();
let savedTarget = new THREE.Vector3();
let markers     = [];
let isDragging  = false;
let lastX = 0, lastY = 0;
let yaw = 0, pitch = 0;
const PITCH_LIMIT = 0.4;
const V_RANGE     = 0.175; // 위아래 이동 범위 (m)
const V_SPEED     = 0.0036;
let vertOffset    = 0;
let lastPinchDist = null;
let zoomOffset = 0;
let targetZoomOffset = 0;
let maxZoomOffset = 0.5;
const verticalKeys = { down: false, up: false };
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredMarker = null;

function isTextInputActive() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

// ── Panel ──
const panel  = document.getElementById('viewer-panel');
const btnAsk = document.getElementById('btn-ask');
btnAsk.addEventListener('click', () => panel.classList.toggle('open'));

// ── Marker geometry (shared) ──
const markerGeo = new THREE.SphereGeometry(0.07, 16, 16);
const markerMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

// ── Load desk ──
async function init() {
  let desk, objects;
  try {
    const desks = await CMS.fetchDesks();
    desk = desks.slice().reverse().find(d => d.desk_id === deskId);
    objects = await CMS.fetchObjects(deskId);
  } catch (e) {
    console.error(e);
    showError('데이터를 불러올 수 없습니다');
    return;
  }

  if (!desk) { showError('책상을 찾을 수 없습니다'); return; }

  // camera saved position
  savedPos.set(
    parseFloat(desk.cam_pos_x)    || 0,
    parseFloat(desk.cam_pos_y)    || 0,
    parseFloat(desk.cam_pos_z)    || 0
  );
  savedTarget.set(
    parseFloat(desk.cam_target_x) || 0,
    parseFloat(desk.cam_target_y) || 0,
    parseFloat(desk.cam_target_z) || 0
  );

  // init yaw/pitch from saved look direction
  const dir = savedTarget.clone().sub(savedPos).normalize();
  yaw   = Math.atan2(dir.x, dir.z);
  pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  maxZoomOffset = Math.max(0.08, savedTarget.distanceTo(savedPos) * 0.5);

  applyCamera();
  renderPanelInfo(desk, objects);

  try {
    showLoading('3D 파일을 불러오는 중...');
    const glbUrl = await fetchDriveBlobUrl(desk.drive_file_id);
    showLoading('3D 파일을 여는 중...');
    const loader = new THREE.GLTFLoader();
    loader.load(glbUrl, (gltf) => {
      URL.revokeObjectURL(glbUrl);
      scene.add(gltf.scene);
      placeMarkers(objects);
      hideLoading();
    }, undefined, (err) => {
      URL.revokeObjectURL(glbUrl);
      console.error(err);
      showDriveLoginError('3D 파일을 불러올 수 없습니다');
    });
  } catch (err) {
    console.error(err);
    showDriveLoginError('3D 파일을 불러올 수 없습니다');
  }
}

// ── Place object markers ──
function placeMarkers(objects) {
  objects.forEach(obj => {
    const x = parseFloat(obj.x), y = parseFloat(obj.y), z = parseFloat(obj.z);
    if ([x, y, z].some(Number.isNaN)) return;
    const mesh = new THREE.Mesh(markerGeo, markerMat.clone());
    mesh.position.set(x, y, z);
    mesh.userData.obj = obj;
    scene.add(mesh);
    markers.push(mesh);
  });
}

// ── Panel content ──
function renderPanelInfo(desk, objects) {
  document.getElementById('panel-desk-info').textContent = '';
  showPanelObject(null);

  // Edit 버튼 항상 표시 — PIN 검증 후 허용
  document.getElementById('btn-edit').style.display = 'inline-block';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[ch]));
}

function showPanelObject(obj) {
  const container = document.getElementById('panel-objects');
  if (!obj) {
    document.getElementById('panel-desk-info').textContent = '사물 위에 커서를 올리세요.';
    container.innerHTML = '';
    return;
  }
  document.getElementById('panel-desk-info').textContent = obj.name || '이름 없음';
  container.innerHTML = `
    <div class="viewer-object-detail">
      ${obj.collected_date ? `<div class="viewer-object-date">${escapeHtml(obj.collected_date)}</div>` : ''}
      ${obj.memory_note ? `<div class="viewer-object-memo">${escapeHtml(obj.memory_note)}</div>` : ''}
    </div>
  `;
}

// ── Camera ──
function applyCamera() {
  const forward = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );
  camera.position.copy(savedPos);
  camera.position.y += vertOffset;
  camera.position.addScaledVector(forward, zoomOffset);
  camera.lookAt(camera.position.clone().add(forward));
}

// ── Mouse / Touch controls ──
const canvas = renderer.domElement;

canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
canvas.addEventListener('mouseup',   () => isDragging = false);
canvas.addEventListener('mouseleave',() => isDragging = false);

canvas.addEventListener('mousemove', e => {
  if (!isDragging) return;
  yaw   += (e.clientX - lastX) / innerWidth  * 2.0;
  pitch += (e.clientY - lastY) / innerHeight * 1.2;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  lastX  = e.clientX;
  lastY  = e.clientY;
  applyCamera();
});

canvas.addEventListener('mousemove', e => {
  if (isDragging || !markers.length) return;

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const hit = raycaster.intersectObjects(markers, false)[0]?.object || null;
  if (!hit || hit === hoveredMarker) return;
  hoveredMarker = hit;
  showPanelObject(hit.userData.obj);
  panel.classList.add('open');
});

// 스크롤 → 부드러운 줌 인/아웃
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  targetZoomOffset = Math.max(0, Math.min(maxZoomOffset, targetZoomOffset - e.deltaY * maxZoomOffset * 0.0012));
}, { passive: false });

document.addEventListener('keydown', e => {
  if (isTextInputActive()) return;
  if (e.code === 'KeyQ' || e.key.toLowerCase() === 'q') {
    e.preventDefault();
    verticalKeys.down = true;
  } else if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
    e.preventDefault();
    verticalKeys.up = true;
  }
}, true);

document.addEventListener('keyup', e => {
  if (isTextInputActive()) {
    verticalKeys.down = false;
    verticalKeys.up = false;
    return;
  }
  if (e.code === 'KeyQ' || e.key.toLowerCase() === 'q') {
    verticalKeys.down = false;
  } else if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
    verticalKeys.up = false;
  }
}, true);

// touch
let lastTX = 0, lastTY = 0;
canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    lastTX = e.touches[0].clientX;
    lastTY = e.touches[0].clientY;
  }
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    // pinch → vertical
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (lastPinchDist !== null) {
      targetZoomOffset = Math.max(0, Math.min(maxZoomOffset, targetZoomOffset + (dist - lastPinchDist) * maxZoomOffset * 0.003));
    }
    lastPinchDist = dist;
    return;
  }
  lastPinchDist = null;
  if (!isDragging) return;
  yaw   += (e.touches[0].clientX - lastTX) / innerWidth  * 2.0;
  pitch += (e.touches[0].clientY - lastTY) / innerHeight * 1.2;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  lastTX = e.touches[0].clientX;
  lastTY = e.touches[0].clientY;
  applyCamera();
}, { passive: true });

canvas.addEventListener('touchend', () => { isDragging = false; lastPinchDist = null; });

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── Render loop ──
(function loop() {
  requestAnimationFrame(loop);
  if (verticalKeys.down || verticalKeys.up) {
    const direction = (verticalKeys.up ? 1 : 0) - (verticalKeys.down ? 1 : 0);
    vertOffset = Math.max(-V_RANGE, Math.min(V_RANGE, vertOffset + direction * V_SPEED));
    applyCamera();
  }
  zoomOffset += (targetZoomOffset - zoomOffset) * 0.09;
  if (Math.abs(targetZoomOffset - zoomOffset) > 0.0001) applyCamera();
  renderer.render(scene, camera);
})();

// ── Loading ──
function showLoading(msg) {
  const el = document.getElementById('loading');
  if (el) el.textContent = msg;
}

function hideLoading() {
  const el = document.getElementById('loading');
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 700);
}
function showError(msg) {
  document.getElementById('loading').textContent = msg;
}

function showDriveLoginError(msg) {
  const el = document.getElementById('loading');
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px;">
      <span>${msg}</span>
      <button class="nav-btn" id="btn-viewer-google-login">Google로 다시 불러오기</button>
    </div>
  `;
  document.getElementById('btn-viewer-google-login').addEventListener('click', () => {
    if (!window.google?.accounts?.oauth2) {
      showError('Google 로그인을 아직 준비하지 못했습니다');
      return;
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: (res) => {
        if (res.error) {
          showError('Google 로그인에 실패했습니다');
          return;
        }
        localStorage.setItem('gtoken', res.access_token);
        localStorage.setItem('gtoken_exp', Date.now() + (res.expires_in - 60) * 1000);
        location.reload();
      },
    });
    client.requestAccessToken();
  });
}

// ── Edit PIN 검증 ──
const editModal = document.getElementById('viewer-edit-modal');
const editPinInput = document.getElementById('viewer-edit-pin');

document.getElementById('btn-edit').addEventListener('click', () => {
  editModal.classList.add('open');
  editPinInput.value = '';
  editPinInput.focus();
});

document.getElementById('btn-viewer-edit-close').addEventListener('click', () => {
  editModal.classList.remove('open');
});

function startEdit(mode) {
  const pin = editPinInput.value.trim();
  if (!pin) return;
  const storedPin = deskId.split('-').pop();
  if (pin.padStart(4, '0') !== storedPin) {
    document.getElementById('viewer-edit-error').textContent = '비밀번호가 일치하지 않습니다.';
    return;
  }

  const query = mode === 'points' ? '&mode=points' : '';
  location.href = `editor.html?edit=${encodeURIComponent(deskId)}${query}`;
}

document.getElementById('btn-edit-points').addEventListener('click', () => startEdit('points'));
document.getElementById('btn-edit-full').addEventListener('click', () => startEdit('full'));

init();
