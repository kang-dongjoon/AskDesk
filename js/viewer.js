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

// --- Render targets ---
let rtNormal = new THREE.WebGLRenderTarget(innerWidth, innerHeight);
let rtClay   = new THREE.WebGLRenderTarget(innerWidth, innerHeight);

// --- Composite quad: inside circle = texture, outside = clay ---
const compScene  = new THREE.Scene();
const compCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const compMat = new THREE.ShaderMaterial({
  uniforms: {
    tNormal:      { value: rtNormal.texture },
    tClay:        { value: rtClay.texture },
    visionRadius: { value: 0.07 },
    aspect:       { value: innerWidth / innerHeight },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tNormal;
    uniform sampler2D tClay;
    uniform float visionRadius;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      float dist  = length(d);
      float edge  = 0.025;
      float mask  = smoothstep(visionRadius + edge, visionRadius - edge, dist);
      vec4 normal = texture2D(tNormal, vUv);
      vec4 clay   = texture2D(tClay,   vUv);
      gl_FragColor = mix(clay, normal, mask);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat));

// --- Clay material map ---
const normalMaterials = new Map();
const clayMaterials   = new Map();
let modelLoaded = false;

function initClayMaterials(root) {
  root.traverse(c => {
    if (!c.isMesh) return;
    normalMaterials.set(c.uuid, c.material);
    clayMaterials.set(c.uuid, new THREE.MeshLambertMaterial({ color: 0xd4b896 }));
  });
}

function applyMaterials(useClay) {
  scene.traverse(c => {
    if (!c.isMesh || !normalMaterials.has(c.uuid)) return;
    c.material = useClay ? clayMaterials.get(c.uuid) : normalMaterials.get(c.uuid);
  });
}

const gltfLoader = new THREE.GLTFLoader();
gltfLoader.load('desk.glb', (gltf) => {
  const model  = gltf.scene;
  const box    = new THREE.Box3().setFromObject(model);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale  = 1.0 / Math.max(size.x, size.y, size.z);
  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  scene.add(model);
  initClayMaterials(model);
  modelLoaded = true;
  document.getElementById('loading').classList.add('hidden');
}, null, (err) => {
  console.error(err);
  document.getElementById('loading-text').textContent = 'error loading model';
});

// --- dev: orbit 토글 ---
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
  rtNormal.setSize(innerWidth, innerHeight);
  rtClay.setSize(innerWidth, innerHeight);
  compMat.uniforms.aspect.value = innerWidth / innerHeight;
});

(function loop() {
  requestAnimationFrame(loop);
  if (window.DEV_ORBIT) orbitCtrl.update();

  if (modelLoaded) {
    // normal pass
    applyMaterials(false);
    scene.background = null;
    renderer.setRenderTarget(rtNormal);
    renderer.render(scene, camera);

    // clay pass
    applyMaterials(true);
    scene.background = new THREE.Color(0xe8ddd0);
    renderer.setRenderTarget(rtClay);
    renderer.render(scene, camera);

    // restore
    applyMaterials(false);
    scene.background = null;
    renderer.setRenderTarget(null);
    renderer.render(compScene, compCamera);
  } else {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }
})();

window.Viewer = {
  scene, camera, renderer,
  setVisionRadius(r) {
    compMat.uniforms.visionRadius.value = r;
  },
};
