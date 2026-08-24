import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import path from 'node:path';
import { AuthGuard } from './application/auth/auth.guard.js';
import { PaymentDocumentService } from './application/documents/payment-document.service.js';
import { DOCUMENT_STORAGE } from './application/documents/tokens.js';
import { PaymentRequestController } from './application/payment-requests/payment-request.controller.js';
import { PaymentRequestService } from './application/payment-requests/payment-request.service.js';
import { ValidationController } from './application/validation/validation.controller.js';
import { AI_PROVIDER, ValidationService } from './application/validation/validation.service.js';
import { OpenAiCompatibleProvider } from './infrastructure/ai/openai-compatible-provider.js';
import { Postgres } from './infrastructure/database/postgres.js';
import { correlationMiddleware } from './infrastructure/http/correlation.middleware.js';
import { LocalDocumentStorage, loadLocalStorageConfig } from './infrastructure/storage/local-document-storage.js';

@Module({
  controllers: [PaymentRequestController, ValidationController],
  providers: [Postgres, AuthGuard, PaymentRequestService, PaymentDocumentService, ValidationService, {
    provide: AI_PROVIDER,
    useFactory: () => process.env.OPENAI_API_KEY ? new OpenAiCompatibleProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL ?? 'gpt-5-mini', process.env.OPENAI_BASE_URL) : null,
  }, {
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
