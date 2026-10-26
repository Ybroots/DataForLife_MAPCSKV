export type IncidentStatus =
  | 'submitted'
  | 'received'
  | 'assigned'
  | 'verifying'
  | 'processing'
  | 'resolved'
  | 'closed'
  | 'rejected';

export type SosStatus =
  | 'triggered'
  | 'dispatched'
  | 'acknowledged'
  | 'responding'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'cancelled_by_citizen';

const incidentTransitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  // 'closed' from submitted/received lets the citizen withdraw a report before anyone is assigned.
  submitted: ['received', 'closed'],
  received: ['assigned', 'rejected', 'closed'],
  // A duplicate/spam/out-of-scope finding after assignment must still be rejectable.
  assigned: ['verifying', 'processing', 'rejected'],
  verifying: ['processing', 'rejected'],
  processing: ['resolved', 'rejected'],
  resolved: ['closed', 'processing'],
  closed: [],
  rejected: ['closed'],
};

const sosTransitions: Record<SosStatus, readonly SosStatus[]> = {
  triggered: ['dispatched', 'cancelled_by_citizen'],
  dispatched: ['acknowledged', 'escalated', 'cancelled_by_citizen'],
  // acknowledged -> resolved: false alarm / sender confirmed safe, closed by an officer with a written basis.
  acknowledged: ['responding', 'escalated', 'resolved'],
  responding: ['resolved', 'escalated'],
  escalated: ['acknowledged', 'responding'],
  resolved: ['closed', 'responding'],
  closed: [],
  cancelled_by_citizen: [],
};

export class WorkflowError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION' | 'INVALID_INPUT' | 'NO_DUTY_OFFICER',
    message: string,
  ) {
    super(message);
  }
}

export function assertIncidentTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!incidentTransitions[from].includes(to)) {
    throw new WorkflowError(
      'INVALID_TRANSITION',
      `Không thể chuyển phản ánh từ ${from} sang ${to}.`,
    );
  }
}

export function assertSosTransition(from: SosStatus, to: SosStatus): void {
  if (!sosTransitions[from].includes(to)) {
    throw new WorkflowError(
      'INVALID_TRANSITION',
      `Không thể chuyển SOS từ ${from} sang ${to}.`,
    );
  }
}

export function incidentNextStatuses(status: IncidentStatus): readonly IncidentStatus[] {
  return incidentTransitions[status];
}

export function sosNextStatuses(status: SosStatus): readonly SosStatus[] {
  return sosTransitions[status];
}

/**
 * Only the officer a case is assigned to may act on it. The previous guard compared the officer id the
 * client chose to send (assignedOfficerId) instead of the stored assignee, so omitting that field let any
 * officer of the locality act on a colleague's case. Handing a case over is a separate, audited flow that
 * does not exist yet, so assigning to a different officer is still refused.
 */
export function assertCaseOwnership(
  actorId: string,
  currentAssigneeId: string | null | undefined,
  requestedAssigneeId: string | null | undefined,
  label: 'hồ sơ' | 'SOS',
): void {
  if (currentAssigneeId && currentAssigneeId !== actorId) {
    throw new WorkflowError('FORBIDDEN', `${label === 'SOS' ? 'SOS' : 'Hồ sơ'} đang do cán bộ khác phụ trách. Cần bàn giao trước khi xử lý.`);
  }
  if (requestedAssigneeId && requestedAssigneeId !== actorId) {
    throw new WorkflowError('FORBIDDEN', `Pilot Xuân Hương chỉ cho phép CSKV đang đăng nhập trực tiếp nhận và xử lý ${label}.`);
  }
}
