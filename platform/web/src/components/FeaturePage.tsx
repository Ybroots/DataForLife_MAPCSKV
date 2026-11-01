import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
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
import { CitizenSosPage, EmergencyCallStrip } from './CitizenSosPage';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { CitizenAccountPage } from './CitizenAccountPage';
import { CitizenFeatureAuthGate } from './CitizenFeatureAuthGate';
import { CitizenFeedbackPage } from './CitizenFeedbackPage';

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

const featureDescriptions: Record<Exclude<FeatureId, 'directory' | 'assistant'>, string> = {
  alerts: 'Cảnh báo đang hiệu lực do cán bộ địa bàn phát hành.',
  reports: 'Gửi phản ánh kèm vị trí, nhận mã tiếp nhận và theo dõi toàn bộ tiến trình xử lý.',
  sos: 'Luồng khẩn cấp local có bước kiểm tra cuối, mã tiếp nhận và đồng bộ trạng thái từ cổng CSKV.',
  feedback: 'Chỉ cho phép đánh giá sau khi mã vụ việc được xác nhận hoàn thành.',
  account: 'Quản lý phiên đăng nhập, phản ánh đã gửi và các tùy chọn hỗ trợ.',
};

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
    return () => { cancelled = true; };
  }, [areaCode, feature]);


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
          {feature !== 'reports' && feature !== 'sos' && (
            <span className="mode-badge active">
              Hoạt động
            </span>
          )}
        </header>

        {feature !== 'sos' && feature !== 'account' && !featureNeedsCitizenLogin && <div className="feature-heading">
          <p className="eyebrow">{feature === 'reports' ? 'Gửi phản ánh' : 'Tính năng tích hợp'}</p>
          <h1 ref={headingRef} tabIndex={-1}>{FEATURE_LABELS[feature]}</h1>
          <p>{featureDescriptions[feature]}</p>
        </div>}

        {feature === 'alerts' && (
          <section className="feature-section" aria-labelledby="alerts-title">
            <div className="section-title-row">
              <div>
                <h2 id="alerts-title">Cảnh báo {areaName ? `tại ${areaName}` : 'theo địa bàn'}</h2>
                <p>Dữ liệu do cán bộ trực ban phát hành trong phạm vi địa bàn.</p>
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

        {feature === 'reports' && (
          isAuthenticated
            ? <CitizenReportsPage selectedPosition={selectedPosition} isAuthenticated onRequireLogin={() => onRequireLogin('gửi phản ánh')} />
            : <CitizenFeatureAuthGate feature="reports" onLogin={() => onRequireLogin('gửi phản ánh')} />
        )}

        {feature === 'sos' && (
          isAuthenticated
            ? <CitizenSosPage isAuthenticated onRequireLogin={() => onRequireLogin('sử dụng SOS')} />
            : <><EmergencyCallStrip /><CitizenFeatureAuthGate feature="sos" onLogin={() => onRequireLogin('sử dụng SOS')} /></>
        )}

        {feature === 'account' && <CitizenAccountPage session={citizenSession} areaName={areaName} onLogin={() => onRequireLogin('xem tài khoản')} onLogout={onCitizenLogout} onNavigate={onNavigate} onStartTour={onStartTour} />}

        {feature === 'feedback' && <CitizenFeedbackPage isAuthenticated={isAuthenticated} onRequireLogin={() => onRequireLogin('gửi đánh giá')} />}

      </div>
    </main>
  );
}
