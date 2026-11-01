import { describe, expect, it } from 'vitest';
import { minNoteLength, planFor } from '../src/case-actions';
import type { CaseAction, CaseKind } from '../src/case-actions';
import { assertIncidentTransition, assertSosTransition } from '../../api/src/workflow';
import type { IncidentStatus, SosStatus } from '../../api/src/workflow';

const incidentStatuses: IncidentStatus[] = ['submitted', 'received', 'assigned', 'verifying', 'processing', 'resolved', 'closed', 'rejected'];
const sosStatuses: SosStatus[] = ['triggered', 'dispatched', 'acknowledged', 'responding', 'escalated', 'resolved', 'closed', 'cancelled_by_citizen'];

function actionsOf(kind: CaseKind, status: string): CaseAction[] {
  const plan = planFor(kind, status);
  return [plan.primary, ...plan.others].filter((action): action is CaseAction => action !== null);
}

function walk(kind: CaseKind, from: string, steps: string[]) {
  let current = from;
  for (const step of steps) {
    if (kind === 'incident') assertIncidentTransition(current as IncidentStatus, step as IncidentStatus);
    else assertSosTransition(current as SosStatus, step as SosStatus);
    current = step;
  }
}

describe('officer case actions', () => {
  it.each([
    ...incidentStatuses.map((status) => ['incident', status] as const),
    ...sosStatuses.map((status) => ['sos', status] as const),
  ])('%s %s: every action is a legal chain of transitions', (kind, status) => {
    for (const action of actionsOf(kind, status)) {
      expect(() => walk(kind, status, action.steps), `${action.label}`).not.toThrow();
    }
  });

  it('standard notes always satisfy the server length rules', () => {
    for (const [kind, statuses] of [['incident', incidentStatuses], ['sos', sosStatuses]] as const) {
      for (const status of statuses) {
        for (const action of actionsOf(kind, status)) {
          if (action.needsNote) continue;
          expect(action.autoNote.length, action.label).toBeGreaterThanOrEqual(minNoteLength(action, kind));
          expect(action.autoNote.length).toBeLessThanOrEqual(500);
        }
      }
    }
  });

  it('shows one main button per open case and none once it is over', () => {
    for (const status of ['submitted', 'received', 'assigned', 'verifying', 'processing', 'resolved', 'rejected']) {
      expect(planFor('incident', status).primary, status).not.toBeNull();
    }
    for (const status of ['triggered', 'dispatched', 'acknowledged', 'responding', 'escalated', 'resolved']) {
      expect(planFor('sos', status).primary, status).not.toBeNull();
    }
    expect(planFor('incident', 'closed').primary).toBeNull();
    expect(planFor('sos', 'closed').primary).toBeNull();
    expect(planFor('sos', 'cancelled_by_citizen').primary).toBeNull();
  });

  it('takes a new report in one tap and the SOS with the standard message', () => {
    expect(planFor('incident', 'submitted').primary?.steps).toEqual(['received', 'assigned']);
    expect(planFor('sos', 'dispatched').primary).toMatchObject({ steps: ['acknowledged'], needsNote: false, tellCitizenByDefault: true });
  });

  it('asks for a written result before finishing and a second tap before closing for good', () => {
    expect(planFor('incident', 'processing').primary).toMatchObject({ steps: ['resolved'], needsNote: true });
    expect(planFor('incident', 'resolved').primary).toMatchObject({ steps: ['closed'], confirm: true });
    expect(planFor('sos', 'responding').primary).toMatchObject({ steps: ['resolved'], needsNote: true });
  });

  it('needs at least 20 characters when a case ends', () => {
    expect(minNoteLength(planFor('incident', 'processing').primary!, 'incident')).toBe(20);
    expect(minNoteLength(planFor('incident', 'assigned').primary!, 'incident')).toBe(8);
  });
});
