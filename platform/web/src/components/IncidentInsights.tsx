import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, Link2Off, Sparkles } from 'lucide-react';
import {
  ApiError,
  decideIncidentCategory,
  getAiStatus,
  getIncidentAiReview,
  listIncidentDuplicates,
  requestIncidentAiReview,
  setIncidentDuplicateOf,
} from '../api';
import type { DuplicateCandidate, ImageLabel, Incident, IncidentAiReview } from '../types';

interface IncidentInsightsProps {
  incident: Incident;
  categoryLabels: Record<string, string>;
  onIncidentChange: (incident: Incident) => void;
  onOpenCase: (id: string) => void;
}

export const imageLabelText: Record<ImageLabel, string> = {
  fire_smoke: 'Lửa, khói',
  traffic_accident: 'Tai nạn giao thông',
  crowd_gathering: 'Đám đông, tụ tập',
  fighting_or_weapon: 'Xô xát, hung khí',
  flood_or_landslide: 'Ngập, sạt lở',
  property_damage: 'Tài sản hư hỏng',
  waste_or_pollution: 'Rác, ô nhiễm',
  document_or_screenshot: 'Giấy tờ, ảnh màn hình',
  no_incident_visible: 'Không thấy sự việc',
  unclear: 'Không rõ',
};

const confidenceText: Record<IncidentAiReview['confidence'], string> = { low: 'thấp', medium: 'trung bình', high: 'cao' };

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** "45 phút", "3 giờ 10 phút". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

/** Phản ánh có thể trùng (quy tắc + so khớp nội dung) và gợi ý lĩnh vực/nhận biết ảnh của AI. Cán bộ quyết định. */
export function IncidentInsights({ incident, categoryLabels, onIncidentChange, onOpenCase }: IncidentInsightsProps) {
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [review, setReview] = useState<IncidentAiReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const linked = incident.duplicateOf ?? null;
  const children = incident.duplicates ?? [];

  useEffect(() => {
    let active = true;
    setCandidates(null);
    setReview(null);
    setError('');
    if (!linked && !children.length) {
      listIncidentDuplicates(incident.id).then((items) => { if (active) setCandidates(items); }).catch(() => { if (active) setCandidates([]); });
    }
    // Không ghi đè gợi ý vừa nhận nếu cán bộ bấm "Nhờ AI gợi ý" trước khi lần tải đầu xong.
    getIncidentAiReview(incident.id).then((item) => { if (active) setReview((current) => current ?? item); }).catch(() => undefined);
    getAiStatus().then((status) => { if (active) setAiConfigured(status.configured && status.features.includes('incident_review')); }).catch(() => undefined);
    return () => { active = false; };
  }, [incident.id, linked?.id, children.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (primaryId: string | null) => {
    setBusy(primaryId ? `link:${primaryId}` : 'unlink');
    setError('');
    try {
      onIncidentChange(await setIncidentDuplicateOf(incident.id, primaryId));
    } catch (caught) {
      setError(errorText(caught, 'Chưa gộp được hồ sơ. Hãy thử lại.'));
    } finally {
      setBusy(null);
    }
  };

  const askAi = async () => {
    setBusy('ai');
    setError('');
    try {
      setReview(await requestIncidentAiReview(incident.id));
    } catch (caught) {
      setError(errorText(caught, 'Chưa kết nối được AI. Hãy thử lại sau.'));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (category: Incident['category']) => {
    if (!review) return;
    setBusy('decide');
    setError('');
    try {
      const updated = await decideIncidentCategory(incident.id, category, review.id);
      onIncidentChange(updated);
      setReview(await getIncidentAiReview(incident.id));
    } catch (caught) {
      setError(errorText(caught, 'Chưa lưu được quyết định. Hãy thử lại.'));
    } finally {
      setBusy(null);
    }
  };

  const suggestedId = incident.suggestedDuplicateOf?.id;
  const closed = ['closed', 'rejected'].includes(incident.status);
  const showDuplicates = Boolean(linked) || children.length > 0 || Boolean(candidates && candidates.length > 0);
  const showAi = Boolean(review) || aiConfigured;
  const attachmentIndex = new Map(incident.attachments.map((attachment, index) => [attachment.id, index + 1]));

  return (
    <>
      {showDuplicates && <section className="ops-card incident-duplicates-card" aria-labelledby={`dup-title-${incident.id}`}>
        <div className="ops-card-title"><h3 id={`dup-title-${incident.id}`}>Phản ánh trùng</h3><Copy size={19} aria-hidden="true" /></div>
        {linked && (
          <div className="duplicate-linked">
            <p>Đã gộp vào hồ sơ chính <strong>{linked.receiptCode}</strong>. Xử lý và trả lời người dân ở hồ sơ chính.</p>
            <div className="duplicate-actions">
              <button type="button" onClick={() => onOpenCase(linked.id)}><ExternalLink size={16} aria-hidden="true" /> Mở hồ sơ chính</button>
              <button type="button" className="secondary" disabled={busy !== null} onClick={() => void link(null)}><Link2Off size={16} aria-hidden="true" /> {busy === 'unlink' ? 'Đang bỏ gộp…' : 'Bỏ gộp'}</button>
            </div>
          </div>
        )}
        {!linked && children.length > 0 && (
          <div className="duplicate-linked">
            <p>Hồ sơ chính của {children.length} phản ánh trùng:</p>
            <ul className="duplicate-children">
              {children.map((child) => <li key={child.id}><button type="button" onClick={() => onOpenCase(child.id)}>{child.receiptCode}</button></li>)}
            </ul>
          </div>
        )}
        {!linked && !children.length && candidates && candidates.length > 0 && (
          <ul className="duplicate-candidates">
            {candidates.map((item) => {
              const primary = item.duplicateOf ?? { id: item.id, receiptCode: item.receiptCode };
              return (
                <li key={item.id} className={item.id === suggestedId || primary.id === suggestedId ? 'suggested' : ''}>
                  <div className="duplicate-head">
                    <span className={`duplicate-level ${item.level}`}>{item.level === 'likely' ? 'Rất có thể trùng' : 'Có thể trùng'}</span>
                    <code>{item.receiptCode}</code>
                    {(item.id === suggestedId || primary.id === suggestedId) && <span className="duplicate-suggested">Hệ thống gợi ý</span>}
                  </div>
                  <strong>{item.summary}</strong>
                  <small>
                    Cách {item.distanceM} m · {minutesLabel(item.minutesApart)}{item.sameCategory ? '' : ` · ${categoryLabels[item.category] ?? item.category}`}
                    {item.duplicateOf ? ` · đã gộp vào ${item.duplicateOf.receiptCode}` : ''}
                  </small>
                  <div className="duplicate-actions">
                    <button type="button" disabled={busy !== null || closed} onClick={() => void link(primary.id)}>
                      <Link2 size={16} aria-hidden="true" /> {busy === `link:${primary.id}` ? 'Đang gộp…' : `Gộp vào ${primary.receiptCode}`}
                    </button>
                    <button type="button" className="secondary" onClick={() => onOpenCase(item.id)}><ExternalLink size={16} aria-hidden="true" /> Xem</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>}

      {showAi && <section className="ops-card incident-ai-card" aria-labelledby={`ai-title-${incident.id}`}>
        <div className="ops-card-title"><h3 id={`ai-title-${incident.id}`}>AI gợi ý lĩnh vực và đọc ảnh</h3><Sparkles size={19} aria-hidden="true" /></div>
        {!review && aiConfigured && (
          <button type="button" className="insight-primary" disabled={busy !== null || closed} onClick={() => void askAi()}>
            <Sparkles size={16} aria-hidden="true" /> {busy === 'ai' ? 'AI đang đọc hồ sơ và ảnh…' : 'Nhờ AI gợi ý'}
          </button>
        )}
        {review && (
          <div className="ai-review">
            <p>
              Gợi ý: <strong>{categoryLabels[review.suggestedCategory] ?? review.suggestedCategory}</strong>
              {' '}<span className={`ai-confidence ${review.confidence}`}>độ tin cậy {confidenceText[review.confidence]}</span>
            </p>
            {review.reason && <p className="ai-reason">{review.reason}</p>}
            {review.imageFindings.length > 0 && (
              <ul className="ai-image-findings">
                {review.imageFindings.map((finding) => (
                  <li key={finding.attachmentId}>
                    <span>Ảnh {attachmentIndex.get(finding.attachmentId) ?? '?'}</span>
                    {finding.labels.map((label) => <em key={label}>{imageLabelText[label] ?? label}</em>)}
                  </li>
                ))}
              </ul>
            )}
            {review.decision === null && !closed && (
              <div className="duplicate-actions">
                {review.suggestedCategory !== incident.category && (
                  <button type="button" disabled={busy !== null} onClick={() => void decide(review.suggestedCategory)}>
                    Áp dụng: {categoryLabels[review.suggestedCategory] ?? review.suggestedCategory}
                  </button>
                )}
                <button type="button" className={review.suggestedCategory !== incident.category ? 'secondary' : ''} disabled={busy !== null} onClick={() => void decide(incident.category)}>
                  {review.suggestedCategory === incident.category ? 'Xác nhận đúng lĩnh vực' : `Giữ: ${categoryLabels[incident.category] ?? incident.category}`}
                </button>
              </div>
            )}
            {review.decision !== null && review.decidedCategory && (
              <p className="insight-muted">
                Cán bộ đã chọn <strong>{categoryLabels[review.decidedCategory] ?? review.decidedCategory}</strong>
                {review.decision === 'accepted' ? ' (theo gợi ý AI).' : ' (khác gợi ý AI).'}
              </p>
            )}
            {review.decision !== null && aiConfigured && !closed && (
              <button type="button" className="text-action" disabled={busy !== null} onClick={() => void askAi()}>Gợi ý lại</button>
            )}
          </div>
        )}
      </section>}
      {error && <p className="inline-notice error" role="alert">{error}</p>}
    </>
  );
}
