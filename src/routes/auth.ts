import { Router } from "express";
import bcrypt from "bcryptjs";
import { User, userToJson, type IUser } from "../models/User";
import {
  requireAuth,
  signToken,
  type AuthRequest,
} from "../middleware/auth";
import {
  exchangeGoogleCode,
  getGoogleAuthUrl,
} from "../services/payments";
import { AdvocateProfile, advocateToJson } from "../models/AdvocateProfile";
import {
  signSajiloKanunToken,
} from "../middleware/sajilokanun-auth";
import {
  accountToAuthUser,
} from "../services/team-accounts";
import { provisionIndividualSajiloAccount } from "../services/individual-accounts";

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

export async function createCitizenSession(
  user: IUser,
  passwordHash?: string
) {
  const account = await provisionIndividualSajiloAccount({
    platformUserId: user._id.toString(),
    name: user.name,
    email: user.email,
    passwordHash,
  });
  return {
    token: signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      userType: user.userType,
    }),
    sajiloKanunToken: signSajiloKanunToken(accountToAuthUser(account)),
    user: userToJson(user),
  };
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      userType: { $in: ["admin", "superadmin"] },
    });
    if (!user?.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      userType: user.userType,
    });

    res.json({ token, user: userToJson(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/user/register", async (req, res) => {
  try {
    const { name, email, password } = req.body as {
      name?: string;
      email?: string;
      password?: string;
    };
    const normalizedEmail = email?.trim().toLowerCase();
    if (!name?.trim() || !normalizedEmail || !password) {
      res.status(400).json({ error: "Name, email, and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    if (await User.exists({ email: normalizedEmail })) {
      res.status(409).json({
        error: "An account with this email already exists. Sign in instead.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      authProvider: "local",
      userType: "user",
    });
    res.status(201).json(await createCitizenSession(user, passwordHash));
  } catch (err) {
    console.error("Citizen registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/user/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await User.findOne({
      email: normalizedEmail,
      userType: "user",
    });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.json(await createCitizenSession(user, user.passwordHash));
  } catch (err) {
    console.error("Citizen login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/google", (_req, res) => {
  const url = getGoogleAuthUrl();
  if (!url) {
    res.redirect(`${FRONTEND_URL}/sajilokanun/login?error=google_not_configured`);
    return;
  }
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;

    if (!code) {
      res.redirect(`${FRONTEND_URL}/sajilokanun/login?error=oauth_cancelled`);
      return;
    }

    const googleUser = await exchangeGoogleCode(code);
    const existing = await User.findOne({
      $or: [{ googleId: googleUser.googleId }, { email: googleUser.email.toLowerCase() }],
    });

    if (existing?.userType === "advocate") {
      res.redirect(`${FRONTEND_URL}/advocate/login?error=use_advocate_login`);
      return;
    }

    if (
      existing?.userType === "admin" ||
      existing?.userType === "superadmin"
    ) {
      res.redirect(`${FRONTEND_URL}/sajilokanun/login?error=use_admin_login`);
      return;
    }

    let user = existing;
    if (!user) {
      user = await User.create({
        name: googleUser.name,
        email: googleUser.email.toLowerCase(),
        googleId: googleUser.googleId,
        avatarUrl: googleUser.avatarUrl,
        authProvider: "google",
        userType: "user",
      });
    } else if (!user.googleId) {
      user.googleId = googleUser.googleId;
      user.avatarUrl = googleUser.avatarUrl ?? user.avatarUrl;
      user.authProvider = "google";
      await user.save();
    }

    const session = await createCitizenSession(user);

    res.redirect(
      `${FRONTEND_URL}/auth/callback?token=${encodeURIComponent(session.token)}&sajiloToken=${encodeURIComponent(session.sajiloKanunToken)}&redirect=${encodeURIComponent("/sajilokanun/chat")}`
    );
  } catch (err) {
    console.error("Google callback error:", err);
    res.redirect(`${FRONTEND_URL}/sajilokanun/login?error=oauth_failed`);
  }
});

router.post("/advocate/register", async (req, res) => {
  try {
    const {
      email,
      password,
      advocateName,
      firmName,
      specialties,
      provinces,
      districts,
      mobile,
      whatsapp,
      viber,
      bio,
    } = req.body as {
      email?: string;
      password?: string;
      advocateName?: string;
      firmName?: string;
      specialties?: string[];
      provinces?: string[];
      districts?: string[];
      mobile?: string;
      whatsapp?: string;
      viber?: string;
      bio?: string;
    };

    if (!email || !password || !advocateName || !firmName) {
      res.status(400).json({ error: "Email, password, name, and firm name are required" });
      return;
    }
    if (!specialties?.length || !provinces?.length || !districts?.length || !mobile) {
      res.status(400).json({ error: "Specialties, location, and mobile are required" });
      return;
    }
    if (!whatsapp && !viber) {
      res.status(400).json({ error: "WhatsApp or Viber is required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: advocateName,
      email: normalizedEmail,
      passwordHash,
      authProvider: "local",
      userType: "advocate",
    });

    const profile = await AdvocateProfile.create({
      userId: user._id,
      firmName,
      advocateName,
      specialties,
      provinces,
      districts,
      mobile,
      whatsapp,
      viber,
      bio,
      status: "pending",
    });

    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      userType: user.userType,
    });

    res.status(201).json({
      token,
      user: userToJson(user),
      profile: advocateToJson(profile, { includeContact: true }),
    });
  } catch (err) {
    console.error("Advocate register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/advocate/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase(), userType: "advocate" });
    if (!user?.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      userType: user.userType,
    });

    res.json({ token, user: userToJson(user) });
  } catch (err) {
    console.error("Advocate login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;
