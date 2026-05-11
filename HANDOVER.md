# AskDesk — 인수인계서

작성일: 2026-05-12  
프로젝트: 강동준(kang-dongjoon)의 책상 사물 아카이브 웹  
GitHub Pages: https://kang-dongjoon.github.io/AskDesk/  
로컬 경로: `/Users/joon/Desktop/26-1/AskDesk/`  
로컬 서버: `python3 -m http.server 3000`

---

## 1. 프로젝트 개념

**"사물은 수집된다. 사물은 기억한다."**

강동준의 작업실 책상 위 사물을 3D 스캔(Polycam, GLB)하여 웹 아카이브로 공개.  
방문자도 자신의 책상 GLB를 업로드해 컬렉션에 추가할 수 있음.  
메타데이터의 핵심은 사물 설명이 아니라 **수집가의 기억 메모**.

---

## 2. 기술 스택

| 역할 | 도구 |
|------|------|
| 프론트엔드 | HTML / CSS / Vanilla JS |
| 3D 렌더링 | Three.js r128 (unpkg CDN) |
| GLB 저장 | Google Drive (공유 폴더) |
| 메타데이터 CMS | Google Sheets (CSV 읽기) |
| Sheets 쓰기 | Google Apps Script 웹앱 |
| 인증 | Google Identity Services (GIS, OAuth 2.0) |
| 호스팅 | GitHub Pages (main branch) |

---

## 3. 파일 구조

```
AskDesk/
├── index.html        # 랜딩 + 컬렉션 (스크롤 단일 페이지)
├── viewer.html       # 개별 책상 3D 뷰어
├── editor.html       # 업로드 + 시점 설정 + 포인트 지정 에디터
├── desk.glb          # 강동준 책상 GLB (테스트용)
├── css/
│   └── style.css     # 전체 스타일
├── js/
│   ├── config.js     # API 키 / 설정값 (하단 참조)
│   ├── cms.js        # Sheets CSV 읽기 (fetchDesks, fetchObjects)
│   ├── main.js       # index 페이지 로직 (패널, 썸네일, fitHero)
│   ├── viewer.js     # 3D 뷰어 로직
│   └── editor.js     # 에디터 로직 (OAuth, Drive 업로드, raycasting)
└── README.md
```

---

## 4. 설정값 (js/config.js)

```javascript
const CONFIG = {
  CLIENT_ID:       '706615137841-br05n94gsq32ao6a78die3as8k6gprcs.apps.googleusercontent.com',
  API_KEY:         'AIzaSyBhCIeg-izHFqUp0xXKgjzKoBHekqkC-bc',
  DRIVE_FOLDER_ID: '18XgRXN41Ia44J2d9Gdx2sizv-C1Puv64',
  SHEET_ID:        '10Z8y13h03lpk1IoT0M3HsPw9ApVEGBI5IliDzFIp3y4',
  SCOPES:          'https://www.googleapis.com/auth/drive.file',
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbydVJJ5iQEpng_kCuYS85TEg-DKLkM0DPio3OEup4bk51g2QfSg3reD6pFterd2PIysTw/exec',
};
```

- **API_KEY**: HTTP referrer 제한 설정됨 (kang-dongjoon.github.io, localhost:3000)
- **OAuth**: Google Cloud에서 프로덕션 발행 완료. ehdwns2815@gmail.com 계정
- **Sheets**: 시트 ID로 직접 CSV 접근. 별도 API 키 불필요 (공개 공유)

---

## 5. Google Sheets 구조

**Sheet1 이름: `desks`**
```
desk_id | owner | drive_file_id | cam_pos_x | cam_pos_y | cam_pos_z | cam_target_x | cam_target_y | cam_target_z | upload_date
```

**Sheet2 이름: `objects`**
```
desk_id | object_id | name | collected_date | memory_note | x | y | z
```

- `desk_id` 형식: `{uuid 앞 8자리}-{4자리 PIN}` 예: `3f2a1b9c-4829`
- PIN은 편집 인증에 사용됨 (아래 § 8 참고)

---

## 6. 페이지별 구조 및 동작

### index.html — 랜딩 + 컬렉션

**레이아웃:**
- 단일 스크롤 페이지
- 상단: 썸네일들 랜덤 배치 (seeded pseudo-random, index 기반)
- 하단: "Ask — Desk" 대형 타이틀 (JS fitHero로 뷰포트 폭 자동 fit)

**Nav:**
- 우상단: `Desk` 버튼 (박스형) → 우측 패널 슬라이드 인

**패널 (id="panel"):**
- 상단: 프로젝트 설명 텍스트
- 구분선
- 하단: `upload` 링크 → editor.html로 이동

**썸네일:**
- Sheets `desks` 시트에서 데이터 fetch
- 각 thumb은 `desk_id`를 URL 파라미터로 viewer.html로 이동
- `thumbnail_url` 컬럼이 있으면 hover 시 해당 이미지 표시, 없으면 #e8e8e8 회색
- 기본: 밝은 회색, hover: 텍스처 컬러 표시

**fitHero 함수 (js/main.js):**
```javascript
el.style.fontSize = '100px';
el.style.width = 'fit-content';  // 텍스트 폭만 측정
const textW = el.offsetWidth;
el.style.width = '';
el.style.fontSize = Math.floor(100 * (window.innerWidth - 48) / textW) + 'px';
```
`document.fonts.ready.then(fitHero)` — 폰트 로드 후 실행

---

### viewer.html — 3D 뷰어

**URL 파라미터:** `?desk={desk_id}`

**Nav:**
- 좌상단: `Home` (박스형) → index.html
- 우상단: `Ask` (박스형) → 우측 패널 토글

**3D 동작:**
- Sheets에서 desk 데이터 fetch → Drive API v3로 GLB 로드
- 저장된 `cam_pos_*` / `cam_target_*` 시점으로 카메라 고정
- 마우스 드래그: 시선(yaw/pitch) 변경 (위치 이동 없음)
- 스크롤/핀치: 수직 미세 이동 (±5cm)
- 오브젝트 마커: SphereGeometry 흰 구체, objects 시트 좌표에 배치

**우측 패널:**
- 2열 테이블: label(name/date) | value 형식
- memory_note: full-width 메모 행
- 하단: `Edit` 버튼 (항상 표시)

**Edit 버튼:**
- 클릭 → 브라우저 prompt로 PIN 4자리 입력
- `desk_id.split('-').pop()` 과 일치하면 `editor.html?edit={desk_id}` 로 이동
- 불일치시 알림

**GLB 로드:**
```javascript
const glbUrl = `https://www.googleapis.com/drive/v3/files/${desk.drive_file_id}?alt=media&key=${CONFIG.API_KEY}`;
```

---

### editor.html — 에디터 (업로드 + 시점 + 포인트)

**Step 1: 업로드**
- Google GIS OAuth 로그인 (localStorage에 토큰 캐시, 만료 전까지 재로그인 불필요)
- GLB 파일 선택 → Drive 공유 폴더에 multipart upload
- 업로드 완료 후 파일 공개 권한(`reader/anyone`) 설정
- OAuth token으로 직접 fetch → Blob URL → Three.js GLTFLoader

**Step 2: 시점 설정 (01 — viewpoint)**
- OrbitControls 활성화: 드래그 회전, 스크롤 줌, 우클릭 패닝
- 모델 bbox 기반으로 orbit.target 자동 설정 (정규화 없음)
- `시점 저장` 클릭 → `camera.position` + `orbit.target` 저장

**Step 3: 포인트 지정 (02 — points)**
- OrbitControls 비활성화
- 마우스 드래그: 시선 이동 (lookMode)
- 클릭 (5px 미만 이동): raycasting → 메쉬 히트 → ? 마커 생성
  - 모든 메쉬 DoubleSide 설정 (양면 raycasting 가능)
  - `raycaster.intersectObjects(meshes, false)` 방식
  - `getBoundingClientRect()` 기반 좌표 계산 (Retina DPR 대응)
- 메타데이터 폼: 이름 / 수집일 / 기억 메모 입력
- 저장 후 마커 ? → ! 로 교체 (SpriteMaterial texture 교체)

**Step 4: 제출 (03 — submit)**
- PIN 4자리 입력 (편집 비밀번호)
- `desk_id = {uuid 앞 8자리}-{pin}`
- Apps Script에 POST:
  ```json
  {
    "desk": { desk_id, owner, drive_file_id, cam_pos_*, cam_target_*, upload_date },
    "objects": [{ desk_id, object_id, name, collected_date, memory_note, x, y, z }, ...]
  }
  ```
- `mode: 'no-cors'`로 POST (Apps Script CORS 우회)

**Nav:**
- 좌상단: `Back` (박스형) → index.html
- 우상단: `Done` 버튼 (박스형, points/submit 단계에서만 표시) → 제출 트리거

---

## 7. Apps Script (Google Sheets 쓰기)

```javascript
function doPost(e) {
  const data  = JSON.parse(e.postData.contents);
  const ss    = SpreadsheetApp.openById('10Z8y13h03lpk1IoT0M3HsPw9ApVEGBI5IliDzFIp3y4');
  const desks = ss.getSheetByName('desks');
  const objs  = ss.getSheetByName('objects');
  const d = data.desk;
  desks.appendRow([d.desk_id, d.owner, d.drive_file_id, d.cam_pos_x, d.cam_pos_y, d.cam_pos_z,
    d.cam_target_x, d.cam_target_y, d.cam_target_z, d.upload_date]);
  data.objects.forEach(o => objs.appendRow([o.desk_id, o.object_id, o.name,
    o.collected_date, o.memory_note, o.x, o.y, o.z]));
  return ContentService.createTextOutput('ok');
}
```
- 배포 ID: `AKfycbydVJJ5iQEpng_kCuYS85TEg-DKLkM0DPio3OEup4bk51g2QfSg3reD6pFterd2PIysTw`
- 액세스: 모든 사용자

---

## 8. 디자인 시스템

**레퍼런스:** creativeapplications.net — 객관적, 공학적, 흰 바탕, 얇은 고딕, 기능적

| 항목 | 값 |
|------|-----|
| 폰트 | DM Sans 300 / 400 (Google Fonts) |
| 배경 | #ffffff |
| 텍스트 | #111111 |
| 보조 텍스트 | #888888 |
| 3차 텍스트 | #bbbbbb |
| 썸네일 기본 | #e8e8e8 |
| 타이틀 | fitHero JS로 뷰포트 폭 자동 fit |
| letter-spacing | 타이틀 -.02em / 레이블 .08~.14em uppercase |
| 패널 | width 280px, border-left 1px solid #111, translateX 400ms cubic-bezier(0.16,1,0.3,1) |
| Nav 버튼 | border 1px solid #111, padding 7px 18px, 12px 폰트 |
| hover | opacity .5 transition |

---

## 9. Canvas/WebGL 주의사항 (반드시 준수)

1. **좌표 계산** — `getBoundingClientRect()` 기준. `e.clientX / innerWidth` 방식 금지
2. **style 설정** — `style.cssText` 대신 개별 속성. Three.js의 width/height 보존
3. **DPR 대응** — resize 이벤트에서 `renderer.setPixelRatio(devicePixelRatio)` 재설정
4. **이벤트 바인딩** — canvas 직접 바인딩 (Safari document 이벤트 미작동)
5. **bbox 측정** — `model.updateMatrixWorld(true)` 후 `setFromObject()` 호출

---

## 10. 미완성 / 앞으로 할 것

### 즉시 필요
- [ ] **index.html fitHero 버그**: 현재 타이틀이 너무 작게 표시됨. `document.fonts.ready` + `width:fit-content` 방식으로 고쳐야 함. 확인 필요.
- [ ] **Desk 버튼 클릭** 동작 검증 (패널 열림 여부)
- [ ] **editor.html edit 모드**: `?edit={desk_id}` URL 파라미터 수신 시 기존 GLB 로드 + 포인트 수정 플로우 미구현

### 기능 추가
- [ ] **썸네일 이미지**: Sheets `desks` 시트에 `thumbnail_url` 컬럼 추가. 에디터에서 업로드 완료 시 Three.js canvas로 스크린샷 캡처 → Drive에 저장 → URL을 thumbnail_url에 기록
- [ ] **오브젝트 마커 클릭**: viewer.html에서 ! 마커를 클릭하면 해당 오브젝트 패널에서 하이라이트
- [ ] **우클릭 좌표 디버거**: 메쉬 위 마우스가 올라간 위치의 3D 좌표를 우하단에 실시간 표시 (오브젝트 좌표 입력용). 배포 후에도 제거하지 말 것.
- [ ] **패널 내 upload 폼**: index.html 패널 하단에 인라인 upload 시작 플로우 (스케치 page 2 하단 2열 폼 구조)
- [ ] **Sheets 연동 완전 검증**: Apps Script POST 실제 작동 여부 end-to-end 테스트 필요

### 디자인 미완
- [ ] **썸네일 hover**: 현재 `thumbnail_url` 없으면 그냥 회색. 텍스처 표시 로직은 있음
- [ ] **viewer.html 패널**: Edit 버튼 이후 편집 플로우 미구현
- [ ] **editor.html step-upload 화면**: 로그인 후 GLB 선택 UI 정리 필요

---

## 11. 알려진 버그

| 버그 | 원인 | 상태 |
|------|------|------|
| fitHero 타이틀 너무 작음 | block 요소 scrollWidth = viewport 폭으로 측정됨 | 패치 적용 (`fit-content`), 검증 필요 |
| viewer GLB 로드 느림 | Drive API 직접 스트리밍, 대용량 파일 | 미해결 |
| Apps Script POST 응답 없음 | `mode: no-cors` → opaque response | 정상 동작이나 성공 여부 확인 불가 |

---

## 12. 개발 환경

- 로컬 서버: `cd /Users/joon/Desktop/26-1/AskDesk && python3 -m http.server 3000`
- OAuth 승인된 출처: `https://kang-dongjoon.github.io`, `http://localhost:3000`, `http://localhost`
- Three.js r128 고정 (버전 변경 금지)
- GitHub main branch → GitHub Pages 자동 배포 (약 1-2분 소요)
