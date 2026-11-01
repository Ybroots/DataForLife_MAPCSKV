import { FormEvent, useEffect, useState } from 'react';
import { Smartphone, Star } from 'lucide-react';
import { ApiError, createSatisfactionRating, createSosRating, getAppRating, listCitizenIncidents, listCitizenSos, saveAppRating } from '../api';
import type { AppRating } from '../types';
import { VneIdLoginPrompt } from './VneIdLoginPrompt';

interface CitizenFeedbackPageProps {
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

interface RatableCase {
  key: string;
  kind: 'incident' | 'sos';
  receiptCode: string;
  label: string;
  rated: boolean;
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Chưa thể gửi đánh giá lúc này.';
}

function RatingOptions({ name, legend, defaultScore }: { name: string; legend: string; defaultScore?: number }) {
  return (
    <fieldset className="rating-options">
      <legend>{legend}</legend>
      {[1, 2, 3, 4, 5].map((score) => (
        <label key={score}>
          <input type="radio" name={name} value={score} required defaultChecked={defaultScore === score} />
          <Star size={18} aria-hidden="true" /><span>{score}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Đánh giá hai chiều: chất lượng xử lý phản ánh/SOS đã hoàn tất và đánh giá chung về ứng dụng. */
export function CitizenFeedbackPage({ isAuthenticated, onRequireLogin }: CitizenFeedbackPageProps) {
  const [cases, setCases] = useState<RatableCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [caseNotice, setCaseNotice] = useState('');
  const [appRating, setAppRating] = useState<AppRating | null>(null);
  const [appNotice, setAppNotice] = useState('');
  const [appFormKey, setAppFormKey] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const [incidents, sos, rating] = await Promise.all([
        listCitizenIncidents().then((payload) => payload.data).catch(() => []),
        listCitizenSos().then((payload) => payload.data).catch(() => []),
        getAppRating().catch(() => null),
      ]);
      const done = (status: string) => ['resolved', 'closed'].includes(status);
      setCases([
        ...sos.filter((item) => done(item.status)).map((item) => ({
          key: `sos:${item.receiptCode}`, kind: 'sos' as const, receiptCode: item.receiptCode,
          label: `SOS ${item.receiptCode}`, rated: Boolean(item.satisfactionRating),
        })),
        ...incidents.filter((item) => done(item.status)).map((item) => ({
          key: `incident:${item.receiptCode}`, kind: 'incident' as const, receiptCode: item.receiptCode,
          label: `${item.receiptCode} · ${item.summary}`, rated: Boolean(item.satisfactionRating),
        })),
      ]);
      setAppRating(rating);
      setAppFormKey((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) void load();
    else { setCases([]); setAppRating(null); }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selected = cases.find((item) => item.key === String(data.get('case-id') ?? ''));
    const score = Number(data.get('rating'));
    const comment = String(data.get('comment') ?? '').trim();
    if (!selected) return;
    setCaseNotice('Đang gửi đánh giá…');
    try {
      if (selected.kind === 'sos') await createSosRating(selected.receiptCode, score, comment);
      else await createSatisfactionRating(selected.receiptCode, score, comment);
      setCaseNotice('Đánh giá đã được ghi nhận. Cảm ơn bạn đã góp ý.');
      setCases((current) => current.map((item) => (item.key === selected.key ? { ...item, rated: true } : item)));
      form.reset();
    } catch (error) {
      setCaseNotice(errorText(error));
    }
  };

  const submitApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setAppNotice('Đang gửi…');
    try {
      setAppRating(await saveAppRating(Number(data.get('app-rating')), String(data.get('app-comment') ?? '')));
      setAppNotice('Cảm ơn bạn. Đánh giá giúp đội phát triển cải thiện ứng dụng.');
    } catch (error) {
      setAppNotice(errorText(error));
    }
  };

  if (!isAuthenticated) {
    return (
      <section className="feature-section form-section" aria-labelledby="feedback-title">
        <h2 id="feedback-title">Đánh giá</h2>
        <VneIdLoginPrompt action="gửi đánh giá" onLogin={onRequireLogin} />
      </section>
    );
  }

  return (
    <>
      <section className="feature-section form-section" aria-labelledby="feedback-title">
        <h2 id="feedback-title">Đánh giá kết quả xử lý</h2>
        <p className="section-lead">Phản ánh và yêu cầu SOS đã được cán bộ xử lý xong mới đủ điều kiện đánh giá. Gửi lại sẽ cập nhật điểm cũ.</p>
        {loading && <p className="workflow-empty">Đang kiểm tra hồ sơ đã hoàn tất…</p>}
        {!loading && cases.length === 0 && <p className="workflow-empty">Chưa có phản ánh hay SOS đã xử lý xong để đánh giá.</p>}
        {cases.length > 0 && (
          <form onSubmit={submitCase}>
            <label>Hồ sơ đã hoàn tất
              <select name="case-id" required>
                {cases.map((item) => <option key={item.key} value={item.key}>{item.label}{item.rated ? ' (đã đánh giá)' : ''}</option>)}
              </select>
            </label>
            <RatingOptions name="rating" legend="Mức độ hài lòng" />
            <label>Góp ý thêm
              <textarea name="comment" maxLength={1000} rows={4} placeholder="Nội dung góp ý (không bắt buộc)" />
            </label>
            <button className="primary-action" type="submit"><Star size={18} aria-hidden="true" /> Gửi đánh giá</button>
          </form>
        )}
        {caseNotice && <p className="inline-notice" role="status">{caseNotice}</p>}
      </section>

      <section className="feature-section form-section" aria-labelledby="app-rating-title">
        <h2 id="app-rating-title"><Smartphone size={20} aria-hidden="true" /> Đánh giá ứng dụng</h2>
        <p className="section-lead">
          {appRating ? `Bạn đã chấm ${appRating.score}/5. Có thể chấm lại bất cứ lúc nào.` : 'Ứng dụng có dễ dùng và hữu ích với bạn không?'}
        </p>
        <form key={appFormKey} onSubmit={submitApp}>
          <RatingOptions name="app-rating" legend="Điểm cho ứng dụng" defaultScore={appRating?.score} />
          <label>Điều cần cải thiện
            <textarea name="app-comment" maxLength={1000} rows={3} defaultValue={appRating?.comment ?? ''} placeholder="Không bắt buộc" />
          </label>
          <button className="primary-action" type="submit"><Star size={18} aria-hidden="true" /> {appRating ? 'Cập nhật đánh giá' : 'Gửi đánh giá ứng dụng'}</button>
        </form>
        {appNotice && <p className="inline-notice" role="status">{appNotice}</p>}
      </section>
    </>
  );
}
