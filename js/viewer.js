const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 20);
camera.position.set(0.4357, 0.0271, -0.0311);
camera.lookAt(0.1357, 0.0264, -0.0339);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(1.5, 3, 2);
scene.add(dirLight);

const gltfLoader = new THREE.GLTFLoader();

gltfLoader.load('desk.glb', (gltf) => {
  const model = gltf.scene;
  const box    = new THREE.Box3().setFromObject(model);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale  = 1.0 / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  scene.add(model);
  document.getElementById('loading').classList.add('hidden');
}, null, (err) => {
  console.error(err);
  document.getElementById('loading-text').textContent = 'error loading model';
});

// dev: orbit 토글 (O키 또는 버튼)
const orbitCtrl = new THREE.OrbitControls(camera, renderer.domElement);
orbitCtrl.enableDamping = true;
orbitCtrl.enabled = false;
window.DEV_ORBIT = false;

function toggleOrbit() {
  window.DEV_ORBIT = !window.DEV_ORBIT;
  orbitCtrl.enabled = window.DEV_ORBIT;
  const btn = document.getElementById('dev-toggle');
  btn.textContent = `orbit: ${window.DEV_ORBIT ? 'ON' : 'OFF'}`;
  btn.style.color  = window.DEV_ORBIT ? '#8f8' : '#aaa';
}

function logCamPos() {
  const p = camera.position;
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  const t = p.clone().addScaledVector(d, 0.3);
  console.log(`pos:    new THREE.Vector3(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`);
  console.log(`lookat: new THREE.Vector3(${t.x.toFixed(4)}, ${t.y.toFixed(4)}, ${t.z.toFixed(4)})`);
}

document.getElementById('dev-toggle').addEventListener('click', toggleOrbit);

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyO') toggleOrbit();
  if (e.code === 'KeyC') logCamPos();
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function loop() {
  requestAnimationFrame(loop);
  if (window.DEV_ORBIT) orbitCtrl.update();
  renderer.render(scene, camera);
})();

window.Viewer = { scene, camera, renderer };
