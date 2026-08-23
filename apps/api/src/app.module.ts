import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import path from 'node:path';
import { AuthGuard } from './application/auth/auth.guard.js';
import { PaymentDocumentService } from './application/documents/payment-document.service.js';
import { DOCUMENT_STORAGE } from './application/documents/tokens.js';
import { PaymentRequestController } from './application/payment-requests/payment-request.controller.js';
import { PaymentRequestService } from './application/payment-requests/payment-request.service.js';
import { Postgres } from './infrastructure/database/postgres.js';
import { correlationMiddleware } from './infrastructure/http/correlation.middleware.js';
import { LocalDocumentStorage, loadLocalStorageConfig } from './infrastructure/storage/local-document-storage.js';

@Module({
  controllers: [PaymentRequestController],
  providers: [Postgres, AuthGuard, PaymentRequestService, PaymentDocumentService, {
    provide: DOCUMENT_STORAGE,
    useFactory: () => {
      const cwd = process.cwd();
      const applicationRoot = cwd.endsWith(`${path.sep}apps${path.sep}api`) ? path.resolve(cwd, '../..') : cwd;
      return new LocalDocumentStorage(loadLocalStorageConfig(process.env, applicationRoot));
    },
  }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware).forRoutes('*');
  }
}
