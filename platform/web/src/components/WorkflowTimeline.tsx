import { Check, Clock3 } from 'lucide-react';
import type { WorkflowHistory } from '../types';

interface WorkflowTimelineProps {
  history: WorkflowHistory<string>[];
  statusLabels: Record<string, string>;
  compact?: boolean;
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function WorkflowTimeline({ history, statusLabels, compact = false }: WorkflowTimelineProps) {
  return (
    <ol className={compact ? 'workflow-timeline compact' : 'workflow-timeline'} aria-label="Lịch sử xử lý">
      {history.map((entry, index) => (
        <li key={`${entry.createdAt}-${entry.toStatus}-${index}`}>
          <span className="timeline-node" aria-hidden="true">
            {index === history.length - 1 ? <Clock3 size={14} /> : <Check size={14} />}
          </span>
          <div>
            <div className="timeline-heading">
              <strong>{entry.actorRole === 'citizen' && entry.fromStatus === entry.toStatus ? 'Người gửi báo đã an toàn' : (statusLabels[entry.toStatus] ?? entry.toStatus)}{!entry.publicMessage && <small className="internal-note-badge">Nội bộ</small>}</strong>
              <time dateTime={entry.createdAt}>{dateFormatter.format(new Date(entry.createdAt))}</time>
            </div>
            {entry.note && <p>{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
