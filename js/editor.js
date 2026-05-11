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

const orbit = new THREE.OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.enabled = false;

const markerGeo = new THREE.SphereGeometry(0.006, 12, 12);

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
    document.getElementById('step-indicator').textContent = 'STEP 1 — 시점 설정';
    orbit.enabled = true;
  } else if (name === 'points') {
    document.getElementById('step-points').style.display = 'block';
    document.getElementById('step-indicator').textContent = 'STEP 2 — 포인트 지정';
    document.getElementById('crosshair').style.display = 'block';
    orbit.enabled = false;
  } else if (name === 'submit') {
    document.getElementById('step-submit').style.display = 'block';
    document.getElementById('step-indicator').textContent = 'STEP 3 — 제출';
    orbit.enabled = false;
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
      document.getElementById('btn-google-login').style.display = 'none';
      document.getElementById('login-status').style.display = 'block';

      // fetch user info
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).then(r => r.json()).then(u => {
        document.getElementById('login-name').textContent = u.name || u.email;
        window._userName = u.name || u.email;
      });
    },
  });
  client.requestAccessToken();
});

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
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.API_KEY}`;
    new THREE.GLTFLoader().load(url, (gltf) => {
      scene.add(gltf.scene);

      // center camera on model
      const box    = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      orbit.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(0, size.y, size.z * 2));
      orbit.update();

      resolve();
    }, undefined, reject);
  });
}

// ── Step 2: Save viewpoint ──
document.getElementById('btn-save-viewpoint').addEventListener('click', () => {
  savedPos    = camera.position.clone();
  savedTarget = orbit.target.clone();
  setStep('points');
});

// ── Step 3: Raycasting for point placement ──
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

renderer.domElement.addEventListener('click', (e) => {
  if (orbit.enabled) return;
  if (document.getElementById('meta-form').style.display === 'flex') return;

  mouse.x =  (e.clientX / innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const meshes = [];
  scene.traverse(c => { if (c.isMesh && !c.userData.isMarker) meshes.push(c); });
  const hits = raycaster.intersectObjects(meshes, true);
  if (!hits.length) return;

  const pt = hits[0].point;

  // place temporary marker
  const mat    = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const marker = new THREE.Mesh(markerGeo.clone(), mat);
  marker.position.copy(pt);
  marker.userData.isMarker = true;
  scene.add(marker);

  pendingPoint = { position: pt.clone(), marker };
  openMetaForm();
});

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

  // change marker to white (confirmed)
  pendingPoint.marker.material.color.set(0xffffff);
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
