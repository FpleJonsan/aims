import assert from "node:assert/strict";
import test from "node:test";
import {assertDisposableIntegrationDatabase} from "./integration-database-guard.mjs";

const urls=name=>["aims_app","aims_finance_runtime","aims_payment_runtime"].map(user=>`postgresql://${user}:test@127.0.0.1:5432/${name}`);

test("integration database guard accepts only an explicit disposable identity",()=>{
  assert.equal(assertDisposableIntegrationDatabase({databaseName:"aims_test_123",urls:urls("aims_test_123")}),"aims_test_123");
});

for(const name of ["aims","aims_competition","production","staging","postgres"]){
  test(`integration database guard rejects ${name} before fixture execution`,()=>{
    assert.throws(()=>assertDisposableIntegrationDatabase({databaseName:name,urls:urls(name)}),/explicit disposable/);
  });
}

test("integration database guard rejects missing, ambiguous, and mismatched configuration",()=>{
  assert.throws(()=>assertDisposableIntegrationDatabase({databaseName:"aims_test_123",urls:[]}),/three isolated/);
  assert.throws(()=>assertDisposableIntegrationDatabase({databaseName:"aims_test_123",urls:urls("aims")}),/does not match/);
});
