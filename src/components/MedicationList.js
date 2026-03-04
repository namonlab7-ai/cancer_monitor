import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import '../styles/MedicationList.css';

function MedicationList({ userId }) {
  const [medications, setMedications] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    frequency: '',
    notes: ''
  });
  const [errors, setErrors] = useState({});
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [draggedElement, setDraggedElement] = useState(null);

  // API 관련 상태
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [drugInfo, setDrugInfo] = useState(null);
  const [durWarnings, setDurWarnings] = useState([]);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [apiError, setApiError] = useState(null);

  const searchTimeoutRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    loadMedications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadMedications = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, `users/${userId}/medications`));
      const medicationList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      medicationList.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      setMedications(medicationList);
    } catch (error) {
      console.error('약물 데이터 로드 오류:', error);
    }
  };

  // 약물명 검색 (디바운스 적용)
  const searchDrugs = useCallback(async (keyword) => {
    if (keyword.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/drug-search?keyword=${encodeURIComponent(keyword)}`);
      const data = await response.json();

      if (data.success && data.data.length > 0) {
        setSearchResults(data.data);
        setShowDropdown(true);
      } else {
        setSearchResults([]);
        setShowDropdown(false);
      }
    } catch (error) {
      console.error('약물 검색 오류:', error);
      setApiError('검색 서비스 연결 실패');
      setSearchResults([]);
      setShowDropdown(false);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // 약물 상세 정보 조회
  const fetchDrugInfo = async (drugName) => {
    setIsLoadingInfo(true);
    setApiError(null);

    try {
      // 효능/부작용 정보 조회
      const infoResponse = await fetch(`/api/drug-info?drugName=${encodeURIComponent(drugName)}`);
      const infoData = await infoResponse.json();

      if (infoData.success && infoData.data) {
        setDrugInfo(infoData.data);
      } else {
        setDrugInfo(null);
      }

      // DUR 경고 정보 조회
      const durResponse = await fetch(`/api/drug-dur?drugName=${encodeURIComponent(drugName)}`);
      const durData = await durResponse.json();

      if (durData.success && durData.data) {
        setDurWarnings(durData.data.warnings || []);
      } else {
        setDurWarnings([]);
      }
    } catch (error) {
      console.error('약물 정보 조회 오류:', error);
      setApiError('정보 조회 서비스 연결 실패');
      setDrugInfo(null);
      setDurWarnings([]);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }

    // 약물명 입력 시 검색 실행 (수동 모드가 아닐 때만)
    if (name === 'name' && !isManualMode) {
      // 기존 타이머 취소
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // 약물 선택 초기화
      if (selectedDrug) {
        setSelectedDrug(null);
        setDrugInfo(null);
        setDurWarnings([]);
      }

      // 디바운스: 300ms 후 검색 실행
      searchTimeoutRef.current = setTimeout(() => {
        searchDrugs(value);
      }, 300);
    }
  };

  // 검색 결과에서 약물 선택
  const handleSelectDrug = (drug) => {
    setSelectedDrug(drug);
    setFormData(prev => ({
      ...prev,
      name: drug.name
    }));
    setShowDropdown(false);
    setSearchResults([]);

    // 상세 정보 조회
    fetchDrugInfo(drug.name);
  };

  // 수동 입력 모드 전환
  const toggleManualMode = () => {
    setIsManualMode(!isManualMode);
    if (!isManualMode) {
      // 수동 모드로 전환 시 API 관련 상태 초기화
      setSelectedDrug(null);
      setDrugInfo(null);
      setDurWarnings([]);
      setSearchResults([]);
      setShowDropdown(false);
      setApiError(null);
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = '약물 이름을 입력해주세요.';
    }

    if (!formData.frequency.trim()) {
      newErrors.frequency = '복용 횟수를 입력해주세요.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      // 저장할 데이터 구성
      const medicationData = {
        name: formData.name,
        frequency: formData.frequency,
        notes: formData.notes,
        isManualEntry: isManualMode || !selectedDrug,
        drugCode: selectedDrug?.drugCode || '',
        efficacy: drugInfo?.efficacy || '',
        sideEffects: drugInfo?.sideEffects || '',
        warnings: drugInfo?.warnings || '',
        durWarnings: durWarnings.map(w => ({
          type: w.type,
          warning: w.warning,
          detail: w.detail
        })),
        updatedAt: new Date().toISOString()
      };

      if (editingId) {
        await updateDoc(doc(db, `users/${userId}/medications`, editingId), medicationData);
        alert('약물 정보가 수정되었습니다.');
      } else {
        const dataWithOrder = {
          ...medicationData,
          order: medications.length,
          createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, `users/${userId}/medications`), dataWithOrder);
        alert('약물이 등록되었습니다.');
      }

      // 폼 초기화
      resetForm();
      await loadMedications();
    } catch (error) {
      console.error('약물 저장 오류:', error);
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', frequency: '', notes: '' });
    setShowForm(false);
    setEditingId(null);
    setSelectedDrug(null);
    setDrugInfo(null);
    setDurWarnings([]);
    setIsManualMode(false);
    setApiError(null);
    setErrors({});
  };

  const handleEdit = (medication) => {
    setEditingId(medication.id);
    setFormData({
      name: medication.name,
      frequency: medication.frequency,
      notes: medication.notes || ''
    });
    setIsManualMode(medication.isManualEntry || false);

    // 기존 저장된 정보 복원
    if (medication.efficacy || medication.sideEffects) {
      setDrugInfo({
        efficacy: medication.efficacy,
        sideEffects: medication.sideEffects,
        warnings: medication.warnings
      });
    }
    if (medication.durWarnings && medication.durWarnings.length > 0) {
      setDurWarnings(medication.durWarnings);
    }

    setShowForm(true);
  };

  const handleDelete = async (id, name) => {
    if (window.confirm(`"${name}" 약물을 삭제하시겠습니까?`)) {
      try {
        await deleteDoc(doc(db, `users/${userId}/medications`, id));
        alert('약물이 삭제되었습니다.');
        await loadMedications();
      } catch (error) {
        console.error('약물 삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
      }
    }
  };

  // 드래그 앤 드롭 핸들러들 (기존 코드 유지)
  const handleDragStart = (e, index) => {
    e.stopPropagation();
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
    const card = e.currentTarget.closest('.medication-card');
    if (card) {
      setTimeout(() => card.classList.add('dragging'), 0);
    }
  };

  const handleDragEnter = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);
  };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newMedications = [...medications];
    const [draggedItem] = newMedications.splice(draggedIndex, 1);
    newMedications.splice(dropIndex, 0, draggedItem);

    try {
      await Promise.all(newMedications.map((med, idx) =>
        updateDoc(doc(db, `users/${userId}/medications`, med.id), { order: idx })
      ));
      setDraggedIndex(null);
      setDragOverIndex(null);
      await loadMedications();
    } catch (error) {
      console.error('순서 변경 오류:', error);
      alert('순서 변경 중 오류가 발생했습니다.');
      setDraggedIndex(null);
      setDragOverIndex(null);
    }
  };

  const handleDragEnd = (e) => {
    e.stopPropagation();
    const card = e.currentTarget.closest('.medication-card');
    if (card) card.classList.remove('dragging');
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // 터치 이벤트 핸들러 (모바일용)
  const handleTouchStart = (e, index) => {
    e.stopPropagation();
    setDraggedIndex(index);
    const card = e.currentTarget.closest('.medication-card');
    if (card) {
      setDraggedElement(card);
      card.classList.add('dragging');
    }
  };

  const handleTouchMove = (e) => {
    if (draggedIndex === null || !draggedElement) return;
    e.preventDefault();
    const touch = e.touches[0];
    const currentY = touch.clientY;
    const cards = document.querySelectorAll('.medication-card');
    let overIndex = null;
    cards.forEach((card, idx) => {
      const rect = card.getBoundingClientRect();
      if (currentY >= rect.top && currentY <= rect.bottom && idx !== draggedIndex) {
        overIndex = idx;
      }
    });
    setDragOverIndex(overIndex);
  };

  const handleTouchEnd = async (e) => {
    e.stopPropagation();
    if (draggedElement) draggedElement.classList.remove('dragging');

    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newMedications = [...medications];
      const [draggedItem] = newMedications.splice(draggedIndex, 1);
      newMedications.splice(dragOverIndex, 0, draggedItem);

      try {
        await Promise.all(newMedications.map((med, idx) =>
          updateDoc(doc(db, `users/${userId}/medications`, med.id), { order: idx })
        ));
        await loadMedications();
      } catch (error) {
        console.error('순서 변경 오류:', error);
        alert('순서 변경 중 오류가 발생했습니다.');
      }
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
    setDraggedElement(null);
  };

  return (
    <div className="medication-list">
      <h2>처방받은 약 목록 관리</h2>

      {!showForm && (
        <button className="add-button" onClick={() => setShowForm(true)}>
          + 약물 등록하기
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="medication-form">
          <h3>{editingId ? '약물 수정' : '약물 등록'}</h3>

          {/* 수동 입력 모드 토글 */}
          <div className="mode-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={isManualMode}
                onChange={toggleManualMode}
              />
              <span className="toggle-slider"></span>
              <span className="toggle-text">수동 입력 모드</span>
            </label>
            {isManualMode && (
              <span className="mode-hint">API 검색 없이 직접 입력합니다</span>
            )}
          </div>

          {/* 약물명 입력 (자동완성 포함) */}
          <div className="form-group" ref={dropdownRef}>
            <label htmlFor="name">
              약물 이름 <span className="required">*</span>
              {!isManualMode && <span className="api-hint">(2글자 이상 입력 시 검색)</span>}
            </label>
            <div className="autocomplete-wrapper">
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className={errors.name ? 'error' : ''}
                placeholder={isManualMode ? '약물명을 직접 입력하세요' : '약물명 검색...'}
                autoComplete="off"
              />
              {isSearching && (
                <div className="search-spinner">
                  <span className="spinner"></span>
                </div>
              )}
            </div>
            {errors.name && <span className="error-message">{errors.name}</span>}
            {apiError && !isManualMode && (
              <span className="api-error">{apiError} - 수동 입력 모드를 사용하세요</span>
            )}

            {/* 검색 결과 드롭다운 */}
            {showDropdown && searchResults.length > 0 && (
              <div className="autocomplete-dropdown">
                {searchResults.map((drug, index) => (
                  <div
                    key={index}
                    className="dropdown-item"
                    onClick={() => handleSelectDrug(drug)}
                  >
                    <span className="drug-name">{drug.name}</span>
                    {drug.manufacturer && (
                      <span className="drug-manufacturer">{drug.manufacturer}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 복용 횟수 */}
          <div className="form-group">
            <label htmlFor="frequency">복용 횟수 <span className="required">*</span></label>
            <input
              type="text"
              id="frequency"
              name="frequency"
              value={formData.frequency}
              onChange={handleChange}
              placeholder="예: 1일 3회"
              className={errors.frequency ? 'error' : ''}
            />
            {errors.frequency && <span className="error-message">{errors.frequency}</span>}
          </div>

          {/* API에서 조회된 약물 정보 미리보기 */}
          {isLoadingInfo && (
            <div className="drug-info-loading">
              <span className="spinner"></span>
              <span>약물 정보를 조회하고 있습니다...</span>
            </div>
          )}

          {drugInfo && !isLoadingInfo && (
            <div className="drug-info-preview">
              <h4>약물 정보 (자동 조회)</h4>
              {drugInfo.efficacy && (
                <div className="info-section">
                  <label>효능</label>
                  <p>{drugInfo.efficacy}</p>
                </div>
              )}
              {drugInfo.sideEffects && (
                <div className="info-section">
                  <label>부작용</label>
                  <p>{drugInfo.sideEffects}</p>
                </div>
              )}
              {drugInfo.warnings && (
                <div className="info-section warning">
                  <label>주의사항</label>
                  <p>{drugInfo.warnings}</p>
                </div>
              )}
            </div>
          )}

          {/* DUR 경고 표시 */}
          {durWarnings.length > 0 && !isLoadingInfo && (
            <div className="dur-warnings">
              <h4>DUR 경고</h4>
              {durWarnings.map((warning, index) => (
                <div key={index} className={`dur-warning-item ${warning.type.includes('금기') ? 'severe' : ''}`}>
                  <span className="warning-type">{warning.type}</span>
                  <p className="warning-content">{warning.warning}</p>
                  {warning.detail && <p className="warning-detail">{warning.detail}</p>}
                </div>
              ))}
            </div>
          )}

          {/* 메모 */}
          <div className="form-group">
            <label htmlFor="notes">메모</label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="3"
              placeholder="추가 메모 사항을 입력하세요"
            />
          </div>

          <div className="form-buttons">
            <button type="submit" className="submit-button">
              {editingId ? '수정하기' : '등록하기'}
            </button>
            <button type="button" className="cancel-button" onClick={resetForm}>
              취소
            </button>
          </div>
        </form>
      )}

      <div className="medication-cards-container">
        {medications.length > 0 ? (
          medications.map((med, index) => (
            <div
              key={med.id}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              className={`medication-card ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
            >
              <div
                className="drag-handle"
                title="드래그하여 순서 변경"
                draggable="true"
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => handleTouchStart(e, index)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="9" cy="7" r="1.5" fill="currentColor"/>
                  <circle cx="15" cy="7" r="1.5" fill="currentColor"/>
                  <circle cx="9" cy="12" r="1.5" fill="currentColor"/>
                  <circle cx="15" cy="12" r="1.5" fill="currentColor"/>
                  <circle cx="9" cy="17" r="1.5" fill="currentColor"/>
                  <circle cx="15" cy="17" r="1.5" fill="currentColor"/>
                </svg>
              </div>

              <div className="card-content">
                <div className="card-row">
                  <label>약물 이름</label>
                  <span className="medication-name">{med.name}</span>
                  {med.isManualEntry && <span className="manual-badge">수동입력</span>}
                </div>
                <div className="card-row">
                  <label>복용 횟수</label>
                  <span>{med.frequency}</span>
                </div>
                {med.efficacy && (
                  <div className="card-row">
                    <label>효능</label>
                    <span className="efficacy-text">{med.efficacy}</span>
                  </div>
                )}
                {med.sideEffects && (
                  <div className="card-row">
                    <label>부작용</label>
                    <span className="side-effects-text">{med.sideEffects}</span>
                  </div>
                )}
                {med.durWarnings && med.durWarnings.length > 0 && (
                  <div className="card-row dur-row">
                    <label>DUR 경고</label>
                    <div className="dur-badges">
                      {med.durWarnings.map((w, i) => (
                        <span key={i} className="dur-badge">{w.type}</span>
                      ))}
                    </div>
                  </div>
                )}
                {med.notes && (
                  <div className="card-row">
                    <label>메모</label>
                    <span>{med.notes}</span>
                  </div>
                )}
              </div>

              <div className="card-actions">
                <button className="action-btn edit-btn" onClick={() => handleEdit(med)}>
                  수정
                </button>
                <button className="action-btn delete-btn" onClick={() => handleDelete(med.id, med.name)}>
                  삭제
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p>등록된 약물이 없습니다.</p>
            <p className="empty-subtitle">+ 약물 등록하기 버튼을 눌러 추가해보세요</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default MedicationList;
