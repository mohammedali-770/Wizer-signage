import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

import type { AuthenticatedDevice } from '../types/device.types';

/**
 * Injects the device principal attached by {@link DeviceAuthGuard}. Throws if the
 * route was not actually device-authenticated.
 */
export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedDevice => {
    const request = ctx.switchToHttp().getRequest<{ device?: AuthenticatedDevice }>();
    if (!request.device) {
      throw new UnauthorizedException('Device authentication required.');
    }
    return request.device;
  },
);
