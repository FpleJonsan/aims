import { Controller,Get,Param,ParseUUIDPipe,Post,Req,UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { FinanceContextService } from './finance-context.service.js';
@UseGuards(AuthGuard) @Controller('payment-requests/:id/finance-context')
export class FinanceContextController{
 constructor(private readonly contexts:FinanceContextService){}
 @Post() calculate(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return this.contexts.calculate(id,req.principal,req.correlationId)}
 @Post('recalculate') recalculate(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return this.contexts.calculate(id,req.principal,req.correlationId,true)}
 @Get() get(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return this.contexts.get(id,req.principal,false)}
 @Get('history') history(@Req()req:Request,@Param('id',ParseUUIDPipe)id:string){return this.contexts.get(id,req.principal,true)}
}
