import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { startSpeechInput, supportsSpeechInput, type SpeechSession } from '../speech-input';

interface VoiceInputButtonProps {
  /** Giá trị hiện tại của ô nhập. */
  value: string;
  /** Nhận giá trị mới (văn bản đang có + lời vừa nói). */
  onChange: (value: string) => void;
  maxLength: number;
  label: string;
  onError?: (message: string) => void;
}

/** Nút micro nói để nhập: lời nói được nối thêm vào cuối nội dung đang có. Ẩn nếu thiết bị không hỗ trợ. */
export function VoiceInputButton({ value, onChange, maxLength, label, onError }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState('');
  const sessionRef = useRef<SpeechSession | null>(null);
  const baseRef = useRef('');
  useEffect(() => () => sessionRef.current?.stop(), []);
  if (!supportsSpeechInput()) return null;

  const fail = (text: string) => { setMessage(text); onError?.(text); };
  const toggle = async () => {
    if (listening) { sessionRef.current?.stop(); return; }
    setMessage('');
    baseRef.current = value.trim();
    setListening(true);
    try {
      sessionRef.current = await startSpeechInput({
        onText: (text) => onChange(`${baseRef.current}${baseRef.current ? ' ' : ''}${text}`.slice(0, maxLength)),
        onEnd: () => { setListening(false); sessionRef.current = null; },
        onError: fail,
      });
    } catch (error) {
      setListening(false);
      fail(error instanceof Error && error.message ? error.message : 'Không bật được micro. Hãy thử lại.');
    }
  };

  return (
    <>
      <button type="button" className={`voice-button${listening ? ' listening' : ''}`} onClick={() => void toggle()}
        aria-pressed={listening} aria-label={listening ? `Dừng nói (${label})` : `Nói để nhập ${label}`}>
        {listening ? <Square size={18} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{listening ? 'Đang nghe, hãy nói.' : message}</span>
      {message && <small className="voice-message" role="alert">{message}</small>}
    </>
  );
}
