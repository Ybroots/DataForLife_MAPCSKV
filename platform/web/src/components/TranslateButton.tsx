import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { ApiError, translateWithAi } from '../api';

interface Props {
  text: string;
  target: 'en' | 'vi';
  /** Đổi theo tin nhắn để xóa bản dịch cũ khi danh sách thay đổi. */
  resetKey?: string;
}

/** Nút "Dịch" dưới một tin nhắn: bản gốc giữ nguyên, bản dịch (do AI) hiện ngay bên dưới và ghi rõ là bản dịch tự động. */
export function TranslateButton({ text, target, resetKey }: Props) {
  const [translation, setTranslation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const english = target === 'en';

  useEffect(() => { setTranslation(''); setError(''); }, [resetKey, text, target]);

  const run = async () => {
    if (translation) { setTranslation(''); return; }
    setBusy(true); setError('');
    try {
      setTranslation(await translateWithAi(text, target));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : english ? 'Could not translate right now.' : 'Chưa dịch được lúc này.');
    } finally { setBusy(false); }
  };

  return (
    <div className="translate-inline">
      <button type="button" className="translate-button" onClick={() => void run()} disabled={busy}>
        <Languages size={14} aria-hidden="true" /> {busy ? (english ? 'Translating…' : 'Đang dịch…') : translation ? (english ? 'Hide translation' : 'Ẩn bản dịch') : (english ? 'Translate to English' : 'Dịch sang tiếng Việt')}
      </button>
      {translation && <p className="translate-result" lang={target}>{translation}<small>{english ? ' Automatic translation' : ' Bản dịch tự động'}</small></p>}
      {error && <small className="translate-error" role="alert">{error}</small>}
    </div>
  );
}
