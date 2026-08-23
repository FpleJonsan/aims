import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { PaymentDocumentService } from '../documents/payment-document.service.js';
import { CapturePaymentRequestDto, ListPaymentRequestsDto } from './payment-request.dto.js';
import { PaymentRequestService } from './payment-request.service.js';

@ApiTags('payment-requests')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('payment-requests')
export class PaymentRequestController {
  constructor(private readonly requests: PaymentRequestService, private readonly documents: PaymentDocumentService) {}

  @Post()
  initiate(@Req() request: Request) {
    return this.requests.initiate(request.principal, request.correlationId);
  }

  @Get()
  list(@Req() request: Request, @Query() query: ListPaymentRequestsDto) {
    return this.requests.list(request.principal, query);
  }

  @Get(':id')
  get(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(id, request.principal);
  }

  @Patch(':id')
  update(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: CapturePaymentRequestDto) {
    return this.requests.update(id, input, request.principal, request.correlationId);
  }

  @Post(':id/submit')
  submit(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.submit(id, request.principal, request.correlationId);
  }

  @Post(':id/documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10_485_760, files: 1 } }))
  upload(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body('documentType') documentType?: string) {
    if (!file) throw new BadRequestException('A document file is required');
    return this.documents.upload(id, file, documentType, request.principal, request.correlationId);
  }

  @Delete(':id/documents/:documentId')
  async remove(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    await this.documents.remove(id, documentId, request.principal, request.correlationId);
    return { removed: true };
  }
}
