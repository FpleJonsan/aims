import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { validateProductionConfig } from './infrastructure/configuration/production-config.js';
import { OperationalExceptionFilter } from './infrastructure/http/operational-exception.filter.js';

async function bootstrap(): Promise<void> {
  validateProductionConfig();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new OperationalExceptionFilter());
  if (process.env.NODE_ENV !== 'production') {
    const openApi = new DocumentBuilder().setTitle('AIMS API').setVersion('1.0').addCookieAuth('aims_session').build();
    SwaggerModule.setup('openapi', app, SwaggerModule.createDocument(app, openApi));
  }
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '127.0.0.1');
}

void bootstrap();
