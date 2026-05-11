const PATH_POINTS = [
  new THREE.Vector3( 0.4357,  0.0271, -0.0311),  // P0: 앉은 눈높이
  new THREE.Vector3( 0.2518, -0.0437, -0.0233),  // P1: 중간 (자동 보간)
  new THREE.Vector3( 0.0678, -0.1144, -0.0155),  // P2: 책상 위
];

const LOOK_POINTS = [
  new THREE.Vector3( 0.1357,  0.0264, -0.0339),  // L0
  new THREE.Vector3(-0.0439, -0.0756, -0.0420),  // L1: 자동 보간
  new THREE.Vector3(-0.2234, -0.1776, -0.0501),  // L2
];

const camPath  = new THREE.CatmullRomCurve3(PATH_POINTS);
const lookPath = new THREE.CatmullRomCurve3(LOOK_POINTS);

let pathT           = 0;
let yaw             = 0;
let pitch           = 0;
const PITCH_LIMIT   = 0.6;
let isDragging      = false;
let lastX           = 0;
let lastY           = 0;
let hasMovedForward = false;

const canvas = document.querySelector('canvas');

// 휠 → 경로 앞뒤 이동
canvas.addEventListener('wheel', (e) => {
  if (window.DEV_ORBIT) return;
  e.preventDefault();
  pathT = Math.max(0, Math.min(1, pathT - e.deltaY / 600));
  if (pathT > 0) hasMovedForward = true;
  applyCamera();
  if (pathT >= 1) onPathComplete();
  if (pathT <= 0 && hasMovedForward) onPathReturn();
}, { passive: false });

// 수평 드래그 → 좌우 pan
canvas.addEventListener('mousedown', (e) => {
  if (window.DEV_ORBIT) return;
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging || window.DEV_ORBIT) return;
  yaw   += (e.clientX - lastX) / innerWidth  * 2.2;
  pitch += (e.clientY - lastY) / innerHeight * 1.5;
  pitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  lastX  = e.clientX;
  lastY  = e.clientY;
  applyCamera();
});

canvas.addEventListener('mouseup',    () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// 터치: 수직 스와이프 → 경로, 수평 스와이프 → pan
let lastTX = 0, lastTY = 0;
canvas.addEventListener('touchstart', (e) => {
  if (window.DEV_ORBIT) return;
  isDragging = true;
  lastTX = e.touches[0].clientX;
  lastTY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (!isDragging || window.DEV_ORBIT) return;
  const dx = e.touches[0].clientX - lastTX;
  const dy = e.touches[0].clientY - lastTY;
  lastTX = e.touches[0].clientX;
  lastTY = e.touches[0].clientY;

  pathT = Math.max(0, Math.min(1, pathT + dy / 600));
  if (pathT > 0) hasMovedForward = true;
  yaw  -= dx / innerWidth * 2.2;
  applyCamera();
  if (pathT >= 1) onPathComplete();
  if (pathT <= 0 && hasMovedForward) onPathReturn();
}, { passive: true });

canvas.addEventListener('touchend', () => { isDragging = false; });

applyCamera();

function applyCamera() {
  const cam = Viewer.camera;
  camPath.getPoint(pathT, cam.position);

  const baseLook = new THREE.Vector3();
  lookPath.getPoint(pathT, baseLook);

  const dir = baseLook.clone().sub(cam.position).normalize();

  // yaw: Y축 회전
  const yawed = new THREE.Vector3(
    dir.x * Math.cos(yaw) + dir.z * Math.sin(yaw),
    dir.y,
    -dir.x * Math.sin(yaw) + dir.z * Math.cos(yaw)
  );

  // pitch: 카메라 right 축 회전
  const right = yawed.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const final = yawed.clone().applyAxisAngle(right, pitch);

  cam.lookAt(cam.position.clone().add(final));
}

let transitionFired = false;
function onPathComplete() {
  if (transitionFired) return;
  transitionFired = true;
  if (window.CMS && window.CMS.startTransition) window.CMS.startTransition();
}

let returnFired = false;
function onPathReturn() {
  if (returnFired) return;
  returnFired = true;
  hasMovedForward = false;
  transitionFired = false;

  const overlay = document.getElementById('loading');
  const text    = document.getElementById('loading-text');
  overlay.classList.remove('hidden');
  text.textContent = '…';
  setTimeout(() => {
    overlay.classList.add('hidden');
    returnFired = false;
  }, 800);
}
