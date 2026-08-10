import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { RequestMeta } from '../../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type {
  AcceptInvitationDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  TwoFactorLoginDto,
} from './dto/auth.dto';

type AuthMock = {
  login: jest.Mock;
  verifyTwoFactorLogin: jest.Mock;
  refresh: jest.Mock;
  logout: jest.Mock;
  forgotPassword: jest.Mock;
  resetPassword: jest.Mock;
  acceptInvitation: jest.Mock;
  getMe: jest.Mock;
};

function makeAuthMock(): AuthMock {
  return {
    login: jest.fn(),
    verifyTwoFactorLogin: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    acceptInvitation: jest.fn(),
    getMe: jest.fn(),
  };
}

function makeController(dashboardUrl = 'https://dashboard.wizer.test') {
  const auth = makeAuthMock();
  const config = {
    get: jest.fn().mockReturnValue(dashboardUrl),
  } as unknown as ConfigService;
  const controller = new AuthController(auth as unknown as AuthService, config);
  return { auth, controller };
}

function makeResponse() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    response: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

function makeRequest({
  cookie,
  origin,
  fetchSite,
}: {
  cookie?: string;
  origin?: string;
  fetchSite?: string;
} = {}): Request {
  return {
    headers: cookie === undefined ? {} : { cookie },
    get: (name: string) => {
      const normalized = name.toLowerCase();
      if (normalized === 'origin') return origin;
      if (normalized === 'sec-fetch-site') return fetchSite;
      return undefined;
    },
  } as unknown as Request;
}

function refreshJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
}

const meta = { ip: '127.0.0.1', userAgent: 'jest' } as RequestMeta;
const loginDto = { email: 'owner@example.test', password: 'Passw0rd!' } as LoginDto;

describe('AuthController browser-session boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a 2FA challenge without exposing or setting refresh credentials', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    const challenge = { requiresTwoFactor: true, challengeToken: 'challenge' };
    auth.login.mockResolvedValue(challenge);

    await expect(controller.login(loginDto, meta, response)).resolves.toBe(challenge);
    expect(auth.login).toHaveBeenCalledWith(loginDto, meta);
    expect(cookie).not.toHaveBeenCalled();
  });

  it('moves the refresh token into an HttpOnly strict cookie and returns only public tokens', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    const refreshToken = refreshJwt(Math.floor(Date.now() / 1000) + 3600);
    auth.login.mockResolvedValue({ accessToken: 'access', refreshToken, tokenType: 'Bearer' });

    const result = await controller.login(loginDto, meta, response);

    expect(result).toEqual({ accessToken: 'access', tokenType: 'Bearer' });
    expect(result).not.toHaveProperty('refreshToken');
    expect(cookie).toHaveBeenCalledWith(
      'wizer_refresh',
      refreshToken,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: expect.any(Number),
      }),
    );
  });

  it('uses a browser-session cookie if a freshly signed refresh token has no parseable expiry', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    auth.login.mockResolvedValue({ accessToken: 'access', refreshToken: 'malformed-token' });

    await controller.login(loginDto, meta, response);

    expect(cookie).toHaveBeenCalledWith(
      'wizer_refresh',
      'malformed-token',
      expect.not.objectContaining({ maxAge: expect.anything() }),
    );
  });

  it('clamps an already-expired refresh token cookie max-age to zero', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    const refreshToken = refreshJwt(1);
    auth.login.mockResolvedValue({ accessToken: 'access', refreshToken });

    await controller.login(loginDto, meta, response);

    expect(cookie).toHaveBeenCalledWith(
      'wizer_refresh',
      refreshToken,
      expect.objectContaining({ maxAge: 0 }),
    );
  });

  it('establishes the same cookie-backed browser session after successful 2FA', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    const dto = { challengeToken: 'challenge', code: '123456' } as TwoFactorLoginDto;
    auth.verifyTwoFactorLogin.mockResolvedValue({
      accessToken: 'access-2fa',
      refreshToken: 'refresh-2fa',
    });

    await expect(controller.loginTwoFactor(dto, meta, response)).resolves.toEqual({
      accessToken: 'access-2fa',
    });
    expect(auth.verifyTwoFactorLogin).toHaveBeenCalledWith(dto, meta);
    expect(cookie).toHaveBeenCalledWith(
      'wizer_refresh',
      'refresh-2fa',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('rejects cross-site refresh requests before reading or rotating credentials', async () => {
    const { auth, controller } = makeController();
    const { response } = makeResponse();
    const request = makeRequest({
      cookie: 'wizer_refresh=refresh',
      origin: 'https://dashboard.wizer.test',
      fetchSite: 'CrOsS-SiTe',
    });

    await expect(controller.refresh(request, response)).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('rejects a browser refresh from an unexpected origin', async () => {
    const { auth, controller } = makeController();
    const { response } = makeResponse();
    const request = makeRequest({
      cookie: 'wizer_refresh=refresh',
      origin: 'https://evil.example',
    });

    await expect(controller.refresh(request, response)).rejects.toThrow(
      'Refresh origin is not allowed.',
    );
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['no cookie header', undefined],
    ['no refresh cookie', 'other=value'],
    ['empty refresh cookie', 'wizer_refresh='],
    ['invalid percent encoding', 'wizer_refresh=%E0%A4%A'],
  ])('rejects refresh when the cookie is unusable: %s', async (_label, cookieHeader) => {
    const { auth, controller } = makeController();
    const { response } = makeResponse();

    await expect(
      controller.refresh(makeRequest({ cookie: cookieHeader }), response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('decodes and rotates the refresh cookie while preserving equals signs in its value', async () => {
    const { auth, controller } = makeController();
    const { response, cookie } = makeResponse();
    auth.refresh.mockResolvedValue({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    });
    const request = makeRequest({
      cookie: 'theme=dark; wizer_refresh=token%3Dwith%3Dequals; another=value',
      origin: 'https://dashboard.wizer.test',
      fetchSite: 'same-origin',
    });

    await expect(controller.refresh(request, response)).resolves.toEqual({
      accessToken: 'rotated-access',
    });
    expect(auth.refresh).toHaveBeenCalledWith('token=with=equals');
    expect(cookie).toHaveBeenCalledWith(
      'wizer_refresh',
      'rotated-refresh',
      expect.objectContaining({ path: '/api/auth/refresh' }),
    );
  });

  it('allows a non-browser refresh harness that omits Origin when the cookie is valid', async () => {
    const { auth, controller } = makeController();
    const { response } = makeResponse();
    auth.refresh.mockResolvedValue({ accessToken: 'access', refreshToken: 'rotated' });

    await expect(
      controller.refresh(makeRequest({ cookie: 'wizer_refresh=refresh' }), response),
    ).resolves.toEqual({ accessToken: 'access' });
    expect(auth.refresh).toHaveBeenCalledWith('refresh');
  });

  it('uses the localhost dashboard origin fallback when configuration is absent', async () => {
    const auth = makeAuthMock();
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const controller = new AuthController(auth as unknown as AuthService, config);
    const { response } = makeResponse();
    auth.refresh.mockResolvedValue({ accessToken: 'access', refreshToken: 'rotated' });

    await expect(
      controller.refresh(
        makeRequest({ cookie: 'wizer_refresh=refresh', origin: 'http://localhost:3000' }),
        response,
      ),
    ).resolves.toEqual({ accessToken: 'access' });
  });

  it('revokes logout server-side and clears the browser refresh cookie', async () => {
    const { auth, controller } = makeController();
    const { response, clearCookie } = makeResponse();
    const user = { id: 'user-1' } as unknown as AuthenticatedUser;
    auth.logout.mockResolvedValue({ success: true });

    await expect(controller.logout(user, response)).resolves.toEqual({ success: true });
    expect(auth.logout).toHaveBeenCalledWith(user);
    expect(clearCookie).toHaveBeenCalledWith(
      'wizer_refresh',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth/refresh',
      }),
    );
  });

  it('delegates forgot-password, reset-password, invitation acceptance and me lookups', async () => {
    const { auth, controller } = makeController();
    const forgot = { email: 'owner@example.test' } as ForgotPasswordDto;
    const reset = { token: 'reset-token', password: 'NewPassw0rd!' } as ResetPasswordDto;
    const invitation = {
      token: 'invite-token',
      name: 'Owner',
      password: 'Passw0rd!',
    } as AcceptInvitationDto;
    const user = { id: 'user-1' } as unknown as AuthenticatedUser;
    auth.forgotPassword.mockReturnValue({ success: true });
    auth.resetPassword.mockReturnValue({ success: true });
    auth.acceptInvitation.mockReturnValue({ user: { id: 'user-1' } });
    auth.getMe.mockReturnValue({ id: 'user-1' });

    expect(controller.forgotPassword(forgot, meta)).toEqual({ success: true });
    expect(controller.resetPassword(reset, meta)).toEqual({ success: true });
    expect(controller.acceptInvitation(invitation)).toEqual({ user: { id: 'user-1' } });
    expect(controller.me(user)).toEqual({ id: 'user-1' });
    expect(auth.forgotPassword).toHaveBeenCalledWith(forgot, meta);
    expect(auth.resetPassword).toHaveBeenCalledWith(reset, meta);
    expect(auth.acceptInvitation).toHaveBeenCalledWith(invitation);
    expect(auth.getMe).toHaveBeenCalledWith(user);
  });
});
