// DUR 품목정보 API - 병용금기, 임부금기, 연령금기 조회
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

  const { drugName, itemSeq } = req.query;

  if (!drugName && !itemSeq) {
    return res.status(400).json({ error: '약물명 또는 품목코드를 입력해주세요.' });
  }

  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  try {
    // DUR 품목정보 조회 API (여러 종류의 DUR 정보 조회)
    const baseUrl = 'https://apis.data.go.kr/1471000/DURPrdlstInfoService03';

    // 병렬로 여러 DUR 정보 조회
    const durTypes = [
      { endpoint: 'getUsjntTabooInfoList03', type: '병용금기', nameParam: 'itemName' },
      { endpoint: 'getPwnmTabooInfoList03', type: '임부금기', nameParam: 'itemName' },
      { endpoint: 'getSpcifyAgrdeTabooInfoList03', type: '특정연령대금기', nameParam: 'itemName' },
      { endpoint: 'getCpctyAtentInfoList03', type: '용량주의', nameParam: 'itemName' },
      { endpoint: 'getMdctnPdAtentInfoList03', type: '투여기간주의', nameParam: 'itemName' }
    ];

    const warnings = [];

    // 모든 DUR 타입에 대해 병렬 조회
    const searchParam = drugName || itemSeq;
    const results = await Promise.allSettled(
      durTypes.map(async (durType) => {
        const url = new URL(`${baseUrl}/${durType.endpoint}`);
        url.searchParams.append('serviceKey', apiKey);
        url.searchParams.append('numOfRows', '10');
        url.searchParams.append('pageNo', '1');
        url.searchParams.append(durType.nameParam, searchParam);
        url.searchParams.append('type', 'json');

        const response = await fetch(url.toString());
        if (!response.ok) return null;

        const data = await response.json();
        const items = data?.body?.items || [];
        const itemList = Array.isArray(items) ? items : items ? [items] : [];

        return {
          type: durType.type,
          items: itemList
        };
      })
    );

    // 결과 취합
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value && result.value.items.length > 0) {
        const { type, items } = result.value;
        items.forEach((item) => {
          if (item) {
            warnings.push({
              type,
              drugName: item.ITEM_NAME || item.itemName || drugName,
              warning: item.PROHBT_CONTENT || item.prohbtContent || item.ATN_CONTENT || item.atnContent || '',
              detail: item.REMARK || item.remark || '',
              mixedDrug: item.MIXTURE_ITEM_NAME || item.mixtureItemName || '' // 병용금기 약물명
            });
          }
        });
      }
    });

    // 중복 제거 및 정리
    const uniqueWarnings = warnings.reduce((acc, warning) => {
      const key = `${warning.type}-${warning.warning}`;
      if (!acc.find(w => `${w.type}-${w.warning}` === key)) {
        acc.push(warning);
      }
      return acc;
    }, []);

    return res.status(200).json({
      success: true,
      data: {
        drugName: drugName || itemSeq,
        warnings: uniqueWarnings,
        hasWarnings: uniqueWarnings.length > 0
      }
    });

  } catch (error) {
    console.error('DUR 정보 조회 API 오류:', error);
    return res.status(500).json({
      error: 'DUR 정보 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
}
