#!/usr/bin/env node
import { run } from "./cli.js";

const code = await run(process.argv.slice(2), {
  fetch,
  env: process.env,
  now: () => new Date(),
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
});
process.exit(code);
