import { handleResearchIntakeRequest } from '@/lib/research-intake-http';

export async function POST(request: Request) {
  return handleResearchIntakeRequest(request, 'question');
}
