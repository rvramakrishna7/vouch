import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { logAudit } from "../audit.js";
import { signToken } from "../auth/jwt.js";
import { timingStorage } from "../middleware/timing.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import pool from "../db/pool.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const demoSchema = z.object({
  role: z.enum(["brand_manager", "creator", "reviewer"]),
});

// POST /api/auth/login
authRouter.post("/login", async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input" });
  }

  const { email, password } = parseResult.data;

  try {
    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      email: string;
      password_hash: string;
      role: string;
      organization_name: string;
    }>(
      `SELECT u.id, u.organization_id, u.name, u.email, u.password_hash, u.role, o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const user = rows[0];
    const authStart = performance.now();
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = signToken({
      sub: user.id,
      org: user.organization_id,
      role: user.role,
    });
    const timingStore = timingStorage.getStore();
    if (timingStore) {
      timingStore.authTime += performance.now() - authStart;
    }

    await logAudit({
      organizationId: user.organization_id,
      actor: user.email,
      action: "auth.login",
      entity: `user:${user.id}`,
      payload: { role: user.role },
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: user.organization_id,
        name: user.organization_name,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/auth/demo
authRouter.post("/demo", async (req: Request, res: Response) => {
  if (process.env.DEMO_LOGIN_ENABLED !== "true") {
    return res.status(404).json({ error: "not_found" });
  }

  const parseResult = demoSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "invalid_input" });
  }

  const { role } = parseResult.data;

  try {
    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      email: string;
      role: string;
      organization_name: string;
    }>(
      `SELECT u.id, u.organization_id, u.name, u.email, u.role, o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE o.slug = 'aqualeaf' AND u.role = $1
       LIMIT 1`,
      [role],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "demo_user_not_found" });
    }

    const user = rows[0];
    const authStart = performance.now();
    const token = signToken({
      sub: user.id,
      org: user.organization_id,
      role: user.role,
    });
    const timingStore = timingStorage.getStore();
    if (timingStore) {
      timingStore.authTime += performance.now() - authStart;
    }

    await logAudit({
      organizationId: user.organization_id,
      actor: user.email,
      action: "auth.demo_login",
      entity: `user:${user.id}`,
      payload: { role: user.role },
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: user.organization_id,
        name: user.organization_name,
      },
    });
  } catch (err) {
    console.error("Demo login error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/auth/me
authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { rows } = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      email: string;
      role: string;
      organization_name: string;
    }>(
      `SELECT u.id, u.organization_id, u.name, u.email, u.role, o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1 AND u.organization_id = $2`,
      [req.user.id, req.user.organizationId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const user = rows[0];
    const authStart = performance.now();
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization: {
        id: user.organization_id,
        name: user.organization_name,
      },
    });
  } catch (err) {
    console.error("Get /me error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// Test-only route for requireRole verification
if (process.env.NODE_ENV !== "production") {
  authRouter.get(
    "/test-role-reviewer",
    requireAuth,
    requireRole("reviewer"),
    (_req: Request, res: Response) => {
      res.json({ ok: true });
    },
  );
}

export default authRouter;
