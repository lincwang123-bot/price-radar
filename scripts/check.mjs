import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
for(const dir of ["lib","sources","collectors","scripts"]){
 for(const file of readdirSync(dir,{recursive:true}))if(file.endsWith(".mjs"))execFileSync(process.execPath,["--check",path.join(dir,file)],{stdio:"inherit"});
}
execFileSync(process.execPath,["--check","radar.mjs"],{stdio:"inherit"});
execFileSync(process.execPath,["--test"],{stdio:"inherit"});
