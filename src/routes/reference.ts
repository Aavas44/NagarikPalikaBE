import { Router } from "express";
import fs from "fs";
import { dataFilePath } from "../lib/dataPath";
import { listCourtsGrouped } from "../services/courts";

const router = Router();

router.get("/provinces", (_req, res) => {
  const file = dataFilePath("nepal-provinces-districts.json");
  res.json(JSON.parse(fs.readFileSync(file, "utf-8")));
});

router.get("/specialties", (_req, res) => {
  const file = dataFilePath("legal-specialties.json");
  res.json(JSON.parse(fs.readFileSync(file, "utf-8")));
});

/** Nepal court catalog grouped by category identifier. */
router.get("/courts", async (_req, res) => {
  try {
    const data = await listCourtsGrouped();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load courts" });
  }
});

export default router;
