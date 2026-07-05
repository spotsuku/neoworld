import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ZONES } from "./engine/population.js";
import { mulberry32 } from "./engine/population.js";

/* ============================================================
   NEOタウン 3Dビュー(表示専用 — シミュレーションのロジックには一切影響しない)
   - 2Dマップと同じ px/py(%)座標をワールド座標に写像
   - ドラッグで回転 / 右ドラッグでパン / ホイールでズーム
   - 住民クリックで onSelect(id)
   ============================================================ */

// %座標(0..100) → ワールド座標(±70)
const W = (p) => (p - 50) * 1.4;

// 住民カラー("hsl(200 70% 60%)" 形式や16進)を THREE.Color に変換
function toColor(str) {
  const m = /hsl\((\d+)[ ,]+(\d+)%[ ,]+(\d+)%\)/.exec(str || "");
  if (m) return new THREE.Color().setHSL(+m[1] / 360, +m[2] / 100, +m[3] / 100, THREE.SRGBColorSpace);
  return new THREE.Color(str || "#94a3b8");
}

const DAY = {
  sky: 0xa5d8ef, fog: 0xc4e6f5, ground: 0xcdecc6, hemi: 0.95, sun: 0.85,
  building: 0x9fc6da,
};
const NIGHT = {
  sky: 0x0d0c2b, fog: 0x141238, ground: 0x1d3a33, hemi: 0.35, sun: 0.15,
  building: 0x2b3a5e,
};

// テキスト/絵文字をスプライト化
function makeSprite(text, { fontSize = 44, pad = 18, bg = null, color = "#1e293b", bold = true, scale = 0.055 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `${bold ? "700 " : ""}${fontSize}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  canvas.width = tw + pad * 2;
  canvas.height = fontSize + pad * 2;
  const c2 = canvas.getContext("2d");
  if (bg) {
    c2.fillStyle = bg;
    const r = canvas.height / 2;
    c2.beginPath();
    c2.roundRect(0, 0, canvas.width, canvas.height, r);
    c2.fill();
  }
  c2.font = font;
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.fillStyle = color;
  c2.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
}

export default function Map3D({ agents, selected, isNight, onSelect }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});   // three一式
  const agentsRef = useRef(agents);
  const selectedRef = useRef(selected);
  const nightRef = useRef(isNight);
  const [webglError, setWebglError] = useState(null);
  agentsRef.current = agents;
  selectedRef.current = selected;
  nightRef.current = isNight;

  // ===== シーン構築(マウント時に1回) =====
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      setWebglError(String(e?.message || e));
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(DAY.sky);
    scene.fog = new THREE.Fog(DAY.fog, 120, 320);

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 600);
    camera.position.set(0, 62, 92);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -4);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 14;
    controls.maxDistance = 220;
    controls.maxPolarAngle = 1.42; // 地平線の少し上まで

    // ライト
    const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa88, DAY.hemi);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, DAY.sun);
    sun.position.set(60, 90, 40);
    scene.add(sun);

    // 地面(大きな円盤)
    const groundMat = new THREE.MeshLambertMaterial({ color: DAY.ground });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(240, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);

    // 街路(NEO HOUSE→各ゾーン)
    const roadMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    const house = ZONES.house;
    Object.values(ZONES).forEach(z => {
      if (z === house) return;
      const from = new THREE.Vector3(W(house.x), 0.02, W(house.y));
      const to = new THREE.Vector3(W(z.x), 0.02, W(z.y));
      const len = from.distanceTo(to);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(2.4, len), roadMat);
      road.rotation.x = -MathPIhalf();
      road.position.copy(from).lerp(to, 0.5);
      road.rotation.z = -Math.atan2(to.x - from.x, to.z - from.z);
      scene.add(road);
    });
    function MathPIhalf() { return Math.PI / 2; }

    // ゾーン: 白いプラットフォーム + 色付きリング + ランドマーク + ラベル
    Object.entries(ZONES).forEach(([key, z]) => {
      const cx = W(z.x), cz = W(z.y);
      const r = z.r * 1.35;
      const col = new THREE.Color(z.color);

      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.04, 0.5, 48),
        new THREE.MeshLambertMaterial({ color: 0xffffff })
      );
      plate.position.set(cx, 0.25, cz);
      scene.add(plate);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.35, 12, 64),
        new THREE.MeshBasicMaterial({ color: col })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(cx, 0.55, cz);
      scene.add(ring);

      /* コンセプトアート「NEOがつくる、応援資本主義の未来」準拠のゾーン造形 */
      if (key === "house") {
        // NEO HOUSE: 緑のテラスが巡る段々のガラスタワー(人との交流と探究の拠点)
        const glass = new THREE.MeshPhongMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.55, shininess: 120 });
        const warm = new THREE.MeshLambertMaterial({ color: 0xffe9b8, emissive: 0xffc46b, emissiveIntensity: 0.4 });
        const terrace = new THREE.MeshLambertMaterial({ color: 0x5cb571 });
        [[9.2, 3.6, 2.3], [7.2, 3.2, 5.6], [5.2, 2.8, 8.5], [3.4, 2.4, 11.0]].forEach(([rr, h, y]) => {
          const core = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.42, rr * 0.42, h, 32), warm);
          core.position.set(cx, y, cz);
          const shell = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 40), glass);
          shell.position.set(cx, y, cz);
          // テラスの緑は縁のリングだけ(ガラスの層が見えるように)
          const ledge = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.25, 0.32, 10, 48), terrace);
          ledge.rotation.x = Math.PI / 2;
          ledge.position.set(cx, y + h / 2 + 0.12, cz);
          scene.add(core, shell, ledge);
        });
        const plaza = new THREE.Mesh(new THREE.RingGeometry(r + 1.2, r + 3.2, 48),
          new THREE.MeshLambertMaterial({ color: 0xf5f0e0, transparent: true, opacity: 0.6 }));
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.set(cx, 0.03, cz);
        scene.add(plaza);
      } else if (key === "sports") {
        // スタジアム: ドーム球場(ベイサイド風の銀色ドーム)+陸上トラック+大型ビジョン
        const field = new THREE.Mesh(new THREE.CircleGeometry(r * 0.42, 40), new THREE.MeshLambertMaterial({ color: 0x74c94e }));
        field.rotation.x = -Math.PI / 2;
        field.position.set(cx, 0.53, cz + r * 0.28);
        const track = new THREE.Mesh(new THREE.RingGeometry(r * 0.42, r * 0.66, 48), new THREE.MeshLambertMaterial({ color: 0x2f6fd8 }));
        track.rotation.x = -Math.PI / 2;
        track.position.set(cx, 0.53, cz + r * 0.28);
        const domeWall = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.3, 2.6, 32), new THREE.MeshLambertMaterial({ color: 0xe8edf2 }));
        domeWall.position.set(cx, 1.85, cz - r * 0.45);
        const domeCap = new THREE.Mesh(
          new THREE.SphereGeometry(4.8, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshPhongMaterial({ color: 0xc9d4dd, shininess: 70 })
        );
        domeCap.position.set(cx, 3.15, cz - r * 0.45);
        const screen = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.8, 0.4),
          new THREE.MeshLambertMaterial({ color: 0x0f172a, emissive: 0x3b82f6, emissiveIntensity: 0.5 }));
        screen.position.set(cx + r * 0.62, 3.2, cz + r * 0.1);
        screen.rotation.y = -0.5;
        scene.add(field, track, domeWall, domeCap, screen);
      } else if (key === "culture") {
        // 文化: オーケストラハウス+マンガミュージアム+野外ステージ
        const hall = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.4, 4.4), new THREE.MeshLambertMaterial({ color: 0xf5edda }));
        hall.position.set(cx - r * 0.42, 2.2, cz - r * 0.22);
        const hallRoof = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 6.2, 24), new THREE.MeshLambertMaterial({ color: 0xd4a94f }));
        hallRoof.rotation.z = Math.PI / 2;
        hallRoof.position.set(cx - r * 0.42, 3.9, cz - r * 0.22);
        const hallDoor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 0.12),
          new THREE.MeshLambertMaterial({ color: 0xffe9b8, emissive: 0xffc46b, emissiveIntensity: 0.5 }));
        hallDoor.position.set(cx - r * 0.42, 1.4, cz - r * 0.22 + 2.25);
        scene.add(hall, hallRoof, hallDoor);
        const museum = new THREE.Mesh(new THREE.BoxGeometry(4.8, 3.2, 3.8), new THREE.MeshLambertMaterial({ color: 0xfefefe }));
        museum.position.set(cx + r * 0.46, 2.1, cz - r * 0.18);
        scene.add(museum);
        [[0xf472b6, -1.3], [0x38bdf8, 0], [0xfbbf24, 1.3]].forEach(([c, dx]) => {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.15),
            new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
          panel.position.set(cx + r * 0.46 + dx, 2.1, cz - r * 0.18 + 1.98);
          scene.add(panel);
        });
        const stage = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.9, 28), new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
        stage.position.set(cx, 0.95, cz + r * 0.42);
        scene.add(stage);
      } else if (key === "robots") {
        // 農場: 植栽レーン+温室+農場ロボット(労働はAI・ロボットが担う)
        for (let i = 0; i < 4; i++) {
          const x = cx - 4.5 + i * 3;
          const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, r * 1.05), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
          bed.position.set(x, 0.75, cz + r * 0.18);
          const crop = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.5, r), new THREE.MeshLambertMaterial({ color: 0x55b868 }));
          crop.position.set(x, 1.25, cz + r * 0.18);
          scene.add(bed, crop);
        }
        const greenhouse = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.4, 4.4),
          new THREE.MeshPhongMaterial({ color: 0xd8f4ff, transparent: true, opacity: 0.4, shininess: 80 }));
        greenhouse.position.set(cx + 2.2, 2.2, cz - r * 0.5);
        const botBody = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 1.8, 16), new THREE.MeshLambertMaterial({ color: 0xf1f5f9 }));
        botBody.position.set(cx - 6.8, 1.45, cz - r * 0.42);
        const botHead = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }));
        botHead.position.set(cx - 6.8, 2.8, cz - r * 0.42);
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 0.2),
          new THREE.MeshLambertMaterial({ color: 0x0f172a, emissive: 0x38bdf8, emissiveIntensity: 0.8 }));
        visor.position.set(cx - 6.8, 2.85, cz - r * 0.42 + 0.62);
        scene.add(greenhouse, botBody, botHead, visor);
      } else if (key === "food") {
        // 食: パラソル付きテラス席+Farm to Tableのキッチンカウンター
        [[-0.45, 0.25], [0.12, -0.35], [0.5, 0.28]].forEach(([dx, dz]) => {
          const x = cx + dx * r, z2 = cz + dz * r;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.7, 8), new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
          leg.position.set(x, 1.55, z2);
          const table = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.18, 20), new THREE.MeshLambertMaterial({ color: 0xffffff }));
          table.position.set(x, 1.2, z2);
          const parasol = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.1, 12), new THREE.MeshLambertMaterial({ color: 0xf59e42 }));
          parasol.position.set(x, 3.3, z2);
          scene.add(leg, table, parasol);
        });
        // 屋台通り(赤提灯が灯る屋台が並ぶ)
        for (let i = 0; i < 3; i++) {
          const x = cx - 4.2 + i * 4.2, z2 = cz - r * 0.55;
          const stall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 1.7), new THREE.MeshLambertMaterial({ color: 0xc98a5a }));
          stall.position.set(x, 1.35, z2);
          const sRoof = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.28, 2.3), new THREE.MeshLambertMaterial({ color: 0xa33f3f }));
          sRoof.position.set(x, 2.45, z2);
          const noren = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.08), new THREE.MeshLambertMaterial({ color: 0xe25555 }));
          noren.position.set(x, 1.95, z2 + 0.92);
          scene.add(stall, sRoof, noren);
          for (let j = 0; j < 3; j++) {
            const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
              new THREE.MeshLambertMaterial({ color: 0xff5544, emissive: 0xff3311, emissiveIntensity: 0.7 }));
            lantern.scale.y = 1.25;
            lantern.position.set(x - 0.9 + j * 0.9, 2.15, z2 + 1.08);
            scene.add(lantern);
          }
        }
      } else if (key === "home") {
        // 住居: パステルカラーの住宅クラスタ
        const pastel = [0xf3e8d8, 0xe8eef5, 0xf5e8ee, 0xe9f5e8, 0xf5f2e0];
        const rngH = mulberry32(20500103);
        for (let i = 0; i < 6; i++) {
          const ang2 = (i / 6) * Math.PI * 2 + 0.4;
          const dist = r * (0.42 + rngH() * 0.26);
          const x = cx + Math.cos(ang2) * dist, z2 = cz + Math.sin(ang2) * dist;
          const s = 1.7 + rngH() * 0.7;
          const hBody = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s, s * 1.4), new THREE.MeshLambertMaterial({ color: pastel[i % 5] }));
          hBody.rotation.y = rngH() * Math.PI;
          hBody.position.set(x, 0.5 + s / 2, z2);
          const hRoof = new THREE.Mesh(new THREE.ConeGeometry(s * 1.18, s * 0.85, 4), new THREE.MeshLambertMaterial({ color: 0xcf7a5a }));
          hRoof.rotation.y = hBody.rotation.y + Math.PI / 4;
          hRoof.position.set(x, 0.5 + s + s * 0.42, z2);
          scene.add(hBody, hRoof);
        }
      }

      const label = makeSprite(`${z.icon} ${z.name}`, { bg: "rgba(255,255,255,.92)", color: "#0f172a", fontSize: 40, scale: 0.042 });
      label.position.set(cx, key === "house" ? 13.5 : 8.2, cz);
      scene.add(label);
    });

    // 並木(シード固定 — 純粋な装飾)
    const rng = mulberry32(20500102);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0xb08050 });
    const leafMats = [0x59c98a, 0x4fbf7f, 0x6ad19b].map(c => new THREE.MeshLambertMaterial({ color: c }));
    const zonesArr = Object.values(ZONES);
    for (let i = 0; i < 46; i++) {
      const x = (rng() - 0.5) * 190, zpos = (rng() - 0.5) * 190;
      if (zpos < -66) continue; // 海(博多湾)エリアには生やさない
      if (zonesArr.some(z => Math.hypot(x - W(z.x), zpos - W(z.y)) < z.r * 1.35 + 4)) continue;
      const s = 0.8 + rng() * 0.9;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.45 * s, 2.2 * s, 8), trunkMat);
      trunk.position.set(x, 1.1 * s, zpos);
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.9 * s, 12, 10), leafMats[Math.floor(rng() * 3)]);
      leaves.position.set(x, 3.3 * s, zpos);
      scene.add(trunk, leaves);
    }

    // 遠景ビル群
    const buildingMat = new THREE.MeshLambertMaterial({ color: DAY.building, transparent: true, opacity: 0.55 });
    const buildings = [];
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + rng() * 0.3;
      const dist = 120 + rng() * 60;
      const h = 14 + rng() * 34;
      const bx = Math.cos(ang) * dist, bz = Math.sin(ang) * dist;
      if (bz < -66) continue; // 北側は博多湾(海)なのでビルを建てない
      const b = new THREE.Mesh(new THREE.BoxGeometry(7 + rng() * 8, h, 7 + rng() * 8), buildingMat);
      b.position.set(bx, h / 2, bz);
      scene.add(b);
      buildings.push(b);
    }

    // ===== 博多湾エリア(福岡モチーフ) =====
    // 海と砂浜
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(520, 190),
      new THREE.MeshPhongMaterial({ color: 0x3aa7d9, shininess: 90, transparent: true, opacity: 0.92 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.08, -168);
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(520, 12),
      new THREE.MeshLambertMaterial({ color: 0xeeddb0 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, 0.06, -68);
    scene.add(sea, beach);

    // 福岡タワー(海辺にそびえる三角ガラスタワー)
    const fTower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.9, 34, 3),
      new THREE.MeshPhongMaterial({ color: 0x9fd0ee, transparent: true, opacity: 0.8, shininess: 120, emissive: 0x2b6f9e, emissiveIntensity: 0.18 }));
    fTower.position.set(34, 17, -60);
    const fAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 6), new THREE.MeshLambertMaterial({ color: 0xdbe6ee }));
    fAntenna.position.set(34, 37.5, -60);
    scene.add(fTower, fAntenna);

    // ベイサイドの観覧車(回転する)
    const wheelBase = new THREE.Group();
    wheelBase.position.set(-46, 0, -58);
    [[-2.4, 0.22], [2.4, -0.22]].forEach(([dx, tilt]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 11, 8), new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
      leg.position.set(dx, 5.2, 0);
      leg.rotation.z = tilt;
      wheelBase.add(leg);
    });
    const wheel = new THREE.Group();
    wheel.position.y = 10.5;
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(8, 0.3, 10, 44), new THREE.MeshLambertMaterial({ color: 0xf8fafc })));
    const gondolaCols = [0xf87171, 0xfbbf24, 0x4ade80, 0x38bdf8, 0xa78bfa, 0xf472b6, 0xfb923c, 0x2dd4bf];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 8, 6), new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }));
      spoke.rotation.z = a;
      spoke.position.set(-Math.sin(a) * 4, Math.cos(a) * 4, 0);
      const gondola = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), new THREE.MeshLambertMaterial({ color: gondolaCols[i] }));
      gondola.position.set(Math.cos(a) * 8, Math.sin(a) * 8, 0.7);
      wheel.add(spoke, gondola);
    }
    wheelBase.add(wheel);
    scene.add(wheelBase);

    // 帆船(湾をゆっくり行き交う)
    const boats = [];
    for (let i = 0; i < 3; i++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 1.3), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      hull.position.y = 0.5;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0x8a7a66 }));
      mast.position.y = 2.4;
      const sail = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.6, 4), new THREE.MeshLambertMaterial({ color: [0xffffff, 0xffd166, 0x93c5fd][i] }));
      sail.scale.z = 0.18;
      sail.position.y = 2.7;
      boat.add(hull, mast, sail);
      scene.add(boat);
      boats.push({ g: boat, x0: -80 + i * 70, z: -88 - i * 24, speed: 1.4 + i * 0.7, phase: i * 2 });
    }

    // 気球(街の上空をふわふわ漂う)
    const balloons = [];
    [[0xff6b81, 46, 30], [0xffd166, 62, 37]].forEach(([c, rr, hh], i) => {
      const g = new THREE.Group();
      const envMesh = new THREE.Mesh(new THREE.SphereGeometry(2.3, 14, 12), new THREE.MeshLambertMaterial({ color: c }));
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
      basket.position.y = -3.1;
      g.add(envMesh, basket);
      scene.add(g);
      balloons.push({ g, r: rr, h: hh, speed: 0.05 + i * 0.02, phase: i * 2.6 });
    });

    // 空を飛び交うドローン(コンセプトアートの空)
    const drones = [];
    const droneMat = new THREE.MeshLambertMaterial({ color: 0x475569 });
    const rotorMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 1.1), droneMat));
      [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(([dx, dz]) => {
        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), rotorMat);
        rotor.position.set(dx, 0.25, dz);
        g.add(rotor);
      });
      scene.add(g);
      drones.push({ g, r: 26 + i * 14, h: 17 + i * 4, speed: 0.12 + i * 0.035, phase: i * 1.7 });
    }

    // 花畑(地面の彩り)
    const flowerCols = [0xffd7e8, 0xfff3b8, 0xffffff, 0xd8ecff];
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * 170, zp = (rng() - 0.5) * 170;
      if (zp < -66) continue; // 海エリアには咲かせない
      if (zonesArr.some(z => Math.hypot(x - W(z.x), zp - W(z.y)) < z.r * 1.35 + 3)) continue;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(1.1 + rng() * 1.6, 10),
        new THREE.MeshLambertMaterial({ color: flowerCols[Math.floor(rng() * 4)], transparent: true, opacity: 0.7 }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, 0.02, zp);
      scene.add(patch);
    }

    // 住民
    const agentGroup = new THREE.Group();
    scene.add(agentGroup);
    const agentMeshes = new Map(); // id -> { body, target, sprite?, bubble? }

    // 選択リング
    const selRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.22, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0xfde047 })
    );
    selRing.rotation.x = Math.PI / 2;
    selRing.visible = false;
    scene.add(selRing);

    // クリック選択(ドラッグと区別するため移動量を見る)
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos = null;
    const onDown = e => { downPos = [e.clientX, e.clientY]; };
    const onUp = e => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
      downPos = null;
      if (moved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(agentGroup.children, false);
      if (hits.length) onSelect(hits[0].object.userData.agentId);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // リサイズ
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    // 描画ループ: 位置のスムーズ移動・昼夜の色補間
    const curEnv = { sky: new THREE.Color(DAY.sky), fog: new THREE.Color(DAY.fog), ground: new THREE.Color(DAY.ground), building: new THREE.Color(DAY.building), hemi: DAY.hemi, sun: DAY.sun };
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const env = nightRef.current ? NIGHT : DAY;
      curEnv.sky.lerp(new THREE.Color(env.sky), 0.04);
      curEnv.fog.lerp(new THREE.Color(env.fog), 0.04);
      curEnv.ground.lerp(new THREE.Color(env.ground), 0.04);
      curEnv.building.lerp(new THREE.Color(env.building), 0.04);
      curEnv.hemi += (env.hemi - curEnv.hemi) * 0.04;
      curEnv.sun += (env.sun - curEnv.sun) * 0.04;
      scene.background.copy(curEnv.sky);
      scene.fog.color.copy(curEnv.fog);
      groundMat.color.copy(curEnv.ground);
      buildingMat.color.copy(curEnv.building);
      hemi.intensity = curEnv.hemi;
      sun.intensity = curEnv.sun;

      const t0 = performance.now() / 1000;
      drones.forEach(d => {
        const a = t0 * d.speed + d.phase;
        d.g.position.set(Math.cos(a) * d.r, d.h + Math.sin(t0 * 1.7 + d.phase) * 0.8, Math.sin(a) * d.r);
        d.g.rotation.y = -a;
      });
      wheel.rotation.z = t0 * 0.18; // 観覧車
      boats.forEach(bt => {
        const x = ((((bt.x0 + t0 * bt.speed) % 240) + 240) % 240) - 120;
        bt.g.position.set(x, 0.12 + Math.sin(t0 * 1.3 + bt.phase) * 0.12, bt.z);
        bt.g.rotation.z = Math.sin(t0 * 1.1 + bt.phase) * 0.04;
      });
      balloons.forEach(bl => {
        const a = t0 * bl.speed + bl.phase;
        bl.g.position.set(Math.cos(a) * bl.r, bl.h + Math.sin(t0 * 0.6 + bl.phase) * 1.2, Math.sin(a) * bl.r * 0.55 - 14);
      });

      for (const rec of agentMeshes.values()) {
        rec.body.position.lerp(rec.target, 0.06);
        if (rec.sprite) rec.sprite.position.set(rec.body.position.x, rec.body.position.y + rec.labelY, rec.body.position.z);
        if (rec.bubble) rec.bubble.position.set(rec.body.position.x, rec.body.position.y + rec.bubbleY, rec.body.position.z);
      }
      const selId = selectedRef.current;
      const selRec = selId ? agentMeshes.get(selId) : null;
      selRing.visible = !!selRec;
      if (selRec) selRing.position.set(selRec.body.position.x, 0.62, selRec.body.position.z);

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    stateRef.current = { scene, agentGroup, agentMeshes };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      scene.traverse(o => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
      });
      mount.removeChild(renderer.domElement);
      stateRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 住民の同期(agents変化時) =====
  useEffect(() => {
    const { scene, agentGroup, agentMeshes } = stateRef.current;
    if (!scene) return;
    const seen = new Set();
    agents.forEach(a => {
      seen.add(a.id);
      const tx = W(a.px), tz = W(a.py);
      let rec = agentMeshes.get(a.id);
      if (!rec) {
        const hero = !!a.emoji;
        const r = hero ? 1.3 : 0.85;
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(r, 16, 12),
          new THREE.MeshLambertMaterial({ color: toColor(a.color) })
        );
        body.position.set(tx, r + 0.5, tz);
        body.userData.agentId = a.id;
        agentGroup.add(body);
        rec = { body, target: new THREE.Vector3(tx, r + 0.5, tz), labelY: hero ? 2.6 : 1.9, bubbleY: hero ? 4.6 : 3.6, speech: null };
        if (hero) {
          rec.sprite = makeSprite(`${a.emoji} ${a.name}`, { bg: "rgba(15,23,42,.85)", color: "#fff", fontSize: 34, scale: 0.026 });
          scene.add(rec.sprite);
        }
        agentMeshes.set(a.id, rec);
      }
      rec.target.set(tx, rec.body.geometry.parameters.radius + 0.5, tz);
      // 吹き出し(発言が変わったら作り直し)
      const speech = a.speech || null;
      if (speech !== rec.speech) {
        if (rec.bubble) { scene.remove(rec.bubble); rec.bubble.material.map?.dispose(); rec.bubble.material.dispose(); rec.bubble = null; }
        if (speech) {
          rec.bubble = makeSprite(`💬 ${speech.slice(0, 22)}`, { bg: "rgba(255,255,255,.95)", color: "#0f172a", fontSize: 34, scale: 0.028 });
          scene.add(rec.bubble);
        }
        rec.speech = speech;
      }
      // SOS(メンタル/体力枯渇)は体を点滅色に
      const sos = a.res.ment < 30 || a.res.stam < 25;
      rec.body.material.emissive = new THREE.Color(sos ? 0xff2244 : 0x000000);
      rec.body.material.emissiveIntensity = sos ? 0.55 : 0;
    });
    // 消えた住民(リセット時)を掃除
    for (const [id, rec] of agentMeshes) {
      if (seen.has(id)) continue;
      agentGroup.remove(rec.body);
      rec.body.geometry.dispose();
      rec.body.material.dispose();
      if (rec.sprite) { scene.remove(rec.sprite); rec.sprite.material.map?.dispose(); rec.sprite.material.dispose(); }
      if (rec.bubble) { scene.remove(rec.bubble); rec.bubble.material.map?.dispose(); rec.bubble.material.dispose(); }
      agentMeshes.delete(id);
    }
  }, [agents]);

  if (webglError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-xs text-slate-400 p-6 text-center">
        3Dビューを表示できません(WebGL無効: {webglError})。ヘッダーの「🗺 2Dマップ」に切り替えてください。
      </div>
    );
  }
  return <div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />;
}
