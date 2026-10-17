import { defineConfig } from "@playwright/test";
import sports from "./playwright.sports-next.config";
export default defineConfig({ ...sports, testMatch: /champions\.spec\.ts/, projects: sports.projects?.map(p=>({...p,testMatch:/champions\.spec\.ts/})), webServer: { command:"npm run start -- -p 3318",url:"http://localhost:3318",reuseExistingServer:false,timeout:45000,env:{BETTER_AUTH_URL:"http://localhost:3318",SPORTS_ENABLED:"true",SPORTS_AGENDA_ENABLED:"true",SPORTS_CHAMPIONS_ENABLED:"true",DATABASE_URL:process.env.FAMILY_UTILS_TEST_DATABASE_URL!} } });
