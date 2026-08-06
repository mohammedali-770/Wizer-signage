import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Response shapes for the OpenAPI contract.
 *
 * These have to be CLASSES, not the interfaces the services already return.
 * `@nestjs/swagger` builds its schemas from emitted decorator metadata, and a
 * TypeScript interface is erased at compile time — there is nothing left to
 * reflect. That is why `contracts/openapi.json` described 67 request DTOs and
 * ZERO response models: exactly one of 38 controllers declared a response type,
 * so the contract documented what clients send and said nothing about what they
 * get back. Anything generated from it (starting with the dashboard's
 * hand-copied types.ts) would have inherited that hole.
 *
 * They are deliberately declaration-only — no runtime behaviour, no validation.
 * The service return types stay the source of truth for the code; these describe
 * that truth to the contract, and `ApiOkResponse` on the controller is what ties
 * the two together.
 */

/** Pagination envelope carried by every list endpoint. */
export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 25 })
  pageSize!: number;

  @ApiProperty({ example: 137, description: 'Total matching rows, ignoring pagination.' })
  total!: number;

  @ApiProperty({ example: 6 })
  totalPages!: number;
}

/**
 * The acknowledgement shapes.
 *
 * There are seven of them, and that is the point. Every one of these endpoints
 * "returns nothing useful", so the first pass pointed all of them at
 * `SuccessResponseDto` — which made the contract claim a `success` field on
 * nine routes that have never sent one, while hiding the field they do send.
 * A client checking `res.success` reads `undefined` and treats a successful
 * delete as a failure.
 *
 * The sixth (`ok`) turned up in scheduled-reports and the seventh
 * (`{ ok, updated }`) in notifications, which is the argument against tidying
 * these up as they are found: the list was "five" until the next module was
 * read, then "six" until the one after that. The seventh is two of the others
 * at once — a client that special-cased `ok` and a client that special-cased
 * `updated` would both be half right.
 *
 * Reaching for one shared shape is the same mistake as deriving a DTO from the
 * Prisma model: it documents what the shape ought to be rather than what it is.
 * The API is inconsistent here; the contract's job is to say so accurately, not
 * to tidy it up. Unifying them is a breaking API change and belongs in its own
 * commit, not in a documentation pass.
 */

/** `{ success: true }` — auth's logout / forgot-password / reset-password. */
export class SuccessResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}

/** `{ deleted: true }` — the delete routes (users, locations, playlists, schedules, tags). */
export class DeletedResponseDto {
  @ApiProperty({ example: true })
  deleted!: boolean;
}

/** `{ updated: true }` — PUT /screens/{id}/kiosk-pin. */
export class UpdatedResponseDto {
  @ApiProperty({ example: true })
  updated!: boolean;
}

/** `{ reset: true }` — DELETE /screens/{id}/kiosk-pin. */
export class ResetResponseDto {
  @ApiProperty({ example: true })
  reset!: boolean;
}

/** `{ affected: n }` — the bulk screen operations. A COUNT, not a boolean. */
export class AffectedResponseDto {
  @ApiProperty({ example: 12, description: 'How many screens the operation touched.' })
  affected!: number;
}

/** `{ ok: true }` — DELETE /scheduled-reports/{id}. A sixth spelling of "done". */
export class OkResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}

/**
 * `{ ok: true, updated: n }` — POST /notifications/read-all.
 *
 * The seventh, and the one that shows why these are not being unified on sight:
 * it is two of the other shapes at once. A client that special-cased `ok` and a
 * client that special-cased `updated` would both be half right.
 */
export class OkUpdatedResponseDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 4, description: 'How many notifications were still unread.' })
  updated!: number;
}

/** `{ purged: n }` — POST /content/trash/purge. A COUNT, not a boolean. */
export class PurgedResponseDto {
  @ApiProperty({ example: 3, description: 'How many trashed items were permanently removed.' })
  purged!: number;
}

/**
 * A user as the API returns it.
 *
 * Mirrors `UserView` — the Prisma `User` minus `passwordHash`,
 * `twoFactorSecret` and `twoFactorPendingSecret`. Those three are absent on
 * purpose and must stay absent: this class is published documentation, so a
 * field added here is a field the contract promises to return.
 */
export class UserViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'LOCATION_MANAGER', 'CONTENT_MANAGER', 'VIEWER'],
  })
  role!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INVITED', 'LOCKED', 'DISABLED'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true, description: 'null for a platform-level Super Admin.' })
  companyId?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastLoginAt?: string | null;

  @ApiProperty()
  twoFactorEnabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * `@ApiPaginatedResponse(Dto)` — a 200 whose body is `{ items: Dto[], meta }`.
 *
 * Nearly every list endpoint on the platform returns that envelope, and Swagger
 * has no way to express a generic: `@ApiOkResponse({ type: Paginated<UserViewDto> })`
 * compiles and emits nothing useful, because the generic is erased before the
 * decorator ever sees it. Written out per endpoint it is eight lines of
 * boilerplate each, across ~40 list routes, which is how a contract ends up with
 * the envelope described inconsistently or not at all.
 *
 * `extra` is for the lists that return MORE than the envelope — notifications
 * adds `unreadCount`, alerts adds `openCount`. Those are the reason the helper
 * takes a parameter at all: applied bare, it would have documented a two-key
 * object for a response that has three, and the field a client actually wants
 * (the unread badge count) would have been the one missing. A helper is only
 * safe where it is TRUE, and this is the seam where it stops being true.
 */
export function ApiPaginatedResponse<T extends Type<unknown>>(
  model: T,
  extra?: Record<string, SchemaObject>,
) {
  return applyDecorators(
    // The item model is referenced only from inside the inline schema below, so
    // Swagger would not otherwise emit it into components.schemas.
    ApiExtraModels(model, PageMetaDto),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'meta', ...Object.keys(extra ?? {})],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMetaDto) },
          ...extra,
        },
      },
    }),
  );
}
