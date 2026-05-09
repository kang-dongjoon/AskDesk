const SHEET_URL = 'https://docs.google.com/spreadsheets/d/10Z8y13h03lpk1IoT0M3HsPw9ApVEGBI5IliDzFIp3y4/export?format=csv&gid=0';

window.CMS = {
  objects: [],

  async fetchObjects() {
    const res  = await fetch(SHEET_URL);
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1); // 헤더 제거
    this.objects = rows.map(row => {
      const [object_id, name, collected_date, memory_note, x, y, z] = row.split(',');
      return {
        object_id:      object_id?.trim(),
        name:           name?.trim(),
        collected_date: collected_date?.trim(),
        memory_note:    memory_note?.trim(),
        x: parseFloat(x),
        y: parseFloat(y),
        z: parseFloat(z),
      };
    }).filter(o => o.object_id);
    return this.objects;
  },

  async startTransition() {
    const overlay = document.getElementById('loading');
    const text    = document.getElementById('loading-text');
    overlay.classList.remove('hidden');

    text.textContent = '수집 중…';

    try {
      const objects = await this.fetchObjects();
      text.textContent = `지금까지 수집된 ${objects.length}개의 사물`;
    } catch (e) {
      text.textContent = '사물을 불러오는 중 오류가 발생했습니다';
      console.error(e);
    }

    // 2초 후 PAGE 2 진입 (추후 page2.js 연결)
    setTimeout(() => {
      overlay.classList.add('hidden');
      // TODO: initPage2()
    }, 2000);
  },
};
