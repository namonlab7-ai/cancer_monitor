import React, { useState, useEffect } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import Auth from './components/Auth';
import InstallBanner from './components/InstallBanner';
import DailySymptomCalendar from './components/DailySymptomCalendar';
import MedicationList from './components/MedicationList';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('symptoms');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('로그아웃 오류:', error);
      alert('로그아웃에 실패했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>로딩 중...</p>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  const tabs = [
    { id: 'symptoms', label: '증상 기록', icon: '📋' },
    { id: 'medication', label: '약물 관리', icon: '💊' }
  ];

  return (
    <div className="App">
      <header className="app-header">
        <div className="app-header-content">
          <h1>항암기록관리</h1>
          <div className="user-info">
            <span className="user-email">{user.email}</span>
            <button className="logout-button" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 탭 네비게이션 */}
      <nav className="tab-navigation">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="app-content">
        <InstallBanner />
        {activeTab === 'symptoms' && <DailySymptomCalendar userId={user.uid} />}
        {activeTab === 'medication' && <MedicationList userId={user.uid} />}
      </main>
    </div>
  );
}

export default App;
