/**
 * ============================================================================
 * 🏎️ 카트라이더 스타일 3D 레이싱 & 드리프트 물리 엔진 - Step 2
 * (본격 서킷 트랙, 연석/가드레일 벽 충돌 물리, 랩 타임 & 실시간 미니맵 추가)
 * ============================================================================
 * [Step 2 핵심 추가 로직 설명 - 초보자 교육용]
 * 1. 곡선 서킷 생성 (CatmullRomCurve3):
 *    - 여러 개의 3D 기준점(웨이포인트)들을 부드러운 곡선으로 이어주는 수학 공식을 사용해
 *      직선 가속 구간, U자 헤어핀 코너, S자 복합 코너가 있는 레이싱 트랙을 만듭니다.
 * 2. 도로, 연석(Curb), 가드레일(Guardrail) 자동 배치:
 *    - 곡선을 따라 일정한 간격으로 점을 찍고, 도로 폭(좌/우 13.5m)만큼 벌려서
 *      아스팔트 도로와 빨강/하양 연석, 그리고 바깥쪽 방호벽을 입체 메쉬로 조립합니다.
 * 3. 가드레일 벽면 충돌 및 미끄러짐 물리:
 *    - 카트가 트랙 중심선에서 도로 폭 이상 벗어나면 벽에 부딪힌 것으로 판정합니다.
 *    - 이때 카트가 벽에 끼이지 않도록 트랙 안쪽으로 밀어내면서 진행 각도(moveAngle)를
 *      벽면 방향으로 자연스럽게 흘려보내 카트라이더 특유의 '벽 타기/튕김'을 구현합니다.
 * 4. 체크포인트 & 랩 타임(Lap Timer) 및 미니맵:
 *    - 꼼수(역주행) 방지를 위해 트랙의 4개 구역(섹터)을 순서대로 통과한 뒤 결승선을 넘으면
 *      1바퀴(Lap) 완주로 인정하고 최고 기록(Best Lap)을 경신합니다.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. Three.js 3D 세계(Scene), 카메라(Camera), 렌더러(Renderer) 초기화
// ----------------------------------------------------------------------------
const container = document.getElementById('game-canvas-container');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.FogExp2(0x0f172a, 0.0022);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  1200
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// ----------------------------------------------------------------------------
// 2. 조명(Lighting) 및 배경 잔디밭 바닥 생성
// ----------------------------------------------------------------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfffbeb, 0.95);
dirLight.position.set(120, 180, 100);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 500;
const shadowBound = 240;
dirLight.shadow.camera.left = -shadowBound;
dirLight.shadow.camera.right = shadowBound;
dirLight.shadow.camera.top = shadowBound;
dirLight.shadow.camera.bottom = -shadowBound;
scene.add(dirLight);

// 트랙 바깥쪽 배경이 될 잔디/그리드 바닥 텍스처 생성
function createGrassGridTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#064e3b';
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#065f46';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillRect(256, 256, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(90, 90);
  return texture;
}

const groundGeo = new THREE.PlaneGeometry(1400, 1400);
const groundMat = new THREE.MeshStandardMaterial({
  map: createGrassGridTexture(),
  roughness: 0.95
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.y = -0.05;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// ----------------------------------------------------------------------------
// 3. 본격 레이싱 서킷 트랙(Circuit Track) 설계 및 3D 메쉬 생성
// ----------------------------------------------------------------------------
// 트랙의 중심선 기준점(Waypoints) 정의:
// 홈 스트레이트(직선) -> 1번 고속 코너 -> 상단 헤어핀 코너 -> S자 연속 코너 -> 하단 헤어핀 -> 결승선 복귀
const trackWaypoints = [
  new THREE.Vector3(110, 0, 60),    // 출발선 직전
  new THREE.Vector3(110, 0, 0),     // 🏁 출발/결승선 (직선 가속 구간)
  new THREE.Vector3(110, 0, -95),   // 메인 직선 끝
  new THREE.Vector3(75, 0, -155),   // 1번 코너 진입
  new THREE.Vector3(0, 0, -165),    // 상단 직선 구간
  new THREE.Vector3(-85, 0, -150),  // 2번 코너 (넓은 좌코너)
  new THREE.Vector3(-135, 0, -85),  // S자 코너 진입
  new THREE.Vector3(-90, 0, -25),   // S자 코너 안쪽 깊숙한 헤어핀(드리프트 포인트!)
  new THREE.Vector3(-140, 0, 45),   // S자 코너 탈출
  new THREE.Vector3(-115, 0, 130),  // 하단 좌코너
  new THREE.Vector3(-25, 0, 155),   // 하단 롱 코너
  new THREE.Vector3(70, 0, 135)     // 마지막 코너 탈출 후 홈 스트레이트 연결
];

// 닫힌 곡선(closed = true)으로 매끄러운 서킷 스플라인을 생성합니다.
const trackCurve = new THREE.CatmullRomCurve3(trackWaypoints, true, 'catmullrom', 0.5);

const TRACK_HALF_WIDTH = 13.5; // 도로 중심에서 양옆 끝까지의 폭 (전체 도로 폭 = 27m)
const CURB_WIDTH = 1.8;        // 빨강-하양 연석의 폭
const TRACK_SAMPLES = 420;     // 트랙을 쪼개어 계산할 정밀도 샘플 개수
const trackSamples = [];       // 충돌 판정과 미니맵에서 사용할 트랙 샘플 데이터 배열

// 트랙 샘플 데이터를 미리 계산하여 저장해 둡니다.
for (let i = 0; i < TRACK_SAMPLES; i++) {
  const t = i / TRACK_SAMPLES;
  const point = trackCurve.getPointAt(t);
  const tangent = trackCurve.getTangentAt(t).normalize();
  // 진행 방향(tangent)에 수직인 오른쪽 방향 벡터(right) 계산
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  // 진행 방향을 Three.js 카트 회전각(carHeading) 체계로 변환한 각도
  const forwardHeading = Math.atan2(-tangent.x, -tangent.z);

  trackSamples.push({
    index: i,
    t,
    point,
    tangent,
    right,
    forwardHeading
  });
}

// 아스팔트 도로 표면 텍스처(차선 포함) 생성 함수
function createRoadSurfaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 진한 아스팔트 바닥
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 512, 512);

  // 아스팔트 질감 라인
  ctx.fillStyle = '#263449';
  ctx.fillRect(40, 0, 432, 512);

  // 양옆 흰색 실선 차선
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(18, 0, 14, 512);
  ctx.fillRect(480, 0, 14, 512);

  // 중앙 점선
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(250, 40, 12, 180);
  ctx.fillRect(250, 300, 12, 180);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 55);
  return texture;
}

// 빨강-하양 연석(Curb) 텍스처 생성 함수
function createCurbTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ef4444';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 128, 64, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 110);
  return texture;
}

// 서킷 도로와 양옆 연석, 그리고 가드레일 벽면을 3D 리본 메쉬로 생성하는 함수
function buildCircuitTrackMeshes() {
  const roadPositions = [];
  const roadUVs = [];
  const roadIndices = [];

  const leftCurbPositions = [];
  const rightCurbPositions = [];
  const curbUVs = [];
  const curbIndices = [];

  for (let i = 0; i <= TRACK_SAMPLES; i++) {
    const sample = trackSamples[i % TRACK_SAMPLES];
    const vCoord = i / TRACK_SAMPLES;

    // 도로 좌/우 끝점 계산
    const leftRoadPt = sample.point.clone().addScaledVector(sample.right, -TRACK_HALF_WIDTH);
    const rightRoadPt = sample.point.clone().addScaledVector(sample.right, TRACK_HALF_WIDTH);

    roadPositions.push(leftRoadPt.x, 0.02, leftRoadPt.z);
    roadPositions.push(rightRoadPt.x, 0.02, rightRoadPt.z);
    roadUVs.push(0, vCoord, 1, vCoord);

    // 좌/우 연석 바깥쪽 끝점 계산
    const leftCurbOuter = sample.point.clone().addScaledVector(sample.right, -(TRACK_HALF_WIDTH + CURB_WIDTH));
    const rightCurbOuter = sample.point.clone().addScaledVector(sample.right, TRACK_HALF_WIDTH + CURB_WIDTH);

    leftCurbPositions.push(leftCurbOuter.x, 0.06, leftCurbOuter.z);
    leftCurbPositions.push(leftRoadPt.x, 0.06, leftRoadPt.z);

    rightCurbPositions.push(rightRoadPt.x, 0.06, rightRoadPt.z);
    rightCurbPositions.push(rightCurbOuter.x, 0.06, rightCurbOuter.z);
    curbUVs.push(0, vCoord, 1, vCoord);

    if (i < TRACK_SAMPLES) {
      const base = i * 2;
      roadIndices.push(base, base + 1, base + 2);
      roadIndices.push(base + 1, base + 3, base + 2);

      curbIndices.push(base, base + 1, base + 2);
      curbIndices.push(base + 1, base + 3, base + 2);
    }
  }

  // (1) 아스팔트 도로 메쉬 생성
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const roadMesh = new THREE.Mesh(
    roadGeo,
    new THREE.MeshStandardMaterial({
      map: createRoadSurfaceTexture(),
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    })
  );
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  // (2) 좌/우 빨강-하양 연석 메쉬 생성
  const curbMat = new THREE.MeshStandardMaterial({
    map: createCurbTexture(),
    roughness: 0.6,
    side: THREE.DoubleSide
  });

  const leftCurbGeo = new THREE.BufferGeometry();
  leftCurbGeo.setAttribute('position', new THREE.Float32BufferAttribute(leftCurbPositions, 3));
  leftCurbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUVs, 2));
  leftCurbGeo.setIndex(curbIndices);
  leftCurbGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(leftCurbGeo, curbMat));

  const rightCurbGeo = new THREE.BufferGeometry();
  rightCurbGeo.setAttribute('position', new THREE.Float32BufferAttribute(rightCurbPositions, 3));
  rightCurbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUVs, 2));
  rightCurbGeo.setIndex(curbIndices);
  rightCurbGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(rightCurbGeo, curbMat));

  // (3) 트랙 양옆 가드레일(방호벽) 기둥과 네온 가이드 블록 배치
  const postGeo = new THREE.BoxGeometry(0.8, 1.4, 2.2);
  const blueWallMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });
  const whiteWallMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });

  for (let i = 0; i < TRACK_SAMPLES; i += 3) {
    const sample = trackSamples[i];
    const mat = (i / 3) % 2 === 0 ? blueWallMat : whiteWallMat;
    const wallDist = TRACK_HALF_WIDTH + CURB_WIDTH + 0.5;

    const leftWall = new THREE.Mesh(postGeo, mat);
    const leftPos = sample.point.clone().addScaledVector(sample.right, -wallDist);
    leftWall.position.set(leftPos.x, 0.7, leftPos.z);
    leftWall.rotation.y = sample.forwardHeading;
    leftWall.castShadow = true;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(postGeo, mat);
    const rightPos = sample.point.clone().addScaledVector(sample.right, wallDist);
    rightWall.position.set(rightPos.x, 0.7, rightPos.z);
    rightWall.rotation.y = sample.forwardHeading;
    rightWall.castShadow = true;
    scene.add(rightWall);
  }

  // (4) 🏁 출발/결승선 아치 게이트(Start/Finish Gate) 및 체크무늬 바닥 생성
  const startSample = trackSamples[Math.floor(TRACK_SAMPLES * 0.08)]; // 직선 구간 위치
  buildStartFinishGate(startSample);
  return startSample;
}

// 결승선 체크무늬 바닥과 아치형 구조물을 만드는 함수
function buildStartFinishGate(startSample) {
  const gateGroup = new THREE.Group();
  gateGroup.position.copy(startSample.point);
  gateGroup.rotation.y = startSample.forwardHeading;
  scene.add(gateGroup);

  // 체크무늬 결승선 텍스처
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111827';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const checkerTex = new THREE.CanvasTexture(canvas);

  // 바닥 결승선 패드
  const finishLineMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2, 4.0),
    new THREE.MeshBasicMaterial({ map: checkerTex })
  );
  finishLineMesh.rotation.x = -Math.PI / 2;
  finishLineMesh.position.y = 0.05;
  gateGroup.add(finishLineMesh);

  // 양옆 아치 기둥과 상단 간판
  const pillarGeo = new THREE.CylinderGeometry(0.7, 0.7, 9, 16);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.3 });

  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-TRACK_HALF_WIDTH - 1, 4.5, 0);
  gateGroup.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(TRACK_HALF_WIDTH + 1, 4.5, 0);
  gateGroup.add(rightPillar);

  const topBanner = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2 + 4, 1.8, 1.2),
    new THREE.MeshStandardMaterial({ map: checkerTex })
  );
  topBanner.position.set(0, 8.6, 0);
  gateGroup.add(topBanner);
}

const startFinishSample = buildCircuitTrackMeshes();

// ----------------------------------------------------------------------------
// 4. 카트라이더 스타일 3D 카트(Kart) 모델 만들기
// ----------------------------------------------------------------------------
const kartRoot = new THREE.Group();
scene.add(kartRoot);

const kartBodyTiltGroup = new THREE.Group();
kartRoot.add(kartBodyTiltGroup);

const bodyMat = new THREE.MeshStandardMaterial({
  color: 0xe11d48,
  roughness: 0.25,
  metalness: 0.35
});
const whiteMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.3
});
const darkMetalMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.5,
  metalness: 0.6
});

const mainChassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 3.4), bodyMat);
mainChassis.position.set(0, 0.5, 0);
mainChassis.castShadow = true;
kartBodyTiltGroup.add(mainChassis);

const frontNose = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 0.9), whiteMat);
frontNose.position.set(0, 0.45, -1.9);
frontNose.castShadow = true;
kartBodyTiltGroup.add(frontNose);

const leftPod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 2.0), whiteMat);
leftPod.position.set(-1.15, 0.52, 0.1);
leftPod.castShadow = true;
kartBodyTiltGroup.add(leftPod);

const rightPod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 2.0), whiteMat);
rightPod.position.set(1.15, 0.52, 0.1);
rightPod.castShadow = true;
kartBodyTiltGroup.add(rightPod);

const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), darkMetalMat);
seatMesh.position.set(0, 0.9, 0.25);
kartBodyTiltGroup.add(seatMesh);

const helmetMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2 });
const driverHead = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 20), helmetMat);
driverHead.position.set(0, 1.55, 0.15);
driverHead.castShadow = true;
kartBodyTiltGroup.add(driverHead);

const goggleMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.68, 0.24, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.4 })
);
goggleMesh.position.set(0, 1.58, -0.25);
kartBodyTiltGroup.add(goggleMesh);

const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.14, 0.55), whiteMat);
spoilerWing.position.set(0, 1.25, 1.55);
spoilerWing.castShadow = true;
kartBodyTiltGroup.add(spoilerWing);

const boosterFlames = [];
const exhaustPositions = [-0.55, 0.55];
exhaustPositions.forEach((xPos) => {
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 12), darkMetalMat);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(xPos, 0.72, 1.75);
  kartBodyTiltGroup.add(pipe);

  const flameGeo = new THREE.ConeGeometry(0.26, 1.6, 12);
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.0
  });
  const flameMesh = new THREE.Mesh(flameGeo, flameMat);
  flameMesh.position.set(xPos, 0.72, 2.65);
  kartBodyTiltGroup.add(flameMesh);
  boosterFlames.push(flameMesh);
});

const wheelMeshes = [];
const frontWheelPivotL = new THREE.Group();
const frontWheelPivotR = new THREE.Group();
frontWheelPivotL.position.set(-1.15, 0.42, -1.25);
frontWheelPivotR.position.set(1.15, 0.42, -1.25);
kartRoot.add(frontWheelPivotL);
kartRoot.add(frontWheelPivotR);

function createWheelMesh() {
  const wheelGroup = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  wheelGroup.add(tire);

  const rimGeo = new THREE.BoxGeometry(0.41, 0.5, 0.14);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.5 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  wheelGroup.add(rim);

  return wheelGroup;
}

const wheelFL = createWheelMesh();
const wheelFR = createWheelMesh();
frontWheelPivotL.add(wheelFL);
frontWheelPivotR.add(wheelFR);

const wheelRL = createWheelMesh();
const wheelRR = createWheelMesh();
wheelRL.position.set(-1.2, 0.42, 1.2);
wheelRR.position.set(1.2, 0.42, 1.2);
kartRoot.add(wheelRL);
kartRoot.add(wheelRR);

wheelMeshes.push(wheelFL, wheelFR, wheelRL, wheelRR);

// ----------------------------------------------------------------------------
// 5. 키보드 입력 상태 관리
// ----------------------------------------------------------------------------
const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  shift: false
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'KeyW') {
    if (!keys.up) {
      tryTriggerInstantBoostOnUpPress();
    }
    keys.up = true;
  }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = true;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;

  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Space') {
    e.preventDefault();
    activateN2OBooster();
  }

  if (e.code === 'KeyR') {
    recoverKartToTrackCenter();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
  if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
});

// ----------------------------------------------------------------------------
// 6. 카트 물리 상태 및 레이스(Lap/체크포인트) 변수 정의
// ----------------------------------------------------------------------------
const kartState = {
  x: startFinishSample.point.x,
  z: startFinishSample.point.z,
  speed: 0,
  maxNormalSpeed: 46,
  maxNitroSpeed: 68,
  maxInstantBoostSpeed: 58,

  carHeading: startFinishSample.forwardHeading,
  moveAngle: startFinishSample.forwardHeading,
  slipAngle: 0,

  isDrifting: false,
  driftDirection: 0,
  driftTime: 0,
  counterSteerActive: false,

  instantBoostWindow: 0,
  instantBoostTimer: 0,

  nitroTimer: 0,
  boostGauge: 0,
  boosterSlots: 0,

  cameraAngle: startFinishSample.forwardHeading,
  closestTrackIndex: startFinishSample.index,
  wallHitCooldown: 0
};

// 레이스 랩 타임 및 체크포인트(4개 구역) 관리 객체
const raceState = {
  currentLap: 1,
  totalLaps: 3,
  lapStartTime: performance.now(),
  currentLapSeconds: 0,
  bestLapSeconds: null,
  passedSectors: new Set([0]) // 0, 1, 2, 3 네 구역을 모두 지나야 한 바퀴 인정!
};

// [R] 키를 눌렀을 때 현재 위치에서 가장 가까운 트랙 중앙으로 카트를 정렬해 주는 함수
function recoverKartToTrackCenter() {
  const sample = trackSamples[kartState.closestTrackIndex];
  kartState.x = sample.point.x;
  kartState.z = sample.point.z;
  kartState.speed = 0;
  kartState.carHeading = sample.forwardHeading;
  kartState.moveAngle = sample.forwardHeading;
  kartState.slipAngle = 0;
  kartState.isDrifting = false;
  showStatusBanner('🔄 트랙 중앙 복귀 완료!', '#38bdf8');
}

function tryTriggerInstantBoostOnUpPress() {
  if (kartState.instantBoostWindow > 0 && kartState.nitroTimer <= 0) {
    kartState.instantBoostWindow = 0;
    kartState.instantBoostTimer = 0.65;
    kartState.speed = Math.max(kartState.speed + 11, kartState.maxNormalSpeed * 1.12);
    showStatusBanner('⚡ 순간 부스터! (INSTANT BOOST)', '#fde047');
  }
}

function activateN2OBooster() {
  if (kartState.boosterSlots > 0 && kartState.nitroTimer <= 0) {
    kartState.boosterSlots -= 1;
    kartState.nitroTimer = 2.8;
    kartState.instantBoostWindow = 0;
    kartState.speed = Math.max(kartState.speed + 14, kartState.maxNormalSpeed * 1.18);
    updateBoosterSlotUI();
    showStatusBanner('🔥 N2O 부스터 발동!!', '#38bdf8');
  }
}

// ----------------------------------------------------------------------------
// 7. UI 및 미니맵 업데이트 도우미 함수들
// ----------------------------------------------------------------------------
const statusTextEl = document.getElementById('status-text');
const instantHintEl = document.getElementById('instant-boost-hint');
const boostGaugeFillEl = document.getElementById('boost-gauge-fill');
const boostGaugeTextEl = document.getElementById('boost-gauge-text');
const speedValueEl = document.getElementById('speed-value');
const driftAngleInfoEl = document.getElementById('drift-angle-info');
const slot0El = document.getElementById('slot-0');
const slot1El = document.getElementById('slot-1');

const lapCountTextEl = document.getElementById('lap-count-text');
const currentLapTimeEl = document.getElementById('current-lap-time');
const bestLapTimeEl = document.getElementById('best-lap-time');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');

let bannerTimeout = null;
function showStatusBanner(message, color) {
  statusTextEl.textContent = message;
  statusTextEl.style.color = color;
  statusTextEl.classList.add('active');

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    statusTextEl.classList.remove('active');
  }, 950);
}

function updateBoosterSlotUI() {
  const slots = [slot0El, slot1El];
  slots.forEach((slotEl, idx) => {
    const iconEl = slotEl.querySelector('.booster-icon');
    const labelEl = slotEl.querySelector('.booster-label');
    if (idx < kartState.boosterSlots) {
      slotEl.classList.add('has-booster');
      iconEl.textContent = 'N2O';
      labelEl.textContent = 'Ctrl / Space';
    } else {
      slotEl.classList.remove('has-booster');
      iconEl.textContent = 'EMPTY';
      labelEl.textContent = `SLOT ${idx + 1}`;
    }
  });
}

// 초(Seconds)를 00:00.00 형식의 문자열로 바꿔주는 함수
function formatLapTime(sec) {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  const hundredths = Math.floor((sec % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function normalizeAngleDiff(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// ----------------------------------------------------------------------------
// 8. 트랙 벽면 충돌 물리 및 체크포인트/결승선 통과 검사 (Step 2 핵심)
// ----------------------------------------------------------------------------
function handleTrackCollisionAndProgress(dt) {
  if (kartState.wallHitCooldown > 0) {
    kartState.wallHitCooldown = Math.max(0, kartState.wallHitCooldown - dt);
  }

  // (1) 현재 카트 좌표(x, z)에서 가장 가까운 트랙 중심선 샘플 찾기
  let bestIdx = kartState.closestTrackIndex;
  let minDistSq = Infinity;

  for (let i = 0; i < TRACK_SAMPLES; i++) {
    const pt = trackSamples[i].point;
    const dx = kartState.x - pt.x;
    const dz = kartState.z - pt.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestIdx = i;
    }
  }

  const prevIdx = kartState.closestTrackIndex;
  kartState.closestTrackIndex = bestIdx;
  const sample = trackSamples[bestIdx];

  // (2) 트랙 중심선으로부터 좌/우로 얼마나 떨어져 있는지(lateralOffset) 계산
  const dx = kartState.x - sample.point.x;
  const dz = kartState.z - sample.point.z;
  const lateralOffset = dx * sample.right.x + dz * sample.right.z;

  // 가드레일 벽까지의 허용 거리 (도로 폭 + 연석 일부)
  const maxAllowedOffset = TRACK_HALF_WIDTH + 0.6;

  // 만약 카트가 가드레일 벽에 부딪혔다면!
  if (Math.abs(lateralOffset) > maxAllowedOffset) {
    const sign = Math.sign(lateralOffset);
    // 카트 좌표를 벽 안쪽으로 즉시 밀어 넣어 벽 뚫림을 방지합니다.
    const clampedOffset = sign * maxAllowedOffset;
    kartState.x = sample.point.x + sample.right.x * clampedOffset;
    kartState.z = sample.point.z + sample.right.z * clampedOffset;

    // 진행 각도(moveAngle)를 트랙 진행 방향으로 부드럽게 꺾어주어 벽을 타고 미끄러지게 합니다.
    const angleToTrack = normalizeAngleDiff(sample.forwardHeading - kartState.moveAngle);
    if (Math.abs(angleToTrack) < Math.PI * 0.75) {
      kartState.moveAngle += angleToTrack * 0.48;
      kartState.carHeading += normalizeAngleDiff(sample.forwardHeading - kartState.carHeading) * 0.25;
    }

    // 벽 충돌 시 속도 감속 처리
    if (kartState.wallHitCooldown <= 0 && Math.abs(kartState.speed) > 20) {
      kartState.speed *= 0.84;
      kartState.wallHitCooldown = 0.25;
      showStatusBanner('💥 가드레일 충돌!', '#f87171');
    }
  }

  // (3) 체크포인트(4개 섹터) 통과 기록 및 결승선 통과(Lap 완주) 판정
  const startIdx = startFinishSample.index;
  // 출발선을 기준으로 현재 트랙 진행률(0.0 ~ 1.0)을 계산합니다.
  const progress = ((bestIdx - startIdx + TRACK_SAMPLES) % TRACK_SAMPLES) / TRACK_SAMPLES;
  const currentSector = Math.floor(progress * 4); // 0, 1, 2, 3 구역
  raceState.passedSectors.add(currentSector);

  // 이전 프레임에는 마지막 구역(3번)에 있다가 이번 프레임에 출발선(0번 구역 초반)을 넘었을 때!
  const prevProgress = ((prevIdx - startIdx + TRACK_SAMPLES) % TRACK_SAMPLES) / TRACK_SAMPLES;
  if (prevProgress > 0.85 && progress < 0.15 && raceState.passedSectors.size >= 4) {
    // 1바퀴 완주 성공!
    const finishedLapTime = (performance.now() - raceState.lapStartTime) / 1000;
    if (raceState.bestLapSeconds === null || finishedLapTime < raceState.bestLapSeconds) {
      raceState.bestLapSeconds = finishedLapTime;
      bestLapTimeEl.textContent = formatLapTime(raceState.bestLapSeconds);
      showStatusBanner(`🏆 베스트 랩 경신! (${formatLapTime(finishedLapTime)})`, '#fde047');
    } else {
      showStatusBanner(`🏁 LAP ${raceState.currentLap} 완주! (${formatLapTime(finishedLapTime)})`, '#38bdf8');
    }

    raceState.currentLap += 1;
    raceState.lapStartTime = performance.now();
    raceState.passedSectors = new Set([0]);
    lapCountTextEl.textContent = `${Math.min(raceState.currentLap, raceState.totalLaps)} / ${raceState.totalLaps}`;
  }
}

// ----------------------------------------------------------------------------
// 9. 카트라이더 드리프트 & 주행 물리 엔진 업데이트
// ----------------------------------------------------------------------------
function updateKartPhysics(dt) {
  if (kartState.nitroTimer > 0) {
    kartState.nitroTimer = Math.max(0, kartState.nitroTimer - dt);
  }
  if (kartState.instantBoostTimer > 0) {
    kartState.instantBoostTimer = Math.max(0, kartState.instantBoostTimer - dt);
  }
  if (kartState.instantBoostWindow > 0) {
    kartState.instantBoostWindow = Math.max(0, kartState.instantBoostWindow - dt);
  }

  let currentMaxSpeed = kartState.maxNormalSpeed;
  let accelRate = 34;

  if (kartState.nitroTimer > 0) {
    currentMaxSpeed = kartState.maxNitroSpeed;
    accelRate = 62;
  } else if (kartState.instantBoostTimer > 0) {
    currentMaxSpeed = kartState.maxInstantBoostSpeed;
    accelRate = 54;
  }

  if (keys.up) {
    kartState.speed += accelRate * dt;
  } else if (keys.down) {
    if (kartState.speed > 0) {
      kartState.speed -= 55 * dt;
    } else {
      kartState.speed -= 22 * dt;
    }
  } else {
    kartState.speed *= Math.pow(0.28, dt);
    if (Math.abs(kartState.speed) < 0.3) kartState.speed = 0;
  }

  if (kartState.speed > currentMaxSpeed) {
    kartState.speed = THREE.MathUtils.lerp(kartState.speed, currentMaxSpeed, dt * 4.5);
  }
  if (kartState.speed < -18) {
    kartState.speed = -18;
  }

  let steerInput = 0;
  if (keys.left) steerInput += 1;
  if (keys.right) steerInput -= 1;

  const speedFactor = Math.min(1, Math.abs(kartState.speed) / 10);
  const reverseSign = kartState.speed >= 0 ? 1 : -1;

  // Shift + 방향키 드리프트 진입
  if (keys.shift && Math.abs(steerInput) > 0 && kartState.speed > 14) {
    if (!kartState.isDrifting) {
      kartState.isDrifting = true;
      kartState.driftDirection = steerInput;
      kartState.driftTime = 0;
      kartState.instantBoostWindow = 0;
    }
  }

  if (kartState.isDrifting) {
    kartState.driftTime += dt;

    const isCounterSteering =
      steerInput !== 0 && Math.sign(steerInput) !== Math.sign(kartState.driftDirection);
    kartState.counterSteerActive = isCounterSteering;

    let turnRate = 0;
    if (steerInput === kartState.driftDirection) {
      turnRate = steerInput * 3.15;
    } else if (isCounterSteering) {
      turnRate = steerInput * 2.25;
    } else {
      turnRate = kartState.driftDirection * 0.95;
    }

    kartState.carHeading += turnRate * speedFactor * dt;

    const maxSlip = 1.12;
    let currentSlip = normalizeAngleDiff(kartState.carHeading - kartState.moveAngle);
    if (Math.abs(currentSlip) > maxSlip) {
      kartState.carHeading = kartState.moveAngle + Math.sign(currentSlip) * maxSlip;
      currentSlip = normalizeAngleDiff(kartState.carHeading - kartState.moveAngle);
    }

    let gripFollowRate = 2.1;
    if (keys.shift) {
      gripFollowRate = 1.45;
    }
    if (isCounterSteering) {
      gripFollowRate = 4.8;
    }

    kartState.moveAngle += currentSlip * gripFollowRate * dt;
    kartState.slipAngle = normalizeAngleDiff(kartState.carHeading - kartState.moveAngle);

    const driftDrag = isCounterSteering ? 0.992 : 0.985;
    kartState.speed *= Math.pow(driftDrag, dt * 15);

    // 드리프트 N2O 게이지 충전
    const chargeAmount = Math.abs(kartState.slipAngle) * (kartState.speed / 35) * 58 * dt;
    kartState.boostGauge += chargeAmount;

    if (kartState.boostGauge >= 100) {
      if (kartState.boosterSlots < 2) {
        kartState.boosterSlots += 1;
        kartState.boostGauge -= 100;
        updateBoosterSlotUI();
        showStatusBanner('🎁 N2O 부스터 획득! (Ctrl/Space)', '#f43f5e');
      } else {
        kartState.boostGauge = 100;
      }
    }

    const slipThreshold = isCounterSteering ? 0.26 : 0.14;
    if ((!keys.shift && Math.abs(kartState.slipAngle) < slipThreshold) || kartState.speed < 10) {
      if (kartState.driftTime >= 0.22 && kartState.speed >= 12) {
        kartState.instantBoostWindow = 0.55;
        if (isCounterSteering && keys.up && kartState.nitroTimer <= 0) {
          tryTriggerInstantBoostOnUpPress();
        }
      }
      kartState.isDrifting = false;
      kartState.counterSteerActive = false;
    }
  } else {
    const normalTurnRate = 2.05;
    kartState.carHeading += steerInput * normalTurnRate * speedFactor * reverseSign * dt;

    const diff = normalizeAngleDiff(kartState.carHeading - kartState.moveAngle);
    kartState.moveAngle += diff * Math.min(1, dt * 14);
    kartState.slipAngle = normalizeAngleDiff(kartState.carHeading - kartState.moveAngle);
  }

  // 이동 벡터 반영
  kartState.x -= Math.sin(kartState.moveAngle) * kartState.speed * dt;
  kartState.z -= Math.cos(kartState.moveAngle) * kartState.speed * dt;

  // 트랙 벽면 충돌 및 랩 타임 체크 실행
  handleTrackCollisionAndProgress(dt);

  // 3D 카트 위치 및 서스펜션 애니메이션 업데이트
  kartRoot.position.set(kartState.x, 0, kartState.z);
  kartRoot.rotation.y = kartState.carHeading;

  const targetRoll = -kartState.slipAngle * 0.35 - steerInput * 0.08 * speedFactor;
  kartBodyTiltGroup.rotation.z = THREE.MathUtils.lerp(kartBodyTiltGroup.rotation.z, targetRoll, dt * 10);

  let targetPitch = 0;
  if (kartState.nitroTimer > 0) targetPitch = 0.09;
  else if (kartState.instantBoostTimer > 0) targetPitch = 0.06;
  else if (keys.down && kartState.speed > 5) targetPitch = -0.06;
  kartBodyTiltGroup.rotation.x = THREE.MathUtils.lerp(kartBodyTiltGroup.rotation.x, targetPitch, dt * 10);

  const targetFrontWheelSteer = steerInput * 0.45;
  frontWheelPivotL.rotation.y = THREE.MathUtils.lerp(frontWheelPivotL.rotation.y, targetFrontWheelSteer, dt * 15);
  frontWheelPivotR.rotation.y = THREE.MathUtils.lerp(frontWheelPivotR.rotation.y, targetFrontWheelSteer, dt * 15);

  wheelMeshes.forEach((wheel) => {
    wheel.rotation.x -= (kartState.speed * dt) / 0.42;
  });

  const isBoosting = kartState.nitroTimer > 0 || kartState.instantBoostTimer > 0;
  boosterFlames.forEach((flame) => {
    if (isBoosting) {
      flame.material.opacity = 0.85 + Math.random() * 0.15;
      flame.material.color.setHex(kartState.nitroTimer > 0 ? 0x38bdf8 : 0xfacc15);
      const scalePulse = 0.9 + Math.random() * 0.45;
      flame.scale.set(scalePulse, scalePulse, scalePulse * (kartState.nitroTimer > 0 ? 1.4 : 1.0));
    } else {
      flame.material.opacity = 0;
    }
  });
}

// ----------------------------------------------------------------------------
// 10. 스프링 추적 카메라 업데이트
// ----------------------------------------------------------------------------
function updateSpringCamera(dt) {
  const desiredCamAngle = kartState.moveAngle + normalizeAngleDiff(kartState.carHeading - kartState.moveAngle) * 0.55;
  const angleDiff = normalizeAngleDiff(desiredCamAngle - kartState.cameraAngle);
  kartState.cameraAngle += angleDiff * Math.min(1, dt * 8.5);

  let targetFov = 62 + (Math.abs(kartState.speed) / kartState.maxNormalSpeed) * 6;
  if (kartState.nitroTimer > 0) targetFov = 82;
  else if (kartState.instantBoostTimer > 0) targetFov = 75;

  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, dt * 8);
  camera.updateProjectionMatrix();

  const camDistance = 8.8;
  const camHeight = 4.2;
  const camX = kartState.x + Math.sin(kartState.cameraAngle) * camDistance;
  const camZ = kartState.z + Math.cos(kartState.cameraAngle) * camDistance;

  camera.position.set(camX, camHeight, camZ);

  const lookAheadX = kartState.x - Math.sin(kartState.carHeading) * 3.8;
  const lookAheadZ = kartState.z - Math.cos(kartState.carHeading) * 3.8;
  camera.lookAt(lookAheadX, 1.2, lookAheadZ);
}

// ----------------------------------------------------------------------------
// 11. 실시간 미니맵(Minimap) 그리기 함수
// ----------------------------------------------------------------------------
function drawMinimap() {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, w, h);

  // 월드 좌표(-180 ~ +180)를 미니맵 캔버스 좌표(0 ~ 190)로 변환하는 도우미 함수
  const scale = 0.48;
  const toMapX = (wx) => w / 2 + wx * scale;
  const toMapY = (wz) => h / 2 + wz * scale;

  // (1) 서킷 트랙 외곽선 그리기
  minimapCtx.beginPath();
  trackSamples.forEach((sample, idx) => {
    const mx = toMapX(sample.point.x);
    const my = toMapY(sample.point.z);
    if (idx === 0) minimapCtx.moveTo(mx, my);
    else minimapCtx.lineTo(mx, my);
  });
  minimapCtx.closePath();
  minimapCtx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  minimapCtx.lineWidth = 10;
  minimapCtx.stroke();

  minimapCtx.strokeStyle = '#1e293b';
  minimapCtx.lineWidth = 6;
  minimapCtx.stroke();

  // (2) 출발/결승선 위치 표시 (노란색 마커)
  const sfX = toMapX(startFinishSample.point.x);
  const sfY = toMapY(startFinishSample.point.z);
  minimapCtx.fillStyle = '#fde047';
  minimapCtx.beginPath();
  minimapCtx.arc(sfX, sfY, 5, 0, Math.PI * 2);
  minimapCtx.fill();

  // (3) 내 카트의 현재 위치와 바라보는 방향 화살표 그리기
  const kx = toMapX(kartState.x);
  const ky = toMapY(kartState.z);

  minimapCtx.save();
  minimapCtx.translate(kx, ky);
  minimapCtx.rotate(-kartState.carHeading);

  // 카트 방향 삼각형 아이콘
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);
  minimapCtx.lineTo(-6, 6);
  minimapCtx.lineTo(6, 6);
  minimapCtx.closePath();
  minimapCtx.fillStyle = kartState.isDrifting ? '#fb7185' : '#38bdf8';
  minimapCtx.fill();
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 1.5;
  minimapCtx.stroke();
  minimapCtx.restore();
}

// ----------------------------------------------------------------------------
// 12. 계기판(HUD) 수치 업데이트 및 메인 게임 루프
// ----------------------------------------------------------------------------
function updateHUD(now) {
  const displayKmh = Math.round(Math.abs(kartState.speed) * 4.35);
  speedValueEl.textContent = displayKmh;

  const slipDegrees = Math.round(Math.abs(THREE.MathUtils.radToDeg(kartState.slipAngle)));
  if (kartState.isDrifting) {
    driftAngleInfoEl.textContent = `🔥 드리프트 중! 슬립 각도: ${slipDegrees}°`;
    driftAngleInfoEl.style.color = '#fb7185';
  } else {
    driftAngleInfoEl.textContent = `슬립 각도(Slip Angle): ${slipDegrees}°`;
    driftAngleInfoEl.style.color = '#94a3b8';
  }

  if (kartState.instantBoostWindow > 0 && kartState.nitroTimer <= 0 && kartState.instantBoostTimer <= 0) {
    instantHintEl.classList.add('visible');
  } else {
    instantHintEl.classList.remove('visible');
  }

  const gaugePercent = Math.min(100, Math.floor(kartState.boostGauge));
  boostGaugeFillEl.style.width = `${gaugePercent}%`;
  boostGaugeTextEl.textContent = `N2O GAUGE : ${gaugePercent}%`;

  // 현재 랩 타임 실시간 갱신
  raceState.currentLapSeconds = (now - raceState.lapStartTime) / 1000;
  currentLapTimeEl.textContent = formatLapTime(raceState.currentLapSeconds);

  // 미니맵 실시간 그리기
  drawMinimap();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastFrameTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  updateKartPhysics(dt);
  updateSpringCamera(dt);
  updateHUD(now);

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
