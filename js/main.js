// ── Panel ──
const panel  = document.getElementById('panel');
const page   = document.getElementById('page');
const btnHow = document.getElementById('nav-how');

btnHow.addEventListener('click', () => {
  const open = panel.classList.toggle('open');
  page.classList.toggle('shifted', open);
});

// ── Seeded pseudo-random ──
function rand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// ── Thumbnails ──
async function init() {
  let desks = [];
  try { desks = await CMS.fetchDesks(); } catch (e) { console.warn('Sheets fetch failed', e); }
  renderThumbs(desks);
}

function renderThumbs(desks) {
  const container = document.getElementById('thumbs');
  const W = window.innerWidth;
  const rows = Math.ceil(desks.length / 3) || 3;
  const H = Math.max(500, rows * 220);
  container.style.height = H + 'px';

  desks.forEach((desk, i) => {
    const el  = document.createElement('div');
    el.className = 'thumb';

    const w   = 180 + rand(i * 7) * 100;
    const h   = w * (0.65 + rand(i * 11) * 0.2);
    const x   = rand(i * 3)     * (W - w - 56) + 28;
    const y   = rand(i * 3 + 1) * (H - h - 40) + 20;
    const rot = (rand(i * 3 + 2) - 0.5) * 10;

    el.style.cssText = `
      width:${w}px; height:${h}px;
      left:${x}px; top:${y}px;
      transform:rotate(${rot}deg);
    `;

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = desk.owner || desk.desk_id;
    el.appendChild(label);

    el.addEventListener('click', () => {
      window.location.href = `viewer.html?desk=${encodeURIComponent(desk.desk_id)}`;
    });

    container.appendChild(el);
  });
}

init();
