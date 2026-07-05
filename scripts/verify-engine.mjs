// エンジン部(src/engine/population.js)の初期値検証スクリプト
// 期待値: 初期人口50人 / 資産ジニ≈0.6 / S2収入ジニ≈0.58 / S3就労16人 / S3初期幸福≈40
import { generatePopulation, gini } from "../src/engine/population.js";

let failed = 0;
function check(label, actual, ok) {
  const mark = ok ? "OK " : "NG ";
  if (!ok) failed++;
  console.log(`${mark} ${label}: ${actual}`);
}
const approx = (v, target, tol) => Math.abs(v - target) <= tol;

for (const scn of ["current", "roboCap", "post"]) {
  const pop = generatePopulation(scn);
  const assetGini = gini(pop.map(a => a.support));
  const avgHappiness = pop.reduce((s, a) => s + a.happiness, 0) / pop.length;
  const workers = pop.filter(a => a.works).length;
  console.log(`\n== シナリオ ${scn} ==`);
  check("人口", pop.length, pop.length === 50);
  check("資産ジニ", assetGini.toFixed(3), approx(assetGini, 0.6, 0.08));
  console.log(`   就労者数: ${workers} / 平均幸福: ${avgHappiness.toFixed(1)} / 平均余白: ${(pop.reduce((s, a) => s + a.slack, 0) / pop.length).toFixed(1)}`);
  if (scn === "roboCap") {
    const incomeGini = gini(pop.map(a => a.dailyIncome));
    check("S2 収入ジニ (≈0.58)", incomeGini.toFixed(3), approx(incomeGini, 0.58, 0.06));
  }
  if (scn === "post") {
    check("S3 就労者数 (=16)", workers, workers === 16);
    check("S3 初期幸福 (≈40)", avgHappiness.toFixed(1), approx(avgHappiness, 40, 4));
  }
}

console.log(failed ? `\n${failed}件の検証に失敗` : "\n全検証パス");
process.exit(failed ? 1 : 0);
