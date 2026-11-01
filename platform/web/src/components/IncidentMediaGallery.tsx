import { useEffect, useState } from 'react';
import { FileImage, Video } from 'lucide-react';
import { getIncidentAttachmentUrl } from '../api';
import type { IncidentAttachment } from '../types';

interface Props {
  scope: 'citizen' | 'officer';
  incidentKey: string;
  attachments: IncidentAttachment[];
}

export function IncidentMediaGallery({ scope, incidentKey, attachments }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const created: string[] = [];
    Promise.all(attachments.map(async (attachment) => {
      try {
        const url = await getIncidentAttachmentUrl(scope, incidentKey, attachment.id);
        created.push(url);
        return [attachment.id, url] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (active) setUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
    });
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachments, incidentKey, scope]);

  if (!attachments.length) return scope === 'citizen' ? null : <p className="workflow-empty">Chưa có tệp minh chứng.</p>;
  return (
    <div className="incident-media-grid">
      {attachments.map((attachment) => (
        <figure key={attachment.id}>
          {urls[attachment.id]
            ? attachment.mimeType.startsWith('video/')
              ? <video controls preload="metadata" src={urls[attachment.id]} />
              : <img src={urls[attachment.id]} alt={`Minh chứng: ${attachment.fileName}`} />
            : <span className="media-placeholder">{attachment.mimeType.startsWith('video/') ? <Video /> : <FileImage />}</span>}
          <figcaption><strong>{attachment.fileName}</strong><span>{attachment.purpose === 'initial' ? 'Ban đầu' : attachment.purpose === 'supplemental' ? 'Bổ sung' : 'Nghiệp vụ'}</span></figcaption>
        </figure>
      ))}
    </div>
  );
}
