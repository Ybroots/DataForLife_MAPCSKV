import { useState } from 'react';
import { Star } from 'lucide-react';
import { ApiError, createSosRating } from '../api';
import type { SatisfactionRating } from '../types';

interface SosRatingInlineProps {
  receiptCode: string;
  rating: SatisfactionRating | null | undefined;
  onRated: (rating: SatisfactionRating) => void;
}

/** Đánh giá nhanh ngay trên phiếu SOS sau khi cán bộ đã xử lý xong. */
export function SosRatingInline({ receiptCode, rating, onRated }: SosRatingInlineProps) {
  const [score, setScore] = useState(rating?.score ?? 0);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = async () => {
    if (!score) return;
    setBusy(true);
    setMessage('');
    try {
      onRated(await createSosRating(receiptCode, score, comment));
      setMessage('Cảm ơn bạn đã đánh giá.');
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Chưa gửi được đánh giá.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sos-rating-inline">
      <strong>{rating ? `Bạn đã chấm ${rating.score}/5. Có thể chấm lại.` : 'Bạn hài lòng với hỗ trợ của cán bộ không?'}</strong>
      <div className="sos-rating-stars" role="radiogroup" aria-label="Điểm hài lòng">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" role="radio" aria-checked={score === value} aria-label={`${value} sao`} className={value <= score ? 'on' : ''} onClick={() => setScore(value)}>
            <Star size={24} fill={value <= score ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={(event) => setComment(event.target.value.slice(0, 1000))} rows={2} maxLength={1000} placeholder="Góp ý thêm (không bắt buộc)" aria-label="Góp ý thêm" />
      <button type="button" className="primary-action" disabled={busy || !score} onClick={() => void send()}>
        <Star size={17} aria-hidden="true" /> {busy ? 'Đang gửi…' : 'Gửi đánh giá'}
      </button>
      {message && <p className="inline-notice" role="status">{message}</p>}
    </div>
  );
}
