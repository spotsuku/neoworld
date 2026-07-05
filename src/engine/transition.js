/* ----------------------------------------------------------
   移行期シナリオ(2026→2050 創発モード)
   現実の2026年日本から出発し、制度転換(マイルストーン)が
   固定年表ではなくシミュレーション内の社会的圧力から
   創発的に成立していく。既存3シナリオ(統制条件)とは独立。
   ---------------------------------------------------------- */
import { CAP_FLOOR } from "./population.js";
import { COMMON_RULE } from "./prompts.js";

export const TRANSITION = {
  label: "移行期(2026→2050・創発)",
  short: "移行期26→50",
  desc: "現実の2026年日本から出発し、自動化・応援制度・BIといった制度転換が社会的圧力から創発的に成立して2050年の応援資本主義に至る(か、至らない)移行過程を観測する",
  incomeLabel: "給与・年金の支給。収入は人それぞれ",
};

// 制度転換マイルストーン
export const MILESTONES = {
  auto_wave: {
    icon: "🤖", label: "自動化の波",
    desc: "AI・ロボットが単純労働を本格的に代替し始め、毎年職を失う人が出る転換点。ロボット収益は資本保有に比例して配当される",
    state: "ロボットが生産の大半を担い、毎年職を失う人が出る。ロボット収益は資本保有に比例して配当され、格差が拡大している",
  },
  support_law: {
    icon: "⚖️", label: "応援制度の立法",
    desc: "個人が自分のお金を他者の挑戦に「応援ポイント」として贈れる仕組みが公的制度になる",
    state: "誰でも自分のptを他者の挑戦に応援として贈れる制度が確立している",
  },
  fund_law: {
    icon: "🏢", label: "応援基金の設立",
    desc: "企業(ロボット法人)の資本余剰10%を応援資本として挑戦に分配する基金の設立",
    state: "応援基金が毎月挑戦に分配されている(配分ルールは未整備・一律割り)",
  },
  bi_trial: {
    icon: "💙", label: "充足BIの試験導入",
    desc: "生活が立ち行かない層に、資本を必要水準の半分まで補填する部分ベーシックインカムの試験導入",
    state: "部分BI(試験): 資本が必要水準の半分を下回る住民に補填が行われている",
  },
  bi_full: {
    icon: "🌅", label: "充足BIの完全実施",
    desc: "全住民の資本を必要水準まで毎月補填する充足BIの完全実施(財源はロボット生産益)。労働は任意の選択になる",
    state: "充足BI: 全住民の資本が満たされる水準まで毎月補填され、労働は生きがいとしての選択になった",
  },
};
// 成立の前提条件(順序制約)
export const MILESTONE_PREREQ = {
  fund_law: ["support_law"],
  bi_trial: ["auto_wave"],
  bi_full: ["bi_trial"],
};

// 世界観プロンプト(成立済み/未成立の制度転換を反映)
export function trWorldRule(flags, year) {
  const done = Object.entries(MILESTONES).filter(([k]) => flags[k]);
  const pending = Object.entries(MILESTONES).filter(([k]) => !flags[k]);
  return `${year}年の日本・福岡近郊の街「NEOタウン」(人口50人、日本の人口構成を反映:高齢化が進み・単身世帯4割・資産と収入は上位層に偏在・健康や資産に性差年齢差が残る)。この社会は現実の2026年の日本から出発し、2050年の「応援資本主義」へ向かう移行期にある。経済の基本は資本主義で、大半の現役世代は生活のため働き(賃金格差あり)、高齢者は年金暮らし。AI・ロボット技術は年々進歩している。
【成立済みの制度転換】${done.length ? done.map(([k, m]) => `${m.label}(${flags[k]}年成立): ${m.state}`).join(" / ") : "まだない(従来の資本主義のまま)"}
【未成立の制度転換】${pending.length ? pending.map(([, m]) => `${m.label}: ${m.desc}`).join(" / ") : "なし(移行は完了した)"}
制度転換は年表どおりに起きるのではなく、シミュレーション内の圧力(失業・格差・不満・社会運動・技術進歩)から創発的に起こる。転換の前には必ずその予兆(圧力の高まり・論争・運動)を描くこと。${COMMON_RULE}`;
}

export const TR_HOUR_SYSTEM = (flags, year) => `${trWorldRule(flags, year)}
注目住民のこの1時間の行動を生成。JSONのみ出力:
{"events":[{"id":"住民id","zone":"house|culture|sports|robots|food|home","action":"20字以内","thought":"25字以内","speech":"発言 or null","support":{"to":"相手id","points":数値} or null,"challenge":{"name":"挑戦名","step":"create|progress|complete"} or null,"dS":体力増減-8〜8,"dM":メンタル増減-8〜8}],"mood":-2〜2(街の空気),"worldNote":"25字以内"}`;

export const TR_DAY_SYSTEM = (flags, year) => `${trWorldRule(flags, year)}
これから1日分(24時間)の社会変化を年代記として一括生成。簡潔なJSONのみ出力(前置き禁止):
{"headline":"この日の見出し(20字以内)","highlights":[{"agentId":"id or null","icon":"絵文字","text":"出来事30字以内"}を4件],"newChallenges":[{"name":"挑戦名(12字以内)","ownerId":"住民id"}]を0〜2件,"progressChallenges":["進展した挑戦名"],"completedChallenges":["実現した挑戦名(進捗2/3以上のみ)"],"dMental":街全体のメンタル影響-6〜6,"supportFlow":その日の応援pt流通量(0〜400),"worldNote":"20字以内"}`;

export const TR_MONTH_SYSTEM = (flags, year) => `${trWorldRule(flags, year)}
これから1ヶ月分の社会変化を年代記として一括生成。個人の日常より社会の構造変化・移行期の軋み(雇用不安・制度論争・世代間対立など)を描く。良い変化だけでなく問題も1件以上含める。簡潔なJSONのみ出力(前置き禁止):
{"headline":"この月の見出し(20字以内)","trends":[{"icon":"絵文字","text":"社会トレンド30字以内"}を3件],"arcs":[{"agentId":"id","text":"個人の物語30字以内"}を2件],"newChallenges":[{"name":"挑戦名(12字以内)","ownerId":"id"}]を1〜2件,"completedChallenges":["実現した挑戦名"],"newInstitutions":["定着した文化(15字以内)"]を0〜1件,"dMental":-12〜12,"supportFlow":月間応援流通量(0〜10000),"worldNote":"20字以内"}`;

export const TR_YEAR_SYSTEM = (flags, year) => `${trWorldRule(flags, year)}
これから1年分の社会の大変動を年代記として一括生成。時代の名前を付け、制度・文化・価値観レベルの変化、成功と影(失業・格差・移行の混乱・反対運動など)の両方を描く。
制度転換(milestones)は、社会的圧力が十分に高まったと判断した年にのみ成立させること。焦らないこと(移行全体は2050年前後まで、およそ20年かける)。前提: 応援基金は応援制度の後、BI試験は自動化の波の後、充足BIはBI試験の後にのみ成立しうる。簡潔なJSONのみ出力(前置き禁止):
{"eraName":"20XX年:○○の年(12字以内)","transformations":[{"icon":"絵文字","text":"時代の変化30字以内"}を4件],"arcs":[{"agentId":"id","text":"個人の1年30字以内"}を3件],"newInstitutions":["定着した制度・文化(15字以内)"]を0〜2件,"completedChallenges":["実現した挑戦名"],"milestones":["auto_wave|support_law|fund_law|bi_trial|bi_full"]を0〜2件(今年成立した制度転換のみ。未成立リストから選ぶ。時期尚早なら空配列),"risk":"顕在化した社会リスク25字以内","dMental":-15〜15,"supportFlow":年間応援流通量(0〜100000),"worldNote":"20字以内"}`;

// ---- 経済メカニクス ----
// フェーズごとの収入構成: 賃金 → +ロボット配当 → +部分BI → 充足BI(賃金消滅)
export function trIncome(flags) {
  return {
    floor: flags.bi_full ? CAP_FLOOR : flags.bi_trial ? Math.round(CAP_FLOOR / 2) : 0,
    wage: !flags.bi_full,
    dividend: !!flags.auto_wave && !flags.bi_full,
  };
}
export const trIncomeLabel = flags =>
  flags.bi_full ? "充足BI: 資本が水準未満の住民に満たされるまで補填(財源:ロボット生産益)"
  : flags.bi_trial ? "給与・年金+部分BI(試験): 困窮層に半額水準まで補填"
  : flags.auto_wave ? "給与・年金+ロボット配当(資本保有に比例)"
  : "給与・年金の支給。収入は人それぞれ";

// 大ジャンプ(1日/1ヶ月/1年)の収入: 賃金+配当×日数 の後、床まで補填
export function trJumpIncome(a, flags, days, totalSupport) {
  const t = trIncome(flags);
  const wage = t.wage
    ? ((a.dailyIncome || 0) + (t.dividend ? Math.max(2, Math.round(2500 * a.support / totalSupport)) : 0)) * days
    : 0;
  const top = t.floor ? Math.max(0, t.floor - (a.support + wage)) : 0;
  return wage + top;
}

// AIが提案した制度転換を検証して適用(未知キー・重複・前提未達を弾く)
export function applyMilestones(flags, proposed, year) {
  const out = { ...flags };
  const applied = [];
  for (const k of (proposed || []).slice(0, 2)) {
    if (!MILESTONES[k] || out[k]) continue;
    if ((MILESTONE_PREREQ[k] || []).some(p => !out[p])) continue;
    out[k] = year;
    applied.push(k);
  }
  return { flags: out, applied };
}

// 簡易エンジン用: フェーズに応じて既存3シナリオの文言・確率を借りる
export const trFallbackScenario = flags =>
  flags.bi_full ? "post" : flags.auto_wave ? "roboCap" : "current";

// 簡易エンジン用: 年が進むほど確率が上がる創発的マイルストーン
export function fbTrMilestones(flags, year) {
  const order = ["support_law", "auto_wave", "fund_law", "bi_trial", "bi_full"];
  const candidates = order.filter(k => !flags[k] && (MILESTONE_PREREQ[k] || []).every(p => flags[p]));
  for (const k of candidates) {
    if (Math.random() < Math.min(0.6, 0.1 + (year - 2026) * 0.03)) return [k];
  }
  return [];
}
