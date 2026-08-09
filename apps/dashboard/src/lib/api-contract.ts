import type { components, paths } from './api-contract.generated';

/**
 * Stable aliases over the generated OpenAPI output.
 *
 * Application code should import contract-backed response/request types from
 * this module instead of reaching into `components` everywhere. The generated
 * file is never edited by hand and CI checks it against contracts/openapi.json.
 */
export type ContractSchemas = components['schemas'];
export type ContractPaths = paths;

export type ContractUserView = ContractSchemas['UserViewDto'];
export type ContractMeResponse = ContractSchemas['MeResponseDto'];
export type ContractAuthTokens = ContractSchemas['AuthTokensDto'];
export type ContractTwoFactorChallenge = ContractSchemas['TwoFactorChallengeDto'];
