import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { WorkerService } from "./worker.service.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: corsOptions() });
  const host = process.env.ADMIN_HOST || "127.0.0.1";
  const port = Number(process.env.ADMIN_PORT || 8765);
  await app.listen(port, host);
  if (process.env.API_WORKER === "1") app.get(WorkerService).startLoop();
  console.log(`Nest SEO API listening on http://${host}:${port}`);
}

function corsOptions() {
  const origins = (process.env.PUBLIC_API_ORIGINS || "*").trim();
  return { origin: origins === "*" ? true : origins.split(",").map((o) => o.trim()).filter(Boolean), credentials: true, methods: "GET,HEAD,PUT,PATCH,POST,DELETE", allowedHeaders: "*" };
}

bootstrap().catch((error) => { console.error(error); process.exit(1); });
