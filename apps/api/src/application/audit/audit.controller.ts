import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { AuditQueryDto } from "./audit.dto.js";
import { AuditService } from "./audit.service.js";

@UseGuards(AuthGuard,FinanceMasterGuard)
@Controller("admin/audit")
export class AuditController{constructor(private readonly audits:AuditService){}@Get()list(@Query()query:AuditQueryDto){return this.audits.list(query)}}
