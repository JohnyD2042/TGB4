#!/usr/bin/env node
import { executeCheck } from './runOnce.mjs';

const out = await executeCheck();
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
