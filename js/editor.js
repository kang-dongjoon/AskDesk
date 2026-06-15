// ── State ──
let accessToken  = null;
let driveFileId  = null;
let savedPos     = null;
let savedTarget  = null;
let thumbnailFileId = null;
let thumbnailPos = null;
let thumbnailTarget = null;
let pendingPoint = null;   // {position, marker}
const points     = [];     // [{position, meta, marker}]
const deletedPoints = [];
const params     = new URLSearchParams(location.search);
const isEditMode = params.has('edit');
const editStartMode = params.get('mode');
const initialDriveFileId = params.get('file');
const initialEditPin = params.get('pin');
let editDeskId   = params.get('edit');
let editDesk     = null;
let editObjects  = [];
let currentStep  = 'upload';
const originalModelMaterials = new Map();
const thumbnailCaptureAspect = 800 / 864;
const modelCenter = new THREE.Vector3();
const modelBox = new THREE.Box3();
const thumbnailSilhouetteMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  side: THREE.DoubleSide,
});

// ── Three.js setup ──
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
// cssText 대신 개별 적용 — Three.js가 setSize로 잡아준 width/height 유지
Object.assign(renderer.domElement.style, { position:'fixed', top:'0', left:'0', zIndex:'0' });
document.body.prepend(renderer.domElement);

const scene  = new THREE.Scene();
const editorBackground = new THREE.Color(0x111111);
const thumbnailBackground = new THREE.Color(0xffffff);
scene.background = editorBackground;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 1, 2);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(2, 4, 3);
scene.add(dirLight);

// ── OrbitControls (시점 설정 단계) ──
const orbit = new THREE.OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.rotateSpeed = 1;
orbit.enabled = false;

// ── Look-only mode (포인트 지정 단계) ──
let lookMode = false;
let lookYaw = 0, lookPitch = 0;
let lookDrag = false, lookLX = 0, lookLY = 0;
let downX = 0, downY = 0, movedPx = 0;
let lookBaseY = 0;
let lookVertOffset = 0;
let orbitVertOffset = 0;
const LOOK_VERTICAL_SPEED = 0.003;
const LOOK_VERTICAL_RANGE = 0.175;
const lookVerticalKeys = { down: false, up: false };
let editingPoint = null;

function isTextInputActive() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

renderer.domElement.addEventListener('mousedown', e => {
  if (!lookMode) return;
  lookDrag = true;
  lookLX = e.clientX; lookLY = e.clientY;
  downX  = e.clientX; downY  = e.clientY;
  movedPx = 0;
});
renderer.domElement.addEventListener('mouseup', e => {
  if (!lookDrag) return;
  lookDrag = false;
  if (movedPx < 5) placePoint(e);
});
renderer.domElement.addEventListener('mouseleave', () => lookDrag = false);
renderer.domElement.addEventListener('mousemove', e => {
  if (!lookMode || !lookDrag) return;
  const rect = renderer.domElement.getBoundingClientRect();
  movedPx   = Math.hypot(e.clientX - downX, e.clientY - downY);
  lookYaw  += (e.clientX - lookLX) / rect.width  * 2.5;
  lookPitch += (e.clientY - lookLY) / rect.height * 2.0;
  lookPitch  = Math.max(-1.4, Math.min(1.4, lookPitch));
  lookLX = e.clientX; lookLY = e.clientY;
  applyLook();
});

function applyLook() {
  camera.position.y = lookBaseY + lookVertOffset;
  const fwd = new THREE.Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch)
  );
  camera.lookAt(camera.position.clone().add(fwd));
}

document.addEventListener('keydown', e => {
  if (isTextInputActive()) return;
  if (!lookMode && (!orbit.enabled || currentStep === 'thumbnail')) return;
  if (e.code === 'KeyQ' || e.key.toLowerCase() === 'q') {
    e.preventDefault();
    lookVerticalKeys.down = true;
  } else if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
    e.preventDefault();
    lookVerticalKeys.up = true;
  }
}, true);

document.addEventListener('keyup', e => {
  if (isTextInputActive()) {
    lookVerticalKeys.down = false;
    lookVerticalKeys.up = false;
    return;
  }
  if (e.code === 'KeyQ' || e.key.toLowerCase() === 'q') {
    lookVerticalKeys.down = false;
  } else if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
    lookVerticalKeys.up = false;
  }
}, true);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function loop() {
  requestAnimationFrame(loop);
  if (lookVerticalKeys.down || lookVerticalKeys.up) {
    const direction = (lookVerticalKeys.up ? 1 : 0) - (lookVerticalKeys.down ? 1 : 0);
    if (lookMode) {
      lookVertOffset = Math.max(-LOOK_VERTICAL_RANGE, Math.min(LOOK_VERTICAL_RANGE, lookVertOffset + direction * LOOK_VERTICAL_SPEED));
      applyLook();
    } else if (orbit.enabled) {
      const nextOffset = Math.max(-LOOK_VERTICAL_RANGE, Math.min(LOOK_VERTICAL_RANGE, orbitVertOffset + direction * LOOK_VERTICAL_SPEED));
      const delta = nextOffset - orbitVertOffset;
      orbitVertOffset = nextOffset;
      camera.position.y += delta;
      orbit.target.y += delta;
    }
  }
  if (orbit.enabled) orbit.update();
  renderer.render(scene, camera);
})();

// ── Step helpers ──
function setStep(name) {
  // UX-09~14: 등록 단계별 표시 문구와 버튼명
  currentStep = name;
  set상Preview(name === 'thumbnail');
  orbit.enableZoom = name !== 'thumbnail';
  orbit.enablePan = name !== 'thumbnail';
  document.getElementById('step-upload').style.display = 'none';
  ['step-viewpoint','step-points','step-thumbnail','step-submit'].forEach(id => {
    const step = document.getElementById(id);
    step.style.display = 'none';
    step.classList.remove('status-only');
  });
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('step-indicator').textContent = '';
  lookMode = false;

  if (name === 'upload') {
    document.getElementById('step-upload').style.display = 'flex';
    document.getElementById('step-indicator').textContent = '';
  } else if (name === 'viewpoint') {
    document.getElementById('step-viewpoint').style.display = 'flex';
    document.getElementById('step-indicator').textContent = '1. 시점';
    document.getElementById('btn-save-viewpoint').textContent = '저장';
    orbitVertOffset = 0;
    orbit.enabled = true;
  } else if (name === 'points') {
    document.getElementById('step-points').style.display = 'flex';
    document.getElementById('step-indicator').textContent = '2. 기록';
    document.getElementById('btn-done-points').textContent = editStartMode === 'points' ? '저장' : '완료';
    document.getElementById('crosshair').style.display = 'block';
    orbit.enabled = false;
    lookMode = true;
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    lookYaw   = Math.atan2(d.x, d.z);
    lookPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    lookBaseY = camera.position.y;
    lookVertOffset = 0;
  } else if (name === 'thumbnail') {
    document.getElementById('step-thumbnail').style.display = 'flex';
    document.getElementById('step-indicator').textContent = '3. 표지';
    document.querySelector('#step-thumbnail p').textContent = '책상의 표지를 정하세요.';
    orbit.enabled = true;
    orbitVertOffset = 0;
    fitThumbnailCamera(
      thumbnailPos && thumbnailTarget
        ? thumbnailPos.clone().sub(thumbnailTarget)
        : camera.position.clone().sub(orbit.target)
    );
    const keepButton = document.getElementById('btn-keep-thumbnail');
    keepButton.style.display = thumbnailFileId ? '' : 'none';
  } else if (name === 'submit') {
    document.getElementById('step-submit').style.display = 'flex';
    document.getElementById('step-indicator').textContent = '저장';
    orbit.enabled = false;
    lookMode = false;
    buildSubmitPreview();
  }
}

function fitThumbnailCamera(direction) {
  if (modelBox.isEmpty()) return;

  if (!direction || direction.lengthSq() < 0.000001) {
    camera.getWorldDirection(direction = new THREE.Vector3());
    direction.multiplyScalar(-1);
  }
  direction.normalize();

  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const tanVertical = Math.tan(verticalHalfFov);
  const tanHorizontal = tanVertical * thumbnailCaptureAspect;
  const forward = direction.clone().multiplyScalar(-1);
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  let distance = 0;

  for (const x of [modelBox.min.x, modelBox.max.x]) {
    for (const y of [modelBox.min.y, modelBox.max.y]) {
      for (const z of [modelBox.min.z, modelBox.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(modelCenter);
        distance = Math.max(
          distance,
          Math.abs(offset.dot(right)) / tanHorizontal + offset.dot(direction),
          Math.abs(offset.dot(up)) / tanVertical + offset.dot(direction)
        );
      }
    }
  }
  distance *= 1.025;

  orbit.target.copy(modelCenter);
  camera.position.copy(modelCenter).addScaledVector(direction, distance);
  camera.updateProjectionMatrix();
  orbit.update();
}

function set상Preview(enabled) {
  scene.background = enabled ? thumbnailBackground : editorBackground;
  originalModelMaterials.forEach((material, mesh) => {
    mesh.material = enabled ? thumbnailSilhouetteMaterial : material;
  });
  points.forEach(point => {
    point.marker.visible = !enabled;
  });
}

function setBottomBarStatusOnly(status, enabled) {
  status.closest('.bottom-bar')?.classList.toggle('status-only', enabled);
}

document.getElementById('btn-back').addEventListener('click', e => {
  e.preventDefault();
  if (currentStep === 'submit') {
    setStep('thumbnail');
    return;
  }
  if (currentStep === 'thumbnail') {
    if (editStartMode === 'thumbnail') {
      location.href = `viewer.html?desk=${encodeURIComponent(editDeskId)}`;
      return;
    }
    setStep(editStartMode === 'view' ? 'viewpoint' : 'points');
    return;
  }
  if (currentStep === 'points') {
    setStep('viewpoint');
    return;
  }
  if (currentStep === 'viewpoint') {
    setStep('upload');
    return;
  }
  history.length > 1 ? history.back() : location.assign('index.html');
});

// ── Step 1: Google login ──
document.getElementById('btn-google-login').addEventListener('click', () => {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (res) => {
      if (res.error) { console.error(res); return; }
      accessToken = res.access_token;
      localStorage.setItem('gtoken', accessToken);
      localStorage.setItem('gtoken_exp', Date.now() + (res.expires_in - 60) * 1000);
      showLoggedIn();
    },
  });
  client.requestAccessToken();
});

function showLoggedIn() {
  document.getElementById('btn-google-login').style.display = 'none';
  document.getElementById('login-status').style.display = 'flex';
  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).then(r => r.json()).then(u => {
    document.getElementById('login-name').textContent = u.name || u.email;
    window._userName = u.name || u.email;
  }).catch(() => {
    // 토큰 만료 — 다시 로그인
    localStorage.removeItem('gtoken');
    localStorage.removeItem('gtoken_exp');
    document.getElementById('btn-google-login').style.display = 'block';
    document.getElementById('login-status').style.display = 'none';
  });
}

function showEditPinStep() {
  // UX-09: 기존 책상 책상 식별 번호 불러오기 화면과 상태 문구
  setStep('upload');
  document.querySelector('#step-upload h2').textContent = '책상 수정';
  document.querySelector('#step-upload .sub').textContent = '책상 식별 번호 4자리를 입력해주세요.';
  document.getElementById('upload-area').innerHTML = `
    <input id="edit-pin-input" class="pin-entry" type="password" maxlength="4" inputmode="numeric" placeholder="0000">
    <button class="btn" id="btn-load-edit">불러오기</button>
    <div id="upload-progress">불러오는 중</div>
  `;

  document.getElementById('btn-load-edit').addEventListener('click', async () => {
    const pin = document.getElementById('edit-pin-input').value.trim();
    if (pin.length !== 4) {
      alert('책상 식별 번호 4자리를 입력해주세요.');
      return;
    }
    await loadEditByPin(pin);
  });
}

async function loadEditByPin(pin) {
  const progress = document.getElementById('upload-progress');
  progress.style.display = 'block';
  progress.textContent = '책상 찾는 중';

  try {
    const desks = await CMS.fetchDesks();
    const desk = CMS.findLatestDesk(desks, (item) => {
      return (item.desk_id || '').split('-').pop() === pin;
    });

    if (!desk) {
      progress.textContent = '책상 식별 번호가 일치하는 책상을 찾을 수 없습니다.';
      return;
    }

    editDeskId = desk.desk_id;
    await loadEditDesk();
  } catch (err) {
    console.error(err);
    progress.textContent = '책상 목록을 불러올 수 없습니다.';
  }
}

// 페이지 로드 시 저장된 토큰 복원
(function restoreToken() {
  const token = localStorage.getItem('gtoken');
  const exp   = parseInt(localStorage.getItem('gtoken_exp') || '0');
  if (token && Date.now() < exp) {
    accessToken = token;
    showLoggedIn();
  }
})();

// ── Step 1: File select & upload ──
document.getElementById('btn-select-file').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('upload-progress').textContent = '등록 중';

  try {
    driveFileId = await uploadToDrive(file);
    document.getElementById('upload-progress').textContent = '등록 완료';
    await loadGLB(driveFileId);
    setStep('viewpoint');
  } catch (err) {
    console.error(err);
    document.getElementById('upload-progress').style.display = 'block';
    document.getElementById('upload-progress').textContent = '오류: ' + err.message;
  }
});

async function uploadToDrive(file) {
  const meta = JSON.stringify({ name: file.name, parents: [CONFIG.DRIVE_FOLDER_ID] });
  const form  = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  const data = await res.json();

  // make public readable
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
  });

  return data.id;
}

// ── Load GLB into scene ──
function loadGLB(fileId, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const fetchOptions = accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : {};
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media${accessToken ? '' : `&key=${CONFIG.API_KEY}`}`,
        fetchOptions
      );
      if (!res.ok) throw new Error(`Drive fetch ${res.status}`);
      const blobUrl = URL.createObjectURL(await res.blob());

      new THREE.GLTFLoader().load(blobUrl, (gltf) => {
        URL.revokeObjectURL(blobUrl);
        const model = gltf.scene;
        scene.add(model);
        model.updateMatrixWorld(true);

        // bbox 기반으로 카메라/orbit 맞추기 (모델 변형 없음)
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        modelBox.copy(box);
        modelCenter.copy(sphere.center);

        // DoubleSide → 뒷면도 raycasting 가능
        model.traverse(c => {
          if (!c.isMesh) return;
          const fix = m => Object.assign(m.clone(), { side: THREE.DoubleSide });
          c.material = Array.isArray(c.material) ? c.material.map(fix) : fix(c.material);
          originalModelMaterials.set(c, c.material);
        });

        if (options.cameraPos && options.cameraTarget) {
          camera.position.copy(options.cameraPos);
          orbit.target.copy(options.cameraTarget);
        } else {
          orbit.target.copy(center);
          camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 2.0);
        }
        orbit.update();

        resolve();
      }, undefined, (err) => { URL.revokeObjectURL(blobUrl); reject(err); });
    } catch (err) { reject(err); }
  });
}

// ── Step 2: Save viewpoint ──
document.getElementById('btn-save-viewpoint').addEventListener('click', async () => {
  savedPos    = camera.position.clone();
  savedTarget = orbit.target.clone();
  if (editStartMode === 'view') {
    const button = document.getElementById('btn-save-viewpoint');
    await saveDesk({
      button,
      status: document.querySelector('#step-viewpoint p'),
      redirectUrl: `viewer.html?desk=${encodeURIComponent(editDeskId)}`,
    });
    return;
  }
  setStep('points');
});

// ── Marker ──
function makeMarkerTexture(char) {
  const sz = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sz;
  const ctx = cv.getContext('2d');
  const inset = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(inset, inset, sz - inset * 2, sz - inset * 2);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 10;
  ctx.strokeRect(inset, inset, sz - inset * 2, sz - inset * 2);
  ctx.fillStyle = '#111111';
  ctx.font = '700 142px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, sz / 2, sz / 2 + 8);
  const texture = new THREE.CanvasTexture(cv);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createMarker() {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeMarkerTexture('?'), depthTest: false })
  );
  sprite.scale.set(0.032, 0.032, 1);
  sprite.userData.isMarker = true;
  return sprite;
}

function seedExistingPoint(obj) {
  const x = parseFloat(obj.x), y = parseFloat(obj.y), z = parseFloat(obj.z);
  if ([x, y, z].some(Number.isNaN)) return;

  const marker = createMarker();
  marker.material.map = makeMarkerTexture('!');
  marker.material.map.needsUpdate = true;
  marker.position.set(x, y, z);
  scene.add(marker);

  points.push({
    objectId: obj.object_id,
    position: marker.position.clone(),
    marker,
    name: obj.name || '',
    date: obj.collected_date || '',
    memo: obj.memory_note || '',
    dirty: false,
  });
}

// ── Step 3: Raycasting for point placement ──
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

function placePoint(e) {
  if (document.getElementById('meta-form').style.display === 'flex') return;

  camera.updateMatrixWorld();

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const markerHits = raycaster.intersectObjects(points.map(p => p.marker), false);
  if (markerHits.length) {
    const point = points.find(p => p.marker === markerHits[0].object);
    if (point) openMetaForm(point);
    return;
  }

  const meshes = [];
  scene.traverse(c => { if (c.isMesh && !c.userData.isMarker) meshes.push(c); });

  const hits = raycaster.intersectObjects(meshes, false);
  console.log(`place — meshes: ${meshes.length}, hits: ${hits.length}`);

  if (!hits.length) return;

  const pt = hits[0].point;

  const marker = createMarker();
  marker.position.copy(pt);
  scene.add(marker);

  pendingPoint = { position: pt.clone(), marker };
  openMetaForm();
}

// ── Metadata form ──
function setDateFields(value) {
  const dateInput = document.getElementById('f-date');
  const unknownInput = document.getElementById('f-date-unknown');
  const isUnknown = value === '알 수 없음';
  unknownInput.checked = isUnknown;
  dateInput.disabled = isUnknown;
  dateInput.value = isUnknown ? '' : (value || '').slice(0, 7);
}

function getDateValue() {
  if (document.getElementById('f-date-unknown').checked) return '알 수 없음';
  return document.getElementById('f-date').value;
}

function openMetaForm(point = null) {
  editingPoint = point;
  const form = document.getElementById('meta-form');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  document.getElementById('btn-meta-delete').style.display = point ? 'block' : 'none';
  document.getElementById('f-name').value  = point?.name || '';
  setDateFields(point?.date || '');
  document.getElementById('f-memo').value  = point?.memo || '';
}

document.getElementById('btn-meta-cancel').addEventListener('click', () => {
  if (pendingPoint) { scene.remove(pendingPoint.marker); pendingPoint = null; }
  editingPoint = null;
  document.getElementById('btn-meta-delete').style.display = 'none';
  document.getElementById('meta-form').style.display = 'none';
});

document.getElementById('btn-meta-delete').addEventListener('click', () => {
  if (!editingPoint) return;
  if (editingPoint.objectId) deletedPoints.push(editingPoint.objectId);
  scene.remove(editingPoint.marker);
  const idx = points.indexOf(editingPoint);
  if (idx >= 0) points.splice(idx, 1);
  editingPoint = null;
  document.getElementById('btn-meta-delete').style.display = 'none';
  document.getElementById('meta-form').style.display = 'none';
});

document.getElementById('btn-meta-save').addEventListener('click', () => {
  const name = document.getElementById('f-name').value.trim();
  const date = getDateValue();
  const memo = document.getElementById('f-memo').value.trim();

  if (editingPoint) {
    editingPoint.name = name;
    editingPoint.date = date;
    editingPoint.memo = memo;
    editingPoint.dirty = true;
    editingPoint = null;
    document.getElementById('btn-meta-delete').style.display = 'none';
    document.getElementById('meta-form').style.display = 'none';
    return;
  }

  if (!pendingPoint) return;
  // ? → ! 로 교체
  pendingPoint.marker.material.map = makeMarkerTexture('!');
  pendingPoint.marker.material.map.needsUpdate = true;
  points.push({
    objectId: null,
    position: pendingPoint.position,
    marker: pendingPoint.marker,
    name,
    date,
    memo,
    dirty: true,
  });
  pendingPoint = null;
  document.getElementById('btn-meta-delete').style.display = 'none';
  document.getElementById('meta-form').style.display = 'none';
});

document.getElementById('f-date-unknown').addEventListener('change', e => {
  const dateInput = document.getElementById('f-date');
  dateInput.disabled = e.target.checked;
  if (e.target.checked) dateInput.value = '';
});

// ── Step 3: Done ──
document.getElementById('btn-done-points').addEventListener('click', async () => {
  if (editStartMode === 'points') {
    const button = document.getElementById('btn-done-points');
    await saveDesk({
      button,
      status: document.querySelector('#step-points p'),
      redirectUrl: `viewer.html?desk=${encodeURIComponent(editDeskId)}`,
    });
    return;
  }
  setStep('thumbnail');
});

document.getElementById('btn-save-thumbnail').addEventListener('click', async () => {
  // UX-13: 표지 저장 상태 및 오류 문구
  const status = document.querySelector('#step-thumbnail p');
  const button = document.getElementById('btn-save-thumbnail');
  if (!accessToken) {
    status.textContent = '새 표지 저장에는 Google 로그인이 필요합니다.';
    return;
  }

  button.disabled = true;
  status.textContent = '표지 저장 중';
  setBottomBarStatusOnly(status, true);
  thumbnailPos = camera.position.clone();
  thumbnailTarget = orbit.target.clone();

  try {
    const blob = await capture상Blob();
    thumbnailFileId = await upload상Blob(blob);
    status.textContent = '표지 저장 완료';
    setStep('submit');
  } catch (err) {
    console.error(err);
    status.textContent = '표지를 저장하지 못했습니다.';
    setBottomBarStatusOnly(status, false);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('btn-keep-thumbnail').addEventListener('click', () => setStep('submit'));

function capture상Blob() {
  const previousBackground = scene.background;
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousAspect = camera.aspect;
  const markerVisibility = points.map(point => point.marker.visible);
  points.forEach(point => { point.marker.visible = false; });
  scene.background = null;
  renderer.setSize(800, 864, false);
  camera.aspect = 800 / 864;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return new Promise((resolve, reject) => {
    renderer.domElement.toBlob(blob => {
      scene.background = previousBackground;
      points.forEach((point, index) => { point.marker.visible = markerVisibility[index]; });
      renderer.setSize(previousSize.x, previousSize.y);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      blob ? resolve(blob) : reject(new Error('상 capture failed'));
    }, 'image/webp', 0.86);
  });
}

async function upload상Blob(blob) {
  const meta = JSON.stringify({
    name: `askdesk-thumbnail-${Date.now()}.webp`,
    parents: [CONFIG.DRIVE_FOLDER_ID],
  });
  const form = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', blob, 'thumbnail.webp');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
  );
  if (!res.ok) throw new Error(`상 upload failed: ${res.status}`);
  const data = await res.json();
  const permission = await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false }),
  });
  if (!permission.ok) throw new Error(`상 permission failed: ${permission.status}`);
  return data.id;
}

// ── Submit preview ──
function buildSubmitPreview() {
  // UX-14: 최종 저장 화면의 변경 요약 문구
  const el = document.getElementById('submit-status');
  const pinInput = document.getElementById('pin-input');
  if (editDeskId) {
    pinInput.style.display = 'none';
    const changedCount = points.filter(point => point.dirty).length;
    const parts = [];
    if (changedCount) parts.push(`기록 ${changedCount}개 변경`);
    if (deletedPoints.length) parts.push(`기록 ${deletedPoints.length}개 삭제`);
    el.textContent = parts.length ? parts.join(' · ') : '기록 변경 없음';
    return;
  }

  pinInput.style.display = 'block';
  el.innerHTML = `책상 1개 · 기록 ${points.length}개 준비됨<br>책상 식별 번호 4자리를 설정해주세요.`;
}

// ── Submit to Apps Script ──
document.getElementById('btn-submit').addEventListener('click', () => saveDesk());

async function saveDesk(options = {}) {
  // UX-10, UX-11, UX-14: 저장 중·완료·오류 상태 문구
  const btn = options.button || document.getElementById('btn-submit');
  const status = options.status || document.getElementById('submit-status');
  const redirectUrl = options.redirectUrl || 'index.html';
  const originalStatus = status.textContent;
  btn.disabled = true;
  status.textContent = '저장 중';
  setBottomBarStatusOnly(status, true);

  const pin    = String(document.getElementById('pin-input').value || '0000').slice(0, 4).padStart(4, '0');
  let previousDeskRowIndex = 0;
  try {
    const desks = await CMS.fetchDesks();
    previousDeskRowIndex = desks
      .filter(item => item.desk_id === editDeskId)
      .reduce((max, item) => Math.max(max, item.__rowIndex || 0), 0);
    if (!editDeskId) {
      const isUsed = desks.some((item) => (item.desk_id || '').split('-').pop() === pin);
      if (isUsed) {
        status.textContent = '이미 사용중인 번호입니다.';
        btn.disabled = false;
        setBottomBarStatusOnly(status, false);
        return;
      }
    }
  } catch (err) {
    console.error(err);
    status.textContent = '저장 전 상태를 확인하지 못했습니다. 다시 시도해주세요.';
    btn.disabled = false;
    setBottomBarStatusOnly(status, false);
    return;
  }

  const uuid   = crypto.randomUUID ? crypto.randomUUID().split('-')[0] : Date.now().toString(36);
  const deskId = editDeskId || `${uuid}-${pin}`;
  const submittedAt = new Date().toISOString();
  const objectVersion = submittedAt.replace(/[^0-9A-Za-z]/g, '');
  const changedPoints = editDeskId ? points.filter(p => p.dirty) : points;
  const objectRows = changedPoints.map((p, i) => ({
        desk_id:        deskId,
        object_id:      p.objectId || (editDeskId
          ? `${deskId}_note_n${crypto.randomUUID?.() || `${Date.now()}_${i}`}`
          : `${deskId}_${objectVersion}_${i}`),
        name:           p.name,
        collected_date: p.date,
        memory_note:    p.memo,
        x:              p.position.x,
        y:              p.position.y,
        z:              p.position.z,
      }));

  deletedPoints.forEach(objectId => {
    objectRows.push({
      desk_id:        deskId,
      object_id:      objectId,
      name:           '',
      collected_date: '',
      memory_note:    '',
      x:              '',
      y:              '',
      z:              '',
    });
  });

  if (!editDeskId && objectRows.length === 0) {
    objectRows.push({
        desk_id:        deskId,
        object_id:      `${deskId}_${objectVersion}_0`,
        name:           '',
        collected_date: '',
        memory_note:    '',
        x:              '',
        y:              '',
        z:              '',
    });
  }

  const payload = {
    desk: {
      desk_id:      deskId,
      owner:        CMS.encodeDeskMeta({
        owner: window._userName || CMS.getDeskMeta(editDesk).owner || '',
        thumbnail_file_id: thumbnailFileId || '',
        thumb_cam_pos_x: thumbnailPos?.x ?? '',
        thumb_cam_pos_y: thumbnailPos?.y ?? '',
        thumb_cam_pos_z: thumbnailPos?.z ?? '',
        thumb_cam_target_x: thumbnailTarget?.x ?? '',
        thumb_cam_target_y: thumbnailTarget?.y ?? '',
        thumb_cam_target_z: thumbnailTarget?.z ?? '',
      }),
      drive_file_id: driveFileId || editDesk?.drive_file_id,
      cam_pos_x:    savedPos.x,
      cam_pos_y:    savedPos.y,
      cam_pos_z:    savedPos.z,
      cam_target_x: savedTarget.x,
      cam_target_y: savedTarget.y,
      cam_target_z: savedTarget.z,
      upload_date:  submittedAt,
    },
    objects: objectRows,
  };

  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const saved = await waitForDeskSaved(deskId, previousDeskRowIndex);
    if (saved) {
      status.textContent = '저장 완료';
      window.setTimeout(() => {
        location.href = redirectUrl;
      }, 1000);
    } else {
      status.textContent = '전송은 완료됐지만 시트 반영을 확인하지 못했습니다.';
      btn.disabled = false;
      setBottomBarStatusOnly(status, false);
    }
  } catch (err) {
    console.error(err);
    status.textContent = '오류가 발생했습니다. 다시 시도해주세요.';
    btn.disabled = false;
    setBottomBarStatusOnly(status, false);
  }
  if (!btn.disabled && options.status) {
    window.setTimeout(() => {
      if (status.textContent !== '저장 완료') status.textContent = originalStatus;
    }, 3000);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDeskSaved(deskId, previousDeskRowIndex) {
  for (let i = 0; i < 8; i += 1) {
    await wait(1200);
    try {
      const desks = await CMS.fetchDesks();
      if (desks.some(d => d.desk_id === deskId && (d.__rowIndex || 0) > previousDeskRowIndex)) return true;
    } catch (err) {
      console.warn('Save verification failed', err);
    }
  }
  return false;
}

async function initEditMode() {
  if (initialDriveFileId) {
    driveFileId = initialDriveFileId;
    document.getElementById('step-upload').style.display = 'none';
    try {
      await loadGLB(driveFileId);
      setStep('viewpoint');
    } catch (err) {
      console.error(err);
      alert('3D 파일을 불러오지 못했습니다.');
      setStep('upload');
    }
    return;
  }

  if (!isEditMode) {
    setStep('upload');
    return;
  }

  if (initialEditPin && /^\d{4}$/.test(initialEditPin)) {
    showEditPinStep();
    document.getElementById('edit-pin-input').value = initialEditPin;
    await loadEditByPin(initialEditPin);
    return;
  }

  if (!editDeskId || editDeskId === '1') {
    showEditPinStep();
    return;
  }

  await loadEditDesk();
}

async function loadEditDesk() {
  // UX-09~13: 기존 책상 로드 상태 및 오류 문구
  try {
    const desks = await CMS.fetchDesks();
    editDesk = CMS.findLatestDesk(desks, d => d.desk_id === editDeskId);
    editObjects = await CMS.fetchObjects(editDeskId);
  } catch (err) {
    console.error(err);
    alert('기존 책상 정보를 불러오지 못했습니다.');
    setStep('upload');
    return;
  }

  if (!editDesk) {
    alert('편집할 책상을 찾을 수 없습니다.');
    setStep('upload');
    return;
  }

  driveFileId = editDesk.drive_file_id;
  savedPos = new THREE.Vector3(
    parseFloat(editDesk.cam_pos_x) || 0,
    parseFloat(editDesk.cam_pos_y) || 0,
    parseFloat(editDesk.cam_pos_z) || 0
  );
  savedTarget = new THREE.Vector3(
    parseFloat(editDesk.cam_target_x) || 0,
    parseFloat(editDesk.cam_target_y) || 0,
    parseFloat(editDesk.cam_target_z) || 0
  );
  const deskMeta = CMS.getDeskMeta(editDesk);
  window._userName = deskMeta.owner || window._userName;
  thumbnailFileId = deskMeta.thumbnail_file_id || null;
  if (deskMeta.thumb_cam_pos_x !== undefined && deskMeta.thumb_cam_pos_x !== '') {
    thumbnailPos = new THREE.Vector3(
      parseFloat(deskMeta.thumb_cam_pos_x) || 0,
      parseFloat(deskMeta.thumb_cam_pos_y) || 0,
      parseFloat(deskMeta.thumb_cam_pos_z) || 0
    );
    thumbnailTarget = new THREE.Vector3(
      parseFloat(deskMeta.thumb_cam_target_x) || 0,
      parseFloat(deskMeta.thumb_cam_target_y) || 0,
      parseFloat(deskMeta.thumb_cam_target_z) || 0
    );
  }

  document.getElementById('step-upload').style.display = 'flex';
  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('upload-progress').textContent = '책상 찾는 중';

  try {
    await loadGLB(driveFileId, { cameraPos: savedPos, cameraTarget: savedTarget });
    editObjects.forEach(seedExistingPoint);
    if (editStartMode === 'thumbnail') {
      setStep('thumbnail');
    } else {
      setStep(editStartMode === 'points' ? 'points' : 'viewpoint');
    }
  } catch (err) {
    console.error(err);
    document.getElementById('upload-progress').textContent = '오류: ' + err.message;
  }
}

// ── Init ──
initEditMode();
