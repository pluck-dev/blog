import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { PublicController } from "./public.controller.js";
import { DbService } from "./db.service.js";
import { DrivingplusApiService } from "./drivingplus-api.service.js";
import { SlotService } from "./slot.service.js";
import { WorkerService } from "./worker.service.js";

@Module({
  controllers: [AdminController, PublicController],
  providers: [DbService, DrivingplusApiService, SlotService, WorkerService],
})
export class AppModule {}
