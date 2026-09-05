import "dotenv/config";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db";
import { User } from "../models/User";
import { WardOperatorProfile } from "../models/WardOperatorProfile";
import { findWardOperatorForLogin } from "../services/ward-operator-auth";

async function main() {
  await connectDB();
  const username = "prakash_changu7";
  const password = "prakash_changu7";

  const match = await findWardOperatorForLogin(username);
  console.log("findWardOperatorForLogin:", match ? {
    userId: match.user._id.toString(),
    email: match.user.email,
    username: match.profile.username,
    active: match.profile.active,
    operatorName: match.profile.operatorName,
  } : null);

  const profiles = await WardOperatorProfile.find({
    $or: [
      { username: /prakash|changu/i },
      { operatorName: /prakash|lamich/i },
    ],
  }).lean();
  console.log("matching profiles:", profiles.map((p) => ({
    id: p._id.toString(),
    username: p.username,
    active: p.active,
    userId: p.userId?.toString(),
    operatorName: p.operatorName,
  })));

  const users = await User.find({
    $or: [
      { email: /prakash|changu|ward/i },
      { name: /prakash|lamich/i },
    ],
  }).select("+passwordHash email name userType").lean();
  console.log("matching users:", users.map((u) => ({
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    userType: u.userType,
    hasHash: Boolean(u.passwordHash),
  })));

  if (match?.user.passwordHash) {
    const ok = await bcrypt.compare(password, match.user.passwordHash);
    console.log("password match for find result:", ok);
  } else if (users.length) {
    for (const u of users) {
      if (!u.passwordHash) continue;
      const ok = await bcrypt.compare(password, u.passwordHash);
      console.log(`password match for ${u.email}:`, ok);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
