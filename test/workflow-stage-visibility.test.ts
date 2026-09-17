import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

// Regression coverage for the "Validation review UI disappears once the workflow stepper's
// derived current stage advances to Finance Context, even though the current validation run is
// still AWAITING_HUMAN_REVIEW" defect. `deriveCurrentStage` is the single source of truth the
// Finance detail view uses to pick which stage panel is visible by default; these tests exercise
// it directly, extracted verbatim from app/page.tsx so the test can never drift from production
// behavior.
const source=await readFile('app/page.tsx','utf8'),ast=ts.createSourceFile('page.tsx',source,99,true,ts.ScriptKind.TSX);
const statusStageDeclaration=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='statusStage'));
assert.ok(statusStageDeclaration,'expected statusStage to be declared in app/page.tsx');
const deriveCurrentStageDeclaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='deriveCurrentStage');
assert.ok(deriveCurrentStageDeclaration,'expected deriveCurrentStage to be declared in app/page.tsx');
const body=`${statusStageDeclaration!.getText(ast)}\n${deriveCurrentStageDeclaration!.getText(ast)}\nexport {statusStage,deriveCurrentStage};`;
const {outputText}=ts.transpileModule(body,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}});
const {statusStage,deriveCurrentStage}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('a VALIDATING request whose current run is AWAITING_HUMAN_REVIEW resolves to stage 2 (Validation), not Finance Context',()=>{
  assert.equal(deriveCurrentStage('VALIDATING',true),2);
  assert.notEqual(deriveCurrentStage('VALIDATING',true),statusStage.VALIDATING);
});

test('the workflow rail is not incorrectly pinned to Finance Context merely because status is VALIDATING',()=>{
  // Before the fix this unconditionally returned statusStage.VALIDATING (3), hiding the
  // mandatory human-review controls regardless of whether validation had actually finished.
  assert.equal(statusStage.VALIDATING,3,'sanity: Finance Context is stage 3 for a VALIDATING request');
  assert.equal(deriveCurrentStage('VALIDATING',true),2,'must not silently advance past the pending review');
});

test('a completed validation run keeps prior behavior and still resolves to Finance Context',()=>{
  assert.equal(deriveCurrentStage('VALIDATING',false),statusStage.VALIDATING);
  assert.equal(deriveCurrentStage('VALIDATING',false),3);
});

test('no automatic PASS or state transition is implied: the derivation is a pure view-selection function',()=>{
  // Calling it twice with the same inputs must be side-effect-free and idempotent.
  assert.equal(deriveCurrentStage('VALIDATING',true),deriveCurrentStage('VALIDATING',true));
});

test('every other status is completely unaffected by the validationAwaitingReview flag, in either direction',()=>{
  for(const status of Object.keys(statusStage)){
    if(status==='VALIDATING')continue;
    assert.equal(deriveCurrentStage(status,true),statusStage[status],`${status} with flag=true`);
    assert.equal(deriveCurrentStage(status,false),statusStage[status],`${status} with flag=false`);
  }
});
