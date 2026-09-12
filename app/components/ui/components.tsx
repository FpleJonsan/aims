"use client";

import {useId, type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes} from 'react';

const cx = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ');
type Box = HTMLAttributes<HTMLDivElement>;
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'ai';
export function UIProvider({className, ...props}: Box) {
  return <div {...props} className={cx('aims-design-system', 'aims-ui', className)}/>;
}
export type TypographyProps = HTMLAttributes<HTMLElement> & {
  as?: 'p'|'span'|'h1'|'h2'|'h3'|'h4'|'h5'|'h6';
  variant?: 'metadata'|'label'|'body'|'section'|'card'|'page'|'metric';
};
export function Typography({as: Tag='p', variant='body', className, ...props}:TypographyProps){
  return <Tag {...props} className={cx('aims-type', `aims-type-${variant}`, className)}/>;
}
export function LoadingSpinner({label='Loading', decorative=false}:{label?:string;decorative?:boolean}){
  return <span className="aims-spinner" role={decorative?undefined:'status'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>
  </span>;
}
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'danger'|'text';busy?:boolean};
export function Button({variant='secondary',busy=false,disabled=false,type='button',className,children,...props}:ButtonProps){
  return <button {...props} type={type} disabled={disabled||busy} aria-busy={busy||undefined} className={cx('aims-button',`aims-button-${variant}`,className)}>
    <span className="aims-button-label">{children}</span><span className="aims-button-indicator" aria-hidden="true" data-visible={busy}><LoadingSpinner decorative/></span>
  </button>;
}
export function BusyButton(props:ButtonProps){return <Button {...props}/>;}
export function Card({className,...props}:Box){return <div {...props} className={cx('aims-card',className)}/>;}
export function CardHeader({className,...props}:Box){return <div {...props} className={cx('aims-card-header',className)}/>;}
export function CardBody({className,...props}:Box){return <div {...props} className={cx('aims-card-body',className)}/>;}
export function CardFooter({className,...props}:Box){return <div {...props} className={cx('aims-card-footer',className)}/>;}
export type BadgeProps=HTMLAttributes<HTMLSpanElement>&{tone?:Tone};
export function Badge({tone='neutral',className,...props}:BadgeProps){return <span {...props} className={cx('aims-badge',`aims-tone-${tone}`,className)}/>;}
const statuses = {
  DRAFT:['Draft','neutral'], SUBMITTED:['Submitted','info'], VALIDATING:['Validating','info'], NEEDS_CLARIFICATION:['Needs clarification','warning'],
  PENDING_APPROVAL:['Pending approval','info'], APPROVED:['Approved','success'], FINANCE_CHECK:['Finance check','info'], FINANCE_HOLD:['Finance hold','warning'],
  READY_FOR_PAYMENT:['Ready for payment','success'], PAID:['Paid','success'], REJECTED:['Rejected','danger'], CANCELLED:['Cancelled','neutral'],
  QUARANTINED:['Awaiting security check','info'], SCANNING:['Checking document','info'], CLEAN:['Document ready','success'], SCAN_FAILED:['Security check failed','danger'],
  HISTORICAL:['Historical','neutral'], PENDING:['Pending','info'], PROCESSING:['Processing','info'], COMPLETED:['Completed','success'], PASS:['Pass','success'], HOLD:['Hold','warning'], FAILED:['Failed','danger'],
} as const;
export type UIStatus=keyof typeof statuses;
export function StatusChip({status,...props}:Omit<BadgeProps,'tone'|'children'>&{status:UIStatus}){
  const [label,tone]=statuses[status];return <Badge {...props} tone={tone}>{label}</Badge>;
}
export function Alert({tone='info',children,title,className,...props}:Box&{tone?:Tone;title?:string}){
  return <div {...props} role={tone==='danger'?'alert':'status'} className={cx('aims-alert',`aims-tone-${tone}`,className)}>{title&&<Typography variant="label">{title}</Typography>}{children}</div>;
}
export function EmptyState({title,children,action,...props}:Omit<Box,'title'>&{title:string;action?:ReactNode}){
  return <div {...props} className={cx('aims-empty',props.className)}><Typography variant="section">{title}</Typography><div>{children}</div>{action&&<div>{action}</div>}</div>;
}
export type FieldMeta={label:string;helper?:string;error?:string;success?:string};
export function FormField({id,label,helper,error,success,required,children}:FieldMeta&{id:string;required?:boolean;children:ReactNode}){
  return <div className="aims-field"><label className="aims-field-label" htmlFor={id}>{label}{required&&<span> (required)</span>}</label>{children}
    {error&&<p className="aims-field-error" id={`${id}-error`} role="alert">{error}</p>}
    {helper&&<p className="aims-field-helper" id={`${id}-helper`}>{helper}</p>}
    {!error&&success&&<p className="aims-field-success" id={`${id}-success`} role="status">{success}</p>}
  </div>;
}
function fieldDescription(id:string,meta:FieldMeta,provided?:string){return [provided,meta.helper&&`${id}-helper`,meta.error&&`${id}-error`,!meta.error&&meta.success&&`${id}-success`].filter(Boolean).join(' ')||undefined;}
export type InputProps=Omit<InputHTMLAttributes<HTMLInputElement>,'size'> & FieldMeta;
export function Input({id:provided,label,helper,error,success,className,...props}:InputProps){
  const generated=useId(),id=provided??generated,meta={label,helper,error,success};
  return <FormField {...meta} id={id} required={props.required}><input {...props} id={id} className={cx('aims-control',className)} aria-invalid={error?true:props['aria-invalid']} aria-describedby={fieldDescription(id,meta,props['aria-describedby'])} data-success={!error&&Boolean(success)}/></FormField>;
}
export type TextareaProps=TextareaHTMLAttributes<HTMLTextAreaElement>&FieldMeta;
export function Textarea({id:provided,label,helper,error,success,className,...props}:TextareaProps){
  const generated=useId(),id=provided??generated,meta={label,helper,error,success};
  return <FormField {...meta} id={id} required={props.required}><textarea {...props} id={id} className={cx('aims-control','aims-textarea',className)} aria-invalid={error?true:props['aria-invalid']} aria-describedby={fieldDescription(id,meta,props['aria-describedby'])} data-success={!error&&Boolean(success)}/></FormField>;
}
export type SelectProps=SelectHTMLAttributes<HTMLSelectElement>&FieldMeta;
export function Select({id:provided,label,helper,error,success,className,children,...props}:SelectProps){
  const generated=useId(),id=provided??generated,meta={label,helper,error,success};
  return <FormField {...meta} id={id} required={props.required}><select {...props} id={id} className={cx('aims-control',className)} aria-invalid={error?true:props['aria-invalid']} aria-describedby={fieldDescription(id,meta,props['aria-describedby'])} data-success={!error&&Boolean(success)}>{children}</select></FormField>;
}
type HeaderProps=Omit<HTMLAttributes<HTMLElement>,'title'>&{title:string;description?:string;actions?:ReactNode};
function Header({title,description,actions,level,className,...props}:HeaderProps&{level:'page'|'section'}){
  return <header {...props} className={cx('aims-header',className)}><div><Typography as={level==='page'?'h1':'h2'} variant={level}>{title}</Typography>{description&&<Typography>{description}</Typography>}</div>{actions&&<div className="aims-actions">{actions}</div>}</header>;
}
export function PageHeader(props:HeaderProps){return <Header {...props} level="page"/>;}
export function SectionHeader(props:HeaderProps){return <Header {...props} level="section"/>;}
export function TableContainer({label,density='default',children,className,...props}:Box&{label:string;density?:'default'|'compact'}){
  return <div {...props} className={cx('aims-table-container',className)} role="region" aria-label={label} tabIndex={0} data-density={density}>{children}</div>;
}
export type PaginationProps={page:number;totalPages?:number;total?:number;hasPreviousPage:boolean;hasNextPage:boolean;onPrevious:()=>void;onNext:()=>void;busy?:boolean;label?:string};
export function Pagination({page,totalPages,total,hasPreviousPage,hasNextPage,onPrevious,onNext,busy=false,label='Pagination'}:PaginationProps){
  return <nav className="aims-pagination" aria-label={label} aria-busy={busy||undefined}><span role="status">Page {page}{totalPages!==undefined&&` of ${totalPages}`}{total!==undefined&&` · ${total} records`}</span><div className="aims-actions"><Button disabled={!hasPreviousPage||busy} onClick={onPrevious} aria-label="Previous page">Previous</Button><Button disabled={!hasNextPage||busy} onClick={onNext} aria-label="Next page">Next</Button></div></nav>;
}
