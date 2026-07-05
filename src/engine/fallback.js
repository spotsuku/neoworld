/* ----------------------------------------------------------
   簡易フォールバックエンジン(AI応答が使えない環境用)
   数値実験(H1〜H8の指標)は継続可能。年代記の質的記述は
   簡易テンプレートになる(H9観測にはAI推奨)。
   ---------------------------------------------------------- */
import { PASSIONS, ZONE_KEYS } from "./population.js";

// AI失敗→簡易エンジン切替の🤖通知は1回だけ出す
let noted = false;
export const fbNoted = () => noted;
export const markFbNoted = () => { noted = true; };
export const resetFbNoted = () => { noted = false; };

const fbPick = arr => arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
const fbFlowScale = scn => scn === "post" ? 1 : scn === "current" ? 0.45 : 0.12;
const fbChName = a => `${fbPick(PASSIONS[a.arch] || ["企画"])}の${fbPick(["会", "祭", "教室", "計画", "工房"])}`;
export function fbNewChallenges(S, p) {
  const cands = S.agents.filter(a => !S.challenges.some(c => c.owner === a.id && c.status === "active"));
  if (!cands.length || Math.random() > p) return [];
  const a = fbPick(cands);
  return [{ name: fbChName(a), ownerId: a.id }];
}
const FB_TRENDS = {
  post: ["応援の贈り合いが日常になりつつある", "基金の一律配分に不公平だとの声", "選択労働を選ぶ住民が少し増えた"],
  roboCap: ["配当格差がじわり広がる", "持たざる層に無気力感が漂う", "富裕層と他の住民の交流が減った"],
  current: ["仕事と挑戦の両立に苦心する声", "職場にも応援文化が少しずつ浸透", "自由時間の不足を嘆く声"],
};
const FB_RISKS = {
  post: ["基金配分の不公平への不満", "満たされた退屈の広がり", "偽の挑戦が応援を集めたとの噂", "ロボット所有権を巡る論争"],
  roboCap: ["資本格差の固定化と社会の分断", "持たざる層の孤立と無気力"],
  current: ["過労による余白の喪失", "挑戦する時間の欠如"],
};

export function fbHour(S, spots) {
  const scn = S.scenario;
  const acts = { culture: "作品づくりに没頭", sports: "体を動かして汗を流す", robots: "ロボットの手入れ", food: "食堂で談笑", house: "対話の輪に加わる", home: "家でひと休み" };
  const active = S.challenges.filter(c => c.status === "active");
  const events = spots.map(a => {
    const zone = Math.random() < 0.6 ? a.arch : fbPick(ZONE_KEYS);
    const e = { id: a.id, zone, action: acts[zone] || "街を歩く", thought: "今日も一日が過ぎていく", speech: null, support: null, challenge: null, dS: Math.round(Math.random() * 4 - 2), dM: Math.round(Math.random() * 4 - 2) };
    const own = active.find(c => c.owner === a.id);
    if (own) {
      if (Math.random() < 0.25) e.challenge = { name: own.name, step: own.progress >= 2 && Math.random() < 0.3 ? "complete" : "progress" };
    } else if (Math.random() < (scn === "post" ? 0.06 : scn === "current" ? 0.04 : 0.015)) {
      e.challenge = { name: fbChName(a), step: "create" };
    }
    const p = scn === "post" ? 0.22 : scn === "current" ? 0.1 : 0.03;
    if (!e.challenge && active.length && Math.random() < p && a.support > 60) {
      const c = fbPick(active.filter(c2 => c2.owner !== a.id));
      if (c) e.support = { to: c.owner, points: 15 + Math.floor(Math.random() * 60) };
    }
    return e;
  });
  return { events, mood: scn === "roboCap" && Math.random() < 0.4 ? -1 : 0, worldNote: "簡易エンジンで進行中(AI応答なし)" };
}

export function fbDay(S) {
  const scn = S.scenario;
  const active = S.challenges.filter(c => c.status === "active");
  return {
    headline: "淡々と過ぎた一日",
    highlights: [],
    newChallenges: fbNewChallenges(S, scn === "post" ? 0.6 : scn === "current" ? 0.4 : 0.12),
    progressChallenges: active.filter(() => Math.random() < 0.4).map(c => c.name),
    completedChallenges: active.filter(c => c.progress >= 2 && Math.random() < 0.15).map(c => c.name),
    dMental: scn === "roboCap" ? -Math.round(Math.random() * 2) : Math.round(Math.random() * 2) - 1,
    supportFlow: Math.round((80 + Math.random() * 200) * fbFlowScale(scn)),
    worldNote: "簡易エンジンで進行中",
  };
}

export function fbMonth(S) {
  const scn = S.scenario;
  const active = S.challenges.filter(c => c.status === "active");
  return {
    headline: "静かな一ヶ月",
    trends: FB_TRENDS[scn].map(tx => ({ icon: "📈", text: tx })),
    arcs: [],
    newChallenges: fbNewChallenges(S, scn === "post" ? 0.9 : scn === "current" ? 0.6 : 0.2),
    completedChallenges: active.filter(c => c.progress >= 2 && Math.random() < 0.35).map(c => c.name),
    newInstitutions: scn === "post" && Math.random() < 0.3 ? [fbPick(["応援の朝市", "週次の対話会", "挑戦発表の夕べ"])] : [],
    dMental: scn === "roboCap" ? -3 : scn === "post" ? 2 : -1,
    supportFlow: Math.round((2000 + Math.random() * 5000) * fbFlowScale(scn)),
    worldNote: "簡易エンジンで進行中",
  };
}

export function fbYear(S) {
  const scn = S.scenario;
  return {
    eraName: `${S.now.getFullYear()}年:記録の年`,
    transformations: FB_TRENDS[scn].map(tx => ({ icon: "🌐", text: tx })),
    arcs: [],
    newInstitutions: scn === "post" ? [fbPick(["応援基金の公開台帳", "収穫祭の定例化", "対話の広場"])] : [],
    completedChallenges: [],
    risk: fbPick(FB_RISKS[scn]),
    dMental: scn === "roboCap" ? -6 : scn === "post" ? 3 : -2,
    supportFlow: Math.round((30000 + Math.random() * 50000) * fbFlowScale(scn)),
    worldNote: "簡易エンジンで進行中",
  };
}
