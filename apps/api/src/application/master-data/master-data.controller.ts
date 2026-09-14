import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import {
  CATEGORIES_MASTER_DATA,
  CURRENCIES_MASTER_DATA,
  DEPARTMENTS_MASTER_DATA,
  PAYMENT_METHODS_MASTER_DATA,
  PROJECTS_MASTER_DATA,
} from "./master-data.domains.js";
import { CreateMasterDataDto, ListMasterDataDto, UpdateMasterDataDto } from "./master-data.dto.js";
import { MasterDataService } from "./master-data.service.js";

/**
 * One reusable route surface, inherited by a thin per-domain subclass below.
 * Route decorators on these methods are inherited together with the
 * subclass's own @Controller(path) prefix — the standard NestJS pattern for
 * sharing a CRUD surface across multiple resources without duplicating it.
 */
@UseGuards(AuthGuard, FinanceMasterGuard)
export abstract class MasterDataController {
  protected constructor(private readonly masterData: MasterDataService) {}

  @Get()
  list(@Query() query: ListMasterDataDto) {
    return this.masterData.list(query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.masterData.get(id);
  }

  @Post()
  create(@Body() body: CreateMasterDataDto, @Req() request: Request) {
    return this.masterData.create(body, request.principal, request);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateMasterDataDto, @Req() request: Request) {
    return this.masterData.update(id, body, request.principal, request);
  }

  @Post(":id/enable")
  enable(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.masterData.setActive(id, true, request.principal, request);
  }

  @Post(":id/disable")
  disable(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.masterData.setActive(id, false, request.principal, request);
  }

  @Post(":id/soft-delete")
  softDelete(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.masterData.softDelete(id, request.principal, request);
  }
}

@Controller("admin/master-data/categories")
export class CategoriesController extends MasterDataController {
  constructor(@Inject(CATEGORIES_MASTER_DATA) service: MasterDataService) {
    super(service);
  }
}

@Controller("admin/master-data/departments")
export class MasterDataDepartmentsController extends MasterDataController {
  constructor(@Inject(DEPARTMENTS_MASTER_DATA) service: MasterDataService) {
    super(service);
  }
}

@Controller("admin/master-data/projects")
export class ProjectsController extends MasterDataController {
  constructor(@Inject(PROJECTS_MASTER_DATA) service: MasterDataService) {
    super(service);
  }
}

@Controller("admin/master-data/currencies")
export class CurrenciesController extends MasterDataController {
  constructor(@Inject(CURRENCIES_MASTER_DATA) service: MasterDataService) {
    super(service);
  }
}

@Controller("admin/master-data/payment-methods")
export class PaymentMethodsController extends MasterDataController {
  constructor(@Inject(PAYMENT_METHODS_MASTER_DATA) service: MasterDataService) {
    super(service);
  }
}
