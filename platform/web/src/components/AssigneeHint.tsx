import { useEffect, useState } from 'react';
import { getAssigneeSuggestion } from '../api';
import type { AssigneeSuggestion } from '../types';

export function AssigneeHint({ incidentId }: { incidentId: string }) {
  const [suggestion, setSuggestion] = useState<AssigneeSuggestion | null>(null);

  useEffect(() => {
    let active = true;
    setSuggestion(null);
    getAssigneeSuggestion(incidentId).then((value) => { if (active) setSuggestion(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [incidentId]);

  if (!suggestion) return null;
  return <small className="assignee-hint"> · Gợi ý: {suggestion.displayName} ({suggestion.openCases === 0 ? 'chưa giữ hồ sơ nào' : `đang giữ ${suggestion.openCases} hồ sơ`})</small>;
}
