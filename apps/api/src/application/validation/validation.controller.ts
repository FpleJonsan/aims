import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { ClarificationResponseDto, ManualValidationDto } from './validation.dto.js';
import { ValidationService } from './validation.service.js';

@UseGuards(AuthGuard) @Controller('payment-requests/:id')
export class ValidationController {
 constructor(private readonly validation:ValidationService){}
 @Post('validation') start(@Req() req:Request,@Param('id',ParseUUIDPipe)id:string){return this.validation.start(id,req.principal,req.correlationId)}
 @Get('validation') get(@Req() req:Request,@Param('id',ParseUUIDPipe)id:string){return this.validation.get(id,req.principal)}
 @Get('validation/history') history(@Req() req:Request,@Param('id',ParseUUIDPipe)id:string){return this.validation.get(id,req.principal)}
 @Post('validation/manual') manual(@Req() req:Request,@Param('id',ParseUUIDPipe)id:string,@Body()body:ManualValidationDto){return this.validation.finalize(id,body,req.principal,req.correlationId)}
 @Post('clarifications/:clarificationId/respond') respond(@Req() req:Request,@Param('id',ParseUUIDPipe)id:string,@Param('clarificationId',ParseUUIDPipe)clarificationId:string,@Body()body:ClarificationResponseDto){return this.validation.respond(id,clarificationId,body,req.principal,req.correlationId)}
}
