// 설계 의도 생성: 화면에서 받은 요청문을 Gemini에 보내고 JSON 결과를 돌려준다.
// Vercel 환경 변수 GEMINI_API_KEY 필요. (선택) GEMINI_MODEL로 모델 변경 가능.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ code: 'no_key' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const prompt = String(body.prompt || '');
  if (!prompt) return res.status(400).json({ code: 'empty' });
  if (prompt.length > 60000) return res.status(413).json({ code: 'too_large' });

  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: body.fresh ? 1.0 : 0.6 }
      })
    });
    if (r.status === 429) return res.status(429).json({ code: 'rate_limited' });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ code: 'upstream_error', detail: j.error && j.error.message });

    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    let data;
    try { data = JSON.parse(text); }
    catch { const m = text.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : null; }
    if (!data || !Array.isArray(data.candidates)) return res.status(502).json({ code: 'invalid_json' });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ code: 'upstream_error' });
  }
};
