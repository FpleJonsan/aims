import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { LocalDocumentStorage, loadLocalStorageConfig } from "./infrastructure/storage/local-document-storage.js";
import { parseRecoveryManifest, RecoveryManifestError } from "./infrastructure/recovery/recovery-manifest.js";
import { runRestoreChecker } from "./infrastructure/recovery/restore-checker.js";

async function main(){
  const manifestPath=process.argv[2];
  if(!manifestPath||process.argv.length!==3)throw new Error("usage: recovery-check <manifest.json>");
  const connectionString=process.env.RECOVERY_CHECK_DATABASE_URL;
  const release=process.env.AIMS_RELEASE_ID;
  if(!connectionString||!release)throw new Error("RECOVERY_CHECK_DATABASE_URL and AIMS_RELEASE_ID are required");
  const manifest=parseRecoveryManifest(JSON.parse(await readFile(manifestPath,"utf8")));
  const storage=process.env.STORAGE_DRIVER==="local"?new LocalDocumentStorage(loadLocalStorageConfig()):undefined;
  const pool=new Pool({connectionString,max:1,statement_timeout:10_000,connectionTimeoutMillis:5_000,options:"-c default_transaction_read_only=on"});
  try{
    const configuredTimeout=process.env.RECOVERY_CHECK_TIMEOUT_MS===undefined?60_000:Number(process.env.RECOVERY_CHECK_TIMEOUT_MS);
    const safeManifestReference=`manifest-${createHash("sha256").update(manifestPath).digest("hex").slice(0,16)}`;
    const result=await runRestoreChecker({pool,storage,manifest,runningApplicationRelease:release,manifestReference:safeManifestReference,documentMode:"FULL",overallTimeoutMs:configuredTimeout});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`AIMS recovery verification: ${result.overallStatus}; ${result.resumeRecommendation}\n`);
    process.exitCode=result.overallStatus==="PASS"?0:2;
  }finally{await pool.end()}
}
main().catch(error=>{const code=error instanceof RecoveryManifestError?`${error.code}${error.path?`:${error.path}`:""}`:"RECOVERY_CHECK_EXECUTION_ERROR";process.stderr.write(`AIMS recovery verification error: ${code}\n`);process.exitCode=3});
