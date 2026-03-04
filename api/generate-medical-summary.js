const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 1200);

function extractTextFromAnthropicResponse(payload) {
  if (!payload || !Array.isArray(payload.content)) {
    return '';
  }

  return payload.content
    .filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
    .trim();
}

function safeJsonParse(text) {
  try {
    // 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
    let cleanText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1].trim();
    }
    return JSON.parse(cleanText);
  } catch {
    return null;
  }
}

function normalizeSummary(rawText, parsed) {
  if (parsed && typeof parsed === 'object') {
    return {
      food: String(parsed.food || ''),
      water: String(parsed.water || ''),
      exercise: String(parsed.exercise || ''),
      bowel: String(parsed.bowel || ''),
      special: String(parsed.special || ''),
      comment: String(parsed.comment || ''),
    };
  }

  const fallback = rawText || 'AI 분석 결과를 파싱하지 못했습니다.';
  return {
    food: fallback,
    water: fallback,
    exercise: fallback,
    bowel: fallback,
    special: fallback,
    comment: '모델 응답 형식이 예상과 달랐습니다. 원문을 각 항목에 동일하게 표시합니다.',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Allow', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      details: `Use POST for this endpoint. Received: ${req.method}`,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server configuration error',
      details: 'ANTHROPIC_API_KEY is not set.',
    });
  }

  const {
    userProfile,
    symptomTexts,
    recordCount,
    currentSessionInfo,
    previousSessionInfo,
    previousSymptomTexts,
  } = req.body || {};

  if (!symptomTexts || typeof symptomTexts !== 'string') {
    return res.status(400).json({
      error: 'Invalid request body',
      details: 'symptomTexts(string) is required.',
    });
  }

  const systemPrompt = [
    '당신은 항암치료 기록을 요약하는 의료 기록 보조 AI입니다.',
    '진단/처방을 하지 말고, 기록 사실 기반으로 간결하게 분석하세요.',
    '출력은 반드시 순수 JSON 객체 한 개만 반환하세요. 코드 블록(```)이나 추가 설명 없이 JSON만 출력하세요.',
    '키는 정확히 food, water, exercise, bowel, special, comment 여섯 개입니다.',
    '각 값은 한국어 문자열로 작성하세요.',
    '',
    '### 분석 정책 ###',
    '1. food, water, exercise, bowel, special 각 항목은 최대 3문장 이내로 간결하게 분석하세요.',
    '2. 모든 분석 결과에서 중요한 수치, 키워드, 핵심 내용은 **bold**(마크다운)를 적용하여 가독성을 높이세요. 예: "식사량 **75%**로 **양호**한 편입니다.", "**구역질**과 **피로감**이 주요 부작용입니다."',
    '3. 이전 회차 데이터가 있는 경우, comment를 제외한 모든 항목(food, water, exercise, bowel, special)에 반드시 "📊 이전 비교:" 접두어와 함께 이전 회차와의 비교 분석을 포함하세요. 비교 내용은 2줄 이내로 간결하게 작성하세요.',
    '4. special에는 주요 부작용과 특이사항을 포함하세요.',
    '5. comment는 항목별 기록과 상세 기록을 종합적으로 분석하여 5줄 이내로 작성하세요. 환자의 나이, 성별, 질병명 등 이미 알고 있는 정보는 생략하고, "1차 2회차 분석결과," 처럼 핵심 정보로 시작하세요.',
    '6. comment의 마지막에는 줄바꿈(\\n\\n)을 추가한 후, 짧고 간결한 응원 문구(예: "잘 하고 계세요, 힘내세요!")를 작성하고 반드시 💪 이모지로 마무리하세요.',
  ].join(' ');

  const userPrompt = [
    `현재 회차 정보: ${JSON.stringify(currentSessionInfo || {}, null, 2)}`,
    `이전 회차 정보: ${JSON.stringify(previousSessionInfo || {}, null, 2)}`,
    `사용자 프로필: ${JSON.stringify(userProfile || {}, null, 2)}`,
    `기록 수: ${recordCount ?? 'unknown'}`,
    '',
    '[현재 회차 증상 텍스트]',
    symptomTexts,
    '',
    '[이전 회차 증상 텍스트]',
    previousSymptomTexts || '없음',
  ].join('\n');

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Failed to call Anthropic API',
      details: error?.message || 'Unknown network error',
    });
  }

  const responseText = await upstreamResponse.text();
  const responseJson = safeJsonParse(responseText) || {};

  if (!upstreamResponse.ok) {
    return res.status(upstreamResponse.status).json({
      error: 'Anthropic API request failed',
      details: responseJson?.error?.message || responseJson?.message || responseText,
    });
  }

  const modelText = extractTextFromAnthropicResponse(responseJson);
  const parsedSummary = safeJsonParse(modelText);
  const normalized = normalizeSummary(modelText, parsedSummary);
  return res.status(200).json(normalized);
};
