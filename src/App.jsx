import React, { useState, useEffect, useCallback, useMemo } from 'react';

// UK Admiralty Tidal API Configuration
const API_BASE_URL = '/api';
const DEFAULT_API_KEY = 'baec423358314e4e8f527980f959295d';
const WEATHER_API_BASE_URL = 'https://api.weatherapi.com/v1';
const WEATHER_API_KEY = '34c6cb97a9cb4f0c89e85256261401';
const LOCAL_HOME_PORT_KEY = 'tidal-calendar-home-port';

const parseEmbedConfig = () => {
  if (typeof window === 'undefined') {
    return { enabled: false, stationId: '', view: 'monthly', theme: 'light', accent: '#0ea5e9', compact: false };
  }

  const params = new URLSearchParams(window.location.search);
  const flag = (params.get('embed') || params.get('widget') || '').toLowerCase();
  const enabled = ['1', 'true', 'yes', 'y'].includes(flag);
  const stationId = params.get('station') || params.get('stationId') || '';
  const view = params.get('view') === 'scrubbing' ? 'scrubbing' : 'monthly';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const accent = params.get('accent') || '#0ea5e9';
  const compact = ['1', 'true', 'yes', 'y'].includes((params.get('compact') || '').toLowerCase());

  return { enabled, stationId, view, theme, accent, compact };
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
  const isPredictedSource = true;
  
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
        const isLongRange = day > 6;
        time.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
        events.push({
          EventType: type,
          DateTime: time.toISOString(),
          Height: Math.max(0, baseHeight + (Math.random() - 0.5) * 0.15),
          IsApproximateTime: isLongRange,
          IsApproximateHeight: isLongRange,
          IsPredicted: isPredictedSource,
          Source: 'Predicted',
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
  const [embedConfig] = useState(() => parseEmbedConfig());
  const isEmbed = embedConfig.enabled;
  const accentColor = embedConfig.accent || '#0ea5e9';
  const primaryText = embedConfig.theme === 'dark' ? '#e2e8f0' : '#0f172a';
  const secondaryText = embedConfig.theme === 'dark' ? '#cbd5e1' : '#475569';
  const surfaceColor = embedConfig.theme === 'dark' ? '#0b1220' : '#ffffff';
  const backgroundColor = embedConfig.theme === 'dark' ? '#0b1220' : 'linear-gradient(180deg, #f7fafc 0%, #eef2f7 40%, #e5ecf5 100%)';

  const [apiKey] = useState(DEFAULT_API_KEY);
  const [stations, setStations] = useState(DEMO_STATIONS);
  const [selectedStation, setSelectedStation] = useState(null);
  const [tidalEvents, setTidalEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDemo, setIsDemo] = useState(!DEFAULT_API_KEY);
  const [viewMode, setViewMode] = useState(embedConfig.view || 'monthly');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [user, setUser] = useState(null);
  const [homePort, setHomePort] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [adminForm, setAdminForm] = useState({ id: null, email: '', password: '', role: 'user', subscriptionStatus: 'inactive', subscriptionPeriodEnd: '' });
  const [adminError, setAdminError] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState('calendar');
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');
  const [subscriptionNotice, setSubscriptionNotice] = useState('');
  const SUBSCRIPTION_PRICE_GBP = 5;

  const [maintenanceLogs, setMaintenanceLogs] = useState([]);
  const [maintenanceForm, setMaintenanceForm] = useState({ date: '', activityType: 'planned', title: '', notes: '', completed: false });
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintenanceReminderStatus, setMaintenanceReminderStatus] = useState(null);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [editingMaintenance, setEditingMaintenance] = useState(null);
  
  const [scrubSettings, setScrubSettings] = useState({
    highWaterStart: '04:30',
    highWaterEnd: '09:00',
  });
  const [scrubModal, setScrubModal] = useState(null);
  const [weatherForecast, setWeatherForecast] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const role = user?.role || 'user';
  const roleLabel = useMemo(() => {
    if (role === 'subscriber') return 'Subscriber (extended data)';
    if (role === 'admin') return 'Admin';
    if (role === 'club_admin') return 'Club admin';
    return 'User (7-day view)';
  }, [role]);
  const pages = useMemo(() => {
    const base = ['calendar', 'profile', 'about'];
    if (user?.role === 'admin') base.push('admin');
    return base;
  }, [user]);
  const subscriptionEndLabel = subscriptionEnd && !Number.isNaN(new Date(subscriptionEnd).getTime())
    ? new Date(subscriptionEnd).toLocaleDateString('en-GB')
    : 'Not set';
  const hasUkhoAccess = useMemo(() => {
    if (!user) return false;
    const end = subscriptionEnd ? new Date(subscriptionEnd) : null;
    return role === 'subscriber' && end && !Number.isNaN(end.getTime()) && end.getTime() > Date.now();
  }, [subscriptionEnd, role, user]);

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
    } catch {
      setUser(null);
    }
  }, [apiRequest]);

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
    const apiDuration = hasUkhoAccess ? daysInMonth + 7 : 7;
    const predictionDays = daysInMonth + 7;
    
    let apiEvents = [];
    if (apiKey && !isDemo) {
      try {
        const response = await fetch(`${API_BASE_URL}/Stations/${station.id}/TidalEvents?duration=${apiDuration}`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error(`TidalEvents fetch failed (${response.status})`);
        const rawApiEvents = await response.json();
        apiEvents = (Array.isArray(rawApiEvents) ? rawApiEvents : [])
          .map(event => ({
            ...event,
            IsPredicted: false,
            Source: 'UKHO',
          }));
      } catch (err) { console.warn('API fetch failed:', err); }
    }
    
    const predictedEvents = predictTidalEvents(station, monthStart, predictionDays);
    const apiDateSet = new Set(apiEvents.map(e => new Date(e.DateTime).toDateString()));
    const merged = [...apiEvents, ...predictedEvents.filter(e => !apiDateSet.has(new Date(e.DateTime).toDateString()))];
    
    setTidalEvents(merged.sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime)));
    setLoading(false);
  }, [apiKey, isDemo, currentMonth, hasUkhoAccess]);

  const persistHomePortSelection = useCallback((portId) => {
    if (typeof window === 'undefined') return;
    if (!portId) {
      window.localStorage.removeItem(LOCAL_HOME_PORT_KEY);
      return;
    }
    window.localStorage.setItem(LOCAL_HOME_PORT_KEY, portId);
  }, []);

  useEffect(() => { fetchStations(); }, [fetchStations]);
  useEffect(() => { if (selectedStation) fetchTidalEvents(selectedStation); }, [selectedStation, fetchTidalEvents]);
  useEffect(() => { loadSession(); }, [loadSession]);
  useEffect(() => {
    if (isEmbed || typeof window === 'undefined' || stations.length === 0) return;
    if (user?.home_port_id) {
      setHomePort(user.home_port_id);
      const match = stations.find(s => s.id === user.home_port_id);
      if (match) setSelectedStation(match);
      persistHomePortSelection(user.home_port_id);
      return;
    }
    const stored = window.localStorage.getItem(LOCAL_HOME_PORT_KEY);
    if (stored) {
      setHomePort(stored);
      const match = stations.find(s => s.id === stored);
      if (match) setSelectedStation(match);
    } else if (!selectedStation && stations.length > 0) {
      setSelectedStation(stations[0]);
    }
  }, [stations, user, selectedStation, persistHomePortSelection, isEmbed]);

  useEffect(() => {
    if (isEmbed) return;
    if (homePort) persistHomePortSelection(homePort);
  }, [homePort, persistHomePortSelection, isEmbed]);

  useEffect(() => {
    if (!isEmbed || stations.length === 0) return;
    const match = stations.find(s => s.id === embedConfig.stationId) || stations.find(s => s.name.toLowerCase() === embedConfig.stationId.toLowerCase());
    const fallback = match || stations[0];
    if (fallback) {
      setHomePort(fallback.id);
      setSelectedStation(fallback);
    }
  }, [embedConfig.stationId, isEmbed, stations]);

  useEffect(() => {
    if (isEmbed) setCurrentPage('calendar');
  }, [isEmbed]);

  useEffect(() => {
    if (isEmbed && embedConfig.view) setViewMode(embedConfig.view);
  }, [embedConfig.view, isEmbed]);

  const filteredStations = stations.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.country.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    if (user?.subscription_period_end) {
      setSubscriptionEnd(user.subscription_period_end);
    } else if (!user) {
      setSubscriptionEnd('');
    }
  }, [user]);

  const updateRole = async (nextRole) => {
    try {
      const updated = await apiRequest('/api/profile/role', { method: 'POST', body: JSON.stringify({ role: nextRole }) });
      setUser(updated);
      if (updated?.subscription_period_end) setSubscriptionEnd(updated.subscription_period_end);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const confirmStripeSession = useCallback(async (sessionId) => {
    setSubscriptionNotice('Confirming payment with Stripe…');
    setAuthError('');
    try {
      const confirmation = await apiRequest('/api/payments/stripe/confirm', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      const nextUser = confirmation?.user || confirmation;
      if (nextUser) {
        setUser(nextUser);
        if (nextUser.subscription_period_end) setSubscriptionEnd(nextUser.subscription_period_end);
      }
      setSubscriptionNotice('Subscription activated via Stripe checkout.');
    } catch (err) {
      setAuthError(err.message);
      setSubscriptionNotice('Could not confirm Stripe checkout. Please retry.');
    }
  }, [apiRequest]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id') || params.get('stripe_session_id');
    if (!sessionId || !user) return;
    confirmStripeSession(sessionId).finally(() => {
      params.delete('session_id');
      params.delete('stripe_session_id');
      const newSearch = params.toString();
      const nextUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    });
  }, [confirmStripeSession, user]);

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
    } catch (err) {
      setAuthError(err.message);
    }
    setAuthForm({ email: '', password: '' });
  };

  const handleSignOut = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setSubscriptionNotice('');
    setSubscriptionEnd('');
  };

  const resetAdminForm = useCallback(() => {
    setAdminForm({ id: null, email: '', password: '', role: 'user', subscriptionStatus: 'inactive', subscriptionPeriodEnd: '' });
  }, []);

  const loadAdminData = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    setAdminLoading(true);
    setAdminError(null);
    try {
      const [stats, users] = await Promise.all([
        apiRequest('/api/admin/stats'),
        apiRequest('/api/admin/users'),
      ]);
      setAdminStats(stats);
      setAdminUsers(Array.isArray(users) ? users : []);
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setAdminLoading(false);
    }
  }, [apiRequest, user]);

  useEffect(() => {
    if (currentPage === 'admin' && user?.role !== 'admin') {
      setCurrentPage('profile');
    }
  }, [currentPage, user]);

  useEffect(() => {
    if (currentPage === 'admin') {
      loadAdminData();
    }
  }, [currentPage, loadAdminData]);

  const formatAdminDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB');
  };

  const handleAdminSubmit = async (event) => {
    event.preventDefault();
    setAdminError(null);
    try {
      const payload = {
        email: adminForm.email,
        role: adminForm.role,
        subscriptionStatus: adminForm.subscriptionStatus,
        subscriptionPeriodEnd: adminForm.subscriptionPeriodEnd || null,
      };
      if (adminForm.password) payload.password = adminForm.password;
      if (adminForm.id) {
        await apiRequest(`/api/admin/users/${adminForm.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
      }
      resetAdminForm();
      await loadAdminData();
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const handleAdminEdit = (record) => {
    setAdminForm({
      id: record.id,
      email: record.email || '',
      password: '',
      role: record.role || 'user',
      subscriptionStatus: record.subscription_status || 'inactive',
      subscriptionPeriodEnd: record.subscription_period_end ? new Date(record.subscription_period_end).toISOString().split('T')[0] : '',
    });
  };

  const handleAdminDelete = async (id) => {
    setAdminError(null);
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
      await loadAdminData();
    } catch (err) {
      setAdminError(err.message);
    }
  };

  const loadMaintenanceLogs = useCallback(async () => {
    if (!user) { setMaintenanceLogs([]); return; }
    try {
      const data = await apiRequest('/api/maintenance-logs');
      setMaintenanceLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load maintenance logs:', err);
      setMaintenanceLogs([]);
    }
  }, [apiRequest, user]);

  useEffect(() => { loadMaintenanceLogs(); }, [loadMaintenanceLogs]);

  const weatherStation = useMemo(() => {
    const targetId = homePort?.toString();
    if (targetId) {
      const match = stations.find(station => `${station.id}` === targetId);
      if (match) return match;
    }
    return selectedStation;
  }, [homePort, selectedStation, stations]);

  useEffect(() => {
    const lat = Number(weatherStation?.lat);
    const lon = Number(weatherStation?.lon);
    if (!scrubModal || !selectedDay || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setWeatherForecast(null);
      setWeatherError('');
      return;
    }

    const controller = new AbortController();
    const dateKey = selectedDay.toISOString().split('T')[0];

    const fetchWeather = async () => {
      setWeatherLoading(true);
      setWeatherError('');
      try {
        const response = await fetch(
          `${WEATHER_API_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&days=7&aqi=no&alerts=no`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error('Failed to fetch weather forecast.');
        const data = await response.json();
        const forecastDay = data?.forecast?.forecastday?.find(day => day.date === dateKey);

        if (!forecastDay) {
          setWeatherForecast({
            date: dateKey,
            location: data?.location,
            missing: true,
          });
          return;
        }

        setWeatherForecast({
          date: dateKey,
          location: data?.location,
          day: forecastDay.day,
          astro: forecastDay.astro,
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        setWeatherError(err.message || 'Unable to load weather forecast.');
        setWeatherForecast(null);
      } finally {
        setWeatherLoading(false);
      }
    };

    fetchWeather();

    return () => controller.abort();
  }, [scrubModal, selectedDay, weatherStation]);

  const createMaintenanceLog = async (payload) => {
    if (!user) {
      setMaintenanceError('Sign in to save maintenance logs.');
      return null;
    }
    setMaintenanceError('');
    try {
      const created = await apiRequest('/api/maintenance-logs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMaintenanceLogs(prev => [...prev, created]);
      return created;
    } catch (err) {
      setMaintenanceError(err.message);
      throw err;
    }
  };

  const updateMaintenanceLog = async (id, payload) => {
    if (!user) return;
    try {
      const updated = await apiRequest(`/api/maintenance-logs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setMaintenanceLogs(prev => prev.map(m => m.id === id ? updated : m));
      return updated;
    } catch (err) {
      setMaintenanceError(err.message);
      throw err;
    }
  };

  const handleDeleteMaintenanceLog = async (id) => {
    if (!user) return;
    await apiRequest(`/api/maintenance-logs/${id}`, { method: 'DELETE' }).catch(() => {});
    setMaintenanceLogs(prev => prev.filter(m => m.id !== id));
  };

  const handleExportMaintenanceLogs = () => {
    if (!user) {
      setMaintenanceError('Sign in to export maintenance logs.');
      return;
    }
    if (!maintenanceLogs.length) {
      setMaintenanceError('No maintenance logs to export yet.');
      return;
    }
    setMaintenanceError('');
    const headers = ['Date', 'Activity Type', 'Title', 'Notes', 'Completed'];
    const escapeValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = maintenanceLogs.map(log => ([
      log.date ? new Date(log.date).toISOString().split('T')[0] : '',
      log.activityType || '',
      log.title || '',
      log.notes || '',
      log.completed ? 'Yes' : 'No',
    ]));
    const csvContent = [headers, ...rows]
      .map(row => row.map(escapeValue).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `maintenance-logs-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);
  };

  const handleMaintenanceReminderToggle = async () => {
    if (!user) {
      setMaintenanceError('Sign in to enable email reminders.');
      return;
    }
    setMaintenanceError('');
    setMaintenanceReminderStatus(null);
    const nextValue = !user.maintenance_reminders_enabled;
    try {
      const updated = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ maintenanceRemindersEnabled: nextValue }),
      });
      setUser(updated);
    } catch (err) {
      setMaintenanceError(err.message);
    }
  };

  const handleSendTestReminder = async () => {
    if (!user) {
      setMaintenanceError('Sign in to send a test reminder.');
      return;
    }
    setMaintenanceError('');
    setMaintenanceReminderStatus({ tone: 'info', message: 'Sending test reminder...' });
    try {
      const data = await apiRequest('/api/maintenance-reminders/test', { method: 'POST' });
      if (data.sent) {
        setMaintenanceReminderStatus({ tone: 'success', message: `Test reminder sent to ${data.email}.` });
      } else {
        setMaintenanceReminderStatus({ tone: 'warning', message: data.note || 'Test reminder was not sent.' });
      }
    } catch (err) {
      setMaintenanceReminderStatus({ tone: 'error', message: err.message });
    }
  };

  const handleMaintenanceSubmit = async (e) => {
    e.preventDefault();
    if (!user) { setMaintenanceError('Sign in to save maintenance logs.'); return; }
    if (!maintenanceForm.date || !maintenanceForm.title) {
      setMaintenanceError('Date and title are required.');
      return;
    }
    try {
      if (editingMaintenance) {
        await updateMaintenanceLog(editingMaintenance.id, maintenanceForm);
        setEditingMaintenance(null);
      } else {
        await createMaintenanceLog(maintenanceForm);
      }
      setMaintenanceForm({ date: '', activityType: 'planned', title: '', notes: '', completed: false });
      setShowMaintenanceModal(false);
    } catch { /* handled in create/update */ }
  };

  const openMaintenanceModal = (date = null) => {
    if (!user) {
      setMaintenanceError('Sign in to save maintenance logs.');
      return;
    }
    const dateStr = date ? date.toISOString().split('T')[0] : '';
    setMaintenanceForm({ date: dateStr, activityType: 'planned', title: '', notes: '', completed: false });
    setEditingMaintenance(null);
    setMaintenanceError('');
    setShowMaintenanceModal(true);
  };

  const editMaintenanceLog = (log) => {
    setEditingMaintenance(log);
    setMaintenanceForm({
      date: log.date ? new Date(log.date).toISOString().split('T')[0] : '',
      activityType: log.activityType || 'planned',
      title: log.title,
      notes: log.notes || '',
      completed: log.completed || false,
    });
    setMaintenanceError('');
    setShowMaintenanceModal(true);
  };

  const handlePurchaseSubscription = () => {
    const nextEnd = new Date();
    nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    setSubscriptionEnd(nextEnd.toISOString());
    setSubscriptionNotice('Subscription marked active locally for testing.');
    updateRole('subscriber');
  };

  const handleSaveHomePort = async () => {
    const match = stations.find(s => s.id === homePort);
    if (!match) return;
    setSelectedStation(match);
    persistHomePortSelection(match.id);
    if (!user) return;
    try {
      const updated = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ homePortId: homePort, homePortName: match.name }),
      });
      setUser(updated);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleDownloadTideBooklet = useCallback(async () => {
    if (!user || !user.home_port_id) {
      alert('Please set your home port first before downloading the tide booklet.');
      return;
    }
    try {
      const response = await fetch('/api/generate-tide-booklet', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tide-booklet-${user.home_port_name.replace(/\s+/g, '-')}-${new Date().getFullYear()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Failed to download tide booklet: ${err.message}`);
    }
  }, [user]);

  const applySelectedStation = (stationId) => {
    setHomePort(stationId);
    const match = stations.find(s => s.id === stationId);
    if (match) {
      setSelectedStation(match);
      persistHomePortSelection(match.id);
    }
  };

  const homePortStation = useMemo(
    () => stations.find(s => s.id === homePort) || selectedStation,
    [stations, homePort, selectedStation]
  );

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

  // Group maintenance logs by date
  const maintenanceByDate = useMemo(() => {
    const grouped = {};
    if (!Array.isArray(maintenanceLogs)) return grouped;

    maintenanceLogs.forEach(log => {
      if (!log?.date) return;
      try {
        const dateKey = new Date(log.date).toDateString();
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(log);
      } catch (err) {
        console.error('Error grouping maintenance log:', err, log);
      }
    });
    return grouped;
  }, [maintenanceLogs]);

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
  const selectedDayEvents = selectedDay ? eventsByDay[selectedDay.toDateString()] || [] : [];
  const selectedDayHasUkhoApi = selectedDayEvents.some(e => e.Source === 'UKHO');
  const selectedDayHasPredicted = selectedDayEvents.some(e => e.IsPredicted);
  const weatherIconUrl = weatherForecast?.day?.condition?.icon ? `https:${weatherForecast.day.condition.icon}` : '';
  const handleDaySelect = useCallback((date, allowSelection = true) => {
    if (!allowSelection) return;
    setSelectedDay(date);
    const scrubData = scrubbingByDate[date.toDateString()] || null;
    setScrubModal({ date, data: scrubData });
  }, [scrubbingByDate]);

  const upcomingDays = useMemo(() => {
    const now = new Date();
    const limit = new Date();
    limit.setDate(now.getDate() + 21);

    return Object.entries(eventsByDay)
      .map(([dateStr, dayEvents]) => ({
        date: new Date(dateStr),
        events: [...dayEvents].sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime)),
      }))
      .filter(({ date }) => date >= now && date <= limit)
      .sort((a, b) => a.date - b.date)
      .slice(0, embedConfig.compact ? 6 : 10);
  }, [embedConfig.compact, eventsByDay]);

  const scrubbingEntries = useMemo(() => {
    return Object.entries(scrubbingByDate)
      .map(([dateStr, data]) => ({ date: new Date(dateStr), data }))
      .sort((a, b) => {
        const order = { excellent: 0, good: 1, fair: 2 };
        return (order[a.data.rating] - order[b.data.rating]) || (a.date - b.date);
      })
      .slice(0, embedConfig.compact ? 4 : 8);
  }, [embedConfig.compact, scrubbingByDate]);

  useEffect(() => {
    if (!isEmbed || typeof window === 'undefined') return;
    const sendHeight = () => {
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      window.parent?.postMessage({ type: 'tidal-calendar:resize', height }, '*');
    };
    sendHeight();
    const observer = new ResizeObserver(sendHeight);
    observer.observe(document.body);
    window.addEventListener('resize', sendHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sendHeight);
    };
  }, [isEmbed, viewMode, currentMonth, tidalEvents, scrubbingByDate, selectedStation]);

  const navigateMonth = (delta) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
    setSelectedDay(null);
  };

  if (isEmbed) {
    const widgetPadding = embedConfig.compact ? '12px' : '20px';
    const widgetGap = embedConfig.compact ? '10px' : '16px';
    const widgetLink = typeof window !== 'undefined' ? `${window.location.origin}?station=${selectedStation?.id || ''}` : '#';
    const cardSurface = embedConfig.theme === 'dark' ? '#0f172a' : '#f8fafc';

    return (
      <div style={{ minHeight: '100%', background: backgroundColor, color: primaryText, fontFamily: "'Outfit', sans-serif", position: 'relative', overflow: 'hidden', padding: widgetPadding }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Outfit:wght@300;400;500&display=swap');
          :root { --tc-accent: ${accentColor}; }
        `}</style>
        <div style={{ maxWidth: '960px', margin: '0 auto', background: surfaceColor, borderRadius: '16px', border: `1px solid ${accentColor}30`, boxShadow: '0 12px 30px rgba(0,0,0,0.14)', padding: widgetPadding, display: 'grid', gap: widgetGap }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: '4px' }}>
              <div style={{ fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: accentColor }}>Tidal Calendar Widget</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: primaryText }}>Scrubbing off Calendar</div>
            </div>
            {selectedStation && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: `${accentColor}14`, borderRadius: '12px', border: `1px solid ${accentColor}30`, color: primaryText, fontWeight: 600 }}>
                ⚓ {selectedStation.name}
              </span>
            )}
          </div>

          {!selectedStation && (
            <div style={{ padding: '14px', background: `${accentColor}10`, borderRadius: '12px', color: secondaryText }}>
              Provide a station via <code style={{ color: primaryText }}>?embed=1&station=ID</code> to render the widget. Default demo data is available if no station is supplied.
            </div>
          )}

          {selectedStation && (
            <>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '13px', color: secondaryText }}>
                  {viewMode === 'monthly' ? 'Next 3 weeks of tide times' : 'Scrubbing day suitability this month'}
                </div>
                <div style={{ display: 'inline-flex', gap: '6px', background: `${accentColor}12`, padding: '4px', borderRadius: '12px', border: `1px solid ${accentColor}26` }}>
                  {['monthly', 'scrubbing'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      style={{
                        padding: '8px 12px',
                        background: viewMode === mode ? accentColor : 'transparent',
                        color: viewMode === mode ? '#ffffff' : secondaryText,
                        border: 'none',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      {mode === 'monthly' ? 'Tide times' : 'Scrubbing'}
                    </button>
                  ))}
                </div>
              </div>

              {viewMode === 'monthly' && (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {upcomingDays.length === 0 && (
                    <div style={{ background: `${accentColor}08`, border: `1px solid ${accentColor}26`, borderRadius: '12px', padding: '14px', color: secondaryText }}>
                      No events available for the next 21 days.
                    </div>
                  )}
                  {upcomingDays.map(({ date, events }) => (
                    <div key={date.toISOString()} style={{ background: cardSurface, border: `1px solid ${accentColor}26`, borderRadius: '12px', padding: '12px', color: primaryText, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                        <div style={{ fontWeight: 700 }}>{date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                        <div style={{ fontSize: '11px', color: secondaryText }}>{getMoonPhaseName(date).icon} {getMoonPhaseName(date).name}</div>
                      </div>
                      <div style={{ display: 'grid', gap: '6px' }}>
                        {events.slice(0, 4).map((event, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: secondaryText }}>
                            <span style={{ color: event.EventType === 'HighWater' ? accentColor : '#64748b' }}>{event.EventType === 'HighWater' ? '▲' : '▼'}</span>
                            <span style={{ color: primaryText, fontWeight: 600 }}>{formatTime(event.DateTime)}</span>
                            <span>{event.Height?.toFixed(1)}m</span>
                            {event.IsPredicted && <span style={{ fontSize: '11px', color: '#b45309' }}>Predicted</span>}
                            {!event.IsPredicted && event.Source === 'UKHO' && <span style={{ fontSize: '11px', color: accentColor }}>{hasUkhoAccess ? 'UKHO' : 'UKHO 7d'}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'scrubbing' && (
                <div style={{ display: 'grid', gap: '10px' }}>
                  {scrubbingEntries.length === 0 && (
                    <div style={{ background: `${accentColor}08`, border: `1px solid ${accentColor}26`, borderRadius: '12px', padding: '14px', color: secondaryText }}>
                      No scrubbing windows found for this month.
                    </div>
                  )}
                  {scrubbingEntries.map(({ date, data }, i) => (
                    <div key={i} style={{ background: cardSurface, border: `1px solid ${accentColor}26`, borderRadius: '12px', padding: '12px', display: 'grid', gap: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', color: primaryText }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <div style={{ display: 'grid', gap: '4px' }}>
                          <div style={{ fontWeight: 700 }}>{date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                          <div style={{ fontSize: '12px', color: secondaryText }}>HW {formatTime(data.hwTime)} • LW {formatTime(data.lwTime)} • Range {data.tidalRange.toFixed(1)}m</div>
                        </div>
                        <ScrubbingBadge rating={data.rating} />
                      </div>
                      <div style={{ fontSize: '11px', color: secondaryText }}>
                        {data.highWater.IsPredicted ? 'Predicted window' : data.highWater.Source === 'UKHO' ? (hasUkhoAccess ? 'UKHO data' : 'UKHO preview (7d)') : 'Predicted'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: secondaryText, fontSize: '12px' }}>
                <span>Embed mode: keeps backgrounds light and trims UI for iframes.</span>
                <a href={widgetLink} target="_blank" rel="noreferrer" style={{ color: accentColor, fontWeight: 700 }}>Open full calendar →</a>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

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
        .calendar-shell { overflow: hidden; }
        .calendar-grid-wrapper { overflow-x: auto; padding-bottom: 10px; }
        .calendar-grid { min-width: 680px; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
        .calendar-weekdays { min-width: 680px; display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        @media (max-width: 768px) {
          .calendar-shell { padding: 16px; }
          .calendar-grid { min-width: 620px; }
          .calendar-weekdays { min-width: 620px; }
          .station-header { flex-direction: column; align-items: flex-start; }
          .station-header-actions { width: 100%; justify-content: flex-start; }
          .calendar-nav { flex-direction: column; gap: 10px; }
          .calendar-nav button { width: 100%; }
          .scrub-card { flex-direction: column; align-items: flex-start; gap: 10px !important; }
          .profile-section { padding: 18px; grid-template-columns: 1fr; gap: 12px; }
          .profile-card { padding: 14px; gap: 10px; background: #ffffff; box-shadow: 0 2px 10px rgba(15,23,42,0.06); }
          .profile-card-nested { padding: 12px; box-shadow: none; background: #ffffff; border-color: #e2e8f0; border-left: 3px solid #bae6fd; }
          .profile-card-nested + .profile-card-nested { margin-top: 8px; }
        }
        ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-track { background: rgba(15, 23, 42, 0.5); } ::-webkit-scrollbar-thumb { background: rgba(56, 189, 248, 0.3); border-radius: 4px; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'relative', padding: '40px 24px 80px', textAlign: 'center', zIndex: 10 }}>
        <div style={{ position: 'absolute', top: '20px', right: '24px' }}><CompassRose size={60} /></div>
        
        <div style={{ animation: 'fadeInUp 0.8s ease-out' }}>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '4px', textTransform: 'uppercase', color: '#0ea5e9', marginBottom: '12px' }}>For UK boat owners</p>
          <h1 style={{ fontSize: 'clamp(36px, 8vw, 64px)', fontWeight: 400, letterSpacing: '2px', margin: '0 0 16px', background: 'linear-gradient(135deg, #0f172a 0%, #0ea5e9 60%, #0f172a 100%)', backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 4s linear infinite' }}>Scrubbing off Calendar</h1>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#475569', maxWidth: '500px', margin: '0 auto 24px' }}>Monthly view • Harmonic predictions • Boat scrubbing day finder</p>
          
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#15803d', padding: '8px 16px', borderRadius: '20px', fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '1px' }}>
           Admiralty data connected
          </span>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}><TideWave height={80} /></div>
      </header>

      {/* Main */}
      <main style={{ position: 'relative', zIndex: 10, padding: '0 24px 60px', maxWidth: '1400px', margin: '0 auto' }}>
        {error && <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', padding: '16px 20px', marginBottom: '24px', fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#fca5a5' }}>⚠ {error}</div>}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {pages.map(page => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(14,165,233,0.25)', background: currentPage === page ? '#e0f2fe' : '#ffffff', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", letterSpacing: '1px', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}
            >
              {page === 'calendar' ? 'Calendar' : page === 'profile' ? 'Profile' : page === 'about' ? 'About' : 'Admin'}
            </button>
          ))}
        </div>

        {currentPage === 'about' && (
          <section style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '20px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#0ea5e9', margin: 0 }}>About</p>
              <h2 style={{ fontSize: '22px', margin: 0, color: '#0f172a', fontWeight: 600 }}>Why we built the Scrubbing off Calendar</h2>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#334155', margin: 0 }}>
                This Calendar keeps boaters informed with a monthly tide view, scrubbing guidance, and maintenance reminders for your chosen home port. We blend UKHO data where available with harmonic predictions so you can plan confidently—even when connectivity is limited.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              {[
                {
                  title: 'Guest users',
                  emoji: '🌐',
                  points: [
                    'Browse stations and set a home port locally with no sign-in required.',
                    'See 7 days of Admiralty API preview data when available.',
                    'Beyond 7 days, tide times and heights are algorithmic predictions for guidance only.',
                  ],
                },
                {
                  title: 'Signed-in (free) users',
                  emoji: '🧭',
                  points: [
                    'Sync your saved home port and maintenance reminders across devices.',
                    'Removal of Ads. Receive the same 7-day Admiralty preview as guests.',
                    'Longer range data remains predicted beyond the 7-day window.',
                  ],
                },
                {
                  title: 'Subscribers',
                  emoji: '🌊',
                  points: [
                    'Unlock extended UKHO tidal events across the year.',
                    'Keep scrubbing guidance and reminders in sync with your subscription.',
                    'Predictions supplement data only when UKHO coverage is unavailable.',
                  ],
                },
              ].map((card, idx) => (
                <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', boxShadow: '0 4px 12px rgba(15,23,42,0.06)', display: 'grid', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>{card.emoji}</span>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: 600 }}>{card.title}</h3>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px', fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#334155' }}>
                    {card.points.map((point, i) => <li key={i}>{point}</li>)}
                  </ul>
                </div>
              ))}
            </div>

            <div style={{ background: '#ecfdf3', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '14px', fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#166534' }}>
              <strong style={{ color: '#15803d' }}>Data transparency:</strong> For guests and non-subscribed users, anything beyond the first 7 days is shown using predicted tide times and heights. Subscribe to replace those forecasts with official UKHO data wherever available.
            </div>
          </section>
        )}

        {currentPage === 'profile' && (
          <section className="profile-section" style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div className="profile-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', boxShadow: '0 6px 14px rgba(15,23,42,0.05)', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Profile</h3>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setAuthMode('signin')} style={{ padding: '6px 10px', background: authMode === 'signin' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign In</button>
                    <button onClick={() => setAuthMode('signup')} style={{ padding: '6px 10px', background: authMode === 'signup' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign Up</button>
                  </div>
                </div>

                {!user ? (
                  <form onSubmit={handleAuthSubmit} style={{ display: 'grid', gap: '10px' }}>
                    <input type="email" placeholder="Email" value={authForm.email} onChange={(e) => setAuthForm(f => ({ ...f, email: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }} />
                    <input type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm(f => ({ ...f, password: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }} />
                    {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                    <button type="submit" style={{ padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>{authMode === 'signup' ? 'Create Account' : 'Sign In'}</button>
                  </form>
                ) : (
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
                    <div>
                      <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>Signed in as</div>
                      <div style={{ fontSize: '13px', color: '#334155' }}>{user.email}</div>
                      <div style={{ marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#ecfeff', border: '1px solid #bae6fd', borderRadius: '10px', color: '#0f172a', fontSize: '12px', fontWeight: 600 }}>
                        Role: {roleLabel}
                      </div>
                    </div>
                    <button onClick={handleSignOut} style={{ padding: '10px 12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>Sign Out</button>
                  </div>
                )}
              </div>

              {user && (
                <div className="profile-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', boxShadow: '0 6px 14px rgba(15,23,42,0.05)', display: 'grid', gap: '12px' }}>
                  <div className="profile-card-nested" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', display: 'grid', gap: '10px' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Home Port (default after sign-in)</div>
                    <select value={homePort} onChange={(e) => setHomePort(e.target.value)} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }}>
                      <option value="">Select a station</option>
                      {stations.map(s => <option key={s.id} value={s.id}>{s.name} — {s.country}</option>)}
                    </select>
                    <button onClick={handleSaveHomePort} style={{ padding: '10px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>Save Home Port</button>
                    {user.home_port_name && (
                      <>
                        <div style={{ fontSize: '12px', color: '#334155' }}>Current home port: <strong style={{ color: '#0f172a' }}>{user.home_port_name}</strong></div>
                      </>
                    )}
                    <div style={{ fontSize: '12px', color: '#334155' }}>Subscription active until <strong style={{ color: '#0f172a' }}>{subscriptionEndLabel}</strong></div>
                  </div>

                  <div className="profile-card-nested" style={{ display: 'grid', gap: '10px', padding: '12px 14px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div>
                        <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Maintenance Logs</div>
                        <div style={{ fontSize: '11px', color: '#475569' }}>Track scrubbing days and boat maintenance.</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          onClick={handleExportMaintenanceLogs}
                          style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                        >
                          Export CSV
                        </button>
                        <button onClick={() => openMaintenanceModal()} style={{ padding: '8px 12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                          Add Log
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#0f172a', cursor: user ? 'pointer' : 'not-allowed' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(user?.maintenance_reminders_enabled)}
                          onChange={handleMaintenanceReminderToggle}
                          disabled={!user}
                          style={{ accentColor: '#0ea5e9' }}
                        />
                        Email reminders (sent the day before).
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          onClick={handleSendTestReminder}
                          disabled={!user}
                          style={{ padding: '6px 10px', background: user ? '#fef3c7' : '#f8fafc', border: '1px solid #f59e0b', borderRadius: '8px', color: '#92400e', cursor: user ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '11px' }}
                        >
                          Send test reminder
                        </button>
                        {!user && <span style={{ fontSize: '11px', color: '#94a3b8' }}>Sign in to enable reminders.</span>}
                      </div>
                    </div>
                    {maintenanceError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{maintenanceError}</div>}
                    {maintenanceReminderStatus && (
                      <div style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: maintenanceReminderStatus.tone === 'success' ? '#166534'
                          : maintenanceReminderStatus.tone === 'warning' ? '#92400e'
                            : maintenanceReminderStatus.tone === 'error' ? '#b91c1c'
                              : '#1d4ed8',
                        background: maintenanceReminderStatus.tone === 'success' ? '#dcfce7'
                          : maintenanceReminderStatus.tone === 'warning' ? '#fef3c7'
                            : maintenanceReminderStatus.tone === 'error' ? '#fee2e2'
                              : '#dbeafe',
                        border: '1px solid',
                        borderColor: maintenanceReminderStatus.tone === 'success' ? '#86efac'
                          : maintenanceReminderStatus.tone === 'warning' ? '#fcd34d'
                            : maintenanceReminderStatus.tone === 'error' ? '#fecaca'
                              : '#93c5fd',
                        borderRadius: '8px',
                        padding: '8px 10px',
                      }}>
                        {maintenanceReminderStatus.message}
                      </div>
                    )}
                    <div style={{ display: 'grid', gap: '8px' }}>
                      {maintenanceLogs.length === 0 && <div style={{ fontSize: '12px', color: '#475569' }}>No maintenance logs yet. Create your first entry.</div>}
                      {maintenanceLogs.map(log => (
                        <div key={log.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', display: 'grid', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>{log.title}</span>
                                {log.completed && <span style={{ fontSize: '10px', padding: '2px 6px', background: '#dcfce7', color: '#166534', borderRadius: '6px', fontWeight: 600 }}>✓ Done</span>}
                              </div>
                              <div style={{ fontSize: '11px', color: '#475569' }}>
                                {new Date(log.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} • {log.activityType}
                              </div>
                              {log.notes && <div style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>{log.notes}</div>}
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button onClick={() => editMaintenanceLog(log)} style={{ padding: '4px 8px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, fontSize: '11px' }}>
                                Edit
                              </button>
                              <button onClick={() => handleDeleteMaintenanceLog(log.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: '11px' }}>
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="profile-card-nested" style={{ display: 'grid', gap: '10px', padding: '12px 14px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Store</div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>Manage your Tide plan and downloads in one place.</div>
                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div className="profile-card-nested" style={{ display: 'grid', gap: '10px', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                        <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Subscription plan</div>
                        <div style={{ fontSize: '12px', color: '#334155' }}>£{SUBSCRIPTION_PRICE_GBP} / year • extended Admiralty API access</div>
                        <div style={{ fontSize: '11px', color: '#475569' }}>Enable test checkout via Stripe Buy Button for extended API coverage. Use Stripe test cards during checkout—successful payment will activate your subscriber role automatically.</div>
                        <div style={{ background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '12px', display: 'grid', gap: '10px' }}>
                          <stripe-buy-button
                            buy-button-id="buy_btn_1SjOVhFjPX0L6hdeuSVzQkzK"
                            publishable-key="pk_test_51SjOPuFjPX0L6hdeZcwi2HKamgScHj7kvkIgMugv7LGNdiCbFaJOCu3BQth2Vo5qgvZgGOcZxYO3xRrychXFn2UT00FcVr2nJ9"
                            client-reference-id={user?.id || undefined}
                          ></stripe-buy-button>
                          <div style={{ fontSize: '11px', color: '#1e293b', lineHeight: 1.5 }}>
                            Completed Stripe checkouts are verified on return and your subscriber status is stored server-side. If you need a manual override for demos, use the local activation button.
                          </div>
                          {subscriptionNotice && <div style={{ fontSize: '11px', color: '#0f172a', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '8px', fontWeight: 600 }}>{subscriptionNotice}</div>}
                          <div style={{ fontSize: '11px', color: '#475569' }}>
                            Status: <strong style={{ color: '#0f172a' }}>{user.subscription_status || 'inactive'}</strong> • Renewed through: <strong style={{ color: '#0f172a' }}>{subscriptionEndLabel}</strong>
                          </div>
                          <button onClick={handlePurchaseSubscription} disabled={role === 'subscriber'} style={{ padding: '10px', background: role === 'subscriber' ? '#dcfce7' : '#22c55e', border: '1px solid #16a34a', borderRadius: '8px', color: role === 'subscriber' ? '#166534' : '#ffffff', cursor: role === 'subscriber' ? 'not-allowed' : 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
                            {role === 'subscriber' ? 'Subscriber active (local mock)' : 'Mark subscription active locally'}
                          </button>
                        </div>
                      </div>
                      {user.home_port_name && (
                        <div className="profile-card-nested" style={{ display: 'grid', gap: '10px', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                          <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Download Year Tide Booklet</div>
                          <div style={{ fontSize: '11px', color: '#475569' }}>Get your annual PDF booklet for offline planning.</div>
                          <button onClick={handleDownloadTideBooklet} style={{ padding: '10px', background: '#8b5cf6', border: '1px solid #7c3aed', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(139,92,246,0.25)' }}>📄 Download Year Tide Booklet (PDF)</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/*
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
                  */}
                </div>
              )}
            </div>

          </section>
        )}

        {currentPage === 'admin' && (
          <section style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '20px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#0ea5e9', margin: 0 }}>Admin Control</p>
                <h2 style={{ fontSize: '22px', margin: '6px 0 0', color: '#0f172a', fontWeight: 600 }}>User Management</h2>
              </div>
              <button
                onClick={loadAdminData}
                style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #bae6fd', background: '#e0f2fe', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}
              >
                Refresh data
              </button>
            </div>

            {adminError && (
              <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                {adminError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {[
                { label: 'Signed up', value: adminStats?.signed_up },
                { label: 'Subscribers', value: adminStats?.subscribers },
                { label: 'Purchasers', value: adminStats?.purchasers },
                { label: 'Total users', value: adminStats?.total },
              ].map(card => (
                <div key={card.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', display: 'grid', gap: '6px', boxShadow: '0 4px 12px rgba(15,23,42,0.06)' }}>
                  <div style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>{card.label}</div>
                  <div style={{ fontSize: '22px', color: '#0f172a', fontWeight: 700 }}>{adminLoading ? '—' : card.value ?? 0}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', alignItems: 'start' }}>
              <form onSubmit={handleAdminSubmit} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', display: 'grid', gap: '12px', boxShadow: '0 6px 14px rgba(15,23,42,0.05)' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: 600 }}>
                    {adminForm.id ? 'Edit user' : 'Create user'}
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
                    {adminForm.id ? 'Update user details, role, or subscription.' : 'Add a new account to the platform.'}
                  </p>
                </div>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  Email
                  <input
                    type="email"
                    value={adminForm.email}
                    onChange={(event) => setAdminForm(form => ({ ...form, email: event.target.value }))}
                    required
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  Password {adminForm.id && <span style={{ color: '#94a3b8' }}>(leave blank to keep)</span>}
                  <input
                    type="password"
                    value={adminForm.password}
                    onChange={(event) => setAdminForm(form => ({ ...form, password: event.target.value }))}
                    required={!adminForm.id}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  Role
                  <select
                    value={adminForm.role}
                    onChange={(event) => setAdminForm(form => ({ ...form, role: event.target.value }))}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    {['user', 'subscriber', 'club_admin', 'admin'].map(option => (
                      <option key={option} value={option}>{option.replace('_', ' ')}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  Subscription status
                  <select
                    value={adminForm.subscriptionStatus}
                    onChange={(event) => setAdminForm(form => ({ ...form, subscriptionStatus: event.target.value }))}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    {['inactive', 'active'].map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                  Subscription end date
                  <input
                    type="date"
                    value={adminForm.subscriptionPeriodEnd}
                    onChange={(event) => setAdminForm(form => ({ ...form, subscriptionPeriodEnd: event.target.value }))}
                    style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {adminForm.id ? 'Save changes' : 'Create user'}
                  </button>
                  {adminForm.id && (
                    <button
                      type="button"
                      onClick={resetAdminForm}
                      style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', display: 'grid', gap: '12px', boxShadow: '0 6px 14px rgba(15,23,42,0.05)' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: 600 }}>User directory</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>Edit or remove user accounts.</p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', color: '#0f172a' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '8px' }}>Email</th>
                        <th style={{ padding: '8px' }}>Role</th>
                        <th style={{ padding: '8px' }}>Status</th>
                        <th style={{ padding: '8px' }}>Subscription end</th>
                        <th style={{ padding: '8px' }}>Created</th>
                        <th style={{ padding: '8px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.length === 0 && (
                        <tr>
                          <td colSpan="6" style={{ padding: '12px', color: '#64748b' }}>
                            {adminLoading ? 'Loading users...' : 'No users found.'}
                          </td>
                        </tr>
                      )}
                      {adminUsers.map(record => (
                        <tr key={record.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '8px', fontWeight: 600 }}>{record.email}</td>
                          <td style={{ padding: '8px', textTransform: 'capitalize' }}>{record.role?.replace('_', ' ')}</td>
                          <td style={{ padding: '8px' }}>{record.subscription_status}</td>
                          <td style={{ padding: '8px' }}>{formatAdminDate(record.subscription_period_end)}</td>
                          <td style={{ padding: '8px' }}>{formatAdminDate(record.created_at)}</td>
                          <td style={{ padding: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => handleAdminEdit(record)}
                              style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #bae6fd', background: '#e0f2fe', cursor: 'pointer', fontWeight: 600 }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdminDelete(record.id)}
                              disabled={record.id === user?.id}
                              style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #fecaca', background: record.id === user?.id ? '#f8fafc' : '#fee2e2', color: record.id === user?.id ? '#94a3b8' : '#b91c1c', cursor: record.id === user?.id ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        {currentPage === 'calendar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <section style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', boxShadow: '0 8px 20px rgba(15,23,42,0.06)', display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>Calendar port selection</h3>
                    <span style={{ padding: '4px 8px', borderRadius: '999px', background: 'rgba(14,165,233,0.12)', color: '#0f172a', fontSize: '11px', fontWeight: 600, fontFamily: "'Outfit', sans-serif" }}>
                      Guest / not signed in
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569' }}>
                    Pick a station to load the calendar. This selection is stored locally on this device and doesn’t affect the profile home port.
                  </p>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search stations..."
                    style={{ width: '100%', padding: '12px 14px 12px 42px', background: '#ffffff', border: '1px solid rgba(15,23,42,0.1)', borderRadius: '10px', color: '#0f172a', fontSize: '14px', fontFamily: "'Outfit', sans-serif" }}
                  />
                  <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', opacity: 0.35 }}>⚓</span>
                </div>
                <select value={homePort} onChange={(e) => applySelectedStation(e.target.value)} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', color: '#0f172a', fontFamily: "'Outfit', sans-serif", boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                  <option value="">Select a station</option>
                  {filteredStations.slice(0, 40).map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {s.country}</option>
                  ))}
                </select>
                
              </div>
            </section>
            {/* Calendar & Detail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Station Content */}
              {selectedStation && (
                <section style={{ animation: 'fadeInUp 0.6s ease-out' }}>
                  {/* Station Header */}
                  <div style={{ background: 'linear-gradient(135deg, #e0f2fe 0%, #f8fafc 100%)', border: '1px solid rgba(14,165,233,0.25)', borderRadius: '20px', padding: '24px 28px', marginBottom: '24px', boxShadow: '0 10px 30px rgba(15,23,42,0.06)' }}>
                    <div className="station-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      <div>
                        <h2 style={{ fontSize: 'clamp(24px, 5vw, 36px)', fontWeight: 500, margin: '0 0 4px', color: '#0f172a' }}>{selectedStation.name}</h2>
                        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#475569', margin: 0 }}>Station {selectedStation.id} • {selectedStation.country}</p>
                      </div>
                      
                      <div className="station-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {homePortStation && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'rgba(14,165,233,0.08)', borderRadius: '12px', border: '1px solid rgba(14,165,233,0.18)', fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#0f172a' }}>
                            🏠 Home port: <strong style={{ fontWeight: 700 }}>{homePortStation.name}</strong>
                          </span>
                        )}
                        <div style={{ display: 'flex', gap: '8px', background: 'rgba(14,165,233,0.08)', padding: '4px', borderRadius: '12px' }}>
                          {['monthly', 'scrubbing'].map(mode => (
                            <button key={mode} className="view-btn" onClick={() => setViewMode(mode)} style={{ padding: '10px 18px', background: viewMode === mode ? '#0ea5e9' : 'transparent', border: 'none', borderRadius: '8px', color: viewMode === mode ? '#ffffff' : '#475569', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '12px', fontWeight: 600, transition: 'all 0.3s' }}>
                              {mode === 'monthly' ? '📅 Month view' : '🧽 Scrubbing Day Finder'}
                            </button>
                          ))}
                        </div>
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
              <div className="calendar-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
                  <button onClick={() => navigateMonth(-1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, flex: '1 1 160px' }}>← Previous</button>
                  
                  <div style={{ textAlign: 'center' }}>
                    <h3 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px', color: '#0f172a' }}>{currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155', margin: 0 }}>
                      {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).icon} {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).name} mid-month
                    </p>
                  </div>
                  
                  <button onClick={() => navigateMonth(1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, flex: '1 1 160px' }}>Next →</button>
                </div>

                {/* Calendar Grid */}
              <div className="calendar-weekdays" style={{ marginBottom: '8px' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontFamily: "'Outfit', sans-serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: '#475569' }}>{day}</div>
                ))}
              </div>

                <div className="calendar-grid-wrapper">
                <div className="calendar-grid">
                  {getMonthData().map(({ date, isCurrentMonth }, i) => {
                    const dateStr = date.toDateString();
                    const dayEvents = eventsByDay[dateStr] || [];
                    const scrubData = scrubbingByDate[dateStr];
                    const dayMaintenanceLogs = maintenanceByDate[dateStr] || [];
                    const isToday = new Date().toDateString() === dateStr;
                    const isSelected = selectedDay?.toDateString() === dateStr;
                    const moonPhase = getMoonPhaseName(date);
                    const hasUkhoEvents = dayEvents.some(e => e.Source === 'UKHO');
                    const hasPredictedEvents = dayEvents.some(e => e.IsPredicted);

                    return (
                      <div
                        key={i}
                        className="day-cell"
                        onClick={() => handleDaySelect(date, isCurrentMonth)}
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

                        {/* Maintenance log indicator */}
                        {dayMaintenanceLogs.length > 0 && (
                          <div style={{ position: 'absolute', top: scrubData ? '20px' : '8px', right: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '12px', cursor: 'pointer' }} title={`${dayMaintenanceLogs.length} maintenance log(s)`}>
                              🔧
                            </span>
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
                          <div style={{ position: 'absolute', bottom: '4px', right: '6px', fontFamily: "'Outfit', sans-serif", fontSize: '8px', color: hasUkhoEvents ? '#0ea5e9' : '#b45309', opacity: 0.9 }}>
                            {hasUkhoEvents ? (hasUkhoAccess ? 'UKHO' : 'UKHO 7d') : (hasPredictedEvents ? 'pred' : '—')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#0f172a', textAlign: 'center' }}>
                    <strong style={{ color: '#0ea5e9' }}>UKHO 7d</strong> = open preview for everyone. Sign in & subscribe to unlock full UKHO times.
                  </div>
                </div>
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
                        const isUkhoEvent = data.highWater.Source === 'UKHO';
                        
                        return (
                          <div key={i} onClick={() => handleDaySelect(date, true)} style={{
                            background: '#ffffff',
                            border: `1px solid ${data.rating === 'excellent' ? '#22c55e' : data.rating === 'good' ? '#84cc16' : '#cbd5e1'}`,
                            borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'all 0.3s', boxShadow: '0 4px 12px rgba(15,23,42,0.06)'
                          }}>
                  <div className="scrub-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '4px', color: '#0f172a' }}>{date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155' }}>
                        HW {formatTime(data.hwTime)} • LW {formatTime(data.lwTime)} • Range {data.tidalRange.toFixed(1)}m
                        {!isPredicted && isUkhoEvent && <span style={{ color: '#0ea5e9', marginLeft: '8px' }}>{hasUkhoAccess ? '• UKHO' : '• UKHO 7d'}</span>}
                        {isPredicted && <span style={{ color: '#b45309', marginLeft: '8px' }}>• Predicted</span>}
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

      {/* Scrubbing modal detail */}
      {scrubModal && selectedDay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', maxWidth: '880px', width: '100%', boxShadow: '0 20px 60px rgba(15,23,42,0.25)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: 700 }}>
                  {scrubModal.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  {getMoonPhaseName(scrubModal.date).icon} {getMoonPhaseName(scrubModal.date).name} • {selectedDayHasUkhoApi ? (hasUkhoAccess ? 'UKHO data (subscriber)' : 'Admiralty Data (7 days)') : (selectedDayHasPredicted ? 'Predicted' : 'API Data')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {scrubModal.data && <ScrubbingBadge rating={scrubModal.data.rating} />}
                <button onClick={() => setScrubModal(null)} style={{ padding: '8px 10px', background: '#e2e8f0', border: '1px solid #cbd5e1', borderRadius: '10px', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}>Close</button>
              </div>
            </div>
            <div style={{ padding: '20px', display: 'grid', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', alignItems: 'start' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  {selectedDayEvents.map((event, i) => {
                    const isHigh = event.EventType === 'HighWater';
                    const isUkhoEvent = event.Source === 'UKHO';
                    return (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px', borderLeft: `3px solid ${isHigh ? '#0ea5e9' : '#64748b'}`, border: '1px solid #e2e8f0' }}>
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase', color: isHigh ? '#0ea5e9' : '#475569', marginBottom: '4px', fontWeight: 600 }}>{isHigh ? '↑ High Water' : '↓ Low Water'}</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px', color: '#0f172a' }}>{formatTime(event.DateTime)}</div>
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#334155' }}>{event.Height?.toFixed(2)}m</div>
                        {event.IsPredicted && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#b45309', marginTop: '6px' }}>⚠ Predicted (harmonic algorithm)</div>}
                        {!event.IsPredicted && isUkhoEvent && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#0ea5e9', marginTop: '6px' }}>{hasUkhoAccess ? 'UKHO data (subscriber)' : 'Admiralty preview (7-day access)'}</div>}
                      </div>
                    );
                  })}
                  {selectedDayEvents.length === 0 && (
                    <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '14px', border: '1px solid #e2e8f0', color: '#475569', fontFamily: "'Outfit', sans-serif" }}>
                      No tide events for this date.
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {scrubModal.data ? (
                    <>
                      <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#475569', marginBottom: '4px' }}>High Water</div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{formatTime(scrubModal.data.hwTime)}</div>
                      </div>
                      <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#475569', marginBottom: '4px' }}>Low Water</div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{formatTime(scrubModal.data.lwTime)}</div>
                      </div>
                      {scrubModal.data.refloatTime && (
                        <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#475569', marginBottom: '4px' }}>Refloat</div>
                          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{formatTime(scrubModal.data.refloatTime)}</div>
                        </div>
                      )}
                      <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#475569', marginBottom: '4px' }}>Tidal Range</div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>{scrubModal.data.tidalRange.toFixed(1)}m</div>
                      </div>
                      <div style={{ gridColumn: '1 / -1', background: '#f8fafc', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: '#475569', marginBottom: '8px' }}>Weather Forecast</div>
                        {weatherLoading && (
                          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569' }}>Loading forecast...</div>
                        )}
                        {!weatherLoading && weatherError && (
                          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#b91c1c' }}>{weatherError}</div>
                        )}
                        {!weatherLoading && !weatherError && weatherForecast?.missing && (
                          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569' }}>
                            Forecast unavailable for {weatherForecast.date}. WeatherAPI provides up to a 7-day outlook.
                          </div>
                        )}
                        {!weatherLoading && !weatherError && weatherForecast?.day && (
                          <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {weatherIconUrl && (
                                <img src={weatherIconUrl} alt={weatherForecast.day.condition?.text || 'Forecast'} style={{ width: '36px', height: '36px' }} />
                              )}
                              <div>
                                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{weatherForecast.day.condition?.text || 'Forecast'}</div>
                                <div style={{ fontSize: '12px', color: '#475569' }}>
                                  {weatherForecast.location?.name || weatherStation?.name}{weatherForecast.location?.region ? `, ${weatherForecast.location.region}` : ''}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
                              <div>
                                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b' }}>High / Low</div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{weatherForecast.day.maxtemp_c?.toFixed(1)}°C / {weatherForecast.day.mintemp_c?.toFixed(1)}°C</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b' }}>Wind</div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{weatherForecast.day.maxwind_kph?.toFixed(0)} kph</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b' }}>Rain Chance</div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{weatherForecast.day.daily_chance_of_rain ?? 0}%</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: '#64748b' }}>Precip</div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{weatherForecast.day.totalprecip_mm?.toFixed(1)} mm</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ background: '#fff7ed', borderRadius: '12px', padding: '14px', border: '1px solid #fed7aa', color: '#9a3412', fontFamily: "'Outfit', sans-serif" }}>
                      Scrubbing window not available for this date based on the selected time window.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: '#334155' }}>
                  {scrubModal.data ? 'Add this scrubbing window to your maintenance log.' : 'No scrubbing slot for this date. Adjust the high water window to see more options.'}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {maintenanceError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{maintenanceError}</div>}
                  <button
                    disabled={!user || !scrubModal.data}
                    onClick={async () => {
                      if (!user || !scrubModal.data) return;
                      await createMaintenanceLog({
                        date: scrubModal.date.toISOString(),
                        activityType: 'planned',
                        title: `Scrub boat - ${scrubModal.data.rating} scrubbing day`,
                        notes: `HW: ${formatTime(scrubModal.data.hwTime)}, LW: ${formatTime(scrubModal.data.lwTime)}, Range: ${scrubModal.data.tidalRange.toFixed(1)}m`,
                        completed: false,
                      });
                      setScrubModal(null);
                    }}
                    style={{
                      padding: '10px 14px',
                      background: user && scrubModal.data ? '#22c55e' : '#e2e8f0',
                      border: `1px solid ${user && scrubModal.data ? '#16a34a' : '#cbd5e1'}`,
                      borderRadius: '10px',
                      color: user && scrubModal.data ? '#ffffff' : '#94a3b8',
                      cursor: user && scrubModal.data ? 'pointer' : 'not-allowed',
                      fontWeight: 700,
                      boxShadow: user && scrubModal.data ? '0 4px 12px rgba(34,197,94,0.3)' : 'none'
                    }}
                  >
                    Add to maintenance log
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Maintenance Log Modal */}
      {showMaintenanceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 1000 }} onClick={() => setShowMaintenanceModal(false)}>
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', maxWidth: '500px', width: '100%', boxShadow: '0 20px 60px rgba(15,23,42,0.25)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', gap: '12px' }}>
              <div style={{ fontSize: '16px', color: '#0f172a', fontWeight: 700 }}>
                {editingMaintenance ? 'Edit Maintenance Log' : 'Add Maintenance Log'}
              </div>
              <button onClick={() => setShowMaintenanceModal(false)} style={{ padding: '6px 10px', background: '#e2e8f0', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}>Close</button>
            </div>
            <div style={{ padding: '20px' }}>
              <form onSubmit={handleMaintenanceSubmit} style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#0f172a', fontWeight: 600, marginBottom: '6px' }}>Date</label>
                  <input
                    type="date"
                    value={maintenanceForm.date}
                    onChange={(e) => setMaintenanceForm(f => ({ ...f, date: e.target.value }))}
                    required
                    style={{ width: '100%', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#0f172a', fontWeight: 600, marginBottom: '6px' }}>Activity Type</label>
                  <select
                    value={maintenanceForm.activityType}
                    onChange={(e) => setMaintenanceForm(f => ({ ...f, activityType: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px' }}
                  >
                    <option value="planned">Planned</option>
                    <option value="scrubbing">Scrubbing</option>
                    <option value="antifouling">Antifouling</option>
                    <option value="inspection">Inspection</option>
                    <option value="repairs">Repairs</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#0f172a', fontWeight: 600, marginBottom: '6px' }}>Title</label>
                  <input
                    type="text"
                    placeholder="e.g., Scrub hull and check anodes"
                    value={maintenanceForm.title}
                    onChange={(e) => setMaintenanceForm(f => ({ ...f, title: e.target.value }))}
                    required
                    style={{ width: '100%', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', color: '#0f172a', fontWeight: 600, marginBottom: '6px' }}>Notes (optional)</label>
                  <textarea
                    placeholder="Additional details..."
                    value={maintenanceForm.notes}
                    onChange={(e) => setMaintenanceForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', fontSize: '13px', resize: 'vertical' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="maintenanceCompleted"
                    checked={maintenanceForm.completed}
                    onChange={(e) => setMaintenanceForm(f => ({ ...f, completed: e.target.checked }))}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="maintenanceCompleted" style={{ fontSize: '13px', color: '#0f172a', cursor: 'pointer' }}>Mark as completed</label>
                </div>
                {maintenanceError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{maintenanceError}</div>}
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button type="submit" style={{ flex: 1, padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>
                    {editingMaintenance ? 'Update Log' : 'Add Log'}
                  </button>
                  <button type="button" onClick={() => setShowMaintenanceModal(false)} style={{ padding: '12px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
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
