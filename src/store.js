/* ----------------------------------------------------------
   シミュレーション記録クライアント
   自サーバーの /api/state(Supabaseプロキシ)を叩く。
   ---------------------------------------------------------- */
async function post(body) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); }
  catch { throw new Error(`HTTP${res.status} 非JSON応答`); }
  if (!res.ok || data.error) throw new Error(data.error || `HTTP${res.status}`);
  return data;
}

export const saveRun = (payload, meta, id) => post({ action: "save", id, ...meta, payload });
export const listRuns = () => post({ action: "list" });
export const loadRun = id => post({ action: "load", id });
export const deleteRun = id => post({ action: "delete", id });
