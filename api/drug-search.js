// 심평원 약가기준정보 API - 약물명 자동완성용
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

  const { keyword } = req.query;

  if (!keyword || keyword.length < 2) {
    return res.status(400).json({ error: '검색어는 2글자 이상 입력해주세요.' });
  }

  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  try {
    // 심평원 약가기준정보조회서비스 API
    const url = new URL('https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList');
    url.searchParams.append('serviceKey', apiKey);
    url.searchParams.append('numOfRows', '20');
    url.searchParams.append('pageNo', '1');
    url.searchParams.append('itmNm', keyword); // 품목명
    url.searchParams.append('_type', 'json');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`);
    }

    const data = await response.json();

    // 응답 데이터 파싱
    const items = data?.response?.body?.items?.item || [];
    const itemList = Array.isArray(items) ? items : [items];

    // 필요한 정보만 추출
    const results = itemList
      .filter(item => item && item.itmNm)
      .map(item => ({
        name: item.itmNm, // 품목명
        drugCode: item.mdsCd || item.itemSeq, // 약품코드
        manufacturer: item.mnfNm || '', // 제조사명
        unit: item.unit || '', // 단위
        specification: item.gnlNmCd || '' // 일반명코드
      }));

    return res.status(200).json({
      success: true,
      data: results,
      total: results.length
    });

  } catch (error) {
    console.error('약물 검색 API 오류:', error);
    return res.status(500).json({
      error: '약물 검색 중 오류가 발생했습니다.',
      details: error.message
    });
  }
}
