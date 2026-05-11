// ── State ──
let accessToken  = null;
let driveFileId  = null;
let savedPos     = null;
let savedTarget  = null;
let pendingPoint = null;   // {position, marker}
const points     = [];     // [{position, meta, marker}]

// ── Three.js setup ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0;';
document.body.prepend(renderer.domElement);

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

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
orbit.enabled = false;

// ── Look-only mode (포인트 지정 단계) ──
let lookMode = false;
let lookYaw = 0, lookPitch = 0;
let lookDrag = false, lookLX = 0, lookLY = 0;
let downX = 0, downY = 0, movedPx = 0;

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
  movedPx   = Math.hypot(e.clientX - downX, e.clientY - downY);
  lookYaw  -= (e.clientX - lookLX) / innerWidth  * 2.5;
  lookPitch -= (e.clientY - lookLY) / innerHeight * 2.0;
  lookPitch  = Math.max(-1.4, Math.min(1.4, lookPitch));
  lookLX = e.clientX; lookLY = e.clientY;
  applyLook();
});

function applyLook() {
  const fwd = new THREE.Vector3(
    Math.sin(lookYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    Math.cos(lookYaw) * Math.cos(lookPitch)
  );
  camera.lookAt(camera.position.clone().add(fwd));
}

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function loop() {
  requestAnimationFrame(loop);
  if (orbit.enabled) orbit.update();
  renderer.render(scene, camera);
})();

// ── Step helpers ──
function setStep(name) {
  ['step-upload','step-viewpoint','step-points','step-submit'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('step-indicator').textContent = '';

  if (name === 'upload')    {
    document.getElementById('step-upload').style.display = 'flex';
  } else if (name === 'viewpoint') {
    document.getElementById('step-viewpoint').style.display = 'block';
    document.getElementById('step-indicator').textContent = 'STEP 1 — 드래그: 회전 · 스크롤: 줌 · 우클릭: 패닝';
    orbit.enabled = true;
  } else if (name === 'points') {
    document.getElementById('step-points').style.display = 'block';
    document.getElementById('step-indicator').textContent = 'STEP 2 — 드래그: 시선 · 클릭: 포인트 지정';
    document.getElementById('crosshair').style.display = 'block';
    orbit.enabled = false;
    lookMode = true;
    // 저장된 시점에서 lookYaw/lookPitch 초기화
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    lookYaw   = Math.atan2(d.x, d.z);
    lookPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  } else if (name === 'submit') {
    document.getElementById('step-submit').style.display = 'block';
    document.getElementById('step-indicator').textContent = 'STEP 3 — 제출';
    orbit.enabled = false;
    lookMode = false;
    buildSubmitPreview();
  }
}

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
  document.getElementById('login-status').style.display = 'block';
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
  document.getElementById('upload-progress').textContent = '업로드 중…';

  try {
    driveFileId = await uploadToDrive(file);
    document.getElementById('upload-progress').textContent = '업로드 완료. GLB 로드 중…';
    await loadGLB(driveFileId);
    setStep('viewpoint');
  } catch (err) {
    console.error(err);
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
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return data.id;
}

// ── Load GLB into scene ──
function loadGLB(fileId) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
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

        // DoubleSide → 뒷면도 raycasting 가능
        model.traverse(c => {
          if (!c.isMesh) return;
          const fix = m => Object.assign(m.clone(), { side: THREE.DoubleSide });
          c.material = Array.isArray(c.material) ? c.material.map(fix) : fix(c.material);
        });

        orbit.target.copy(center);
        camera.position.set(center.x, center.y + maxDim * 0.5, center.z + maxDim * 2.0);
        orbit.update();

        resolve();
      }, undefined, (err) => { URL.revokeObjectURL(blobUrl); reject(err); });
    } catch (err) { reject(err); }
  });
}

// ── Step 2: Save viewpoint ──
document.getElementById('btn-save-viewpoint').addEventListener('click', () => {
  savedPos    = camera.position.clone();
  savedTarget = orbit.target.clone();
  setStep('points');
});

// ── Marker ──
function makeMarkerTexture(char) {
  const sz = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = sz;
  const ctx = cv.getContext('2d');
  ctx.beginPath();
  ctx.arc(sz/2, sz/2, sz/2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = '#666666';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 62px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, sz/2, sz/2 + 3);
  return new THREE.CanvasTexture(cv);
}

function createMarker() {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeMarkerTexture('?'), depthTest: false })
  );
  sprite.scale.set(0.018, 0.018, 1);
  sprite.userData.isMarker = true;
  return sprite;
}

// ── Step 3: Raycasting for point placement ──
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

function placePoint(e) {
  if (document.getElementById('meta-form').style.display === 'flex') return;

  camera.updateMatrixWorld();

  mouse.x =  (e.clientX / innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

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
function openMetaForm() {
  const form = document.getElementById('meta-form');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  document.getElementById('f-name').value  = '';
  document.getElementById('f-date').value  = '';
  document.getElementById('f-memo').value  = '';
}

document.getElementById('btn-meta-cancel').addEventListener('click', () => {
  if (pendingPoint) { scene.remove(pendingPoint.marker); pendingPoint = null; }
  document.getElementById('meta-form').style.display = 'none';
});

document.getElementById('btn-meta-save').addEventListener('click', () => {
  if (!pendingPoint) return;
  const name = document.getElementById('f-name').value.trim();
  const date = document.getElementById('f-date').value;
  const memo = document.getElementById('f-memo').value.trim();

  // ? → ! 로 교체
  pendingPoint.marker.material.map = makeMarkerTexture('!');
  pendingPoint.marker.material.map.needsUpdate = true;
  points.push({ position: pendingPoint.position, marker: pendingPoint.marker, name, date, memo });
  pendingPoint = null;
  document.getElementById('meta-form').style.display = 'none';
});

// ── Step 3: Done ──
document.getElementById('btn-done-points').addEventListener('click', () => setStep('submit'));

// ── Submit preview ──
function buildSubmitPreview() {
  const el = document.getElementById('submit-status');
  el.textContent = `책상 1개 · 포인트 ${points.length}개 준비됨`;
}

// ── Submit to Apps Script ──
document.getElementById('btn-submit').addEventListener('click', async () => {
  const btn = document.getElementById('btn-submit');
  btn.textContent = '제출 중…';
  btn.disabled = true;

  const deskId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);

  const payload = {
    desk: {
      desk_id:      deskId,
      owner:        window._userName || '익명',
      drive_file_id: driveFileId,
      cam_pos_x:    savedPos.x,
      cam_pos_y:    savedPos.y,
      cam_pos_z:    savedPos.z,
      cam_target_x: savedTarget.x,
      cam_target_y: savedTarget.y,
      cam_target_z: savedTarget.z,
      upload_date:  new Date().toISOString().slice(0, 10),
    },
    objects: points.map((p, i) => ({
      desk_id:        deskId,
      object_id:      `${deskId}_${i}`,
      name:           p.name,
      collected_date: p.date,
      memory_note:    p.memo,
      x:              p.position.x,
      y:              p.position.y,
      z:              p.position.z,
    })),
  };

  try {
    await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    document.getElementById('submit-status').textContent = '제출 완료!';
    btn.textContent = '홈으로';
    btn.disabled = false;
    btn.addEventListener('click', () => location.href = 'index.html', { once: true });
  } catch (err) {
    console.error(err);
    document.getElementById('submit-status').textContent = '오류가 발생했습니다. 다시 시도해주세요.';
    btn.textContent = '다시 제출';
    btn.disabled = false;
  }
});

// ── Init ──
setStep('upload');
