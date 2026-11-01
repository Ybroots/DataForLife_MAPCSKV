/**
 * What the officer should do next on a case, in plain words.
 *
 * The API stays the authority on which transitions are allowed (api/src/workflow.ts); this module only
 * decides which few buttons to show and what to send. Each action may chain several legal transitions so the
 * officer does one tap for "take the case" instead of walking received → assigned by hand. Every step is still
 * a real, audited transition.
 */
export type CaseKind = 'incident' | 'sos';

export interface CaseAction {
  id: string;
  label: string;
  /** Statuses applied in order; the first must be allowed from the current status. */
  steps: string[];
  needsNote: boolean;
  noteLabel: string;
  notePlaceholder: string;
  /** Sent when the officer writes nothing. At least 8 characters, 20 when the last step ends the case. */
  autoNote: string;
  tone: 'primary' | 'danger' | 'neutral';
  /** Cannot be undone, so the first tap only asks "tap again to confirm". */
  confirm: boolean;
  /** Default for "let the citizen read this note". The officer can switch it off. */
  tellCitizenByDefault: boolean;
}

export interface CasePlan {
  prompt: string;
  primary: CaseAction | null;
  others: CaseAction[];
}

const NO_PLACEHOLDER = '';

function quick(id: string, label: string, steps: string[], autoNote: string, extra: Partial<CaseAction> = {}): CaseAction {
  return {
    id, label, steps, needsNote: false, noteLabel: 'Lời nhắn cho người dân (không bắt buộc)', notePlaceholder: NO_PLACEHOLDER,
    autoNote, tone: 'primary', confirm: false, tellCitizenByDefault: true, ...extra,
  };
}

function written(id: string, label: string, steps: string[], noteLabel: string, notePlaceholder: string, extra: Partial<CaseAction> = {}): CaseAction {
  return {
    id, label, steps, needsNote: true, noteLabel, notePlaceholder, autoNote: '', tone: 'neutral', confirm: false,
    tellCitizenByDefault: false, ...extra,
  };
}

const outOfScope = written('reject', 'Không thuộc phạm vi', ['rejected'], 'Lý do và nơi người dân cần liên hệ', 'Ví dụ: Việc thuộc thẩm quyền của UBND phường, người dân liên hệ bộ phận một cửa.', { tellCitizenByDefault: true });
const closeWithReason = written('close-reason', 'Đóng, không xử lý', ['closed'], 'Lý do đóng hồ sơ', 'Ví dụ: Nội dung trùng với hồ sơ đã xử lý, không cần xử lý thêm.', { confirm: true });
const reopenIncident = written('reopen', 'Mở lại để xử lý tiếp', ['processing'], 'Lý do mở lại', 'Ví dụ: Người dân báo sự việc tái diễn.');

const sosDone = written('sos-done', 'Đã xử lý xong', ['resolved'], 'Kết quả và tình trạng an toàn của người dân', 'Ví dụ: Đã đến nơi, người dân an toàn, tình huống đã ổn định.', { tone: 'primary', tellCitizenByDefault: true });
const sosEscalate = written('sos-escalate', 'Chuyển đơn vị khác phối hợp', ['escalated'], 'Đơn vị nhận và thông tin đã bàn giao', 'Ví dụ: Đã chuyển Đội cảnh sát PCCC lúc 21:10, kèm vị trí và số điện thoại.');
const sosCancelled = written('sos-cancelled', 'Người dân đã hủy', ['cancelled_by_citizen'], 'Cách đã xác minh việc hủy', 'Ví dụ: Đã gọi lại, người dân xác nhận an toàn.', { confirm: true });

export const SOS_ACCEPT_NOTE = 'Cán bộ khu vực đã nhận tín hiệu SOS và đang liên hệ với bạn.';

export function planFor(kind: CaseKind, status: string): CasePlan {
  if (kind === 'incident') {
    switch (status) {
      case 'submitted':
        return { prompt: 'Hồ sơ mới, chưa có ai nhận.', primary: quick('take', 'Nhận hồ sơ', ['received', 'assigned'], 'CSKV đã tiếp nhận hồ sơ và nhận xử lý.'), others: [closeWithReason] };
      case 'received':
        return { prompt: 'Hồ sơ đã được ghi nhận, chưa có người phụ trách.', primary: quick('take', 'Nhận xử lý', ['assigned'], 'CSKV nhận xử lý hồ sơ.'), others: [outOfScope, closeWithReason] };
      case 'assigned':
        return {
          prompt: 'Bạn đang phụ trách hồ sơ này. Hãy xem nội dung rồi bắt đầu xử lý.',
          primary: quick('start', 'Bắt đầu xử lý', ['processing'], 'CSKV bắt đầu xử lý hồ sơ.'),
          others: [quick('verify', 'Cần xác minh thêm', ['verifying'], 'Đang xác minh thông tin hồ sơ.', { tone: 'neutral', tellCitizenByDefault: false }), outOfScope],
        };
      case 'verifying':
        return { prompt: 'Đang xác minh thông tin.', primary: quick('start', 'Chuyển sang xử lý', ['processing'], 'Đã xác minh, chuyển sang xử lý.'), others: [outOfScope] };
      case 'processing':
        return {
          prompt: 'Đang xử lý. Xong việc thì ghi kết quả, người dân sẽ được báo.',
          primary: written('done', 'Đã xử lý xong', ['resolved'], 'Kết quả xử lý (người dân sẽ đọc được)', 'Ví dụ: Đã đến hiện trường, giải quyết và hướng dẫn người dân.', { tone: 'primary', tellCitizenByDefault: true }),
          others: [outOfScope],
        };
      case 'resolved':
        return { prompt: 'Đã có kết quả. Đóng hồ sơ để hoàn tất.', primary: quick('close', 'Đóng hồ sơ', ['closed'], 'Đã rà soát kết quả xử lý, đóng hồ sơ.', { confirm: true, tellCitizenByDefault: false }), others: [reopenIncident] };
      case 'rejected':
        return { prompt: 'Hồ sơ đã được chuyển ngoài phạm vi.', primary: quick('close', 'Đóng hồ sơ', ['closed'], 'Đã chuyển ngoài phạm vi, đóng hồ sơ.', { confirm: true, tellCitizenByDefault: false }), others: [] };
      default:
        return { prompt: 'Hồ sơ đã đóng. Không còn việc cần làm.', primary: null, others: [] };
    }
  }
  switch (status) {
    case 'triggered':
      return { prompt: 'SOS mới. Nhận ngay để liên hệ người dân.', primary: quick('accept', 'Nhận SOS ngay', ['dispatched', 'acknowledged'], SOS_ACCEPT_NOTE, { tone: 'danger' }), others: [sosCancelled] };
    case 'dispatched':
      return { prompt: 'SOS đang chờ bạn nhận. Nhận ngay để liên hệ người dân.', primary: quick('accept', 'Nhận SOS ngay', ['acknowledged'], SOS_ACCEPT_NOTE, { tone: 'danger' }), others: [sosEscalate, sosCancelled] };
    case 'acknowledged':
      return {
        prompt: 'Đã nhận SOS. Gọi người dân và đến hiện trường.',
        primary: quick('go', 'Đang đến hiện trường', ['responding'], 'Lực lượng đang triển khai đến hiện trường.', { tone: 'danger' }),
        others: [sosDone, sosEscalate],
      };
    case 'responding':
      return { prompt: 'Lực lượng đang xử lý. Xong việc thì ghi kết quả.', primary: sosDone, others: [sosEscalate] };
    case 'escalated':
      return { prompt: 'SOS đã chuyển đơn vị khác. Khi nhận lại thì bấm nhận.', primary: quick('accept', 'Nhận lại SOS', ['acknowledged'], 'Cán bộ khu vực tiếp nhận lại SOS và tiếp tục xử lý.', { tone: 'danger' }), others: [quick('go', 'Đang đến hiện trường', ['responding'], 'Lực lượng đang triển khai đến hiện trường.', { tone: 'neutral' })] };
    case 'resolved':
      return {
        prompt: 'Đã xử lý xong. Đóng SOS để hoàn tất.',
        primary: quick('close', 'Đóng SOS', ['closed'], 'Đã rà soát kết quả xử lý, đóng SOS.', { confirm: true, tellCitizenByDefault: false }),
        others: [written('reopen', 'Mở lại để xử lý tiếp', ['responding'], 'Lý do mở lại', 'Ví dụ: Người dân gọi lại, tình huống còn nguy hiểm.')],
      };
    default:
      return { prompt: 'Không còn việc cần làm.', primary: null, others: [] };
  }
}

/** Shortest note the server accepts for the last step of this action. */
export function minNoteLength(action: CaseAction, kind: CaseKind): number {
  const last = action.steps[action.steps.length - 1] ?? '';
  const long = kind === 'incident' ? ['resolved', 'closed', 'rejected'] : ['resolved', 'closed'];
  return long.includes(last) ? 20 : 8;
}

/** Only these steps carry an assignee in the request. */
export function stepAssignsSelf(status: string): boolean {
  return status === 'assigned' || status === 'acknowledged' || status === 'responding';
}
