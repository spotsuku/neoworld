/* ----------------------------------------------------------
   Vercelサーバーレス関数: Anthropic Messages API プロキシ
   POST { system, userMsg } → { text } / { error }
   APIキーは process.env.ANTHROPIC_API_KEY からのみ読む。
   エラー時は Anthropic のHTTPステータスをそのまま返す
   (クライアント側で表示するため)。
   ---------------------------------------------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY が未設定です(サーバー環境変数)" });
  }
  const { system, userMsg } = req.body || {};
  if (typeof userMsg !== "string" || !userMsg.trim()) {
    return res.status(400).json({ error: "userMsg は必須です" });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        ...(typeof system === "string" && system ? { system } : {}),
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); }
    catch {
      return res.status(502).json({ error: `Anthropic APIが非JSON応答: HTTP${upstream.status} ${raw.slice(0, 100)}` });
    }
    if (!upstream.ok || data.error) {
      return res.status(upstream.status).json({
        error: (data.error && (data.error.message || data.error.type)) || `HTTP${upstream.status}`,
      });
    }
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    if (!text) {
      return res.status(502).json({ error: "空応答" });
    }
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: `プロキシエラー: ${(e && e.message) || e}` });
  }
}
