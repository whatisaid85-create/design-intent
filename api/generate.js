// 설계 의도 생성: 화면에서 받은 요청문을 Gemini에 보내고 JSON 결과를 돌려준다.
// Vercel 환경 변수 GEMINI_API_KEY 필요. (선택) GEMINI_MODEL로 모델 지정 가능.
// 모델 하나가 안 되면 다음 모델로 자동으로 넘어간다.
const FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'];

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    // 브라우저로 /api/generate를 열면 설정 상태를 보여 준다 (키 값은 보여 주지 않음)
    return res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY, models: modelList() });
  }
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });

  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return res.status(500).json({ code: 'no_key', detail: 'Vercel 환경 변수 GEMINI_API_KEY가 없습니다.' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = String(body.prompt || '');
  if (!prompt) return res.status(400).json({ code: 'empty' });
  if (prompt.length > 60000) return res.status(413).json({ code: 'too_large' });

  const errors = [];
  for (const model of modelList()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: body.fresh ? 1.0 : 0.6 }
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
        errors.push(`${model}: ${msg}`);
        // 키 문제는 다른 모델로 넘어가도 소용없으니 바로 알려 준다
        if (r.status === 400 && /API key/i.test(msg)) return res.status(500).json({ code: 'bad_key', detail: msg });
        if (r.status === 403) return res.status(500).json({ code: 'bad_key', detail: msg });
        continue;
      }
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      let data = null;
      try { data = JSON.parse(text); }
      catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { data = JSON.parse(m[0]); } catch {} } }
      if (!data || !Array.isArray(data.candidates)) { errors.push(`${model}: 결과 형식 오류`); continue; }
      data.model = model;
      return res.status(200).json(data);
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  const limited = errors.some(e => /429|quota|RESOURCE_EXHAUSTED/i.test(e));
  return res.status(limited ? 429 : 502).json({ code: limited ? 'rate_limited' : 'upstream_error', detail: errors.join(' | ') });
};

function modelList() {
  const env = (process.env.GEMINI_MODEL || '').trim();
  return env ? [env, ...FALLBACKS.filter(m => m !== env)] : FALLBACKS;
}
