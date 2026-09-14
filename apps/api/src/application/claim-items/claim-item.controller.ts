import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { ClaimItemService } from './claim-item.service.js';
import { CreateClaimItemDto, ReorderClaimItemsDto, UpdateClaimItemDto } from './claim-item.dto.js';

@ApiTags('claim-items')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('payment-requests/:id/claim-items')
export class ClaimItemController {
  constructor(private readonly claimItems: ClaimItemService) {}

  @Get()
  list(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.claimItems.list(id, request.principal);
  }

  @Post()
  create(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateClaimItemDto) {
    return this.claimItems.create(id, input, request.principal, request.correlationId, request.ip ?? null);
  }

  @Patch('reorder')
  reorder(@Req() request: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: ReorderClaimItemsDto) {
    return this.claimItems.reorder(id, input, request.principal, request.correlationId, request.ip ?? null);
  }

  @Patch(':claimItemId')
  update(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('claimItemId', ParseUUIDPipe) claimItemId: string,
    @Body() input: UpdateClaimItemDto,
  ) {
    return this.claimItems.update(id, claimItemId, input, request.principal, request.correlationId, request.ip ?? null);
  }

  @Delete(':claimItemId')
  async remove(
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('claimItemId', ParseUUIDPipe) claimItemId: string,
  ) {
    await this.claimItems.remove(id, claimItemId, request.principal, request.correlationId, request.ip ?? null);
    return { removed: true };
  }
}
