"use client";

import { useEffect, useState } from "react";
import { RequestList } from "@/app/components/payment-request/RequestList";
import { financeQueueItem, paymentQueueItem } from "@/app/lib/mappers";
import type { DashboardDrill, PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function ReportingRequestDrill({api,drill,back}:{api:PortalApi;drill:Extract<DashboardDrill,{view:"REPORTING_REQUESTS"}>;back:()=>void}) {
  const [data,setData]=useState<{items:Array<Record<string,unknown>>;total:number}|null>(null),[notice,setNotice]=useState("");
  const query=new URLSearchParams({view:drill.reportView,...Object.fromEntries(Object.entries(drill.filters).filter(([,v])=>v))}).toString();
  useEffect(()=>{let active=true;void api(`/dashboard/requests?${query}`).then((x)=>{if(active)setData(x as {items:Array<Record<string,unknown>>;total:number})}).catch((e)=>{if(active)setNotice(msg(e))});return()=>{active=false}},[api,query]);
  return <section className="card reportingDrill"><button className="back" onClick={back}>← Finance Dashboard</button><header><div><small>REPORTING VIEW · READ ONLY</small><h2>{drill.reportView==="PENDING_APPROVAL"?"Pending Approval":"High / Critical Risk"}</h2></div></header>{notice&&<p className="notice">{notice}</p>}<p>{data?.total??0} authoritative records · reporting access does not grant Approval or Payment authority.</p><div className="table">{data?.items.map((x)=><div className="reportingRow" key={String(x.id)}><span className="ticket">{String(x.ticket_number)}</span><span><b>{String(x.payee)}</b><small>{String(x.department)} · {String(x.category)}</small></span><span>{String(x.currency)} {String(x.amount)}<small>{String(x.status)}</small></span><span><b>{String(x.final_risk??"—")}</b><small>{String(x.final_priority??"—")}</small></span></div>)}</div>{data&&!data.items.length&&<p>NO DATA IN SELECTED RANGE</p>}</section>;
}

export function OperationalDrill({api,drill,open,back}:{api:PortalApi;drill:Extract<DashboardDrill,{view:"FINANCE_CONTROL"|"PAYMENT_QUEUE"}>;open:(id:string)=>Promise<void>;back:()=>void}) {
  const [rows,setRows]=useState<PaymentRequestItem[]>([]),[notice,setNotice]=useState("");
  useEffect(()=>{let active=true;const query=new URLSearchParams(Object.entries({departmentId:drill.filters.departmentId,category:drill.filters.category}).filter(([,v])=>v)).toString(),path=`${drill.view==="FINANCE_CONTROL"?"/finance-control":"/payment-queue"}?${query}`;void api(path).then((x)=>{if(!active)return;const raw=(x as {items:Array<Record<string,unknown>>}).items;const mapped=raw.map(drill.view==="FINANCE_CONTROL"?financeQueueItem:paymentQueueItem);setRows(mapped.filter((item)=>item.status===drill.status));}).catch((e)=>{if(active)setNotice(msg(e))});return()=>{active=false}},[api,drill]);
  return <section><button className="back" onClick={back}>← Finance Dashboard</button>{notice&&<p className="notice">{notice}</p>}<RequestList items={rows} open={open} empty={()=>Promise.resolve()} canCreate={false} requesterView={false} financeView={drill.view==="FINANCE_CONTROL"?"finance-control":"payment-queue"}/></section>;
}
