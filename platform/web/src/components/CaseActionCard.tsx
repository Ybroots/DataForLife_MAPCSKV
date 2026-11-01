import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import { minNoteLength, planFor } from '../case-actions';
import type { CaseAction, CaseKind } from '../case-actions';

interface Props {
  kind: CaseKind;
  status: string;
  /** Changes when another case is opened, so a half-written note never follows the officer to a new case. */
  caseKey: string;
  busy: boolean;
  /** Returns true when the transition went through. */
  onRun: (action: CaseAction, note: string, tellCitizen: boolean) => Promise<boolean>;
}

/** One clear next step for the officer. Rare choices wait under "Việc khác". */
export function CaseActionCard({ kind, status, caseKey, busy, onRun }: Props) {
  const plan = useMemo(() => planFor(kind, status), [kind, status]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [tellCitizen, setTellCitizen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const active = [plan.primary, ...plan.others].find((action) => action?.id === activeId) ?? plan.primary;

  useEffect(() => {
    setActiveId(null); setNote(''); setShowNote(false); setConfirming(false);
  }, [caseKey, status]);

  useEffect(() => {
    setTellCitizen(active?.tellCitizenByDefault ?? false);
    setConfirming(false);
  }, [active?.id, caseKey, status]);

  if (!active) {
    return <section className="case-action-card done" aria-label="Việc cần làm"><p className="case-action-prompt">{plan.prompt}</p></section>;
  }

  const trimmed = note.trim();
  const minimum = minNoteLength(active, kind);
  const writing = active.needsNote || showNote;
  const noteTooShort = writing && trimmed.length > 0 && trimmed.length < minimum;
  const ready = active.needsNote ? trimmed.length >= minimum : trimmed.length === 0 || trimmed.length >= minimum;
  const isPrimary = active.id === plan.primary?.id;

  const submit = async () => {
    if (busy || !ready) return;
    if (active.confirm && !confirming) { setConfirming(true); return; }
    // Typed text wins; otherwise the short standard sentence is used so the officer is not forced to write.
    const text = trimmed.length >= minimum ? trimmed : active.autoNote;
    const publicNote = writing && trimmed.length > 0 ? tellCitizen : active.tellCitizenByDefault;
    await onRun(active, text, publicNote);
  };

  const buttonClass = `case-action-button ${active.tone}${confirming ? ' confirming' : ''}`;

  return (
    <section className="case-action-card" aria-label="Việc cần làm">
      {!isPrimary && (
        <button className="case-action-back" type="button" onClick={() => { setActiveId(null); setNote(''); }}>← Quay lại</button>
      )}

      {writing && (
        <label className="case-action-note">
          <span>{active.noteLabel}</span>
          <textarea
            name="transitionNote" rows={3} maxLength={500} value={note} autoComplete="off"
            placeholder={active.notePlaceholder} onChange={(event) => setNote(event.target.value)}
          />
          {noteTooShort && <em role="alert">Viết thêm một chút, cần ít nhất {minimum} ký tự.</em>}
        </label>
      )}

      {writing && (
        <label className="case-action-share">
          <input name="publicMessage" type="checkbox" checked={tellCitizen} onChange={(event) => setTellCitizen(event.target.checked)} />
          <span>Cho người dân đọc nội dung này</span>
        </label>
      )}

      <button className={buttonClass} type="button" onClick={() => void submit()} disabled={busy || !ready}>
        <CheckCircle2 size={22} aria-hidden="true" />
        <span>{busy ? 'Đang ghi nhận…' : confirming ? `Bấm lần nữa để ${active.label.toLocaleLowerCase('vi-VN')}` : active.label}</span>
      </button>
      {confirming && <p className="case-action-warning" role="status">Việc này không hoàn tác được.</p>}

      {!active.needsNote && !showNote && (
        <button className="case-action-link" type="button" onClick={() => setShowNote(true)}>Nhắn người dân</button>
      )}

      {isPrimary && plan.others.length > 0 && (
        <details className="case-action-others">
          <summary>Việc khác <ChevronDown size={16} aria-hidden="true" /></summary>
          <div>
            {plan.others.map((action) => (
              <button key={action.id} type="button" onClick={() => { setActiveId(action.id); setNote(''); setShowNote(false); }}>{action.label}</button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
