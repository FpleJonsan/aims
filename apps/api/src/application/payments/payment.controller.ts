import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { PaymentListDto, RecordPaymentDto } from "./payment.dto.js";
import { DashboardFilterDto } from "../dashboard/dashboard.dto.js";
import { PaymentService } from "./payment.service.js";
import {observeOperation,observePaymentRecord} from "../../infrastructure/observability/telemetry.js";

@UseGuards(AuthGuard)
@Controller()
export class PaymentController {
  constructor(private readonly service: PaymentService) {}
  @Get("payment-queue") queue(@Req() r: Request, @Query() q: DashboardFilterDto) {
    return this.service.queue(r.principal, q);
  }
  @Post("payment-requests/:id/payment-slip")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 10_485_760, files: 1 } }),
  )
  slip(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("A payment slip is required");
    return observeOperation("PAYMENT_SLIP_UPLOAD","WEB",r.correlationId,()=>this.service.uploadSlip(id, file, r.principal, r.correlationId));
  }
  @Post("payment-requests/:id/payment") record(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RecordPaymentDto,
  ) {
    return observePaymentRecord(r.correlationId,report=>this.service.record(id, body, r.principal, r.correlationId,report));
  }
  @Get("payments") list(@Req() r: Request, @Query() q: PaymentListDto) {
    return this.service.list(r.principal, q);
  }
  @Get("payments/export") async export(
    @Req() r: Request,
    @Query() q: PaymentListDto,
    @Res() res: Response,
  ) {
    const csv = await this.service.export(r.principal, q);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      'attachment; filename="aims-payments.csv"',
    );
    res.send(csv);
  }
  @Get("payments/:id/slip") async download(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.service.downloadSlip(
      id,
      r.principal,
      r.correlationId,
    );
    res.setHeader("content-type", file.mimeType);
    res.setHeader(
      "content-disposition",
      `attachment; filename="${file.filename.replaceAll('"', "")}"`,
    );
    res.send(Buffer.from(file.data));
  }
  @Get("payments/:id") get(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(id, r.principal);
  }
}
