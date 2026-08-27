export const requesterStatusPresentation = {
  DRAFT:{label:"Draft",tone:"neutral",owner:"You",action:"Complete and submit your request"},
  SUBMITTED:{label:"Submitted",tone:"info",owner:"Finance",action:"Finance is reviewing your request"},
  VALIDATING:{label:"Finance Review in Progress",tone:"info",owner:"Finance",action:"Finance is reviewing your request"},
  NEEDS_CLARIFICATION:{label:"Action Required",tone:"warning",owner:"You",action:"Respond to the clarification"},
  PENDING_APPROVAL:{label:"Waiting for Approval",tone:"warning",owner:"Approver",action:"Waiting for required approval"},
  APPROVED:{label:"Approved",tone:"success",owner:"Finance",action:"Final Finance review"},
  FINANCE_CHECK:{label:"Final Finance Review",tone:"info",owner:"Finance",action:"Finance is completing final payment checks"},
  FINANCE_HOLD:{label:"Finance Review in Progress",tone:"warning",owner:"Finance",action:"Finance is resolving a payment-readiness issue"},
  READY_FOR_PAYMENT:{label:"Ready for Payment",tone:"success",owner:"Finance / Payment Team",action:"Payment processing"},
  PAID:{label:"Paid",tone:"success",owner:"Complete",action:"No action required"},
  REJECTED:{label:"Not Approved",tone:"danger",owner:"Complete",action:"Review the decision information"},
  CANCELLED:{label:"Cancelled",tone:"neutral",owner:"Complete",action:"No action required"},
} as const;

export type RequesterStatus=keyof typeof requesterStatusPresentation;

export function requesterNeedsAction(status:RequesterStatus){return status==="DRAFT"||status==="NEEDS_CLARIFICATION";}

export const requesterActivityLabel:Record<string,string>={
  REQUEST_INITIATED:"Request created",REQUEST_CREATED:"Request created",REQUEST_UPDATED:"Draft saved",REQUEST_SUBMITTED:"Request submitted",
  VALIDATION_CLARIFICATION_REQUESTED:"Clarification requested",APPROVAL_CLARIFICATION_REQUESTED:"Clarification requested",POLICY_CLARIFICATION_REQUESTED:"Clarification requested",
  CLARIFICATION_REQUESTED:"Clarification requested",CLARIFICATION_RESPONDED:"Clarification response submitted",VALIDATION_CLARIFICATION_RESPONDED:"Clarification response submitted",APPROVAL_CLARIFICATION_RESPONDED:"Clarification response submitted",
  VALIDATION_STARTED:"Finance review started",VALIDATION_COMPLETED:"Validation completed",MANUAL_VALIDATION_COMPLETED:"Validation completed",
  APPROVAL_CASE_CREATED:"Sent for approval",APPROVAL_COMPLETED:"Approval completed",REQUEST_APPROVED:"Approval completed",REQUEST_REJECTED:"Request not approved",
  FINANCE_CONTROL_COMPLETED:"Final Finance review completed",REQUEST_READY_FOR_PAYMENT:"Ready for payment",
  PAYMENT_RECORDED:"Payment recorded",REQUEST_PAID:"Payment recorded",
};

export function friendlyActivity(action:string){
  return requesterActivityLabel[action]??action.toLowerCase().replaceAll("_"," ").replace(/^./,value=>value.toUpperCase());
}

export function requesterActivityVisible(action:string){return Boolean(requesterActivityLabel[action]);}
export function clarificationActionable(status:string){return status==="OPEN";}
