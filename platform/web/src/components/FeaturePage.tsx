import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { showToast } from '../toast';
import {
  ArrowLeft,
  ExternalLink,
  MapPinned,
  Navigation,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { FEATURE_LABELS, type FeatureId } from '../features';
import { listPublicAlerts } from '../api';
import type { PublicAlert } from '../types';
import type { CitizenSession } from '../types';
import { CitizenReportsPage } from './CitizenReportsPage';
import { CitizenSosPage } from './CitizenSosPage';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { CitizenAccountPage } from './CitizenAccountPage';
import { CitizenFeatureAuthGate } from './CitizenFeatureAuthGate';
import { CitizenFeedbackPage } from './CitizenFeedbackPage';
import { StatsPage } from './StatsPage';

interface FeaturePageProps {
  feature: Exclude<FeatureId, 'directory' | 'assistant'>;
  onBack: () => void;
  onShowAlertsOnMap: () => void;
  selectedPosition: { latitude: number; longitude: number } | null;
  areaCode: string | null;
  areaName: string | null;
  isAuthenticated: boolean;
  onRequireLogin: (action: string) => void;
  citizenSession: CitizenSession | null;
  onCitizenLogout: () => void;
  onNavigate: (feature: FeatureId) => void;
  onStartTour: () => void;
}

function mapsDirectionUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

const alertCategoryLabels: Record<PublicAlert['category'], string> = {
  security: 'An ninh', traffic: 'Giao thông', fire_rescue: 'PCCC/CNCH', weather: 'Thời tiết', other: 'Khác',
};

export function FeaturePage({ feature, onBack, onShowAlertsOnMap, selectedPosition, areaCode, areaName, isAuthenticated, onRequireLogin, citizenSession, onCitizenLogout, onNavigate, onStartTour }: FeaturePageProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [alerts, setAlerts] = useState<PublicAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsFailed, setAlertsFailed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [feature]);

  useEffect(() => {
    let cancelled = false;
    setAlerts([]); setAlertsLoading(false); setAlertsFailed(false);
    if (feature !== 'alerts' || !areaCode) return;
    setAlertsLoading(true);
    listPublicAlerts(areaCode).then(value => { if (!cancelled) setAlerts(value); })
      .catch(() => { if (!cancelled) setAlertsFailed(true); })
      .finally(() => { if (!cancelled) setAlertsLoading(false); });
    // Cảnh báo luôn mới: tự tải lại mỗi phút khi đang mở trang, có cảnh báo mới thì báo bằng popup.
    let known: Set<string> | null = null;
    const refresh = () => {
      if (document.hidden) return;
      listPublicAlerts(areaCode).then(value => {
        if (cancelled) return;
        if (known && value.some(alert => !known!.has(alert.id))) showToast({ kind: 'warning', topic: 'alert', title: 'Có cảnh báo mới tại khu vực', message: areaName ?? undefined });
        known = new Set(value.map(alert => alert.id));
        setAlerts(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 60_000);
    listPublicAlerts(areaCode).then(value => { known = new Set(value.map(alert => alert.id)); }).catch(() => undefined);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [areaCode, areaName, feature]);


  const featureNeedsCitizenLogin = !isAuthenticated && (feature === 'reports' || feature === 'sos');

  return (
    <main className="feature-workspace" id="main-content">
      <div className="feature-page">
        <header className="feature-page-header">
          <a className="back-button" href="./" onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onBack();
          }}>
            <ArrowLeft size={19} aria-hidden="true" />
            <span>Về bản đồ</span>
          </a>
        </header>

        {feature !== 'sos' && feature !== 'account' && !featureNeedsCitizenLogin && <div className="feature-heading">
          <h1 ref={headingRef} tabIndex={-1}>{FEATURE_LABELS[feature]}</h1>
        </div>}

        {feature === 'alerts' && (
          <section className="feature-section" aria-labelledby="alerts-title">
            <div className="section-title-row">
              <div>
                <h2 id="alerts-title">{areaName ?? 'Chưa chọn địa bàn'}</h2>
              </div>
              <button className="secondary-action" type="button" onClick={onShowAlertsOnMap}>
                <MapPinned size={18} aria-hidden="true" /> Xem trên bản đồ
              </button>
            </div>
            <div className="alert-demo-list">
              {alertsLoading && <p className="workflow-empty">Đang tải cảnh báo…</p>}
              {!areaCode && <p className="workflow-empty">Hãy chọn xã/phường trên bản đồ để xem cảnh báo đúng địa bàn.</p>}
              {alertsFailed && <p className="workflow-empty" role="alert">Chưa tải được cảnh báo. Vui lòng thử mở lại địa bàn.</p>}
              {areaCode && !alertsLoading && !alertsFailed && alerts.length === 0 && <p className="workflow-empty">Hiện chưa có cảnh báo đang hiệu lực tại địa bàn.</p>}
              {alerts.map((alert) => (
                <article className="alert-demo-card" key={alert.id}>
                  <span className="alert-demo-icon"><ShieldAlert size={21} aria-hidden="true" /></span>
                  <div>
                    <div className="card-kicker"><span>{alert.riskLevel === 'high' ? 'Mức cao' : alert.riskLevel === 'medium' ? 'Mức vừa' : 'Thông tin'}</span><span>{alertCategoryLabels[alert.category]}</span></div>
                    <h3>{alert.title}</h3>
                    <p>{alert.summary}</p>
                    <small>Hiệu lực đến {new Date(alert.endsAt).toLocaleString('vi-VN')}</small>
                  </div>
                  {alert.latitude !== null && alert.longitude !== null && <a href={mapsDirectionUrl(alert.latitude, alert.longitude)} target="_blank" rel="noreferrer">
                    <Navigation size={17} aria-hidden="true" /> Chỉ đường <ExternalLink size={14} aria-hidden="true" />
                  </a>}
                </article>
              ))}
            </div>
          </section>
        )}

        {feature === 'stats' && <StatsPage />}

        {feature === 'reports' && (
          isAuthenticated
            ? <CitizenReportsPage selectedPosition={selectedPosition} isAuthenticated onRequireLogin={() => onRequireLogin('gửi phản ánh')} />
            : <CitizenFeatureAuthGate feature="reports" onLogin={() => onRequireLogin('gửi phản ánh')} />
        )}

        {feature === 'sos' && (
          isAuthenticated
            ? <CitizenSosPage isAuthenticated onRequireLogin={() => onRequireLogin('sử dụng SOS')} />
            : <CitizenFeatureAuthGate feature="sos" onLogin={() => onRequireLogin('sử dụng SOS')} />
        )}

        {feature === 'account' && <CitizenAccountPage session={citizenSession} areaName={areaName} onLogin={() => onRequireLogin('xem tài khoản')} onLogout={onCitizenLogout} onNavigate={onNavigate} onStartTour={onStartTour} />}

        {feature === 'feedback' && <CitizenFeedbackPage isAuthenticated={isAuthenticated} onRequireLogin={() => onRequireLogin('gửi đánh giá')} />}

      </div>
    </main>
  );
}
