import assert from "node:assert/strict";
import test from "node:test";
import { parseRecoveryManifest, RecoveryManifestError } from "../src/infrastructure/recovery/recovery-manifest.js";

const valid=()=>({specificationVersion:"1",environment:"isolated-restore",databaseRecoveryReference:"db-evidence-1",databaseRecoveryPoint:"2026-09-01T00:00:00Z",objectRecoveryReference:"object-evidence-1",applicationRelease:"release-59",schemaVersion:59,latestMigrationId:"059_p12_recovery_generation_fencing",expectedRecoveryGeneration:"123e4567-e89b-42d3-a456-426614174000",generationAdvancementEvidenceReference:"generation-evidence-1",createdAt:"2026-09-01T01:00:00Z",integrity:{algorithm:"PROVIDER_ATTESTATION_REQUIRED",evidenceReference:"provider-attestation-required"},operatorMetadata:{incidentId:"INC-1"}});

test("valid recovery manifest is parsed and bounded",()=>assert.equal(parseRecoveryManifest(valid()).schemaVersion,59));
test("unknown manifest version fails closed",()=>assert.throws(()=>parseRecoveryManifest({...valid(),specificationVersion:"2"}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_VERSION_UNSUPPORTED"));
test("overlong fields are rejected",()=>assert.throws(()=>parseRecoveryManifest({...valid(),applicationRelease:"x".repeat(129)}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_RELEASE_REQUIRED"));
test("missing recovery reference is rejected",()=>assert.throws(()=>parseRecoveryManifest({...valid(),databaseRecoveryReference:undefined}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_DATABASE_REFERENCE_REQUIRED"));
test("unsupported schema and migration fail closed",()=>{assert.throws(()=>parseRecoveryManifest({...valid(),schemaVersion:58}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_SCHEMA_UNSUPPORTED");assert.throws(()=>parseRecoveryManifest({...valid(),latestMigrationId:"058_old"}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_MIGRATION_UNSUPPORTED")});
test("secret-like uncontracted fields are rejected",()=>assert.throws(()=>parseRecoveryManifest({...valid(),password:"never"}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_FIELD_PROHIBITED"));
test("provider metadata is strictly bounded",()=>assert.throws(()=>parseRecoveryManifest({...valid(),operatorMetadata:{providerNote:"x".repeat(257)}}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_OPERATOR_METADATA_INVALID"));
test("operator metadata cannot carry secrets or connection strings",()=>{assert.throws(()=>parseRecoveryManifest({...valid(),operatorMetadata:{accessToken:"never"}}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_FIELD_PROHIBITED");assert.throws(()=>parseRecoveryManifest({...valid(),operatorMetadata:{incidentId:"postgresql://user:password@host/db"}}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_PROHIBITED_CONTENT")});
test("every operator supplied reference field rejects credential-bearing URIs without echoing them",()=>{
  const credential="do-not-echo-p12-secret",uri=`postgresql://operator:${credential}@db.invalid/aims`;
  const cases:Array<[string,(input:ReturnType<typeof valid>)=>void]>=[
    ["databaseRecoveryReference",input=>{input.databaseRecoveryReference=uri}],
    ["objectRecoveryReference",input=>{input.objectRecoveryReference=uri}],
    ["applicationRelease",input=>{input.applicationRelease=uri}],
    ["generationAdvancementEvidenceReference",input=>{input.generationAdvancementEvidenceReference=uri}],
    ["integrity.evidenceReference",input=>{input.integrity.evidenceReference=uri}],
    ["operatorMetadata.incidentId",input=>{input.operatorMetadata.incidentId=uri}],
  ];
  for(const [path,mutate] of cases){const input=valid();mutate(input);assert.throws(()=>parseRecoveryManifest(input),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_PROHIBITED_CONTENT"&&error.path===path&&!error.message.includes(credential))}
});
test("generic URI userinfo and explicit secret assignments are rejected while opaque references remain valid",()=>{
  assert.throws(()=>parseRecoveryManifest({...valid(),objectRecoveryReference:"https://user:password@provider.invalid/snapshot"}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_PROHIBITED_CONTENT");
  assert.throws(()=>parseRecoveryManifest({...valid(),databaseRecoveryReference:"database_url=hidden"}),error=>error instanceof RecoveryManifestError&&error.code==="MANIFEST_PROHIBITED_CONTENT");
  assert.equal(parseRecoveryManifest(valid()).databaseRecoveryReference,"db-evidence-1");
});
