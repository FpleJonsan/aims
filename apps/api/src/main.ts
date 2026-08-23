import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const openApi = new DocumentBuilder().setTitle('AIMS Day 1 API').setVersion('1.0').addApiKey({ type: 'apiKey', in: 'header', name: 'x-aims-user' }).build();
  SwaggerModule.setup('openapi', app, SwaggerModule.createDocument(app, openApi));
  await app.listen(Number(process.env.API_PORT ?? 3001), '127.0.0.1');
}

void bootstrap();
