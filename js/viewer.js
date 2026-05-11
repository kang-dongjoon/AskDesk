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

// ── State ──
let savedPos    = new THREE.Vector3();
let savedTarget = new THREE.Vector3();
let markers     = [];
let isDragging  = false;
let lastX = 0, lastY = 0;
let yaw = 0, pitch = 0;
const PITCH_LIMIT = 0.4;
const V_RANGE     = 0.05; // 위아래 이동 범위 (m)
let vertOffset    = 0;
let lastPinchDist = null;

// ── Panel ──
const panel  = document.getElementById('viewer-panel');
const btnAsk = document.getElementById('btn-ask');
btnAsk.addEventListener('click', () => panel.classList.toggle('open'));

// ── Marker geometry (shared) ──
const markerGeo = new THREE.SphereGeometry(0.006, 12, 12);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

// ── Load desk ──
async function init() {
  let desk, objects;
  try {
    const desks = await CMS.fetchDesks();
    desk = desks.find(d => d.desk_id === deskId);
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

  applyCamera();
  renderPanelInfo(desk, objects);

  // load GLB from Drive
  const glbUrl = `https://www.googleapis.com/drive/v3/files/${desk.drive_file_id}?alt=media&key=${CONFIG.API_KEY}`;
  const loader = new THREE.GLTFLoader();
  loader.load(glbUrl, (gltf) => {
    scene.add(gltf.scene);
    placeMarkers(objects);
    hideLoading();
  }, undefined, (err) => {
    console.error(err);
    showError('3D 파일을 불러올 수 없습니다');
  });
}

// ── Place object markers ──
function placeMarkers(objects) {
  objects.forEach(obj => {
    const x = parseFloat(obj.x), y = parseFloat(obj.y), z = parseFloat(obj.z);
    if (isNaN(x)) return;
    const mesh = new THREE.Mesh(markerGeo, markerMat.clone());
    mesh.position.set(x, y, z);
    mesh.userData.obj = obj;
    scene.add(mesh);
    markers.push(mesh);
  });
}

// ── Panel content ──
function renderPanelInfo(desk, objects) {
  document.getElementById('panel-desk-info').textContent = desk.owner || '';

  const container = document.getElementById('panel-objects');
  objects.forEach(obj => {
    // 이름 행
    const rowName = document.createElement('div');
    rowName.className = 'obj-row';
    rowName.innerHTML = `
      <div class="obj-row-label">name</div>
      <div class="obj-row-value">${obj.name || ''}</div>
    `;
    // 날짜 행
    const rowDate = document.createElement('div');
    rowDate.className = 'obj-row';
    rowDate.innerHTML = `
      <div class="obj-row-label">date</div>
      <div class="obj-row-value">${obj.collected_date || ''}</div>
    `;
    // 메모 행 (full-width)
    const rowMemo = document.createElement('div');
    rowMemo.className = 'obj-row-memo';
    rowMemo.textContent = obj.memory_note || '';

    container.appendChild(rowName);
    container.appendChild(rowDate);
    if (obj.memory_note) container.appendChild(rowMemo);
  });

  // Edit 버튼 항상 표시 — PIN 검증 후 허용
  document.getElementById('btn-edit').style.display = 'inline-block';
}

// ── Camera ──
function applyCamera() {
  camera.position.copy(savedPos);
  camera.position.y += vertOffset;

  const forward = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(camera.position.clone().add(forward));
}

// ── Mouse / Touch controls ──
const canvas = renderer.domElement;

canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
canvas.addEventListener('mouseup',   () => isDragging = false);
canvas.addEventListener('mouseleave',() => isDragging = false);

canvas.addEventListener('mousemove', e => {
  if (!isDragging) return;
  yaw   -= (e.clientX - lastX) / innerWidth  * 2.0;
  pitch += (e.clientY - lastY) / innerHeight * 1.2;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  lastX  = e.clientX;
  lastY  = e.clientY;
  applyCamera();
});

// 수직 스크롤 → 카메라 약간 위아래
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  vertOffset = Math.max(-V_RANGE, Math.min(V_RANGE, vertOffset - e.deltaY * 0.0002));
  applyCamera();
}, { passive: false });

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
      vertOffset = Math.max(-V_RANGE, Math.min(V_RANGE, vertOffset + (dist - lastPinchDist) * 0.0003));
      applyCamera();
    }
    lastPinchDist = dist;
    return;
  }
  lastPinchDist = null;
  if (!isDragging) return;
  yaw   -= (e.touches[0].clientX - lastTX) / innerWidth  * 2.0;
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
  renderer.render(scene, camera);
})();

// ── Loading ──
function hideLoading() {
  const el = document.getElementById('loading');
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 700);
}
function showError(msg) {
  document.getElementById('loading').textContent = msg;
}

// ── Edit PIN 검증 ──
document.getElementById('btn-edit').addEventListener('click', () => {
  const pin = prompt('편집 비밀번호 4자리를 입력하세요.');
  if (!pin) return;
  const storedPin = deskId.split('-').pop();
  if (pin.padStart(4, '0') === storedPin) {
    location.href = `editor.html?edit=${encodeURIComponent(deskId)}`;
  } else {
    alert('비밀번호가 일치하지 않습니다.');
  }
});

init();
