import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live") liveness() { return this.health.liveness(); }

  @Get("ready") @HttpCode(HttpStatus.OK)
  async readiness(@Res({ passthrough: true }) response: Response) {
    const result = await this.health.readiness();
    if (result.status !== "ready") response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
