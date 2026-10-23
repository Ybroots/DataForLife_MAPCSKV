import { FormEvent, useEffect, useRef, useState } from 'react';
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
import { ApiError, createSatisfactionRating, listCitizenIncidents, listPublicAlerts } from '../api';
import type { Incident, PublicAlert } from '../types';
import type { CitizenSession } from '../types';
import { CitizenReportsPage } from './CitizenReportsPage';
import { CitizenSosPage, EmergencyCallStrip } from './CitizenSosPage';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';
import { CitizenAccountPage } from './CitizenAccountPage';
import { CitizenFeatureAuthGate } from './CitizenFeatureAuthGate';

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
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [alerts, setAlerts] = useState<PublicAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const [feedbackIncidents, setFeedbackIncidents] = useState<Incident[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

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

  useEffect(() => {
    if (feature !== 'feedback' || !isAuthenticated) { setFeedbackIncidents([]); return; }
    setFeedbackLoading(true);
    listCitizenIncidents()
      .then((payload) => setFeedbackIncidents(payload.data.filter((item) => ['resolved', 'closed'].includes(item.status))))
      .catch(() => setFeedbackIncidents([]))
      .finally(() => setFeedbackLoading(false));
  }, [feature, isAuthenticated]);

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(event.currentTarget);
    const receiptCode = String(data.get('case-id') ?? '').trim();
    const score = Number(data.get('rating'));
    const comment = String(data.get('comment') ?? '').trim();
    setFeedbackNotice('Đang gửi đánh giá…');
    try {
      await createSatisfactionRating(receiptCode, score, comment);
      setFeedbackNotice('Đánh giá đã được ghi nhận. Cảm ơn bạn đã góp ý.');
      form.reset();
    } catch (error) {
      setFeedbackNotice(error instanceof ApiError ? error.message : 'Chưa thể gửi đánh giá lúc này.');
    }
  };

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

        {feature === 'feedback' && (
          <section className="feature-section form-section" aria-labelledby="feedback-title">
            <h2 id="feedback-title">Tra cứu lời mời đánh giá</h2>
            <p className="section-lead">Chỉ phản ánh đã có kết quả hoặc đã đóng mới đủ điều kiện đánh giá.</p>
            {!isAuthenticated ? <VneIdLoginPrompt action="xem phản ánh đủ điều kiện đánh giá" onLogin={() => onRequireLogin('gửi đánh giá')} /> : (
              <>
                {feedbackLoading && <p className="workflow-empty">Đang kiểm tra phản ánh đã hoàn tất…</p>}
                {!feedbackLoading && feedbackIncidents.length === 0 && <p className="workflow-empty">Chưa có phản ánh đã xử lý xong để đánh giá.</p>}
                {feedbackIncidents.length > 0 && <form onSubmit={submitFeedback}>
                  <label>Phản ánh đã hoàn tất
                    <select name="case-id" required>{feedbackIncidents.map((item) => <option key={item.id} value={item.receiptCode}>{item.receiptCode} · {item.summary}</option>)}</select>
                  </label>
                  <fieldset className="rating-options">
                    <legend>Mức độ hài lòng</legend>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <label key={score}><input type="radio" name="rating" value={score} required /><Star size={18} aria-hidden="true" /><span>{score}</span></label>
                    ))}
                  </fieldset>
                  <label>Góp ý thêm
                    <textarea name="comment" maxLength={1000} rows={4} placeholder="Nội dung góp ý (không bắt buộc)" />
                  </label>
                  <button className="primary-action" type="submit"><Star size={18} aria-hidden="true" /> Gửi đánh giá</button>
                </form>}
              </>
            )}
            {feedbackNotice && <p className="inline-notice" role="status">{feedbackNotice}</p>}
          </section>
        )}

      </div>
    </main>
  );
}
