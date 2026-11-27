export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { productionWarnings } = await import("./server/startup-checks");
  for (const w of productionWarnings()) console.warn(`[portal] CẢNH BÁO: ${w}`);
  if (process.env.DATABASE_URL) {
    const { startJobs } = await import("./server/jobs");
    startJobs();
  }
}
