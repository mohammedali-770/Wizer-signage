import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}

export class TwoFactorLoginDto {
  @IsString()
  challengeToken!: string;

  @IsString()
  @Length(6, 12)
  code!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

export class AcceptInvitationDto {
  @IsString()
  token!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}
