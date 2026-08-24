export const REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'VALIDATING', 'NEEDS_CLARIFICATION', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type Role = 'REQUESTER' | 'FINANCE' | 'ADMIN';

export interface Principal {
  id: string;
  departmentId: string;
  roles: readonly Role[];
}

export interface RequestCapture {
  payee: string | null;
  purpose: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  departmentId: string;
  dueDate: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  remark: string | null;
}

export interface PaymentRequest extends RequestCapture {
  id: string;
  ticketNumber: string | null;
  status: RequestStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  rowVersion: number;
}

export function canReadRequest(actor: Principal, request: PaymentRequest): boolean {
  return actor.roles.includes('ADMIN')
    || actor.roles.includes('FINANCE')
    || (actor.departmentId === request.departmentId && actor.id === request.createdBy);
}

export function canEditDraft(actor: Principal, request: PaymentRequest): boolean {
  return request.status === 'DRAFT'
    && (actor.roles.includes('ADMIN') || actor.id === request.createdBy)
    && (actor.roles.includes('ADMIN') || actor.departmentId === request.departmentId);
}

export function assertSubmittable(request: PaymentRequest): void {
  if (request.status !== 'DRAFT') throw new Error('Only a DRAFT request can be submitted');
  const required: Array<[string, string | null]> = [
    ['payee', request.payee], ['purpose', request.purpose], ['category', request.category],
    ['amount', request.amount], ['currency', request.currency], ['dueDate', request.dueDate],
    ['paymentMethod', request.paymentMethod], ['paymentDetails', request.paymentDetails],
  ];
  const missing = required.filter(([, value]) => value === null || !String(value).trim()).map(([name]) => name);
  if (missing.length) throw new Error(`Missing required request fields: ${missing.join(', ')}`);
  if (!/^\d+(\.\d{1,4})?$/.test(String(request.amount)) || Number(request.amount) <= 0) {
    throw new Error('Amount must be a positive decimal with at most four decimal places');
  }
  if (!/^[A-Z]{3}$/.test(String(request.currency))) throw new Error('Currency must be a three-letter ISO code');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(request.dueDate))) throw new Error('Due date must use YYYY-MM-DD');
}

function normalizeDate(value: string | Date | null): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
}

export function formatTicketNumber(businessYear: number, sequence: bigint): string {
  if (!Number.isInteger(businessYear) || businessYear < 2000 || businessYear > 9999) {
    throw new Error('Invalid business year');
  }
  if (sequence < 1n || sequence > 999999n) throw new Error('Ticket sequence is outside its supported range');
  return `PAY-${businessYear}-${sequence.toString().padStart(6, '0')}`;
}
