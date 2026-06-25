import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { ReqMeta, type RequestMeta } from '../../common/decorators/request-meta.decorator';
import { DemoRequestDto } from './dto/demo-request.dto';
import { TrialSignupDto } from './dto/trial-signup.dto';
import { PublicService } from './public.service';

/**
 * Unauthenticated endpoints consumed by the public marketing website.
 * `@Public()` bypasses the global JWT guard; each mutating route is rate-limited.
 */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicSvc: PublicService) {}

  @Post('trial-signup')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } }) // 5 / hour per IP
  @ApiOperation({ summary: 'Create a trial tenant (company + owner + trial subscription).' })
  trialSignup(@Body() dto: TrialSignupDto, @ReqMeta() meta: RequestMeta) {
    return this.publicSvc.trialSignup(dto, meta);
  }

  @Post('demo-request')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } }) // 5 / hour per IP
  @ApiOperation({ summary: 'Submit a "Book a Demo" / contact-sales request.' })
  demoRequest(@Body() dto: DemoRequestDto, @ReqMeta() meta: RequestMeta) {
    return this.publicSvc.demoRequest(dto, meta);
  }

  @Get('plans')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List active public plans for the marketing pricing page.' })
  plans() {
    return this.publicSvc.listPublicPlans();
  }
}
