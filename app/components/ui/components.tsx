"use client";

import {useId, useEffect, useRef, type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes} from 'react';

const cx = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(' ');
const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
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
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'danger'|'text';busy?:boolean;busyLabel?:ReactNode};
/**
 * `busyLabel` is optional and additive: omit it and a busy button behaves
 * exactly as before (label unchanged, aria-busy + disabled + the reserved
 * spinner indicator only). Pass it only where exactly one action can be
 * in flight at a time — a `busy` flag shared by several simultaneously
 * visible buttons must not swap every one of their labels, since only one
 * of them is the action actually in progress.
 */
export function Button({variant='secondary',busy=false,busyLabel,disabled=false,type='button',className,children,...props}:ButtonProps){
  return <button {...props} type={type} disabled={disabled||busy} aria-busy={busy||undefined} className={cx('aims-button',`aims-button-${variant}`,className)}>
    <span className="aims-button-label">{busy&&busyLabel!==undefined?busyLabel:children}</span><span className="aims-button-indicator" aria-hidden="true" data-visible={busy}><LoadingSpinner decorative/></span>
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
function humanizeStatus(status:string){return status.replaceAll('_',' ').replace(/\w\S*/g,(word)=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase());}
/**
 * Renders through the shared `statuses` label/tone map whenever `status`
 * is one of the known enum values; falls back to a humanized (never raw)
 * label at a neutral tone for anything else, so an unexpected value from a
 * loosely-typed source (e.g. a generic `string` API field) degrades
 * gracefully instead of throwing or leaking a raw enum to the screen.
 */
export function StatusChip({status,...props}:Omit<BadgeProps,'tone'|'children'>&{status:UIStatus|(string&{})}){
  const known=(statuses as Record<string,readonly [string,Tone]>)[status];
  const [label,tone]=known??[humanizeStatus(status),'neutral'];
  return <Badge {...props} tone={tone} role="status" aria-label={`Status: ${label}`}>{label}</Badge>;
}
export function Alert({tone='info',children,title,className,...props}:Box&{tone?:Tone;title?:string}){
  return <div {...props} role={tone==='danger'?'alert':'status'} className={cx('aims-alert',`aims-tone-${tone}`,className)}>{title&&<Typography variant="label">{title}</Typography>}{children}</div>;
}
export type DialogProps = Omit<Box,'aria-labelledby'|'aria-describedby'|'role'> & {
  labelledBy: string;
  describedBy?: string;
  onClose?: () => void;
  dismissible?: boolean;
};
/**
 * Shared accessible dialog primitive: the one authoritative implementation of
 * focus trap, focus return, Escape-to-dismiss, background inertness, and
 * scroll lock for AIMS. Mount it only while the dialog should be open (e.g.
 * `{open && <Dialog ...>}`) — setup runs once on mount and its cleanup runs
 * once on unmount, which is what makes focus return to the trigger reliable.
 * `dismissible`/`onClose` are read live (via a ref) so a dialog that becomes
 * busy mid-lifetime can suppress Escape without needing to remount.
 */
export function Dialog({labelledBy,describedBy,onClose,dismissible=true,className,children,...props}:DialogProps){
  const ref=useRef<HTMLDivElement>(null);
  const live=useRef({onClose,dismissible});
  useEffect(()=>{live.current={onClose,dismissible};});
  useEffect(()=>{
    const node=ref.current;
    if(!node)return;
    const returnFocusTo=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const restoreInert:Array<()=>void>=[];
    let el:HTMLElement|null=node;
    while(el&&el!==document.body){
      const parent:HTMLElement|null=el.parentElement;
      if(parent){
        Array.from(parent.children).forEach(sibling=>{
          if(sibling!==el&&sibling instanceof HTMLElement&&!sibling.hasAttribute('inert')){
            sibling.setAttribute('inert','');
            restoreInert.push(()=>sibling.removeAttribute('inert'));
          }
        });
      }
      el=parent;
    }
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const focusable=node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable[0]??node).focus();
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        if(live.current.dismissible&&live.current.onClose){event.stopPropagation();live.current.onClose();}
        return;
      }
      if(event.key!=='Tab')return;
      const items=Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if(items.length===0){event.preventDefault();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKeyDown,true);
    return ()=>{
      document.removeEventListener('keydown',onKeyDown,true);
      document.body.style.overflow=previousOverflow;
      restoreInert.forEach(fn=>fn());
      returnFocusTo?.focus();
    };
  },[]);
  return <div ref={ref} {...props} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1} className={cx('aims-dialog',className)}>{children}</div>;
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
/**
 * The one shared header-row pattern for AIMS's ARIA-table lists: a
 * visually-hidden `role="row"` of `role="columnheader"` cells, meant to be
 * the first child of a `role="table"` container whose visible rows are
 * `role="row"` elements with `role="cell"` children in the same column
 * order. Chosen over a native `<table>` for these specific screens because
 * their rows/columns are governed by frozen, per-breakpoint CSS Grid rules
 * (P18.4 Responsive) that a native table would require rewriting; the ARIA
 * table pattern gives the same header/cell association without touching
 * that CSS. Reuse this for every workflow list — do not hand-roll a second
 * hidden header row.
 */
export function TableHeaderRow({columns}:{columns:string[]}){
  return <div role="row" className="aims-visually-hidden">{columns.map(label=><span role="columnheader" key={label}>{label}</span>)}</div>;
}
export type PaginationProps={page:number;totalPages?:number;total?:number;hasPreviousPage:boolean;hasNextPage:boolean;onPrevious:()=>void;onNext:()=>void;busy?:boolean;label?:string};
export function Pagination({page,totalPages,total,hasPreviousPage,hasNextPage,onPrevious,onNext,busy=false,label='Pagination'}:PaginationProps){
  return <nav className="aims-pagination" aria-label={label} aria-busy={busy||undefined}><span role="status">Page {page}{totalPages!==undefined&&` of ${totalPages}`}{total!==undefined&&` · ${total} records`}</span><div className="aims-actions"><Button disabled={!hasPreviousPage||busy} onClick={onPrevious} aria-label="Previous page">Previous</Button><Button disabled={!hasNextPage||busy} onClick={onNext} aria-label="Next page">Next</Button></div></nav>;
}
