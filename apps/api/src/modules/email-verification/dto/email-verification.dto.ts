import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmEmailDto {
  @ApiProperty({
    description:
      'The single-use token from the confirmation link. Consumed on first use; ' +
      'requesting a new link invalidates any outstanding one.',
    minLength: 16,
    maxLength: 512,
  })
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({
    maxLength: 320,
    description:
      'Always answered identically whether or not the address exists or is already ' +
      'verified — this route is unauthenticated and a truthful answer would make it ' +
      'an account-existence oracle.',
  })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class EmailVerificationResultDto {
  @ApiProperty({ description: 'Always true; failures are returned as errors.' })
  success!: boolean;

  @ApiProperty({ description: 'The address that is now confirmed.' })
  email!: string;
}

export class ResendVerificationResultDto {
  @ApiProperty({
    description:
      'Fixed acknowledgement. Does NOT indicate that an email was sent — see the ' +
      'oracle note on the request shape.',
  })
  success!: boolean;
}
