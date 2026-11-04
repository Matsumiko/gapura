import { cpus, platform, release } from "node:os";
import { hashAdminPassword, verifyAdminPassword } from "../src/services/admin-password.ts";

const RUNS = Number(process.argv[2] ?? 5);
if (!Number.isInteger(RUNS) || RUNS < 1) {
  throw new Error("Jumlah run harus bilangan bulat >= 1.");
}

const PASSWORD = "password-yang-panjang";
const samples = { hash: [] as number[], verify: [] as number[] };
const cpu = cpus()[0]?.model ?? "unknown";

console.log("Argon2id admin password benchmark");
console.log("params: m=19456 KiB, t=2, p=1, dkLen=32 (lihat src/services/admin-password.ts)");
console.log(`runtime: node ${process.version} ${platform()} ${release()} (${cpu})`);
console.log(`runs: ${RUNS} (+1 warmup per operasi)\n`);

let encoded = "";
for (let index = 0; index < RUNS + 1; index += 1) {
  const started = performance.now();
  encoded = await hashAdminPassword(PASSWORD);
  const elapsed = performance.now() - started;
  if (index > 0) {
    samples.hash.push(elapsed);
  }
}
for (let index = 0; index < RUNS + 1; index += 1) {
  const started = performance.now();
  await verifyAdminPassword(PASSWORD, encoded);
  const elapsed = performance.now() - started;
  if (index > 0) {
    samples.verify.push(elapsed);
  }
}

function summarize(label: string, values: number[]): void {
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  console.log(
    `${label}: min ${Math.min(...values).toFixed(1)} ms, median ${median.toFixed(1)} ms, mean ${mean.toFixed(1)} ms, max ${Math.max(...values).toFixed(1)} ms`,
  );
}

summarize("hash  ", samples.hash);
summarize("verify", samples.verify);
const meanVerify = samples.verify.reduce((total, value) => total + value, 0) / samples.verify.length;
console.log(
  `\nPerkiraan CPU per login (verify) dan bootstrap (hash): ~${Math.round(meanVerify)} ms lokal. Bandingkan dengan batas CPU Workers free tier (10 ms/invocation).`,
);
