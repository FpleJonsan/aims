import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CorporateExchangeRequest, CorporateIdentityProvider, VerifiedCorporateIdentity } from "../../application/auth/corporate-identity.provider.js";
import { classifyAimsEnvironment } from "../configuration/aims-environment.js";

type TestClaims={alg:"HS256";iss:string;sub:string;aud:string;exp:number;nbf:number;nonce:string;pkce:string;email?:string;groups?:string[]};

/** Cryptographically signed deterministic provider used only by automated tests. */
export class TestCorporateIdentityProvider implements CorporateIdentityProvider {
  readonly adapterId="test-corporate";
  readonly expectedIssuer="https://test-idp.example.invalid";
  readonly authorizationEndpoint="https://test-idp.example.invalid/authorize";
  readonly available=true;
  readonly audience="aims-test-client";
  private authorization?:{challenge:string;nonce:string};
  constructor(private readonly key:Buffer,environment:Readonly<Record<string,string|undefined>>=process.env){
    if(classifyAimsEnvironment(environment).protected)throw new Error("TEST_CORPORATE_PROVIDER_FORBIDDEN_IN_PROTECTED_ENVIRONMENT");
    if(key.byteLength<32)throw new Error("TEST_CORPORATE_PROVIDER_KEY_INVALID");
  }
  buildAuthorizationRequest(input:{state:string;pkceChallenge:string;nonce:string}){
    this.authorization={challenge:input.pkceChallenge,nonce:input.nonce};
    const url=new URL(this.authorizationEndpoint);
    url.search=new URLSearchParams({response_type:"code",client_id:this.audience,state:input.state,nonce:input.nonce,code_challenge:input.pkceChallenge,code_challenge_method:"S256"}).toString();
    return{authorizationUrl:url.toString()};
  }
  issueCode(overrides:Partial<TestClaims>={}):string{
    if(!this.authorization)throw new Error("TEST_AUTHORIZATION_NOT_INITIATED");
    const now=Math.floor(Date.now()/1000);
    return this.sign({alg:"HS256",iss:this.expectedIssuer,sub:"known.subject",aud:this.audience,exp:now+60,nbf:now-1,nonce:this.authorization.nonce,pkce:this.authorization.challenge,...overrides});
  }
  async exchangeAndVerify(input:CorporateExchangeRequest):Promise<VerifiedCorporateIdentity>{
    const [payload,signature,...rest]=input.code.split(".");if(!payload||!signature||rest.length)throw new Error("INVALID_CODE");
    const expected=createHmac("sha256",this.key).update(payload).digest("base64url");
    if(!safeEqual(signature,expected))throw new Error("INVALID_SIGNATURE");
    let claims:TestClaims;try{claims=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as TestClaims}catch{throw new Error("INVALID_CLAIMS")}
    const now=Math.floor(Date.now()/1000);
    const challenge=createHash("sha256").update(input.pkceVerifier).digest("base64url");
    if(claims.alg!=="HS256"||claims.iss!==input.expectedIssuer||claims.aud!==this.audience||claims.exp<=now||claims.nbf>now||!claims.sub||claims.sub.length>255||claims.pkce!==challenge||createHash("sha256").update(claims.nonce).digest("hex")!==input.expectedNonceDigest)throw new Error("IDENTITY_VERIFICATION_FAILED");
    return{issuer:claims.iss,subject:claims.sub};
  }
  private sign(claims:TestClaims):string{const payload=Buffer.from(JSON.stringify(claims)).toString("base64url");return `${payload}.${createHmac("sha256",this.key).update(payload).digest("base64url")}`}
}
function safeEqual(left:string,right:string):boolean{const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}
