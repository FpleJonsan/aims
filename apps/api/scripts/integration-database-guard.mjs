const forbiddenNames=new Set(["aims","aims_competition","postgres","production","staging","template0","template1"]);

export function assertDisposableIntegrationDatabase({databaseName,urls=[]}){
  if(typeof databaseName!=="string"||!/^aims_test_[a-z0-9_]+$/.test(databaseName)||forbiddenNames.has(databaseName)) throw new Error("integration database must be an explicit disposable aims_test_* database");
  if(!Array.isArray(urls)||urls.length!==3) throw new Error("all three isolated integration database URLs are required");
  for(const value of urls){
    if(typeof value!=="string"||value.length===0) throw new Error("isolated integration database URL is missing");
    let parsed;try{parsed=new URL(value);}catch{throw new Error("isolated integration database URL is invalid");}
    const target=decodeURIComponent(parsed.pathname.replace(/^\//,""));
    if(target!==databaseName||forbiddenNames.has(target)) throw new Error("integration database URL target does not match the approved disposable database");
  }
  return databaseName;
}
