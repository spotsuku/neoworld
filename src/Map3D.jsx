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

      if (key === "house") {
        // NEO HOUSE: ガラス張りの段々タワー
        const glass = new THREE.MeshPhongMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.4, shininess: 90 });
        [[8.5, 4.5, 2.25], [6.4, 3.6, 6.3], [4.4, 3.0, 9.6]].forEach(([rr, h, y]) => {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 40), glass);
          m.position.set(cx, y, cz);
          scene.add(m);
        });
      } else {
        // 各ゾーンのパビリオン(色付きの小さな建物)
        const pav = new THREE.Mesh(
          new THREE.BoxGeometry(4.6, 3.4, 4.6),
          new THREE.MeshLambertMaterial({ color: col })
        );
        pav.position.set(cx, 2.2, cz - r * 0.45);
        scene.add(pav);
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(3.7, 2.2, 4),
          new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.75) })
        );
        roof.rotation.y = Math.PI / 4;
        roof.position.set(cx, 5.0, cz - r * 0.45);
        scene.add(roof);
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
      const b = new THREE.Mesh(new THREE.BoxGeometry(7 + rng() * 8, h, 7 + rng() * 8), buildingMat);
      b.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
      scene.add(b);
      buildings.push(b);
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
