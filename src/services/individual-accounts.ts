import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";
import {
  SajiloKanunAccount,
  type ISajiloKanunAccount,
} from "../models/SajiloKanunAccount";

export async function provisionIndividualSajiloAccount(params: {
  platformUserId: string;
  name: string;
  email: string;
  passwordHash?: string;
}): Promise<ISajiloKanunAccount> {
  const platformUserId = new mongoose.Types.ObjectId(params.platformUserId);
  const email = params.email.trim().toLowerCase();

  let account = await SajiloKanunAccount.findOne({ platformUserId });
  if (!account) {
    account = await SajiloKanunAccount.findOne({
      email,
      teamId: null,
      role: null,
      platformUserId: { $exists: false },
    });
  }

  if (account) {
    account.platformUserId = platformUserId;
    account.name = params.name.trim();
    account.email = email;
    account.active = true;
    if (params.passwordHash) account.passwordHash = params.passwordHash;
    await account.save();
    return account;
  }

  const emailUsernameTaken = await SajiloKanunAccount.exists({ username: email });
  const username = emailUsernameTaken
    ? `individual-${params.platformUserId.slice(-10).toLowerCase()}`
    : email;
  const passwordHash =
    params.passwordHash ??
    (await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10));

  return SajiloKanunAccount.create({
    username,
    passwordHash,
    name: params.name.trim(),
    email,
    active: true,
    platformUserId,
  });
}
