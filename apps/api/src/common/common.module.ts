import { Global, Module } from '@nestjs/common';

import { TenantContextService } from './context/tenant-context.service';
import { CryptoService } from './crypto/crypto.service';
import { PasswordService } from './crypto/password.service';

/**
 * Global module exposing cross-cutting services (crypto, password hashing,
 * tenant context) to the whole application without per-module imports.
 */
@Global()
@Module({
  providers: [CryptoService, PasswordService, TenantContextService],
  exports: [CryptoService, PasswordService, TenantContextService],
})
export class CommonModule {}
