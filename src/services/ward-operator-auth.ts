import type { IUser } from "../models/User";
import { User } from "../models/User";
import {
  WardOperatorProfile,
  type IWardOperatorProfile,
} from "../models/WardOperatorProfile";
import { normalizeWardLoginIdentifier } from "./ward-operator-utils";

export async function findWardOperatorForLogin(
  identifier: string
): Promise<{ user: IUser; profile: IWardOperatorProfile } | null> {
  const normalized = normalizeWardLoginIdentifier(identifier);
  if (!normalized) return null;

  const profileByUsername = await WardOperatorProfile.findOne({
    username: normalized,
  });
  if (profileByUsername) {
    const user = await User.findOne({
      _id: profileByUsername.userId,
      userType: "wardOperator",
    });
    if (user) {
      return { user, profile: profileByUsername };
    }
  }

  const userByEmail = await User.findOne({
    email: normalized,
    userType: "wardOperator",
  });
  if (!userByEmail) return null;

  const profile = await WardOperatorProfile.findOne({ userId: userByEmail._id });
  if (!profile) return null;

  return { user: userByEmail, profile };
}
