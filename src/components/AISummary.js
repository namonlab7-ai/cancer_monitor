import React, { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import '../styles/AISummary.css';

// ============================================================
// 상수 정의
// ============================================================

const NO_DATA_MESSAGE = '분석을 위해서는 기록이 더 쌓여야 합니다. 증상 기록을 계속 입력해주세요.';
const NO_DATA_COMMENT = '상세한 AI 분석을 위해 식사 메뉴, 음수 내용, 운동 방식, 주요 증상 등을 텍스트로 입력해주세요. 기록이 쌓일수록 더 정확한 분석이 가능합니다.';
const ERROR_MESSAGE = 'AI 분석 생성 중 오류가 발생했습니다.';

const ANALYSIS_SECTIONS = [
  { key: 'food', label: '식사량', icon: '🍽️', gradient: 'linear-gradient(135deg, #8895d4 0%, #7885c2 100%)' },
  { key: 'water', label: '음수량', icon: '💧', gradient: 'linear-gradient(135deg, #d888b2 0%, #c678a1 100%)' },
  { key: 'exercise', label: '운동량', icon: '🚶', gradient: 'linear-gradient(135deg, #78a8cc 0%, #6898bc 100%)' },
  { key: 'bowel', label: '배변', icon: '🚽', gradient: 'linear-gradient(135deg, #88c6b7 0%, #78b6a7 100%)' },
  { key: 'special', label: '특이사항 및 부작용', icon: '⚠️', gradient: 'linear-gradient(135deg, #f4a5ae 0%, #e4959e 100%)' },
];

const FOOD_LABEL_MAP = {
  '0': '섭취 안함',
  '25': '평소의 1/4 정도',
  '50': '평소의 50%',
  '75': '평소의 75%',
  '100': '평소만큼'
};

const WATER_LABEL_MAP = {
  '500': '500ml 이하',
  '1000': '500~1000ml',
  '1500': '1000~1500ml',
  '2000': '1500~2000ml',
  '2500': '2000ml 이상'
};

const EXERCISE_LABEL_MAP = {
  '0': '0보',
  '500': '1천보 미만',
  '1500': '1천~2천보',
  '3000': '2천~5천보',
  '7500': '5천~1만보',
  '10000': '1만보 이상'
};

// ============================================================
// 유틸리티 함수
// ============================================================

const extractNumber = (str) => {
  const match = str?.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const calculateAge = (birthdate) => {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
};

const getTimestampMs = (data) => {
  const toMs = (value) => {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return Math.max(toMs(data?.updatedAt), toMs(data?.createdAt));
};

const getRecordTimestamp = (record) => {
  const toMs = (value) => {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return Math.max(toMs(record.updatedAt), toMs(record.createdAt));
};

const formatRecordToText = (record) => {
  // 식사량 상세 정보 구성
  let foodDetails = '';
  if (record.foodIntakeBreakfast || record.foodIntakeLunch || record.foodIntakeDinner || record.foodIntakeOther) {
    const meals = [];
    if (record.foodIntakeBreakfast) meals.push(`아침: ${record.foodIntakeBreakfast}`);
    if (record.foodIntakeLunch) meals.push(`점심: ${record.foodIntakeLunch}`);
    if (record.foodIntakeDinner) meals.push(`저녁: ${record.foodIntakeDinner}`);
    if (record.foodIntakeOther) meals.push(`기타: ${record.foodIntakeOther}`);
    foodDetails = ` (${meals.join(', ')})`;
  } else if (record.foodIntakeNote) {
    foodDetails = ` (${record.foodIntakeNote})`;
  }

  const bowelStatus = record.bowelMovement === 'yes' ? '있음' : '없음';
  const bowelCondition = record.bowelCondition?.length > 0 ? ` (${record.bowelCondition.join(', ')})` : '';
  const waterNote = record.waterIntakeNote ? ` (${record.waterIntakeNote})` : '';
  const exerciseNote = record.exerciseNote ? ` (${record.exerciseNote})` : '';

  return `[${record.date}]
- 항암 진행: ${record.chemoCycle} ${record.chemoSession} ${record.chemoDay}
- 식사량: ${record.foodIntakeLevel}%${foodDetails}
- 음수량: 약 ${record.waterIntakeAmount}ml${waterNote}
- 운동량: 약 ${record.exerciseTime}보${exerciseNote}
- 배변: ${bowelStatus}${bowelCondition}
- 주요 부작용: ${record.sideEffects?.join(', ') || '없음'}
- 상세 증상: ${record.symptoms || '없음'}`;
};

const hasUserInputText = (records) => {
  return records.some(record =>
    (record.foodIntakeNote?.trim()) ||
    (record.waterIntakeNote?.trim()) ||
    (record.exerciseNote?.trim()) ||
    (record.symptoms?.trim())
  );
};

// ============================================================
// 통계 분석 함수
// ============================================================

const analyzeCountTrend = (records, valueField, labelMap, unit = '') => {
  if (records.length === 0) return '데이터 없음';

  const counts = {};
  records.forEach(record => {
    const value = record[valueField];
    if (value !== undefined && value !== '') {
      const label = labelMap[value] || '미기록';
      counts[label] = (counts[label] || 0) + 1;
    }
  });

  if (Object.keys(counts).length === 0) return '데이터 없음';

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [mostFrequent, count] = sorted[0];
  return `${mostFrequent}${unit} (${count}회)`;
};

const analyzeFoodIntakeTrend = (records) => {
  if (records.length === 0) return '데이터 없음';

  const dailyData = records
    .map((record, index) => ({
      day: index + 1,
      value: record.foodIntakeLevel,
      label: FOOD_LABEL_MAP[record.foodIntakeLevel] || '미기록'
    }))
    .filter(d => d.value !== undefined && d.value !== '');

  if (dailyData.length === 0) return '데이터 없음';

  // 연속된 동일 값 구간 찾기
  const segments = [];
  let currentSegment = { ...dailyData[0], start: dailyData[0].day, end: dailyData[0].day };

  for (let i = 1; i < dailyData.length; i++) {
    if (dailyData[i].value === currentSegment.value) {
      currentSegment.end = dailyData[i].day;
    } else {
      segments.push(currentSegment);
      currentSegment = { ...dailyData[i], start: dailyData[i].day, end: dailyData[i].day };
    }
  }
  segments.push(currentSegment);

  return segments.map(seg =>
    seg.start === seg.end
      ? `${seg.start}일차: ${seg.label}`
      : `${seg.start}~${seg.end}일차: ${seg.label} 유지`
  ).join('\n        ');
};

const generateStatisticalSummary = (records) => {
  const sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

  // 부작용 빈도 계산
  const sideEffectCount = {};
  sortedRecords.forEach(record => {
    record.sideEffects?.forEach(effect => {
      sideEffectCount[effect] = (sideEffectCount[effect] || 0) + 1;
    });
  });

  const sortedSideEffects = Object.entries(sideEffectCount).sort((a, b) => b[1] - a[1]);
  const uniqueDates = [...new Set(sortedRecords.map(r => r.date))];

  return {
    startDate: sortedRecords[0]?.date,
    endDate: sortedRecords[sortedRecords.length - 1]?.date,
    totalDays: uniqueDates.length,
    foodTrend: analyzeFoodIntakeTrend(sortedRecords),
    waterTrend: analyzeCountTrend(sortedRecords, 'waterIntakeAmount', WATER_LABEL_MAP, '를 가장 많이 섭취'),
    exerciseTrend: analyzeCountTrend(sortedRecords, 'exerciseTime', EXERCISE_LABEL_MAP, '를 가장 많이 기록'),
    bowelMovementCount: sortedRecords.filter(r => r.bowelMovement === 'yes' || r.bowelMovement === '예').length,
    sideEffectCount,
    sortedSideEffects,
    symptomsWithDates: sortedRecords
      .filter(r => r.symptoms?.trim())
      .map((r, idx) => ({ date: r.date, day: idx + 1, text: r.symptoms.trim() }))
  };
};

// ============================================================
// 컴포넌트
// ============================================================

function AISummary({ userId }) {
  const [symptomRecords, setSymptomRecords] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [selectedCycle, setSelectedCycle] = useState('');
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showDailyRecords, setShowDailyRecords] = useState(false);

  // 마크다운 bold(**text**)를 HTML로 변환
  const renderBoldText = (text) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  // AI 분석 내용에서 이전 비교 부분을 분리해서 렌더링
  const renderAIContent = (text) => {
    if (!text) return null;

    const comparisonMarker = '📊 이전 비교:';
    const markerIndex = text.indexOf(comparisonMarker);

    if (markerIndex === -1) {
      return <div>{renderBoldText(text)}</div>;
    }

    const currentPart = text.substring(0, markerIndex).trim();
    const comparisonPart = text.substring(markerIndex + comparisonMarker.length).trim();

    return (
      <>
        <div className="ai-current-analysis">{renderBoldText(currentPart)}</div>
        <div className="ai-comparison-section">
          <div className="ai-comparison-header">📊 이전 비교</div>
          <div className="ai-comparison-content">{renderBoldText(comparisonPart)}</div>
        </div>
      </>
    );
  };

  // 데이터 로드
  const loadSymptomRecords = useCallback(async () => {
    try {
      const querySnapshot = await getDocs(collection(db, `users/${userId}/symptomRecords`));
      const allRecords = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 날짜별로 최신 레코드만 필터링
      const recordsByDate = {};
      allRecords.forEach(record => {
        const previous = recordsByDate[record.date];
        if (!previous || getRecordTimestamp(record) >= getRecordTimestamp(previous)) {
          recordsByDate[record.date] = record;
        }
      });

      setSymptomRecords(Object.values(recordsByDate));
    } catch (error) {
      console.error('증상 기록 로드 오류:', error);
    }
  }, [userId]);

  const loadUserProfile = useCallback(async () => {
    try {
      const querySnapshot = await getDocs(collection(db, `users/${userId}/profile`));
      if (!querySnapshot.empty) {
        const latestDoc = querySnapshot.docs.reduce((latest, current) => {
          if (!latest) return current;
          return getTimestampMs(current.data()) >= getTimestampMs(latest.data()) ? current : latest;
        }, null);

        setUserProfile(latestDoc.data());
      }
    } catch (error) {
      console.error('사용자 프로필 로드 오류:', error);
    }
  }, [userId]);

  useEffect(() => {
    loadSymptomRecords();
    loadUserProfile();
  }, [loadSymptomRecords, loadUserProfile]);

  useEffect(() => {
    if (symptomRecords.length > 0) {
      const uniqueCycles = [...new Set(symptomRecords.map(r => r.chemoCycle).filter(Boolean))];
      setCycles(uniqueCycles.sort((a, b) => extractNumber(a) - extractNumber(b)));
    }
  }, [symptomRecords]);

  useEffect(() => {
    if (selectedCycle) {
      const filteredRecords = symptomRecords.filter(r => r.chemoCycle === selectedCycle);
      const uniqueSessions = [...new Set(filteredRecords.map(r => r.chemoSession).filter(Boolean))];
      setSessions(uniqueSessions.sort((a, b) => extractNumber(a) - extractNumber(b)));
    }
  }, [selectedCycle, symptomRecords]);

  // 직전 회차 데이터 가져오기
  const getPreviousSessionData = useCallback(() => {
    const sessionMap = new Map();
    symptomRecords.forEach(record => {
      const key = `${record.chemoCycle}|${record.chemoSession}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          cycle: record.chemoCycle,
          session: record.chemoSession,
          cycleNum: extractNumber(record.chemoCycle),
          sessionNum: extractNumber(record.chemoSession),
        });
      }
    });

    const sortedSessions = Array.from(sessionMap.values()).sort((a, b) => {
      if (a.cycleNum !== b.cycleNum) return a.cycleNum - b.cycleNum;
      return a.sessionNum - b.sessionNum;
    });

    const currentIndex = sortedSessions.findIndex(
      s => s.cycle === selectedCycle && s.session === selectedSession
    );

    if (currentIndex > 0) {
      const prev = sortedSessions[currentIndex - 1];
      const prevRecords = symptomRecords.filter(
        r => r.chemoCycle === prev.cycle && r.chemoSession === prev.session
      );
      return { prevCycle: prev.cycle, prevSession: prev.session, prevRecords };
    }
    return null;
  }, [symptomRecords, selectedCycle, selectedSession]);

  // AI 요약 생성
  const generateAISummary = async () => {
    if (!selectedCycle || !selectedSession) {
      alert('항암 진행 횟수와 항암 회차를 선택해주세요.');
      return;
    }

    setLoading(true);
    setAiLoading(true);
    setSummary(null);
    setAiSummary(null);

    try {
      const filteredRecords = symptomRecords.filter(
        r => r.chemoCycle === selectedCycle && r.chemoSession === selectedSession
      );

      if (filteredRecords.length === 0) {
        alert('선택한 기간에 기록된 데이터가 없습니다.');
        setLoading(false);
        setAiLoading(false);
        return;
      }

      // 통계 기반 요약 생성
      setSummary(generateStatisticalSummary(filteredRecords));
      setLoading(false);

      // 사용자 입력 텍스트 확인
      if (!hasUserInputText(filteredRecords)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        setAiSummary({
          food: NO_DATA_MESSAGE,
          water: NO_DATA_MESSAGE,
          exercise: NO_DATA_MESSAGE,
          bowel: NO_DATA_MESSAGE,
          special: NO_DATA_MESSAGE,
          comment: NO_DATA_COMMENT,
        });
        setAiLoading(false);
        return;
      }

      // API 호출
      const previousSessionData = getPreviousSessionData();
      const symptomTexts = filteredRecords.map(formatRecordToText).join('\n\n');

      let previousSymptomTexts = null;
      let previousSessionInfo = null;
      if (previousSessionData?.prevRecords.length > 0) {
        previousSessionInfo = {
          cycle: previousSessionData.prevCycle,
          session: previousSessionData.prevSession
        };
        previousSymptomTexts = previousSessionData.prevRecords.map(formatRecordToText).join('\n\n');
      }

      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('인증 토큰을 가져올 수 없습니다. 다시 로그인해주세요.');
      }

      const response = await fetch('/api/generate-medical-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          userProfile: {
            age: userProfile?.birthdate ? calculateAge(userProfile.birthdate) : null,
            gender: userProfile?.gender,
            disease: userProfile?.disease,
            diagnosisDate: userProfile?.diagnosisDate
          },
          symptomTexts,
          recordCount: filteredRecords.length,
          currentSessionInfo: { cycle: selectedCycle, session: selectedSession },
          previousSessionInfo,
          previousSymptomTexts
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.details || errorBody.error || `API 호출 실패: ${response.status}`);
      }

      const data = await response.json();
      setAiSummary(data);

    } catch (error) {
      console.error('AI 요약 생성 오류:', error);
      setAiSummary({
        food: ERROR_MESSAGE,
        water: ERROR_MESSAGE,
        exercise: ERROR_MESSAGE,
        bowel: ERROR_MESSAGE,
        special: ERROR_MESSAGE,
        comment: `오류 메시지: ${error.message}\n\nAPI 키 또는 모델 설정을 확인하거나 나중에 다시 시도해주세요.`
      });
    } finally {
      setAiLoading(false);
    }
  };

  // 선택 핸들러
  const handleCycleChange = (e) => {
    setSelectedCycle(e.target.value);
    setSelectedSession('');
    setSummary(null);
  };

  const handleSessionChange = (e) => {
    setSelectedSession(e.target.value);
    setSummary(null);
  };

  // ============================================================
  // 렌더링
  // ============================================================

  return (
    <div className="ai-summary">
      <h2>AI 요약</h2>

      {/* 선택 영역 */}
      <div className="selection-container">
        <div className="form-group">
          <label htmlFor="cycle">항암 진행 횟수 선택</label>
          <select id="cycle" value={selectedCycle} onChange={handleCycleChange}>
            <option value="">선택해주세요</option>
            {cycles.map(cycle => (
              <option key={cycle} value={cycle}>{cycle}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="session">항암 회차 선택</label>
          <select
            id="session"
            value={selectedSession}
            onChange={handleSessionChange}
            disabled={!selectedCycle}
          >
            <option value="">선택해주세요</option>
            {sessions.map(session => (
              <option key={session} value={session}>{session}</option>
            ))}
          </select>
        </div>

        <button
          className="generate-button"
          onClick={generateAISummary}
          disabled={!selectedCycle || !selectedSession || loading}
        >
          {loading ? 'AI 요약 생성 중...' : 'AI 요약 생성'}
        </button>
      </div>

      {/* 결과 영역 */}
      {summary && (
        <div className="summary-result">
          <h3>📊 요약 결과</h3>
          <div className="summary-content">
            {/* 선택된 기간 */}
            <div className="summary-section">
              <div className="summary-section-header">
                <span className="summary-section-icon">📅</span>
                <h4 className="summary-section-title">선택된 기간</h4>
              </div>
              <div className="summary-info-grid">
                <div className="summary-info-item">
                  <span className="summary-info-label">항암 진행 횟수</span>
                  <span className="summary-info-value">{selectedCycle}</span>
                </div>
                <div className="summary-info-item">
                  <span className="summary-info-label">항암 회차</span>
                  <span className="summary-info-value">{selectedSession}</span>
                </div>
                <div className="summary-info-item">
                  <span className="summary-info-label">기록 기간</span>
                  <span className="summary-info-value">{summary.startDate} ~ {summary.endDate}</span>
                </div>
                <div className="summary-info-item">
                  <span className="summary-info-label">총 기록 일수</span>
                  <span className="summary-info-value">{summary.totalDays}일</span>
                </div>
              </div>
            </div>

            {/* AI 분석 결과 */}
            <div className="summary-section">
              <div className="summary-section-header">
                <span className="summary-section-icon">🤖</span>
                <h4 className="summary-section-title">AI 분석 결과</h4>
              </div>

              {aiLoading ? (
                <div className="ai-loading-container">
                  <div className="ai-loading-spinner"></div>
                  <div className="ai-loading-text">AI가 증상 데이터를 분석하고 있습니다...</div>
                </div>
              ) : aiSummary ? (
                <>
                  <div className="ai-summary-box">
                    {/* 분석 항목들 - map으로 통합 렌더링 */}
                    {ANALYSIS_SECTIONS.map(({ key, label, icon, gradient }) => (
                      <div key={key} style={{ marginBottom: '20px' }}>
                        <div style={{ marginBottom: '8px', fontWeight: 700, color: '#374151', fontSize: '15px', display: 'flex', alignItems: 'center' }}>
                          <span style={{ marginRight: '6px' }}>{icon}</span>
                          <span>{label}</span>
                        </div>
                        <div className="ai-summary-content" style={{ background: gradient, color: 'white', padding: '16px', borderRadius: '8px' }}>
                          {renderAIContent(aiSummary[key])}
                        </div>
                      </div>
                    ))}

                    {/* AI 코멘트 */}
                    <div style={{ marginBottom: '20px' }}>
                      <div className="ai-comment-header">💬 AI 코멘트 (참고용)</div>
                      <div className="ai-comment-content">
                        {aiSummary.comment?.split('\n').map((line, idx) => (
                          <span key={idx}>
                            {renderBoldText(line)}
                            {idx < aiSummary.comment.split('\n').length - 1 && <br />}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 주의 문구 */}
                    <div className="ai-disclaimer">
                      ⚠️ <strong>중요 안내</strong><br />
                      본 AI 코멘트는 참고용 정보로, 의학적 진단이나 치료 결정을 대체할 수 없습니다.<br />
                      모든 증상과 건강 관련 결정은 반드시 담당 의료진과 상의하시기 바랍니다.
                    </div>
                  </div>

                  {/* 일자별 증상 기록 토글 */}
                  <div style={{ marginTop: '24px' }}>
                    <button
                      className="toggle-button"
                      onClick={() => setShowDailyRecords(!showDailyRecords)}
                    >
                      <span>{showDailyRecords ? '▼' : '▶'}</span>
                      <span style={{ marginLeft: '8px' }}>
                        일자별 상세 증상 기록 {showDailyRecords ? '접기' : '펼치기'}
                      </span>
                    </button>

                    {showDailyRecords && (
                      <div style={{ marginTop: '16px' }}>
                        {summary.symptomsWithDates.length > 0 ? (
                          summary.symptomsWithDates.map((symptom, index) => (
                            <div key={index} className="symptom-record">
                              <div className="symptom-date">{symptom.day}일차 ({symptom.date})</div>
                              <div className="symptom-text">{symptom.text}</div>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: '20px', textAlign: 'center', background: '#f3f4f6', borderRadius: '8px', color: '#6b7280' }}>
                            특이사항 없음
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 플레이스홀더 */}
      {!summary && !loading && (
        <div className="placeholder">
          항암 진행 횟수와 항암 회차를 선택한 후 'AI 요약 생성' 버튼을 클릭하세요.
        </div>
      )}
    </div>
  );
}

export default AISummary;
