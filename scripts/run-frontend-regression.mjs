#!/usr/bin/env node
// Runs every maintained root frontend regression test file as its own
// `node --test` process (sequential, not globbed) because several of these
// files build an isolated component render via esbuild+data-URI import and
// bleed shared module-cache/global state when run together in one process.
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const files=[
  'test/approval-ui.test.ts',
  'test/dashboard-navigation.test.ts',
  'test/dashboard-ui.test.ts',
  'test/document-polling.test.ts',
  'test/finance-context-ui.test.ts',
  'test/finance-control-ui.test.ts',
  'test/financial-analysis-ui.test.ts',
  'test/history-ui.test.ts',
  'test/payment-ui.test.ts',
  'test/policy-ready.test.ts',
  'test/policy-ui.test.ts',
  'test/request-ui.test.ts',
  'test/ui-library.test.ts',
  'test/validation-ui.test.ts',
  'test/workflow-stage-visibility.test.ts',
];

let totalTests=0,totalPass=0,totalFail=0;const failedFiles=[];
for(const file of files){
  const result=spawnSync(process.execPath,['--experimental-strip-types','--test',file],{cwd:root,encoding:'utf8'});
  const output=`${result.stdout}\n${result.stderr}`;
  const tests=Number(output.match(/^ℹ tests (\d+)$/m)?.[1]??0);
  const pass=Number(output.match(/^ℹ pass (\d+)$/m)?.[1]??0);
  const fail=Number(output.match(/^ℹ fail (\d+)$/m)?.[1]??0);
  totalTests+=tests;totalPass+=pass;totalFail+=fail;
  if(fail>0||result.status!==0){failedFiles.push(file);process.stderr.write(output);}
  console.log(`${fail>0||result.status!==0?'✖':'✔'} ${file} — tests ${tests}, pass ${pass}, fail ${fail}`);
}
console.log(JSON.stringify({result:failedFiles.length?'FAIL':'PASS',files:files.length,tests:totalTests,pass:totalPass,fail:totalFail,failedFiles}));
if(failedFiles.length)process.exit(1);
