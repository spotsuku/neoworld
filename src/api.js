/* ----------------------------------------------------------
   Claude API クライアント
   自サーバーの /api/claude(Vercelサーバーレス関数)を叩く。
   APIキーはサーバー側のみ — ブラウザには一切渡らない。
   ---------------------------------------------------------- */
export async function callClaude(system, userMsg) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg }),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`HTTP${res.status} 非JSON応答: ${raw.slice(0, 70)}`); }
  if (!res.ok || data.error) throw new Error(`API: ${data.error || `HTTP${res.status}`}`);
  if (!data.text) throw new Error(`HTTP${res.status} 空応答`);
  return data.text;
}

// AI応答のJSONを取り出す。途中で切れたJSONは括弧を補完して修復を試みる
export function parseJSON(text) {
  let s = text.replace(/```json|```/g, "").trim();
  s = s.slice(s.indexOf("{"));
  try { return JSON.parse(s); } catch { /* 修復へ */ }
  for (let i = s.length; i > 1; i--) {
    const c = s[i - 1];
    if (c !== "}" && c !== "]" && c !== '"') continue;
    const prefix = s.slice(0, i);
    let stack = [], inStr = false, esc = false, ok = true;
    for (const ch of prefix) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
      else if (ch === '"') inStr = true;
      else if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") { if (stack.pop() !== ch) { ok = false; break; } }
    }
    if (!ok || inStr) continue;
    try { return JSON.parse(prefix.replace(/,\s*$/, "") + stack.reverse().join("")); } catch { /* 次へ */ }
  }
  throw new Error("JSON parse failed");
}
