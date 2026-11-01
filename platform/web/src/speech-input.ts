import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

type WebRecognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type WebRecognitionCtor = new () => WebRecognition;

const LANGUAGE = 'vi-VN';

function webCtor(): WebRecognitionCtor | null {
  const scope = window as unknown as { SpeechRecognition?: WebRecognitionCtor; webkitSpeechRecognition?: WebRecognitionCtor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Trình duyệt/ứng dụng có thể nhận giọng nói hay không (nút micro ẩn nếu không). */
export function supportsSpeechInput(): boolean {
  return Capacitor.isNativePlatform() || webCtor() !== null;
}

export interface SpeechSession { stop: () => void }
export interface SpeechHandlers {
  onText: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

const WEB_ERRORS: Record<string, string> = {
  'not-allowed': 'Chưa được cấp quyền micro. Hãy cho phép micro trong cài đặt rồi thử lại.',
  'service-not-allowed': 'Chưa được cấp quyền micro. Hãy cho phép micro trong cài đặt rồi thử lại.',
  'no-speech': 'Chưa nghe thấy giọng nói. Hãy thử lại gần micro hơn.',
  'audio-capture': 'Không tìm thấy micro trên thiết bị.',
  network: 'Không nhận dạng được giọng nói vì mất kết nối mạng.',
};

/** Bắt đầu nghe. Văn bản nhận dạng (cả tạm thời) được gửi qua onText; onEnd luôn được gọi đúng một lần. */
export async function startSpeechInput(handlers: SpeechHandlers): Promise<SpeechSession> {
  let ended = false;
  const finish = () => { if (!ended) { ended = true; handlers.onEnd(); } };

  if (Capacitor.isNativePlatform()) {
    const { available } = await SpeechRecognition.available();
    if (!available) throw new Error('Thiết bị chưa hỗ trợ nhận dạng giọng nói. Hãy bật Google/ dịch vụ giọng nói rồi thử lại.');
    let permission = await SpeechRecognition.checkPermissions();
    if (permission.speechRecognition !== 'granted') permission = await SpeechRecognition.requestPermissions();
    if (permission.speechRecognition !== 'granted') throw new Error('Chưa được cấp quyền micro. Hãy cho phép micro trong cài đặt rồi thử lại.');
    const partial = await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
      const text = data.matches?.[0];
      if (text) handlers.onText(text);
    });
    const state = await SpeechRecognition.addListener('listeningState', (data: { status: 'started' | 'stopped' }) => {
      if (data.status === 'stopped') { void cleanup(); }
    });
    const cleanup = async () => { await partial.remove(); await state.remove(); finish(); };
    try {
      await SpeechRecognition.start({ language: LANGUAGE, maxResults: 1, partialResults: true, popup: false, prompt: 'Hãy nói nội dung phản ánh' });
    } catch (error) { await cleanup(); throw error; }
    return { stop: () => { void SpeechRecognition.stop().catch(() => undefined); } };
  }

  const Ctor = webCtor();
  if (!Ctor) throw new Error('Trình duyệt này chưa hỗ trợ nhập bằng giọng nói. Hãy dùng Chrome hoặc ứng dụng di động.');
  const recognition = new Ctor();
  recognition.lang = LANGUAGE;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    let text = '';
    for (let index = 0; index < event.results.length; index += 1) text += event.results[index]?.[0]?.transcript ?? '';
    if (text.trim()) handlers.onText(text.trim());
  };
  recognition.onerror = (event) => { handlers.onError(WEB_ERRORS[event.error ?? ''] ?? 'Không nhận dạng được giọng nói. Hãy thử lại.'); };
  recognition.onend = finish;
  recognition.start();
  return { stop: () => { try { recognition.stop(); } catch { /* đã dừng */ } } };
}
