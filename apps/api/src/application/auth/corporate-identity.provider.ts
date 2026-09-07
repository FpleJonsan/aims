export const CORPORATE_IDENTITY_PROVIDER = Symbol("CORPORATE_IDENTITY_PROVIDER");

export type CorporateAuthorizationRequest = {
  authorizationUrl: string;
};

export type CorporateExchangeRequest = {
  code: string;
  pkceVerifier: string;
  expectedIssuer: string;
  expectedNonceDigest: string;
};

export type VerifiedCorporateIdentity = {
  issuer: string;
  subject: string;
};

export interface CorporateIdentityProvider {
  readonly adapterId: string;
  readonly expectedIssuer: string;
  readonly authorizationEndpoint: string;
  readonly available: boolean;
  buildAuthorizationRequest(input: {
    state: string;
    pkceChallenge: string;
    nonce: string;
  }): CorporateAuthorizationRequest;
  exchangeAndVerify(input: CorporateExchangeRequest): Promise<VerifiedCorporateIdentity>;
}

export class UnavailableCorporateIdentityProvider implements CorporateIdentityProvider {
  readonly adapterId = "unconfigured";
  readonly expectedIssuer = "unconfigured";
  readonly authorizationEndpoint = "https://unconfigured.invalid/authorize";
  readonly available = false;
  buildAuthorizationRequest(): never { throw new Error("CORPORATE_IDENTITY_PROVIDER_NOT_CONFIGURED"); }
  async exchangeAndVerify(): Promise<never> { throw new Error("CORPORATE_IDENTITY_PROVIDER_NOT_CONFIGURED"); }
}
