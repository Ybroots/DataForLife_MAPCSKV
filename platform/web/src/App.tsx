import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps, ComponentType } from 'react';
import { ContactRound, FileWarning, Map, MapPinned, Menu, MessageSquareText, Search, ShieldCheck, UserRound, UserRoundCheck, X } from 'lucide-react';
import { ApiError, getAreaOverview, getCitizenSession, getOfficerSession, listHotlines, lookupByCode, lookupByLocation, searchAreas, signOutCitizen, signOutOfficer } from './api';
import { DirectoryPanel } from './components/DirectoryPanel';
import { FeatureDrawer } from './components/FeatureDrawer';
import { PoliceLoginDialog, PoliceLoginScreen } from './components/PoliceLogin';
import type { PolicePortal as PolicePortalComponent } from './components/PolicePortal';
import { LoginScreen } from './components/LoginScreen';
import { CitizenAuthSheet } from './components/CitizenAuthSheet';
import { clearReportDraft } from './report-draft';
import { CitizenOnboardingTour } from './components/CitizenOnboardingTour';
import { CitizenNotifications } from './components/CitizenNotifications';
import { NotificationSettings } from './components/NotificationSettings';
import { PushToast } from './components/PushToast';
import { OfflineBanner } from './components/OfflineBanner';
import { AppToasts } from './components/AppToasts';
import { showToast } from './toast';
import { disablePush, initPush, pushSupported, PUSH_EVENT, readPushPrefs, syncPushDevice, takePendingPushOpen, writePushPrefs } from './push-notifications';
import type { PushEventDetail, PushPrefs, PushTarget } from './push-notifications';
import { readRecentAreas, rememberArea } from './recent-areas';
import type { RecentArea } from './recent-areas';
import { ScreenErrorBoundary } from './components/ScreenErrorBoundary';
import type { FeatureId } from './features';
import type { AreaLookup, AreaOverview, AreaSummary, CitizenSession, Hotline, WorkflowActor } from './types';
import directoryLogoUrl from '../../../assets/images/logo-transparent.png';

const MapPane = lazy(async () => {
  const module = await import('./components/MapPane');
  return { default: module.MapPane };
});

const MapAssistant = lazy(async () => {
  const module = await import('./components/MapAssistant');
  return { default: module.MapAssistant };
});

const FeaturePage = lazy(async () => {
  const module = await import('./components/FeaturePage');
  return { default: module.FeaturePage };
});

// Bản dành cho người dân không đóng gói cổng nghiệp vụ (nhánh `import()` bị loại khi build).
const PolicePortal: ComponentType<ComponentProps<typeof PolicePortalComponent>> = __CITIZEN_ONLY__
  ? () => null
  : lazy(async () => {
    const module = await import('./components/PolicePortal');
    return { default: module.PolicePortal };
  });

type LookupState = 'idle' | 'loading' | 'success' | 'error';
const COMPACT_LAYOUT_QUERY = '(max-width: 1023px)';
const FEATURE_IDS: FeatureId[] = ['directory', 'alerts', 'stats', 'reports', 'sos', 'feedback', 'assistant', 'account'];
const CITIZEN_TOUR_KEY = 'cskv-citizen-tour-v1';

function featureFromUrl(): FeatureId {
  const requested = new URL(window.location.href).searchParams.get('feature');
  return FEATURE_IDS.includes(requested as FeatureId) ? requested as FeatureId : 'directory';
}

function useCompactLayout(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(COMPACT_LAYOUT_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return matches;
}

export default function App() {
  const policePortalRequested = __OFFICER_APP__ || (!__CITIZEN_ONLY__ && new URL(window.location.href).searchParams.get('portal') === 'police');
  const isCompactLayout = useCompactLayout();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AreaSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSettled, setSearchSettled] = useState(false);
  const [state, setState] = useState<LookupState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<AreaLookup | null>(null);
  const [overview, setOverview] = useState<AreaOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const [areaNavigationVersion, setAreaNavigationVersion] = useState(0);
  const [isFixture, setIsFixture] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mobileView, setMobileView] = useState<'directory' | 'map'>('map');
  const [mapRequested, setMapRequested] = useState(true);
  const [activeFeature, setActiveFeature] = useState<FeatureId>(featureFromUrl);
  const [featureMenuOpen, setFeatureMenuOpen] = useState(false);
  const [showDemoAlerts, setShowDemoAlerts] = useState(false);
  const [mapToolsOpen, setMapToolsOpen] = useState(false);
  const [searchResultsOpen, setSearchResultsOpen] = useState(false);
  const [hotlines, setHotlines] = useState<Hotline[]>([]);
  const [policeSession, setPoliceSession] = useState<WorkflowActor | null>(null);
  const [policeSessionChecking, setPoliceSessionChecking] = useState(policePortalRequested);
  const [policeLoginOpen, setPoliceLoginOpen] = useState(false);
  const [citizenSession, setCitizenSession] = useState<CitizenSession | null>(null);
  const [citizenLoginOpen, setCitizenLoginOpen] = useState(false);
  const [citizenLoginAction, setCitizenLoginAction] = useState('tiếp tục');
  const [citizenLoginNotice, setCitizenLoginNotice] = useState('');
  const [tourOpen, setTourOpen] = useState(false);
  const [recentAreas, setRecentAreas] = useState<RecentArea[]>(() => readRecentAreas());
  const [pushPrefs, setPushPrefs] = useState<PushPrefs>(() => readPushPrefs());
  const [pushSettingsOpen, setPushSettingsOpen] = useState(false);
  const [pushSettingsIntro, setPushSettingsIntro] = useState(false);
  const [pushToast, setPushToast] = useState<PushEventDetail | null>(null);
  const [caseNavigationVersion, setCaseNavigationVersion] = useState(0);
  const tourAutoStarted = useRef(false);
  const [appView, setAppView] = useState<'landing' | 'citizen' | 'officer'>(() => {
    if (policePortalRequested) return 'officer';
    return 'landing';
  });
  const requestId = useRef(0);
  const lookupRequestId = useRef(0);
  const lookupPanelRef = useRef<HTMLElement | null>(null);
  const areaSearchRef = useRef<HTMLInputElement | null>(null);
  const statusRegionRef = useRef<HTMLDivElement | null>(null);
  const resultAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const restoreFeature = () => { setActiveFeature(featureFromUrl()); setAreaNavigationVersion(value => value + 1); };
    window.addEventListener('popstate', restoreFeature);
    return () => window.removeEventListener('popstate', restoreFeature);
  }, []);

  useEffect(() => {
    void listHotlines().then(setHotlines).catch(() => setHotlines([]));
  }, []);

  useEffect(() => {
    if (policePortalRequested || appView !== 'citizen' || (activeFeature !== 'directory' && activeFeature !== 'assistant') || overview) return;
    let cancelled = false;
    setOverviewError(false);
    void getAreaOverview().then(payload => {
      if (!cancelled) { setOverview(payload.data); setIsFixture(payload.meta.dataSource === 'fixture'); }
    }).catch(() => { if (!cancelled) setOverviewError(true); });
    return () => { cancelled = true; };
  }, [overviewAttempt, policePortalRequested, appView, activeFeature, overview]);

  useEffect(() => {
    if (!citizenLoginNotice) return;
    const timer = window.setTimeout(() => setCitizenLoginNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [citizenLoginNotice]);

  useEffect(() => {
    if (!policePortalRequested) return;
    let cancelled = false;
    void getOfficerSession()
      .then((actor) => { if (!cancelled) setPoliceSession(actor); })
      .catch(() => { if (!cancelled) setPoliceSession(null); })
      .finally(() => { if (!cancelled) setPoliceSessionChecking(false); });
    return () => { cancelled = true; };
  }, [policePortalRequested]);

  useEffect(() => {
    if (appView !== 'citizen' || tourAutoStarted.current || window.localStorage.getItem(CITIZEN_TOUR_KEY)) return;
    tourAutoStarted.current = true;
    setMapRequested(true); setMobileView('map'); setActiveFeature('directory');
    const timer = window.setTimeout(() => setTourOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [appView]);

  useEffect(() => {
    if (policePortalRequested) return;
    let cancelled = false;
    void getCitizenSession()
      .then((session) => {
        if (cancelled) return;
        setCitizenSession(session);
        if (session) setAppView('citizen');
      })
      .catch(() => { if (!cancelled) setCitizenSession(null); });
    return () => { cancelled = true; };
  }, [policePortalRequested]);

  useEffect(() => {
    if (!isCompactLayout) {
      setMapRequested(true);
      lookupPanelRef.current?.scrollTo({ top: 0 });
    }
  }, [isCompactLayout]);

  useEffect(() => {
    if (!isCompactLayout || !error) return;
    const frame = window.requestAnimationFrame(() => {
      statusRegionRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'end',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, isCompactLayout]);

  useEffect(() => {
    if (!isCompactLayout || state !== 'success' || !area) return;
    const frame = window.requestAnimationFrame(() => {
      resultAnchorRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [area, isCompactLayout, state]);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (area && query.trim() === area.name) {
      setSuggestions([]);
      setSearching(false);
      setSearchSettled(false);
      return;
    }
    if (query.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      setSearchSettled(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchSettled(false);
      try {
        const results = await searchAreas(query);
        if (currentRequest === requestId.current) {
          setSuggestions(results);
          setSearchSettled(true);
        }
      } catch {
        if (currentRequest === requestId.current) {
          setSuggestions([]);
          setSearchSettled(true);
        }
      } finally {
        if (currentRequest === requestId.current) setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [area, query]);

  const acceptEnvelope = useCallback((payload: Awaited<ReturnType<typeof lookupByCode>>) => {
    setArea(payload.data);
    setQuery(payload.data.name);
    setRecentAreas(rememberArea({ code: payload.data.code, name: payload.data.name }));
    const url = new URL(window.location.href);
    url.searchParams.set('area', payload.data.code);
    window.history.replaceState(window.history.state, '', url);
    setIsFixture(payload.meta.dataSource === 'fixture');
    setState('success');
    setError(null);
    setSuggestions([]);
  }, []);

  const resolveCoordinates = useCallback(async (latitude: number, longitude: number) => {
    const current = ++lookupRequestId.current;
    setSelectedPosition({ latitude, longitude });
    setState('loading');
    setError(null);
    try {
      const payload = await lookupByLocation(latitude, longitude);
      if (current === lookupRequestId.current) acceptEnvelope(payload);
    } catch (caught) {
      if (current !== lookupRequestId.current) return;
      const message = caught instanceof ApiError ? caught.message : 'Không thể tra cứu vị trí lúc này.';
      setState('error');
      setError(message);
    }
  }, [acceptEnvelope]);

  const showProvince = useCallback(() => {
    lookupRequestId.current += 1;
    setArea(null); setSelectedPosition(null); setQuery(''); setSuggestions([]);
    setState('idle'); setError(null); setSearchSettled(false); setMobileView('map');
    const url = new URL(window.location.href);
    url.searchParams.delete('area');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const selectAreaCode = useCallback(async (code: string, showDirectory = true) => {
    const current = ++lookupRequestId.current;
    setState('loading'); setError(null);
    try {
      const payload = await lookupByCode(code);
      if (current !== lookupRequestId.current) return;
      acceptEnvelope(payload);
      // Selecting an administrative area is not the user's GPS position.
      setSelectedPosition(null);
      if (showDirectory) setMobileView('directory');
    } catch (caught) {
      if (current !== lookupRequestId.current) return;
      setState('error');
      setError(caught instanceof ApiError ? caught.message : 'Không thể tải địa bàn lúc này.');
    }
  }, [acceptEnvelope]);

  useEffect(() => {
    if (policePortalRequested) return;
    const requestedCode = new URL(window.location.href).searchParams.get('area');
    if (requestedCode) void selectAreaCode(requestedCode, false);
    else showProvince();
    return () => { lookupRequestId.current += 1; };
  }, [areaNavigationVersion, policePortalRequested, selectAreaCode, showProvince]);

  const handleCoordinateSelect = useCallback((latitude: number, longitude: number) => {
    setMobileView('directory');
    void resolveCoordinates(latitude, longitude);
  }, [resolveCoordinates]);

  const chooseArea = async (item: AreaSummary) => {
    setQuery(item.name);
    setSearchResultsOpen(false);
    setMapToolsOpen(false);
    await selectAreaCode(item.code);
  };

  const clearSearch = () => {
    setQuery('');
    setSuggestions([]);
    setSearchSettled(false);
    setSearchResultsOpen(false);
  };

  const updateSearch = (value: string) => {
    lookupRequestId.current += 1;
    setState(area ? 'success' : 'idle');
    setError(null);
    setQuery(value);
    setSearchSettled(false);
    setSearchResultsOpen(true);
    setMapToolsOpen(false);
  };

  const navigateToFeature = useCallback((feature: FeatureId) => {
    const url = new URL(window.location.href);
    if (feature === 'directory') url.searchParams.delete('feature');
    else url.searchParams.set('feature', feature);
    window.history.pushState({}, '', url);
    setActiveFeature(feature);
    setFeatureMenuOpen(false);
    if (feature === 'assistant') {
      setMapRequested(true); setMobileView('map'); setMapToolsOpen(false); setSearchResultsOpen(false);
    }
  }, []);

  const changeMapTools = useCallback((open: boolean) => {
    setMapToolsOpen(open);
    if (!open) return;
    setSearchResultsOpen(false);
    areaSearchRef.current?.blur();
    if (new URL(window.location.href).searchParams.get('feature') === 'assistant') navigateToFeature('directory');
  }, [navigateToFeature]);

  const showAlertsOnMap = () => {
    setShowDemoAlerts(true);
    showToast({ kind: 'info', topic: 'alert', title: 'Đang hiển thị cảnh báo trên bản đồ' });
    setMapRequested(true);
    setMobileView('map');
    navigateToFeature('directory');
  };

  const enterPolicePortal = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('feature');
    url.searchParams.set('portal', 'police');
    window.location.assign(url.toString());
  };

  const handlePoliceLoginSuccess = (actor: WorkflowActor) => {
    setPoliceSession(actor);
    setPoliceLoginOpen(false);
    if (!policePortalRequested) enterPolicePortal();
  };

  const handlePoliceLogout = async () => {
    try {
      if (__OFFICER_APP__) await disablePush();
      await signOutOfficer();
    } finally {
      setPoliceSession(null);
    }
    window.location.assign('./');
  };

  const handleCitizenLogout = async () => {
    try { await signOutCitizen(); } finally { clearReportDraft(); setCitizenSession(null); }
    navigateToFeature('directory');
    showToast({ kind: 'info', topic: 'account', title: 'Đã đăng xuất' });
  };

  const startTour = useCallback(() => {
    navigateToFeature('directory'); setMapRequested(true); setMobileView('map'); setFeatureMenuOpen(false);
    window.setTimeout(() => setTourOpen(true), 120);
  }, [navigateToFeature]);

  const openCase = useCallback((kind: 'incident' | 'sos', receiptCode: string) => {
    const url = new URL(window.location.href);
    const feature: FeatureId = kind === 'sos' ? 'sos' : 'reports';
    url.searchParams.set('feature', feature);
    if (kind === 'incident') {
      url.searchParams.set('reportTab', 'tracking'); url.searchParams.set('reportReceipt', receiptCode);
    } else {
      url.searchParams.set('sosStep', 'receipt'); url.searchParams.set('sosReceipt', receiptCode);
    }
    window.history.pushState({}, '', url);
    setActiveFeature(feature); setFeatureMenuOpen(false); setCaseNavigationVersion((value) => value + 1);
  }, []);

  // Thông báo ngoài màn hình: bấm vào thông báo thì mở đúng khu vực hoặc đúng hồ sơ.
  const openFromPush = useCallback((target: PushTarget) => {
    setAppView('citizen');
    if (target.type === 'alert') { navigateToFeature('alerts'); void selectAreaCode(target.areaCode, false); }
    else if (target.type === 'citizen') openCase(target.kind, target.receiptCode);
  }, [navigateToFeature, openCase, selectAreaCode]);

  const updatePushPrefs = useCallback((next: PushPrefs) => { writePushPrefs(next); setPushPrefs(next); }, []);

  // Bản cán bộ tự lo thông báo trong cổng nghiệp vụ (PolicePortal).
  useEffect(() => {
    if (!pushSupported() || __OFFICER_APP__) return;
    void initPush();
    const onPush = (event: Event) => {
      const detail = (event as CustomEvent<PushEventDetail>).detail;
      if (detail.phase === 'received') { setPushToast(detail); return; }
      const target = takePendingPushOpen();
      if (target) openFromPush(target);
    };
    window.addEventListener(PUSH_EVENT, onPush);
    const pending = takePendingPushOpen();
    if (pending) openFromPush(pending);
    return () => window.removeEventListener(PUSH_EVENT, onPush);
  }, [openFromPush]);

  // Đăng nhập/đăng xuất làm đổi tài khoản gắn với thiết bị: báo lại cho máy chủ.
  useEffect(() => { if (!__OFFICER_APP__) void syncPushDevice(); }, [citizenSession?.id]);

  // Hỏi bật thông báo đúng một lần, sau khi người dùng đã chọn một địa bàn và xem xong hướng dẫn.
  useEffect(() => {
    if (!pushSupported() || pushPrefs.asked || !area || appView !== 'citizen' || tourOpen) return;
    const timer = window.setTimeout(() => {
      setPushSettingsIntro(true); setPushSettingsOpen(true); updatePushPrefs({ ...pushPrefs, asked: true });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [area, appView, tourOpen, pushPrefs, updatePushPrefs]);

  const openPushSettings = useCallback(() => {
    setFeatureMenuOpen(false); setPushSettingsIntro(false); setPushSettingsOpen(true);
  }, []);
  const closePushSettings = useCallback(() => setPushSettingsOpen(false), []);
  const closePushToast = useCallback(() => setPushToast(null), []);

  const loading = state === 'loading';

  if (appView === 'landing') {
    return (
      <LoginScreen
        onEnterAsCitizen={() => setAppView('citizen')}
        onCitizenLoginSuccess={(session) => { setCitizenSession(session); setAppView('citizen'); }}
        onOfficerLoginSuccess={(actor) => { setPoliceSession(actor); setAppView('officer'); }}
      />
    );
  }

  if (!__CITIZEN_ONLY__ && appView === 'officer') {
    if (policeSessionChecking) return <main className="police-login-screen"><div className="queue-loading"><span className="loader" /> Đang kiểm tra phiên đăng nhập…</div></main>;
    return policeSession
      ? <Suspense fallback={<main className="police-login-screen"><div className="queue-loading"><span className="loader" /> Đang tải cổng cán bộ…</div></main>}><PolicePortal sessionActor={policeSession} onSignOut={() => { void handlePoliceLogout(); setAppView('landing'); }} /></Suspense>
      : <PoliceLoginScreen onSuccess={handlePoliceLoginSuccess} onBack={__OFFICER_APP__ ? undefined : () => setAppView('landing')} />;
  }

  return (
    <div className="app-shell" data-mobile-view={mobileView} data-active-feature={activeFeature}>
      <a className="skip-link" href={activeFeature === 'assistant' ? '#map-assistant-title' : activeFeature === 'directory' ? '#lookup-panel' : '#main-content'}>Đến nội dung chính</a>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <img src={directoryLogoUrl} alt="" width="44" height="44" />
        </div>
        <div className="brand-copy">
          <strong><span className="brand-title-full">Bản đồ số Cảnh sát khu vực</span><span className="brand-title-compact">Bản đồ CSKV</span></strong>
          <span>Công an tỉnh Lâm Đồng</span>
        </div>
        <div className="topbar-actions">
          <button className="map-assistant-trigger" type="button" aria-label="Trợ lý ảo" aria-expanded={activeFeature === 'assistant'} aria-controls={activeFeature === 'assistant' ? 'map-assistant-title' : undefined} onClick={() => navigateToFeature(activeFeature === 'assistant' ? 'directory' : 'assistant')}><MessageSquareText size={20} aria-hidden="true" /><span>Trợ lý</span></button>
          <CitizenNotifications key={citizenSession?.id ?? 'guest'} sessionId={citizenSession?.id ?? null}
            onRequireLogin={() => { setCitizenSession(null); setCitizenLoginAction('xem thông báo xử lý hồ sơ'); setCitizenLoginOpen(true); }}
            onOpenCase={(notification) => openCase(notification.kind, notification.receiptCode)} />
          {!citizenSession && <button className="citizen-login-trigger" data-tour="account" type="button" onClick={() => { setCitizenLoginAction('sử dụng ứng dụng người dân'); setCitizenLoginOpen(true); }} aria-label="Đăng nhập hoặc đăng ký tài khoản người dân" title="Tài khoản người dân"><UserRoundCheck size={22} aria-hidden="true" /></button>}
          {citizenSession && <button className="citizen-session-button" data-tour="account" type="button" onClick={() => navigateToFeature('account')} title="Mở tài khoản người dân"><UserRoundCheck size={17} /><span>{citizenSession.displayName}</span></button>}
          <button
            className="feature-menu-button"
            data-tour="feature-menu"
            type="button"
            onClick={() => setFeatureMenuOpen(true)}
            aria-expanded={featureMenuOpen}
            aria-controls="feature-drawer"
          >
            <Menu size={20} aria-hidden="true" /><span>Tính năng</span>
          </button>
        </div>
      </header>

      {activeFeature === 'directory' || activeFeature === 'assistant' ? (
        <main className="workspace">
          <aside ref={lookupPanelRef} className="lookup-panel" id="lookup-panel" aria-label="Tìm kiếm và danh bạ địa bàn">
            <div className="panel-intro">
              <h1>Danh bạ địa bàn</h1>
              <button type="button" onClick={() => {
                setMobileView('map');
                // Restore focus to the trigger, not the search input: focusing
                // an input opens the keyboard and hides mobile navigation.
                window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.directory-toggle')?.focus({ preventScroll: true }));
              }} aria-label="Thu gọn danh bạ"><X size={20} aria-hidden="true" /></button>
            </div>

            <div className="search-block">
              <label htmlFor="area-search">Tên đơn vị, xã/phường hoặc mã địa bàn</label>
              <div className="search-field">
                <Search size={18} aria-hidden="true" />
                <input
                  id="area-search"
                  ref={areaSearchRef}
                  name="area-search"
                  type="search"
                  autoComplete="off"
                  value={query}
                  onFocus={() => { setSearchResultsOpen(true); setMapToolsOpen(false); if (activeFeature === 'assistant') navigateToFeature('directory'); }}
                  onChange={(event) => updateSearch(event.target.value)}
                  // Xóa ô tìm nhưng không gõ gì: trả lại tên địa bàn đang xem (bản đồ và danh bạ giữ nguyên).
                  onBlur={() => { if (area && !query.trim()) window.setTimeout(() => setQuery((current) => current.trim() ? current : area.name), 150); }}
                  placeholder="Tìm xã/phường hoặc mã địa bàn…"
                  aria-controls="area-suggestions"
                  aria-expanded={suggestions.length > 0}
                />
                {query && (
                  <button type="button" onClick={() => { clearSearch(); if (area) areaSearchRef.current?.focus({ preventScroll: true }); }} aria-label="Xóa nội dung tìm kiếm"><X size={17} aria-hidden="true" /></button>
                )}
                <button type="button" className="directory-toggle" onClick={() => setMobileView((view) => view === 'map' ? 'directory' : 'map')} aria-label={mobileView === 'map' ? 'Mở danh bạ địa bàn' : 'Thu gọn danh bạ'} aria-expanded={mobileView === 'directory'} aria-controls="directory-results"><ContactRound size={20} aria-hidden="true" /></button>
              </div>
              <div className="province-navigation">
                <select aria-label="Chọn xã/phường" value={area?.code ?? ''} disabled={!overview}
                  onFocus={() => { setMapToolsOpen(false); if (activeFeature === 'assistant') navigateToFeature('directory'); }}
                  onChange={event => { if (event.target.value) void selectAreaCode(event.target.value); else showProvince(); }}>
                  <option value="">{overview ? `Toàn tỉnh Lâm Đồng · ${overview.features.length} xã/phường` : overviewError ? 'Chưa tải được danh sách địa bàn' : 'Đang tải danh sách địa bàn…'}</option>
                  {overview?.features.map(feature => <option key={feature.id} value={feature.id}>{feature.properties.name}</option>)}
                </select>
                {area && <button type="button" onClick={showProvince}>Toàn tỉnh</button>}
              </div>
              {overviewError && <div className="overview-error" role="alert">Chưa tải được ranh giới toàn tỉnh. <button type="button" onClick={() => setOverviewAttempt(value => value + 1)}>Thử lại</button></div>}
              {searchResultsOpen && (suggestions.length > 0 || searching) && (
                <div className="suggestions" id="area-suggestions" role="listbox" aria-label="Kết quả tìm địa bàn">
                  {searching && suggestions.length === 0 ? (
                    <div className="suggestion-loading">Đang tìm…</div>
                  ) : suggestions.map((item) => (
                    <button key={item.code} type="button" role="option" aria-selected="false" onClick={() => void chooseArea(item)}>
                      <MapPinned size={18} aria-hidden="true" />
                      <span><strong>{item.name}</strong><small>{item.code} · {item.provinceName}</small></span>
                    </button>
                  ))}
                </div>
              )}
              {searchResultsOpen && searchSettled && !searching && suggestions.length === 0 && query.trim().length >= 2 && (
                <p className="search-empty" role="status">Không tìm thấy địa bàn phù hợp. Hãy kiểm tra tên hoặc thử mã địa bàn.</p>
              )}
            </div>

            <div className="status-region" ref={statusRegionRef} aria-live="polite">
              {loading && <div className="loading-card"><span className="loader" /> Đang đối chiếu ranh giới địa bàn…</div>}
              {error && (
                <div className="error-card" role="alert">
                  <strong>Chưa thể tra cứu</strong>
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div id="directory-results" hidden={mobileView !== 'directory'}>
            {area ? (
              <div className="result-anchor" ref={resultAnchorRef}>
                <DirectoryPanel area={area} isFixture={isFixture} hotlines={hotlines} />
              </div>
            ) : (
              state === 'idle' && (
                <div className="empty-state">
                  <span className="empty-state-icon"><ShieldCheck size={22} aria-hidden="true" /></span>
                  <div>
                    <strong>Chọn một xã/phường trên bản đồ hoặc tìm ở trên.</strong>
                  </div>
                </div>
              )
            )}
            {!area && state === 'idle' && recentAreas.length > 0 && (
              <section className="recent-areas" aria-labelledby="recent-areas-title">
                <h2 id="recent-areas-title">Đã xem gần đây</h2>
                <div>
                  {recentAreas.map(item => <button key={item.code} type="button" onClick={() => void selectAreaCode(item.code)}><MapPinned size={16} aria-hidden="true" />{item.name}</button>)}
                </div>
              </section>
            )}
            </div>
          </aside>

          {mapRequested && (
            <Suspense fallback={<section id="map-panel" className="map-pane map-loading" aria-label="Đang tải bản đồ"><span className="loader" /> Đang tải bản đồ…</section>}>
              <MapPane
                area={area}
                overview={overview}
                onAreaSelect={code => { if (activeFeature === 'assistant') { navigateToFeature('directory'); void selectAreaCode(code, false); } else void selectAreaCode(code); }}
                selectedPosition={selectedPosition}
                onCoordinateSelect={handleCoordinateSelect}
                showDemoAlerts={showDemoAlerts}
                hotlines={hotlines}
                onOpenSos={() => navigateToFeature('sos')}
                toolMenuOpen={mapToolsOpen}
                onToolMenuOpenChange={changeMapTools}
                onMapTapGuard={() => {
                  // Điện thoại: bảng danh bạ đang mở thì chạm lên bản đồ phía sau chỉ đóng bảng, giống nút X (không nhảy sang xã khác).
                  if (!isCompactLayout || mobileView !== 'directory') return false;
                  setMobileView('map');
                  window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.directory-toggle')?.focus({ preventScroll: true }));
                  return true;
                }}
              />
            </Suspense>
          )}
          {activeFeature === 'assistant' && <Suspense fallback={<div className="map-assistant" role="status">Đang tải trợ lý ảo…</div>}>
            <MapAssistant areaCode={area?.code ?? null} areaName={area?.name ?? null}
              onAreaSelect={code => { navigateToFeature('directory'); setMobileView('map'); void selectAreaCode(code, false); }}
              onClose={() => { navigateToFeature('directory'); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.map-assistant-trigger')?.focus({ preventScroll: true })); }}
              onOpenSos={() => navigateToFeature('sos')}
              onOpenReports={() => navigateToFeature('reports')} />
          </Suspense>}
        </main>
      ) : (
        <ScreenErrorBoundary key={`${activeFeature}:${caseNavigationVersion}`}>
        <Suspense fallback={<main className="feature-workspace"><div className="queue-loading"><span className="loader" /> Đang tải tính năng…</div></main>}>
          <FeaturePage
            key={caseNavigationVersion}
            feature={activeFeature}
            areaCode={area?.code ?? null}
            areaName={area?.name ?? null}
            selectedPosition={selectedPosition}
            isAuthenticated={Boolean(citizenSession)}
            onRequireLogin={(action) => { setCitizenLoginAction(action); setCitizenLoginOpen(true); }}
            onBack={() => { navigateToFeature('directory'); setMobileView('map'); }}
            onShowAlertsOnMap={showAlertsOnMap}
            citizenSession={citizenSession}
            onCitizenLogout={() => void handleCitizenLogout()}
            onNavigate={navigateToFeature}
            onStartTour={startTour}
          />
        </Suspense>
        </ScreenErrorBoundary>
      )}

      <nav className="mobile-tabs" aria-label="Điều hướng chính">
        <button
          type="button"
          className={activeFeature === 'directory' && mobileView === 'map' ? 'active' : ''}
          aria-pressed={activeFeature === 'directory' && mobileView === 'map'}
          aria-controls={mapRequested ? 'map-panel' : undefined}
          onClick={() => {
            navigateToFeature('directory');
            setMapRequested(true);
            setMobileView('map');
          }}
        >
          <Map size={23} aria-hidden="true" />
          <span>Bản đồ</span>
        </button>
        <button
          type="button"
          className={activeFeature === 'directory' && mobileView === 'directory' ? 'active' : ''}
          aria-pressed={activeFeature === 'directory' && mobileView === 'directory'}
          aria-controls="lookup-panel"
          onClick={() => { navigateToFeature('directory'); setMobileView('directory'); }}
        >
          <ContactRound size={23} aria-hidden="true" />
          <span>Danh bạ</span>
        </button>
        <button
          type="button"
          className={activeFeature === 'reports' ? 'active' : ''}
          aria-pressed={activeFeature === 'reports'}
          onClick={() => navigateToFeature('reports')}
        >
          <FileWarning size={23} aria-hidden="true" />
          <span>Phản ánh</span>
        </button>
        <button
          type="button"
          data-tour="account"
          className={activeFeature === 'account' ? 'active' : ''}
          aria-pressed={activeFeature === 'account'}
          onClick={() => navigateToFeature('account')}
        >
          <UserRound size={23} aria-hidden="true" />
          <span>Tài khoản</span>
        </button>
      </nav>

      <FeatureDrawer open={featureMenuOpen} activeFeature={activeFeature} onClose={() => setFeatureMenuOpen(false)} onSelect={(feature) => { navigateToFeature(feature); if (feature === 'directory') setMobileView('directory'); }} onStartTour={startTour} onOpenNotifications={openPushSettings} notificationsReady={pushSupported()} onOfficerLogin={__CITIZEN_ONLY__ ? undefined : () => { setFeatureMenuOpen(false); setPoliceLoginOpen(true); }} />
      {!__CITIZEN_ONLY__ && <PoliceLoginDialog open={policeLoginOpen} onSuccess={handlePoliceLoginSuccess} onClose={() => setPoliceLoginOpen(false)} />}
      <CitizenAuthSheet open={citizenLoginOpen && !citizenSession} action={citizenLoginAction} onClose={() => setCitizenLoginOpen(false)} onSuccess={(session) => { setCitizenSession(session); setCitizenLoginOpen(false); setCitizenLoginNotice('Đăng nhập tài khoản thành công.'); }} />
      {citizenLoginNotice && <div className="citizen-login-success" role="status" aria-live="polite"><ShieldCheck size={20} aria-hidden="true" /><span>{citizenLoginNotice}</span></div>}
      <NotificationSettings open={pushSettingsOpen} intro={pushSettingsIntro} currentArea={area ? { code: area.code, name: area.name } : null} prefs={pushPrefs} onPrefsChange={updatePushPrefs} onClose={closePushSettings} />
      <OfflineBanner />
      <AppToasts />
      <PushToast toast={pushToast} onOpen={(toast) => { if (toast.target) openFromPush(toast.target); }} onClose={closePushToast} />
      <CitizenOnboardingTour open={tourOpen} onClose={(completed) => { setTourOpen(false); window.localStorage.setItem(CITIZEN_TOUR_KEY, completed ? 'completed' : 'skipped'); }} />
    </div>
  );
}
