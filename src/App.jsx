import React, { useState, useEffect, useCallback, useMemo } from 'react';

// UK Admiralty Tidal API Configuration
const API_BASE_URL = '/api';
const DEFAULT_API_KEY = 'baec423358314e4e8f527980f959295d';

// CLUB COMPONENTS
const ScrubWindowCard = ({ window, onJoin }) => {
  const isFull = window.booked >= window.capacity;
  return (
    <div style={{ padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc', display: 'grid', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>{window.date}</div>
          <div style={{ fontSize: '12px', color: '#334155' }}>Low water {window.lowWater} • Duration {window.duration}</div>
        </div>
        {window.booked > 5 && <span style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>Scrub day</span>}
      </div>
      <div style={{ fontSize: '12px', color: '#0f172a' }}>{window.booked} of {window.capacity} boats booked</div>
      {window.booked > 5 && window.boats?.length > 0 && (
        <div style={{ fontSize: '12px', color: '#334155' }}>
          Boats: {window.boats.slice(0, 6).join(', ')}
          {window.boats.length > 6 && '…'}
        </div>
      )}
      <button disabled={isFull} onClick={onJoin} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #0ea5e9', background: isFull ? '#e2e8f0' : '#0ea5e9', color: isFull ? '#475569' : '#ffffff', cursor: isFull ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
        {isFull ? 'Capacity reached' : 'Join this window'}
      </button>
    </div>
  );
};

const ClubRulesPanel = () => (
  <div style={{ padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#ffffff', display: 'grid', gap: '8px', boxShadow: '0 6px 16px rgba(15,23,42,0.06)' }}>
    <h4 style={{ margin: 0, fontSize: '14px', color: '#0f172a' }}>Club Rules</h4>
    <div style={{ fontSize: '12px', color: '#334155' }}>
      <strong style={{ color: '#0f172a' }}>Scrubbing area:</strong> Outer grid, west wall only.
    </div>
    <div style={{ fontSize: '12px', color: '#334155' }}>
      <strong style={{ color: '#0f172a' }}>Permitted:</strong> Soft brush, hand tools, buckets of seawater.
    </div>
    <div style={{ fontSize: '12px', color: '#334155' }}>
      <strong style={{ color: '#0f172a' }}>Prohibited:</strong> Pressure washers, detergents, scrubbing antifoul into the mud.
    </div>
  </div>
);

const ClubDashboard = ({ clubName, windows, onJoinWindow }) => {
  const nextWindow = windows[0];
  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ padding: '16px', borderRadius: '14px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', boxShadow: '0 10px 30px rgba(15,23,42,0.06)' }}>
        <div style={{ fontSize: '12px', letterSpacing: '1px', color: '#334155' }}>{clubName}</div>
        {nextWindow ? (
          <>
            <div style={{ fontSize: '18px', margin: '6px 0', fontWeight: 600 }}>Next scrub window: {nextWindow.date}</div>
            <div style={{ fontSize: '13px', color: '#334155' }}>Low water {nextWindow.lowWater} • Estimated {nextWindow.duration}</div>
            <div style={{ fontSize: '13px', color: '#0f172a' }}>{nextWindow.booked} of {nextWindow.capacity} boats booked • {nextWindow.capacity - nextWindow.booked} remaining</div>
          </>
        ) : (
          <div style={{ fontSize: '13px', color: '#334155' }}>No upcoming windows</div>
        )}
      </div>

      <ClubRulesPanel />

      <div style={{ display: 'grid', gap: '10px' }}>
        <h4 style={{ margin: '8px 0', color: '#e2e8f0', fontSize: '14px' }}>Upcoming scrub windows</h4>
        {windows.map(w => (
          <ScrubWindowCard key={w.id} window={w} onJoin={() => onJoinWindow(w.id)} />
        ))}
      </div>
    </div>
  );
};

// Sample stations with tidal characteristics for prediction
const DEMO_STATIONS = [
  { id: '0001', name: 'Aberdeen', country: 'Scotland', lat: 57.143, lon: -2.079, mhws: 4.3, mhwn: 3.4, mlwn: 1.3, mlws: 0.5 },
  { id: '0113', name: 'London Bridge', country: 'England', lat: 51.507, lon: -0.087, mhws: 7.1, mhwn: 6.0, mlwn: 1.5, mlws: 0.5 },
  { id: '0162', name: 'Liverpool (Alfred Dock)', country: 'England', lat: 53.405, lon: -2.994, mhws: 9.4, mhwn: 7.5, mlwn: 2.9, mlws: 1.0 },
  { id: '0240', name: 'Southampton', country: 'England', lat: 50.899, lon: -1.391, mhws: 4.5, mhwn: 3.7, mlwn: 1.8, mlws: 0.5 },
  { id: '0316', name: 'Dover', country: 'England', lat: 51.114, lon: 1.318, mhws: 6.8, mhwn: 5.3, mlwn: 1.9, mlws: 0.8 },
  { id: '0402', name: 'Bristol (Avonmouth)', country: 'England', lat: 51.509, lon: -2.711, mhws: 13.2, mhwn: 9.8, mlwn: 3.8, mlws: 0.9 },
  { id: '0452', name: 'Plymouth (Devonport)', country: 'England', lat: 50.368, lon: -4.186, mhws: 5.5, mhwn: 4.4, mlwn: 2.2, mlws: 0.8 },
  { id: '0503', name: 'Cardiff', country: 'Wales', lat: 51.461, lon: -3.165, mhws: 12.4, mhwn: 9.2, mlwn: 3.6, mlws: 0.8 },
  { id: '0590', name: 'Holyhead', country: 'Wales', lat: 53.314, lon: -4.633, mhws: 5.6, mhwn: 4.4, mlwn: 2.0, mlws: 0.7 },
  { id: '0621', name: 'Belfast', country: 'Northern Ireland', lat: 54.607, lon: -5.909, mhws: 3.5, mhwn: 3.0, mlwn: 1.1, mlws: 0.4 },
];

// ===========================================
// TIDAL PREDICTION ALGORITHMS
// ===========================================

const getLunarPhase = (date) => {
  const LUNAR_CYCLE = 29.53059;
  const KNOWN_NEW_MOON = new Date('2024-01-11T11:57:00Z').getTime();
  const daysSinceNew = (date.getTime() - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const phase = (daysSinceNew % LUNAR_CYCLE) / LUNAR_CYCLE;
  return phase < 0 ? phase + 1 : phase;
};

const getSpringNeapFactor = (date) => {
  const phase = getLunarPhase(date);
  const springProximity = Math.min(Math.abs(phase - 0), Math.abs(phase - 0.5), Math.abs(phase - 1));
  return 1 - (springProximity / 0.25);
};

const getMoonPhaseName = (date) => {
  const phase = getLunarPhase(date);
  if (phase < 0.0625 || phase >= 0.9375) return { name: 'New Moon', icon: '🌑', isSpring: true };
  if (phase < 0.1875) return { name: 'Waxing Crescent', icon: '🌒', isSpring: false };
  if (phase < 0.3125) return { name: 'First Quarter', icon: '🌓', isSpring: false };
  if (phase < 0.4375) return { name: 'Waxing Gibbous', icon: '🌔', isSpring: false };
  if (phase < 0.5625) return { name: 'Full Moon', icon: '🌕', isSpring: true };
  if (phase < 0.6875) return { name: 'Waning Gibbous', icon: '🌖', isSpring: false };
  if (phase < 0.8125) return { name: 'Last Quarter', icon: '🌗', isSpring: false };
  return { name: 'Waning Crescent', icon: '🌘', isSpring: false };
};

const predictTidalEvents = (station, startDate, days) => {
  const events = [];
  const { mhws = 4.5, mhwn = 3.5, mlwn = 1.5, mlws = 0.5 } = station;
  const M2_PERIOD = 12.4206;
  
  const referenceDate = new Date(startDate);
  referenceDate.setHours(0, 0, 0, 0);
  
  const lunarPhase = getLunarPhase(referenceDate);
  const initialHWOffset = (lunarPhase * 24 * 0.5 + 2) % M2_PERIOD;
  
  for (let day = 0; day < days; day++) {
    const currentDate = new Date(referenceDate);
    currentDate.setDate(currentDate.getDate() + day);
    
    const laggedDate = new Date(currentDate);
    laggedDate.setDate(laggedDate.getDate() - 2);
    const springFactor = getSpringNeapFactor(laggedDate);
    
    const hwHeight = mhwn + (mhws - mhwn) * springFactor;
    const lwHeight = mlwn - (mlwn - mlws) * springFactor;
    
    const dayOffset = day * 0.8333;
    let hw1Hour = (initialHWOffset + dayOffset) % 24;
    if (hw1Hour < 0) hw1Hour += 24;
    
    let hw2Hour = (hw1Hour + M2_PERIOD) % 24;
    let lw1Hour = (hw1Hour + M2_PERIOD / 2) % 24;
    let lw2Hour = (hw2Hour + M2_PERIOD / 2) % 24;
    
    const addEvent = (hour, type, baseHeight) => {
      if (hour >= 0 && hour < 24) {
        const time = new Date(currentDate);
        time.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
        events.push({
          EventType: type,
          DateTime: time.toISOString(),
          Height: Math.max(0, baseHeight + (Math.random() - 0.5) * 0.15),
          IsApproximateTime: day > 6,
          IsApproximateHeight: day > 6,
          IsPredicted: day > 6,
        });
      }
    };
    
    addEvent(hw1Hour, 'HighWater', hwHeight);
    if (Math.abs(hw2Hour - hw1Hour) > 6 || hw2Hour < hw1Hour) addEvent(hw2Hour, 'HighWater', hwHeight - 0.1);
    addEvent(lw1Hour, 'LowWater', lwHeight);
    if (Math.abs(lw2Hour - lw1Hour) > 6 || lw2Hour < lw1Hour) addEvent(lw2Hour, 'LowWater', lwHeight + 0.1);
  }
  
  return events.sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime));
};

// ===========================================
// UI COMPONENTS
// ===========================================

const TideWave = ({ height = 60, animated = true }) => (
  <svg viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ width: '100%', height: `${height}px`, display: 'block' }}>
    <defs>
      <linearGradient id="waveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="rgba(20, 100, 130, 0.4)" />
        <stop offset="100%" stopColor="rgba(10, 60, 90, 0.8)" />
      </linearGradient>
    </defs>
    <path d="M0,60 C150,90 350,30 600,60 C850,90 1050,30 1200,60 L1200,120 L0,120 Z" fill="url(#waveGradient)" style={animated ? { animation: 'waveMove 8s ease-in-out infinite' } : {}} />
    <path d="M0,80 C200,50 400,110 600,80 C800,50 1000,110 1200,80 L1200,120 L0,120 Z" fill="rgba(15, 80, 110, 0.6)" style={animated ? { animation: 'waveMove 6s ease-in-out infinite reverse' } : {}} />
  </svg>
);

const CompassRose = ({ size = 80 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ opacity: 0.15 }}>
    <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1" />
    <path d="M50,10 L55,45 L50,35 L45,45 Z" fill="currentColor" />
    <path d="M50,90 L55,55 L50,65 L45,55 Z" fill="currentColor" opacity="0.5" />
    <path d="M10,50 L45,45 L35,50 L45,55 Z" fill="currentColor" opacity="0.5" />
    <path d="M90,50 L55,45 L65,50 L55,55 Z" fill="currentColor" opacity="0.5" />
  </svg>
);

const ScrubbingBadge = ({ rating, small = false }) => {
  const config = {
    excellent: { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.2)', label: 'Excellent', icon: '★★★' },
    good: { color: '#84cc16', bg: 'rgba(132, 204, 22, 0.2)', label: 'Good', icon: '★★' },
    fair: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.2)', label: 'Fair', icon: '★' },
    poor: { color: '#64748b', bg: 'rgba(100, 116, 139, 0.2)', label: 'Not Ideal', icon: '—' },
  };
  const { color, bg, label, icon } = config[rating] || config.poor;
  
  if (small) {
    return <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} title={label} />;
  }
  
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: bg, border: `1px solid ${color}40`, color, padding: '4px 10px', borderRadius: '12px', fontFamily: "'Outfit', sans-serif", fontSize: '11px', fontWeight: 500 }}>
      <span>{icon}</span>{label}
    </span>
  );
};

// ===========================================
// MAIN APP COMPONENT
// ===========================================

export default function TidalCalendarApp() {
  const [apiKey] = useState(DEFAULT_API_KEY);
  const [stations, setStations] = useState(DEMO_STATIONS);
  const [selectedStation, setSelectedStation] = useState(null);
  const [tidalEvents, setTidalEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDemo, setIsDemo] = useState(!DEFAULT_API_KEY);
  const [viewMode, setViewMode] = useState('monthly');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [user, setUser] = useState(null);
  const [homePort, setHomePort] = useState('');
  const [homeClub, setHomeClub] = useState('');
  const [currentPage, setCurrentPage] = useState('calendar');
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [alertForm, setAlertForm] = useState({ title: '', dueDate: '', notes: '' });
  const [subscriptionEnd, setSubscriptionEnd] = useState('2025-12-31');
  const SUBSCRIPTION_PRICE_GBP = 5;
  const [clubs, setClubs] = useState([]);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [createClubForm, setCreateClubForm] = useState({ name: '', capacity: 8 });
  
  const [scrubSettings, setScrubSettings] = useState({
    highWaterStart: '06:30',
    highWaterEnd: '09:00',
  });

  const apiRequest = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      let message = 'Request failed';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch { /* ignore */ }
      throw new Error(message);
    }
    return res.status === 204 ? null : res.json();
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const me = await apiRequest('/api/auth/me');
      setUser(me);
      setHomePort(me.home_port_id || '');
      setHomeClub(me.home_club_id || '');
    } catch {
      setUser(null);
    }
  }, [apiRequest]);

  const loadAlerts = useCallback(async () => {
    if (!user) { setAlerts([]); return; }
    try {
      const data = await apiRequest('/api/alerts');
      setAlerts(data);
    } catch (err) {
      console.error(err);
    }
  }, [apiRequest, user]);

  const loadClubs = useCallback(async () => {
    try {
      const data = await apiRequest('/api/clubs');
      setClubs(data);
      if (!selectedClubId && data[0]?.id) setSelectedClubId(data[0].id);
    } catch (err) {
      console.error(err);
    }
  }, [apiRequest, selectedClubId]);

  const fetchStations = useCallback(async () => {
    if (!apiKey) { setStations(DEMO_STATIONS); setIsDemo(true); return; }
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/Stations`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to fetch stations.');
      const data = await response.json();
      const formatted = Array.isArray(data)
        ? data.map(s => ({
            id: s.Id || s.id,
            name: s.Name || s.name,
            country: s.Country || s.country || 'Unknown',
            lat: s.Latitude || s.lat || s.geometry?.coordinates?.[1],
            lon: s.Longitude || s.lon || s.geometry?.coordinates?.[0],
            mhws: 4.5, mhwn: 3.5, mlwn: 1.5, mlws: 0.5,
          }))
        : data.features?.map(f => ({
            id: f.properties.Id, name: f.properties.Name, country: f.properties.Country,
            lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
            mhws: 4.5, mhwn: 3.5, mlwn: 1.5, mlws: 0.5,
          })) || [];
      if (formatted.length === 0) throw new Error('No stations returned from API.');
      setStations(formatted); setIsDemo(false); setError(null);
    } catch (err) { setError(err.message); setStations(DEMO_STATIONS); setIsDemo(true); }
    finally { setLoading(false); }
  }, [apiKey]);

  const fetchTidalEvents = useCallback(async (station) => {
    if (!station) return;
    setLoading(true);
    
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const apiDuration = user?.role === 'subscriber' ? 30 : 7;
    const predictionDays = user?.role === 'subscriber' ? daysInMonth + 7 : 14;
    
    let apiEvents = [];
    if (apiKey && !isDemo) {
      try {
        const response = await fetch(`${API_BASE_URL}/Stations/${station.id}/TidalEvents?duration=${apiDuration}`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error(`TidalEvents fetch failed (${response.status})`);
        apiEvents = await response.json();
      } catch (err) { console.warn('API fetch failed:', err); }
    }
    
    const predictedEvents = predictTidalEvents(station, monthStart, predictionDays);
    const apiDateSet = new Set(apiEvents.map(e => new Date(e.DateTime).toDateString()));
    const merged = [...apiEvents, ...predictedEvents.filter(e => !apiDateSet.has(new Date(e.DateTime).toDateString()))];
    
    setTidalEvents(merged.sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime)));
    setLoading(false);
  }, [apiKey, isDemo, currentMonth, user]);

  useEffect(() => { fetchStations(); }, [fetchStations]);
  useEffect(() => { if (selectedStation) fetchTidalEvents(selectedStation); }, [selectedStation, fetchTidalEvents]);
  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => { loadClubs(); }, [loadClubs]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);
  useEffect(() => {
    if (!user?.home_port_id || stations.length === 0) return;
    const match = stations.find(s => s.id === user.home_port_id);
    if (match) setSelectedStation(match);
  }, [stations, user]);

  const filteredStations = stations.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.country.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const role = user?.role || 'user';
  const subscriptionActive = useMemo(() => {
    const end = new Date(subscriptionEnd);
    return role === 'subscriber' || end.getTime() > Date.now();
  }, [subscriptionEnd, role]);
  const selectedClub = useMemo(() => clubs.find(c => c.id === selectedClubId) || clubs[0], [clubs, selectedClubId]);

  const updateRole = async (nextRole) => {
    try {
      const updated = await apiRequest('/api/profile/role', { method: 'POST', body: JSON.stringify({ role: nextRole }) });
      setUser(updated);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { email, password } = authForm;
    if (!email || !password) { setAuthError('Email and password are required.'); return; }
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const account = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ email, password }) });
      setUser(account);
      setHomePort(account.home_port_id || '');
      setHomeClub(account.home_club_id || '');
      await loadAlerts();
    } catch (err) {
      setAuthError(err.message);
    }
    setAuthForm({ email: '', password: '' });
  };

  const handleSignOut = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setAlerts([]);
  };

  const handleAlertSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    if (!alertForm.title || !alertForm.dueDate) return;
    try {
      const created = await apiRequest('/api/alerts', { method: 'POST', body: JSON.stringify(alertForm) });
      setAlerts(prev => [...prev, created]);
      setAlertForm({ title: '', dueDate: '', notes: '' });
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleDeleteAlert = async (id) => {
    if (!user) return;
    await apiRequest(`/api/alerts/${id}`, { method: 'DELETE' }).catch(() => {});
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handlePurchaseSubscription = () => {
    const nextEnd = new Date();
    nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    setSubscriptionEnd(nextEnd.toISOString().slice(0, 10));
    updateRole('subscriber');
  };

  const handleSaveHomePort = async () => {
    if (!user) return;
    const match = stations.find(s => s.id === homePort);
    if (!match) return;
    try {
      const updated = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ homePortId: homePort, homePortName: match.name }),
      });
      setUser(updated);
      setSelectedStation(match);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleSaveHomeClub = async () => {
    if (!user) return;
    const match = clubs.find(c => c.id === homeClub);
    try {
      const updated = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ homeClubId: homeClub, homeClubName: match?.name || '' }),
      });
      setUser(updated);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleJoinWindow = async (id) => {
    if (!user || !selectedClubId) return;
    try {
      await apiRequest(`/api/clubs/${selectedClubId}/windows/${id}/book`, { method: 'POST' });
      await loadClubs();
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleCreateClub = async (e) => {
    e.preventDefault();
    if (!createClubForm.name || !user) return;
    if (role !== 'club_admin') { setAuthError('Club admin role required to create clubs.'); return; }
    try {
      const created = await apiRequest('/api/clubs', { method: 'POST', body: JSON.stringify(createClubForm) });
      setClubs(prev => [...prev, { ...created, windows: [] }]);
      setSelectedClubId(created.id);
      setCreateClubForm({ name: '', capacity: 8 });
    } catch (err) {
      setAuthError(err.message);
    }
  };

  // Analyse scrubbing suitability
  const scrubbingByDate = useMemo(() => {
    if (tidalEvents.length === 0) return {};
    
    const [startHour, startMin] = scrubSettings.highWaterStart.split(':').map(Number);
    const [endHour, endMin] = scrubSettings.highWaterEnd.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    const eventsByDate = {};
    tidalEvents.forEach(event => {
      const date = new Date(event.DateTime).toDateString();
      if (!eventsByDate[date]) eventsByDate[date] = [];
      eventsByDate[date].push(event);
    });
    
    const results = {};
    
    Object.entries(eventsByDate).forEach(([dateStr, events]) => {
      const highWaters = events.filter(e => e.EventType === 'HighWater');
      const lowWaters = events.filter(e => e.EventType === 'LowWater');
      
      highWaters.forEach(hw => {
        const hwDate = new Date(hw.DateTime);
        const hwMinutes = hwDate.getHours() * 60 + hwDate.getMinutes();
        
        if (hwMinutes >= startMinutes && hwMinutes <= endMinutes) {
          const followingLow = lowWaters.find(lw => new Date(lw.DateTime) > hwDate);
          const allHighs = tidalEvents.filter(e => e.EventType === 'HighWater');
          const nextHigh = allHighs.find(h => new Date(h.DateTime) > hwDate && new Date(h.DateTime).toDateString() !== hwDate.toDateString() || (new Date(h.DateTime) > hwDate && new Date(h.DateTime).getTime() - hwDate.getTime() > 6 * 60 * 60 * 1000));
          
          if (followingLow) {
            const tidalRange = hw.Height - followingLow.Height;
            const refloatTime = nextHigh ? new Date(nextHigh.DateTime) : null;
            const refloatBeforeEvening = refloatTime ? refloatTime.getHours() < 20 : true;
            
            let rating = 'fair';
            if (tidalRange >= 4.5 && refloatBeforeEvening) rating = 'excellent';
            else if (tidalRange >= 3.5 && refloatBeforeEvening) rating = 'good';
            
            if (!results[dateStr] || (rating === 'excellent' || (rating === 'good' && results[dateStr].rating !== 'excellent'))) {
              results[dateStr] = {
                rating,
                highWater: hw,
                lowWater: followingLow,
                nextHighWater: nextHigh,
                tidalRange,
                hwTime: hwDate,
                lwTime: new Date(followingLow.DateTime),
                refloatTime,
              };
            }
          }
        }
      });
    });
    
    return results;
  }, [tidalEvents, scrubSettings]);

  // Calendar helpers
  const getMonthData = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days = [];
    for (let i = 0; i < startPadding; i++) {
      const d = new Date(year, month, -startPadding + i + 1);
      days.push({ date: d, isCurrentMonth: false });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }
    return days;
  };

  const formatTime = (dateOrString) => {
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const eventsByDay = useMemo(() => {
    const grouped = {};
    tidalEvents.forEach(event => {
      const date = new Date(event.DateTime).toDateString();
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(event);
    });
    return grouped;
  }, [tidalEvents]);

  const navigateMonth = (delta) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
    setSelectedDay(null);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #f7fafc 0%, #eef2f7 40%, #e5ecf5 100%)', color: '#0f172a', fontFamily: "'Outfit', sans-serif", position: 'relative', overflow: 'hidden' }}>
      
      {/* Background */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: `radial-gradient(800px 800px at 20% 20%, rgba(56, 189, 248, 0.08), transparent), radial-gradient(600px 600px at 80% 10%, rgba(34, 197, 94, 0.06), transparent)`, pointerEvents: 'none', zIndex: 0 }} />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Outfit:wght@300;400;500&display=swap');
        @keyframes waveMove { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-25px); } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        .station-card:hover { transform: translateY(-2px); background: rgba(56, 189, 248, 0.15) !important; border-color: rgba(56, 189, 248, 0.4) !important; }
        .day-cell:hover { background: rgba(56, 189, 248, 0.1) !important; }
        .view-btn:hover { background: rgba(56, 189, 248, 0.2) !important; }
        input::placeholder { color: rgba(148, 163, 184, 0.6); }
        ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.5); } ::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 4px; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'relative', padding: '40px 24px 80px', textAlign: 'center', zIndex: 10 }}>
        <div style={{ position: 'absolute', top: '20px', right: '24px' }}><CompassRose size={60} /></div>
        
        <div style={{ animation: 'fadeInUp 0.8s ease-out' }}>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '4px', textTransform: 'uppercase', color: '#0ea5e9', marginBottom: '12px' }}>UK Admiralty Tidal API</p>
          <h1 style={{ fontSize: 'clamp(36px, 8vw, 64px)', fontWeight: 400, letterSpacing: '2px', margin: '0 0 16px', background: 'linear-gradient(135deg, #0f172a 0%, #0ea5e9 60%, #0f172a 100%)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 4s linear infinite' }}>Tidal Calendar</h1>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#475569', maxWidth: '500px', margin: '0 auto 24px' }}>Monthly view • Harmonic predictions • Boat scrubbing planner</p>
          
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#15803d', padding: '8px 16px', borderRadius: '20px', fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '1px' }}>
            ✓ Live API Connected
          </span>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}><TideWave height={80} /></div>
      </header>

      {/* Main */}
      <main style={{ position: 'relative', zIndex: 10, padding: '0 24px 60px', maxWidth: '1400px', margin: '0 auto' }}>
        {error && <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#fca5a5' }}>⚠ {error}</div>}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
          {['calendar', 'profile'].map(page => (
            <button key={page} onClick={() => setCurrentPage(page)} style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(14,165,233,0.25)', background: currentPage === page ? '#e0f2fe' : '#ffffff', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", letterSpacing: '1px', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
              {page === 'calendar' ? 'Calendar' : 'Profile'}
            </button>
          ))}
        </div>

        {currentPage === 'profile' ? (
          <section style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '20px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Profile</h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setAuthMode('signin')} style={{ padding: '6px 10px', background: authMode === 'signin' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign In</button>
                  <button onClick={() => setAuthMode('signup')} style={{ padding: '6px 10px', background: authMode === 'signup' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign Up</button>
                </div>
              </div>

              {!user ? (
                <form onSubmit={handleAuthSubmit} style={{ display: 'grid', gap: '10px' }}>
                  <input type="email" placeholder="Email" value={authForm.email} onChange={(e) => setAuthForm(f => ({ ...f, email: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                  <input type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm(f => ({ ...f, password: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                  {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                  <button type="submit" style={{ padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.3)' }}>{authMode === 'signup' ? 'Create Account' : 'Sign In'}</button>
                </form>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                  <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>Signed in as</div>
                  <div style={{ fontSize: '13px', color: '#334155' }}>{user.email}</div>
                  <div style={{ marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#ecfeff', border: '1px solid #bae6fd', borderRadius: '10px', color: '#0f172a', fontSize: '12px', fontWeight: 600 }}>
                    Role: {role === 'subscriber' ? 'Subscriber (extended data)' : role === 'club_admin' ? 'Club Admin' : 'User (7-day view)'}
                  </div>
                </div>
                <button onClick={handleSignOut} style={{ padding: '10px 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>Sign Out</button>
              </div>
              )}

              {user && (
                <div style={{ marginTop: '16px', padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', display: 'grid', gap: '10px', boxShadow: '0 4px 12px rgba(15,23,42,0.06)' }}>
                  <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Home Port (default after sign-in)</div>
                  <select value={homePort} onChange={(e) => setHomePort(e.target.value)} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }}>
                    <option value="">Select a station</option>
                    {stations.map(s => <option key={s.id} value={s.id}>{s.name} — {s.country}</option>)}
                  </select>
                  <button onClick={handleSaveHomePort} style={{ padding: '10px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.3)' }}>Save Home Port</button>
                  {user.home_port_name && <div style={{ fontSize: '12px', color: '#334155' }}>Current home port: <strong style={{ color: '#0f172a' }}>{user.home_port_name}</strong></div>}
                  <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600, marginTop: '8px' }}>Home Club</div>
                  <select value={homeClub} onChange={(e) => setHomeClub(e.target.value)} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }}>
                    <option value="">Select a club</option>
                    {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={handleSaveHomeClub} style={{ padding: '10px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.3)' }}>Save Home Club</button>
                  {user.home_club_name && <div style={{ fontSize: '12px', color: '#334155' }}>Current home club: <strong style={{ color: '#0f172a' }}>{user.home_club_name}</strong></div>}
                  <div style={{ fontSize: '12px', color: '#334155' }}>Subscription active until <strong style={{ color: '#0f172a' }}>{new Date(subscriptionEnd).toLocaleDateString('en-GB')}</strong></div>
                  <div style={{ display: 'grid', gap: '8px', padding: '10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Subscription plan</div>
                    <div style={{ fontSize: '12px', color: '#334155' }}>£{SUBSCRIPTION_PRICE_GBP} / year • billed via Tide when enabled</div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>Tide payment integration will go here (client placeholder only).</div>
                    <button onClick={handlePurchaseSubscription} disabled={role === 'subscriber'} style={{ padding: '10px', background: role === 'subscriber' ? '#dcfce7' : '#22c55e', border: '1px solid #16a34a', borderRadius: '8px', color: role === 'subscriber' ? '#166534' : '#ffffff', cursor: role === 'subscriber' ? 'not-allowed' : 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
                      {role === 'subscriber' ? 'Subscriber active' : `Pay £${SUBSCRIPTION_PRICE_GBP} via Tide (mock)`}
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: '8px', padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Tidal station</div>
                    <div style={{ position: 'relative' }}>
                      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search stations..." style={{ width: '100%', padding: '12px 14px 12px 42px', background: '#ffffff', border: '1px solid rgba(15,23,42,0.1)', borderRadius: '10px', color: '#0f172a', fontSize: '14px', fontFamily: "'Outfit', sans-serif" }} />
                      <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', opacity: 0.35 }}>⚓</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                      {filteredStations.slice(0, 16).map(station => (
                        <button key={station.id} className="station-card" onClick={() => setSelectedStation(station)} style={{ background: selectedStation?.id === station.id ? '#e0f2fe' : '#ffffff', border: `1px solid ${selectedStation?.id === station.id ? '#0ea5e9' : '#cbd5e1'}`, borderRadius: '10px', padding: '12px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.3s ease', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '2px' }}>{station.name}</div>
                          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#475569', letterSpacing: '1px', textTransform: 'uppercase' }}>{station.country}</div>
                        </button>
                      ))}
                    </div>
                    {!selectedStation && <div style={{ fontSize: '12px', color: '#475569' }}>Select a station to view the calendar.</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => updateRole('club_admin')} disabled={role === 'club_admin'} style={{ padding: '10px 14px', background: role === 'club_admin' ? '#e0f2fe' : '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: role === 'club_admin' ? '#075985' : '#ffffff', cursor: role === 'club_admin' ? 'not-allowed' : 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>
                      {role === 'club_admin' ? 'Club admin enabled' : 'Enable club admin'}
                    </button>
                    <span style={{ fontSize: '12px', color: '#475569' }}>Club admins can create clubs and manage scrub windows.</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Maintenance Alerts</h3>
                <span style={{ fontSize: '12px', color: '#334155' }}>{alerts.length} scheduled</span>
              </div>
              {user ? (
                <>
                  <form onSubmit={handleAlertSubmit} style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
                    <input type="text" placeholder="Task (e.g., Scrub hull)" value={alertForm.title} onChange={(e) => setAlertForm(f => ({ ...f, title: e.target.value }))} style={{ padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                    <input type="datetime-local" value={alertForm.dueDate} onChange={(e) => setAlertForm(f => ({ ...f, dueDate: e.target.value }))} style={{ padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                    <textarea placeholder="Notes (tools, crew, conditions...)" value={alertForm.notes} onChange={(e) => setAlertForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ padding: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px', resize: 'vertical', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }} />
                    <button type="submit" style={{ padding: '10px', background: '#22c55e', border: '1px solid #16a34a', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>Add Alert</button>
                  </form>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                    {alerts.length === 0 && <div style={{ fontSize: '13px', color: '#334155' }}>No alerts yet. Create one to nudge yourself before scrubbing or maintenance.</div>}
                    {alerts.map(a => (
                      <div key={a.id} style={{ padding: '10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', gap: '10px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                        <div>
                          <div style={{ fontSize: '13px', color: '#0f172a', marginBottom: '2px', fontWeight: 600 }}>{a.title}</div>
                          <div style={{ fontSize: '12px', color: '#334155' }}>{a.dueDate ? new Date(a.dueDate).toLocaleString('en-GB') : ''}</div>
                          {a.notes && <div style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>{a.notes}</div>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                          <button onClick={() => handleDeleteAlert(a.id)} style={{ alignSelf: 'flex-start', padding: '6px 8px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>Remove</button>
                          {a.dueDate && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <a
                                href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.title || 'Maintenance')}&details=${encodeURIComponent(a.notes || '')}&dates=${new Date(a.dueDate).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}/${new Date(new Date(a.dueDate).getTime() + 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ padding: '6px 8px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', fontSize: '11px', textDecoration: 'none', fontWeight: 600 }}
                              >
                                Add to Gmail
                              </a>
                              <a
                                href={`https://outlook.live.com/calendar/0/action/compose?subject=${encodeURIComponent(a.title || 'Maintenance')}&body=${encodeURIComponent(a.notes || '')}&startdt=${encodeURIComponent(new Date(a.dueDate).toISOString())}&enddt=${encodeURIComponent(new Date(new Date(a.dueDate).getTime() + 60 * 60 * 1000).toISOString())}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ padding: '6px 8px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', fontSize: '11px', textDecoration: 'none', fontWeight: 600 }}
                              >
                                Add to Outlook
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#334155' }}>Sign in to create scrubbing and maintenance alerts.</div>
              )}
            </div>
          </section>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Calendar & Detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Station Content */}
              {selectedStation && (
                <section style={{ animation: 'fadeInUp 0.6s ease-out' }}>
                  {/* Station Header */}
                  <div style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #f8fafc 100%)', border: '1px solid rgba(14,165,233,0.25)', borderRadius: '20px', padding: '24px 28px', marginBottom: '24px', boxShadow: '0 10px 30px rgba(15,23,42,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <h2 style={{ fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 500, margin: '0 0 4px', color: '#0f172a' }}>{selectedStation.name}</h2>
                        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#475569', margin: 0 }}>Station {selectedStation.id} • {selectedStation.country}</p>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px', background: 'rgba(14,165,233,0.08)', padding: '4px', borderRadius: '12px' }}>
                        {['monthly', 'scrubbing'].map(mode => (
                          <button key={mode} className="view-btn" onClick={() => setViewMode(mode)} style={{ padding: '10px 18px', background: viewMode === mode ? '#0ea5e9' : 'transparent', border: 'none', borderRadius: '8px', color: viewMode === mode ? '#ffffff' : '#475569', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '12px', fontWeight: 600, transition: 'all 0.3s' }}>
                            {mode === 'monthly' ? '📅 Monthly' : '🧽 Scrubbing'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 6px 16px rgba(15,23,42,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, color: '#0f172a', fontWeight: 600 }}>Clubs</h4>
                  <span style={{ fontSize: '11px', color: '#475569' }}>Manage home club here</span>
                </div>
                <form onSubmit={handleCreateClub} style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
                  <input type="text" value={createClubForm.name} onChange={(e) => setCreateClubForm(f => ({ ...f, name: e.target.value }))} placeholder="Club name" style={{ padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', background: '#ffffff' }} />
                  <input type="number" min="1" value={createClubForm.capacity} onChange={(e) => setCreateClubForm(f => ({ ...f, capacity: e.target.value }))} placeholder="Capacity per window" style={{ padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', background: '#ffffff' }} />
                  <button type="submit" disabled={role !== 'club_admin'} style={{ padding: '10px', background: role === 'club_admin' ? '#0ea5e9' : '#e2e8f0', border: '1px solid #0284c7', borderRadius: '8px', color: role === 'club_admin' ? '#ffffff' : '#94a3b8', cursor: role === 'club_admin' ? 'pointer' : 'not-allowed', fontWeight: 700 }}>Create club (admin only)</button>
                </form>
                {role !== 'club_admin' && <div style={{ fontSize: '12px', color: '#b45309', fontWeight: 600 }}>Enable club admin in Profile to create clubs.</div>}
                <label style={{ display: 'grid', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Select club</span>
                  <select value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', background: '#ffffff' }}>
                    {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>

              <ClubDashboard clubName={selectedClub?.name || 'Club'} windows={selectedClub?.windows || []} onJoinWindow={handleJoinWindow} />
            </div>
          </section>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Calendar & Detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Station Content */}
              {selectedStation && (
                <section style={{ animation: 'fadeInUp 0.6s ease-out' }}>
                  {/* Station Header */}
                  <div style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #f8fafc 100%)', border: '1px solid rgba(14,165,233,0.25)', borderRadius: '20px', padding: '24px 28px', marginBottom: '24px', boxShadow: '0 10px 30px rgba(15,23,42,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <h2 style={{ fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 500, margin: '0 0 4px', color: '#0f172a' }}>{selectedStation.name}</h2>
                        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#475569', margin: 0 }}>Station {selectedStation.id} • {selectedStation.country}</p>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px', background: 'rgba(14,165,233,0.08)', padding: '4px', borderRadius: '12px' }}>
                        {['monthly', 'scrubbing'].map(mode => (
                          <button key={mode} className="view-btn" onClick={() => setViewMode(mode)} style={{ padding: '10px 18px', background: viewMode === mode ? '#0ea5e9' : 'transparent', border: 'none', borderRadius: '8px', color: viewMode === mode ? '#ffffff' : '#475569', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '12px', fontWeight: 600, transition: 'all 0.3s' }}>
                            {mode === 'monthly' ? '📅 Monthly' : '🧽 Scrubbing'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Scrubbing Settings */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', boxShadow: '0 6px 16px rgba(15,23,42,0.06)' }}>
                    <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#0f172a' }}>High Water Window:</span>
                    <input type="time" value={scrubSettings.highWaterStart} onChange={(e) => setScrubSettings(s => ({ ...s, highWaterStart: e.target.value }))} style={{ padding: '8px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0f172a', fontFamily: "'Outfit', sans-serif", fontSize: '13px' }} />
                    <span style={{ color: '#334155' }}>to</span>
                    <input type="time" value={scrubSettings.highWaterEnd} onChange={(e) => setScrubSettings(s => ({ ...s, highWaterEnd: e.target.value }))} style={{ padding: '8px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#0f172a', fontFamily: "'Outfit', sans-serif", fontSize: '13px' }} />
                    
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center', fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#0f172a' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} />Excellent</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#84cc16' }} />Good</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#eab308' }} />Fair</span>
                    </div>
                  </div>

            {loading && (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid rgba(56, 189, 248, 0.2)', borderTopColor: '#38bdf8', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <span style={{ fontFamily: "'Outfit', sans-serif", color: '#64748b' }}>Loading tidal predictions...</span>
              </div>
            )}

            {/* MONTHLY VIEW */}
            {!loading && viewMode === 'monthly' && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', marginBottom: '24px', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' }}>
                {/* Month Navigation */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <button onClick={() => navigateMonth(-1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600 }}>← Previous</button>
                  
                  <div style={{ textAlign: 'center' }}>
                    <h3 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px', color: '#0f172a' }}>{currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155', margin: 0 }}>
                      {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).icon} {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).name} mid-month
                    </p>
                  </div>
                  
                  <button onClick={() => navigateMonth(1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600 }}>Next →</button>
                </div>

                {/* Calendar Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '8px' }}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontFamily: "'Outfit', sans-serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: '#475569' }}>{day}</div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
                  {getMonthData().map(({ date, isCurrentMonth }, i) => {
                    const dateStr = date.toDateString();
                    const dayEvents = eventsByDay[dateStr] || [];
                    const scrubData = scrubbingByDate[dateStr];
                    const isToday = new Date().toDateString() === dateStr;
                    const isSelected = selectedDay?.toDateString() === dateStr;
                    const moonPhase = getMoonPhaseName(date);
                    const isPredicted = dayEvents.some(e => e.IsPredicted);
                    
                    return (
                      <div
                        key={i}
                        className="day-cell"
                        onClick={() => setSelectedDay(isCurrentMonth ? date : null)}
                        style={{
                          background: isSelected ? '#e0f2fe' : '#ffffff',
                          border: `1px solid ${isSelected ? '#0ea5e9' : isToday ? '#94a3b8' : '#e2e8f0'}`,
                          borderRadius: '10px',
                          padding: '10px 8px',
                          minHeight: '90px',
                          opacity: isCurrentMonth ? 1 : 0.4,
                          cursor: isCurrentMonth ? 'pointer' : 'default',
                          transition: 'all 0.2s ease',
                          position: 'relative',
                          boxShadow: '0 2px 10px rgba(15,23,42,0.05)',
                        }}
                      >
                        {/* Date Number */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: isToday ? 700 : 500, color: isToday ? '#0ea5e9' : '#0f172a' }}>{date.getDate()}</span>
                          {(moonPhase.isSpring || moonPhase.name.includes('Quarter')) && (
                            <span style={{ fontSize: '12px', color: '#0f172a' }} title={moonPhase.name}>{moonPhase.icon}</span>
                          )}
                        </div>

                        {/* Scrubbing indicator */}
                        {scrubData && (
                          <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                            <ScrubbingBadge rating={scrubData.rating} small />
                          </div>
                        )}

                        {/* Tide times */}
                        {isCurrentMonth && dayEvents.length > 0 && (
                          <div style={{ fontSize: '10px', fontFamily: "'Outfit', sans-serif", color: '#334155', lineHeight: 1.5 }}>
                            {dayEvents.slice(0, 4).map((e, j) => (
                              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: e.IsPredicted ? 0.7 : 1 }}>
                                <span style={{ color: e.EventType === 'HighWater' ? '#0ea5e9' : '#64748b' }}>{e.EventType === 'HighWater' ? '▲' : '▼'}</span>
                                <span>{formatTime(e.DateTime)}</span>
                                <span style={{ color: '#475569' }}>{e.Height?.toFixed(1)}m</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Data source indicator */}
                        {isCurrentMonth && (
                          <div style={{ position: 'absolute', bottom: '4px', right: '6px', fontFamily: "'Outfit', sans-serif", fontSize: '8px', color: subscriptionActive ? '#0ea5e9' : '#b45309', opacity: 0.9 }}>
                            {subscriptionActive ? 'UKHO' : (isPredicted ? 'pred' : 'API')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center' }}>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#0ea5e9' }}>▲</span> High Water
                    <span style={{ color: '#475569', marginLeft: '8px' }}>▼</span> Low Water
                  </div>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '8px', padding: '2px 6px', background: '#fef3c7', borderRadius: '4px', color: '#b45309' }}>pred</span> Algorithmically predicted (beyond 7-day API)
                  </div>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#334155' }}>
                    🌑🌕 = Spring tides (larger range) • 🌓🌗 = Neap tides (smaller range)
                  </div>
                </div>
              </div>
            )}

            {/* Selected Day Detail */}
            {!loading && selectedDay && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', marginBottom: '24px', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                  <div>
                    <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 4px', color: '#0f172a' }}>{selectedDay.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#334155', margin: 0 }}>
                      {getMoonPhaseName(selectedDay).icon} {getMoonPhaseName(selectedDay).name} • {subscriptionActive ? 'UKHO data' : (eventsByDay[selectedDay.toDateString()]?.some(e => e.IsPredicted) ? 'Predicted' : 'API Data')}
                    </p>
                  </div>
                  {scrubbingByDate[selectedDay.toDateString()] && <ScrubbingBadge rating={scrubbingByDate[selectedDay.toDateString()].rating} />}
                </div>

                {/* Tide Events */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  {(eventsByDay[selectedDay.toDateString()] || []).map((event, i) => {
                    const isHigh = event.EventType === 'HighWater';
                    return (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', borderLeft: `3px solid ${isHigh ? '#0ea5e9' : '#64748b'}`, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: isHigh ? '#0ea5e9' : '#475569', marginBottom: '4px', fontWeight: 600 }}>{isHigh ? '↑ High Water' : '↓ Low Water'}</div>
                        <div style={{ fontSize: '28px', fontWeight: 600, marginBottom: '4px', color: '#0f172a' }}>{formatTime(event.DateTime)}</div>
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#334155' }}>{event.Height?.toFixed(2)}m</div>
                        {event.IsPredicted && !subscriptionActive && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#b45309', marginTop: '8px' }}>⚠ Predicted (harmonic algorithm)</div>}
                        {subscriptionActive && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#0ea5e9', marginTop: '8px' }}>UKHO data (subscription)</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Scrubbing Info */}
                {scrubbingByDate[selectedDay.toDateString()] && (
                  <div style={{ marginTop: '20px', padding: '16px', background: '#ecfdf3', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                    <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', fontWeight: 600, color: '#15803d', margin: '0 0 12px' }}>🧽 Scrubbing Schedule</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#0f172a' }}>
                      <div><span style={{ color: '#475569' }}>Beach at:</span> <strong>{formatTime(scrubbingByDate[selectedDay.toDateString()].hwTime)}</strong></div>
                      <div><span style={{ color: '#475569' }}>Work at:</span> <strong>{formatTime(scrubbingByDate[selectedDay.toDateString()].lwTime)}</strong></div>
                      {scrubbingByDate[selectedDay.toDateString()].refloatTime && <div><span style={{ color: '#475569' }}>Refloat at:</span> <strong>{formatTime(scrubbingByDate[selectedDay.toDateString()].refloatTime)}</strong></div>}
                      <div><span style={{ color: '#475569' }}>Tidal Range:</span> <strong>{scrubbingByDate[selectedDay.toDateString()].tidalRange.toFixed(1)}m</strong></div>
                    </div>
                    <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        disabled={!user}
                        onClick={() => { if (!user) return; const nextAlerts = [...alerts, { id: Date.now(), title: `Scrub boat - ${selectedDay.toDateString()}`, dueDate: scrubbingByDate[selectedDay.toDateString()].lwTime?.toISOString?.() || '', notes: 'Added from scrubbing schedule' }]; setAlerts(nextAlerts); if (user?.email) persistAlerts(user.email, nextAlerts); }}
                        style={{
                          padding: '10px 14px',
                          background: user ? '#22c55e' : '#e2e8f0',
                          border: `1px solid ${user ? '#16a34a' : '#cbd5e1'}`,
                          borderRadius: '8px',
                          color: user ? '#ffffff' : '#94a3b8',
                          cursor: user ? 'pointer' : 'not-allowed',
                          fontWeight: 700,
                          boxShadow: user ? '0 4px 12px rgba(34,197,94,0.3)' : 'none'
                        }}
                      >
                        Add to maintenance log
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SCRUBBING LIST VIEW */}
            {!loading && viewMode === 'scrubbing' && (
              <div>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>
                  Suitable Scrubbing Days in {currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                </h3>
                
                {Object.keys(scrubbingByDate).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 6px 16px rgba(15,23,42,0.06)' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#334155' }}>No suitable dates found this month. Try adjusting the time window.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {Object.entries(scrubbingByDate)
                      .sort((a, b) => { const order = { excellent: 0, good: 1, fair: 2 }; return order[a[1].rating] - order[b[1].rating] || new Date(a[0]) - new Date(b[0]); })
                      .map(([dateStr, data], i) => {
                        const date = new Date(dateStr);
                        const isPredicted = data.highWater.IsPredicted;
                        
                        return (
                          <div key={i} onClick={() => { setSelectedDay(date); setViewMode('monthly'); }} style={{
                            background: '#ffffff',
                            border: `1px solid ${data.rating === 'excellent' ? '#22c55e' : data.rating === 'good' ? '#84cc16' : '#cbd5e1'}`,
                            borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'all 0.3s', boxShadow: '0 4px 12px rgba(15,23,42,0.06)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                              <div>
                                <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '4px', color: '#0f172a' }}>{date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                                <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155' }}>
                                  HW {formatTime(data.hwTime)} • LW {formatTime(data.lwTime)} • Range {data.tidalRange.toFixed(1)}m
                                  {subscriptionActive ? <span style={{ color: '#0ea5e9', marginLeft: '8px' }}>• UKHO</span> : (isPredicted && <span style={{ color: '#b45309', marginLeft: '8px' }}>• Predicted</span>)}
                                </div>
                              </div>
                              <ScrubbingBadge rating={data.rating} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {currentPage === 'calendar' && !selectedStation && (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>🌊</div>
            <h3 style={{ fontSize: '24px', fontWeight: 400, marginBottom: '12px' }}>Select a Tidal Station</h3>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px', color: '#64748b', maxWidth: '400px', margin: '0 auto' }}>Choose a station to view monthly tide times and find the best days for scrubbing your boat.</p>
          </div>
        )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ position: 'relative', zIndex: 10, padding: '40px 24px', textAlign: 'center', borderTop: '1px solid rgba(56, 189, 248, 0.1)' }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569', margin: '0 0 8px' }}>
          API data from <a href="https://admiraltyapi.portal.azure-api.net" target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8' }}>UK Hydrographic Office</a> • Extended predictions use harmonic algorithms (M2/S2 constituents)
        </p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#334155', margin: 0 }}>© Crown Copyright. All times GMT/UTC. Heights in metres above Chart Datum. Predictions beyond 7 days are estimates.</p>
      </footer>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 5 }}><TideWave height={100} /></div>
    </div>
  );
}
