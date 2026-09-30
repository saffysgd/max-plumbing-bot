import { Router, type IRouter } from "express";
import healthRouter from "./health";
import maxBotRouter from "./max-bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(maxBotRouter);

export default router;
