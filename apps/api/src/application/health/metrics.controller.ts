import {Controller,Get,Header} from "@nestjs/common";
import {metrics} from "../../infrastructure/observability/telemetry.js";

@Controller("metrics")
export class MetricsController{
  @Get() @Header("content-type","text/plain; version=0.0.4; charset=utf-8") expose(){return metrics.exposition()}
}
