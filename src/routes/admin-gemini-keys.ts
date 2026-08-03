import { Router, type Response, type NextFunction } from "express";
import {
  requireAuth,
  requireSuperadmin,
  type AuthRequest,
} from "../middleware/auth";
import {
  bootstrapGeminiKeysFromPayload,
  createGeminiApiKey,
  deleteGeminiApiKey,
  getRuntimeGeminiKeyPool,
  importGeminiKeysFromPayload,
  listGeminiApiKeys,
  markGeminiKeyUsed,
  reportGeminiKeyError,
  revealGeminiApiKey,
  updateGeminiApiKey,
} from "../services/gemini-api-keys";

const router = Router();

const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET?.trim() ||
  process.env.CRON_SECRET?.trim() ||
  "dev-cron-secret";

function hasInternalSecret(req: AuthRequest): boolean {
  const header =
    req.headers["x-internal-secret"] ?? req.headers["x-cron-secret"];
  const value = Array.isArray(header) ? header[0] : header;
  return Boolean(value && value === INTERNAL_SECRET);
}

function requireSuperadminOrInternal(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (hasInternalSecret(req)) {
    next();
    return;
  }
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    requireSuperadmin(req, res, next);
  });
}

function requireSuperadminJwt(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    requireSuperadmin(req, res, next);
  });
}

/** Ordered plaintext keys for Next.js Gemini client. */
router.get(
  "/gemini-keys/runtime",
  requireSuperadminOrInternal,
  async (_req, res) => {
    try {
      const keys = await getRuntimeGeminiKeyPool();
      res.json({
        keys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          role: k.role,
          apiKey: k.apiKey,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load Gemini key pool" });
    }
  }
);

/** Seed from Next.js env when DB is empty. */
router.post(
  "/gemini-keys/bootstrap",
  requireSuperadminOrInternal,
  async (req, res) => {
    try {
      const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
      const result = await bootstrapGeminiKeysFromPayload(
        keys.map(
          (k: { label?: string; apiKey?: string; role?: string }) => ({
            label: typeof k.label === "string" ? k.label : undefined,
            apiKey: String(k.apiKey ?? ""),
            role:
              k.role === "default" || k.role === "fallback" || k.role === "pool"
                ? k.role
                : undefined,
          })
        )
      );
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Bootstrap failed",
      });
    }
  }
);

/** Upsert GEMINI_API_KEY / FALLBACK (and any labeled keys) from Next env. */
router.post(
  "/gemini-keys/import-env",
  requireSuperadminOrInternal,
  async (req, res) => {
    try {
      const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
      const mapped = keys
        .map((k: { label?: string; apiKey?: string; role?: string }) => {
          if (typeof k.label !== "string" || !k.label.trim()) return null;
          if (typeof k.apiKey !== "string" || !k.apiKey.trim()) return null;
          const role =
            k.role === "default" || k.role === "fallback" || k.role === "pool"
              ? k.role
              : "pool";
          return { label: k.label.trim(), apiKey: k.apiKey.trim(), role };
        })
        .filter(Boolean) as Array<{
        label: string;
        apiKey: string;
        role: "default" | "fallback" | "pool";
      }>;
      const result = await importGeminiKeysFromPayload(mapped);
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Import failed",
      });
    }
  }
);

router.post(
  "/gemini-keys/:id/report-error",
  requireSuperadminOrInternal,
  async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const message =
        typeof req.body?.error === "string"
          ? req.body.error
          : typeof req.body?.message === "string"
            ? req.body.message
            : "Unknown error";
      const updated = await reportGeminiKeyError(id, message);
      if (!updated) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to report error",
      });
    }
  }
);

router.post(
  "/gemini-keys/:id/mark-used",
  requireSuperadminOrInternal,
  async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      await markGeminiKeyUsed(id);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "Failed to mark key used" });
    }
  }
);

router.get("/gemini-keys", requireSuperadminJwt, async (req, res) => {
  try {
    const revealId =
      typeof req.query.reveal === "string" ? req.query.reveal : null;
    const keys = await listGeminiApiKeys();
    if (revealId) {
      const revealed = await revealGeminiApiKey(revealId);
      if (!revealed) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json({
        keys: keys.map((k) => (k.id === revealId ? revealed : k)),
      });
      return;
    }
    res.json({ keys });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list Gemini keys" });
  }
});

router.post("/gemini-keys", requireSuperadminJwt, async (req, res) => {
  try {
    const { label, apiKey, role } = req.body as {
      label?: string;
      apiKey?: string;
      role?: string;
    };
    if (!label?.trim() || !apiKey?.trim()) {
      res.status(400).json({ error: "label and apiKey are required" });
      return;
    }
    const created = await createGeminiApiKey({
      label,
      apiKey,
      role:
        role === "default" || role === "fallback" || role === "pool"
          ? role
          : "pool",
    });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to add key",
    });
  }
});

router.patch("/gemini-keys/:id", requireSuperadminJwt, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { label, active, setRole } = req.body as {
      label?: string;
      active?: boolean;
      setRole?: string;
    };
    const updated = await updateGeminiApiKey(id, {
      label,
      active,
      setRole:
        setRole === "default" || setRole === "fallback" || setRole === "pool"
          ? setRole
          : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Key not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update key",
    });
  }
});

router.delete("/gemini-keys/:id", requireSuperadminJwt, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteGeminiApiKey(id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to delete key",
    });
  }
});

export default router;
