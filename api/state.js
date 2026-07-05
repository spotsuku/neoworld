/* ----------------------------------------------------------
   Vercelサーバーレス関数: シミュレーション記録の保存/読込
   Supabase(PostgREST)へのプロキシ。キーはサーバー側のみ。
   POST { action: "save" | "list" | "load" | "delete", ... }
   ---------------------------------------------------------- */
const headers = key => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(501).json({ error: "Supabase未設定: SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY をVercelの環境変数に設定してください" });
  }
  const { action, id, title, scenario, payload } = req.body || {};
  const base = `${url.replace(/\/$/, "")}/rest/v1/sim_runs`;

  const fail = async (r) => {
    let msg;
    try { msg = (await r.json()).message; } catch { /* 非JSON */ }
    return res.status(r.status).json({ error: msg || `Supabase HTTP${r.status}` });
  };

  try {
    if (action === "save") {
      // 既存記録があれば上書き、無ければ新規作成
      if (id) {
        const r = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { ...headers(key), Prefer: "return=representation" },
          body: JSON.stringify({ title, scenario, state: payload, updated_at: new Date().toISOString() }),
        });
        if (!r.ok) return fail(r);
        const rows = await r.json();
        if (rows.length) return res.status(200).json({ id: rows[0].id });
        // idの行が消えていた場合は新規作成にフォールスルー
      }
      const r = await fetch(base, {
        method: "POST",
        headers: { ...headers(key), Prefer: "return=representation" },
        body: JSON.stringify({ title, scenario, state: payload }),
      });
      if (!r.ok) return fail(r);
      const rows = await r.json();
      return res.status(200).json({ id: rows[0].id });
    }

    if (action === "list") {
      const r = await fetch(`${base}?select=id,title,scenario,created_at,updated_at&order=updated_at.desc&limit=30`, { headers: headers(key) });
      if (!r.ok) return fail(r);
      return res.status(200).json({ runs: await r.json() });
    }

    if (action === "load") {
      const r = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=id,title,scenario,state`, { headers: headers(key) });
      if (!r.ok) return fail(r);
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: "記録が見つかりません" });
      return res.status(200).json(rows[0]);
    }

    if (action === "delete") {
      const r = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers(key) });
      if (!r.ok) return fail(r);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "不明なaction" });
  } catch (e) {
    return res.status(500).json({ error: `Supabase接続エラー: ${(e && e.message) || e}` });
  }
}
