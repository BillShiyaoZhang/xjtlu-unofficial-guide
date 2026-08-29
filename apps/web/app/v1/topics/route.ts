import { publicJson } from '@/lib/http';
import { listTopics } from '@/lib/repository';

export async function GET() {
  return publicJson({
    data: await listTopics(),
    request_id: crypto.randomUUID(),
  });
}
