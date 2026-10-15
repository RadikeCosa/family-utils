import { writeFile } from "node:fs/promises";
import pg from "pg";
import env from "@next/env";

env.loadEnvConfig(process.cwd());
const familyIndex=process.argv.indexOf("--family");
const familyId=familyIndex>=0?process.argv[familyIndex+1]:null;
const execute=process.argv.includes("--execute");
const backupArg=process.argv.findIndex(arg=>arg==="--backup");
const backupPath=backupArg>=0?process.argv[backupArg+1]:null;
if(!familyId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId))throw new Error("Pass an exact --family UUID. No rows are selected without it.");
const connectionString=process.env.FAMILY_UTILS_TEST_DATABASE_URL;
if(!connectionString)throw new Error("FAMILY_UTILS_TEST_DATABASE_URL is required; production DATABASE_URL values are never used by this cleanup script.");
if(backupArg>=0&&!backupPath)throw new Error("--backup requires a destination path.");
const pool=new pg.Pool({connectionString,ssl:connectionString.includes("localhost")||connectionString.includes("127.0.0.1")?false:{rejectUnauthorized:false}});
const tables=["sports_comments","sports_formations","sports_fights","sports_sync_item_state","sports_sync_state","sports_auto_sync_settings","sports_weeks","sports_events"];
const client=await pool.connect();
try{
 const counts={};for(const table of tables){const {rows:[row]}=await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE family_id=$1`,[familyId]);counts[table]=row.count;}
 console.log(JSON.stringify({mode:execute?"execute":"dry-run",familyId,database:(await client.query("SELECT current_database() AS name")).rows[0].name,counts},null,2));
 if(!execute){console.log("Dry-run only. Add --execute after reviewing the target and counts.");process.exitCode=0;}
 else{
  await client.query("BEGIN");
  if(backupPath){const backup={familyId,tables:{}};for(const table of tables)backup.tables[table]=(await client.query(`SELECT * FROM ${table} WHERE family_id=$1`,[familyId])).rows;await writeFile(backupPath,JSON.stringify(backup,null,2),{flag:"wx",mode:0o600});}
  for(const table of tables)await client.query(`DELETE FROM ${table} WHERE family_id=$1`,[familyId]);
  await client.query("COMMIT");console.log("Sports test rows removed in dependency order.");
 }
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await pool.end();}
