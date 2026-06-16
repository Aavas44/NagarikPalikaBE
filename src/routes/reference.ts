import { Router } from "express";
import fs from "fs";
import { dataFilePath } from "../lib/dataPath";

const router = Router();

router.get("/provinces", (_req, res) => {
  const file = dataFilePath("nepal-provinces-districts.json");
  res.json(JSON.parse(fs.readFileSync(file, "utf-8")));
});

router.get("/specialties", (_req, res) => {
  const file = dataFilePath("legal-specialties.json");
  res.json(JSON.parse(fs.readFileSync(file, "utf-8")));
});

export default router;
