import { DbService, safeJson } from './db.service.js';
import { WorkerService } from './worker.service.js';

const db = new DbService();
db.init();
const worker = new WorkerService(db);
const jobId = process.argv[2] || '';
const job = jobId
  ? db.get('select * from jobs where id=?', [jobId])
  : db.get("select * from jobs where tenant='pattern-lab.local' and status='queued' order by scheduled_at limit 1");
if (!job) {
  console.log('no pattern-lab job');
  process.exit(0);
}
if (job.status !== 'running') db.run('update jobs set status=\'running\', started_at=CURRENT_TIMESTAMP, finished_at=null, error=null, result=null where id=?', [job.id]);
try {
  const payload = safeJson(job.payload, {});
  const result = await worker.process({ ...job, status: 'running', payload_obj: payload });
  db.completeJob(job.id, Number(result.fail || 0) === 0, result, Number(result.fail || 0) === 0 ? undefined : 'one or more slots failed');
  console.log(JSON.stringify({ job_id: job.id, ...result }, null, 2));
  if (Number(result.fail || 0) !== 0) process.exitCode = 1;
} catch (error: any) {
  db.completeJob(job.id, false, undefined, error?.message || String(error));
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
