import { Global, Module } from '@nestjs/common';

import { TenantContextService } from './context/tenant-context.service';
import { CryptoService } from './crypto/crypto.service';
import { PasswordService } from './crypto/password.service';
import { CaptchaService } from './security/captcha.service';
import { UploadSpoolService } from './upload/upload-spool.service';

/**
 * Global module exposing cross-cutting services (crypto, password hashing,
 * tenant context) to the whole application without per-module imports.
 */
@Global()
@Module({
  providers: [
    CryptoService,
    PasswordService,
    TenantContextService,
    UploadSpoolService,
    CaptchaService,
  ],
  exports: [CryptoService, PasswordService, TenantContextService, CaptchaService],
})
export class CommonModule {}
