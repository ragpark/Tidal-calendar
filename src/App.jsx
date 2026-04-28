import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ScrubAdvisorChatbot from './chatbot/ScrubAdvisorChatbot';

// UK Admiralty Tidal API Configuration
const API_BASE_URL = '/api';
const DEFAULT_API_KEY = 'baec423358314e4e8f527980f959295d';
const WEATHER_API_BASE_URL = 'https://api.weatherapi.com/v1';
const WEATHER_API_KEY = '34c6cb97a9cb4f0c89e85256261401';
const LOCAL_HOME_PORT_KEY = 'tidal-calendar-home-port';
const UK_TIME_ZONE = 'Europe/London';
const CHATBOT_ENABLED = false;
const LONDON_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  timeZoneName: 'shortOffset',
  hour: '2-digit',
  minute: '2-digit',
});

const getLondonOffsetMinutes = (date) => {
  const tzPart = LONDON_OFFSET_FORMATTER.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  if (tzPart === 'GMT') return 0;
  const match = tzPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
};

const createLondonDate = (year, month, day, hour, minute) => {
  let utcMs = Date.UTC(year, month, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getLondonOffsetMinutes(new Date(utcMs));
    const nextUtcMs = Date.UTC(year, month, day, hour, minute, 0, 0) - offsetMinutes * 60 * 1000;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }
  return new Date(utcMs);
};

const ensureUtcDateTimeString = (value) => {
  if (typeof value !== 'string') return value;
  if (!value.includes('T')) return value;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
};

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

const getInitialAppRoute = () => {
  if (typeof window === 'undefined') return { page: 'calendar', blogSlug: null };
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/blog') return { page: 'blog', blogSlug: null };
  if (pathname.startsWith('/blog/')) {
    return { page: 'blog', blogSlug: decodeURIComponent(pathname.slice('/blog/'.length)).toLowerCase() || null };
  }
  return { page: 'calendar', blogSlug: null };
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
  
  const referenceDate = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
  
  const lunarPhase = getLunarPhase(referenceDate);
  const initialHWOffset = (lunarPhase * 24 * 0.5 + 2) % M2_PERIOD;
  
  for (let day = 0; day < days; day++) {
    const currentDate = new Date(referenceDate);
    currentDate.setUTCDate(currentDate.getUTCDate() + day);
    
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
        const isLongRange = day > 6;
        let eventHour = Math.floor(hour);
        let eventMinute = Math.round((hour % 1) * 60);
        if (eventMinute === 60) {
          eventHour = (eventHour + 1) % 24;
          eventMinute = 0;
        }
        const time = createLondonDate(
          currentDate.getUTCFullYear(),
          currentDate.getUTCMonth(),
          currentDate.getUTCDate(),
          eventHour,
          eventMinute,
        );
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

const ScrubbingBadge = ({ small = false }) => {
  const color = '#22c55e';
  const bg = 'rgba(34, 197, 94, 0.2)';
  const label = 'Suitable';

  if (small) {
    return <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} title={label} />;
  }
  
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: bg, border: `1px solid ${color}40`, color, padding: '4px 10px', borderRadius: '12px', fontFamily: "'Outfit', sans-serif", fontSize: '11px', fontWeight: 500 }}>
      <span>✓</span>{label}
    </span>
  );
};

// ===========================================
// MAIN APP COMPONENT
// ===========================================

export default function TidalCalendarApp() {
  const initialRoute = useMemo(() => getInitialAppRoute(), []);
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
  const [viewMode, setViewMode] = useState(isEmbed ? (embedConfig.view || 'monthly') : 'scrubbing');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [user, setUser] = useState(null);
  const [homePort, setHomePort] = useState('');
  const [stripePricingReady, setStripePricingReady] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [adminForm, setAdminForm] = useState({ id: null, email: '', password: '', role: 'user', subscriptionStatus: 'inactive', subscriptionPeriodEnd: '' });
  const [adminError, setAdminError] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [clubAdminData, setClubAdminData] = useState({ club: null, members: [], windows: [], availableUsers: [], integrations: [], facilities: [] });
  const [clubAdminLoading, setClubAdminLoading] = useState(false);
  const [clubAdminError, setClubAdminError] = useState('');
  const [clubSetupForm, setClubSetupForm] = useState({ clubName: '', scrubPostCount: 8, homePortId: '', homePortName: '' });
  const [calendarSyncBusy, setCalendarSyncBusy] = useState(false);
  const [myClubCalendar, setMyClubCalendar] = useState({ club: null, windows: [], facilities: [] });
  const [myClubCalendarLoading, setMyClubCalendarLoading] = useState(false);
  const [myClubCalendarError, setMyClubCalendarError] = useState('');
  const [myClubBookingBusy, setMyClubBookingBusy] = useState({});
  const [myClubBookingModalDateKey, setMyClubBookingModalDateKey] = useState('');
  const [myClubSelectedFacilityByDate, setMyClubSelectedFacilityByDate] = useState({});
  const [myClubBoatNames, setMyClubBoatNames] = useState({});
  const [selectedMemberToAdd, setSelectedMemberToAdd] = useState('');
  const [facilityFormName, setFacilityFormName] = useState('');
  const [bookingAssignments, setBookingAssignments] = useState({});
  const [blogPosts, setBlogPosts] = useState([]);
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogError, setBlogError] = useState('');
  const [blogAdminError, setBlogAdminError] = useState('');
  const [selectedBlogPostId, setSelectedBlogPostId] = useState(null);
  const [pendingBlogSlug, setPendingBlogSlug] = useState(initialRoute.blogSlug);
  const [blogEditor, setBlogEditor] = useState({ id: null, title: '', excerpt: '', coverImageUrl: '', contentHtml: '' });
  const blogCarouselRef = useRef(null);
  const [currentPage, setCurrentPage] = useState(initialRoute.page);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordStatus, setForgotPasswordStatus] = useState('');
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changePasswordStatus, setChangePasswordStatus] = useState('');
  const [resetPasswordForm, setResetPasswordForm] = useState({ token: '', newPassword: '', confirmPassword: '' });
  const [resetPasswordStatus, setResetPasswordStatus] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');
  const [subscriptionNotice, setSubscriptionNotice] = useState('');
  const SUBSCRIPTION_PRICE_GBP = 5;
  const STRIPE_PRICING_TABLE_ID = process.env.VITE_STRIPE_PRICING_TABLE_ID || '';
  const STRIPE_PUBLISHABLE_KEY = process.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
  const stripeUsingTestPublishableKey = STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_');
  const stripePricingConfigured = Boolean(STRIPE_PRICING_TABLE_ID && STRIPE_PUBLISHABLE_KEY) && !stripeUsingTestPublishableKey;
  const mcpCapabilities = useMemo(
    () => ['search_facilities', 'list_clubs', 'create_scrub_window', 'book_scrub_window', 'update_profile'],
    [],
  );

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
  const [legalModal, setLegalModal] = useState(null);
  const londonDateKeyFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: UK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }),
    []
  );
  const londonTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }),
    []
  );
  const getLondonDateKey = useCallback((dateOrString) => {
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    return londonDateKeyFormatter.format(date);
  }, [londonDateKeyFormatter]);
  const getLondonHourMinute = useCallback((dateOrString) => {
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    const parts = londonTimeFormatter.formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return { hour, minute };
  }, [londonTimeFormatter]);
  const role = user?.role || 'user';
  const roleLabel = useMemo(() => {
    if (role === 'subscriber') return 'Subscriber (extended data)';
    if (role === 'admin') return 'Admin';
    if (role === 'club_admin') return 'Club admin';
    return 'User';
  }, [role]);
  const pages = useMemo(() => {
    const base = ['calendar', 'profile', 'about', 'blog'];
    if (user?.role === 'club_admin' || user?.role === 'admin') base.push('club');
    if (user?.role === 'admin') base.push('admin');
    return base;
  }, [user]);
  const subscriptionEndLabel = subscriptionEnd && !Number.isNaN(new Date(subscriptionEnd).getTime())
    ? new Date(subscriptionEnd).toLocaleDateString('en-GB')
    : 'Not set';
  const hasPaidCalendarProduct = useMemo(() => {
    if (!user) return false;
    return Boolean(user.has_pdf_calendar_access);
  }, [user]);
  const canAccessMyClubCalendar = useMemo(
    () => Boolean(user && (user.home_club_id || clubAdminData.club?.id)),
    [clubAdminData.club?.id, user],
  );

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

  const setPageWithHistory = useCallback((page) => {
    setCurrentPage(page);
    if (typeof window === 'undefined') return;
    const targetPath = page === 'blog' ? '/blog' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    if (page !== 'blog') {
      setPendingBlogSlug(null);
    }
  }, []);

  const selectBlogPost = useCallback((post, options = {}) => {
    if (!post) return;
    const { replace = false } = options;
    setSelectedBlogPostId(post.id);
    setPendingBlogSlug(post.slug || null);
    if (typeof window === 'undefined') return;
    const nextPath = post.slug ? `/blog/${encodeURIComponent(post.slug)}` : '/blog';
    if (window.location.pathname === nextPath) return;
    if (replace) {
      window.history.replaceState({}, '', nextPath);
    } else {
      window.history.pushState({}, '', nextPath);
    }
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
    const predictionDays = daysInMonth + 7;
    
    const hasPremiumApiAccess = Boolean(
      user
      && user.subscription_status === 'active'
      && user.has_pdf_calendar_access
    );
    // Keep non-premium users (including signed-in basic accounts) on the same
    // UKHO window as guests: a strict 7-day duration.
    const apiDuration = hasPremiumApiAccess ? 365 : 7;
    const fallbackApiDuration = 7;
    let apiEvents = [];
    let apiFetchFailed = false;
    if (apiKey && !isDemo) {
      try {
        const parseApiEvents = (payload) => (Array.isArray(payload) ? payload : []).map(event => ({
          ...event,
          DateTime: ensureUtcDateTimeString(event.DateTime),
          IsPredicted: false,
          Source: 'UKHO',
        }));

        const response = await fetch(`${API_BASE_URL}/Stations/${station.id}/TidalEvents?duration=${apiDuration}`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) throw new Error(`TidalEvents fetch failed (${response.status})`);
        const rawApiEvents = await response.json();
        apiEvents = parseApiEvents(rawApiEvents);
      } catch (err) {
        console.warn('Extended UKHO fetch failed; retrying with fallback duration.', err);
        try {
          const fallbackResponse = await fetch(`${API_BASE_URL}/Stations/${station.id}/TidalEvents?duration=${fallbackApiDuration}`, { method: 'GET', cache: 'no-store' });
          if (!fallbackResponse.ok) throw new Error(`Fallback TidalEvents fetch failed (${fallbackResponse.status})`);
          const fallbackEvents = await fallbackResponse.json();
          apiEvents = (Array.isArray(fallbackEvents) ? fallbackEvents : []).map(event => ({
            ...event,
            DateTime: ensureUtcDateTimeString(event.DateTime),
            IsPredicted: false,
            Source: 'UKHO',
          }));
        } catch (fallbackErr) {
          console.warn('Fallback UKHO fetch failed:', fallbackErr);
          apiFetchFailed = true;
        }
      }
    }

    const shouldBlendPredictedEvents = !hasPremiumApiAccess;

    if (shouldBlendPredictedEvents && apiEvents.length > 0) {
      const nonPremiumWindowStart = new Date();
      nonPremiumWindowStart.setUTCHours(0, 0, 0, 0);
      const nonPremiumWindowEnd = new Date(nonPremiumWindowStart);
      nonPremiumWindowEnd.setUTCDate(nonPremiumWindowEnd.getUTCDate() + 6);
      apiEvents = apiEvents.filter((event) => {
        const eventDate = new Date(event.DateTime);
        if (Number.isNaN(eventDate.getTime())) return false;
        return eventDate >= nonPremiumWindowStart && eventDate <= nonPremiumWindowEnd;
      });
    }

    const predictedEvents = predictTidalEvents(station, monthStart, predictionDays);
    const apiDateSet = new Set(apiEvents.map((event) => getLondonDateKey(event.DateTime)));

    let nextEvents = [...apiEvents, ...predictedEvents.filter((event) => !apiDateSet.has(getLondonDateKey(event.DateTime)))];
    if (!shouldBlendPredictedEvents && (apiFetchFailed || apiEvents.length === 0)) {
      nextEvents = predictedEvents;
    }

    setTidalEvents(nextEvents.sort((a, b) => new Date(a.DateTime) - new Date(b.DateTime)));
    setLoading(false);
  }, [apiKey, isDemo, currentMonth, getLondonDateKey, user]);

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
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (window.location.pathname === '/reset-password' && token) {
      setCurrentPage('profile');
      setAuthMode('reset');
      setResetPasswordForm((form) => ({ ...form, token }));
    }
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const scriptSrc = 'https://js.stripe.com/v3/pricing-table.js';
    const existingScript = document.querySelector(`script[src="${scriptSrc}"]`);
    if (existingScript) {
      setStripePricingReady(true);
      return undefined;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    const handleLoad = () => setStripePricingReady(true);
    const handleError = () => setStripePricingReady(false);
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, []);
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
    } else if (stations.length > 0) {
      setSelectedStation((current) => current || stations[0]);
    }
  }, [stations, user, persistHomePortSelection, isEmbed]);

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

  const normalizedStationSearchQuery = searchQuery.trim().toLowerCase();
  const hasStationSearchInput = normalizedStationSearchQuery.length > 0;
  const filteredStations = hasStationSearchInput
    ? stations.filter(s =>
      s.name.toLowerCase().includes(normalizedStationSearchQuery) || s.country.toLowerCase().includes(normalizedStationSearchQuery)
    )
    : [];

  useEffect(() => {
    if (user?.subscription_period_end) {
      setSubscriptionEnd(user.subscription_period_end);
    } else if (!user) {
      setSubscriptionEnd('');
    }
  }, [user]);

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
      setSubscriptionNotice('Stripe purchase confirmed and entitlements updated.');
    } catch (err) {
      setAuthError(err.message);
      setSubscriptionNotice('Could not confirm Stripe checkout. Please retry.');
    }
  }, [apiRequest]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '');
    const sessionId = params.get('session_id')
      || params.get('stripe_session_id')
      || params.get('checkout_session_id')
      || hashParams.get('session_id')
      || hashParams.get('stripe_session_id')
      || hashParams.get('checkout_session_id');
    if (!sessionId || !user) return;
    confirmStripeSession(sessionId).finally(() => {
      params.delete('session_id');
      params.delete('stripe_session_id');
      params.delete('checkout_session_id');
      hashParams.delete('session_id');
      hashParams.delete('stripe_session_id');
      hashParams.delete('checkout_session_id');
      const newSearch = params.toString();
      const newHash = hashParams.toString();
      const nextUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}${newHash ? `#${newHash}` : ''}`;
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

  const handleForgotPasswordSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');
    setForgotPasswordStatus('');
    if (!forgotPasswordEmail) {
      setForgotPasswordStatus('Please enter your account email.');
      return;
    }
    try {
      await apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });
      setForgotPasswordStatus('If that email exists, a password reset link has been sent.');
      setForgotPasswordEmail('');
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleResetPasswordSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');
    setResetPasswordStatus('');
    if (!resetPasswordForm.token) {
      setAuthError('Password reset token is missing.');
      return;
    }
    if (!resetPasswordForm.newPassword || resetPasswordForm.newPassword.length < 8) {
      setAuthError('New password must be at least 8 characters.');
      return;
    }
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      setAuthError('New password and confirmation do not match.');
      return;
    }
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetPasswordForm.token, newPassword: resetPasswordForm.newPassword }),
      });
      setResetPasswordStatus('Password reset successfully. You can now sign in with your new password.');
      setResetPasswordForm({ token: '', newPassword: '', confirmPassword: '' });
      setAuthMode('signin');
      if (window.location.pathname === '/reset-password') {
        window.history.replaceState({}, document.title, '/');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleChangePasswordSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');
    setChangePasswordStatus('');
    if (!changePasswordForm.currentPassword || !changePasswordForm.newPassword) {
      setAuthError('Current and new password are required.');
      return;
    }
    if (changePasswordForm.newPassword.length < 8) {
      setAuthError('New password must be at least 8 characters.');
      return;
    }
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setAuthError('New password and confirmation do not match.');
      return;
    }
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: changePasswordForm.currentPassword,
          newPassword: changePasswordForm.newPassword,
        }),
      });
      setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setChangePasswordStatus('Password updated successfully.');
    } catch (err) {
      setAuthError(err.message);
    }
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

  const loadClubAdminData = useCallback(async () => {
    if (!user || (user.role !== 'club_admin' && user.role !== 'admin')) return;
    setClubAdminLoading(true);
    setClubAdminError('');
    try {
      const data = await apiRequest('/api/club-admin/overview');
      const normalized = {
        club: data?.club || null,
        members: Array.isArray(data?.members) ? data.members : [],
        windows: Array.isArray(data?.windows) ? data.windows : [],
        availableUsers: Array.isArray(data?.availableUsers) ? data.availableUsers : [],
        integrations: Array.isArray(data?.integrations) ? data.integrations : [],
        facilities: Array.isArray(data?.facilities) ? data.facilities : [],
      };
      setClubAdminData(normalized);
      setClubSetupForm((form) => ({
        ...form,
        clubName: normalized.club?.name || form.clubName,
        scrubPostCount: normalized.club?.capacity || form.scrubPostCount,
        homePortId: user?.home_port_id || form.homePortId,
        homePortName: user?.home_port_name || form.homePortName,
      }));
    } catch (err) {
      setClubAdminError(err.message || 'Unable to load club admin data.');
    } finally {
      setClubAdminLoading(false);
    }
  }, [apiRequest, user]);

  const loadMyClubCalendar = useCallback(async () => {
    if (!canAccessMyClubCalendar) return;
    setMyClubCalendarLoading(true);
    setMyClubCalendarError('');
    try {
      const data = await apiRequest('/api/my-club/calendar');
      setMyClubCalendar({
        club: data?.club || null,
        windows: Array.isArray(data?.windows) ? data.windows : [],
        facilities: Array.isArray(data?.facilities) ? data.facilities : [],
      });
    } catch (err) {
      setMyClubCalendarError(err.message || 'Unable to load My Club calendar.');
      setMyClubCalendar({ club: null, windows: [], facilities: [] });
    } finally {
      setMyClubCalendarLoading(false);
    }
  }, [apiRequest, canAccessMyClubCalendar]);

  useEffect(() => {
    if (!(user?.role === 'club_admin' || user?.role === 'admin')) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return;
    (async () => {
      try {
        await apiRequest('/api/club-admin/calendar/oauth/callback', {
          method: 'POST',
          body: JSON.stringify({ code, state }),
        });
        await loadClubAdminData();
      } catch (err) {
        setClubAdminError(err.message || 'Calendar connection callback failed.');
      } finally {
        params.delete('code');
        params.delete('state');
        params.delete('scope');
        const clean = params.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${clean ? `?${clean}` : ''}`);
      }
    })();
  }, [apiRequest, loadClubAdminData, user]);

  const loadBlogPosts = useCallback(async () => {
    setBlogLoading(true);
    setBlogError('');
    try {
      const posts = await apiRequest('/api/blog-posts');
      const normalized = Array.isArray(posts) ? posts : [];
      setBlogPosts(normalized);
      setSelectedBlogPostId((current) => {
        const byCurrent = current ? normalized.find((post) => post.id === current) : null;
        if (byCurrent) return byCurrent.id;
        const bySlug = pendingBlogSlug
          ? normalized.find((post) => (post.slug || '').toLowerCase() === pendingBlogSlug.toLowerCase())
          : null;
        return bySlug?.id || normalized[0]?.id || null;
      });
    } catch (err) {
      setBlogError(err.message || 'Unable to load blog posts.');
    } finally {
      setBlogLoading(false);
    }
  }, [apiRequest, pendingBlogSlug]);

  const resetBlogEditor = useCallback(() => {
    setBlogEditor({ id: null, title: '', excerpt: '', coverImageUrl: '', contentHtml: '' });
    setBlogAdminError('');
  }, []);

  useEffect(() => {
    if (currentPage === 'admin' && user?.role !== 'admin') {
      setCurrentPage('profile');
      return;
    }
    if (currentPage === 'club' && !(user?.role === 'club_admin' || user?.role === 'admin')) {
      setCurrentPage('profile');
    }
  }, [currentPage, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPopState = () => {
      const route = getInitialAppRoute();
      setCurrentPage(route.page);
      setPendingBlogSlug(route.blogSlug);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (currentPage === 'admin') {
      loadAdminData();
    }
  }, [currentPage, loadAdminData]);

  useEffect(() => {
    if (currentPage === 'club') {
      loadClubAdminData();
    }
  }, [currentPage, loadClubAdminData]);

  useEffect(() => {
    if (currentPage === 'calendar' && (user?.role === 'club_admin' || user?.role === 'admin')) {
      loadClubAdminData();
    }
  }, [currentPage, loadClubAdminData, user]);

  useEffect(() => {
    if (currentPage !== 'calendar' || !canAccessMyClubCalendar) return;
    loadMyClubCalendar();
  }, [canAccessMyClubCalendar, currentPage, loadMyClubCalendar]);

  useEffect(() => {
    if (viewMode === 'my_club' && !canAccessMyClubCalendar) {
      setViewMode('monthly');
    }
  }, [canAccessMyClubCalendar, viewMode]);

  useEffect(() => {
    if (currentPage === 'blog' || currentPage === 'admin') {
      loadBlogPosts();
    }
  }, [currentPage, loadBlogPosts]);

  const formatAdminDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB');
  };

  const handleClubSetupSubmit = async (event) => {
    event.preventDefault();
    setClubAdminError('');
    try {
      const data = await apiRequest('/api/club-admin/club', {
        method: 'PUT',
        body: JSON.stringify({
          clubName: clubSetupForm.clubName,
          scrubPostCount: Number(clubSetupForm.scrubPostCount) || 1,
          homePortId: clubSetupForm.homePortId || null,
          homePortName: clubSetupForm.homePortName || null,
        }),
      });
      if (data?.user) {
        setUser(data.user);
      }
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to save club settings.');
    }
  };

  const handleAddClubMember = async (event) => {
    event.preventDefault();
    if (!selectedMemberToAdd) {
      setClubAdminError('Select a calendar user first.');
      return;
    }
    setClubAdminError('');
    try {
      await apiRequest('/api/club-admin/members', {
        method: 'POST',
        body: JSON.stringify({ userId: selectedMemberToAdd }),
      });
      setSelectedMemberToAdd('');
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to add member to club group.');
    }
  };

  const handleCreateFacility = async (event) => {
    event.preventDefault();
    const name = facilityFormName.trim();
    if (!name) {
      setClubAdminError('Enter a facility name first.');
      return;
    }
    setClubAdminError('');
    try {
      await apiRequest('/api/club-admin/facilities', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setFacilityFormName('');
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to save facility label.');
    }
  };

  const handleBookOnBehalf = async (windowId) => {
    const userId = bookingAssignments[windowId];
    if (!userId) {
      setClubAdminError('Choose a club member to book for.');
      return;
    }
    setClubAdminError('');
    try {
      await apiRequest(`/api/club-admin/windows/${windowId}/book-on-behalf`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to book on behalf of user.');
    }
  };

  const connectExternalCalendar = async (provider) => {
    setClubAdminError('');
    try {
      const { authorizationUrl } = await apiRequest(`/api/club-admin/calendar/oauth/start?provider=${encodeURIComponent(provider)}`);
      if (!authorizationUrl) throw new Error('No authorization URL returned.');
      window.location.href = authorizationUrl;
    } catch (err) {
      setClubAdminError(err.message || `Unable to connect ${provider} calendar.`);
    }
  };

  const disconnectExternalCalendar = async (integrationId) => {
    setClubAdminError('');
    try {
      await apiRequest(`/api/club-admin/calendar/integrations/${integrationId}`, { method: 'DELETE' });
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to disconnect calendar.');
    }
  };

  const runCalendarSync = async () => {
    setClubAdminError('');
    setCalendarSyncBusy(true);
    try {
      await apiRequest('/api/club-admin/calendar/sync', { method: 'POST', body: JSON.stringify({}) });
      await loadClubAdminData();
    } catch (err) {
      setClubAdminError(err.message || 'Unable to sync calendars.');
    } finally {
      setCalendarSyncBusy(false);
    }
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

  const handleBlogEdit = (post) => {
    setBlogEditor({
      id: post.id,
      title: post.title || '',
      excerpt: post.excerpt || '',
      coverImageUrl: post.coverImageUrl || '',
      contentHtml: post.contentHtml || '',
    });
    setBlogAdminError('');
  };

  const handleBlogSubmit = async (event) => {
    event.preventDefault();
    setBlogAdminError('');
    try {
      const payload = {
        title: blogEditor.title,
        excerpt: blogEditor.excerpt,
        coverImageUrl: blogEditor.coverImageUrl,
        contentHtml: blogEditor.contentHtml,
      };
      if (blogEditor.id) {
        await apiRequest(`/api/admin/blog-posts/${blogEditor.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/api/admin/blog-posts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      resetBlogEditor();
      await loadBlogPosts();
    } catch (err) {
      setBlogAdminError(err.message || 'Unable to save blog post.');
    }
  };

  const handleBlogDelete = async (id) => {
    setBlogAdminError('');
    try {
      await apiRequest(`/api/admin/blog-posts/${id}`, { method: 'DELETE' });
      if (blogEditor.id === id) resetBlogEditor();
      await loadBlogPosts();
    } catch (err) {
      setBlogAdminError(err.message || 'Unable to delete blog post.');
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

  const weatherQueryCandidates = useMemo(() => {
    if (!weatherStation) return [];
    const queries = [];
    const lat = Number(weatherStation.lat);
    const lon = Number(weatherStation.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      queries.push({
        query: `${lat},${lon}`,
        label: `${weatherStation.name} coordinates`,
      });
    }

    const stationName = (weatherStation.name || '').trim();
    const stationCountry = (weatherStation.country || '').trim();
    if (stationName) {
      queries.push({ query: `${stationName}, UK`, label: `${stationName}, UK` });
      if (stationCountry) {
        queries.push({ query: `${stationName}, ${stationCountry}, UK`, label: `${stationName}, ${stationCountry}` });
      }
    }

    const normalize = (value = '') => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const targetTokens = new Set(normalize(stationName).split(' ').filter(token => token.length > 2));
    const countryNorm = normalize(stationCountry);

    const candidates = stations
      .filter(s => s?.id !== weatherStation?.id)
      .map((candidate) => {
        const cLat = Number(candidate.lat);
        const cLon = Number(candidate.lon);
        if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
        const candidateTokens = new Set(normalize(candidate.name).split(' ').filter(token => token.length > 2));
        let overlap = 0;
        targetTokens.forEach(token => {
          if (candidateTokens.has(token)) overlap += 1;
        });
        const countryScore = countryNorm && normalize(candidate.country) === countryNorm ? 0.5 : 0;
        return {
          candidate,
          score: overlap + countryScore,
          query: `${cLat},${cLon}`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    candidates.slice(0, 3).forEach((item) => {
      queries.push({
        query: item.query,
        label: `Nearby weather fallback: ${item.candidate.name}`,
      });
    });

    const deduped = [];
    const seen = new Set();
    queries.forEach((item) => {
      if (!item?.query || seen.has(item.query)) return;
      seen.add(item.query);
      deduped.push(item);
    });
    return deduped;
  }, [weatherStation, stations]);

  useEffect(() => {
    if (!scrubModal || !selectedDay || weatherQueryCandidates.length === 0) {
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
        let lastError = null;
        for (const weatherCandidate of weatherQueryCandidates) {
          try {
            const response = await fetch(
              `${WEATHER_API_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(weatherCandidate.query)}&days=7&aqi=no&alerts=no`,
              { signal: controller.signal }
            );
            if (!response.ok) {
              lastError = new Error(`Weather lookup failed for ${weatherCandidate.label}.`);
              continue;
            }
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
            return;
          } catch (candidateError) {
            lastError = candidateError;
          }
        }
        throw lastError || new Error('Unable to match this port to a weather station.');
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
  }, [scrubModal, selectedDay, weatherQueryCandidates]);

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
    if (!hasPaidCalendarProduct) {
      alert('Complete checkout from the pricing table to unlock PDF downloads.');
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
  }, [hasPaidCalendarProduct, user]);

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
      const date = getLondonDateKey(event.DateTime);
      if (!eventsByDate[date]) eventsByDate[date] = [];
      eventsByDate[date].push(event);
    });
    
    const results = {};
    
    Object.entries(eventsByDate).forEach(([dateStr, events]) => {
      const highWaters = events.filter(e => e.EventType === 'HighWater');
      const lowWaters = events.filter(e => e.EventType === 'LowWater');
      
      highWaters.forEach(hw => {
        const hwDate = new Date(hw.DateTime);
        const { hour: hwHour, minute: hwMinute } = getLondonHourMinute(hwDate);
        const hwMinutes = hwHour * 60 + hwMinute;
        
        if (hwMinutes >= startMinutes && hwMinutes <= endMinutes) {
          const followingLow = lowWaters.find(lw => new Date(lw.DateTime) > hwDate);
          const allHighs = tidalEvents.filter(e => e.EventType === 'HighWater');
          const nextHigh = allHighs.find(h => new Date(h.DateTime) > hwDate && getLondonDateKey(h.DateTime) !== getLondonDateKey(hwDate) || (new Date(h.DateTime) > hwDate && new Date(h.DateTime).getTime() - hwDate.getTime() > 6 * 60 * 60 * 1000));
          
          if (followingLow) {
            const tidalRange = hw.Height - followingLow.Height;
            const refloatTime = nextHigh ? new Date(nextHigh.DateTime) : null;
            const refloatBeforeEvening = refloatTime ? getLondonHourMinute(refloatTime).hour < 20 : true;
            
            const score = (refloatBeforeEvening ? 1 : 0) * 100 + tidalRange;

            if (!results[dateStr] || score > results[dateStr].score) {
              results[dateStr] = {
                highWater: hw,
                lowWater: followingLow,
                nextHighWater: nextHigh,
                tidalRange,
                hwTime: hwDate,
                lwTime: new Date(followingLow.DateTime),
                refloatTime,
                score,
              };
            }
          }
        }
      });
    });
    
    return results;
  }, [tidalEvents, scrubSettings, getLondonDateKey, getLondonHourMinute]);

  // Group maintenance logs by date
  const maintenanceByDate = useMemo(() => {
    const grouped = {};
    if (!Array.isArray(maintenanceLogs)) return grouped;

    maintenanceLogs.forEach(log => {
      if (!log?.date) return;
      try {
        const dateKey = getLondonDateKey(log.date);
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(log);
      } catch (err) {
        console.error('Error grouping maintenance log:', err, log);
      }
    });
    return grouped;
  }, [maintenanceLogs, getLondonDateKey]);

  // Calendar helpers
  const getMonthData = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = (firstDay.getDay() + 6) % 7;
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
    return londonTimeFormatter.format(date);
  };
  const formatLondonDate = useCallback((dateOrString, options = {}) => {
    const date = typeof dateOrString === 'string' ? new Date(dateOrString) : dateOrString;
    return date.toLocaleDateString('en-GB', { timeZone: UK_TIME_ZONE, ...options });
  }, []);

  const eventsByDay = useMemo(() => {
    const grouped = {};
    tidalEvents.forEach(event => {
      const date = getLondonDateKey(event.DateTime);
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(event);
    });
    return grouped;
  }, [tidalEvents, getLondonDateKey]);
  const clubWindowsByDay = useMemo(() => {
    const grouped = {};
    if (!Array.isArray(myClubCalendar.windows)) return grouped;
    myClubCalendar.windows.forEach((window) => {
      const sourceDate = window?.startsAt || window?.date;
      if (!sourceDate) return;
      const parsed = new Date(sourceDate);
      if (Number.isNaN(parsed.getTime())) return;
      const key = getLondonDateKey(parsed);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(window);
    });
    return grouped;
  }, [myClubCalendar.windows, getLondonDateKey]);
  const myClubBookingModalWindows = useMemo(() => {
    if (!myClubBookingModalDateKey) return [];
    return [...(clubWindowsByDay[myClubBookingModalDateKey] || [])].sort((a, b) => {
      const aTs = new Date(a.startsAt || a.date || 0).getTime();
      const bTs = new Date(b.startsAt || b.date || 0).getTime();
      return aTs - bTs;
    });
  }, [clubWindowsByDay, myClubBookingModalDateKey]);
  const myClubBookingModalDateLabel = useMemo(() => {
    if (!myClubBookingModalDateKey) return '';
    const [year, month, day] = myClubBookingModalDateKey.split('-').map(Number);
    if (!year || !month || !day) return myClubBookingModalDateKey;
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return formatLondonDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, [formatLondonDate, myClubBookingModalDateKey]);
  const bookMyClubWindow = useCallback(async (windowId, boatName) => {
    if (!windowId) return;
    const normalizedBoatName = String(boatName || '').trim();
    if (!normalizedBoatName) {
      setMyClubCalendarError('Boat name is required to book a slot.');
      return;
    }
    setMyClubBookingBusy((state) => ({ ...state, [windowId]: true }));
    setMyClubCalendarError('');
    try {
      await apiRequest(`/api/my-club/windows/${windowId}/book`, { method: 'POST', body: JSON.stringify({ boatName: normalizedBoatName }) });
      await loadMyClubCalendar();
    } catch (err) {
      setMyClubCalendarError(err.message || 'Unable to book this slot.');
    } finally {
      setMyClubBookingBusy((state) => ({ ...state, [windowId]: false }));
    }
  }, [apiRequest, loadMyClubCalendar]);
  const bookMyClubWindowOnBehalf = useCallback(async (windowId, userId, boatName) => {
    if (!windowId || !userId) return;
    const normalizedBoatName = String(boatName || '').trim();
    if (!normalizedBoatName) {
      setMyClubCalendarError('Boat name is required to book a slot.');
      return;
    }
    setMyClubBookingBusy((state) => ({ ...state, [windowId]: true }));
    setMyClubCalendarError('');
    try {
      await apiRequest(`/api/club-admin/windows/${windowId}/book-on-behalf`, {
        method: 'POST',
        body: JSON.stringify({ userId, boatName: normalizedBoatName }),
      });
      await Promise.all([loadMyClubCalendar(), loadClubAdminData()]);
    } catch (err) {
      setMyClubCalendarError(err.message || 'Unable to book this slot.');
    } finally {
      setMyClubBookingBusy((state) => ({ ...state, [windowId]: false }));
    }
  }, [apiRequest, loadClubAdminData, loadMyClubCalendar]);
  const bookMyClubFacilityByDate = useCallback(async (dateKey, facilityId, boatName) => {
    if (!dateKey || !facilityId) return;
    const normalizedBoatName = String(boatName || '').trim();
    if (!normalizedBoatName) {
      setMyClubCalendarError('Boat name is required to book a slot.');
      return;
    }
    const busyKey = `${dateKey}:${facilityId}`;
    setMyClubBookingBusy((state) => ({ ...state, [busyKey]: true }));
    setMyClubCalendarError('');
    try {
      await apiRequest('/api/my-club/bookings', {
        method: 'POST',
        body: JSON.stringify({ date: dateKey, facilityId, boatName: normalizedBoatName }),
      });
      await loadMyClubCalendar();
    } catch (err) {
      setMyClubCalendarError(err.message || 'Unable to create a booking for this facility.');
    } finally {
      setMyClubBookingBusy((state) => ({ ...state, [busyKey]: false }));
    }
  }, [apiRequest, loadMyClubCalendar]);
  const stripDeletedBookingFromWindows = useCallback((windows, bookingId) => {
    if (!Array.isArray(windows) || !bookingId) return Array.isArray(windows) ? windows : [];
    const normalizedBookingId = String(bookingId);
    return windows.map((window) => {
      const bookingDetails = Array.isArray(window.bookingDetails) ? window.bookingDetails : [];
      const deletedBooking = bookingDetails.find((booking) => String(booking?.bookingId ?? booking?.id ?? '') === normalizedBookingId) || null;
      const nextBookingDetails = bookingDetails.filter((booking) => String(booking?.bookingId ?? booking?.id ?? '') !== normalizedBookingId);
      const myBookingId = String(window?.myBooking?.bookingId ?? window?.myBooking?.id ?? '');
      const removedFromDetails = bookingDetails.length - nextBookingDetails.length;
      const removedFromMyBooking = myBookingId === normalizedBookingId ? 1 : 0;
      const removedCount = Math.max(removedFromDetails, removedFromMyBooking);
      const hadBooking = bookingDetails.length !== nextBookingDetails.length
        || myBookingId === normalizedBookingId;
      if (!hadBooking) return window;

      const deletedBoatName = deletedBooking?.boatName
        || window?.myBooking?.boatName
        || null;
      const bookedBoats = Array.isArray(window.bookedBoats) ? window.bookedBoats : [];
      const boatsFromRemainingDetails = nextBookingDetails
        .map((booking) => String(booking?.boatName || '').trim())
        .filter(Boolean);
      const nextBookedBoats = boatsFromRemainingDetails.length > 0
        ? boatsFromRemainingDetails
        : (() => {
          let removedBoat = false;
          return bookedBoats.filter((boat) => {
            if (!removedBoat && deletedBoatName && boat === deletedBoatName) {
              removedBoat = true;
              return false;
            }
            return true;
          });
        })();

      return {
        ...window,
        booked: Math.max(0, Number(window.booked || 0) - removedCount),
        bookingDetails: nextBookingDetails,
        myBooking: myBookingId === normalizedBookingId ? null : window.myBooking,
        bookedBoats: nextBookedBoats,
      };
    });
  }, []);
  const deleteMyClubBooking = useCallback(async (bookingId) => {
    if (!bookingId) return;
    const busyKey = `delete-${bookingId}`;
    setMyClubBookingBusy((state) => ({ ...state, [busyKey]: true }));
    setMyClubCalendarError('');
    setMyClubCalendar((state) => ({
      ...state,
      windows: stripDeletedBookingFromWindows(state.windows, bookingId),
    }));
    setClubAdminData((state) => ({
      ...state,
      windows: stripDeletedBookingFromWindows(state.windows, bookingId),
    }));
    try {
      await apiRequest(`/api/my-club/bookings/${bookingId}`, { method: 'DELETE' });
      const refreshes = [loadMyClubCalendar()];
      if (user?.role === 'club_admin' || user?.role === 'admin') refreshes.push(loadClubAdminData());
      const results = await Promise.allSettled(refreshes);
      const failedRefresh = results.find((result) => result.status === 'rejected');
      if (failedRefresh) {
        setMyClubCalendarError('Booking deleted, but one or more calendar views failed to refresh.');
      }
    } catch (err) {
      setMyClubCalendarError(err.message || 'Unable to delete this booking.');
      await Promise.allSettled([
        loadMyClubCalendar(),
        (user?.role === 'club_admin' || user?.role === 'admin') ? loadClubAdminData() : Promise.resolve(),
      ]);
    } finally {
      setMyClubBookingBusy((state) => ({ ...state, [busyKey]: false }));
    }
  }, [apiRequest, loadClubAdminData, loadMyClubCalendar, stripDeletedBookingFromWindows, user?.role]);
  const selectedDayEvents = selectedDay ? eventsByDay[getLondonDateKey(selectedDay)] || [] : [];
  const selectedDayHasUkhoApi = selectedDayEvents.some(e => e.Source === 'UKHO');
  const selectedDayHasPredicted = selectedDayEvents.some(e => e.IsPredicted);
  const currentTideTrend = useMemo(() => {
    if (!selectedDay || tidalEvents.length < 2) return null;
    if (getLondonDateKey(selectedDay) !== getLondonDateKey(new Date())) return null;

    const timeline = [...tidalEvents]
      .map((event) => ({ ...event, ts: new Date(event.DateTime).getTime() }))
      .filter((event) => Number.isFinite(event.ts))
      .sort((a, b) => a.ts - b.ts);
    if (timeline.length < 2) return null;

    const nowTs = Date.now();
    let previous = null;
    let next = null;
    for (let i = 0; i < timeline.length; i += 1) {
      const event = timeline[i];
      if (event.ts <= nowTs) previous = event;
      if (event.ts > nowTs) {
        next = event;
        break;
      }
    }
    if (!previous || !next || next.ts <= previous.ts) return null;

    let direction = null;
    if (previous.EventType === 'LowWater') direction = 'rising';
    if (previous.EventType === 'HighWater') direction = 'falling';
    if (!direction) return null;

    const progress = Math.max(0, Math.min(1, (nowTs - previous.ts) / (next.ts - previous.ts)));
    return {
      direction,
      progress,
      previousEvent: previous,
      nextEvent: next,
      remainingMs: Math.max(0, next.ts - nowTs),
    };
  }, [selectedDay, tidalEvents, getLondonDateKey]);
  const weatherIconUrl = weatherForecast?.day?.condition?.icon ? `https:${weatherForecast.day.condition.icon}` : '';
  const handleDaySelect = useCallback((date, allowSelection = true) => {
    if (!allowSelection) return;
    setSelectedDay(date);
    const scrubData = scrubbingByDate[getLondonDateKey(date)] || null;
    setScrubModal({ date, data: scrubData });
  }, [scrubbingByDate, getLondonDateKey]);

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Object.entries(scrubbingByDate)
      .map(([dateStr, data]) => ({ date: new Date(dateStr), data }))
      .sort((a, b) => {
        const aDate = new Date(a.date);
        const bDate = new Date(b.date);
        aDate.setHours(0, 0, 0, 0);
        bDate.setHours(0, 0, 0, 0);

        const aIsFutureOrToday = aDate >= today;
        const bIsFutureOrToday = bDate >= today;

        if (aIsFutureOrToday !== bIsFutureOrToday) {
          return aIsFutureOrToday ? -1 : 1;
        }

        return a.date - b.date;
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
                        <div style={{ fontWeight: 700 }}>{formatLondonDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                        <div style={{ fontSize: '11px', color: secondaryText }}>{getMoonPhaseName(date).icon} {getMoonPhaseName(date).name}</div>
                      </div>
                      <div style={{ display: 'grid', gap: '6px' }}>
                        {events.slice(0, 4).map((event, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: secondaryText }}>
                            <span style={{ color: event.EventType === 'HighWater' ? accentColor : '#64748b' }}>{event.EventType === 'HighWater' ? '▲' : '▼'}</span>
                            <span style={{ color: primaryText, fontWeight: 600 }}>{formatTime(event.DateTime)}</span>
                            <span>{event.Height?.toFixed(1)}m</span>
                            {event.IsPredicted && <span style={{ fontSize: '11px', color: '#b45309' }}>Predicted</span>}
                            {!event.IsPredicted && event.Source === 'UKHO' && <span style={{ fontSize: '11px', color: accentColor }}>UKHO</span>}
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
                          <div style={{ fontWeight: 700 }}>{formatLondonDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                          <div style={{ fontSize: '12px', color: secondaryText }}>HW {formatTime(data.hwTime)} • LW {formatTime(data.lwTime)} • Range {data.tidalRange.toFixed(1)}m</div>
                        </div>
                        <ScrubbingBadge />
                      </div>
                      <div style={{ fontSize: '11px', color: secondaryText }}>
                        {data.highWater.IsPredicted ? 'Predicted window' : data.highWater.Source === 'UKHO' ? 'UKHO data' : 'Predicted'}
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

  const selectedBlogPost = blogPosts.find((post) => post.id === selectedBlogPostId) || blogPosts[0] || null;

  useEffect(() => {
    if (currentPage !== 'blog' || !selectedBlogPost) return;
    selectBlogPost(selectedBlogPost, { replace: true });
  }, [currentPage, selectedBlogPost, selectBlogPost]);

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
          .profile-account-header { flex-direction: column; align-items: flex-start !important; gap: 10px; }
          .profile-auth-toggle { width: 100%; }
          .profile-auth-toggle button { flex: 1; }
          .profile-signed-in { flex-direction: column; align-items: flex-start !important; gap: 12px; }
          .profile-signed-in button { width: 100%; }
          .profile-maintenance-header { flex-direction: column; align-items: flex-start !important; }
          .profile-maintenance-header-actions { width: 100%; justify-content: stretch !important; }
          .profile-maintenance-header-actions button { flex: 1; }
          .profile-log-row { flex-direction: column; align-items: flex-start !important; }
          .profile-log-actions { width: 100%; }
          .profile-log-actions button { flex: 1; }
          .blog-shell { padding: 18px !important; }
          .blog-title { font-size: 24px !important; }
          .blog-carousel-nav { flex-wrap: wrap; }
          .blog-carousel-nav button { flex: 1; min-width: 140px; }
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
              onClick={() => setPageWithHistory(page)}
              style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(14,165,233,0.25)', background: currentPage === page ? '#e0f2fe' : '#ffffff', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", letterSpacing: '1px', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}
            >
              {page === 'calendar' ? 'Calendar' : page === 'profile' ? 'Account' : page === 'about' ? 'Subscribe' : page === 'blog' ? 'Blog' : page === 'club' ? 'Club' : 'Admin'}
            </button>
          ))}
        </div>

        {currentPage === 'about' && (
          <section style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '20px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#0ea5e9', margin: 0 }}>Subscribe</p>
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
                    'See official UKHO tidal events for next 7 days.',
                    'Free use of the Scrubbing Day finder.',
                  ],
                },
                {
                  title: 'Signed-in (free) users',
                  emoji: '🧭',
                  points: [
                    'Create a maintenance log and receive email reminders before important dates.',
                    'Synced home-port preferences across devices.',
                    'Same UKHO + prediction blending as guest users.',
                  ],
                },
                {
                  title: 'Subscribers',
                  emoji: '🌊',
                  points: [
                    'A full year (365 days from purchase) of Tidal data for UK ports in Calendar and identification of best scrubbing days for 365 days.',
                    'A downloadable PDF of Home Port tide times.',
                  ],
                },
                {
                  title: 'Partners - get in touch',
                  emoji: '🤝',
                  points: [
                    'Embed our app services inside partner sites as a streamlined widget.',
                    'Launch agent icon flows that hand off context and scheduling to Tidal.',
                    'Use MCP to connect data and actions between partner tools and our calendar.',
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
              <strong style={{ color: '#15803d' }}>Data transparency:</strong> UKHO actual data is shown for all users wherever returned by the API. Predicted tide times/heights appear only when UKHO events are unavailable for a date.
            </div>
          </section>
        )}

        {currentPage === 'blog' && (
          <section className="blog-shell" style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '16px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <header style={{ display: 'grid', gap: '6px' }}>
              <p style={{ margin: 0, fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#0ea5e9' }}>Tidal Blog</p>
              <h2 style={{ margin: 0, color: '#0f172a' }}>Latest marine maintenance articles</h2>
            </header>
            {blogError && <div style={{ color: '#b91c1c', fontWeight: 600 }}>{blogError}</div>}
            {blogLoading && <div style={{ color: '#334155' }}>Loading blog posts…</div>}
            {!blogLoading && blogPosts.length === 0 && <div style={{ color: '#334155' }}>No blog posts have been published yet.</div>}

            {!blogLoading && blogPosts.length > 0 && (
              <div style={{ display: 'grid', gap: '18px' }}>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div className="blog-carousel-nav" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569', fontWeight: 600 }}>Browse articles</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => blogCarouselRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                        style={{ padding: '8px 12px', borderRadius: '999px', border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}
                      >
                        ← Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => blogCarouselRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                        style={{ padding: '8px 12px', borderRadius: '999px', border: '1px solid #0284c7', background: '#e0f2fe', color: '#075985', cursor: 'pointer', fontWeight: 700 }}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                  <div
                    ref={blogCarouselRef}
                    style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '6px', scrollSnapType: 'x mandatory' }}
                  >
                  {blogPosts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => selectBlogPost(post)}
                      style={{
                        textAlign: 'left',
                        border: selectedBlogPost?.id === post.id ? '1px solid #0ea5e9' : '1px solid #e2e8f0',
                        background: selectedBlogPost?.id === post.id ? '#eff6ff' : '#f8fafc',
                        borderRadius: '12px',
                        padding: '12px',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: '6px',
                        minWidth: 'min(320px, 86vw)',
                        maxWidth: '420px',
                        flex: '0 0 auto',
                        scrollSnapAlign: 'start',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{post.title}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{new Date(post.publishedAt).toLocaleDateString('en-GB')}</div>
                      <div style={{ fontSize: '13px', color: '#334155' }}>{post.excerpt}</div>
                    </button>
                  ))}
                  </div>
                </div>

                {selectedBlogPost && (
                  <article style={{ display: 'grid', gap: '12px', alignContent: 'start', width: '100%' }}>
                    <header style={{ display: 'grid', gap: '6px' }}>
                      <h3 className="blog-title" style={{ margin: 0, fontSize: '32px', color: '#0f172a', lineHeight: 1.2 }}>{selectedBlogPost.title}</h3>
                      <div style={{ color: '#64748b', fontSize: '13px' }}>
                        {new Date(selectedBlogPost.publishedAt).toLocaleDateString('en-GB')} • {selectedBlogPost.authorEmail || 'Admin'}
                      </div>
                      <div>
                        <a
                          href={selectedBlogPost.slug ? `/blog/${encodeURIComponent(selectedBlogPost.slug)}` : '/blog'}
                          onClick={(event) => {
                            event.preventDefault();
                            selectBlogPost(selectedBlogPost);
                          }}
                          style={{ color: '#0369a1', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}
                        >
                          Permanent link
                        </a>
                      </div>
                    </header>
                    {selectedBlogPost.coverImageUrl && (
                      <img src={selectedBlogPost.coverImageUrl} alt={selectedBlogPost.title} style={{ width: '100%', borderRadius: '12px', maxHeight: '340px', objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                    )}
                    <div
                      style={{ color: '#1e293b', fontSize: '15px', lineHeight: 1.7, display: 'grid', gap: '10px' }}
                      dangerouslySetInnerHTML={{ __html: selectedBlogPost.contentHtml }}
                    />
                  </article>
                )}
              </div>
            )}
          </section>
        )}

        {currentPage === 'profile' && (
          <section className="profile-section" style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <div style={{ display: 'grid', gap: '16px' }}>
              <div className="profile-card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', boxShadow: '0 6px 14px rgba(15,23,42,0.05)', display: 'grid', gap: '12px' }}>
                <div className="profile-account-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Account</h3>
                  {!user && (
                    <div className="profile-auth-toggle" style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => { setAuthMode('signin'); setAuthError(''); }} style={{ padding: '6px 10px', background: authMode === 'signin' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign In</button>
                      <button onClick={() => { setAuthMode('signup'); setAuthError(''); }} style={{ padding: '6px 10px', background: authMode === 'signup' ? '#e0f2fe' : '#ffffff', border: '1px solid #bae6fd', borderRadius: '6px', color: '#0f172a', cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 8px rgba(15,23,42,0.08)' }}>Sign Up</button>
                    </div>
                  )}
                </div>

                {!user ? (
                  <>
                    {(authMode === 'signin' || authMode === 'signup') && (
                      <form onSubmit={handleAuthSubmit} style={{ display: 'grid', gap: '10px' }}>
                        <input type="email" placeholder="Email" value={authForm.email} onChange={(e) => setAuthForm(f => ({ ...f, email: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }} />
                        <input type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm(f => ({ ...f, password: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }} />
                        {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                        {resetPasswordStatus && <div style={{ color: '#166534', fontSize: '12px', fontWeight: 600 }}>{resetPasswordStatus}</div>}
                        <button type="submit" style={{ padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>{authMode === 'signup' ? 'Create Account' : 'Sign In'}</button>
                        {authMode === 'signin' && (
                          <button
                            type="button"
                            onClick={() => { setAuthMode('forgot'); setAuthError(''); setForgotPasswordStatus(''); }}
                            style={{ padding: '8px 0', background: 'transparent', border: 'none', textAlign: 'left', color: '#0369a1', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                          >
                            Forgot your password?
                          </button>
                        )}
                      </form>
                    )}

                    {authMode === 'forgot' && (
                      <form onSubmit={handleForgotPasswordSubmit} style={{ display: 'grid', gap: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#334155' }}>Enter your email and we&apos;ll send a reset link.</div>
                        <input type="email" placeholder="Account email" value={forgotPasswordEmail} onChange={(e) => setForgotPasswordEmail(e.target.value)} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }} />
                        {forgotPasswordStatus && <div style={{ color: forgotPasswordStatus.includes('sent') ? '#166534' : '#92400e', fontSize: '12px', fontWeight: 600 }}>{forgotPasswordStatus}</div>}
                        {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                        <button type="submit" style={{ padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>Send reset link</button>
                        <button type="button" onClick={() => setAuthMode('signin')} style={{ padding: '8px 0', background: 'transparent', border: 'none', textAlign: 'left', color: '#0369a1', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>Back to sign in</button>
                      </form>
                    )}

                    {authMode === 'reset' && (
                      <form onSubmit={handleResetPasswordSubmit} style={{ display: 'grid', gap: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#334155' }}>Set a new password for your account.</div>
                        <input type="text" placeholder="Reset token" value={resetPasswordForm.token} onChange={(e) => setResetPasswordForm((form) => ({ ...form, token: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                        <input type="password" placeholder="New password (min 8 characters)" value={resetPasswordForm.newPassword} onChange={(e) => setResetPasswordForm((form) => ({ ...form, newPassword: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                        <input type="password" placeholder="Confirm new password" value={resetPasswordForm.confirmPassword} onChange={(e) => setResetPasswordForm((form) => ({ ...form, confirmPassword: e.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                        {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                        <button type="submit" style={{ padding: '12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>Reset password</button>
                        <button type="button" onClick={() => setAuthMode('signin')} style={{ padding: '8px 0', background: 'transparent', border: 'none', textAlign: 'left', color: '#0369a1', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>Back to sign in</button>
                      </form>
                    )}
                  </>
                ) : (
                  <div className="profile-signed-in" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
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

                {user && (
                  <form onSubmit={handleChangePasswordSubmit} style={{ display: 'grid', gap: '10px', marginTop: '4px' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Change password</div>
                    <input type="password" placeholder="Current password" value={changePasswordForm.currentPassword} onChange={(event) => setChangePasswordForm((form) => ({ ...form, currentPassword: event.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                    <input type="password" placeholder="New password (min 8 characters)" value={changePasswordForm.newPassword} onChange={(event) => setChangePasswordForm((form) => ({ ...form, newPassword: event.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                    <input type="password" placeholder="Confirm new password" value={changePasswordForm.confirmPassword} onChange={(event) => setChangePasswordForm((form) => ({ ...form, confirmPassword: event.target.value }))} style={{ padding: '12px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a' }} />
                    {changePasswordStatus && <div style={{ color: '#166534', fontSize: '12px', fontWeight: 600 }}>{changePasswordStatus}</div>}
                    {authError && <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>{authError}</div>}
                    <button type="submit" style={{ padding: '10px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 700, boxShadow: '0 4px 12px rgba(14,165,233,0.25)' }}>Update password</button>
                  </form>
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
                    <div className="profile-maintenance-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Maintenance Logs</div>
                        <div style={{ fontSize: '11px', color: '#475569' }}>Track scrubbing days and boat maintenance.</div>
                      </div>
                      <div className="profile-maintenance-header-actions" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                        {user?.role === 'admin' && (
                          <button
                            onClick={handleSendTestReminder}
                            style={{ padding: '6px 10px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', color: '#92400e', cursor: 'pointer', fontWeight: 700, fontSize: '11px' }}
                          >
                            Send test reminder
                          </button>
                        )}
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
                          <div className="profile-log-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '10px' }}>
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
                            <div className="profile-log-actions" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
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
                        <div style={{ fontSize: '11px', color: '#475569' }}>Live Stripe checkout activates your subscriber role automatically after successful payment confirmation.</div>
                        <div style={{ background: '#ffffff', border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '12px', display: 'grid', gap: '10px' }}>
                          {stripePricingConfigured ? (
                            stripePricingReady ? (
                              <stripe-pricing-table
                                pricing-table-id={STRIPE_PRICING_TABLE_ID}
                                publishable-key={STRIPE_PUBLISHABLE_KEY}
                                client-reference-id={String(user.id)}
                                customer-email={user.email}
                              >
                              </stripe-pricing-table>
                            ) : (
                              <div style={{ fontSize: '11px', color: '#64748b' }}>Loading Stripe pricing table…</div>
                            )
                          ) : (
                            <div style={{ fontSize: '11px', color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '8px' }}>
                              {stripeUsingTestPublishableKey
                                ? 'Stripe is configured with a test publishable key. Set VITE_STRIPE_PUBLISHABLE_KEY to a live pk_live key and VITE_STRIPE_PRICING_TABLE_ID to your live pricing table ID.'
                                : 'Stripe pricing table is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY and VITE_STRIPE_PRICING_TABLE_ID to enable live checkout.'}
                            </div>
                          )}
                          <div style={{ fontSize: '11px', color: '#1e293b', lineHeight: 1.5 }}>
                            Completed Stripe checkouts are verified on return and by secure Stripe webhook events, then stored server-side for product unlocks.
                          </div>
                          {subscriptionNotice && <div style={{ fontSize: '11px', color: '#0f172a', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '8px', fontWeight: 600 }}>{subscriptionNotice}</div>}
                          <div style={{ fontSize: '11px', color: '#475569' }}>
                            Status: <strong style={{ color: '#0f172a' }}>{user.subscription_status || 'inactive'}</strong> • Renewed through: <strong style={{ color: '#0f172a' }}>{subscriptionEndLabel}</strong>
                          </div>
                        </div>
                      </div>
                      {user.home_port_name && (
                        <div className="profile-card-nested" style={{ display: 'grid', gap: '10px', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                          <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>Download Year Tide Booklet</div>
                          <div style={{ fontSize: '11px', color: '#475569' }}>Get your annual PDF booklet for offline planning once your pricing-table purchase is active.</div>
                          <button
                            onClick={handleDownloadTideBooklet}
                            disabled={!hasPaidCalendarProduct}
                            style={{
                              padding: '10px',
                              background: hasPaidCalendarProduct ? '#8b5cf6' : '#e2e8f0',
                              border: `1px solid ${hasPaidCalendarProduct ? '#7c3aed' : '#cbd5e1'}`,
                              borderRadius: '8px',
                              color: hasPaidCalendarProduct ? '#ffffff' : '#64748b',
                              cursor: hasPaidCalendarProduct ? 'pointer' : 'not-allowed',
                              fontWeight: 700,
                              boxShadow: hasPaidCalendarProduct ? '0 4px 12px rgba(139,92,246,0.25)' : 'none',
                            }}
                          >
                            📄 Download Year Tide Booklet (PDF)
                          </button>
                          {!hasPaidCalendarProduct && (
                            <div style={{ fontSize: '11px', color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '8px' }}>
                              PDF download unlocks after a successful checkout from the pricing table above.
                            </div>
                          )}
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


        {currentPage === 'club' && (
          <section style={{ animation: 'fadeInUp 0.8s ease-out 0.1s both', background: '#ffffff', border: '1px solid rgba(15, 23, 42, 0.06)', borderRadius: '16px', padding: '24px', display: 'grid', gap: '18px', boxShadow: '0 10px 30px rgba(15,23,42,0.08)' }}>
            <header style={{ display: 'grid', gap: '6px' }}>
              <p style={{ margin: 0, fontSize: '12px', letterSpacing: '2px', textTransform: 'uppercase', color: '#0ea5e9' }}>Club Admin</p>
              <h2 style={{ margin: 0, color: '#0f172a' }}>Club setup, members, and scrubbing bookings</h2>
              <p style={{ margin: 0, color: '#475569', fontSize: '13px' }}>Configure your club details, add calendar users to your group, and manage connected calendar sync. Booking is now handled in the My Club calendar view.</p>
            </header>

            {clubAdminError && <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: '13px' }}>{clubAdminError}</div>}
            {clubAdminLoading && <div style={{ color: '#475569', fontSize: '13px' }}>Loading club workspace…</div>}

            <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <form onSubmit={handleClubSetupSubmit} style={{ display: 'grid', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '15px' }}>1) Club profile</h3>
                <input
                  type="text"
                  value={clubSetupForm.clubName}
                  onChange={(event) => setClubSetupForm((form) => ({ ...form, clubName: event.target.value }))}
                  placeholder="Club name"
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  required
                />
                <input
                  type="number"
                  min="1"
                  value={clubSetupForm.scrubPostCount}
                  onChange={(event) => setClubSetupForm((form) => ({ ...form, scrubPostCount: event.target.value }))}
                  placeholder="Number of scrubbing posts"
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  required
                />
                <input
                  type="text"
                  value={clubSetupForm.homePortName}
                  onChange={(event) => setClubSetupForm((form) => ({ ...form, homePortName: event.target.value }))}
                  placeholder="Home port name"
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  value={clubSetupForm.homePortId}
                  onChange={(event) => setClubSetupForm((form) => ({ ...form, homePortId: event.target.value }))}
                  placeholder="Home port station ID (optional)"
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
                <button type="submit" style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Save club setup</button>
              </form>

              <form onSubmit={handleAddClubMember} style={{ display: 'grid', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '15px' }}>2) Add users to your group</h3>
                <select
                  value={selectedMemberToAdd}
                  onChange={(event) => setSelectedMemberToAdd(event.target.value)}
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff' }}
                >
                  <option value="">Select calendar user</option>
                  {clubAdminData.availableUsers.map((record) => (
                    <option key={record.id} value={record.id}>{record.email}</option>
                  ))}
                </select>
                <button type="submit" style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Add to club group</button>
                <div style={{ fontSize: '12px', color: '#475569' }}>Current members: {clubAdminData.members.length}</div>
              </form>

              <form onSubmit={handleCreateFacility} style={{ display: 'grid', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '15px' }}>3) Label your facilities</h3>
                <input
                  type="text"
                  placeholder="Facility name e.g. Scrub Pad A"
                  value={facilityFormName}
                  onChange={(event) => setFacilityFormName(event.target.value)}
                  style={{ padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  required
                />
                <button type="submit" style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Add facility label</button>
                <div style={{ fontSize: '12px', color: '#475569' }}>Named facilities: {clubAdminData.facilities.length}</div>
              </form>

            </div>

            <div style={{ display: 'grid', gap: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '15px' }}>4) Connect Google / Outlook calendar</h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>Bi-directional sync: create availability in this app and it is pushed to your connected calendar. Run sync to pull external changes back into the club schedule.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button onClick={() => connectExternalCalendar('gmail')} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #16a34a', background: '#22c55e', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Connect Gmail</button>
                <button onClick={() => connectExternalCalendar('outlook')} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #1d4ed8', background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Connect Outlook</button>
                <button onClick={runCalendarSync} disabled={calendarSyncBusy || clubAdminData.integrations.length === 0} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff', fontWeight: 700, cursor: calendarSyncBusy ? 'wait' : 'pointer', opacity: calendarSyncBusy || clubAdminData.integrations.length === 0 ? 0.6 : 1 }}>
                  {calendarSyncBusy ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
              {clubAdminData.integrations.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#64748b' }}>No external calendars connected yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {clubAdminData.integrations.map((integration) => (
                    <div key={integration.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 10px' }}>
                      <div style={{ display: 'grid' }}>
                        <strong style={{ textTransform: 'capitalize', color: '#0f172a' }}>{integration.provider}</strong>
                        <span style={{ fontSize: '12px', color: '#475569' }}>{integration.metadata?.summary || integration.externalCalendarId}</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Last sync: {integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString('en-GB') : 'Never'}</span>
                      </div>
                      <button onClick={() => disconnectExternalCalendar(integration.id)} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #dc2626', background: '#fee2e2', color: '#b91c1c', fontWeight: 700, cursor: 'pointer' }}>Disconnect</button>
                    </div>
                  ))}
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
                { label: 'PDF buyers', value: adminStats?.pdf_calendar_buyers },
                { label: 'Stripe customers', value: adminStats?.stripe_customers },
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
                        <th style={{ padding: '8px' }}>PDF access</th>
                        <th style={{ padding: '8px' }}>Subscription end</th>
                        <th style={{ padding: '8px' }}>Created</th>
                        <th style={{ padding: '8px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.length === 0 && (
                        <tr>
                          <td colSpan="7" style={{ padding: '12px', color: '#64748b' }}>
                            {adminLoading ? 'Loading users...' : 'No users found.'}
                          </td>
                        </tr>
                      )}
                      {adminUsers.map(record => (
                        <tr key={record.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '8px', fontWeight: 600 }}>{record.email}</td>
                          <td style={{ padding: '8px', textTransform: 'capitalize' }}>{record.role?.replace('_', ' ')}</td>
                          <td style={{ padding: '8px' }}>{record.subscription_status}</td>
                          <td style={{ padding: '8px' }}>{record.has_pdf_calendar_access ? 'Yes' : 'No'}</td>
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

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', display: 'grid', gap: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>Blog CMS</h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>Create, edit, and publish blog posts with rich text content stored in the database.</p>
              </div>
              {blogAdminError && (
                <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                  {blogAdminError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 330px) 1fr', gap: '16px', alignItems: 'start' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '14px', display: 'grid', gap: '10px' }}>
                  <button type="button" onClick={resetBlogEditor} style={{ padding: '10px', borderRadius: '10px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                    + New post
                  </button>
                  {blogPosts.map((post) => (
                    <div key={post.id} style={{ border: '1px solid #e2e8f0', background: blogEditor.id === post.id ? '#eff6ff' : '#fff', borderRadius: '10px', padding: '10px', display: 'grid', gap: '8px' }}>
                      <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>{post.title}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{new Date(post.publishedAt).toLocaleDateString('en-GB')}</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button type="button" onClick={() => handleBlogEdit(post)} style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid #bae6fd', background: '#e0f2fe', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                        <button type="button" onClick={() => handleBlogDelete(post.id)} style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fee2e2', color: '#b91c1c', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleBlogSubmit} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', display: 'grid', gap: '10px' }}>
                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                    Title
                    <input value={blogEditor.title} onChange={(event) => setBlogEditor((form) => ({ ...form, title: event.target.value }))} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                  </label>
                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                    Excerpt
                    <textarea value={blogEditor.excerpt} onChange={(event) => setBlogEditor((form) => ({ ...form, excerpt: event.target.value }))} rows={3} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                  </label>
                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', color: '#475569' }}>
                    Cover image URL (optional)
                    <input value={blogEditor.coverImageUrl} onChange={(event) => setBlogEditor((form) => ({ ...form, coverImageUrl: event.target.value }))} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                  </label>
                  <div style={{ display: 'grid', gap: '6px' }}>
                    <div style={{ fontSize: '12px', color: '#475569' }}>Content</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {[
                        ['Bold', 'bold'],
                        ['Italic', 'italic'],
                        ['H2', 'formatBlock', '<h2>'],
                        ['Paragraph', 'formatBlock', '<p>'],
                        ['Bullet list', 'insertUnorderedList'],
                      ].map(([label, cmd, value]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            document.execCommand(cmd, false, value);
                            const html = document.getElementById('blog-editor-area')?.innerHTML || '';
                            setBlogEditor((form) => ({ ...form, contentHtml: html }));
                          }}
                          style={{ padding: '6px 8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div
                      id="blog-editor-area"
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(event) => {
                        const contentHtml = event.currentTarget.innerHTML;
                        setBlogEditor((form) => ({ ...form, contentHtml }));
                      }}
                      style={{ minHeight: '220px', padding: '12px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff', lineHeight: 1.6 }}
                      dangerouslySetInnerHTML={{ __html: blogEditor.contentHtml }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #0284c7', background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                      {blogEditor.id ? 'Update post' : 'Publish post'}
                    </button>
                    {blogEditor.id && (
                      <button type="button" onClick={resetBlogEditor} style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
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
                <div style={{ display: 'grid', gap: '12px' }}>
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
                {!user && !homePort && (
                  <p style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#0369a1' }}>
                    Search for your nearest port to load your tidal calendar.
                  </p>
                )}
                {!hasStationSearchInput ? (
                  <p style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569' }}>
                    Start typing to find tidal stations.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                    {filteredStations.slice(0, 16).map(station => (
                      <button
                        key={station.id}
                        className="station-card"
                        onClick={() => applySelectedStation(station.id)}
                        style={{ background: selectedStation?.id === station.id ? '#e0f2fe' : '#ffffff', border: `1px solid ${selectedStation?.id === station.id ? '#0ea5e9' : '#cbd5e1'}`, borderRadius: '10px', padding: '12px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.3s ease', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '2px' }}>{station.name}</div>
                        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#475569', letterSpacing: '1px', textTransform: 'uppercase' }}>{station.country}</div>
                      </button>
                    ))}
                    {filteredStations.length === 0 && (
                      <p style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#475569' }}>
                        No stations match your search yet.
                      </p>
                    )}
                  </div>
                )}
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
                        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '13px', color: '#475569', margin: 0 }}>{selectedStation.country}</p>
                      </div>
                      
                      <div className="station-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {homePortStation?.id === selectedStation.id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'rgba(14,165,233,0.08)', borderRadius: '12px', border: '1px solid rgba(14,165,233,0.18)', fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#0f172a' }}>
                            🏠 Home port: <strong style={{ fontWeight: 700 }}>{selectedStation.name}</strong>
                          </span>
                        ) : (
                          <button
                            onClick={() => applySelectedStation(selectedStation.id)}
                            style={{ padding: '8px 12px', background: '#0ea5e9', border: '1px solid #0284c7', borderRadius: '12px', color: '#ffffff', fontFamily: "'Outfit', sans-serif", fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Set as home port
                          </button>
                        )}
                        <div style={{ display: 'flex', gap: '8px', background: 'rgba(14,165,233,0.08)', padding: '4px', borderRadius: '12px', flexWrap: 'wrap' }}>
                          {['monthly', 'scrubbing', ...(canAccessMyClubCalendar ? ['my_club'] : [])].map(mode => (
                            <button key={mode} className="view-btn" onClick={() => setViewMode(mode)} style={{ padding: '10px 18px', background: viewMode === mode ? '#0ea5e9' : mode === 'scrubbing' ? '#dbeafe' : 'transparent', border: 'none', borderRadius: '8px', color: viewMode === mode ? '#ffffff' : mode === 'scrubbing' ? '#1d4ed8' : '#475569', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '12px', fontWeight: 700, transition: 'all 0.3s' }}>
                              {mode === 'monthly' ? '📅 Month view' : mode === 'scrubbing' ? '🧽 Scrubbing Day Finder' : '🏟️ My Club'}
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
                    <h3 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px', color: '#0f172a' }}>{formatLondonDate(currentMonth, { month: 'long', year: 'numeric' })}</h3>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155', margin: 0 }}>
                      {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).icon} {getMoonPhaseName(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 15)).name} mid-month
                    </p>
                  </div>
                  
                  <button onClick={() => navigateMonth(1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, flex: '1 1 160px' }}>Next →</button>
                </div>

                {/* Calendar Grid */}
              <div className="calendar-weekdays" style={{ marginBottom: '8px' }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontFamily: "'Outfit', sans-serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: '#475569' }}>{day}</div>
                ))}
              </div>

                <div className="calendar-grid-wrapper">
                <div className="calendar-grid">
                  {getMonthData().map(({ date, isCurrentMonth }, i) => {
                    const dateStr = getLondonDateKey(date);
                    const dayEvents = eventsByDay[dateStr] || [];
                    const scrubData = scrubbingByDate[dateStr];
                    const dayMaintenanceLogs = maintenanceByDate[dateStr] || [];
                    const isToday = getLondonDateKey(new Date()) === dateStr;
                    const isSelected = selectedDay ? getLondonDateKey(selectedDay) === dateStr : false;
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
                          <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: isToday ? 700 : 500, color: isToday ? '#0ea5e9' : '#0f172a' }}>{formatLondonDate(date, { day: 'numeric' })}</span>
                          {(moonPhase.isSpring || moonPhase.name.includes('Quarter')) && (
                            <span style={{ fontSize: '12px', color: '#0f172a' }} title={moonPhase.name}>{moonPhase.icon}</span>
                          )}
                        </div>

                        {/* Scrubbing indicator */}
                        {scrubData && (
                          <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                            <ScrubbingBadge small />
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
                          <div
                            style={{ position: 'absolute', bottom: '4px', right: '6px', fontFamily: "'Outfit', sans-serif", fontSize: '8px', color: hasUkhoEvents ? '#0ea5e9' : '#b45309', opacity: 0.9 }}
                            title={hasPredictedEvents ? 'Predicted tidal data' : undefined}
                          >
                            {hasUkhoEvents ? 'UKHO' : (hasPredictedEvents ? 'Pred.' : '—')}
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
                    <span style={{ fontSize: '8px', padding: '2px 6px', background: '#fef3c7', borderRadius: '4px', color: '#b45309' }} title="Predicted tidal data">Pred.</span> Predicted tidal data used only when UKHO events are unavailable
                  </div>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#334155' }}>
                    🌑🌕 = Spring tides (larger range) • 🌓🌗 = Neap tides (smaller range)
                  </div>
                  <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#0f172a', textAlign: 'center' }}>
                    <strong style={{ color: '#0ea5e9' }}>UKHO</strong> = official UKHO event data when available for the selected date.
                  </div>
                </div>
              </div>
            )}

            {!loading && viewMode === 'my_club' && canAccessMyClubCalendar && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', marginBottom: '24px', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' }}>
                <div className="calendar-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
                  <button onClick={() => navigateMonth(-1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, flex: '1 1 160px' }}>← Previous</button>
                  <div style={{ textAlign: 'center' }}>
                    <h3 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px', color: '#0f172a' }}>My Club · {formatLondonDate(currentMonth, { month: 'long', year: 'numeric' })}</h3>
                    <p style={{ margin: 0, fontSize: '12px', color: '#475569', fontFamily: "'Outfit', sans-serif" }}>
                      {myClubCalendar.club?.name || user?.home_club_name || 'Club schedule'}
                    </p>
                  </div>
                  <button onClick={() => navigateMonth(1)} style={{ background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 20px', color: '#0f172a', cursor: 'pointer', fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, flex: '1 1 160px' }}>Next →</button>
                </div>

                {myClubCalendarError && (
                  <div style={{ marginBottom: '12px', fontSize: '13px', color: '#b91c1c', fontWeight: 600 }}>{myClubCalendarError}</div>
                )}
                {myClubCalendarLoading && (
                  <div style={{ marginBottom: '12px', fontSize: '13px', color: '#475569' }}>Loading My Club calendar…</div>
                )}

                <div className="calendar-weekdays" style={{ marginBottom: '8px' }}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontFamily: "'Outfit', sans-serif", fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', color: '#475569' }}>{day}</div>
                  ))}
                </div>
                <div className="calendar-grid-wrapper">
                  <div className="calendar-grid">
                    {getMonthData().map(({ date, isCurrentMonth }, i) => {
                      const dateStr = getLondonDateKey(date);
                      const windows = clubWindowsByDay[dateStr] || [];
                      const isToday = getLondonDateKey(new Date()) === dateStr;
                      const activeWindows = windows.filter((window) => {
                        const isMemberCreatedWindow = String(window?.notes || '').trim().toLowerCase() === 'member-created booking';
                        const booked = Number(window?.booked || 0);
                        return !isMemberCreatedWindow || booked > 0;
                      });
                      const myBookedCount = windows.filter((window) => Boolean(window.myBooking)).length;
                      return (
                        <div
                          key={i}
                          style={{
                            background: '#ffffff',
                            border: `1px solid ${isToday ? '#94a3b8' : '#e2e8f0'}`,
                            borderRadius: '10px',
                            padding: '10px 8px',
                            minHeight: '90px',
                            opacity: isCurrentMonth ? 1 : 0.4,
                            boxShadow: '0 2px 10px rgba(15,23,42,0.05)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: isToday ? 700 : 500, color: isToday ? '#0ea5e9' : '#0f172a' }}>
                              {formatLondonDate(date, { day: 'numeric' })}
                            </span>
                            {activeWindows.length > 0 && <span style={{ fontSize: '10px', color: '#334155' }}>{activeWindows.length} slot{activeWindows.length > 1 ? 's' : ''}</span>}
                          </div>
                          {isCurrentMonth && (
                            <div style={{ display: 'grid', gap: '4px' }}>
                              {myBookedCount > 0 && (
                                <div style={{ fontSize: '10px', color: '#0369a1', fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>
                                  Booked: {myBookedCount}
                                </div>
                              )}
                              <button
                                onClick={() => setMyClubBookingModalDateKey(dateStr)}
                                style={{ marginTop: '4px', padding: '6px 8px', borderRadius: '7px', border: '1px solid #7dd3fc', background: '#e0f2fe', color: '#0369a1', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                Book
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: '18px', display: 'grid', gap: '10px' }}>
                  {(() => {
                    const monthlyBookedWindows = myClubCalendar.windows
                      .filter((window) => {
                        const source = window.startsAt || window.date;
                        const start = source ? new Date(source) : null;
                        if (!start || Number.isNaN(start.getTime())) return false;
                        const inCurrentMonth = start.getFullYear() === currentMonth.getFullYear() && start.getMonth() === currentMonth.getMonth();
                        return inCurrentMonth && Number(window.booked || 0) > 0;
                      });

                    if (monthlyBookedWindows.length === 0) {
                      return (
                        <div style={{ fontSize: '12px', color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
                          No booked facilities for this month.
                        </div>
                      );
                    }

                    return monthlyBookedWindows.map((window) => {
                        const available = Number(window.booked) < Number(window.capacity);
                        const deleteBusy = Boolean(myClubBookingBusy[`delete-${window?.myBooking?.bookingId}`]);
                        return (
                          <div key={window.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: '#f8fafc' }}>
                            <div style={{ display: 'grid', gap: '3px' }}>
                              <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 700 }}>
                                {window.facilityName || 'Scrub facility'} · {formatLondonDate(window.startsAt || window.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                              </div>
                              <div style={{ fontSize: '12px', color: '#475569' }}>
                                {window.startsAt ? `${formatTime(window.startsAt)} - ${formatTime(window.endsAt || window.startsAt)}` : `Low water ${window.lowWater}`} • {window.duration}
                              </div>
                              <div style={{ fontSize: '11px', color: available ? '#166534' : '#b91c1c' }}>
                                {window.booked}/{window.capacity} booked
                              </div>
                              {Array.isArray(window.bookedBoats) && window.bookedBoats.length > 0 && (
                                <div style={{ fontSize: '11px', color: '#334155' }}>
                                  Boats: {window.bookedBoats.join(', ')}
                                </div>
                              )}
                              {window.myBooking && (
                                <div style={{ fontSize: '11px', color: '#075985', fontWeight: 700 }}>
                                  Status: Booked • Boat: {window.myBooking.boatName || 'Not provided'}
                                </div>
                              )}
                            </div>
                            {window.myBooking ? (
                              <button
                                onClick={() => deleteMyClubBooking(window.myBooking.bookingId)}
                                disabled={deleteBusy}
                                style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontWeight: 700, cursor: deleteBusy ? 'wait' : 'pointer' }}
                              >
                                {deleteBusy ? 'Deleting…' : 'Delete booking'}
                              </button>
                            ) : null}
                          </div>
                        );
                      });
                  })()}
                </div>
              </div>
            )}

            {/* SCRUBBING LIST VIEW */}
            {!loading && viewMode === 'scrubbing' && (
              <div>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '16px' }}>
                  Suitable Scrubbing Days from {formatLondonDate(currentMonth, { month: 'long', year: 'numeric' })}
                </h3>
                
                {Object.keys(scrubbingByDate).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 6px 16px rgba(15,23,42,0.06)' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', color: '#334155' }}>No suitable dates found this month. Try adjusting the time window.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {Object.entries(scrubbingByDate)
                      .sort((a, b) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        const aDate = new Date(a[0]);
                        const bDate = new Date(b[0]);
                        aDate.setHours(0, 0, 0, 0);
                        bDate.setHours(0, 0, 0, 0);

                        const aIsFutureOrToday = aDate >= today;
                        const bIsFutureOrToday = bDate >= today;

                        if (aIsFutureOrToday !== bIsFutureOrToday) {
                          return aIsFutureOrToday ? -1 : 1;
                        }

                        return new Date(a[0]) - new Date(b[0]);
                      })
                      .map(([dateStr, data], i) => {
                        const date = new Date(dateStr);
                        const isPredicted = data.highWater.IsPredicted;
                        const isUkhoEvent = data.highWater.Source === 'UKHO';
                        
                        return (
                          <div key={i} onClick={() => handleDaySelect(date, true)} style={{
                            background: '#ffffff',
                            border: '1px solid #22c55e',
                            borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'all 0.3s', boxShadow: '0 4px 12px rgba(15,23,42,0.06)'
                          }}>
                  <div className="scrub-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '4px', color: '#0f172a' }}>{formatLondonDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#334155' }}>
                        HW {formatTime(data.hwTime)} • LW {formatTime(data.lwTime)} • Range {data.tidalRange.toFixed(1)}m
                        {!isPredicted && isUkhoEvent && <span style={{ color: '#0ea5e9', marginLeft: '8px' }}>• UKHO</span>}
                        {isPredicted && <span style={{ color: '#b45309', marginLeft: '8px' }}>• Predicted</span>}
                                </div>
                              </div>
                              <ScrubbingBadge />
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
                  {formatLondonDate(scrubModal.date, { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div style={{ fontSize: '12px', color: '#475569' }}>
                  {getMoonPhaseName(scrubModal.date).icon} {getMoonPhaseName(scrubModal.date).name} • {selectedDayHasUkhoApi ? 'UKHO data' : (selectedDayHasPredicted ? 'Predicted' : 'API Data')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {scrubModal.data && <ScrubbingBadge />}
                <button onClick={() => setScrubModal(null)} style={{ padding: '8px 10px', background: '#e2e8f0', border: '1px solid #cbd5e1', borderRadius: '10px', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}>Close</button>
              </div>
            </div>
            <div style={{ padding: '20px', display: 'grid', gap: '16px' }}>
              {currentTideTrend && (
                <div
                  style={{
                    background: currentTideTrend.direction === 'rising' ? '#ecfeff' : '#f8fafc',
                    border: `1px solid ${currentTideTrend.direction === 'rising' ? '#67e8f9' : '#cbd5e1'}`,
                    borderRadius: '12px',
                    padding: '12px',
                    display: 'grid',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
                      Tide right now: {currentTideTrend.direction === 'rising' ? '↗️ Rising' : '↘️ Falling'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>
                      {Math.round(currentTideTrend.progress * 100)}% to next {currentTideTrend.nextEvent.EventType === 'HighWater' ? 'high' : 'low'} tide
                    </div>
                  </div>
                  <div style={{ height: '9px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.round(currentTideTrend.progress * 100)}%`,
                        height: '100%',
                        borderRadius: '999px',
                        background: currentTideTrend.direction === 'rising'
                          ? 'linear-gradient(90deg, #06b6d4, #0ea5e9)'
                          : 'linear-gradient(90deg, #64748b, #0f172a)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: '#334155' }}>
                    <span>
                      Since {currentTideTrend.previousEvent.EventType === 'HighWater' ? 'high' : 'low'} tide at {formatTime(currentTideTrend.previousEvent.DateTime)}
                    </span>
                    <span>
                      Next {currentTideTrend.nextEvent.EventType === 'HighWater' ? 'high' : 'low'} tide at {formatTime(currentTideTrend.nextEvent.DateTime)}
                    </span>
                  </div>
                </div>
              )}
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
                        {!event.IsPredicted && isUkhoEvent && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#0ea5e9', marginTop: '6px' }}>UKHO data</div>}
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
                  {canAccessMyClubCalendar && (
                    <button
                      onClick={async () => {
                        try {
                          await loadMyClubCalendar();
                        } catch (err) {
                          console.warn('Unable to refresh My Club availability before booking modal opens.', err);
                        }
                        setScrubModal(null);
                        setMyClubBookingModalDateKey(getLondonDateKey(scrubModal.date));
                      }}
                      style={{
                        padding: '10px 14px',
                        background: '#0ea5e9',
                        border: '1px solid #0284c7',
                        borderRadius: '10px',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 700,
                        boxShadow: '0 4px 12px rgba(14,165,233,0.25)',
                      }}
                    >
                      Book club facility
                    </button>
                  )}
                  <button
                    disabled={!user || !scrubModal.data}
                    onClick={async () => {
                      if (!user || !scrubModal.data) return;
                      await createMaintenanceLog({
                        date: scrubModal.date.toISOString(),
                        activityType: 'planned',
                        title: 'Scrub boat - suitable scrubbing day',
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

      {myClubBookingModalDateKey && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 1000 }} onClick={() => setMyClubBookingModalDateKey('')}>
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', maxWidth: '560px', width: '100%', boxShadow: '0 20px 60px rgba(15,23,42,0.25)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', color: '#0f172a', fontWeight: 700 }}>Book Scrubbing Facility</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>{myClubBookingModalDateLabel}</div>
              </div>
              <button onClick={() => setMyClubBookingModalDateKey('')} style={{ padding: '6px 10px', background: '#e2e8f0', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}>Close</button>
            </div>
            <div style={{ padding: '16px', display: 'grid', gap: '10px' }}>
              {(() => {
                const facilities = Array.isArray(myClubCalendar.facilities) ? myClubCalendar.facilities : [];
                const windowByFacilityId = Object.fromEntries(
                  myClubBookingModalWindows
                    .filter((window) => window?.facilityId)
                    .map((window) => [window.facilityId, window]),
                );
                const selectedFacilityId = myClubSelectedFacilityByDate[myClubBookingModalDateKey]
                  || facilities[0]?.id
                  || myClubBookingModalWindows[0]?.facilityId
                  || '';
                const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || null;
                const activeWindow = selectedFacilityId ? windowByFacilityId[selectedFacilityId] || null : null;
                const createBusyKey = `${myClubBookingModalDateKey}:${selectedFacilityId}`;
                const busy = Boolean(myClubBookingBusy[activeWindow?.id || createBusyKey]);
                const available = activeWindow ? Number(activeWindow.booked) < Number(activeWindow.capacity) : true;

                if (facilities.length === 0) {
                  return (
                    <div style={{ fontSize: '13px', color: '#475569', border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '12px' }}>
                      No facilities are configured for this club yet.
                    </div>
                  );
                }

                return (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', display: 'grid', gap: '10px', background: '#f8fafc' }}>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <label style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>Facility</label>
                      <select
                        value={selectedFacilityId}
                        onChange={(event) => setMyClubSelectedFacilityByDate((state) => ({ ...state, [myClubBookingModalDateKey]: event.target.value }))}
                        style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff' }}
                      >
                        {facilities.map((facility) => {
                          const facilityWindow = windowByFacilityId[facility.id];
                          const label = facilityWindow
                            ? `${facility.name} (${facilityWindow.booked}/${facilityWindow.capacity} in use)`
                            : `${facility.name} (available)`;
                          return <option key={facility.id} value={facility.id}>{label}</option>;
                        })}
                      </select>
                    </div>

                    <div style={{ display: 'grid', gap: '3px' }}>
                      <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 700 }}>{selectedFacility?.name || 'Scrub facility'}</div>
                      {activeWindow ? (
                        <>
                          <div style={{ fontSize: '12px', color: '#475569' }}>
                            {activeWindow.startsAt ? `${formatTime(activeWindow.startsAt)} - ${formatTime(activeWindow.endsAt || activeWindow.startsAt)}` : `Low water ${activeWindow.lowWater}`} • {activeWindow.duration}
                          </div>
                          <div style={{ fontSize: '11px', color: available ? '#166534' : '#b91c1c' }}>
                            {available ? 'Available' : 'Unavailable'} • {activeWindow.booked}/{activeWindow.capacity} in use
                          </div>
                          {activeWindow.myBooking && (
                            <div style={{ fontSize: '11px', color: '#075985', fontWeight: 700 }}>
                              Status: Booked • Boat: {activeWindow.myBooking.boatName || 'Not provided'}
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#475569' }}>No boat booking created for this facility on this date.</div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gap: '6px' }}>
                      <label style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>Boat name</label>
                      <input
                        type="text"
                        value={myClubBoatNames[activeWindow?.id || createBusyKey] ?? activeWindow?.myBooking?.boatName ?? ''}
                        onChange={(event) => setMyClubBoatNames((state) => ({ ...state, [activeWindow?.id || createBusyKey]: event.target.value }))}
                        placeholder="e.g. Sea Mist"
                        style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff' }}
                      />
                    </div>

                    {(user?.role === 'club_admin' || user?.role === 'admin') && activeWindow ? (
                      <div style={{ display: 'grid', gap: '6px' }}>
                        <select
                          value={bookingAssignments[activeWindow.id] || ''}
                          onChange={(event) => setBookingAssignments((state) => ({ ...state, [activeWindow.id]: event.target.value }))}
                          style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', minWidth: '190px' }}
                        >
                          <option value="">Select member</option>
                          {clubAdminData.members.map((member) => (
                            <option key={member.id} value={member.id}>{member.email}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => bookMyClubWindowOnBehalf(activeWindow.id, bookingAssignments[activeWindow.id], myClubBoatNames[activeWindow.id] ?? activeWindow.myBooking?.boatName ?? '')}
                          disabled={!available || busy || !bookingAssignments[activeWindow.id]}
                          style={{ padding: '9px 12px', borderRadius: '8px', border: `1px solid ${available ? '#0284c7' : '#cbd5e1'}`, background: available ? '#0ea5e9' : '#e2e8f0', color: available ? '#fff' : '#64748b', fontWeight: 700, cursor: available ? 'pointer' : 'not-allowed' }}
                        >
                          {busy ? 'Booking…' : available ? 'Book for member' : 'Unavailable'}
                        </button>
                      </div>
                    ) : (
                      (() => {
                        const handleMemberBooking = () => {
                          const boatName = myClubBoatNames[activeWindow?.id || createBusyKey] ?? activeWindow?.myBooking?.boatName ?? '';
                          if (activeWindow) {
                            bookMyClubWindow(activeWindow.id, boatName);
                          } else {
                            bookMyClubFacilityByDate(myClubBookingModalDateKey, selectedFacilityId, boatName);
                          }
                        };
                        return (
                          <button
                            onClick={handleMemberBooking}
                            disabled={!selectedFacilityId || !available || busy}
                            style={{ padding: '9px 12px', borderRadius: '8px', border: `1px solid ${available ? '#0284c7' : '#cbd5e1'}`, background: available ? '#0ea5e9' : '#e2e8f0', color: available ? '#fff' : '#64748b', fontWeight: 700, cursor: available ? 'pointer' : 'not-allowed' }}
                          >
                            {busy ? 'Booking…' : available ? 'Book facility' : 'Unavailable'}
                          </button>
                        );
                      })()
                    )}
                  </div>
                );
              })()}
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
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#334155', margin: '0 0 8px', display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setLegalModal('privacy')}
            style={{ background: 'transparent', border: 'none', color: '#0ea5e9', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '11px' }}
          >
            Privacy Notice (UK)
          </button>
          <button
            type="button"
            onClick={() => setLegalModal('terms')}
            style={{ background: 'transparent', border: 'none', color: '#0ea5e9', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '11px' }}
          >
            Terms of Use (UK)
          </button>
        </p>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '11px', color: '#334155', margin: 0 }}>© Crown Copyright. All times GMT/UTC. Heights in metres above Chart Datum. Predictions beyond 7 days are estimates.</p>
      </footer>

      {legalModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(2, 6, 23, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => setLegalModal(null)}
        >
          <div
            style={{ width: 'min(720px, 100%)', maxHeight: '85vh', overflowY: 'auto', background: '#ffffff', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 24px 64px rgba(15, 23, 42, 0.35)', padding: '22px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '20px', color: '#0f172a' }}>
              {legalModal === 'privacy' ? 'Privacy Notice (United Kingdom)' : 'Terms of Use (United Kingdom)'}
            </h3>
            {legalModal === 'privacy' ? (
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', lineHeight: 1.65, color: '#334155' }}>
                <p style={{ marginTop: 0 }}>
                  This UK privacy notice is provided as boilerplate text for users in the United Kingdom. It explains what personal data may be collected when you use this tidal calendar, including account details, usage information, and service diagnostics.
                </p>
                <p>
                  Personal data is processed for legitimate business purposes, contract performance, legal obligations, and (where required) your consent. Typical processing purposes include operating your account, providing tide planning features, improving reliability, and responding to support requests.
                </p>
                <p>
                  You may have rights under UK data protection law, including rights to access, correct, erase, restrict, object, or request portability of your information. You may also withdraw consent where processing is based on consent.
                </p>
                <p style={{ marginBottom: 0 }}>
                  This notice is a general template and should be reviewed by qualified legal counsel to ensure compliance with UK GDPR, the Data Protection Act 2018, and any applicable sector-specific requirements.
                </p>
              </div>
            ) : (
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '14px', lineHeight: 1.65, color: '#334155' }}>
                <p style={{ marginTop: 0 }}>
                  These UK terms of use are boilerplate and govern access to and use of this tidal calendar service. By using the service, users agree to act lawfully, provide accurate account information, and avoid misuse, reverse engineering, or disruption of service availability.
                </p>
                <p>
                  The service and its content are provided on an “as is” basis, subject to applicable law. Tide times and related predictions are informational only and should not replace official navigational publications, local notices, or prudent seamanship.
                </p>
                <p>
                  To the extent permitted by UK law, liability is limited for indirect or consequential losses. Nothing in these terms excludes liability where exclusion is not lawful, including for fraud or death/personal injury caused by negligence.
                </p>
                <p style={{ marginBottom: 0 }}>
                  This template should be reviewed by legal counsel and adapted for your business model, consumer rights obligations, and governing law/jurisdiction provisions applicable within the United Kingdom.
                </p>
              </div>
            )}
            <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', fontWeight: 600, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 5 }}><TideWave height={100} /></div>
      {!isEmbed && CHATBOT_ENABLED && <ScrubAdvisorChatbot mcpCapabilities={mcpCapabilities} />}
    </div>
  );
}
