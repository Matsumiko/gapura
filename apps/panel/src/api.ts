export interface HealthResponse {
  status: string;
  service: string;
  environment: string;
}

export const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787";

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/health`);
  if (!response.ok) {
    throw new Error(`API membalas HTTP ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}
