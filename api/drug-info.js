// e약은요 API - 효능/부작용/주의사항 조회
export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { drugName } = req.query;

  if (!drugName) {
    return res.status(400).json({ error: '약물명을 입력해주세요.' });
  }

  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  try {
    // e약은요 (의약품개요정보) API
    const url = new URL('https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList');
    url.searchParams.append('serviceKey', apiKey);
    url.searchParams.append('numOfRows', '5');
    url.searchParams.append('pageNo', '1');
    url.searchParams.append('itemName', drugName);
    url.searchParams.append('type', 'json');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`);
    }

    const data = await response.json();

    // 응답 데이터 파싱
    const items = data?.body?.items || [];
    const itemList = Array.isArray(items) ? items : [items];

    if (itemList.length === 0 || !itemList[0]) {
      return res.status(200).json({
        success: true,
        data: null,
        message: '검색 결과가 없습니다.'
      });
    }

    // 첫 번째 결과 사용
    const item = itemList[0];

    // HTML 태그 제거 및 텍스트 정리 함수
    const cleanText = (text) => {
      if (!text) return '';
      return text
        .replace(/<[^>]*>/g, '') // HTML 태그 제거
        .replace(/&nbsp;/g, ' ') // &nbsp; -> 공백
        .replace(/\s+/g, ' ') // 연속 공백 정리
        .trim();
    };

    // 텍스트 요약 함수 (긴 텍스트를 적절히 자름)
    const summarize = (text, maxLength = 500) => {
      const cleaned = cleanText(text);
      if (cleaned.length <= maxLength) return cleaned;
      return cleaned.substring(0, maxLength) + '...';
    };

    const result = {
      itemName: item.itemName || drugName, // 품목명
      entpName: item.entpName || '', // 업체명
      efficacy: summarize(item.efcyQesitm, 300), // 효능
      useMethod: summarize(item.useMethodQesitm, 200), // 용법용량
      sideEffects: summarize(item.seQesitm, 300), // 부작용
      warnings: summarize(item.atpnWarnQesitm, 300), // 경고
      caution: summarize(item.atpnQesitm, 300), // 주의사항
      interaction: summarize(item.intrcQesitm, 200), // 상호작용
      storageMethod: summarize(item.depositMethodQesitm, 100), // 보관방법
      itemSeq: item.itemSeq || '' // 품목기준코드
    };

    return res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('약물 정보 조회 API 오류:', error);
    return res.status(500).json({
      error: '약물 정보 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
}
