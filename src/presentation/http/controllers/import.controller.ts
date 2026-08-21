import { Request, Response, NextFunction } from "express";
import { pool } from '../../../infrastructure/db/index.js';
export class ImportController {
  constructor(private isAcceptingTraffic: () => boolean = () => true) {}

  public getLiveness = async (_req: Request, res: Response) => {
    res
      .status(200)
      .json({ status: "live", timestamp: new Date().toISOString() });
  };

  public getReadiness = async (_req: Request, res: Response) => {
    if (!this.isAcceptingTraffic()) {
      return res
        .status(503)
        .json({ status: "not_ready", reason: "shutting_down" });
    }
    try {
      await pool.query("SELECT 1");
      res
        .status(200)
        .json({
          status: "ready",
          database: "connected",
          timestamp: new Date().toISOString(),
        });
    } catch {
      res.status(503).json({ status: "not_ready", database: "disconnected" });
    }
  };
}
