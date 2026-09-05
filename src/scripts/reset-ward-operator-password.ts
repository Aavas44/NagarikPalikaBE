/**
 * Reset a ward operator password.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/reset-ward-operator-password.ts prakash_changu7 prakash_changu7
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import { findWardOperatorForLogin } from "../services/ward-operator-auth";

async function main() {
  const username = (process.argv[2] || "").trim();
  const password = process.argv[3] || "";
  if (!username || !password) {
    throw new Error("Usage: npx tsx src/scripts/reset-ward-operator-password.ts <username> <password>");
  }

  await connectDB();
  const match = await findWardOperatorForLogin(username);
  if (!match) {
    throw new Error(`Ward operator not found for: ${username}`);
  }
  if (!match.profile.active) {
    throw new Error(`Ward operator is inactive: ${username}`);
  }

  match.user.passwordHash = await bcrypt.hash(password, 10);
  await match.user.save();

  const ok = await bcrypt.compare(password, match.user.passwordHash);
  console.log(
    JSON.stringify(
      {
        username: match.profile.username,
        email: match.user.email,
        operatorName: match.profile.operatorName,
        passwordReset: ok,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
