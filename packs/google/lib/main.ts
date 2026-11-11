import { main, realIo } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2), realIo());
