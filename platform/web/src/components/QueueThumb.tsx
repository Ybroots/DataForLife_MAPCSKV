import { useEffect, useRef, useState } from 'react';
import { getIncidentAttachmentUrl } from '../api';

interface Props {
  incidentId: string;
  attachmentId: string;
  photoCount: number;
}

// Object URLs are kept for the session so scrolling back does not download the photo again.
const cache = new Map<string, string>();
const CACHE_LIMIT = 60;

function remember(key: string, url: string) {
  cache.set(key, url);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    URL.revokeObjectURL(cache.get(oldest) ?? '');
    cache.delete(oldest);
  }
}

/** Small photo on a queue card. Loads only when the card scrolls into view. */
export function QueueThumb({ incidentId, attachmentId, photoCount }: Props) {
  const box = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(cache.get(attachmentId) ?? null);

  useEffect(() => {
    if (url || !box.current) return;
    let active = true;
    const load = () => {
      void getIncidentAttachmentUrl('officer', incidentId, attachmentId)
        .then((next) => { remember(attachmentId, next); if (active) setUrl(next); })
        .catch(() => undefined);
    };
    if (typeof IntersectionObserver === 'undefined') { load(); return () => { active = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '120px' });
    observer.observe(box.current);
    return () => { active = false; observer.disconnect(); };
  }, [attachmentId, incidentId, url]);

  return (
    <span className="queue-thumb" ref={box} aria-hidden="true">
      {url && <img src={url} alt="" loading="lazy" decoding="async" />}
      {photoCount > 1 && <em>+{photoCount - 1}</em>}
    </span>
  );
}
