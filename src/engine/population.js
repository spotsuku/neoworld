/* ============================================================
   NEO 2050 SOCIETY SIMULATOR — 余白理論エンジン(純関数部)
   6資源: 挑戦・応援・資本・時間・体力・メンタル
   哲学: 豊かさは「余白」。幸福度は操作せず、
   全資源が満たされ少し余白がある状態から導出する。
   幸福度 = 充足(min)×0.55 + 平均×0.30 + slackBonus(余白)
   ※実験の統制条件のため、数値・式・シードは改変禁止
   ============================================================ */

// ---------- 世界定義 ----------
export const ZONES = {
  house:   { name: "NEO HOUSE", icon: "💬", color: "#0E8C8C", x: 50, y: 40, r: 13 },
  culture: { name: "文化", icon: "🎨", color: "#7A4FBF", x: 17, y: 20, r: 11 },
  sports:  { name: "スポーツ", icon: "🏃", color: "#2456C8", x: 83, y: 20, r: 11 },
  robots:  { name: "農場", icon: "🤖", color: "#3E9E4F", x: 17, y: 72, r: 11 },
  food:    { name: "食", icon: "🍽", color: "#E8821E", x: 83, y: 72, r: 11 },
  home:    { name: "住居", icon: "🏠", color: "#8a8fa8", x: 50, y: 90, r: 12 },
};
export const ZONE_KEYS = Object.keys(ZONES);

// ---------- 6資源の定義 ----------
export const RES_DEF = [
  { key: "chal", label: "挑戦", icon: "🚩", color: "#fbbf24", desc: "目的への没頭" },
  { key: "conn", label: "応援", icon: "❤️", color: "#fb7185", desc: "つながりの往来" },
  { key: "cap",  label: "資本", icon: "💰", color: "#34d399", desc: "応援pt(対数換算)" },
  { key: "time", label: "時間", icon: "⏳", color: "#38bdf8", desc: "自由な時間" },
  { key: "stam", label: "体力", icon: "💪", color: "#f97316", desc: "身体エネルギー" },
  { key: "ment", label: "メンタル", icon: "🧠", color: "#a78bfa", desc: "心の状態" },
];
export const NEED_LINE = 70; // 必要水準: これを超えた分が「余白」
export const CAP_FLOOR = 3500; // 充足BIの補填水準(資本資源≈71となり、資本がボトルネックでなくなる)
export const FUND_MONTHLY = 3000; // 応援基金: 企業の資本余剰10%相当/月
export const OPT_SLACK = 12; // ちょうど良い余白。少なすぎれば窮屈、多すぎれば退屈

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));
export const normCap = pt => Math.min(100, Math.round(20 * Math.log10(pt + 1))); // 100pt→40, 1万pt→80

// 余白→幸福への寄与は逆U字: 最適値でピーク、過剰は退屈で減点
export function slackBonus(slack) {
  const MAXB = 12, MAXSLACK = 30;
  if (slack <= OPT_SLACK) return slack / OPT_SLACK * MAXB;
  return MAXB - (slack - OPT_SLACK) / (MAXSLACK - OPT_SLACK) * (MAXB + 20); // 余白30で-20(強い退屈と空虚)
}

// 資源→幸福度・余白の導出
export function derive(a) {
  const R = [a.res.chal, a.res.conn, normCap(a.support), a.res.time, a.res.stam, a.res.ment];
  const fulfill = Math.min(...R);                                  // 充足=ボトルネック
  const avg = R.reduce((s, x) => s + x, 0) / R.length;
  const slack = R.reduce((s, x) => s + Math.max(0, x - NEED_LINE), 0) / R.length; // 余白
  return { happiness: clamp(0.55 * fulfill + 0.30 * avg + slackBonus(slack)), slack: Math.round(slack * 10) / 10, fulfill: Math.round(fulfill) };
}
// 余白の状態判定
export const slackState = s => s < 4 ? { label: "不足(窮屈)", cls: "text-rose-300" } : s <= 18 ? { label: "ちょうど良い", cls: "text-emerald-300" } : { label: "過剰(退屈気味)", cls: "text-amber-300" };

// ---------- 50人の住民 (2050年日本の人口統計を反映) ----------
export const HEROES = [
  { id: "haruka", name: "ハルカ", emoji: "🎬", color: "#F03090", age: 28, sex: "女", w0: 350, arch: "culture",
    persona: "28歳女性。元銀行員。BI社会移行後、映画監督に転身。情熱的だが自信が揺らぎやすい。", goal: "初監督作品『応援の街』を完成させる" },
  { id: "kenji", name: "ケンジ", emoji: "🌾", color: "#3E9E4F", age: 58, sex: "男", w0: 5200, arch: "robots",
    persona: "58歳男性。元会計士で資産に余裕がある層。農場ロボットの世話が生きがい。若者の挑戦を応援する世話焼き。", goal: "誰でも参加できる収穫祭を開く" },
  { id: "mio", name: "ミオ", emoji: "⚡", color: "#00A8D8", age: 19, sex: "女", w0: 45, arch: "sports",
    persona: "19歳女性。BI世代で蓄えは少ない。eスポーツと陸上の二刀流。「働くって何?」が口癖。", goal: "スポーツ×ゲームの新競技を発明する" },
  { id: "sota", name: "ソウタ", emoji: "🔬", color: "#7A4FBF", age: 35, sex: "男", w0: 480, arch: "house",
    persona: "35歳男性。研究者。「応援ポイントは新しい貨幣か?」を研究中。没頭すると孤立しがち。", goal: "応援経済の論文を住民との対話から書く" },
  { id: "aya", name: "アヤ", emoji: "🍳", color: "#E8821E", age: 42, sex: "女", w0: 900, arch: "food",
    persona: "42歳女性。シェフ。料理は人をつなぐ装置だと信じる。元気のない人にすぐ気づく。", goal: "全住民が集まる晩餐会を実現する" },
];
export const NAMES = ["レン","ユイ","ダイキ","サクラ","タクミ","ヒナ","カイト","メイ","リク","アオイ","ショウ","ニコ","ツバサ","カンナ","イツキ","ノア","ハヤト","エマ","ミナト","スズ","ゲン","ルナ","コウ","ワカナ","ジン","チヒロ","タイガ","ミサキ","ソラ","カエデ","ユウゴ","ナナ","キリト","ホノカ","リョウ","ミユ","アサヒ","シオン","テル","マコ","ライ","ヒカリ","オウガ","フウカ","ケイ"];
export const JOBS = ["トラック運転手","コールセンター員","銀行窓口","経理","レジ係","倉庫作業員","プログラマー","保険営業","翻訳者","事務員","タクシー運転手","品質検査員","データ入力","警備員","校正者"];
export const PASSIONS = {
  culture: ["水彩画","作曲","マンガ執筆","陶芸","演劇","写真","詩作","DJ"],
  sports:  ["マラソン","ボルダリング","サッカー","ダンス","武道","自転車","水泳"],
  robots:  ["ロボット改造","品種改良","養蜂","木工","発明","ドローン栽培"],
  food:    ["発酵料理","パン作り","コーヒー焙煎","郷土料理の復元","菓子作り"],
  house:   ["哲学対話","子どもの学び場","歴史研究","語学交換","起業支援","読書会"],
};
export const TRAITS = ["楽観的","慎重派","おしゃべり","内向的","負けず嫌い","マイペース","面倒見がいい","皮肉屋だが優しい","好奇心旺盛","飽きっぽい","粘り強い","感激屋"];
export const HUES = [200, 340, 160, 40, 280, 20, 100, 220, 300, 60];

export function mulberry32(s){return function(){s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export function pick(arr, rng){ return arr[Math.floor(rng() * arr.length)]; }
export function gini(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length, sum = v.reduce((s, x) => s + x, 0);
  if (!sum) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return cum / (n * sum);
}

export function generatePopulation(scn = "post") {
  const rng = mulberry32(20500101);
  const nz = () => (rng() + rng() + rng() + rng() - 2) * 1.73; // 近似正規乱数(平均0,SD1)

  /* --- 2050年日本の推計(IPSS等)に基づく初期条件 ---
     年齢: 成人の約42%が65歳以上(高齢化率38%)。若年24%/中年34%/高齢42%
     性別: 全体で女性約52%、高齢層は女性56%
     資産: 対数正規分布(資産ジニ≈0.6超)。高齢層と男性に偏在(年金・資産格差)
     健康: 加齢で低下+所得勾配(裕福ほど健康)+女性がやや長命
     孤独: 単身世帯約4割。独居高齢男性の孤立リスク
     幸福のU字: メンタルは中年期(40-55歳)が谷 */
  const ageBands = [...Array(9).fill("y"), ...Array(15).fill("m"), ...Array(21).fill("o")];

  const pop = HEROES.map(h => ({ ...h, wealth: h.w0, single: false, works: scn === "current" ? h.id !== "mio" : scn === "roboCap" ? h.id === "sota" : h.id === "kenji" }));
  NAMES.forEach((name, i) => {
    const band = ageBands[i % ageBands.length];
    const age = band === "y" ? 16 + Math.floor(rng() * 24) : band === "m" ? 40 + Math.floor(rng() * 25) : 65 + Math.floor(rng() * 24);
    const sex = rng() < (age >= 65 ? 0.56 : 0.51) ? "女" : "男";
    // 資産: 対数正規 × 年齢係数 × 性差係数
    let wealth = Math.round(Math.exp(5.6 + nz() * 1.35) * (0.35 + age / 55) * (sex === "男" ? 1.3 : 1));
    wealth = Math.max(10, wealth);
    const single = rng() < 0.42;
    // 労働: 現代日本=現役の85%が就労 / 資本主義×ロボ=専門職1割のみ / 応援×ロボ=任意の選択労働25%
    const works = scn === "current" ? (age < 65 ? rng() < 0.85 : rng() < 0.12)
      : scn === "roboCap" ? (age < 65 && rng() < 0.1)
      : rng() < 0.25;
    // 活動領域: 年齢で好みが変わる
    const archPool = age >= 65 ? ["robots","robots","culture","culture","food","house","house","sports"]
      : age <= 39 ? ["sports","sports","culture","culture","house","house","food","robots"]
      : ["culture","sports","robots","food","house","house"];
    const arch = archPool[Math.floor(rng() * archPool.length)];
    const passion = pick(PASSIONS[arch], rng);
    pop.push({
      id: `a${i}`, name, emoji: null, age, sex, wealth, single, works, arch,
      color: `hsl(${pick(HUES, rng)} 70% 60%)`,
      persona: "", goal: `${passion}で街に何かを残す`, _passion: passion,
    });
  });
  // 資産上位10人=富裕層フラグ
  const sorted = [...pop].sort((a, b) => b.wealth - a.wealth);
  const richIds = new Set(sorted.slice(0, 10).map(a => a.id));
  const totalWealth = pop.reduce((t, a) => t + a.wealth, 0); // ロボット配当の分配基準

  return pop.map(a => {
    const w = a.wealth;
    const capN = normCap(w);
    const isRich = richIds.has(a.id);
    const wLabel = isRich ? "資産に余裕がある" : capN < 40 ? "蓄えは少ない" : "中間層";
    if (!a.persona) {
      a.persona = `${a.age}歳${a.sex}性。${wLabel}。${a.age > 26 ? `元${pick(JOBS, mulberry32(a.id.length + a.age))}。` : "BI世代。"}今は${a._passion}に夢中。${pick(TRAITS, mulberry32(a.age * 7))}。${a.works ? (scn === "current" ? "働きながら暮らす。" : scn === "roboCap" ? "希少な専門職として働く。" : "週2日の選択労働も続ける。") : ""}${a.single && a.age >= 65 ? "独居。" : ""}`;
    }
    // 日次収入: 応援×ロボ=充足BI(別途補填) / 現代日本=賃金格差・年金 / 資本主義×ロボ=ロボット配当(資本比例)+生活保護の床
    const dailyIncome = scn === "post" ? 0
      : scn === "roboCap" ? Math.max(8, Math.round(2500 * w / totalWealth) + (a.works ? 60 : 0))
      : a.works ? Math.max(15, Math.round(Math.exp(3.5 + nz() * 0.55) * (0.7 + capN / 100)))
      : a.age >= 65 ? 28 : 12;
    // 健康・メンタルの初期格差
    const stam = clamp(90 - (a.age - 16) * 0.55 + (capN - 50) * 0.12 + (a.sex === "女" ? 2 : 0) + nz() * 6, 15, 98);
    const ment = clamp(66 - 11 * Math.exp(-((a.age - 50) ** 2) / 350) + (capN < 35 ? -5 : 0) + (a.single && a.sex === "男" && a.age >= 65 ? -7 : 0) + nz() * 7, 15, 92);
    const conn = clamp(52 + (a.sex === "女" ? 4 : -2) - (a.single ? 6 : 0) - (a.single && a.sex === "男" && a.age >= 65 ? 10 : 0) + nz() * 8, 10, 90);
    const chal = clamp(50 - (a.age - 16) * 0.35 + (a.works ? 6 : 0) + nz() * 8, 18, 72);
    // 自由時間: 現代日本の就労者は大きく削られる
    const time = clamp((a.works && scn !== "post" ? 54 : 82) + (a.sex === "女" && a.age >= 40 && a.age < 60 ? -7 : 0) + nz() * 6, 30, 95);
    const { _passion, w0, ...rest } = a;
    const base = {
      ...rest, isRich, dailyIncome, zone: "home", support: w, recv: 0, memories: [], thought: "…", speech: null,
      res: { chal, conn, time, stam, ment },
    };
    return { ...base, ...derive(base) };
  });
}

// いま一番足りない資源(幸福のボトルネック)
export function weakest(a) {
  const R = { 挑戦: a.res.chal, 応援: a.res.conn, 資本: normCap(a.support), 時間: a.res.time, 体力: a.res.stam, メンタル: a.res.ment };
  return Object.entries(R).sort((x, y) => x[1] - y[1])[0][0];
}
