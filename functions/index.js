const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_MAX_TOKENS = 1200;

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
    return JSON.parse(text);
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

exports.generateMedicalSummary = onRequest(
  {
    cors: true,
    secrets: [anthropicApiKey],
    region: 'asia-northeast3',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed',
        details: `Use POST for this endpoint. Received: ${req.method}`,
      });
    }

    const apiKey = anthropicApiKey.value();
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
      '출력은 반드시 JSON 객체 한 개만 반환하세요.',
      '키는 정확히 food, water, exercise, bowel, special, comment 여섯 개입니다.',
      '각 값은 한국어 문자열로 작성하세요.',
      'special에는 주요 부작용과 특이사항을 포함하세요.',
      '가능하면 현재 회차와 이전 회차 비교를 포함하고, 비교 문구는 "📊 이전 비교:" 접두어를 사용하세요.',
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
  }
);
