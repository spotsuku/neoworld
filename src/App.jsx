import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from "react";
import { Play, Pause, MessageCircle, Heart, Flag, Activity, X, RotateCcw, Landmark } from "lucide-react";

// 3Dビュー(three.js)は遅延ロードして初期バンドルを軽く保つ
const Map3D = lazy(() => import("./Map3D.jsx"));
import {
  ZONES, ZONE_KEYS, RES_DEF, NEED_LINE, CAP_FLOOR, FUND_MONTHLY, OPT_SLACK,
  clamp, normCap, derive, slackState, gini, generatePopulation, weakest,
} from "./engine/population.js";
import { fbHour, fbDay, fbMonth, fbYear, fbNewChallenges, fbNoted, markFbNoted, resetFbNoted } from "./engine/fallback.js";
import { SCENARIOS, HOUR_SYSTEM, DAY_SYSTEM, MONTH_SYSTEM, YEAR_SYSTEM, rosterText } from "./engine/prompts.js";
import {
  TRANSITION, MILESTONES, TR_HOUR_SYSTEM, TR_DAY_SYSTEM, TR_MONTH_SYSTEM, TR_YEAR_SYSTEM,
  trIncome, trIncomeLabel, trJumpIncome, applyMilestones, trFallbackScenario, fbTrMilestones,
} from "./engine/transition.js";
import { callClaude, parseJSON } from "./api.js";
import { saveRun, listRuns, loadRun, deleteRun } from "./store.js";

// 表示用シナリオ一覧: 統制条件の3シナリオ + 移行期(創発)モード
const ALL_SCENARIOS = { ...SCENARIOS, transition: TRANSITION };

/* ============================================================
   NEO 2050 SOCIETY SIMULATOR v3.3 — 余白理論エンジン(Web版)
   AI生成は /api/claude 経由。失敗時は簡易エンジンに自動切替。
   ============================================================ */

// ---------- 時刻 ----------
const START = new Date(2050, 0, 1, 7, 0);
// 移行期モードは現実の2026年からスタート
const startFor = scn => scn === "transition" ? new Date(2026, 0, 1, 7, 0) : new Date(START);
// 移行期の初期人口は「現代日本」条件(統制条件のgeneretePopulationはそのまま利用)
const populationFor = scn => generatePopulation(scn === "transition" ? "current" : scn);
const fmtDate = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:00`;
const shortLabel = d => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}時`;

// ---------- 画面幅判定 ----------
function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => {
    const f = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return m;
}

// ---------- 軽量折れ線グラフ(自前SVG) ----------
function MiniLine({ data, dataKey, color, domain }) {
  const w = 300, h = 100, pad = 8;
  const vals = (data || []).map(d => (typeof d[dataKey] === "number" ? d[dataKey] : 0));
  if (!vals.length) return <div className="text-[9px] text-slate-600 p-2">データなし(時間を進めてください)</div>;
  let lo = domain ? domain[0] : Math.min(...vals);
  let hi = domain ? domain[1] : Math.max(...vals);
  if (hi === lo) hi = lo + 1;
  const n = vals.length;
  const pts = vals.map((v, i) => `${pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1))},${h - pad - (h - 2 * pad) * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)}`).join(" ");
  const last = vals[n - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#334155" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      <text x={w - pad} y={14} textAnchor="end" fontSize="11" fill={color} fontFamily="monospace">{Math.round(last * 10) / 10}</text>
    </svg>
  );
}

// ============================================================
export default function NeoSimulator() {
  const isMobile = useIsMobile();
  const [view, setView] = useState("3d"); // "3d"=立体空間 / "2d"=平面分析
  const [scenario, setScenario] = useState("post");
  const [agents, setAgents] = useState(() => generatePopulation("post"));
  const [now, setNow] = useState(new Date(START));
  const [events, setEvents] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [customRules, setCustomRules] = useState([]);
  const [ruleInput, setRuleInput] = useState("");
  const [metrics, setMetrics] = useState([]);
  const [worldNote, setWorldNote] = useState("2050年1月1日、シミュレーション待機中");
  const [eraName, setEraName] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("timeline");
  const [interview, setInterview] = useState([]);
  const [interviewQ, setInterviewQ] = useState("");
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportChat, setReportChat] = useState([]);       // レポートについての議論スレッド
  const [reportQ, setReportQ] = useState("");
  const [reportChatLoading, setReportChatLoading] = useState(false);
  const reportDataRef = useRef("");                        // レポート生成時の観測データ(議論の文脈用)
  const [flags, setFlags] = useState({});        // 移行期モードの成立済み制度転換 {key: 成立年}
  const [runId, setRunId] = useState(null);      // Supabase上の記録ID(保存後は同じ記録に上書き)
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [runs, setRuns] = useState(null);        // null=読込中 / []=なし
  const [runsError, setRunsError] = useState(null);
  const zoneHoursRef = useRef({ house: 0, culture: 0, sports: 0, robots: 0, food: 0, home: 0 });
  const issuedRef = useRef(0); // BI累計支給額(循環率の分母)
  const stateRef = useRef({});
  stateRef.current = { agents, now, challenges, events, ticking, playing, institutions, metrics, scenario, customRules, eraName, worldNote, flags };

  const pushEvents = (list, arr) => [...list, ...arr].slice(-120);
  const noise = amp => Math.round((Math.random() * 2 - 1) * amp);

  // ===== 資源ルール(毎時): LLM補正の前に物理的な増減を適用 =====
  function stepResourcesHour(a, ctx) {
    const r = { ...a.res };
    const own = ctx.challenges.filter(c => c.owner === a.id && c.status === "active").length;
    // 時間: 挑戦を持つほど削れる。現代日本の就労者はさらに労働で削られる
    const timeTarget = (a.works && ctx.scn !== "post" ? 58 : 88) - own * 14;
    r.time = clamp(r.time + (timeTarget - r.time) * 0.2);
    // 体力: 活動で消耗、住居/食で回復
    r.stam = clamp(r.stam + (a.zone === "home" ? 4 : a.zone === "food" ? 3 : a.zone === "sports" ? -2 : -1));
    // 応援(つながり): 放置で減衰、賑わうゾーンで微増
    r.conn = clamp(r.conn - 1 + (ctx.zoneCount[a.zone] >= 6 && a.zone !== "home" ? 2 : 0));
    // 挑戦(充実): 進行中なら高水準、無ければ空虚へ漂う
    if (own > 0) {
      const best = Math.max(...ctx.challenges.filter(c => c.owner === a.id && c.status === "active").map(c => c.progress));
      r.chal = clamp(Math.max(r.chal - 1, 55 + best * 12));
    } else r.chal = clamp(r.chal + (32 - r.chal) * 0.06);
    // メンタル: 孤立と資本格差の比較でじわり削れる
    r.ment = clamp(r.ment + ctx.mood + (r.conn < 30 ? -2 : 0) + (normCap(a.support) < ctx.capAvg - 25 ? -1 : 0));
    return r;
  }
  // 応援の授受は「つながり」と相手のメンタルを直接潤す
  const applySupportGlow = (r, giving) => ({ ...r, conn: clamp(r.conn + 6), ment: clamp(r.ment + (giving ? 2 : 4)) });

  const finalize = a => ({ ...a, ...derive(a) });

  const recordMetric = (agentsArr, chArr, instArr, flowAdd, label) =>
    setMetrics(m => {
      const cumFlow = (m.length ? m[m.length - 1].応援流通 : 0) + flowAdd;
      const totRecv = agentsArr.reduce((s, a) => s + (a.recv || 0), 0);
      const owners = new Set(chArr.map(c => c.owner));
      return [...m.slice(-119), {
        label,
        幸福度: Math.round(agentsArr.reduce((s, a) => s + a.happiness, 0) / agentsArr.length),
        余白: Math.round(agentsArr.reduce((s, a) => s + a.slack, 0) / agentsArr.length * 10) / 10,
        応援流通: cumFlow,
        循環率: issuedRef.current ? Math.min(100, Math.round(cumFlow / issuedRef.current * 100)) : 0,
        富裕層応援シェア: totRecv ? Math.round(agentsArr.filter(a => a.isRich).reduce((s, a) => s + (a.recv || 0), 0) / totRecv * 100) : 0,
        挑戦者応援シェア: totRecv ? Math.round(agentsArr.filter(a => owners.has(a.id)).reduce((s, a) => s + (a.recv || 0), 0) / totRecv * 100) : 0,
        挑戦数: chArr.length,
        文化: instArr.length,
        挑戦者数: owners.size,
        資本偏り: Math.round(gini(agentsArr.map(a => a.support)) * 100),
        体力: Math.round(agentsArr.reduce((s, a) => s + a.res.stam, 0) / agentsArr.length),
        メンタル: Math.round(agentsArr.reduce((s, a) => s + a.res.ment, 0) / agentsArr.length),
      }];
    });

  // 応援基金: 企業の資本余剰10%を挑戦に分配(配分ルール未整備 → 現状は一律分配)
  function applyFund(chList, agentsById, months, evs, t) {
    const active = chList.map((c, i) => ({ c, i })).filter(x => x.c.status === "active");
    if (!active.length) return { chList, gains: {} };
    const fund = FUND_MONTHLY * months;
    const share = Math.round(fund / active.length);
    const gains = {};
    const list = [...chList];
    active.forEach(x => {
      list[x.i] = { ...x.c, totalSupport: x.c.totalSupport + share };
      gains[x.c.owner] = (gains[x.c.owner] || 0) + share;
    });
    evs.push({ t, icon: "🏢", text: `応援基金: 資本余剰10%(${fund}pt)を挑戦に分配(配分ルール未整備・一律割り)`, type: "system" });
    return { chList: list, gains };
  }

  // 大ジャンプ時: 期間中の応援流通を「誰が受けたか」に配分
  // 重み = 基礎1 + 挑戦者ボーナス3 + 富の後光(資産が多いほど応援も集めやすい慣性)
  function distributeFlow(agentsArr, chArr, flow) {
    const owners = new Set(chArr.map(c => c.owner));
    const weights = agentsArr.map(a => 1 + (owners.has(a.id) ? 3 : 0) + normCap(a.support) / 100 * 1.5);
    const W = weights.reduce((s, x) => s + x, 0);
    const out = {};
    agentsArr.forEach((a, i) => { out[a.id] = Math.round(flow * weights[i] / W); });
    return out;
  }

  const addZoneHours = (agentsArr, days) => {
    const zh = zoneHoursRef.current;
    agentsArr.forEach(a => { zh.home += 14 * days; zh[a.arch] += 6 * days; zh.house += 2 * days; zh.food += 2 * days; });
  };

  function applyChallenges(chList, { create = [], prog = [], done = [] }, agentsArr, evs, t) {
    let list = [...chList];
    create.forEach(nc => {
      if (!nc?.name || list.some(c => c.name === nc.name)) return;
      const owner = agentsArr.find(a => a.id === nc.ownerId) || agentsArr[Math.floor(Math.random() * agentsArr.length)];
      list.push({ name: nc.name, owner: owner.id, ownerName: owner.name, progress: 0, totalSupport: 0, status: "active", color: owner.color });
      evs.push({ t, icon: "🚩", text: `${owner.name}が挑戦「${nc.name}」を開始!`, type: "challenge" });
    });
    prog.forEach(name => {
      const i = list.findIndex(c => c.name === name && c.status === "active");
      if (i >= 0) list[i] = { ...list[i], progress: Math.min(3, list[i].progress + 1) };
    });
    done.forEach(name => {
      const i = list.findIndex(c => c.name === name && c.status === "active");
      if (i >= 0) {
        list[i] = { ...list[i], progress: 3, status: "done" };
        evs.push({ t, icon: "🎉", text: `挑戦「${name}」が実現!街の文化になった`, type: "challenge" });
      }
    });
    return list;
  }

  // ===== 1時間 =====
  const tickHour = useCallback(async () => {
    const S = stateRef.current;
    const next = new Date(S.now.getTime() + 3600000);
    const h = next.getHours();
    const t = shortLabel(next);

    if (h >= 0 && h <= 5) {
      setAgents(prev => prev.map(a => finalize({ ...a, zone: "home", speech: null, thought: "…就寝中…", res: { ...a.res, stam: clamp(a.res.stam + 7), time: clamp(a.res.time + 2), ment: clamp(a.res.ment + 1) } })));
      zoneHoursRef.current.home += S.agents.length;
      setWorldNote("街は眠っている");
      setNow(next); return;
    }

    let agentsNow = S.agents;
    const evs = [];
    if (h === 8) {
      if (S.scenario === "post") {
        let topup = 0;
        agentsNow = agentsNow.map(a => { const d = Math.max(0, CAP_FLOOR - a.support); topup += d; return { ...a, support: a.support + d }; });
        issuedRef.current += topup;
        if (topup > 0) evs.push({ t, icon: "💙", text: `充足BI: 資本が水準未満の住民に計${topup}pt補填(財源:ロボット生産益)`, type: "system" });
      } else if (S.scenario === "transition") {
        // 移行期: フェーズに応じて 賃金→+配当→+部分BI→充足BI と変化
        const totalSup = agentsNow.reduce((s2, a) => s2 + a.support, 0) || 1;
        let paid = 0;
        agentsNow = agentsNow.map(a => {
          const inc = trJumpIncome(a, S.flags, 1, totalSup);
          paid += inc;
          return { ...a, support: a.support + inc };
        });
        issuedRef.current += paid;
        if (paid > 0) evs.push({ t, icon: "💙", text: trIncomeLabel(S.flags), type: "system" });
      } else {
        agentsNow = agentsNow.map(a => ({ ...a, support: a.support + (a.dailyIncome || 0) }));
        issuedRef.current += agentsNow.reduce((s2, a) => s2 + (a.dailyIncome || 0), 0);
        evs.push({ t, icon: S.scenario === "roboCap" ? "🏦" : "💙", text: SCENARIOS[S.scenario].incomeLabel, type: "system" });
      }
    }
    const challengerIds = S.challenges.filter(c => c.status === "active").map(c => c.owner);
    const spotIds = new Set(agentsNow.slice(0, 5).map(a => a.id));
    challengerIds.forEach(id => spotIds.size < 8 && spotIds.add(id));
    while (spotIds.size < 10) spotIds.add(agentsNow[5 + Math.floor(Math.random() * 45)].id);
    const spots = agentsNow.filter(a => spotIds.has(a.id));

    const prompt = `${next.getMonth()+1}月${next.getDate()}日 ${h}:00。\n【注目住民】\n${spots.map(a => `${a.id}(${a.name},${a.age}):${a.persona}目標:${a.goal} 現在地:${a.zone} 幸福:${a.happiness} 余白:${a.slack} 弱点資源:${weakest(a)} 応援pt:${a.support} 記憶:${a.memories.slice(-2).join("/") || "無"}`).join("\n")}\n【進行中の挑戦】${S.challenges.filter(c=>c.status==="active").map(c=>`「${c.name}」(${c.ownerName},${c.progress}/3)`).join(",")||"なし"}\n【直近】${S.events.slice(-3).map(e=>e.text).join("/")||"なし"}\n【施行中の追加ルール】${S.customRules.join(" / ") || "なし"}`;
    let result;
    const hourSys = S.scenario === "transition" ? TR_HOUR_SYSTEM(S.flags, S.now.getFullYear()) : HOUR_SYSTEM(S.scenario);
    try { result = parseJSON(await callClaude(hourSys, prompt)); }
    catch (fe) {
      result = fbHour(S.scenario === "transition" ? { ...S, scenario: trFallbackScenario(S.flags) } : S, spots);
      if (!fbNoted()) { markFbNoted(); evs.push({ t, icon: "🤖", text: `AI生成が使えないため簡易エンジンで進行(${String(fe && fe.message).slice(0, 60)})`, type: "system" }); }
    }

    let newCh = [...S.challenges];
    const supportIn = {};
    let flow = 0;
    const mood = result.mood || 0;

    // 先に位置を確定(ゾーン人数の計算のため)
    const zoneMap = {};
    const positioned = agentsNow.map(a => {
      const e = spotIds.has(a.id) ? (result.events || []).find(x => x.id === a.id) : null;
      let zone = a.zone;
      if (e && ZONES[e.zone]) zone = e.zone;
      else if (!spotIds.has(a.id)) zone = h >= 21 ? "home" : (Math.random() < 0.45 ? (Math.random() < 0.55 ? a.arch : ZONE_KEYS[Math.floor(Math.random() * 6)]) : a.zone);
      zoneMap[zone] = (zoneMap[zone] || 0) + 1;
      return { ...a, zone, _e: e };
    });
    const capAvg = positioned.reduce((s, a) => s + normCap(a.support), 0) / positioned.length;
    // 移行期は充足BI完全実施後にpost相当(労働が時間を奪わない)へ切り替わる
    const effScn = S.scenario === "transition" ? (S.flags.bi_full ? "post" : "current") : S.scenario;
    const ctx = { challenges: newCh, zoneCount: zoneMap, mood, capAvg, scn: effScn };

    let updated = positioned.map(a => {
      const e = a._e;
      let res = stepResourcesHour(a, ctx);
      let support = a.support;
      let memories = a.memories, thought = a.thought, speech = null;
      if (e) {
        if (e.support?.to && e.support.points > 0) {
          const pts = Math.min(e.support.points, support);
          support -= pts; flow += pts;
          supportIn[e.support.to] = (supportIn[e.support.to] || 0) + pts;
          res = applySupportGlow(res, true);
          const tg = positioned.find(x => x.id === e.support.to);
          if (tg) evs.push({ t, icon: "❤️", text: `${a.name} → ${tg.name} に応援 ${pts}pt`, type: "support" });
        }
        if (e.challenge?.name) {
          if (e.challenge.step === "create") newCh = applyChallenges(newCh, { create: [{ name: e.challenge.name, ownerId: a.id }] }, positioned, evs, t);
          else if (e.challenge.step === "complete") { newCh = applyChallenges(newCh, { done: [e.challenge.name] }, positioned, evs, t); res.chal = clamp(92); res.ment = clamp(res.ment + 8); }
          else newCh = applyChallenges(newCh, { prog: [e.challenge.name] }, positioned, evs, t);
        }
        res.stam = clamp(res.stam + (e.dS || 0));
        res.ment = clamp(res.ment + (e.dM || 0));
        thought = e.thought || thought; speech = e.speech || null;
        memories = [...memories.slice(-9), `${t}:${e.action}`];
        evs.push({ t, icon: a.emoji || "👤", text: `${a.name}: ${e.action}${e.speech ? `「${e.speech}」` : ""}`, type: "action" });
      }
      const { _e, ...rest } = a;
      return finalize({ ...rest, res, support, memories, thought, speech });
    });
    // 応援の受け取り
    updated = updated.map(a => supportIn[a.id]
      ? finalize({ ...a, support: a.support + supportIn[a.id], recv: (a.recv || 0) + supportIn[a.id], res: applySupportGlow(a.res, false) })
      : a);
    (result.events || []).forEach(e => {
      if (e.support?.to) {
        const ci = newCh.findIndex(c => c.owner === e.support.to && c.status === "active");
        if (ci >= 0) newCh[ci] = { ...newCh[ci], totalSupport: newCh[ci].totalSupport + e.support.points };
      }
    });
    flow += newCh.filter(c => c.status === "active").length * (3 + Math.floor(Math.random() * 5));

    updated.forEach(a => { zoneHoursRef.current[a.zone] = (zoneHoursRef.current[a.zone] || 0) + 1; });
    setAgents(updated); setChallenges(newCh);
    setEvents(ev => pushEvents(ev, evs));
    setWorldNote(result.worldNote || "");
    recordMetric(updated, newCh, S.institutions, flow, t);
    setNow(next);
  }, []);

  // ===== 大ジャンプ共通: N日分の資源変化を圧縮適用 =====
  function stepResourcesJump(a, days, dMental, chList) {
    const r = { ...a.res };
    const own = chList.filter(c => c.owner === a.id && c.status === "active").length;
    const completedOwn = chList.some(c => c.owner === a.id && c.status === "done");
    const S0 = stateRef.current;
    const freeTime = S0.scenario === "post" || (S0.scenario === "transition" && S0.flags.bi_full);
    r.time = clamp((a.works && !freeTime ? 58 : 88) - own * 14 + noise(4));
    r.stam = clamp(r.stam + (75 - r.stam) * Math.min(1, days / 20) + noise(5));
    r.conn = clamp(r.conn + (own || completedOwn ? 6 : -4) * Math.min(3, days / 10) + noise(5));
    r.chal = own > 0 ? clamp(60 + noise(10)) : completedOwn ? clamp(75 + noise(8)) : clamp(r.chal + (36 - r.chal) * 0.5 + noise(6));
    // 快楽適応(セットポイント理論): メンタルはショック後、加齢U字カーブの
    // 個人基準値(中年が谷・高齢で回復)へゆっくり回帰する — 体力の自然回復と同型
    const setPoint = clamp(66 - 11 * Math.exp(-((a.age - 50) ** 2) / 350), 40, 70);
    r.ment = clamp(r.ment + dMental + (r.conn < 30 ? -4 : 0) + (setPoint - r.ment) * Math.min(0.5, days / 180) + noise(6));
    return r;
  }

  // ソーシャルサポートの緩衝効果: 応援を受け取ると心とつながりが潤う
  // (+1時間のapplySupportGlowと同じ性質をジャンプ刻みにも)
  const applyJumpGlow = (res, received) => {
    if (received > 0) { res.conn = clamp(res.conn + 4); res.ment = clamp(res.ment + 3); }
    return res;
  };

  // ===== 1日 =====
  const tickDay = useCallback(async () => {
    const S = stateRef.current;
    const next = new Date(S.now.getTime() + 86400000);
    const t = `${next.getMonth() + 1}/${next.getDate()}`;
    let result, fbMsg = null;
    const daySys = S.scenario === "transition" ? TR_DAY_SYSTEM(S.flags, S.now.getFullYear()) : DAY_SYSTEM(S.scenario);
    try { result = parseJSON(await callClaude(daySys, `${t}の1日分を生成。\n${rosterText(S.agents, S.challenges)}\n【直近】${S.events.slice(-3).map(e=>e.text).join("/")||"なし"}\n【施行中の追加ルール】${S.customRules.join(" / ") || "なし"}`)); }
    catch (fe) { result = fbDay(S.scenario === "transition" ? { ...S, scenario: trFallbackScenario(S.flags) } : S); fbMsg = fe && fe.message; }
    const evs = [{ t, icon: "📅", text: `【1日経過】${result.headline}`, type: "system" }];
    if (fbMsg && !fbNoted()) { markFbNoted(); evs.push({ t, icon: "🤖", text: `AI生成が使えないため簡易エンジンで進行(${String(fbMsg).slice(0, 60)})`, type: "system" }); }
    (result.highlights || []).forEach(hl => hl.text && evs.push({ t, icon: hl.icon || "・", text: hl.text, type: "action" }));
    let newCh = applyChallenges(S.challenges, { create: result.newChallenges, prog: result.progressChallenges, done: result.completedChallenges }, S.agents, evs, t);
    let fundGains = {};
    if (S.scenario === "post" || (S.scenario === "transition" && S.flags.fund_law)) {
      const fr = applyFund(newCh, null, 1 / 30, evs, t);
      newCh = fr.chList; fundGains = fr.gains;
    }
    const dist = distributeFlow(S.agents, newCh, result.supportFlow || 100);
    const totalSupD = S.agents.reduce((s, a) => s + a.support, 0) || 1;
    const updated = S.agents.map(a => {
      const inc = S.scenario === "post" ? Math.max(0, CAP_FLOOR - a.support)
        : S.scenario === "transition" ? trJumpIncome(a, S.flags, 1, totalSupD)
        : (a.dailyIncome || 0);
      issuedRef.current += inc;
      const arc = (result.highlights || []).find(x => x.agentId === a.id && x.text);
      return finalize({ ...a, speech: null, support: a.support + inc + (fundGains[a.id] || 0), recv: (a.recv || 0) + (dist[a.id] || 0) + (fundGains[a.id] || 0),
        res: applyJumpGlow(stepResourcesJump(a, 1, result.dMental || 0, newCh), (dist[a.id] || 0) + (fundGains[a.id] || 0)),
        memories: arc ? [...a.memories.slice(-9), `${t}:${arc.text}`] : a.memories });
    });
    setAgents(updated); setChallenges(newCh);
    setEvents(ev => pushEvents(ev, evs));
    setWorldNote(result.worldNote || "");
    addZoneHours(updated, 1);
    recordMetric(updated, newCh, S.institutions, result.supportFlow || 100, t);
    setNow(next);
  }, []);

  // ===== 1ヶ月 =====
  const tickMonth = useCallback(async () => {
    const S = stateRef.current;
    const next = new Date(S.now); next.setMonth(next.getMonth() + 1);
    const t = `${next.getFullYear()}年${next.getMonth() + 1}月`;
    let result, fbMsg = null;
    const monthSys = S.scenario === "transition" ? TR_MONTH_SYSTEM(S.flags, S.now.getFullYear()) : MONTH_SYSTEM(S.scenario);
    try { result = parseJSON(await callClaude(monthSys, `${t}までの1ヶ月分を生成。\n${rosterText(S.agents, S.challenges)}\n【定着済みの文化】${S.institutions.join(",")||"なし"}\n【施行中の追加ルール】${S.customRules.join(" / ") || "なし"}`)); }
    catch (fe) { result = fbMonth(S.scenario === "transition" ? { ...S, scenario: trFallbackScenario(S.flags) } : S); fbMsg = fe && fe.message; }
    const evs = [{ t, icon: "🗓", text: `【1ヶ月経過】${result.headline}`, type: "epoch" }];
    if (fbMsg && !fbNoted()) { markFbNoted(); evs.push({ t, icon: "🤖", text: `AI生成が使えないため簡易エンジンで進行(${String(fbMsg).slice(0, 60)})`, type: "system" }); }
    (result.trends || []).forEach(x => x.text && evs.push({ t, icon: x.icon || "📈", text: x.text, type: "trend" }));
    (result.arcs || []).forEach(x => {
      if (!x.text) return;
      const a = S.agents.find(ag => ag.id === x.agentId);
      evs.push({ t, icon: a?.emoji || "👤", text: `${a ? a.name + ": " : ""}${x.text}`, type: "action" });
    });
    let newCh = applyChallenges(S.challenges, { create: result.newChallenges, done: result.completedChallenges }, S.agents, evs, t);
    newCh = newCh.map(c => c.status === "active" ? { ...c, progress: Math.min(3, c.progress + 1), totalSupport: c.totalSupport + 80 + Math.floor(Math.random() * 200) } : c);
    const newInst = [...S.institutions, ...(result.newInstitutions || [])];
    (result.newInstitutions || []).forEach(n => evs.push({ t, icon: "🏛", text: `「${n}」が街の文化として定着`, type: "institution" }));
    let fundGains = {};
    if (S.scenario === "post" || (S.scenario === "transition" && S.flags.fund_law)) {
      const fr = applyFund(newCh, null, 1, evs, t);
      newCh = fr.chList; fundGains = fr.gains;
    }
    const dist = distributeFlow(S.agents, newCh, result.supportFlow || 3000);
    const totalSupM = S.agents.reduce((s, a) => s + a.support, 0) || 1;
    const updated = S.agents.map(a => {
      const inc = S.scenario === "post" ? Math.max(0, CAP_FLOOR - a.support)
        : S.scenario === "transition" ? trJumpIncome(a, S.flags, 30, totalSupM)
        : (a.dailyIncome || 0) * 30;
      issuedRef.current += inc;
      const arc = (result.arcs || []).find(x => x.agentId === a.id && x.text);
      return finalize({ ...a, speech: null, support: a.support + inc + (fundGains[a.id] || 0), recv: (a.recv || 0) + (dist[a.id] || 0) + (fundGains[a.id] || 0),
        res: applyJumpGlow(stepResourcesJump(a, 30, result.dMental || 0, newCh), (dist[a.id] || 0) + (fundGains[a.id] || 0)),
        memories: [...a.memories.slice(-8), `${t}:${arc ? arc.text : "月日が流れた"}`] });
    });
    setAgents(updated); setChallenges(newCh); setInstitutions(newInst);
    setEvents(ev => pushEvents(ev, evs));
    setWorldNote(result.worldNote || "");
    addZoneHours(updated, 30);
    recordMetric(updated, newCh, newInst, result.supportFlow || 3000, t);
    setNow(next);
  }, []);

  // ===== 1年 =====
  const tickYear = useCallback(async () => {
    const S = stateRef.current;
    const next = new Date(S.now); next.setFullYear(next.getFullYear() + 1);
    const t = `${next.getFullYear()}年`;
    let result, fbMsg = null;
    const yearSys = S.scenario === "transition" ? TR_YEAR_SYSTEM(S.flags, S.now.getFullYear()) : YEAR_SYSTEM(S.scenario);
    const yearExtra = S.scenario === "transition"
      ? `\n【就労者数】${S.agents.filter(a => a.works).length}/50 【現在の年】${S.now.getFullYear()}年(2050年まであと${Math.max(0, 2050 - S.now.getFullYear())}年)`
      : "";
    try { result = parseJSON(await callClaude(yearSys, `${S.now.getFullYear()}年の1年分を生成。\n${rosterText(S.agents, S.challenges)}\n【定着済みの文化】${S.institutions.join(",")||"なし"}\n【平均幸福度】${Math.round(S.agents.reduce((s,a)=>s+a.happiness,0)/S.agents.length)} 【平均余白】${(S.agents.reduce((s,a)=>s+a.slack,0)/S.agents.length).toFixed(1)}${yearExtra}\n【施行中の追加ルール】${S.customRules.join(" / ") || "なし"}`)); }
    catch (fe) {
      result = fbYear(S.scenario === "transition" ? { ...S, scenario: trFallbackScenario(S.flags) } : S);
      if (S.scenario === "transition") {
        result.milestones = fbTrMilestones(S.flags, next.getFullYear());
        // 移行期は+1年が基本操作なので、簡易エンジンでも草の根の挑戦が生まれる
        result.newChallenges = fbNewChallenges(S, S.flags.support_law ? 0.9 : 0.55);
      }
      fbMsg = fe && fe.message;
    }
    const evs = [{ t, icon: "🌏", text: `【1年経過】${result.eraName}`, type: "epoch" }];

    // ===== 移行期: 制度転換の創発的成立(前提条件・重複はコードで検証) =====
    let nf = S.flags;
    if (S.scenario === "transition") {
      const mr = applyMilestones(S.flags, result.milestones, next.getFullYear());
      nf = mr.flags;
      mr.applied.forEach(k => evs.push({ t, icon: MILESTONES[k].icon, text: `【制度転換】${MILESTONES[k].label}が成立 — ${MILESTONES[k].desc}`, type: "epoch" }));
      if (S.now.getFullYear() < 2050 && next.getFullYear() >= 2050) {
        evs.push({
          t, icon: "🗼", type: "epoch",
          text: nf.bi_full
            ? "【2050年到達】応援資本主義への移行が完了。NEOタウンの物語はここから始まる"
            : `【2050年到達】移行はまだ道半ば(成立した転換 ${Object.keys(nf).length}/5)。社会は変わり続ける`,
        });
      }
      setFlags(nf);
    }
    if (fbMsg && !fbNoted()) { markFbNoted(); evs.push({ t, icon: "🤖", text: `AI生成が使えないため簡易エンジンで進行(${String(fbMsg).slice(0, 60)})`, type: "system" }); }
    (result.transformations || []).forEach(x => x.text && evs.push({ t, icon: x.icon || "🌐", text: x.text, type: "trend" }));
    (result.arcs || []).forEach(x => {
      if (!x.text) return;
      const a = S.agents.find(ag => ag.id === x.agentId);
      evs.push({ t, icon: a?.emoji || "👤", text: `${a ? a.name + ": " : ""}${x.text}`, type: "action" });
    });
    if (result.risk) evs.push({ t, icon: "⚠️", text: `社会リスク: ${result.risk}`, type: "risk" });
    let newCh;
    if (S.scenario === "transition") {
      // 移行期: +1年が基本操作なので挑戦もここで生まれ、複数年かけて進行・実現する
      newCh = applyChallenges(S.challenges, { create: result.newChallenges, done: result.completedChallenges }, S.agents, evs, t);
      newCh = newCh.map(c => {
        if (c.status !== "active") return c;
        if (c.progress >= 3) {
          evs.push({ t, icon: "🎉", text: `挑戦「${c.name}」が実現!街の文化になった`, type: "challenge" });
          return { ...c, status: "done" };
        }
        const boost = nf.support_law ? 120 + Math.floor(Math.random() * 240) : 20 + Math.floor(Math.random() * 40);
        return { ...c, progress: Math.min(3, c.progress + 2), totalSupport: c.totalSupport + boost };
      });
    } else {
      newCh = applyChallenges(S.challenges, { done: result.completedChallenges }, S.agents, evs, t);
      newCh = newCh.map(c => c.status === "active" ? { ...c, progress: 3, status: "done" } : c);
    }
    const newInst = [...S.institutions, ...(result.newInstitutions || [])];
    (result.newInstitutions || []).forEach(n => evs.push({ t, icon: "🏛", text: `「${n}」が制度・文化として定着`, type: "institution" }));
    let fundGains = {};
    if (S.scenario === "post" || (S.scenario === "transition" && nf.fund_law)) {
      const fr = applyFund(newCh, null, 12, evs, t);
      newCh = fr.chList; fundGains = fr.gains;
    }
    const dist = distributeFlow(S.agents, newCh, result.supportFlow || 50000);
    const totalSupY = S.agents.reduce((s, a) => s + a.support, 0) || 1;
    let jobsLost = 0;
    const updated = S.agents.map(a => {
      // 移行期: 自動化の波の成立後は毎年一定割合が職を失う(充足BIまで)
      let base = a;
      if (S.scenario === "transition" && nf.auto_wave && !nf.bi_full && a.works && Math.random() < 0.12) {
        base = { ...a, works: false, dailyIncome: a.age >= 65 ? 28 : 12 };
        jobsLost++;
      }
      const inc = S.scenario === "post" ? Math.max(0, CAP_FLOOR - base.support)
        : S.scenario === "transition" ? trJumpIncome(base, nf, 365, totalSupY)
        : (base.dailyIncome || 0) * 365;
      issuedRef.current += inc;
      const arc = (result.arcs || []).find(x => x.agentId === a.id && x.text);
      const res = applyJumpGlow(stepResourcesJump(base, 365, result.dMental || 0, newCh), (dist[a.id] || 0) + (fundGains[a.id] || 0));
      if (S.scenario === "transition") {
        // 定着した文化(対話の場・互助)が「つながり」の底を支える — 24年運転での孤立崩壊を防ぐ
        const connFloor = 22 + Math.min(10, newInst.length) * 3;
        res.conn = Math.max(res.conn, clamp(connFloor + noise(4)));
      }
      return finalize({ ...base, age: base.age + 1, speech: null, support: base.support + inc + (fundGains[a.id] || 0), recv: (base.recv || 0) + (dist[a.id] || 0) + (fundGains[a.id] || 0),
        res,
        memories: [...base.memories.slice(-6), `${t}:${arc ? arc.text : "1年が過ぎ、少し歳を重ねた"}`] });
    });
    if (jobsLost > 0) evs.push({ t, icon: "🤖", text: `自動化により今年${jobsLost}人が職を失った`, type: "risk" });
    setAgents(updated); setChallenges(newCh); setInstitutions(newInst);
    setEraName(result.eraName);
    setEvents(ev => pushEvents(ev, evs));
    setWorldNote(result.worldNote || "");
    addZoneHours(updated, 365);
    recordMetric(updated, newCh, newInst, result.supportFlow || 50000, t);
    setNow(next);
  }, []);

  // ===== 実行ラッパー(リトライ付き) =====
  const run = useCallback(async (fn, label) => {
    if (stateRef.current.ticking) return;
    setTicking(true); setProgress(label); setError(null);
    try { await fn(); }
    catch (e1) {
      console.warn("1回目失敗、リトライ", e1);
      try { await fn(); }
      catch (e2) { console.error(e2); setError(`生成に失敗: ${(e2 && e2.message) || e2}`.slice(0, 160)); setPlaying(false); }
    }
    setTicking(false); setProgress(null);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && stateRef.current.playing) {
        await run(tickHour, "1時間");
        await new Promise(r => setTimeout(r, 1000));
      }
    })();
    return () => { cancelled = true; };
  }, [playing, run, tickHour]);

  // ===== AI観測レポート =====
  const genReport = async () => {
    if (reportLoading) return;
    setReportLoading(true);
    const S = stateRef.current;
    try {
      const m0 = S.metrics[0], mN = S.metrics[S.metrics.length - 1];
      const supports = S.agents.map(a => a.support).sort((a, b) => b - a);
      const total = supports.reduce((s, x) => s + x, 0) || 1;
      const top20 = Math.round(supports.slice(0, 10).reduce((s, x) => s + x, 0) / total * 100);
      const zh = zoneHoursRef.current;
      const zTotal = Object.values(zh).reduce((s, x) => s + x, 0) || 1;
      const timeUse = Object.entries(zh).map(([k, v]) => `${ZONES[k].name}${Math.round(v / zTotal * 100)}%`).join(",");
      const resAvg = RES_DEF.map(rd => `${rd.label}${Math.round(S.agents.reduce((s, a) => s + (rd.key === "cap" ? normCap(a.support) : a.res[rd.key]), 0) / S.agents.length)}`).join(",");
      const burnout = S.agents.filter(a => a.res.ment < 35 || a.res.stam < 30).map(a => a.name).slice(0, 5).join(",");
      const avgBy = f => { const g = S.agents.filter(f); return g.length ? Math.round(g.reduce((s, a) => s + a.happiness, 0) / g.length) : "-"; };
      const demo = `男${avgBy(a=>a.sex==="男")}/女${avgBy(a=>a.sex==="女")} 若年(〜39)${avgBy(a=>a.age<=39)}/中年${avgBy(a=>a.age>39&&a.age<65)}/高齢${avgBy(a=>a.age>=65)} 富裕層${avgBy(a=>a.isRich)}/非富裕${avgBy(a=>!a.isRich)}`;
      const yr = S.metrics.filter(m => /^\d{4}年$/.test(m.label));
      const yearlyLine = yr.length
        ? `\n年次推移(年: 幸福/余白/挑戦者数/資本ジニ/循環%/メンタル):\n${yr.map(m => `${m.label} ${m.幸福度}/${m.余白}/${m.挑戦者数}/${m.資本偏り}/${m.循環率}/${m.メンタル}`).join("\n")}`
        : "";
      const trLine = S.scenario === "transition"
        ? `\n成立済みの制度転換: ${Object.entries(S.flags).map(([k, y]) => `${MILESTONES[k].label}(${y}年)`).join(",") || "なし"} / 就労者数 ${S.agents.filter(a => a.works).length}/50`
        : "";
      const data = `シナリオ: ${ALL_SCENARIOS[S.scenario].label}${trLine}
期間: 2050/1/1〜${fmtDate(S.now)}
挑戦者: ${m0 ? m0.挑戦者数 : 0}人 → ${mN ? mN.挑戦者数 : 0}人 (人口50) 累計挑戦${S.challenges.length}件(実現${S.challenges.filter(c=>c.status==="done").length}件)
資本: ジニ係数 ${m0 ? m0.資本偏り : 0} → ${mN ? mN.資本偏り : 0} / 上位20%シェア ${top20}% / 循環率(応援流通÷BI支給) ${mN ? mN.循環率 : 0}%
富への敬意: 富裕層(資産上位10人)への応援シェア ${m0 ? m0.富裕層応援シェア : 0}% → ${mN ? mN.富裕層応援シェア : 0}% / 挑戦者への応援シェア ${mN ? mN.挑戦者応援シェア : 0}%
時間の使い方(累計滞在): ${timeUse}
6資源の街平均: ${resAvg}
余白: ${m0 ? m0.余白 : "-"} → ${mN ? mN.余白 : "-"} / 幸福度: ${m0 ? m0.幸福度 : "-"} → ${mN ? mN.幸福度 : "-"}
属性別平均幸福: ${demo}
消耗が心配な住民: ${burnout || "なし"} / 定着文化: ${S.institutions.join(",") || "なし"}
施行中の追加ルール: ${S.customRules.join(" / ") || "なし(基金配分・挑戦認定・所有権は未整備)"}${yearlyLine}`;
      const sys = `あなたは応援資本主義シミュレーションの観測研究者。哲学:「豊かさはちょうど良い余白(最適≈12)。不足は窮屈、過剰は退屈」。「${ALL_SCENARIOS[S.scenario].label}」型社会(${ALL_SCENARIOS[S.scenario].desc})のデータから以下を分析: ①挑戦者は増えたか ②資本の偏りと循環(蓄財と応援循環のどちらが優勢か) ③人は何に時間を使っているか ④余白は適正か ⑤富はまだ尊敬を集めるか(富裕層vs挑戦者への応援シェアから判断) ⑥格差(男女・世代・貧富)は幸福差を生んでいるか ⑦年次推移データがあれば、悪化・回復の転換点となった年とその要因を推定。各見出し2文で数値を引用。良い面だけでなく問題や悪化も正直に指摘すること。最後に「この社会で目指される生き方」を総評2文で。装飾記号やマークダウン禁止。`;
      const ans = await callClaude(sys, data);
      reportDataRef.current = data;
      setReport({ text: ans, t: fmtDate(S.now) });
      setReportChat([]);
    } catch (e) {
      setReport({ text: `レポート生成に失敗: ${(e && e.message) || e}。サーバーのANTHROPIC_API_KEYが設定されているか確認してください。`, t: "" });
    }
    setReportLoading(false);
  };

  // ===== レポートについての議論チャット =====
  const askReport = async () => {
    if (!reportQ.trim() || !report?.t || reportChatLoading) return;
    const q = reportQ;
    setReportChat(rc => [...rc, { role: "you", text: q }]);
    setReportQ(""); setReportChatLoading(true);
    try {
      const S = stateRef.current;
      const sys = `あなたは応援資本主義シミュレーションの観測研究者。哲学:「豊かさはちょうど良い余白(最適≈12)。不足は窮屈、過剰は退屈」。「${ALL_SCENARIOS[S.scenario].label}」型社会のシミュレーションについて、以下の観測データとあなた自身が書いた分析レポートを踏まえてユーザーと議論する。データから具体的な数値を引いて簡潔(4文以内)に答える。データに無いことは推測と明示する。反論には誠実に向き合い、正しければ自説を修正する。装飾記号やマークダウン禁止。
【観測データ】
${reportDataRef.current}
【あなたの分析レポート】
${report.text}`;
      const history = reportChat.slice(-8).map(m => `${m.role === "you" ? "ユーザー" : "研究者(あなた)"}: ${m.text}`).join("\n");
      const ans = await callClaude(sys, `${history ? `これまでの議論:\n${history}\n\n` : ""}ユーザーの発言: ${q}`);
      setReportChat(rc => [...rc, { role: "ai", text: ans }]);
    } catch (e) {
      setReportChat(rc => [...rc, { role: "ai", text: `(応答に失敗: ${(e && e.message) || e})` }]);
    }
    setReportChatLoading(false);
  };

  // ===== インタビュー =====
  const askAgent = async () => {
    if (!interviewQ.trim() || !selected || interviewLoading) return;
    const a = agents.find(x => x.id === selected);
    const q = interviewQ;
    setInterview(iv => [...iv, { role: "you", text: q }]);
    setInterviewQ(""); setInterviewLoading(true);
    try {
      const sys = `あなたは${now.getFullYear()}年のNEOタウン住民「${a.name}」(${a.age}歳)。${a.persona} 目標:${a.goal} 幸福度:${a.happiness} 余白:${a.slack} いま一番足りないもの:${weakest(a)} 記憶:${a.memories.slice(-5).join("、") || "なし"}。定着した文化:${institutions.slice(-4).join("、") || "まだない"}。この人物として一人称で自然に短く(3文以内)答える。取り繕わず、不満や不安があれば正直に話す。`;
      const ans = await callClaude(sys, q);
      setInterview(iv => [...iv, { role: "agent", text: ans }]);
    } catch (e) { setInterview(iv => [...iv, { role: "agent", text: `(AI応答が使えません: ${(e && e.message) || ""}。サーバーのANTHROPIC_API_KEYを設定するとインタビューが使えます)` }]); }
    setInterviewLoading(false);
  };

  // ===== シミュレーション記録(Supabase) =====
  const snapshot = () => {
    const S = stateRef.current;
    return {
      version: 1,
      scenario: S.scenario,
      now: S.now.getTime(),
      agents: S.agents,
      events: S.events,
      challenges: S.challenges,
      institutions: S.institutions,
      customRules: S.customRules,
      metrics: S.metrics,
      eraName: S.eraName,
      worldNote: S.worldNote,
      flags: S.flags,
      zoneHours: { ...zoneHoursRef.current },
      issued: issuedRef.current,
    };
  };
  const runTitle = () => `${ALL_SCENARIOS[stateRef.current.scenario].short} ${fmtDate(stateRef.current.now)}`;

  const doSave = async () => {
    if (saveBusy) return;
    setSaveBusy(true); setSaveMsg(null);
    try {
      const r = await saveRun(snapshot(), { title: runTitle(), scenario: stateRef.current.scenario }, runId);
      setRunId(r.id);
      setSaveMsg("💾 保存しました(以降は自動で上書き保存)");
    } catch (e) {
      setSaveMsg(`保存失敗: ${(e && e.message) || e}`.slice(0, 90));
    }
    setSaveBusy(false);
    setTimeout(() => setSaveMsg(null), 5000);
  };

  // 一度保存した記録は、時間が進むたびに自動で上書き保存(3秒デバウンス・失敗は静かに無視)
  useEffect(() => {
    if (!runId || !metrics.length) return;
    const t = setTimeout(() => {
      saveRun(snapshot(), { title: runTitle(), scenario: stateRef.current.scenario }, runId)
        .catch(e => console.warn("自動保存失敗", e));
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, runId]);

  const openLoad = () => {
    setLoadOpen(true); setRuns(null); setRunsError(null);
    listRuns().then(r => setRuns(r.runs)).catch(e => { setRuns([]); setRunsError(String((e && e.message) || e)); });
  };

  const restore = (s, id) => {
    setPlaying(false);
    setScenario(s.scenario); setAgents(s.agents); setNow(new Date(s.now));
    setEvents(s.events || []); setChallenges(s.challenges || []); setInstitutions(s.institutions || []);
    setCustomRules(s.customRules || []); setMetrics(s.metrics || []);
    setEraName(s.eraName || null); setWorldNote(s.worldNote || ""); setFlags(s.flags || {});
    zoneHoursRef.current = s.zoneHours || { house: 0, culture: 0, sports: 0, robots: 0, food: 0, home: 0 };
    issuedRef.current = s.issued || 0;
    setSelected(null); setInterview([]); setReport(null); setReportChat([]); setError(null);
    setRunId(id); setLoadOpen(false);
    setSaveMsg("📂 記録を読み込みました");
    setTimeout(() => setSaveMsg(null), 4000);
  };

  const doLoad = async (id) => {
    try {
      const r = await loadRun(id);
      restore(r.state, r.id);
    } catch (e) { setRunsError(String((e && e.message) || e)); }
  };

  const doDelete = async (id) => {
    try {
      await deleteRun(id);
      setRuns(rs => (rs || []).filter(x => x.id !== id));
      if (id === runId) setRunId(null);
    } catch (e) { setRunsError(String((e && e.message) || e)); }
  };

  const reset = (scn = stateRef.current.scenario) => {
    setPlaying(false); setScenario(scn); setAgents(populationFor(scn)); setNow(startFor(scn));
    setEvents([]); setChallenges([]); setInstitutions([]); setMetrics([]); setCustomRules([]); setFlags({});
    setSelected(null); setInterview([]); setEraName(null); setReport(null); setReportChat([]);
    zoneHoursRef.current = { house: 0, culture: 0, sports: 0, robots: 0, food: 0, home: 0 };
    issuedRef.current = 0;
    resetFbNoted();
    setRunId(null); // リセット後は別の記録として保存する
    setWorldNote(`${startFor(scn).getFullYear()}年1月1日、シミュレーション待機中`); setError(null);
  };

  const enactRule = () => {
    if (!ruleInput.trim()) return;
    const r = ruleInput.trim();
    setCustomRules(cr => [...cr, r]);
    setEvents(ev => pushEvents(ev, [{ t: shortLabel(now), icon: "⚖️", text: `制度改正: 「${r}」が施行された`, type: "institution" }]));
    setRuleInput("");
  };

  const sel = agents.find(a => a.id === selected);
  const hour = now.getHours();
  const isNight = hour >= 20 || hour <= 5;
  const avgH = Math.round(agents.reduce((s, a) => s + a.happiness, 0) / agents.length);
  const avgSlack = Math.round(agents.reduce((s, a) => s + a.slack, 0) / agents.length * 10) / 10;

  const zoneCount = {};
  const agentPos = agents.map(a => {
    const z = ZONES[a.zone];
    const k = zoneCount[a.zone] = (zoneCount[a.zone] || 0) + 1;
    const ring = Math.floor((k - 1) / 8), idx = (k - 1) % 8;
    const rad = 4.5 + ring * 3.2;
    const ang = idx / 8 * Math.PI * 2 + ring * 0.4;
    return {
      ...a,
      px: Math.max(3, Math.min(97, z.x + Math.cos(ang) * rad)),
      py: Math.max(4, Math.min(96, z.y + Math.sin(ang) * rad * 0.8 + 2)),
    };
  });

  const jumpBtn = (label, fn, cls) => (
    <button onClick={() => run(fn, label)} disabled={ticking || playing}
      className={`rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-40 shrink-0 whitespace-nowrap border border-white/5 shadow-sm ${cls}`}>+{label}</button>
  );
  const resValue = (a, key) => key === "cap" ? normCap(a.support) : a.res[key];

  return (
    <div className="w-full h-screen flex flex-col bg-slate-950 text-white font-sans overflow-hidden">
      {/* ===== ヘッダー ===== */}
      <div className="bg-slate-950/95 border-b border-white/5 px-3.5 py-2.5 space-y-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 flex items-baseline gap-2">
            <span className="font-black tracking-[0.28em] text-base bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent">NEO</span>
            <span className="text-[9px] font-bold text-slate-500 tracking-widest">2050・余白理論 v3.3</span>
          </div>
          {eraName && <div className="text-[10px] bg-indigo-500/15 border border-indigo-400/30 rounded-full px-3 py-1 text-indigo-200 truncate">{eraName}</div>}
          {scenario === "transition" && (
            <div className="text-[10px] bg-cyan-500/15 border border-cyan-400/30 rounded-full px-3 py-1 text-cyan-200 shrink-0 whitespace-nowrap" title="創発的に成立した制度転換の数">
              🧭 制度転換 {Object.keys(flags).length}/5
            </div>
          )}
          <div className="ml-auto text-[10px] md:text-xs font-mono bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 shrink-0 whitespace-nowrap text-slate-200">{fmtDate(now)} {isNight ? "🌙" : "☀️"}</div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          <div className="flex rounded-xl bg-slate-800/80 border border-white/5 p-0.5 shrink-0">
            {Object.entries(ALL_SCENARIOS).map(([k, s]) => (
              <button key={k} onClick={() => k !== scenario && reset(k)}
                className={`px-3 py-1.5 text-[10px] font-bold whitespace-nowrap rounded-lg transition ${scenario === k ? "bg-indigo-500 text-white shadow-md shadow-indigo-950/60" : "text-slate-400 hover:text-slate-200"}`}>
                {s.short}
              </button>
            ))}
          </div>
          <div className="flex rounded-xl bg-slate-800/80 border border-white/5 p-0.5 shrink-0" title="立体空間と平面分析を切り替え">
            {[["3d", "🌐 3D空間"], ["2d", "🗺 2Dマップ"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[10px] font-bold whitespace-nowrap rounded-lg transition ${view === v ? "bg-cyan-600 text-white shadow-md shadow-cyan-950/60" : "text-slate-400 hover:text-slate-200"}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setPlaying(p => !p)} disabled={ticking && !playing}
            className={`flex items-center gap-1 rounded-xl px-3.5 py-2 text-xs font-bold transition shrink-0 border border-white/5 shadow-sm ${playing ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"}`}>
            {playing ? <Pause size={13}/> : <Play size={13}/>}{playing ? "停止" : "自動"}
          </button>
          {jumpBtn("1時間", tickHour, "bg-slate-700 hover:bg-slate-600")}
          {jumpBtn("1日", tickDay, "bg-cyan-800 hover:bg-cyan-700")}
          {jumpBtn("1ヶ月", tickMonth, "bg-violet-800 hover:bg-violet-700")}
          {jumpBtn("1年", tickYear, "bg-amber-700 hover:bg-amber-600")}
          <button onClick={() => reset()} className="rounded-xl p-2 bg-slate-800 hover:bg-slate-700 border border-white/5 shrink-0" title="リセット"><RotateCcw size={13}/></button>
          <div className="w-px h-5 bg-white/10 shrink-0" />
          <button onClick={doSave} disabled={saveBusy}
            className="rounded-xl px-3 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-white/5 disabled:opacity-40 shrink-0 whitespace-nowrap"
            title="現在の状態をクラウドに保存">{saveBusy ? "💾 保存中…" : runId ? "💾 上書き保存" : "💾 保存"}</button>
          <button onClick={openLoad}
            className="rounded-xl px-3 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-white/5 shrink-0 whitespace-nowrap"
            title="保存した記録の一覧">📂 記録</button>
          {saveMsg && <span className="text-[10px] text-slate-300 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 shrink-0 whitespace-nowrap">{saveMsg}</span>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0" style={{ flexDirection: isMobile ? "column" : "row" }}>
        {/* ===== 俯瞰マップ(🌐3D空間 / 🗺2Dマップ) ===== */}
        <div className="relative w-full min-w-0 overflow-hidden"
          style={isMobile ? { height: "44vh", minHeight: 250, flex: "none" } : { flex: 1 }}>
          {view === "3d" ? (
            <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-xs text-slate-400">🌐 3D空間を読み込み中…</div>}>
              <Map3D agents={agentPos} selected={selected} isNight={isNight}
                stages={scenario === "transition" ? {
                  neoTiers: (flags.support_law ? 1 : 0) + (flags.bi_trial ? 1 : 0) + (flags.bi_full ? 1 : 0),
                  robots: !!flags.auto_wave,
                  drones: !!flags.auto_wave,
                } : null}
                onSelect={id => { setSelected(id); setInterview([]); }} />
            </Suspense>
          ) : (
            <>
              {/* 空(昼夜グラデーション)・ドットグリッド・ビネット */}
              <div className="absolute inset-0 transition-all duration-1000" style={{
                background: isNight
                  ? "radial-gradient(120% 95% at 50% 30%, #241f52 0%, #131036 55%, #07051c 100%)"
                  : "radial-gradient(120% 95% at 50% 30%, #10537a 0%, #0a3a58 55%, #051e30 100%)",
              }} />
              <div className="absolute inset-0" style={{
                backgroundImage: "radial-gradient(rgba(255,255,255,.55) 1px, transparent 1.2px)",
                backgroundSize: "28px 28px", opacity: isNight ? 0.1 : 0.08,
              }} />
              <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 160px 30px rgba(0,0,0,.45)" }} />

              {/* 街路(NEO HOUSEから各ゾーンへ) */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {Object.values(ZONES).map((z, i) => (
                  <path key={i} d={`M 50 40 Q ${(50 + z.x) / 2} ${(40 + z.y) / 2 - 3} ${z.x} ${z.y}`} fill="none"
                    stroke="rgba(255,255,255,.18)" strokeWidth="0.35" strokeDasharray="0.12 1.5" strokeLinecap="round" />
                ))}
              </svg>

              {Object.entries(ZONES).map(([key, z]) => {
                const count = agents.filter(a => a.zone === key).length;
                const zw = z.r * (isMobile ? 6.5 : 11), zh = z.r * (isMobile ? 5 : 9);
                return (
                  <div key={key} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none" style={{ left: `${z.x}%`, top: `${z.y}%` }}>
                    <div className="rounded-full flex flex-col items-center justify-center backdrop-blur-[2px] transition-shadow duration-700"
                      style={{
                        width: zw, height: zh,
                        background: `radial-gradient(ellipse at 50% 32%, ${z.color}3d 0%, ${z.color}14 55%, transparent 78%)`,
                        border: `1.5px solid ${z.color}59`,
                        boxShadow: `0 0 ${count > 6 ? 46 : 22}px ${z.color}${count > 6 ? "59" : "26"}, inset 0 0 34px ${z.color}1f`,
                      }}>
                      <div className={isMobile ? "text-base" : "text-2xl"} style={{ filter: `drop-shadow(0 0 8px ${z.color}aa)` }}>{z.icon}</div>
                      <div className="text-[10px] font-bold tracking-[0.2em]" style={{ color: z.color, textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>{z.name}</div>
                      <div className="text-[10px] font-mono bg-black/50 border border-white/10 rounded-full px-2 py-px mt-1 text-slate-200">{count}</div>
                    </div>
                  </div>
                );
              })}

              {agentPos.map(a => (
                <div key={a.id} className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 flex flex-col items-center group p-1.5 -m-1.5"
                  style={{ left: `${a.px}%`, top: `${a.py}%`, transition: "left 1s ease, top 1s ease" }}
                  onClick={() => { setSelected(a.id); setInterview([]); }}>
                  {a.speech && <div className="absolute -top-9 whitespace-nowrap max-w-[180px] overflow-hidden text-ellipsis bg-white/95 text-slate-900 text-[10px] rounded-xl rounded-bl-sm px-2.5 py-1.5 shadow-xl font-medium z-20">{a.speech}</div>}
                  {/* メンタル/体力が枯渇している住民はSOSサイン */}
                  {(a.res.ment < 30 || a.res.stam < 25) && <div className="absolute -top-3.5 text-[11px] animate-pulse">🆘</div>}
                  {a.emoji ? (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base border-2 border-white/90 transition-transform hover:scale-125 ${selected === a.id ? "ring-2 ring-yellow-300" : ""}`}
                      style={{ background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.45), transparent 50%), ${a.color}`, boxShadow: `0 2px 10px rgba(0,0,0,.5), 0 0 14px ${a.color}66` }}>{a.emoji}</div>
                  ) : (
                    <div className={`w-[13px] h-[13px] rounded-full border border-white/70 transition-transform hover:scale-150 ${selected === a.id ? "ring-2 ring-yellow-300" : ""}`}
                      style={{ background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.55), transparent 55%), ${a.color}`, boxShadow: `0 0 8px ${a.color}77`, opacity: 0.55 + a.happiness / 220 }} />
                  )}
                  <div className={`text-[8px] font-bold bg-black/70 rounded-full px-1.5 py-px mt-1 ${a.emoji ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}`}>{a.name}</div>
                </div>
              ))}
            </>
          )}

          {/* 共通オーバーレイ(3D/2D両方に表示) */}
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 bg-slate-950/60 backdrop-blur-md rounded-full px-4 py-1.5 text-xs border border-white/10 shadow-lg max-w-[92%] whitespace-nowrap overflow-hidden text-ellipsis">
            {ticking ? <span className="animate-pulse">🧠 {progress}分の社会を生成中…</span> : `🏙 ${worldNote}`}
          </div>
          {error && <div className="absolute top-11 left-1/2 -translate-x-1/2 z-20 bg-rose-600/90 rounded-lg px-3 py-1 text-xs max-w-[92%]">{error}</div>}
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2.5 bg-slate-950/60 backdrop-blur-md rounded-xl px-3.5 py-2 text-[10px] text-slate-300 border border-white/10 shadow-lg">
            <span>😊 幸福 <b className={avgH > 65 ? "text-emerald-300" : avgH > 40 ? "text-amber-300" : "text-rose-300"}>{avgH}</b></span>
            <span className="text-white/15">|</span>
            <span>🌿 余白 <b className={slackState(avgSlack).cls}>{avgSlack}</b></span>
            <span className="text-white/15">|</span>
            <span>🚩 挑戦 {challenges.filter(c => c.status === "active").length}</span>
            <span className="text-white/15">|</span>
            <span>🏛 文化 {institutions.length}</span>
          </div>
          {view === "3d" && (
            <div className="absolute bottom-3 right-3 z-20 bg-slate-950/60 backdrop-blur-md rounded-xl px-3 py-1.5 text-[9px] text-slate-400 border border-white/10 shadow-lg">
              🖱 ドラッグ:回転 / 右ドラッグ:移動 / ホイール:ズーム / 住民クリック:詳細
            </div>
          )}
        </div>

        {/* ===== パネル (モバイル:下 / PC:右) ===== */}
        <div className={`bg-slate-950 flex flex-col min-h-0 ${isMobile ? "border-t w-full" : "border-l"} border-white/5`}
          style={isMobile ? { flex: 1 } : { width: 336, flex: "none" }}>
          <div className="flex border-b border-white/5 text-[11px] font-bold">
            {[["timeline", "年代記", Activity], ["metrics", "指標", Heart], ["challenges", "挑戦", Flag], ["culture", "文化", Landmark]].map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={`relative flex-1 flex items-center justify-center gap-1.5 py-3 transition ${tab === k ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
                <Icon size={12}/>{label}
                {tab === k && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-9 h-0.5 rounded-full bg-indigo-400" />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
            {tab === "timeline" && (events.length === 0
              ? <div className="text-xs text-slate-500 text-center pt-8">時間を進めると年代記が刻まれます。<br/><br/>+1時間: 個人の行動を詳細観察<br/>+1日: 一日のダイジェスト<br/>+1ヶ月: 社会トレンドの変化<br/>+1年: 時代レベルの大変動</div>
              : [...events].reverse().map((e, i) => (
                <div key={i} className={`text-xs rounded-lg px-3 py-2 leading-relaxed ${
                  e.type === "epoch" ? "bg-indigo-900/70 border border-indigo-600 font-bold" :
                  e.type === "trend" ? "bg-slate-800 border-l-2 border-cyan-500" :
                  e.type === "institution" ? "bg-emerald-950/60 border border-emerald-800/50" :
                  e.type === "risk" ? "bg-rose-950/70 border border-rose-700/60" :
                  e.type === "support" ? "bg-rose-950/50" :
                  e.type === "challenge" ? "bg-amber-950/50" :
                  e.type === "system" ? "bg-blue-950/50" : "bg-slate-800/60"}`}>
                  <span className="text-slate-500 font-mono text-[9px] mr-1.5">{e.t}</span>{e.icon} {e.text}
                </div>
              )))}

            {tab === "metrics" && (
              <div className="space-y-3">
                <button onClick={genReport} disabled={reportLoading || metrics.length === 0}
                  className="w-full bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 rounded-lg py-2 text-xs font-bold transition">
                  {reportLoading ? "🧠 データを分析中…" : "📊 AI観測レポートを生成"}
                </button>
                {report && (
                  <div className="bg-indigo-950/60 border border-indigo-700/50 rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                    <div className="text-[9px] text-indigo-300 mb-1.5 font-mono">📊 観測時点: {report.t}</div>
                    {report.text}
                  </div>
                )}

                {/* レポートについて研究者と議論する */}
                {report?.t && (
                  <div className="bg-slate-800/40 border border-white/5 rounded-lg p-2.5 space-y-2">
                    <div className="text-[11px] font-bold text-slate-400">💬 レポートについて研究者と議論</div>
                    {reportChat.length === 0 && <div className="text-[9px] text-slate-600">例:「なぜ挑戦者が増えないの?」「循環率が低い原因は?」「このデータから何を変えるべき?」</div>}
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {reportChat.map((m, i) => (
                        <div key={i} className={`text-[11px] rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap max-w-[92%] ${m.role === "you" ? "bg-cyan-800/60 ml-auto" : "bg-indigo-950/70 border border-indigo-800/40"}`}>
                          {m.role === "ai" && <span className="text-[9px] text-indigo-300 block mb-0.5">🔬 観測研究者</span>}
                          {m.text}
                        </div>
                      ))}
                      {reportChatLoading && <div className="text-[11px] text-slate-500 animate-pulse">🔬 研究者が考えています…</div>}
                    </div>
                    <div className="flex gap-1.5">
                      <input value={reportQ} onChange={e => setReportQ(e.target.value)} onKeyDown={e => e.key === "Enter" && askReport()}
                        placeholder="レポートへの質問・反論…"
                        className="flex-1 bg-slate-800 rounded-lg px-2.5 py-2 text-[11px] outline-none focus:ring-1 ring-indigo-500 min-w-0" />
                      <button onClick={askReport} disabled={reportChatLoading}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg px-3 text-[11px] font-bold shrink-0">送信</button>
                    </div>
                  </div>
                )}

                {/* 年次推移レポート */}
                {(() => {
                  const yr = metrics.filter(m => /^\d{4}年$/.test(m.label));
                  if (!yr.length) return null;
                  const msByYear = {};
                  if (scenario === "transition") {
                    Object.entries(flags).forEach(([k, y]) => { msByYear[`${y}年`] = (msByYear[`${y}年`] || "") + MILESTONES[k].icon; });
                  }
                  return (
                    <div>
                      <div className="text-[11px] font-bold text-slate-400 mb-1.5">📅 年次推移 <span className="text-slate-600 font-normal">(+1年ごとの記録)</span></div>
                      <div className="overflow-x-auto rounded-lg border border-white/5">
                        <table className="w-full text-[10px] font-mono">
                          <thead>
                            <tr className="bg-slate-800/80 text-slate-400">
                              <th className="px-2 py-1.5 text-left font-bold">年</th>
                              <th className="px-1" title="平均幸福度">😊</th>
                              <th className="px-1" title="平均余白">🌿</th>
                              <th className="px-1" title="挑戦者数">🚩</th>
                              <th className="px-1" title="資本ジニ係数">ジニ</th>
                              <th className="px-1" title="応援の循環率">循環%</th>
                              <th className="px-1" title="平均メンタル">🧠</th>
                              {scenario === "transition" && <th className="px-1" title="成立した制度転換">転換</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {yr.map(m => (
                              <tr key={m.label} className="odd:bg-slate-800/30 text-center text-slate-300">
                                <td className="px-2 py-1 text-left text-slate-400">{m.label}</td>
                                <td>{m.幸福度}</td>
                                <td>{m.余白}</td>
                                <td>{m.挑戦者数}</td>
                                <td>{m.資本偏り}</td>
                                <td>{m.循環率}</td>
                                <td>{m.メンタル}</td>
                                {scenario === "transition" && <td>{msByYear[m.label] || ""}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1 px-1">この推移はAI観測レポートにも渡され、転換点の分析に使われます</div>
                    </div>
                  );
                })()}

                {/* 6資源の街平均 */}
                <div>
                  <div className="text-[11px] font-bold text-slate-400 mb-1.5">6資源の街平均 <span className="text-slate-600 font-normal">(70=必要水準、超過分が余白)</span></div>
                  <div className="space-y-1">
                    {RES_DEF.map(rd => {
                      const v = Math.round(agents.reduce((s, a) => s + resValue(a, rd.key), 0) / agents.length);
                      return (
                        <div key={rd.key} className="flex items-center gap-2 text-[10px]">
                          <span className="w-20 shrink-0">{rd.icon} {rd.label}</span>
                          <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden relative">
                            <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: rd.color }} />
                            <div className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${NEED_LINE}%` }} />
                          </div>
                          <span className={`w-7 text-right font-mono ${v >= NEED_LINE ? "text-emerald-300" : v >= 45 ? "text-slate-400" : "text-rose-300"}`}>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 時間の使い方 */}
                {(() => {
                  const zh = zoneHoursRef.current;
                  const zTotal = Object.values(zh).reduce((s, x) => s + x, 0);
                  if (!zTotal) return null;
                  return (
                    <div>
                      <div className="text-[11px] font-bold text-slate-400 mb-1.5">時間の使い方(累計滞在シェア)</div>
                      <div className="space-y-1">
                        {Object.entries(zh).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2 text-[10px]">
                            <span className="w-20 shrink-0">{ZONES[k].icon} {ZONES[k].name}</span>
                            <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${v / zTotal * 100}%`, background: ZONES[k].color }} />
                            </div>
                            <span className="w-9 text-right font-mono text-slate-400">{Math.round(v / zTotal * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 資本の偏りと富への敬意 */}
                {(() => {
                  const supports = [...agents].map(a => a.support).sort((a, b) => b - a);
                  const total = supports.reduce((s, x) => s + x, 0) || 1;
                  const top20 = Math.round(supports.slice(0, 10).reduce((s, x) => s + x, 0) / total * 100);
                  const g = Math.round(gini(supports) * 100);
                  const mN = metrics[metrics.length - 1] || {};
                  return (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        {[["資産ジニ係数", g, g > 40 ? "text-rose-300" : g > 25 ? "text-amber-300" : "text-emerald-300"],
                          ["上位20%シェア", `${top20}%`, top20 > 50 ? "text-rose-300" : "text-slate-200"],
                          ["挑戦者数", `${new Set(challenges.map(c => c.owner)).size}人`, "text-cyan-300"]].map(([l, v, c]) => (
                          <div key={l} className="bg-slate-800/70 rounded-lg py-2">
                            <div className={`text-sm font-bold font-mono ${c}`}>{v}</div>
                            <div className="text-[9px] text-slate-500">{l}</div>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        {[["応援の循環率", `${mN.循環率 ?? 0}%`, "text-cyan-300"],
                          ["富裕層への応援", `${mN.富裕層応援シェア ?? 0}%`, "text-yellow-300"],
                          ["挑戦者への応援", `${mN.挑戦者応援シェア ?? 0}%`, "text-pink-300"]].map(([l, v, c]) => (
                          <div key={l} className="bg-slate-800/70 rounded-lg py-2">
                            <div className={`text-sm font-bold font-mono ${c}`}>{v}</div>
                            <div className="text-[9px] text-slate-500">{l}</div>
                          </div>
                        ))}
                      </div>
                      <div className="text-[9px] text-slate-500 px-1">💡 富裕層シェア↓+挑戦者シェア↑ = 「金持ちより挑戦者が尊敬される社会」への移行シグナル</div>
                    </div>
                  );
                })()}

                {[["幸福度", "平均幸福度(6資源から導出)", "#34d399", [0, 100]],
                  ["余白", `平均余白(最適≈${OPT_SLACK}、多すぎは退屈)`, "#4ade80", [0, 30]],
                  ["富裕層応援シェア", "富裕層への応援シェア(富は敬意を集め続けるか %)", "#eab308", [0, 100]],
                  ["循環率", "応援の循環率(流通÷BI支給 %:蓄財か循環か)", "#22d3ee", [0, 100]],
                  ["メンタル", "平均メンタル", "#a78bfa", [0, 100]],
                  ["体力", "平均体力", "#f97316", [0, 100]],
                  ["挑戦者数", "挑戦者数の推移(人)", "#f472b6", [0, 50]],
                  ["資本偏り", "資本の偏り:ジニ係数", "#f87171", [0, 100]],
                  ["応援流通", "応援pt累計流通量", "#fb7185", null],
                  ["文化", "定着した文化の数", "#818cf8", null]].map(([key, title, color, domain]) => (
                  <div key={key}>
                    <div className="text-[11px] font-bold text-slate-400 mb-1">{title}</div>
                    <div className="h-28 bg-slate-800/50 rounded-lg p-1">
                      <MiniLine data={metrics} dataKey={key} color={color} domain={domain} />
                    </div>
                  </div>
                ))}
                <div className="text-[11px] font-bold text-slate-400 pt-1">応援pt 保有量 上位/下位</div>
                {[...agents].sort((a, b) => b.support - a.support).filter((_, i, arr) => i < 3 || i >= arr.length - 3).map((a, i) => (
                  <div key={a.id} className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer hover:bg-slate-800" onClick={() => { setSelected(a.id); setInterview([]); }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="font-bold">{a.emoji || ""}{a.name}</span>
                    <span className="ml-auto font-mono text-slate-300">{a.support}pt</span>
                    {i === 2 && <span className="text-slate-600">…</span>}
                  </div>
                ))}
              </div>
            )}

            {tab === "challenges" && (challenges.length === 0
              ? <div className="text-xs text-slate-500 text-center pt-8">まだ挑戦は生まれていません</div>
              : [...challenges].reverse().map((c, i) => (
                <div key={i} className="bg-slate-800/70 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className="min-w-0 truncate">{c.name}</span>{c.status === "done" && "🎉"}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">発起: {c.ownerName} / 応援 {c.totalSupport}pt</div>
                  <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full transition-all" style={{ width: `${(c.progress / 3) * 100}%` }} />
                  </div>
                </div>
              )))}

            {tab === "culture" && (
              <div className="space-y-3">
                {/* 移行期: 制度転換の成立状況(創発) */}
                {scenario === "transition" && (
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 mb-1.5">🧭 2050年への制度転換 <span className="text-slate-600 font-normal">(年表ではなく社会的圧力から創発)</span></div>
                    <div className="space-y-1">
                      {Object.entries(MILESTONES).map(([k, m]) => (
                        <div key={k} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] border ${flags[k] ? "bg-cyan-950/40 border-cyan-700/40" : "bg-slate-800/40 border-white/5 text-slate-500"}`}
                          title={m.desc}>
                          <span className="shrink-0">{m.icon}</span>
                          <span className="flex-1 min-w-0 truncate">{m.label}</span>
                          <span className={`font-mono text-[9px] shrink-0 ${flags[k] ? "text-cyan-300" : ""}`}>{flags[k] ? `${flags[k]}年 成立` : "未成立"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 制度ルール設計 */}
                <div>
                  <div className="text-[11px] font-bold text-slate-400 mb-1.5">⚖️ 制度ルール(問題が生まれたら、ここで設計して施行)</div>
                  <div className="flex gap-1.5 mb-2">
                    <input value={ruleInput} onChange={e => setRuleInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") enactRule(); }}
                      placeholder="例: 応援基金は市民の応援量に比例して配分する"
                      className="flex-1 bg-slate-800 rounded-lg px-2.5 py-2 text-[11px] outline-none focus:ring-1 ring-emerald-500 min-w-0" />
                    <button onClick={enactRule}
                      className="bg-emerald-700 hover:bg-emerald-600 rounded-lg px-3 text-[11px] font-bold shrink-0">施行</button>
                  </div>
                  {customRules.length === 0
                    ? <div className="text-[10px] text-slate-500 bg-slate-800/50 rounded-lg p-2.5 leading-relaxed">未整備の領域: 基金の配分方法/挑戦の認定基準/失敗の扱い/ロボット所有権。<br/>年代記に問題が現れたら、対応するルールを書いて施行してください。以降の世界はそのルールに従います(副作用も含めて)。※簡易エンジンでは追加ルールは反映されません(AI生成モード推奨)</div>
                    : customRules.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 bg-slate-800/70 border border-emerald-900/50 rounded-lg px-3 py-2 text-[11px] mb-1">
                        <span className="shrink-0">⚖️</span>
                        <span className="flex-1 leading-relaxed">{r}</span>
                        <button onClick={() => { setCustomRules(cr => cr.filter((_, j) => j !== i)); setEvents(ev => pushEvents(ev, [{ t: shortLabel(now), icon: "⚖️", text: `制度廃止: 「${r}」が撤回された`, type: "institution" }])); }}
                          className="text-slate-500 hover:text-rose-400 shrink-0"><X size={12}/></button>
                      </div>
                    ))}
                </div>
                {/* 定着した文化 */}
                <div className="text-[11px] font-bold text-slate-400">🏛 定着した文化</div>
                {institutions.length === 0
                  ? <div className="text-xs text-slate-500 text-center py-4">実現した挑戦や時代の変化から<br/>「文化・制度」が定着していきます。</div>
                  : institutions.map((inst, i) => (
                    <div key={i} className="bg-emerald-950/50 border border-emerald-800/40 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                      <Landmark size={13} className="text-emerald-400 shrink-0" />{inst}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 住民詳細 (モバイル:ボトムシート / PC:左サイドバー) ===== */}
      {sel && (
        <div className={`absolute z-30 bg-slate-900/95 backdrop-blur border-slate-700 flex flex-col shadow-2xl ${isMobile ? "inset-x-0 bottom-0 rounded-t-2xl border-t" : "inset-y-0 left-0 border-r"}`}
          style={isMobile ? { height: "72vh" } : { width: 310 }}>
          {isMobile && <div className="flex justify-center pt-2"><div className="w-10 h-1 rounded-full bg-slate-600" /></div>}
          <div className="p-3.5 border-b border-slate-800 flex items-start gap-3">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0" style={{ background: sel.color }}>{sel.emoji || sel.name[0]}</div>
            <div className="min-w-0">
              <div className="font-bold text-sm">{sel.name} <span className="text-[10px] text-slate-400 font-normal">{sel.age}歳</span></div>
              <div className="text-[10px] text-slate-400 leading-relaxed">{sel.persona}</div>
            </div>
            <button className="ml-auto text-slate-400 hover:text-white shrink-0 p-2 -m-1 rounded-lg active:bg-slate-800" onClick={() => setSelected(null)}><X size={18}/></button>
          </div>
          <div className="p-3.5 space-y-2.5 text-[11px] border-b border-slate-800">
            <div><span className="text-slate-500">🎯</span> {sel.goal}</div>
            <div className="flex gap-3 items-center flex-wrap">
              <span><span className="text-slate-500">📍</span> {ZONES[sel.zone].icon}{ZONES[sel.zone].name}</span>
              <span>😊 <b className={sel.happiness > 65 ? "text-emerald-300" : sel.happiness > 40 ? "text-amber-300" : "text-rose-300"}>{sel.happiness}</b></span>
              <span>🌿 余白 <b className={slackState(sel.slack).cls}>{sel.slack}</b> <span className={`text-[9px] ${slackState(sel.slack).cls}`}>{slackState(sel.slack).label}</span></span>
            </div>
            {/* 6資源バー */}
            <div className="space-y-1 bg-slate-800/60 rounded-lg p-2">
              {RES_DEF.map(rd => {
                const v = resValue(sel, rd.key);
                return (
                  <div key={rd.key} className="flex items-center gap-1.5 text-[9px]">
                    <span className="w-14 shrink-0">{rd.icon}{rd.label}</span>
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden relative">
                      <div className="h-full rounded-full" style={{ width: `${v}%`, background: rd.color }} />
                      <div className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: `${NEED_LINE}%` }} />
                    </div>
                    <span className={`w-6 text-right font-mono ${v >= NEED_LINE ? "text-emerald-300" : v >= 45 ? "text-slate-400" : "text-rose-300"}`}>{v}</span>
                  </div>
                );
              })}
              <div className="text-[8px] text-slate-500 pt-0.5">いま一番足りないもの: <b className="text-rose-300">{weakest(sel)}</b>(幸福のボトルネック)</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-2 italic text-slate-300">💭 {sel.thought}</div>
            {sel.memories.length > 0 && (
              <div>
                <div className="text-slate-500 mb-1">🧠 記憶</div>
                <div className="space-y-0.5 max-h-16 overflow-y-auto">
                  {[...sel.memories].reverse().map((m, i) => <div key={i} className="text-[9px] text-slate-400">・{m}</div>)}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3.5 pt-2.5 text-[11px] font-bold text-slate-400 flex items-center gap-1"><MessageCircle size={12}/>インタビュー</div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
              {interview.length === 0 && <div className="text-[9px] text-slate-600">例:「余白はある?」「何に一番時間を使ってる?」「応援は足りてる?」</div>}
              {interview.map((m, i) => (
                <div key={i} className={`text-[11px] rounded-xl px-3 py-2 max-w-[90%] ${m.role === "you" ? "bg-cyan-800/60 ml-auto" : "bg-slate-800"}`}>{m.text}</div>
              ))}
              {interviewLoading && <div className="text-[11px] text-slate-500 animate-pulse">{sel.name}が考えています…</div>}
            </div>
            <div className="p-2.5 border-t border-slate-800 flex gap-1.5">
              <input value={interviewQ} onChange={e => setInterviewQ(e.target.value)} onKeyDown={e => e.key === "Enter" && askAgent()}
                placeholder={`${sel.name}に質問…`}
                className="flex-1 bg-slate-800 rounded-lg px-2.5 py-2 text-[11px] outline-none focus:ring-1 ring-cyan-500 min-w-0" />
              <button onClick={askAgent} disabled={interviewLoading} className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 rounded-lg px-2.5 text-[11px] font-bold shrink-0">送信</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 保存記録の一覧モーダル ===== */}
      {loadOpen && (
        <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setLoadOpen(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="text-sm font-bold">📂 保存した記録</div>
              <button className="text-slate-400 hover:text-white p-1.5 -m-1 rounded-lg" onClick={() => setLoadOpen(false)}><X size={16}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {runsError && <div className="text-[11px] text-rose-300 bg-rose-950/50 border border-rose-800/50 rounded-lg p-2.5 leading-relaxed">{runsError}</div>}
              {runs === null && !runsError && <div className="text-xs text-slate-500 text-center py-8 animate-pulse">読み込み中…</div>}
              {runs !== null && runs.length === 0 && !runsError && (
                <div className="text-xs text-slate-500 text-center py-8 leading-relaxed">保存された記録はまだありません。<br/>ヘッダーの「💾 保存」で現在の状態を記録できます。</div>
              )}
              {(runs || []).map(r => (
                <div key={r.id} className={`flex items-center gap-2.5 bg-slate-800/70 border rounded-xl px-3 py-2.5 ${r.id === runId ? "border-cyan-500/50" : "border-white/5"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate">{r.title || "(無題)"} {r.id === runId && <span className="text-[9px] text-cyan-300 font-normal">← 現在の記録</span>}</div>
                    <div className="text-[9px] text-slate-500 font-mono">{ALL_SCENARIOS[r.scenario]?.short || r.scenario} ・ 更新 {new Date(r.updated_at).toLocaleString("ja-JP")}</div>
                  </div>
                  <button onClick={() => doLoad(r.id)} className="bg-cyan-700 hover:bg-cyan-600 rounded-lg px-3 py-1.5 text-[11px] font-bold shrink-0">読込</button>
                  <button onClick={() => doDelete(r.id)} className="text-slate-500 hover:text-rose-400 p-1.5 shrink-0" title="削除"><X size={13}/></button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-white/5 text-[9px] text-slate-500 leading-relaxed">
              記録はSupabaseに保存されます(サーバー側の SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要)。一度保存すると、時間を進めるたびに同じ記録へ自動上書きされます。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
