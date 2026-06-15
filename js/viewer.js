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
  try {
    await assertDriveFileActive(fileId, token);
  } catch (err) {
    console.warn('Drive metadata check skipped', fileId, err);
  }
  const publicAttempt = {
    url: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
    options: {},
    timeout: 60000,
  };
  const attempts = [
    ...(!token ? [publicAttempt] : []),
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media${token ? '' : `&key=${CONFIG.API_KEY}`}`,
      options: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    },
    {
      url: `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`,
      options: {},
    },
    ...(token ? [publicAttempt] : []),
    {
      url: `https://drive.google.com/uc?export=download&id=${fileId}`,
      options: {},
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, attempt.options, attempt.timeout || 4500);
      if (!res.ok) throw new Error(`Drive fetch ${res.status}`);
      const blob = await resolveDriveDownload(res, attempt.options);
      await assertLikelyGLB(blob);
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
const occlusionRaycaster = new THREE.Raycaster();
let hoveredMarker = null;
let pointerX = -10000;
let pointerY = -10000;
let pointerInside = false;
const MARKER_REVEAL_RADIUS = 130;
const modelMeshes = [];

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

// ── Flat note marker (shared texture) ──
function makeMarkerTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const inset = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 10;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = '#111111';
  ctx.font = '700 142px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', size / 2, size / 2 + 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const markerTexture = makeMarkerTexture();
const MARKER_BASE_SCALE = 0.032;

// ── Load desk ──
async function init() {
  // UX-06: 탐색 정보 및 3D 파일 로딩·오류 문구
  let desk, objects;
  try {
    const desks = await CMS.fetchDesks();
    desk = CMS.findLatestDesk(desks, d => d.desk_id === deskId);
    objects = await CMS.fetchObjects(deskId);
  } catch (e) {
    console.error(e);
    showError('정보를 불러올 수 없습니다');
    return;
  }

  if (!desk) {
    showError('등록된 책상 정보를 찾을 수 없습니다');
    return;
  }

  if (!desk.drive_file_id) {
    showError('3D 파일이 연결되지 않았습니다');
    return;
  }

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
    showLoading('책상을 불러오는 중');
    const glbUrl = await fetchDriveBlobUrl(desk.drive_file_id);
    const loader = new THREE.GLTFLoader();
    loader.load(glbUrl, (gltf) => {
      URL.revokeObjectURL(glbUrl);
      scene.add(gltf.scene);
      gltf.scene.traverse(child => {
        if (child.isMesh) modelMeshes.push(child);
      });
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
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    }));
    marker.position.set(x, y, z);
    marker.scale.setScalar(MARKER_BASE_SCALE);
    marker.userData.obj = obj;
    scene.add(marker);
    markers.push(marker);
  });
}

// ── Panel content ──
function renderPanelInfo(desk, objects) {
  document.getElementById('panel-desk-info').textContent = '';
  showPanelObject(null);

  // Edit 버튼 항상 표시 — 책상 식별 번호 검증 후 허용
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
  // UX-07: 기록 탐색 전 안내와 선택된 기록 표시
  const container = document.getElementById('panel-objects');
  if (!obj) {
    document.getElementById('panel-desk-info').textContent = '사물 위에 커서를 올려보세요.';
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
  pointerX = e.clientX;
  pointerY = e.clientY;
  pointerInside = true;
  if (isDragging || !markers.length) return;
  const nearestMarker = findNearestMarker()?.marker || null;
  if (!nearestMarker || nearestMarker === hoveredMarker) return;
  hoveredMarker = nearestMarker;
  showPanelObject(hoveredMarker.userData.obj);
  panel.classList.add('open');
});

canvas.addEventListener('mouseleave', () => {
  pointerInside = false;
  hoveredMarker = null;
});

function findNearestMarker() {
  if (!pointerInside) return null;
  const candidates = [];
  markers.forEach(marker => {
    const projected = marker.position.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) return;
    const x = (projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * innerHeight;
    const distance = Math.hypot(pointerX - x, pointerY - y);
    if (distance <= MARKER_REVEAL_RADIUS) candidates.push({ marker, distance });
  });
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.find(candidate => !isMarkerOccluded(candidate.marker)) || null;
}

function isMarkerOccluded(marker) {
  if (!modelMeshes.length) return false;
  const direction = marker.position.clone().sub(camera.position);
  const distance = direction.length();
  if (!distance) return false;
  occlusionRaycaster.set(camera.position, direction.normalize());
  occlusionRaycaster.far = Math.max(0, distance - 0.03);
  return occlusionRaycaster.intersectObjects(modelMeshes, false).length > 0;
}

function updateMarkerProximity() {
  const nearest = findNearestMarker();
  markers.forEach(marker => {
    const distance = nearest?.marker === marker ? nearest.distance : Infinity;
    const proximity = Math.max(0, 1 - distance / MARKER_REVEAL_RADIUS);
    marker.material.opacity = proximity > 0 ? 1 : 0;
    marker.scale.setScalar(MARKER_BASE_SCALE);
  });
}

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
  updateMarkerProximity();
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
  // UX-06: Drive 파일 오류 및 Google 재로그인 문구
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

// ── Edit 책상 식별 번호 검증 ──
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
  // UX-08: 기록 수정·시점 재설정 책상 식별 번호 검증과 이동
  const pin = editPinInput.value.trim();
  if (!pin) return;
  const storedPin = deskId.split('-').pop();
  if (pin.padStart(4, '0') !== storedPin) {
    document.getElementById('viewer-edit-error').textContent = '책상 식별 번호가 일치하지 않습니다.';
    return;
  }

  const query = mode === 'points' ? '&mode=points' : '&mode=view';
  location.href = `editor.html?edit=${encodeURIComponent(deskId)}${query}`;
}

document.getElementById('btn-edit-points').addEventListener('click', () => startEdit('points'));
document.getElementById('btn-edit-full').addEventListener('click', () => startEdit('full'));

init();
